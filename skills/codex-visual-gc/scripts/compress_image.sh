#!/usr/bin/env bash
# compress_image.sh - Fast image downsampling and JPEG compression using macOS native sips
# Usage:
#   compress_image.sh input.png [output.jpg] [max_dimension] [quality]
#   compress_image.sh /path/to/folder_with_pngs/

set -euo pipefail

MAX_DIM="${3:-1280}"
QUALITY="${4:-70}"

compress_single() {
  local in_file="$1"
  local out_file="${2:-}"

  if [ -z "$out_file" ]; then
    out_file="${in_file%.*}.jpg"
  fi

  if [ ! -f "$in_file" ]; then
    echo "Error: File $in_file does not exist" >&2
    return 1
  fi

  local orig_size
  orig_size=$(stat -f%z "$in_file" 2>/dev/null || stat -c%s "$in_file" 2>/dev/null || echo 0)

  # Run sips downsample and JPEG compression
  sips -s format jpeg -s formatOptions "$QUALITY" -Z "$MAX_DIM" "$in_file" --out "$out_file" >/dev/null 2>&1

  local new_size
  new_size=$(stat -f%z "$out_file" 2>/dev/null || stat -c%s "$out_file" 2>/dev/null || echo 0)

  local orig_kb=$((orig_size / 1024))
  local new_kb=$((new_size / 1024))
  local ratio=0
  if [ "$orig_size" -gt 0 ]; then
    ratio=$(( (orig_size - new_size) * 100 / orig_size ))
  fi

  echo "Compressed: $in_file (${orig_kb}KB) -> $out_file (${new_kb}KB, saved ${ratio}%)"
}

if [ $# -eq 0 ]; then
  echo "Usage: $0 <image_file_or_directory> [output_file] [max_dimension] [quality]"
  exit 1
fi

TARGET="$1"

if [ -d "$TARGET" ]; then
  echo "Compressing all images in directory: $TARGET"
  find "$TARGET" -maxdepth 1 -type f \( -name "*.png" -o -name "*.PNG" -o -name "*.jpeg" -o -name "*.jpg" \) | while read -r img; do
    # avoid re-compressing already compressed .jpg if target is the same
    if [[ "$img" == *.compressed.jpg ]]; then continue; fi
    out_jpg="${img%.*}.jpg"
    compress_single "$img" "$out_jpg"
  done
elif [ -f "$TARGET" ]; then
  OUT="${2:-}"
  compress_single "$TARGET" "$OUT"
else
  echo "Error: Target $TARGET not found" >&2
  exit 1
fi
