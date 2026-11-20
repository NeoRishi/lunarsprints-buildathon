/**
 * Live end-to-end check of AI planning. Needs everything running:
 *   npm run dev:all        (Auth emulator, agent service, Next.js)
 *   npm run test:ai-planning
 *
 * Signs up a fictional test account on the Auth emulator, creates a sprint,
 * gets the AI understanding of the intention, the goal suggestion, the steps
 * and the schedule notes from Gemini, approves the plan, then reloads it and
 * checks it was saved. Uses the Gemini key through the agent service.
 */
import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { signUpNeutral } from "../src/lib/firebase/flows";

const APP = process.env.AI_CHECK_APP_URL ?? "http://127.0.0.1:3000";
const EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!EMULATOR || !PROJECT)
  throw new Error(
    "Set FIREBASE_AUTH_EMULATOR_HOST and NEXT_PUBLIC_FIREBASE_PROJECT_ID (see .env.example), then run npm run dev:all.",
  );

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type View = { sprint: Json; hashes: Record<string, string>; capacity: Json };

const started = Date.now();
const step = (label: string) =>
  console.log(`[${((Date.now() - started) / 1000).toFixed(1)} s] ${label}`);
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Check failed: ${message}`);
}

async function health() {
  const r = await fetch(`${APP}/health`).catch(() => null);
  check(r, `the app does not answer at ${APP}. Start it with npm run dev:all`);
  const body = (await r.json()) as Json;
  check(body.ai?.engine === "gemini_agents", "AGENTS_SERVICE_URL is not set");
  check(body.ai?.agentService === true, "the agent service does not answer");
  check(body.database === true, "the database does not answer");
}

async function signIn(): Promise<string> {
  const app = initializeApp(
    { apiKey: "emulator-check-key", projectId: PROJECT },
    "ai-planning-check",
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${EMULATOR}`, { disableWarnings: true });
  const email = `ai-check-${randomUUID().slice(0, 8)}@example.com`;
  const password = `Moonlit-${randomUUID().slice(0, 8)}-9!`;
  await signUpNeutral(auth, email, password, `${APP}/app`);
  const codes = (await (
    await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT}/oobCodes`)
  ).json()) as {
    oobCodes: { email: string; requestType: string; oobLink: string }[];
  };
  const link = codes.oobCodes
    .filter((c) => c.email === email && c.requestType === "VERIFY_EMAIL")
    .at(-1)?.oobLink;
  check(link, "no confirmation email from the emulator");
  await fetch(link, { redirect: "manual" });
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  const r = await fetch(`${APP}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP },
    body: JSON.stringify({ idToken: await user.getIdToken() }),
  });
  check(r.ok, `session sign-in returned ${r.status}`);
  const cookie = /__session=([^;]*)/.exec(
    r.headers.get("set-cookie") ?? "",
  )?.[1];
  check(cookie, "no session cookie");
  await signOut(auth);
  await deleteApp(app);
  return `__session=${cookie}`;
}

function client(cookie: string) {
  let view: View | null = null;
  const sprintId = randomUUID();
  async function send(action: string, data: unknown = {}, hashKind?: string) {
    const r = await fetch(`${APP}/api/sprints`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: APP, cookie },
      body: JSON.stringify({
        sprintId,
        expectedRevision: view ? view.sprint.revision : -1,
        idempotencyKey: randomUUID(),
        action,
        data,
        ...(hashKind ? { hash: view!.hashes[hashKind] } : {}),
      }),
    });
    const body = (await r.json()) as Json;
    if (!r.ok)
      throw new Error(
        `${action} failed: ${body.error?.code}: ${body.error?.message}`,
      );
    view = body as View;
    return view;
  }
  async function reload() {
    const r = await fetch(`${APP}/api/sprints?id=${sprintId}`, {
      headers: { cookie },
    });
    check(r.ok, `reload returned ${r.status}`);
    return (await r.json()) as View;
  }
  /** Answers any saved follow-up question with its first option, then continues. */
  async function settle(label: string) {
    for (let i = 0; i < 4 && view!.sprint.pendingClarification; i++) {
      const p = view!.sprint.pendingClarification as Json;
      step(`${label}: the AI asked a follow-up question, answering it`);
      if (!p.consentGranted) await send("consent_clarification");
      await send("answer_clarification", {
        questionId: p.id,
        status: "confirmed",
        optionId: p.options[0]?.id ?? null,
        customText: p.options[0]
          ? null
          : "Five pages: home, about and three case studies. Text is written.",
      });
      await send("resume_clarification");
    }
    check(
      !view!.sprint.pendingClarification,
      `${label}: questions did not settle`,
    );
  }
  return {
    send,
    reload,
    settle,
    get view() {
      return view!;
    },
  };
}

function today(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  await health();
  step("app, database and agent service answer");
  const cookie = await signIn();
  step("signed up and signed in a fictional test account");
  const c = client(cookie);
  const timezone = "Asia/Kolkata";
  const start = today(timezone);
  await c.send("create", {
    startDate: start,
    endDate: addDays(start, 6),
    timezone,
    capacityMinutes: 420,
    dailyMinutes: [90, 90, 90, 90, 90, 90, 90],
    bufferPercent: 10,
  });
  step("created a 7-day sprint");
  await c.send("capture", {
    intention:
      "Launch my 5 page illustration portfolio site: home, about and 3 case studies. All the text is written; I still need to design the pages in Webflow and publish them.",
  });
  await c.send("assess");
  check(c.view.sprint.assessment?.intents?.length, "no intentions understood");
  step(`AI understood ${c.view.sprint.assessment.intents.length} intention(s)`);
  if (c.view.sprint.stage === "select")
    await c.send("select_intents", [c.view.sprint.assessment.intents[0].id]);
  for (const q of c.view.sprint.clarification?.questions ?? []) {
    const option = q.options[0];
    await c.send("answer", {
      questionId: q.id,
      optionId: option?.id ?? null,
      customText: option
        ? null
        : "Home, about and 3 case studies, text written.",
      status: "confirmed",
      source: option ? "user_selected" : "user_custom",
    });
  }
  step(
    `answered ${c.view.sprint.clarification?.questions?.length ?? 0} question(s)`,
  );
  await c.send("synthesize", {});
  await c.settle("goal");
  check(c.view.sprint.goals.length, "no goal suggestion");
  step(`AI goal suggestion: ${c.view.sprint.goals.length} goal(s)`);
  // A follow-up question during the steps call resumes as a new goal
  // proposal (new scope is always reviewed), so approve it again and retry.
  for (let round = 0; round < 3 && !c.view.sprint.stories.length; round++) {
    if (c.view.sprint.stage === "goals") {
      await c.send("approve_goals", {}, "goals");
      step("approved the goal");
    }
    await c.send("generate_stories");
    await c.settle("steps");
  }
  check(c.view.sprint.stories.length, "no steps suggested");
  const steps = c.view.sprint.stories.flatMap((s: Json) => s.tasks).length;
  step(
    `AI steps: ${c.view.sprint.stories.length} milestone(s), ${steps} step(s)`,
  );
  await c.send("approve_stories", {}, "stories");
  await c.send("schedule");
  check(c.view.sprint.allocations.length, "the schedule was not built");
  await c.send("request_schedule_advice");
  check(
    c.view.sprint.scheduleAdvice?.status === "ready",
    "the AI schedule notes did not come through",
  );
  step(
    `schedule built; AI notes: ${c.view.sprint.scheduleAdvice.notes.length}`,
  );
  await c.send("approve_schedule", { acknowledgeRisk: true }, "schedule");
  check(
    c.view.sprint.approvals.some((a: Json) => a.kind === "schedule"),
    "schedule approval missing",
  );
  step("approved the plan");

  const saved = c.view.sprint;
  const reloaded = (await c.reload()).sprint;
  check(reloaded.revision === saved.revision, "revision changed on reload");
  check(
    JSON.stringify(reloaded.goals) === JSON.stringify(saved.goals) &&
      JSON.stringify(reloaded.stories) === JSON.stringify(saved.stories) &&
      JSON.stringify(reloaded.allocations) ===
        JSON.stringify(saved.allocations) &&
      JSON.stringify(reloaded.approvals) === JSON.stringify(saved.approvals),
    "the reloaded plan differs from the approved plan",
  );
  step("reloaded: the approved plan was saved unchanged");
  console.log("\nAI planning check passed.");
}

main().catch((error) => {
  console.error(
    `\nAI planning check FAILED: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
