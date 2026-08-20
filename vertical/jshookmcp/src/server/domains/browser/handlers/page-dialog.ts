import type { PageController } from '@server/domains/shared/modules/collector';
import { argBool, argString } from '@server/domains/shared/parse-args';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface PageDialogHandlersDeps {
  pageController: PageController;
}

export class PageDialogHandlers {
  constructor(private deps: PageDialogHandlersDeps) {}

  async handlePageHandleDialog(args: Record<string, unknown>): Promise<ToolResponse> {
    const accept = argBool(args, 'accept', true);
    const promptText = argString(args, 'promptText');
    const dismissAll = argBool(args, 'dismissAll', false);

    const result = await this.deps.pageController.handleDialog({
      accept,
      promptText: promptText ?? undefined,
      dismissAll,
    });

    return R.ok().build(result);
  }
}
