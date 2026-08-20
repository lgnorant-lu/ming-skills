import { argString, argNumber, argBool, argObject } from '@server/domains/shared/parse-args';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface EvaluatablePage {
  evaluate(pageFunction: unknown, ...args: unknown[]): Promise<unknown>;
}

interface IndexedDBDumpHandlersDeps {
  getActivePage: () => Promise<unknown>;
}

interface KeyRangeSpec {
  lower?: unknown;
  upper?: unknown;
  lowerOpen?: boolean;
  upperOpen?: boolean;
}

interface CursorSpec {
  offset?: number;
  batchSize?: number;
}

export class IndexedDBDumpHandlers {
  constructor(private deps: IndexedDBDumpHandlersDeps) {}

  async handleIndexedDBDump(args: Record<string, unknown>): Promise<ToolResponse> {
    const database = argString(args, 'database', '');
    const store = argString(args, 'store', '');
    const maxRecords = argNumber(args, 'maxRecords', 100);
    const indexName = argString(args, 'indexName', '');
    const countOnly = argBool(args, 'count', false);
    const keyRange = argObject(args, 'keyRange') as KeyRangeSpec | undefined;
    const cursor = argObject(args, 'cursor') as CursorSpec | undefined;

    return handleSafe(async () => {
      const page = (await this.deps.getActivePage()) as EvaluatablePage;
      const result = await page.evaluate(
        async (opts: {
          database: string;
          store: string;
          maxRecords: number;
          indexName: string;
          countOnly: boolean;
          keyRange: KeyRangeSpec | null;
          cursor: CursorSpec | null;
        }) => {
          const dbList = await indexedDB.databases();
          const output: Record<string, Record<string, unknown>> = {};

          // Resolve the IDBKeyRange once (opts.keyRange is constant across stores).
          let range: IDBKeyRange | null = null;
          if (opts.keyRange) {
            const kr = opts.keyRange;
            const hasLower = kr.lower !== undefined;
            const hasUpper = kr.upper !== undefined;
            if (hasLower && hasUpper) {
              range = IDBKeyRange.bound(
                kr.lower,
                kr.upper,
                kr.lowerOpen ?? false,
                kr.upperOpen ?? false,
              );
            } else if (hasLower) {
              range = IDBKeyRange.lowerBound(kr.lower, kr.lowerOpen ?? false);
            } else if (hasUpper) {
              range = IDBKeyRange.upperBound(kr.upper, kr.upperOpen ?? false);
            }
          }

          for (const dbInfo of dbList) {
            if (!dbInfo.name) continue;
            if (opts.database && dbInfo.name !== opts.database) continue;
            const dbName = dbInfo.name;

            let db: IDBDatabase;
            try {
              db = await new Promise((resolve, reject) => {
                const req = dbInfo.version
                  ? indexedDB.open(dbName, dbInfo.version)
                  : indexedDB.open(dbName);
                req.addEventListener('success', () => resolve(req.result), { once: true });
                req.addEventListener('error', () => reject(req.error), { once: true });
              });
            } catch {
              output[dbName] = { __error__: ['failed to open'] };
              continue;
            }

            const storeNames = Array.from(db.objectStoreNames);
            const dbData: Record<string, unknown> = {};

            for (const storeName of storeNames) {
              if (opts.store && storeName !== opts.store) continue;
              try {
                dbData[storeName] = await new Promise((resolve, reject) => {
                  try {
                    const tx = db.transaction(storeName, 'readonly');
                    const objectStore = tx.objectStore(storeName);
                    const source = opts.indexName ? objectStore.index(opts.indexName) : objectStore;

                    // count-only mode (B1): return {count} without fetching records
                    if (opts.countOnly) {
                      const req = source.count(range ?? undefined);
                      req.addEventListener('success', () => resolve({ count: req.result }), {
                        once: true,
                      });
                      req.addEventListener('error', () => reject(req.error), { once: true });
                      return;
                    }

                    // cursor pagination mode (B2): stream a batch via openCursor,
                    // avoiding one giant getAll() on very large stores
                    if (opts.cursor) {
                      const offset = opts.cursor.offset ?? 0;
                      const batchSize = opts.cursor.batchSize ?? opts.maxRecords;
                      const collected: unknown[] = [];
                      let advanced = false;
                      const req = source.openCursor(range ?? undefined);
                      const onSuccess = () => {
                        const c = req.result;
                        if (!c) {
                          resolve({ records: collected, hasMore: false, nextOffset: null });
                          return;
                        }
                        if (!advanced && offset > 0) {
                          advanced = true;
                          c.advance(offset);
                          return;
                        }
                        if (collected.length < batchSize) {
                          collected.push(c.value);
                          c.continue();
                        } else {
                          resolve({
                            records: collected,
                            hasMore: true,
                            nextOffset: offset + collected.length,
                          });
                        }
                      };
                      req.addEventListener('success', onSuccess);
                      req.addEventListener('error', () => reject(req.error), { once: true });
                      return;
                    }

                    // default: getAll with optional keyRange (B1), sliced to maxRecords
                    const req = source.getAll(range ?? undefined);
                    req.addEventListener(
                      'success',
                      () => resolve((req.result as unknown[]).slice(0, opts.maxRecords)),
                      { once: true },
                    );
                    req.addEventListener('error', () => reject(req.error), { once: true });
                  } catch (e) {
                    reject(e);
                  }
                });
              } catch {
                dbData[storeName] = ['__error reading store__'];
              }
            }

            db.close();
            output[dbName] = dbData;
          }

          return output;
        },
        {
          database,
          store,
          maxRecords,
          indexName,
          countOnly,
          keyRange: keyRange ?? null,
          cursor: cursor ?? null,
        },
      );

      return result as Record<string, unknown>;
    });
  }
}
