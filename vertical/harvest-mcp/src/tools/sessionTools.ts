import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  HarvestError,
  type SessionStartResponse,
  type SessionStartSchema,
  type SessionToolContext,
} from "../types/index.js";

/**
 * Handle session_start tool call
 */
export async function handleSessionStart(
  params: z.infer<typeof SessionStartSchema>,
  context: SessionToolContext
): Promise<CallToolResult> {
  try {
    const sessionId = await context.sessionManager.createSession(params);

    // Get session to check HAR validation results
    const session = context.sessionManager.getSession(sessionId);
    if (!session) {
      throw new HarvestError(
        "Session not found after creation",
        "SESSION_NOT_FOUND"
      );
    }
    const harValidation = session.harData.validation;

    const response: SessionStartResponse = {
      sessionId,
      message: "Session created successfully",
      harPath: params.harPath,
      prompt: params.prompt,
      harValidation: harValidation
        ? {
            quality: harValidation.quality,
            stats: harValidation.stats,
            isValid: harValidation.isValid,
          }
        : undefined,
    };

    // Add warnings or recommendations if HAR quality is concerning
    if (harValidation) {
      if (harValidation.quality === "empty") {
        response.warning = "HAR file is empty or contains no usable requests";
        response.recommendations = harValidation.recommendations || [];
      } else if (harValidation.quality === "poor") {
        response.warning = "HAR file has limited useful content";
        response.recommendations = (harValidation.recommendations || []).slice(
          0,
          3
        ); // Limit recommendations
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Failed to create session: ${error instanceof Error ? error.message : "Unknown error"}`,
      "SESSION_CREATE_ERROR"
    );
  }
}

/**
 * Handle session_list tool call
 */
export function handleSessionList(context: SessionToolContext): CallToolResult {
  try {
    const sessions = context.sessionManager.listSessions();
    const stats = context.sessionManager.getStats();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              sessions,
              stats,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Failed to list sessions: ${error instanceof Error ? error.message : "Unknown error"}`,
      "SESSION_LIST_ERROR"
    );
  }
}

/**
 * Handle session_delete tool call
 */
export function handleSessionDelete(
  params: { sessionId: string },
  context: SessionToolContext
): CallToolResult {
  try {
    const deleted = context.sessionManager.deleteSession(params.sessionId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: deleted,
            sessionId: params.sessionId,
            message: deleted
              ? "Session deleted successfully"
              : "Session not found",
          }),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Failed to delete session: ${error instanceof Error ? error.message : "Unknown error"}`,
      "SESSION_DELETE_ERROR"
    );
  }
}

/**
 * Register session management tools with the MCP server
 */
export function registerSessionTools(
  server: McpServer,
  context: SessionToolContext
): void {
  server.tool(
    "session_start",
    "Initialize a new Harvest analysis session with HAR file and prompt. Creates a session that can be used for step-by-step API analysis and code generation.",
    {
      harPath: z
        .string()
        .min(1)
        .describe(
          "Absolute path to the HAR file to analyze. HAR files contain recorded HTTP requests and responses from browser network traffic."
        ),
      cookiePath: z
        .string()
        .optional()
        .describe(
          "Optional path to a Netscape-format cookie file for session authentication"
        ),
      prompt: z
        .string()
        .min(1)
        .describe(
          "Analysis prompt describing what you want to achieve or extract from the HAR data"
        ),
      inputVariables: z
        .record(z.string())
        .optional()
        .describe(
          "Optional key-value pairs for replacing dynamic parts in requests"
        ),
      harParsingOptions: z
        .object({
          excludeKeywords: z.array(z.string()).optional(),
          includeAllApiRequests: z.boolean().optional(),
          minQualityThreshold: z.enum(["excellent", "good", "poor"]).optional(),
          preserveAnalyticsRequests: z.boolean().optional(),
          customFilters: z.array(z.function()).optional(),
        })
        .optional()
        .describe("Advanced HAR parsing configuration options"),
    },
    async (params: z.infer<typeof SessionStartSchema>) =>
      handleSessionStart(params, context)
  );

  server.tool(
    "session_list",
    "List all active analysis sessions with their status",
    {},
    async () => handleSessionList(context)
  );

  server.tool(
    "session_delete",
    "Delete an analysis session and free resources",
    {
      sessionId: z.string().uuid().describe("UUID of the session to delete"),
    },
    async (params: { sessionId: string }) =>
      handleSessionDelete(params, context)
  );
}
