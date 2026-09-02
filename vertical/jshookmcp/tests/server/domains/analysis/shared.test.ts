import { describe, expect, it } from 'vitest';
import { requireCodeArg } from '@server/domains/analysis/handlers/shared';
import type { ToolArgs } from '@server/types';

describe('analysis handlers/shared requireCodeArg', () => {
  it('returns the code when it is a non-blank string', () => {
    expect(requireCodeArg({ code: 'const x = 1;' } as ToolArgs)).toBe('const x = 1;');
  });

  it('returns null when code is missing', () => {
    expect(requireCodeArg({} as ToolArgs)).toBeNull();
  });

  it('returns null when code is blank or whitespace-only', () => {
    expect(requireCodeArg({ code: '' } as ToolArgs)).toBeNull();
    expect(requireCodeArg({ code: '   ' } as ToolArgs)).toBeNull();
  });

  it('returns null when code is not a string', () => {
    expect(requireCodeArg({ code: 42 } as unknown as ToolArgs)).toBeNull();
    expect(requireCodeArg({ code: null } as unknown as ToolArgs)).toBeNull();
  });
});
