import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "solar",
    compatibilityDate: "2026-11-15",
    entrypoint: "./web/worker.ts",
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

      // 太陽光パネルの設置場所 (初期値: 東京都中央区 / 今回のサイト用: 東京都練馬区)
      SOLAR_LOCATION: bindings.text(process.env.SOLAR_LOCATION || "東京都練馬区"),
      // 買電単価 (円/kWh, 初期値: 35)
      SOLAR_BUY_PRICE_YEN: bindings.text(process.env.SOLAR_BUY_PRICE_YEN || "35"),
      // 売電単価 (円/kWh, 初期値: 24)
      SOLAR_SELL_PRICE_YEN: bindings.text(process.env.SOLAR_SELL_PRICE_YEN || "24"),
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
      // 取り込みトークンのSHA-256ハッシュ (平文トークンはサーバの config/epcube.env にのみ保持)
      INGEST_TOKEN_SHA256: bindings.text(
        process.env.INGEST_TOKEN_SHA256 ||
          "27d0a917b8307f76d757ff85691656112b2227bd33a132c334faae28c8bf9b86",
      ),
    },
  },
});
