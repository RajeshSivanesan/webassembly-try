cmake_minimum_required(VERSION 3.10)
project(image_filters CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# ── OpenCV WASM root ──────────────────────────────────────────────────────────
# Override with:  cmake -DOPENCV_WASM_ROOT=/path/to/opencv-wasm ...
if(NOT DEFINED OPENCV_WASM_ROOT)
  set(OPENCV_WASM_ROOT "${CMAKE_SOURCE_DIR}/third_party/opencv")
endif()

if(NOT EXISTS "${OPENCV_WASM_ROOT}/include/opencv2/opencv.hpp")
  message(FATAL_ERROR
    "\n[image_filters] OpenCV WASM headers not found at:\n"
    "  ${OPENCV_WASM_ROOT}/include/opencv2/opencv.hpp\n\n"
    "Run  ./setup_opencv.sh  first, or pass\n"
    "  -DOPENCV_WASM_ROOT=<path>  to cmake.\n")
endif()

# ── Include directories ───────────────────────────────────────────────────────
# 1. Main opencv2 umbrella header
include_directories("${OPENCV_WASM_ROOT}/include")

# 2. Generated build-time config headers.
#    opencv2/opencv_modules.hpp lives at build/opencv2/opencv_modules.hpp,
#    so we add build/ (not build/opencv2/) so the lookup "opencv2/..." resolves.
include_directories("${OPENCV_WASM_ROOT}/build")
include_directories("${OPENCV_WASM_ROOT}/build/include")

# 3. Per-module public headers
file(GLOB_RECURSE _module_include_dirs
     LIST_DIRECTORIES true
     "${OPENCV_WASM_ROOT}/modules/*/include")
foreach(_dir IN LISTS _module_include_dirs)
  if(IS_DIRECTORY "${_dir}")
    include_directories("${_dir}")
  endif()
endforeach()

# 4. Per-module generated headers (*.simd_declarations.hpp, opencl_kernels_*.hpp)
file(GLOB _build_module_dirs
     LIST_DIRECTORIES true
     "${OPENCV_WASM_ROOT}/build/modules/*")
foreach(_dir IN LISTS _build_module_dirs)
  if(IS_DIRECTORY "${_dir}")
    include_directories("${_dir}")
  endif()
endforeach()

# ── Target ────────────────────────────────────────────────────────────────────
add_executable(image_filters src/image_filters.cpp)
target_compile_options(image_filters PRIVATE -fexceptions)

# ── Link OpenCV static libraries ──────────────────────────────────────────────
file(GLOB _opencv_libs     "${OPENCV_WASM_ROOT}/lib/*.a")
file(GLOB _3rdparty_libs   "${OPENCV_WASM_ROOT}/3rdparty/lib/*.a")
file(GLOB _opencv_core_lib "${OPENCV_WASM_ROOT}/lib/libopencv_core.a")

# Link order matters: link all modules, then 3rdparty, then core again to
# resolve circular dependencies (known OpenCV WASM build quirk).
target_link_libraries(image_filters
  ${_opencv_libs}
  ${_3rdparty_libs}
  ${_opencv_core_lib}
)

# ── Emscripten linker flags ───────────────────────────────────────────────────
set(_exported_functions
  "_malloc,_free\
,_apply_grayscale\
,_apply_threshold_binary\
,_apply_threshold_otsu\
,_apply_threshold_adaptive\
,_apply_gaussian_blur\
,_apply_canny\
,_apply_center_crop"
)

set(_link_flags
  "-s MODULARIZE=1"
  "-s EXPORT_NAME=createImageFilterModule"
  "-s EXPORTED_FUNCTIONS=[${_exported_functions}]"
  # HEAPU8/HEAP32 are always present on the module object in Emscripten >=3.x
  # and do not need to be listed in EXPORTED_RUNTIME_METHODS.
  "-s EXPORTED_RUNTIME_METHODS=[]"
  "-s ALLOW_MEMORY_GROWTH=1"
  "-s INITIAL_MEMORY=33554432"   # 32 MB — enough for a 4K RGBA image
  "-s ENVIRONMENT=web"
  "-fexceptions"
  "-O2"
)

# CMake requires LINK_FLAGS as a single space-separated string
string(JOIN " " _link_flags_str ${_link_flags})
set_target_properties(image_filters PROPERTIES LINK_FLAGS "${_link_flags_str}")
