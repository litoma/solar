#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${1:-192.168.0.36}"
ARDUINO_CLI="${ARDUINO_CLI:-$HOME/.local/bin/arduino-cli}"
FQBN="${FQBN:-esp32:esp32:m5stack_atoms3:PartitionScheme=default_8MB}"

if [[ ! -x "$ARDUINO_CLI" ]]; then
  if command -v arduino-cli >/dev/null 2>&1; then
    ARDUINO_CLI="$(command -v arduino-cli)"
  else
    echo "arduino-cli が見つかりません: $ARDUINO_CLI" >&2
    exit 1
  fi
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

SKETCH_DIR="$WORK_DIR/epcube-gw"
BUILD_DIR="$WORK_DIR/build"
mkdir -p "$SKETCH_DIR" "$BUILD_DIR"

cp "$SCRIPT_DIR/epcube-gw.ino" "$SKETCH_DIR/epcube-gw.ino"
if [[ -f "$SCRIPT_DIR/secrets.h" ]]; then
  cp "$SCRIPT_DIR/secrets.h" "$SKETCH_DIR/secrets.h"
else
  echo "警告: $SCRIPT_DIR/secrets.h が見つかりません（プレースホルダー設定でビルドします）" >&2
fi

TOKEN="${GW_TOKEN:-}"
if [[ -z "$TOKEN" && -f "$SCRIPT_DIR/secrets.h" ]]; then
  TOKEN="$(sed -n 's/^[[:space:]]*static[[:space:]]\+const[[:space:]]\+char\*[[:space:]]\+API_TOKEN[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$SCRIPT_DIR/secrets.h" | head -n 1)"
fi

echo "==> ファームウェアをビルド中 ($FQBN)..."
"$ARDUINO_CLI" compile --fqbn "$FQBN" --output-dir "$BUILD_DIR" "$SKETCH_DIR"

BIN_FILE="$BUILD_DIR/epcube-gw.ino.bin"
if [[ ! -f "$BIN_FILE" ]]; then
  echo "ビルド成果物が見つかりません: $BIN_FILE" >&2
  exit 1
fi

MD5_HEX="$(md5sum "$BIN_FILE" | awk '{print $1}')"
echo "==> http://${HOST}/api/ota へ送信中 (md5=${MD5_HEX})..."

CURL_ARGS=(-fsS --max-time 120 -F "firmware=@${BIN_FILE}")
if [[ -n "$TOKEN" ]]; then
  CURL_ARGS+=(-H "X-Api-Token: ${TOKEN}")
fi

curl "${CURL_ARGS[@]}" "http://${HOST}/api/ota?md5=${MD5_HEX}"
echo ""
echo "==> 再起動と接続復帰を待機中..."
for _ in $(seq 1 20); do
  sleep 2
  LATEST_ARGS=(-fsS --max-time 3)
  if [[ -n "$TOKEN" ]]; then
    LATEST_ARGS+=(-H "X-Api-Token: ${TOKEN}")
  fi
  if resp="$(curl "${LATEST_ARGS[@]}" "http://${HOST}/api/latest" 2>/dev/null)"; then
    echo "$resp" | head -c 300
    echo ""
    echo "==> OTA 更新が完了しました"
    exit 0
  fi
done

echo "警告: 送信は成功しましたが、再起動後の応答確認がタイムアウトしました" >&2
exit 1
