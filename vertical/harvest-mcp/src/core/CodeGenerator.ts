import { HarvestError, type HarvestSession } from "../types/index.js";
import { createComponentLogger } from "../utils/logger.js";
import { WrapperScriptOrchestrator } from "./ast/WrapperScriptOrchestrator.js";

const logger = createComponentLogger("code-generator");

/**
 * Generate a complete TypeScript wrapper script from a completed analysis session
 * Uses AST-based code generation for type-safe, maintainable output
 *
 * Takes a fully analyzed session with resolved dependencies and generates a complete
 * wrapper script that reproduces the API workflow.
 */
export async function generateWrapperScript(
  session: HarvestSession
): Promise<string> {
  // Comprehensive session validation
  if (!session) {
    throw new Error("Session is null or undefined");
  }

  if (!session.state) {
    throw new Error("Session state is missing");
  }

  if (!session.prompt) {
    throw new Error("Session prompt is missing");
  }

  // Validate that analysis is complete using DAG as primary source of truth
  if (!session.dagManager.isComplete()) {
    const unresolvedNodes = session.dagManager.getUnresolvedNodes();

    const blockers = unresolvedNodes.map(
      (node) =>
        `Node ${node.nodeId} has unresolved parts: ${node.unresolvedParts.join(", ")}`
    );

    throw new HarvestError(
      `Analysis not complete. Unresolved nodes: ${blockers.join("; ")}`,
      "ANALYSIS_INCOMPLETE"
    );
  }

  // Use AST-based orchestration for code generation
  const orchestrator = new WrapperScriptOrchestrator({
    useInMemoryFileSystem: true,
    formatCode: true,
    fileName: "api-client.ts",
    autoImports: true,
    useSharedTypes: true, // Enable shared type imports to reduce boilerplate
  });

  logger.info("Generating code using AST orchestration", {
    sessionId: session.id,
    prompt: session.prompt,
  });

  return await orchestrator.generateWrapperScript(session);
}
