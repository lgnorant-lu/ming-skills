import { describe, it, expect } from 'vitest';
import {
  exportCheatTable,
  importCheatTable,
  mapValueTypeToCE,
  mapCEToValueType,
  formatModuleAddress,
} from '../../src/native/CheatTableIO';
import type { CheatEntry } from '../../src/native/CheatTableIO';

describe('CheatTableIO', () => {
  describe('mapValueTypeToCE', () => {
    it('maps int32 to "4 Bytes"', () => {
      expect(mapValueTypeToCE('int32')).toBe('4 Bytes');
    });

    it('maps float to "Float"', () => {
      expect(mapValueTypeToCE('float')).toBe('Float');
    });

    it('maps pointer to "8 Bytes"', () => {
      expect(mapValueTypeToCE('pointer')).toBe('8 Bytes');
    });

    it('maps double to "Double"', () => {
      expect(mapValueTypeToCE('double')).toBe('Double');
    });

    it('maps byte to "Byte"', () => {
      expect(mapValueTypeToCE('byte')).toBe('Byte');
    });

    it('maps string to "String"', () => {
      expect(mapValueTypeToCE('string')).toBe('String');
    });

    it('maps hex to "Array of Bytes"', () => {
      expect(mapValueTypeToCE('hex')).toBe('Array of Bytes');
    });

    it('maps unknown types to "4 Bytes"', () => {
      expect(mapValueTypeToCE('unknown')).toBe('4 Bytes');
    });
  });

  describe('mapCEToValueType', () => {
    it('maps "4 Bytes" to int32', () => {
      expect(mapCEToValueType('4 Bytes')).toBe('int32');
    });

    it('maps "Float" to float', () => {
      expect(mapCEToValueType('Float')).toBe('float');
    });

    it('maps "8 Bytes" to int64', () => {
      expect(mapCEToValueType('8 Bytes')).toBe('int64');
    });

    it('maps unknown to int32', () => {
      expect(mapCEToValueType('UnknownType')).toBe('int32');
    });
  });

  describe('formatModuleAddress', () => {
    it('formats module+offset correctly', () => {
      expect(formatModuleAddress('game.exe', '0x00123456')).toBe('"game.exe"+00123456');
    });

    it('handles offset without 0x prefix', () => {
      expect(formatModuleAddress('client.dll', '00ABCDEF')).toBe('"client.dll"+00ABCDEF');
    });
  });

  describe('exportCheatTable', () => {
    it('exports empty entries', () => {
      const xml = exportCheatTable([]);
      expect(xml).toContain('<?xml version="1.0" encoding="utf-8"?>');
      expect(xml).toContain('<CheatTable CheatEngineTableVersion="45">');
      expect(xml).toContain('<CheatEntries>');
      expect(xml).toContain('</CheatEntries>');
      expect(xml).toContain('</CheatTable>');
    });

    it('exports single entry with hex address', () => {
      const entries: CheatEntry[] = [
        {
          description: 'Health',
          address: '0x7FF612340000',
          variableType: '4 Bytes',
        },
      ];
      const xml = exportCheatTable(entries);
      expect(xml).toContain('<ID>0</ID>');
      expect(xml).toContain('<Description>Health</Description>');
      expect(xml).toContain('<VariableType>4 Bytes</VariableType>');
      expect(xml).toContain('<Address>0x7FF612340000</Address>');
    });

    it('exports entry with module-relative address', () => {
      const entries: CheatEntry[] = [
        {
          description: 'Player Base',
          address: '"game.exe"+00123456',
          variableType: '8 Bytes',
        },
      ];
      const xml = exportCheatTable(entries);
      expect(xml).toContain('<Description>Player Base</Description>');
      expect(xml).toContain('<Address>"game.exe"+00123456</Address>');
    });

    it('exports multiple entries', () => {
      const entries: CheatEntry[] = [
        { description: 'Health', address: '0x1000', variableType: '4 Bytes' },
        { description: 'Mana', address: '0x2000', variableType: '4 Bytes' },
      ];
      const xml = exportCheatTable(entries);
      expect(xml).toContain('<ID>0</ID>');
      expect(xml).toContain('<ID>1</ID>');
      const healthIdx = xml.indexOf('<Description>Health</Description>');
      const manaIdx = xml.indexOf('<Description>Mana</Description>');
      expect(healthIdx).toBeGreaterThan(0);
      expect(manaIdx).toBeGreaterThan(healthIdx);
    });

    it('escapes XML special characters', () => {
      const entries: CheatEntry[] = [
        { description: 'A < B & C', address: '0x1000', variableType: '4 Bytes' },
      ];
      const xml = exportCheatTable(entries);
      expect(xml).toContain('<Description>A &lt; B &amp; C</Description>');
    });

    it('uses custom version', () => {
      const xml = exportCheatTable([], 42);
      expect(xml).toContain('CheatEngineTableVersion="42"');
    });
  });

  describe('importCheatTable', () => {
    it('parses empty cheat table', () => {
      const xml = exportCheatTable([]);
      const result = importCheatTable(xml);
      expect(result.entries).toHaveLength(0);
      expect(result.warnings.skippedAutoAssembler).toHaveLength(0);
    });

    it('parses single entry', () => {
      const xml = exportCheatTable([
        { description: 'Health', address: '0x7FF612340000', variableType: '4 Bytes' },
      ]);
      const result = importCheatTable(xml);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.description).toBe('Health');
      expect(result.entries[0]!.address).toBe('0x7FF612340000');
      expect(result.entries[0]!.variableType).toBe('4 Bytes');
    });

    it('parses module-relative address', () => {
      const xml = exportCheatTable([
        {
          description: 'Player Base',
          address: '"game.exe"+00123456',
          variableType: '8 Bytes',
        },
      ]);
      const result = importCheatTable(xml);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.moduleName).toBe('game.exe');
      expect(result.entries[0]!.offset).toBe('0x00123456');
    });

    it('parses multiple entries', () => {
      const xml = exportCheatTable([
        { description: 'Health', address: '0x1000', variableType: '4 Bytes' },
        { description: 'Mana', address: '0x2000', variableType: 'Float' },
      ]);
      const result = importCheatTable(xml);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]!.description).toBe('Health');
      expect(result.entries[1]!.description).toBe('Mana');
    });

    it('skips entries with Auto Assembler scripts', () => {
      const xml =
        `<?xml version="1.0" encoding="utf-8"?>\n` +
        `<CheatTable CheatEngineTableVersion="45">\n` +
        `  <CheatEntries>\n` +
        `    <CheatEntry>\n` +
        `      <ID>0</ID>\n` +
        `      <Description>AA Script</Description>\n` +
        `      <VariableType>Auto Assembler Script</VariableType>\n` +
        `      <Address>0x0</Address>\n` +
        `      <AssemblerScript>[ENABLE]\nnop\n[DISABLE]\nnop</AssemblerScript>\n` +
        `    </CheatEntry>\n` +
        `    <CheatEntry>\n` +
        `      <ID>1</ID>\n` +
        `      <Description>Health</Description>\n` +
        `      <VariableType>4 Bytes</VariableType>\n` +
        `      <Address>0x1000</Address>\n` +
        `    </CheatEntry>\n` +
        `  </CheatEntries>\n` +
        `</CheatTable>\n`;
      const result = importCheatTable(xml);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.description).toBe('Health');
      expect(result.warnings.skippedAutoAssembler).toContain('AA Script');
    });

    it('normalizes bare hex addresses', () => {
      const xml =
        `<?xml version="1.0" encoding="utf-8"?>\n` +
        `<CheatTable CheatEngineTableVersion="45">\n` +
        `  <CheatEntries>\n` +
        `    <CheatEntry>\n` +
        `      <ID>0</ID>\n` +
        `      <Description>Value</Description>\n` +
        `      <VariableType>4 Bytes</VariableType>\n` +
        `      <Address>7FF612340000</Address>\n` +
        `    </CheatEntry>\n` +
        `  </CheatEntries>\n` +
        `</CheatTable>\n`;
      const result = importCheatTable(xml);
      expect(result.entries[0]!.address).toBe('0x7FF612340000');
    });

    it('handles entries with empty description', () => {
      const xml =
        `<?xml version="1.0" encoding="utf-8"?>\n` +
        `<CheatTable CheatEngineTableVersion="45">\n` +
        `  <CheatEntries>\n` +
        `    <CheatEntry>\n` +
        `      <ID>0</ID>\n` +
        `      <Description></Description>\n` +
        `      <VariableType>4 Bytes</VariableType>\n` +
        `      <Address>0x1000</Address>\n` +
        `    </CheatEntry>\n` +
        `  </CheatEntries>\n` +
        `</CheatTable>\n`;
      const result = importCheatTable(xml);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.description).toBe('');
    });
  });
});
