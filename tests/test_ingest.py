from __future__ import annotations

import io
import logging
import urllib.error
from typing import Any

import pytest

from conftest import load_fixture, make_minute
from epcube_collector import db
from epcube_collector.cli import main
from epcube_collector.gateway import GatewayAuthError, GatewayClient, GatewayError
from epcube_collector.ingest import (
    EXIT_GATEWAY,
    EXIT_OK,
    EXIT_STALE,
    META_BLE_DOWN_SINCE,
    run_once,
)

NOW = 1_800_000_000  # 60の倍数


class FakeGateway:
    def __init__(self, minutes: list[dict[str, Any]], time_valid: bool = True,
                 latest: Any = None, now: int = NOW, latest_error: Exception | None = None) -> None:
        self.minutes = minutes
        self.time_valid = time_valid
        self.latest = latest if latest is not None else load_fixture("latest.json")
        self.now = now
        self.latest_error = latest_error
        self.since_calls: list[int | None] = []
        self.latest_calls = 0

    def get_minutes(self, since: int | None, limit: int = 180) -> Any:
        self.since_calls.append(since)
        mins = [m for m in self.minutes if since is None or m["ts"] > since]
        return {"device": "epcube-gw", "now": self.now, "time_valid": self.time_valid, "minutes": mins[:limit]}

    def get_latest(self, cells: bool = True) -> Any:
        self.latest_calls += 1
        if self.latest_error:
            raise self.latest_error
        data = dict(self.latest)
        data["now"] = self.now
        return data


def clock() -> float:
    return NOW + 5


def test_since_and_idempotent(cfg, conn) -> None:
    gw = FakeGateway([make_minute(NOW - 180), make_minute(NOW - 120), make_minute(NOW - 60)])
    r1 = run_once(cfg, gw, conn, clock=clock)
    assert r1.exit_code == EXIT_OK and r1.saved == 3
    r2 = run_once(cfg, gw, conn, clock=clock)
    assert gw.since_calls == [None, NOW - 60]
    assert r2.saved == 0
    assert db.count_rows(conn, "minute_samples") == 3


def test_time_valid_false_not_ingested(cfg, conn, caplog) -> None:
    gw = FakeGateway([make_minute(NOW - 60)], time_valid=False)
    with caplog.at_level(logging.WARNING):
        r = run_once(cfg, gw, conn, clock=clock)
    assert r.saved == 0
    assert db.count_rows(conn, "minute_samples") == 0
    assert "time_valid=false" in caplog.text


def test_stale_detection(cfg, conn) -> None:
    db.upsert_minutes(conn, [])
    gw = FakeGateway([make_minute(NOW - 600)])
    r = run_once(cfg, gw, conn, clock=clock)
    assert r.saved == 1
    assert r.exit_code == EXIT_STALE


def test_low_n_and_gap_warnings(cfg, conn, caplog) -> None:
    gw = FakeGateway([make_minute(NOW - 240, n=6), make_minute(NOW - 60, n=2)])
    with caplog.at_level(logging.WARNING):
        r = run_once(cfg, gw, conn, clock=clock)
    assert r.exit_code == EXIT_OK
    assert "品質低下" in caplog.text
    assert "欠損" in caplog.text and "2 分" in caplog.text


def test_future_ts_rejected(cfg, conn) -> None:
    gw = FakeGateway([make_minute(NOW - 60), make_minute(NOW + 3600)])
    r = run_once(cfg, gw, conn, clock=clock)
    assert [row["ts"] for row in r.rows] == [NOW - 60]


def test_dry_run_does_not_write(cfg, conn) -> None:
    gw = FakeGateway([make_minute(NOW - 60)])
    r = run_once(cfg, gw, conn, dry_run=True, clock=clock)
    assert len(r.rows) == 1 and r.saved == 0
    assert db.count_rows(conn, "minute_samples") == 0
    assert gw.latest_calls == 0


def test_snapshot_interval(cfg, conn) -> None:
    gw = FakeGateway([make_minute(NOW - 60)])
    r = run_once(cfg, gw, conn, clock=clock)
    assert r.snapshot_ts is not None and r.snapshot_ts % 60 == 0
    assert db.count_rows(conn, "bms_snapshots") == 1
    run_once(cfg, gw, conn, clock=lambda: NOW + 65)
    assert gw.latest_calls == 1  # 10分経つまで再取得しない
    run_once(cfg, gw, conn, clock=lambda: NOW + 5 + cfg.snapshot_interval)
    assert gw.latest_calls == 2


def test_snapshot_failure_is_nonzero_and_retried(cfg, conn) -> None:
    gw = FakeGateway([make_minute(NOW - 60)], latest_error=GatewayError("timeout"))
    r = run_once(cfg, gw, conn, clock=clock)
    assert r.saved == 1 and r.exit_code == EXIT_GATEWAY
    run_once(cfg, gw, conn, clock=lambda: NOW + 65)
    assert gw.latest_calls == 2


def test_ble_disconnected_and_stats_delta(cfg, conn, caplog) -> None:
    latest = load_fixture("latest.json")
    gw = FakeGateway([make_minute(NOW - 60)], latest=latest)
    run_once(cfg, gw, conn, clock=clock)
    bad = dict(latest, ble_connected=False, stats=dict(latest["stats"], fast_fail=latest["stats"]["fast_fail"] + 7),
               uptime_s=latest["uptime_s"] + 600)
    gw.latest = bad
    with caplog.at_level(logging.WARNING):
        run_once(cfg, gw, conn, clock=lambda: NOW + 5 + cfg.snapshot_interval)
    assert "BLE未接続" in caplog.text
    assert "fast_fail が +7" in caplog.text
    assert db.get_meta(conn, META_BLE_DOWN_SINCE) is not None


# ---------------------------------------------------------------- HTTPクライアント


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_client_sends_token_and_params() -> None:
    seen = {}

    def opener(req, timeout):
        seen["url"] = req.full_url
        seen["token"] = req.get_header("X-api-token")
        seen["timeout"] = timeout
        return FakeResp(b'{"minutes": []}')

    c = GatewayClient("http://gw/", token="secret", timeout=10, urlopen=opener)
    assert c.get_minutes(since=120, limit=500) == {"minutes": []}
    assert seen["url"] == "http://gw/api/minutes?limit=180&since=120"
    assert seen["token"] == "secret" and seen["timeout"] == 10


def test_client_errors() -> None:
    def unauthorized(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)

    def refused(req, timeout):
        raise urllib.error.URLError(ConnectionRefusedError())

    def bad_json(req, timeout):
        return FakeResp(b"<html>")

    with pytest.raises(GatewayAuthError):
        GatewayClient("http://gw", urlopen=unauthorized).get_latest()
    with pytest.raises(GatewayError):
        GatewayClient("http://gw", urlopen=refused).get_latest()
    with pytest.raises(GatewayError):
        GatewayClient("http://gw", urlopen=bad_json).get_latest()


def test_cli_exit_codes(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("EPCUBE_DB_PATH", str(tmp_path / "c.db"))
    monkeypatch.setenv("EPCUBE_GW_URL", "ftp://bad")
    assert main(["once"]) == 2

    monkeypatch.setenv("EPCUBE_GW_URL", "http://gw")

    def auth_fail(self, since, limit=180):
        raise GatewayAuthError("401")

    monkeypatch.setattr(GatewayClient, "get_minutes", auth_fail)
    assert main(["once"]) == 4

    def down(self, since, limit=180):
        raise GatewayError("down")

    monkeypatch.setattr(GatewayClient, "get_minutes", down)
    assert main(["once"]) == 3

