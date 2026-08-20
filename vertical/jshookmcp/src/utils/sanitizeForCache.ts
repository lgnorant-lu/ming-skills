/**
 * sanitizeForCache — recursively replaces oversized string fields with compact
 * disk-backed placeholders BEFORE data enters the cache / a tool response.
 *
 * Motivation (issue #62): a captured network request whose `url` is an inline
 * `data:image/png;base64,...` blob can be several megabytes. Stored verbatim in
 * DetailedDataManager, any later `get_detailed_data` retrieval re-emits the full
 * base64 and overflows the LLM context window. This sanitizer intercepts such
 * fields, writes the raw bytes to `artifacts/offloaded/`, and leaves behind a
 * placeholder the LLM can still reason about:
 *
 *   { _offload: { type: 'file', path, size, mimeType?, sample } }
 *
 * Properties:
 *   - cycle-safe (WeakSet guards against circular references)
 *   - idempotent (an existing `{ _offload }` placeholder is returned untouched)
 *   - cheap for primitives / small strings (returned as-is, no allocation)
 *   - synchronous disk write (mkdirSync + writeFileSync) so callers like
 *     DetailedDataManager.store() keep their synchronous signature — matching the
 *     existing sync-write precedent in McpLogTransport / PersistentCache.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { getArtifactDir, getArtifactsRoot } from '@utils/artifacts';
import { getProjectRoot } from '@utils/outputPaths';
import { OFFLOAD_FIELD_SANITIZE_THRESHOLD_BYTES } from '@src/constants';
import { logger } from '@utils/logger';

/** Matches a base64 data URI prefix, capturing the MIME type. Shared across the offload pipeline. */
export const DATA_URI_RE = /^data:([a-zA-Z0-9/+.-]+);base64,/;

/** Length (chars) of the human-readable sample retained in the placeholder. */
const SAMPLE_LENGTH = 128;

export interface OffloadFilePlaceholder {
  _offload: {
    type: 'file';
    /** Project-relative path to the offloaded file (forward slashes). */
    path: string;
    /** Human-readable size of the offloaded payload. */
    size: string;
    /** MIME type, present only when the source was a data: URI. */
    mimeType?: string;
    /** Leading slice of the original string, so the LLM knows what was removed. */
    sample: string;
  };
}

export interface SanitizeOptions {
  /** Strings longer than this (chars) are offloaded. Default: constant (64KB). */
  threshold?: number;
  /** Override the directory for offloaded files (absolute). Default: artifacts/offloaded. */
  outputDir?: string;
  /**
   * When false, oversized values are replaced with a placeholder WITHOUT writing
   * a file (no `path`). Used by defensive call sites that only need to shrink the
   * payload, not preserve it. Default: true.
   */
  writeFile?: boolean;
}

/** Format a byte count as a human-readable B/KB/MB string. Shared across the offload pipeline. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function isOffloadPlaceholder(value: object): boolean {
  return '_offload' in value;
}

/** Write raw string bytes to artifacts/offloaded and return the project-relative path. */
function writeOffloadFile(raw: string, mimeType: string | undefined, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const shortId = Math.random().toString(36).substring(2, 8);
  const ext = mimeType ? 'bin' : 'txt';
  const filename = `offload-${ts}-${shortId}.${ext}`;
  const absolutePath = resolve(outputDir, filename);

  // For a data: URI we persist the decoded bytes; otherwise the raw string.
  const dataUriMatch = mimeType ? raw.match(DATA_URI_RE) : null;
  if (dataUriMatch) {
    const base64 = raw.slice(dataUriMatch[0].length);
    writeFileSync(absolutePath, Buffer.from(base64, 'base64'));
  } else {
    writeFileSync(absolutePath, raw, 'utf8');
  }

  return relative(getProjectRoot(), absolutePath).replace(/\\/g, '/');
}

/** Build the compact placeholder for an oversized string, optionally writing the original to disk. */
function offloadString(value: string, opts: Required<SanitizeOptions>): OffloadFilePlaceholder {
  const mimeType = value.match(DATA_URI_RE)?.[1];
  const sample = value.slice(0, SAMPLE_LENGTH);

  let path = '';
  if (opts.writeFile) {
    try {
      path = writeOffloadFile(value, mimeType, opts.outputDir);
    } catch (error) {
      logger.warn(`[sanitizeForCache] Failed to offload field to disk: ${String(error)}`);
    }
  }

  return {
    _offload: {
      type: 'file',
      path,
      size: formatSize(Buffer.byteLength(value, 'utf8')),
      ...(mimeType ? { mimeType } : {}),
      sample,
    },
  };
}

/** True when a string should be offloaded: any data: URI, or any string over the threshold. */
function shouldOffloadString(value: string, threshold: number): boolean {
  return DATA_URI_RE.test(value) || value.length > threshold;
}

function sanitizeValue(
  value: unknown,
  opts: Required<SanitizeOptions>,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === 'string') {
    return shouldOffloadString(value, opts.threshold) ? offloadString(value, opts) : value;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  // Idempotent: an already-offloaded placeholder is left untouched.
  if (isOffloadPlaceholder(value)) {
    return value;
  }

  // Cycle guard (stack-scoped): if this object is an ancestor of itself we've hit
  // a cycle — return the reference to break it. We delete on exit (below) rather
  // than keeping a persistent "seen" set, so that a shared object referenced from
  // two distinct branches (a DAG, which JSON.stringify would expand anyway) is
  // sanitized at every occurrence instead of leaking the original at the second.
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    let mutated = false;
    const result = value.map((item) => {
      const sanitized = sanitizeValue(item, opts, seen);
      if (sanitized !== item) mutated = true;
      return sanitized;
    });
    seen.delete(value);
    return mutated ? result : value;
  }

  let mutated = false;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const sanitized = sanitizeValue(item, opts, seen);
    if (sanitized !== item) mutated = true;
    result[key] = sanitized;
  }
  seen.delete(value);
  return mutated ? result : value;
}

/**
 * Recursively sanitize a value for caching. Oversized strings and data: URIs are
 * replaced with disk-backed `{ _offload }` placeholders. Returns the original
 * reference unchanged when nothing needed offloading (so callers can cheaply
 * detect "no-op").
 */
export function sanitizeForCache<T>(data: T, options: SanitizeOptions = {}): T {
  const opts: Required<SanitizeOptions> = {
    threshold: options.threshold ?? OFFLOAD_FIELD_SANITIZE_THRESHOLD_BYTES,
    outputDir: options.outputDir ?? getArtifactDir('offloaded'),
    writeFile: options.writeFile ?? true,
  };
  return sanitizeValue(data, opts, new WeakSet<object>()) as T;
}

/** Exposed for tests / callers that need the default offload directory. */
export function getOffloadDir(): string {
  return getArtifactDir('offloaded');
}

/** Exposed for the offloaded-data retrieval tool: the artifacts root for containment checks. */
export function getOffloadRoot(): string {
  return getArtifactsRoot();
}
