import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { newSprint } from "../src/features/lunarsprints/coordinator";
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const id = crypto.randomUUID();
const db = new PGlite();
const state = newSprint(id, {
  startDate: "2026-10-28",
  timezone: "Asia/Kolkata",
  capacityMinutes: 600,
  dailyMinutes: Array(15).fill(60),
  bufferPercent: 20,
});
beforeAll(async () => {
  await db.exec(
    `create schema auth; create role anon; create role authenticated; create role service_role bypassrls; create table auth.users(id uuid primary key); insert into auth.users values('${a}'),('${b}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema public,auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;`,
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
});
afterAll(async () => {
  await db.close();
});
async function commit(
  owner: string,
  key: string,
  expected: number,
  payload: unknown,
  requestHash = "same-request",
) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return tx.query<{ ls_commit: typeof state }>(
      "select public.ls_commit($1,$2,$3,$4,$5,$6,$7::jsonb,null)",
      [
        owner,
        id,
        expected,
        key,
        requestHash,
        expected === -1 ? "create" : "capture",
        JSON.stringify(payload),
      ],
    );
  });
}
describe("PostgreSQL migration, RLS and transactional command boundary", () => {
  let key: string;
  it("creates an aggregate, revision and event atomically", async () => {
    key = crypto.randomUUID();
    const result = await commit(a, key, -1, state);
    expect(result.rows[0].ls_commit.revision).toBe(0);
    const revisions = await db.query<{ n: number }>(
      "select count(*)::int as n from public.ls_revisions",
    );
    expect(revisions.rows[0].n).toBe(1);
  });
  it("replays exactly once under idempotency and rejects reuse with a different payload hash", async () => {
    const result = await commit(a, key, -1, state);
    expect(result.rows[0].ls_commit).toEqual(state);
    await expect(
      commit(a, key, -1, state, "different-request"),
    ).rejects.toThrow("idempotency_conflict");
    const events = await db.query<{ n: number }>(
      "select count(*)::int as n from public.ls_events",
    );
    expect(events.rows[0].n).toBe(1);
  });
  it("isolates two authenticated tenants with RLS", async () => {
    await db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [a]);
      expect(
        (await tx.query("select id from public.ls_sprints")).rows,
      ).toHaveLength(1);
    });
    await db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [b]);
      expect(
        (await tx.query("select id from public.ls_sprints")).rows,
      ).toHaveLength(0);
      expect(
        (await tx.query("select sprint_id from public.ls_revisions")).rows,
      ).toHaveLength(0);
    });
  });
  it("does not let an authenticated browser bypass the command service or alter audit history", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("update public.ls_sprints set revision=99 where id=$1", [
          id,
        ]);
      }),
    ).rejects.toThrow("permission denied");
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query(
          "select public.ls_commit($1,$2,0,$3,$4,$5,$6::jsonb,null)",
          [
            a,
            id,
            crypto.randomUUID(),
            "forged",
            "capture",
            JSON.stringify({ ...state, revision: 1 }),
          ],
        );
      }),
    ).rejects.toThrow("permission denied");
  });
  it("rejects stale concurrent edits and rolls back partial writes", async () => {
    const next = { ...state, revision: 1, intention: "A confirmed edit" };
    await commit(a, crypto.randomUUID(), 0, next, "edit-1");
    await expect(
      commit(
        a,
        crypto.randomUUID(),
        0,
        { ...next, intention: "Stale overwrite" },
        "edit-2",
      ),
    ).rejects.toThrow("stale_revision");
    const result = await db.query<{ state: typeof state }>(
      "select state from public.ls_sprints where id=$1",
      [id],
    );
    expect(result.rows[0].state.intention).toBe("A confirmed edit");
    const revisions = await db.query<{ n: number }>(
      "select count(*)::int as n from public.ls_revisions",
    );
    expect(revisions.rows[0].n).toBe(2);
  });
  it("keeps audit history append-only for the application role too", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        await tx.query(
          "update public.ls_events set action=$1 where sprint_id=$2",
          ["forged", id],
        );
      }),
    ).rejects.toThrow("permission denied");
  });
  it("limits requests across processes using database counters", async () => {
    for (let i = 0; i < 2; i++) {
      const r = await db.query<{ allowed: boolean }>(
        "select public.ls_claim_rate($1,$2,2,3600) as allowed",
        [a, "test"],
      );
      expect(r.rows[0].allowed).toBe(true);
    }
    const denied = await db.query<{ allowed: boolean }>(
      "select public.ls_claim_rate($1,$2,2,3600) as allowed",
      [a, "test"],
    );
    expect(denied.rows[0].allowed).toBe(false);
  });
});

it("persists aggregate usage with owner-only RLS and rejects non-object metrics", async () => {
  await db.query(
    "insert into public.ls_agent_runs(user_id,sprint_id,role,resource_id,status,duration_ms,metrics) values($1,$2,'story_decomposer','saved-fixture','ok',1200,$3::jsonb)",
    [
      a,
      id,
      JSON.stringify({
        model: "gpt-6.1-sol",
        inputTokens: 120,
        outputTokens: 80,
      }),
    ],
  );
  for (const [owner, count] of [
    [a, 1],
    [b, 0],
  ] as const)
    await db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        owner,
      ]);
      const result = await tx.query<{ metrics: { inputTokens: number } }>(
        "select metrics from public.ls_agent_runs",
      );
      expect(result.rows).toHaveLength(count);
      if (count) expect(result.rows[0].metrics.inputTokens).toBe(120);
    });
  await expect(
    db.query(
      "insert into public.ls_agent_runs(user_id,sprint_id,role,resource_id,status,duration_ms,metrics) values($1,$2,'story_decomposer','saved-fixture','ok',1200,'[]'::jsonb)",
      [a, id],
    ),
  ).rejects.toThrow("ls_agent_runs_metrics_object");
});
