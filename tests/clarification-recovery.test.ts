import { describe, it, expect } from "vitest";
import {
  coordinate,
  hash,
  hashes,
} from "../src/features/lunarsprints/coordinator";
import {
  approvalPayload,
  capacity,
  AppError,
} from "../src/features/lunarsprints/domain";
import { planningFacts } from "../src/features/lunarsprints/planning";
import type { Sprint, Command } from "../src/features/lunarsprints/contracts";
import {
  NeedsClarification,
  clarificationOutcome,
} from "../src/features/lunarsprints/agents/outcomes";
import type { Role } from "../src/features/lunarsprints/contracts";
import type { Intelligence } from "../src/features/lunarsprints/agents/managed";
import { sprint, story } from "./fixtures";
import {
  planningResponseSchema,
  goalPlanningSchema,
} from "../src/features/lunarsprints/contracts";
const ready = {
  status: "ready",
  mode: "delivery",
  scopeSummary: "A defined three-section draft.",
  rationale: "The scope is bounded.",
  evidenceRefs: ["intention"],
  clarification: null,
};
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
    throw new Error("Unexpected model call");
  },
};
async function savedQuestion() {
  const s = approvedBook();
  s.scopeReadiness = {
    ...ready,
    status: "ready",
    mode: "delivery",
    goalsHash: hash(s.goals),
  };
  return coordinate(s, cmd(s, "generate_stories"), {
    invoke: async () => {
      throw new NeedsClarification("story_decomposer", {
        question: "What outline should this draft cover?",
        options: ["I know the outline", "The outline is not decided"],
        missingFields: ["chapterScope"],
        reason: "Scope is required for an estimate.",
      });
    },
  });
}
async function saveReply(s: Sprint, unknown = false) {
  return coordinate(
    s,
    cmd(s, "answer_clarification", {
      questionId: s.pendingClarification!.id,
      status: unknown ? "unknown" : "confirmed",
      optionId: null,
      customText: unknown
        ? null
        : "Three sections, about 2,000 words, from existing fragments.",
    }),
    noAI,
  );
}

function approvedBook() {
  const s = sprint();
  s.originalIntention = s.intention =
    "Combine scattered notes and fragments into a complete book draft.";
  s.goals[0].title = "Complete the consolidated manuscript";
  s.goals[0].statement = "Combine the fragments and draft every chapter.";
  s.goals[0].assumptions = ["Chapter scope and remaining writing are unknown."];
  s.capacityMinutes = null;
  s.stage = "stories";
  s.approvals = [
    {
      kind: "goals",
      hash: hash(approvalPayload(s, "goals")),
      revision: s.revision,
      at: new Date().toISOString(),
    },
  ];
  return s;
}
describe("fragmented book: downstream clarification recovery", () => {
  it("persists the specialist question while retaining the approved goal and empty work plan", async () => {
    const s = approvedBook();
    const ai: Intelligence = {
      invoke: async () => {
        throw new NeedsClarification("story_decomposer", {
          question:
            "What outline and approximate extent should this draft cover?",
          options: ["I can provide an outline", "The scope is not decided yet"],
          missingFields: ["chapterScope", "approximateTargetManuscriptLength"],
          reason: "Scope is needed to estimate remaining work.",
        });
      },
    };
    const next = await coordinate(
      s,
      {
        sprintId: s.id,
        expectedRevision: s.revision,
        idempotencyKey: crypto.randomUUID(),
        action: "generate_stories",
        data: {},
      },
      ai,
    );
    expect(next.pendingClarification?.question).toContain("outline");
    expect(next.goals).toEqual(s.goals);
    expect(next.approvals).toEqual(s.approvals);
    expect(next.stories).toEqual([]);
    expect(next.revision).toBe(s.revision + 1);
  });
});

describe("clarification lifecycle and readiness", () => {
  it("constrains readiness provenance to supplied fact IDs", () => {
    const schema = planningResponseSchema(goalPlanningSchema, {
      confirmedFacts: [{ id: "intention" }],
    });
    expect(
      schema.safeParse({
        goals: sprint().goals,
        readiness: { ...ready, evidenceRefs: ["invented"] },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ goals: sprint().goals, readiness: ready }).success,
    ).toBe(true);
  });
  it("resolves selected answers without treating them as confirmed numeric capacity", () => {
    const s = approvedBook();
    s.clarification = {
      questions: [
        {
          id: "hours",
          intentId: s.selectedIntentIds[0],
          category: "constraints",
          question: "Available time?",
          required: false,
          rationale: "Estimate time",
          options: [
            {
              id: "one-hour",
              text: "About one hour daily",
              recommended: false,
              recommendationBasis: "none",
              recommendationReason: null,
            },
            {
              id: "varies",
              text: "It varies",
              recommended: false,
              recommendationBasis: "none",
              recommendationReason: null,
            },
          ],
        },
      ],
      existingFacts: [],
      missingFacts: [],
      canProposeGoalNow: false,
      requiresBlockingClarification: true,
    };
    s.answers = [
      {
        questionId: "hours",
        optionId: "one-hour",
        customText: null,
        status: "confirmed",
        source: "user_selected",
      },
    ];
    expect(planningFacts(s).find((f) => f.id === "answer:hours")?.value).toBe(
      "About one hour daily",
    );
    expect(planningFacts(s).some((f) => f.id === "availability")).toBe(false);
  });
  it.each([false, true])(
    "resumes active guidance without changing work (unknown answer: %s)",
    async (unknown) => {
      let s = sprint();
      s.stage = "active";
      s.stories = [structuredClone(story)];
      const before = structuredClone({
        stories: s.stories,
        progress: s.progress,
      });
      s = await coordinate(s, cmd(s, "next_action"), {
        invoke: async () => {
          throw new NeedsClarification("daily_execution", {
            question: "What context is available now?",
            options: ["At my desk", "Away from my desk"],
            missingFields: ["context"],
            reason: "Choose a useful next action.",
          });
        },
      });
      s = await saveReply(s, unknown);
      if (unknown)
        expect(s.pendingClarification?.reply?.requestsDiscovery).toBe(false);
      s = await coordinate(s, cmd(s, "resume_clarification"), {
        invoke: async () =>
          ({
            taskId: "task-write",
            actionTitle: "Review the draft",
            minutes: 15,
            reason: "Based on your answer",
            readiness: "ready",
          }) as never,
      });
      expect(s.pendingClarification).toBeNull();
      expect(s.stories).toEqual(before.stories);
      expect(s.progress).toEqual(before.progress);
    },
  );
  it.each([
    "story_decomposer",
    "smart_goal",
    "scheduling",
    "daily_execution",
    "adaptive_backlog",
    "reflection",
  ] as Role[])("preserves a null-payload clarification from %s", (role) => {
    const result = clarificationOutcome(role, {
      status: "needs_clarification",
      missingFields: ["chapterScope"],
      clarification: {
        question: "Which scope is intended?",
        options: ["A known outline", "An outline is not known"],
      },
      warnings: [],
    });
    expect(result).toBeInstanceOf(NeedsClarification);
    expect(result?.role).toBe(role);
    expect(result?.request.question).toBe("Which scope is intended?");
    expect(result?.request.options).toHaveLength(2);
  });
  it("does not regenerate a saved unanswered question", async () => {
    const s = await savedQuestion();
    await expect(
      coordinate(s, cmd(s, "generate_stories"), noAI),
    ).rejects.toThrow("already saved");
  });
  it("keeps custom answers and the existing approval across reload", async () => {
    const s = await savedQuestion();
    const next = JSON.parse(JSON.stringify(await saveReply(s))) as Sprint;
    expect(next.pendingClarification?.reply?.value).toContain("Three sections");
    expect(next.approvals).toEqual(s.approvals);
    expect(next.goals).toEqual(s.goals);
  });
  it("requires an answer and rejects obsolete question IDs", async () => {
    const s = await savedQuestion();
    await expect(
      coordinate(s, cmd(s, "resume_clarification"), noAI),
    ).rejects.toThrow("Answer");
    await expect(
      coordinate(
        s,
        cmd(s, "answer_clarification", {
          questionId: "old",
          status: "confirmed",
          customText: "A bounded draft",
          optionId: null,
        }),
        noAI,
      ),
    ).rejects.toThrow("no longer current");
  });
  it("rejects simultaneous option/custom confirmation", async () => {
    const s = await savedQuestion();
    await expect(
      coordinate(
        s,
        cmd(s, "answer_clarification", {
          questionId: s.pendingClarification!.id,
          status: "confirmed",
          customText: "Three sections",
          optionId: "option-0",
        }),
        noAI,
      ),
    ).rejects.toThrow("or enter");
  });
  it("routes a scope answer through a newly approved goal", async () => {
    let s = await saveReply(await savedQuestion());
    const proposal = structuredClone(s.goals[0]);
    proposal.statement =
      "Produce a three-section, 2,000-word consolidated draft.";
    const ai: Intelligence = {
      invoke: async (role, _schema, data) => {
        expect(role).toBe("smart_goal");
        expect(JSON.stringify(data)).toContain("Three sections");
        return { goals: [proposal], readiness: ready } as never;
      },
    };
    s = await coordinate(s, cmd(s, "resume_clarification"), ai);
    expect(s.stage).toBe("goals");
    expect(s.approvals).toEqual([]);
    expect(s.pendingClarification).toBeNull();
    await expect(
      coordinate(s, cmd(s, "generate_stories"), noAI),
    ).rejects.toThrow("Approve");
    const c = cmd(s, "approve_goals");
    c.hash = hashes(s).goals;
    s = await coordinate(s, c, noAI);
    expect(s.stage).toBe("stories");
  });
  it("treats unknown scope as uncertainty and requires approval of discovery", async () => {
    let s = await savedQuestion();
    const oldGoals = structuredClone(s.goals);
    s = await saveReply(s, true);
    expect(s.goals).toEqual(oldGoals);
    const proposal = structuredClone(s.goals[0]);
    proposal.title = "Inventory fragments and agree an outline";
    proposal.statement =
      "Produce a source inventory and an outline with gaps identified.";
    const ai: Intelligence = {
      invoke: async (_r, _s, data) => {
        expect(
          (data as { discoveryRequested: boolean }).discoveryRequested,
        ).toBe(true);
        return {
          goals: [proposal],
          readiness: { ...ready, mode: "discovery" },
        } as never;
      },
    };
    s = await coordinate(s, cmd(s, "resume_clarification"), ai);
    expect(s.scopeReadiness?.mode).toBe("discovery");
    expect(s.approvals).toEqual([]);
    expect(s.originalIntention).toContain("complete book");
    expect(planningFacts(s).at(-1)?.status).toBe("unknown");
  });
  it("rejects a delivery promise when the user explicitly requested discovery", async () => {
    const s = await saveReply(await savedQuestion(), true);
    await expect(
      coordinate(s, cmd(s, "resume_clarification"), {
        invoke: async () => ({ goals: s.goals, readiness: ready }) as never,
      }),
    ).rejects.toThrow("request for a bounded discovery");
    expect(s.pendingClarification?.reply?.status).toBe("unknown");
  });
  it("requires specific consent before a sixth question", async () => {
    let s = approvedBook();
    s.clarificationHistory = Array.from({ length: 5 }, (_, i) => ({
      questionId: `old-${i}`,
      question: "Earlier question",
      value: "An answer",
      source: "user_custom",
      status: "confirmed",
    }));
    s = await coordinate(s, cmd(s, "generate_stories"), {
      invoke: async () => {
        throw new NeedsClarification("smart_goal", {
          question: "Which scope should be included?",
          options: [],
          missingFields: ["scope"],
          reason: "One essential scope detail remains.",
        });
      },
    });
    expect(s.pendingClarification?.consentGranted).toBe(false);
    await expect(saveReply(s)).rejects.toThrow("Confirm continuation");
    s = await coordinate(s, cmd(s, "consent_clarification"), noAI);
    s = await saveReply(s);
    expect(s.pendingClarification?.reply).not.toBeNull();
  });
  it("rejects a continuation if its bound plan changed", async () => {
    const s = await saveReply(await savedQuestion());
    s.goals[0].statement = "A different scope";
    await expect(
      coordinate(s, cmd(s, "resume_clarification"), noAI),
    ).rejects.toThrow("plan changed");
  });
  it("checks legacy goal scope before spending on decomposition", async () => {
    const s = approvedBook();
    const calls: string[] = [];
    const ai: Intelligence = {
      invoke: async (role) => {
        calls.push(role);
        return {
          ...ready,
          status: "needs_scope",
          scopeSummary: null,
          clarification: {
            question: "What extent is intended?",
            options: ["I know the scope", "I need to discover it"],
          },
        } as never;
      },
    };
    const next = await coordinate(s, cmd(s, "generate_stories"), ai);
    expect(calls).toEqual(["smart_goal"]);
    expect(next.pendingClarification?.role).toBe("smart_goal");
    expect(next.approvals).toEqual(s.approvals);
  });
  it("does not disguise provider outages as questions", async () => {
    const s = approvedBook();
    await expect(
      coordinate(s, cmd(s, "generate_stories"), {
        invoke: async () => {
          throw new AppError(
            "provider_unavailable",
            "Provider unavailable",
            503,
          );
        },
      }),
    ).rejects.toThrow("Provider unavailable");
    expect(s.pendingClarification).toBeNull();
  });
  it("does not accept an unresolved synthesis as ready", async () => {
    const s = sprint();
    const next = await coordinate(s, cmd(s, "synthesize"), {
      invoke: async () =>
        ({
          goals: s.goals,
          readiness: {
            ...ready,
            status: "needs_scope",
            scopeSummary: null,
            clarification: {
              question: "Which sections are in scope?",
              options: [],
            },
          },
        }) as never,
    });
    expect(next.pendingClarification).not.toBeNull();
    expect(next.approvals).toEqual([]);
  });
  it("confirms time explicitly and uses the shared budget and buffer", async () => {
    const s = approvedBook();
    const next = await coordinate(
      s,
      cmd(s, "confirm_availability", {
        capacityMinutes: 900,
        dailyMinutes: Array(15).fill(60),
        bufferPercent: 20,
      }),
      noAI,
    );
    expect(capacity(next).usable).toBe(720);
    expect(next.approvals).toEqual(s.approvals);
    expect(planningFacts(next).at(-1)?.id).toBe("availability");
  });
  it("does not discard reviewed work when confirming a changed budget", async () => {
    const s = approvedBook();
    s.stage = "review";
    s.stories = [structuredClone(story)];
    s.allocations = story.tasks.map((t) => ({
      taskId: t.id,
      date: s.startDate,
      minutes: t.minutes,
    }));
    s.approvals.push(
      {
        kind: "stories",
        hash: hash(approvalPayload(s, "stories")),
        revision: s.revision,
        at: new Date().toISOString(),
      },
      {
        kind: "schedule",
        hash: hash(approvalPayload(s, "schedule")),
        revision: s.revision,
        at: new Date().toISOString(),
      },
    );
    const next = await coordinate(
      s,
      cmd(s, "confirm_availability", {
        capacityMinutes: 300,
        dailyMinutes: s.dailyMinutes,
        bufferPercent: 20,
      }),
      noAI,
    );
    expect(next.stories).toEqual(s.stories);
    expect(next.allocations).toEqual(s.allocations);
    expect(next.approvals.map((a) => a.kind)).toEqual(["goals", "stories"]);
    expect(next.stage).toBe("schedule");
  });
  it("preserves unknown availability and rejects inflated budgets", async () => {
    const s = approvedBook();
    await expect(
      coordinate(
        s,
        cmd(s, "confirm_availability", {
          capacityMinutes: 901,
          dailyMinutes: Array(15).fill(60),
          bufferPercent: 20,
        }),
        noAI,
      ),
    ).rejects.toThrow("exceeds");
    const next = await coordinate(
      s,
      cmd(s, "confirm_availability", {
        capacityMinutes: null,
        dailyMinutes: Array(15).fill(60),
        bufferPercent: 20,
      }),
      noAI,
    );
    expect(next.capacityMinutes).toBeNull();
  });
  it("cannot directly replace an active budget", async () => {
    const s = approvedBook();
    s.stage = "active";
    await expect(
      coordinate(
        s,
        cmd(s, "confirm_availability", {
          capacityMinutes: 900,
          dailyMinutes: Array(15).fill(60),
          bufferPercent: 20,
        }),
        noAI,
      ),
    ).rejects.toThrow();
  });
});
