/**
 * Applies db/migrations/*.sql in name order as ls_owner. Each file runs in its
 * own transaction and is recorded in ls_schema_migrations, so running this
 * twice is safe. Any error stops the run loudly and rolls that file back.
 *
 * Migrations are additive only: never edit or delete a file that has run.
 *
 *   npm run db:migrate              uses DATABASE_URL_OWNER
 *   npm run db:migrate -- --test    same owner, on the DATABASE_URL_TEST database
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

export const MIGRATIONS_DIR = fileURLToPath(
  new URL("../db/migrations/", import.meta.url),
);

export async function migrate(
  client: pg.Client,
  log: (line: string) => void = console.log,
) {
  await client.query(`create table if not exists public.ls_schema_migrations (
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
  await client.query(
    "alter table public.ls_schema_migrations enable row level security",
  );
  await client.query(
    "alter table public.ls_schema_migrations force row level security",
  );
  await client.query(`do $$ begin
    if not exists (select 1 from pg_policies where tablename='ls_schema_migrations' and policyname='ls_schema_migrations_owner') then
      create policy ls_schema_migrations_owner on public.ls_schema_migrations for all to current_user using (true) with check (true);
    end if; end $$`);
  await client.query("revoke all on public.ls_schema_migrations from public");

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const done = new Map(
    (
      await client.query<{ name: string; checksum: string }>(
        "select name, checksum from public.ls_schema_migrations",
      )
    ).rows.map((r) => [r.name, r.checksum]),
  );
  let applied = 0;
  for (const file of files) {
    const sql = await readFile(MIGRATIONS_DIR + file, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = done.get(file);
    if (previous) {
      if (previous !== checksum)
        throw new Error(
          `${file} changed after it was applied. Migrations are additive only: add a new file instead.`,
        );
      continue;
    }
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into public.ls_schema_migrations(name, checksum) values ($1, $2)",
        [file, checksum],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw new Error(
        `${file} failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    applied++;
    log(`applied ${file}`);
  }
  log(
    applied
      ? `${applied} migration(s) applied.`
      : "Database is up to date. Nothing to apply.",
  );
}

function ownerUrl() {
  const owner = process.env.DATABASE_URL_OWNER;
  if (!owner)
    throw new Error("DATABASE_URL_OWNER is not set. See .env.example.");
  if (!process.argv.includes("--test")) return owner;
  const test = process.env.DATABASE_URL_TEST;
  if (!test) throw new Error("DATABASE_URL_TEST is not set. See .env.example.");
  const url = new URL(owner);
  url.pathname = new URL(test).pathname;
  return url.toString();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const client = new pg.Client({ connectionString: ownerUrl() });
  try {
    await client.connect();
    const who = await client.query<{ db: string; usr: string }>(
      "select current_database() as db, current_user as usr",
    );
    console.log(`Migrating database ${who.rows[0].db} as ${who.rows[0].usr}`);
    await migrate(client);
  } catch (error) {
    console.error(
      `MIGRATION FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}
