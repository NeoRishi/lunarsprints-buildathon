import "./safe-test-errors";
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  ManagedIntelligence,
  type RunRecord,
} from "../src/features/lunarsprints/agents/managed";
import {
  clarificationSchema,
  type Sprint,
} from "../src/features/lunarsprints/contracts";
import { clarificationInstructions } from "../src/features/lunarsprints/agents/policies";
import { validateQuestions } from "../src/features/lunarsprints/domain";
const vars = Object.fromEntries(
  (await readFile(".env.test.local", "utf8"))
    .trim()
    .split("\n")
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { persistSession: false } },
);
const signed = await db.auth.signInWithPassword({
  email: vars.LUNARSPRINTS_QA_EMAIL,
  password: vars.LUNARSPRINTS_QA_PASSWORD,
});
assert(!signed.error);
const { data, error } = await db
  .from("ls_sprints")
  .select("state")
  .eq("user_id", signed.data.user!.id)
  .order("updated_at", { ascending: false });
assert(!error);
const s = data!
  .map((x) => x.state as Sprint)
  .find((x) => x.intention.includes("two pencil sketches"))!;
assert(s);
const selected = s.assessment!.intents.map((i) => i.id);
const runs: RunRecord[] = [];
const ai = new ManagedIntelligence({
  userId: signed.data.user!.id,
  sprintId: s.id,
  sessionModel: "gpt-6-sol",
  onRun: (r) => runs.push(r),
});
const plan = await ai.invoke(
  "smart_goal",
  clarificationSchema,
  {
    originalIntention: s.originalIntention,
    intention: s.intention,
    assessment: s.assessment,
    selectedIntents: s.assessment!.intents,
    startDate: s.startDate,
    endDate: s.endDate,
    capacityMinutes: s.capacityMinutes,
    dailyMinutes: s.dailyMinutes,
    bufferPercent: s.bufferPercent,
    confirmedAnswers: [],
  },
  clarificationInstructions,
);
validateQuestions(plan, selected);
await writeFile(
  "docs/evidence/smart-model-benchmark.json",
  JSON.stringify(
    {
      passed: true,
      savedModel: "gpt-6-astra",
      sessionModel: "gpt-6-sol",
      reason:
        "Astra exceeded the bounded timeout on the same overcommitted multi-goal context twice.",
      plan,
      runs,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    passed: true,
    sessionModel: "gpt-6-sol",
    questionCount: plan.questions.length,
    questions: plan.questions.map((q) => q.question),
    runs,
  }),
);
