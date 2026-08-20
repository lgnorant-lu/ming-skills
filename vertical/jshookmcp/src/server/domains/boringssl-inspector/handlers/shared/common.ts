export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeHex(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9A-F]+$/i.test(value);
}
