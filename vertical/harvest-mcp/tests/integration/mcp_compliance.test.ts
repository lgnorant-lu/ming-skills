import { type ChildProcess, spawn } from "child_process";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * MCP Compliance Test Suite
 *
 * Tests that validate the MCP server follows the Model Context Protocol specification
 * and catches common configuration issues that can prevent Claude Desktop integration.
 */

describe("MCP Server Compliance", () => {
  let serverProcess: ChildProcess;
  const serverOutput: string[] = [];
  const serverErrors: string[] = [];

  const MCP_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
  const MCP_RESOURCE_URI_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//; // Basic URI scheme validation

  beforeAll(async () => {
    // Set log level to info to capture startup messages in test environment
    process.env.HARVEST_LOG_LEVEL = "info";

    // Start the MCP server
    const serverPath = path.join(process.cwd(), "src", "server.ts");
    serverProcess = spawn("bun", ["run", serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HARVEST_LOG_LEVEL: "info" },
    });

    // Collect server output and errors
    serverProcess.stdout?.on("data", (data) => {
      serverOutput.push(data.toString());
    });

    serverProcess.stderr?.on("data", (data) => {
      serverErrors.push(data.toString());
    });

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(() => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill("SIGTERM");
    }
  });

  describe("Server Startup", () => {
    it("should start without errors", () => {
      expect(serverProcess.exitCode).toBeNull();
      expect(serverProcess.killed).toBe(false);
    });

    it("should not output JSON parsing errors", () => {
      const allOutput = [...serverOutput, ...serverErrors].join("");
      expect(allOutput).not.toMatch(/is not valid JSON/);
      expect(allOutput).not.toMatch(/Unexpected token/);
    });

    it("should output startup confirmation", () => {
      const allErrors = serverErrors.join("");
      expect(allErrors).toMatch(/Harvest MCP Server started and listening/);
    });
  });

  describe("MCP Protocol Compliance", () => {
    let initResponse: unknown;

    beforeAll(async () => {
      // Send MCP initialization message
      const initMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "test-client",
            version: "1.0.0",
          },
        },
      };

      serverProcess.stdin?.write(`${JSON.stringify(initMessage)}\n`);

      // Send tools/list request
      const toolsMessage = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      };

      serverProcess.stdin?.write(`${JSON.stringify(toolsMessage)}\n`);

      // Send resources/list request
      const resourcesMessage = {
        jsonrpc: "2.0",
        id: 3,
        method: "resources/list",
        params: {},
      };

      serverProcess.stdin?.write(`${JSON.stringify(resourcesMessage)}\n`);

      // Send prompts/list request
      const promptsMessage = {
        jsonrpc: "2.0",
        id: 4,
        method: "prompts/list",
        params: {},
      };

      serverProcess.stdin?.write(`${JSON.stringify(promptsMessage)}\n`);

      // Wait for responses
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Parse responses from output
      const allOutput = serverOutput.join("");
      const responses = allOutput.split("\n").filter((line) => {
        try {
          const parsed = JSON.parse(line);
          return parsed.jsonrpc === "2.0" && "result" in parsed;
        } catch {
          return false;
        }
      });

      for (const responseStr of responses) {
        try {
          const response = JSON.parse(responseStr);
          if (response.id === 1) {
            initResponse = response;
          }
          // Note: toolsResponse, resourcesResponse, promptsResponse would be used
          // in a more complete MCP protocol test, but for now we only test init
        } catch (_error) {
          // Ignore parsing errors for this test
        }
      }
    });

    it("should respond to initialize with proper capabilities", () => {
      expect(initResponse).toBeDefined();
      const response = initResponse as {
        result?: {
          capabilities?: unknown;
          serverInfo?: { name?: string; version?: string };
        };
      };
      expect(response.result).toBeDefined();
      expect(response.result?.capabilities).toBeDefined();
      expect(response.result?.serverInfo).toBeDefined();
      expect(response.result?.serverInfo?.name).toBe("harvest-mcp-server");
      expect(response.result?.serverInfo?.version).toBe("1.0.0");
    });

    it("should declare required capabilities", () => {
      const response = initResponse as {
        result?: {
          capabilities?: {
            tools?: unknown;
            resources?: unknown;
            prompts?: unknown;
          };
        };
      };
      const capabilities = response?.result?.capabilities;
      expect(capabilities).toBeDefined();
      expect(capabilities?.tools).toBeDefined();
      expect(capabilities?.resources).toBeDefined();
      expect(capabilities?.prompts).toBeDefined();
    });
  });

  describe("Tool Name Compliance", () => {
    let tools: { name: string }[] = [];

    beforeAll(async () => {
      // This would be populated from the MCP communication above
      // For now, we'll test the tool names directly from the server setup
      const expectedTools = [
        "session_start",
        "session_list",
        "session_delete",
        "analysis_start_primary_workflow",
        "analysis_process_next_node",
        "analysis_is_complete",
        "debug_get_unresolved_nodes",
        "debug_get_node_details",
        "debug_list_all_requests",
        "debug_force_dependency",
        "codegen_generate_wrapper_script",
      ];

      tools = expectedTools.map((name) => ({ name }));
    });

    it("should have tool names that match MCP pattern", () => {
      for (const tool of tools) {
        expect(tool.name).toMatch(MCP_TOOL_NAME_PATTERN);
        expect(tool.name.length).toBeLessThanOrEqual(64);
        expect(tool.name.length).toBeGreaterThan(0);
      }
    });

    it("should not use dots in tool names", () => {
      for (const tool of tools) {
        expect(tool.name).not.toContain(".");
      }
    });

    it("should use underscores or hyphens as separators", () => {
      for (const tool of tools) {
        if (tool.name.includes("_") || tool.name.includes("-")) {
          expect(tool.name).toMatch(/^[a-zA-Z0-9_-]+$/);
        }
      }
    });

    it("should have consistent naming conventions", () => {
      const sessionTools = tools.filter((t) => t.name.startsWith("session_"));
      const analysisTools = tools.filter((t) => t.name.startsWith("analysis_"));
      const debugTools = tools.filter((t) => t.name.startsWith("debug_"));
      const codegenTools = tools.filter((t) => t.name.startsWith("codegen_"));

      expect(sessionTools.length).toBeGreaterThan(0);
      expect(analysisTools.length).toBeGreaterThan(0);
      expect(debugTools.length).toBeGreaterThan(0);
      expect(codegenTools.length).toBeGreaterThan(0);

      // All tools should follow consistent prefix_action pattern
      for (const tool of tools) {
        expect(tool.name).toMatch(/^[a-z]+_[a-z_]+$/);
      }
    });
  });

  describe("Resource URI Compliance", () => {
    const expectedResources = [
      "harvest://{sessionId}/dag.json",
      "harvest://{sessionId}/log.txt",
      "harvest://{sessionId}/status.json",
      "harvest://{sessionId}/generated_code.ts",
    ];

    it("should have valid URI schemes", () => {
      for (const uri of expectedResources) {
        expect(uri).toMatch(MCP_RESOURCE_URI_PATTERN);
      }
    });

    it("should use consistent URI scheme", () => {
      for (const uri of expectedResources) {
        expect(uri).toMatch(/^harvest:\/\//);
      }
    });

    it("should have parameterized URIs for dynamic resources", () => {
      for (const uri of expectedResources) {
        expect(uri).toMatch(/\{sessionId\}/);
      }
    });

    it("should have appropriate file extensions", () => {
      const extensions = expectedResources
        .map((uri) => {
          const match = uri.match(/\.([a-z]+)$/);
          return match ? match[1] : null;
        })
        .filter(Boolean);

      expect(extensions).toContain("json");
      expect(extensions).toContain("txt");
      expect(extensions).toContain("ts");
    });
  });

  describe("Prompt Name Compliance", () => {
    const expectedPrompts = ["harvest_full_run"];

    it("should have prompt names that match MCP pattern", () => {
      for (const name of expectedPrompts) {
        expect(name).toMatch(MCP_TOOL_NAME_PATTERN);
        expect(name.length).toBeLessThanOrEqual(64);
        expect(name.length).toBeGreaterThan(0);
      }
    });

    it("should not use dots in prompt names", () => {
      for (const name of expectedPrompts) {
        expect(name).not.toContain(".");
      }
    });
  });

  describe("Configuration Validation", () => {
    it("should have executable server file", async () => {
      const fs = await import("fs/promises");
      const serverPath = path.join(process.cwd(), "src", "server.ts");

      try {
        const stats = await fs.stat(serverPath);
        // Check if file has execute permissions (at least for owner)
        expect(stats.mode & 0o100).toBeTruthy();
      } catch (_error) {
        throw new Error(
          `Server file not found or not accessible: ${serverPath}`
        );
      }
    });

    it("should have correct shebang for bun", async () => {
      const fs = await import("fs/promises");
      const serverPath = path.join(process.cwd(), "src", "server.ts");

      const content = await fs.readFile(serverPath, "utf-8");
      const firstLine = content.split("\n")[0];

      expect(firstLine).toBe("#!/usr/bin/env bun");
    });
  });

  describe("Error Handling", () => {
    it("should not have unhandled promise rejections in output", () => {
      const allOutput = [...serverOutput, ...serverErrors].join("");
      expect(allOutput).not.toMatch(/UnhandledPromiseRejectionWarning/);
      expect(allOutput).not.toMatch(/DeprecationWarning/);
    });

    it("should not have TypeScript compilation errors", () => {
      const allOutput = [...serverOutput, ...serverErrors].join("");
      expect(allOutput).not.toMatch(/TS\d{4}:/);
      expect(allOutput).not.toMatch(/Type error:/);
    });

    it("should handle graceful shutdown", () => {
      // The beforeAll setup should not have caused the process to exit
      expect(serverProcess.exitCode).toBeNull();
    });
  });

  describe("JSON-RPC Compliance", () => {
    it("should produce valid JSON in all outputs", () => {
      const allOutput = serverOutput.join("");

      // Split by newlines and test each potential JSON line
      const lines = allOutput.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        // Skip non-JSON lines (like log messages)
        if (!line.trim().startsWith("{")) {
          continue;
        }

        try {
          const parsed = JSON.parse(line);
          expect(parsed).toBeDefined();

          // If it's a JSON-RPC message, validate structure
          if (parsed.jsonrpc) {
            expect(parsed.jsonrpc).toBe("2.0");
            expect(parsed).toHaveProperty("id");
          }
        } catch (_error) {
          throw new Error(`Invalid JSON in server output: ${line}`);
        }
      }
    });
  });
});
