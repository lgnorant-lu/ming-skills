/**
 * Truncate a string to `maxLength` UTF-16 code units without splitting a
 * surrogate pair (which would produce a lone surrogate and mojibake when the
 * content is later decoded or displayed).
 */
export function truncateUtf16Safe(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  let end = maxLength;
  const last = content.charCodeAt(end - 1);
  // A high surrogate at the boundary means its low surrogate was cut off.
  if (last >= 0xd800 && last <= 0xdbff) {
    end -= 1;
  }
  return content.slice(0, end);
}
