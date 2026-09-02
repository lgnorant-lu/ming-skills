import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolvePidState = vi.hoisted(() => ({
  resolveMemoryDomainPid: vi.fn(),
}));

vi.mock('../../../../src/server/domains/memory/pid-resolver', () => ({
  resolveMemoryDomainPid: resolvePidState.resolveMemoryDomainPid,
}));

import { BookmarkHandlers } from '../../../../src/server/domains/memory/handlers/bookmark';

describe('BookmarkHandlers', () => {
  let handlers: BookmarkHandlers;

  beforeEach(async () => {
    vi.clearAllMocks();
    resolvePidState.resolveMemoryDomainPid.mockResolvedValue(1234);
    handlers = new BookmarkHandlers();
    // Clear any leftover bookmarks from previous tests (module-level store)
    await handlers.handleBookmarkDispatch({ action: 'clear', pid: 1234 });
  });

  function parseResponse(response: any) {
    return JSON.parse((response.content[0] as any).text);
  }

  describe('add and list bookmarks', () => {
    it('adds a bookmark with label and color, then lists it', async () => {
      // Add a bookmark
      const addResp = await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 1234,
        address: '0x7FF612340000',
        label: 'Player Health',
        color: '#FF0000',
      });
      const addParsed = parseResponse(addResp);

      expect(addParsed.success).toBe(true);
      expect(addParsed.action).toBe('add');
      expect(addParsed.label).toBe('Player Health');
      expect(addParsed.color).toBe('#FF0000');
      expect(addParsed.totalBookmarks).toBe(1);

      // List bookmarks
      const listResp = await handlers.handleBookmarkDispatch({
        action: 'list',
        pid: 1234,
      });
      const listParsed = parseResponse(listResp);

      expect(listParsed.success).toBe(true);
      expect(listParsed.totalBookmarks).toBe(1);
      expect(listParsed.bookmarks).toBeInstanceOf(Array);
      expect(listParsed.bookmarks[0].address).toBe('0x7ff612340000');
      expect(listParsed.bookmarks[0].label).toBe('Player Health');
      expect(listParsed.bookmarks[0].color).toBe('#FF0000');
    });

    it('adds, removes, and clears bookmarks correctly', async () => {
      // Add two bookmarks
      await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 1234,
        address: '0x10000000',
      });
      await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 1234,
        address: '0x20000000',
      });

      // List should show 2
      const listResp1 = await handlers.handleBookmarkDispatch({
        action: 'list',
        pid: 1234,
      });
      expect(parseResponse(listResp1).totalBookmarks).toBe(2);

      // Remove one
      const removeResp = await handlers.handleBookmarkDispatch({
        action: 'remove',
        pid: 1234,
        address: '0x10000000',
      });
      const removeParsed = parseResponse(removeResp);
      expect(removeParsed.removed).toBe(true);
      expect(removeParsed.totalBookmarks).toBe(1);

      // Clear all
      const clearResp = await handlers.handleBookmarkDispatch({
        action: 'clear',
        pid: 1234,
      });
      const clearParsed = parseResponse(clearResp);
      expect(clearParsed.cleared).toBe(1);

      // List should be empty
      const listResp2 = await handlers.handleBookmarkDispatch({
        action: 'list',
        pid: 1234,
      });
      expect(parseResponse(listResp2).totalBookmarks).toBe(0);
    });
  });

  describe('export bookmarks', () => {
    it('exports bookmarks as structured JSON with json string', async () => {
      // Add two bookmarks
      await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 9999,
        address: '0xAABB0000',
        label: 'Gold',
        color: '#FFD700',
      });
      await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 9999,
        address: '0xAABB0008',
        label: 'HP',
        color: '#FF0000',
      });

      const exportResp = await handlers.handleBookmarkDispatch({
        action: 'export',
        pid: 9999,
      });
      const parsed = parseResponse(exportResp);
      expect(parsed.success).toBe(true);
      expect(parsed.action).toBe('export');
      expect(parsed.pid).toBe(1234);
      expect(parsed.totalBookmarks).toBe(2);
      expect(parsed.bookmarks).toBeInstanceOf(Array);
      expect(parsed.bookmarks).toHaveLength(2);
      expect(parsed.bookmarksJson).toBeTypeOf('string');

      const parsedJson = JSON.parse(parsed.bookmarksJson);
      expect(parsedJson).toHaveLength(2);
      expect(parsedJson[0].address).toBe('0xaabb0000');
      expect(parsedJson[0].label).toBe('Gold');
      expect(parsedJson[1].address).toBe('0xaabb0008');
    });

    it('returns empty export for PID with no bookmarks', async () => {
      const exportResp = await handlers.handleBookmarkDispatch({
        action: 'export',
        pid: 7777,
      });
      const parsed = parseResponse(exportResp);
      expect(parsed.success).toBe(true);
      expect(parsed.totalBookmarks).toBe(0);
      expect(parsed.bookmarksJson).toBe('[]');
    });
  });
});
