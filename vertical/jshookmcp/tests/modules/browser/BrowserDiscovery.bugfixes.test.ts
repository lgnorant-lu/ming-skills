import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execFile: execFileMock }));
vi.mock('util', () => ({ promisify: () => execFileMock }));
vi.mock('@src/native/ScriptLoader', () => ({
  ScriptLoader: class {
    getScriptPath(name: string) {
      return `C:/scripts/${name}`;
    }
  },
}));

import { BrowserDiscovery } from '@modules/browser/BrowserDiscovery';

class TestBrowserDiscovery extends BrowserDiscovery {
  public async testCheckPort(pid: number, port: number): Promise<boolean> {
    return (
      this as unknown as {
        checkPort: (pid: number, port: number) => Promise<boolean>;
      }
    ).checkPort(pid, port);
  }
}

describe('BrowserDiscovery PowerShell command construction', () => {
  let discovery: TestBrowserDiscovery;

  beforeEach(() => {
    vi.clearAllMocks();
    discovery = new TestBrowserDiscovery();
  });

  it('separates Get-Process tokens with whitespace in findByProcessName', async () => {
    execFileMock.mockResolvedValue({ stdout: '' });

    await discovery.findByProcessName('chrome');

    const [, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
    const command = args.join(' ');
    expect(command).toContain('SilentlyContinue');
    expect(command).toContain('Select-Object Id');
    expect(command).not.toContain('ContinueSelect-Object');
    expect(command).not.toContain('WorkingSet64ConvertTo-Json');
  });

  it('separates checkPort pipeline tokens with whitespace', async () => {
    execFileMock.mockResolvedValue({ stdout: 'null' });

    await discovery.testCheckPort(100, 9222);

    const [, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
    const command = args.join(' ');
    expect(command).toContain('SilentlyContinue');
    expect(command).toContain('Select-Object LocalPort');
    expect(command).not.toContain('ContinueSelect-Object');
    expect(command).not.toContain('LocalPort|ConvertTo-Json');
  });
});
