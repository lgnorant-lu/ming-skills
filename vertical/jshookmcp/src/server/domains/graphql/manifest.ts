import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import {
  defineMethodRegistrations,
  ensureBrowserCore,
  toolLookup,
} from '@server/domains/shared/registry';
import { graphqlTools } from '@server/domains/graphql/definitions';
import type { GraphQLToolHandlers } from '@server/domains/graphql/index';

const DOMAIN = 'graphql' as const;
const DEP_KEY = 'graphqlHandlers' as const;
type H = GraphQLToolHandlers;
const t = toolLookup(graphqlTools);
const registrations = defineMethodRegistrations<H, (typeof graphqlTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'call_graph_analyze', method: 'handleCallGraphAnalyzeTool' },
    { tool: 'script_replace_persist', method: 'handleScriptReplacePersistTool' },
    { tool: 'graphql_introspect', method: 'handleGraphqlIntrospectTool' },
    { tool: 'graphql_extract_queries', method: 'handleGraphqlExtractQueriesTool' },
    { tool: 'graphql_replay', method: 'handleGraphqlReplayTool' },
    { tool: 'graphql_subscribe', method: 'handleGraphqlSubscribeTool' },
    { tool: 'graphql_enum_schema', method: 'handleGraphqlEnumSchemaTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { GraphQLToolHandlers } = await import('@server/domains/graphql/index');
  await ensureBrowserCore(ctx);
  if (!ctx.graphqlHandlers) {
    ctx.graphqlHandlers = new GraphQLToolHandlers({
      collector: ctx.collector!,
      consoleMonitor: ctx.consoleMonitor,
    });
  }
  return ctx.graphqlHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,
  registrations,
};

export default manifest;
