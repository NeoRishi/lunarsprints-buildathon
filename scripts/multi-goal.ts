import "./safe-test-errors";
import { request } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Sprint, Command } from "../src/features/lunarsprints/contracts";
import { capacity } from "../src/features/lunarsprints/domain";
const credentials = Object.fromEntries(
  (await readFile(".env.test.local", "utf8"))
    .trim()
    .split("\n")
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
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
let view: { sprint: Sprint; hashes: Record<string, string> };
const steps: string[] = [];
async function send(
  action: Command["action"],
  data: unknown = {},
  kind?: string,
) {
  const r = await api.post("/api/sprints", {
    data: {
      sprintId: view.sprint.id,
      expectedRevision: view.sprint.revision,
      idempotencyKey: crypto.randomUUID(),
      action,
      data,
      ...(kind ? { hash: view.hashes[kind] } : {}),
    },
  });
  assert.equal(r.status(), 200, `${action}: ${await r.text()}`);
  view = await r.json();
  steps.push(action);
  console.log("Multi-goal:", action, view.sprint.stage);
}
if (process.env.LUNARSPRINTS_MULTI_RESUME === "1") {
  const list = await (await api.get("/api/sprints")).json();
  const chosen = list.sprints.find((s: { title: string }) =>
    s.title.includes("pencil sketches"),
  );
  assert(chosen, "Multi-goal QA draft not found");
  view = await (await api.get("/api/sprints?id=" + chosen.id)).json();
  console.log("Multi-goal resume", view.sprint.stage);
} else {
  const created = await api.post("/api/sprints", {
    data: {
      sprintId: crypto.randomUUID(),
      expectedRevision: -1,
      idempotencyKey: crypto.randomUUID(),
      action: "create",
      data: {
        startDate: "2026-10-28",
        timezone: "Asia/Kolkata",
        capacityMinutes: 120,
        dailyMinutes: Array(15).fill(60),
        bufferPercent: 20,
      },
    },
  });
  assert.equal(created.status(), 200);
  view = await created.json();
  await send("capture", {
    intention:
      "I want to make two pencil sketches of houseplants and have two relaxed phone-free dinners with my family during this sprint. Each sketch and each dinner gets 45 minutes. A sketch is done when the outline and shading are finished and I have a photo of the page. A family dinner is done when we have spent 45 uninterrupted minutes together; I do not want to collect photos or evidence about my family. I have only two hours available for all of this over the sprint. These are two independent goals that I want to review together.",
  });
  await send("assess");
}
assert(view.sprint.assessment!.intents.length >= 2);
if (view.sprint.stage === "select")
  await send(
    "select_intents",
    view.sprint.assessment!.intents.map((i) => i.id),
  );
if (view.sprint.stage === "clarify")
  for (const q of view.sprint.clarification?.questions ?? [])
    await send("answer", {
      questionId: q.id,
      optionId: null,
      customText:
        q.category === "constraints" || q.category === "achievable"
          ? "Two hours total across both goals. Preserve the stated scope as a proposal and show the capacity conflict honestly; do not invent extra availability."
          : "Keep the two outcomes exactly as stated: two 45-minute plant sketches from scratch with finished outline/shading, and two relaxed 45-minute phone-free family dinners without any family photos, diagnostics or extra tracking.",
      status: "confirmed",
      source: "user_custom",
    });
if (!view.sprint.goals.length) await send("synthesize");
assert.equal(view.sprint.goals.length, view.sprint.selectedIntentIds.length);
assert(view.sprint.goals.length >= 2);
if (view.sprint.stage === "goals") await send("approve_goals", {}, "goals");
if (!view.sprint.stories.length) await send("generate_stories");
assert(new Set(view.sprint.stories.map((st) => st.goalId)).size >= 2);
await send("approve_stories", {}, "stories");
await send("schedule");
const c = capacity(view.sprint);
assert(
  c.overbooked > 0,
  "Both stated goals must be counted against the two-hour total capacity",
);
const blocked = await api.post("/api/sprints", {
  data: {
    sprintId: view.sprint.id,
    expectedRevision: view.sprint.revision,
    idempotencyKey: crypto.randomUUID(),
    action: "approve_schedule",
    data: { acknowledgeRisk: false },
    hash: view.hashes.schedule,
  },
});
assert.equal(
  blocked.status(),
  400,
  "An overload requires explicit acknowledgment",
);
await send("approve_schedule", { acknowledgeRisk: true }, "schedule");
await send("activate", {}, "activation");
const refreshed = await (
  await api.get("/api/sprints?id=" + view.sprint.id)
).json();
assert.deepEqual(refreshed.sprint, view.sprint);
await writeFile(
  "docs/evidence/multi-goal.json",
  JSON.stringify(
    {
      passed: true,
      sprintId: view.sprint.id,
      goalTitles: view.sprint.goals.map((g) => g.title),
      questionCount: view.sprint.clarification?.questions.length,
      capacity: c,
      steps,
      checks: [
        "distinct intentions selected by user",
        "multiple SMART goals approved",
        "stories belong to one goal",
        "aggregate capacity conflict",
        "unacknowledged overload blocked",
        "explicit risk decision recorded",
        "activated plan persisted",
      ],
    },
    null,
    2,
  ),
);
console.log(
  "Multiple competing goals persisted and activated with an explicit capacity-risk decision.",
);
await api.dispose();
