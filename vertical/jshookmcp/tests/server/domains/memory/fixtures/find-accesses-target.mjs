/**
 * Cooperating target for find-accesses.runtime.test.ts.
 *
 * Exposes ONE stable address that is continuously written, so the parent test
 * process can arm a DR0 write hardware breakpoint on it and capture the trap.
 *
 * Protocol: prints exactly one line `ADDR=<hex>` (the Buffer's underlying data
 * pointer via koffi.address — stable as long as `target` is alive), then loops
 * writing target[0]. The parent attaches as debugger, sets the write BP, and
 * the next write here raises EXCEPTION_SINGLE_STEP.
 *
 * Run only on Win32 + JSHOOK_NATIVE_RUNTIME=1.
 */
import koffi from 'koffi';

// Module-level so the backing memory is alive for the process lifetime.
const target = Buffer.allocUnsafeSlow(8);
target.fill(0);

// koffi.address(Buffer) → the Buffer's underlying data pointer (used the same
// way in src/native/syscall/SyscallStubBuilder.ts to pass Buffer ptrs to FFI).
const addr = koffi.address(target);
process.stdout.write(`ADDR=${addr.toString(16)}\n`);

// Continuously write offset 0 to keep tripping a size-1 write breakpoint.
let i = 0;
setInterval(() => {
  for (let k = 0; k < 2000; k++) target[0] = (i + k) & 0xff;
  i++;
}, 1);
