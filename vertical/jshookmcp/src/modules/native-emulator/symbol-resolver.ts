export type ResolvedGuestSymbol<TFunction> =
  | { kind: 'function'; fn: TFunction }
  | { kind: 'data'; address: number };

/** Supplies imported guest symbols without exposing a concrete library container. */
export interface GuestSymbolResolver<TFunction> {
  resolveSymbol(name: string): ResolvedGuestSymbol<TFunction> | undefined;
}
