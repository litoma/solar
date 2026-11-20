# EP VIEW

EP CUBE の PV1〜4・システム値・BMS（セル電圧/温度）を、BLE ゲートウェイ（M5Stack ATOMS3 Lite）の HTTP API から **Cloudflare Tunnel (`cloudflared`) + Workers VPC + Cloudflare Workers (Cron Trigger)** 経由で直接取得して **Cloudflare D1** に蓄積し、公開ダッシュボード（`https://solar.yusukesakai.com`）を配信するリポジトリです。

## システム構成

```text
EP CUBE ⇄ ATOMS3 Lite (192.168.0.36:80)
              ▲
              │ (LAN内 HTTP)
         cloudflared (自宅サーバ上の Tunnel 中継のみ)
              ▲
              │ Workers VPC (EP_GATEWAY)
    Cloudflare Worker (Cron * * * * * / 毎分)
              │
              ▼
        Cloudflare D1 (minute_samples / bms_snapshots / daily_summary)
              │
              ▼
    Cloudflare Worker (/api/dashboard + Cache API) → ブラウザ (EP VIEW)
```

※ ローカル SQLite や Python 常駐スクリプトは不要です。自宅サーバでは Tunnel 中継用の `cloudflared.service` のみを稼働させます。

## ディレクトリ構成

```text
~/solar/
├── README.md
├── package.json                       # Cloudflare (cf CLI + Vite + React + Recharts)
├── package-lock.json
├── cloudflare.config.ts               # cf CLI 設定 (Worker / Cron / D1 / Workers VPC / 環境変数)
├── tsconfig.json
├── vite.config.ts                     # Vite + @cloudflare/vite-plugin 設定
├── index.html                         # EP VIEW ダッシュボード HTML
├── esp32s3/                           # M5Stack ATOMS3 Lite (ESP32-S3) ファームウェア
│   ├── epcube-gw.ino                  # BLE ⇄ HTTP ゲートウェイ スケッチ (v1.2.1)
│   ├── secrets.example.h              # Wi-Fi / API_TOKEN 設定テンプレート
│   └── README.md                      # ゲートウェイ設計・レジスタ・運用仕様書
├── web/
│   ├── worker.ts                      # Cloudflare Worker (Cron直接取り込み + /api/dashboard)
│   ├── main.ts                        # フロントエンド描画ロジック (非表示タブ時は自動更新停止)
│   ├── SimulationChart.tsx            # PV GENERATION 月別推定/実績グラフ
│   ├── PaybackChart.tsx               # PAYBACK PLAN 投資回収計画・実績グラフ
│   └── style.css                      # EP VIEW ダッシュボード CSS
└── migrations/
    ├── 0001_init.sql                  # minute_samples / bms_snapshots 初期スキーマ
    ├── 0002_daily_summary.sql         # daily_summary (日次サマリー) テーブル
    └── 0003_past_daily_summary.sql    # 記録開始前 (2026-10-28〜11-14) の日次実績データ
```

## 1. バインディング・環境変数 (Cloudflare Workers)

[cloudflare.config.ts](file:///home/litoma/solar/cloudflare.config.ts) または Cloudflare ダッシュボードの **Settings → Variables and Secrets** で設定します。

### 主なバインディング・動作設定

| 項目名 | 種別 | 内容 |
|---|---|---|
| `DB` | D1 Binding | `epcube-solar`（1分値・BMS・日次サマリー保存先） |
| `ASSETS` | Assets Binding | Vite でビルドした静的アセット配信 |
| `EP_GATEWAY` | Workers VPC Service | Tunnel 経由で自宅 LAN 内 `192.168.0.36:80` へプライベート接続 |
| `SOLAR_SITE_ORIGIN` | Text | Cron 取り込み後のエッジキャッシュ破棄対象オリジン（既定 `https://solar.yusukesakai.com`） |
| `GW_TOKEN` | Secret（任意） | ゲートウェイ側で `API_TOKEN` を有効化した場合に `X-Api-Token` として送信 |

### サイト設定用 環境変数

| 環境変数名 | コード初期値 | 今回のサイト設定値 | 説明 |
|---|---|---|---|
| `SOLAR_LOCATION` | `東京都中央区` | **`東京都練馬区`** | 太陽光パネルの設置場所（日の出・日の入り計算および Open-Meteo 天気取得に使用） |
| `SOLAR_BUY_PRICE_YEN` | `35` | **`35`** | 電力会社から電力を購入するときの買電単価（円/kWh） |
| `SOLAR_SELL_PRICE_YEN` | `24` | **`24`** | 売電単価の基本値（円/kWh、下記スケジュール未設定時のフォールバック） |
| `SOLAR_SELL_PRICE_SCHEDULE` | `1-4:24,5-10:8.3,11+:8.5` | **`1-4:24,5-10:8.3,11+:8.5`** | 運転年数別の売電単価スケジュール（初期投資支援スキーム 1〜4年目24円 / 5〜10年目8.3円 / 11年目以降卒FIT 8.5円） |
| `SOLAR_START_YM` | `2026-11` | **`2026-11`** | 導入・発電開始年月 |
| `SOLAR_SELL_START_DATE` | `2027-04-01` | **`2027-04-01`** | 売電（FIT）開始日（この日より前は売電単価0円、この日からFIT年数カウント開始） |
| `SOLAR_SELF_CONSUME_RATIO` | `0.65` | **`0.65`** | 投資回収シミュレーション用の想定自家消費率（`0.65` ＝ 自家消費65% / 売電35%） |
| `SOLAR_REFRESH_MINUTES` | `1` | **`1`** | 公開サイトの情報更新頻度（分。秒指定の `SOLAR_REFRESH_SEC` も可） |
| `SOLAR_BATTERY_CAPACITY_KWH` | `13.3` | **`13.3`** | 蓄電池の定格容量（kWh、カタログ値 13.3kWh） |
| `SOLAR_PAYBACK_TARGET_YEN` | `1100000` | **`1100000`** | 補助金控除後の実質自己負担・投資回収目標額（円、初期値110万円） |
| `SOLAR_INITIAL_COST_YEN` / `SOLAR_SUBSIDY_YEN` | `3500000` / `2400000` | **`3500000` / `2400000`** | 導入総額（350万円）および自治体補助金（240万円） |
| `SOLAR_LATITUDE` / `SOLAR_LONGITUDE` | 自動解決 | 自動解決 (`35.7356`, `139.6517`) | 緯度・経度を直接数値で上書きしたい場合のみ指定 |

## 2. データ取り込み・D1 読み取り削減の仕組み

- **毎分 Cron 取り込み (`* * * * *`)**:
  - Worker の `scheduled` ハンドラが `minute_samples` / `bms_snapshots` の最新 `ts`（計2行）だけを取得し、VPC 経由で `/api/minutes?since=<max_ts>&limit=30` を取得して D1 へ UPSERT します（無料枠の 50クエリ / CPU 10ms 上限対策で1回30件までに制限。単発通信失敗対策として 5秒タイムアウト・最大2回リトライを実施）。
  - 新規分があれば `daily_summary` の当日行（1〜2行）のみを参照して増分・日積算値を更新します（Open-Meteo の天気・外気温も 300秒キャッシュ付きで同時記録）。
  - 10分おき（585秒以上経過時）に `/api/latest?cells=1` を取得して 48セル・16温度センサー値を `bms_snapshots` へ保存します。
  - 直近データ `latest.ts` が現在時刻から **300秒（5分）以内** なら `ONLINE`、超過すると `OFFLINE` として配信します。
- **ダッシュボード応答 (`GET /api/dashboard`)**:
  - `minute_samples` の全件スキャンは行わず、最新1行 + BMS最新1行 + `daily_summary`（1日1行）のみを読み取ります。
  - Cache API（10〜60秒の動的 TTL、クライアント返却は `cache-control: no-store`）を併用し、複数端末・複数タブからの閲覧でも D1 読み取りを最小限に抑えています。
  - フロントエンド（[main.ts](file:///home/litoma/solar/web/main.ts)）は非表示タブ時は自動更新タイマーを停止し、再表示時（`visibilitychange`）に即座に再取得します。

## 3. ビルド・デプロイ・運用コマンド

通常は `main` ブランチへのプッシュで Cloudflare Workers Builds が自動ビルド・デプロイを行います（`npm run build` → `npx cf deploy --prebuilt`）。

```bash
# 型チェック・本番ビルド
npx tsc --noEmit && npm run build

# 手動デプロイ / トリガー反映
npm run deploy
npx cf workers triggers deploy --prebuilt

# D1 データ確認・アナリティクス確認
npx cf d1 query d85e2057-3eda-4fc8-bf60-f1e9195a5f60 --sql "SELECT jst_date, solar_kwh, sell_kwh, buy_kwh, load_kwh, samples FROM daily_summary ORDER BY jst_date DESC LIMIT 10"
```

自宅サーバでは `cloudflared.service` が稼働している必要があります。

## 4. EP VIEW ダッシュボードの構成とデータ対応表

### SUMMARY

| 表示項目 | 取得元 | 内容・計算式 |
|---|---|---|
| `SOLAR` `kW` / `kWh/d` | ゲートウェイ | `solar_w / 1000`、`solar_day_kwh` |
| `USE` `kW` / `kWh/d` | ゲートウェイ | `load_w / 1000`、`load_day_kwh` |
| `BATTERY` `%` / `kWh` / `MAX` | ゲートウェイ + 設定値 | `soc`、`SOLAR_BATTERY_CAPACITY_KWH × soc / 100` |
| 充放電 `kW`・状態ラベル | ゲートウェイ | `batt_w` の符号反転（正=充電 `CHARGING`、負=放電 `DISCHARGING`、0付近=`IDLE`） |
| `BUY` `kW` / `kWh/d` | ゲートウェイ | `grid_w`（正の部分 `/ 1000`）、`buy_day_kwh` |
| `SELL` `kW` / `kWh/d` | ゲートウェイ + 計算 | `grid_w`（負の部分の絶対値 `/ 1000`）、当日の `grid_w < 0` 積算値（`daily_summary.sell_kwh`） |
| `SELF %` | 計算 | 自給率 `(load_day_kwh - buy_day_kwh) ÷ load_day_kwh × 100` |
| `EST`（残り時間） | 計算 | `蓄電池残量kWh ÷ 現在の使用電力kW`（無負荷時は充放電電力） |
| 日の出・南中・日の入り・太陽位置 | 計算 | `SOLAR_LOCATION`（東京都練馬区）の緯度経度から天文計算（NOAA式） |
| 天気アイコン・気温 | Open-Meteo → D1 | Cron 取り込み時に `minute_samples` へ記録（欠損時はダッシュボード側でフォールバック取得） |
| `VALUE` / `COST` / `REV` (`¥`) | 設定値 + 計算 | `VALUE = 発電量 × 買電単価`、`COST = 買電量 × 買電単価`、`REV = 売電量 × 当該年売電単価` |

### その他セクション
- **PV STRINGS**: 1ページ目に方角別の発電電力・当日発電量（`daily_summary.pv1〜4_kwh`）と屋根レイアウト図、2ページ目に搭載パネル仕様詳細を表示します。
- **PV GENERATION**: `daily_summary` から当年月別の実績発電量を集計し、年間シミュレーション値（6,348 kWh/年）と比較表示します。
- **PAYBACK PLAN**: 全期間の `daily_summary` から自家消費節約額＋売電収益を算出し、投資回収目標（110万円）に対する進捗・年次予測・単価設定を表示します。
- **BMS STATUS**: `PACK`（総電圧とセル平均×48の整合性）・`TEMP`（16温度センサー 2×8）・`CELL`（48セル電圧 4×12）を表示します。
