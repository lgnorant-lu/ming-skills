import { describe, expect, it } from 'vitest';
import * as exports from '@server/domains/workflow/macro';
import { macroTools } from '@server/domains/workflow/macro/definitions';
import { MacroToolHandlers } from '@server/domains/workflow/macro/handlers';

describe('macro domain exports', () => {
  it('should export macroTools', async () => {
    expect(exports.macroTools).toBe(macroTools);
  });

  it('should export MacroToolHandlers', async () => {
    expect(exports.MacroToolHandlers).toBe(MacroToolHandlers);
  });
});
