export interface LineDiffOptions {
  maxLcsCells: number;
  fallback?: (oldLines: string[], newLines: string[]) => string;
}

export function buildLineDiff(
  original: string,
  transformed: string,
  options: LineDiffOptions,
): string {
  if (original === transformed) return '';

  const oldLines = original.split('\n');
  const newLines = transformed.split('\n');
  const fallback = options.fallback ?? buildFallbackLineDiff;

  let prefixEnd = 0;
  while (
    prefixEnd < oldLines.length &&
    prefixEnd < newLines.length &&
    oldLines[prefixEnd] === newLines[prefixEnd]
  ) {
    prefixEnd += 1;
  }

  let oldSuffixStart = oldLines.length;
  let newSuffixStart = newLines.length;
  while (
    oldSuffixStart > prefixEnd &&
    newSuffixStart > prefixEnd &&
    oldLines[oldSuffixStart - 1] === newLines[newSuffixStart - 1]
  ) {
    oldSuffixStart -= 1;
    newSuffixStart -= 1;
  }

  const oldMiddle = oldLines.slice(prefixEnd, oldSuffixStart);
  const newMiddle = newLines.slice(prefixEnd, newSuffixStart);
  if (exceedsLcsBudget(oldMiddle.length, newMiddle.length, options.maxLcsCells)) {
    return fallback(oldLines, newLines);
  }

  const diffLines: string[] = [];
  for (let i = 0; i < prefixEnd; i++) diffLines.push(` ${oldLines[i]}`);
  diffLines.push(...buildLcsMiddleDiff(oldMiddle, newMiddle));
  for (let i = oldSuffixStart; i < oldLines.length; i++) diffLines.push(` ${oldLines[i]}`);
  return diffLines.join('\n');
}

export function buildFallbackLineDiff(oldLines: string[], newLines: string[]): string {
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start += 1;
  }

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const removed = oldLines.slice(start, oldEnd + 1).map((line) => `-${line}`);
  const added = newLines.slice(start, newEnd + 1).map((line) => `+${line}`);
  return [...removed, ...added].join('\n');
}

function exceedsLcsBudget(m: number, n: number, maxCells: number): boolean {
  return m > 0 && n > Math.floor(maxCells / m);
}

function buildLcsMiddleDiff(oldLines: string[], newLines: string[]): string[] {
  const m = oldLines.length;
  const n = newLines.length;
  if (m === 0) return newLines.map((line) => `+${line}`);
  if (n === 0) return oldLines.map((line) => `-${line}`);

  const width = n + 1;
  const dp = new Uint32Array((m + 1) * width);

  for (let i = m - 1; i >= 0; i--) {
    const row = i * width;
    const nextRow = (i + 1) * width;
    for (let j = n - 1; j >= 0; j--) {
      dp[row + j] =
        oldLines[i] === newLines[j]
          ? dp[nextRow + j + 1]! + 1
          : Math.max(dp[nextRow + j]!, dp[row + j + 1]!);
    }
  }

  const diffLines: string[] = [];
  let i = 0;
  let j = 0;

  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      diffLines.push(` ${oldLines[i]}`);
      i += 1;
      j += 1;
      continue;
    }
    if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
      diffLines.push(`-${oldLines[i]}`);
      i += 1;
    } else {
      diffLines.push(`+${newLines[j]}`);
      j += 1;
    }
  }

  while (i < m) {
    diffLines.push(`-${oldLines[i]}`);
    i += 1;
  }
  while (j < n) {
    diffLines.push(`+${newLines[j]}`);
    j += 1;
  }

  return diffLines;
}
