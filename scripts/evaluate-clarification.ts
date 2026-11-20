import "./safe-test-errors";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  clarificationSchema,
  intentSchema,
} from "../src/features/lunarsprints/contracts";
import { validateQuestions } from "../src/features/lunarsprints/domain";
import {
  ManagedIntelligence,
  type RunRecord,
} from "../src/features/lunarsprints/agents/managed";
import { clarificationInstructions } from "../src/features/lunarsprints/agents/policies";

const scenarios = [
  {
    name: "research_paper",
    intention:
      "I want to finish my research paper in the next 15 days. The literature review is done; methodology, discussion and editing remain.",
    forbidden: [/already completed the literature review/i],
  },
  {
    name: "portfolio_launch",
    intention:
      "Launch my personal portfolio website in this sprint. My visual design is already finished.",
    forbidden: [/is the visual design finished/i],
  },
  {
    name: "fitness_habit",
    intention:
      "Build a calm morning movement routine over the next 15 days without hurting my knees.",
    forbidden: [/30 days/i],
  },
  {
    name: "exam_prep",
    intention:
      "Prepare for my operating systems exam in 12 days. Processes and threads are done; memory, file systems and two practice papers remain.",
    forbidden: [/are processes and threads done/i],
  },
  {
    name: "mixed_goals",
    intention:
      "Ship the client billing bugfix, clean up my study notes, and start a 20-minute evening walk.",
    forbidden: [],
  },
  {
    name: "constrained_availability",
    intention:
      "Write and record a 3-part onboarding video series for new customers, though I only have 30 minutes on weekday evenings.",
    forbidden: [/how many minutes on weekday evenings/i],
  },
  {
    name: "dependency_heavy_release",
    intention:
      "Migrate our staging database schema, run integration verification, and cut the v2.1 release notes in this 15-day sprint.",
    forbidden: [],
  },
  {
    name: "overambitious_scope",
    intention:
      "Build a full iOS app, Android app, marketing website, and 10 blog posts from scratch in 15 days working solo.",
    forbidden: [],
  },
];

type Result = {
  name: string;
  passed: boolean;
  intentCount?: number;
  questionCount?: number;
  categories?: string[];
  runs: RunRecord[];
  error?: string;
};
const results: Result[] = [];
if (process.env.LUNARSPRINTS_EVAL_RESUME === "1") {
  try {
    const prior = JSON.parse(
      await readFile("docs/evidence/clarification-eval.json", "utf8"),
    );
    results.push(...prior.results.filter((r: Result) => r.passed));
  } catch {
    /* No checkpoint exists. */
  }
}
async function checkpoint() {
  await writeFile(
    "docs/evidence/clarification-eval.json",
    JSON.stringify(
      {
        passed:
          results.length === scenarios.length && results.every((r) => r.passed),
        verifiedAt: new Date().toISOString(),
        expectedScenarios: scenarios.length,
        scope:
          "Structural contracts, intent ownership, zero-to-five question bounds and specified redundant-question checks; not a comprehensive human quality review.",
        results,
      },
      null,
      2,
    ),
  );
}
for (const scenario of scenarios) {
  if (results.some((r) => r.name === scenario.name && r.passed)) continue;
  const runs: RunRecord[] = [];
  const ai = new ManagedIntelligence({
    userId: "eval",
    sprintId: "00000000-0000-4000-8000-000000000001",
    onRun: (r) => runs.push(r),
  });
  try {
    const assessment = await ai.invoke(
      "intent_alignment",
      intentSchema,
      {
        intention: scenario.intention,
        startDate: "2026-10-28",
        endDate: "2026-11-11",
      },
      "Extract distinct intentions and user-stated facts only.",
    );
    const selectedIds = assessment.intents.map((i) => i.id);
    const plan = await ai.invoke(
      "smart_goal",
      clarificationSchema,
      {
        originalIntention: scenario.intention,
        intention: scenario.intention,
        assessment,
        selectedIntents: assessment.intents,
        startDate: "2026-10-28",
        endDate: "2026-11-11",
        timezone: "Asia/Kolkata",
        capacityMinutes: 600,
        dailyMinutes: Array(15).fill(60),
        bufferPercent: 20,
        confirmedAnswers: [],
        skippedQuestionIds: [],
      },
      clarificationInstructions,
    );
    validateQuestions(plan, selectedIds);
    for (const pattern of scenario.forbidden)
      assert(
        !plan.questions.some((q) => pattern.test(q.question)),
        `Redundant question in ${scenario.name}`,
      );
    results.push({
      name: scenario.name,
      passed: true,
      runs,
      intentCount: assessment.intents.length,
      questionCount: plan.questions.length,
      categories: plan.questions.map((q) => q.category),
    });
    console.log(
      `${scenario.name}: passed (${plan.questions.length} questions)`,
    );
  } catch (error) {
    results.push({
      name: scenario.name,
      passed: false,
      runs,
      error: error instanceof Error ? error.name : "unknown",
    });
    console.log(
      `${scenario.name}: failed (${runs.at(-1)?.errorCode ?? "validation"})`,
    );
  }
  await checkpoint();
}
assert(
  results.length === scenarios.length && results.every((r) => r.passed),
  "One or more clarification scenarios failed; see the checkpoint receipt.",
);
console.log("Clarification evaluation passed:", results.length, "scenarios");
