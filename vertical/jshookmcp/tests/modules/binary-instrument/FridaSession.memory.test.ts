import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FridaSession } from '@modules/binary-instrument/FridaSession';
import { probeCommand } from '@modules/external/ToolProbe';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file, _args, _options, cb) => {
    cb(null, '__frida_attach_ok__', '');
  }),
}));

vi.mock('@modules/external/ToolProbe', () => ({
  probeCommand: vi.fn(),
}));

// Frida execFile mocking follows the established pattern in FridaSession.test.ts
// (cast execFile to any so mockImplementation + mock.calls stay ergonomic).
/* eslint-disable @typescript-eslint/no-explicit-any */
const getExecFile = async (): Promise<any> => (await import('node:child_process')).execFile as any;

describe('FridaSession memory scan/read', () => {
  let session: FridaSession;

  beforeEach(async () => {
    vi.clearAllMocks();
    (probeCommand as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      available: true,
      path: '/usr/bin/frida',
      version: '16.0.0',
    });
    session = new FridaSession();
    await session.attach('1234');
  });

  it('memoryScan scans readable ranges and parses matches', async () => {
    const execFile = await getExecFile();
    execFile.mockImplementation((_file: any, args: any[], _opts: any, cb: any) => {
      const script = args.at(-1);
      cb(
        null,
        typeof script === 'string' && script.includes('Memory.scanSync')
          ? '[{"address":"0x1000","size":4},{"address":"0x2000","size":4}]'
          : '__frida_attach_ok__',
        '',
      );
    });

    const matches = await session.memoryScan('cafebabe', { max: 10 });
    expect(matches).toEqual([
      { address: '0x1000', size: 4 },
      { address: '0x2000', size: 4 },
    ]);
  });

  it('memoryScan scopes to a named module when provided', async () => {
    const execFile = await getExecFile();
    execFile.mockImplementation((_file: any, _args: any, _opts: any, cb: any) => {
      cb(null, '[]', '');
    });

    await session.memoryScan('deadbeef', { moduleName: 'libfoo.so' });
    const script = execFile.mock.calls.at(-1)?.[1]?.at(-1);
    expect(script).toContain('Process.getModuleByName');
    expect(script).toContain('libfoo.so');
    expect(script).toContain('Memory.scanSync');
  });

  it('memoryScan uses an explicit address+size range when provided', async () => {
    const execFile = await getExecFile();
    execFile.mockImplementation((_file: any, _args: any, _opts: any, cb: any) => {
      cb(null, '[]', '');
    });

    await session.memoryScan('deadbeef', { address: '0x4000', size: 4096 });
    const script = execFile.mock.calls.at(-1)?.[1]?.at(-1);
    expect(script).toContain('ptr("0x4000")');
    expect(script).toContain('4096');
    expect(script).not.toContain('enumerateRanges');
  });

  it('memoryScan returns empty for an empty pattern without invoking Frida', async () => {
    const execFile = await getExecFile();
    const callsBefore = execFile.mock.calls.length;
    const matches = await session.memoryScan('   ');
    expect(matches).toEqual([]);
    expect(execFile.mock.calls.length).toBe(callsBefore);
  });

  it('memoryRead reads bytes and returns hex', async () => {
    const execFile = await getExecFile();
    execFile.mockImplementation((_file: any, args: any[], _opts: any, cb: any) => {
      const script = args.at(-1);
      cb(
        null,
        typeof script === 'string' && script.includes('readByteArray')
          ? '{"address":"0x1000","size":4,"hex":"deadbeef"}'
          : '__frida_attach_ok__',
        '',
      );
    });

    const read = await session.memoryRead('0x1000', 4);
    expect(read).toEqual({ address: '0x1000', size: 4, hex: 'deadbeef' });
    const script = execFile.mock.calls.at(-1)?.[1]?.at(-1);
    expect(script).toContain('readByteArray');
  });

  it('memoryRead caps size at 65536 bytes', async () => {
    const execFile = await getExecFile();
    execFile.mockImplementation((_file: any, _args: any, _opts: any, cb: any) => {
      cb(null, '{"address":"0x1000","size":65536,"hex":"00"}', '');
    });

    await session.memoryRead('0x1000', 999_999);
    const script = execFile.mock.calls.at(-1)?.[1]?.at(-1);
    expect(script).toContain('65536');
    expect(script).not.toContain('999999');
  });
});
