import { describe, expect, it } from 'vitest';
import { generatePythonCode } from '@modules/emulator/EmulatorCodeGen';

describe('EmulatorCodeGen Python triple-quote escaping', () => {
  it('doubles backslashes so JSON escapes survive Python parsing intact', () => {
    // Value contains a real newline and a backslash: JSON.stringify emits \n
    // and \\, which Python would otherwise re-interpret inside the
    // triple-quoted env_code (newline -> raw newline inside a JS string
    // literal = syntax error). After escaping, the emitted line must carry
    // two backslashes per original one.
    const code = generatePythonCode({ 'navigator.userAgent': 'line1\nline2\\tail' }, false);

    expect(code).toContain('navigator.userAgent = "line1\\\\nline2\\\\\\\\tail";');
    // No raw newline must leak inside the embedded JS literal.
    expect(code).not.toContain('"line1\nline2');
  });

  it('escapes triple quotes inside values so env_code cannot terminate early', () => {
    const code = generatePythonCode({ 'window.x': 'a"""b' }, false);

    expect(code).toContain('window.x = "a\\\\"\\\\"\\\\"b";');
  });

  it('leaves plain values untouched', () => {
    const code = generatePythonCode({ 'navigator.plugins.0.name': 'plugin' }, false);

    expect(code).toContain('navigator.plugins.0.name = "plugin";');
  });
});
