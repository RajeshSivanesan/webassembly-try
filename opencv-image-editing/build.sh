#!/usr/bin/env bash
# build.sh — Compile image_filters.cpp to WebAssembly using Emscripten.
#
# Prerequisites:
#   • emcc must be on PATH  (run `source emsdk/emsdk_env.sh` if needed)
#   • third_party/opencv/ must be populated  (run ./setup_opencv.sh first)
#
# Output:
#   build/image_filters.js    — Emscripten JS glue (factory function)
#   build/image_filters.wasm  — WebAssembly module

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"

# Verify emcc is available
if ! command -v emcc &>/dev/null; then
  echo "ERROR: emcc not found on PATH."
  echo "Activate Emscripten first:  source emsdk/emsdk_env.sh"
  exit 1
fi

echo "Emscripten: $(emcc --version | head -1)"
echo "Build dir:  $BUILD_DIR"

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

emcmake cmake "$SCRIPT_DIR" -DCMAKE_BUILD_TYPE=Release
emmake make -j"$(nproc 2>/dev/null || echo 4)"

echo ""
echo "Build successful:"
ls -lh "$BUILD_DIR/image_filters.js" "$BUILD_DIR/image_filters.wasm"

# ── Copy to webapp public directory ───────────────────────────────────────────
WEBAPP_OPENCV="$SCRIPT_DIR/../webapp/public/opencv"
if [[ -d "$SCRIPT_DIR/../webapp" ]]; then
  mkdir -p "$WEBAPP_OPENCV"
  cp "$BUILD_DIR/image_filters.js"   "$WEBAPP_OPENCV/"
  cp "$BUILD_DIR/image_filters.wasm" "$WEBAPP_OPENCV/"
  echo "Copied to $WEBAPP_OPENCV"
fi
