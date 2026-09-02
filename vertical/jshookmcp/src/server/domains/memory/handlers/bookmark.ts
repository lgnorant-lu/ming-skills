/**
 * Address Bookmark System Handler — memory_bookmark
 *
 * In-memory bookmark store for tracking addresses during reverse engineering.
 * Keys are scoped per PID. Supports add/remove/list/clear operations with optional
 * label and color categorization.
 *
 * Cross-platform. Persisted via in-process Map (survives individual tool calls
 * but not server restarts — for long-term persistence, export bookmarks via
 * state_board_io with namespace memory_bookmarks:{pid}).
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argString } from '@server/domains/shared/parse-args';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { validateHexAddress } from './validation';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';

const TOOL_NAME = 'memory_bookmark';
const ACTION_OPTIONS = new Set(['add', 'remove', 'list', 'clear', 'export'] as const);

interface Bookmark {
  address: string;
  label: string;
  color: string | null;
  createdAt: string;
}

/* Module-level bookmark store keyed by PID.
 * Survives across calls within the same server process.
 */
const bookmarkStore = new Map<number, Map<string, Bookmark>>();

function bookmarkKey(address: string): string {
  return address.toLowerCase().replace(/^0x/i, '');
}

function ensurePidStore(pid: number): Map<string, Bookmark> {
  let store = bookmarkStore.get(pid);
  if (!store) {
    store = new Map();
    bookmarkStore.set(pid, store);
  }
  return store;
}

export class BookmarkHandlers {
  private readonly processManager?: UnifiedProcessManager;
  private readonly ctx?: MCPServerContext;
  constructor(processManager?: UnifiedProcessManager, ctx?: MCPServerContext) {
    this.processManager = processManager;
    this.ctx = ctx;
  }

  private async resolvePid(value: unknown): Promise<number> {
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  async handleBookmarkDispatch(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const action = argString(args, 'action');
      if (!action || !(ACTION_OPTIONS as ReadonlySet<string>).has(action)) {
        throw new Error(
          `${TOOL_NAME}: missing or invalid required argument "action" (expected one of: add, remove, list, clear), got: ${JSON.stringify(args.action)}`,
        );
      }

      switch (action) {
        case 'add':
          return this.handleAdd(args);
        case 'remove':
          return this.handleRemove(args);
        case 'list':
          return this.handleList(args);
        case 'clear':
          return this.handleClear(args);
        case 'export':
          return this.handleExport(args);
        default:
          throw new Error(`${TOOL_NAME}: unknown action "${action}"`);
      }
    });
  }

  private async handleAdd(args: Record<string, unknown>) {
    const pid = await this.resolvePid(args.pid);
    const address = validateHexAddress(args.address, 'address');
    const label = argString(args, 'label', '');
    const color = argString(args, 'color');

    // Validate color format
    if (color !== undefined && color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new Error(
        `${TOOL_NAME}: argument "color" must be a hex color string (e.g. "#FF0000"), got: ${JSON.stringify(color)}`,
      );
    }

    const store = ensurePidStore(pid);
    const key = bookmarkKey(address);
    const existing = store.get(key);

    const bookmark: Bookmark = {
      address: address.toLowerCase(),
      label: label || existing?.label || '',
      color: color ?? existing?.color ?? null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    store.set(key, bookmark);

    return {
      success: true,
      action: 'add',
      pid,
      address: bookmark.address,
      label: bookmark.label,
      color: bookmark.color,
      totalBookmarks: store.size,
      updated: !!existing,
      hint: existing
        ? `Updated bookmark at ${address}.`
        : `Bookmarked ${address}. Total: ${store.size} bookmarks for PID ${pid}.`,
    };
  }

  private async handleRemove(args: Record<string, unknown>) {
    const pid = await this.resolvePid(args.pid);
    const address = validateHexAddress(args.address, 'address');

    const store = bookmarkStore.get(pid);
    if (!store) {
      return {
        success: true,
        action: 'remove',
        pid,
        removed: false,
        totalBookmarks: 0,
        hint: `No bookmarks found for PID ${pid}.`,
      };
    }

    const key = bookmarkKey(address);
    const removed = store.has(key);
    store.delete(key);

    if (store.size === 0) {
      bookmarkStore.delete(pid);
    }

    return {
      success: true,
      action: 'remove',
      pid,
      removed,
      totalBookmarks: store.size,
      hint: removed
        ? `Removed bookmark at ${address}. ${store.size} remaining for PID ${pid}.`
        : `No bookmark found at ${address}.`,
    };
  }

  private async handleList(args: Record<string, unknown>) {
    const pid = await this.resolvePid(args.pid);

    const store = bookmarkStore.get(pid);
    if (!store || store.size === 0) {
      return {
        success: true,
        action: 'list',
        pid,
        bookmarks: [],
        totalBookmarks: 0,
        hint: `No bookmarks for PID ${pid}. Use action='add' to create one.`,
      };
    }

    const bookmarks = [...store.values()]
      .map((b) => ({
        address: b.address,
        label: b.label || null,
        color: b.color,
        createdAt: b.createdAt,
      }))
      .toSorted((a, b) => a.address.localeCompare(b.address));

    return {
      success: true,
      action: 'list',
      pid,
      bookmarks,
      totalBookmarks: bookmarks.length,
    };
  }

  private async handleClear(args: Record<string, unknown>) {
    const pid = await this.resolvePid(args.pid);

    const store = bookmarkStore.get(pid);
    const count = store?.size ?? 0;
    bookmarkStore.delete(pid);

    return {
      success: true,
      action: 'clear',
      pid,
      cleared: count,
      hint:
        count > 0
          ? `Cleared ${count} bookmarks for PID ${pid}.`
          : `No bookmarks to clear for PID ${pid}.`,
    };
  }

  /**
   * Export all bookmarks for a PID as a JSON string.
   *
   * Pure data export — no workflow, no replay, no orchestration.
   * The JSON string is suitable for file save or state_board_io import.
   * Returns the full bookmark list with address, label, color, and createdAt.
   */
  private async handleExport(args: Record<string, unknown>) {
    const pid = await this.resolvePid(args.pid);

    const store = bookmarkStore.get(pid);
    if (!store || store.size === 0) {
      return {
        success: true,
        action: 'export',
        pid,
        bookmarksJson: '[]',
        totalBookmarks: 0,
        hint: `No bookmarks for PID ${pid}. Use action='add' to create one.`,
      };
    }

    const bookmarks = [...store.values()]
      .map((b) => ({
        address: b.address,
        label: b.label || null,
        color: b.color,
        createdAt: b.createdAt,
      }))
      .toSorted((a, b) => a.address.localeCompare(b.address));

    return {
      success: true,
      action: 'export',
      pid,
      bookmarks,
      bookmarksJson: JSON.stringify(bookmarks),
      totalBookmarks: bookmarks.length,
      hint: `Exported ${bookmarks.length} bookmarks for PID ${pid}.`,
    };
  }
}
