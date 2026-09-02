import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageController } from '@modules/collector/PageController';
import type { CodeCollector } from '@modules/collector/CodeCollector';

function createCollectorMock(page: {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
}) {
  return {
    getActivePage: vi.fn().mockResolvedValue(page),
  } as unknown as CodeCollector;
}

describe('PageController dialog handler dedup', () => {
  let page: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> };
  let controller: PageController;

  beforeEach(() => {
    page = { on: vi.fn(), off: vi.fn() };
    controller = new PageController(createCollectorMock(page));
  });

  it('removes the previous handler before installing a new one on the same page', async () => {
    await controller.handleDialog({ dismissAll: true });
    await controller.handleDialog({ dismissAll: true });

    expect(page.on).toHaveBeenCalledTimes(2);
    expect(page.off).toHaveBeenCalledTimes(1);

    const firstHandler = page.on.mock.calls[0]![1];
    // The previously-installed handler is unregistered with the same reference
    // that was passed to page.on — no listener is left behind on re-register.
    expect(page.off).toHaveBeenCalledWith('dialog', firstHandler);
  });

  it('does not stack duplicate handlers when called on different pages', async () => {
    const pageA = { on: vi.fn(), off: vi.fn() };
    const pageB = { on: vi.fn(), off: vi.fn() };
    const controllerAB = new PageController(createCollectorMock(pageA));
    const controllerAB2 = new PageController(createCollectorMock(pageB));

    await controllerAB.handleDialog({ dismissAll: true });
    await controllerAB2.handleDialog({ dismissAll: true });

    expect(pageA.off).not.toHaveBeenCalled();
    expect(pageB.off).not.toHaveBeenCalled();
    expect(pageA.on).toHaveBeenCalledTimes(1);
    expect(pageB.on).toHaveBeenCalledTimes(1);
  });

  it('installed handler dismisses incoming dialogs', async () => {
    await controller.handleDialog({ dismissAll: true });

    const dismiss = vi.fn().mockResolvedValue(undefined);
    const dialog = {
      type: () => 'alert',
      message: () => 'hi',
      accept: vi.fn().mockResolvedValue(undefined),
      dismiss,
    };

    const handler = page.on.mock.calls[0]![1] as (d: typeof dialog) => Promise<void>;
    await handler(dialog);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
