import type { HostFunction } from '../host-context';
import type { GuestSymbolResolver, ResolvedGuestSymbol } from '../symbol-resolver';

/** Function and data symbols exported by the emulated bionic runtime. */
export class BionicLibrary implements GuestSymbolResolver<HostFunction> {
  private readonly functions = new Map<string, HostFunction>();
  readonly dataSymbols = new Map<string, number>();
  /** Diagnostic log of dlsym lookups (both hits and misses). */
  readonly dlsymLog: string[] = [];

  set(name: string, fn: HostFunction): this {
    this.functions.set(name, fn);
    return this;
  }

  get(name: string): HostFunction | undefined {
    return this.functions.get(name);
  }

  has(name: string): boolean {
    return this.functions.has(name);
  }

  keys(): MapIterator<string> {
    return this.functions.keys();
  }

  resolveSymbol(name: string): ResolvedGuestSymbol<HostFunction> | undefined {
    const address = this.dataSymbols.get(name);
    if (address !== undefined) return { kind: 'data', address };
    const fn = this.functions.get(name);
    return fn ? { kind: 'function', fn } : undefined;
  }
}
