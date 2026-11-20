import "./safe-test-errors";
import { request, chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Command, Sprint } from "../src/features/lunarsprints/contracts";
import { hash } from "../src/features/lunarsprints/coordinator";
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
const records: { action: string; durationMs: number; revision: number }[] = [];
let v: { sprint: Sprint; hashes: Record<string, string> };
const created = await api.post("/api/sprints", {
  data: {
    sprintId: crypto.randomUUID(),
    expectedRevision: -1,
    idempotencyKey: crypto.randomUUID(),
    action: "create",
    data: {
      startDate: "2026-10-31",
      timezone: "Asia/Kolkata",
      capacityMinutes: 600,
      dailyMinutes: Array(15).fill(60),
      bufferPercent: 20,
    },
  },
});
assert.equal(created.status(), 200);
v = await created.json();
async function send(
  action: Command["action"],
  data: unknown = {},
  kind?: string,
) {
  const start = Date.now();
  const r = await api.post("/api/sprints", {
    data: {
      sprintId: v.sprint.id,
      expectedRevision: v.sprint.revision,
      idempotencyKey: crypto.randomUUID(),
      action,
      data,
      ...(kind ? { hash: v.hashes[kind] } : {}),
    },
  });
  assert.equal(r.status(), 200, `${action}: ${await r.text()}`);
  v = await r.json();
  records.push({
    action,
    durationMs: Date.now() - start,
    revision: v.sprint.revision,
  });
  console.log(`${action}: ${records.at(-1)!.durationMs} ms; ${v.sprint.stage}`);
}
await send("capture", {
  intention:
    "I want to make time for drawing. I am a beginner with paper and pencil already available, and I want to complete two 20-minute pencil sketches of household objects, save one photo of each, and write one observation per sketch by the end of these 15 days. Nothing is started. This is for personal enjoyment. I have ten hours available, with up to one hour a day and a 20% buffer.",
});
await send("assess");
if (v.sprint.stage === "select")
  await send("select_intents", [v.sprint.assessment!.intents[0].id]);
assert(!v.sprint.pendingClarification);
for (const q of v.sprint.clarification?.questions ?? [])
  await send("answer", {
    questionId: q.id,
    optionId: null,
    customText:
      "Two 20-minute beginner pencil sketches of household objects; paper and pencil are available; nothing started; save one photo and one observation per sketch; for personal enjoyment; 10 hours total, up to 60 minutes daily, 20% buffer, by the last sprint day.",
    status: "confirmed",
    source: "user_custom",
  });
await send("synthesize");
assert(
  !v.sprint.pendingClarification,
  "The bounded synthetic intention should be ready",
);
await send("approve_goals", {}, "goals");
await send("generate_stories");
assert(v.sprint.stories.length);
await send("approve_stories", {}, "stories");
await new Promise((resolve) => setTimeout(resolve, 6000));
const countBefore = (
  await db
    .from("ls_agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("sprint_id", v.sprint.id)
).count;
await send("schedule");
const countAfter = (
  await db
    .from("ls_agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("sprint_id", v.sprint.id)
).count;
assert.equal(countAfter, countBefore, "Scheduling must make zero model calls");
const scheduleHash = hash(v.sprint.allocations);
const approvalsHash = hash(v.sprint.approvals);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  storageState: await api.storageState(),
  viewport: { width: 1440, height: 1000 },
});
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.name));
await page.goto(`${origin}/app?sprint=${v.sprint.id}`);
await page
  .getByRole("heading", { name: "Give your plan some breathing room." })
  .waitFor();
const explain = page.getByRole("button", {
  name: "Explain this schedule (optional)",
  exact: true,
});
await explain.waitFor();
await explain.click();
await page
  .getByRole("button", {
    name: "Explain this schedule (optional)",
    exact: true,
  })
  .waitFor();
// Wait for the UI command to finish without persisting a browser storage dump.
await page.waitForFunction(
  () => !document.body.innerText.includes("Explaining your saved schedule"),
  null,
  { timeout: 190000 },
);
v = await (await api.get(`/api/sprints?id=${v.sprint.id}`)).json();
assert(v.sprint.scheduleAdvice);
assert.equal(hash(v.sprint.allocations), scheduleHash);
assert.equal(hash(v.sprint.approvals), approvalsHash);
assert(!v.sprint.pendingClarification);
await page.screenshot({
  path: "docs/evidence/planning-performance-desktop.png",
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: "docs/evidence/planning-performance-mobile.png",
  fullPage: true,
});
assert(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
);
await send("approve_schedule", { acknowledgeRisk: true }, "schedule");
await send("activate", {}, "activation");
await page.reload();
await page
  .getByRole("heading", { name: "Your active sprint" })
  .waitFor();
assert.deepEqual(errors, []);
await new Promise((resolve) => setTimeout(resolve, 6000));
const runs = (
  await db
    .from("ls_agent_runs")
    .select(
      "role,resource_id,session_id,turn_id,status,duration_ms,error_code,metrics",
    )
    .eq("sprint_id", v.sprint.id)
    .order("created_at")
).data!;
assert.equal(runs.filter((r) => r.role === "orchestrator").length, 0);
assert.equal(runs.filter((r) => r.role === "intent_alignment").length, 1);
assert.equal(runs.filter((r) => r.role === "scheduling").length, 1);
assert(runs.every((r) => r.metrics?.contractVersion === "2.1"));
assert(
  runs.find((r) => r.role === "story_decomposer")?.metrics.model ===
    "gpt-6.1-sol",
);
const after = await db
  .from("ls_sprints")
  .select("state")
  .eq("id", humanId)
  .single();
assert.equal(hash(after.data!.state), hash(before.data!.state));
await writeFile(
  "docs/evidence/planning-performance.json",
  JSON.stringify(
    {
      passed: true,
      verifiedAt: new Date().toISOString(),
      projectRef: ref,
      sprintId: v.sprint.id,
      steps: records,
      schedulingModelCalls: countAfter! - countBefore!,
      optionalAdviceStatus: v.sprint.scheduleAdvice?.status,
      taskCount: v.sprint.stories.flatMap((s) => s.tasks).length,
      humanSprintUnchanged: true,
      humanRevision: before.data!.state.revision,
      browser: { errors, mobileOverflow: false },
      runs,
    },
    null,
    2,
  ),
);
console.log("Planning performance acceptance passed; receipt saved.");
await browser.close();
await api.dispose();
