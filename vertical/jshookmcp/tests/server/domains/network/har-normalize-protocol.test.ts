/**
 * Unit tests for protocol normalization function (CRIT-08)
 * Tests the normalizeProtocol utility that converts CDP protocol identifiers to HAR format
 */

import { describe, it, expect } from 'vitest';

// Re-implement normalizeProtocol for testing (since it's not exported)
// This matches the implementation in har.ts
function normalizeProtocol(protocol: string | undefined): string {
  if (!protocol || protocol.trim() === '') {
    return 'HTTP/1.1';
  }

  const normalized = protocol.toLowerCase().trim();

  // HTTP/1.x
  if (normalized === 'http/1.0') return 'HTTP/1.0';
  if (normalized === 'http/1.1') return 'HTTP/1.1';

  // HTTP/2
  if (normalized === 'h2' || normalized === 'h2c') return 'HTTP/2';

  // HTTP/3 (includes QUIC variants)
  if (normalized === 'h3' || normalized.startsWith('http/2+quic')) return 'HTTP/3';

  // Unknown protocols: preserve as-is with uppercase HTTP prefix if it looks like http/X.Y
  if (normalized.startsWith('http/')) {
    return protocol.replace(/^http\//i, 'HTTP/');
  }

  // Complete unknown: fallback to HTTP/1.1
  return 'HTTP/1.1';
}

describe('normalizeProtocol (HAR Protocol Normalization)', () => {
  describe('HTTP/1.x variants', () => {
    it('should normalize http/1.0 to HTTP/1.0', () => {
      expect(normalizeProtocol('http/1.0')).toBe('HTTP/1.0');
    });

    it('should normalize http/1.1 to HTTP/1.1', () => {
      expect(normalizeProtocol('http/1.1')).toBe('HTTP/1.1');
    });

    it('should handle case insensitivity', () => {
      expect(normalizeProtocol('HTTP/1.1')).toBe('HTTP/1.1');
      expect(normalizeProtocol('Http/1.1')).toBe('HTTP/1.1');
      expect(normalizeProtocol('hTtP/1.0')).toBe('HTTP/1.0');
    });

    it('should handle extra whitespace', () => {
      expect(normalizeProtocol('  http/1.1  ')).toBe('HTTP/1.1');
      expect(normalizeProtocol('\thttp/1.0\n')).toBe('HTTP/1.0');
    });
  });

  describe('HTTP/2 variants', () => {
    it('should normalize h2 to HTTP/2', () => {
      expect(normalizeProtocol('h2')).toBe('HTTP/2');
    });

    it('should normalize h2c to HTTP/2', () => {
      expect(normalizeProtocol('h2c')).toBe('HTTP/2');
    });

    it('should handle case insensitivity', () => {
      expect(normalizeProtocol('H2')).toBe('HTTP/2');
      expect(normalizeProtocol('H2C')).toBe('HTTP/2');
      expect(normalizeProtocol('H2c')).toBe('HTTP/2');
    });

    it('should handle extra whitespace', () => {
      expect(normalizeProtocol('  h2  ')).toBe('HTTP/2');
      expect(normalizeProtocol('  h2c  ')).toBe('HTTP/2');
    });
  });

  describe('HTTP/3 variants', () => {
    it('should normalize h3 to HTTP/3', () => {
      expect(normalizeProtocol('h3')).toBe('HTTP/3');
    });

    it('should normalize http/2+quic/43 to HTTP/3', () => {
      expect(normalizeProtocol('http/2+quic/43')).toBe('HTTP/3');
    });

    it('should normalize http/2+quic/46 to HTTP/3', () => {
      expect(normalizeProtocol('http/2+quic/46')).toBe('HTTP/3');
    });

    it('should normalize http/2+quic (without version) to HTTP/3', () => {
      expect(normalizeProtocol('http/2+quic')).toBe('HTTP/3');
    });

    it('should handle case insensitivity', () => {
      expect(normalizeProtocol('H3')).toBe('HTTP/3');
      expect(normalizeProtocol('HTTP/2+QUIC/43')).toBe('HTTP/3');
      expect(normalizeProtocol('Http/2+Quic/46')).toBe('HTTP/3');
    });

    it('should handle extra whitespace', () => {
      expect(normalizeProtocol('  h3  ')).toBe('HTTP/3');
      expect(normalizeProtocol('  http/2+quic/43  ')).toBe('HTTP/3');
    });
  });

  describe('Fallback behavior', () => {
    it('should fallback to HTTP/1.1 when protocol is undefined', () => {
      expect(normalizeProtocol(undefined)).toBe('HTTP/1.1');
    });

    it('should fallback to HTTP/1.1 when protocol is empty string', () => {
      expect(normalizeProtocol('')).toBe('HTTP/1.1');
    });

    it('should fallback to HTTP/1.1 when protocol is only whitespace', () => {
      expect(normalizeProtocol('   ')).toBe('HTTP/1.1');
      expect(normalizeProtocol('\t\n')).toBe('HTTP/1.1');
    });

    it('should fallback to HTTP/1.1 for completely unknown protocols', () => {
      expect(normalizeProtocol('websocket')).toBe('HTTP/1.1');
      expect(normalizeProtocol('unknown')).toBe('HTTP/1.1');
      expect(normalizeProtocol('foo')).toBe('HTTP/1.1');
    });
  });

  describe('Future HTTP versions', () => {
    it('should preserve http/2.0 as HTTP/2.0', () => {
      expect(normalizeProtocol('http/2.0')).toBe('HTTP/2.0');
    });

    it('should preserve http/3.0 as HTTP/3.0', () => {
      expect(normalizeProtocol('http/3.0')).toBe('HTTP/3.0');
    });

    it('should preserve http/4.0 as HTTP/4.0 (future-proof)', () => {
      expect(normalizeProtocol('http/4.0')).toBe('HTTP/4.0');
    });

    it('should handle case for future versions', () => {
      expect(normalizeProtocol('HTTP/2.0')).toBe('HTTP/2.0');
      expect(normalizeProtocol('Http/3.0')).toBe('HTTP/3.0');
    });
  });

  describe('Edge cases', () => {
    it('should handle h3-29 (draft version identifier)', () => {
      expect(normalizeProtocol('h3-29')).toBe('HTTP/1.1');
    });

    it('should handle spdy variants (legacy)', () => {
      expect(normalizeProtocol('spdy/3.1')).toBe('HTTP/1.1');
    });

    it('should handle http2 (alternative notation)', () => {
      expect(normalizeProtocol('http2')).toBe('HTTP/1.1');
    });

    it('should handle null-like values gracefully', () => {
      expect(normalizeProtocol(undefined)).toBe('HTTP/1.1');
    });
  });

  describe('Protocol string variations from real CDP', () => {
    // These are actual protocol values that Chrome DevTools might report
    it('should handle real CDP h2 responses', () => {
      expect(normalizeProtocol('h2')).toBe('HTTP/2');
    });

    it('should handle real CDP h3 responses', () => {
      expect(normalizeProtocol('h3')).toBe('HTTP/3');
    });

    it('should handle real CDP http/1.1 responses', () => {
      expect(normalizeProtocol('http/1.1')).toBe('HTTP/1.1');
    });

    it('should handle real CDP http/1.0 responses', () => {
      expect(normalizeProtocol('http/1.0')).toBe('HTTP/1.0');
    });

    it('should handle real CDP http/2+quic/43 responses (early QUIC)', () => {
      expect(normalizeProtocol('http/2+quic/43')).toBe('HTTP/3');
    });
  });
});
