/**
 * PageLockManager — Multi-subagent coordination for WebGPU operations.
 *
 * **Problem**: WebGPU context state is not thread-safe. When multiple subagents
 * concurrently access the same page's GPU context:
 * - Shader compilation can collide with timing analysis
 * - Device.lost events can propagate across operations
 * - Command queue state becomes unpredictable
 *
 * **Solution**: Per-page exclusive locks. Each WebGPU operation acquires a lock
 * on the page ID before executing, ensuring serial access.
 *
 * **Example**:
 *   Agent A: webgpu_shader_compile (page X) — acquires lock
 *   Agent B: webgpu_timing_analysis (page X) — waits for lock
 *   Agent C: webgpu_shader_compile (page Y) — independent, runs in parallel
 *
 * **Lock Granularity**: Page-level (not global). Different pages can run WebGPU
 * operations concurrently.
 *
 * **Deadlock Prevention**: No nested locks. All operations are single-lock,
 * release-on-completion.
 */

export class PageLockManager {
  private locks = new Map<string, Promise<void>>();

  /**
   * Execute a function with exclusive access to a page's WebGPU context.
   *
   * @param pageId - Unique page identifier (typically page.url() or frame ID)
   * @param fn - Async function to execute under lock
   * @returns Result of fn
   *
   * @throws Error from fn if operation fails
   */
  async withLock<T>(pageId: string, fn: () => Promise<T>): Promise<T> {
    // Wait for any existing lock on this page
    while (this.locks.has(pageId)) {
      await this.locks.get(pageId);
    }

    // Acquire new lock
    let releaseLock: (() => void) | undefined;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.locks.set(pageId, lockPromise);

    try {
      return await fn();
    } finally {
      // Release lock
      this.locks.delete(pageId);
      if (releaseLock) {
        releaseLock();
      }
    }
  }

  /**
   * Check if a page currently has an active lock.
   *
   * @param pageId - Page identifier
   * @returns True if locked
   */
  isLocked(pageId: string): boolean {
    return this.locks.has(pageId);
  }

  /**
   * Get count of currently held locks (for diagnostics).
   *
   * @returns Number of active locks
   */
  getActiveLockCount(): number {
    return this.locks.size;
  }

  /**
   * Clear all locks (emergency cleanup, should not be needed in normal operation).
   *
   * **Warning**: This can break in-flight operations. Only use for test cleanup
   * or error recovery.
   */
  clearAll(): void {
    this.locks.clear();
  }
}

/** Singleton instance shared across all WebGPU handlers */
let globalInstance: PageLockManager | undefined;

/**
 * Get the global PageLockManager instance.
 *
 * @returns Singleton instance
 */
export function getPageLockManager(): PageLockManager {
  if (!globalInstance) {
    globalInstance = new PageLockManager();
  }
  return globalInstance;
}

/**
 * Reset the global instance (for testing only).
 */
export function resetPageLockManager(): void {
  globalInstance = undefined;
}
