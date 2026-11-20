import "./safe-test-errors";
import { createClient } from "@supabase/supabase-js";
import { request, chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Sprint, Command } from "../src/features/lunarsprints/contracts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
assert(
  url?.includes("jhkoxgyxrihsuhpjqkxc"),
  "Live verification is restricted to the explicitly authorized LifeOS project.",
);
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const resume = process.env.LUNARSPRINTS_E2E_RESUME === "1";
const prior = resume
  ? Object.fromEntries(
      (await readFile(".env.test.local", "utf8"))
        .trim()
        .split("\n")
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i), l.slice(i + 1)];
        }),
    )
  : null;
const email =
  prior?.LUNARSPRINTS_QA_EMAIL ??
  `qa-${crypto.randomUUID().slice(0, 8)}@lunarsprints.example`;
const password =
  prior?.LUNARSPRINTS_QA_PASSWORD ?? "Aa9!" + crypto.randomUUID();
let userId: string;
if (resume) {
  const qa = createClient(url, publishable, {
    auth: { persistSession: false },
  });
  const signed = await qa.auth.signInWithPassword({ email, password });
  assert(!signed.error, "QA sign-in failed");
  userId = signed.data.user!.id;
} else {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { lunarsprints_test: true },
  });
  assert(!created.error, created.error?.message ?? "Could not create QA user");
  userId = created.data.user!.id;
}
await writeFile(
  ".env.test.local",
  `LUNARSPRINTS_QA_EMAIL=${email}\nLUNARSPRINTS_QA_PASSWORD=${password}\n`,
  { mode: 0o600 },
);
const api = await request.newContext({
  baseURL: "http://127.0.0.1:3000",
  timeout: 240000,
  extraHTTPHeaders: { Origin: new URL("http://127.0.0.1:3000").origin },
});
const login = await api.post("/api/auth", {
  data: { action: "login", email, password },
});
assert.equal(login.status(), 200, await login.text());
type View = { sprint: Sprint; hashes: Record<string, string> };
let view: View;
const records: { step: string; revision: number; stage: string }[] = [];
async function send(
  action: Command["action"],
  data: unknown = {},
  kind?: string,
) {
  const payload: Command = {
    sprintId: view.sprint.id,
    expectedRevision: view.sprint.revision,
    idempotencyKey: crypto.randomUUID(),
    action,
    data,
    ...(kind ? { hash: view.hashes[kind] } : {}),
  };
  const response = await api.post("/api/sprints", { data: payload });
  assert.equal(response.status(), 200, `${action}: ${await response.text()}`);
  view = await response.json();
  records.push({
    step: action,
    revision: view.sprint.revision,
    stage: view.sprint.stage,
  });
  console.log(
    `${action}: saved revision ${view.sprint.revision} (${view.sprint.stage})`,
  );
  return payload;
}
if (resume) {
  const list = await (await api.get("/api/sprints")).json();
  assert(list.sprints.length);
  view = await (await api.get("/api/sprints?id=" + list.sprints[0].id)).json();
  console.log(
    "Resuming saved revision",
    view.sprint.revision,
    view.sprint.stage,
  );
} else {
  const createPayload: Command = {
    sprintId: crypto.randomUUID(),
    expectedRevision: -1,
    idempotencyKey: crypto.randomUUID(),
    action: "create",
    data: {
      startDate: "2026-10-28",
      timezone: "Asia/Kolkata",
      capacityMinutes: 600,
      dailyMinutes: Array(15).fill(60),
      bufferPercent: 20,
    },
  };
  const creation = await api.post("/api/sprints", { data: createPayload });
  assert.equal(creation.status(), 200, await creation.text());
  view = await creation.json();
  const duplicate = await api.post("/api/sprints", { data: createPayload });
  assert.deepEqual((await duplicate.json()).sprint, view.sprint);
  await send("capture", {
    intention:
      "I want to finally launch my portfolio. My visual design and a draft case study are already done. I have ten focused hours available in this sprint.",
  });
  await send("assess");
  if (view.sprint.stage === "select")
    await send("select_intents", [view.sprint.assessment!.intents[0].id]);
}
const questions = view.sprint.clarification?.questions ?? [];
assert(questions.length <= 5);
await mkdir("docs/evidence", { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: await api.storageState(),
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const consoleErrors: string[] = [];
page.on("pageerror", (e) => consoleErrors.push(e.message));
await page.goto(`http://127.0.0.1:3000/app?sprint=${view.sprint.id}`);
if (!resume) {
  await page
    .getByRole("heading", { name: /clarity|concrete/ })
    .waitFor({ timeout: 30000 });
  await page.screenshot({
    path: "docs/evidence/clarification-desktop.png",
    fullPage: true,
  });
}
if (view.sprint.stage === "clarify" || !view.sprint.goals.length) {
  for (const q of questions) {
    const answer =
      q.category === "baseline"
        ? "The visual design and a draft case study are already done. An existing Next.js scaffold and hosting account are available."
        : q.category === "constraints" || q.category === "achievable"
          ? "I can protect ten hours in the entire sprint, at most sixty minutes per day, keeping twenty percent as buffer."
          : q.category === "relevant"
            ? "I want a public place to show my work to potential collaborators."
            : "Publish a home page and one reviewed case study using my existing design, Next.js scaffold and hosting. Both pages should be accessible on a phone and laptop, with links tested. No redesign, extra case studies or new analytics setup.";
    await send("answer", {
      questionId: q.id,
      optionId: null,
      customText: answer,
      status: "confirmed",
      source: "user_custom",
    });
  }
  await send("synthesize");
  assert(view.sprint.goals.length >= 1);
}
if (view.sprint.stage === "goals") {
  const invalidHash = await api.post("/api/sprints", {
    data: {
      sprintId: view.sprint.id,
      expectedRevision: view.sprint.revision,
      idempotencyKey: crypto.randomUUID(),
      action: "approve_goals",
      hash: "forged",
      data: {},
    },
  });
  assert.equal(invalidHash.status(), 409);
  await send("approve_goals", {}, "goals");
}
if (view.sprint.stage === "stories") {
  if (!view.sprint.stories.length) await send("generate_stories");
  await send("approve_stories", {}, "stories");
}
if (view.sprint.stage === "schedule") {
  if (!view.sprint.allocations.length) await send("schedule");
  await page.reload();
  await page
    .getByRole("heading", { name: "Give your plan some breathing room." })
    .waitFor();
  await page.screenshot({
    path: "docs/evidence/schedule-desktop.png",
    fullPage: true,
  });
  // Exercise an editable effort allocation without silently approving it.
  await send("edit_schedule", {
    allocations: view.sprint.allocations,
    capacityMinutes: view.sprint.capacityMinutes,
    dailyMinutes: view.sprint.dailyMinutes,
    bufferPercent: view.sprint.bufferPercent,
  });
  await send("approve_schedule", { acknowledgeRisk: true }, "schedule");
}
if (view.sprint.stage === "review") await send("activate", {}, "activation");
const activated = view.sprint;
assert.equal(activated.stage, "active");
const refresh = await api.get(`/api/sprints?id=${activated.id}`);
assert.deepEqual((await refresh.json()).sprint, activated);
await page.reload();
await page
  .getByRole("heading", { name: "Your active sprint" })
  .waitFor();
await page.screenshot({
  path: "docs/evidence/board-desktop.png",
  fullPage: true,
});
await page.getByRole("button", { name: "All days", exact: true }).click();
const firstTask = activated.stories[0].tasks[0];
await page
  .getByRole("button")
  .filter({
    has: page.getByRole("heading", { name: firstTask.title, exact: true }),
  })
  .click();
await page.getByRole("dialog").waitFor();
assert(await page.getByLabel("Reported status").isVisible());
await page.getByRole("button", { name: "Close task" }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: "docs/evidence/board-mobile.png",
  fullPage: true,
});
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
  "No mobile page overflow",
);
const next = { ...view.sprint.allocations[0], date: "2026-11-10" };
await send("propose_replan", {
  allocations: view.sprint.allocations.map((a) =>
    a.taskId === next.taskId ? next : a,
  ),
  notes: [],
});
assert.notDeepEqual(view.sprint.pendingSchedule, view.sprint.allocations);
await send("approve_replan", { acknowledgeRisk: true }, "replan");
await send("progress", {
  taskId: firstTask.id,
  status: "done",
  percent: 100,
  dodConfirmed: true,
  completedSubtaskIds: firstTask.subtasks.map((t) => t.id),
  note: "Synthetic acceptance test: all completion checks explicitly confirmed.",
  actualMinutes: 15,
});
const check = await api.get(`/api/sprints?id=${view.sprint.id}`);
assert.equal((await check.json()).sprint.progress[firstTask.id].status, "done");
const secondEmail = `qa-isolation-${crypto.randomUUID().slice(0, 8)}@lunarsprints.example`;
const secondPassword = "Aa9!" + crypto.randomUUID();
const second = await admin.auth.admin.createUser({
  email: secondEmail,
  password: secondPassword,
  email_confirm: true,
  app_metadata: { lunarsprints_test: true },
});
assert(
  !second.error,
  second.error?.message ?? "Could not create isolation user",
);
const other = createClient(url, publishable, {
  auth: { persistSession: false },
});
const otherLogin = await other.auth.signInWithPassword({
  email: secondEmail,
  password: secondPassword,
});
assert(
  !otherLogin.error,
  otherLogin.error?.message ?? "Could not sign in isolation user",
);
const foreign = await other
  .from("ls_sprints")
  .select("id")
  .eq("id", view.sprint.id);
assert(!foreign.error);
assert.deepEqual(foreign.data, []);
const bypass = await other.rpc("ls_commit", {
  p_user: userId,
  p_sprint: view.sprint.id,
  p_expected: view.sprint.revision,
  p_key: crypto.randomUUID(),
  p_request_hash: "forged",
  p_action: "activate",
  p_state: view.sprint,
});
assert(bypass.error, "Authenticated clients must not have commit permission");
const otherApi = await request.newContext({
  baseURL: "http://127.0.0.1:3000",
  extraHTTPHeaders: { Origin: new URL("http://127.0.0.1:3000").origin },
});
await otherApi.post("/api/auth", {
  data: { action: "login", email: secondEmail, password: secondPassword },
});
const unauthorized = await otherApi.get(`/api/sprints?id=${view.sprint.id}`);
assert.equal(unauthorized.status(), 404);
const unauthenticated = await request.newContext({
  baseURL: "http://127.0.0.1:3000",
  extraHTTPHeaders: { Origin: new URL("http://127.0.0.1:3000").origin },
});
assert.equal((await unauthenticated.get("/api/sprints")).status(), 401);
const badOrigin = await api.post("/api/sprints", {
  headers: { Origin: "https://untrusted.example" },
  data: {},
});
assert.equal(badOrigin.status(), 403);
assert.deepEqual(consoleErrors, []);
const { data: runs, error: runError } = await admin
  .from("ls_agent_runs")
  .select("role,resource_id,session_id,turn_id,status,duration_ms,error_code")
  .eq("sprint_id", view.sprint.id);
assert(!runError);
const { count: revisionCount, error: historyError } = await admin
  .from("ls_revisions")
  .select("*", { count: "exact", head: true })
  .eq("sprint_id", view.sprint.id);
assert(!historyError);
assert.equal(revisionCount, view.sprint.revision + 1);
await writeFile(
  "docs/evidence/end-to-end.json",
  JSON.stringify(
    {
      passed: true,
      projectRef: "jhkoxgyxrihsuhpjqkxc",
      sprintId: view.sprint.id,
      stages: records,
      questionCount: questions.length,
      goalTitles: view.sprint.goals.map((g) => g.title),
      storyCount: view.sprint.stories.length,
      taskCount: view.sprint.stories.flatMap((st) => st.tasks).length,
      checks: [
        "real managed agents",
        "authenticated persistence",
        "idempotent create",
        "hash substitution blocked",
        "explicit approvals",
        "reload",
        "board dialog",
        "mobile overflow",
        "approved replan",
        "reported completion",
        "cross-user RLS",
        "server-only commit",
        "cross-user HTTP",
        "unauthenticated HTTP",
        "cross-origin rejection",
        "append-only revision history",
      ],
      runs,
    },
    null,
    2,
  ),
);
console.log("Real-agent, Supabase and browser journey passed. Evidence saved.");
await browser.close();
await api.dispose();
await otherApi.dispose();
await unauthenticated.dispose();
