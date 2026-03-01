/// Maximum supported sequence length.
const MAX_N: usize = 94; // fib(93) is the last u64-safe value

/// Static buffer holding the computed sequence.
/// The WASM linear memory is shared with JavaScript, which reads from it directly.
static mut RESULT: [u64; MAX_N] = [0u64; MAX_N];

/// Compute the Fibonacci sequence up to `n` numbers.
///
/// Stores results in the module-internal static buffer and returns a pointer to
/// it. JavaScript retrieves the pointer via `get_result_ptr()` and reads `n`
/// u64 values from the WASM linear memory.
///
/// `n` is clamped to `MAX_N` (94) because fib(93) is the last value that fits
/// in a `u64`.
#[no_mangle]
pub extern "C" fn fibonacci(n: u32) -> u32 {
    let len = (n as usize).min(MAX_N) as u32;

    // SAFETY: single-threaded WASM, no concurrent access.
    unsafe {
        if len == 0 {
            return 0;
        }
        RESULT[0] = 0;
        if len == 1 {
            return 1;
        }
        RESULT[1] = 1;
        for i in 2..len as usize {
            RESULT[i] = RESULT[i - 1].saturating_add(RESULT[i - 2]);
        }
    }
    len
}

/// Returns the byte offset of the result buffer inside the WASM linear memory.
/// JavaScript uses this together with a `BigUint64Array` view to read the sequence.
#[no_mangle]
pub extern "C" fn get_result_ptr() -> *const u64 {
    core::ptr::addr_of!(RESULT) as *const u64
}
