"""SQLite層。

Cloudflare D1 との互換のため INTEGER/REAL/TEXT のみ、トリガー・仮想テーブル・拡張は使わない。
ingest_meta はローカルの取り込み状態用で、D1 へは同期しない想定。
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable, Sequence

from .parse import MINUTE_COLUMNS, Row

SCHEMA_VERSION = 2

_V2_COLUMNS = {"weather_code", "outdoor_temp_c"}


def _create_minute_samples_v1() -> str:
    cols = ",\n  ".join(
        f"{name} {sqltype}" + (" PRIMARY KEY" if name == "ts" else "")
        for name, sqltype in MINUTE_COLUMNS
        if name not in _V2_COLUMNS
    )
    return f"CREATE TABLE IF NOT EXISTS minute_samples (\n  {cols}\n)"


# バージョン番号 -> そのバージョンへ上げるSQL。既存バージョンの内容は変更しないこと。
# 列を増やすときは例: 2: ["ALTER TABLE minute_samples ADD COLUMN xxx REAL"]
MIGRATIONS: dict[int, list[str]] = {
    1: [
        _create_minute_samples_v1(),
        "CREATE TABLE IF NOT EXISTS bms_snapshots ("
        " ts INTEGER PRIMARY KEY, cells_json TEXT, temps_json TEXT)",
        "CREATE TABLE IF NOT EXISTS ingest_meta (key TEXT PRIMARY KEY, value TEXT)",
    ],
    2: [
        "ALTER TABLE minute_samples ADD COLUMN weather_code INTEGER",
        "ALTER TABLE minute_samples ADD COLUMN outdoor_temp_c REAL",
    ],
}


class SchemaError(RuntimeError):
    pass


def connect(path: Path, create: bool = True) -> sqlite3.Connection:
    if not create and not path.exists():
        raise FileNotFoundError(f"DBがありません: {path}")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    conn = sqlite3.connect(str(path), timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    migrate(conn)
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    if current > SCHEMA_VERSION:
        raise SchemaError(f"DBのスキーマ版 {current} はこのプログラム({SCHEMA_VERSION})より新しいです")
    for version in range(current + 1, SCHEMA_VERSION + 1):
        with conn:
            for sql in MIGRATIONS[version]:
                conn.execute(sql)
            conn.execute(f"PRAGMA user_version = {version}")


def schema_version(conn: sqlite3.Connection) -> int:
    return int(conn.execute("PRAGMA user_version").fetchone()[0])


# ---------------------------------------------------------------- minute_samples

_COL_NAMES = [name for name, _ in MINUTE_COLUMNS]
_UPSERT_MINUTE = (
    f"INSERT INTO minute_samples ({', '.join(_COL_NAMES)}) "
    f"VALUES ({', '.join('?' for _ in _COL_NAMES)}) "
    f"ON CONFLICT(ts) DO UPDATE SET "
    + ", ".join(f"{c} = excluded.{c}" for c in _COL_NAMES if c != "ts")
)


def upsert_minutes(conn: sqlite3.Connection, rows: Iterable[Row]) -> int:
    params = [tuple(row.get(c) for c in _COL_NAMES) for row in rows]
    if not params:
        return 0
    with conn:
        conn.executemany(_UPSERT_MINUTE, params)
    return len(params)


def max_minute_ts(conn: sqlite3.Connection) -> int | None:
    value = conn.execute("SELECT MAX(ts) FROM minute_samples").fetchone()[0]
    return None if value is None else int(value)


def recent_minutes(conn: sqlite3.Connection, limit: int) -> list[sqlite3.Row]:
    rows = conn.execute(
        "SELECT * FROM minute_samples ORDER BY ts DESC LIMIT ?", (limit,)
    ).fetchall()
    return list(reversed(rows))


def minutes_since(conn: sqlite3.Connection, since_ts: int, limit: int = 300) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM minute_samples WHERE ts > ? ORDER BY ts ASC LIMIT ?",
        (since_ts, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def count_rows(conn: sqlite3.Connection, table: str) -> int:
    if table not in ("minute_samples", "bms_snapshots"):
        raise ValueError(table)
    return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])


# ---------------------------------------------------------------- bms_snapshots


def upsert_snapshot(
    conn: sqlite3.Connection, ts: int, cells: Sequence[int], temps: Sequence[int] | None
) -> None:
    with conn:
        conn.execute(
            "INSERT INTO bms_snapshots (ts, cells_json, temps_json) VALUES (?, ?, ?) "
            "ON CONFLICT(ts) DO UPDATE SET cells_json = excluded.cells_json, "
            "temps_json = excluded.temps_json",
            (
                ts,
                json.dumps(list(cells), separators=(",", ":")),
                None if temps is None else json.dumps(list(temps), separators=(",", ":")),
            ),
        )


def recent_snapshots(conn: sqlite3.Connection, limit: int) -> list[sqlite3.Row]:
    rows = conn.execute(
        "SELECT * FROM bms_snapshots ORDER BY ts DESC LIMIT ?", (limit,)
    ).fetchall()
    return list(reversed(rows))


def snapshots_since(conn: sqlite3.Connection, since_ts: int, limit: int = 60) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM bms_snapshots WHERE ts > ? ORDER BY ts ASC LIMIT ?",
        (since_ts, limit),
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------- ingest_meta


def get_meta(conn: sqlite3.Connection, key: str) -> Any:
    row = conn.execute("SELECT value FROM ingest_meta WHERE key = ?", (key,)).fetchone()
    return None if row is None else json.loads(row[0])


def set_meta(conn: sqlite3.Connection, key: str, value: Any) -> None:
    with conn:
        conn.execute(
            "INSERT INTO ingest_meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )


def all_meta(conn: sqlite3.Connection) -> dict[str, Any]:
    return {r[0]: json.loads(r[1]) for r in conn.execute("SELECT key, value FROM ingest_meta")}
