/**
 * Symbol Persistence — cross-session symbol save/restore via state_board.
 *
 * CE 7.6 added symbol sync between debugger instances. jshookmcp's state_board
 * is the natural persistence layer: after nemu_load_library resolves exported
 * symbols, they are auto-saved. Subsequent sessions can restore them to avoid
 * re-dumping symbols from already-analyzed SO files.
 *
 * Store format (state_board key `nemu_symbols:{libraryHash}`):
 * ```
 * {
 *   symbols: [{name: string, address: number, module: string}],
 *   soPath: string,
 *   timestamp: number,
 *   sessions: string[]  // sessionId(s) where this library was loaded
 * }
 * ```
 *
 * @module SymbolPersistence
 */

import { createHash } from 'node:crypto';

/** A single persisted symbol entry. */
export interface PersistedSymbol {
  name: string;
  address: number;
  module?: string;
}

/** A symbol catalog for one loaded library, ready for state_board storage. */
export interface SymbolCatalog {
  symbols: PersistedSymbol[];
  soPath: string;
  libraryHash: string;
  timestamp: number;
  sessions: string[];
}

/** Arguments for saving a library's exported symbols. */
export interface SaveSymbolsArgs {
  soPath: string;
  symbols: string[];
  /** Resolve symbol name → guest address. Returns undefined when not resolvable. */
  resolveAddress: (name: string) => number | undefined;
  sessionId: string;
  moduleName?: string;
}

/**
 * Compute a content-based hash of a filesystem path for deduplication.
 * Uses the path basename + size hint for a stable key — in production
 * you would hash the file contents, but SO files can be 50MB+.
 */
function hashLibraryPath(soPath: string): string {
  const normalized = soPath.replace(/\\/g, '/');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Build a SymbolCatalog from a freshly loaded library's exports.
 *
 * Call this AFTER nemu_load_library to persist the exported symbols to
 * the state_board, so future sessions can look them up without reloading.
 */
export function buildSymbolCatalog(args: SaveSymbolsArgs): SymbolCatalog {
  const libraryHash = hashLibraryPath(args.soPath);
  const symbols: PersistedSymbol[] = [];

  for (const name of args.symbols) {
    const address = args.resolveAddress(name);
    if (address !== undefined) {
      symbols.push({ name, address, module: args.moduleName });
    }
  }

  return {
    symbols,
    soPath: args.soPath,
    libraryHash,
    timestamp: Date.now(),
    sessions: [args.sessionId],
  };
}

/**
 * Build the state_board key for a given library hash.
 *
 * Namespace: `nemu_symbols`
 * Key: the library hash (first 16 chars of SHA-256 of normalized path).
 */
export function symbolCatalogKey(libraryHash: string): {
  namespace: string;
  key: string;
} {
  return { namespace: 'nemu_symbols', key: libraryHash };
}

/**
 * Merge an existing catalog with a new session's load.
 *
 * Symbols are deduplicated by name; the address from the most recent load
 * wins (address randomization may change across sessions, but intra-session
 * the addresses are stable).
 */
export function mergeCatalog(existing: SymbolCatalog, incoming: SymbolCatalog): SymbolCatalog {
  const symbolMap = new Map<string, PersistedSymbol>();

  // Existing symbols first (incoming overwrites on name collision)
  for (const s of existing.symbols) {
    symbolMap.set(s.name, s);
  }
  for (const s of incoming.symbols) {
    symbolMap.set(s.name, s);
  }

  return {
    symbols: [...symbolMap.values()],
    soPath: incoming.soPath || existing.soPath,
    libraryHash: existing.libraryHash,
    timestamp: incoming.timestamp,
    sessions: [...new Set([...existing.sessions, ...incoming.sessions])],
  };
}

/**
 * Format a SymbolCatalog for the state_board `value` field.
 *
 * state_board expects `value` to be an object (Record<string, unknown>).
 * This returns a plain object suitable for `state_board(action='set', ...)`.
 */
export function catalogToStateValue(catalog: SymbolCatalog): Record<string, unknown> {
  return {
    symbols: catalog.symbols.map((s) => ({
      name: s.name,
      address: `0x${s.address.toString(16)}`,
      module: s.module ?? null,
    })),
    soPath: catalog.soPath,
    libraryHash: catalog.libraryHash,
    timestamp: catalog.timestamp,
    sessions: catalog.sessions,
  };
}

/**
 * Parse a SymbolCatalog from a state_board value.
 */
export function catalogFromStateValue(value: Record<string, unknown>): SymbolCatalog | null {
  try {
    const symbols = (Array.isArray(value.symbols) ? value.symbols : []) as Array<
      Record<string, unknown>
    >;
    return {
      symbols: symbols.map((s) => ({
        name: String(s.name ?? ''),
        address:
          typeof s.address === 'string'
            ? parseInt(s.address as string, 16) || 0
            : Number(s.address ?? 0),
        module: typeof s.module === 'string' ? s.module : undefined,
      })),
      soPath: String(value.soPath ?? ''),
      libraryHash: String(value.libraryHash ?? ''),
      timestamp: Number(value.timestamp ?? 0),
      sessions: (Array.isArray(value.sessions) ? value.sessions : []) as string[],
    };
  } catch {
    return null;
  }
}

/**
 * Generate a hint string describing the symbol catalog for the AI.
 */
export function formatCatalogHint(catalog: SymbolCatalog): string {
  const age = Math.round((Date.now() - catalog.timestamp) / 1000);
  const ageStr =
    age < 60
      ? `${age}s ago`
      : age < 3600
        ? `${Math.round(age / 60)}m ago`
        : `${Math.round(age / 3600)}h ago`;
  return (
    `Symbol catalog for ${catalog.soPath}: ${catalog.symbols.length} symbols, ` +
    `saved ${ageStr} (session(s): ${catalog.sessions.join(', ')}). ` +
    `Use state_board(action='get', namespace='nemu_symbols', key='${catalog.libraryHash}') to retrieve.`
  );
}
