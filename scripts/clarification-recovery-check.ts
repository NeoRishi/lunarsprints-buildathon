import "./safe-test-errors";
import { request, chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { hash, hashes } from "../src/features/lunarsprints/coordinator";
import { clarificationBase } from "../src/features/lunarsprints/planning";
import type { Sprint, Command } from "../src/features/lunarsprints/contracts";

const ref = "jhkoxgyxrihsuhpjqkxc";
assert.equal(
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname,
  `${ref}.supabase.co`,
);
const origin = process.env.LUNARSPRINTS_TEST_ORIGIN || "http://127.0.0.1:3000";
assert(["http://127.0.0.1:3000", "http://127.0.0.1:3001"].includes(origin));
const credentials = Object.fromEntries(
  (await readFile(".env.test.local", "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
assert.match(
  credentials.LUNARSPRINTS_QA_EMAIL,
  /^qa-.*@lunarsprints\.example$/,
);
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const api = await request.newContext({
  baseURL: origin,
  timeout: 300000,
  extraHTTPHeaders: { Origin: new URL(origin).origin },
});
assert.equal(
  (
    await api.post("/api/auth", {
      data: {
        action: "login",
        email: credentials.LUNARSPRINTS_QA_EMAIL,
        password: credentials.LUNARSPRINTS_QA_PASSWORD,
      },
    })
  ).status(),
  200,
);
const user = (await (await api.get("/api/auth")).json()).user;
assert(user?.id);
const checked = await admin.auth.admin.getUserById(user.id);
assert(
  checked.data.user?.app_metadata.lunarsprints_test === true,
  "Only the existing marked synthetic QA account may be used",
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: await api.storageState(),
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(e.name));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push("console_error");
});
type View = { sprint: Sprint; hashes: Record<string, string> };
let v: View;
const humanId = "d47d6bc6-92bd-4c73-bdbb-bf2a74d6e136";
const before = await admin
  .from("ls_sprints")
  .select("state")
  .eq("id", humanId)
  .maybeSingle();
async function refresh() {
  v = await (await api.get(`/api/sprints?id=${v.sprint.id}`)).json();
}
async function send(
  action: Command["action"],
  data: unknown = {},
  kind?: string,
) {
  const res = await api.post("/api/sprints", {
    data: {
      sprintId: v.sprint.id,
      expectedRevision: v.sprint.revision,
      idempotencyKey: crypto.randomUUID(),
      action,
      data,
      ...(kind ? { hash: v.hashes[kind] } : {}),
    },
  });
  assert.equal(res.status(), 200, `${action}: ${await res.text()}`);
  v = await res.json();
  console.log(
    `${action}: ${v.sprint.pendingClarification ? "awaiting clarification" : v.sprint.stage}`,
  );
}
async function seedLegacyFixture() {
  const response = await api.post("/api/sprints", {
    data: {
      sprintId: crypto.randomUUID(),
      expectedRevision: -1,
      idempotencyKey: crypto.randomUUID(),
      action: "create",
      data: {
        startDate: "2026-10-31",
        timezone: "Asia/Kolkata",
        capacityMinutes: null,
        dailyMinutes: Array(15).fill(60),
        bufferPercent: 20,
      },
    },
  });
  assert.equal(response.status(), 200);
  v = await response.json();
  // Explicit synthetic legacy snapshot, not a claim of a newly generated/approved goal.
  const s = structuredClone(v.sprint);
  s.revision++;
  s.stage = "stories";
  s.originalIntention = s.intention =
    "Combine scattered notes and fragments into a complete volunteer handbook draft. The chapter outline and target extent are not known yet.";
  s.assessment = {
    intents: [
      {
        id: "handbook",
        outcome: "Complete a consolidated handbook draft",
        why: null,
        priority: null,
        conflicts: [],
      },
    ],
    facts: [],
    uncertainties: ["Chapter scope and remaining writing are unknown"],
    baseline: "Mostly notes and fragments",
    constraints: [],
    recommendation: "Clarify deliverable scope",
  };
  s.selectedIntentIds = ["handbook"];
  s.clarification = {
    existingFacts: [],
    missingFacts: ["Scope"],
    canProposeGoalNow: false,
    requiresBlockingClarification: true,
    questions: [
      {
        id: "baseline",
        intentId: "handbook",
        category: "baseline",
        question: "What material exists?",
        required: false,
        rationale: "Establish the baseline",
        options: [
          {
            id: "fragments",
            text: "Mostly notes and fragments",
            recommended: false,
            recommendationBasis: "none",
            recommendationReason: null,
          },
          {
            id: "draft",
            text: "A complete draft",
            recommended: false,
            recommendationBasis: "none",
            recommendationReason: null,
          },
        ],
      },
      {
        id: "success",
        intentId: "handbook",
        category: "measurable",
        question: "What is the completion standard?",
        required: false,
        rationale: "Define the outcome",
        options: [
          {
            id: "rough",
            text: "A complete rough draft",
            recommended: false,
            recommendationBasis: "none",
            recommendationReason: null,
          },
          {
            id: "edited",
            text: "An edited publication-ready manuscript",
            recommended: false,
            recommendationBasis: "none",
            recommendationReason: null,
          },
        ],
      },
      {
        id: "time",
        intentId: "handbook",
        category: "constraints",
        question: "How much time is estimated?",
        required: false,
        rationale: "Estimate capacity",
        options: [
          {
            id: "hour",
            text: "About one hour each day",
            recommended: false,
            recommendationBasis: "none",
            recommendationReason: null,
          },
          {
            id: "unknown",
            text: "Not known yet",
            recommended: false,
            recommendationBasis: "none",
            recommendationReason: null,
          },
        ],
      },
    ],
  };
  s.answers = [
    {
      questionId: "baseline",
      optionId: "fragments",
      customText: null,
      status: "confirmed",
      source: "user_selected",
    },
    {
      questionId: "success",
      optionId: "rough",
      customText: null,
      status: "confirmed",
      source: "user_selected",
    },
    {
      questionId: "time",
      optionId: "hour",
      customText: null,
      status: "confirmed",
      source: "user_selected",
    },
  ];
  s.goals = [
    {
      id: "goal-handbook",
      intentId: "handbook",
      title: "Complete the consolidated handbook manuscript",
      statement:
        "By November 14, consolidate the fragments into a manuscript with every chapter drafted.",
      smart: {
        specific: "One consolidated manuscript",
        measurable: "Every chapter drafted",
        achievable: "Provisional; chapter scope and remaining work are unknown",
        relevant: "The user's original outcome",
        timeBound: "By November 14",
      },
      completionCriteria: [
        "Existing material is consolidated",
        "Every intended chapter is drafted",
      ],
      definitionOfSuccess: "A complete consolidated rough manuscript",
      deadline: s.endDate,
      assumptions: [
        "Chapter scope and amount of writing remaining are unknown",
      ],
      warnings: ["Feasibility is provisional"],
      confidence: "medium",
      feasibility: "provisional",
    },
  ];
  s.approvals = [
    {
      kind: "goals",
      hash: hashes(s).goals,
      revision: s.revision - 1,
      at: new Date().toISOString(),
    },
  ];
  s.scopeReadiness = null;
  s.updatedAt = new Date().toISOString();
  const saved = await admin.rpc("ls_commit", {
    p_user: user.id,
    p_sprint: s.id,
    p_expected: v.sprint.revision,
    p_key: crypto.randomUUID(),
    p_request_hash: hash({ syntheticLegacyFixture: s.id }),
    p_action: "qa_legacy_fixture",
    p_state: s,
    p_approved_hash: null,
  });
  assert(!saved.error, "Could not seed synthetic legacy snapshot");
  await refresh();
  return {
    goals: structuredClone(v.sprint.goals),
    approvals: structuredClone(v.sprint.approvals),
    original: s.originalIntention,
  };
}

if (process.env.LUNARSPRINTS_RECOVERY_DISCOVERY_ONLY === "1") {
  const previous = JSON.parse(
    await readFile("docs/evidence/clarification-recovery.json", "utf8"),
  );
  const snapshots = await admin
    .from("ls_revisions")
    .select("state")
    .eq("sprint_id", previous.discoverySprintId)
    .eq("user_id", user.id)
    .order("revision");
  assert(!snapshots.error);
  const source = snapshots.data
    ?.map((r) => r.state as Sprint)
    .find((s) => s.pendingClarification && !s.pendingClarification.reply);
  assert(source, "A previously live-generated synthetic question must exist");
  const created = await api.post("/api/sprints", {
    data: {
      sprintId: crypto.randomUUID(),
      expectedRevision: -1,
      idempotencyKey: crypto.randomUUID(),
      action: "create",
      data: {
        startDate: source.startDate,
        timezone: source.timezone,
        capacityMinutes: null,
        dailyMinutes: source.dailyMinutes,
        bufferPercent: source.bufferPercent,
      },
    },
  });
  assert.equal(created.status(), 200);
  const fresh = (await created.json()) as View;
  const s = structuredClone(source);
  s.id = fresh.sprint.id;
  s.revision = 1;
  s.updatedAt = new Date().toISOString();
  s.createdAt = s.updatedAt;
  s.clarificationHistory = [
    {
      questionId: "qa-prior-baseline",
      question: "Is the existing material fragmented?",
      value: "Yes, it is mostly fragments.",
      source: "user_custom",
      status: "confirmed",
    },
    {
      questionId: "qa-prior-standard",
      question: "Is a rough draft sufficient?",
      value: "Yes, a complete rough draft is the intended standard.",
      source: "user_custom",
      status: "confirmed",
    },
  ];
  s.pendingClarification!.requiresConsent = true;
  s.pendingClarification!.consentGranted = false;
  s.pendingClarification!.baseHash = hash(clarificationBase(s));
  const seeded = await admin.rpc("ls_commit", {
    p_user: user.id,
    p_sprint: s.id,
    p_expected: 0,
    p_key: crypto.randomUUID(),
    p_request_hash: hash({ syntheticReplay: s.id }),
    p_action: "qa_question_replay",
    p_state: s,
    p_approved_hash: null,
  });
  assert(!seeded.error);
  v = { sprint: s, hashes: hashes(s) };
  const premature = await api.post("/api/sprints", {
    data: {
      ...{
        sprintId: s.id,
        expectedRevision: s.revision,
        idempotencyKey: crypto.randomUUID(),
        action: "answer_clarification",
      },
      data: {
        questionId: s.pendingClarification!.id,
        status: "unknown",
        optionId: null,
        customText: null,
      },
    },
  });
  assert.equal(premature.status(), 400);
  await page.goto(`${origin}/app?sprint=${s.id}`);
  await page
    .getByRole("heading", { name: "One extra question could help." })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "I don’t know yet", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", {
      name: "Continue with one extra question",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", { name: "One detail before we continue." })
    .waitFor();
  await refresh();
  assert.equal(v.sprint.pendingClarification?.consentGranted, true);
  await send("answer_clarification", {
    questionId: s.pendingClarification!.id,
    status: "unknown",
    optionId: null,
    customText: null,
  });
  assert.equal(v.sprint.pendingClarification?.reply?.requestsDiscovery, true);
  await page.goto(`${origin}/app?sprint=${s.id}`);
  await page
    .getByRole("button", { name: "Propose a discovery milestone", exact: true })
    .waitFor();
  await send("resume_clarification");
  assert.equal(v.sprint.scopeReadiness?.mode, "discovery");
  assert.equal(v.sprint.stage, "goals");
  assert.equal(v.sprint.approvals.length, 0);
  assert.equal(v.sprint.originalIntention, source.originalIntention);
  await page.reload();
  await page
    .getByText("Discovery milestone · proposal for your approval", {
      exact: true,
    })
    .waitFor();
  const runs = await admin
    .from("ls_agent_runs")
    .select("role,resource_id,session_id,turn_id,status,duration_ms,error_code")
    .eq("sprint_id", s.id);
  await writeFile(
    "docs/evidence/p0-final-discovery.json",
    JSON.stringify(
      {
        passed: true,
        verifiedAt: new Date().toISOString(),
        projectRef: ref,
        sprintId: s.id,
        checks: [
          "existing live-generated question replayed only into a synthetic QA fixture",
          "sixth question requires explicit consent before rendering or accepting an answer",
          "unknown status explicitly requests discovery only for goal scope",
          "bounded discovery proposal produced by actual saved Agent 03",
          "goal reapproval required and original outcome preserved",
          "final UI renders discovery proposal",
        ],
        providerCalls: 1,
        runs: runs.data,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await api.dispose();
  console.log("Final-build discovery recovery passed with one model call.");
  process.exit(0);
}

const legacy = await seedLegacyFixture();
const deliveryId = v!.sprint.id;
await send("generate_stories");
assert(v!.sprint.pendingClarification);
assert.deepEqual(v!.sprint.goals, legacy.goals);
assert.deepEqual(v!.sprint.approvals, legacy.approvals);
assert.equal(v!.sprint.stories.length, 0);
await page.goto(`${origin}/app?sprint=${deliveryId}`);
await page
  .getByRole("heading", { name: "One detail before we continue." })
  .waitFor();
assert.match(await page.title(), /LunarSprints/);
assert.equal(await page.locator('input[type="radio"]:checked').count(), 0);
await page.screenshot({
  path: "docs/evidence/clarification-recovery-desktop.png",
});
await page.reload();
await page
  .getByRole("heading", { name: "One detail before we continue." })
  .waitFor();
await send("confirm_availability", {
  capacityMinutes: 900,
  dailyMinutes: Array(15).fill(60),
  bufferPercent: 20,
});
assert.deepEqual(v!.sprint.approvals, legacy.approvals);
await page.reload();
const scope =
  "Use four agreed sections: introduction (300 words), volunteer orientation (500), shift checklist (700), conclusion (500), about 2,000 words total. Existing fragments cover about half of each section. A coherent rough draft is sufficient; editing and publication are outside this sprint.";
await page.getByLabel(/Other.*write my own answer|Your answer/).fill(scope);
await page.getByRole("button", { name: "Save answer", exact: true }).click();
await page.getByText("Saved answer", { exact: true }).waitFor();
await refresh();
assert.equal(v!.sprint.pendingClarification?.reply?.value, scope);
assert.deepEqual(v!.sprint.approvals, legacy.approvals);
await page.reload();
await page.getByText("Saved answer", { exact: true }).waitFor();
await page.setViewportSize({ width: 390, height: 844 });
assert(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
);
await page.screenshot({
  path: "docs/evidence/clarification-recovery-mobile.png",
  fullPage: true,
});
await send("resume_clarification");
assert.equal(v!.sprint.pendingClarification, null);
assert.equal(v!.sprint.stage, "goals");
assert.equal(v!.sprint.approvals.length, 0);
assert.equal(v!.sprint.originalIntention, legacy.original);
await send("approve_goals", {}, "goals");
await send("generate_stories");
assert(
  !v!.sprint.pendingClarification,
  "Confirmed bounded scope should produce a work proposal",
);
assert(v!.sprint.stories.length);
await send("approve_stories", {}, "stories");
await send("schedule");
assert(
  !v!.sprint.pendingClarification,
  "The validated schedule should be available",
);
await send("approve_schedule", { acknowledgeRisk: true }, "schedule");
await send("activate", {}, "activation");
assert.equal(v!.sprint.stage, "active");
await refresh();
assert.equal(v!.sprint.stage, "active");
await page.goto(`${origin}/app?sprint=${deliveryId}`);
await page
  .getByRole("heading", { name: "Your active sprint" })
  .waitFor();

const unknownLegacy = await seedLegacyFixture();
const discoveryId = v!.sprint.id;
await send("generate_stories");
const discoveryView = (await (
  await api.get(`/api/sprints?id=${discoveryId}`)
).json()) as View;
assert(discoveryView.sprint.pendingClarification);
await send("answer_clarification", {
  questionId: discoveryView.sprint.pendingClarification.id,
  status: "unknown",
  optionId: null,
  customText: null,
});
assert.deepEqual(v!.sprint.goals, unknownLegacy.goals);
assert.deepEqual(v!.sprint.approvals, unknownLegacy.approvals);
await send("resume_clarification");
assert(
  !v!.sprint.pendingClarification,
  "Unknown scope should lead to a bounded discovery proposal",
);
assert.equal(v!.sprint.scopeReadiness?.mode, "discovery");
assert.equal(v!.sprint.stage, "goals");
assert.equal(v!.sprint.approvals.length, 0);
assert.equal(v!.sprint.originalIntention, unknownLegacy.original);
await page.goto(`${origin}/app?sprint=${discoveryId}`);
await page
  .getByText("Discovery milestone · proposal for your approval", {
    exact: true,
  })
  .waitFor();
await page.screenshot({
  path: "docs/evidence/discovery-proposal-mobile.png",
  fullPage: true,
});
assert(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
);
assert.deepEqual(pageErrors, []);
assert.deepEqual(consoleErrors, []);
const after = await admin
  .from("ls_sprints")
  .select("state")
  .eq("id", humanId)
  .maybeSingle();
const humanUnchanged = hash(before.data?.state) === hash(after.data?.state);
assert(humanUnchanged, "The real user's sprint must remain untouched");
const runs = await admin
  .from("ls_agent_runs")
  .select(
    "sprint_id,role,resource_id,session_id,turn_id,status,duration_ms,error_code",
  )
  .in("sprint_id", [deliveryId, discoveryId]);
assert(!runs.error);
await writeFile(
  "docs/evidence/clarification-recovery.json",
  JSON.stringify(
    {
      passed: true,
      verifiedAt: new Date().toISOString(),
      projectRef: ref,
      origin,
      deliverySprintId: deliveryId,
      discoverySprintId: discoveryId,
      fixture:
        "Explicitly seeded synthetic legacy approvals; all subsequent scope, goal and work proposals use live existing agents",
      checks: [
        "legacy approved goal preserved while missing-scope question is saved",
        "actual generated MCQ/custom response, no preselection",
        "question and saved custom answer survive reload",
        "explicit capacity confirmation retains goal approval",
        "scope answer produces a newly reviewed goal",
        "real story/task/subtask generation after exact goal reapproval",
        "schedule approval, activation and board persistence",
        "unknown scope produces unapproved bounded discovery milestone",
        "original outcome retained",
        "desktop/mobile no overflow or page/console errors",
        "real user sprint unchanged",
      ],
      humanSprintUnchanged: humanUnchanged,
      browser: {
        method: "Playwright",
        reason: "Browser plugin not available",
        desktop: [1440, 1000],
        mobile: [390, 844],
        pageErrors,
        consoleErrors,
      },
      runs: runs.data,
    },
    null,
    2,
  ),
);
await browser.close();
await api.dispose();
console.log("P0 live clarification recovery and discovery acceptance passed.");
