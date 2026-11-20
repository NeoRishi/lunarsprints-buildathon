/**
 * One-time local setup: creates the roles ls_owner and ls_app and the
 * databases lunarsprints_dev and lunarsprints_test. Safe to run again.
 *
 * Role names, passwords and database names are read from DATABASE_URL (ls_app),
 * DATABASE_URL_OWNER (ls_owner) and DATABASE_URL_TEST (ls_app on the test
 * database). It connects as a PostgreSQL superuser using the standard PGHOST,
 * PGUSER and PGPASSWORD variables (on a Homebrew install the defaults work).
 * Nothing secret is printed.
 */
import pg from "pg";

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    console.error(`db:setup stopped: ${name} is not set. See .env.example.`);
    process.exit(1);
  }
  return new URL(value);
}

const app = required("DATABASE_URL");
const owner = required("DATABASE_URL_OWNER");
const test = required("DATABASE_URL_TEST");
const name = (url: URL) => decodeURIComponent(url.pathname.slice(1));
const user = (url: URL) => decodeURIComponent(url.username);
const password = (url: URL) => decodeURIComponent(url.password);

if (user(app) === user(owner)) {
  console.error(
    "db:setup stopped: DATABASE_URL and DATABASE_URL_OWNER must use different roles.",
  );
  process.exit(1);
}
if (user(test) !== user(app)) {
  console.error(
    "db:setup stopped: DATABASE_URL_TEST must use the same app role as DATABASE_URL.",
  );
  process.exit(1);
}

const admin = new pg.Client({ database: "postgres" });
await admin.connect();
const ident = (value: string) => admin.escapeIdentifier(value);
const literal = (value: string) => admin.escapeLiteral(value);

async function role(url: URL, attributes: string) {
  const exists = await admin.query("select 1 from pg_roles where rolname=$1", [
    user(url),
  ]);
  const secret = password(url)
    ? `password ${literal(password(url))}`
    : "password null";
  await admin.query(
    `${exists.rowCount ? "alter" : "create"} role ${ident(user(url))} with login ${attributes} ${secret}`,
  );
  console.log(`role ${user(url)}: ${exists.rowCount ? "updated" : "created"}`);
}

// The app role can never own tables, bypass RLS or create objects.
await role(
  owner,
  "nosuperuser nocreatedb nocreaterole nobypassrls noreplication",
);
await role(
  app,
  "nosuperuser nocreatedb nocreaterole nobypassrls noreplication noinherit",
);

for (const database of new Set([name(app), name(test)])) {
  const exists = await admin.query(
    "select 1 from pg_database where datname=$1",
    [database],
  );
  if (!exists.rowCount)
    await admin.query(
      `create database ${ident(database)} owner ${ident(user(owner))}`,
    );
  else
    await admin.query(
      `alter database ${ident(database)} owner to ${ident(user(owner))}`,
    );
  await admin.query(`revoke all on database ${ident(database)} from public`);
  await admin.query(
    `grant connect, temporary on database ${ident(database)} to ${ident(user(app))}`,
  );
  const scoped = new pg.Client({ database });
  await scoped.connect();
  // PostgreSQL 15+ gives the public schema to the database owner. Make that
  // explicit and keep everyone else from creating objects in it.
  await scoped.query(`alter schema public owner to ${ident(user(owner))}`);
  await scoped.query("revoke create on schema public from public");
  await scoped.query(`grant usage on schema public to ${ident(user(app))}`);
  await scoped.end();
  console.log(
    `database ${database}: ${exists.rowCount ? "checked" : "created"}`,
  );
}
await admin.end();
console.log("db:setup finished. Next: npm run db:migrate");
