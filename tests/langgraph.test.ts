import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import registry from "../config/agent-registry.json";
import { AppError } from "../src/features/lunarsprints/domain";
import { NeedsClarification } from "../src/features/lunarsprints/agents/outcomes";
import {
  ManagedIntelligence,
  type Intelligence,
  type RunRecord,
} from "../src/features/lunarsprints/agents/managed";
import { openAIModelFor } from "../src/features/lunarsprints/agents/contract";
import {
  aiEngine,
  assertNoTracing,
  modelFor,
} from "../src/features/lunarsprints/ai/config";
import type { StructuredModel } from "../src/features/lunarsprints/ai/graph";
import { LangGraphIntelligence } from "../src/features/lunarsprints/ai/intelligence";
import {
  ShadowIntelligence,
  createIntelligence,
} from "../src/features/lunarsprints/ai/select";

const notesSchema = z.object({ notes: z.array(z.string()).max(3) });
const ok = (payload: unknown, extra: Record<string, unknown> = {}) => ({
  schemaVersion: "2.1",
  agentId: "scheduling",
  status: "ok",
  payload,
  missingFields: [],
  clarification: null,
  warnings: [],
  ...extra,
});

/** A stand-in chat model that returns a fixed structured answer. */
function stub(answer: unknown, seen: unknown[] = []): StructuredModel {
  return {
    withStructuredOutput: () => ({
      invoke: async (messages: unknown) => {
        seen.push(messages);
        return {
          parsed: answer,
          raw: {
            usage_metadata: {
              input_tokens: 120,
              output_tokens: 30,
              total_tokens: 150,
            },
          },
        };
      },
    }),
  } as unknown as StructuredModel;
}

function engine(
  answer: unknown,
  options: {
    env?: Record<string, string>;
    runs?: RunRecord[];
    seen?: unknown[];
    ported?: boolean;
  } = {},
) {
  const createModel = vi.fn(() => stub(answer, options.seen));
  const ai = new LangGraphIntelligence(
    {
      userId: "user",
      sprintId: "sprint",
      onRun: (r) => options.runs?.push(r),
    },
    {
      env: options.env ?? {},
      definitions:
        options.ported === false
          ? {}
          : { scheduling: { instructions: "Scheduling rules." } },
      createModel,
    },
  );
  return { ai, createModel };
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return error instanceof AppError
      ? error.code
      : error instanceof NeedsClarification
        ? "NeedsClarification"
        : String(error);
  }
}

describe("AI settings", () => {
  it("defaults to the saved agents and rejects unknown engines", () => {
    expect(aiEngine({})).toBe("saved_agents");
    expect(aiEngine({ AI_ENGINE: "shadow" })).toBe("shadow");
    expect(() => aiEngine({ AI_ENGINE: "crewai" })).toThrow(AppError);
  });

  it("uses the same OpenAI model per role as the saved agents", () => {
    expect(modelFor("reflection", {}).model).toBe(registry.reflection.model);
    expect(modelFor("story_decomposer", {}).model).toBe("gpt-6.1-sol");
    expect(
      modelFor("smart_goal", { OPENAI_SMART_MODEL: "" }).model,
      "an empty variable counts as unset",
    ).toBe(registry.smart_goal.model);
    expect(openAIModelFor("smart_goal", { OPENAI_SMART_MODEL: "m1" })).toBe(
      "m1",
    );
  });

  it("switches provider and model by config only", () => {
    const env = {
      AI_PROVIDER: "anthropic",
      AI_MODEL: "model-a",
      AI_MODEL_STORY_DECOMPOSER: "model-b",
    };
    expect(modelFor("reflection", env)).toEqual({
      provider: "anthropic",
      model: "model-a",
    });
    expect(modelFor("story_decomposer", env).model).toBe("model-b");
    expect(() => modelFor("reflection", { AI_PROVIDER: "anthropic" })).toThrow(
      AppError,
    );
  });

  it("refuses to run while LangSmith tracing is on", () => {
    expect(() => assertNoTracing({ LANGSMITH_TRACING: "true" })).toThrow(
      AppError,
    );
    expect(() => assertNoTracing({ LANGSMITH_TRACING: "false" })).not.toThrow();
  });

  it("picks the engine from AI_ENGINE", () => {
    const context = { userId: "u", sprintId: "s" };
    expect(createIntelligence(context, {}).ai).toBeInstanceOf(
      ManagedIntelligence,
    );
    expect(
      createIntelligence(context, { AI_ENGINE: "langgraph" }).ai,
    ).toBeInstanceOf(LangGraphIntelligence);
    expect(
      createIntelligence(context, { AI_ENGINE: "shadow" }).ai,
    ).toBeInstanceOf(ShadowIntelligence);
  });
});

describe("LangGraph engine", () => {
  it("returns the validated payload and records the run", async () => {
    const runs: RunRecord[] = [];
    const seen: unknown[] = [];
    const { ai } = engine(ok({ notes: ["Start with the outline."] }), {
      runs,
      seen,
    });
    const result = await ai.invoke(
      "scheduling",
      notesSchema,
      { readyTasks: [] },
      "Extra stage rule.",
    );
    expect(result).toEqual({ notes: ["Start with the outline."] });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      role: "scheduling",
      resourceId: "langgraph:openai:scheduling",
      status: "ok",
      sessionId: null,
      metrics: {
        engine: "langgraph",
        shadow: false,
        model: registry.scheduling.model,
        provider: "openai",
        totalTokens: 150,
        usageSource: "provider_response",
        contractVersion: "2.1",
      },
    });
    const [system, human] = seen[0] as {
      content: string;
    }[];
    expect(system.content).toContain("Scheduling rules.");
    expect(system.content).toContain("Application session contract v2.1");
    expect(system.content).toContain("Extra stage rule.");
    expect(human.content).toBe(JSON.stringify({ readyTasks: [] }));
  });

  it("passes a clarification request through unchanged", async () => {
    const { ai } = engine(
      ok(null, {
        status: "needs_clarification",
        missingFields: ["dailyMinutes"],
        clarification: { question: "How long each day?", options: ["1 hour"] },
      }),
    );
    const error = await ai
      .invoke("scheduling", notesSchema, {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NeedsClarification);
    expect((error as NeedsClarification).request.question).toBe(
      "How long each day?",
    );
  });

  it("stops on blocker warnings and malformed answers", async () => {
    const blocked = engine(
      ok(
        { notes: [] },
        {
          warnings: [
            { code: "x", message: "Dates conflict.", severity: "blocker" },
          ],
        },
      ),
    );
    expect(await codeOf(blocked.ai.invoke("scheduling", notesSchema, {}))).toBe(
      "needs_clarification",
    );
    const runs: RunRecord[] = [];
    const malformed = engine({ status: "ok" }, { runs });
    expect(
      await codeOf(malformed.ai.invoke("scheduling", notesSchema, {})),
    ).toBe("invalid_model_output");
    expect(runs[0]).toMatchObject({
      status: "error",
      errorCode: "invalid_model_output",
    });
    const unparsed = engine(null);
    expect(
      await codeOf(unparsed.ai.invoke("scheduling", notesSchema, {})),
    ).toBe("invalid_model_output");
  });

  it("never falls back silently for roles that are not ported", async () => {
    const runs: RunRecord[] = [];
    const { ai, createModel } = engine(ok({ notes: [] }), {
      runs,
      ported: false,
    });
    expect(await codeOf(ai.invoke("scheduling", notesSchema, {}))).toBe(
      "agent_not_ported",
    );
    expect(createModel).not.toHaveBeenCalled();
    expect(runs[0].errorCode).toBe("agent_not_ported");
  });

  it("keeps rhythm off and refuses tracing", async () => {
    const { ai } = engine(ok({ notes: [] }));
    expect(await codeOf(ai.invoke("rhythm", notesSchema, {}))).toBe(
      "agent_disabled",
    );
    const traced = engine(ok({ notes: [] }), {
      env: { LANGCHAIN_TRACING_V2: "true" },
    });
    expect(await codeOf(traced.ai.invoke("scheduling", notesSchema, {}))).toBe(
      "ai_misconfigured",
    );
  });
});

describe("shadow mode", () => {
  const fixed = (result: unknown): Intelligence => ({
    invoke: vi.fn(async () => result) as Intelligence["invoke"],
  });
  const failing = (): Intelligence => ({
    invoke: vi.fn(async () => {
      throw new AppError("agent_not_ported", "Not yet.", 501);
    }) as Intelligence["invoke"],
  });

  it("always returns the saved agents' answer, even if the new engine fails", async () => {
    const primary = fixed({ notes: ["saved"] });
    const shadow = failing();
    const ai = new ShadowIntelligence(primary, shadow);
    expect(await ai.invoke("scheduling", notesSchema, { a: 1 })).toEqual({
      notes: ["saved"],
    });
    await ai.settle();
    expect(shadow.invoke).toHaveBeenCalledWith(
      "scheduling",
      notesSchema,
      { a: 1 },
      undefined,
    );
  });

  it("still reports the saved agents' errors", async () => {
    const ai = new ShadowIntelligence(failing(), fixed({ notes: [] }));
    expect(await codeOf(ai.invoke("scheduling", notesSchema, {}))).toBe(
      "agent_not_ported",
    );
    await ai.settle();
  });
});
