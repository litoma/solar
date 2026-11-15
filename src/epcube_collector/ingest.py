"""取り込み処理(1回実行して終了)。"""

from __future__ import annotations

import logging
import sqlite3
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Protocol

from . import db
from .config import Config
from .gateway import GatewayError
from .parse import (
    ParseError,
    EXPECTED_CELLS,
    EXPECTED_TEMPS,
    LatestResponse,
    Row,
    parse_latest_response,
    parse_minutes_response,
)

log = logging.getLogger(__name__)

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_CONFIG = 2
EXIT_GATEWAY = 3
EXIT_AUTH = 4
EXIT_STALE = 5

CLOCK_SKEW_WARN_SEC = 120
SNAPSHOT_MAX_AGE_SEC = 120
BLE_DOWN_ERROR_SEC = 600
FREE_HEAP_WARN = 30_000
RSSI_WARN_DBM = -85
MAX_ISSUES_LOGGED = 10

META_LAST_LATEST = "last_latest_fetch"
META_PREV_STATS = "prev_gateway_stats"
META_BLE_DOWN_SINCE = "ble_down_since"


class Gateway(Protocol):
    def get_minutes(self, since: int | None, limit: int = ...) -> Any: ...

    def get_latest(self, cells: bool = ...) -> Any: ...


@dataclass
class IngestResult:
    exit_code: int = EXIT_OK
    since: int | None = None
    rows: list[Row] = field(default_factory=list)
    saved: int = 0
    snapshot_ts: int | None = None


def iso(ts: int | float | None) -> str:
    if ts is None:
        return "-"
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def run_once(
    cfg: Config,
    client: Gateway,
    conn: sqlite3.Connection | None,
    dry_run: bool = False,
    clock: Callable[[], float] = time.time,
) -> IngestResult:
    """1回分の取り込み。通信・パースの例外(GatewayError/ParseError)は呼び出し側で処理する。"""
    result = IngestResult()
    since = db.max_minute_ts(conn) if conn is not None else None
    result.since = since

    resp = parse_minutes_response(client.get_minutes(since))
    for msg in resp.issues[:MAX_ISSUES_LOGGED]:
        log.warning("応答の問題: %s", msg)
    if len(resp.issues) > MAX_ISSUES_LOGGED:
        log.warning("応答の問題: ほか %d 件", len(resp.issues) - MAX_ISSUES_LOGGED)

    server_now = clock()
    if resp.time_valid and resp.now is not None:
        skew = resp.now - server_now
        if abs(skew) > CLOCK_SKEW_WARN_SEC:
            log.warning("ゲートウェイとサーバの時計が %+d 秒ずれています", int(skew))

    rows: list[Row] = []
    if not resp.time_valid:
        log.warning("ゲートウェイの時刻が未同期(time_valid=false)のため取り込みません")
    else:
        limit_ts = max(server_now, resp.now or 0) + 60
        for row in resp.rows:
            ts = int(row["ts"])  # type: ignore[arg-type]
            if since is not None and ts <= since:
                continue
            if ts > limit_ts:
                log.warning("未来の ts を破棄: %s", iso(ts))
                continue
            rows.append(row)
    result.rows = rows

    _report_gaps(since, rows)
    low = [r for r in rows if r["n"] is None or int(r["n"]) < cfg.low_n_threshold]  # type: ignore[arg-type]
    for r in low:
        log.warning("品質低下: %s のサンプル数 n=%s(%d未満)", iso(r["ts"]), r["n"], cfg.low_n_threshold)

    if rows and not dry_run and conn is not None:
        result.saved = db.upsert_minutes(conn, rows)
    if rows:
        log.info(
            "%s %d 件(%s 〜 %s)",
            "取得(dry-run、保存なし)" if dry_run else "保存",
            len(rows), iso(rows[0]["ts"]), iso(rows[-1]["ts"]),
        )
    else:
        log.info("新しい確定分はありません(since=%s)", iso(since))

    # 新しい分が長時間来ない = BLE切断・集計停止などの異常
    newest = max([since or 0] + [int(r["ts"]) for r in rows]) or None  # type: ignore[arg-type]
    ref_now = resp.now if (resp.time_valid and resp.now is not None) else server_now
    if newest is None:
        log.warning("まだ1件もデータがありません(ゲートウェイ起動直後なら正常)")
    elif ref_now - newest > cfg.stale_sec:
        log.error(
            "最新の確定分が %d 秒前(%s)で止まっています。ゲートウェイのBLE接続や時刻同期を確認してください",
            int(ref_now - newest), iso(newest),
        )
        result.exit_code = EXIT_STALE

    if not dry_run and conn is not None:
        _maybe_snapshot(cfg, client, conn, server_now, result)
    return result


def _report_gaps(since: int | None, rows: list[Row]) -> None:
    prev = since
    for r in rows:
        ts = int(r["ts"])  # type: ignore[arg-type]
        if prev is not None and ts - prev > 60:
            missing = (ts - prev) // 60 - 1
            log.warning("欠損: %s 〜 %s の %d 分", iso(prev + 60), iso(ts - 60), missing)
        prev = ts


def _maybe_snapshot(
    cfg: Config, client: Gateway, conn: sqlite3.Connection, server_now: float, result: IngestResult
) -> None:
    """snapshot_interval ごとに /api/latest?cells=1 を取得し、全セル・全温度の保存と死活確認を行う。

    失敗時は次の実行(1分後)で再試行する。
    """
    last = db.get_meta(conn, META_LAST_LATEST)
    # timer の揺らぎで1周期飛ばないよう、少し手前から許可する
    if isinstance(last, (int, float)) and server_now - last < cfg.snapshot_interval - 15:
        return

    try:
        latest = parse_latest_response(client.get_latest(cells=True))
    except (GatewayError, ParseError) as err:
        log.error("/api/latest の取得に失敗: %s", err)
        if result.exit_code == EXIT_OK:
            result.exit_code = EXIT_GATEWAY
        return

    check_health(conn, latest, server_now)
    db.set_meta(conn, META_LAST_LATEST, int(server_now))

    if not latest.time_valid or latest.now is None:
        log.warning("時刻未同期のため bms_snapshots を保存しません")
        return
    if latest.cells_mv is None or latest.slow_age_s is None:
        log.warning("BMSの最新値(セル電圧)が無いため bms_snapshots を保存しません")
        return
    if latest.slow_age_s > SNAPSHOT_MAX_AGE_SEC:
        log.warning("BMSの最新値が %d 秒前と古いため bms_snapshots を保存しません", latest.slow_age_s)
        return
    if len(latest.cells_mv) != EXPECTED_CELLS:
        log.warning("セル数が %d(想定 %d)", len(latest.cells_mv), EXPECTED_CELLS)
    if latest.temps_c is not None and len(latest.temps_c) != EXPECTED_TEMPS:
        log.warning("温度センサー数が %d(想定 %d)", len(latest.temps_c), EXPECTED_TEMPS)

    ts = (latest.now - latest.slow_age_s) // 60 * 60
    db.upsert_snapshot(conn, ts, latest.cells_mv, latest.temps_c)
    result.snapshot_ts = ts
    log.info("bms_snapshots を保存(%s、セル %d 個)", iso(ts), len(latest.cells_mv))


def check_health(conn: sqlite3.Connection, latest: LatestResponse, server_now: float) -> None:
    """ble_connected の継続的な false や、失敗数・再接続数の増加を警告する。"""
    # BLE接続状態
    down_since = db.get_meta(conn, META_BLE_DOWN_SINCE)
    if latest.ble_connected is False:
        if not isinstance(down_since, (int, float)):
            down_since = int(server_now)
            db.set_meta(conn, META_BLE_DOWN_SINCE, down_since)
        duration = server_now - down_since
        level = logging.ERROR if duration >= BLE_DOWN_ERROR_SEC else logging.WARNING
        log.log(level, "ゲートウェイがEP CUBEとBLE未接続です(%d 分継続) last_error=%r",
                int(duration // 60), latest.last_error)
    elif latest.ble_connected is True and down_since is not None:
        log.info("BLE接続が回復しました")
        db.set_meta(conn, META_BLE_DOWN_SINCE, None)

    # 動作統計の増分(前回取得時との差)
    prev = db.get_meta(conn, META_PREV_STATS)
    current = {"uptime_s": latest.uptime_s, "stats": latest.stats}
    if isinstance(prev, dict) and isinstance(prev.get("stats"), dict):
        prev_uptime = prev.get("uptime_s")
        if (
            latest.uptime_s is not None
            and isinstance(prev_uptime, int)
            and latest.uptime_s < prev_uptime
        ):
            log.warning("ゲートウェイの再起動を検知しました(uptime %d 秒)", latest.uptime_s)
        else:
            prev_stats: dict[str, int] = prev["stats"]
            delta = {
                k: v - prev_stats.get(k, 0)
                for k, v in latest.stats.items()
                if v - prev_stats.get(k, 0) > 0
            }
            for key in ("fast_fail", "slow_fail", "timeouts", "connects", "connect_fail"):
                if delta.get(key):
                    log.warning("ゲートウェイ統計 %s が +%d 増加(last_error=%r)",
                                key, delta[key], latest.last_error)
    db.set_meta(conn, META_PREV_STATS, current)

    if latest.free_heap is not None and latest.free_heap < FREE_HEAP_WARN:
        log.warning("ゲートウェイの空きヒープが少なくなっています: %d bytes", latest.free_heap)
    if latest.wifi_rssi is not None and latest.wifi_rssi < RSSI_WARN_DBM:
        log.warning("ゲートウェイのWi-Fi電波が弱いです: %d dBm", latest.wifi_rssi)
