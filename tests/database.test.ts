import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { newSprint } from "../src/features/lunarsprints/coordinator";
import { asUser, migratedDatabase } from "./pglite";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const id = crypto.randomUUID();
let db: PGlite;
const state = newSprint(id, {
  startDate: "2026-10-28",
  timezone: "Asia/Kolkata",
  capacityMinutes: 600,
  dailyMinutes: Array(15).fill(60),
  bufferPercent: 20,
});
beforeAll(async () => {
  db = await migratedDatabase([a, b]);
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
  return asUser(db, owner, (tx) =>
    tx.query<{ ls_commit: typeof state }>(
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
    ),
  );
}
const count = async (table: string) =>
  (
    await db.query<{ n: number }>(
      `select count(*)::int as n from public.${table}`,
    )
  ).rows[0].n;

describe("PostgreSQL migration, RLS and transactional command boundary", () => {
  let key: string;
  it("forces Row Level Security on every ls_ table", async () => {
    const tables = await db.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      "select relname, relrowsecurity, relforcerowsecurity from pg_class where relkind='r' and relname like 'ls\\_%'",
    );
    expect(tables.rows.length).toBeGreaterThanOrEqual(7);
    for (const t of tables.rows) {
      expect(t.relrowsecurity, t.relname).toBe(true);
      expect(t.relforcerowsecurity, t.relname).toBe(true);
    }
  });
  it("creates an aggregate, revision and event atomically", async () => {
    key = crypto.randomUUID();
    const result = await commit(a, key, -1, state);
    expect(result.rows[0].ls_commit.revision).toBe(0);
    expect(await count("ls_revisions")).toBe(1);
  });
  it("replays exactly once under idempotency and rejects reuse with a different payload hash", async () => {
    const result = await commit(a, key, -1, state);
    expect(result.rows[0].ls_commit).toEqual(state);
    await expect(
      commit(a, key, -1, state, "different-request"),
    ).rejects.toThrow("idempotency_conflict");
    expect(await count("ls_events")).toBe(1);
  });
  it("isolates two users with RLS, and shows nothing when no user is set", async () => {
    await asUser(db, a, async (tx) => {
      expect(
        (await tx.query("select id from public.ls_sprints")).rows,
      ).toHaveLength(1);
    });
    for (const who of [b, null])
      await asUser(db, who, async (tx) => {
        expect(
          (await tx.query("select id from public.ls_sprints")).rows,
        ).toHaveLength(0);
        expect(
          (await tx.query("select sprint_id from public.ls_revisions")).rows,
        ).toHaveLength(0);
      });
  });
  it("refuses a command whose user does not match the signed-in user", async () => {
    await expect(
      asUser(db, b, (tx) =>
        tx.query("select public.ls_commit($1,$2,0,$3,$4,$5,$6::jsonb,null)", [
          a,
          id,
          crypto.randomUUID(),
          "forged",
          "capture",
          JSON.stringify({ ...state, revision: 1 }),
        ]),
      ),
    ).rejects.toThrow("identity_mismatch");
    expect(await count("ls_revisions")).toBe(1);
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
    expect(await count("ls_revisions")).toBe(2);
  });
  it("keeps audit history append-only for the application role too", async () => {
    for (const sql of [
      "update public.ls_events set action='forged'",
      "delete from public.ls_revisions",
      "update public.ls_revisions set state='{}'::jsonb",
      "delete from public.ls_commands",
    ])
      await expect(asUser(db, a, (tx) => tx.query(sql))).rejects.toThrow(
        "permission denied",
      );
  });
  it("limits requests across processes using database counters", async () => {
    const claim = () =>
      asUser(db, a, (tx) =>
        tx.query<{ allowed: boolean }>(
          "select public.ls_claim_rate($1,$2,2,3600) as allowed",
          [a, "test"],
        ),
      );
    for (let i = 0; i < 2; i++)
      expect((await claim()).rows[0].allowed).toBe(true);
    expect((await claim()).rows[0].allowed).toBe(false);
  });
  it("creates users once per Firebase account and returns the same id", async () => {
    const first = await asUser(db, null, (tx) =>
      tx.query<{ id: string }>(
        "select public.ls_sign_in('fb-new','n@example.com') as id",
      ),
    );
    const again = await asUser(db, null, (tx) =>
      tx.query<{ id: string }>(
        "select public.ls_sign_in('fb-new','n@example.com') as id",
      ),
    );
    expect(again.rows[0].id).toBe(first.rows[0].id);
    const found = await asUser(db, null, (tx) =>
      tx.query<{ id: string }>("select public.ls_user_id('fb-new') as id"),
    );
    expect(found.rows[0].id).toBe(first.rows[0].id);
  });
});

it("persists aggregate usage with owner-only RLS and rejects non-object metrics", async () => {
  await asUser(db, a, (tx) =>
    tx.query(
      "insert into public.ls_agent_runs(user_id,sprint_id,role,resource_id,status,duration_ms,metrics) values($1,$2,'story_decomposer','saved-fixture','ok',1200,$3::jsonb)",
      [
        a,
        id,
        JSON.stringify({
          model: "test-model",
          inputTokens: 120,
          outputTokens: 80,
        }),
      ],
    ),
  );
  for (const [owner, n] of [
    [a, 1],
    [b, 0],
  ] as const)
    await asUser(db, owner, async (tx) => {
      const result = await tx.query<{ metrics: { inputTokens: number } }>(
        "select metrics from public.ls_agent_runs",
      );
      expect(result.rows).toHaveLength(n);
      if (n) expect(result.rows[0].metrics.inputTokens).toBe(120);
    });
  await expect(
    asUser(db, a, (tx) =>
      tx.query(
        "insert into public.ls_agent_runs(user_id,sprint_id,role,resource_id,status,duration_ms,metrics) values($1,$2,'story_decomposer','saved-fixture','ok',1200,'[]'::jsonb)",
        [a, id],
      ),
    ),
  ).rejects.toThrow("ls_agent_runs_metrics_object");
  await expect(
    asUser(db, b, (tx) =>
      tx.query(
        "insert into public.ls_agent_runs(user_id,sprint_id,role,resource_id,status,duration_ms) values($1,$2,'story_decomposer','forged','ok',1)",
        [a, id],
      ),
    ),
  ).rejects.toThrow("row-level security");
});
