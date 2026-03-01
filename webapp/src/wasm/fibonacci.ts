/**
 * Thin wrapper around the Fibonacci WebAssembly module.
 *
 * The Rust module exposes two raw C-ABI exports:
 *   fibonacci(n: u32) -> u32   – fills the static buffer, returns actual length
 *   get_result_ptr() -> i32    – returns the byte offset of the buffer in WASM memory
 *
 * Because we use a direct WASM build (no wasm-bindgen), we load the binary via
 * fetch and instantiate it ourselves. The sequence values are read back through
 * a BigUint64Array view over the shared linear memory.
 */

interface FibonacciWasmExports {
  fibonacci: (n: number) => number;
  get_result_ptr: () => number;
  memory: WebAssembly.Memory;
}

export interface FibonacciWasm {
  /** Compute and return the Fibonacci sequence up to `n` numbers. */
  compute: (n: number) => bigint[];
}

export async function loadFibonacciWasm(): Promise<FibonacciWasm> {
  const response = await fetch('/wasm/fibonacci_wasm.wasm');
  const { instance } = await WebAssembly.instantiateStreaming(response);
  const exports = instance.exports as unknown as FibonacciWasmExports;

  return {
    compute(n: number): bigint[] {
      const length = exports.fibonacci(n);
      if (length === 0) return [];

      const ptr = exports.get_result_ptr();
      // Each u64 is 8 bytes; read `length` values starting at the returned byte offset.
      const view = new BigUint64Array(exports.memory.buffer, ptr, length);
      return Array.from(view);
    },
  };
}
