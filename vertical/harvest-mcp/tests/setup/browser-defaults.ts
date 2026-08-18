/**
 * Default browser configuration for tests
 * Optimized for performance and resource usage
 */

export const TEST_BROWSER_DEFAULTS = {
  headless: true,
  viewport: {
    width: 800,
    height: 600,
  },
  // Disable GPU and sandbox for faster startup in CI/test environments
  args: [
    "--disable-gpu",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage", // Overcome limited resource problems
    "--disable-web-security", // For testing cross-origin scenarios
    "--disable-features=IsolateOrigins",
    "--disable-site-isolation-trials",
  ],
  // Reduce timeout for faster failure detection
  timeout: 10000, // 10 seconds instead of default 30
};

export const SMALL_VIEWPORT = {
  width: 800,
  height: 600,
};
