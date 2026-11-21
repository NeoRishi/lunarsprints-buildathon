import type { z } from "zod";
import type { Role } from "../contracts";
import type { ServiceErrorCode } from "./contract";
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

/** Plain messages for each way an AI call can fail. The saved plan never changes. */
export const AI_MESSAGES = {
  ai_timeout: {
    status: 504,
    message:
      "AI suggestions took too long this time. Your saved plan is safe. Try again.",
  },
  ai_unavailable: {
    status: 503,
    message:
      "AI suggestions didn't come through this time. Your saved plan is safe. Try again.",
  },
  invalid_ai_output: {
    status: 502,
    message:
      "The AI suggestion didn't pass our checks, so nothing was changed. Your saved plan is safe. Try again.",
  },
  unauthorized: {
    status: 503,
    message:
      "AI suggestions aren't available right now. Your saved plan is safe. Try again later.",
  },
  invalid_request: {
    status: 503,
    message:
      "AI suggestions didn't come through this time. Your saved plan is safe. Try again.",
  },
} as const satisfies Record<
  ServiceErrorCode,
  { status: number; message: string }
>;

export function aiError(code: ServiceErrorCode) {
  return new AppError(
    code,
    AI_MESSAGES[code].message,
    AI_MESSAGES[code].status,
  );
}

/**
 * Runs one of the app's own checks on an AI proposal. A proposal that fails
 * is rejected with the plain message; nothing is saved. Edits the person
 * types keep the specific message from the check instead.
 */
export function checkAiProposal(check: () => void) {
  try {
    check();
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === "invalid_input" || error.code === "invalid_model_output")
    )
      throw aiError("invalid_ai_output");
    throw error;
  }
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
