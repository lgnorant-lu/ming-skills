/**
 * LIFO resource cleanup scope (devres RAII from Linux device-model).
 * Resources dispose in reverse registration order, each under its own
 * timeout; failures are collected, never leaking the rest.
 */
export class CleanupScope {
  private stack: Array<{ label: string; dispose: () => void | Promise<void> }> = [];

  push(label: string, dispose: () => void | Promise<void>): void {
    this.stack.push({ label, dispose });
  }

  /** Dispose all resources LIFO; per-step timeout, errors collected, returned. */
  async dispose(timeoutMs = 10_000): Promise<Error[]> {
    const errors: Error[] = [];
    while (this.stack.length > 0) {
      const { label, dispose } = this.stack.pop()!;
      try {
        await withTimeout(label, dispose, timeoutMs);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return errors;
  }
}

/** Run a dispose under a timeout; the timer is cleared on both settle paths. */
function withTimeout(
  label: string,
  dispose: () => void | Promise<void>,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Cleanup "${label}" timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    Promise.resolve(dispose()).then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
