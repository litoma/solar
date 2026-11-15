from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from conftest import make_minute
from epcube_collector import db
from epcube_collector.parse import parse_minutes_response


def rows_for(*ts: int, p: float = 100.0):
    return parse_minutes_response({"time_valid": True, "minutes": [make_minute(t, p=p) for t in ts]}).rows


def test_schema_and_pragmas(conn: sqlite3.Connection) -> None:
    assert db.schema_version(conn) == db.SCHEMA_VERSION
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
    types = {r[1]: r[2] for r in conn.execute("PRAGMA table_info(minute_samples)")}
    assert set(types.values()) <= {"INTEGER", "REAL", "TEXT"}
    assert types["ts"] == "INTEGER" and types["pv1_p_min_w"] == "INTEGER"
    assert conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'").fetchone()[0] == 0


def test_upsert_is_idempotent(conn: sqlite3.Connection) -> None:
    rows = rows_for(60, 120, 180)
    assert db.upsert_minutes(conn, rows) == 3
    db.upsert_minutes(conn, rows)
    assert db.count_rows(conn, "minute_samples") == 3
    assert db.max_minute_ts(conn) == 180


def test_upsert_overwrites_same_minute(conn: sqlite3.Connection) -> None:
    db.upsert_minutes(conn, rows_for(60, p=100))
    db.upsert_minutes(conn, rows_for(60, p=200))
    (row,) = db.recent_minutes(conn, 5)
    assert row["pv1_p_avg_w"] == 200.0


def test_null_bms_saved_as_null(conn: sqlite3.Connection) -> None:
    rows = parse_minutes_response({"time_valid": True, "minutes": [make_minute(60, bms=False)]}).rows
    db.upsert_minutes(conn, rows)
    (row,) = db.recent_minutes(conn, 1)
    assert row["pack_v"] is None and row["temp_avg_c"] is None


def test_reopen_does_not_remigrate(cfg) -> None:
    c = db.connect(cfg.db_path)
    db.upsert_minutes(c, rows_for(60))
    c.close()
    c = db.connect(cfg.db_path)
    assert db.count_rows(c, "minute_samples") == 1
    c.close()


def test_newer_schema_rejected(tmp_path: Path) -> None:
    path = tmp_path / "x.db"
    c = sqlite3.connect(path)
    c.execute("PRAGMA user_version = 99")
    c.close()
    with pytest.raises(db.SchemaError):
        db.connect(path)


def test_snapshot_and_meta(conn: sqlite3.Connection) -> None:
    db.upsert_snapshot(conn, 600, [3300] * 48, [15] * 16)
    db.upsert_snapshot(conn, 600, [3301] * 48, None)
    (snap,) = db.recent_snapshots(conn, 5)
    assert snap["cells_json"].startswith("[3301,")
    assert snap["temps_json"] is None
    db.set_meta(conn, "k", {"a": 1})
    assert db.get_meta(conn, "k") == {"a": 1}
    assert db.get_meta(conn, "missing") is None

