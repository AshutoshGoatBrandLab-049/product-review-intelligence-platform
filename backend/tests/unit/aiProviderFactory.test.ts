import { describe, it, expect } from "vitest";
import { createAiProvider } from "../../src/modules/ai/providers/providerFactory.js";
import { MockAiProvider } from "../../src/modules/ai/providers/mockAiProvider.js";

describe("createAiProvider (Phase 4 §2)", () => {
  it("returns the mock provider by default (config.ai.provider = 'mock' in tests)", () => {
    const provider = createAiProvider();
    expect(provider).toBeInstanceOf(MockAiProvider);
    expect(provider.name).toBe("mock");
  });
});
