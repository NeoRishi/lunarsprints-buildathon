import OpenAI from "openai";
import { tool, RunContext } from "@openai/agents";
import { z } from "zod";
import registry from "../../../../config/agent-registry.json";
import type { Role } from "../contracts";
import { AppError, assert } from "../domain";
import { redactSensitive } from "@/lib/http";
import { NeedsClarification } from "./outcomes";
import { applyUsage } from "./usage";
import { instructionsAllowed } from "./registry-check";
import {
  AI_FAILURE_MESSAGE,
  acceptAgentOutput,
  agentErrorCode,
  agentContract,
  agentTimeoutMs,
  openAIModelFor,
  sessionContractText,
} from "./contract";

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
    /** Which engine produced this run. Absent on older saved-agent records. */
    engine?: "saved_agents" | "langgraph";
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
export interface Intelligence {
  invoke<T extends z.ZodType>(
    role: Role,
    schema: T,
    data: unknown,
    instructions?: string,
  ): Promise<z.infer<T>>;
}
/** Remote saved resources are invoked by ID. No SDK Agent instance is fabricated. */
export class ManagedIntelligence implements Intelligence {
  private instance: OpenAI | undefined;
  constructor(private context: AgentContext) {}
  private get client() {
    assert(
      process.env.OPENAI_API_KEY,
      "OpenAI is not configured.",
      "provider_unavailable",
      503,
    );
    return (this.instance ??= new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      project: process.env.OPENAI_PROJECT_ID || "proj_vI5AtNhbZISblXntDQZHNhZ1",
      maxRetries: 0,
      timeout: 180000,
    }));
  }
  async invoke<T extends z.ZodType>(
    role: Role,
    schema: T,
    data: unknown,
    instructions = "",
  ): Promise<z.infer<T>> {
    const entry = registry[role];
    assert(
      role !== "rhythm",
      `The ${entry?.name ?? role} specialist is disabled in this phase.`,
      "agent_disabled",
      403,
    );
    const executionModel = this.context.sessionModel ?? openAIModelFor(role);
    const contract = agentContract(
      role,
      schema,
      data,
      this.context.contract !== "full",
    );
    const started = Date.now();
    const metrics: RunRecord["metrics"] = {
      model: executionModel,
      contractVersion: contract.contractVersion,
      inputCharacters: JSON.stringify(data).length,
      schemaCharacters: 0,
      outputCharacters: 0,
      firstOutputMs: null,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      outcome: "provider_error",
      usageSource: "unavailable",
      engine: "saved_agents",
    };
    const timeoutMs = agentTimeoutMs(role, data);
    const signal = AbortSignal.timeout(timeoutMs);
    let sessionId: string | null = null;
    let turnId: string | null = null;
    let terminal = false;
    // The Agents SDK supplies a bounded, validated function-tool boundary. The
    // coordinator invokes it directly, with trusted context, rather than asking a
    // second model to route a transition already known to application code.
    const remote = tool({
      name: `invoke_${role}`,
      description: `Read-only ${entry.name} proposal; no writes or approvals.`,
      parameters: z.object({ inputJson: z.string().max(100000) }),
      execute: async ({ inputJson }) => {
        const saved = await this.client.beta.agents.retrieve(entry.id, {
          signal,
          timeout: timeoutMs,
        });
        assert(
          saved.id === entry.id && saved.model === entry.model,
          "Saved agent configuration changed; reconciliation is required.",
          "agent_configuration_changed",
          503,
        );
        assert(
          instructionsAllowed(entry, saved.instructions),
          "Saved agent instructions changed; review the registry before continuing.",
          "agent_configuration_changed",
          503,
        );
        assert(
          !saved.tools?.length && !saved.multi_agent?.enabled,
          "This integration permits no remote tools or autonomous delegation.",
          "agent_configuration_changed",
          503,
        );
        const jsonSchema = contract.jsonSchema;
        metrics.schemaCharacters = JSON.stringify(jsonSchema).length;
        const stream = await this.client.beta.agents.sessions.create(
          {
            agent_id: entry.id,
            environment: { type: "none" },
            stream: true,
            agent: {
              model: executionModel,
              instructions:
                (saved.instructions ?? "") +
                sessionContractText(contract.compact) +
                instructions,
              text: {
                format: { type: "json_schema", schema: jsonSchema },
                verbosity: "low",
              },
              tools: [],
              multi_agent: { enabled: false },
              reasoning: { effort: "low" },
            },
            input: inputJson,
            metadata: {
              application: "lunarsprints",
              role,
              sprint_id: this.context.sprintId,
            },
          },
          {
            signal,
            timeout: timeoutMs,
          },
        );
        stream.withResultCollection();
        let turnEnded = false;
        for await (const event of stream) {
          if (
            event.type === "agent.session.turn.output_text.delta" &&
            metrics.firstOutputMs === null
          )
            metrics.firstOutputMs = Date.now() - started;
          if (event.type === "agent.session.created")
            sessionId = event.session.id;
          if (event.type === "agent.session.turn.created")
            turnId = event.turn.id;
          if (
            event.type === "agent.session.turn.completed" ||
            event.type === "agent.session.turn.failed" ||
            event.type === "agent.session.turn.cancelled"
          ) {
            turnEnded = true;
            applyUsage(metrics, event.usage, "stream");
          }
          // Session SSE may stay open for future turns. Finish this bounded call
          // once its root turn is terminal and the session reports idle.
          if (event.type === "agent.session.idle" && turnEnded) break;
        }
        const result = await stream.finalResult();
        applyUsage(metrics, result.turn.usage, "turn_result");
        terminal = true;
        sessionId = result.session_id;
        turnId = result.turn_id;
        assert(
          result.turn.status === "completed",
          "The AI turn did not complete. Your last saved plan is unchanged.",
          "provider_unavailable",
          502,
        );
        metrics.outputCharacters = result.output_text.length;
        return acceptAgentOutput(
          role,
          schema,
          contract,
          JSON.parse(result.output_text),
        );
      },
      errorFunction: (_context, error) => {
        throw error;
      },
    });
    try {
      const output = await remote.invoke(
        new RunContext(this.context),
        JSON.stringify({ inputJson: JSON.stringify(data) }),
      );
      const parsed = schema.parse(
        typeof output === "string" ? JSON.parse(output) : output,
      );
      metrics.outcome = "ok";
      this.context.onRun?.({
        role,
        resourceId: entry.id,
        sessionId,
        turnId,
        status: "ok",
        durationMs: Date.now() - started,
        errorCode: null,
        metrics,
      });
      return parsed;
    } catch (error) {
      if (sessionId && !terminal) {
        try {
          await this.client.beta.agents.sessions.events.create(
            sessionId,
            { events: [{ type: "agent.session.input.cancel" }] },
            { timeout: 5000, maxRetries: 0 },
          );
        } catch {
          /* The run metadata retains the ID for reconciliation; cancellation is best effort. */
        }
      }
      if (process.env.LUNARSPRINTS_DIAGNOSTICS === "1")
        console.error("Provider diagnostics", {
          name: error instanceof Error ? error.name : "unknown",
          message:
            error instanceof Error
              ? redactSensitive(error.message.slice(0, 600))
              : "unknown",
          status: error instanceof OpenAI.APIError ? error.status : null,
          code: error instanceof OpenAI.APIError ? error.code : null,
        });
      const code = agentErrorCode(error);
      metrics.outcome = code;
      this.context.onRun?.({
        role,
        resourceId: entry.id,
        sessionId,
        turnId,
        status: "error",
        durationMs: Date.now() - started,
        errorCode: code,
        metrics,
      });
      if (error instanceof AppError || error instanceof NeedsClarification)
        throw error;
      throw new AppError(code, AI_FAILURE_MESSAGE, 502);
    }
  }
}
