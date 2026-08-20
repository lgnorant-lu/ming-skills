import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IndexedDBDumpHandlers } from '@server/domains/browser/handlers/indexeddb-dump';

type EvaluateFn = (pageFunction: any, ...args: any[]) => Promise<any>;

function createAsyncRequest<T>() {
  const listeners = {
    success: [] as Array<() => void>,
    error: [] as Array<() => void>,
  };
  const req: any = {
    result: undefined,
    error: undefined,
    addEventListener(type: 'success' | 'error', cb: () => void) {
      listeners[type].push(cb);
    },
  };
  return {
    req,
    resolve(value: T) {
      req.result = value;
      for (const cb of listeners.success) cb.call(req);
    },
    reject(error: unknown) {
      req.error = error;
      for (const cb of listeners.error) cb.call(req);
    },
  };
}

function createDatabase(
  name: string,
  stores: Record<string, { records?: unknown[]; error?: unknown }>,
) {
  return {
    name,
    objectStoreNames: Object.keys(stores),
    transaction(storeName: string) {
      const store = stores[storeName];
      if (!store) throw new Error(`Missing store: ${storeName}`);
      return {
        objectStore() {
          const api = {
            getAll(_range?: unknown) {
              const request = createAsyncRequest<unknown[]>();
              queueMicrotask(() => {
                if (store.error !== undefined) {
                  request.reject(store.error);
                  return;
                }
                request.resolve([...(store.records ?? [])]);
              });
              return request.req;
            },
            count(_range?: unknown) {
              const request = createAsyncRequest<number>();
              queueMicrotask(() => {
                if (store.error !== undefined) {
                  request.reject(store.error);
                  return;
                }
                request.resolve((store.records ?? []).length);
              });
              return request.req;
            },
            index(_name: string) {
              return api;
            },
            openCursor(_range?: unknown) {
              const request = createAsyncRequest<unknown>();
              queueMicrotask(() => request.resolve(null));
              return request.req;
            },
          };
          return api;
        },
      };
    },
    close: vi.fn(),
  } as any;
}

function createHandler(indexedDBMock: any) {
  const page = {
    evaluate: vi.fn(async (pageFunction: EvaluateFn, ...args: any[]) => {
      const prevIndexedDB = (globalThis as any).indexedDB;
      (globalThis as any).indexedDB = indexedDBMock;
      try {
        // @ts-expect-error
        return await pageFunction(...args);
      } finally {
        (globalThis as any).indexedDB = prevIndexedDB;
      }
    }),
  } as any;

  const handlers = new IndexedDBDumpHandlers({
    getActivePage: vi.fn(async () => page),
  });

  return { handlers, page };
}

describe('IndexedDBDumpHandlers runtime coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('count mode returns {count} without fetching records (B1)', async () => {
    const targetDb = createDatabase('targetDb', {
      users: { records: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    });
    const indexedDBMock = {
      databases: vi.fn(async () => [{ name: 'targetDb', version: 1 }]),
      open: vi.fn(() => {
        const r = createAsyncRequest<any>();
        queueMicrotask(() => r.resolve(targetDb));
        return r.req;
      }),
    };
    const { handlers } = createHandler(indexedDBMock);

    const parsed = parseJson<any>(
      await handlers.handleIndexedDBDump({ database: 'targetDb', store: 'users', count: true }),
    );
    expect(parsed.targetDb.users.count).toBe(3);
  });

  it('indexName queries a specific index (B1)', async () => {
    const targetDb = createDatabase('targetDb', {
      users: { records: [{ id: 1, name: 'a' }] },
    });
    const indexedDBMock = {
      databases: vi.fn(async () => [{ name: 'targetDb', version: 1 }]),
      open: vi.fn(() => {
        const r = createAsyncRequest<any>();
        queueMicrotask(() => r.resolve(targetDb));
        return r.req;
      }),
    };
    const { handlers } = createHandler(indexedDBMock);

    const parsed = parseJson<any>(
      await handlers.handleIndexedDBDump({
        database: 'targetDb',
        store: 'users',
        indexName: 'name_idx',
      }),
    );
    expect(parsed.targetDb.users).toHaveLength(1);
  });

  it('cursor mode returns {records, hasMore} (B2)', async () => {
    const targetDb = createDatabase('targetDb', { users: { records: [] } });
    const indexedDBMock = {
      databases: vi.fn(async () => [{ name: 'targetDb', version: 1 }]),
      open: vi.fn(() => {
        const r = createAsyncRequest<any>();
        queueMicrotask(() => r.resolve(targetDb));
        return r.req;
      }),
    };
    const { handlers } = createHandler(indexedDBMock);

    const parsed = parseJson<any>(
      await handlers.handleIndexedDBDump({
        database: 'targetDb',
        store: 'users',
        cursor: { offset: 0, batchSize: 10 },
      }),
    );
    expect(parsed.targetDb.users.records).toEqual([]);
    expect(parsed.targetDb.users.hasMore).toBe(false);
  });

  it('filters databases and stores, respects versioned open, and truncates records', async () => {
    const targetDb = createDatabase('targetDb', {
      users: { records: [{ id: 1 }, { id: 2 }] },
      logs: { records: [{ id: 3 }] },
    });
    const open = vi.fn((dbName: string, _version?: number) => {
      const request = createAsyncRequest<any>();
      queueMicrotask(() => {
        if (dbName !== 'targetDb') {
          request.reject(new Error('unexpected open'));
          return;
        }
        request.resolve(targetDb);
      });
      return request.req;
    });
    const indexedDBMock = {
      databases: vi.fn(async () => [
        { name: '' },
        { name: 'targetDb', version: 7 },
        { name: 'otherDb', version: 1 },
      ]),
      open,
    };
    const { handlers } = createHandler(indexedDBMock);

    const parsed = parseJson<any>(
      await handlers.handleIndexedDBDump({
        database: 'targetDb',
        store: 'users',
        maxRecords: 1,
      }),
    );

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('targetDb', 7);
    expect(parsed.targetDb.users).toEqual([{ id: 1 }]);
    expect(parsed.targetDb.logs).toBeUndefined();
    expect(parsed.otherDb).toBeUndefined();
  });

  it('marks databases that fail to open and stores that fail to read', async () => {
    const dataDb = createDatabase('dataDb', {
      goodStore: { records: [{ ok: true }] },
      badStore: { error: new Error('read failed') },
    });
    const open = vi.fn((dbName: string) => {
      const request = createAsyncRequest<any>();
      queueMicrotask(() => {
        if (dbName === 'brokenDb') {
          request.reject(new Error('open failed'));
          return;
        }
        if (dbName === 'dataDb') {
          request.resolve(dataDb);
          return;
        }
        request.reject(new Error(`unexpected db: ${dbName}`));
      });
      return request.req;
    });
    const indexedDBMock = {
      databases: vi.fn(async () => [{ name: 'brokenDb' }, { name: 'dataDb' }]),
      open,
    };
    const { handlers } = createHandler(indexedDBMock);

    const parsed = parseJson<any>(await handlers.handleIndexedDBDump({}));

    expect(parsed.brokenDb.__error__).toEqual(['failed to open']);
    expect(parsed.dataDb.goodStore).toEqual([{ ok: true }]);
    expect(parsed.dataDb.badStore).toEqual(['__error reading store__']);
  });
});
