/**
 * Match a value against a simple wildcard pattern where `*` means
 * "any characters". Patterns without `*` are treated as literal substrings.
 */
export function matchesWildcardPattern(value: string, pattern: string): boolean {
  if (pattern.length === 0) {
    return true;
  }

  const segments = pattern.split('*').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return true;
  }

  let offset = 0;
  for (const segment of segments) {
    const nextIndex = value.indexOf(segment, offset);
    if (nextIndex === -1) {
      return false;
    }
    offset = nextIndex + segment.length;
  }

  return true;
}
