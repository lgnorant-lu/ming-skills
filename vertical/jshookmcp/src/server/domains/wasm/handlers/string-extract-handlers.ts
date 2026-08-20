/**
 * wasm_string_extract — section-aware printable-string extraction for .wasm.
 *
 * Differs from binary-instrument's generic `binary_strings_extract` by being
 * wasm-aware: it parses the wasm section layout so every string is attributed
 * to its source section (data / code / import / export / custom), and recovers
 * function names from the custom "name" section — the primary anti-stripping /
 * deobfuscation artifact in a wasm module. Pure TS, no wabt dependency.
 */

import { readFile } from 'node:fs/promises';
import { argNumber, argStringRequired } from '@server/domains/shared/parse-args';
import { ExternalToolHandlersBase } from './external-base';
import { parseFunctionNames, parseWasmSections, type WasmFunctionName } from './binary-reader';

export interface WasmStringEntry {
  value: string;
  section: string;
  offset: number;
  categories: string[];
}

export interface WasmStringResult {
  sectionCount: number;
  totalStrings: number;
  returnedStrings: number;
  truncated: boolean;
  functionNames: WasmFunctionName[];
  bySection: Record<string, number>;
  classified: Record<string, WasmStringEntry[]>;
  strings: WasmStringEntry[];
}

/** Classify a string into high-value RE categories. */
export function classifyString(value: string): string[] {
  const cats: string[] = [];
  if (/^https?:\/\//i.test(value) || /^wss?:\/\//i.test(value)) cats.push('url');
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(value)) cats.push('ip');
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) cats.push('email');
  if (/^[0-9a-fA-F]{32,64}$/.test(value)) cats.push('hex-hash');
  if (/^[A-Za-z0-9+/]{16,}={0,2}$/.test(value)) cats.push('base64');
  if (
    /(?:^|[/\\])[\w.-]+\.(?:js|wasm|json|png|jpe?g|html?|css|so|dex|apk|proto|wat|pem|crt)(?:$|\?)/i.test(
      value,
    )
  ) {
    cats.push('file-path');
  }
  return cats;
}

function scanPrintableRuns(
  bytes: Buffer,
  start: number,
  end: number,
  minLength: number,
): Array<{ value: string; offset: number }> {
  const out: Array<{ value: string; offset: number }> = [];
  let runStart = -1;
  const flush = (rs: number, re: number): void => {
    if (re - rs >= minLength) {
      out.push({ value: bytes.subarray(rs, re).toString('latin1'), offset: rs });
    }
  };
  for (let i = start; i < end; i++) {
    const b = bytes[i]!;
    if (b >= 0x20 && b <= 0x7e) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      flush(runStart, i);
      runStart = -1;
    }
  }
  if (runStart >= 0) flush(runStart, end);
  return out;
}

export interface ExtractWasmStringsOptions {
  minLength?: number;
  maxStrings?: number;
}

export function extractWasmStrings(
  bytes: Buffer,
  opts: ExtractWasmStringsOptions = {},
): WasmStringResult {
  const minLength = Math.max(1, opts.minLength ?? 4);
  const maxStrings = Math.max(1, opts.maxStrings ?? 200);
  const sections = parseWasmSections(bytes);

  const allStrings: WasmStringEntry[] = [];
  const bySection: Record<string, number> = {};
  let functionNames: WasmFunctionName[] = [];

  for (const section of sections) {
    if (section.name === 'custom:name') {
      functionNames = parseFunctionNames(bytes, section.bodyStart, section.bodyEnd);
    }
    const found = scanPrintableRuns(bytes, section.bodyStart, section.bodyEnd, minLength);
    if (found.length === 0) continue;
    bySection[section.name] = (bySection[section.name] ?? 0) + found.length;
    for (const s of found) {
      allStrings.push({
        value: s.value,
        section: section.name,
        offset: s.offset,
        categories: classifyString(s.value),
      });
    }
  }

  const classified: Record<string, WasmStringEntry[]> = {};
  for (const s of allStrings) {
    for (const cat of s.categories) {
      (classified[cat] ??= []).push(s);
    }
  }

  const truncated = allStrings.length > maxStrings;
  const returned = allStrings.slice(0, maxStrings);

  return {
    sectionCount: sections.length,
    totalStrings: allStrings.length,
    returnedStrings: returned.length,
    truncated,
    functionNames,
    bySection,
    classified,
    strings: returned,
  };
}

export class StringExtractHandlers extends ExternalToolHandlersBase {
  async handleWasmStringExtract(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const minLength = argNumber(args, 'minLength', 4);
    const maxStrings = argNumber(args, 'maxStrings', 200);

    let bytes: Buffer;
    try {
      bytes = await readFile(inputPath);
    } catch (error) {
      return this.fail(
        `Failed to read wasm file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      const result = extractWasmStrings(bytes, { minLength, maxStrings });
      return this.ok({ inputPath, ...result });
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : String(error));
    }
  }
}
