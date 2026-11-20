import type { z } from "zod";
import type { Role } from "../contracts";
import { AppError } from "../domain";

/**
 * Every AI call in LunarSprints goes through this interface. The coordinator
 * and the tests depend only on it, never on a model vendor.
 */
export interface Intelligence {
  invoke<T extends z.ZodType>(
    role: Role,
    schema: T,
    data: unknown,
    instructions?: string,
  ): Promise<z.infer<T>>;
}

/** One AI call, recorded after the response for cost and quality review. */
export type RunRecord = {
  role: Role;
  resourceId: string;
  sessionId: string | null;
  turnId: string | null;
  status: "ok" | "error";
  durationMs: number;
  errorCode: string | null;
  metrics: {
    model: string;
    contractVersion: string;
    inputCharacters: number;
    schemaCharacters: number;
    outputCharacters: number;
    firstOutputMs: number | null;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
    totalTokens: number | null;
    outcome: string;
    usageSource:
      | "stream"
      | "turn_result"
      | "turn_lookup"
      | "provider_response"
      | "unavailable";
    /** Which engine produced this run. Older records may name a retired engine. */
    engine?: string;
    /** True when the run was a side-by-side comparison, not shown to the user. */
    shadow?: boolean;
    provider?: string;
  };
};

export type AgentContext = {
  userId: string;
  sprintId: string;
  sessionModel?: string;
  contract?: "full" | "compact";
  onRun?: (record: RunRecord) => void;
};

/** Token counts as any provider reports them. Unknown counts stay null. */
export type TokenCounts = {
  inputTokens: number;
  cachedInputTokens?: number | null;
  outputTokens: number;
  reasoningTokens?: number | null;
  totalTokens: number;
};

/**
 * Copies reported token counts onto a run record. A missing report leaves
 * every count null, so unknown cost is never recorded as zero cost.
 */
export function applyUsage(
  metrics: RunRecord["metrics"],
  usage: TokenCounts | null,
  source: RunRecord["metrics"]["usageSource"],
) {
  if (!usage) return;
  Object.assign(metrics, {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens ?? null,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens ?? null,
    totalTokens: usage.totalTokens,
    usageSource: source,
  });
}

/** Shown to the user while no AI engine is connected. */
export const AI_NOT_CONNECTED_MESSAGE =
  "AI suggestions are being upgraded. Your saved plan is safe.";

/**
 * Temporary engine used until the new agent service is connected. Every call
 * fails with a plain, honest message. Because the coordinator saves nothing
 * when a call throws, the user's last saved plan is never changed.
 */
export class UnavailableIntelligence implements Intelligence {
  async invoke<T extends z.ZodType>(): Promise<z.infer<T>> {
    throw new AppError("ai_not_connected", AI_NOT_CONNECTED_MESSAGE, 503);
  }
}
