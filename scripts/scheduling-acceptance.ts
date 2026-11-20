import "./safe-test-errors";
import { request, chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Command, Sprint } from "../src/features/lunarsprints/contracts";
import { hash, hashes } from "../src/features/lunarsprints/coordinator";
const ref = "jhkoxgyxrihsuhpjqkxc";
assert.equal(
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname,
  `${ref}.supabase.co`,
);
const origin = process.env.LUNARSPRINTS_TEST_ORIGIN || "http://127.0.0.1:3001";
assert(["http://127.0.0.1:3000", "http://127.0.0.1:3001"].includes(origin));
const vars = Object.fromEntries(
  (await readFile(".env.test.local", "utf8"))
    .trim()
    .split("\n")
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
assert.match(vars.LUNARSPRINTS_QA_EMAIL, /^qa-.*@lunarsprints\.example$/);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const api = await request.newContext({
  baseURL: origin,
  timeout: 240000,
  extraHTTPHeaders: { Origin: new URL(origin).origin },
});
assert.equal(
  (
    await api.post("/api/auth", {
      data: {
        action: "login",
        email: vars.LUNARSPRINTS_QA_EMAIL,
        password: vars.LUNARSPRINTS_QA_PASSWORD,
      },
    })
  ).status(),
  200,
);
const user = (await (await api.get("/api/auth")).json()).user;
assert(
  (await db.auth.admin.getUserById(user.id)).data.user?.app_metadata
    .lunarsprints_test === true,
);
const humanId = "d47d6bc6-92bd-4c73-bdbb-bf2a74d6e136";
const before = await db
  .from("ls_sprints")
  .select("state")
  .eq("id", humanId)
  .single();
assert(!before.error);
import { sprint, story, goal } from "../tests/fixtures";
type View = { sprint: Sprint; hashes: Record<string, string> };
let v: View;
const checks: string[] = [];
async function refresh() {
  v = await (await api.get(`/api/sprints?id=${v.sprint.id}`)).json();
}
async function send(
  action: Command["action"],
  data: unknown = {},
  kind?: string,
) {
  const response = await api.post("/api/sprints", {
    data: {
      sprintId: v.sprint.id,
      expectedRevision: v.sprint.revision,
      idempotencyKey: crypto.randomUUID(),
      action,
      data,
      ...(kind ? { hash: v.hashes[kind] } : {}),
    },
  });
  assert.equal(response.status(), 200, `${action}: ${await response.text()}`);
  v = await response.json();
  console.log(
    `${action}: ${v.sprint.stage}; conflict=${Boolean(v.sprint.scheduleConflict)}`,
  );
}
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
      dailyMinutes: Array(15).fill(0),
      bufferPercent: 20,
    },
  },
});
assert.equal(response.status(), 200);
v = await response.json();
async function seed(state: Sprint, action: string) {
  state.revision = v.sprint.revision + 1;
  const result = await db.rpc("ls_commit", {
    p_user: user.id,
    p_sprint: v.sprint.id,
    p_expected: v.sprint.revision,
    p_key: crypto.randomUUID(),
    p_request_hash: hash({
      fixture: action,
      id: state.id,
      revision: state.revision,
    }),
    p_action: action,
    p_state: state,
    p_approved_hash: null,
  });
  assert(!result.error, "Could not save marked QA fixture");
  await refresh();
}
const fixture = {
  ...sprint(),
  ...v.sprint,
  stage: "schedule" as const,
  intention:
    "Synthetic QA: publish the existing portfolio home page and one case study, and check both at phone and laptop sizes by the first sprint day.",
  originalIntention:
    "Synthetic QA: two existing public pages need a final publication and responsive check.",
  goals: [
    {
      ...structuredClone(goal),
      deadline: v.sprint.startDate,
      statement:
        "Publish the existing home page and one case study; check phone and laptop layouts by " +
        v.sprint.startDate,
      smart: { ...goal.smart, timeBound: "By " + v.sprint.startDate },
    },
  ],
  stories: [structuredClone(story)],
};
fixture.selectedIntentIds = ["portfolio"];
fixture.assessment = sprint().assessment;
fixture.approvals = (["goals", "stories"] as const).map((kind) => ({
  kind,
  hash: hashes(fixture)[kind],
  revision: 0,
  at: new Date().toISOString(),
}));
await seed(fixture, "qa_p2_reviewed_fixture");
const reviewed = {
  goals: hash(v.sprint.goals),
  stories: hash(v.sprint.stories),
  approvals: hash(v.sprint.approvals),
};
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  storageState: await api.storageState(),
  viewport: { width: 1440, height: 1000 },
});
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.name));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console_error");
});
await page.goto(`${origin}/app?sprint=${v.sprint.id}`);
await page
  .getByRole("button", { name: "Suggest a schedule", exact: true })
  .click();
await page
  .getByText("This work needs a scheduling adjustment.", { exact: true })
  .waitFor();
await refresh();
assert(v.sprint.scheduleConflict);
assert.equal(v.sprint.allocations.length, 0);
assert.equal(hash(v.sprint.goals), reviewed.goals);
assert.equal(hash(v.sprint.stories), reviewed.stories);
assert.equal(hash(v.sprint.approvals), reviewed.approvals);
await page.reload();
await page
  .getByText("This work needs a scheduling adjustment.", { exact: true })
  .waitFor();
await page.screenshot({
  path: "docs/evidence/p2-schedule-conflict-desktop.png",
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 844 });
assert(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
);
await page.screenshot({
  path: "docs/evidence/p2-schedule-conflict-mobile.png",
  fullPage: true,
});
checks.push(
  "all-rest-day conflict is saved and survives reload; reviewed goals, work and approvals retained; desktop/mobile recovery visible",
);
await page
  .getByLabel("Available hours for the sprint", { exact: true })
  .fill("2");
await page.getByText("Adjust daily effort budgets", { exact: true }).click();
await page.locator(".availability-grid input").first().fill("120");
await page
  .getByRole("button", { name: "Save availability & retry", exact: true })
  .click();
await page
  .getByRole("button", { name: "Approve schedule & review", exact: true })
  .waitFor();
await refresh();
assert.equal(v.sprint.scheduleConflict, null);
assert(v.sprint.allocations.every((a) => a.date === v.sprint.startDate));
checks.push(
  "UI availability correction creates a deadline-compliant schedule without AI",
);
const unchanged = hash(v.sprint);
const forgedDeadline = await api.post("/api/sprints", {
  data: {
    sprintId: v.sprint.id,
    expectedRevision: v.sprint.revision,
    idempotencyKey: crypto.randomUUID(),
    action: "edit_schedule",
    data: {
      allocations: v.sprint.allocations.map((a) => ({
        ...a,
        date: v.sprint.endDate,
      })),
      capacityMinutes: v.sprint.capacityMinutes,
      dailyMinutes: v.sprint.dailyMinutes,
      bufferPercent: v.sprint.bufferPercent,
    },
  },
});
assert.equal(forgedDeadline.status(), 422);
await refresh();
assert.equal(hash(v.sprint), unchanged);
checks.push(
  "HTTP rejects in-sprint dates after goal deadline and preserves saved revision",
);
// Explicitly synthetic pre-existing advice fixture verifies editing after advice, without a paid commentary call.
const explained = structuredClone(v.sprint);
explained.scheduleAdvice = {
  status: "ready",
  notes: [
    "Synthetic UI fixture: the existing explanation must not disable edits.",
  ],
  forHash: "qa-fixture",
};
await seed(explained, "qa_p2_advice_fixture");
await page.reload();
await page.getByLabel("Buffer %", { exact: true }).fill("25");
const save = page.getByRole("button", {
  name: "Save my changes",
  exact: true,
});
assert(await save.isEnabled());
await save.click();
await page
  .getByRole("button", { name: "Approve schedule & review", exact: true })
  .waitFor();
await refresh();
assert.equal(v.sprint.scheduleAdvice, null);
assert.equal(v.sprint.bufferPercent, 25);
checks.push(
  "schedule can be edited after successful advice; saving invalidates the old explanation",
);
const forged = await api.post("/api/sprints", {
  data: {
    sprintId: v.sprint.id,
    expectedRevision: v.sprint.revision,
    idempotencyKey: crypto.randomUUID(),
    action: "approve_schedule",
    hash: "forged",
    data: { acknowledgeRisk: true },
  },
});
assert.equal(forged.status(), 409);
await send("approve_schedule", { acknowledgeRisk: false }, "schedule");
await send("activate", {}, "activation");
const task = v.sprint.stories[0].tasks[0];
await send("progress", {
  taskId: task.id,
  status: "done",
  percent: 100,
  dodConfirmed: true,
  completedSubtaskIds: task.subtasks.map((s) => s.id),
  note: "Synthetic QA user reports publication checked.",
  actualMinutes: 45,
});
const doneTask = structuredClone(task);
const doneAllocation = structuredClone(
  v.sprint.allocations.find((a) => a.taskId === task.id),
);
const active = hash({
  stories: v.sprint.stories,
  allocations: v.sprint.allocations,
  progress: v.sprint.progress,
});
await send("request_replan", {
  reason:
    "The publication task is complete. The remaining phone/laptop responsive check only needs a focused 15-minute pass because both layouts were already implemented. Please reduce that remaining check estimate to 15 minutes while preserving both device checks and all completion criteria. Keep completed work locked and every allocation on the first-day goal deadline; later days are rest days.",
  capacityMinutes: 90,
  dailyMinutes: v.sprint.dailyMinutes,
  bufferPercent: 25,
});
assert(
  v.sprint.pendingReplan,
  "Actual Agent 09 must return a validated pending replan",
);
assert.equal(
  hash({
    stories: v.sprint.stories,
    allocations: v.sprint.allocations,
    progress: v.sprint.progress,
  }),
  active,
);
assert.deepEqual(
  v.sprint.pendingReplan.stories
    .flatMap((st) => st.tasks)
    .find((t) => t.id === doneTask.id),
  doneTask,
);
assert.deepEqual(
  v.sprint.pendingReplan.allocations.find((a) => a.taskId === task.id),
  doneAllocation,
);
assert(
  v.sprint.pendingReplan.allocations.every(
    (a) =>
      a.date <= v.sprint.goals[0].deadline &&
      v.sprint.dailyMinutes[
        Math.round(
          (Date.parse(a.date) - Date.parse(v.sprint.startDate)) / 86400000,
        )
      ] > 0,
  ),
);
checks.push(
  "real saved Agent 09 returns pending-only semantic changes respecting deadline and rest days; completed task and allocation preserved",
);
await page.reload();
await page
  .getByRole("heading", { name: "Review schedule change", exact: true })
  .waitFor({ timeout: 15000 });
await page.screenshot({
  path: "docs/evidence/p2-replan-desktop.png",
  fullPage: true,
});
await send("approve_replan", { acknowledgeRisk: true }, "replan");
await refresh();
assert.equal(v.sprint.pendingReplan, null);
assert.deepEqual(
  v.sprint.stories.flatMap((st) => st.tasks).find((t) => t.id === doneTask.id),
  doneTask,
);
checks.push(
  "exact-hash replan approval persists; completed work remains unchanged",
);
const after = await db
  .from("ls_sprints")
  .select("state")
  .eq("id", humanId)
  .single();
assert.equal(hash(after.data!.state), hash(before.data!.state));
assert.deepEqual(errors, []);
await new Promise((resolve) => setTimeout(resolve, 6000));
const runs = await db
  .from("ls_agent_runs")
  .select(
    "role,resource_id,session_id,turn_id,status,error_code,duration_ms,metrics",
  )
  .eq("sprint_id", v.sprint.id);
assert(!runs.error);
assert.equal(runs.data.filter((r) => r.role === "adaptive_backlog").length, 1);
assert.equal(runs.data.filter((r) => r.role !== "adaptive_backlog").length, 0);
await writeFile(
  "docs/evidence/p2-scheduling-acceptance.json",
  JSON.stringify(
    {
      passed: true,
      verifiedAt: new Date().toISOString(),
      projectRef: ref,
      sprintId: v.sprint.id,
      fixture:
        "Explicit synthetic reviewed work and pre-existing advice fixtures; only Agent 09 proposal is live AI-generated",
      checks,
      deterministicSchedulingModelCalls: 0,
      humanSprintUnchanged: true,
      humanRevision: before.data!.state.revision,
      browser: {
        method: "Playwright",
        reason: "Browser plugin not available",
        errors,
        mobileOverflow: false,
      },
      runs: runs.data,
    },
    null,
    2,
  ),
);
await browser.close();
await api.dispose();
console.log(
  "P2 scheduling, recovery UI, exact approval and real Agent 09 acceptance passed.",
);
