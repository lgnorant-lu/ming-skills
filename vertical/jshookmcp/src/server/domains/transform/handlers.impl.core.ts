/**
 * Transform domain — composition facade.
 *
 * All utility functions extracted to ./handlers/shared.ts.
 * Transform operations extracted to ./handlers/transform-operations.ts.
 * Handler methods delegated to AstHandlers and CryptoHandlers sub-handlers.
 */

import type { CodeCollector } from '@server/domains/shared/modules/collector';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import type { TransformSharedState } from './handlers/shared';
import { createTransformSharedState } from './handlers/shared';
import { AstHandlers } from './handlers/ast-handlers';
import { CryptoHandlers } from './handlers/crypto-handlers';
import { WorkbenchHandlers } from './handlers/workbench-handlers';

export class TransformToolHandlers {
  protected collector: CodeCollector;
  protected state: TransformSharedState;
  private ast: AstHandlers;
  private crypto: CryptoHandlers;
  private workbench: WorkbenchHandlers;

  constructor(collector: CodeCollector) {
    this.collector = collector;
    this.state = createTransformSharedState(collector);
    this.ast = new AstHandlers(this.state);
    this.crypto = new CryptoHandlers(this.state);
    this.workbench = new WorkbenchHandlers();
  }

  async close(): Promise<void> {
    await this.state.cryptoHarnessPool.close();
  }

  protected get chains() {
    return this.state.chains;
  }
  protected get cryptoHarnessPool() {
    return this.state.cryptoHarnessPool;
  }

  protected async runCryptoHarness(
    code: string,
    functionName: string,
    testInputs: string[],
  ): Promise<{
    results: Array<{ input: string; output: string; duration: number; error?: string }>;
    allPassed: boolean;
  }> {
    return this.crypto.runCryptoHarnessProxy(code, functionName, testInputs);
  }

  async handleAstTransformPreviewTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleAstTransformPreview(args));
  }

  async handleAstTransformChainTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleAstTransformChain(args));
  }

  async handleAstTransformApplyTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleAstTransformApply(args));
  }

  async handleCryptoExtractStandaloneTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleCryptoExtractStandalone(args));
  }

  async handleCryptoTestHarnessTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleCryptoTestHarness(args));
  }

  async handleCryptoCompareTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleCryptoCompare(args));
  }

  async handleTransformWorkbenchTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTransformWorkbench(args));
  }

  handleAstTransformPreview = (args: Record<string, unknown>) =>
    this.ast.handleAstTransformPreview(args);
  handleAstTransformChain = (args: Record<string, unknown>) =>
    this.ast.handleAstTransformChain(args);
  handleAstTransformApply = (args: Record<string, unknown>) =>
    this.ast.handleAstTransformApply(args);
  handleCryptoExtractStandalone = (args: Record<string, unknown>) =>
    this.crypto.handleCryptoExtractStandalone(args);
  handleCryptoTestHarness = (args: Record<string, unknown>) =>
    this.crypto.handleCryptoTestHarness(args);
  handleCryptoCompare = (args: Record<string, unknown>) => this.crypto.handleCryptoCompare(args);
  handleTransformWorkbench = (args: Record<string, unknown>) =>
    this.workbench.handleTransformWorkbench(args);
}
