import { it, expect } from "vitest";
import {
  applyUsage,
  type RunRecord,
} from "../src/features/lunarsprints/agents/intelligence";
const metrics = (): RunRecord["metrics"] => ({
  model: "test-model",
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
it("records reported token counts and provenance without copying prompts or extra fields", () => {
  const m = metrics();
  applyUsage(
    m,
    {
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 50,
      reasoningTokens: 10,
      totalTokens: 150,
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
it("keeps optional counts null when a provider does not report them", () => {
  const m = metrics();
  applyUsage(
    m,
    { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    "provider_response",
  );
  expect(m.cachedInputTokens).toBeNull();
  expect(m.reasoningTokens).toBeNull();
  expect(m.totalTokens).toBe(15);
});
