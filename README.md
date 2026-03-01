# Fibonacci WebAssembly App

A single-page React application that computes the Fibonacci sequence inside a
**Rust-compiled WebAssembly module** and displays the result on screen.

```
webassembly-try/
├── fibonacci-wasm/   # Rust crate → compiled to .wasm
└── webapp/           # React + TypeScript SPA (Vite)
```

---

## Prerequisites

| Tool | Version used | Install |
|------|-------------|---------|
| Rust + Cargo | 1.93+ | https://rustup.rs |
| wasm32-unknown-unknown target | — | `rustup target add wasm32-unknown-unknown` |
| Node.js | 22+ | https://nodejs.org |
| npm | 10+ | bundled with Node |

---

## 1 — Build the WebAssembly module

```bash
cd fibonacci-wasm
cargo build --target wasm32-unknown-unknown --release
```

The compiled binary is written to:

```
fibonacci-wasm/target/wasm32-unknown-unknown/release/fibonacci_wasm.wasm
```

Copy it into the web app's public directory so the dev server and production
build can serve it:

```bash
cp fibonacci-wasm/target/wasm32-unknown-unknown/release/fibonacci_wasm.wasm \
   webapp/public/wasm/fibonacci_wasm.wasm
```

> The repository already contains a pre-built copy at
> `webapp/public/wasm/fibonacci_wasm.wasm`, so you can skip steps 1 & 2 if you
> only want to run the web app.

---

## 2 — Run the web app (development)

```bash
cd webapp
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

---

## 3 — Build the web app (production)

```bash
cd webapp
npm run build        # output goes to webapp/dist/
npm run preview      # serve the production build locally
```

---

## Architecture

### Rust / WASM (`fibonacci-wasm/`)

- **`src/lib.rs`** — the entire WASM surface:
  - `fibonacci(n: u32) -> u32` — writes the first `n` Fibonacci numbers into a
    static `[u64; 94]` buffer and returns the actual length used (capped at 94
    because *F(93)* is the last value that fits in a `u64`).
  - `get_result_ptr() -> *const u64` — returns the byte offset of that buffer
    inside WASM linear memory.
- No third-party crates, no `wasm-bindgen` — plain `#[no_mangle] extern "C"`
  exports compiled with `crate-type = ["cdylib"]`.

### Web app (`webapp/`)

```
src/
├── wasm/
│   └── fibonacci.ts      # loads the .wasm binary, wraps exports
├── hooks/
│   └── useFibonacci.ts   # React hook: async WASM init + stable compute fn
└── App.tsx               # UI: number input → calls hook → renders sequence
```

- **`fibonacci.ts`** — `fetch`es the `.wasm` file, calls
  `WebAssembly.instantiateStreaming`, then reads back the sequence through a
  `BigUint64Array` view over the shared linear memory.
- **`useFibonacci.ts`** — loads the module once on mount; exposes a synchronous
  `compute(n)` after the module is ready.
- **`App.tsx`** — a form with a number input (1 – 94) and a submit button;
  renders the sequence as a labelled list.

---

## How the WASM↔JS memory bridge works

WebAssembly modules share a contiguous linear memory with their host (the
browser). The Rust module writes Fibonacci numbers into a static array that
lives in that memory. JavaScript retrieves the byte offset of that array via
`get_result_ptr()` and wraps it in a `BigUint64Array` — no copying needed.

```
Rust (WASM)                       JavaScript
──────────────────────────────    ──────────────────────────────────
fibonacci(n)                  →   fills static buffer, returns length
get_result_ptr()              →   returns byte offset inside memory
                                  BigUint64Array(memory.buffer, ptr, length)
                                  → typed view over the same bytes
```
