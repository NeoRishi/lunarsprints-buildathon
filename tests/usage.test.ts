import { it, expect } from "vitest";
import { applyUsage } from "../src/features/lunarsprints/agents/usage";
import type { RunRecord } from "../src/features/lunarsprints/agents/managed";
const metrics = (): RunRecord["metrics"] => ({
  model: "gpt-6.1-sol",
  contractVersion: "2.1",
  inputCharacters: 100,
  schemaCharacters: 200,
  outputCharacters: 300,
  firstOutputMs: 50,
  inputTokens: null,
  cachedInputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  totalTokens: null,
  outcome: "ok",
  usageSource: "unavailable",
});
it("retains unknown usage as null rather than claiming zero cost", () => {
  const m = metrics();
  applyUsage(m, null, "stream");
  expect(m.totalTokens).toBeNull();
  expect(m.usageSource).toBe("unavailable");
});
it("records provider token counts and provenance without copying prompts or extra fields", () => {
  const m = metrics();
  applyUsage(
    m,
    {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 40 },
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 150,
    },
    "turn_lookup",
  );
  expect(m).toMatchObject({
    inputTokens: 100,
    cachedInputTokens: 40,
    outputTokens: 50,
    reasoningTokens: 10,
    totalTokens: 150,
    usageSource: "turn_lookup",
    firstOutputMs: 50,
  });
  expect(Object.keys(m)).not.toContain("input");
});
