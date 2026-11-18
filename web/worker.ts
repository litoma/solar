export interface SellPriceTier {
  startYear: number;
  endYear: number | null;
  priceYenPerKwh: number;
}

export interface SiteConfig {
  location: string;
  buyPriceYenPerKwh: number;
  sellPriceYenPerKwh: number;
  sellPriceSchedule: SellPriceTier[];
  sellPriceScheduleRaw: string;
  startYm: string;
  sellStartDate: string;
  selfConsumeRatio: number;
  refreshIntervalSec: number;
  batteryCapacityKwh: number;
  paybackTargetYen: number;
  initialCostYen: number;
  subsidyYen: number;
  latitude: number;
  longitude: number;
  timezoneOffsetMinutes: number;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  EP_GATEWAY?: Fetcher;
  SOLAR_SITE_ORIGIN?: string;
  GW_TOKEN?: string;
  // 環境変数 (未設定時は下記の初期値を使用)
  SOLAR_LOCATION?: string;
  SOLAR_LATITUDE?: string;
  SOLAR_LONGITUDE?: string;
  SOLAR_BUY_PRICE_YEN?: string;
  SOLAR_SELL_PRICE_YEN?: string;
  SOLAR_SELL_PRICE_SCHEDULE?: string;
  SOLAR_START_YM?: string;
  SOLAR_SELL_START_DATE?: string;
  SOLAR_SELF_CONSUME_RATIO?: string;
  SOLAR_REFRESH_MINUTES?: string;
  SOLAR_REFRESH_SEC?: string;
  SOLAR_BATTERY_CAPACITY_KWH?: string;
  SOLAR_PAYBACK_TARGET_YEN?: string;
  SOLAR_INITIAL_COST_YEN?: string;
  SOLAR_SUBSIDY_YEN?: string;
  // 取り込み認証 (平文シークレットまたはSHA-256ハッシュ)
  INGEST_TOKEN?: string;
  INGEST_TOKEN_SHA256?: string;
}

// 初期値
const DEFAULT_LOCATION = "東京都中央区";
const DEFAULT_BUY_PRICE_YEN = 35;
const DEFAULT_SELL_PRICE_YEN = 24;
// 2025年度下半期〜 初期投資支援スキーム (1〜4年目: 24円, 5〜10年目: 8.3円) + 卒FIT (11年目以降: 8.5円)
const DEFAULT_SELL_PRICE_SCHEDULE = "1-4:24,5-10:8.3,11+:8.5";
const DEFAULT_START_YM = "2026-11";
const DEFAULT_SELL_START_DATE = "2027-04-01";
const DEFAULT_SELF_CONSUME_RATIO = 0.65;
const DEFAULT_REFRESH_MINUTES = 1;
const DEFAULT_BATTERY_CAPACITY_KWH = 13.3;
const DEFAULT_PAYBACK_TARGET_YEN = 1100000;
const DEFAULT_INITIAL_COST_YEN = 3500000;
const DEFAULT_SUBSIDY_YEN = 2400000;
const DEFAULT_TZ_OFFSET_MIN = 540; // JST (UTC+9)

// 主要地域の緯度・経度テーブル
const LOCATION_COORDS: Record<string, { lat: number; lon: number }> = {
  東京都中央区: { lat: 35.6707, lon: 139.772 },
  中央区: { lat: 35.6707, lon: 139.772 },
  東京都練馬区: { lat: 35.7356, lon: 139.6517 },
  練馬区: { lat: 35.7356, lon: 139.6517 },
  東京都千代田区: { lat: 35.694, lon: 139.7536 },
  東京都港区: { lat: 35.6581, lon: 139.7516 },
  東京都新宿区: { lat: 35.6938, lon: 139.7034 },
  東京都文京区: { lat: 35.7081, lon: 139.7522 },
  東京都台東区: { lat: 35.7126, lon: 139.78 },
  東京都墨田区: { lat: 35.7107, lon: 139.8015 },
  東京都江東区: { lat: 35.6729, lon: 139.8174 },
  東京都品川区: { lat: 35.6092, lon: 139.7302 },
  東京都目黒区: { lat: 35.6415, lon: 139.6982 },
  東京都大田区: { lat: 35.5614, lon: 139.716 },
  東京都世田谷区: { lat: 35.6466, lon: 139.6532 },
  東京都渋谷区: { lat: 35.6638, lon: 139.6977 },
  東京都中野区: { lat: 35.7074, lon: 139.6638 },
  東京都杉並区: { lat: 35.6995, lon: 139.6364 },
  東京都豊島区: { lat: 35.7261, lon: 139.7166 },
  東京都北区: { lat: 35.7528, lon: 139.7335 },
  東京都荒川区: { lat: 35.736, lon: 139.7834 },
  東京都板橋区: { lat: 35.7512, lon: 139.7092 },
  東京都足立区: { lat: 35.775, lon: 139.8044 },
  東京都葛飾区: { lat: 35.7435, lon: 139.8472 },
  東京都江戸川区: { lat: 35.7067, lon: 139.8683 },
  東京都: { lat: 35.6895, lon: 139.6917 },
};

const MINUTE_COLS = [
  "ts",
  "n",
  "pv1_p_avg_w",
  "pv1_p_min_w",
  "pv1_p_max_w",
  "pv1_v",
  "pv1_i",
  "pv2_p_avg_w",
  "pv2_p_min_w",
  "pv2_p_max_w",
  "pv2_v",
  "pv2_i",
  "pv3_p_avg_w",
  "pv3_p_min_w",
  "pv3_p_max_w",
  "pv3_v",
  "pv3_i",
  "pv4_p_avg_w",
  "pv4_p_min_w",
  "pv4_p_max_w",
  "pv4_v",
  "pv4_i",
  "solar_w",
  "grid_w",
  "load_w",
  "batt_w",
  "pcs_w",
  "soc",
  "mode",
  "solar_day_kwh",
  "buy_day_kwh",
  "load_day_kwh",
  "pack_v",
  "cell_max_mv",
  "cell_min_mv",
  "cell_avg_mv",
  "temp_max_c",
  "temp_min_c",
  "temp_avg_c",
  "weather_code",
  "outdoor_temp_c",
] as const;

const CREATE_TABLES_SQL = [
  `CREATE TABLE IF NOT EXISTS minute_samples (
    ts INTEGER PRIMARY KEY, n INTEGER,
    pv1_p_avg_w REAL, pv1_p_min_w INTEGER, pv1_p_max_w INTEGER, pv1_v REAL, pv1_i REAL,
    pv2_p_avg_w REAL, pv2_p_min_w INTEGER, pv2_p_max_w INTEGER, pv2_v REAL, pv2_i REAL,
    pv3_p_avg_w REAL, pv3_p_min_w INTEGER, pv3_p_max_w INTEGER, pv3_v REAL, pv3_i REAL,
    pv4_p_avg_w REAL, pv4_p_min_w INTEGER, pv4_p_max_w INTEGER, pv4_v REAL, pv4_i REAL,
    solar_w REAL, grid_w REAL, load_w REAL, batt_w REAL, pcs_w REAL, soc INTEGER, mode INTEGER,
    solar_day_kwh REAL, buy_day_kwh REAL, load_day_kwh REAL,
    pack_v REAL, cell_max_mv INTEGER, cell_min_mv INTEGER, cell_avg_mv INTEGER,
    temp_max_c INTEGER, temp_min_c INTEGER, temp_avg_c REAL,
    weather_code INTEGER, outdoor_temp_c REAL
  )`,
  `CREATE TABLE IF NOT EXISTS bms_snapshots (
    ts INTEGER PRIMARY KEY, cells_json TEXT, temps_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS daily_summary (
    jst_date TEXT PRIMARY KEY,
    solar_kwh REAL, sell_kwh REAL, buy_kwh REAL, load_kwh REAL,
    pv1_kwh REAL, pv2_kwh REAL, pv3_kwh REAL, pv4_kwh REAL,
    samples INTEGER, last_ts INTEGER
  )`,
];

const ALTER_COLUMNS_SQL = [
  "ALTER TABLE minute_samples ADD COLUMN weather_code INTEGER",
  "ALTER TABLE minute_samples ADD COLUMN outdoor_temp_c REAL",
];

const UPSERT_MINUTE_SQL =
  `INSERT INTO minute_samples (${MINUTE_COLS.join(", ")}) ` +
  `VALUES (${MINUTE_COLS.map(() => "?").join(", ")}) ` +
  `ON CONFLICT(ts) DO UPDATE SET ` +
  MINUTE_COLS.filter((c) => c !== "ts")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");

// 日別サマリー (収集プログラムがローカルSQLiteで集計した絶対値をUPSERTする)
const DAILY_COLS = [
  "jst_date",
  "solar_kwh",
  "sell_kwh",
  "buy_kwh",
  "load_kwh",
  "pv1_kwh",
  "pv2_kwh",
  "pv3_kwh",
  "pv4_kwh",
  "samples",
  "last_ts",
] as const;

const UPSERT_DAILY_SQL =
  `INSERT INTO daily_summary (${DAILY_COLS.join(", ")}) ` +
  `VALUES (${DAILY_COLS.map(() => "?").join(", ")}) ` +
  `ON CONFLICT(jst_date) DO UPDATE SET ` +
  DAILY_COLS.filter((c) => c !== "jst_date")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");

interface DailySummaryRow {
  jst_date: string;
  solar_kwh: number | null;
  sell_kwh: number | null;
  buy_kwh: number | null;
  load_kwh: number | null;
  pv1_kwh: number | null;
  pv2_kwh: number | null;
  pv3_kwh: number | null;
  pv4_kwh: number | null;
  samples: number | null;
  last_ts: number | null;
}

// /api/dashboard のエッジキャッシュ (Cache API)。D1 へのアクセスを最大で約1分に1回に抑える
const DASHBOARD_CACHE_MIN_SEC = 10;
const DASHBOARD_CACHE_MAX_SEC = 60;
// 1分値 ts の分は ts+60 で確定し、収集プログラムが毎分20秒に送るため、次のデータは概ね ts+140秒頃に届く
const NEXT_DATA_ARRIVAL_SEC = 150;

const UPSERT_SNAPSHOT_SQL =
  `INSERT INTO bms_snapshots (ts, cells_json, temps_json) VALUES (?, ?, ?) ` +
  `ON CONFLICT(ts) DO UPDATE SET cells_json = excluded.cells_json, temps_json = excluded.temps_json`;

let schemaInitialized = false;

async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaInitialized) return;
  await db.batch(CREATE_TABLES_SQL.map((sql) => db.prepare(sql)));
  for (const sql of ALTER_COLUMNS_SQL) {
    try {
      await db.prepare(sql).run();
    } catch {
      // 既に列が存在する場合は無視
    }
  }
  schemaInitialized = true;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/dashboard" && request.method === "GET") {
      return handleDashboardCached(request, env, ctx);
    }
    if (url.pathname === "/api/ingest" && request.method === "POST") {
      return handleIngest(request, env, ctx);
    }
    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({ error: "Not Found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    await handleScheduledIngest(env, ctx);
  },
};

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * "1-4:24,5-10:8.3,11+:8.5" のような年数別売電単価スケジュール文字列をパースする
 */
function parseSellPriceSchedule(
  raw: string | undefined,
  fallbackPrice: number,
): SellPriceTier[] {
  const src = (raw || DEFAULT_SELL_PRICE_SCHEDULE).trim();
  const tiers: SellPriceTier[] = [];
  for (const part of src.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const [rangePart, pricePart] = token.split(":").map((s) => s.trim());
    if (!rangePart || !pricePart) continue;
    const price = Number(pricePart);
    if (!Number.isFinite(price) || price < 0) continue;

    const mRange = /^(\d+)\s*-\s*(\d+)$/.exec(rangePart);
    const mOpen = /^(\d+)\s*(?:\+|-)?$/.exec(rangePart);
    if (mRange) {
      const s = Number(mRange[1]);
      const e = Number(mRange[2]);
      if (s >= 1 && e >= s) {
        tiers.push({ startYear: s, endYear: e, priceYenPerKwh: price });
      }
    } else if (mOpen) {
      const s = Number(mOpen[1]);
      const isOpenEnded = rangePart.endsWith("+") || rangePart.endsWith("-");
      if (s >= 1) {
        tiers.push({
          startYear: s,
          endYear: isOpenEnded ? null : s,
          priceYenPerKwh: price,
        });
      }
    }
  }
  if (tiers.length === 0) {
    return [{ startYear: 1, endYear: null, priceYenPerKwh: fallbackPrice }];
  }
  tiers.sort((a, b) => a.startYear - b.startYear);
  return tiers;
}

function getSellPriceForYear(
  schedule: SellPriceTier[],
  yearOfOperation: number,
  fallbackPrice: number,
): number {
  const yr = Math.max(1, Math.floor(yearOfOperation));
  for (const t of schedule) {
    if (yr >= t.startYear && (t.endYear === null || yr <= t.endYear)) {
      return t.priceYenPerKwh;
    }
  }
  return schedule[schedule.length - 1]?.priceYenPerKwh ?? fallbackPrice;
}

function getOperationYearForYm(startYm: string, targetYm: string): number {
  const ms = /^(\d{4})-(\d{2})$/.exec(startYm);
  const mt = /^(\d{4})-(\d{2})$/.exec(targetYm);
  if (!ms || !mt) return 1;
  const startMonths = Number(ms[1]) * 12 + (Number(ms[2]) - 1);
  const targetMonths = Number(mt[1]) * 12 + (Number(mt[2]) - 1);
  const diff = Math.max(0, targetMonths - startMonths);
  return Math.floor(diff / 12) + 1;
}

async function resolveSiteConfig(env: Env): Promise<SiteConfig> {
  const location = (env.SOLAR_LOCATION || DEFAULT_LOCATION).trim() || DEFAULT_LOCATION;
  const buyPriceYenPerKwh = parsePositiveNumber(
    env.SOLAR_BUY_PRICE_YEN,
    DEFAULT_BUY_PRICE_YEN,
  );
  const baseSellPriceYen = parsePositiveNumber(
    env.SOLAR_SELL_PRICE_YEN,
    DEFAULT_SELL_PRICE_YEN,
  );
  const sellPriceScheduleRaw =
    (env.SOLAR_SELL_PRICE_SCHEDULE || DEFAULT_SELL_PRICE_SCHEDULE).trim() ||
    DEFAULT_SELL_PRICE_SCHEDULE;
  const sellPriceSchedule = parseSellPriceSchedule(
    sellPriceScheduleRaw,
    baseSellPriceYen,
  );
  const startYmRaw = (env.SOLAR_START_YM || DEFAULT_START_YM).trim();
  const startYm = /^\d{4}-\d{2}$/.test(startYmRaw)
    ? startYmRaw
    : DEFAULT_START_YM;
  const sellStartRaw = (env.SOLAR_SELL_START_DATE || DEFAULT_SELL_START_DATE)
    .trim()
    .replace(/\//g, "-");
  const sellStartDate = /^\d{4}-\d{2}-\d{2}$/.test(sellStartRaw)
    ? sellStartRaw
    : DEFAULT_SELL_START_DATE;
  const rawSelfRatio = parsePositiveNumber(
    env.SOLAR_SELF_CONSUME_RATIO,
    DEFAULT_SELF_CONSUME_RATIO,
  );
  const selfConsumeRatio = Math.max(0.05, Math.min(1.0, rawSelfRatio));

  // 現在日付が売電開始日前なら売電単価0円、開始日以降なら売電開始日を起点に年数判定
  const nowJst = new Date(Date.now() + DEFAULT_TZ_OFFSET_MIN * 60 * 1000);
  const currentDate = `${nowJst.getUTCFullYear()}-${String(nowJst.getUTCMonth() + 1).padStart(2, "0")}-${String(nowJst.getUTCDate()).padStart(2, "0")}`;
  const currentYm = currentDate.slice(0, 7);
  const sellStartYm = sellStartDate.slice(0, 7);
  const sellPriceYenPerKwh =
    currentDate < sellStartDate
      ? 0
      : getSellPriceForYear(
          sellPriceSchedule,
          getOperationYearForYm(sellStartYm, currentYm),
          baseSellPriceYen,
        );

  const batteryCapacityKwh = parsePositiveNumber(
    env.SOLAR_BATTERY_CAPACITY_KWH,
    DEFAULT_BATTERY_CAPACITY_KWH,
  );
  const paybackTargetYen = Math.round(
    parsePositiveNumber(env.SOLAR_PAYBACK_TARGET_YEN, DEFAULT_PAYBACK_TARGET_YEN),
  );
  const initialCostYen = Math.round(
    parsePositiveNumber(env.SOLAR_INITIAL_COST_YEN, DEFAULT_INITIAL_COST_YEN),
  );
  const subsidyYen = Math.round(
    parsePositiveNumber(env.SOLAR_SUBSIDY_YEN, DEFAULT_SUBSIDY_YEN),
  );

  let refreshIntervalSec = DEFAULT_REFRESH_MINUTES * 60;
  if (env.SOLAR_REFRESH_SEC) {
    refreshIntervalSec = Math.max(
      10,
      Math.round(parsePositiveNumber(env.SOLAR_REFRESH_SEC, 60)),
    );
  } else if (env.SOLAR_REFRESH_MINUTES) {
    refreshIntervalSec = Math.max(
      10,
      Math.round(parsePositiveNumber(env.SOLAR_REFRESH_MINUTES, DEFAULT_REFRESH_MINUTES) * 60),
    );
  }

  // 緯度・経度の解決 (直接指定 > 内蔵辞書 > Open-Meteo Geocoding > 初期値:東京都中央区)
  const explicitLat = env.SOLAR_LATITUDE ? Number(env.SOLAR_LATITUDE.trim()) : NaN;
  const explicitLon = env.SOLAR_LONGITUDE ? Number(env.SOLAR_LONGITUDE.trim()) : NaN;

  let coords: { lat: number; lon: number };
  if (Number.isFinite(explicitLat) && Number.isFinite(explicitLon)) {
    coords = { lat: explicitLat, lon: explicitLon };
  } else if (LOCATION_COORDS[location]) {
    coords = LOCATION_COORDS[location];
  } else {
    coords =
      (await geocodeOpenMeteo(location)) || LOCATION_COORDS[DEFAULT_LOCATION];
  }

  return {
    location,
    buyPriceYenPerKwh,
    sellPriceYenPerKwh,
    sellPriceSchedule,
    sellPriceScheduleRaw,
    startYm,
    sellStartDate,
    selfConsumeRatio,
    refreshIntervalSec,
    batteryCapacityKwh,
    paybackTargetYen,
    initialCostYen,
    subsidyYen,
    latitude: coords.lat,
    longitude: coords.lon,
    timezoneOffsetMinutes: DEFAULT_TZ_OFFSET_MIN,
  };
}

async function geocodeOpenMeteo(
  name: string,
): Promise<{ lat: number; lon: number } | null> {
  const query = name.replace(/^東京都/, "").trim() || name;
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=ja&format=json`;
  try {
    const resp = await fetch(url, {
      cf: { cacheTtl: 86400, cacheEverything: true },
      signal: AbortSignal.timeout(2000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      results?: Array<{ latitude?: number; longitude?: number }>;
    };
    const first = data.results?.[0];
    if (
      first &&
      typeof first.latitude === "number" &&
      typeof first.longitude === "number"
    ) {
      return { lat: first.latitude, lon: first.longitude };
    }
    return null;
  } catch {
    return null;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyIngestAuth(request: Request, env: Env): Promise<boolean> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice(7).trim()
    : (request.headers.get("x-ingest-token") || "").trim();
  if (!token) return false;

  const expectedPlain = (env.INGEST_TOKEN || "").trim();
  if (expectedPlain) {
    return token === expectedPlain;
  }
  const expectedHash = (env.INGEST_TOKEN_SHA256 || "").trim().toLowerCase();
  if (expectedHash) {
    const actualHash = await sha256Hex(token);
    return actualHash === expectedHash;
  }
  return false;
}

async function handleIngest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!(await verifyIngestAuth(request, env))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: {
    minutes?: Record<string, unknown>[];
    snapshots?: Record<string, unknown>[];
    daily?: Record<string, unknown>[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  await ensureSchema(env.DB);

  const stmts: D1PreparedStatement[] = [];
  const minutes = Array.isArray(body.minutes) ? body.minutes : [];
  for (const row of minutes) {
    if (!row || typeof row.ts !== "number") continue;
    const values = MINUTE_COLS.map((col) => {
      const v = row[col];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    });
    stmts.push(env.DB.prepare(UPSERT_MINUTE_SQL).bind(...values));
  }

  const snapshots = Array.isArray(body.snapshots) ? body.snapshots : [];
  for (const snap of snapshots) {
    if (!snap || typeof snap.ts !== "number") continue;
    const cellsJson =
      typeof snap.cells_json === "string" ? snap.cells_json : null;
    const tempsJson =
      typeof snap.temps_json === "string" ? snap.temps_json : null;
    stmts.push(
      env.DB.prepare(UPSERT_SNAPSHOT_SQL).bind(snap.ts, cellsJson, tempsJson),
    );
  }

  const daily = Array.isArray(body.daily) ? body.daily : [];
  let dailyUpserted = 0;
  for (const row of daily) {
    if (
      !row ||
      typeof row.jst_date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.jst_date)
    ) {
      continue;
    }
    const values = DAILY_COLS.map((col) => {
      const v = row[col];
      if (col === "jst_date") return v as string;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    });
    stmts.push(env.DB.prepare(UPSERT_DAILY_SQL).bind(...values));
    dailyUpserted += 1;
  }

  // D1 batch limit を考慮して100件ずつ実行
  await execBatched(env.DB, stmts);

  // 新規データが取り込まれた同一エッジのダッシュボードキャッシュを破棄して即時反映する
  if (minutes.length > 0 || dailyUpserted > 0) {
    purgeDashboardCache(new URL(request.url).origin, ctx);
  }

  return jsonResponse({
    ok: true,
    minutes_upserted: minutes.length,
    snapshots_upserted: snapshots.length,
    daily_upserted: dailyUpserted,
  });
}

const GATEWAY_MINUTES_LIMIT = 30;
const GATEWAY_FETCH_TIMEOUT_MS = 8000;
const SNAPSHOT_INTERVAL_SEC = 600;
const SNAPSHOT_MAX_AGE_SEC = 120;
const GATEWAY_INTERNAL_ORIGIN = "http://192.168.0.36";

type ParsedMinuteRow = Partial<Record<(typeof MINUTE_COLS)[number], number | null>> & {
  ts: number;
};

function toReal(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toInt(value: unknown): number | null {
  const n = toReal(value);
  return n === null ? null : Math.round(n);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function purgeDashboardCache(origin: string, ctx: ExecutionContext): void {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } })
    .caches?.default;
  if (!cache) return;
  ctx.waitUntil(
    cache.delete(new Request(`${origin}/api/dashboard`, { method: "GET" })),
  );
}

async function execBatched(
  db: D1Database,
  stmts: D1PreparedStatement[],
): Promise<void> {
  const CHUNK_SIZE = 100;
  for (let i = 0; i < stmts.length; i += CHUNK_SIZE) {
    await db.batch(stmts.slice(i, i + CHUNK_SIZE));
  }
}

async function queryIngestWatermarks(
  db: D1Database,
): Promise<{ maxMinuteTs: number | null; maxSnapTs: number | null }> {
  const stmts = [
    db.prepare("SELECT MAX(ts) AS max_ts FROM minute_samples"),
    db.prepare("SELECT MAX(ts) AS max_ts FROM bms_snapshots"),
  ];
  let results: D1Result<{ max_ts: number | null }>[];
  try {
    results = await db.batch<{ max_ts: number | null }>(stmts);
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) {
      await ensureSchema(db);
      results = await db.batch<{ max_ts: number | null }>(stmts);
    } else {
      throw err;
    }
  }
  const m = results[0]?.results?.[0]?.max_ts;
  const s = results[1]?.results?.[0]?.max_ts;
  return {
    maxMinuteTs: typeof m === "number" ? m : null,
    maxSnapTs: typeof s === "number" ? s : null,
  };
}

async function fetchGatewayJson(
  gateway: Fetcher,
  pathAndQuery: string,
  gwToken?: string,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = gwToken?.trim();
  if (token) {
    headers["X-Api-Token"] = token;
  }
  const resp = await gateway.fetch(`${GATEWAY_INTERNAL_ORIGIN}${pathAndQuery}`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(GATEWAY_FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`Gateway HTTP ${resp.status} for ${pathAndQuery}`);
  }
  return await resp.json();
}

function parseGatewayMinutes(
  raw: unknown,
  sinceTs: number | null,
  serverNowSec: number,
): ParsedMinuteRow[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  if (obj.time_valid !== true || !Array.isArray(obj.minutes)) {
    return [];
  }
  const gwNow = toInt(obj.now);
  const limitTs = Math.max(serverNowSec, gwNow ?? 0) + 60;
  const byTs = new Map<number, ParsedMinuteRow>();

  for (const item of obj.minutes) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const rawTs = rec.ts;
    if (
      typeof rawTs !== "number" ||
      !Number.isInteger(rawTs) ||
      rawTs <= 0 ||
      rawTs % 60 !== 0
    ) {
      continue;
    }
    if ((sinceTs !== null && rawTs <= sinceTs) || rawTs > limitTs) {
      continue;
    }
    const nVal = toInt(rec.n);
    const row: ParsedMinuteRow = {
      ts: rawTs,
      n: nVal !== null && nVal >= 0 ? nVal : null,
    };

    const pvArr = Array.isArray(rec.pv) ? rec.pv : [];
    const dyn = row as Record<string, number | null>;
    for (let idx = 1; idx <= 4; idx++) {
      const pv = pvArr[idx - 1];
      const pObj =
        pv && typeof pv === "object" ? (pv as Record<string, unknown>) : null;
      dyn[`pv${idx}_p_avg_w`] = pObj ? toReal(pObj.p_avg) : null;
      dyn[`pv${idx}_p_min_w`] = pObj ? toInt(pObj.p_min) : null;
      dyn[`pv${idx}_p_max_w`] = pObj ? toInt(pObj.p_max) : null;
      dyn[`pv${idx}_v`] = pObj ? toReal(pObj.v) : null;
      dyn[`pv${idx}_i`] = pObj ? toReal(pObj.i) : null;
    }

    const sys =
      rec.sys && typeof rec.sys === "object"
        ? (rec.sys as Record<string, unknown>)
        : {};
    row.solar_w = toReal(sys.solar_w);
    row.grid_w = toReal(sys.grid_w);
    row.load_w = toReal(sys.load_w);
    row.batt_w = toReal(sys.batt_w);
    row.pcs_w = toReal(sys.pcs_w);
    row.soc = toInt(sys.soc);
    row.mode = toInt(sys.mode);
    row.solar_day_kwh = toReal(sys.solar_day_kwh);
    row.buy_day_kwh = toReal(sys.buy_day_kwh);
    row.load_day_kwh = toReal(sys.load_day_kwh);

    const bms =
      rec.bms && typeof rec.bms === "object"
        ? (rec.bms as Record<string, unknown>)
        : {};
    row.pack_v = toReal(bms.pack_v);
    row.cell_max_mv = toInt(bms.cell_max_mv);
    row.cell_min_mv = toInt(bms.cell_min_mv);
    row.cell_avg_mv = toInt(bms.cell_avg_mv);
    row.temp_max_c = toInt(bms.temp_max_c);
    row.temp_min_c = toInt(bms.temp_min_c);
    row.temp_avg_c = toReal(bms.temp_avg_c);

    byTs.set(rawTs, row);
  }

  return Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
}

function parseGatewaySnapshot(
  raw: unknown,
  prevSnapTs: number | null,
): { ts: number; cellsJson: string; tempsJson: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.time_valid !== true) return null;
  const gwNow = toInt(obj.now);
  const slow =
    obj.slow && typeof obj.slow === "object"
      ? (obj.slow as Record<string, unknown>)
      : null;
  if (!slow || gwNow === null) return null;
  const ageS = toInt(slow.age_s);
  if (ageS === null || ageS < 0 || ageS > SNAPSHOT_MAX_AGE_SEC) return null;
  if (!Array.isArray(slow.cells_mv) || slow.cells_mv.length === 0) return null;

  const cellsMv = slow.cells_mv
    .map((v) => toInt(v))
    .filter((v): v is number => v !== null);
  if (cellsMv.length === 0) return null;

  const snapTs = Math.floor((gwNow - ageS) / 60) * 60;
  if (prevSnapTs !== null && snapTs <= prevSnapTs) return null;

  let tempsJson: string | null = null;
  if (Array.isArray(slow.temps_c) && slow.temps_c.length > 0) {
    const tempsC = slow.temps_c
      .map((v) => toInt(v))
      .filter((v): v is number => v !== null);
    if (tempsC.length > 0) {
      tempsJson = JSON.stringify(tempsC);
    }
  }
  return {
    ts: snapTs,
    cellsJson: JSON.stringify(cellsMv),
    tempsJson,
  };
}

async function buildDailyUpsertStmts(
  db: D1Database,
  minutes: ParsedMinuteRow[],
  tzOffsetMin: number,
): Promise<D1PreparedStatement[]> {
  if (minutes.length === 0) return [];
  const tzSec = tzOffsetMin * 60;
  const byDate = new Map<string, ParsedMinuteRow[]>();
  for (const m of minutes) {
    const jstDate = new Date((m.ts + tzSec) * 1000).toISOString().slice(0, 10);
    const list = byDate.get(jstDate) ?? [];
    list.push(m);
    byDate.set(jstDate, list);
  }

  const dates = Array.from(byDate.keys()).sort();
  const placeholders = dates.map(() => "?").join(", ");
  const existingRes = await db
    .prepare(
      `SELECT ${DAILY_COLS.join(", ")} FROM daily_summary WHERE jst_date IN (${placeholders})`,
    )
    .bind(...dates)
    .all<DailySummaryRow>();

  const existingByDate = new Map<string, DailySummaryRow>();
  for (const r of existingRes.results || []) {
    existingByDate.set(r.jst_date, r);
  }

  const stmts: D1PreparedStatement[] = [];
  for (const jstDate of dates) {
    const dayMins = byDate.get(jstDate) ?? [];
    const cur = existingByDate.get(jstDate);
    let lastTs = cur?.last_ts ?? -1;
    let samples = cur?.samples ?? 0;
    let solarKwh = cur?.solar_kwh ?? 0;
    let sellKwh = cur?.sell_kwh ?? 0;
    let buyKwh = cur?.buy_kwh ?? 0;
    let loadKwh = cur?.load_kwh ?? 0;
    let pv1Kwh = cur?.pv1_kwh ?? 0;
    let pv2Kwh = cur?.pv2_kwh ?? 0;
    let pv3Kwh = cur?.pv3_kwh ?? 0;
    let pv4Kwh = cur?.pv4_kwh ?? 0;
    let updated = false;

    for (const m of dayMins) {
      if (m.ts <= lastTs) continue;
      updated = true;
      lastTs = m.ts;
      samples += 1;

      if (m.solar_day_kwh !== null && m.solar_day_kwh !== undefined) {
        solarKwh = Math.max(solarKwh, m.solar_day_kwh);
      } else if (m.solar_w && m.solar_w > 0) {
        solarKwh += m.solar_w / 60000;
      }

      if (m.buy_day_kwh !== null && m.buy_day_kwh !== undefined) {
        buyKwh = Math.max(buyKwh, m.buy_day_kwh);
      } else if (m.grid_w && m.grid_w > 0) {
        buyKwh += m.grid_w / 60000;
      }

      if (m.load_day_kwh !== null && m.load_day_kwh !== undefined) {
        loadKwh = Math.max(loadKwh, m.load_day_kwh);
      } else if (m.load_w && m.load_w > 0) {
        loadKwh += m.load_w / 60000;
      }

      if (m.grid_w && m.grid_w < 0) sellKwh += -m.grid_w / 60000;
      if (m.pv1_p_avg_w && m.pv1_p_avg_w > 0) pv1Kwh += m.pv1_p_avg_w / 60000;
      if (m.pv2_p_avg_w && m.pv2_p_avg_w > 0) pv2Kwh += m.pv2_p_avg_w / 60000;
      if (m.pv3_p_avg_w && m.pv3_p_avg_w > 0) pv3Kwh += m.pv3_p_avg_w / 60000;
      if (m.pv4_p_avg_w && m.pv4_p_avg_w > 0) pv4Kwh += m.pv4_p_avg_w / 60000;
    }

    if (!updated) continue;
    stmts.push(
      db
        .prepare(UPSERT_DAILY_SQL)
        .bind(
          jstDate,
          round4(solarKwh),
          round4(sellKwh),
          round4(buyKwh),
          round4(loadKwh),
          round4(pv1Kwh),
          round4(pv2Kwh),
          round4(pv3Kwh),
          round4(pv4Kwh),
          samples,
          lastTs,
        ),
    );
  }
  return stmts;
}

/**
 * Cron Trigger (毎分) により Workers VPC 経由でゲートウェイから直接データを取得して D1 へ保存する。
 * 無料プラン上限 (50クエリ/実行・CPU 10ms) に収まるよう、1回の取得は最大30件に制限する。
 */
async function handleScheduledIngest(
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  if (!env.EP_GATEWAY) {
    console.error("EP_GATEWAY VPC binding is not configured");
    return;
  }

  const cfg = await resolveSiteConfig(env);
  const nowSec = Math.floor(Date.now() / 1000);
  const { maxMinuteTs, maxSnapTs } = await queryIngestWatermarks(env.DB);

  let parsedMinutes: ParsedMinuteRow[] = [];
  try {
    const minutesQuery =
      `/api/minutes?limit=${GATEWAY_MINUTES_LIMIT}` +
      (maxMinuteTs !== null ? `&since=${maxMinuteTs}` : "");
    const rawMinutes = await fetchGatewayJson(
      env.EP_GATEWAY,
      minutesQuery,
      env.GW_TOKEN,
    );
    parsedMinutes = parseGatewayMinutes(rawMinutes, maxMinuteTs, nowSec);
  } catch (err) {
    console.error("Scheduled /api/minutes fetch failed:", err);
  }

  if (parsedMinutes.length > 0) {
    const weather = await fetchWeather(cfg.latitude, cfg.longitude, 300);
    if (weather) {
      for (const m of parsedMinutes) {
        m.weather_code = weather.code;
        m.outdoor_temp_c = weather.tempC;
      }
    }
  }

  let snapshot: { ts: number; cellsJson: string; tempsJson: string | null } | null =
    null;
  if (maxSnapTs === null || nowSec - maxSnapTs >= SNAPSHOT_INTERVAL_SEC - 15) {
    try {
      const rawLatest = await fetchGatewayJson(
        env.EP_GATEWAY,
        "/api/latest?cells=1",
        env.GW_TOKEN,
      );
      snapshot = parseGatewaySnapshot(rawLatest, maxSnapTs);
    } catch (err) {
      console.error("Scheduled /api/latest fetch failed:", err);
    }
  }

  if (parsedMinutes.length === 0 && !snapshot) {
    return;
  }

  const stmts: D1PreparedStatement[] = [];
  for (const row of parsedMinutes) {
    const values = MINUTE_COLS.map((col) => row[col] ?? null);
    stmts.push(env.DB.prepare(UPSERT_MINUTE_SQL).bind(...values));
  }
  if (snapshot) {
    stmts.push(
      env.DB.prepare(UPSERT_SNAPSHOT_SQL).bind(
        snapshot.ts,
        snapshot.cellsJson,
        snapshot.tempsJson,
      ),
    );
  }
  const dailyStmts = await buildDailyUpsertStmts(
    env.DB,
    parsedMinutes,
    cfg.timezoneOffsetMinutes,
  );
  stmts.push(...dailyStmts);

  await execBatched(env.DB, stmts);

  if (parsedMinutes.length > 0 || dailyStmts.length > 0) {
    const siteOrigin = (env.SOLAR_SITE_ORIGIN || "").trim();
    if (siteOrigin) {
      purgeDashboardCache(siteOrigin, ctx);
    }
  }
}

/**
 * /api/dashboard を Cache API で短時間キャッシュする。
 * データ更新は毎分1回なので、閲覧者やタブの数に関係なく D1 へのアクセスは最大で約1分に1回になる。
 */
async function handleDashboardCached(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}/api/dashboard`, { method: "GET" });
  // Cache API は独自ドメインでのみ有効 (workers.dev やローカル開発では素通りする)
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches
    ?.default;

  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const resp = new Response(hit.body, hit);
      resp.headers.set("cache-control", "no-store");
      resp.headers.set("x-dashboard-cache", "HIT");
      return resp;
    }
  }

  const { body, ttlSec } = await buildDashboard(env);
  const json = JSON.stringify(body);
  if (cache) {
    // Cache API に保存するコピーには max-age を設定し、確実にエッジで ttlSec 秒保持させる
    const cacheResp = new Response(json, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${ttlSec}`,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, cacheResp));
  }
  return new Response(json, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-dashboard-cache": "MISS",
    },
  });
}

async function queryDashboardRows(env: Env) {
  const stmts = [
    env.DB.prepare("SELECT * FROM minute_samples ORDER BY ts DESC LIMIT 1"),
    env.DB.prepare("SELECT * FROM bms_snapshots ORDER BY ts DESC LIMIT 1"),
    env.DB.prepare(
      "SELECT jst_date, solar_kwh, sell_kwh, pv1_kwh, pv2_kwh, pv3_kwh, pv4_kwh FROM daily_summary",
    ),
  ];
  try {
    return await env.DB.batch<Record<string, unknown>>(stmts);
  } catch (err) {
    // 初回デプロイ直後など daily_summary 未作成時のみスキーマ初期化して再試行する
    if (err instanceof Error && /no such table/i.test(err.message)) {
      await ensureSchema(env.DB);
      return await env.DB.batch<Record<string, unknown>>(stmts);
    }
    throw err;
  }
}

async function buildDashboard(
  env: Env,
): Promise<{ body: Record<string, unknown>; ttlSec: number }> {
  const cfg = await resolveSiteConfig(env);

  // D1 の読み取りは「最新の1分値1行」「最新のBMS 1行」「日別サマリー(1日1行)」だけ
  const [latestResult, snapResult, dailyResult] = await queryDashboardRows(env);
  const latest =
    (latestResult.results?.[0] as Record<string, number | null> | undefined) ??
    null;
  const latestSnap =
    (snapResult.results?.[0] as
      | { ts: number; cells_json: string | null; temps_json: string | null }
      | undefined) ?? null;
  const dailyRows = (dailyResult.results || []) as unknown as DailySummaryRow[];

  const refTs =
    typeof latest?.ts === "number" ? latest.ts : Math.floor(Date.now() / 1000);
  const tzSec = (cfg.timezoneOffsetMinutes ?? 540) * 60;
  const nowSec = Math.floor(Date.now() / 1000);
  const gatewayOnline = Boolean(
    latest && typeof latest.ts === "number" && nowSec - latest.ts <= 240,
  );

  const jstDate = new Date((refTs + tzSec) * 1000);
  const jstYear = jstDate.getUTCFullYear();
  const todayJst = jstDate.toISOString().slice(0, 10);
  const round2 = (v: number) => Math.round(v * 100) / 100;

  // 当日の売電電力量 (kWh) と PV1〜4別の1日発電量 (kWh/d)
  const today = dailyRows.find((d) => d.jst_date === todayJst);
  const sellDayKwhFromSeries = round2(Math.max(0, today?.sell_kwh ?? 0));
  const pvDayKwh = {
    pv1: round2(Math.max(0, today?.pv1_kwh ?? 0)),
    pv2: round2(Math.max(0, today?.pv2_kwh ?? 0)),
    pv3: round2(Math.max(0, today?.pv3_kwh ?? 0)),
    pv4: round2(Math.max(0, today?.pv4_kwh ?? 0)),
  };

  // 当年(JST)の月別実績発電量 (kWh) と、全期間の投資回収実績 (自家消費節約額 + 売電収益)
  const monthlyActualKwh: Record<number, number> = {};
  let totalSolarKwh = 0;
  let totalSellKwh = 0;
  let totalBenefitYen = 0;
  let activeDays = 0;
  let firstDate: string | null = null;
  const byYearMonth: Record<
    string,
    { solarKwh: number; sellKwh: number; benefitYen: number; days: number }
  > = {};

  const sellStartYm = cfg.sellStartDate.slice(0, 7);
  for (const d of dailyRows) {
    if (!d.jst_date) continue;
    const ym = d.jst_date.slice(0, 7);
    const sKwh = Math.max(0, d.solar_kwh ?? 0);
    const eKwh = Math.max(0, d.sell_kwh ?? 0);

    if (Number(d.jst_date.slice(0, 4)) === jstYear) {
      const month = Number(d.jst_date.slice(5, 7));
      monthlyActualKwh[month] = (monthlyActualKwh[month] ?? 0) + sKwh;
    }

    const selfKwh = Math.max(0, sKwh - eKwh);
    let sellPriceForDay = 0;
    if (d.jst_date >= cfg.sellStartDate) {
      const opYear = getOperationYearForYm(sellStartYm, ym);
      sellPriceForDay = getSellPriceForYear(
        cfg.sellPriceSchedule,
        opYear,
        cfg.sellPriceYenPerKwh,
      );
    }
    const benefit = selfKwh * cfg.buyPriceYenPerKwh + eKwh * sellPriceForDay;
    totalSolarKwh += sKwh;
    totalSellKwh += eKwh;
    totalBenefitYen += benefit;
    activeDays += 1;
    if (!firstDate || d.jst_date < firstDate) firstDate = d.jst_date;
    const cur = byYearMonth[ym] || {
      solarKwh: 0,
      sellKwh: 0,
      benefitYen: 0,
      days: 0,
    };
    cur.solarKwh = Math.round((cur.solarKwh + sKwh) * 100) / 100;
    cur.sellKwh = Math.round((cur.sellKwh + eKwh) * 100) / 100;
    cur.benefitYen = Math.round(cur.benefitYen + benefit);
    cur.days += 1;
    byYearMonth[ym] = cur;
  }
  for (const m of Object.keys(monthlyActualKwh)) {
    const k = Number(m);
    monthlyActualKwh[k] = Math.round(monthlyActualKwh[k] * 10) / 10;
  }

  const payback = {
    targetYen: cfg.paybackTargetYen,
    initialCostYen: cfg.initialCostYen,
    subsidyYen: cfg.subsidyYen,
    sellPriceSchedule: cfg.sellPriceSchedule,
    startYm: cfg.startYm,
    sellStartDate: cfg.sellStartDate,
    selfConsumeRatio: cfg.selfConsumeRatio,
    totalSolarKwh: Math.round(totalSolarKwh * 10) / 10,
    totalSellKwh: Math.round(totalSellKwh * 10) / 10,
    totalBenefitYen: Math.round(totalBenefitYen),
    activeDays,
    firstDate,
    byYearMonth,
  };

  // 次の1分値が届く頃までキャッシュする (10〜60秒)
  const ttlSec =
    latest && typeof latest.ts === "number"
      ? Math.max(
          DASHBOARD_CACHE_MIN_SEC,
          Math.min(
            DASHBOARD_CACHE_MAX_SEC,
            latest.ts + NEXT_DATA_ARRIVAL_SEC - nowSec,
          ),
        )
      : DASHBOARD_CACHE_MIN_SEC;

  const sun = computeSunTimes(
    refTs,
    cfg.latitude,
    cfg.longitude,
    cfg.timezoneOffsetMinutes,
  );

  // DB(minute_samples)に1分ごとの天気・気温が記録されていればそれを優先し、未記録時のみOpen-Meteoから取得
  let weather: {
    code: number;
    condition: string;
    tempC: number | null;
    text: string;
  } | null = null;
  if (
    latest &&
    (typeof latest.weather_code === "number" ||
      typeof latest.outdoor_temp_c === "number")
  ) {
    const code =
      typeof latest.weather_code === "number" ? latest.weather_code : 0;
    const cond = WMO_LABELS[code] || "CLEAR";
    const temp =
      typeof latest.outdoor_temp_c === "number"
        ? Math.round(latest.outdoor_temp_c * 10) / 10
        : null;
    weather = {
      code,
      condition: cond,
      tempC: temp,
      text: temp !== null ? `${cond} ${Math.round(temp)}°C` : cond,
    };
  } else {
    weather = await fetchWeather(cfg.latitude, cfg.longitude);
  }

  const body = {
    hasData: Boolean(latest),
    gatewayOnline,
    config: cfg,
    sun,
    weather,
    latest: latest || null,
    sellDayKwhComputed: sellDayKwhFromSeries,
    pvDayKwh,
    monthlyActualKwh,
    payback,
    snapshot: latestSnap
      ? {
          ts: latestSnap.ts,
          cells_mv: safeJsonArray(latestSnap.cells_json),
          temps_c: safeJsonArray(latestSnap.temps_json),
        }
      : null,
  };
  return { body, ttlSec };
}

function safeJsonArray(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 設置場所の緯度・経度・日付から日の出 / 南中 / 日の入り時刻 (分単位 0..1439 と "HH:MM") を計算する (NOAA式)
 */
function computeSunTimes(
  epochSec: number,
  lat: number,
  lon: number,
  tzOffsetMin: number,
): {
  sunriseMin: number;
  noonMin: number;
  sunsetMin: number;
  sunrise: string;
  noon: string;
  sunset: string;
} {
  const localMs = (epochSec + tzOffsetMin * 60) * 1000;
  const d = new Date(localMs);
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((localMs - startOfYear) / 86400000) + 1;

  const rad = Math.PI / 180;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const cosHa =
    Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) -
    Math.tan(lat * rad) * Math.tan(decl);
  const clamped = Math.max(-1, Math.min(1, cosHa));
  const haDeg = Math.acos(clamped) / rad;

  const noonMin = Math.round(720 - 4 * lon - eqTime + tzOffsetMin);
  const sunriseMin = Math.round(noonMin - haDeg * 4);
  const sunsetMin = Math.round(noonMin + haDeg * 4);

  const fmt = (m: number) => {
    const norm = ((m % 1440) + 1440) % 1440;
    const hh = String(Math.floor(norm / 60)).padStart(2, "0");
    const mm = String(norm % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  return {
    sunriseMin,
    noonMin,
    sunsetMin,
    sunrise: fmt(sunriseMin),
    noon: fmt(noonMin),
    sunset: fmt(sunsetMin),
  };
}

const WMO_LABELS: Record<number, string> = {
  0: "CLEAR",
  1: "MAINLY CLEAR",
  2: "PARTLY CLOUDY",
  3: "CLOUDY",
  45: "FOG",
  48: "FOG",
  51: "DRIZZLE",
  53: "DRIZZLE",
  55: "DRIZZLE",
  61: "RAIN",
  63: "RAIN",
  65: "HEAVY RAIN",
  71: "SNOW",
  73: "SNOW",
  75: "SNOW",
  80: "SHOWERS",
  81: "SHOWERS",
  82: "SHOWERS",
  95: "THUNDER",
};

async function fetchWeather(
  lat: number,
  lon: number,
  cacheTtl = 60,
): Promise<{
  code: number;
  condition: string;
  tempC: number | null;
  text: string;
} | null> {
  const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code&timezone=Asia%2FTokyo`;
  try {
    const resp = await fetch(apiUrl, {
      cf: { cacheTtl, cacheEverything: true },
      signal: AbortSignal.timeout(2500),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
    };
    const code = data.current?.weather_code ?? 0;
    const temp = data.current?.temperature_2m;
    const cond = WMO_LABELS[code] || "CLEAR";
    const rounded = typeof temp === "number" ? Math.round(temp * 10) / 10 : null;
    return {
      code,
      condition: cond,
      tempC: rounded,
      text: rounded !== null ? `${cond} ${Math.round(rounded)}°C` : cond,
    };
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
