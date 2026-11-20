import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { newSprint } from "../src/features/lunarsprints/coordinator";
import {
  AppError,
  addDays,
  capacity,
  planSchedule,
  sprintDays,
  todayIn,
  validateSchedule,
  validateWindow,
} from "../src/features/lunarsprints/domain";
import {
  assertCanActivate,
  planFor,
} from "../src/features/lunarsprints/entitlements";
import { sprint, story } from "./fixtures";

const base = {
  startDate: "2026-11-05",
  timezone: "Asia/Kolkata",
  capacityMinutes: null,
  bufferPercent: 20,
};
const make = (days: number, extra: Record<string, unknown> = {}) =>
  newSprint(crypto.randomUUID(), {
    ...base,
    endDate: addDays(base.startDate, days - 1),
    dailyMinutes: Array(days).fill(60),
    ...extra,
  });
function code(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : "other";
  }
  return "no_error";
}

describe("variable sprint duration", () => {
  it("keeps older clients on 15 inclusive days when endDate is omitted", () => {
    const s = newSprint(crypto.randomUUID(), {
      ...base,
      dailyMinutes: Array(15).fill(60),
    });
    expect(s.endDate).toBe("2026-11-19");
    expect(sprintDays(s)).toBe(15);
  });
  it("accepts the 3-day minimum and the 45-day maximum", () => {
    expect(sprintDays(make(3))).toBe(3);
    expect(sprintDays(make(45))).toBe(45);
    expect(make(7).assistantMessage).toContain("next 7 days");
  });
  it("rejects windows outside 3 to 45 days", () => {
    // Daily values pass the schema so the window check itself is exercised.
    const window = (days: number) => () =>
      make(days, { dailyMinutes: Array(15).fill(60) });
    expect(code(window(2))).toBe("invalid_input");
    expect(code(window(46))).toBe("invalid_input");
    expect(code(() => validateWindow("2026-11-05", "2026-11-04"))).toBe(
      "invalid_input",
    );
  });
  it("requires exactly one availability value per sprint day", () => {
    expect(code(() => make(10, { dailyMinutes: Array(15).fill(60) }))).toBe(
      "invalid_input",
    );
  });
  it("applies a plan cap as a plan limit, not a validation error", () => {
    expect(
      code(() =>
        newSprint(
          crypto.randomUUID(),
          {
            ...base,
            endDate: addDays(base.startDate, 15),
            dailyMinutes: Array(16).fill(60),
          },
          { maxDays: 15 },
        ),
      ),
    ).toBe("plan_limit");
  });
  it("rejects past or far-future starts when the route enforces the window", () => {
    const today = todayIn("Asia/Kolkata");
    const at = (start: string) => () =>
      newSprint(
        crypto.randomUUID(),
        {
          ...base,
          startDate: start,
          endDate: addDays(start, 6),
          dailyMinutes: Array(7).fill(60),
        },
        { enforceStartWindow: true },
      );
    expect(code(at(addDays(today, -1)))).toBe("invalid_input");
    expect(code(at(addDays(today, 91)))).toBe("invalid_input");
    expect(code(at(today))).toBe("no_error");
  });
  it("schedules and measures capacity across a 45-day sprint", () => {
    const s = sprint();
    s.endDate = addDays(s.startDate, 44);
    s.dailyMinutes = Array(45).fill(60);
    s.goals[0].deadline = s.endDate;
    s.stories = [structuredClone(story)];
    s.approvals = [];
    const allocations = planSchedule(s);
    expect(allocations.every((a) => a.date <= s.endDate)).toBe(true);
    expect(capacity(s, allocations).dayLoads).toHaveLength(45);
  });
  it("keeps a 3-day sprint inside its own dates", () => {
    const s = sprint();
    s.endDate = addDays(s.startDate, 2);
    s.dailyMinutes = Array(3).fill(960);
    s.goals[0].deadline = s.endDate;
    s.stories = [structuredClone(story)];
    const allocations = planSchedule(s);
    expect(capacity(s, allocations).dayLoads).toHaveLength(3);
    const late = allocations.map((a, i) =>
      i === 0 ? { ...a, date: addDays(s.endDate, 1) } : a,
    );
    expect(code(() => validateSchedule(s, late))).toBe("invalid_input");
  });
});

describe("plan limits", () => {
  const free = planFor("user-a", "");
  const plus = planFor("user-a", "user-b, user-a");
  const running = {
    id: "other",
    endDate: addDays(todayIn("Asia/Kolkata"), 3),
    timezone: "Asia/Kolkata",
  };
  it("defaults everyone to free and grants plus only to listed ids", () => {
    expect(free).toMatchObject({
      id: "free",
      maxActiveSprints: 1,
      maxSprintDays: 15,
    });
    expect(plus).toMatchObject({
      id: "plus",
      maxActiveSprints: 3,
      maxSprintDays: 45,
    });
  });
  it("allows one active sprint on free", () => {
    expect(code(() => assertCanActivate(free, "new", []))).toBe("no_error");
    expect(code(() => assertCanActivate(free, "new", [running]))).toBe(
      "plan_limit",
    );
    // Re-activating the same sprint is not a second active sprint.
    expect(code(() => assertCanActivate(free, "other", [running]))).toBe(
      "no_error",
    );
  });
  it("ignores finished and archived sprints", () => {
    const ended = { ...running, endDate: addDays(todayIn("Asia/Kolkata"), -1) };
    const archived = { ...running, archivedAt: "2026-11-01T00:00:00Z" };
    expect(code(() => assertCanActivate(free, "new", [ended, archived]))).toBe(
      "no_error",
    );
  });
  it("allows up to three on plus", () => {
    const two = [running, { ...running, id: "other-2" }];
    expect(code(() => assertCanActivate(plus, "new", two))).toBe("no_error");
    expect(
      code(() =>
        assertCanActivate(plus, "new", [...two, { ...running, id: "other-3" }]),
      ),
    ).toBe("plan_limit");
  });
});

describe("variable duration migration", () => {
  const owner = "33333333-3333-4333-8333-333333333333";
  const db = new PGlite();
  beforeAll(async () => {
    await db.exec(
      `create schema auth; create role anon; create role authenticated; create role service_role bypassrls; create table auth.users(id uuid primary key); insert into auth.users values('${owner}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema public,auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;`,
    );
    for (const file of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  });
  afterAll(async () => {
    await db.close();
  });
  const create = (state: ReturnType<typeof make>) =>
    db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      return tx.query(
        "select public.ls_commit($1,$2,-1,$3,'h','create',$4::jsonb,null)",
        [owner, state.id, crypto.randomUUID(), JSON.stringify(state)],
      );
    });
  it("stores 3, 15 and 45 day sprints", async () => {
    for (const days of [3, 15, 45]) await create(make(days));
    const rows = await db.query<{ n: number }>(
      "select count(*)::int as n from public.ls_sprints",
    );
    expect(rows.rows[0].n).toBe(3);
  });
  it("still rejects windows outside 3 to 45 days at the database", async () => {
    for (const days of [2, 46]) {
      const s = make(15);
      s.endDate = addDays(s.startDate, days - 1);
      await expect(create(s)).rejects.toThrow(/ls_sprints_window_check/);
    }
  });
});
