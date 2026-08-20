import { hasBionicSymbol } from './bionic';
import {
  ElfLoader,
  R_AARCH64_GLOB_DAT,
  R_AARCH64_JUMP_SLOT,
  type ElfRelocation,
} from './ElfLoader';

export type NativeImportResolution = 'bionic' | 'unresolved';

export interface NativeImportRecord {
  symbol: string;
  gotOffset: number;
  relocationType: string;
  addend: number;
  resolution: NativeImportResolution;
}

export interface NativeImportInspection {
  totalImports: number;
  supportedImports: number;
  unresolvedImports: number;
  imports: NativeImportRecord[];
}

export interface NativeImportInspectorOptions {
  /**
   * Override symbol resolution for tests or alternate runtime catalogs. Defaults
   * to the built-in Android bionic catalog used by CpuEngine ELF auto-wiring.
   */
  supportsSymbol?: (symbol: string) => boolean;
}

export function inspectElfImports(
  bytes: Uint8Array,
  options: NativeImportInspectorOptions = {},
): NativeImportInspection {
  const elf = new ElfLoader(bytes);
  const supportsSymbol = options.supportsSymbol ?? hasBionicSymbol;
  const imports = elf
    .relocations()
    .filter(isUndefinedImport)
    .map((rel) => toImportRecord(rel, supportsSymbol));
  const unresolvedImports = imports.filter((item) => item.resolution === 'unresolved').length;
  return {
    totalImports: imports.length,
    supportedImports: imports.length - unresolvedImports,
    unresolvedImports,
    imports,
  };
}

function isUndefinedImport(rel: ElfRelocation): boolean {
  return rel.symbolName !== '' && isImportRelocation(rel.type) && rel.symbolValue === 0;
}

function isImportRelocation(type: number): boolean {
  return type === R_AARCH64_JUMP_SLOT || type === R_AARCH64_GLOB_DAT;
}

function toImportRecord(
  rel: ElfRelocation,
  supportsSymbol: (symbol: string) => boolean,
): NativeImportRecord {
  const resolution: NativeImportResolution = supportsSymbol(rel.symbolName)
    ? 'bionic'
    : 'unresolved';
  return {
    symbol: rel.symbolName,
    gotOffset: rel.offset,
    relocationType: relocationTypeName(rel.type),
    addend: rel.addend,
    resolution,
  };
}

function relocationTypeName(type: number): string {
  if (type === R_AARCH64_JUMP_SLOT) return 'R_AARCH64_JUMP_SLOT';
  if (type === R_AARCH64_GLOB_DAT) return 'R_AARCH64_GLOB_DAT';
  return `R_AARCH64_${type}`;
}
