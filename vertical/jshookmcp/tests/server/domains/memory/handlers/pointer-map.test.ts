import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PointerMapHandlers } from '../../../../../src/server/domains/memory/handlers/pointer-map';

function parseResponse(response: unknown): Record<string, unknown> {
  const r = response as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0]!.text);
}

describe('PointerMapHandlers', () => {
  let handlers: PointerMapHandlers;
  let tmpDir: string;

  beforeEach(() => {
    handlers = new PointerMapHandlers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-map-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('save', () => {
    it('saves entries to a .ptr.json file and returns success', async () => {
      const entries = [
        { address: '0x7FF612340000', value: '0x0000000000000064', label: 'health' },
        { address: '0x7FF612340010', value: '0x00000000000000C8', moduleName: 'game.exe' },
      ];

      const response = await handlers.handlePointerMap({
        action: 'save',
        name: 'test-scan',
        pid: 1234,
        targetAddress: '0x7FF612340000',
        entries,
        projectRoot: tmpDir,
      });

      const parsed = parseResponse(response);
      expect(parsed.success).toBe(true);
      expect(parsed.totalEntries).toBe(2);
      expect(parsed.name).toBe('test-scan');

      // Verify file exists
      const ptrDir = path.join(tmpDir, '.ptr');
      expect(fs.existsSync(ptrDir)).toBe(true);
      const files = fs.readdirSync(ptrDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe('test-scan.ptr.json');

      // Verify file content
      const raw = fs.readFileSync(path.join(ptrDir, files[0]!), 'utf-8');
      const parsed_file = JSON.parse(raw);
      expect(parsed_file.version).toBe(1);
      expect(parsed_file.pid).toBe(1234);
      expect(parsed_file.entries).toHaveLength(2);
      expect(parsed_file.entries[0].address).toBe('0x7FF612340000');
      expect(parsed_file.entries[0].label).toBe('health');
    });

    it('rejects empty entries array', async () => {
      const response = await handlers.handlePointerMap({
        action: 'save',
        name: 'empty',
        pid: 1234,
        targetAddress: '0x0',
        entries: [],
        projectRoot: tmpDir,
      });

      const parsed = parseResponse(response);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('non-empty array');
    });

    it('rejects missing name', async () => {
      const response = await handlers.handlePointerMap({
        action: 'save',
        pid: 1234,
        targetAddress: '0x0',
        entries: [{ address: '0x1', value: '0x2' }],
        projectRoot: tmpDir,
      });

      const parsed = parseResponse(response);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('name');
    });

    it('sanitizes name to prevent path traversal', async () => {
      const response = await handlers.handlePointerMap({
        action: 'save',
        name: '../../../etc/passwd',
        pid: 1234,
        targetAddress: '0x0',
        entries: [{ address: '0x1', value: '0x2' }],
        projectRoot: tmpDir,
      });

      const parsed = parseResponse(response);
      expect(parsed.success).toBe(true);
      // The filename should be sanitized, not contain path segments
      const ptrDir = path.join(tmpDir, '.ptr');
      const files = fs.readdirSync(ptrDir);
      expect(files[0]).not.toContain('/');
      expect(files[0]).not.toContain('\\');
      // Should not have raw ".." traversal segments
      expect(files[0]).not.toMatch(/(^|\/)\.\.(\/|$)/);
    });
  });

  describe('load', () => {
    it('loads a previously saved pointer map', async () => {
      // Save first
      const entries = [
        { address: '0x7FF612340000', value: '0x64' },
        { address: '0x7FF612340008', value: '0xC8' },
      ];
      await handlers.handlePointerMap({
        action: 'save',
        name: 'load-test',
        pid: 5678,
        targetAddress: '0x7FF612340000',
        entries,
        projectRoot: tmpDir,
      });

      // Load
      const response = await handlers.handlePointerMap({
        action: 'load',
        name: 'load-test',
        projectRoot: tmpDir,
      });

      const parsed = parseResponse(response);
      expect(parsed.success).toBe(true);
      expect(parsed.map).toBeDefined();
      const map = parsed.map as { pid: number; entries: unknown[] };
      expect(map.pid).toBe(5678);
      expect(map.entries).toHaveLength(2);
    });

    it('rejects non-existent file', async () => {
      const response = await handlers.handlePointerMap({
        action: 'load',
        name: 'nonexistent',
        projectRoot: tmpDir,
      });

      const parsed = parseResponse(response);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('not found');
    });

    it('loads by absolute filePath', async () => {
      // Save first
      await handlers.handlePointerMap({
        action: 'save',
        name: 'by-path',
        pid: 1,
        targetAddress: '0x0',
        entries: [{ address: '0x1', value: '0x2' }],
        projectRoot: tmpDir,
      });

      const filePath = path.join(tmpDir, '.ptr', 'by-path.ptr.json');
      const response = await handlers.handlePointerMap({
        action: 'load',
        filePath,
        projectRoot: tmpDir,
      });

      const parsed = parseResponse(response);
      expect(parsed.success).toBe(true);
      expect((parsed.map as { totalEntries: number }).totalEntries).toBe(1);
    });
  });

  describe('compare', () => {
    it('finds intersection across 2 pointer maps', async () => {
      // Save map 1
      await handlers.handlePointerMap({
        action: 'save',
        name: 'instance-1',
        pid: 100,
        targetAddress: '0x7FF612340000',
        entries: [
          { address: '0x7FF612340000', value: '0x64' },
          { address: '0x7FF612340010', value: '0xC8' },
          { address: '0x7FF612340020', value: '0x12C' },
        ],
        projectRoot: tmpDir,
      });

      // Save map 2 — only first two addresses overlap
      await handlers.handlePointerMap({
        action: 'save',
        name: 'instance-2',
        pid: 100,
        targetAddress: '0x7FF612350000',
        entries: [
          { address: '0x7FF612340000', value: '0x64' },
          { address: '0x7FF612340010', value: '0xC8' },
          { address: '0x7FF612340030', value: '0x190' },
        ],
        projectRoot: tmpDir,
      });

      const response = await handlers.handlePointerMap({
        action: 'compare',
        names: ['instance-1', 'instance-2'],
        projectRoot: tmpDir,
      });

      const parsed = parseResponse(response);
      expect(parsed.success).toBe(true);
      expect(parsed.filesCompared).toBe(2);
      expect(parsed.intersectionCount).toBe(2);
      expect(parsed.totalUniqueAddresses).toBe(4);
      expect(parsed.perMapCounts).toEqual([3, 3]);
    });

    it('finds intersection across 3 pointer maps', async () => {
      const common = { address: '0x7FF612340000', value: '0x64' };

      for (let i = 1; i <= 3; i += 1) {
        const entries = [common];
        if (i === 1) entries.push({ address: '0x7FF612340010', value: '0xC8' });
        if (i === 2) entries.push({ address: '0x7FF612340020', value: '0x12C' });
        if (i === 3) entries.push({ address: '0x7FF612340030', value: '0x190' });

        await handlers.handlePointerMap({
          action: 'save',
          name: `triple-${i}`,
          pid: 100,
          targetAddress: '0x7FF612340000',
          entries,
          projectRoot: tmpDir,
        });
      }

      const response = await handlers.handlePointerMap({
        action: 'compare',
        names: ['triple-1', 'triple-2', 'triple-3'],
        projectRoot: tmpDir,
      });

      const parsed = parseResponse(response);
      expect(parsed.success).toBe(true);
      expect(parsed.intersectionCount).toBe(1); // Only the common address
      expect(parsed.totalUniqueAddresses).toBe(4);
    });

    it('rejects compare with less than 2 maps', async () => {
      const response = await handlers.handlePointerMap({
        action: 'compare',
        names: ['only-one'],
        projectRoot: tmpDir,
      });

      const parsed = parseResponse(response);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('at least 2');
    });

    it('rejects compare when a file is missing', async () => {
      // Save only one map
      await handlers.handlePointerMap({
        action: 'save',
        name: 'exists',
        pid: 100,
        targetAddress: '0x0',
        entries: [{ address: '0x1', value: '0x2' }],
        projectRoot: tmpDir,
      });

      const response = await handlers.handlePointerMap({
        action: 'compare',
        names: ['exists', 'missing'],
        projectRoot: tmpDir,
      });

      const parsed = parseResponse(response);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('not found');
    });
  });

  describe('dispatch', () => {
    it('rejects unknown action', async () => {
      const response = await handlers.handlePointerMap({
        action: 'bogus',
        projectRoot: tmpDir,
      });

      const parsed = parseResponse(response);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('unknown action');
    });
  });
});
