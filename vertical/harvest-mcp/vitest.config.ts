import { resolve } from "node:path";
/// <reference types="vitest" />
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  // Unit tests - fast, isolated, mocked dependencies
  {
    test: {
      name: "unit",
      include: ["tests/unit/**/*.test.ts"],
      setupFiles: ["tests/setup/vitest.setup.ts"],
      environment: "node",
      globals: true,
      // Unit tests should be fast
      testTimeout: 5000,
      // Encourage mocking for isolation
      mockReset: true,
      clearMocks: true,
      restoreMocks: true,
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
        "@tests": resolve(__dirname, "./tests"),
      },
    },
  },

  // Integration tests - test component interaction, limited mocking
  {
    test: {
      name: "integration",
      include: ["tests/integration/**/*.test.ts"],
      setupFiles: ["tests/setup/vitest.setup.ts"],
      environment: "node",
      globals: true,
      // Integration tests may take longer
      testTimeout: 15000,
      // Less aggressive mocking - test real interactions
      mockReset: false,
      clearMocks: true,
      restoreMocks: false,
      // Run browser tests sequentially to avoid resource contention
      pool: "forks",
      poolOptions: {
        forks: {
          singleFork: true,
        },
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
        "@tests": resolve(__dirname, "./tests"),
      },
    },
  },

  // E2E tests - full system tests, minimal mocking
  {
    test: {
      name: "e2e",
      include: ["tests/e2e/**/*.test.ts"],
      setupFiles: ["tests/setup/vitest.setup.ts"],
      environment: "node",
      globals: true,
      // E2E tests can be slow
      testTimeout: 30000,
      // No automatic mocking - test real system behavior
      mockReset: false,
      clearMocks: false,
      restoreMocks: false,
      // Run e2e tests sequentially to avoid browser resource contention
      pool: "forks",
      poolOptions: {
        forks: {
          singleFork: true,
        },
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
        "@tests": resolve(__dirname, "./tests"),
      },
    },
  },
]);
