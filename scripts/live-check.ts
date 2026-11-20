import "./safe-test-errors";
import {
  ManagedIntelligence,
  type RunRecord,
} from "../src/features/lunarsprints/agents/managed";
import { clarificationSchema } from "../src/features/lunarsprints/contracts";
import { clarificationInstructions } from "../src/features/lunarsprints/agents/policies";
import { validateQuestions } from "../src/features/lunarsprints/domain";
import { writeFile, mkdir } from "node:fs/promises";
const runs: RunRecord[] = [];
const ai = new ManagedIntelligence({
  userId: "synthetic-evaluation",
  sprintId: crypto.randomUUID(),
  onRun: (r) => runs.push(r),
});
const plan = await ai.invoke(
  "smart_goal",
  clarificationSchema,
  {
    originalIntention: "I want to finally launch my portfolio.",
    selectedIntents: [{ id: "portfolio", outcome: "Launch my portfolio" }],
    startDate: "2026-10-28",
    endDate: "2026-11-11",
    capacityMinutes: 600,
    confirmedAnswers: [],
  },
  clarificationInstructions,
);
validateQuestions(plan, ["portfolio"]);
await mkdir("docs/evidence", { recursive: true });
await writeFile(
  "docs/evidence/real-agent-03.json",
  JSON.stringify({ plan, runs }, null, 2),
);
console.log(
  JSON.stringify(
    { passed: true, questions: plan.questions.map((q) => q.question), runs },
    null,
    2,
  ),
);
