import { describe, it, expect } from "vitest";
import { sprint, story, goal } from "./fixtures";
import {
  addDays,
  planSchedule,
  validateSchedule,
  validateReplanProposal,
  capacity,
  approvalPayload,
} from "../src/features/lunarsprints/domain";
import {
  coordinate,
  hash,
  hashes,
} from "../src/features/lunarsprints/coordinator";
import type {
  Command,
  Sprint,
  Story,
} from "../src/features/lunarsprints/contracts";
const noAI = {
  invoke: async () => {
    throw new Error("Scheduling must not call AI");
  },
};
const cmd = (
  s: Sprint,
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
function ready() {
  const s = sprint();
  s.stories = [structuredClone(story)];
  s.stage = "schedule";
  s.approvals = (["goals", "stories"] as const).map((kind) => ({
    kind,
    hash: hash(approvalPayload(s, kind)),
    revision: 0,
    at: "",
  }));
  return s;
}
function one(id: string, goalId = goal.id, minutes = 30): Story {
  return {
    ...structuredClone(story),
    id,
    goalId,
    tasks: [{ ...structuredClone(story.tasks[1]), id: `${id}-task`, minutes }],
    dependencyIds: [],
  };
}
describe("P2 deadline and availability boundaries", () => {
  it("rejects a date inside the sprint but after its goal deadline", () => {
    const s = ready();
    s.goals[0].deadline = s.startDate;
    const a = s.stories[0].tasks.map((t) => ({
      taskId: t.id,
      date: addDays(s.startDate, 1),
      minutes: t.minutes,
    }));
    expect(() => validateSchedule(s, a)).toThrow(/deadline/i);
  });
  it("does not waive goal deadlines through capacity risk approval", async () => {
    const s = ready();
    s.goals[0].deadline = s.startDate;
    s.allocations = s.stories[0].tasks.map((t) => ({
      taskId: t.id,
      date: s.endDate,
      minutes: t.minutes,
    }));
    await expect(
      coordinate(
        s,
        cmd(s, "approve_schedule", { acknowledgeRisk: true }, "schedule"),
        noAI,
      ),
    ).rejects.toThrow(/deadline/i);
  });
  it("rejects manual allocations on an explicit zero-minute rest day", () => {
    const s = ready();
    s.dailyMinutes[0] = 0;
    const a = s.stories[0].tasks.map((t) => ({
      taskId: t.id,
      date: s.startDate,
      minutes: t.minutes,
    }));
    expect(() => validateSchedule(s, a)).toThrow(/rest day/i);
  });
  it("saves a recoverable conflict instead of inventing work on 15 rest days", async () => {
    const s = ready();
    s.dailyMinutes.fill(0);
    s.capacityMinutes = null;
    const next = await coordinate(s, cmd(s, "schedule"), noAI);
    expect(next.scheduleConflict?.message).toMatch(/availability|rest/i);
    expect(next.allocations).toEqual([]);
    expect(next.goals).toEqual(s.goals);
    expect(next.stories).toEqual(s.stories);
    expect(next.approvals).toEqual(s.approvals);
    expect(next.stage).toBe("schedule");
  });
  it("schedules urgent goals before higher-priority later goals", () => {
    const s = ready();
    s.goals = [
      { ...structuredClone(goal), id: "later", intentId: "portfolio" },
      {
        ...structuredClone(goal),
        id: "urgent",
        intentId: "urgent",
        deadline: s.startDate,
      },
    ];
    s.selectedIntentIds = ["portfolio", "urgent"];
    s.stories = [one("later", "later", 40), one("urgent", "urgent", 40)];
    s.dailyMinutes.fill(60);
    const a = planSchedule(s);
    expect(a.find((x) => x.taskId === "urgent-task")?.date).toBe(s.startDate);
    expect(a.find((x) => x.taskId === "later-task")?.date).toBe(
      addDays(s.startDate, 1),
    );
  });
  it("propagates successor deadlines to a shared prerequisite", () => {
    const s = ready();
    s.goals = [
      { ...structuredClone(goal), id: "foundation", intentId: "foundation" },
      {
        ...structuredClone(goal),
        id: "urgent",
        intentId: "urgent",
        deadline: addDays(s.startDate, 1),
      },
    ];
    s.selectedIntentIds = ["foundation", "urgent"];
    s.stories = [
      one("other", "foundation", 45),
      one("base", "foundation", 45),
      { ...one("child", "urgent", 45), dependencyIds: ["base"] },
    ];
    const a = planSchedule(s);
    expect(a.find((x) => x.taskId === "base-task")?.date).toBe(s.startDate);
    expect(a.find((x) => x.taskId === "child-task")?.date).toBe(
      addDays(s.startDate, 1),
    );
  });
  it("reports impossible same-day dependency and deadline windows without partial writes", async () => {
    const s = ready();
    s.goals[0].deadline = s.startDate;
    s.stories = [one("base"), { ...one("child"), dependencyIds: ["base"] }];
    const before = structuredClone(s);
    const next = await coordinate(s, cmd(s, "schedule"), noAI);
    expect(next.scheduleConflict).toBeTruthy();
    expect(next.allocations).toEqual([]);
    expect(s).toEqual(before);
  });
  it("does not put an unsplittable task into an unavailable-sized slot", async () => {
    const s = ready();
    s.dailyMinutes.fill(20);
    s.capacityMinutes = null;
    const next = await coordinate(s, cmd(s, "schedule"), noAI);
    expect(next.scheduleConflict?.message).toMatch(/45|split/i);
    expect(next.allocations).toEqual([]);
  });
  it("does not silently overfill days when combined work exceeds all daily slots", async () => {
    const s = ready();
    s.dailyMinutes.fill(0);
    s.dailyMinutes[0] = 60;
    s.capacityMinutes = 60;
    const next = await coordinate(s, cmd(s, "schedule"), noAI);
    expect(next.scheduleConflict).toBeTruthy();
    expect(next.allocations).toEqual([]);
  });
  it("allows a valid schedule using some buffer but exposes the risk", () => {
    const s = ready();
    s.stories = [one("work", goal.id, 50)];
    s.dailyMinutes.fill(0);
    s.dailyMinutes[0] = 60;
    s.capacityMinutes = 60;
    const a = planSchedule(s);
    expect(a).toHaveLength(1);
    expect(capacity(s, a).dailyBufferOverload).toBe(true);
  });
  it("requires acknowledgment before approving use of daily protected buffer", async () => {
    const s = ready();
    s.stories = [one("work", goal.id, 50)];
    s.dailyMinutes[0] = 60;
    s.capacityMinutes = 600;
    s.allocations = [{ taskId: "work-task", date: s.startDate, minutes: 50 }];
    await expect(
      coordinate(
        s,
        cmd(s, "approve_schedule", { acknowledgeRisk: false }, "schedule"),
        noAI,
      ),
    ).rejects.toThrow(/risk/i);
  });
  it("clears the conflict after availability is explicitly corrected", async () => {
    const s = ready();
    s.dailyMinutes.fill(0);
    s.capacityMinutes = null;
    let next = await coordinate(s, cmd(s, "schedule"), noAI);
    next = await coordinate(
      next,
      cmd(next, "confirm_availability", {
        capacityMinutes: 600,
        dailyMinutes: Array(15).fill(60),
        bufferPercent: 20,
      }),
      noAI,
    );
    next = await coordinate(next, cmd(next, "schedule"), noAI);
    expect(next.scheduleConflict).toBeNull();
    expect(next.allocations).toHaveLength(2);
  });
  it("enforces the same deadline boundary for semantic replan candidates", () => {
    const s = ready();
    s.allocations = planSchedule(s);
    s.goals[0].deadline = s.startDate;
    expect(() =>
      validateReplanProposal(s, {
        stories: s.stories,
        allocations: s.allocations.map((a) => ({ ...a, date: s.endDate })),
        capacityMinutes: s.capacityMinutes,
        dailyMinutes: s.dailyMinutes,
        bufferPercent: s.bufferPercent,
      }),
    ).toThrow(/deadline/i);
  });
  it("rejects unknown and cyclic dependencies with an actionable error before placement", () => {
    const s = ready();
    s.stories[0].dependencyIds = ["missing"];
    expect(() => planSchedule(s)).toThrow(/dependency/i);
    s.stories[0].dependencyIds = [s.stories[0].id];
    expect(() => planSchedule(s)).toThrow(/cycle/i);
  });
  it("is deterministic and preserves the reviewed estimates and task contents", () => {
    const s = ready();
    const before = structuredClone(s);
    expect(planSchedule(s)).toEqual(planSchedule(s));
    expect(s).toEqual(before);
  });
});

it("does not approve an empty conflict proposal even with risk acknowledgment", async () => {
  const s = ready();
  s.dailyMinutes.fill(0);
  s.capacityMinutes = null;
  const next = await coordinate(s, cmd(s, "schedule"), noAI);
  await expect(
    coordinate(
      next,
      cmd(next, "approve_schedule", { acknowledgeRisk: true }, "schedule"),
      noAI,
    ),
  ).rejects.toThrow(/Every task/);
});
it("preserves completed work when deadline or rest-day restrictions make a replan invalid", () => {
  const s = ready();
  s.allocations = planSchedule(s);
  const t = s.stories[0].tasks[0];
  s.progress[t.id] = {
    status: "done",
    percent: 100,
    dodConfirmed: true,
    completedSubtaskIds: t.subtasks.map((x) => x.id),
    note: "User reported done",
    actualMinutes: t.minutes,
    updatedAt: new Date().toISOString(),
  };
  const before = structuredClone(s);
  const candidate = {
    stories: structuredClone(s.stories),
    allocations: s.allocations.map((a) => ({ ...a, date: s.endDate })),
    capacityMinutes: s.capacityMinutes,
    dailyMinutes: s.dailyMinutes,
    bufferPercent: s.bufferPercent,
  };
  expect(() => validateReplanProposal(s, candidate)).toThrow(
    /recorded allocation/,
  );
  expect(s).toEqual(before);
});
it("checks 200 deterministic varied DAG, deadline, buffer and availability scenarios", () => {
  let seed = 9042;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  let fits = 0,
    conflicts = 0;
  for (let sample = 0; sample < 200; sample++) {
    const s = ready();
    s.capacityMinutes = null;
    s.bufferPercent = next() % 51;
    s.dailyMinutes = Array.from(
      { length: 15 },
      () => [0, 15, 30, 60][next() % 4],
    );
    s.goals[0].deadline = addDays(s.startDate, next() % 15);
    s.stories = Array.from({ length: 1 + (next() % 8) }, (_, i) => ({
      ...one(`s${i}`, goal.id, 5 + (next() % 56)),
      dependencyIds: i && next() % 2 ? [`s${i - 1}`] : [],
    }));
    try {
      const allocations = planSchedule(s);
      fits++;
      expect(allocations).toHaveLength(s.stories.length);
      for (const a of allocations) {
        expect(a.date <= s.goals[0].deadline).toBe(true);
        const day = Math.round(
          (Date.parse(a.date) - Date.parse(s.startDate)) / 86400000,
        );
        expect(s.dailyMinutes[day]).toBeGreaterThan(0);
        expect(
          allocations
            .filter((x) => x.date === a.date)
            .reduce((n, x) => n + x.minutes, 0),
        ).toBeLessThanOrEqual(s.dailyMinutes[day]);
      }
      for (const st of s.stories)
        for (const dep of st.dependencyIds)
          expect(
            allocations.find((a) => a.taskId === `${dep}-task`)!.date <
              allocations.find((a) => a.taskId === `${st.id}-task`)!.date,
          ).toBe(true);
    } catch (e) {
      expect(e).toMatchObject({ code: "schedule_conflict" });
      conflicts++;
    }
  }
  expect(fits).toBeGreaterThan(0);
  expect(conflicts).toBeGreaterThan(0);
});
