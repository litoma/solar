from __future__ import annotations

import io
import json
import urllib.error

import pytest

from conftest import make_minute
from epcube_collector import db
from epcube_collector.config import Config
from epcube_collector.parse import parse_minutes_response
from epcube_collector.sync import (
    META_DAILY_BACKFILLED,
    META_SYNCED_MINUTE_TS,
    META_SYNCED_SNAPSHOT_TS,
    SyncError,
    sync_to_cloud,
)

NEW_WORKER_BODY = b'{"ok":true,"minutes_upserted":0,"snapshots_upserted":0,"daily_upserted":1}'


class FakeHttpResp(io.BytesIO):
    def __init__(self, body: bytes = b'{"ok":true}', status: int = 200) -> None:
        super().__init__(body)
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_sync_sends_unsynced_rows_and_updates_meta(tmp_path) -> None:
    cfg = Config.from_env(
        {
            "EPCUBE_DB_PATH": str(tmp_path / "sync.db"),
            "EPCUBE_SYNC_URL": "https://solar.example.com",
            "EPCUBE_SYNC_TOKEN": "secret-ingest-token",
        }
    )
    conn = db.connect(cfg.db_path)
    try:
        rows = parse_minutes_response(
            {"time_valid": True, "minutes": [make_minute(600), make_minute(660)]}
        ).rows
        db.upsert_minutes(conn, rows)
        db.upsert_snapshot(conn, 600, [3300] * 48, [16] * 16)

        calls: list[dict[str, object]] = []

        def opener(req, timeout):
            calls.append(
                {
                    "url": req.full_url,
                    "auth": req.get_header("Authorization"),
                    "body": json.loads(req.data.decode("utf-8")),
                }
            )
            return FakeHttpResp(NEW_WORKER_BODY)

        res = sync_to_cloud(cfg, conn, urlopen=opener)
        assert res.minutes_sent == 2
        assert res.snapshots_sent == 1
        # 1回目: 全期間の日別サマリーのバックフィル, 2回目: 1分値 + その日の日別サマリー
        assert len(calls) == 2
        backfill, data = calls[0]["body"], calls[1]["body"]
        assert backfill["minutes"] == [] and len(backfill["daily"]) == 1
        assert all(c["url"] == "https://solar.example.com/api/ingest" for c in calls)
        assert all(c["auth"] == "Bearer secret-ingest-token" for c in calls)
        assert len(data["minutes"]) == 2
        assert len(data["snapshots"]) == 1
        assert data["daily"][0]["jst_date"] == "1970-01-01"
        assert db.get_meta(conn, META_SYNCED_MINUTE_TS) == 660
        assert db.get_meta(conn, META_SYNCED_SNAPSHOT_TS) == 600
        assert db.get_meta(conn, META_DAILY_BACKFILLED) is True

        # 2回目は差分がないためリクエストを投げない
        res2 = sync_to_cloud(cfg, conn, urlopen=lambda *a, **k: pytest.fail("should not call"))
        assert res2.minutes_sent == 0 and res2.snapshots_sent == 0
    finally:
        conn.close()


def test_backfill_is_retried_while_worker_does_not_support_daily(tmp_path) -> None:
    cfg = Config.from_env(
        {
            "EPCUBE_DB_PATH": str(tmp_path / "old.db"),
            "EPCUBE_SYNC_URL": "https://solar.example.com",
        }
    )
    conn = db.connect(cfg.db_path)
    try:
        rows = parse_minutes_response({"time_valid": True, "minutes": [make_minute(600)]}).rows
        db.upsert_minutes(conn, rows)
        # 旧 Worker は daily_upserted を返さない
        res = sync_to_cloud(cfg, conn, urlopen=lambda *a, **k: FakeHttpResp())
        assert res.minutes_sent == 1
        assert db.get_meta(conn, META_DAILY_BACKFILLED) is None

        # Worker 更新後はバックフィルが完了する
        bodies: list[dict] = []

        def opener(req, timeout):
            bodies.append(json.loads(req.data.decode("utf-8")))
            return FakeHttpResp(NEW_WORKER_BODY)

        sync_to_cloud(cfg, conn, urlopen=opener)
        assert len(bodies) == 1 and len(bodies[0]["daily"]) == 1
        assert db.get_meta(conn, META_DAILY_BACKFILLED) is True
    finally:
        conn.close()


def test_sync_dry_run_does_not_update_meta(tmp_path) -> None:
    cfg = Config.from_env(
        {
            "EPCUBE_DB_PATH": str(tmp_path / "dry.db"),
            "EPCUBE_SYNC_URL": "https://solar.example.com",
        }
    )
    conn = db.connect(cfg.db_path)
    try:
        rows = parse_minutes_response({"time_valid": True, "minutes": [make_minute(600)]}).rows
        db.upsert_minutes(conn, rows)
        res = sync_to_cloud(cfg, conn, dry_run=True)
        assert res.minutes_sent == 1
        assert db.get_meta(conn, META_SYNCED_MINUTE_TS) is None
    finally:
        conn.close()


def test_sync_http_error(tmp_path) -> None:
    cfg = Config.from_env(
        {
            "EPCUBE_DB_PATH": str(tmp_path / "err.db"),
            "EPCUBE_SYNC_URL": "https://solar.example.com",
        }
    )
    conn = db.connect(cfg.db_path)
    try:
        rows = parse_minutes_response({"time_valid": True, "minutes": [make_minute(600)]}).rows
        db.upsert_minutes(conn, rows)

        def fail_opener(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)

        with pytest.raises(SyncError):
            sync_to_cloud(cfg, conn, urlopen=fail_opener)
        assert db.get_meta(conn, META_SYNCED_MINUTE_TS) is None
    finally:
        conn.close()
