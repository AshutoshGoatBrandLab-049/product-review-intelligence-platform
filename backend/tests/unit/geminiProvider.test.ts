import { describe, it, expect } from "vitest";
import { GeminiProvider } from "../../src/modules/ai/providers/geminiProvider.js";
import { AiProviderError } from "../../src/modules/ai/providers/aiProvider.js";

describe("GeminiProvider construction (Phase 4.1)", () => {
  it("refuses to construct without an API key — never silently proceeds unauthenticated", () => {
    expect(() => new GeminiProvider("", "gemini-flash-latest")).toThrow(AiProviderError);
  });

  it("exposes a modelVersion that names the provider and model, once a key is present", () => {
    const provider = new GeminiProvider("fake-key-for-construction-only", "gemini-flash-latest");
    expect(provider.name).toBe("gemini");
    expect(provider.modelVersion).toBe("gemini:gemini-flash-latest:analysis-v1");
  });
});
