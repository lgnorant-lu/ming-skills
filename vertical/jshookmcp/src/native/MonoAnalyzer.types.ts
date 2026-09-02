/**
 * MonoAnalyzer types.
 * @module MonoAnalyzer.types
 */

/** Detected Mono runtime variant. */
export type MonoRuntimeKind = 'mono' | 'il2cpp' | 'none';

/** Result of Mono runtime detection. */
export interface MonoRuntimeInfo {
  kind: MonoRuntimeKind;
  /** Module name (e.g., "mono-2.0-bdwgc.dll", "mono.dll", "GameAssembly.dll"). */
  moduleName: string;
  /** Module base address (hex string). */
  moduleBase: string;
  /** Size of pointers in bytes (4 for 32-bit, 8 for 64-bit). */
  pointerSize: number;
  /** Root domain address if resolved (hex string), null if not found. */
  rootDomain?: string;
  /** Exported symbols found (mono_get_root_domain, mono_root_domain, etc.). */
  exportedSymbols: string[];
}

/** A Mono assembly (loaded .NET assembly in a domain). */
export interface MonoAssemblyInfo {
  name: string;
  address: string;
  imageAddress?: string;
}

/** Field of a Mono class. */
export interface MonoFieldInfo {
  name: string;
  /** Memory offset from object start (for instance fields) or -1 for static. */
  offset: number;
  /** Type name hint from the MonoType pointer (best-effort). */
  typeName: string;
  isStatic: boolean;
}

/** A Mono class definition. */
export interface MonoClassInfo {
  name: string;
  namespace: string;
  fullName: string;
  address: string;
  parentClass?: string;
  fieldCount: number;
  methodCount: number;
  fields: MonoFieldInfo[];
  /** Assembly that owns this class. */
  assemblyName?: string;
}

/** A live MonoObject in the managed heap. */
export interface MonoObjectInfo {
  address: string;
  className: string;
  namespace?: string;
  size: number;
}

/** Parsed field value from a MonoObject. */
export interface MonoFieldValue {
  fieldName: string;
  fieldOffset: number;
  /** Human-readable value representation. */
  value: string;
  /** Raw bytes (hex). */
  rawHex: string;
  typeHint: 'int32' | 'int64' | 'float' | 'double' | 'boolean' | 'string' | 'pointer' | 'unknown';
}

/** IL2CPP type for fallback - metadata summary. */
export interface Il2CppMetadataSummary {
  version: number;
  stringLiteralCount: number;
  typeCount: number;
  methodCount: number;
  fieldCount: number;
  assemblies: string[];
}
