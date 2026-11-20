import pg from "pg";
import { AppError } from "@/features/lunarsprints/domain";

/**
 * One connection pool for the app, built only from DATABASE_URL, which must
 * connect as ls_app (never the owner or a superuser).
 *
 * Step 2B (Cloud SQL) changes config only: point DATABASE_URL at the Cloud SQL
 * unix socket, for example
 *   postgres://ls_app:PASSWORD@/lunarsprints?host=/cloudsql/PROJECT:REGION:INSTANCE
 */
let pool: pg.Pool | null = null;
let roleCheck: Promise<void> | null = null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function unavailable() {
  return new AppError(
    "database_unavailable",
    "Saving is unavailable right now. Your saved plans are safe. Please try again shortly.",
    503,
  );
}

function getPool() {
  if (!process.env.DATABASE_URL) throw unavailable();
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    // An idle client error must not crash the server; the next query reconnects.
    pool.on("error", () => {
      console.error("Database pool connection error");
    });
  }
  return pool;
}

/**
 * Refuses to run user queries on a role that could skip Row Level Security.
 * Checked once per process.
 */
async function assertSafeRole(client: pg.PoolClient) {
  roleCheck ??= (async () => {
    const { rows } = await client.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      owns: boolean;
    }>(
      `select r.rolsuper, r.rolbypassrls,
        exists(select 1 from pg_tables t where t.schemaname='public' and t.tablename like 'ls\\_%' and t.tableowner=current_user) as owns
       from pg_roles r where r.rolname=current_user`,
    );
    const role = rows[0];
    if (!role || role.rolsuper || role.rolbypassrls || role.owns)
      throw new AppError(
        "configuration_error",
        "This deployment is misconfigured. Your saved plans are safe. Please try again later.",
        503,
      );
  })().catch((error) => {
    roleCheck = null;
    throw error;
  });
  return roleCheck;
}

async function connect() {
  let client: pg.PoolClient;
  try {
    client = await getPool().connect();
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Database connection failed");
    throw unavailable();
  }
  try {
    await assertSafeRole(client);
  } catch (error) {
    client.release();
    if (error instanceof AppError) throw error;
    throw unavailable();
  }
  return client;
}

/**
 * Runs fn in one transaction with app.user_id set to the server-verified user.
 * Every Row Level Security policy reads that setting. Rolls back on any error.
 */
export async function withUser<T>(
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!UUID.test(userId))
    throw new AppError("unauthenticated", "Sign in to continue.", 401);
  const client = await connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Queries that run before a user id is known: the sign-in functions and the
 * health check. They still run as ls_app, never as the owner.
 */
export async function withoutUser<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** For tests and graceful shutdown. */
export async function closePool() {
  const current = pool;
  pool = null;
  roleCheck = null;
  await current?.end();
}
