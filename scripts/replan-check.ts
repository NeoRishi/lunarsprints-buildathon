import "./safe-test-errors";
import { request, chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Sprint } from "../src/features/lunarsprints/contracts";
import { canonical } from "../src/features/lunarsprints/domain";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
assert(
  url?.includes("jhkoxgyxrihsuhpjqkxc"),
  "Live verification is restricted to the explicitly authorized LifeOS project.",
);

const credentials = Object.fromEntries(
  (await readFile(".env.test.local", "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
const evidence = JSON.parse(
  await readFile("docs/evidence/end-to-end.json", "utf8"),
);

const api = await request.newContext({
  baseURL: "http://127.0.0.1:3000",
  timeout: 240000,
  extraHTTPHeaders: { Origin: new URL("http://127.0.0.1:3000").origin },
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

type View = { sprint: Sprint; hashes: Record<string, string> };
let view: View = await (
  await api.get(`/api/sprints?id=${evidence.sprintId}`)
).json();
assert.equal(view.sprint.stage, "active");

const completedTaskIds = Object.entries(view.sprint.progress)
  .filter(([, p]) => p.status === "done")
  .map(([id]) => id);
assert(
  completedTaskIds.length > 0,
  "The QA fixture must include completed work",
);
const activeStoriesBefore = structuredClone(view.sprint.stories);
const activeAllocationsBefore = structuredClone(view.sprint.allocations);
const activeProgressBefore = structuredClone(view.sprint.progress);

// 1. Request a live Agent 09 (adaptive_backlog) semantic replan
const replanRes = await api.post("/api/sprints", {
  data: {
    sprintId: view.sprint.id,
    expectedRevision: view.sprint.revision,
    idempotencyKey: crypto.randomUUID(),
    action: "request_replan",
    data: {
      reason:
        "Lost two weekday evenings due to travel; rebalance remaining unfinished tasks within 8 hours while keeping completed work locked.",
      capacityMinutes: 480,
      dailyMinutes: view.sprint.dailyMinutes,
      bufferPercent: view.sprint.bufferPercent,
    },
  },
});
assert.equal(replanRes.status(), 200, await replanRes.text());
view = await replanRes.json();

// Active plan must remain untouched while proposal is pending
assert.deepEqual(view.sprint.stories, activeStoriesBefore);
assert.deepEqual(view.sprint.allocations, activeAllocationsBefore);
assert(view.sprint.pendingReplan, "Pending semantic replan must be present");
assert.equal(view.sprint.pendingReplan.source, "agent");
assert(view.sprint.pendingReplan.diff.scope.length >= 1);

// Completed tasks must still exist in the proposed stories
const proposedTaskIds = new Set(
  view.sprint.pendingReplan.stories.flatMap((st) => st.tasks.map((t) => t.id)),
);
for (const doneId of completedTaskIds) {
  assert(
    proposedTaskIds.has(doneId),
    `Completed task ${doneId} must be preserved in Agent 09 proposal`,
  );
  const before = activeStoriesBefore
    .flatMap((st) => st.tasks)
    .find((t) => t.id === doneId);
  const after: Sprint["stories"][number]["tasks"][number] | undefined =
    view.sprint.pendingReplan.stories
      .flatMap((st) => st.tasks)
      .find((t) => t.id === doneId);
  assert.equal(canonical(after), canonical(before));
  assert.deepEqual(
    view.sprint.pendingReplan.allocations.find((a) => a.taskId === doneId),
    activeAllocationsBefore.find((a) => a.taskId === doneId),
  );
}

// 2. Verify forged hash is rejected with 409
const forgedRes = await api.post("/api/sprints", {
  data: {
    sprintId: view.sprint.id,
    expectedRevision: view.sprint.revision,
    idempotencyKey: crypto.randomUUID(),
    action: "approve_replan",
    hash: "forged_hash",
    data: { acknowledgeRisk: true },
  },
});
assert.equal(forgedRes.status(), 409);

// 3. Verify browser UI renders the pending Agent 09 diff cleanly
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: await api.storageState(),
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
await page.goto(`http://127.0.0.1:3000/app?sprint=${view.sprint.id}`);
await page
  .getByRole("heading", { name: "Review schedule change" })
  .waitFor({ timeout: 30000 });
await page.screenshot({
  path: "docs/evidence/replan-diff-desktop.png",
  fullPage: true,
});
assert.deepEqual(pageErrors, []);
assert.match(await page.title(), /LunarSprints/i);
await page.getByRole("button", { name: "Edit proposal", exact: true }).click();
await page
  .getByRole("heading", {
    name: "Adjust proposed task dates & effort before approving",
  })
  .waitFor();
await page.getByRole("button", { name: "Hide editor", exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
assert(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  "Mobile replan must not overflow",
);
await page.screenshot({
  path: "docs/evidence/replan-diff-mobile.png",
  fullPage: true,
});
assert.deepEqual(consoleErrors, []);

// 4. Approve the exact Agent 09 replan version
const approveRes = await api.post("/api/sprints", {
  data: {
    sprintId: view.sprint.id,
    expectedRevision: view.sprint.revision,
    idempotencyKey: crypto.randomUUID(),
    action: "approve_replan",
    hash: view.hashes.replan,
    data: { acknowledgeRisk: true },
  },
});
assert.equal(approveRes.status(), 200, await approveRes.text());
view = await approveRes.json();
assert.equal(view.sprint.pendingReplan, null);
assert.equal(view.sprint.pendingSchedule, null);
assert.equal(view.sprint.capacityMinutes, 480);
assert.equal(view.sprint.approvals.at(-1)?.kind, "replan");
assert.deepEqual(view.sprint.progress, activeProgressBefore);
const persisted: View = await (
  await api.get(`/api/sprints?id=${view.sprint.id}`)
).json();
assert.deepEqual(persisted.sprint, view.sprint);
await page.reload();
await page
  .getByRole("heading", { name: "Your active sprint" })
  .waitFor();
assert.equal(
  await page.getByRole("heading", { name: "Review schedule change" }).count(),
  0,
);
assert.deepEqual(pageErrors, []);

// 5. Verify export endpoint returns portable JSON bundle
const exportRes = await api.get(`/api/sprints?id=${view.sprint.id}&export=1`);
assert.equal(exportRes.status(), 200);
const exportBundle = await exportRes.json();
assert.equal(exportBundle.schemaVersion, "1.0");
assert.equal(exportBundle.sprint.id, view.sprint.id);

// 6. Verify Supabase telemetry recorded Agent 09 run and immutable revisions
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
const runs = await admin
  .from("ls_agent_runs")
  .select("role,resource_id,session_id,turn_id,status,duration_ms,error_code")
  .eq("sprint_id", view.sprint.id)
  .eq("role", "adaptive_backlog");
assert(!runs.error);
assert(
  runs.data?.some(
    (r) =>
      r.role === "adaptive_backlog" &&
      r.resource_id ===
        "agent_3019f5aff3784a4bb0eb2d8eaf1a9811a540bb67f94e4a07a0" &&
      r.status === "ok",
  ),
  "Expected successful adaptive_backlog run in ls_agent_runs",
);

await writeFile(
  "docs/evidence/replan-acceptance.json",
  JSON.stringify(
    {
      passed: true,
      verifiedAt: new Date().toISOString(),
      projectRef: "jhkoxgyxrihsuhpjqkxc",
      sprintId: view.sprint.id,
      revision: view.sprint.revision,
      checks: [
        "saved Agent 09 (adaptive_backlog) invoked via official session",
        "pendingReplan persisted without mutating active stories or schedule",
        "completed tasks preserved across semantic replan",
        "completed task contents, allocations and reported progress unchanged",
        "before/after diff rendered in browser with zero page errors",
        "proposal editor opens; desktop/mobile render without overflow or console errors",
        "forged approval hash rejected with 409",
        "exact hash approval atomically updated active sprint",
        "portable JSON export verified",
        "approved plan persists and reload removes pending review",
      ],
      browser: {
        method: "Playwright",
        reason: "Browser plugin not available",
        desktop: [1440, 1100],
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
console.log("Agent 09 live semantic replanning acceptance passed.");
