import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { logger } from '@utils/logger';
import {
  JSCRAMBLER_JOB_TIMEOUT_MS,
  resolveJscramblerCoreUrl,
  type JscramblerPool,
} from './jscrambler-worker';
import { resolveBabelUrls } from './babel-urls';
import {
  createJscramblerCore,
  type JscramblerCoreBabel,
  type JscramblerLog,
  type JscramblerLogEntry,
} from './jscrambler-core';

export interface JScramberDeobfuscatorOptions {
  code: string;
  removeDeadCode?: boolean;
  restoreControlFlow?: boolean;
  decryptStrings?: boolean;
  simplifyExpressions?: boolean;
}

export interface JScramberDeobfuscatorResult {
  code: string;
  success: boolean;
  transformations: string[];
  warnings: string[];
  confidence: number;
}

/** Babel runtime surface for the shared core (matches the `@babel/*` imports). */
const CORE_BABEL: JscramblerCoreBabel = { parser, traverse, generate, types: t };

/**
 * The shared pass core — single source of truth for the main-thread path. The
 * worker path runs the *same* module (see `jscrambler-worker.ts`), loaded from
 * its resolved `file://` URL inside the eval worker.
 */
const core = createJscramblerCore(CORE_BABEL);

/** Forward the core's injected log calls to the real logger. */
const LOG_TO_LOGGER: JscramblerLog = (level, message, error) => {
  if (level === 'info') {
    logger.info(message);
  } else if (level === 'warn') {
    logger.warn(message, error);
  } else {
    logger.error(message, error);
  }
};

/** Replay worker-collected log entries through the main-thread logger. */
function replayWorkerLogs(logs: JscramblerLogEntry[] | undefined): void {
  if (!logs) {
    return;
  }
  for (const entry of logs) {
    if (entry.level === 'info') {
      logger.info(entry.message);
    } else if (entry.level === 'warn') {
      logger.warn(entry.message, entry.error);
    } else {
      logger.error(entry.message, entry.error);
    }
  }
}

export class JScramberDeobfuscator {
  async deobfuscate(
    options: JScramberDeobfuscatorOptions,
    pool?: JscramblerPool,
  ): Promise<JScramberDeobfuscatorResult> {
    const {
      code,
      removeDeadCode = true,
      restoreControlFlow = true,
      decryptStrings = true,
      simplifyExpressions = true,
    } = options;

    // Worker path: run the Babel parse + five traverse passes off the event
    // loop. The main thread only posts `{ code, babelUrls, coreUrl, options }`
    // and receives the deobfuscated result back.
    if (pool) {
      const result = await pool.submit(
        {
          code,
          babelUrls: resolveBabelUrls(),
          coreUrl: resolveJscramblerCoreUrl(),
          options: { removeDeadCode, restoreControlFlow, decryptStrings, simplifyExpressions },
        },
        JSCRAMBLER_JOB_TIMEOUT_MS,
      );

      // The worker runs the core with a log collector (an eval worker has no
      // `@utils/logger`); replay those entries here so the off-thread path
      // keeps the same logging instrumentation as the main-thread path.
      replayWorkerLogs(result.logs);
      const { logs: _logs, ...withoutLogs } = result;
      return withoutLogs;
    }

    return core.deobfuscate(
      code,
      { removeDeadCode, restoreControlFlow, decryptStrings, simplifyExpressions },
      LOG_TO_LOGGER,
    );
  }
}
