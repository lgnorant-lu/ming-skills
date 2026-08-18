# Contributing to Harvest MCP Server

Thank you for your interest in contributing to the Harvest MCP Server! This guide will help you get started with contributing to this TypeScript-based Model Context Protocol server.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Code Quality Standards](#code-quality-standards)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Sprint Planning](#sprint-planning)
- [Debugging and Development](#debugging-and-development)

## Development Setup

### Prerequisites

- **Bun** (latest version) - JavaScript runtime and package manager
- **Node.js** 18+ - Runtime environment
- **TypeScript** knowledge - Primary development language
- **Git** - Version control

### Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd harvest-mcp
   ```

2. **Install dependencies**:
   ```bash
   bun install
   ```

3. **Verify setup**:
   ```bash
   bun test
   bun run lint
   ```

### Development Environment

```bash
# Development server with hot reload
bun run dev

# Run tests in watch mode
bun run test:watch

# Check code quality
bun run check
```

## Project Structure

```
src/
├── core/                    # Core business logic
│   ├── SessionManager.ts    # Session management
│   ├── DAGManager.ts        # Graph operations
│   ├── HARParser.ts         # HAR file processing
│   └── CookieParser.ts      # Cookie handling
├── models/                  # Data models
│   └── Request.ts           # HTTP request modeling
├── types/                   # TypeScript types and schemas
│   └── index.ts             # Centralized type definitions
├── tools/                   # MCP tool implementations
├── agents/                  # Analysis agents (future)
├── utils/                   # Utility functions
└── server.ts                # Main MCP server

tests/
├── core/                    # Unit tests
├── models/                  # Model tests
├── integration/             # Integration tests
└── fixtures/                # Test data
```

## Code Quality Standards

### Code Style

We use **Biome** for linting, formatting, and code quality enforcement:

```bash
# Check code quality
bun run check

# Find unused code and dependencies  
bun run knip

# Auto-fix unused dependencies (where possible)
bun run knip:fix
```

### TypeScript Guidelines

1. **Strict Type Safety**:
   - Avoid `any` types - use `unknown` instead
   - Prefer explicit types over inference when clarity is needed
   - Use Zod schemas for runtime validation

2. **Import Conventions**:
   - Use Node.js import protocol: `node:fs/promises`
   - Explicit `.js` extensions for relative imports
   - Type-only imports when appropriate

3. **Error Handling**:
   - Use custom error classes extending `HarvestError`
   - Provide meaningful error messages
   - Include error codes for programmatic handling

### Code Organization

- **Single Responsibility**: Each class/function has one clear purpose
- **Composition over Inheritance**: Prefer composition patterns
- **Immutability**: Avoid mutable state where possible
- **Pure Functions**: Minimize side effects

## Testing Guidelines

### Test Structure

1. **Unit Tests**: Test individual components in isolation
2. **Integration Tests**: Test component interactions
3. **End-to-End Tests**: Test complete workflows

### Testing Standards

- **Coverage Target**: Aim for >90% test coverage
- **Test Naming**: Descriptive test names explaining the scenario
- **AAA Pattern**: Arrange, Act, Assert
- **Test Isolation**: Each test should be independent

### Running Tests

```bash
# Run all tests
bun test

# Run tests with coverage
bun test --coverage

# Run specific test file
bun test tests/core/SessionManager.test.ts

# Watch mode for development
bun run test:watch
```

### Writing Tests

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('ComponentName', () => {
  let component: ComponentType;

  beforeEach(() => {
    component = new ComponentType();
  });

  afterEach(() => {
    // Cleanup
  });

  describe('methodName', () => {
    it('should handle valid input correctly', () => {
      // Arrange
      const input = 'test';
      
      // Act
      const result = component.methodName(input);
      
      // Assert
      expect(result).toBe('expected');
    });

    it('should throw error for invalid input', () => {
      expect(() => component.methodName(null)).toThrow();
    });
  });
});
```

## Pull Request Process

### Before Submitting

1. **Code Quality Checks**:
   ```bash
   bun run ci  # Runs check + knip + test
   ```

2. **Update Documentation**: Ensure README and code comments are current

3. **Test Coverage**: Add tests for new functionality

### PR Guidelines

1. **Title Format**: `[Sprint X] Brief description of changes`
2. **Description Template**:
   ```markdown
   ## Summary
   Brief description of changes
   
   ## Changes Made
   - List of specific changes
   - Include any breaking changes
   
   ## Testing
   - [ ] Unit tests added/updated
   - [ ] Integration tests pass
   - [ ] Manual testing completed
   
   ## Sprint Context
   - Sprint: X
   - Related to: Task/Feature description
   ```

3. **Review Checklist**:
   - [ ] Code follows project conventions
   - [ ] Tests added for new functionality
   - [ ] Documentation updated
   - [ ] CI checks pass
   - [ ] No breaking changes (or properly documented)

## Sprint Planning

### Current Sprint Status

**Sprint 1** ✅ (Completed):
- Project setup and core infrastructure
- Session management
- DAG operations
- HAR parsing
- Basic MCP server with session tools

**Sprint 2** (Next):
- LLM integration with OpenAI
- Analysis agents implementation
- URL identification and dynamic parts detection

### Contributing to Sprints

1. **Check Project Board**: Review current sprint tasks
2. **Pick Up Tasks**: Choose tasks appropriate to your skill level
3. **Create Feature Branch**: `git checkout -b sprint-2/feature-name`
4. **Follow TDD**: Write tests first, then implementation
5. **Regular Updates**: Push progress regularly for feedback

## Debugging and Development

### MCP Server Testing

```bash
# Start server for manual testing
bun run start

# Test with MCP Inspector (if available)
mcp-inspector --transport stdio --command "bun run start"
```

### Common Development Tasks

1. **Adding New MCP Tools**:
   ```typescript
   // In src/server.ts
   this.server.tool(
     'tool.name',
     'Description of tool functionality',
     InputSchema,
     async (params): Promise<CallToolResult> => {
       // Implementation
     }
   );
   ```

2. **Adding New Types**:
   ```typescript
   // In src/types/index.ts
   export interface NewType {
     property: string;
   }
   
   export const NewTypeSchema = z.object({
     property: z.string()
   });
   ```

3. **Session State Management**:
   ```typescript
   // Always use SessionManager for state
   const session = this.sessionManager.getSession(sessionId);
   this.sessionManager.addLog(sessionId, 'info', 'Action performed');
   ```

### Debugging Tips

1. **Logging**: Use `console.error()` for server-side logging (goes to stderr)
2. **Session Inspection**: Use MCP resources to inspect session state
3. **Error Handling**: Check error codes and messages for debugging context

## Architecture Guidelines

### Design Principles

1. **Stateful Sessions**: All operations work within session contexts
2. **Granular Control**: Break down monolithic operations into atomic tools
3. **Error Recovery**: Provide debugging tools for manual intervention
4. **Type Safety**: Leverage TypeScript for compile-time guarantees

### Adding New Features

1. **Start with Types**: Define interfaces and schemas first
2. **Write Tests**: Create test cases for expected behavior
3. **Implement Core Logic**: Focus on business logic first
4. **Add MCP Integration**: Expose functionality through MCP tools
5. **Document**: Update README and code comments

## Getting Help

- **Questions**: Open GitHub Discussions for questions
- **Bugs**: Create GitHub Issues with reproduction steps
- **Features**: Discuss in GitHub Issues before implementing
- **Code Review**: Tag maintainers for review feedback

## Recognition

Contributors will be recognized in:
- README.md contributor section
- Git commit history
- Release notes for significant contributions

Thank you for contributing to Harvest MCP Server!
