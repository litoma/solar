from __future__ import annotations

import pytest

from conftest import load_fixture, make_minute
from epcube_collector.parse import (
    MINUTE_COLUMNS,
    ParseError,
    parse_latest_response,
    parse_minutes_response,
    to_int,
    to_real,
)


def test_real_minutes_fixture() -> None:
    resp = parse_minutes_response(load_fixture("minutes.json"))
    assert resp.time_valid is True
    assert resp.device == "epcube-gw"
    assert resp.rows, "実機応答から1件以上パースできること"
    for row in resp.rows:
        assert set(row) == {c for c, _ in MINUTE_COLUMNS}
        assert row["ts"] % 60 == 0
        assert isinstance(row["pv1_p_min_w"], int)
        assert isinstance(row["pv1_p_avg_w"], float)
        assert isinstance(row["soc"], int)
    assert [r["ts"] for r in resp.rows] == sorted(r["ts"] for r in resp.rows)


def test_bms_null_and_missing_sections() -> None:
    m = make_minute(1800, bms=False)
    del m["sys"]
    resp = parse_minutes_response({"time_valid": True, "minutes": [m]})
    row = resp.rows[0]
    assert row["pack_v"] is None and row["cell_avg_mv"] is None
    assert row["solar_w"] is None
    assert row["pv4_p_avg_w"] == 103.0


def test_zero_and_null_values_are_kept() -> None:
    m = make_minute(1800, p=0)
    m["pv"][2] = {"p_avg": None, "p_min": None, "p_max": None, "v": None, "i": None}
    row = parse_minutes_response({"time_valid": True, "minutes": [m]}).rows[0]
    assert row["pv1_p_avg_w"] == 0.0
    assert row["pv3_p_avg_w"] is None and row["pv3_v"] is None


def test_invalid_ts_rejected_and_short_pv() -> None:
    good = make_minute(120)
    good["pv"] = good["pv"][:2]
    resp = parse_minutes_response({
        "time_valid": True,
        "minutes": [{"ts": 61}, {"ts": "abc"}, {"ts": True}, "x", good],
    })
    assert resp.rejected == 4
    assert len(resp.rows) == 1
    assert resp.rows[0]["pv3_p_avg_w"] is None
    assert any("要素数" in s for s in resp.issues)


def test_time_valid_must_be_true() -> None:
    assert parse_minutes_response({"time_valid": "true", "minutes": []}).time_valid is False
    assert parse_minutes_response({"minutes": []}).time_valid is False


def test_malformed_response() -> None:
    with pytest.raises(ParseError):
        parse_minutes_response({"minutes": None})
    with pytest.raises(ParseError):
        parse_minutes_response([])


@pytest.mark.parametrize(
    "value,real,integer",
    [(1, 1.0, 1), ("2.5", 2.5, 2), (3.6, 3.6, 4), (None, None, None), (True, None, None),
     ("x", None, None), (float("nan"), None, None)],
)
def test_conversions(value, real, integer) -> None:
    assert to_real(value) == real
    assert to_int(value) == integer


def test_real_latest_fixture() -> None:
    latest = parse_latest_response(load_fixture("latest.json"))
    assert latest.time_valid is True
    assert latest.ble_connected is True
    assert latest.cells_mv is not None and len(latest.cells_mv) == 48
    assert latest.temps_c is not None and len(latest.temps_c) == 16
    assert "fast_fail" in latest.stats

