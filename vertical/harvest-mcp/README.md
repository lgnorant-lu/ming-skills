# HARvest MCP Server

## Overview

HARvest MCP Server enables AI coding agents to programmatically analyze API interactions and generate API wrappers. By analyzing browser network traffic (HAR files), it generates executable code that reproduces entire API workflows including authentication, dependency chains, and data extraction.

### Key Features

- **🧠 AI-Powered Analysis**: Uses LLM function calling for intelligent request analysis
- **📊 Dependency Graph Management**: Builds and manages complex API dependency chains  
- **🔧 Interactive Debugging**: Granular control with manual intervention capabilities
- **⚡ High Performance**: <30ms analysis, supports 12+ concurrent sessions
- **🔍 Real-Time Inspection**: Live access to analysis state via MCP resources
- **🛡️ Type-Safe**: Full TypeScript implementation with stricter tsconfig flags and Biome rules.
- **✅ Comprehensive Testing**: 100% coverage driven by a strict test-first (TDD) workflow


## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Server (STDIO)                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │   Tools     │  │ Resources   │  │  Prompts    │           │
│  │             │  │             │  │             │           │
│  │ session_*   │  │ dag.json    │  │ full_run    │           │
│  │ analysis_*  │  │ log.txt     │  │             │           │
│  │ debug_*     │  │ status.json │  │             │           │
│  │ codegen_*   │  │ code.ts     │  │             │           │
│  └─────────────┘  └─────────────┘  └─────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd harvest-mcp

# Install dependencies
bun install

# Build the project
bun run build
```

### Basic Usage

1. **Start the server:**
   ```bash
   bun run start
   ```

2. **Connect with MCP client:**
   ```bash
   # Using MCP Inspector (if available)
   mcp-inspector --transport stdio --command "bun run start"
   ```

3. **Basic workflow:**
   ```typescript
   // 1. Create a session
   const session = await tools.session.start({
     harPath: './path/to/traffic.har',
     cookiePath: './path/to/cookies.json', // optional
     prompt: 'Login to the application'
   });

   // 2. Start primary workflow analysis
   await tools.analysis_start_primary_workflow({ sessionId: session.id });
   
   // 3. Process dependencies
   while (!(await tools.analysis.is_complete({ sessionId: session.id }))) {
     await tools.analysis.process_next_node({ sessionId: session.id });
   }
   
   // 4. Generate code
   const code = await tools.codegen.generate_wrapper_script({ sessionId: session.id });
   ```

## MCP Tools Reference

### Session Management

#### `session.start`
Initializes a new analysis session.

**Parameters:**
- `harPath` (string): Path to HAR file
- `cookiePath` (string, optional): Path to cookie file  
- `prompt` (string): Description of the action to analyze
- `inputVariables` (object, optional): Pre-defined input variables

**Returns:**
```json
{
  "sessionId": "uuid-string"
}
```

#### `session.list`
Lists all active sessions.

**Returns:**
```json
{
  "sessions": [
    {
      "id": "uuid",
      "prompt": "Login to application",
      "createdAt": "2025-01-01T00:00:00Z",
      "isComplete": false,
      "nodeCount": 3
    }
  ]
}
```

#### `session.delete`
Deletes a session and cleans up resources.

**Parameters:**
- `sessionId` (string): Session to delete

### Analysis Tools

#### `analysis_start_primary_workflow`
Discover all workflows in the HAR file and automatically start analysis of the highest-priority workflow using the modern multi-workflow system.

**Parameters:**
- `sessionId` (string): Session ID

**Returns:**
```json
{
  "success": true,
  "workflow": {
    "id": "workflow-uuid",
    "name": "Login Flow",
    "description": "User authentication workflow"
  },
  "masterNode": {
    "url": "https://api.example.com/login",
    "method": "POST"
  }
}
```

#### `analysis.process_next_node`
Processes the next unresolved node in the dependency graph.

**Parameters:**
- `sessionId` (string): Session ID

**Returns:**
```json
{
  "processedNodeId": "uuid",
  "foundDependencies": [
    {
      "type": "request",
      "nodeId": "uuid",
      "extractedPart": "auth_token"
    }
  ],
  "status": "completed"
}
```

#### `analysis.is_complete`
Checks if the dependency analysis is finished.

**Parameters:**
- `sessionId` (string): Session ID

**Returns:**
```json
{
  "isComplete": true
}
```

### Debug Tools

#### `debug_get_unresolved_nodes`
Returns nodes with unresolved dependencies.

**Parameters:**
- `sessionId` (string): Session ID

**Returns:**
```json
{
  "unresolvedNodes": [
    {
      "nodeId": "uuid",
      "unresolvedParts": ["auth_token", "session_id"]
    }
  ]
}
```

#### `debug_get_node_details`
Gets detailed information about a specific node.

**Parameters:**
- `sessionId` (string): Session ID
- `nodeId` (string): Node to inspect

**Returns:**
```json
{
  "nodeType": "curl",
  "content": "curl -X POST ...",
  "dynamicParts": ["auth_token"],
  "extractedParts": ["user_id"],
  "inputVariables": {"username": "user@example.com"}
}
```

#### `debug_list_all_requests`
Lists all available requests from the HAR file.

**Parameters:**
- `sessionId` (string): Session ID

**Returns:**
```json
{
  "requests": [
    {
      "method": "POST",
      "url": "https://api.example.com/auth",
      "responsePreview": "{\"token\":\"abc123\"...}"
    }
  ]
}
```

#### `debug_force_dependency`
Manually creates a dependency link in the DAG.

**Parameters:**
- `sessionId` (string): Session ID
- `consumerNodeId` (string): Node that needs the dependency
- `providerNodeId` (string): Node that provides the dependency
- `providedPart` (string): The variable being provided

### Code Generation

#### `codegen.generate_wrapper_script`
Generates the final TypeScript wrapper script.

**Parameters:**
- `sessionId` (string): Session ID (analysis must be complete)

**Returns:**
```typescript
// Generated TypeScript code
async function authLogin(): Promise<ApiResponse> { /* ... */ }
async function searchDocuments(): Promise<ApiResponse> { /* ... */ }
async function loginAndSearchDocuments(): Promise<ApiResponse> { /* ... */ }
```

## MCP Resources

### `harvest://{sessionId}/dag.json`
Real-time JSON representation of the dependency graph.

**MIME Type:** `application/json`

**Example:**
```json
{
  "nodes": {
    "node-1": {
      "type": "master_curl", 
      "content": "curl -X POST ...",
      "dynamicParts": [],
      "extractedParts": ["result"]
    }
  },
  "edges": []
}
```

### `harvest://{sessionId}/log.txt`
Plain-text analysis log with timestamps.

**MIME Type:** `text/plain`

### `harvest://{sessionId}/status.json` 
Current analysis status and progress.

**MIME Type:** `application/json`

### `harvest://{sessionId}/generated_code.ts`
Generated TypeScript wrapper script (available after code generation).

**MIME Type:** `text/typescript`

## MCP Prompts

### `harvest.full_run`
Complete automated analysis from HAR to code generation.

**Arguments:**
- `harPath` (string): Path to HAR file
- `cookiePath` (string, optional): Path to cookie file
- `prompt` (string): Description of the action
- `inputVariables` (object, optional): Pre-defined variables

**Returns:**
Complete workflow results including generated code and analysis summary.

## Examples

### Complete Workflow Example

```typescript
// Automated login analysis
const result = await prompts.harvest.full_run({
  harPath: './login-traffic.har',
  cookiePath: './cookies.json',
  prompt: 'Login to the dashboard and navigate to settings'
});

console.log(result.generatedCode); // Complete TypeScript implementation
```

### Manual Debugging Example

```typescript
// Create session
const session = await tools.session.start({
  harPath: './complex-workflow.har',
  prompt: 'Multi-step document processing'
});

// Start analysis with modern workflow system
await tools.analysis_start_primary_workflow({ sessionId: session.id });

// Monitor progress
while (true) {
  const complete = await tools.analysis.is_complete({ sessionId: session.id });
  if (complete.isComplete) break;
  
  try {
    await tools.analysis.process_next_node({ sessionId: session.id });
  } catch (error) {
    // Handle failed dependency resolution
    const unresolved = await tools.debug.get_unresolved_nodes({ sessionId: session.id });
    console.log('Manual intervention needed:', unresolved);
    
    // Example manual fix
    await tools.debug.force_dependency({
      sessionId: session.id,
      consumerNodeId: 'problematic-node-id',
      providerNodeId: 'auth-node-id', 
      providedPart: 'auth_token'
    });
  }
}

// Generate final code
const code = await tools.codegen.generate_wrapper_script({ sessionId: session.id });
```

### State Inspection Example

```typescript
// Monitor analysis state in real-time
const sessionId = 'your-session-id';

// View dependency graph
const dagResource = await resources.read(`harvest://${sessionId}/dag.json`);
console.log('Current DAG:', JSON.parse(dagResource.content));

// Check analysis logs
const logResource = await resources.read(`harvest://${sessionId}/log.txt`);
console.log('Analysis log:', logResource.content);

// Monitor status
const statusResource = await resources.read(`harvest://${sessionId}/status.json`);
const status = JSON.parse(statusResource.content);
console.log(`Progress: ${status.totalNodes - status.nodesRemaining}/${status.totalNodes} nodes processed`);
```

## Performance Characteristics

Based on comprehensive benchmarking:

- **Analysis Speed**: <60ms for typical workflows
- **Tool Response Time**: <1ms for non-LLM operations
- **Memory Usage**: ~16MB per active session
- **Concurrent Sessions**: Supports 12+ simultaneous sessions
- **Bulk Operations**: 15 sessions + 20 operations in ~200ms

## Development

### Prerequisites

- **Bun**: Package manager and runtime
- **TypeScript**: Strict typing enabled
- **Node.js 18+**: For compatibility

### Development Commands

```bash
# Development server with hot reload
bun run dev

# Run tests
bun test                  # All tests
bun test:unit             # Unit tests only  
bun test:integration      # Integration tests
bun test:e2e              # End-to-end tests
bun test:coverage         # With coverage report

# Code quality
bun run check             # Lint and format check
bun run check:fix         # Auto-fix issues
bun run typecheck         # TypeScript validation

# Build
bun run build             # Production build
```

### Project Structure

```
src/
├── core/                 # Core business logic
│   ├── SessionManager.ts # Stateful session management
│   ├── DAGManager.ts     # Dependency graph operations
│   ├── HARParser.ts      # HAR file processing
│   ├── LLMClient.ts      # OpenAI integration
│   └── CodeGenerator.ts  # TypeScript code generation
├── agents/               # Analysis agents
│   ├── DynamicPartsAgent.ts
│   ├── InputVariablesAgent.ts
│   └── DependencyAgent.ts
├── models/               # Data models
│   └── Request.ts        # HTTP request modeling
├── types/                # TypeScript definitions
│   └── index.ts          # Centralized types
└── server.ts            # MCP server entry point

tests/
├── unit/                # Unit tests
├── integration/         # Integration tests
├── e2e/                # End-to-end tests
└── fixtures/           # Test data
```

### Adding New Features

1. **New Analysis Agent:**
   ```typescript
   // src/agents/MyNewAgent.ts
   export class MyNewAgent {
     static async analyze(session: HarvestSession): Promise<AnalysisResult> {
       // Implementation
     }
   }
   ```

2. **New MCP Tool:**
   ```typescript
   // In src/server.ts
   server.tool('my.new_tool', MyToolSchema, async (params) => {
     // Tool implementation
     return { content: [{ type: 'text', text: 'result' }] };
   });
   ```

3. **New Resource:**
   ```typescript
   // Add to resource handler
   case 'my_resource.json':
     return {
       contents: [{ type: 'text', text: JSON.stringify(data) }],
       mimeType: 'application/json'
     };
   ```

### Testing Guidelines

- **Unit Tests**: Test individual functions and classes
- **Integration Tests**: Test MCP tool workflows
- **E2E Tests**: Test complete user scenarios
- **Performance Tests**: Validate speed and memory requirements

All tests use Vitest with comprehensive mocking for LLM calls.

## Configuration

### Environment Variables

HARvest MCP Server supports multiple LLM providers. Configure your preferred provider using environment variables:

```bash
# LLM Provider Selection (optional)
# Supported values: openai, gemini
# If not set, auto-detects based on available API keys
LLM_PROVIDER=openai

# OpenAI Configuration
OPENAI_API_KEY=your-openai-api-key-here

# Google Gemini Configuration  
GOOGLE_API_KEY=your-google-api-key-here

# Model Configuration (optional)
# Overrides the default model for your provider
LLM_MODEL=gpt-4o  # OpenAI: gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-4, gpt-3.5-turbo
                  # Gemini: gemini-1.5-pro, gemini-1.5-flash, gemini-1.0-pro
```

#### Provider Auto-Detection

If `LLM_PROVIDER` is not set, the system automatically selects a provider based on available API keys:
1. If `OPENAI_API_KEY` is present → Uses OpenAI
2. If only `GOOGLE_API_KEY` is present → Uses Gemini
3. If neither is present → Throws configuration error

#### Supported Models

**OpenAI Models:**
- `gpt-4o` (default) - Latest GPT-4 Optimized
- `gpt-4o-mini` - Smaller, faster variant
- `gpt-4-turbo` - GPT-4 Turbo
- `gpt-4` - Standard GPT-4
- `gpt-3.5-turbo` - Fast, cost-effective

**Gemini Models:**
- `gemini-1.5-pro` (default) - Most capable
- `gemini-1.5-flash` - Faster, lighter variant
- `gemini-1.0-pro` - Previous generation

### Session Configuration

```typescript
// SessionManager configuration
const MAX_SESSIONS = 100;            // Maximum concurrent sessions
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;  // 5 minutes
```

## Troubleshooting

### Common Issues

**1. LLM API Failures**
```
Error: URL identification failed: API call failed
```
- Check API key environment variables (`OPENAI_API_KEY` or `GOOGLE_API_KEY`)
- Verify the correct provider is selected (check `LLM_PROVIDER`)
- Verify internet connectivity
- Check API status for your provider (OpenAI or Google)

**2. HAR File Parsing Errors**
```
Error: Failed to parse HAR file: Invalid JSON
```
- Ensure HAR file is valid JSON
- Check file permissions
- Verify file path is correct

**3. Session Not Found**
```
Error: Session not found: uuid
```
- Session may have expired (30 min timeout)
- Check session ID is correct
- Verify session was created successfully

**4. Memory Issues**
```
Out of memory errors
```
- Sessions automatically clean up after 30 minutes
- Manually delete unused sessions
- Check for memory leaks in custom code

### Debug Logging

Enable detailed logging:

```bash
# Enable MCP debug logging
DEBUG=mcp:* bun run start

# Server-side logging (stderr)
bun run start 2> debug.log
```

### Performance Debugging

Use the built-in performance tests:

```bash
# Run performance benchmarks
bun test tests/integration/performance.test.ts

# Monitor memory usage
bun test tests/integration/performance.test.ts --reporter=verbose
```

## Security Considerations

- **Local Execution Only**: Server uses STDIO transport, no network binding
- **File Path Validation**: All file paths are validated to prevent traversal
- **No Code Execution**: Server only generates code, never executes it
- **Session Isolation**: Each session is completely isolated
- **Automatic Cleanup**: Session data is cleared on timeout/termination

## Test Coverage & Quality

Current test metrics:
- **Total Tests**: 279 tests across 24 files
- **Pass Rate**: 100.0% (test-driven development power)
- **Coverage Areas**: Unit, integration, E2E, and performance tests

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make changes with tests: `bun test`
4. Ensure code quality: `bun run check`
5. Submit a pull request

### Code Standards

- **TypeScript Strict Mode**: No `any` types allowed
- **Test Coverage**: >90% target coverage
- **Performance**: Tools must respond in <200ms
- **Documentation**: All public APIs documented

## Aknowledges

The approach adopted on this project - HAR file creation, DAG transversing and script generation - is inspired on the amazing work of [Integuru](https://github.com/Integuru-AI/Integuru?tab=readme-ov-file) agent.

## Support

- **Issues**: [GitHub Issues](link-to-issues)
- **Documentation**: This README and inline code documentation
- **Examples**: See `tests/` directory for comprehensive examples
