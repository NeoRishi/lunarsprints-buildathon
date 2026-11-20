import "./safe-test-errors";
import { request, chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Sprint } from "../src/features/lunarsprints/contracts";

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
const initial: { sprint: Sprint } = await (
  await api.get("/api/sprints?id=" + evidence.sprintId)
).json();
assert.equal(initial.sprint.stage, "active");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: await api.storageState(),
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:3000/app?sprint=" + evidence.sprintId);
await page
  .getByRole("heading", { name: "Your active sprint" })
  .waitFor();
for (const name of ["Suggest next action", "Reflect"]) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/sprints") && r.request().method() === "POST",
    { timeout: 240000 },
  );
  await page.getByRole("button", { name, exact: true }).click();
  const result = await response;
  assert.equal(result.status(), 200, `${name}: ${await result.text()}`);
  const view: { sprint: Sprint } = await result.json();
  assert.deepEqual(
    view.sprint.progress,
    initial.sprint.progress,
    "Guidance cannot report progress",
  );
  assert.deepEqual(
    view.sprint.allocations,
    initial.sprint.allocations,
    "Guidance cannot reschedule",
  );
  if (name === "Suggest next action")
    assert(view.sprint.nextAction?.actionTitle);
  else assert(view.sprint.assistantMessage);
  await page.getByRole("button", { name, exact: true }).waitFor();
  console.log("Execution guidance passed:", name);
}
await page.getByRole("button", { name: "All days", exact: true }).click();
await page.screenshot({
  path: "docs/evidence/board-desktop.png",
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 844 });
assert(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  "Mobile page overflow",
);
await page.screenshot({
  path: "docs/evidence/board-mobile.png",
  fullPage: true,
});
assert.deepEqual(errors, []);
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
);
for (const file of ["end-to-end.json", "multi-goal.json"]) {
  const report = JSON.parse(await readFile("docs/evidence/" + file, "utf8"));
  const revisions = await admin
    .from("ls_revisions")
    .select("revision,action,state,created_at")
    .eq("sprint_id", report.sprintId)
    .order("revision");
  assert(!revisions.error);
  report.persistedHistory = revisions.data!.map((r) => ({
    revision: r.revision,
    action: r.action,
    stage: r.state.stage,
    at: r.created_at,
  }));
  report.acceptanceNote =
    "History was read from persisted Supabase revisions and contains every committed step.";
  await writeFile("docs/evidence/" + file, JSON.stringify(report, null, 2));
}
const runs = await admin
  .from("ls_agent_runs")
  .select("role,resource_id,session_id,turn_id,status,duration_ms,error_code")
  .eq("sprint_id", evidence.sprintId)
  .in("role", ["daily_execution", "reflection"]);
assert(!runs.error);
assert(
  ["daily_execution", "reflection"].every((role) =>
    runs.data!.some((r) => r.role === role && r.status === "ok"),
  ),
);
await writeFile(
  "docs/evidence/execution-guidance.json",
  JSON.stringify(
    {
      passed: true,
      sprintId: evidence.sprintId,
      checks: [
        "real board controls invoke saved Agents 08 and 10",
        "guidance does not mutate reported progress or approved dates",
        "mobile no overflow",
        "no browser page errors",
      ],
      runs: runs.data,
    },
    null,
    2,
  ),
);
await browser.close();
await api.dispose();
