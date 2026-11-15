# epcube-collector & ENERGY FLOW Web Dashboard

EP CUBE の PV1〜4・システム値・BMS(セル電圧/温度)を、BLEゲートウェイ(ATOMS3 Lite, `epcube_gateway.ino` v1.0.0)の
HTTP API から取得してローカル SQLite に保存し、Cloudflare Workers + D1 (`cf` CLI) で公開ダッシュボード (`https://solar.yusukesakai.com`) を配信するリポジトリです。

## ディレクトリ構成

```
~/solar/
├── README.md
├── pyproject.toml                 # epcube-collector (Python取り込み・同期CLI)
├── package.json                   # Cloudflare (cf CLI + @cloudflare/vite-plugin)
├── cloudflare.config.ts           # cf CLI 設定ファイル (Worker + D1 + Assets + 環境変数)
├── vite.config.ts                 # Vite + Cloudflare プラグイン設定
├── index.html                     # ENERGY FLOW ダッシュボード HTML
├── web/
│   ├── worker.ts                  # Cloudflare Worker (/api/dashboard, /api/ingest)
│   ├── main.ts                    # フロントエンド描画ロジック (実データ・1分自動更新)
│   └── style.css                  # ENERGY FLOW ダッシュボード CSS
├── migrations/
│   └── 0001_init.sql              # Cloudflare D1 スキーマ
├── config/
│   ├── epcube.env.example         # 環境変数ファイルの雛形
│   └── epcube.env                 # 実ファイル(権限600、Git管理外)
├── src/epcube_collector/
│   ├── cli.py                     # サブコマンド (once / sync / show / latest / status)
│   ├── config.py                  # 環境変数の読み込み
│   ├── gateway.py                 # HTTP層(urllib、タイムアウト10秒、X-Api-Token)
│   ├── parse.py                   # 応答のパース・検証、列定義(MINUTE_COLUMNS)
│   ├── db.py                      # SQLite層(WAL、busy_timeout、user_version、UPSERT)
│   ├── ingest.py                  # 取り込み手順・品質チェック・死活監視
│   └── sync.py                    # Cloudflare D1 (/api/ingest) への差分同期
├── systemd/
│   ├── epcube-collector.service
│   └── epcube-collector.timer
├── tests/                         # pytest
└── var/epcube.db                  # ローカルSQLite(Git管理外)
```

## 1. 公開サイト (Cloudflare Workers) の環境変数

[cloudflare.config.ts](file:///home/litoma/solar/cloudflare.config.ts) または Cloudflare ダッシュボードの **Settings → Variables and Secrets** で以下の環境変数を設定できます。

| 環境変数名 | コード初期値 | 今回のサイト設定値 | 説明 |
|---|---|---|---|
| `SOLAR_LOCATION` | `東京都中央区` | **`東京都練馬区`** | 太陽光パネルの設置場所（日の出・日の入り計算および Open-Meteo 天気取得に使用） |
| `SOLAR_BUY_PRICE_YEN` | `35` | **`35`** | 電力会社から電力を購入するときの買電単価（円/kWh） |
| `SOLAR_SELL_PRICE_YEN` | `24` | **`24`** | 電力会社へ電力を売却するときの売電単価（円/kWh） |
| `SOLAR_REFRESH_MINUTES` | `1` | **`1`** | 公開サイトの情報更新頻度（分。秒指定の `SOLAR_REFRESH_SEC` も可） |
| `SOLAR_BATTERY_CAPACITY_KWH` | `13.8` | **`13.8`** | 蓄電池の定格容量（kWh） |
| `SOLAR_LATITUDE` / `SOLAR_LONGITUDE` | 自動解決 | 自動解決 (`35.7356`, `139.6517`) | 緯度・経度を直接数値で上書きしたい場合のみ指定 |

## 2. ローカル収集・D1同期 (`epcube-collector`)

### 動作確認

```bash
cd ~/solar && set -a; . config/epcube.env; set +a
.venv/bin/epcube-collector latest            # ゲートウェイの生値・統計(JSON)
.venv/bin/epcube-collector once --dry-run    # 取得して表示するだけ(保存しない)
.venv/bin/epcube-collector once              # SQLiteへ取り込み + Cloudflare D1へ差分同期
.venv/bin/epcube-collector sync --dry-run    # D1への未同期件数を確認
.venv/bin/epcube-collector sync              # D1へ手動で差分同期を実行
.venv/bin/epcube-collector show --last 10
.venv/bin/epcube-collector status
.venv/bin/python -m pytest -q
```

## 3. ENERGY FLOW ダッシュボードのデータ対応表

| 表示項目 | 取得元 | 内容・計算式 |
|---|---|---|
| `SOLAR` `kW` / `TODAY kWh` | ゲートウェイ | `solar_w / 1000`、`solar_day_kwh` |
| `USE` `kW` / `TODAY kWh` | ゲートウェイ | `load_w / 1000`、`load_day_kwh` |
| `BUY` `kW` / `TODAY kWh` | ゲートウェイ | `grid_w`（正の部分 `/ 1000`）、`buy_day_kwh` |
| `SELL` `kW` / `TODAY kWh` | ゲートウェイ + 計算 | `grid_w`（負の部分の絶対値 `/ 1000`）、当日の `grid_w < 0` の1分積算値（kWh） |
| `BATTERY` `%` / `kWh` / `CAPACITY` | ゲートウェイ + 設定値 | `soc`、`SOLAR_BATTERY_CAPACITY_KWH × soc / 100` |
| 充放電 `kW`・状態ラベル | ゲートウェイ | `batt_w` の符号を反転（正=充電 `CHARGING`、負=放電 `DISCHARGING`、0付近=`IDLE`） |
| `SELF %` | 計算 | 自給率 `(load_day_kwh - buy_day_kwh) ÷ load_day_kwh × 100` |
| `EST`（残り時間） | 計算 | `蓄電池残量kWh ÷ 現在の使用電力kW` |
| 日の出・南中・日の入り・太陽位置 | 計算 | `SOLAR_LOCATION`（東京都練馬区）の緯度経度から天文計算（NOAA式） |
| 天気・気温 (`CLEAR 19°C` 等) | Open-Meteo API | `SOLAR_LOCATION` の緯度経度で Open-Meteo から現在天気・気温を取得（15分キャッシュ） |
| `VALUE` / `COST` / `REV` (`¥`) | 設定値 + 計算 | `VALUE = 発電量 × 買電単価(35円)`、`COST = 買電量 × 買電単価(35円)`、`REV = 売電量 × 売電単価(24円)` |
