/**
 * Handlers for activate_tools and deactivate_tools meta-tools.
 */
import { logger } from '@utils/logger';
import {
  registerExtensionToolRecord,
  unregisterExtensionToolRecord,
} from '@server/extensions/ExtensionManager.tools';
import { asTextResponse } from '@server/domains/shared/response';
import { createToolHandlerMap } from '@server/ToolHandlerMap';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import { normalizeToolName, validateToolNameArray } from '@server/MCPServer.search.validation';
import { getActiveToolNames } from '@server/MCPServer.search.helpers';
import { loadSearchCatalog } from '@server/registry/SearchCatalog';
import { ensureDomainLoaded, getRegistrationByName } from '@server/registry/index';
import { deactivateToolCore } from '@server/tool-lifecycle';

interface ActivationSummary {
  activated: string[];
  alreadyActive: string[];
  notFound: string[];
  totalActive: number;
}

async function notifyToolListChanged(ctx: MCPServerContext, changed: boolean): Promise<void> {
  if (!changed) {
    return;
  }

  try {
    await ctx.server.sendToolListChanged();
  } catch (e) {
    logger.warn('sendToolListChanged failed:', e);
  }
}

export async function activateToolNames(
  ctx: MCPServerContext,
  names: string[],
): Promise<ActivationSummary> {
  const activeNames = getActiveToolNames(ctx);
  const activated: string[] = [];
  const alreadyActive: string[] = [];
  const notFound: string[] = [];

  for (const rawName of names) {
    const name = normalizeToolName(rawName);
    if (activeNames.has(name)) {
      alreadyActive.push(name);
      continue;
    }

    const extensionRecord = ctx.extensionToolsByName.get(name);
    if (extensionRecord) {
      registerExtensionToolRecord(ctx, extensionRecord, 'activate_tools');
    } else {
      const catalog = await loadSearchCatalog();
      const catalogEntry = catalog.entryByName.get(name);
      if (!catalogEntry) {
        notFound.push(name);
        continue;
      }
      await ensureDomainLoaded(catalogEntry.domain);
      const toolDef = getRegistrationByName(name)?.tool;
      if (!toolDef) {
        notFound.push(name);
        continue;
      }
      const registeredTool = ctx.registerSingleTool(toolDef);
      ctx.activatedToolNames.add(name);
      ctx.activatedRegisteredTools.set(name, registeredTool);
      ctx.enabledDomains.add(catalogEntry.domain);
      const newToolNames = new Set([name]);
      const newHandlers = createToolHandlerMap(ctx.handlerDeps, newToolNames);
      ctx.router.addHandlers(newHandlers);
    }

    activated.push(name);
    activeNames.add(name);
  }

  await notifyToolListChanged(ctx, activated.length > 0);

  logger.info(
    `activate_tools: activated ${activated.length}, already_active ${alreadyActive.length}, not_found ` +
      `${notFound.length}`,
  );

  return {
    activated,
    alreadyActive,
    notFound,
    totalActive: activeNames.size,
  };
}

// ── activate_tools handler ──

export async function handleActivateTools(
  ctx: MCPServerContext,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  // Handle both array and JSON-string formats (anyOf schema may pass either)
  let namesArg = args.names;
  if (typeof namesArg === 'string' && namesArg.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(namesArg);
      if (Array.isArray(parsed)) namesArg = parsed;
    } catch {
      /* malformed — fall through */
    }
  }

  const { names, error } = validateToolNameArray({ names: namesArg });
  if (error) {
    return asTextResponse(JSON.stringify({ success: false, error }));
  }

  const result = await activateToolNames(ctx, names);

  return asTextResponse(
    JSON.stringify({
      success: true,
      ...result,
      hint:
        result.activated.length > 0
          ? 'Tools activated. If they do not appear in your tool list, use call_tool({ name: "<tool>", args: {...} ' +
            '}) to invoke them.'
          : undefined,
    }),
  );
}

// ── deactivate_tools handler ──

export async function handleDeactivateTools(
  ctx: MCPServerContext,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const { names, error } = validateToolNameArray(args);
  if (error) {
    return asTextResponse(JSON.stringify({ success: false, error }));
  }

  const deactivated: string[] = [];
  const notActivated: string[] = [];

  for (const rawName of names) {
    const name = normalizeToolName(rawName);
    if (!ctx.activatedToolNames.has(name)) {
      notActivated.push(name);
      continue;
    }

    const registeredTool = ctx.activatedRegisteredTools.get(name);
    if (registeredTool && !ctx.extensionToolsByName.has(name)) {
      try {
        registeredTool.remove();
      } catch (e) {
        logger.warn(`Failed to remove activated tool "${name}":`, e);
      }
    }

    const extensionRecord = ctx.extensionToolsByName.get(name);
    if (extensionRecord) {
      unregisterExtensionToolRecord(ctx, extensionRecord, {
        onRemoveError: (removeError) => {
          logger.warn(`Failed to remove activated tool "${name}":`, removeError);
        },
      });
    } else {
      deactivateToolCore(name, {
        activatedToolNames: ctx.activatedToolNames,
        activatedRegisteredTools: ctx.activatedRegisteredTools,
        router: ctx.router,
        extensionToolsByName: ctx.extensionToolsByName,
      });
    }
    deactivated.push(name);
  }

  await notifyToolListChanged(ctx, deactivated.length > 0);

  logger.info(
    `deactivate_tools: deactivated ${deactivated.length}, not_activated ${notActivated.length}`,
  );

  return asTextResponse(
    JSON.stringify({
      success: true,
      deactivated,
      notActivated,
      hint: 'Deactivated tools are no longer available. Search again to find alternatives.',
    }),
  );
}
