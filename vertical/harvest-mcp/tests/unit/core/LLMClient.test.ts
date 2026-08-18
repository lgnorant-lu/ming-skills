import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LLMClient } from "../../../src/core/LLMClient.js";

describe("LLMClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe("constructor", () => {
    it("should create instance without throwing", () => {
      // LLMClient no longer throws in constructor
      const client = new LLMClient();
      expect(client).toBeInstanceOf(LLMClient);
    });

    it("should create instance with custom model", () => {
      const client = new LLMClient("gpt-4");
      expect(client.getModel()).toBe("gpt-4");
    });

    it("should use LLM_MODEL env var if no model specified", () => {
      process.env.LLM_MODEL = "gemini-1.5-pro";

      const client = new LLMClient();
      expect(client.getModel()).toBe("gemini-1.5-pro");
    });
  });

  describe("provider initialization", () => {
    it("should throw error when no API keys are configured", async () => {
      process.env.OPENAI_API_KEY = undefined;
      process.env.GOOGLE_API_KEY = undefined;
      process.env.LLM_PROVIDER = undefined;

      const client = new LLMClient();

      await expect(client.generateResponse("test")).rejects.toThrow(
        "No LLM provider configured"
      );
    });

    it("should use OpenAI provider when OPENAI_API_KEY is set", async () => {
      process.env.OPENAI_API_KEY = "test-openai-key";
      process.env.GOOGLE_API_KEY = undefined;
      process.env.LLM_PROVIDER = undefined;

      const client = new LLMClient();
      const providerName = await client.getProviderName();

      expect(providerName).toBe("openai");
    });

    it("should use Gemini provider when only GOOGLE_API_KEY is set", async () => {
      process.env.OPENAI_API_KEY = undefined;
      process.env.GOOGLE_API_KEY = "test-google-key";
      process.env.LLM_PROVIDER = undefined;

      const client = new LLMClient();
      const providerName = await client.getProviderName();

      expect(providerName).toBe("gemini");
    });

    it("should respect LLM_PROVIDER env var", async () => {
      process.env.OPENAI_API_KEY = "test-openai-key";
      process.env.GOOGLE_API_KEY = "test-google-key";
      process.env.LLM_PROVIDER = "gemini";

      const client = new LLMClient();
      const providerName = await client.getProviderName();

      expect(providerName).toBe("gemini");
    });
  });

  describe("setModel", () => {
    it("should update the model", () => {
      const client = new LLMClient();
      client.setModel("gpt-3.5-turbo");
      expect(client.getModel()).toBe("gpt-3.5-turbo");
    });
  });

  describe("setProvider", () => {
    it("should switch to a different provider", async () => {
      process.env.OPENAI_API_KEY = "test-openai-key";
      process.env.GOOGLE_API_KEY = "test-google-key";

      const client = new LLMClient();

      // Start with default provider
      let providerName = await client.getProviderName();
      expect(providerName).toBe("openai");

      // Switch to Gemini
      await client.setProvider("gemini");
      providerName = await client.getProviderName();
      expect(providerName).toBe("gemini");
    });
  });

  // Note: LLM function call tests require provider mocking
  // These will be tested in integration tests with proper mocking setup
});
