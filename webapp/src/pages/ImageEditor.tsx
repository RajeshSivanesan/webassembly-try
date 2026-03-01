import { useRef, useState, useCallback } from 'react';
import { useImageFilters } from '../hooks/useImageFilters';
import type { FilterResult } from '../wasm/imageFilters';

// ── Filter definitions ────────────────────────────────────────────────────────

type FilterId =
  | 'grayscale'
  | 'threshold_binary'
  | 'threshold_otsu'
  | 'threshold_adaptive'
  | 'gaussian_blur'
  | 'canny'
  | 'center_crop';

interface FilterDef {
  id: FilterId;
  label: string;
}

const FILTERS: FilterDef[] = [
  { id: 'grayscale',           label: 'Grayscale' },
  { id: 'threshold_binary',    label: 'Binary Threshold' },
  { id: 'threshold_otsu',      label: 'Otsu Threshold' },
  { id: 'threshold_adaptive',  label: 'Adaptive Threshold' },
  { id: 'gaussian_blur',       label: 'Gaussian Blur' },
  { id: 'canny',               label: 'Canny Edges' },
  { id: 'center_crop',         label: 'Center Crop' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Draw a FilterResult onto a canvas element and resize the canvas to match. */
function drawResult(canvas: HTMLCanvasElement, result: FilterResult): void {
  canvas.width  = result.width;
  canvas.height = result.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(result.data, result.width, result.height), 0, 0);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ImageEditor() {
  const { status, error: wasmError, module } = useImageFilters();

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const origCanvasRef   = useRef<HTMLCanvasElement>(null);
  const outCanvasRef    = useRef<HTMLCanvasElement>(null);

  // Original image data cached so we can re-apply filters without reloading.
  const imageDataRef = useRef<ImageData | null>(null);

  const [hasImage,      setHasImage]      = useState(false);
  const [activeFilter,  setActiveFilter]  = useState<FilterId>('grayscale');
  const [filterError,   setFilterError]   = useState<string | null>(null);
  const [isProcessing,  setIsProcessing]  = useState(false);

  // Parameters for filters that accept them
  const [threshold,  setThreshold]  = useState(128);   // binary threshold  0-255
  const [kernelSize, setKernelSize] = useState(5);      // gaussian kernel  3-31 (odd)

  // ── File loading ────────────────────────────────────────────────────────────

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);

        const canvas = origCanvasRef.current;
        if (!canvas) return;

        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        imageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // Clear output canvas
        const out = outCanvasRef.current;
        if (out) {
          out.width  = 0;
          out.height = 0;
        }

        setHasImage(true);
        setFilterError(null);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        setFilterError('Failed to load the selected image.');
      };

      img.src = url;
    },
    [],
  );

  // ── Filter application ──────────────────────────────────────────────────────

  const applyFilter = useCallback(() => {
    const imgData = imageDataRef.current;
    if (!module || !imgData) return;

    setIsProcessing(true);
    setFilterError(null);

    // Run synchronously – WASM filters are fast enough not to need a worker.
    try {
      let result: FilterResult | null = null;

      switch (activeFilter) {
        case 'grayscale':
          result = module.applyGrayscale(imgData);
          break;
        case 'threshold_binary':
          result = module.applyThresholdBinary(imgData, threshold);
          break;
        case 'threshold_otsu':
          result = module.applyThresholdOtsu(imgData);
          break;
        case 'threshold_adaptive':
          result = module.applyThresholdAdaptive(imgData);
          break;
        case 'gaussian_blur':
          result = module.applyGaussianBlur(imgData, kernelSize);
          break;
        case 'canny':
          result = module.applyCanny(imgData);
          break;
        case 'center_crop':
          result = module.applyCenterCrop(imgData);
          break;
      }

      if (!result) {
        setFilterError('Filter returned no output. The image may be too large or invalid.');
        return;
      }

      const out = outCanvasRef.current;
      if (out) drawResult(out, result);
    } catch (err: unknown) {
      setFilterError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  }, [module, activeFilter, threshold, kernelSize]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const needsThreshold  = activeFilter === 'threshold_binary';
  const needsKernelSize = activeFilter === 'gaussian_blur';

  return (
    <main className="ie-container">
      <h1>Image Filters via WebAssembly</h1>
      <p className="subtitle">
        Filters run in a C++/OpenCV{' '}
        <abbr title="WebAssembly">WASM</abbr> module — no data leaves your browser.
      </p>

      {/* WASM module status */}
      {status === 'loading' && (
        <p className="status">Loading OpenCV WASM module…</p>
      )}
      {status === 'error' && (
        <p className="status error">Failed to load WASM module: {wasmError}</p>
      )}

      {status === 'ready' && (
        <>
          {/* File picker */}
          <div className="ie-upload-row">
            <button
              type="button"
              className="ie-upload-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose Image…
            </button>
            <span className="hint">JPEG or PNG, up to 4096 × 4096 px</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>

          {/* Filter selector */}
          {hasImage && (
            <>
              <div className="ie-filter-row">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`ie-filter-btn${activeFilter === f.id ? ' active' : ''}`}
                    onClick={() => setActiveFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Per-filter parameters */}
              {needsThreshold && (
                <div className="ie-param-row">
                  <label htmlFor="threshold-input">
                    Threshold value
                    <span className="hint">(0 – 255)</span>
                  </label>
                  <input
                    id="threshold-input"
                    type="number"
                    min={0}
                    max={255}
                    value={threshold}
                    onChange={(e) =>
                      setThreshold(Math.max(0, Math.min(255, Number(e.target.value))))
                    }
                  />
                </div>
              )}

              {needsKernelSize && (
                <div className="ie-param-row">
                  <label htmlFor="kernel-input">
                    Kernel size
                    <span className="hint">(odd, 3 – 31)</span>
                  </label>
                  <input
                    id="kernel-input"
                    type="number"
                    min={3}
                    max={31}
                    step={2}
                    value={kernelSize}
                    onChange={(e) => {
                      let v = Number(e.target.value);
                      if (v % 2 === 0) v += 1;       // enforce odd
                      setKernelSize(Math.max(3, Math.min(31, v)));
                    }}
                  />
                </div>
              )}

              <div className="ie-apply-row">
                <button
                  type="button"
                  className="ie-apply-btn"
                  onClick={applyFilter}
                  disabled={isProcessing}
                >
                  {isProcessing ? 'Processing…' : 'Apply Filter'}
                </button>
              </div>

              {filterError && (
                <p className="status error">{filterError}</p>
              )}
            </>
          )}

          {/* Side-by-side canvases */}
          <div className="ie-canvas-row">
            <figure className="ie-canvas-wrap">
              <figcaption>Original</figcaption>
              <canvas ref={origCanvasRef} className="ie-canvas" />
            </figure>
            <figure className="ie-canvas-wrap">
              <figcaption>Processed</figcaption>
              <canvas ref={outCanvasRef} className="ie-canvas ie-canvas--out" />
            </figure>
          </div>
        </>
      )}
    </main>
  );
}
