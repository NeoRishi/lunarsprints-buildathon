import OpenAI from "openai";
import type { TokenUsage } from "openai/resources/beta/agents/agents";
import type { RunRecord } from "./managed";
export function applyUsage(
  metrics: RunRecord["metrics"],
  usage: TokenUsage | null,
  source: RunRecord["metrics"]["usageSource"],
) {
  if (!usage) return;
  Object.assign(metrics, {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? null,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? null,
    totalTokens: usage.total_tokens,
    usageSource: source,
  });
}
/** One bounded metadata read per missing usage record, after the HTTP response. No model invocation or retry. */
export async function reconcileUsage(runs: RunRecord[]) {
  const missing = runs.filter(
    (r) => r.sessionId && r.turnId && r.metrics.totalTokens === null,
  );
  if (!missing.length || !process.env.OPENAI_API_KEY) return;
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    project: process.env.OPENAI_PROJECT_ID || "proj_vI5AtNhbZISblXntDQZHNhZ1",
    maxRetries: 0,
    timeout: 5000,
  });
  await Promise.allSettled(
    missing.map(async (r) => {
      const turn = await client.beta.agents.sessions.turns.retrieve(r.turnId!, {
        session_id: r.sessionId!,
      });
      applyUsage(r.metrics, turn.usage, "turn_lookup");
    }),
  );
}
