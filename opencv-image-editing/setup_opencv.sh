#!/usr/bin/env bash
# setup_opencv.sh
#
# Copies the pre-built OpenCV WASM static libraries and headers into
# third_party/opencv/ so the CMake build can find them.
#
# Usage:
#   ./setup_opencv.sh                        # auto-detect
#   ./setup_opencv.sh <SRC_ROOT>             # old-style: build subdir inside src
#   ./setup_opencv.sh <SRC_ROOT> <BUILD_ROOT> # new-style: separate cmake build dir
#
# Where SRC_ROOT contains OpenCV source (modules/, include/) and
# BUILD_ROOT contains cmake output (lib/*.a, modules/*/, cv_cpu_config.h).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$SCRIPT_DIR/third_party/opencv"

# ── Locate source + build roots ───────────────────────────────────────────────
if [[ $# -ge 2 ]]; then
  OPENCV_SRC="$1"
  OPENCV_BUILD="$2"
elif [[ $# -eq 1 ]]; then
  # Legacy single-root: build/ is a subdirectory of the source root
  OPENCV_SRC="$1"
  OPENCV_BUILD="$1/build"
else
  # Auto-detect in priority order
  # (first entry that satisfies the check wins)
  OPENCV_SRC=""
  OPENCV_BUILD=""

  # 1. New-style cmake build (separate source + build dir)
  if [[ -f "E:/Rajesh/ImageFilter/opencv_wasm_build/lib/libopencv_core.a" ]]; then
    OPENCV_SRC="E:/Rajesh/ImageFilter/opencv"
    OPENCV_BUILD="E:/Rajesh/ImageFilter/opencv_wasm_build"

  # 2. Old-style: scanbot sibling project (build/ inside source root)
  elif [[ -f "E:/Rajesh/scanbot-test-task-web-sdk-rajesh-sivanesan/UI/webassembly/imageFilter/opencv/build/lib/libopencv_core.a" ]]; then
    OPENCV_SRC="E:/Rajesh/scanbot-test-task-web-sdk-rajesh-sivanesan/UI/webassembly/imageFilter/opencv"
    OPENCV_BUILD="$OPENCV_SRC/build"
  fi

  if [[ -z "$OPENCV_SRC" ]]; then
    echo "ERROR: Could not auto-detect OpenCV WASM build."
    echo "Usage: $0 <opencv-src-root> [<opencv-build-root>]"
    echo ""
    echo "  Rebuild OpenCV for WASM first, e.g.:"
    echo "    cd E:/Rajesh/ImageFilter"
    echo "    source emsdk/emsdk_env.sh"
    echo "    emcmake cmake -S opencv -B opencv_wasm_build -G 'Unix Makefiles' ..."
    echo "    emmake make -C opencv_wasm_build opencv_imgproc -j4"
    exit 1
  fi
fi

echo "OpenCV source : $OPENCV_SRC"
echo "OpenCV build  : $OPENCV_BUILD"
echo "Target        : $TARGET_DIR"

# ── Copy ──────────────────────────────────────────────────────────────────────
# 1. Static libraries
mkdir -p "$TARGET_DIR/lib"
cp "$OPENCV_BUILD/lib/"*.a "$TARGET_DIR/lib/"

mkdir -p "$TARGET_DIR/3rdparty/lib"
cp "$OPENCV_BUILD/3rdparty/lib/"*.a "$TARGET_DIR/3rdparty/lib/" 2>/dev/null || true

# 2. Umbrella includes  (opencv2/opencv.hpp lives under include/ in the source tree)
mkdir -p "$TARGET_DIR/include"
cp -r "$OPENCV_SRC/include/." "$TARGET_DIR/include/"

# 3. Generated build-time headers (cv_cpu_config.h, cvconfig.h, opencv_modules.hpp).
#    These may live directly in BUILD_ROOT or in BUILD_ROOT/include/ depending on
#    the cmake version / layout.  Copy whichever exists.
mkdir -p "$TARGET_DIR/build"
for f in cv_cpu_config.h cvconfig.h custom_hal.hpp; do
  [[ -f "$OPENCV_BUILD/$f" ]]         && cp "$OPENCV_BUILD/$f"         "$TARGET_DIR/build/" || true
  [[ -f "$OPENCV_BUILD/include/$f" ]] && cp "$OPENCV_BUILD/include/$f" "$TARGET_DIR/build/" || true
done

mkdir -p "$TARGET_DIR/build/opencv2"
for f in cvconfig.h opencv_modules.hpp; do
  [[ -f "$OPENCV_BUILD/$f" ]]                && cp "$OPENCV_BUILD/$f"                "$TARGET_DIR/build/opencv2/" || true
  [[ -f "$OPENCV_BUILD/opencv2/$f" ]]        && cp "$OPENCV_BUILD/opencv2/$f"        "$TARGET_DIR/build/opencv2/" || true
  [[ -f "$OPENCV_BUILD/include/opencv2/$f" ]]&& cp "$OPENCV_BUILD/include/opencv2/$f" "$TARGET_DIR/build/opencv2/" || true
done

# opencv_modules.hpp is also generated into BUILD_ROOT directly by newer cmake
[[ -f "$OPENCV_BUILD/opencv_modules.hpp" ]] && \
  cp "$OPENCV_BUILD/opencv_modules.hpp" "$TARGET_DIR/build/opencv2/" || true

# 4. Per-module public headers  (SOURCE_TREE/modules/*/include/)
for mod_dir in "$OPENCV_SRC/modules"/*/include; do
  mod_name="$(basename "$(dirname "$mod_dir")")"
  mkdir -p "$TARGET_DIR/modules/$mod_name/include"
  cp -r "$mod_dir/." "$TARGET_DIR/modules/$mod_name/include/"
done

# 5. Per-module generated headers  (build/modules/*/*.hpp, *.h, *.inc)
for mod_dir in "$OPENCV_BUILD/modules"/*/; do
  mod_name="$(basename "$mod_dir")"
  mkdir -p "$TARGET_DIR/build/modules/$mod_name"
  find "$mod_dir" -maxdepth 1 \( -name "*.hpp" -o -name "*.h" -o -name "*.inc" \) \
    -exec cp {} "$TARGET_DIR/build/modules/$mod_name/" \; 2>/dev/null || true
done

echo ""
echo "Done.  third_party/opencv is ready."
echo "  libs         : $(ls "$TARGET_DIR/lib/"*.a 2>/dev/null | wc -l) .a files"
echo "  3rdparty libs: $(ls "$TARGET_DIR/3rdparty/lib/"*.a 2>/dev/null | wc -l) .a files"
