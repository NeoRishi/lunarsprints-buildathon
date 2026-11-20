import "./safe-test-errors";
import { request } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

assert.equal(
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname,
  "jhkoxgyxrihsuhpjqkxc.supabase.co",
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
assert.match(
  credentials.LUNARSPRINTS_QA_EMAIL,
  /^qa-.*@lunarsprints\.example$/,
);
const api = await request.newContext({
  baseURL: "http://127.0.0.1:3000",
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
const id = crypto.randomUUID();
const command = {
  sprintId: id,
  expectedRevision: -1,
  idempotencyKey: crypto.randomUUID(),
  action: "create",
  data: {
    startDate: new Date().toISOString().slice(0, 10),
    timezone: "Asia/Kolkata",
    capacityMinutes: 600,
    dailyMinutes: Array(15).fill(60),
    bufferPercent: 20,
  },
};
assert.equal((await api.post("/api/sprints", { data: command })).status(), 200);
const exported = await api.get(`/api/sprints?id=${id}&export=1`);
assert.equal(exported.status(), 200);
assert.equal((await exported.json()).sprint.id, id);
assert.match(exported.headers()["content-disposition"], /attachment/);
assert.equal(
  (
    await api.delete(`/api/sprints?id=${id}`, {
      headers: { Origin: "https://untrusted.example" },
    })
  ).status(),
  403,
);
assert.equal((await api.delete(`/api/sprints?id=${id}`)).status(), 200);
assert.equal((await api.get(`/api/sprints?id=${id}`)).status(), 404);
assert.equal((await api.get(`/api/sprints?id=${id}&export=1`)).status(), 404);
const list = await (await api.get("/api/sprints")).json();
assert(!list.sprints.some((s: { id: string }) => s.id === id));
assert.equal(
  (await api.post("/api/sprints", { data: command })).status(),
  404,
  "A historical command retry must not restore an archived view",
);
await writeFile(
  "docs/evidence/archive-acceptance.json",
  JSON.stringify(
    {
      passed: true,
      verifiedAt: new Date().toISOString(),
      projectRef: "jhkoxgyxrihsuhpjqkxc",
      sprintId: id,
      checks: [
        "owned synthetic sprint export",
        "cross-origin archive denied",
        "archive hidden from list, detail and export",
        "historical retry cannot restore archived view",
      ],
      retention: "Archive only: immutable historical data is retained.",
    },
    null,
    2,
  ),
);
await api.dispose();
console.log("Synthetic sprint export/archive acceptance passed.");
