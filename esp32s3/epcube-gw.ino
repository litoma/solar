#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <time.h>
#include <math.h>
#include <stdarg.h>
#include <atomic>
#include <BLE.h>

#define FW_VERSION "1.3.0"

// ---------- 設定 (Wi-Fi 認証情報は secrets.example.h を secrets.h にコピーして設定) ----------
#if __has_include("secrets.h")
#include "secrets.h"
#else
static const char* WIFI_SSID = "YOUR_SSID";
static const char* WIFI_PASS = "YOUR_PASSWORD";
static const char* API_TOKEN = "";            // 空なら認証なし。設定すると X-Api-Token ヘッダが必須になる
#endif
static const char* HOST_NAME = "epcube-gw";   // mDNS名 (epcube-gw.local)

static const uint32_t WIFI_REINIT_MS         = 60000UL;   // Wi-Fi 切断が60秒続いたら disconnect + begin で再初期化
static const uint32_t WIFI_DISCONNECT_RESTART_MS = 900000UL; // Wi-Fi 切断が15分連続したら再起動

static const uint32_t FAST_MS               = 10000;   // 高速サンプリング周期
static const uint32_t SLOW_MS               = 60000;   // 低速(BMS)サンプリング周期 (Worker側の上限120秒に収まる周期を維持)
static const uint32_t SLOW_START_OFFSET_MS  = 5000;    // fast と同じ瞬間に重ならないよう 5秒ずらして開始
static const uint32_t RESP_TIMEOUT_MS       = 800;     // BLE応答待ち
static const uint32_t GAP_MS                = 100;     // BLEリクエスト最小間隔
static const int      RING_MAX              = 720;     // 保持する1分集計の最大件数 (12時間分)
static const int      RING_MIN              = 60;      // メモリ不足時に縮小する下限 (1時間分)
static const uint32_t BLE_TASK_STACK        = 8192;    // BLEタスク用スタックサイズ(バイト)
static const uint32_t MIN_HEAP_AFTER_RING   = 50000;   // バッファ＋BLEタスク確保後に最低限残す空きヒープ(バイト)
static const int      MINUTES_DEFAULT_LIMIT = 60;      // /api/minutes で limit 省略時の件数
static const uint32_t BMS_MAX_AGE_MS        = 120000;  // 集計に使うBMS値の最大経過時間
static const int      FAIL_RECONNECT        = 6;       // 高速サンプルが連続失敗したらBLE再接続
static const uint32_t NO_DATA_RESTART_MS    = 600000;  // 10分間1件も取れなければ再起動

// ---------- BLE (EP CUBE) ----------
static const BLEUUID serviceUUID("ee6d7170-88c6-11e8-b444-060400ef5315");
static const BLEUUID charTxUUID("ee6d7171-88c6-11e8-b444-060400ef5315");  // 書き込み用
static const BLEUUID charRxUUID("ee6d7172-88c6-11e8-b444-060400ef5315");  // 通知用
static const uint8_t MB_SLAVE_ID = 0x64;
static const uint8_t MB_FUNC     = 0x03;   // 読み取り専用。変更しないこと

// ---------- レジスタ ----------
static const uint16_t REG_PV     = 0x501B;  // 12個: 電圧1-4(0.1V) 電流1-4(0.1A) 電力1-4(W)
static const uint16_t REG_SYS1   = 0x0510;  // 16個: [3]=運転モード [5]=SOC [15]=系統電力(10W, 符号付き)
static const uint16_t REG_SYS2   = 0x0540;  // 16個: [2]=負荷(10W) [3]=太陽光(10W) [4]=本日買電 [6]=本日発電 [10]=本日負荷 (0.01kWh)
static const uint16_t REG_SYS3   = 0x0580;  // 16個: [2]=蓄電池電力(W, 符号付き) [6]=PCS出力(W, 符号付き)
static const uint16_t REG_PACK_V = 0x5027;  // 1個: パック電圧(0.1V)
static const uint16_t REG_CELLS  = 0x5050;  // 48個(16個x3): セル電圧(mV)
static const uint16_t REG_TEMPS  = 0x50D0;  // 16個: 温度(℃, 符号付き)
static const int N_CELLS = 48;
static const int N_TEMPS = 16;

// ---------- データ構造 ----------
struct FastSample {
  uint32_t atMs;
  time_t epoch;
  float pvV[4], pvI[4];
  uint16_t pvP[4];
  int solarW, gridW, loadW, battW, pcsW, soc, mode;
  float solarDay, buyDay, loadDay;
};

struct SlowSample {
  uint32_t atMs;
  time_t epoch;
  bool ok;
  float packV;
  uint16_t cell[N_CELLS];
  int16_t temp[N_TEMPS];
  uint16_t cellMax, cellMin, cellAvg;
  int16_t tMax, tMin;
  float tAvg;
};

struct MinuteRec {            // 確定した1分集計 (76バイトに圧縮。出力時に元の単位へ戻す)
  uint32_t ts;                // 分の開始時刻 (UTC epoch秒, 60の倍数)
  uint16_t pvPAvg10[4];       // PV電力の平均 (0.1W単位)
  uint16_t pvPMin[4], pvPMax[4];  // PV電力の最小・最大 (W)
  uint16_t pvV10[4];          // PV電圧の平均 (0.1V単位)
  uint16_t pvI100[4];         // PV電流の平均 (0.01A単位)
  int16_t solarW, gridW, loadW, battW, pcsW;   // 平均電力 (W)
  uint16_t solarDay100, buyDay100, loadDay100; // 日積算 (0.01kWh単位)
  uint16_t packV10;           // パック電圧 (0.1V単位)
  uint16_t cellMax, cellMin, cellAvg;          // セル電圧 (mV)
  int16_t tAvg10;             // 温度の平均 (0.1℃単位)
  int8_t tMax, tMin;          // 温度の最大・最小 (℃)
  uint8_t n;                  // 集計に使った高速サンプル数
  uint8_t soc, mode;
  uint8_t bmsOk;
};

struct MinuteAcc {            // 集計中の1分
  bool active;
  uint32_t minute;
  uint16_t n;
  float pvPSum[4];
  uint16_t pvPMin[4], pvPMax[4];
  float pvVSum[4], pvISum[4];
  float solarSum, gridSum, loadSum, battSum, pcsSum;
  int soc, mode;
  float solarDay, buyDay, loadDay;
};

// ---------- 状態 ----------
static WebServer server(80);
static bool httpStarted = false;

static BLEClient bleClient;
static BLEAdvertisedDevice targetDevice;
static BLERemoteCharacteristic txChar;
static BLERemoteCharacteristic rxChar;
static std::atomic<bool> doConnect{false};
static std::atomic<bool> connecting{false};
static std::atomic<bool> connected{false};

// 同期プリミティブ
static portMUX_TYPE rxMux = portMUX_INITIALIZER_UNLOCKED;
static SemaphoreHandle_t bleMutex  = nullptr;   // BLE トランザクション排他 (blePollTask と /api/regs)
static SemaphoreHandle_t rxSem     = nullptr;   // BLE 応答完了 / 切断通知
static SemaphoreHandle_t dataMutex = nullptr;   // 共有データ (gFast, gSlow, ring, stats, lastError)

static char rxBuf[768];
static size_t rxLen = 0;
static volatile uint8_t rxState = 255;   // 0=待機中, 1=正常応答, 2=例外応答, 3=切断, 255=アイドル
static volatile uint8_t rxExcCode = 0;
static uint16_t rxRegs[32];
static uint8_t expectedBytes = 0;

static FastSample gFast;
static SlowSample gSlow;
static bool gHaveFast = false;
static bool gHaveSlow = false;

static MinuteAcc acc;
static MinuteRec* ring = nullptr;   // 起動時にmallocで確保 (allocRing)
static int ringCap = 0;
static int ringCount = 0;
static int ringHead = 0;

static uint32_t nextFast = 0, nextSlow = 0, lastGoodMs = 0;
static uint32_t lastBleDoneMs = 0;
static int consecFail = 0;
static bool slowErrActive = false;
static uint32_t statFastOk = 0, statFastFail = 0, statSlowOk = 0, statSlowFail = 0;
static uint32_t statConnects = 0, statConnectFail = 0, statTimeouts = 0;
static char lastError[64] = "";

// ---------- ユーティリティ ----------
// ログ出力 (setup() 側で USB CDC 送信タイムアウトを設定して未接続時の長ブロックを防ぐ)
static void logPrintf(const char* fmt, ...) {
  char buf[256];
  va_list ap;
  va_start(ap, fmt);
  int len = vsnprintf(buf, sizeof(buf), fmt, ap);
  va_end(ap);
  if (len <= 0) return;
  size_t n = (len >= (int)sizeof(buf)) ? (sizeof(buf) - 1) : (size_t)len;
  Serial.write((const uint8_t*)buf, n);
}

// バッファへ安全にフォーマット追記 (切り詰め時も pos が cap を超えない)
static void appendFmt(char* buf, size_t cap, size_t& pos, const char* fmt, ...) {
  if (pos + 1 >= cap) return;
  va_list ap;
  va_start(ap, fmt);
  int w = vsnprintf(buf + pos, cap - pos, fmt, ap);
  va_end(ap);
  if (w > 0) {
    size_t adv = (size_t)w;
    pos = (pos + adv >= cap) ? (cap - 1) : (pos + adv);
  }
}

// JSON 文字列として安全にエスケープしながら追記
static void appendJsonEscaped(char* buf, size_t cap, size_t& pos, const char* s) {
  if (!s) return;
  for (; *s && pos + 2 < cap; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') {
      if (pos + 2 >= cap) break;
      buf[pos++] = '\\';
      buf[pos++] = (char)c;
    } else if (c < 0x20) {
      appendFmt(buf, cap, pos, "\\u%04x", (unsigned)c);
    } else {
      buf[pos++] = (char)c;
    }
  }
  buf[pos] = '\0';
}

static uint16_t mbCrc16(const uint8_t* data, size_t len) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int j = 0; j < 8; j++) crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : (crc >> 1);
  }
  return crc;
}

static int hv(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static uint8_t hex2(const char* p) {
  int a = hv(p[0]), b = hv(p[1]);
  return (a < 0 || b < 0) ? 0 : (uint8_t)((a << 4) | b);
}

static bool timeValid() { return time(nullptr) > 1700000000; }

// ---------- BLE受信 (rxMux 内から呼ぶため高速・非ブロッキングのみ) ----------
static void parseResponse() {
  const char* k = strstr(rxBuf, "\"RawModbus\":\"");
  if (!k) return;
  const char* s = k + 13;
  const char* e = strchr(s, '"');
  if (!e) return;
  size_t hl = (size_t)(e - s);
  if (hl < 6) return;

  if (hex2(s) != MB_SLAVE_ID) return;
  uint8_t func = hex2(s + 2);
  if (func == (uint8_t)(MB_FUNC | 0x80)) {   // 例外応答
    rxExcCode = hex2(s + 4);
    rxState = 2;
    return;
  }
  if (func != MB_FUNC) return;

  uint8_t bc = hex2(s + 4);
  if (bc != expectedBytes) return;
  size_t need = 6 + (size_t)bc * 2;
  if (hl < need) return;

  if (hl >= need + 4) {   // CRCが付いていれば検証
    uint8_t tmp[3 + 64];
    tmp[0] = MB_SLAVE_ID; tmp[1] = func; tmp[2] = bc;
    for (uint8_t i = 0; i < bc; i++) tmp[3 + i] = hex2(s + 6 + i * 2);
    uint16_t calc = mbCrc16(tmp, 3 + bc);
    uint16_t recv = (uint16_t)(hex2(s + need) | (hex2(s + need + 2) << 8));
    if (calc != recv) return;
  }

  for (uint8_t i = 0; i < bc / 2 && i < 32; i++) {
    rxRegs[i] = (uint16_t)((hex2(s + 6 + i * 4) << 8) | hex2(s + 8 + i * 4));
  }
  rxState = 1;
}

static void notifyCallback(BLERemoteCharacteristic& /*chr*/, const uint8_t* pData, size_t length, BLESubscription /*kind*/) {
  bool notifyDone = false;
  taskENTER_CRITICAL(&rxMux);
  if (rxState == 0) {
    for (size_t i = 0; i < length; i++) {
      if (pData[i] >= 0x20 && pData[i] <= 0x7E && rxLen < sizeof(rxBuf) - 1) {
        rxBuf[rxLen++] = (char)pData[i];
      }
    }
    rxBuf[rxLen] = 0;
    if (strchr(rxBuf, '}')) {
      parseResponse();
      rxLen = 0;
      rxBuf[0] = 0;
      notifyDone = (rxState != 0);
    } else if (rxLen >= sizeof(rxBuf) - 1) {
      rxLen = 0;
      rxBuf[0] = 0;
    }
  }
  taskEXIT_CRITICAL(&rxMux);

  if (notifyDone && rxSem) {
    xSemaphoreGive(rxSem);
  }
}

// ---------- レジスタ読み出し (ファンクション0x03のみ) ----------
static bool readRegs(uint16_t addr, uint8_t count, uint16_t* out, char* errOut, size_t errCap) {
  if (count < 1 || count > 32) return false;
  if (errOut && errCap > 0) errOut[0] = '\0';
  if (!bleMutex || !rxSem) return false;
  if (xSemaphoreTake(bleMutex, pdMS_TO_TICKS(5000)) != pdTRUE) {
    if (errOut && errCap > 0) snprintf(errOut, errCap, "ble busy");
    return false;
  }

  bool ok = false;
  bool timedOutAll = false;

  for (int attempt = 0; attempt < 2; attempt++) {
    // 次のコマンド送信前に最小間隔 GAP_MS を保証 (最終コマンド後には余計に待たない)
    if (lastBleDoneMs != 0) {
      uint32_t elapsed = millis() - lastBleDoneMs;
      if (elapsed < GAP_MS) {
        vTaskDelay(pdMS_TO_TICKS(GAP_MS - elapsed));
      }
    }

    if (!connected || !txChar) {
      if (errOut && errCap > 0) snprintf(errOut, errCap, "ble disconnected");
      break;
    }

    uint8_t f[8] = { MB_SLAVE_ID, MB_FUNC, (uint8_t)(addr >> 8), (uint8_t)(addr & 0xFF), 0x00, count, 0, 0 };
    uint16_t crc = mbCrc16(f, 6);
    f[6] = (uint8_t)(crc & 0xFF);
    f[7] = (uint8_t)(crc >> 8);

    char hex[17];
    for (int i = 0; i < 8; i++) snprintf(hex + i * 2, 3, "%02x", f[i]);
    char cmd[36];
    int cmdLen = snprintf(cmd, sizeof(cmd), "{\"RawModbus\":\"%s\"}", hex);

    taskENTER_CRITICAL(&rxMux);
    expectedBytes = (uint8_t)(count * 2);
    rxState = 0;
    rxExcCode = 0;
    rxLen = 0;
    rxBuf[0] = 0;
    taskEXIT_CRITICAL(&rxMux);

    // 以前のタイムアウト後に遅れて届いたセマフォ通知があれば破棄
    while (xSemaphoreTake(rxSem, 0) == pdTRUE) {}

    BTStatus wSt = txChar.writeValue((const uint8_t*)cmd, (size_t)cmdLen, false);
    if (!wSt) {
      taskENTER_CRITICAL(&rxMux);
      if (rxState == 0) rxState = 3;
      taskEXIT_CRITICAL(&rxMux);
    } else {
      // ビジーウェイト (delay(2)) をやめ、通知到達またはタイムアウトまでタスクをスリープ
      xSemaphoreTake(rxSem, pdMS_TO_TICKS(RESP_TIMEOUT_MS));
    }
    lastBleDoneMs = millis();

    uint8_t st;
    uint8_t exc;
    taskENTER_CRITICAL(&rxMux);
    st = rxState;
    exc = rxExcCode;
    if (st == 1) {
      memcpy(out, rxRegs, count * sizeof(uint16_t));
    }
    rxState = 255;   // 以降は待機外のため遅延パケットを無視
    taskEXIT_CRITICAL(&rxMux);

    if (st == 1) {
      ok = true;
      break;
    }
    if (st == 2) {
      if (errOut && errCap > 0) snprintf(errOut, errCap, "exception 0x%02X at 0x%04X", exc, addr);
      break;   // 例外は再試行しない
    }
    if (st == 3 || !connected) {
      if (errOut && errCap > 0) snprintf(errOut, errCap, "ble disconnected");
      break;
    }
    if (attempt == 1) {
      timedOutAll = true;
    }
  }

  xSemaphoreGive(bleMutex);

  if (!ok && timedOutAll) {
    if (dataMutex && xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      statTimeouts++;
      xSemaphoreGive(dataMutex);
    }
    if (errOut && errCap > 0) snprintf(errOut, errCap, "timeout at 0x%04X", addr);
  }
  return ok;
}

// ---------- 1分集計 ----------
static uint16_t clampU16(float v) {
  if (v < 0.0f) return 0;
  if (v > 65535.0f) return 65535;
  return (uint16_t)(v + 0.5f);
}

static int16_t clampI16(float v) {
  long r = lroundf(v);
  if (r < -32768) r = -32768;
  if (r > 32767) r = 32767;
  return (int16_t)r;
}

static int8_t clampI8(int v) {
  if (v < -128) return -128;
  if (v > 127) return 127;
  return (int8_t)v;
}

// 履歴バッファを確保する。空きヒープが足りなければ件数を半分ずつ減らす。
static void allocRing() {
  for (int cap = RING_MAX; cap >= RING_MIN; cap /= 2) {
    MinuteRec* p = (MinuteRec*)malloc((size_t)cap * sizeof(MinuteRec));
    if (!p) continue;
    if (ESP.getFreeHeap() < MIN_HEAP_AFTER_RING + BLE_TASK_STACK) {
      free(p);
      continue;
    }
    ring = p;
    ringCap = cap;
    logPrintf("履歴バッファ: %d件(%d分) %u バイト  空きヒープ %u バイト\n", cap, cap,
              (unsigned)((size_t)cap * sizeof(MinuteRec)), (unsigned)ESP.getFreeHeap());
    return;
  }
  ringCap = 0;
  logPrintf("履歴バッファを確保できませんでした (履歴なしで動作します)\n");
}

// 以下 pushRing / closeMinute / accumulate は dataMutex 保持中に呼ぶ
static void pushRingLocked(const MinuteRec& m) {
  if (ringCap <= 0) return;
  if (ringCount < ringCap) {
    ring[(ringHead + ringCount) % ringCap] = m;
    ringCount++;
  } else {
    ring[ringHead] = m;
    ringHead = (ringHead + 1) % ringCap;
  }
}

static void closeMinuteLocked() {
  if (!acc.active || acc.n == 0) { acc.active = false; return; }
  MinuteRec m;
  memset(&m, 0, sizeof(m));
  m.ts = acc.minute * 60;
  m.n = (acc.n > 255) ? 255 : (uint8_t)acc.n;
  float inv = 1.0f / (float)acc.n;
  for (int i = 0; i < 4; i++) {
    m.pvPAvg10[i] = clampU16(acc.pvPSum[i] * inv * 10.0f);
    m.pvPMin[i] = acc.pvPMin[i];
    m.pvPMax[i] = acc.pvPMax[i];
    m.pvV10[i] = clampU16(acc.pvVSum[i] * inv * 10.0f);
    m.pvI100[i] = clampU16(acc.pvISum[i] * inv * 100.0f);
  }
  m.solarW = clampI16(acc.solarSum * inv);
  m.gridW = clampI16(acc.gridSum * inv);
  m.loadW = clampI16(acc.loadSum * inv);
  m.battW = clampI16(acc.battSum * inv);
  m.pcsW = clampI16(acc.pcsSum * inv);
  m.soc = (uint8_t)acc.soc;
  m.mode = (uint8_t)acc.mode;
  m.solarDay100 = clampU16(acc.solarDay * 100.0f);
  m.buyDay100 = clampU16(acc.buyDay * 100.0f);
  m.loadDay100 = clampU16(acc.loadDay * 100.0f);

  if (gHaveSlow && gSlow.ok && (millis() - gSlow.atMs) < BMS_MAX_AGE_MS) {
    m.bmsOk = 1;
    m.packV10 = clampU16(gSlow.packV * 10.0f);
    m.cellMax = gSlow.cellMax;
    m.cellMin = gSlow.cellMin;
    m.cellAvg = gSlow.cellAvg;
    m.tMax = clampI8(gSlow.tMax);
    m.tMin = clampI8(gSlow.tMin);
    m.tAvg10 = clampI16(gSlow.tAvg * 10.0f);
  }
  pushRingLocked(m);
  acc.active = false;
}

static void accumulateLocked(const FastSample& f) {
  if (f.epoch < 1700000000) return;   // 時刻未同期のサンプルは集計しない
  uint32_t minute = (uint32_t)(f.epoch / 60);
  if (acc.active && acc.minute != minute) closeMinuteLocked();
  if (!acc.active) {
    memset(&acc, 0, sizeof(acc));
    acc.active = true;
    acc.minute = minute;
    for (int i = 0; i < 4; i++) { acc.pvPMin[i] = 0xFFFF; acc.pvPMax[i] = 0; }
  }
  acc.n++;
  for (int i = 0; i < 4; i++) {
    acc.pvPSum[i] += f.pvP[i];
    if (f.pvP[i] < acc.pvPMin[i]) acc.pvPMin[i] = f.pvP[i];
    if (f.pvP[i] > acc.pvPMax[i]) acc.pvPMax[i] = f.pvP[i];
    acc.pvVSum[i] += f.pvV[i];
    acc.pvISum[i] += f.pvI[i];
  }
  acc.solarSum += f.solarW;
  acc.gridSum += f.gridW;
  acc.loadSum += f.loadW;
  acc.battSum += f.battW;
  acc.pcsSum += f.pcsW;
  acc.soc = f.soc;
  acc.mode = f.mode;
  acc.solarDay = f.solarDay;
  acc.buyDay = f.buyDay;
  acc.loadDay = f.loadDay;
}

// ---------- サンプリング ----------
static void runFast() {
  uint16_t pv[12], s1[16], s2[16], s3[16];
  char err[64] = "";
  bool ok = readRegs(REG_PV, 12, pv, err, sizeof(err)) &&
            readRegs(REG_SYS1, 16, s1, err, sizeof(err)) &&
            readRegs(REG_SYS2, 16, s2, err, sizeof(err)) &&
            readRegs(REG_SYS3, 16, s3, err, sizeof(err));
  if (!ok) {
    if (xSemaphoreTake(dataMutex, portMAX_DELAY) == pdTRUE) {
      statFastFail++;
      consecFail++;
      snprintf(lastError, sizeof(lastError), "%s", err[0] ? err : "fast failed");
      xSemaphoreGive(dataMutex);
    }
    logPrintf("[fast] 失敗 (%s)\n", err);
    return;
  }

  FastSample f;
  memset(&f, 0, sizeof(f));
  f.atMs = millis();
  f.epoch = time(nullptr);
  for (int i = 0; i < 4; i++) {
    f.pvV[i] = pv[i] * 0.1f;
    f.pvI[i] = pv[4 + i] * 0.1f;
    f.pvP[i] = pv[8 + i];
  }
  f.mode = s1[3];
  f.soc = s1[5];
  f.gridW = (int16_t)s1[15] * 10;
  f.loadW = s2[2] * 10;
  f.solarW = s2[3] * 10;
  f.buyDay = s2[4] * 0.01f;
  f.solarDay = s2[6] * 0.01f;
  f.loadDay = s2[10] * 0.01f;
  f.battW = (int16_t)s3[2];
  f.pcsW = (int16_t)s3[6];

  if (xSemaphoreTake(dataMutex, portMAX_DELAY) == pdTRUE) {
    consecFail = 0;
    statFastOk++;
    lastGoodMs = f.atMs;
    if (!slowErrActive) lastError[0] = '\0';
    gFast = f;
    gHaveFast = true;
    accumulateLocked(f);
    xSemaphoreGive(dataMutex);
  }

  logPrintf("[fast] PV %u/%u/%u/%u W  太陽光 %d W  系統 %d W  負荷 %d W  蓄電池 %d W  SOC %d%%\n",
            f.pvP[0], f.pvP[1], f.pvP[2], f.pvP[3], f.solarW, f.gridW, f.loadW, f.battW, f.soc);
}

static void runSlow() {
  uint16_t pk[1], c1[16], c2[16], c3[16], t[16];
  char err[64] = "";
  bool ok = readRegs(REG_PACK_V, 1, pk, err, sizeof(err)) &&
            readRegs(REG_CELLS, 16, c1, err, sizeof(err)) &&
            readRegs(REG_CELLS + 16, 16, c2, err, sizeof(err)) &&
            readRegs(REG_CELLS + 32, 16, c3, err, sizeof(err)) &&
            readRegs(REG_TEMPS, 16, t, err, sizeof(err));
  if (!ok) {
    if (xSemaphoreTake(dataMutex, portMAX_DELAY) == pdTRUE) {
      statSlowFail++;
      slowErrActive = true;
      snprintf(lastError, sizeof(lastError), "%s", err[0] ? err : "slow failed");
      xSemaphoreGive(dataMutex);
    }
    logPrintf("[slow] 失敗 (%s)\n", err);
    return;
  }

  SlowSample s;
  memset(&s, 0, sizeof(s));
  s.atMs = millis();
  s.epoch = time(nullptr);
  s.packV = pk[0] * 0.1f;
  for (int i = 0; i < 16; i++) {
    s.cell[i] = c1[i];
    s.cell[16 + i] = c2[i];
    s.cell[32 + i] = c3[i];
    s.temp[i] = (int16_t)t[i];
  }

  // 妥当性チェックと統計 (セル: 2000〜4500mV, 温度: -40〜100℃)
  int cn = 0;
  uint32_t csum = 0;
  uint16_t cmax = 0, cmin = 0xFFFF;
  for (int i = 0; i < N_CELLS; i++) {
    uint16_t v = s.cell[i];
    if (v < 2000 || v > 4500) continue;
    cn++;
    csum += v;
    if (v > cmax) cmax = v;
    if (v < cmin) cmin = v;
  }
  int tn = 0;
  int tsum = 0;
  int16_t tmax = -32768, tmin = 32767;
  for (int i = 0; i < N_TEMPS; i++) {
    int16_t v = s.temp[i];
    if (v < -40 || v > 100) continue;
    tn++;
    tsum += v;
    if (v > tmax) tmax = v;
    if (v < tmin) tmin = v;
  }
  s.ok = (cn >= 40 && tn >= 8);
  if (!s.ok) {
    if (xSemaphoreTake(dataMutex, portMAX_DELAY) == pdTRUE) {
      statSlowFail++;
      slowErrActive = true;
      snprintf(lastError, sizeof(lastError), "bms invalid cells=%d temps=%d", cn, tn);
      xSemaphoreGive(dataMutex);
    }
    logPrintf("[slow] 値が不正 (cells=%d temps=%d)\n", cn, tn);
    return;
  }
  s.cellMax = cmax;
  s.cellMin = cmin;
  s.cellAvg = (uint16_t)(csum / (uint32_t)cn);
  s.tMax = tmax;
  s.tMin = tmin;
  s.tAvg = (float)tsum / (float)tn;

  if (xSemaphoreTake(dataMutex, portMAX_DELAY) == pdTRUE) {
    gSlow = s;
    gHaveSlow = true;
    statSlowOk++;
    slowErrActive = false;
    if (consecFail == 0) lastError[0] = '\0';
    xSemaphoreGive(dataMutex);
  }
  logPrintf("[slow] パック %.1f V  セル %u〜%u mV  温度 %d〜%d C\n", s.packV, s.cellMin, s.cellMax, s.tMin, s.tMax);
}

// ---------- HTTP ----------
static bool authOk() {
  if (strlen(API_TOKEN) == 0) return true;
  if (server.header("X-Api-Token") == API_TOKEN) return true;
  server.client().setNoDelay(true);
  server.send(401, "text/plain", "unauthorized");
  return false;
}

static void appendMinuteJson(char* buf, size_t cap, size_t& pos, const MinuteRec& m, bool first) {
  appendFmt(buf, cap, pos, "%s{\"ts\":%lu,\"n\":%u,\"pv\":[",
            first ? "" : ",", (unsigned long)m.ts, (unsigned)m.n);
  for (int i = 0; i < 4; i++) {
    appendFmt(buf, cap, pos, "%s{\"p_avg\":%.1f,\"p_min\":%u,\"p_max\":%u,\"v\":%.1f,\"i\":%.2f}",
              i ? "," : "", m.pvPAvg10[i] / 10.0f, (unsigned)m.pvPMin[i], (unsigned)m.pvPMax[i],
              m.pvV10[i] / 10.0f, m.pvI100[i] / 100.0f);
  }
  appendFmt(buf, cap, pos,
            "],\"sys\":{\"solar_w\":%d,\"grid_w\":%d,\"load_w\":%d,\"batt_w\":%d,\"pcs_w\":%d,"
            "\"soc\":%u,\"mode\":%u,\"solar_day_kwh\":%.2f,\"buy_day_kwh\":%.2f,\"load_day_kwh\":%.2f}",
            m.solarW, m.gridW, m.loadW, m.battW, m.pcsW, (unsigned)m.soc, (unsigned)m.mode,
            m.solarDay100 / 100.0f, m.buyDay100 / 100.0f, m.loadDay100 / 100.0f);
  if (m.bmsOk) {
    appendFmt(buf, cap, pos,
              ",\"bms\":{\"pack_v\":%.1f,\"cell_max_mv\":%u,\"cell_min_mv\":%u,\"cell_avg_mv\":%u,"
              "\"temp_max_c\":%d,\"temp_min_c\":%d,\"temp_avg_c\":%.1f}}",
              m.packV10 / 10.0f, (unsigned)m.cellMax, (unsigned)m.cellMin, (unsigned)m.cellAvg,
              (int)m.tMax, (int)m.tMin, m.tAvg10 / 10.0f);
  } else {
    appendFmt(buf, cap, pos, ",\"bms\":null}");
  }
}

static void handleMinutes() {
  if (!authOk()) return;

  uint64_t curSince = server.hasArg("since") ? strtoull(server.arg("since").c_str(), nullptr, 10) : 0;
  int limit = server.hasArg("limit") ? server.arg("limit").toInt() : MINUTES_DEFAULT_LIMIT;
  if (limit < 1) limit = 1;
  if (ringCap > 0 && limit > ringCap) limit = ringCap;

  static char minChunkBuf[3072];
  size_t pos = 0;
  appendFmt(minChunkBuf, sizeof(minChunkBuf), pos,
            "{\"device\":\"%s\",\"now\":%lu,\"time_valid\":%s,\"minutes\":[",
            HOST_NAME, (unsigned long)time(nullptr), timeValid() ? "true" : "false");

  server.client().setNoDelay(true);

  if (ringCap <= 0) {
    appendFmt(minChunkBuf, sizeof(minChunkBuf), pos, "]}");
    server.send(200, "application/json", minChunkBuf);
    return;
  }

  const int BATCH_MAX = 3;
  bool chunked = false;
  int sent = 0;

  // 平常時(0〜3件)はチャンク分割せず1回で send()、追いつき時は3件(約2KB)単位で送信しロック時間を極小化する
  while (sent < limit) {
    MinuteRec batch[BATCH_MAX];
    int batchCount = 0;
    int want = limit - sent;
    if (want > BATCH_MAX) want = BATCH_MAX;
    bool hasMoreCandidate = false;

    if (xSemaphoreTake(dataMutex, portMAX_DELAY) == pdTRUE) {
      for (int i = 0; i < ringCount; i++) {
        const MinuteRec& m = ring[(ringHead + i) % ringCap];
        if ((uint64_t)m.ts <= curSince) continue;
        if (batchCount < want) {
          batch[batchCount++] = m;
        } else {
          hasMoreCandidate = true;
          break;
        }
      }
      xSemaphoreGive(dataMutex);
    }

    if (batchCount == 0) break;

    for (int k = 0; k < batchCount; k++) {
      appendMinuteJson(minChunkBuf, sizeof(minChunkBuf), pos, batch[k], sent == 0);
      curSince = (uint64_t)batch[k].ts;
      sent++;
    }

    if (!chunked) {
      if (sent < limit && hasMoreCandidate) {
        chunked = true;
        server.setContentLength(CONTENT_LENGTH_UNKNOWN);
        server.send(200, "application/json", "");
        server.sendContent(minChunkBuf);
        pos = 0;
        minChunkBuf[0] = '\0';
      } else {
        break;
      }
    } else {
      server.sendContent(minChunkBuf);
      pos = 0;
      minChunkBuf[0] = '\0';
    }
  }

  if (!chunked) {
    appendFmt(minChunkBuf, sizeof(minChunkBuf), pos, "]}");
    server.send(200, "application/json", minChunkBuf);
  } else {
    server.sendContent("]}");
    server.sendContent("");
  }
}

static void handleLatest() {
  if (!authOk()) return;
  bool withCells = server.hasArg("cells") && server.arg("cells") == "1";

  // 共有データをマイクロ秒単位でスナップショット取得してからJSON整形・一括送信
  FastSample fCopy;
  SlowSample sCopy;
  bool haveFastCopy = false, haveSlowCopy = false;
  int rCountCopy = 0;
  uint32_t sFastOk = 0, sFastFail = 0, sSlowOk = 0, sSlowFail = 0;
  uint32_t sConn = 0, sConnFail = 0, sTimeouts = 0;
  char errCopy[64] = "";

  if (xSemaphoreTake(dataMutex, portMAX_DELAY) == pdTRUE) {
    haveFastCopy = gHaveFast;
    if (haveFastCopy) fCopy = gFast;
    haveSlowCopy = gHaveSlow;
    if (haveSlowCopy) sCopy = gSlow;
    rCountCopy = ringCount;
    sFastOk = statFastOk;
    sFastFail = statFastFail;
    sSlowOk = statSlowOk;
    sSlowFail = statSlowFail;
    sConn = statConnects;
    sConnFail = statConnectFail;
    sTimeouts = statTimeouts;
    snprintf(errCopy, sizeof(errCopy), "%s", lastError);
    xSemaphoreGive(dataMutex);
  }

  static char latestBuf[2560];
  size_t pos = 0;
  uint32_t nowMs = millis();
  time_t now = time(nullptr);

  appendFmt(latestBuf, sizeof(latestBuf), pos,
            "{\"device\":\"%s\",\"fw\":\"%s\",\"now\":%lu,\"time_valid\":%s,\"uptime_s\":%lu,"
            "\"ble_connected\":%s,\"wifi_rssi\":%d,\"free_heap\":%lu,\"min_free_heap\":%lu,\"max_alloc_heap\":%lu,"
            "\"ring_count\":%d,\"ring_cap\":%d,"
            "\"stats\":{\"fast_ok\":%lu,\"fast_fail\":%lu,\"slow_ok\":%lu,\"slow_fail\":%lu,"
            "\"connects\":%lu,\"connect_fail\":%lu,\"timeouts\":%lu},\"last_error\":\"",
            HOST_NAME, FW_VERSION, (unsigned long)now, timeValid() ? "true" : "false",
            (unsigned long)(nowMs / 1000), connected ? "true" : "false", (int)WiFi.RSSI(),
            (unsigned long)ESP.getFreeHeap(), (unsigned long)ESP.getMinFreeHeap(),
            (unsigned long)ESP.getMaxAllocHeap(), rCountCopy, ringCap,
            (unsigned long)sFastOk, (unsigned long)sFastFail, (unsigned long)sSlowOk,
            (unsigned long)sSlowFail, (unsigned long)sConn, (unsigned long)sConnFail,
            (unsigned long)sTimeouts);
  appendJsonEscaped(latestBuf, sizeof(latestBuf), pos, errCopy);
  appendFmt(latestBuf, sizeof(latestBuf), pos, "\"");

  if (haveFastCopy) {
    appendFmt(latestBuf, sizeof(latestBuf), pos, ",\"fast\":{\"age_s\":%lu,\"pv\":[",
              (unsigned long)((nowMs - fCopy.atMs) / 1000));
    for (int i = 0; i < 4; i++) {
      appendFmt(latestBuf, sizeof(latestBuf), pos, "%s{\"p\":%u,\"v\":%.1f,\"i\":%.1f}",
                i ? "," : "", fCopy.pvP[i], fCopy.pvV[i], fCopy.pvI[i]);
    }
    appendFmt(latestBuf, sizeof(latestBuf), pos,
              "],\"solar_w\":%d,\"grid_w\":%d,\"load_w\":%d,\"batt_w\":%d,\"pcs_w\":%d,\"soc\":%d,\"mode\":%d,"
              "\"solar_day_kwh\":%.2f,\"buy_day_kwh\":%.2f,\"load_day_kwh\":%.2f}",
              fCopy.solarW, fCopy.gridW, fCopy.loadW, fCopy.battW, fCopy.pcsW,
              fCopy.soc, fCopy.mode, fCopy.solarDay, fCopy.buyDay, fCopy.loadDay);
  } else {
    appendFmt(latestBuf, sizeof(latestBuf), pos, ",\"fast\":null");
  }

  if (haveSlowCopy) {
    appendFmt(latestBuf, sizeof(latestBuf), pos,
              ",\"slow\":{\"age_s\":%lu,\"pack_v\":%.1f,\"cell_max_mv\":%u,\"cell_min_mv\":%u,\"cell_avg_mv\":%u,"
              "\"temp_max_c\":%d,\"temp_min_c\":%d,\"temp_avg_c\":%.1f",
              (unsigned long)((nowMs - sCopy.atMs) / 1000), sCopy.packV, sCopy.cellMax,
              sCopy.cellMin, sCopy.cellAvg, sCopy.tMax, sCopy.tMin, sCopy.tAvg);
    if (withCells) {
      appendFmt(latestBuf, sizeof(latestBuf), pos, ",\"cells_mv\":[");
      for (int i = 0; i < N_CELLS; i++) {
        appendFmt(latestBuf, sizeof(latestBuf), pos, "%s%u", i ? "," : "", sCopy.cell[i]);
      }
      appendFmt(latestBuf, sizeof(latestBuf), pos, "],\"temps_c\":[");
      for (int i = 0; i < N_TEMPS; i++) {
        appendFmt(latestBuf, sizeof(latestBuf), pos, "%s%d", i ? "," : "", sCopy.temp[i]);
      }
      appendFmt(latestBuf, sizeof(latestBuf), pos, "]");
    }
    appendFmt(latestBuf, sizeof(latestBuf), pos, "}");
  } else {
    appendFmt(latestBuf, sizeof(latestBuf), pos, ",\"slow\":null");
  }
  appendFmt(latestBuf, sizeof(latestBuf), pos, "}");

  server.client().setNoDelay(true);
  server.send(200, "application/json", latestBuf);
}

// 調査用: レジスタを読み取って返す (ファンクション0x03のみ・最大16個)
static void handleRegs() {
  if (!authOk()) return;
  server.client().setNoDelay(true);
  if (!server.hasArg("addr")) { server.send(400, "text/plain", "addr (hex) required"); return; }
  unsigned long addr = strtoul(server.arg("addr").c_str(), nullptr, 16);
  int count = server.hasArg("count") ? server.arg("count").toInt() : 16;
  if (count < 1 || count > 16 || addr + (unsigned long)count > 0x10000UL) {
    server.send(400, "text/plain", "bad range");
    return;
  }
  if (!connected) { server.send(503, "text/plain", "ble not connected"); return; }
  uint16_t v[16];
  char err[64] = "";
  if (!readRegs((uint16_t)addr, (uint8_t)count, v, err, sizeof(err))) {
    server.send(502, "text/plain", err[0] ? err : "read failed");
    return;
  }
  char b[320];
  size_t pos = 0;
  appendFmt(b, sizeof(b), pos, "{\"addr\":%lu,\"count\":%d,\"values\":[", addr, count);
  for (int i = 0; i < count; i++) {
    appendFmt(b, sizeof(b), pos, "%s%u", i ? "," : "", (unsigned)v[i]);
  }
  appendFmt(b, sizeof(b), pos, "]}");
  server.send(200, "application/json", b);
}

// ---------- BLE接続・専用タスク ----------
static bool connectToServer() {
  if (!targetDevice) return false;
  if (xSemaphoreTake(bleMutex, pdMS_TO_TICKS(5000)) != pdTRUE) return false;

  bool ok = false;
  if (!bleClient) {
    bleClient = BLE.createClient();
    if (bleClient) {
      bleClient.onDisconnect([](BLEClient& /*c*/, const BLEConnInfo& /*info*/, uint8_t /*reason*/) {
        connected = false;
        bool wake = false;
        taskENTER_CRITICAL(&rxMux);
        if (rxState == 0) {
          rxState = 3;
          wake = true;
        }
        taskEXIT_CRITICAL(&rxMux);
        if (wake && rxSem) xSemaphoreGive(rxSem);
        logPrintf(">>> BLE切断\n");
      });
    }
  }
  if (bleClient) {
    bleClient.setMTU(517);
    if (bleClient.connect(targetDevice, 5000) && bleClient.discoverServices()) {
      BLERemoteService svc = bleClient.getService(serviceUUID);
      if (svc) {
        txChar = svc.getCharacteristic(charTxUUID);
        rxChar = svc.getCharacteristic(charRxUUID);
        if (txChar && rxChar) {
          if (!rxChar.canNotify() || rxChar.subscribe(BLESubscription::Notify, notifyCallback)) {
            ok = true;
          }
        }
      }
    }
    if (!ok) {
      txChar = BLERemoteCharacteristic();
      rxChar = BLERemoteCharacteristic();
      if (bleClient.isConnected()) bleClient.disconnect();
    }
  }
  xSemaphoreGive(bleMutex);

  if (!ok) return false;

  connected = true;
  uint32_t nowMs = millis();
  nextFast = nowMs;
  nextSlow = nowMs + SLOW_START_OFFSET_MS;
  if (xSemaphoreTake(dataMutex, portMAX_DELAY) == pdTRUE) {
    consecFail = 0;
    statConnects++;
    xSemaphoreGive(dataMutex);
  }
  logPrintf(">>> EP CUBEに接続しました\n");
  return true;
}

static void blePollTask(void* /*pvParameters*/) {
  uint32_t lastScan = 0;
  for (;;) {
    if (doConnect.load(std::memory_order_acquire)) {
      connecting.store(true, std::memory_order_release);
      doConnect.store(false, std::memory_order_release);
      BLEScan sc = BLE.getScan();
      if (sc.isScanning()) sc.stop();
      bool ok = connectToServer();
      connecting.store(false, std::memory_order_release);
      if (!ok) {
        if (xSemaphoreTake(dataMutex, portMAX_DELAY) == pdTRUE) {
          statConnectFail++;
          xSemaphoreGive(dataMutex);
        }
        logPrintf("BLE接続に失敗。再スキャンします\n");
      }
    }

    BLEScan sc = BLE.getScan();
    if (!connected && !doConnect && !sc.isScanning()) {
      if (millis() - lastScan > 7000) {
        lastScan = millis();
        sc.clearResults();  // 長時間運用でメモリが増えないよう結果を破棄
        logPrintf("EP CUBEを探しています...\n");
        BTStatus st = sc.start(5000, false);
        if (!st) {
          logPrintf("BLEスキャン開始失敗: %s\n", st.toString());
        }
      }
    }

    if (connected) {
      uint32_t nowMs = millis();
      if ((int32_t)(nowMs - nextFast) >= 0) {
        runFast();
        nextFast += FAST_MS;
        if ((int32_t)(millis() - nextFast) >= (int32_t)FAST_MS) {
          nextFast = millis() + FAST_MS;
        }
      }
      if (connected && (int32_t)(millis() - nextSlow) >= 0) {
        runSlow();
        nextSlow += SLOW_MS;
        if ((int32_t)(millis() - nextSlow) >= (int32_t)SLOW_MS) {
          nextSlow = millis() + SLOW_MS;
        }
      }

      bool needReconnect = false;
      if (xSemaphoreTake(dataMutex, portMAX_DELAY) == pdTRUE) {
        if (consecFail >= FAIL_RECONNECT) {
          consecFail = 0;
          needReconnect = true;
        }
        xSemaphoreGive(dataMutex);
      }
      if (connected && needReconnect) {
        logPrintf("高速サンプルが連続で失敗したためBLEを再接続します\n");
        if (xSemaphoreTake(bleMutex, pdMS_TO_TICKS(5000)) == pdTRUE) {
          connected = false;
          txChar = BLERemoteCharacteristic();
          rxChar = BLERemoteCharacteristic();
          if (bleClient && bleClient.isConnected()) bleClient.disconnect();
          xSemaphoreGive(bleMutex);
        }
      }
    }

    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// ---------- Wi-Fi ----------
static void wifiTask() {
  static bool wasUp = false;
  static uint32_t lastTry = 0;
  static uint32_t downSinceMs = 0;
  static uint32_t lastHardResetMs = 0;
  uint32_t nowMs = millis();
  bool up = (WiFi.status() == WL_CONNECTED);

  if (up && !wasUp) {
    wasUp = true;
    downSinceMs = 0;
    lastHardResetMs = 0;
    logPrintf("Wi-Fi接続: IP=%s RSSI=%d dBm\n", WiFi.localIP().toString().c_str(), (int)WiFi.RSSI());
    if (!httpStarted) {
      configTime(0, 0, "ntp.nict.jp", "time.cloudflare.com", "pool.ntp.org");
      MDNS.begin(HOST_NAME);
      server.begin();
      httpStarted = true;
    } else {
      MDNS.end();
      MDNS.begin(HOST_NAME);
    }
  } else if (!up) {
    if (wasUp || downSinceMs == 0) {
      if (wasUp) logPrintf("Wi-Fi切断を検知しました\n");
      wasUp = false;
      downSinceMs = nowMs;
      lastHardResetMs = nowMs;
    }
    if (nowMs - downSinceMs > WIFI_DISCONNECT_RESTART_MS) {
      logPrintf("Wi-Fiが長時間復旧しないため再起動します\n");
      delay(200);
      ESP.restart();
    }
    if (nowMs - lastTry > 15000UL) {
      lastTry = nowMs;
      if (nowMs - lastHardResetMs >= WIFI_REINIT_MS) {
        lastHardResetMs = nowMs;
        logPrintf("Wi-Fiを再初期化しています...\n");
        WiFi.disconnect(false, false);
        WiFi.begin(WIFI_SSID, WIFI_PASS);
      } else {
        logPrintf("Wi-Fiに再接続しています...\n");
        if (!WiFi.reconnect()) {
          WiFi.begin(WIFI_SSID, WIFI_PASS);
        }
      }
    }
  }
}

// ---------- setup / loop ----------
void setup() {
  Serial.begin(115200);
#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
  Serial.setTxTimeoutMs(5);
#endif
  uint32_t t = millis();
  while (!Serial && millis() - t < 3000) delay(10);
  logPrintf("=== EP CUBE ゲートウェイ v" FW_VERSION " ===\n");

  bleMutex  = xSemaphoreCreateMutex();
  rxSem     = xSemaphoreCreateBinary();
  dataMutex = xSemaphoreCreateMutex();

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  // BLE 併用時は ESP-IDF 共存機構が Modem Sleep を要求するため true のまま維持する (false にすると abort し得る)
  WiFi.setSleep(true);
  WiFi.setAutoReconnect(true);
  WiFi.setHostname(HOST_NAME);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  static const char* hdrKeys[] = { "X-Api-Token" };
  server.collectHeaders(hdrKeys, 1);
  server.on("/api/latest", HTTP_GET, handleLatest);
  server.on("/api/minutes", HTTP_GET, handleMinutes);
  server.on("/api/regs", HTTP_GET, handleRegs);
  server.onNotFound([]() {
    server.client().setNoDelay(true);
    server.send(404, "text/plain", "not found");
  });

  BTStatus bleSt = BLE.begin("ATOMS3-EPCUBE");
  if (!bleSt) {
    logPrintf("BLE初期化失敗: %s\n", bleSt.toString());
  }
  BLE.setMTU(517);
  BLEScan sc = BLE.getScan();
  sc.onResult([](const BLEAdvertisedDevice& advertisedDevice) {
    if (doConnect.load(std::memory_order_acquire) ||
        connecting.load(std::memory_order_acquire) ||
        connected.load(std::memory_order_acquire)) {
      return;
    }
    if (advertisedDevice.haveName() && strstr(advertisedDevice.getName().c_str(), "EPCUBE") != nullptr) {
      BLE.getScan().stop();
      targetDevice = advertisedDevice;
      doConnect.store(true, std::memory_order_release);
    }
  });
  sc.setActiveScan(true);
  sc.setInterval(125);   // 再スキャン中も Wi-Fi 通信枠を残す (125ms)
  sc.setWindow(25);      // (25ms)

  allocRing();   // BLE・Wi-Fiの初期化後に確保し、空きヒープを確認する
  lastGoodMs = millis();

  xTaskCreatePinnedToCore(blePollTask, "ble_poll", BLE_TASK_STACK, nullptr, 1, nullptr, 1);
}

void loop() {
  wifiTask();
  if (httpStarted) server.handleClient();

  uint32_t lastOkMs = 0;
  if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
    lastOkMs = lastGoodMs;
    xSemaphoreGive(dataMutex);
  } else {
    lastOkMs = millis();
  }

  if (millis() - lastOkMs > NO_DATA_RESTART_MS) {
    logPrintf("長時間データが取得できないため再起動します\n");
    delay(200);
    ESP.restart();
  }
  delay(2);
}
