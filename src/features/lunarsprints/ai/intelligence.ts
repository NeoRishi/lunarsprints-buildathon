import { z } from "zod";
import type { Role } from "../contracts";
import { AppError, assert } from "../domain";
import { NeedsClarification } from "../agents/outcomes";
import type { AgentContext, Intelligence, RunRecord } from "../agents/managed";
import {
  AI_FAILURE_MESSAGE,
  acceptAgentOutput,
  agentContract,
  agentErrorCode,
  agentTimeoutMs,
  sessionContractText,
} from "../agents/contract";
import { assertNoTracing, aiProvider, modelFor, type Env } from "./config";
import { agentDefinitions, type AgentDefinition } from "./definitions";
import { buildAgentGraph, type StructuredModel } from "./graph";
import { createChatModel } from "./models";

export type LangGraphContext = AgentContext & {
  /** Marks runs made only for side-by-side comparison. */
  shadow?: boolean;
};

export type LangGraphDependencies = {
  definitions: Partial<Record<Role, AgentDefinition>>;
  createModel: (
    choice: ReturnType<typeof modelFor>,
    timeoutMs: number,
  ) => StructuredModel;
  env: Env;
};

/**
 * Runs agents through LangGraph and LangChain models. Same interface, same
 * output contract and same error codes as the saved OpenAI agents, so the
 * coordinator cannot tell the engines apart.
 */
export class LangGraphIntelligence implements Intelligence {
  private deps: LangGraphDependencies;
  constructor(
    private context: LangGraphContext,
    deps: Partial<LangGraphDependencies> = {},
  ) {
    const env = deps.env ?? process.env;
    this.deps = {
      definitions: deps.definitions ?? agentDefinitions,
      createModel:
        deps.createModel ??
        ((choice, timeoutMs) => createChatModel(choice, timeoutMs, env)),
      env,
    };
  }

  async invoke<T extends z.ZodType>(
    role: Role,
    schema: T,
    data: unknown,
    instructions = "",
  ): Promise<z.infer<T>> {
    const started = Date.now();
    const contract = agentContract(
      role,
      schema,
      data,
      this.context.contract !== "full",
    );
    const input = JSON.stringify(data);
    const metrics: RunRecord["metrics"] = {
      model: "unresolved",
      contractVersion: contract.contractVersion,
      inputCharacters: input.length,
      schemaCharacters: JSON.stringify(contract.jsonSchema).length,
      outputCharacters: 0,
      firstOutputMs: null,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      outcome: "provider_error",
      usageSource: "unavailable",
      engine: "langgraph",
      shadow: this.context.shadow ?? false,
    };
    let resourceId = `langgraph:${role}`;
    const record = (status: "ok" | "error", errorCode: string | null) =>
      this.context.onRun?.({
        role,
        resourceId,
        sessionId: null,
        turnId: null,
        status,
        durationMs: Date.now() - started,
        errorCode,
        metrics,
      });
    try {
      assert(
        role !== "rhythm",
        "Lunar rhythm suggestions are turned off for now.",
        "agent_disabled",
        403,
      );
      assertNoTracing(this.deps.env);
      const definition = this.deps.definitions[role];
      assert(
        definition,
        "This part of planning is not available in the new AI engine yet. Your saved plan is safe.",
        "agent_not_ported",
        501,
      );
      const choice = this.context.sessionModel
        ? {
            provider: aiProvider(this.deps.env),
            model: this.context.sessionModel,
          }
        : modelFor(role, this.deps.env);
      metrics.model = choice.model;
      metrics.provider = choice.provider;
      resourceId = `langgraph:${choice.provider}:${role}`;
      const timeoutMs = agentTimeoutMs(role, data);
      const graph = buildAgentGraph({
        name: `lunarsprints_${role}`,
        model: this.deps.createModel(choice, timeoutMs),
        jsonSchema: contract.jsonSchema,
        accept: (answer) => acceptAgentOutput(role, schema, contract, answer),
      });
      const state = await graph.invoke(
        {
          system:
            definition.instructions +
            sessionContractText(contract.compact) +
            instructions,
          input,
        },
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      metrics.outputCharacters = state.outputCharacters ?? 0;
      if (state.usage) {
        metrics.inputTokens = state.usage.input_tokens;
        metrics.outputTokens = state.usage.output_tokens;
        metrics.totalTokens = state.usage.total_tokens;
        metrics.cachedInputTokens =
          state.usage.input_token_details?.cache_read ?? null;
        metrics.reasoningTokens =
          state.usage.output_token_details?.reasoning ?? null;
        metrics.usageSource = "provider_response";
      }
      const parsed = schema.parse(state.payload);
      metrics.outcome = "ok";
      record("ok", null);
      return parsed;
    } catch (error) {
      const code = agentErrorCode(error);
      metrics.outcome = code;
      record("error", code);
      if (error instanceof AppError || error instanceof NeedsClarification)
        throw error;
      throw new AppError(code, AI_FAILURE_MESSAGE, 502);
    }
  }
}
