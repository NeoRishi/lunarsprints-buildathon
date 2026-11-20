import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Role } from "../contracts";
import { AppError } from "../domain";
import {
  acceptAgentOutput,
  agentContract,
  serviceErrorSchema,
  serviceRequestSchema,
  serviceTaskFor,
  serviceUsageSchema,
  type ServiceErrorCode,
  type ServiceRole,
} from "./contract";
import {
  AI_NOT_CONNECTED_MESSAGE,
  UnavailableIntelligence,
  type AgentContext,
  type Intelligence,
  type RunRecord,
} from "./intelligence";
import { NeedsClarification } from "./outcomes";

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

/** The service answers within 45 seconds; this leaves room for the network. */
const CLIENT_TIMEOUT_MS = 50_000;

const okResponse = z.object({
  result: z.unknown(),
  usage: serviceUsageSchema,
});

export type GeminiAgentsOptions = {
  url: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Calls the Python agent service (Google ADK on Gemini). Every answer is
 * checked with the same zod contract the coordinator uses before it is
 * returned, so nothing unchecked can be saved. One call, no retries.
 */
export class GeminiAgentsIntelligence implements Intelligence {
  private fetcher: typeof fetch;
  constructor(
    private context: AgentContext,
    private options: GeminiAgentsOptions,
  ) {
    this.fetcher = options.fetch ?? fetch;
  }

  async invoke<T extends z.ZodType>(
    role: Role,
    schema: T,
    data: unknown,
  ): Promise<z.infer<T>> {
    const match = serviceTaskFor(role, schema);
    if (!match)
      throw new AppError("ai_not_connected", AI_NOT_CONNECTED_MESSAGE, 503);
    const serviceRole = role as ServiceRole;
    const requestId = randomUUID();
    const started = Date.now();
    const record = (
      outcome: string,
      usage: z.infer<typeof serviceUsageSchema> | null,
    ) =>
      this.context.onRun?.({
        role,
        resourceId: `adk:${role}.${match.task}`,
        sessionId: requestId,
        turnId: null,
        status:
          outcome === "ok" || outcome === "needs_clarification"
            ? "ok"
            : "error",
        durationMs: Date.now() - started,
        errorCode:
          outcome === "ok" || outcome === "needs_clarification"
            ? null
            : outcome,
        metrics: {
          engine: "adk_gemini",
          task: match.task,
          model: usage?.model ?? null,
          latencyMs: usage?.latency_ms ?? null,
          inputTokens: usage?.input_tokens ?? null,
          outputTokens: usage?.output_tokens ?? null,
          outcome,
        },
      } satisfies RunRecord);

    // Only what this role needs is sent: unknown keys (and any identity) are dropped.
    const body = serviceRequestSchema(serviceRole, match.task).safeParse({
      requestId,
      task: match.task,
      input: data,
    });
    if (!body.success) {
      record("invalid_request", null);
      throw aiError("invalid_request");
    }

    let response: Response;
    try {
      response = await this.fetcher(
        `${this.options.url.replace(/\/$/, "")}/v1/roles/${role}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-service-token": this.options.token,
          },
          body: JSON.stringify(body.data),
          signal: AbortSignal.timeout(
            this.options.timeoutMs ?? CLIENT_TIMEOUT_MS,
          ),
          cache: "no-store",
        },
      );
    } catch (error) {
      const code =
        error instanceof Error && error.name === "TimeoutError"
          ? "ai_timeout"
          : "ai_unavailable";
      record(code, null);
      throw aiError(code);
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = serviceErrorSchema.safeParse(payload);
      const code = parsed.success ? parsed.data.error.code : "ai_unavailable";
      record(code, null);
      throw aiError(code);
    }
    const ok = okResponse.safeParse(payload);
    if (!ok.success) {
      record("invalid_ai_output", null);
      throw aiError("invalid_ai_output");
    }

    try {
      const contract = agentContract(role, schema, data, true);
      const accepted = acceptAgentOutput(
        role,
        schema,
        contract,
        ok.data.result,
      );
      record("ok", ok.data.usage);
      return accepted;
    } catch (error) {
      if (error instanceof NeedsClarification) {
        record("needs_clarification", ok.data.usage);
        throw error;
      }
      if (error instanceof AppError && error.code === "needs_clarification") {
        record("needs_clarification", ok.data.usage);
        throw error;
      }
      record("invalid_ai_output", ok.data.usage);
      throw aiError("invalid_ai_output");
    }
  }
}

export type EngineName = "gemini_agents" | "unavailable";
type Env = Record<string, string | undefined>;

/** Which engine the app uses: the agent service when its address is set. */
export function activeEngine(env: Env = process.env): EngineName {
  return env.AGENTS_SERVICE_URL ? "gemini_agents" : "unavailable";
}

export function selectIntelligence(
  context: AgentContext,
  env: Env = process.env,
): Intelligence {
  if (activeEngine(env) === "unavailable") return new UnavailableIntelligence();
  return new GeminiAgentsIntelligence(context, {
    url: env.AGENTS_SERVICE_URL!,
    token: env.AGENTS_SERVICE_TOKEN ?? "",
  });
}

/** True when the agent service answers its liveness check within 2 seconds. */
export async function agentServiceAnswers(
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): Promise<boolean | null> {
  if (!env.AGENTS_SERVICE_URL) return null;
  try {
    const r = await fetcher(
      `${env.AGENTS_SERVICE_URL.replace(/\/$/, "")}/healthz`,
      { signal: AbortSignal.timeout(2000), cache: "no-store" },
    );
    return r.ok;
  } catch {
    return false;
  }
}
