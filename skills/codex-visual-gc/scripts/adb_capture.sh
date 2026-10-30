#!/usr/bin/env bash
# adb_capture.sh - Streamlined ADB screencap with instant native JPEG downsampling
# Usage:
#   adb_capture.sh <output.jpg> [device_serial] [max_dimension] [quality]
# Example:
#   adb_capture.sh screens/001.jpg 2433TN308308

set -euo pipefail

OUT_FILE="${1:-screen.jpg}"
SERIAL="${2:-}"
MAX_DIM="${3:-1280}"
QUALITY="${4:-70}"

ADB_CMD="adb"
if [ -n "$SERIAL" ]; then
  ADB_ARGS=("-s" "$SERIAL")
else
  ADB_ARGS=()
fi

DIR=$(dirname "$OUT_FILE")
if [ -n "$DIR" ] && [ "$DIR" != "." ]; then
  mkdir -p "$DIR"
fi

TMP_PNG=$(mktemp /tmp/adb_screencap_XXXXXX.png)
trap 'rm -f "$TMP_PNG"' EXIT

# Capture raw screen from device
"$ADB_CMD" "${ADB_ARGS[@]}" exec-out screencap -p > "$TMP_PNG"

if [ ! -s "$TMP_PNG" ]; then
  echo "Error: Failed to capture screen via adb" >&2
  exit 1
fi

# Downsample and convert to compressed JPEG
sips -s format jpeg -s formatOptions "$QUALITY" -Z "$MAX_DIM" "$TMP_PNG" --out "$OUT_FILE" >/dev/null 2>&1

NEW_SIZE=$(stat -f%z "$OUT_FILE" 2>/dev/null || stat -c%s "$OUT_FILE" 2>/dev/null || echo 0)
NEW_KB=$((NEW_SIZE / 1024))
echo "Captured & compressed screen: $OUT_FILE (${NEW_KB}KB)"
