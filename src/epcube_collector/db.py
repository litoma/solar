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


# ---------------------------------------------------------------- daily summary (D1送信用)

JST_OFFSET_SEC = 9 * 3600

# 日別サマリー (Cloudflare D1 の daily_summary テーブルへ送る。ローカルには保存せず毎回計算する)
# 1分値は1分間の平均W なので、W / 60000 で kWh になる。
_DAILY_SUMMARY_SQL = """
SELECT
  strftime('%Y-%m-%d', ts + :tz, 'unixepoch') AS jst_date,
  COALESCE(MAX(solar_day_kwh),
           SUM(CASE WHEN solar_w > 0 THEN solar_w ELSE 0 END) / 60000.0) AS solar_kwh,
  SUM(CASE WHEN grid_w < 0 THEN -grid_w ELSE 0 END) / 60000.0 AS sell_kwh,
  COALESCE(MAX(buy_day_kwh),
           SUM(CASE WHEN grid_w > 0 THEN grid_w ELSE 0 END) / 60000.0) AS buy_kwh,
  COALESCE(MAX(load_day_kwh),
           SUM(CASE WHEN load_w > 0 THEN load_w ELSE 0 END) / 60000.0) AS load_kwh,
  SUM(CASE WHEN pv1_p_avg_w > 0 THEN pv1_p_avg_w ELSE 0 END) / 60000.0 AS pv1_kwh,
  SUM(CASE WHEN pv2_p_avg_w > 0 THEN pv2_p_avg_w ELSE 0 END) / 60000.0 AS pv2_kwh,
  SUM(CASE WHEN pv3_p_avg_w > 0 THEN pv3_p_avg_w ELSE 0 END) / 60000.0 AS pv3_kwh,
  SUM(CASE WHEN pv4_p_avg_w > 0 THEN pv4_p_avg_w ELSE 0 END) / 60000.0 AS pv4_kwh,
  COUNT(*) AS samples,
  MAX(ts) AS last_ts
FROM minute_samples
WHERE ts >= :start AND ts < :end
GROUP BY jst_date
ORDER BY jst_date ASC
"""

_DAILY_FLOAT_KEYS = (
    "solar_kwh",
    "sell_kwh",
    "buy_kwh",
    "load_kwh",
    "pv1_kwh",
    "pv2_kwh",
    "pv3_kwh",
    "pv4_kwh",
)


def jst_day_start(ts: int, tz_offset_sec: int = JST_OFFSET_SEC) -> int:
    """ts を含む日(JST)の 0:00 を UTC epoch 秒で返す。"""
    return (int(ts) + tz_offset_sec) // 86400 * 86400 - tz_offset_sec


def daily_summaries(
    conn: sqlite3.Connection,
    start_ts: int | None = None,
    end_ts: int | None = None,
    tz_offset_sec: int = JST_OFFSET_SEC,
) -> list[dict[str, Any]]:
    """[start_ts, end_ts) の1分値から日(JST)ごとの発電量・売買電量・PV1〜4発電量を集計する。

    値はその日の全1分値から計算した絶対値なので、何度送っても(UPSERTしても)二重計上されない。
    """
    rows = conn.execute(
        _DAILY_SUMMARY_SQL,
        {
            "tz": tz_offset_sec,
            "start": 0 if start_ts is None else int(start_ts),
            "end": (1 << 62) if end_ts is None else int(end_ts),
        },
    ).fetchall()
    result: list[dict[str, Any]] = []
    for r in rows:
        item = dict(r)
        for key in _DAILY_FLOAT_KEYS:
            v = item.get(key)
            item[key] = None if v is None else round(float(v), 4)
        result.append(item)
    return result


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
