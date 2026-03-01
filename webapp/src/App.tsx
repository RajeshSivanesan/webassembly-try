import { useState } from 'react';
import { useFibonacci } from './hooks/useFibonacci';
import ImageEditor from './pages/ImageEditor';
import './App.css';

const MAX_N = 94; // fib(93) is the last value that fits in u64

type Page = 'fibonacci' | 'image-editor';

// ── Fibonacci page ────────────────────────────────────────────────────────────

function FibonacciPage() {
  const { status, compute, error } = useFibonacci();
  const [n, setN] = useState<number>(10);
  const [sequence, setSequence] = useState<bigint[]>([]);

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setSequence(compute(n));
  }

  return (
    <main className="container">
      <h1>Fibonacci via WebAssembly</h1>
      <p className="subtitle">
        Sequence computed by a Rust-compiled <abbr title="WebAssembly">WASM</abbr> module.
      </p>

      {status === 'loading' && <p className="status">Loading WASM module…</p>}
      {status === 'error' && (
        <p className="status error">Failed to load WASM module: {error}</p>
      )}

      {status === 'ready' && (
        <>
          <form onSubmit={handleSubmit} className="input-row">
            <label htmlFor="n-input">
              Number of terms
              <span className="hint">(1 – {MAX_N})</span>
            </label>
            <input
              id="n-input"
              type="number"
              min={1}
              max={MAX_N}
              value={n}
              onChange={(e) => setN(Math.max(1, Math.min(MAX_N, Number(e.target.value))))}
            />
            <button type="submit">Compute</button>
          </form>

          {sequence.length > 0 && (
            <section className="result">
              <h2>
                Fibonacci({n}) — {sequence.length} term{sequence.length !== 1 ? 's' : ''}
              </h2>
              <ol className="sequence-list">
                {sequence.map((value, index) => (
                  <li key={index}>
                    <span className="index">F({index}) = {value.toString()}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </main>
  );
}

// ── Root component with tab navigation ───────────────────────────────────────

export default function App() {
  const [page, setPage] = useState<Page>('fibonacci');

  return (
    <>
      <nav className="nav-tabs">
        <button
          type="button"
          className={`nav-tab${page === 'fibonacci' ? ' active' : ''}`}
          onClick={() => setPage('fibonacci')}
        >
          Fibonacci
        </button>
        <button
          type="button"
          className={`nav-tab${page === 'image-editor' ? ' active' : ''}`}
          onClick={() => setPage('image-editor')}
        >
          Image Filters
        </button>
      </nav>

      {page === 'fibonacci'    && <FibonacciPage />}
      {page === 'image-editor' && <ImageEditor />}
    </>
  );
}
