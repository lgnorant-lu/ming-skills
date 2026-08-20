import type { ObfuscationType } from '@internal-types/index';

/**
 * Source lengths above this with zero newlines are classified as uglify —
 * uglify-js output is a single minified line, while real (large) sources
 * virtually always retain line breaks.
 */
const UGLIFY_TOKEN_COUNT = 1000;

/**
 * Density = non-whitespace chars / total chars. Below this the source is
 * considered low-density (whitespace-rich, i.e. not packed/minified).
 */
const DENSITY_THRESHOLD = 0.8;

/**
 * Readability score contributions (max 100). Weights reflect how strongly
 * each signal indicates human-written source: preserved formatting (+20),
 * human-meaningful identifier length (+30, the strongest single signal),
 * whitespace presence (+20) and absence of hex-escaped identifiers (+20).
 */
const SCORE_WEIGHTS = {
  /** Source contains newlines — formatting was preserved. */
  newlines: 20,
  /** Average identifier length > 3 — human-meaningful names survive. */
  identifierLength: 30,
  /** Whitespace-rich source — not packed/minified. */
  lowDensity: 20,
  /** No `_0x` / `\x` hex-escaped identifiers. */
  noHexEscaping: 20,
} as const;

/** Average identifier length above this counts as human-meaningful. */
const IDENTIFIER_LENGTH_THRESHOLD = 3;
/** Readability score ceiling (the weights above sum to this). */
const MAX_READABILITY_SCORE = 100;

export function detectObfuscationType(code: string): ObfuscationType[] {
  // Null/undefined inputs (e.g. failed script captures) must not crash on
  // .includes() — treat them as empty source.
  const src = code ?? '';
  const types: ObfuscationType[] = [];

  if (src.includes('_0x') || src.includes('\\x') || /var\s+_0x[a-f0-9]+\s*=/.test(src)) {
    types.push('javascript-obfuscator');
  }

  if (src.includes('__webpack_require__') || src.includes('webpackJsonp')) {
    types.push('webpack');
  }

  if (src.length > UGLIFY_TOKEN_COUNT && !src.includes('\n')) {
    types.push('uglify');
  }

  if (src.includes('eval') && src.includes('Function')) {
    types.push('vm-protection');
  }

  if (types.length === 0) {
    types.push('unknown');
  }

  return types;
}

export function calculateReadabilityScore(code: string): number {
  const src = code ?? '';
  let score = 0;

  if (src.includes('\n')) score += SCORE_WEIGHTS.newlines;

  const varNames = src.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) || [];
  const avgLength = varNames.reduce((sum, name) => sum + name.length, 0) / (varNames.length || 1);
  if (avgLength > IDENTIFIER_LENGTH_THRESHOLD) score += SCORE_WEIGHTS.identifierLength;

  const density = src.length > 0 ? src.replace(/\s/g, '').length / src.length : 0;
  if (density < DENSITY_THRESHOLD) score += SCORE_WEIGHTS.lowDensity;

  if (!src.includes('_0x') && !src.includes('\\x')) score += SCORE_WEIGHTS.noHexEscaping;

  return Math.min(score, MAX_READABILITY_SCORE);
}
