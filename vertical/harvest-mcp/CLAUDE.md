# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Harvest MCP Server is a TypeScript-based Model Context Protocol server that provides AI-powered API analysis and integration code generation. It analyzes browser network traffic (HAR files) to generate executable code that reproduces entire API workflows.

**Multi-Provider LLM Support**: Supports OpenAI GPT models and Google Gemini models with automatic provider detection and seamless switching.

## Development Commands

### Essential Commands
```bash
# Install dependencies
bun install

# Development
bun run dev             # Development server with hot reload
bun run start           # Start the MCP server

# Testing
bun test                # Run all tests
bun test:unit           # Unit tests only
bun test:integration    # Integration tests only
bun test:e2e            # End-to-end tests only
bun test:watch          # Watch mode
bun test:coverage       # With coverage report

# Code Quality (run before committing)
bun run check           # Lint and format check
bun run typecheck       # TypeScript type checking
bun run knip            # Find unused code and dependencies

# Build
bun run build           # Lint, format, and build for production
```

**IMPORTANT**: before assume a task as done your last command always is `bun validate:quick` and only all issues underlying causes are adressed. on every todo list you write run `validate:quick` is its last task.

When investigating bug reports, you check the involved artifacts saved at `˜/.harvest/`

### Testing Single Files
```bash
# Run a single test file
bun test tests/unit/core/HARParser.test.ts

# Run tests matching a pattern
bun test -t "HARParser"
```

## Directory Structure

```
src/
├── agents/              # AI-powered analysis modules using OpenAI function calling
│   ├── DependencyAgent.ts      # Analyzes requests to identify dependencies between them
│   ├── DynamicPartsAgent.ts    # Detects dynamic elements (timestamps, IDs) in requests
│   ├── InputVariablesAgent.ts  # Identifies user input requirements in requests
├── core/               # Core business logic and services
│   ├── CodeGenerator.ts         # Generates executable TypeScript code from analysis
│   ├── CookieParser.ts          # Parses Netscape cookie files for authentication
│   ├── DAGManager.ts            # Manages dependency graphs using graphlib
│   ├── HARParser.ts             # Parses HAR files into structured request models
│   ├── LLMClient.ts             # OpenAI client with function calling capabilities
│   ├── ManualSessionManager.ts  # Manual browser session lifecycle management
│   ├── ArtifactCollector.ts     # Real-time artifact collection (HAR, cookies, screenshots)
│   ├── BrowserAgentFactory.ts   # Browser instance creation and configuration
│   └── SessionManager.ts        # Stateful session management with FSM pattern
├── models/             # Data models and domain objects
│   └── Request.ts          # HTTP request representation with headers, body, etc.
├── browser/            # Browser automation components
│   ├── types.ts             # Browser-specific type definitions and interfaces
│   ├── BrowserProvider.ts   # Browser instance provider
│   ├── logger.ts           # Browser operation logging
│   └── AgentFactory.ts     # Browser agent creation utilities
├── types/              # TypeScript type definitions and schemas
│   ├── index.ts            # Centralized types, interfaces, and Zod schemas
├── tools/              # MCP tool implementations (currently empty)
├── utils/              # Utility functions and helpers
└── server.ts           # Main MCP server entry point and tool handlers

tests/
├── unit/               # Isolated component tests with mocks
├── integration/        # Multi-component interaction tests
├── e2e/               # Full workflow tests with real HAR files
├── fixtures/          # Test data including sample HAR files
├── manual/            # Scripts for manual testing and debugging
├── mocks/             # Mock implementations for testing
└── setup/             # Test configuration and helper functions

## Architecture

### Core Components

1. **Agents** (`src/agents/`): AI-powered analysis modules using OpenAI function calling
   - `DependencyAgent`: Identifies request dependencies and builds DAG
   - `DynamicPartsAgent`: Detects dynamic elements in requests
   - `InputVariablesAgent`: Finds user input requirements

2. **Core Services** (`src/core/`):
   - `SessionManager`: Manages stateful MCP sessions with FSM pattern
   - `DAGManager`: Builds and manages dependency graphs using graphlib
   - `CodeGenerator`: Generates executable TypeScript code
   - `HARParser`: Processes HAR files into request models
   - `LLMClient`: OpenAI integration with function calling

3. **MCP Server** (`src/server.ts`): Main entry point implementing MCP protocol with:
   - **Analysis Tools**: session_start, analysis_start_primary_workflow, analysis_process_next_node, analysis_is_complete
   - **Debug Tools**: debug_get_unresolved_nodes, debug_get_node_details, debug_list_all_requests, debug_force_dependency
   - **Code Generation**: codegen_generate_wrapper_script
   - **Manual Session Tools**: session_start_manual, session_stop_manual, session_list_manual
   - **Resources**: session DAG, logs, status, generated code, manual session artifacts

4. **Browser Automation** (`src/core/`, `src/browser/`):
   - `ManualSessionManager`: Manual browser session lifecycle management
   - `ArtifactCollector`: Real-time HAR, cookie, and screenshot collection
   - `BrowserAgentFactory`: Browser instance creation with Playwright
   - `BrowserProvider`: Browser instance provider
   - `AgentFactory`: Browser agent creation utilities

### Session State Flow
```
START → INITIAL_ANALYSIS → [USER_REVIEW] → [DEPENDENCY_GRAPH] → CODE_READY → COMPLETE
```

Sessions are managed statewide with transitions controlled by SessionManager's FSM implementation.

### Manual Browser Session Workflow
```
START_MANUAL → BROWSER_LAUNCH → ARTIFACT_COLLECTION → [USER_INTERACTION] → STOP_MANUAL → ARTIFACT_GENERATION
```

Manual sessions enable real-time browser interaction with automatic artifact collection for later analysis.

### Testing Strategy
- Unit tests: Individual component testing with mocks
- Integration tests: Multi-component interaction testing
- E2E tests: Full workflow testing with real HAR files
- Minimum 80% coverage requirement

## Key Development Patterns

1. **TypeScript**: Strict typing enabled, avoid `any` types
2. **Error Handling**: Use proper error types and logging via SessionManager
3. **Async Operations**: All agent and LLM operations are async
4. **State Management**: Session state persists across tool calls
5. **Testing**: Write tests for all new functionality, maintain coverage

---

## Manual Browser Session Workflows

Harvest MCP provides powerful manual browser session capabilities for interactive exploration and artifact collection. These sessions generate HAR files, cookies, and screenshots that can be used for analysis.

### Basic Manual Session

Start a manual browser session:
```javascript
// Using MCP tools
await session_start_manual({
  url: "https://example.com",
  config: {
    artifactConfig: {
      enabled: true,
      saveHar: true,
      saveCookies: true,
      saveScreenshots: true
    }
  }
})
```

Stop the session and collect artifacts:
```javascript
await session_stop_manual({
  sessionId: "uuid-session-id",
  takeScreenshot: true,
  reason: "analysis_complete"
})
```

### Advanced Configuration

```javascript
await session_start_manual({
  url: "https://myapp.com/login", 
  config: {
    timeout: 30, // Auto-cleanup after 30 minutes
    browserOptions: {
      headless: false, // Visible browser for manual interaction
      viewport: {
        width: 1920,
        height: 1080
      },
      contextOptions: {
        deviceScaleFactor: 1
      }
    },
    artifactConfig: {
      enabled: true,
      outputDir: "./session-artifacts",
      saveHar: true,
      saveCookies: true, 
      saveScreenshots: true,
      autoScreenshotInterval: 30 // Screenshot every 30 seconds
    }
  }
})
```

### Workflow Integration

1. **Manual Exploration**:
   ```javascript
   // Start manual session
   const session = await session_start_manual({
     url: "https://api.example.com/docs"
   })
   
   // User manually interacts with the browser:
   // - Navigate through API documentation
   // - Fill out forms
   // - Trigger API calls
   // - Login flows
   
   // Stop session and collect artifacts
   const result = await session_stop_manual({
     sessionId: session.sessionId
   })
   ```

2. **HAR Analysis**:
   ```javascript
   // Use generated HAR file for analysis
   const analysisSession = await session_start({
     harPath: result.artifacts.find(a => a.type === 'har').path,
     prompt: "Generate integration code for the API workflow I just completed"
   })
   
   // Continue with standard harvest analysis workflow...
   ```

### Manual Session Resources

Access real-time session information via MCP resources:

- `harvest://manual/sessions.json` - List all active manual sessions
- `harvest://manual/{sessionId}/artifacts.json` - Real-time artifact status 
- `harvest://manual/{sessionId}/session-log.txt` - Session activity log

### Use Cases

**API Exploration**:
- Start manual session on API documentation site
- Follow authentication flows manually
- Trigger complex API sequences
- Generate comprehensive HAR files for analysis

**E-commerce Workflows**:
- Manual session on shopping site
- Complete purchase flow manually
- Capture all network traffic and cookies
- Generate integration code for checkout API

**Authentication Flows**:
- Manual OAuth/SAML flows
- Capture authentication cookies
- Generate auth integration code
- Test complex login sequences

**SPA Debugging**:
- Manual interaction with Single Page Applications
- Capture dynamic network requests
- Screenshot important UI states
- Generate API integration for SPA backends

### Session Management

List active sessions:
```javascript
const sessions = await session_list_manual()
// Returns: { totalSessions: 2, sessions: [...] }
```

Multiple concurrent sessions supported:
```javascript
// Start multiple sessions for different workflows
const loginSession = await session_start_manual({ url: "https://app.com/login" })
const apiSession = await session_start_manual({ url: "https://api.app.com/docs" })
const checkoutSession = await session_start_manual({ url: "https://shop.app.com" })
```

### Artifact Collection

Generated artifacts include:

**HAR Files**: Complete network traffic capture
- HTTP requests and responses
- Headers, cookies, timing information
- Compatible with HAR 1.2 specification
- Ready for harvest analysis

**Cookie Files**: Authentication state capture
- JSON format with metadata
- Domain, path, security flags
- Compatible with existing harvest cookie parsing

**Screenshots**: Visual documentation
- Full-page PNG screenshots
- Automatic interval captures
- Final state documentation

### Best Practices

1. **Resource Management**:
   - Always stop sessions when done
   - Use timeout settings for long-running sessions
   - Clean up artifacts after analysis

2. **Security**:
   - Be careful with sensitive authentication flows
   - Review generated artifacts before sharing
   - Use secure output directories

3. **Performance**:
   - Disable artifacts for quick sessions
   - Use headless mode for automated workflows
   - Limit concurrent sessions

4. **Debugging**:
   - Use session logs for troubleshooting
   - Check session resources for real-time status
   - Enable auto-screenshots for complex flows

### Error Handling

Common error scenarios:
```javascript
// Invalid configuration
try {
  await session_start_manual({
    config: {
      timeout: -1, // Invalid
      browserOptions: { viewport: { width: 100 } } // Too small
    }
  })
} catch (error) {
  // Handle validation errors
}

// Session not found
try {
  await session_stop_manual({ sessionId: "invalid-uuid" })
} catch (error) {
  // Handle missing session
}
```

### Integration Examples

**Complete API Discovery Workflow**:
```bash
# 1. Start manual session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "session_start_manual", "params": {"url": "https://api.example.com"}}'

# 2. User manually explores API, triggers requests

# 3. Stop session  
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "session_stop_manual", "params": {"sessionId": "uuid"}}'

# 4. Analyze generated HAR
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "session_start", "params": {"harPath": "/path/to/session.har", "prompt": "Generate API client"}}'
```

---

## MCP Protocol Compliance & Logging

Harvest MCP Server strictly adheres to the Model Context Protocol specification for stdio transport logging requirements.

### ⚠️ Critical MCP Logging Rules

**Stdout Usage**: Reserved **exclusively** for JSON-RPC messages
- No application logs, debug output, or console messages allowed
- Any stdout contamination breaks MCP client communication
- Violations cause Zod validation errors: "Invalid literal value, expected '2.0'"

**Stderr Usage**: All application logging goes here
- Structured JSON logs via Pino logger
- Safe for debugging and monitoring
- MCP clients may capture or ignore stderr

### Implementation Details

The logger configuration in `src/utils/logger.ts` automatically detects MCP mode and routes logs appropriately:

**MCP Mode Detection**:
```typescript
const isMcpMode = 
  process.env.MCP_STDIO === "true" ||
  process.argv.includes("--stdio") ||
  (process.stdout.isTTY === false && process.stdin.isTTY === false);
```

**Stream Routing**:
- **MCP Mode**: `pino.destination(2)` → stderr only
- **Development**: Pretty-printed logs with colors
- **Production**: Standard JSON logging

### Troubleshooting Log Interference

If you see Zod validation errors like:
```
"Invalid literal value, expected '2.0'"
"Unrecognized keys: 'level', 'time', 'pid', 'hostname', 'name', 'msg'"
```

**Causes**:
1. Application logs leaking to stdout
2. External MCP wrapper/client logging 
3. Incorrect Pino transport configuration
4. Console.log calls in MCP mode

**Solutions**:
1. Verify `MCP_STDIO=true` environment variable is set
2. Check that all logs go to stderr: `bun run start 2>logs.txt 1>stdout.txt`
3. Ensure stdout contains only JSON-RPC messages
4. Look for external MCP client debug/verbose logging modes

### Logging Best Practices

✅ **Do**: Use structured logging via Pino logger
✅ **Do**: Log errors, debugging info to stderr 
✅ **Do**: Test stdout cleanliness: `MCP_STDIO=true bun start 1>/dev/null`

❌ **Don't**: Use console.log/console.error in application code
❌ **Don't**: Write any non-JSON-RPC content to stdout
❌ **Don't**: Enable verbose logging from MCP SDK or external tools
