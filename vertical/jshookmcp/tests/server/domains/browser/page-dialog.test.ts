import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageDialogHandlers } from '@server/domains/browser/handlers/page-dialog';

describe('PageDialogHandlers', () => {
  let pageController: any;
  let handlers: PageDialogHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = {
      handleDialog: vi.fn(),
    };
    handlers = new PageDialogHandlers({ pageController });
  });

  it('installs persistent dismissAll handler by default', async () => {
    pageController.handleDialog.mockResolvedValue({
      handled: true,
      message: 'Persistent dialog handler installed — all future dialogs will be auto-dismissed.',
    });

    const result = parseJson<BrowserStatusResponse>(await handlers.handlePageHandleDialog({}));

    expect(result.handled).toBe(true);
    expect(result.message).toContain('Persistent dialog handler installed');
    expect(pageController.handleDialog).toHaveBeenCalledWith({
      accept: true,
      dismissAll: false,
    });
  });

  it('passes accept=false for dismiss action', async () => {
    pageController.handleDialog.mockResolvedValue({
      handled: true,
      message: 'dismissed confirm dialog: "Are you sure?"',
      type: 'confirm',
      dialogMessage: 'Are you sure?',
    });

    const result = parseJson<BrowserStatusResponse>(
      await handlers.handlePageHandleDialog({ accept: false, dismissAll: false }),
    );

    expect(result.handled).toBe(true);
    expect(result.type).toBe('confirm');
    expect(result.dialogMessage).toBe('Are you sure?');
    expect(pageController.handleDialog).toHaveBeenCalledWith({
      accept: false,
      dismissAll: false,
      promptText: undefined,
    });
  });

  it('passes promptText for prompt dialogs', async () => {
    pageController.handleDialog.mockResolvedValue({
      handled: true,
      message: 'accepted prompt dialog: "Enter password"',
      type: 'prompt',
      dialogMessage: 'Enter password',
    });

    const result = parseJson<BrowserStatusResponse>(
      await handlers.handlePageHandleDialog({ promptText: 'mypassword', dismissAll: false }),
    );

    expect(result.handled).toBe(true);
    expect(pageController.handleDialog).toHaveBeenCalledWith({
      accept: true,
      dismissAll: false,
      promptText: 'mypassword',
    });
  });

  it('installs persistent dismissAll when dismissAll=true', async () => {
    pageController.handleDialog.mockResolvedValue({
      handled: true,
      message: 'Persistent dialog handler installed — all future dialogs will be auto-dismissed.',
    });

    const result = parseJson<BrowserStatusResponse>(
      await handlers.handlePageHandleDialog({ dismissAll: true }),
    );

    expect(result.handled).toBe(true);
    expect(pageController.handleDialog).toHaveBeenCalledWith({
      accept: true,
      dismissAll: true,
      promptText: undefined,
    });
  });

  it('returns success for dialog timeout (no dialog after 30s)', async () => {
    pageController.handleDialog.mockResolvedValue({
      handled: false,
      message: 'Timed out waiting for a dialog (30s). No dialog appeared.',
    });

    const result = parseJson<BrowserStatusResponse>(
      await handlers.handlePageHandleDialog({ dismissAll: false }),
    );

    expect(result.handled).toBe(false);
    expect(result.message).toContain('Timed out');
  });
});
