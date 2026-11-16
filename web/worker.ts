export interface SiteConfig {
  location: string;
  buyPriceYenPerKwh: number;
  sellPriceYenPerKwh: number;
  refreshIntervalSec: number;
  batteryCapacityKwh: number;
  latitude: number;
  longitude: number;
  timezoneOffsetMinutes: number;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  // 環境変数 (未設定時は下記の初期値を使用)
  SOLAR_LOCATION?: string;
  SOLAR_LATITUDE?: string;
  SOLAR_LONGITUDE?: string;
  SOLAR_BUY_PRICE_YEN?: string;
  SOLAR_SELL_PRICE_YEN?: string;
  SOLAR_REFRESH_MINUTES?: string;
  SOLAR_REFRESH_SEC?: string;
  SOLAR_BATTERY_CAPACITY_KWH?: string;
  // 取り込み認証 (平文シークレットまたはSHA-256ハッシュ)
  INGEST_TOKEN?: string;
  INGEST_TOKEN_SHA256?: string;
}

// 初期値
const DEFAULT_LOCATION = "東京都中央区";
const DEFAULT_BUY_PRICE_YEN = 35;
const DEFAULT_SELL_PRICE_YEN = 24;
const DEFAULT_REFRESH_MINUTES = 1;
const DEFAULT_BATTERY_CAPACITY_KWH = 13.3;
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/dashboard" && request.method === "GET") {
      return handleDashboard(env);
    }
    if (url.pathname === "/api/ingest" && request.method === "POST") {
      return handleIngest(request, env);
    }
    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({ error: "Not Found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function resolveSiteConfig(env: Env): Promise<SiteConfig> {
  const location = (env.SOLAR_LOCATION || DEFAULT_LOCATION).trim() || DEFAULT_LOCATION;
  const buyPriceYenPerKwh = parsePositiveNumber(
    env.SOLAR_BUY_PRICE_YEN,
    DEFAULT_BUY_PRICE_YEN,
  );
  const sellPriceYenPerKwh = parsePositiveNumber(
    env.SOLAR_SELL_PRICE_YEN,
    DEFAULT_SELL_PRICE_YEN,
  );
  const batteryCapacityKwh = parsePositiveNumber(
    env.SOLAR_BATTERY_CAPACITY_KWH,
    DEFAULT_BATTERY_CAPACITY_KWH,
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
    refreshIntervalSec,
    batteryCapacityKwh,
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

async function handleIngest(request: Request, env: Env): Promise<Response> {
  if (!(await verifyIngestAuth(request, env))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: {
    minutes?: Record<string, unknown>[];
    snapshots?: Record<string, unknown>[];
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

  // D1 batch limit を考慮して100件ずつ実行
  const CHUNK_SIZE = 100;
  for (let i = 0; i < stmts.length; i += CHUNK_SIZE) {
    await env.DB.batch(stmts.slice(i, i + CHUNK_SIZE));
  }

  return jsonResponse({
    ok: true,
    minutes_upserted: minutes.length,
    snapshots_upserted: snapshots.length,
  });
}

async function handleDashboard(env: Env): Promise<Response> {
  await ensureSchema(env.DB);
  const cfg = await resolveSiteConfig(env);

  const latest = await env.DB.prepare(
    "SELECT * FROM minute_samples ORDER BY ts DESC LIMIT 1",
  ).first<Record<string, number | null>>();

  const latestSnap = await env.DB.prepare(
    "SELECT * FROM bms_snapshots ORDER BY ts DESC LIMIT 1",
  ).first<{ ts: number; cells_json: string | null; temps_json: string | null }>();

  const refTs =
    typeof latest?.ts === "number" ? latest.ts : Math.floor(Date.now() / 1000);
  const tzSec = (cfg.timezoneOffsetMinutes ?? 540) * 60;
  const dayStartUtc = Math.floor((refTs + tzSec) / 86400) * 86400 - tzSec;
  const dayEndUtc = dayStartUtc + 86400;

  const dayRowsResult = await env.DB.prepare(
    `SELECT ts, solar_w, grid_w, load_w, batt_w, soc,
            pv1_p_avg_w, pv2_p_avg_w, pv3_p_avg_w, pv4_p_avg_w,
            weather_code, outdoor_temp_c
     FROM minute_samples
     WHERE ts >= ? AND ts < ?
     ORDER BY ts ASC`,
  )
    .bind(dayStartUtc, dayEndUtc)
    .all<Record<string, number | null>>();

  const dayRows = dayRowsResult.results || [];

  // 売電電力量 (kWh) と PV1〜4別の1日発電量 (kWh/d) を1分値から積算
  let sellWh = 0;
  let pv1Wh = 0;
  let pv2Wh = 0;
  let pv3Wh = 0;
  let pv4Wh = 0;
  for (const r of dayRows) {
    const g = r.grid_w;
    if (typeof g === "number" && g < 0) {
      sellWh += -g / 60;
    }
    if (typeof r.pv1_p_avg_w === "number" && r.pv1_p_avg_w > 0) {
      pv1Wh += r.pv1_p_avg_w / 60;
    }
    if (typeof r.pv2_p_avg_w === "number" && r.pv2_p_avg_w > 0) {
      pv2Wh += r.pv2_p_avg_w / 60;
    }
    if (typeof r.pv3_p_avg_w === "number" && r.pv3_p_avg_w > 0) {
      pv3Wh += r.pv3_p_avg_w / 60;
    }
    if (typeof r.pv4_p_avg_w === "number" && r.pv4_p_avg_w > 0) {
      pv4Wh += r.pv4_p_avg_w / 60;
    }
  }
  const sellDayKwhFromSeries = Math.round((sellWh / 1000) * 100) / 100;
  const pvDayKwh = {
    pv1: Math.round((pv1Wh / 1000) * 100) / 100,
    pv2: Math.round((pv2Wh / 1000) * 100) / 100,
    pv3: Math.round((pv3Wh / 1000) * 100) / 100,
    pv4: Math.round((pv4Wh / 1000) * 100) / 100,
  };
  const nowSec = Math.floor(Date.now() / 1000);
  const gatewayOnline = Boolean(
    latest && typeof latest.ts === "number" && nowSec - latest.ts <= 240,
  );

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

  return jsonResponse({
    hasData: Boolean(latest),
    gatewayOnline,
    config: cfg,
    sun,
    weather,
    latest: latest || null,
    sellDayKwhComputed: sellDayKwhFromSeries,
    pvDayKwh,
    snapshot: latestSnap
      ? {
          ts: latestSnap.ts,
          cells_mv: safeJsonArray(latestSnap.cells_json),
          temps_c: safeJsonArray(latestSnap.temps_json),
        }
      : null,
    series: dayRows,
  });
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
): Promise<{
  code: number;
  condition: string;
  tempC: number | null;
  text: string;
} | null> {
  const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code&timezone=Asia%2FTokyo`;
  try {
    const resp = await fetch(apiUrl, {
      cf: { cacheTtl: 60, cacheEverything: true },
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
