/**
 * CAPTCHA solving: polling, timeouts, retries, screenshot storage.
 * Prefixes: CAPTCHA_*
 */

import { int } from './helpers.js';

/* ================================================================== */
/*  CAPTCHA solving                                                    */
/* ================================================================== */

export const CAPTCHA_SUBMIT_TIMEOUT_MS = int('CAPTCHA_SUBMIT_TIMEOUT_MS', 15_000);
export const CAPTCHA_POLL_INTERVAL_MS = int('CAPTCHA_POLL_INTERVAL_MS', 5_000);
export const CAPTCHA_RESULT_TIMEOUT_MS = int('CAPTCHA_RESULT_TIMEOUT_MS', 10_000);
export const CAPTCHA_DEFAULT_TIMEOUT_MS = int('CAPTCHA_DEFAULT_TIMEOUT_MS', 180_000);
export const CAPTCHA_MIN_TIMEOUT_MS = int('CAPTCHA_MIN_TIMEOUT_MS', 5_000);
export const CAPTCHA_MAX_TIMEOUT_MS = int('CAPTCHA_MAX_TIMEOUT_MS', 600_000);
export const CAPTCHA_MAX_RETRIES = int('CAPTCHA_MAX_RETRIES', 5);
export const CAPTCHA_DEFAULT_RETRIES = int('CAPTCHA_DEFAULT_RETRIES', 2);

/**
 * Hook-mode wait ceiling for `handleWidgetChallengeSolve` (mode='hook') —
 * caps how long the in-page callback wait may run, independent of the
 * caller-supplied timeoutMs.
 *
 * @env CAPTCHA_HOOK_TIMEOUT_MAX_MS
 * @default 30000
 */
export const CAPTCHA_HOOK_TIMEOUT_MAX_MS = int('CAPTCHA_HOOK_TIMEOUT_MAX_MS', 30_000);

/** CAPTCHA screenshot fallback directory. */
export const CAPTCHA_SCREENSHOT_FALLBACK_DIR = 'screenshots/captcha';
