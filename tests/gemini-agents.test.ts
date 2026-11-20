import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AI_MESSAGES,
  GeminiAgentsIntelligence,
  activeEngine,
  agentServiceAnswers,
  selectIntelligence,
} from "../src/features/lunarsprints/agents/gemini-agents";
import {
  UnavailableIntelligence,
  type RunRecord,
} from "../src/features/lunarsprints/agents/intelligence";
import { scheduleNotesSchema } from "../src/features/lunarsprints/agents/contract";
import { NeedsClarification } from "../src/features/lunarsprints/agents/outcomes";
import { coordinate, hashes } from "../src/features/lunarsprints/coordinator";
import { AppError } from "../src/features/lunarsprints/domain";
import type { Command } from "../src/features/lunarsprints/contracts";
import { sprint, story } from "./fixtures";

const NOTES_INPUT = {
  validatedAllocations: [{ taskId: "m1-s1", date: "2026-12-02", minutes: 30 }],
  capacity: {
    planned: 30,
    buffer: 0,
    usable: null,
    dayLoads: [0, 30, 0],
    overbooked: 0,
    unknown: true,
    dailyOverload: false,
    dailyBufferOverload: false,
    byGoal: [{ id: "g1", title: "Fictional goal", minutes: 30 }],
  },
  startDate: "2026-12-01",
  endDate: "2026-12-03",
  confirmedFacts: [],
};

const envelope = (payload: unknown, extra: Record<string, unknown> = {}) => ({
  schemaVersion: "2.1",
  agentId: "scheduling",
  status: "ok",
  payload,
  missingFields: [],
  clarification: null,
  warnings: [],
  ...extra,
});

const usage = {
  model: "test-flash-model",
  input_tokens: 120,
  output_tokens: null,
  latency_ms: 900,
};

type Sent = { url: string; init: RequestInit };

function fakeService(respond: (sent: Sent) => Response | Promise<Response>): {
  fetch: typeof fetch;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    sent.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fetch: f, sent };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function engine(
  respond: (sent: Sent) => Response | Promise<Response>,
  timeoutMs?: number,
) {
  const runs: RunRecord[] = [];
  const service = fakeService(respond);
  const ai = new GeminiAgentsIntelligence(
    { userId: "user-1", sprintId: "sprint-1", onRun: (r) => runs.push(r) },
    {
      url: "http://agents.test/",
      token: "test-token",
      fetch: service.fetch,
      timeoutMs,
    },
  );
  return { ai, runs, sent: service.sent };
}

describe("GeminiAgentsIntelligence", () => {
  it("returns a checked answer and records metadata only", async () => {
    const { ai, runs, sent } = engine(() =>
      json({
        result: envelope({ notes: ["Most work sits on 2 December 2026."] }),
        usage,
      }),
    );
    const out = await ai.invoke("scheduling", scheduleNotesSchema, NOTES_INPUT);
    expect(out).toEqual({ notes: ["Most work sits on 2 December 2026."] });

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("http://agents.test/v1/roles/scheduling");
    const headers = sent[0].init.headers as Record<string, string>;
    expect(headers["x-service-token"]).toBe("test-token");
    const body = JSON.parse(String(sent[0].init.body));
    expect(body.task).toBe("schedule_notes");
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toContain("user-1");

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      role: "scheduling",
      resourceId: "adk:scheduling.schedule_notes",
      sessionId: body.requestId,
      status: "ok",
      errorCode: null,
      metrics: {
        engine: "adk_gemini",
        model: "test-flash-model",
        latencyMs: 900,
        inputTokens: 120,
        outputTokens: null,
        outcome: "ok",
      },
    });
    expect(JSON.stringify(runs)).not.toContain("2 December");
  });

  it("sends only what the role needs, dropping identity and extras", async () => {
    const { ai, sent } = engine(() =>
      json({ result: envelope({ notes: [] }), usage }),
    );
    await ai.invoke("scheduling", scheduleNotesSchema, {
      ...NOTES_INPUT,
      email: "someone@example.com",
      userId: "user-1",
    });
    const body = JSON.parse(String(sent[0].init.body));
    expect(body.input).not.toHaveProperty("email");
    expect(body.input).not.toHaveProperty("userId");
  });

  it("turns a slow service into a plain timeout message", async () => {
    const { ai, runs } = engine(
      ({ init }) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          ),
        ),
      20,
    );
    const error = await ai
      .invoke("scheduling", scheduleNotesSchema, NOTES_INPUT)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "ai_timeout",
      status: 504,
      message: AI_MESSAGES.ai_timeout.message,
    });
    expect(runs[0]).toMatchObject({ status: "error", errorCode: "ai_timeout" });
  });

  it("maps the service timeout code to the same message", async () => {
    const { ai } = engine(() => json({ error: { code: "ai_timeout" } }, 504));
    await expect(
      ai.invoke("scheduling", scheduleNotesSchema, NOTES_INPUT),
    ).rejects.toMatchObject({ code: "ai_timeout" });
  });

  it("rejects an answer that breaks the contract and saves nothing", async () => {
    const { ai, runs } = engine(() =>
      json({ result: envelope({ notes: ["a", "b", "c", "d"] }), usage }),
    );
    await expect(
      ai.invoke("scheduling", scheduleNotesSchema, NOTES_INPUT),
    ).rejects.toMatchObject({
      code: "invalid_ai_output",
      status: 502,
      message: AI_MESSAGES.invalid_ai_output.message,
    });
    expect(runs[0]).toMatchObject({
      status: "error",
      errorCode: "invalid_ai_output",
      metrics: { model: "test-flash-model" },
    });
  });

  it("rejects an answer from the wrong role", async () => {
    const { ai } = engine(() =>
      json({
        result: envelope({ notes: [] }, { agentId: "smart_goal" }),
        usage,
      }),
    );
    await expect(
      ai.invoke("scheduling", scheduleNotesSchema, NOTES_INPUT),
    ).rejects.toMatchObject({ code: "invalid_ai_output" });
  });

  it("passes the service's invalid output code through", async () => {
    const { ai } = engine(() =>
      json({ error: { code: "invalid_ai_output" } }, 502),
    );
    await expect(
      ai.invoke("scheduling", scheduleNotesSchema, NOTES_INPUT),
    ).rejects.toMatchObject({ code: "invalid_ai_output" });
  });

  it("reports an unauthorized call honestly", async () => {
    const { ai, runs } = engine(() =>
      json({ error: { code: "unauthorized" } }, 401),
    );
    await expect(
      ai.invoke("scheduling", scheduleNotesSchema, NOTES_INPUT),
    ).rejects.toMatchObject({
      code: "unauthorized",
      status: 503,
      message: AI_MESSAGES.unauthorized.message,
    });
    expect(runs[0].errorCode).toBe("unauthorized");
  });

  it("explains a stopped service without retrying", async () => {
    const { ai, sent } = engine(() => {
      throw new TypeError("fetch failed");
    });
    await expect(
      ai.invoke("scheduling", scheduleNotesSchema, NOTES_INPUT),
    ).rejects.toMatchObject({
      code: "ai_unavailable",
      message:
        "AI suggestions didn't come through this time. Your saved plan is safe. Try again.",
    });
    expect(sent).toHaveLength(1);
  });

  it("keeps the being-upgraded message for roles not connected yet", async () => {
    const { ai, sent } = engine(() => json({}));
    for (const role of [
      "daily_execution",
      "adaptive_backlog",
      "reflection",
    ] as const)
      await expect(ai.invoke(role, z.object({}), {})).rejects.toMatchObject({
        code: "ai_not_connected",
        status: 503,
        message: "AI suggestions are being upgraded. Your saved plan is safe.",
      });
    expect(sent).toHaveLength(0);
  });

  it("raises a clarification instead of guessing", async () => {
    const { ai, runs } = engine(() =>
      json({
        result: envelope(null, {
          status: "needs_clarification",
          missingFields: ["deliverableScope"],
          clarification: {
            question: "Which pages are in scope?",
            options: ["Home only", "All five pages"],
          },
        }),
        usage,
      }),
    );
    const error = await ai
      .invoke("scheduling", scheduleNotesSchema, NOTES_INPUT)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NeedsClarification);
    expect(runs[0]).toMatchObject({ status: "ok", errorCode: null });
  });

  it("leaves the saved sprint unchanged when the service fails", async () => {
    const { ai } = engine(() => {
      throw new TypeError("fetch failed");
    });
    const s = sprint();
    const before = structuredClone(s);
    const command: Command = {
      sprintId: s.id,
      expectedRevision: s.revision,
      idempotencyKey: crypto.randomUUID(),
      action: "regenerate_goals",
      data: {},
    };
    await expect(coordinate(s, command, ai)).rejects.toMatchObject({
      code: "ai_unavailable",
    });
    expect(s).toEqual(before);
  });

  it("keeps the schedule and notes the optional explanation is unavailable", async () => {
    const { ai } = engine(() => json({ error: { code: "ai_timeout" } }, 504));
    const cmd = (
      s: ReturnType<typeof sprint>,
      action: Command["action"],
      data: unknown = {},
      kind?: string,
    ): Command => ({
      sprintId: s.id,
      expectedRevision: s.revision,
      idempotencyKey: crypto.randomUUID(),
      action,
      data,
      ...(kind ? { hash: hashes(s)[kind] } : {}),
    });
    let s = sprint();
    s = await coordinate(s, cmd(s, "approve_goals", {}, "goals"), ai);
    s.stories = [structuredClone(story)];
    s = await coordinate(s, cmd(s, "approve_stories", {}, "stories"), ai);
    s = await coordinate(s, cmd(s, "schedule", {}), ai);
    const allocations = structuredClone(s.allocations);
    s = await coordinate(s, cmd(s, "request_schedule_advice", {}), ai);
    expect(s.scheduleAdvice?.status).toBe("unavailable");
    expect(s.allocations).toEqual(allocations);
  });
});

describe("engine selection", () => {
  it("uses the agent service only when its address is set", () => {
    expect(activeEngine({})).toBe("unavailable");
    expect(activeEngine({ AGENTS_SERVICE_URL: "http://127.0.0.1:8080" })).toBe(
      "gemini_agents",
    );
    expect(
      selectIntelligence({ userId: "u", sprintId: "s" }, {}),
    ).toBeInstanceOf(UnavailableIntelligence);
    expect(
      selectIntelligence(
        { userId: "u", sprintId: "s" },
        { AGENTS_SERVICE_URL: "http://127.0.0.1:8080" },
      ),
    ).toBeInstanceOf(GeminiAgentsIntelligence);
  });

  it("reports whether the agent service answers", async () => {
    const up = (async () => new Response("{}")) as unknown as typeof fetch;
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const env = { AGENTS_SERVICE_URL: "http://127.0.0.1:8080" };
    expect(await agentServiceAnswers({}, up)).toBeNull();
    expect(await agentServiceAnswers(env, up)).toBe(true);
    expect(await agentServiceAnswers(env, down)).toBe(false);
  });
});
