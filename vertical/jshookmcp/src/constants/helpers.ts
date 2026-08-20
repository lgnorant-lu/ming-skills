/**
 * Helper functions for parsing environment variables.
 * Used across all constant modules.
 */

import { cpus } from 'node:os';

export const int = (key: string, fallback: number): number => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const float = (key: string, fallback: number): number => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export const bool = (key: string, fallback: boolean): boolean => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const normalized = v.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
};

export const str = (key: string, fallback: string): string => process.env[key] || fallback;

export const list = (key: string, fallback: number[]): number[] => {
  const v = process.env[key];
  if (!v) return fallback;
  return v.split(',').map(Number).filter(Number.isFinite);
};

export const csv = (key: string, fallback: string[]): string[] => {
  const v = process.env[key];
  if (!v) return fallback;
  const parsed = v
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
};

/**
 * Auto-sized int: accepts "auto" (case-insensitive) to derive the value from
 * a supplier, otherwise behaves like `int(key, fallback)`.
 */
export const autoInt = (key: string, fallback: number, autoSupplier: () => number): number => {
  const v = process.env[key];
  if (v !== undefined && v.trim().toLowerCase() === 'auto') {
    const derived = autoSupplier();
    return Number.isFinite(derived) && derived > 0 ? Math.floor(derived) : fallback;
  }
  return int(key, fallback);
};

export const cpuCount = (): number => {
  try {
    return cpus().length;
  } catch {
    return 4;
  }
};
