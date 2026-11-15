export interface SiteConfig {
  buyPriceYenPerKwh: number;
  sellPriceYenPerKwh: number;
  batteryCapacityKwh: number;
  latitude: number;
  longitude: number;
  timezoneOffsetMinutes: number;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_CONFIG: SiteConfig;
  INGEST_TOKEN?: string;
}

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
    temp_max_c INTEGER, temp_min_c INTEGER, temp_avg_c REAL
  )`,
  `CREATE TABLE IF NOT EXISTS bms_snapshots (
    ts INTEGER PRIMARY KEY, cells_json TEXT, temps_json TEXT
  )`,
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
  schemaInitialized = true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/dashboard" && request.method === "GET") {
      return handleDashboard(url, env);
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

async function handleIngest(request: Request, env: Env): Promise<Response> {
  const expected = (env.INGEST_TOKEN || "").trim();
  if (!expected) {
    return jsonResponse(
      { error: "INGEST_TOKEN secret is not configured on this Worker" },
      503,
    );
  }
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice(7).trim()
    : (request.headers.get("x-ingest-token") || "").trim();

  if (!token || token !== expected) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { minutes?: Record<string, unknown>[]; snapshots?: Record<string, unknown>[] };
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
    const cellsJson = typeof snap.cells_json === "string" ? snap.cells_json : null;
    const tempsJson = typeof snap.temps_json === "string" ? snap.temps_json : null;
    stmts.push(env.DB.prepare(UPSERT_SNAPSHOT_SQL).bind(snap.ts, cellsJson, tempsJson));
  }

  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }

  return jsonResponse({
    ok: true,
    minutes_upserted: minutes.length,
    snapshots_upserted: snapshots.length,
  });
}

async function handleDashboard(url: URL, env: Env): Promise<Response> {
  await ensureSchema(env.DB);
  const cfg: SiteConfig = {
    buyPriceYenPerKwh: 31,
    sellPriceYenPerKwh: 16,
    batteryCapacityKwh: 13.8,
    latitude: 35.6812,
    longitude: 139.7671,
    timezoneOffsetMinutes: 540,
    ...(env.SITE_CONFIG || {}),
  };

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
            pv1_p_avg_w, pv2_p_avg_w, pv3_p_avg_w, pv4_p_avg_w
     FROM minute_samples
     WHERE ts >= ? AND ts < ?
     ORDER BY ts ASC`,
  )
    .bind(dayStartUtc, dayEndUtc)
    .all<Record<string, number | null>>();

  const dayRows = dayRowsResult.results || [];

  // 売電電力量 (kWh) を1分値の grid_w < 0 から積分算出
  let sellWh = 0;
  for (const r of dayRows) {
    const g = r.grid_w;
    if (typeof g === "number" && g < 0) {
      sellWh += -g / 60;
    }
  }
  const sellDayKwhFromSeries = Math.round((sellWh / 1000) * 100) / 100;

  const sun = computeSunTimes(
    refTs,
    cfg.latitude,
    cfg.longitude,
    cfg.timezoneOffsetMinutes,
  );
  const weather = await fetchWeather(cfg.latitude, cfg.longitude);

  return jsonResponse({
    hasData: Boolean(latest),
    config: cfg,
    sun,
    weather,
    latest: latest || null,
    sellDayKwhComputed: sellDayKwhFromSeries,
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
 * 緯度・経度・日付から日の出 / 南中 / 日の入り時刻 (分単位 0..1439 と "HH:MM") を計算する (NOAA式)
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
): Promise<{ condition: string; tempC: number | null; text: string } | null> {
  const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code`;
  try {
    const resp = await fetch(apiUrl, {
      cf: { cacheTtl: 900, cacheEverything: true },
      signal: AbortSignal.timeout(2500),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
    };
    const code = data.current?.weather_code ?? 0;
    const temp = data.current?.temperature_2m;
    const cond = WMO_LABELS[code] || "CLEAR";
    const rounded = typeof temp === "number" ? Math.round(temp) : null;
    return {
      condition: cond,
      tempC: rounded,
      text: rounded !== null ? `${cond} ${rounded}°C` : cond,
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
