import { useState, useEffect } from 'react';
import { loadImageFilters, type ImageFilterModule } from '../wasm/imageFilters';

type Status = 'loading' | 'ready' | 'error';

export interface UseImageFiltersResult {
  status: Status;
  error: string | null;
  module: ImageFilterModule | null;
}

/**
 * Loads the OpenCV image-filter WASM module once on mount.
 * Exposes the module directly so the page component can call whichever
 * filter the user picks without extra indirection.
 */
export function useImageFilters(): UseImageFiltersResult {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [module, setModule] = useState<ImageFilterModule | null>(null);

  useEffect(() => {
    loadImageFilters()
      .then((m) => {
        setModule(m);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
  }, []);

  return { status, error, module };
}
