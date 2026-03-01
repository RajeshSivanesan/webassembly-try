# WebAssembly Playground

A single-page React application containing two WebAssembly-powered features:

| Feature | WASM source | Toolchain |
|---------|------------|-----------|
| **Fibonacci Sequence** | Rust (`cdylib`) | `cargo` + `wasm32-unknown-unknown` |
| **Image Filters** | C++ with OpenCV | Emscripten (`emcc`) + `wasm32-emscripten` |

Both modules run entirely in the browser — no server computation, no image uploads.

```
webassembly-try/
├── fibonacci-wasm/        # Rust crate → .wasm
├── opencv-image-editing/  # C++ project → .wasm (via Emscripten + OpenCV)
└── webapp/                # React + TypeScript SPA (Vite)
```

---

## Prerequisites

### To run the pre-built app (no rebuild needed)

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 22+ | https://nodejs.org |
| npm | 10+ | bundled with Node |

The repository ships pre-built `.wasm` binaries at:
- `webapp/public/wasm/fibonacci_wasm.wasm`
- `webapp/public/opencv/image_filters.{js,wasm}`

### To rebuild the Rust WASM

| Tool | Install |
|------|---------|
| Rust + Cargo | https://rustup.rs |
| `wasm32-unknown-unknown` target | `rustup target add wasm32-unknown-unknown` |

### To rebuild the C++/OpenCV WASM

| Tool | Version used | Notes |
|------|-------------|-------|
| Emscripten SDK (emsdk) | 3.1.45 | https://emscripten.org/docs/getting_started/downloads.html |
| CMake | 3.27+ | Via `pip install cmake` or system package |
| GNU Make | 4.4+ | Must be on PATH; Ninja is **not** used (see Build Journey below) |
| Python | 3.8+ | Required by Emscripten toolchain scripts |

---

## Quick Start

```bash
cd webapp
npm install
npm run dev
```

Open http://localhost:5173 — both tabs ("Fibonacci" and "Image Filters") are
immediately usable with the pre-built binaries.

---

## Rebuilding the Fibonacci WASM (Rust)

```bash
cd fibonacci-wasm
cargo build --target wasm32-unknown-unknown --release
```

The `npm run dev` / `npm run build` scripts automatically copy the output to
`webapp/public/wasm/` via the `copy-wasm` npm script.

---

## Rebuilding the Image Filter WASM (C++ / Emscripten)

```bash
# 1. Activate the Emscripten toolchain
source /path/to/emsdk/emsdk_env.sh

# 2. Populate third_party/opencv/ with pre-built WASM libraries
cd opencv-image-editing
bash setup_opencv.sh

# 3. Compile image_filters.cpp → image_filters.{js,wasm}
#    (also copies output to webapp/public/opencv/)
bash build.sh
```

---

## Web App

```bash
cd webapp
npm install
npm run dev       # development server (localhost:5173)
npm run build     # production build → webapp/dist/
npm run preview   # serve the production build locally
```

---

## Architecture

### Fibonacci tab

```
fibonacci-wasm/src/lib.rs
  fibonacci(n) → fills static [u64; 94] buffer, returns length
  get_result_ptr() → byte offset of buffer in WASM linear memory

webapp/src/wasm/fibonacci.ts
  WebAssembly.instantiateStreaming(fetch('/wasm/fibonacci_wasm.wasm'))
  BigUint64Array(memory.buffer, ptr, length) ← zero-copy typed view

webapp/src/hooks/useFibonacci.ts  → React hook (load once on mount)
webapp/src/App.tsx                → form → hook → rendered list
```

**Memory bridge**: WASM writes into a static buffer; JS reads it through a
`BigUint64Array` view over the shared linear memory — no copying needed.

### Image Filters tab

```
opencv-image-editing/src/image_filters.cpp
  Seven EMSCRIPTEN_KEEPALIVE functions (grayscale, thresholds, blur, Canny, crop)
  Input:  RGBA byte pointer + dimensions (from JS canvas.getImageData)
  Output: [int32 width][int32 height][RGBA pixels...] in a malloc'd buffer

webapp/src/wasm/imageFilters.ts
  Injects <script src="/opencv/image_filters.js"> to define factory function
  createImageFilterModule({ locateFile }) → raw Emscripten module object
  callFilter(): malloc input → copy RGBA in → call C fn → read result → free both

webapp/src/hooks/useImageFilters.ts  → React hook
webapp/src/pages/ImageEditor.tsx     → file picker + side-by-side canvases
```

**Memory bridge**: JS allocates WASM memory with `_malloc`, copies the canvas
pixel data in, calls the C++ function, reads the result header (width/height)
and pixel bytes back into a fresh `Uint8ClampedArray<ArrayBuffer>`, then frees
both buffers. Raw pointers never leave the loader module.

---

## Image Filters Implemented

| Filter | OpenCV call | Extra parameter |
|--------|------------|-----------------|
| Grayscale | `cvtColor` (BGR→GRAY→BGRA) | — |
| Binary Threshold | `threshold(THRESH_BINARY)` | threshold value 0–255 |
| Otsu Threshold | `threshold(THRESH_BINARY \| THRESH_OTSU)` | — |
| Adaptive Threshold | `adaptiveThreshold(ADAPTIVE_THRESH_GAUSSIAN_C)` | — |
| Gaussian Blur | `GaussianBlur` | kernel size (odd, 3–31) |
| Canny Edge Detection | `Canny` (with pre-blur) | — |
| Center Crop | crops to largest centred square | — |

---

## The Build Journey

> **Why this section exists**: building C++ to WebAssembly with a library as
> large as OpenCV involves a non-trivial number of moving parts. What follows is
> an honest account of what was tried, what broke, and why — useful for anyone
> attempting something similar.

### Part 1 — Fibonacci (Rust): the easy road

The Rust path is well-supported. The only tool needed beyond `cargo` is the
`wasm32-unknown-unknown` compilation target:

```bash
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release
```

**One obstacle encountered**: on Windows machine, Git ships its own
`link.exe` (in `C:\Program Files\Git\mingw64\bin\`) and it sits earlier on
`PATH` than MSVC's `link.exe`. This breaks any native compilation that goes
through the standard linker — including `cargo install wasm-pack` and any crate
that has proc-macro dependencies.

**Solution**: skip `wasm-pack` entirely. The `wasm32-unknown-unknown` target
uses LLVM's bundled LLD linker (not the system linker), so it is unaffected.
Instead of `wasm-bindgen`, the module exposes raw `#[no_mangle] extern "C"`
functions and the JS side uses `WebAssembly.instantiateStreaming` directly.
This turned out to be *cleaner* — no generated glue code, no macros, full
control over the memory layout.

---

### Part 2 — Image Filters (C++ + OpenCV): the longer road

#### Attempt 1: Link against externally pre-built OpenCV WASM libraries

The first approach was to skip rebuilding OpenCV from source and instead link
against an existing set of pre-built OpenCV WASM static libraries — nine `.a`
files totalling ~16 MB that had been compiled for a previous project.
The plan was to link `image_filters.cpp` directly against those.

**What happened**: compilation of `image_filters.cpp` succeeded, but linking
failed with a wall of `undefined symbol` errors:

```
wasm-ld: error: undefined symbol: std::__2::basic_string<char,...>::basic_string(const&)
wasm-ld: error: undefined symbol: std::__2::vector<...>::__throw_length_error
```

**Root cause**: the pre-built `.a` files were compiled years ago with an older
version of Emscripten that used an older LLVM libc++. In that version, certain
`std::string` and `std::vector` methods were out-of-line functions exported from
the library. In LLVM 17+ (used by Emscripten 3.1.45, the version on this
machine), those same methods are inlined at the call site — so the symbols
simply do not exist as link targets in the new runtime. Adding `-fexceptions` to
pull in the exception-capable libc++ did not help because the ABI mismatch is
in the standard library version itself, not just exception support.

**Conclusion**: the pre-built libraries were irreconcilably incompatible.
OpenCV had to be rebuilt from source with the installed Emscripten 3.1.45.

---

#### Attempt 2: Build OpenCV from source — first run

With the pre-built libraries ruled out, OpenCV was compiled from source using
the Emscripten toolchain. The build command:

```bash
source emsdk/emsdk_env.sh
emcmake cmake -S opencv -B opencv_wasm_build -G Ninja ...
```

**Error 1 — make program not found**:

```
CMake Error at CMakeLists.txt:104 (enable_language):
  Running 'C:/MinGW/bin;FORCE' '--version' failed
```

This bizarre error — cmake trying to execute the *string* `C:/MinGW/bin;FORCE`
as a binary — turned out to be caused by a leftover line in the OpenCV source's
`CMakeLists.txt` that someone had added during a previous experiment:

```cmake
set(CMAKE_MAKE_PROGRAM "C:/MinGW/bin" FORCE)
```

In CMake, `FORCE` is only valid inside a `set(...CACHE...)` call. Used without
`CACHE`, CMake treats the extra tokens as additional list elements and joins them
with `;`, making `CMAKE_MAKE_PROGRAM` equal to `C:/MinGW/bin;FORCE` — which
cmake then tried to run as the build tool. **Fixed by removing that line.**

**Error 2 — Ninja not found**:

After fixing the above, cmake reported that Ninja (specified with `-G Ninja`)
was not on `PATH`. Ninja had been listed in the PATH at some point but was
not installed on this machine. **Fixed by switching to `-G "Unix Makefiles"`**
(GNU Make 4.4.1 was available).

---

#### Attempt 3: cmake configuration — the compiler flag check

```
CMake Error at cmake/OpenCVCompilerOptimizations.cmake:497 (message):
  Compiler doesn't support baseline optimization flags:
```

Note: the flags string at the end of the error was *empty*. We were already
passing `-DCPU_BASELINE="" -DCPU_DISPATCH=""`, so there were no flags to check.
Yet the check was failing.

**Diagnosis**: the relevant cmake macro (`ocv_check_compiler_flag`) writes a
trivial `int main() { return 0; }` to a temp file and runs `TRY_COMPILE`. If
the compiler output matches any string in `OCV_COMPILER_FAIL_REGEX` (which
includes `"unknown .*option"`), the test is marked as failed.

Emscripten's Windows toolchain file (`Emscripten.cmake`) sets:
```cmake
set(CMAKE_EXE_LINKER_FLAGS "... /MANIFEST:NO --default-obj-ext .obj" CACHE STRING "" FORCE)
```

These Visual-Studio-style flags get forwarded into the `TRY_COMPILE` subprocess
as `-DCMAKE_EXE_LINKER_FLAGS=...`. The Emscripten linker (lld-wasm) doesn't
recognise `/MANIFEST:NO`, prints `warning: unknown option`, and the OpenCV
regex check catches that warning and declares the compiler "unsupported".

**Fix**: patched `OpenCVCompilerOptimizations.cmake` to bypass the
`TRY_COMPILE` check entirely when `EMSCRIPTEN` is defined — since Emscripten
targets WebAssembly and has no SIMD baseline flags to validate anyway:

```cmake
if(EMSCRIPTEN)
  set(HAVE_CPU_BASELINE_FLAGS 1 CACHE INTERNAL "Test HAVE_CPU_BASELINE_FLAGS")
else()
  # ... original try_compile check ...
endif()
```

---

#### Attempt 4: compilation — missing `CV_CPU_DISPATCH_FEATURES`

cmake configuration now succeeded, and compilation of `opencv_core` started.
Most files compiled cleanly, then:

```
error: use of undeclared identifier 'CV_CPU_DISPATCH_FEATURES'
  725 | const int features[] = { CV_CPU_BASELINE_FEATURES, CV_CPU_DISPATCH_FEATURES };
```

The macro `CV_CPU_DISPATCH_FEATURES` is supposed to be generated into
`cv_cpu_config.h` by cmake, mirroring `CV_CPU_BASELINE_FEATURES`. But the
cmake template only generates the `CV_CPU_DISPATCH_COMPILE_<OPT>` defines for
each listed dispatch target — when `CPU_DISPATCH=""` the section is completely
empty and `CV_CPU_DISPATCH_FEATURES` never gets defined.

Comparison of the generated file vs a reference build that worked:

```c
// This machine (broken)          // Reference build (working)
// OpenCV supported CPU           // OpenCV supported CPU
// dispatched features            // dispatched features
                                  #define CV_CPU_DISPATCH_FEATURES 0 \
```

**Fix**: patched `OpenCVCompilerOptimizations.cmake` to always emit the
`CV_CPU_DISPATCH_FEATURES` macro (as `0 \` when CPU_DISPATCH is empty), and
also added it directly to the already-generated `cv_cpu_config.h` so the
in-progress build would not need a cmake re-run.

---

#### Attempt 5: successful build

With all four fixes in place:

```bash
emmake make -C opencv_wasm_build opencv_imgproc -j4
```

Only the two modules needed were built (`core` as a dependency of `imgproc`),
avoiding the heavy `dnn`, `calib3d`, etc. modules that were enabled by default.

```
[100%] Linking CXX static library ../../lib/libopencv_core.a    (2.9 MB)
[100%] Linking CXX static library ../../lib/libopencv_imgproc.a (3.9 MB)
[100%] Built target opencv_imgproc
```

Then `bash build.sh` compiled `image_filters.cpp` against the fresh `.a` files
and linked with Emscripten:

```
[100%] Linking CXX executable image_filters.js
Build successful:
  image_filters.js    80 KB
  image_filters.wasm  1.1 MB
```

---

### Summary of what the build actually needed

| # | Problem | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | ABI mismatch in pre-built `.a` files | Compiled with old Emscripten; `std::__2` symbols changed between LLVM versions | Rebuilt OpenCV from source |
| 2 | `cmake: running 'C:/MinGW/bin;FORCE'` | Stray `set(CMAKE_MAKE_PROGRAM … FORCE)` in source `CMakeLists.txt` without `CACHE` | Removed the line |
| 3 | Ninja not found | Ninja not installed | Switched to `"Unix Makefiles"` generator |
| 4 | Compiler flag check fails for Emscripten | VS linker flags in `CMAKE_EXE_LINKER_FLAGS` produce `unknown option` warning, caught by OpenCV's compiler-test regex | Bypass `TRY_COMPILE` for `EMSCRIPTEN` |
| 5 | `CV_CPU_DISPATCH_FEATURES` undeclared | cmake template omits the macro when `CPU_DISPATCH=""` | Patched cmake template; also hand-edited generated header |

Total time from "let's use OpenCV" to "build succeeded": several hours of
reading cmake internals, Emscripten toolchain code, and comparing generated
headers against working reference builds.

---

## Lessons Learned

**Rust → WASM is nearly friction-free** when you sidestep `wasm-pack` (which
requires native compilation) and use raw C-ABI exports. The `wasm32-unknown-unknown`
target uses its own bundled linker and is completely insulated from the host
system's linker issues.

**C++ → WASM with a large library requires patience.** The main sources of
friction:

1. **Pre-built libraries are version-sensitive.** A WASM `.a` file built with
   Emscripten 2.x is not guaranteed to link with Emscripten 3.x. Always prefer
   rebuilding from source with the exact toolchain version you're using.

2. **cmake's `TRY_COMPILE` can be fooled by cross-compilation environments.**
   When Emscripten's toolchain injects linker flags designed for Visual Studio
   (`/MANIFEST:NO`), cmake's compiler-capability probes may fail even for valid
   code. Know how to bypass or override these checks.

3. **Generated headers must match the build configuration.** Many OpenCV
   macros (`CV_CPU_*`) are generated at cmake configure time. If the generation
   logic has gaps (like missing `CV_CPU_DISPATCH_FEATURES` for an empty dispatch
   list), compilation will fail with cryptic `undeclared identifier` errors that
   look unrelated to build configuration.

4. **Only build what you need.** OpenCV has 20+ modules. Building only `core`
   and `imgproc` (with `BUILD_opencv_<module>=OFF` flags) reduces build time
   from ~1 hour to ~15 minutes and avoids pulling in heavy optional dependencies
   like Protobuf (needed by `dnn`).

---

## Alternatives Worth Knowing

If you don't need a custom-trimmed binary, there are easier routes:

- **Pre-built `opencv.js`** — OpenCV's official releases ship a ready-to-use
  JS + WASM bundle loadable from CDN or via
  [`@techstark/opencv-js`](https://www.npmjs.com/package/@techstark/opencv-js)
  on npm (TypeScript types included). Zero build work required. The trade-off
  is size: the full build is ~7–8 MB versus the 1.1 MB targeted binary produced
  here.

- **Upgrading Emscripten doesn't help.** Emscripten 4.x introduces its own
  new breaking changes against OpenCV (`DEMANGLE_SUPPORT` removed, Embind
  requiring C++17) — so the cmake patching burden doesn't go away, it just
  shifts.

- **Docker is the better build environment.** OpenCV ships an official build
  script (`platforms/js/build_js.py`) designed to run inside the
  `emscripten/emsdk` Docker image. Running the build in Linux inside Docker
  avoids the Windows-specific toolchain contamination issues (`/MANIFEST:NO`
  injected into cmake flags) that caused most of the friction documented above.
