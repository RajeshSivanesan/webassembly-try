/**
 * Loader and typed wrapper for the OpenCV-based image-filter Emscripten module.
 *
 * The C++ module is built with:
 *   MODULARIZE=1  EXPORT_NAME=createImageFilterModule
 *
 * So the generated image_filters.js adds a factory function with that name.
 * We inject it as a <script> tag (the file lives under public/opencv/) and
 * then call the factory.  The module is instantiated at most once (singleton).
 *
 * Memory layout for every filter result:
 *   bytes 0-3   : out_width  (int32, little-endian)
 *   bytes 4-7   : out_height (int32, little-endian)
 *   bytes 8+    : RGBA pixels (out_width * out_height * 4 bytes)
 *
 * Security notes:
 * – All input size validation happens in C++ (max 4096×4096).
 * – We only expose the seven operations declared below; raw WASM pointers
 *   never leave this module.
 * – We always copy the pixel bytes out of WASM memory before freeing, so the
 *   caller gets a plain JS Uint8ClampedArray with no WASM dependency.
 */

// ── Emscripten raw module shape ───────────────────────────────────────────────

interface RawModule {
  // Typed-array views over linear WASM memory.
  // IMPORTANT: always access these as `this.m.HEAPU8` / `this.m.HEAP32` (not
  // cached locals) because ALLOW_MEMORY_GROWTH may replace the backing buffer.
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;

  // Memory management
  _malloc(size: number): number;
  _free(ptr: number): void;

  // Image filter exports
  _apply_grayscale(ptr: number, w: number, h: number): number;
  _apply_threshold_binary(ptr: number, w: number, h: number, threshold: number): number;
  _apply_threshold_otsu(ptr: number, w: number, h: number): number;
  _apply_threshold_adaptive(ptr: number, w: number, h: number): number;
  _apply_gaussian_blur(ptr: number, w: number, h: number, kernelSize: number): number;
  _apply_canny(ptr: number, w: number, h: number): number;
  _apply_center_crop(ptr: number, w: number, h: number): number;
}

// ── Public result type ────────────────────────────────────────────────────────

export interface FilterResult {
  /** RGBA pixel data copied into a plain ArrayBuffer – safe to hold onto. */
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

// ── Module wrapper class ──────────────────────────────────────────────────────

export class ImageFilterModule {
  private readonly m: RawModule;

  constructor(rawModule: RawModule) {
    this.m = rawModule;
  }

  /**
   * Generic bridge: copies `imageData` RGBA bytes into WASM linear memory,
   * calls the supplied filter function, reads the result header + pixels back,
   * and frees both the input and output WASM buffers.
   *
   * Returns null if the C++ code returns a null pointer (invalid input, OOM).
   */
  private callFilter(
    fn: (ptr: number, w: number, h: number, ...args: number[]) => number,
    imageData: ImageData,
    ...extra: number[]
  ): FilterResult | null {
    const { width, height, data } = imageData;
    const inputBytes = width * height * 4;

    const inPtr = this.m._malloc(inputBytes);
    if (inPtr === 0) return null;

    try {
      // Re-read HEAPU8 after malloc: memory growth may have replaced the buffer.
      this.m.HEAPU8.set(data, inPtr);

      const outPtr = fn.call(this.m, inPtr, width, height, ...extra);
      if (outPtr === 0) return null;

      try {
        // Parse the result header: [outWidth: int32][outHeight: int32][pixels...]
        const outWidth  = this.m.HEAP32[(outPtr    ) >> 2];
        const outHeight = this.m.HEAP32[(outPtr + 4) >> 2];
        const pixelBytes = outWidth * outHeight * 4;

        // Copy pixels into a fresh ArrayBuffer-backed Uint8ClampedArray.
        // Using new Uint8ClampedArray(length) + .set() guarantees the backing
        // store is a plain ArrayBuffer (not SharedArrayBuffer), which is what
        // the ImageData constructor and TypeScript's strict lib types require.
        const pixels = new Uint8ClampedArray(pixelBytes);
        pixels.set(new Uint8Array(this.m.HEAPU8.buffer, outPtr + 8, pixelBytes));

        return { data: pixels, width: outWidth, height: outHeight };
      } finally {
        this.m._free(outPtr);
      }
    } finally {
      this.m._free(inPtr);
    }
  }

  applyGrayscale(img: ImageData): FilterResult | null {
    return this.callFilter(this.m._apply_grayscale, img);
  }

  applyThresholdBinary(img: ImageData, threshold: number): FilterResult | null {
    return this.callFilter(this.m._apply_threshold_binary, img, threshold);
  }

  applyThresholdOtsu(img: ImageData): FilterResult | null {
    return this.callFilter(this.m._apply_threshold_otsu, img);
  }

  applyThresholdAdaptive(img: ImageData): FilterResult | null {
    return this.callFilter(this.m._apply_threshold_adaptive, img);
  }

  applyGaussianBlur(img: ImageData, kernelSize: number): FilterResult | null {
    return this.callFilter(this.m._apply_gaussian_blur, img, kernelSize);
  }

  applyCanny(img: ImageData): FilterResult | null {
    return this.callFilter(this.m._apply_canny, img);
  }

  applyCenterCrop(img: ImageData): FilterResult | null {
    return this.callFilter(this.m._apply_center_crop, img);
  }
}

// ── Module loading ────────────────────────────────────────────────────────────

// Extend the Window interface so TypeScript knows about the injected global.
declare global {
  interface Window {
    createImageFilterModule?: (opts: object) => Promise<RawModule>;
  }
}

/** Singleton promise – the module is instantiated at most once per page. */
let modulePromise: Promise<ImageFilterModule> | null = null;

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * Load and initialise the image-filter WASM module.
 * Safe to call multiple times – returns the same promise on subsequent calls.
 */
export async function loadImageFilters(): Promise<ImageFilterModule> {
  if (modulePromise) return modulePromise;

  modulePromise = (async () => {
    // 1. Inject the Emscripten glue script (defines createImageFilterModule).
    await injectScript('/opencv/image_filters.js');

    if (!window.createImageFilterModule) {
      throw new Error('createImageFilterModule not defined after script load');
    }

    // 2. Instantiate the WASM module; locateFile tells it where image_filters.wasm is.
    const raw = await window.createImageFilterModule({
      locateFile: (path: string) => `/opencv/${path}`,
    });

    return new ImageFilterModule(raw);
  })();

  return modulePromise;
}
