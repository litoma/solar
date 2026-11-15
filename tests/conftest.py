from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from epcube_collector import db
from epcube_collector.config import Config

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def make_minute(ts: int, n: int = 6, p: float = 100.0, bms: bool = True) -> dict[str, Any]:
    return {
        "ts": ts,
        "n": n,
        "pv": [{"p_avg": p + k, "p_min": int(p) + k - 1, "p_max": int(p) + k + 1, "v": 150.0, "i": 0.7}
               for k in range(4)],
        "sys": {"solar_w": 400, "grid_w": -50, "load_w": 300, "batt_w": -20, "pcs_w": 380,
                "soc": 55, "mode": 1, "solar_day_kwh": 3.21, "buy_day_kwh": 0.5, "load_day_kwh": 6.0},
        "bms": ({"pack_v": 156.8, "cell_max_mv": 3270, "cell_min_mv": 3268, "cell_avg_mv": 3269,
                 "temp_max_c": 16, "temp_min_c": 15, "temp_avg_c": 15.3} if bms else None),
    }


@pytest.fixture
def cfg(tmp_path: Path) -> Config:
    return Config.from_env({"EPCUBE_DB_PATH": str(tmp_path / "t.db")})


@pytest.fixture
def conn(cfg: Config) -> sqlite3.Connection:
    c = db.connect(cfg.db_path)
    yield c
    c.close()

