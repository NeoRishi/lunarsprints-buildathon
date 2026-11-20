import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";

/**
 * In-memory PostgreSQL for fast unit tests. Creates the same two roles as
 * scripts/db-setup.ts and applies db/migrations in order as ls_owner.
 * tests/rls.test.ts repeats these checks on a real PostgreSQL server.
 */
export async function migratedDatabase(users: string[]) {
  const db = new PGlite();
  await db.exec(
    "create role ls_owner nosuperuser nobypassrls; create role ls_app nosuperuser nobypassrls; grant create, usage on schema public to ls_owner; grant usage on schema public to ls_app;",
  );
  await db.exec("set role ls_owner");
  for (const file of (await readdir("db/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("db/migrations/" + file, "utf8"));
  await db.exec("reset role");
  for (const id of users)
    await db.query(
      "insert into public.ls_users(id, firebase_uid, email) values ($1, $2, $3)",
      [id, `uid-${id}`, `${id.slice(0, 4)}@example.com`],
    );
  return db;
}

/** Runs fn as the app role with app.user_id set, like withUser in src/lib/db.ts. */
export function asUser<T>(
  db: PGlite,
  userId: string | null,
  fn: (tx: Transaction) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role ls_app");
    if (userId)
      await tx.query("select set_config('app.user_id', $1, true)", [userId]);
    return fn(tx);
  });
}
