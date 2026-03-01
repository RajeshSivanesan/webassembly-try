import { useState, useEffect, useCallback } from 'react';
import { loadFibonacciWasm, type FibonacciWasm } from '../wasm/fibonacci';

type Status = 'loading' | 'ready' | 'error';

interface UseFibonacciResult {
  status: Status;
  compute: (n: number) => bigint[];
  error: string | null;
}

/**
 * Loads the Fibonacci WASM module once on mount and exposes a stable `compute`
 * function that the UI can call synchronously after the module is ready.
 */
export function useFibonacci(): UseFibonacciResult {
  const [status, setStatus] = useState<Status>('loading');
  const [wasm, setWasm] = useState<FibonacciWasm | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFibonacciWasm()
      .then((instance) => {
        setWasm(instance);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
  }, []);

  const compute = useCallback(
    (n: number): bigint[] => {
      if (!wasm) return [];
      return wasm.compute(n);
    },
    [wasm],
  );

  return { status, compute, error };
}
