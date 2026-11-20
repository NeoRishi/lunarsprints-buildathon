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

/**
 * One AI call, recorded after the response for cost and quality review.
 * Never holds prompts, user text or answers: only who, which model, how long,
 * how many tokens and how it ended. Unknown token counts stay null, never 0.
 */
export type RunRecord = {
  role: Role;
  /** The agent that answered, for example "adk:smart_goal.goals". */
  resourceId: string;
  /** The random request ID shared with the agent service logs. */
  sessionId: string | null;
  turnId: string | null;
  status: "ok" | "error";
  durationMs: number;
  errorCode: string | null;
  metrics: {
    engine: "adk_gemini";
    task: string;
    model: string | null;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    outcome: string;
  };
};

/** Context the route gives an AI engine. The user ID never leaves the app. */
export type AgentContext = {
  userId: string;
  sprintId: string;
  onRun?: (record: RunRecord) => void;
};

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
