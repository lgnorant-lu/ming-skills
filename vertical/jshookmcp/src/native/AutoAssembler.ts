/**
 * Auto Assembler — CE-style AA scripting engine.
 *
 * Parses and executes a minimal subset of Cheat Engine's Auto Assembler DSL.
 * Supports [ENABLE]/[DISABLE] sections, ALLOC, DEALLOC, LABEL, REGISTERSYMBOL,
 * AOBSCAN, ASSERT, CREATETHREAD, DEFINE, FULLACCESS, READMEM, WRITEMEM.
 *
 * INCLUDE and LOADBINARY are rejected for security.
 *
 * @module AutoAssembler
 */

import type {
  AAExecutionContext,
  AACommandResult,
  AAExecuteResult,
  AADisableScript,
  AAParsedCommand,
} from './AutoAssembler.types';
import { AA_LIMITS, AA_PROTECTION } from './AutoAssembler.types';

// ── Parser ──

/** Regex for commands: NAME(args). Case-insensitive command name. */
const COMMAND_RE = /^([A-Za-z_]\w*)\s*\(\s*(.*?)\s*\)\s*$/;

/** Regex for hex values with optional 0x prefix. */
const HEX_RE = /^(0x)?[0-9a-fA-F]+$/;

/**
 * Parse a hex string to a bigint. Accepts "0x" prefix or raw hex.
 * Also accepts decimal numbers (bare digits).
 */
function parseHexOrDecimal(raw: string): bigint {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new Error(`Expected a numeric value, got empty string`);
  }
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    return BigInt(trimmed);
  }
  if (/^\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }
  if (HEX_RE.test(trimmed)) {
    return BigInt(`0x${trimmed}`);
  }
  throw new Error(
    `Invalid numeric value: "${trimmed}". Expected hex (e.g. "0x1000" or "1000") or decimal.`,
  );
}

/** Parse arg string into positional arguments, respecting quoted strings and commas. */
function splitArgs(raw: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inQuotes) {
      if (ch === quoteChar) {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
    } else if (ch === ',') {
      args.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  args.push(current.trim());
  return args;
}

/** Parse a bytes string like "48 8B ?? ?? 00 00" into a cleaned pattern. */
function parseBytesPattern(raw: string): string {
  const trimmed = raw.replace(/^["']|["']$/g, '').trim();
  if (trimmed.length > AA_LIMITS.MAX_AOB_PATTERN_LENGTH) {
    throw new Error(
      `AOB pattern too long: ${trimmed.length} chars (max ${AA_LIMITS.MAX_AOB_PATTERN_LENGTH})`,
    );
  }
  if (trimmed.length === 0) {
    throw new Error('AOB pattern must not be empty');
  }
  // Validate: only hex bytes (00-FF), ?? wildcards, spaces
  if (!/^[0-9a-fA-F? \t]+$/.test(trimmed)) {
    throw new Error(`Invalid AOB pattern: "${trimmed}". Expected hex bytes and "??" wildcards.`);
  }
  return trimmed;
}

/** Parse a bytes string like "48 8B 00 00" into a Buffer. */
function parseWriteBytes(raw: string): Buffer {
  const trimmed = raw.replace(/^["']|["']$/g, '').trim();
  if (trimmed.length === 0) {
    throw new Error('Byte data must not be empty');
  }
  const hexBytes = trimmed.split(/\s+/).filter(Boolean);
  if (hexBytes.length > AA_LIMITS.MAX_WRITEMEM_SIZE) {
    throw new Error(
      `WRITEMEM size ${hexBytes.length} exceeds max ${AA_LIMITS.MAX_WRITEMEM_SIZE} bytes`,
    );
  }
  const bytes: number[] = [];
  for (const hb of hexBytes) {
    if (!/^[0-9a-fA-F]{2}$/.test(hb)) {
      throw new Error(`Invalid hex byte in WRITEMEM: "${hb}". Expected two hex digits.`);
    }
    bytes.push(parseInt(hb, 16));
  }
  return Buffer.from(bytes);
}

/** Trim a line comment (//) and whitespace. */
function trimLine(line: string): string {
  const commentIdx = line.indexOf('//');
  if (commentIdx !== -1) {
    return line.substring(0, commentIdx).trimEnd();
  }
  return line.trimEnd();
}

/**
 * Parse an AA script into sections.
 *
 * Sections:
 *   - header: lines before [ENABLE]
 *   - enable: lines between [ENABLE] and [DISABLE]
 *   - disable: lines after [DISABLE]
 */
function parseSections(script: string): {
  headerLines: string[];
  enableLines: string[];
  disableLines: string[];
} {
  const rawLines = script.split(/\r?\n/);
  const headerLines: string[] = [];
  const enableLines: string[] = [];
  const disableLines: string[] = [];

  let section: 'header' | 'enable' | 'disable' = 'header';

  for (const raw of rawLines) {
    const trimmed = trimLine(raw);
    const upper = trimmed.toUpperCase().trim();

    if (upper === '[ENABLE]') {
      section = 'enable';
      continue;
    }
    if (upper === '[DISABLE]') {
      section = 'disable';
      continue;
    }

    // Skip blank lines
    if (trimmed === '') continue;

    switch (section) {
      case 'header':
        headerLines.push(trimmed);
        break;
      case 'enable':
        enableLines.push(trimmed);
        break;
      case 'disable':
        disableLines.push(trimmed);
        break;
    }
  }

  return { headerLines, enableLines, disableLines };
}

/**
 * Parse a single line into a command, or return null if not a command.
 */
function parseCommand(line: string, lineNumber: number): AAParsedCommand | null {
  const match = COMMAND_RE.exec(line);
  if (!match) return null;

  const command = match[1]!.toUpperCase();
  const rawArgs = match[2]!;
  return { command, rawArgs, line: lineNumber };
}

/**
 * Parse all commands from a list of lines.
 * Lines that don't match the COMMAND_RE are treated as raw assembly (ignored in this minimal engine).
 */
function parseCommands(lines: string[], startLine: number): AAParsedCommand[] {
  const commands: AAParsedCommand[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cmd = parseCommand(lines[i]!, startLine + i);
    if (cmd) {
      commands.push(cmd);
    }
  }
  return commands;
}

// ── AutoAssembler Engine ──

export class AutoAssembler {
  /**
   * Execute the ENABLE section of an AA script.
   *
   * Returns the DISABLE script for later use with executeDisable().
   */
  async execute(script: string, ctx: AAExecutionContext): Promise<AAExecuteResult> {
    const { enableLines, disableLines } = parseSections(script);

    const enableCommands = parseCommands(enableLines, 1);
    const disableCommands = parseCommands(disableLines, 1);

    if (enableCommands.length > AA_LIMITS.MAX_COMMANDS) {
      throw new Error(
        `Too many commands in ENABLE section: ${enableCommands.length} (max ${AA_LIMITS.MAX_COMMANDS})`,
      );
    }

    // State
    const symbolTable = new Map<string, bigint>();
    const allocations: Map<string, string> = new Map();
    const symbols: Map<string, string> = new Map();
    const labels: Map<string, string> = new Map();
    const results: AACommandResult[] = [];

    // Execute each command in order
    for (const cmd of enableCommands) {
      try {
        const result = await this.executeCommand(
          cmd,
          ctx,
          symbolTable,
          allocations,
          symbols,
          labels,
        );
        results.push(result);
        if (!result.success) {
          return {
            success: false,
            enableResults: results,
            disableScript: this.buildDisableScript(
              ctx.pid,
              disableCommands,
              allocations,
              symbols,
              labels,
            ),
            allocations: Object.fromEntries(allocations),
            symbols: Object.fromEntries(symbols),
            labels: Object.fromEntries(labels),
          };
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({
          command: cmd.command,
          line: cmd.line,
          success: false,
          message: `Line ${cmd.line}: ${errMsg}`,
        });
        return {
          success: false,
          enableResults: results,
          disableScript: this.buildDisableScript(
            ctx.pid,
            disableCommands,
            allocations,
            symbols,
            labels,
          ),
          allocations: Object.fromEntries(allocations),
          symbols: Object.fromEntries(symbols),
          labels: Object.fromEntries(labels),
        };
      }
    }

    return {
      success: true,
      enableResults: results,
      disableScript: this.buildDisableScript(
        ctx.pid,
        disableCommands,
        allocations,
        symbols,
        labels,
      ),
      allocations: Object.fromEntries(allocations),
      symbols: Object.fromEntries(symbols),
      labels: Object.fromEntries(labels),
    };
  }

  /**
   * Execute the DISABLE section of a previously executed AA script.
   */
  async executeDisable(
    disableScript: AADisableScript,
    ctx: AAExecutionContext,
  ): Promise<AACommandResult[]> {
    // Rebuild symbol table from saved state
    const symbolTable = new Map<string, bigint>();
    for (const [name, addrStr] of Object.entries(disableScript.allocations)) {
      symbolTable.set(name, BigInt(addrStr));
    }
    for (const [name, addrStr] of Object.entries(disableScript.symbols)) {
      symbolTable.set(name, BigInt(addrStr));
    }
    for (const [name, addrStr] of Object.entries(disableScript.labels)) {
      symbolTable.set(name, BigInt(addrStr));
    }

    const allocations = new Map<string, string>(Object.entries(disableScript.allocations));
    const symbols = new Map<string, string>(Object.entries(disableScript.symbols));
    const labels = new Map<string, string>(Object.entries(disableScript.labels));

    // Execute DEALLOC last (CE convention)
    const deallocCommands: AAParsedCommand[] = [];
    const otherCommands: AAParsedCommand[] = [];

    for (const cmd of disableScript.disableCommands) {
      if (cmd.command === 'DEALLOC') {
        deallocCommands.push(cmd);
      } else {
        otherCommands.push(cmd);
      }
    }

    const results: AACommandResult[] = [];

    for (const cmd of otherCommands) {
      try {
        const result = await this.executeCommand(
          cmd,
          ctx,
          symbolTable,
          allocations,
          symbols,
          labels,
        );
        results.push(result);
      } catch (err) {
        results.push({
          command: cmd.command,
          line: cmd.line,
          success: false,
          message: `Line ${cmd.line}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    for (const cmd of deallocCommands) {
      try {
        const result = await this.executeCommand(
          cmd,
          ctx,
          symbolTable,
          allocations,
          symbols,
          labels,
        );
        results.push(result);
      } catch (err) {
        results.push({
          command: cmd.command,
          line: cmd.line,
          success: false,
          message: `Line ${cmd.line}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return results;
  }

  /** Resolve a value: first check symbol table, then parse as hex/decimal. */
  private resolve(raw: string, symbols: Map<string, bigint>): bigint {
    const trimmed = raw.trim();
    // Try symbol table first
    if (symbols.has(trimmed)) {
      return symbols.get(trimmed)!;
    }
    // Try hex/decimal parse
    try {
      return parseHexOrDecimal(trimmed);
    } catch {
      throw new Error(`Undefined symbol "${trimmed}". Use DEFINE, LABEL, ALLOC, or AOBSCAN first.`);
    }
  }

  private async executeCommand(
    cmd: AAParsedCommand,
    ctx: AAExecutionContext,
    symbols: Map<string, bigint>,
    allocations: Map<string, string>,
    registeredSymbols: Map<string, string>,
    labels: Map<string, string>,
  ): Promise<AACommandResult> {
    const args = splitArgs(cmd.rawArgs);

    switch (cmd.command) {
      case 'ALLOC': {
        if (args.length < 2) {
          throw new Error('ALLOC(name, size) requires name and size');
        }
        const name = args[0]!.trim();
        const size = Number(this.resolve(args[1]!, symbols));
        if (!Number.isInteger(size) || size <= 0 || size > AA_LIMITS.MAX_ALLOC_SIZE) {
          throw new Error(
            `ALLOC "${name}": size must be 1-${AA_LIMITS.MAX_ALLOC_SIZE}, got ${size}`,
          );
        }
        if (allocations.size >= AA_LIMITS.MAX_ALLOCATIONS) {
          throw new Error(`Too many allocations: max ${AA_LIMITS.MAX_ALLOCATIONS}`);
        }
        const addr = await ctx.allocate(size);
        if (addr === 0n) {
          throw new Error(`ALLOC "${name}": VirtualAllocEx failed`);
        }
        const addrStr = `0x${addr.toString(16).toUpperCase()}`;
        symbols.set(name, addr);
        allocations.set(name, addrStr);
        return {
          command: 'ALLOC',
          line: cmd.line,
          success: true,
          message: `Allocated ${size} bytes for "${name}" at ${addrStr}`,
          detail: { name, size, address: addrStr },
        };
      }

      case 'DEALLOC': {
        if (args.length < 1) {
          throw new Error('DEALLOC(name) requires name');
        }
        const name = args[0]!.trim();
        if (!allocations.has(name)) {
          throw new Error(`DEALLOC "${name}": no allocation found`);
        }
        const addr = symbols.get(name);
        if (addr === undefined) {
          throw new Error(`DEALLOC "${name}": symbol not found`);
        }
        await ctx.free(addr);
        allocations.delete(name);
        symbols.delete(name);
        registeredSymbols.delete(name);
        labels.delete(name);
        return {
          command: 'DEALLOC',
          line: cmd.line,
          success: true,
          message: `Deallocated "${name}"`,
          detail: { name },
        };
      }

      case 'LABEL': {
        if (args.length < 1) {
          throw new Error('LABEL(name) requires name');
        }
        const name = args[0]!.trim();
        const addr = args.length >= 2 ? this.resolve(args[1]!, symbols) : undefined;
        if (addr !== undefined) {
          symbols.set(name, addr);
          labels.set(name, `0x${addr.toString(16).toUpperCase()}`);
        }
        // In a real AA engine, a label without address gets the current assembly position.
        // Our minimal engine treats it as a forward declaration (address resolved later).
        return {
          command: 'LABEL',
          line: cmd.line,
          success: true,
          message:
            addr !== undefined
              ? `Label "${name}" = 0x${addr.toString(16).toUpperCase()}`
              : `Label "${name}" declared`,
          detail: {
            name,
            address: addr !== undefined ? `0x${addr.toString(16).toUpperCase()}` : null,
          },
        };
      }

      case 'REGISTERSYMBOL': {
        if (args.length < 1) {
          throw new Error('REGISTERSYMBOL(name) requires name');
        }
        const name = args[0]!.trim();
        const addr = symbols.get(name);
        if (addr === undefined) {
          throw new Error(
            `REGISTERSYMBOL "${name}": symbol not found. Use ALLOC, LABEL, or AOBSCAN first.`,
          );
        }
        const addrStr = `0x${addr.toString(16).toUpperCase()}`;
        registeredSymbols.set(name, addrStr);
        return {
          command: 'REGISTERSYMBOL',
          line: cmd.line,
          success: true,
          message: `Registered symbol "${name}" = ${addrStr}`,
          detail: { name, address: addrStr },
        };
      }

      case 'AOBSCAN': {
        if (args.length < 2) {
          throw new Error('AOBSCAN(name, pattern) requires name and pattern');
        }
        const name = args[0]!.trim();
        const pattern = parseBytesPattern(args.slice(1).join(','));
        const matches = await ctx.aobScan(pattern);
        if (matches.length === 0) {
          throw new Error(`AOBSCAN "${name}": pattern not found — script aborted`);
        }
        const firstMatch = matches[0]!;
        const addrStr = `0x${firstMatch.toString(16).toUpperCase()}`;
        symbols.set(name, firstMatch);
        labels.set(name, addrStr);
        return {
          command: 'AOBSCAN',
          line: cmd.line,
          success: true,
          message: `AOBSCAN "${name}" found at ${addrStr} (${matches.length} total matches)`,
          detail: { name, address: addrStr, totalMatches: matches.length },
        };
      }

      case 'ASSERT': {
        if (args.length < 2) {
          throw new Error('ASSERT(address, bytes) requires address and bytes');
        }
        const addr = this.resolve(args[0]!, symbols);
        const pattern = parseBytesPattern(args.slice(1).join(','));
        // Convert pattern with wildcards to expected bytes (wildcards match anything)
        const tokens = pattern.split(/\s+/);
        const buf = await ctx.read(addr, tokens.length);
        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i]!;
          if (token === '??' || token === '?') continue;
          const expected = parseInt(token, 16);
          if (buf[i] !== expected) {
            const addrHex = `0x${(addr + BigInt(i)).toString(16).toUpperCase()}`;
            throw new Error(
              `ASSERT failed at offset ${i} (${addrHex}): expected 0x${expected.toString(16).padStart(2, '0')}, got 0x${(buf[i] ?? 0).toString(16).padStart(2, '0')}`,
            );
          }
        }
        return {
          command: 'ASSERT',
          line: cmd.line,
          success: true,
          message: 'ASSERT passed',
          detail: { address: `0x${addr.toString(16).toUpperCase()}`, bytes: tokens.length },
        };
      }

      case 'CREATETHREAD': {
        if (args.length < 1) {
          throw new Error('CREATETHREAD(address) requires address');
        }
        const addr = this.resolve(args[0]!, symbols);
        await ctx.createThread(addr);
        return {
          command: 'CREATETHREAD',
          line: cmd.line,
          success: true,
          message: `Thread created at 0x${addr.toString(16).toUpperCase()}`,
          detail: { address: `0x${addr.toString(16).toUpperCase()}` },
        };
      }

      case 'DEFINE': {
        if (args.length < 2) {
          throw new Error('DEFINE(name, value) requires name and value');
        }
        const name = args[0]!.trim();
        const value = this.resolve(args[1]!, symbols);
        symbols.set(name, value);
        return {
          command: 'DEFINE',
          line: cmd.line,
          success: true,
          message: `DEFINE "${name}" = 0x${value.toString(16).toUpperCase()}`,
          detail: { name, value: `0x${value.toString(16).toUpperCase()}` },
        };
      }

      case 'FULLACCESS': {
        if (args.length < 2) {
          throw new Error('FULLACCESS(address, size) requires address and size');
        }
        const addr = this.resolve(args[0]!, symbols);
        const size = Number(this.resolve(args[1]!, symbols));
        if (!Number.isInteger(size) || size <= 0) {
          throw new Error(`FULLACCESS: size must be positive, got ${size}`);
        }
        await ctx.protect(addr, size, AA_PROTECTION.RWX);
        return {
          command: 'FULLACCESS',
          line: cmd.line,
          success: true,
          message: `Protection changed to RWX at 0x${addr.toString(16).toUpperCase()} (${size} bytes)`,
          detail: { address: `0x${addr.toString(16).toUpperCase()}`, size },
        };
      }

      case 'READMEM': {
        if (args.length < 2) {
          throw new Error('READMEM(address, size) requires address and size');
        }
        const addr = this.resolve(args[0]!, symbols);
        const size = Number(this.resolve(args[1]!, symbols));
        if (!Number.isInteger(size) || size <= 0 || size > AA_LIMITS.MAX_READMEM_SIZE) {
          throw new Error(`READMEM: size must be 1-${AA_LIMITS.MAX_READMEM_SIZE}, got ${size}`);
        }
        const buf = await ctx.read(addr, size);
        const hex = Array.from(buf)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' ');
        return {
          command: 'READMEM',
          line: cmd.line,
          success: true,
          message: `Read ${size} bytes`,
          detail: { address: `0x${addr.toString(16).toUpperCase()}`, size, hex },
        };
      }

      case 'WRITEMEM': {
        if (args.length < 2) {
          throw new Error('WRITEMEM(address, bytes) requires address and bytes');
        }
        const addr = this.resolve(args[0]!, symbols);
        const data = parseWriteBytes(args.slice(1).join(','));
        await ctx.write(addr, data);
        const hex = Array.from(data)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' ');
        return {
          command: 'WRITEMEM',
          line: cmd.line,
          success: true,
          message: `Wrote ${data.length} bytes`,
          detail: { address: `0x${addr.toString(16).toUpperCase()}`, bytes: data.length, hex },
        };
      }

      case 'INCLUDE': {
        throw new Error('INCLUDE is not supported for security — load files manually');
      }

      case 'LOADBINARY': {
        throw new Error(
          'LOADBINARY is not supported for security — use WRITEMEM with pre-loaded data',
        );
      }

      default: {
        throw new Error(`Unknown command: ${cmd.command}`);
      }
    }
  }

  private buildDisableScript(
    pid: number,
    disableCommands: AAParsedCommand[],
    allocations: Map<string, string>,
    symbols: Map<string, string>,
    labels: Map<string, string>,
  ): AADisableScript {
    return {
      pid,
      disableCommands,
      allocations: Object.fromEntries(allocations),
      symbols: Object.fromEntries(symbols),
      labels: Object.fromEntries(labels),
    };
  }
}

export const autoAssembler = new AutoAssembler();
