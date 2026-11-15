# epcube-collector & ENERGY FLOW Web Dashboard

EP CUBE の PV1〜4・システム値・BMS(セル電圧/温度)を、BLEゲートウェイ(ATOMS3 Lite, `epcube_gateway.ino` v1.0.0)の
HTTP API から取得してローカル SQLite に保存し、Cloudflare Workers + D1 (`cf` CLI) で公開ダッシュボード (`ENERGY FLOW`) を配信するリポジトリです。

## ディレクトリ構成

```
~/solar/
├── README.md
├── pyproject.toml                 # epcube-collector (Python取り込み・同期CLI)
├── package.json                   # Cloudflare (cf CLI + @cloudflare/vite-plugin)
├── cloudflare.config.ts           # cf CLI 設定ファイル (Worker + D1 + Assets)
├── vite.config.ts                 # Vite + Cloudflare プラグイン設定
├── index.html                     # ENERGY FLOW ダッシュボード HTML
├── web/
│   ├── worker.ts                  # Cloudflare Worker (/api/dashboard, /api/ingest)
│   ├── main.ts                    # フロントエンド描画ロジック
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

## 1. ローカル収集 (`epcube-collector`)

### セットアップ

```bash
sudo apt install python3-venv
cd ~/solar
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/pip install -r requirements-dev.txt
cp config/epcube.env.example config/epcube.env
chmod 600 config/epcube.env
```

### 動作確認

```bash
cd ~/solar && set -a; . config/epcube.env; set +a
.venv/bin/epcube-collector latest            # ゲートウェイの生値・統計(JSON)
.venv/bin/epcube-collector once --dry-run    # 取得して表示するだけ(保存しない)
.venv/bin/epcube-collector once              # SQLiteへ取り込み (EPCUBE_SYNC_URL設定時はD1へも差分同期)
.venv/bin/epcube-collector sync --dry-run    # D1への未同期件数を確認
.venv/bin/epcube-collector show --last 10
.venv/bin/epcube-collector show --snapshots --last 5
.venv/bin/epcube-collector status
.venv/bin/python -m pytest -q
```

### 定期実行(systemd)

```bash
sudo cp ~/solar/systemd/epcube-collector.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now epcube-collector.timer
```

## 2. Cloudflare 連携 (`cf` CLI)

本プロジェクトは `wrangler` ではなく Cloudflare の新CLI **`cf`** (`cloudflare.config.ts`) を使用します。

### セットアップ & ローカル開発

```bash
cd ~/solar
npm install

# Cloudflare アカウントへログイン
npx cf auth login

# D1 データベースの作成 (作成後に表示される database id を CLOUDFLARE_D1_ID に設定)
npx cf d1 create epcube-solar

# ローカル開発サーバ起動
npx cf dev

# ビルド確認
npx cf build
```

### デプロイと同期設定

1. `cloudflare.config.ts` の `SITE_CONFIG` (買電単価 `buyPriceYenPerKwh`、売電単価 `sellPriceYenPerKwh`、蓄電池容量 `batteryCapacityKwh`、緯度 `latitude`、経度 `longitude`) を必要に応じて調整します。
2. シークレットファイル (`.env.secrets` 等、Git管理外) に取り込み用トークン `INGEST_TOKEN=<任意のランダム文字列>` を用意し、`cf deploy` でデプロイします:
   ```bash
   export CLOUDFLARE_D1_ID="<作成したD1のUUID>"
   npx cf deploy --secrets-file config/cf-secrets.env
   ```
3. Ubuntuサーバ側の `config/epcube.env` に `EPCUBE_SYNC_URL` と `EPCUBE_SYNC_TOKEN` を設定すると、毎分の `epcube-collector once` 実行時に未送信の `minute_samples` / `bms_snapshots` が自動的に Cloudflare D1 へ差分同期されます。

## 3. ENERGY FLOW ダッシュボードのデータ対応表

| 画面表示項目 | データソース / 算出式 |
|---|---|
| `13:45` (時刻) | 最新サンプルの `ts` (JST `HH:MM`) |
| `CLEAR 19°C` (天気・気温) | Worker側で設置座標の Open-Meteo API を取得(15分キャッシュ、APIキー不要) |
| `EXPORTING` 等の状態ピル | `grid_w` / `batt_w` から `EXPORTING` / `IMPORTING` / `CHARGING` / `DISCHARGING` / `IDLE` を自動判定 |
| 太陽軌道 (`06:18` / `12:00` / `16:35`) | 設置座標(`latitude`, `longitude`)と日付から天文計算(NOAA式)で算出 |
| `SOLAR` `kW` / `TODAY kWh` / `VALUE ¥` | `solar_w / 1000`、`solar_day_kwh`、`solar_day_kwh × buyPriceYenPerKwh(31円)` |
| `USE` `kW` / `TODAY kWh` / `SELF %` | `load_w / 1000`、`load_day_kwh`、`(load_day_kwh - buy_day_kwh) / load_day_kwh × 100` |
| `BUY` `kW` / `TODAY kWh` / `COST ¥` | `max(0, grid_w) / 1000`、`buy_day_kwh`、`buy_day_kwh × buyPriceYenPerKwh(31円)` |
| `SELL` `kW` / `TODAY kWh` / `REV ¥` | `max(0, -grid_w) / 1000`、当日の `grid_w < 0` の1分積分値(kWh)、`sellTodayKwh × sellPriceYenPerKwh(16円)` |
| `BATTERY` `% (kWh)` / `CAPACITY` / `EST` | `soc`、`batteryCapacityKwh(13.8kWh) × soc / 100`、`残量kWh ÷ 現在消費kW` |
| `PV1〜4・BMS詳細` ドロワー | `pv1..4_p_avg_w`, `pv1..4_v`, `pv1..4_i`、および `pack_v`, 48セル電圧(`cells_json`), 16温度(`temps_json`) |
