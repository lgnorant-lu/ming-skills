import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupAddress } from 'node:dns';

// File-level mock so the SSRF policy module resolves against a controlled
// DNS table — needed to prove the DNS-rebinding guard (a hostname that
// resolves to both public and private addresses must be treated as SSRF).
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup } from 'node:dns/promises';
import { isSsrfTarget, resolveNetworkTargets } from '@utils/network/ssrf-policy';
import { buildTestHost, buildTestUrl } from '@tests/shared/test-urls';

// The module calls lookup with { all: true }, which returns every record —
// type the mock against that overload instead of the single-address one.
type AllRecordsLookup = (
  hostname: string,
  options: { all: true; verbatim?: boolean },
) => Promise<LookupAddress[]>;
const mockLookup = vi.mocked(lookup as unknown as AllRecordsLookup);

function mockAddresses(addresses: string[]): void {
  mockLookup.mockResolvedValue(addresses.map((address) => ({ address, family: 4 })));
}

describe('network ssrf-policy DNS rebinding', () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  describe('resolveNetworkTargets', () => {
    it('returns every resolved address for a hostname', async () => {
      mockAddresses(['8.8.8.8', '1.1.1.1']);
      const targets = await resolveNetworkTargets(
        buildTestUrl('multi', { scheme: 'http', path: '/path' }),
      );
      expect(targets.isIpLiteral).toBe(false);
      expect(targets.addresses).toEqual(['8.8.8.8', '1.1.1.1']);
    });

    it('resolves IP literals without consulting DNS', async () => {
      const targets = await resolveNetworkTargets('http://10.0.0.1/path');
      expect(targets.addresses).toEqual(['10.0.0.1']);
      expect(mockLookup).not.toHaveBeenCalled();
    });
  });

  describe('isSsrfTarget', () => {
    it('blocks a hostname that resolves to both public and private addresses', async () => {
      mockAddresses(['8.8.8.8', '10.0.0.1']);
      await expect(
        isSsrfTarget(buildTestUrl('rebind', { scheme: 'http', path: '/path' })),
      ).resolves.toBe(true);
    });

    it('blocks a mixed-resolution hostname unless every address is authorized', async () => {
      mockAddresses(['8.8.8.8', '10.0.0.1']);
      // Only the private address is authorized; the public one remains a
      // rebinding vector and must still block.
      await expect(
        isSsrfTarget(buildTestUrl('rebind', { scheme: 'http', path: '/' }), {
          allowedHosts: [buildTestHost('rebind')],
          allowedCidrs: ['10.0.0.0/8'],
          allowPrivateNetwork: true,
        }),
      ).resolves.toBe(true);
    });

    it('allows a mixed-resolution hostname when every address is authorized', async () => {
      mockAddresses(['8.8.8.8', '10.0.0.1']);
      await expect(
        isSsrfTarget(buildTestUrl('rebind', { scheme: 'http', path: '/' }), {
          allowedHosts: [buildTestHost('rebind')],
          allowedCidrs: ['8.8.8.8/32', '10.0.0.0/8'],
          allowPrivateNetwork: true,
          // Plaintext HTTP to a private address needs both permissions.
          allowInsecureHttp: true,
        }),
      ).resolves.toBe(false);
    });

    it('still allows a public-only hostname', async () => {
      mockAddresses(['8.8.8.8']);
      await expect(
        isSsrfTarget(buildTestUrl('public', { scheme: 'http', path: '/path' })),
      ).resolves.toBe(false);
    });

    it('still blocks an all-private hostname without authorization', async () => {
      mockAddresses(['10.0.0.1']);
      await expect(
        isSsrfTarget(buildTestUrl('internal', { scheme: 'http', path: '/path' })),
      ).resolves.toBe(true);
    });
  });
});
