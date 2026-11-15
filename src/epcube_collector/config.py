"""環境変数から設定を読み込む。"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
from urllib.parse import urlparse

DEFAULT_GW_URL = "http://192.168.0.36"
DEFAULT_DB_PATH = Path.home() / "solar" / "var" / "epcube.db"
# 既定の設置場所座標 (東京都練馬区)
DEFAULT_LATITUDE = 35.7356
DEFAULT_LONGITUDE = 139.6517


class ConfigError(ValueError):
    """設定値が不正。"""


@dataclass(frozen=True)
class Config:
    gw_url: str
    gw_token: str | None
    db_path: Path
    http_timeout: float
    snapshot_interval: int
    stale_sec: int
    low_n_threshold: int
    sync_url: str | None = None
    sync_token: str | None = None
    latitude: float = DEFAULT_LATITUDE
    longitude: float = DEFAULT_LONGITUDE

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Config":
        env = os.environ if env is None else env

        gw_url = (env.get("EPCUBE_GW_URL") or DEFAULT_GW_URL).strip().rstrip("/")
        parsed = urlparse(gw_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ConfigError("EPCUBE_GW_URL は http://<ホスト> の形式で指定してください")

        token = (env.get("EPCUBE_GW_TOKEN") or "").strip() or None
        db_path = Path(env.get("EPCUBE_DB_PATH") or DEFAULT_DB_PATH).expanduser()

        sync_url = (env.get("EPCUBE_SYNC_URL") or "").strip().rstrip("/") or None
        if sync_url is not None:
            sync_parsed = urlparse(sync_url)
            if sync_parsed.scheme not in ("http", "https") or not sync_parsed.netloc:
                raise ConfigError("EPCUBE_SYNC_URL は https://<ホスト> の形式で指定してください")
        sync_token = (env.get("EPCUBE_SYNC_TOKEN") or "").strip() or None

        return cls(
            gw_url=gw_url,
            gw_token=token,
            db_path=db_path,
            http_timeout=_num(env, "EPCUBE_HTTP_TIMEOUT", 10.0, 1.0, 30.0),
            snapshot_interval=int(_num(env, "EPCUBE_SNAPSHOT_INTERVAL", 600, 60, 86400)),
            stale_sec=int(_num(env, "EPCUBE_STALE_SEC", 300, 120, 86400)),
            low_n_threshold=int(_num(env, "EPCUBE_LOW_N", 3, 1, 60)),
            sync_url=sync_url,
            sync_token=sync_token,
            latitude=_num(env, "EPCUBE_LATITUDE", DEFAULT_LATITUDE, -90.0, 90.0),
            longitude=_num(env, "EPCUBE_LONGITUDE", DEFAULT_LONGITUDE, -180.0, 180.0),
        )


def _num(env: Mapping[str, str], key: str, default: float, lo: float, hi: float) -> float:
    raw = env.get(key)
    if raw is None or raw.strip() == "":
        return float(default)
    try:
        value = float(raw)
    except ValueError as err:
        raise ConfigError(f"{key} は数値で指定してください") from err
    if not lo <= value <= hi:
        raise ConfigError(f"{key} は {lo:g}〜{hi:g} の範囲で指定してください")
    return value
