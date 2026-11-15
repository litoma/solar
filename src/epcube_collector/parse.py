"""ゲートウェイ応答のパースと検証。

列定義(MINUTE_COLUMNS)はここに一元化し、DB層はこれを使ってスキーマとUPSERT文を作る。
項目を増やすときは、ここに列を追加し、db.py にマイグレーション(ALTER TABLE ADD COLUMN)を足す。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Union

Number = Union[int, float]
Row = dict[str, Union[Number, None]]

PV_COUNT = 4
EXPECTED_CELLS = 48
EXPECTED_TEMPS = 16

# PV要素のJSONキー -> (列名の接尾辞, SQLite型)
_PV_FIELDS: list[tuple[str, str, str]] = [
    ("p_avg", "p_avg_w", "REAL"),
    ("p_min", "p_min_w", "INTEGER"),
    ("p_max", "p_max_w", "INTEGER"),
    ("v", "v", "REAL"),
    ("i", "i", "REAL"),
]

# sys のJSONキー = 列名
SYS_FIELDS: list[tuple[str, str]] = [
    ("solar_w", "REAL"),
    ("grid_w", "REAL"),
    ("load_w", "REAL"),
    ("batt_w", "REAL"),
    ("pcs_w", "REAL"),
    ("soc", "INTEGER"),
    ("mode", "INTEGER"),
    ("solar_day_kwh", "REAL"),
    ("buy_day_kwh", "REAL"),
    ("load_day_kwh", "REAL"),
]

# bms のJSONキー = 列名
BMS_FIELDS: list[tuple[str, str]] = [
    ("pack_v", "REAL"),
    ("cell_max_mv", "INTEGER"),
    ("cell_min_mv", "INTEGER"),
    ("cell_avg_mv", "INTEGER"),
    ("temp_max_c", "INTEGER"),
    ("temp_min_c", "INTEGER"),
    ("temp_avg_c", "REAL"),
]

# 気象情報 (Open-Meteo から1分ごとに取得して記録)
WEATHER_FIELDS: list[tuple[str, str]] = [
    ("weather_code", "INTEGER"),
    ("outdoor_temp_c", "REAL"),
]

PV_COLUMNS: list[tuple[str, str]] = [
    (f"pv{i}_{suffix}", sqltype)
    for i in range(1, PV_COUNT + 1)
    for _, suffix, sqltype in _PV_FIELDS
]

MINUTE_COLUMNS: list[tuple[str, str]] = (
    [("ts", "INTEGER"), ("n", "INTEGER")]
    + PV_COLUMNS
    + SYS_FIELDS
    + BMS_FIELDS
    + WEATHER_FIELDS
)
_COLUMN_TYPES: dict[str, str] = dict(MINUTE_COLUMNS)


class ParseError(ValueError):
    """応答全体が想定外の形式。"""


# ---------------------------------------------------------------- 値の変換


def to_real(value: Any) -> float | None:
    """数値(または数値文字列)を float に。null・非数値・NaN・無限大は None。"""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        f = float(value)
    elif isinstance(value, str):
        try:
            f = float(value.strip())
        except ValueError:
            return None
    else:
        return None
    return f if math.isfinite(f) else None


def to_int(value: Any) -> int | None:
    f = to_real(value)
    return None if f is None else int(round(f))


def _convert(column: str, value: Any) -> Number | None:
    return to_int(value) if _COLUMN_TYPES[column] == "INTEGER" else to_real(value)


def _strict_int(value: Any) -> int | None:
    """ts 用: 整数値(int か整数値のfloat)だけを受け付ける。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


# ---------------------------------------------------------------- /api/minutes


@dataclass
class MinutesResponse:
    device: str | None
    now: int | None
    time_valid: bool
    rows: list[Row]
    rejected: int = 0
    issues: list[str] = field(default_factory=list)


def parse_minute(obj: Any, issues: list[str]) -> Row | None:
    """minutes の1要素を1行に変換する。ts が不正なら None(その要素は捨てる)。"""
    if not isinstance(obj, dict):
        issues.append("minutes の要素がオブジェクトではありません")
        return None
    ts = _strict_int(obj.get("ts"))
    if ts is None or ts <= 0 or ts % 60 != 0:
        issues.append(f"不正な ts を破棄: {obj.get('ts')!r}")
        return None

    row: Row = {name: None for name, _ in MINUTE_COLUMNS}
    row["ts"] = ts
    n = to_int(obj.get("n"))
    row["n"] = n if n is not None and n >= 0 else None

    pv = obj.get("pv")
    if isinstance(pv, list):
        if len(pv) != PV_COUNT:
            issues.append(f"ts={ts}: pv の要素数が {len(pv)}(想定 {PV_COUNT})")
        for idx, item in enumerate(pv[:PV_COUNT], start=1):
            if not isinstance(item, dict):
                continue
            for key, suffix, _ in _PV_FIELDS:
                col = f"pv{idx}_{suffix}"
                row[col] = _convert(col, item.get(key))
    elif pv is not None:
        issues.append(f"ts={ts}: pv が配列ではありません")

    for section, fields in (("sys", SYS_FIELDS), ("bms", BMS_FIELDS)):
        data = obj.get(section)
        if isinstance(data, dict):
            for col, _ in fields:
                row[col] = _convert(col, data.get(col))
        elif data is not None:
            issues.append(f"ts={ts}: {section} がオブジェクトではありません")
    return row


def parse_minutes_response(obj: Any) -> MinutesResponse:
    if not isinstance(obj, dict) or not isinstance(obj.get("minutes"), list):
        raise ParseError("/api/minutes の応答に minutes 配列がありません")
    issues: list[str] = []
    rows: dict[int, Row] = {}
    rejected = 0
    for item in obj["minutes"]:
        row = parse_minute(item, issues)
        if row is None:
            rejected += 1
            continue
        rows[int(row["ts"])] = row  # 同じtsが重複したら後勝ち
    device = obj.get("device")
    return MinutesResponse(
        device=device if isinstance(device, str) else None,
        now=_strict_int(obj.get("now")),
        time_valid=obj.get("time_valid") is True,
        rows=[rows[ts] for ts in sorted(rows)],
        rejected=rejected,
        issues=issues,
    )


# ---------------------------------------------------------------- /api/latest


@dataclass
class LatestResponse:
    now: int | None
    time_valid: bool
    ble_connected: bool | None
    uptime_s: int | None
    free_heap: int | None
    wifi_rssi: int | None
    last_error: str
    stats: dict[str, int]
    slow_age_s: int | None
    cells_mv: list[int] | None
    temps_c: list[int] | None


def _int_list(value: Any) -> list[int] | None:
    if not isinstance(value, list) or not value:
        return None
    out: list[int] = []
    for v in value:
        i = to_int(v)
        if i is None:
            return None
        out.append(i)
    return out


def parse_latest_response(obj: Any) -> LatestResponse:
    if not isinstance(obj, dict):
        raise ParseError("/api/latest の応答がオブジェクトではありません")
    stats_raw = obj.get("stats") if isinstance(obj.get("stats"), dict) else {}
    stats = {k: v for k, v in ((k, to_int(v)) for k, v in stats_raw.items()) if v is not None}
    slow = obj.get("slow") if isinstance(obj.get("slow"), dict) else {}
    ble = obj.get("ble_connected")
    last_error = obj.get("last_error")
    return LatestResponse(
        now=_strict_int(obj.get("now")),
        time_valid=obj.get("time_valid") is True,
        ble_connected=ble if isinstance(ble, bool) else None,
        uptime_s=to_int(obj.get("uptime_s")),
        free_heap=to_int(obj.get("free_heap")),
        wifi_rssi=to_int(obj.get("wifi_rssi")),
        last_error=last_error if isinstance(last_error, str) else "",
        stats=stats,
        slow_age_s=to_int(slow.get("age_s")),
        cells_mv=_int_list(slow.get("cells_mv")),
        temps_c=_int_list(slow.get("temps_c")),
    )
