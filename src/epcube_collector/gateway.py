"""ゲートウェイのHTTP API(読み取り専用のGETのみ)クライアント。"""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from typing import Any, Callable
from urllib.parse import urlencode

from . import __version__

MAX_BODY_BYTES = 1_000_000
MINUTES_LIMIT_MAX = 180


class GatewayError(Exception):
    """通信失敗・HTTPエラー・不正なJSON。"""


class GatewayAuthError(GatewayError):
    """X-Api-Token の不一致(HTTP 401)。"""


UrlOpen = Callable[..., Any]


class GatewayClient:
    def __init__(
        self,
        base_url: str,
        token: str | None = None,
        timeout: float = 10.0,
        urlopen: UrlOpen | None = None,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout
        self._urlopen = urlopen or urllib.request.urlopen

    def get_minutes(self, since: int | None, limit: int = MINUTES_LIMIT_MAX) -> Any:
        params: dict[str, int] = {"limit": max(1, min(limit, MINUTES_LIMIT_MAX))}
        if since is not None:
            params["since"] = since
        return self._get("/api/minutes", params)

    def get_latest(self, cells: bool = True) -> Any:
        return self._get("/api/latest", {"cells": 1} if cells else {})

    def _get(self, path: str, params: dict[str, int]) -> Any:
        url = self._base + path + ("?" + urlencode(params) if params else "")
        headers = {"Accept": "application/json", "User-Agent": f"epcube-collector/{__version__}"}
        if self._token:
            headers["X-Api-Token"] = self._token
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with self._urlopen(req, timeout=self._timeout) as resp:
                body = resp.read(MAX_BODY_BYTES + 1)
        except urllib.error.HTTPError as err:
            if err.code == 401:
                raise GatewayAuthError(f"{path}: HTTP 401(EPCUBE_GW_TOKEN を確認してください)") from None
            raise GatewayError(f"{path}: HTTP {err.code}") from None
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as err:
            reason = getattr(err, "reason", err)
            raise GatewayError(f"{path}: 接続失敗 ({reason})") from None
        if len(body) > MAX_BODY_BYTES:
            raise GatewayError(f"{path}: 応答が大きすぎます")
        try:
            return json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as err:
            raise GatewayError(f"{path}: JSONとして解釈できません ({err})") from None

