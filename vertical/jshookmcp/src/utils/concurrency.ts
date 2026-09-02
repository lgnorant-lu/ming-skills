/**
 * Global concurrency limiters for different resource categories.
 * Prevents OOM and event-loop starvation under heavy load.
 *
 * Usage:
 *   import { ioLimit, cpuLimit, cdpLimit } from '@utils/concurrency';
 *   const result = await ioLimit(() => runExternalTool(...));
 */
import { readEnvInteger } from '@src/config/environment';

// Lightweight p-limit compatible concurrency limiter

type LimitFunction = <T>(fn: () => Promise<T> | T) => Promise<T>;

/** Default concurrency per resource category. */
const IO_CONCURRENCY_DEFAULT = 4;
const CPU_CONCURRENCY_DEFAULT = 2;
const CDP_CONCURRENCY_DEFAULT = 2;

function pLimit(concurrency: number): LimitFunction {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be an integer >= 1');
  }

  let activeCount = 0;
  const queue: Array<() => void> = [];

  function next(): void {
    if (queue.length > 0 && activeCount < concurrency) {
      activeCount++;
      const resolve = queue.shift()!;
      resolve();
    }
  }

  function run<T>(fn: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          activeCount--;
          next();
        }
      };

      if (activeCount < concurrency) {
        activeCount++;
        void execute();
      } else {
        queue.push(() => {
          void execute();
        });
      }
    });
  }

  return run;
}

/** External CLI calls, HAR export, large file I/O */
export const ioLimit = pLimit(
  readEnvInteger(
    'JSHOOK_IO_CONCURRENCY',
    readEnvInteger('jshook_IO_CONCURRENCY', IO_CONCURRENCY_DEFAULT, { min: 1 }),
    { min: 1 },
  ),
);

/** CPU-heavy: AST parsing, deobfuscation, binary decoding */
export const cpuLimit = pLimit(
  readEnvInteger(
    'JSHOOK_CPU_CONCURRENCY',
    readEnvInteger('jshook_CPU_CONCURRENCY', CPU_CONCURRENCY_DEFAULT, { min: 1 }),
    { min: 1 },
  ),
);

/** CDP-heavy: heap snapshots, traces, profiling */
export const cdpLimit = pLimit(
  readEnvInteger(
    'JSHOOK_CDP_CONCURRENCY',
    readEnvInteger('jshook_CDP_CONCURRENCY', CDP_CONCURRENCY_DEFAULT, { min: 1 }),
    { min: 1 },
  ),
);
