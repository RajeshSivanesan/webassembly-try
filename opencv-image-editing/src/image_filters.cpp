/**
 * image_filters.cpp
 *
 * OpenCV image processing functions compiled to WebAssembly via Emscripten.
 *
 * Public API (extern "C", EMSCRIPTEN_KEEPALIVE):
 *   Each function receives a const pointer to the caller-owned RGBA pixel
 *   buffer plus the image dimensions.  It returns a newly malloc'd result
 *   buffer with the layout:
 *
 *       [ out_width  : int32 (4 bytes) ]
 *       [ out_height : int32 (4 bytes) ]
 *       [ RGBA pixels: uint8 * out_width * out_height * 4 bytes ]
 *
 *   The caller (JavaScript) is responsible for calling free() on the returned
 *   pointer after reading the pixel data.  Returns nullptr on error.
 *
 * Only the seven named filter functions and _free/_malloc are exported to JS.
 * All internal helpers live in an anonymous namespace.
 */

#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>
#include <emscripten.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>

using namespace cv;

// ── Internal helpers ──────────────────────────────────────────────────────────

namespace {

/// Hard limits to prevent unreasonable allocations from untrusted input.
constexpr int kMaxDimension = 4096;

bool validate_input(const uint8_t* ptr, int w, int h) {
    return ptr != nullptr
        && w > 0 && h > 0
        && w <= kMaxDimension && h <= kMaxDimension;
}

/**
 * Allocate a result buffer:  8-byte header + w*h*4 RGBA bytes.
 * Writes out_w / out_h into the header.
 * Returns nullptr on allocation failure.
 */
uint8_t* alloc_result(int out_w, int out_h) {
    if (out_w <= 0 || out_h <= 0) return nullptr;

    const size_t header_bytes = 2 * sizeof(int32_t);
    const size_t pixel_bytes  = static_cast<size_t>(out_w) * out_h * 4;

    auto* buf = static_cast<uint8_t*>(malloc(header_bytes + pixel_bytes));
    if (!buf) return nullptr;

    reinterpret_cast<int32_t*>(buf)[0] = out_w;
    reinterpret_cast<int32_t*>(buf)[1] = out_h;
    return buf;
}

/// Pointer to the pixel region of a result buffer.
inline uint8_t* pixel_data(uint8_t* result) {
    return result + 2 * sizeof(int32_t);
}

/// Wrap a caller-owned RGBA byte array in an OpenCV Mat (no copy).
inline Mat wrap_rgba(const uint8_t* data, int w, int h) {
    // const_cast is safe: we only read from this Mat.
    return Mat(h, w, CV_8UC4, const_cast<uint8_t*>(data));
}

/// Convert RGBA → grayscale → RGBA (keeps 4 channels for uniform output).
Mat to_gray_rgba(const Mat& src) {
    Mat gray, out;
    cvtColor(src, gray, COLOR_RGBA2GRAY);
    cvtColor(gray, out, COLOR_GRAY2RGBA);
    return out;
}

/// Write a Mat (RGBA, same size as original) into an allocated result buffer.
uint8_t* pack_result(const Mat& mat, int w, int h) {
    uint8_t* result = alloc_result(w, h);
    if (!result) return nullptr;
    memcpy(pixel_data(result), mat.data,
           static_cast<size_t>(w) * h * mat.elemSize());
    return result;
}

} // namespace

// ── Exported C API ────────────────────────────────────────────────────────────

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Convert the image to grayscale.
 * Output: same dimensions as input, RGBA (grey value in all three channels).
 */
EMSCRIPTEN_KEEPALIVE
uint8_t* apply_grayscale(const uint8_t* rgba_in, int width, int height) {
    if (!validate_input(rgba_in, width, height)) return nullptr;

    const Mat src = wrap_rgba(rgba_in, width, height);
    const Mat out = to_gray_rgba(src);
    return pack_result(out, width, height);
}

/**
 * Binary threshold: pixels whose grayscale value exceeds `threshold_val`
 * become white; all others become black.
 * `threshold_val` is clamped to [0, 255].
 */
EMSCRIPTEN_KEEPALIVE
uint8_t* apply_threshold_binary(const uint8_t* rgba_in, int width, int height,
                                 int threshold_val) {
    if (!validate_input(rgba_in, width, height)) return nullptr;
    threshold_val = std::max(0, std::min(255, threshold_val));

    const Mat src = wrap_rgba(rgba_in, width, height);
    Mat gray, thresh, out;
    cvtColor(src, gray, COLOR_RGBA2GRAY);
    threshold(gray, thresh, threshold_val, 255, THRESH_BINARY);
    cvtColor(thresh, out, COLOR_GRAY2RGBA);
    return pack_result(out, width, height);
}

/**
 * Otsu's thresholding: automatically determines the optimal global threshold
 * from the image's histogram.
 */
EMSCRIPTEN_KEEPALIVE
uint8_t* apply_threshold_otsu(const uint8_t* rgba_in, int width, int height) {
    if (!validate_input(rgba_in, width, height)) return nullptr;

    const Mat src = wrap_rgba(rgba_in, width, height);
    Mat gray, thresh, out;
    cvtColor(src, gray, COLOR_RGBA2GRAY);
    threshold(gray, thresh, 0, 255, THRESH_BINARY | THRESH_OTSU);
    cvtColor(thresh, out, COLOR_GRAY2RGBA);
    return pack_result(out, width, height);
}

/**
 * Adaptive threshold: computes a per-pixel threshold using a weighted average
 * of a local neighbourhood (Gaussian window, 11×11 block, C=2).
 */
EMSCRIPTEN_KEEPALIVE
uint8_t* apply_threshold_adaptive(const uint8_t* rgba_in, int width, int height) {
    if (!validate_input(rgba_in, width, height)) return nullptr;

    const Mat src = wrap_rgba(rgba_in, width, height);
    Mat gray, thresh, out;
    cvtColor(src, gray, COLOR_RGBA2GRAY);
    adaptiveThreshold(gray, thresh, 255,
                      ADAPTIVE_THRESH_GAUSSIAN_C, THRESH_BINARY,
                      /*blockSize=*/11, /*C=*/2);
    cvtColor(thresh, out, COLOR_GRAY2RGBA);
    return pack_result(out, width, height);
}

/**
 * Gaussian blur: smooth the image with a Gaussian kernel.
 * `kernel_size` is clamped to the range [3, 31] and rounded up to the nearest
 * odd integer (a requirement of OpenCV's GaussianBlur).
 */
EMSCRIPTEN_KEEPALIVE
uint8_t* apply_gaussian_blur(const uint8_t* rgba_in, int width, int height,
                              int kernel_size) {
    if (!validate_input(rgba_in, width, height)) return nullptr;

    kernel_size = std::max(3, std::min(31, kernel_size));
    if (kernel_size % 2 == 0) ++kernel_size; // must be odd

    const Mat src = wrap_rgba(rgba_in, width, height);
    Mat out;
    GaussianBlur(src, out, Size(kernel_size, kernel_size), /*sigmaX=*/0);
    return pack_result(out, width, height);
}

/**
 * Canny edge detection: highlights edges.
 * Internally converts to grayscale, applies a mild Gaussian pre-blur, then
 * runs Canny with low=50 / high=150 thresholds.
 * Output is RGBA with edges in white on a black background.
 */
EMSCRIPTEN_KEEPALIVE
uint8_t* apply_canny(const uint8_t* rgba_in, int width, int height) {
    if (!validate_input(rgba_in, width, height)) return nullptr;

    const Mat src = wrap_rgba(rgba_in, width, height);
    Mat gray, blurred, edges, out;
    cvtColor(src, gray, COLOR_RGBA2GRAY);
    GaussianBlur(gray, blurred, Size(5, 5), /*sigmaX=*/1.4);
    Canny(blurred, edges, /*threshold1=*/50, /*threshold2=*/150);
    cvtColor(edges, out, COLOR_GRAY2RGBA);
    return pack_result(out, width, height);
}

/**
 * Center-crop to the largest possible square.
 * Output dimensions: min(width, height) × min(width, height).
 */
EMSCRIPTEN_KEEPALIVE
uint8_t* apply_center_crop(const uint8_t* rgba_in, int width, int height) {
    if (!validate_input(rgba_in, width, height)) return nullptr;

    const int side = std::min(width, height);
    const int x    = (width  - side) / 2;
    const int y    = (height - side) / 2;

    const Mat src     = wrap_rgba(rgba_in, width, height);
    const Mat cropped = src(Rect(x, y, side, side)).clone();

    return pack_result(cropped, side, side);
}

#ifdef __cplusplus
} // extern "C"
#endif
