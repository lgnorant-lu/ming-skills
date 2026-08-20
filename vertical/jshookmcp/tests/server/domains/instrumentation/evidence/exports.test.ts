import { describe, expect, it } from 'vitest';
import * as exports from '@server/domains/instrumentation/evidence/index';
import { evidenceTools } from '@server/domains/instrumentation/evidence/definitions';
import { EvidenceHandlers } from '@server/domains/instrumentation/evidence/handlers';

describe('evidence domain exports', () => {
  it('should export evidenceTools', async () => {
    expect(exports.evidenceTools).toBe(evidenceTools);
  });
  it('should export EvidenceHandlers', async () => {
    expect(exports.EvidenceHandlers).toBe(EvidenceHandlers);
  });
});
