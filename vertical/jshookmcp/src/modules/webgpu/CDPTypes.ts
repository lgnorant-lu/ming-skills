/**
 * Internal types shared between CDPIntegration.ts, MemoryTracking.ts, and
 * CommandHook.ts. Not intended for external consumption — consumers should
 * import through CDPIntegration.ts (backward-compatible re-export hub).
 */

/**
 * WeakRef-based allocation record kept in the page context.
 */
export interface PageAllocationRecord {
  size: number;
  usage: number;
  label?: string;
  type: 'buffer' | 'texture';
  ref: WeakRef<any>;
}

/**
 * Hook state stored in the page context for recoverable hooks.
 *
 * Shared by MemoryTracking (allocation tracking) and CommandHook (command capture).
 */
export interface PageHookState {
  originalSubmit: typeof GPUQueue.prototype.submit;
  originalCreateCommandEncoder: typeof GPUDevice.prototype.createCommandEncoder;
  hooksInstalled: boolean;
  commandTrace: {
    commands: any[];
    totalSubmissions: number;
    startTime: number;
  } | null;
  allocations: PageAllocationRecord[];
  /**
   * GPU timestamp-query state (Fix 2). Populated when the page device supports
   * the `timestamp-query` feature; used to attach per-pass GPU durations to
   * captured commands.
   */
  timestampQuery?: {
    supported: boolean;
    /** Query set with `count` slots (2 per pass: begin + end). */
    querySet: any;
    /** Total allocated slots. */
    count: number;
    /** Next free slot index. */
    next: number;
    /** ns per GPU clock tick (device.limits.timestampPeriod). */
    timestampPeriod: number;
    /** Passes awaiting resolution: commandIndex is filled at pass end(). */
    pending: Array<{ commandIndex: number | null; begin: number; end: number }>;
    /** Resolved per-command GPU timings keyed by command index (ns). */
    results: Record<number, { startNs: number; endNs: number; elapsedNs: number }>;
    /** True when the slot pool was exhausted (further passes untimed). */
    overflow: boolean;
    /** True while an async resolveQuerySet + mapAsync chain is in flight. */
    resolving: boolean;
    /** Timestamp of the most recent resolve kick-off (ms). */
    resolveStartedAt: number;
    /** Page device used for query resolution (null when unsupported). */
    device: any;
  };
}

/** Re-exported via CDPIntegration for backward compatibility. */
export type { GPUCommandTrace } from './CommandHook';
