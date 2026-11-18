"""Cloudflare Worker (D1) への差分同期。

ts を単調増加の主キーとして、ingest_meta に保存した最後の送信済み ts より新しい行だけを
POST /api/ingest へバッチ送信する。

あわせて、送信した1分値を含む日(JST)の日別サマリー(daily)をローカルSQLiteで集計して送る。
ダッシュボードは D1 の daily_summary だけを読むため、D1 上で1分値を集計する必要がなくなる。
初回のみ、ローカルにある全期間の日別サマリーを一括送信する(バックフィル)。
"""

from __future__ import annotations

import json
import logging
import socket
import sqlite3
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

from . import __version__, db
from .config import Config

log = logging.getLogger(__name__)

META_SYNCED_MINUTE_TS = "last_synced_minute_ts"
META_SYNCED_SNAPSHOT_TS = "last_synced_snapshot_ts"
# 全期間の日別サマリーをD1へ一括送信済みかどうか(Workerが daily を受け付けたときだけ立てる)
META_DAILY_BACKFILLED = "daily_summary_backfilled"

MINUTE_BATCH_SIZE = 100
SNAPSHOT_BATCH_SIZE = 50
DAILY_BATCH_SIZE = 90
MAX_BATCHES_PER_RUN = 10


class SyncError(Exception):
    """Cloudflare への同期失敗。"""


@dataclass
class SyncResult:
    minutes_sent: int = 0
    snapshots_sent: int = 0
    last_minute_ts: int | None = None
    last_snapshot_ts: int | None = None
    daily_sent: int = 0


UrlOpen = Callable[..., Any]


def sync_to_cloud(
    cfg: Config,
    conn: sqlite3.Connection,
    dry_run: bool = False,
    urlopen: UrlOpen | None = None,
) -> SyncResult:
    if not cfg.sync_url:
        raise SyncError("EPCUBE_SYNC_URL が設定されていません")
    opener = urlopen or urllib.request.urlopen

    last_min = int(db.get_meta(conn, META_SYNCED_MINUTE_TS) or 0)
    last_snap = int(db.get_meta(conn, META_SYNCED_SNAPSHOT_TS) or 0)

    backfilled = bool(db.get_meta(conn, META_DAILY_BACKFILLED))

    if dry_run:
        minutes = db.minutes_since(conn, last_min, limit=100000)
        snapshots = db.snapshots_since(conn, last_snap, limit=100000)
        daily = db.daily_summaries(conn) if not backfilled else _daily_for_minutes(conn, minutes)
        log.info(
            "Cloudflare 同期(dry-run): minutes=%d 件, snapshots=%d 件, daily=%d 件%s",
            len(minutes),
            len(snapshots),
            len(daily),
            "" if backfilled else " (全期間バックフィル)",
        )
        return SyncResult(
            minutes_sent=len(minutes),
            snapshots_sent=len(snapshots),
            last_minute_ts=int(minutes[-1]["ts"]) if minutes else (last_min or None),
            last_snapshot_ts=int(snapshots[-1]["ts"]) if snapshots else (last_snap or None),
            daily_sent=len(daily),
        )

    total_min = 0
    total_snap = 0
    total_daily = 0

    if not backfilled:
        total_daily += _backfill_daily(cfg, opener, conn)

    for _ in range(MAX_BATCHES_PER_RUN):
        minutes = db.minutes_since(conn, last_min, limit=MINUTE_BATCH_SIZE)
        snapshots = db.snapshots_since(conn, last_snap, limit=SNAPSHOT_BATCH_SIZE)
        if not minutes and not snapshots:
            break

        daily = _daily_for_minutes(conn, minutes)
        _post_ingest(cfg, opener, minutes, snapshots, daily)
        total_daily += len(daily)

        if minutes:
            last_min = int(minutes[-1]["ts"])
            db.set_meta(conn, META_SYNCED_MINUTE_TS, last_min)
            total_min += len(minutes)
        if snapshots:
            last_snap = int(snapshots[-1]["ts"])
            db.set_meta(conn, META_SYNCED_SNAPSHOT_TS, last_snap)
            total_snap += len(snapshots)

        if len(minutes) < MINUTE_BATCH_SIZE and len(snapshots) < SNAPSHOT_BATCH_SIZE:
            break

    if total_min or total_snap:
        log.info(
            "Cloudflare D1 へ同期完了: minutes=%d 件, snapshots=%d 件, daily=%d 件",
            total_min,
            total_snap,
            total_daily,
        )
    else:
        log.debug("Cloudflare へ送信すべき未同期データはありません")

    return SyncResult(
        minutes_sent=total_min,
        snapshots_sent=total_snap,
        last_minute_ts=last_min or None,
        last_snapshot_ts=last_snap or None,
        daily_sent=total_daily,
    )


def _daily_for_minutes(
    conn: sqlite3.Connection, minutes: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """送信する1分値が属する日(JST)の日別サマリーを、ローカルの全1分値から集計する。"""
    if not minutes:
        return []
    start = db.jst_day_start(int(minutes[0]["ts"]))
    end = db.jst_day_start(int(minutes[-1]["ts"])) + 86400
    return db.daily_summaries(conn, start, end)


def _backfill_daily(cfg: Config, opener: UrlOpen, conn: sqlite3.Connection) -> int:
    """ローカルにある全期間の日別サマリーを一括送信する。

    Worker が daily を受け付けた(応答に daily_upserted がある)ときだけ完了扱いにするので、
    Worker 更新前に実行されても取りこぼさない。
    """
    daily = db.daily_summaries(conn)
    if not daily:
        return 0
    sent = 0
    for i in range(0, len(daily), DAILY_BATCH_SIZE):
        chunk = daily[i : i + DAILY_BATCH_SIZE]
        resp = _post_ingest(cfg, opener, [], [], chunk)
        if not isinstance(resp, dict) or "daily_upserted" not in resp:
            log.warning("Worker が日別サマリー(daily)に未対応のため、バックフィルを保留します")
            return sent
        sent += len(chunk)
    db.set_meta(conn, META_DAILY_BACKFILLED, True)
    log.info("日別サマリーを全期間バックフィルしました: %d 日分", sent)
    return sent


def _post_ingest(
    cfg: Config,
    opener: UrlOpen,
    minutes: list[dict[str, Any]],
    snapshots: list[dict[str, Any]],
    daily: list[dict[str, Any]] | None = None,
) -> Any:
    assert cfg.sync_url is not None
    url = f"{cfg.sync_url.rstrip('/')}/api/ingest"
    body_obj: dict[str, Any] = {"minutes": minutes, "snapshots": snapshots}
    if daily:
        body_obj["daily"] = daily
    payload = json.dumps(body_obj, separators=(",", ":")).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": f"epcube-collector/{__version__}",
    }
    if cfg.sync_token:
        headers["Authorization"] = f"Bearer {cfg.sync_token}"

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with opener(req, timeout=cfg.http_timeout) as resp:
            body = resp.read(65536).decode("utf-8", errors="replace")
            if resp.status >= 400:
                raise SyncError(f"HTTP {resp.status}: {body}")
            try:
                return json.loads(body) if body else None
            except ValueError:
                return None
    except urllib.error.HTTPError as err:
        detail = err.read(1024).decode("utf-8", errors="replace") if err.fp else ""
        raise SyncError(f"HTTP {err.code}: {detail}") from None
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as err:
        reason = getattr(err, "reason", err)
        raise SyncError(f"接続失敗 ({reason})") from None
