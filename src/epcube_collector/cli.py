"""epcube-collector コマンド。

  once [--dry-run]         /api/minutes を1回取り込む(定期実行用。EPCUBE_SYNC_URL 設定時はD1へ差分同期)
  sync [--dry-run]         ローカルSQLiteからCloudflare D1(/api/ingest)へ未送信分を同期する
  show [--last N]          直近N分をテーブル表示(--snapshots でセル電圧スナップショット)
  latest                   /api/latest?cells=1 をそのまま表示(死活確認・デバッグ用)
  status                   DBの件数・最新時刻・取り込み状態を表示
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
from datetime import datetime
from typing import Any, Sequence

from . import __version__, db
from .config import Config, ConfigError
from .gateway import GatewayAuthError, GatewayClient, GatewayError
from .ingest import (
    EXIT_AUTH,
    EXIT_CONFIG,
    EXIT_ERROR,
    EXIT_GATEWAY,
    EXIT_OK,
    iso,
    run_once,
)
from .parse import PV_COUNT, ParseError, Row
from .sync import SyncError, sync_to_cloud

log = logging.getLogger("epcube_collector")


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
        stream=sys.stderr,
    )
    try:
        cfg = Config.from_env()
    except ConfigError as err:
        log.error("設定エラー: %s", err)
        return EXIT_CONFIG

    try:
        return int(args.func(cfg, args))
    except GatewayAuthError as err:
        log.error("ゲートウェイ認証エラー: %s", err)
        return EXIT_AUTH
    except (GatewayError, ParseError) as err:
        log.error("ゲートウェイから取得できません: %s", err)
        return EXIT_GATEWAY
    except SyncError as err:
        log.error("Cloudflare 同期エラー: %s", err)
        return EXIT_GATEWAY
    except (sqlite3.Error, db.SchemaError, OSError) as err:
        log.error("DBエラー: %s", err)
        return EXIT_ERROR


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="epcube-collector", description="EP CUBE ゲートウェイの1分集計をSQLiteに取り込む")
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    p.add_argument("-v", "--verbose", action="store_true", help="デバッグログを出す")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("once", help="1回取り込んで終了する")
    s.add_argument("--dry-run", action="store_true", help="保存せず取得値を表示する")
    s.set_defaults(func=cmd_once)

    s = sub.add_parser("sync", help="ローカルSQLiteからCloudflare D1へ差分同期する")
    s.add_argument("--dry-run", action="store_true", help="送信せず未同期件数を表示する")
    s.set_defaults(func=cmd_sync)

    s = sub.add_parser("show", help="直近のデータを表示する")
    s.add_argument("--last", type=int, default=10, metavar="N", help="件数(既定10)")
    s.add_argument("--snapshots", action="store_true", help="bms_snapshots を表示する")
    s.set_defaults(func=cmd_show)

    s = sub.add_parser("latest", help="/api/latest?cells=1 を表示する")
    s.set_defaults(func=cmd_latest)

    s = sub.add_parser("status", help="DBと取り込み状態を表示する")
    s.set_defaults(func=cmd_status)
    return p


def _client(cfg: Config) -> GatewayClient:
    return GatewayClient(cfg.gw_url, cfg.gw_token, cfg.http_timeout)


# ---------------------------------------------------------------- subcommands


def cmd_once(cfg: Config, args: argparse.Namespace) -> int:
    if args.dry_run:
        conn = db.connect(cfg.db_path, create=False) if cfg.db_path.exists() else None
    else:
        conn = db.connect(cfg.db_path)
    try:
        result = run_once(cfg, _client(cfg), conn, dry_run=args.dry_run)
        if not args.dry_run and conn is not None and cfg.sync_url:
            try:
                sync_to_cloud(cfg, conn)
            except SyncError as err:
                log.warning("Cloudflare への同期に失敗(次回再試行): %s", err)
    finally:
        if conn is not None:
            conn.close()
    if args.dry_run:
        print(f"since={iso(result.since)}  取得 {len(result.rows)} 件(保存していません)")
        _print_minutes(result.rows)
    return result.exit_code


def cmd_sync(cfg: Config, args: argparse.Namespace) -> int:
    conn = db.connect(cfg.db_path, create=False)
    try:
        res = sync_to_cloud(cfg, conn, dry_run=args.dry_run)
        print(
            f"minutes={res.minutes_sent} 件, snapshots={res.snapshots_sent} 件 "
            f"(latest_ts={_local(res.last_minute_ts)})"
        )
    finally:
        conn.close()
    return EXIT_OK


def cmd_show(cfg: Config, args: argparse.Namespace) -> int:
    n = max(1, min(args.last, 100000))
    conn = db.connect(cfg.db_path, create=False)
    try:
        if args.snapshots:
            for r in db.recent_snapshots(conn, n):
                cells = json.loads(r["cells_json"] or "[]")
                temps = json.loads(r["temps_json"] or "[]")
                cell_txt = f"{min(cells)}〜{max(cells)} mV ({len(cells)}個)" if cells else "-"
                temp_txt = f"{min(temps)}〜{max(temps)} ℃ ({len(temps)}個)" if temps else "-"
                print(f"{_local(r['ts'])}  セル {cell_txt}  温度 {temp_txt}")
        else:
            _print_minutes([dict(r) for r in db.recent_minutes(conn, n)])
    finally:
        conn.close()
    return EXIT_OK


def cmd_latest(cfg: Config, args: argparse.Namespace) -> int:
    data = _client(cfg).get_latest(cells=True)
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return EXIT_OK


def cmd_status(cfg: Config, args: argparse.Namespace) -> int:
    print(f"ゲートウェイ: {cfg.gw_url}  (トークン: {'設定あり' if cfg.gw_token else 'なし'})")
    print(f"Cloudflare同期: {cfg.sync_url or '未設定'}")
    print(f"DB: {cfg.db_path}")
    if not cfg.db_path.exists():
        print("  DBはまだ作成されていません")
        return EXIT_OK
    conn = db.connect(cfg.db_path, create=False)
    try:
        latest_ts = db.max_minute_ts(conn)
        print(f"  スキーマ版: {db.schema_version(conn)}")
        print(f"  minute_samples: {db.count_rows(conn, 'minute_samples')} 件  最新 {_local(latest_ts)}")
        print(f"  bms_snapshots : {db.count_rows(conn, 'bms_snapshots')} 件")
        for k, v in db.all_meta(conn).items():
            shown = (
                _local(v)
                if k in ("last_latest_fetch", "last_synced_minute_ts", "last_synced_snapshot_ts")
                else json.dumps(v, ensure_ascii=False)
            )
            print(f"  {k}: {shown}")
    finally:
        conn.close()
    return EXIT_OK


# ---------------------------------------------------------------- 表示


def _local(ts: Any) -> str:
    if not isinstance(ts, (int, float)):
        return "-"
    return datetime.fromtimestamp(ts).astimezone().strftime("%Y-%m-%d %H:%M")


def _f(v: Any, width: int, digits: int = 0) -> str:
    if v is None:
        return "-".rjust(width)
    return f"{v:{width}.{digits}f}"


def _print_minutes(rows: Sequence[Row] | Sequence[dict[str, Any]]) -> None:
    if not rows:
        print("(データなし)")
        return
    head = (
        f"{'時刻(ローカル)':<16}{'n':>3}"
        + "".join(f"{f'PV{i}[W]':>9}{f'V{i}':>7}{f'A{i}':>6}" for i in range(1, PV_COUNT + 1))
        + f"{'PV計':>7}{'太陽光':>7}{'系統':>7}{'負荷':>7}{'蓄電池':>7}{'SOC':>5}{'セルmin-max[mV]':>17}{'温度[℃]':>9}"
    )
    print(head)
    for r in rows:
        pv_vals = [r.get(f"pv{i}_p_avg_w") for i in range(1, PV_COUNT + 1)]
        pv_sum = sum(v for v in pv_vals if v is not None) if any(v is not None for v in pv_vals) else None
        cell = (
            f"{r.get('cell_min_mv')}-{r.get('cell_max_mv')}"
            if r.get("cell_min_mv") is not None else "-"
        )
        line = f"{_local(r.get('ts')):<16}{_f(r.get('n'), 3)}"
        for i in range(1, PV_COUNT + 1):
            line += (
                _f(r.get(f"pv{i}_p_avg_w"), 9, 1)
                + _f(r.get(f"pv{i}_v"), 7, 1)
                + _f(r.get(f"pv{i}_i"), 6, 1)
            )
        line += (
            _f(pv_sum, 7)
            + _f(r.get("solar_w"), 7)
            + _f(r.get("grid_w"), 7)
            + _f(r.get("load_w"), 7)
            + _f(r.get("batt_w"), 7)
            + _f(r.get("soc"), 5)
            + f"{cell:>17}"
            + _f(r.get("temp_avg_c"), 9, 1)
        )
        print(line)
