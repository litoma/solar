"""Cloudflare Worker (D1) への差分同期。

ts を単調増加の主キーとして、ingest_meta に保存した最後の送信済み ts より新しい行だけを
POST /api/ingest へバッチ送信する。
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

MINUTE_BATCH_SIZE = 200
SNAPSHOT_BATCH_SIZE = 50


class SyncError(Exception):
    """Cloudflare への同期失敗。"""


@dataclass
class SyncResult:
    minutes_sent: int = 0
    snapshots_sent: int = 0
    last_minute_ts: int | None = None
    last_snapshot_ts: int | None = None


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

    minutes = db.minutes_since(conn, last_min, limit=MINUTE_BATCH_SIZE)
    snapshots = db.snapshots_since(conn, last_snap, limit=SNAPSHOT_BATCH_SIZE)

    res = SyncResult(
        minutes_sent=len(minutes),
        snapshots_sent=len(snapshots),
        last_minute_ts=int(minutes[-1]["ts"]) if minutes else (last_min or None),
        last_snapshot_ts=int(snapshots[-1]["ts"]) if snapshots else (last_snap or None),
    )

    if not minutes and not snapshots:
        log.debug("Cloudflare へ送信すべき未同期データはありません")
        return res

    if dry_run:
        log.info(
            "Cloudflare 同期(dry-run): minutes=%d 件, snapshots=%d 件",
            len(minutes),
            len(snapshots),
        )
        return res

    url = f"{cfg.sync_url.rstrip('/')}/api/ingest"
    payload = json.dumps(
        {"minutes": minutes, "snapshots": snapshots},
        separators=(",", ":"),
    ).encode("utf-8")

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
    except urllib.error.HTTPError as err:
        detail = err.read(1024).decode("utf-8", errors="replace") if err.fp else ""
        raise SyncError(f"HTTP {err.code}: {detail}") from None
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as err:
        reason = getattr(err, "reason", err)
        raise SyncError(f"接続失敗 ({reason})") from None

    if minutes:
        db.set_meta(conn, META_SYNCED_MINUTE_TS, int(minutes[-1]["ts"]))
    if snapshots:
        db.set_meta(conn, META_SYNCED_SNAPSHOT_TS, int(snapshots[-1]["ts"]))

    log.info(
        "Cloudflare D1 へ同期完了: minutes=%d 件, snapshots=%d 件",
        len(minutes),
        len(snapshots),
    )
    return res
