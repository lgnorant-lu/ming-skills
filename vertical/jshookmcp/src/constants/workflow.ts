/**
 * Workflow engine: batch execution, account registration, bundle fetching.
 * Prefixes: WORKFLOW_*
 */

import { int } from './helpers.js';

/* ================================================================== */
/*  Workflow engine                                                    */
/* ================================================================== */

export const WORKFLOW_BATCH_MAX_ACCOUNTS = int('WORKFLOW_BATCH_MAX_ACCOUNTS', 50);
export const WORKFLOW_BATCH_MAX_CONCURRENCY = int('WORKFLOW_BATCH_MAX_CONCURRENCY', 1);
export const WORKFLOW_REGISTER_ACCOUNT_TIMEOUT_MS = int(
  'WORKFLOW_REGISTER_ACCOUNT_TIMEOUT_MS',
  60_000,
);
export const WORKFLOW_ACTION_DELAY_MS = int('WORKFLOW_ACTION_DELAY_MS', 1_000);
export const WORKFLOW_SETTLE_DELAY_MS = int('WORKFLOW_SETTLE_DELAY_MS', 2_000);
export const WORKFLOW_INPUT_DELAY_MS = int('WORKFLOW_INPUT_DELAY_MS', 1_500);

export const WORKFLOW_BATCH_MAX_RETRIES = int('WORKFLOW_BATCH_MAX_RETRIES', 3);
export const WORKFLOW_BATCH_MAX_BACKOFF_MS = int('WORKFLOW_BATCH_MAX_BACKOFF_MS', 30_000);
export const WORKFLOW_BATCH_MAX_TIMEOUT_MS = int('WORKFLOW_BATCH_MAX_TIMEOUT_MS', 300_000);
export const WORKFLOW_BATCH_RETRY_BACKOFF_MS = int('WORKFLOW_BATCH_RETRY_BACKOFF_MS', 2_000);
export const WORKFLOW_BATCH_TIMEOUT_PER_ACCOUNT_MS = int(
  'WORKFLOW_BATCH_TIMEOUT_PER_ACCOUNT_MS',
  90_000,
);
export const WORKFLOW_JS_BUNDLE_MAX_SIZE_BYTES = int(
  'WORKFLOW_JS_BUNDLE_MAX_SIZE_BYTES',
  20 * 1024 * 1024,
);
export const WORKFLOW_JS_BUNDLE_MAX_REDIRECTS = int('WORKFLOW_JS_BUNDLE_MAX_REDIRECTS', 5);
export const WORKFLOW_JS_BUNDLE_FETCH_TIMEOUT_MS = int(
  'WORKFLOW_JS_BUNDLE_FETCH_TIMEOUT_MS',
  30_000,
);
export const WORKFLOW_BUNDLE_CACHE_TTL_MS = int('WORKFLOW_BUNDLE_CACHE_TTL_MS', 5 * 60 * 1000);
export const WORKFLOW_BUNDLE_CACHE_MAX_BYTES = int(
  'WORKFLOW_BUNDLE_CACHE_MAX_BYTES',
  100 * 1024 * 1024,
);
