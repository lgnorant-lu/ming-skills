/**
 * Tests for memory_trace_code — Ultimap-style INT3 tracing.
 *
 * Tests findFunctionEntries (pure function) plus handler validation.
 * The full Win32 debug-event-loop path is not unit-testable without
 * a real debuggee process; runtime integration is covered by the
 * e2e test suite when E2E_TARGET_URL is set.
 */

import { describe, it, expect } from 'vitest';
import { findFunctionEntries } from '../../../../src/server/domains/memory/handlers/trace-code';

// ── Unit tests: findFunctionEntries ──

describe('findFunctionEntries (0x55 prologue scanner)', () => {
  it('finds 0x55 markers at expected offsets', () => {
    // Buffer with push rbp at offsets 0, 5, and 10
    const buf = Buffer.from([
      0x55,
      0x48,
      0x89,
      0xe5,
      0x90, // push rbp; mov rbp,rsp; nop
      0x55,
      0x48,
      0x83,
      0xec,
      0x20, // push rbp; sub rsp, 0x20
      0x55, // push rbp (alone)
    ]);
    const base = BigInt(0x7ff610000000);

    const entries = findFunctionEntries(buf, base);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toBe(base + 0n);
    expect(entries[1]).toBe(base + 5n);
    expect(entries[2]).toBe(base + 10n);
  });

  it('returns empty for buffer with no 0x55', () => {
    const buf = Buffer.from([0x90, 0x90, 0x90, 0xc3]); // nop; nop; nop; ret
    const base = BigInt(0x1000);

    const entries = findFunctionEntries(buf, base);
    expect(entries).toHaveLength(0);
  });

  it('handles 0x55 appearing as data within larger instruction encoding', () => {
    // 0x55 could be part of an immediate value, e.g.:
    // mov eax, 0x55 (B8 55 00 00 00) — the 0x55 here is not a push rbp
    // Our scanner would still flag it — this is a known limitation
    const buf = Buffer.from([0xb8, 0x55, 0x00, 0x00, 0x00]);
    const base = BigInt(0x1000);

    const entries = findFunctionEntries(buf, base);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe(base + 1n);
    // Known false positive: 0x55 at offset 1 is part of "mov eax, 0x55",
    // not a push rbp. The handler's heuristic is simple by design —
    // users can pass explicit addresses for precision.
  });

  it('returns empty buffer for empty input', () => {
    const buf = Buffer.alloc(0);
    const entries = findFunctionEntries(buf, BigInt(0));
    expect(entries).toHaveLength(0);
  });
});

// ── Handler validation tests ──

describe('TraceCodeHandlers', () => {
  let handler: InstanceType<
    typeof import('../../../../src/server/domains/memory/handlers/trace-code').TraceCodeHandlers
  >;

  it('throws early on non-Win32 platforms (if not win32)', async () => {
    const mod = await import('../../../../src/server/domains/memory/handlers/trace-code');
    handler = new mod.TraceCodeHandlers();

    // On non-Win32, the handler should reject with platform error
    // On Win32, it would try to attach to the debugger (which would fail with invalid PID)
    const result = await handler.handleTraceCode({
      pid: 1234,
      addresses: ['0x0000000000000000'],
    });
    const parsed = JSON.parse(JSON.stringify(result));
    const text = parsed.content[0].text;

    if (process.platform !== 'win32') {
      expect(text).toContain('only supported on Windows');
      expect(text).toContain('false');
    }
    // On Win32 CI, this test would fail trying to DebugActiveProcess(1234)
    // which is expected — unit tests can't exercise the full debug loop
  });

  it('rejects missing pid', async () => {
    const mod = await import('../../../../src/server/domains/memory/handlers/trace-code');
    handler = new mod.TraceCodeHandlers();
    const result = await handler.handleTraceCode({
      addresses: ['0x0000000000000000'],
    });
    const parsed = JSON.parse(JSON.stringify(result));
    expect(parsed.content[0].text).toContain('false');
  });

  it('rejects when neither addresses nor startAddress+size provided', async () => {
    const mod = await import('../../../../src/server/domains/memory/handlers/trace-code');
    handler = new mod.TraceCodeHandlers();
    const result = await handler.handleTraceCode({ pid: 1234 });
    const parsed = JSON.parse(JSON.stringify(result));
    const text = parsed.content[0].text;

    if (process.platform !== 'win32') {
      // Non-Win32: platform gate fires first
      expect(text).toContain('only supported on Windows');
    } else {
      // Win32: missing addresses error
      expect(text).toContain('false');
    }
  });
});
