import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
  worker: {
    name: "solar",
    compatibilityDate: "2026-11-15",
    entrypoint: "./web/worker.ts",
    triggers: [triggers.scheduled({ schedule: "* * * * *" })],
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
    env: {
      DB: bindings.d1({
        name: "epcube-solar",
        id: process.env.CLOUDFLARE_D1_ID,
      }),
      ASSETS: bindings.assets(),
      // Workers VPC Service (epcube-gw -> zmshabin Tunnel -> 192.168.0.36:80)
      EP_GATEWAY: bindings.vpcService({
        id:
          process.env.CLOUDFLARE_VPC_SERVICE_ID ||
          "01a1ef69-d41b-7c00-a0cb-7f79c1c08be5",
      }),
      // Cron実行時のエッジキャッシュ無効化対象オリジン
      SOLAR_SITE_ORIGIN: bindings.text(
        process.env.SOLAR_SITE_ORIGIN || "https://solar.yusukesakai.com",
      ),
      // ESP32-S3 オフライン検知通知メール (Email Routing + send_email)
      EMAIL: bindings.sendEmail(),
      ALERT_EMAIL_FROM: bindings.text(
        process.env.ALERT_EMAIL_FROM || "alert@notify.yusukesakai.com",
      ),
      ALERT_OFFLINE_MINUTES: bindings.text(
        process.env.ALERT_OFFLINE_MINUTES || "60",
      ),

      // 太陽光パネルの設置場所 (初期値: 東京都中央区 / 今回のサイト用: 東京都練馬区)
      SOLAR_LOCATION: bindings.text(process.env.SOLAR_LOCATION || "東京都練馬区"),
      // 電気の基本料金 (円/月, 初期値: 1991.56 / 基本料金なしプランは 0)
      SOLAR_BASE_FEE_YEN: bindings.text(
        process.env.SOLAR_BASE_FEE_YEN || "1991.56",
      ),
      // 従量電灯 第1段階料金 (〜120kWh, 円/kWh, 初期値: 29.86)
      SOLAR_BUY_PRICE_TIER1_YEN: bindings.text(
        process.env.SOLAR_BUY_PRICE_TIER1_YEN || "29.86",
      ),
      // 従量電灯 第2段階料金 (121〜400kWh, 円/kWh, 初期値: 35.87)
      SOLAR_BUY_PRICE_TIER2_YEN: bindings.text(
        process.env.SOLAR_BUY_PRICE_TIER2_YEN || "35.87",
      ),
      // 従量電灯 第3段階料金 (401kWh〜, 円/kWh, 初期値: 40.49)
      SOLAR_BUY_PRICE_TIER3_YEN: bindings.text(
        process.env.SOLAR_BUY_PRICE_TIER3_YEN || "40.49",
      ),
      // 売電単価 (円/kWh, 初期値: 24 ※年数別スケジュール未設定時のフォールバック)
      SOLAR_SELL_PRICE_YEN: bindings.text(process.env.SOLAR_SELL_PRICE_YEN || "24"),
      // 年数別の売電単価スケジュール (初期投資支援スキーム + 卒FIT: 1〜4年目=24円, 5〜10年目=8.3円, 11年目以降=8.5円)
      SOLAR_SELL_PRICE_SCHEDULE: bindings.text(
        process.env.SOLAR_SELL_PRICE_SCHEDULE || "1-4:24,5-10:8.3,11+:8.5",
      ),
      // 導入・発電開始年月 (初期値: 2026-11)
      SOLAR_START_YM: bindings.text(process.env.SOLAR_START_YM || "2026-11"),
      // 売電(FIT)開始日 (この日までは売電単価0円、初期値: 2027-04-01)
      SOLAR_SELL_START_DATE: bindings.text(
        process.env.SOLAR_SELL_START_DATE || "2027-04-01",
      ),
      // 計画試算用の想定自家消費率 (0.0〜1.0, 初期値: 0.65 = 自家消費65% / 売電35%)
      SOLAR_SELF_CONSUME_RATIO: bindings.text(
        process.env.SOLAR_SELF_CONSUME_RATIO || "0.65",
      ),
      // 公開サイトの情報更新頻度 (分, 初期値: 1)
      SOLAR_REFRESH_MINUTES: bindings.text(process.env.SOLAR_REFRESH_MINUTES || "1"),
      // 蓄電池の定格容量 (kWh, カタログ値: 13.3)
      SOLAR_BATTERY_CAPACITY_KWH: bindings.text(
        process.env.SOLAR_BATTERY_CAPACITY_KWH || "13.3",
      ),
      // 投資回収目標額 (円, 初期値: 1100000 = 350万円 - 補助金240万円)
      SOLAR_PAYBACK_TARGET_YEN: bindings.text(
        process.env.SOLAR_PAYBACK_TARGET_YEN || "1100000",
      ),
      // 導入総額 (円, 初期値: 3500000)
      SOLAR_INITIAL_COST_YEN: bindings.text(
        process.env.SOLAR_INITIAL_COST_YEN || "3500000",
      ),
      // 自治体補助金 (円, 初期値: 2400000)
      SOLAR_SUBSIDY_YEN: bindings.text(
        process.env.SOLAR_SUBSIDY_YEN || "2400000",
      ),
    },
  },
});
