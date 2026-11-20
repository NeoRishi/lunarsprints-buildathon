import "./safe-test-errors";
import { request, chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Sprint, Command } from "../src/features/lunarsprints/contracts";
const privateEnv = Object.fromEntries(
  (await readFile(".env.test.local", "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
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
        email: privateEnv.LUNARSPRINTS_QA_EMAIL,
        password: privateEnv.LUNARSPRINTS_QA_PASSWORD,
      },
    })
  ).status(),
  200,
);
let view: { sprint: Sprint; hashes: Record<string, string> };
async function send(action: Command["action"], data: unknown) {
  const r = await api.post("/api/sprints", {
    data: {
      sprintId: view.sprint.id,
      expectedRevision: view.sprint.revision,
      idempotencyKey: crypto.randomUUID(),
      action,
      data,
    },
  });
  assert.equal(r.status(), 200, await r.text());
  view = await r.json();
}
if (process.env.LUNARSPRINTS_BROWSER_RESUME === "1") {
  const list = await (await api.get("/api/sprints")).json();
  view = await (
    await api.get(
      "/api/sprints?id=" +
        list.sprints.find(
          (s: { stage: string; title: string }) =>
            s.stage === "clarify" &&
            s.title === "I want to finally launch my portfolio.",
        ).id,
    )
  ).json();
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
        capacityMinutes: 600,
        dailyMinutes: Array(15).fill(60),
        bufferPercent: 20,
      },
    },
  });
  assert.equal(created.status(), 200);
  view = await created.json();
  await send("capture", {
    intention: "I want to finally launch my portfolio.",
  });
  await send("assess", {});
}
assert(
  view.sprint.clarification?.questions.some((q) => q.options.length >= 2),
  "The actual app must offer context-specific MCQs",
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: await api.storageState(),
  viewport: { width: 1440, height: 1100 },
});
await context.addInitScript({
  content:
    "Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{throw new DOMException('Permission denied','NotAllowedError');}});",
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:3000/app?sprint=${view.sprint.id}`);
await page
  .getByRole("heading", { name: "A little clarity goes a long way." })
  .waitFor();
assert.equal(
  await page.locator("input[type=radio]:checked").count(),
  0,
  "No recommendation silently selected",
);
await page.screenshot({
  path: "docs/evidence/clarification-desktop.png",
  fullPage: true,
});
const radios = page.locator("input[type=radio]");
if (await radios.count()) await radios.first().check();
const custom = `Use my existing site and publish one concise case study. Keep the rest of the design unchanged. QA ${Date.now()}.`;
await page.getByPlaceholder("Type your answer here…").fill(custom);
await Promise.all([
  page.waitForResponse(
    (r) => r.url().endsWith("/api/sprints") && r.request().method() === "POST",
  ),
  page.locator(".summary-chip").last().click(),
]);
await page.getByText(/Saving your changes/).waitFor({ state: "hidden" });
await page.locator(".summary-chip").first().click();
await page.getByText(/Saving your changes/).waitFor({ state: "hidden" });
assert.equal(
  await page.getByPlaceholder("Type your answer here…").inputValue(),
  custom,
);
assert.equal(await page.locator("input[type=radio]:checked").count(), 0);
await page.reload();
await page
  .getByRole("heading", { name: "A little clarity goes a long way." })
  .waitFor();
assert.equal(
  await page.getByPlaceholder("Type your answer here…").inputValue(),
  custom,
);
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: "docs/evidence/clarification-mobile.png",
  fullPage: true,
});
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
);
await page.getByRole("button", { name: "Edit intention", exact: true }).click();
const mic = page.getByRole("button", {
  name: "Speak your intention",
  exact: true,
});
assert.equal(await mic.isEnabled(), false);
await page.getByLabel(/I agree to send this recording/).check();
await page.evaluate(
  "Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{throw new DOMException('Permission denied','NotAllowedError');}})",
);
await mic.click();
console.log("Microphone test diagnostics", {
  alerts: await page.getByRole("alert").allTextContents(),
  pageErrors: errors,
});
await page
  .getByRole("alert")
  .filter({ hasText: "Microphone permission was denied" })
  .waitFor();
assert(await page.getByLabel(/Your intention/).isEditable());
const invalid = await api.post("/api/voice/transcribe", {
  multipart: {
    consent: "true",
    duration: "1",
    audio: {
      name: "invalid.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from("not an audio file"),
    },
  },
});
assert.equal(invalid.status(), 400);
const audio = await readFile(
  new URL("../tests/fixtures/intention.wav", import.meta.url),
);
const transcription = await api.post("/api/voice/transcribe", {
  multipart: {
    consent: "true",
    duration: "10",
    audio: { name: "voice-fixture.wav", mimeType: "audio/wav", buffer: audio },
  },
});
assert.equal(transcription.status(), 200, await transcription.text());
const result = await transcription.json();
assert.match(result.transcript, /family/i);
await writeFile(
  "docs/evidence/browser-and-voice.json",
  JSON.stringify(
    {
      passed: true,
      sprintId: view.sprint.id,
      checks: [
        "actual AI-generated MCQs",
        "no default selections",
        "custom overrides radio",
        "custom answer saved on navigation",
        "custom answer restored after reload",
        "mobile no overflow",
        "microphone consent gate",
        "permission denial keeps text usable",
        "invalid audio rejected",
        "real OpenAI transcription of a synthetic spoken fixture",
      ],
      transcript: result.transcript,
      consoleErrors: errors,
    },
    null,
    2,
  ),
);
assert.deepEqual(errors, []);
console.log(
  "MCQ navigation, mobile layout, microphone denial and real transcription passed.",
);
await browser.close();
await api.dispose();
