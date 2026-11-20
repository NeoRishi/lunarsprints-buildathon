import "./safe-test-errors";
import { z } from "zod";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import {
  ManagedIntelligence,
  type RunRecord,
} from "../src/features/lunarsprints/agents/managed";
import {
  storiesSchema,
  type Goal,
} from "../src/features/lunarsprints/contracts";
import { storyInstructions } from "../src/features/lunarsprints/agents/policies";
import { validateStories } from "../src/features/lunarsprints/domain";
import { planningFacts } from "../src/features/lunarsprints/planning";
import { sprint, goal } from "../tests/fixtures";
const results: unknown[] = [];
const handbook: Goal = {
  ...structuredClone(goal),
  id: "handbook-goal",
  intentId: "handbook",
  title: "Draft two handbook sections",
  statement:
    "Turn existing notes into a first draft of Welcome and Safety (about 400 words each), reviewed for gaps by Nov 11.",
  smart: {
    specific: "First drafts of Welcome and Safety, using existing notes",
    measurable: "Two approximately 400-word sections and a gap list",
    achievable: "Pending effort review",
    relevant: "Organize volunteer onboarding notes",
    timeBound: "By Nov 11",
  },
  completionCriteria: [
    "Welcome and Safety each have an approximately 400-word first draft using the existing notes",
    "Both sections are read for gaps and a gap list is saved",
  ],
  definitionOfSuccess: "Two first-draft sections and a recorded gap list",
};
for (const scenario of ["handbook", "competing-goals"]) {
  const s = sprint();
  s.id = crypto.randomUUID();
  s.intention = s.originalIntention =
    scenario === "handbook"
      ? "I have notes for Welcome and Safety. Draft these two volunteer handbook sections, about 400 words each, and review gaps. I have 10 hours over 15 days."
      : "Publish my existing portfolio home page and one case study, check both on phone and laptop, and also finish two 20-minute pencil sketches. Portfolio is first priority. I have 10 hours over 15 days.";
  s.goals =
    scenario === "handbook"
      ? [handbook]
      : [
          structuredClone(goal),
          {
            ...structuredClone(goal),
            id: "sketch-goal",
            intentId: "sketch",
            title: "Make two pencil sketches",
            statement:
              "Make two 20-minute pencil sketches from household objects and save photographs by Nov 11.",
            completionCriteria: [
              "Two 20-minute sketches from household objects have photographs saved",
            ],
            definitionOfSuccess: "Two sketch photos saved",
            smart: {
              specific: "Two pencil sketches from household objects",
              measurable: "Two photographs saved",
              achievable: "Pending effort review",
              relevant: "Make time for drawing",
              timeBound: "By Nov 11",
            },
          },
        ];
  s.assessment = {
    ...s.assessment!,
    intents: s.goals.map((g, i) => ({
      id: g.intentId,
      outcome: g.statement,
      why: null,
      priority: i + 1,
      conflicts: [],
    })),
  };
  s.selectedIntentIds = s.goals.map((g) => g.intentId);
  const shared = {
    selectedIntents: s.assessment.intents,
    startDate: s.startDate,
    endDate: s.endDate,
    timezone: s.timezone,
    capacityMinutes: s.capacityMinutes,
    dailyMinutes: s.dailyMinutes,
    bufferPercent: s.bufferPercent,
    approvedGoals: s.goals,
    confirmedFacts: planningFacts(s),
  };
  for (const profile of ["baseline", "candidate"] as const) {
    const runs: RunRecord[] = [];
    const ai = new ManagedIntelligence({
      userId: "synthetic-benchmark",
      sprintId: s.id,
      contract: profile === "baseline" ? "full" : "compact",
      sessionModel: profile === "baseline" ? "gpt-6-astra" : "gpt-6.1-sol",
      onRun: (r) => runs.push(r),
    });
    const input: unknown =
      profile === "baseline"
        ? {
            ...shared,
            originalIntention: s.originalIntention,
            intention: s.intention,
            assessment: s.assessment,
            questions: [],
            confirmedAnswers: [],
            skippedQuestionIds: [],
          }
        : shared;
    try {
      const proposal: z.infer<typeof storiesSchema> = await ai.invoke(
        "story_decomposer",
        storiesSchema,
        input,
        storyInstructions,
      );
      validateStories(s, proposal.stories);
      assert.equal(proposal.uncoveredCriteria.length, 0);
      results.push({
        scenario,
        profile,
        passed: true,
        storyCount: proposal.stories.length,
        taskCount: proposal.stories.reduce((n, x) => n + x.tasks.length, 0),
        proposal,
        runs,
      });
      console.log(JSON.stringify({ scenario, profile, passed: true, runs }));
    } catch (e) {
      results.push({
        scenario,
        profile,
        passed: false,
        error: e instanceof Error ? e.name : "unknown",
        runs,
      });
      console.log(JSON.stringify({ scenario, profile, passed: false, runs }));
    }
    await writeFile(
      "docs/evidence/planning-benchmark.json",
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          projectId: "proj_vI5AtNhbZISblXntDQZHNhZ1",
          remoteDefinitionsUnmodified: true,
          method:
            "Two matched synthetic workloads; baseline Astra/full frame vs candidate 6.1 Sol/compact frame. Low reasoning, standard service. Small sample, not a p95 or cost guarantee.",
          results,
        },
        null,
        2,
      ),
    );
  }
}

assert.equal(results.length, 4);
assert(
  results.every((r) => (r as { passed: boolean }).passed),
  "One or more planning benchmark cases failed; inspect the saved receipt.",
);
