import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const TLS_VERSION_VALUES = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'] as const;

export function objectTool(
  name: string,
  description: string,
  properties: Record<string, object> = {},
  required: string[] = [],
): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      required,
    },
  };
}
