/**
 * Process inspection: hollowing detection limits, injection guards.
 * Prefixes: PROCESS_*
 */

import { int } from './helpers.js';

/* ================================================================== */
/*  Hollowing detection memory-dump limits                             */
/* ================================================================== */

/** Max differing sections to include in a hollowing-detection memory dump. */
export const PROCESS_HOLLOWING_MAX_DUMP_SECTIONS = int('PROCESS_HOLLOWING_MAX_DUMP_SECTIONS', 3);

/** Max bytes per section read during a hollowing-detection memory dump. */
export const PROCESS_HOLLOWING_MAX_BYTES_PER_SECTION = int(
  'PROCESS_HOLLOWING_MAX_BYTES_PER_SECTION',
  65_536,
);

/* ================================================================== */
/*  Static hollowing-scan confidence scoring weights                    */
/* ================================================================== */

/** Severity weights for the static scan's weighted indicator score. */
export const PROCESS_HOLLOWING_SEVERITY_WEIGHT_CRITICAL = int(
  'PROCESS_HOLLOWING_SEVERITY_WEIGHT_CRITICAL',
  100,
);
export const PROCESS_HOLLOWING_SEVERITY_WEIGHT_HIGH = int(
  'PROCESS_HOLLOWING_SEVERITY_WEIGHT_HIGH',
  60,
);
export const PROCESS_HOLLOWING_SEVERITY_WEIGHT_MEDIUM = int(
  'PROCESS_HOLLOWING_SEVERITY_WEIGHT_MEDIUM',
  30,
);
export const PROCESS_HOLLOWING_SEVERITY_WEIGHT_LOW = int(
  'PROCESS_HOLLOWING_SEVERITY_WEIGHT_LOW',
  10,
);

/** Weighted-score thresholds that select the reported confidence tier. */
export const PROCESS_HOLLOWING_SCORE_STRONG = int('PROCESS_HOLLOWING_SCORE_STRONG', 200);
export const PROCESS_HOLLOWING_SCORE_HIGH = int('PROCESS_HOLLOWING_SCORE_HIGH', 100);
export const PROCESS_HOLLOWING_SCORE_MEDIUM = int('PROCESS_HOLLOWING_SCORE_MEDIUM', 50);

/** Reported confidence values per tier (strong/high/medium/low). */
export const PROCESS_HOLLOWING_CONFIDENCE_STRONG = int('PROCESS_HOLLOWING_CONFIDENCE_STRONG', 95);
export const PROCESS_HOLLOWING_CONFIDENCE_HIGH = int('PROCESS_HOLLOWING_CONFIDENCE_HIGH', 80);
export const PROCESS_HOLLOWING_CONFIDENCE_MEDIUM = int('PROCESS_HOLLOWING_CONFIDENCE_MEDIUM', 50);
export const PROCESS_HOLLOWING_CONFIDENCE_LOW = int('PROCESS_HOLLOWING_CONFIDENCE_LOW', 20);
