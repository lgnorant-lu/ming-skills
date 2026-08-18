#!/usr/bin/env bun

/**
 * MCP Validation Script
 *
 * Quick validation script to catch common MCP server configuration issues
 * before deployment. Run this before committing changes to the MCP server.
 *
 * Usage: bun scripts/validate-mcp.ts
 */

import { type ChildProcess, spawn } from "child_process";
import path from "path";
import fs from "fs/promises";

const MCP_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const MCP_RESOURCE_URI_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

type LogType = "info" | "warn" | "error" | "success";

interface ClaudeDesktopConfig {
  mcpServers?: {
    [key: string]: {
      command: string;
      args?: string[];
    };
  };
}

class MCPValidator {
  private errors: string[] = [];
  private warnings: string[] = [];

  private log(message: string, type: LogType = "info"): void {
    const prefix: Record<LogType, string> = {
      info: "ℹ️",
      warn: "⚠️",
      error: "❌",
      success: "✅",
    };

    console.log(`${prefix[type]} ${message}`);

    if (type === "error") {
      this.errors.push(message);
    } else if (type === "warn") {
      this.warnings.push(message);
    }
  }

  private async validateServerFile(): Promise<void> {
    this.log("Validating server file configuration...");

    const serverPath = path.join(process.cwd(), "src", "server.ts");

    try {
      // Check if file exists
      const stats = await fs.stat(serverPath);

      // Check executable permissions
      if (!(stats.mode & 0o100)) {
        this.log("Server file is not executable", "error");
      }

      // Check shebang
      const content = await fs.readFile(serverPath, "utf-8");
      const firstLine = content.split("\n")[0];

      if (firstLine !== "#!/usr/bin/env bun") {
        this.log(
          `Invalid shebang: ${firstLine}. Expected: #!/usr/bin/env bun`,
          "error"
        );
      }

      this.log("Server file configuration is valid", "success");
    } catch {
      this.log(`Server file not found: ${serverPath}`, "error");
    }
  }

  private async validateClaudeDesktopConfig(): Promise<void> {
    this.log("Validating Claude Desktop configuration...");

    const configPath = path.join(
      process.env.HOME || "",
      "Library/Application Support/Claude/claude_desktop_config.json"
    );

    try {
      const content = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(content) as ClaudeDesktopConfig;

      const mcpServers = config.mcpServers || {};
      const harvestConfig = mcpServers["harvest-mcp"];

      if (!harvestConfig) {
        this.log(
          "No harvest-mcp configuration found in Claude Desktop config",
          "warn"
        );
        return;
      }

      if (harvestConfig.command !== "bun") {
        this.log(
          `Claude Desktop config uses wrong command: ${harvestConfig.command}. Expected: bun`,
          "error"
        );
      }

      if (!harvestConfig.args || !harvestConfig.args.includes("run")) {
        this.log(
          "Claude Desktop config missing 'run' argument for bun",
          "error"
        );
      }

      this.log("Claude Desktop configuration is valid", "success");
    } catch {
      this.log("Claude Desktop config not found or invalid", "warn");
    }
  }

  private extractToolNamesFromServer(content: string): string[] {
    // Extract tool names from server.tool() calls
    const toolPattern = /this\.server\.tool\(\s*["']([^"']+)["']/g;
    const tools: string[] = [];
    const matches = content.matchAll(toolPattern);

    for (const match of matches) {
      if (match[1]) {
        tools.push(match[1]);
      }
    }

    return tools;
  }

  private extractPromptNamesFromServer(content: string): string[] {
    // Extract prompt names from server.prompt() calls
    const promptPattern = /this\.server\.prompt\(\s*["']([^"']+)["']/g;
    const prompts: string[] = [];
    const matches = content.matchAll(promptPattern);

    for (const match of matches) {
      if (match[1]) {
        prompts.push(match[1]);
      }
    }

    return prompts;
  }

  private extractResourceUrisFromServer(content: string): string[] {
    // Extract resource URIs from server.resource() calls
    const resourcePattern = /this\.server\.resource\(\s*["']([^"']+)["']/g;
    const resources: string[] = [];
    const matches = content.matchAll(resourcePattern);

    for (const match of matches) {
      if (match[1]) {
        resources.push(match[1]);
      }
    }

    return resources;
  }

  private async validateNamingConventions(): Promise<void> {
    this.log("Validating MCP naming conventions...");

    const serverPath = path.join(process.cwd(), "src", "server.ts");
    const content = await fs.readFile(serverPath, "utf-8");

    // Validate tool names
    const tools = this.extractToolNamesFromServer(content);
    this.log(`Found ${tools.length} tools to validate`);

    for (const tool of tools) {
      if (!MCP_TOOL_NAME_PATTERN.test(tool)) {
        this.log(
          `Invalid tool name: '${tool}'. Must match pattern ^[a-zA-Z0-9_-]{1,64}$`,
          "error"
        );
      }

      if (tool.includes(".")) {
        this.log(
          `Tool name contains dots: '${tool}'. Use underscores instead`,
          "error"
        );
      }

      if (tool.length > 64) {
        this.log(
          `Tool name too long: '${tool}' (${tool.length} chars, max 64)`,
          "error"
        );
      }
    }

    // Validate prompt names
    const prompts = this.extractPromptNamesFromServer(content);
    this.log(`Found ${prompts.length} prompts to validate`);

    for (const prompt of prompts) {
      if (!MCP_TOOL_NAME_PATTERN.test(prompt)) {
        this.log(
          `Invalid prompt name: '${prompt}'. Must match pattern ^[a-zA-Z0-9_-]{1,64}$`,
          "error"
        );
      }

      if (prompt.includes(".")) {
        this.log(
          `Prompt name contains dots: '${prompt}'. Use underscores instead`,
          "error"
        );
      }
    }

    // Validate resource URIs
    const resources = this.extractResourceUrisFromServer(content);
    this.log(`Found ${resources.length} resources to validate`);

    for (const resource of resources) {
      if (!MCP_RESOURCE_URI_PATTERN.test(resource)) {
        this.log(
          `Invalid resource URI: '${resource}'. Must be a valid URI scheme`,
          "error"
        );
      }
    }

    if (this.errors.length === 0) {
      this.log("All naming conventions are valid", "success");
    }
  }

  private async validateServerStartup(): Promise<void> {
    this.log("Testing server startup...");

    return new Promise<void>((resolve) => {
      const serverPath = path.join(process.cwd(), "src", "server.ts");
      const serverProcess: ChildProcess = spawn("bun", ["run", serverPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let startupSuccessful = false;

      const timeout = setTimeout(() => {
        if (!serverProcess.killed) {
          serverProcess.kill("SIGTERM");
        }

        if (!startupSuccessful) {
          this.log("Server startup timed out", "error");
        }

        resolve();
      }, 3000);

      serverProcess.stderr?.on("data", (data: Buffer) => {
        const output = data.toString();

        if (output.includes("Harvest MCP Server started")) {
          startupSuccessful = true;
          this.log("Server started successfully", "success");
        }

        if (output.includes("error") || output.includes("Error")) {
          this.log(`Server error: ${output.trim()}`, "error");
        }
      });

      serverProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString();

        if (
          output.includes("Unexpected token") ||
          output.includes("is not valid JSON")
        ) {
          this.log(`JSON parsing error: ${output.trim()}`, "error");
        }
      });

      serverProcess.on("exit", (code: number | null) => {
        clearTimeout(timeout);

        if (code !== null && code !== 0) {
          this.log(`Server exited with code ${code}`, "error");
        }

        resolve();
      });

      // Give the server a moment to start, then send SIGTERM
      setTimeout(() => {
        if (!serverProcess.killed) {
          serverProcess.kill("SIGTERM");
        }
        clearTimeout(timeout);
        resolve();
      }, 1500);
    });
  }

  private async validateTypeScript(): Promise<void> {
    this.log("Running TypeScript validation...");

    return new Promise<void>((resolve) => {
      const tsc: ChildProcess = spawn("bunx", ["tsc", "--noEmit", "--strict"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let output = "";

      tsc.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
      });

      tsc.stderr?.on("data", (data: Buffer) => {
        output += data.toString();
      });

      tsc.on("exit", (code: number | null) => {
        if (code !== 0) {
          this.log("TypeScript validation failed", "error");
          if (output.trim()) {
            this.log(`TypeScript errors:\n${output}`, "error");
          }
        } else {
          this.log("TypeScript validation passed", "success");
        }
        resolve();
      });
    });
  }

  public async run(): Promise<void> {
    console.log("🔍 MCP Server Validation\n");

    await this.validateServerFile();
    await this.validateClaudeDesktopConfig();
    await this.validateNamingConventions();
    await this.validateTypeScript();
    await this.validateServerStartup();

    console.log("\n📊 Validation Summary:");
    console.log(`   Errors: ${this.errors.length}`);
    console.log(`   Warnings: ${this.warnings.length}`);

    if (this.errors.length > 0) {
      console.log("\n❌ Validation Failed");
      console.log("Errors that must be fixed:");
      for (const error of this.errors) {
        console.log(`   • ${error}`);
      }
      process.exit(1);
    } else {
      console.log("\n✅ All validations passed!");
      if (this.warnings.length > 0) {
        console.log("Warnings to consider:");
        for (const warning of this.warnings) {
          console.log(`   • ${warning}`);
        }
      }
      process.exit(0);
    }
  }
}

// Run the validator
const validator = new MCPValidator();
validator.run().catch((error: Error) => {
  console.error("❌ Validation script failed:", error);
  process.exit(1);
});
