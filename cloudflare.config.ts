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
      SITE_CONFIG: bindings.json({
        // 電気料金単価 (円/kWh)
        buyPriceYenPerKwh: 31,
        sellPriceYenPerKwh: 16,
        // 蓄電池の定格容量 (kWh)
        batteryCapacityKwh: 13.8,
        // 日の出・日の入り・天気取得用の緯度・経度 (既定: 東京)
        latitude: 35.6812,
        longitude: 139.7671,
        timezoneOffsetMinutes: 540,
      }),
    },
  },
});
