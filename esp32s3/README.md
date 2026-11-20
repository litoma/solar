# EP CUBE 発電・BMSモニタ 仕様書

版数 1.3 ／ 2026-11-20 ／ 対象: ATOMS3 Liteゲートウェイ (`esp32s3/epcube-gw.ino` v1.2.1) と Cloudflare Workers 取り込み構成

## 1. 目的と範囲

- 目的: EP CUBEのPV1〜4ごとの電圧・電流・電力と、BMS(セル電圧・温度)を、人の操作なしで継続的に記録し可視化する。
- 背景: 公式アプリと操作パネルでは、発電量は合計しか見られない。クラウドAPI(非公式)はログインにCAPTCHAがあり、トークン期限切れ時に人手が必要になる。LAN側のModbus TCP(502番)は閉じている。一方、BLEの独自通信路でModbusのレジスタを読めることを確認した。
- 範囲: (1) ATOMS3 Liteゲートウェイ (`esp32s3/epcube-gw.ino`) (2) `cloudflared` + Workers VPC 経由での Cloudflare Worker Cron 取り込み (`web/worker.ts`) (3) Cloudflare D1 保存・ダッシュボード配信 (`EP VIEW`)
- 範囲外: 機器の設定変更(書き込み)

## 2. システム構成

```text
EP CUBE ⇄ BLE ⇄ ATOMS3 Lite (192.168.0.36:80)
                      ▲
                      │ (LAN内 HTTP)
                 cloudflared (自宅Ubuntuサーバ上の Tunnel 中継のみ)
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

- ATOMS3 Lite: BLEでレジスタを読み、直近値と最大720件(12時間分)の1分集計を保持して HTTP/JSON で公開する。クラウドへ直接接続する処理は持たない。
- 自宅Ubuntuサーバ (`zmshabin`): `cloudflared.service` のみを稼働させ、Cloudflare Workers VPC からのプライベート接続を `192.168.0.36:80` へ中継する（※以前の Python コレクタ `epcube-collector` + ローカル SQLite 構成は廃止済み）。
- Cloudflare Worker: 毎分の Cron Trigger で VPC 経由で `/api/minutes`（および10分ごとに `/api/latest?cells=1`）を取得し、Open-Meteo の天気・気温を付加して D1 へ UPSERT する。
- 注意: EP CUBE 側のBLE接続は同時に1台のみ。ゲートウェイの接続中は、スマホアプリのBluetooth機能(Wi-Fi設定)が使えない可能性がある。通常のアプリ機能への影響は未確認。

## 3. 前提と制約

- 読み取り専用: 送るModbusはファンクション0x03(保持レジスタの読み取り)のみ。書き込み系は一切送らない。
- スレーブIDは0x64のみ。他のIDへの問い合わせを試したところ、3回ともBLEが切断されたため、行わない。
- 参考サイトの機器は EP Cube HES-JP2-613G(ソフトV1.2.7)。自機のパワコンは図面上 EP Cube PCS-JP2-6G。機種・ファームウェアの差でレジスタが異なる可能性があるため、取得値には妥当性検査を行う。
- 機器の許容リクエスト頻度は非公開。参考サイトは約14秒周期、試験では5秒周期で動作した実績があり、その範囲内の10秒/60秒を採用する。
- 非公式な方法であり、ファームウェア更新で動作しなくなる可能性がある。

## 4. 環境

- ハードウェア: M5Stack ATOMS3 Lite (ESP32-S3)
- ファームウェア環境: Arduino-ESP32 (3.3.13 で動作確認済み) 標準ライブラリ (`WiFi`, `WebServer`, `ESPmDNS`, `BLEDevice` / `BLEScan` / `BLEClient`, FreeRTOS タスク・セマフォ)
- 中継サーバ: Ubuntu 上の `cloudflared` (Cloudflare Tunnel / Workers VPC Service 経由)
- バックエンド・フロントエンド: Cloudflare Workers, Cloudflare D1 (`epcube-solar`), Vite + React + Recharts (`EP VIEW`)

## 5. BLE通信とタスク分離仕様

- 探索: 機器名に `EPCUBE` を含むBLE機器を探して接続する。未接続時は7秒間隔で5秒間スキャンする（Wi-Fi 通信枠を残すため `interval=200`, `window=40` を設定）。
- サービスUUID: `ee6d7170-88c6-11e8-b444-060400ef5315`
- 書き込み特性: `ee6d7171-88c6-11e8-b444-060400ef5315` (`Write / Write Without Response`)
- 通知特性: `ee6d7172-88c6-11e8-b444-060400ef5315` (`Notify`)
- ペアリングは不要。MTUは517を要求する。
- 要求: `RawModbus` というキーにhex文字列を入れたJSONを、書き込み特性へ書く。hexはModbus RTUフレーム(スレーブID 1バイト=`0x64`、ファンクション=`0x03`、開始アドレス2バイト(上位が先)、個数2バイト、CRC16(下位が先))。ヒープ断片化を避けるため固定文字配列 (`char cmd[36]`) で組み立てる。
- 応答: 通知特性にJSONが分割されて届く。閉じ括弧 `}` が来るまで連結し、`RawModbus` のhexを解析する。形式はスレーブID、`0x03`、バイト数、データ(各レジスタ上位が先)、CRC。例外応答は、ファンクションに `0x80` を足した値と例外コード。
- 並行制御・待機:
  - BLE 処理 (`blePollTask`) と HTTP サーバ (`loop()` の `server.handleClient()`) を別 FreeRTOS タスクに分離し、BLE 待ちや再スキャン中に HTTP 応答が止まらないようにしている。
  - 通知コールバック (`notifyCallback`) と読み出し処理 (`readRegs`) 間は `portMUX_TYPE` とバイナリセマフォ (`rxSem`) で保護し、切断時も即座に待機解除する。`blePollTask` と `/api/regs` 間の同時アクセスは `bleMutex`、共有サンプルデータとリングバッファは `dataMutex` で保護する。
  - 要求は1つずつ。応答待ちは最大800ミリ秒、要求間隔は送信直前に前回完了から100ミリ秒 (`GAP_MS`) を確保(最後の読み出し後の無駄待ちはしない)、タイムアウト時は1回だけ再試行する。1回の読み出しは16レジスタ以下(検証済みは12個と16個)。
- 存在しないアドレスは、例外ではなく0が返る。
- Wi-Fi 共存: ESP32-S3 は Wi-Fi と BLE で 2.4GHz 無線回路を共有するため、`WiFi.setSleep(true)` (Modem Sleep) を維持し、ESP-IDF 共存機構との競合クラッシュを防ぐ。
- 再接続・自己復旧:
  - BLE: 切断を検知したら再スキャンして再接続する。高速サンプルが6回連続で失敗したらBLEを再接続し、10分間 (`NO_DATA_RESTART_MS`) 1件も取れなければ再起動する。
  - Wi-Fi: 切断を検知したら15秒間隔で `WiFi.reconnect()`、60秒継続時は `WiFi.disconnect()` + `WiFi.begin()` で再初期化し、15分 (`WIFI_DISCONNECT_RESTART_MS`) 連続未接続で再起動する。

## 6. レジスタマップ

確度の表記: 確認済み=自機で値を確認し整合性を検証済み、元コード=動作確認済みのテレメトリ用コードの定義、推定=値の分布や整合性からの推定。

### PV(確認済み)

- `0x501B`〜`0x501E`: PV1〜4の電圧(0.1V単位)
- `0x501F`〜`0x5022`: PV1〜4の電流(0.1A単位。分解能が粗いので、電力の計算には使わない)
- `0x5023`〜`0x5026`: PV1〜4の電力(W)
- 検証: 電圧×電流は電力と概ね一致。4系統の電力合計(452W)は、`0x0543`×10(430W)より約5%大きく、DC側がAC側より大きいことと整合する。

### システム(元コード)

- `0x0513`: 運転モード(1=自家消費、2=時間帯別、3=バックアップ)
- `0x0515`: SOC(%)
- `0x051F`: 系統電力(符号付き、10W単位。正=買電、負=売電)
- `0x0542`: バックアップ負荷電力(10W単位)
- `0x0543`: 太陽光発電電力(10W単位)
- `0x0544`: 本日買電量(0.01kWh単位)
- `0x0546`: 本日太陽光発電量(0.01kWh単位)
- `0x054A`: 本日負荷消費量(0.01kWh単位)
- `0x0582`: 蓄電池電力(W、符号付き。負=充電、正=放電)
- `0x0586`: PCS出力(W、符号付き)
- 電力の符号(系統は正=買電・負=売電、蓄電池は正=放電・負=充電)は、昼間の収支(太陽光+買電+蓄電池放電≒負荷)で裏づけた。

注意: `load_w`(`0x0542`)は、家の負荷の直接測定値と見てよい(暫定)。収支(`solar_w + grid_w + batt_w`。買電を正、蓄電池放電を正とする)との差は、PCSの状態に依らず中央値で約−30W(夜間は−33〜−34Wで安定)で、機器自身の待機消費(約33W、1日約0.8kWh)と変換損失と考えられる。日積算は、分データの積算と機器の `load_day_kwh` が約1%以内で一致した。家全体の負荷かどうかは、電力会社のスマートメーターの買電量との照合で確認する(未実施)。なお、`pcs_w`(`0x0586`)が0でも蓄電池が放電している分があり、PCS停止の判定には使えない場合がある(要確認)。

### BMS(確認済み)

- `0x5027`: パック電圧(0.1V単位)
- `0x5050`〜`0x507F`: セル電圧48個(mV)
- `0x50D0`〜`0x50DF`: 温度センサー16個(℃、符号付き)
- 検証: 48セルの合計がパック電圧と一致した。自機でも、セル電圧3265〜3270mV×48≒156.9Vに対し、パック電圧は156.6〜156.8Vだった。

### 参考(今回は未使用)

- `0x0595`〜`0x059A`: 機器の時計(年、月、日、時、分、秒)
- `0x0535`〜`0x053F`: 機器の識別情報と思われる文字列(記録も公開もしない)
- `0x3004`: 系統AC電圧(0.1V単位)、`0x300B`: 周波数(0.01Hz単位)、`0x3018`〜`0x301C`: PCS温度

## 7. 取得スケジュール

### 高速(10秒周期)

- 4回の読み出し: `0x501B`×12、`0x0510`×16、`0x0540`×16、`0x0580`×16
- 1つでも失敗したら、そのサンプルは破棄する。

### 低速(60秒周期)

- 5回の読み出し: `0x5027`×1、`0x5050`×16、`0x5060`×16、`0x5070`×16、`0x50D0`×16
- `runFast()` と毎分衝突しないよう、接続時は5秒オフセット (`SLOW_START_OFFSET_MS = 5000`) して開始する（Worker側の鮮度上限 `SNAPSHOT_MAX_AGE_SEC = 120` に対応するため60秒周期を維持）。
- 妥当性検査: セルは2000〜4500mVの値が40個以上、温度は−40〜100℃の値が8個以上。満たさない場合は破棄し、エラーを統計と `last_error` に記録する。

### その他

- スケジュールは `next += PERIOD` 方式でドリフトを抑え、毎分ほぼ一定に `n=6` サンプルを取得する。周期はスケッチ冒頭の `FAST_MS` と `SLOW_MS` で変更できる。5秒未満は非推奨。
- 時刻はNTP(`ntp.nict.jp`、`time.cloudflare.com`、`pool.ntp.org`)でUTCに同期する。未同期の間は集計しない(最新値は更新する)。

## 8. 1分集計

- 分の境界はUTCの時計の分。`ts` は分の開始時刻(UTCのepoch秒、60の倍数)。
- その分に取れた高速サンプルを集計する。`n` はサンプル数(通常6。起動直後や欠測時は少ない)。
- PV電力は平均・最小・最大(W)、PV電圧・電流は平均。太陽光・系統・負荷・蓄電池・PCSの電力は平均。SOC、運転モード、日積算は、分の最後の値。
- BMS: 分の確定時に、直近120秒以内の低速サンプルがあれば、パック電圧、セル電圧の最大・最小・平均、温度の最大・最小・平均を付ける。なければ `null`。
- 確定した分だけを、リングバッファ(最大720件=12時間分、1件76バイトで約54.7KB)に保持する。起動時に `BLE_TASK_STACK` (8KB) と最低空きヒープ (`MIN_HEAP_AFTER_RING` = 50KB) を差し引いても残るサイズで確保し、足りなければ件数を半分ずつ減らす(最小60件)。再起動で消える。取り込み停止が保持時間を超えると欠損する。
- 集計中の分は `/api/minutes` に出ない。確定は、次の分の最初のサンプルが取れた時点(最大約10秒遅れ)。

## 9. HTTP API

- 共通: ポート80、JSON(UTF-8)、読み取り専用のGET。LAN内専用で外部インターネットには直接公開せず、`cloudflared` + `Workers VPC` 経由で Worker のみがアクセスする。全エンドポイントで `TCP_NODELAY` (`server.client().setNoDelay(true)`) を有効化している。
- 認証: `secrets.h` の `API_TOKEN` を設定すると、ヘッダ `X-Api-Token` が必須になる(不一致は401)。Worker 側はシークレット `GW_TOKEN` として同値を設定する。
- ホスト名: `epcube-gw.local`(mDNS)。DHCP予約による固定IP(`192.168.0.36`)での運用を推奨。

### `GET /api/minutes?since=EPOCH&limit=N`

- `since`: この時刻より新しい `ts` だけを返す。`limit`: 最大件数(1〜保持件数、既定60。Worker 側は `30` を指定)。
- 転送方式: 3件以下(平常時の毎分0〜1件)は `Content-Length` 付きで一括送信(`server.send`)。4件以上の追いつき時は `dataMutex` を細切れに解放しながら3件(約2KB)単位でチャンク送信する。
- 応答: `device`、`now`、`time_valid`、`minutes`(ts昇順の配列)。
- `minutes` の各要素: `ts`、`n`、`pv`(4要素の配列。`p_avg`、`p_min`、`p_max`、`v`、`i`)、`sys`(`solar_w`、`grid_w`、`load_w`、`batt_w`、`pcs_w`、`soc`、`mode`、`solar_day_kwh`、`buy_day_kwh`、`load_day_kwh`)、`bms`(`pack_v`、`cell_max_mv`、`cell_min_mv`、`cell_avg_mv`、`temp_max_c`、`temp_min_c`、`temp_avg_c`。なければ `null`)
- 単位: 電力W、電圧V、電流A、日積算kWh、セル電圧mV、温度℃。`pv` の配列はPV1〜4の順。

### `GET /api/latest?cells=1`

- 転送方式: 一括送信 (`server.send`)。`cells=1` 指定時も約1.0〜1.1KB を1回で返却する。
- 内容: 直近の生値と動作統計。`fast`(PV等の最新値)、`slow`(BMSの最新値。`cells=1` で `cells_mv` の48個と `temps_c` の16個を含む)、`stats`(成功・失敗数、再接続数、タイムアウト数)、`last_error`(JSONエスケープ済み。対応するサンプリングの正常復帰時に自動クリア)、`ble_connected`、`wifi_rssi`、`free_heap`、`min_free_heap`、`max_alloc_heap`、`ring_count`、`ring_cap`、`uptime_s`、`time_valid`
- 用途: 死活監視、10分ごとの全セル電圧スナップショット取得、デバッグ。

### `GET /api/regs?addr=HEX&count=N`

- 調査用。レジスタを読み取って返す。ファンクション `0x03`(読み取り)のみで、書き込みはできない。
- `addr`: 開始アドレス(16進)。`count`: 1〜16(既定16)。
- 応答: `addr`(10進)、`count`、`values`(レジスタ値の配列)。エラーは `400`(範囲不正)、`502`(読み取り失敗)、`503`(BLE未接続)。
- 認証は他のAPIと同じ(`API_TOKEN`)。`bleMutex` で通常ポーリングと調停される。

## 10. Cloudflare 取り込み仕様・D1 スキーマ

- 実行: Cloudflare Worker の Cron Trigger (`* * * * *`、毎分) が [web/worker.ts](file:///home/litoma/solar/web/worker.ts) の `handleScheduledIngest()` を実行する。
- 処理:
  1. D1 から `minute_samples` と `bms_snapshots` の最大 `ts` を取得する。
  2. Workers VPC (`EP_GATEWAY`) 経由で `GET /api/minutes?limit=30&since=<max_ts>` を呼び出す（タイムアウト 5秒、4xx 以外の失敗時は 300ms 待機して最大2回まで試行）。
  3. `time_valid !== true` の応答、および `since` 以下・未来過ぎる `ts` はスキップする。
  4. 新規行があれば Open-Meteo から天気コード (`weather_code`) と外気温 (`outdoor_temp_c`) を取得して各分へ付与し、`ts` を主キーとして D1 (`minute_samples`) に UPSERT する。
  5. 当日（および跨いだ日付）の `daily_summary` を D1 の既存行から差分更新する。
  6. 前回スナップショットから 585秒以上経過していれば `/api/latest?cells=1` を取得し、`slow.age_s <= 120` かつ有効なら `bms_snapshots` へ UPSERT する。
  7. 新規データ保存時は `SOLAR_SITE_ORIGIN` の Edge Cache をパージする。
- `ONLINE / OFFLINE` 判定: `/api/dashboard` 側で `nowSec - latest.ts <= 300` 秒なら `ONLINE`、超過すると `OFFLINE` と判定する。

### Cloudflare D1 スキーマ ([migrations/0001_init.sql](file:///home/litoma/solar/migrations/0001_init.sql), [0002_daily_summary.sql](file:///home/litoma/solar/migrations/0002_daily_summary.sql))

- `minute_samples` (1分1行)
  - `ts INTEGER PRIMARY KEY` (UTC epoch秒)、`n INTEGER`
  - `pv1_p_avg_w REAL`, `pv1_p_min_w INTEGER`, `pv1_p_max_w INTEGER`, `pv1_v REAL`, `pv1_i REAL` (`pv2`〜`pv4` も同様)
  - `solar_w REAL`, `grid_w REAL`, `load_w REAL`, `batt_w REAL`, `pcs_w REAL`, `soc INTEGER`, `mode INTEGER`
  - `solar_day_kwh REAL`, `buy_day_kwh REAL`, `load_day_kwh REAL`
  - `pack_v REAL`, `cell_max_mv INTEGER`, `cell_min_mv INTEGER`, `cell_avg_mv INTEGER`, `temp_max_c INTEGER`, `temp_min_c INTEGER`, `temp_avg_c REAL` (BMSの欠測はNULL)
  - `weather_code INTEGER`, `outdoor_temp_c REAL`
- `bms_snapshots` (10分ごと)
  - `ts INTEGER PRIMARY KEY`, `cells_json TEXT`, `temps_json TEXT`
- `daily_summary` (日別サマリー・1日1行)
  - `jst_date TEXT PRIMARY KEY`, `solar_kwh REAL`, `sell_kwh REAL`, `buy_kwh REAL`, `load_kwh REAL`, `pv1_kwh REAL`, `pv2_kwh REAL`, `pv3_kwh REAL`, `pv4_kwh REAL`, `samples INTEGER`, `last_ts INTEGER`

### D1(無料プラン)の制約と設計方針

- 無料プランの上限(1日): 読み取り500万行、書き込み10万行。ストレージは5GB。リセットは毎日0:00 UTC(日本時間9:00)。
- 2026-11-17に、読み取りが上限の76%に達する警告があり、その後89%まで増えた(書き込み838行、容量約664KB)。原因は閲覧側API (`/api/dashboard`) が `minute_samples` を全件走査していたことだった。
- 対応済み方針(2026-11-18〜): (1) ダッシュボード用集計を `daily_summary` (1日1行) へ分離し、`minute_samples` と `bms_snapshots` は `ORDER BY ts DESC LIMIT 1` のみ参照 (2) `/api/dashboard` に Edge Cache API (10〜60秒の動的 TTL) と非表示タブ時のポーリング停止を導入 (3) Cron 1回あたりの取り込みは `limit=30` に制限し、Worker 無料枠のクエリ数・CPU時間制限内に収める。

## 11. PV1〜4と屋根の回路の対応(未確認)

- 図面: 回路1-1(5枚 1.705kW)、1-2(4枚 1.630kW)、1-3(3枚 1.395kW)、1-4(3枚 1.335kW)。パワコンは EP Cube PCS-JP2-6G(15枚 6.065kW)。
- 仮説: PV1〜4が回路1-1〜1-4に対応する。根拠は、ある朝の出力を定格で割った値が、7.5%、7.2%、8.2%、7.0%と揃ったこと。
- 図面の位置関係(上が北)からは、回路1-1と1-3が西側、1-2が東側、1-4が北側の屋根に見える(推定)。
- 検証: 晴天日の1日分の分値で、東側の1-2が午前にピークとなり、西側の1-1と1-3が午後にピークとなること、同じ屋根の1-1と1-3の波形が似ることを確認する。確定するまで、表示側の方位ラベルは設定値として分離しておく。

## 12. セキュリティ

- Wi-Fi の SSID・パスワードおよび `API_TOKEN` は、スケッチ本体に直接書かず `esp32s3/secrets.example.h` を `esp32s3/secrets.h` にコピーして管理する(`esp32s3/secrets.h` は `.gitignore` 済み)。
- LAN 内 HTTP は暗号化しないがインターネットへ直接公開せず、`cloudflared` + `Workers VPC` 経由に限定する。必要に応じて `API_TOKEN` と Cloudflare 側 `GW_TOKEN` (Secret) を併用する。
- ゲートウェイは EP CUBE へ書き込まない (`0x03` 読み取り専用)。

## 13. 動作確認手順

1. `esp32s3/secrets.example.h` を同じフォルダに `secrets.h` としてコピーし、`WIFI_SSID` / `WIFI_PASS`(必要なら `API_TOKEN`)を設定して書き込む。調査用スケッチやスマホアプリのBLEは止めておく。
2. シリアルモニタ(115200bps)で、Wi-FiのIP、「EP CUBEに接続しました」、`[fast]` と `[slow]` の行が出ることを確認する。
3. `http://192.168.0.36/api/latest?cells=1` を開き、`fw` が `1.2.1` であること、`fast` のPV電力がログと一致すること、セルが48個あること、`cell_avg_mv×48÷1000` が `pack_v` に近いことを確認する。
4. 3分後に `/api/minutes` に確定分が約3件あり、`n` が約6であることを確認する。
5. Cloudflare D1 (`minute_samples` / `bms_snapshots` / `daily_summary`) にデータが入ること、公開サイト (`/api/dashboard`) が `gatewayOnline: true` になることを確認する。
6. 24時間運転し、`stats` の再接続数・タイムアウト数と、`free_heap`・`min_free_heap`・`max_alloc_heap` の推移を確認する。

### `load_w` の確認手順

- 方法A(実施済み): `minute_samples` から、`load_w` と収支(`solar_w + grid_w + batt_w`)を比べる。結果: 差(`load_w−収支`)の中央値は、PCS稼働中が−29W、停止中が−32W、夜間(21〜5時)は−33〜−34Wで安定。大きなずれ(|差|>500W)は全体の2.1%。日積算は、load積算が機器の `load_day_kwh` と約1%以内、買電が約3%以内で一致した。
- 方法D(未実施): 電力会社のスマートメーターの買電量(kWh)と、機器の `buy_day_kwh` を、同じ日で比べる。数%以内で一致すれば、機器の計測は引込口(家全体)と見てよい。機器の方が明らかに少なければ、機器が測っているのは家の一部(特定負荷など)。
- 方法B(未実施・任意): 夜間などPCSが止まっている時間に、消費電力が分かる家電(1,000W前後)を数分つけ、`/api/latest` の `load_w` と `grid_w` の変化を見る。`grid_w` だけが増えて `load_w` が動かなければ、`load_w` は家全体の消費ではない。
- 方法C(未実施・任意): 方法Bの負荷のオフ時とオン時に、`/api/regs` で `0x0500`〜`0x05FF` を読み比べ、変化したレジスタを探す(ノイズは、OFFのまま2回読んで除く)。家全体の負荷に対応するレジスタが見つかれば、USEの算出元を差し替える。

## 14. 実測実績と既知の未確認事項

- `v1.2.0` 実測実績 (2026-11-20): HTTP一括送信 + FreeRTOSタスク分離後の設置場所稼働において、夜間約8時間20分 (`00:38〜08:54 JST`) で D1 欠損ゼロ (496分連続・`n=6`)、`cloudflared` エラー0件、`workersVpcConnection` 546/546 成功 (`avg 245.8 ms`)、`free_heap` 約 68.8KB、`min_free_heap` 約 56.7KB、`wifi_rssi` `-60`〜`-70 dBm` を確認済み。
- BLE接続実績: `v1.0.0` で約55時間連続失敗ゼロを確認済み。24時間超での BLE 切断後の自動再接続と `min_free_heap` 長期推移は引き続き観察対象。
- EP CUBEが許容するリクエスト頻度の上限。
- 運転モード値(`mode`)の全定義(電力の符号は昼間の収支で裏づけ済み)。
- 家全体の負荷かどうか(`load_w` は収支との差が約−30Wで安定しており USE に使える見込み。電力会社スマートメーターとの照合は未実施)。
- `pcs_w`(`0x0586`)が0でも蓄電池が放電している分があり、PCS停止の判定に使えない場合がある。更新タイミングのずれの可能性も含めて未確認。
- BMSレジスタの範囲が、他のファームウェアでも同じか。

## 15. 変更履歴

- 1.3(2026-11-20): `epcube-gw.ino` v1.2.0〜v1.2.1(FreeRTOSタスク分離、HTTP一括/まとめ送信、`TCP_NODELAY`、USB CDC非ブロッキングログ、`secrets.h`分離、Wi-Fi切断フェイルセーフ)および Cloudflare Worker 直接取り込み構成 (Workers VPC + D1 + 5秒リトライ + 300秒オンライン判定) へ全面改訂。夜間8時間超の稼働実績を追記。
- 1.2(2026-11-19): v1.1.0を実機で動作確認。`load_w` の確認結果(待機消費約33W、日積算が機器の値と一致)を反映。D1の対応状況と現行の取り込み構成を追記。`load_w` の確認手順を更新(方法Dを追加)。
- 1.1(2026-11-18): 保持を12時間(720件、1件76バイトに圧縮)に拡大。`/api/minutes` の `limit` 既定を60件に変更。`/api/latest` に診断項目、`/api/regs` を追加。D1(無料プラン)の制約と設計方針を追記。BMSレジスタを確認済みに更新。`load_w` の注意を追記。
- 1.0(2026-11-15): 初版
