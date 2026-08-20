import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import {
  defineMethodRegistrations,
  ensureBrowserCore,
  toolLookup,
} from '@server/domains/shared/registry';
import { encodingTools } from '@server/domains/encoding/definitions';
import type { EncodingToolHandlers } from '@server/domains/encoding/index';

const DOMAIN = 'encoding' as const;
const DEP_KEY = 'encodingHandlers' as const;
type H = EncodingToolHandlers;
const t = toolLookup(encodingTools);
const registrations = defineMethodRegistrations<H, (typeof encodingTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'binary_detect_format', method: 'handleBinaryDetectFormatTool' },
    { tool: 'binary_decode', method: 'handleBinaryDecodeTool' },
    { tool: 'binary_encode', method: 'handleBinaryEncodeTool' },
    { tool: 'binary_entropy_analysis', method: 'handleBinaryEntropyAnalysisTool' },
    { tool: 'protobuf_decode_raw', method: 'handleProtobufDecodeRawTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { EncodingToolHandlers } = await import('@server/domains/encoding/index');
  await ensureBrowserCore(ctx);
  if (!ctx.encodingHandlers) {
    ctx.encodingHandlers = new EncodingToolHandlers(
      ctx.collector!,
      async (requestId) => ctx.consoleMonitor?.getResponseBody(requestId) ?? null,
    );
  }
  return ctx.encodingHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,
  registrations,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
