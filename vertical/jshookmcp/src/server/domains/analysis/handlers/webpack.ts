/**
 * Webpack enumeration handler: webpack_enumerate
 */

import type { CodeCollector } from '@server/domains/shared/modules/collector';
import type { ToolArgs, ToolResponse } from '@server/types';
import { runWebpackEnumerate } from '@server/domains/analysis/handlers.web-tools';

export async function handleWebpackEnumerate(
  collector: CodeCollector,
  args: ToolArgs,
): Promise<ToolResponse> {
  return runWebpackEnumerate(collector, args);
}
