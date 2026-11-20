/**
 * Row Level Security on a real PostgreSQL server, connected as ls_app through
 * the same withUser helper the app uses. Run with: npm run test:rls
 * Needs DATABASE_URL_TEST (and npm run db:migrate:test). It fails, never
 * skips, when that is missing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";

const TEST_URL = process.env.DATABASE_URL_TEST;
if (!TEST_URL)
  throw new Error(
    "DATABASE_URL_TEST is not set. The RLS tests need the local lunarsprints_test database (see README: Run locally). They do not skip.",
  );
// The app pool reads DATABASE_URL. Point it at the test database only.
process.env.DATABASE_URL = TEST_URL;

const { withUser, withoutUser, closePool } = await import("../src/lib/db");
const { newSprint } = await import("../src/features/lunarsprints/coordinator");

const run = crypto.randomUUID().slice(0, 8);
let userA = "";
let userB = "";
const sprintId = crypto.randomUUID();

const USER_TABLES = [
  "ls_users",
  "ls_sprints",
  "ls_revisions",
  "ls_commands",
  "ls_events",
  "ls_agent_runs",
  "ls_rate_limits",
] as const;

async function signIn(label: string) {
  return withoutUser(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      "select public.ls_sign_in($1,$2)::text as id",
      [`rls-${run}-${label}`, `rls-${run}-${label}@example.com`],
    );
    return rows[0].id;
  });
}

const ownerColumn = (table: string) =>
  table === "ls_users" ? "id" : "user_id";

async function rowsFor(owner: string, table: string, db: PoolClient) {
  const { rows } = await db.query(
    `select * from public.${table} where ${ownerColumn(table)}=$1`,
    [owner],
  );
  return rows.length;
}

beforeAll(async () => {
  userA = await signIn("a");
  userB = await signIn("b");
  const state = newSprint(sprintId, {
    startDate: "2026-11-20",
    timezone: "Asia/Kolkata",
    capacityMinutes: 600,
    dailyMinutes: Array(15).fill(60),
    bufferPercent: 20,
  });
  await withUser(userA, async (db) => {
    await db.query(
      "select public.ls_commit($1,$2,-1,$3,'h','create',$4::jsonb,null)",
      [userA, sprintId, crypto.randomUUID(), JSON.stringify(state)],
    );
    await db.query(
      "insert into public.ls_agent_runs(user_id,sprint_id,role,resource_id,status,duration_ms) values($1,$2,'reflection','rls-test','ok',1)",
      [userA, sprintId],
    );
    await db.query("select public.ls_claim_rate($1,'rls',5,60)", [userA]);
  });
});

afterAll(async () => {
  await closePool();
});

describe("Row Level Security on PostgreSQL as ls_app", () => {
  it("connects as a role that cannot skip RLS or own the tables", async () => {
    const role = await withoutUser(async (db) => {
      const { rows } = await db.query(
        `select current_user as name, r.rolsuper, r.rolbypassrls,
          exists(select 1 from pg_tables t where t.tablename like 'ls\\_%' and t.tableowner=current_user) as owns
         from pg_roles r where r.rolname=current_user`,
      );
      return rows[0];
    });
    expect(role).toMatchObject({
      name: "ls_app",
      rolsuper: false,
      rolbypassrls: false,
      owns: false,
    });
  });

  it("has RLS enabled and forced on every ls_ table", async () => {
    const tables = await withoutUser(async (db) => {
      const { rows } = await db.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        "select relname, relrowsecurity, relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'ls\\_%'",
      );
      return rows;
    });
    expect(tables.map((t) => t.relname).sort()).toEqual(
      expect.arrayContaining([...USER_TABLES, "ls_schema_migrations"]),
    );
    for (const t of tables) {
      expect(t.relrowsecurity, t.relname).toBe(true);
      expect(t.relforcerowsecurity, t.relname).toBe(true);
    }
  });

  it("user A can see their own row in every table that holds user data", async () => {
    await withUser(userA, async (db) => {
      for (const table of USER_TABLES)
        expect(await rowsFor(userA, table, db), table).toBeGreaterThan(0);
    });
  });

  it("(a) user B cannot read user A's rows in any table", async () => {
    await withUser(userB, async (db) => {
      for (const table of USER_TABLES)
        expect(await rowsFor(userA, table, db), table).toBe(0);
    });
  });

  it("(a) user B cannot update or delete user A's rows in any table", async () => {
    for (const table of USER_TABLES) {
      for (const sql of [
        `update public.${table} set ${table === "ls_rate_limits" ? "count=count" : "created_at=created_at"} where ${ownerColumn(table)}=$1`,
        `delete from public.${table} where ${ownerColumn(table)}=$1`,
      ]) {
        const outcome = await withUser(userB, async (db) => {
          const result = await db.query(sql, [userA]);
          return result.rowCount;
        }).catch((error: Error) => error.message);
        // Either the role has no such right at all, or RLS hides every row.
        if (typeof outcome === "string")
          expect(outcome, `${table}: ${sql}`).toMatch(/permission denied/);
        else expect(outcome, `${table}: ${sql}`).toBe(0);
      }
    }
    // And user A's data is unchanged.
    await withUser(userA, async (db) => {
      for (const table of USER_TABLES)
        expect(await rowsFor(userA, table, db), table).toBeGreaterThan(0);
    });
  });

  it("(a) user B cannot write rows that claim to belong to user A", async () => {
    await expect(
      withUser(userB, (db) =>
        db.query(
          "insert into public.ls_agent_runs(user_id,sprint_id,role,resource_id,status,duration_ms) values($1,$2,'reflection','forged','ok',1)",
          [userA, sprintId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withUser(userB, (db) =>
        db.query("select public.ls_claim_rate($1,'rls',5,60)", [userA]),
      ),
    ).rejects.toThrow(/identity_mismatch/);
  });

  it("(b) returns no rows when app.user_id is not set", async () => {
    await withoutUser(async (db) => {
      for (const table of USER_TABLES) {
        const { rows } = await db.query(`select * from public.${table}`);
        expect(rows, table).toHaveLength(0);
      }
    });
  });

  it("(c) immutable plan revisions and audit history cannot be changed", async () => {
    for (const sql of [
      "update public.ls_revisions set state='{}'::jsonb where sprint_id=$1",
      "delete from public.ls_revisions where sprint_id=$1",
      "update public.ls_events set action='forged' where sprint_id=$1",
      "delete from public.ls_commands where sprint_id=$1",
      "update public.ls_agent_runs set status='error' where sprint_id=$1",
    ])
      await expect(
        withUser(userA, (db) => db.query(sql, [sprintId])),
        sql,
      ).rejects.toThrow(/permission denied/);
    await expect(
      withUser(userA, (db) => db.query("truncate public.ls_revisions")),
    ).rejects.toThrow(/permission denied/);
  });

  it("the migration runner is safe to run twice", async () => {
    const { migrate } = await import("../scripts/migrate");
    const pg = (await import("pg")).default;
    const owner = process.env.DATABASE_URL_OWNER;
    if (!owner)
      throw new Error("DATABASE_URL_OWNER is not set. See .env.example.");
    const url = new URL(owner);
    url.pathname = new URL(TEST_URL).pathname;
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    const lines: string[] = [];
    try {
      await migrate(client, (line) => lines.push(line));
      await migrate(client, (line) => lines.push(line));
    } finally {
      await client.end();
    }
    expect(lines.at(-1)).toContain("up to date");
  });
});
