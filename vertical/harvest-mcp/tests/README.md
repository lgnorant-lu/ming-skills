# Testing Guide

This guide explains the testing setup, patterns, and best practices for the Harvest MCP project.

## Test Structure

### Directory Organization

```
tests/
├── unit/           # Unit tests - fast, isolated, heavily mocked
├── integration/    # Integration tests - component interaction, limited mocking  
├── e2e/           # End-to-end tests - full system, minimal mocking
├── fixtures/      # Test data (HAR files, cookies, etc.)
├── mocks/         # Mock implementations
├── setup/         # Test configuration and utilities
└── manual/        # Manual tests (excluded from CI)
```

### Test Types & When to Use

#### Unit Tests (`tests/unit/`)
- **Purpose**: Test individual components in isolation
- **Characteristics**: Fast, deterministic, heavily mocked
- **When to use**: Testing business logic, utility functions, single class behavior
- **Mocking**: Mock all external dependencies (file system, network, other components)

```typescript
// Example: Unit test for a utility function
describe('HARParser', () => {
  it('should parse valid HAR data', () => {
    const mockHarContent = createMockHarContent();
    const result = HARParser.parse(mockHarContent);
    expect(result.requests).toHaveLength(3);
  });
});
```

#### Integration Tests (`tests/integration/`)
- **Purpose**: Test how components work together
- **Characteristics**: Moderate speed, test real interactions between components
- **When to use**: Testing workflows, API endpoints, database interactions
- **Mocking**: Mock external services only (OpenAI API, file system sometimes)

```typescript
// Example: Integration test for session workflow
describe('Session Workflow', () => {
  it('should create session and process analysis', async () => {
    const sessionManager = new SessionManager();
    const sessionId = await sessionManager.createSession(testData);
    
    // Test real component interaction
    const session = sessionManager.getSession(sessionId);
    expect(session.dagManager.getNodes()).toHaveLength(0);
  });
});
```

#### E2E Tests (`tests/e2e/`)
- **Purpose**: Test complete user workflows
- **Characteristics**: Slow, test real system behavior
- **When to use**: Testing complete MCP server workflows, CLI interactions
- **Mocking**: Minimal - only mock external APIs if necessary

```typescript
// Example: E2E test for complete analysis workflow
describe('Complete Analysis Workflow', () => {
  it('should analyze HAR file and generate code', async () => {
    // Test the full system end-to-end
    const result = await runCompleteAnalysis(harFilePath, prompt);
    expect(result.generatedCode).toContain('curl');
  });
});
```

## Testing Patterns & Best Practices

### 1. Clear Separation of Concerns

**❌ Bad - Mixing unit and integration concerns:**
```typescript
describe('SessionManager', () => {
  it('should create session', async () => {
    // This test mixes unit and integration concerns
    const mockLLM = createMockLLMClient();
    const sessionManager = new SessionManager(mockLLM);
    
    // But then tests file system interaction (integration concern)
    const sessionId = await sessionManager.createSession({
      harPath: './real-file.har'  // Uses real file system
    });
  });
});
```

**✅ Good - Clear separation:**
```typescript
// Unit test - mock everything
describe('SessionManager - Unit', () => {
  it('should create session with valid parameters', async () => {
    const mockFileSystem = createMockFileSystem();
    const mockLLM = createMockLLMClient();
    
    const sessionManager = new SessionManager(mockLLM, mockFileSystem);
    const sessionId = await sessionManager.createSession(validParams);
    
    expect(sessionId).toBeValidUUID();
  });
});

// Integration test - test real interactions
describe('SessionManager - Integration', () => {
  it('should create session and parse real HAR file', async () => {
    const sessionManager = new SessionManager();
    const sessionId = await sessionManager.createSession({
      harPath: './tests/fixtures/valid.har'
    });
    
    const session = sessionManager.getSession(sessionId);
    expect(session.harData.requests).toHaveLength(5);
  });
});
```

### 2. Appropriate Mock Usage

**❌ Bad - Over-mocking in integration tests:**
```typescript
// Integration test that mocks everything defeats the purpose
describe('Analysis Integration', () => {
  it('should run complete analysis', async () => {
    const mockSession = createMockSession();
    const mockDAG = createMockDAG();
    const mockLLM = createMockLLMClient();
    
    // This isn't testing integration anymore!
    const result = await runAnalysis(mockSession, mockDAG, mockLLM);
  });
});
```

**✅ Good - Strategic mocking:**
```typescript
// Integration test - only mock external services
describe('Analysis Integration', () => {
  it('should run complete analysis', async () => {
    // Mock only external API calls
    const mockLLM = createMockLLMClient();
    
    // Use real components to test their interaction
    const sessionManager = new SessionManager();
    const sessionId = await sessionManager.createSession(testData);
    
    const result = await runAnalysis(sessionId, mockLLM);
    expect(result.dagManager.getNodes()).toHaveLength(3);
  });
});
```

### 3. Test Data Management

**Use fixtures for consistent test data:**
```typescript
// tests/fixtures/test-data.ts
export const VALID_HAR_CONTENT = {
  log: {
    version: '1.2',
    entries: [
      // ... valid HAR entries
    ]
  }
};

// In tests
import { VALID_HAR_CONTENT } from '@tests/fixtures/test-data.js';
```

## Available Testing Utilities

### Test Helpers (`tests/setup/test-helpers.ts`)

```typescript
import { 
  createMockSession, 
  createMockURLInfo,
  waitForCondition,
  expectToThrow
} from '@tests/setup/test-helpers.js';

// Create mock data with overrides
const session = createMockSession({ 
  prompt: 'custom prompt' 
});

// Wait for async conditions
await waitForCondition(() => analysis.isComplete());

// Test error scenarios
await expectToThrow(
  () => sessionManager.getSession('invalid-id'),
  'Session not found'
);
```

### Mock Utilities

```typescript
// For unit tests - mock LLM client
import { createMockLLMClient } from '@tests/mocks/llm-client.mock.js';

const mockLLM = createMockLLMClient({
  identify_end_url: { url: 'https://custom.com/api' }
});

// For unit tests - mock file system
import { createMockFileSystem } from '@tests/mocks/file-system.mock.js';

const mockFS = createMockFileSystem();
mockFS.setFileContent('/path/to/file.har', validHarContent);
```

### Custom Matchers
```typescript
// Available custom matchers
expect(sessionId).toBeValidUUID();
```

## Running Tests

```bash
# Run all tests
bun test

# Run by type
bun run test:unit         # Fast unit tests only
bun run test:integration  # Integration tests only  
bun run test:e2e         # End-to-end tests only

# Development workflow
bun run test:watch       # Watch mode for active development
bun run test:coverage    # Generate coverage reports
```

## Test Configuration

### Workspace Configuration
Tests are configured using Vitest workspace (`vitest.workspace.ts`) with different settings for each test type:

- **Unit tests**: Fast timeouts, aggressive mocking, isolated
- **Integration tests**: Moderate timeouts, limited mocking
- **E2E tests**: Long timeouts, minimal mocking

### Environment Setup
Each test type has appropriate environment setup in `tests/setup/vitest.setup.ts`:
- Global utilities and matchers
- Environment variable setup
- Mock cleanup between tests

## Common Anti-Patterns to Avoid

### ❌ Testing Implementation Details
```typescript
// Bad - testing internal implementation
it('should call handleRequest method', () => {
  const spy = vi.spyOn(manager, 'handleRequest');
  manager.processSession(sessionId);
  expect(spy).toHaveBeenCalled();
});
```

### ❌ Over-Mocking in Integration Tests
```typescript
// Bad - mocking everything in integration test
describe('Session Integration', () => {
  it('should work', () => {
    const mockEverything = createAllMocks();
    // This is not testing integration anymore
  });
});
```

### ❌ Brittle Test Data
```typescript
// Bad - hardcoded test data
const testData = {
  harPath: '/Users/john/projects/test.har',  // Brittle path
  prompt: 'test'
};
```

### ❌ Testing Multiple Concerns
```typescript
// Bad - testing too many things at once
it('should create session, parse HAR, run analysis, and generate code', () => {
  // This test is doing too much
});
```

## Best Practices Summary

1. **Separate concerns clearly** - unit/integration/e2e have different purposes
2. **Mock appropriately** - unit tests mock everything, integration tests mock selectively
3. **Use test helpers** - leverage provided utilities for consistent test data
4. **Test behavior, not implementation** - focus on what the code does, not how
5. **Keep tests focused** - one test should verify one behavior
6. **Use descriptive test names** - test names should explain the expected behavior
7. **Clean up properly** - use setup/teardown hooks to maintain test isolation

Following these patterns will ensure your tests are maintainable, reliable, and provide good coverage of the system's behavior.
