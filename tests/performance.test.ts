import { describe, it, expect } from "vitest";
import { coordinate, hash } from "../src/features/lunarsprints/coordinator";
import { approvalPayload } from "../src/features/lunarsprints/domain";
import type { Command, Sprint } from "../src/features/lunarsprints/contracts";
import type { Intelligence } from "../src/features/lunarsprints/agents/intelligence";
import { sprint, story } from "./fixtures";
const cmd = (
  s: Sprint,
  action: Command["action"],
  data: unknown = {},
): Command => ({
  sprintId: s.id,
  expectedRevision: s.revision,
  idempotencyKey: crypto.randomUUID(),
  action,
  data,
});
const noAI: Intelligence = {
  invoke: async () => {
    throw new Error("No model call should be required");
  },
};
function reviewedWork() {
  const s = sprint();
  s.stories = [structuredClone(story)];
  s.stage = "schedule";
  s.approvals = (["goals", "stories"] as const).map((kind) => ({
    kind,
    hash: hash(approvalPayload(s, kind)),
    revision: s.revision,
    at: new Date().toISOString(),
  }));
  return s;
}
describe("P1 planning critical path", () => {
  it("uses only intent extraction and clarification for a simple assessment", async () => {
    const s = sprint();
    const assessment = structuredClone(s.assessment);
    s.goals = [];
    s.stage = "intention";
    const calls: string[] = [];
    const next = await coordinate(s, cmd(s, "assess"), {
      invoke: async (role) => {
        calls.push(role);
        if (role === "intent_alignment") return assessment as never;
        if (role === "smart_goal")
          return {
            existingFacts: [],
            missingFacts: [],
            questions: [],
            canProposeGoalNow: true,
            requiresBlockingClarification: false,
          } as never;
        throw new Error("Cosmetic model call");
      },
    });
    expect(calls).toEqual(["intent_alignment", "smart_goal"]);
    expect(next.stage).toBe("goals");
  });
  it("creates a validated schedule without AI or provider access", async () => {
    const s = reviewedWork();
    const next = await coordinate(s, cmd(s, "schedule"), noAI);
    expect(next.allocations).toHaveLength(2);
    expect(next.stage).toBe("schedule");
    expect(next.approvals).toEqual(s.approvals);
  });
  it("keeps the saved schedule usable when optional advice fails", async () => {
    let s = reviewedWork();
    s = await coordinate(s, cmd(s, "schedule"), noAI);
    const allocations = structuredClone(s.allocations);
    const next = await coordinate(s, cmd(s, "request_schedule_advice"), noAI);
    expect(next.allocations).toEqual(allocations);
    expect(next.scheduleAdvice?.status).toBe("unavailable");
    expect(next.pendingClarification).toBeNull();
    expect(next.approvals).toEqual(s.approvals);
  });
  it("cannot ask for schedule advice before a validated schedule exists", async () => {
    const s = reviewedWork();
    await expect(
      coordinate(s, cmd(s, "request_schedule_advice"), noAI),
    ).rejects.toThrow("schedule");
  });
  it("invalidates advice after schedule edits without changing reviewed stories", async () => {
    let s = reviewedWork();
    s = await coordinate(s, cmd(s, "schedule"), noAI);
    s = await coordinate(s, cmd(s, "request_schedule_advice"), {
      invoke: async () =>
        ({ notes: ["Keep a buffer for unexpected work."] }) as never,
    });
    expect(s.scheduleAdvice?.status).toBe("ready");
    const next = await coordinate(
      s,
      cmd(s, "edit_schedule", {
        allocations: s.allocations,
        capacityMinutes: s.capacityMinutes,
        dailyMinutes: s.dailyMinutes,
        bufferPercent: 25,
      }),
      noAI,
    );
    expect(next.scheduleAdvice).toBeNull();
    expect(next.stories).toEqual(s.stories);
  });
});

import {
  compactEnvelope,
  storiesSchema,
} from "../src/features/lunarsprints/contracts";
import { clarificationOutcome } from "../src/features/lunarsprints/agents/outcomes";
it("keeps missing-scope recovery in the compact response contract", () => {
  const frame = compactEnvelope("story_decomposer", storiesSchema).parse({
    schemaVersion: "2.1",
    agentId: "story_decomposer",
    status: "needs_clarification",
    payload: null,
    missingFields: ["chapterScope"],
    clarification: {
      question: "Which sections should this draft cover?",
      options: ["Known outline", "Discover the outline"],
    },
    warnings: [],
  });
  expect(
    clarificationOutcome("story_decomposer", frame)?.request.options,
  ).toHaveLength(2);
  expect(() =>
    compactEnvelope("story_decomposer", storiesSchema).parse({
      ...frame,
      agentId: "smart_goal",
    }),
  ).toThrow();
});

it("reuses successful explanation for the same saved schedule", async () => {
  let s = reviewedWork();
  s = await coordinate(s, cmd(s, "schedule"), noAI);
  s = await coordinate(s, cmd(s, "request_schedule_advice"), {
    invoke: async () => ({ notes: ["A protected buffer remains."] }) as never,
  });
  const next = await coordinate(s, cmd(s, "request_schedule_advice"), noAI);
  expect(next.scheduleAdvice).toEqual(s.scheduleAdvice);
});
