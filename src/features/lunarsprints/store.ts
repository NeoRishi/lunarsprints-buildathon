import { withUser } from "@/lib/db";
import type { Command, Sprint } from "./contracts";
import { AppError } from "./domain";
import type { RunRecord } from "./agents/intelligence";

/**
 * Every query here runs through withUser, so Row Level Security limits it to
 * the server-verified user. The explicit user_id filters are a second guard.
 */
function dbError(message: string) {
  return (error: unknown): never => {
    if (error instanceof AppError) throw error;
    throw new AppError("database_unavailable", message, 503);
  };
}

export async function replay(
  userId: string,
  key: string,
  requestHash: string,
): Promise<Sprint | null> {
  const row = await withUser(userId, async (db) => {
    const { rows } = await db.query<{ request_hash: string; result: Sprint }>(
      "select request_hash, result from public.ls_commands where user_id=$1 and idempotency_key=$2",
      [userId, key],
    );
    return rows[0] ?? null;
  }).catch(dbError("Could not check the last saved command."));
  if (row && row.request_hash !== requestHash)
    throw new AppError(
      "idempotency_conflict",
      "This retry key was used for a different request.",
      409,
    );
  return row?.result ?? null;
}

export async function rateLimit(
  userId: string,
  bucket: string,
  limit: number,
  seconds: number,
) {
  const allowed = await withUser(userId, async (db) => {
    const { rows } = await db.query<{ allowed: boolean }>(
      "select public.ls_claim_rate($1,$2,$3,$4) as allowed",
      [userId, bucket, limit, seconds],
    );
    return rows[0]?.allowed === true;
  }).catch(dbError("Usage protection is unavailable. Please try again."));
  if (!allowed)
    throw new AppError(
      "rate_limited",
      "You’ve made several requests. Please wait before trying again.",
      429,
    );
}

export async function commit(
  userId: string,
  command: Command,
  state: Sprint,
  requestHash: string,
) {
  try {
    return await withUser(userId, async (db) => {
      const { rows } = await db.query<{ result: Sprint }>(
        "select public.ls_commit($1,$2,$3,$4,$5,$6,$7::jsonb,$8) as result",
        [
          userId,
          command.sprintId,
          command.expectedRevision,
          command.idempotencyKey,
          requestHash,
          command.action,
          JSON.stringify(state),
          command.hash ?? null,
        ],
      );
      return rows[0].result;
    });
  } catch (error) {
    if (error instanceof AppError && error.code !== "database_unavailable")
      throw error;
    const message = error instanceof Error ? error.message : "";
    const conflict = /stale_revision|idempotency_conflict|invalid_revision/.test(
      message,
    );
    throw new AppError(
      conflict ? "stale_revision" : "database_unavailable",
      conflict
        ? "This plan changed in another session. Refresh and review the latest version."
        : "The database could not save this change. Your last saved plan is safe.",
      conflict ? 409 : 503,
    );
  }
}

export async function recordRuns(
  userId: string,
  sprintId: string,
  runs: RunRecord[],
) {
  if (!runs.length) return;
  try {
    await withUser(userId, async (db) => {
      for (const r of runs)
        await db.query(
          `insert into public.ls_agent_runs(user_id,sprint_id,role,resource_id,session_id,turn_id,status,duration_ms,error_code,metrics)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [
            userId,
            sprintId,
            r.role,
            r.resourceId,
            r.sessionId ?? null,
            r.turnId ?? null,
            r.status,
            r.durationMs,
            r.errorCode ?? null,
            JSON.stringify(r.metrics ?? {}),
          ],
        );
    });
  } catch (error) {
    // Usage records never block the user's saved plan. Log without details.
    console.error("Agent run telemetry write failed", {
      code: (error as { code?: string })?.code ?? "unknown",
    });
  }
}

export type SprintRow = Sprint & { archivedAt?: string };

/** The saved snapshot of one sprint, or null when it is not this user's. */
export async function loadSprint(
  userId: string,
  sprintId: string,
): Promise<SprintRow | null> {
  return withUser(userId, async (db) => {
    const { rows } = await db.query<{ state: SprintRow }>(
      "select state from public.ls_sprints where id::text=$1 and user_id=$2",
      [sprintId, userId],
    );
    return rows[0]?.state ?? null;
  }).catch(dbError("Could not load your sprint."));
}

export type SprintSummary = {
  id: string;
  revision: number;
  stage: Sprint["stage"];
  goalTitle: string | null;
  intention: string | null;
  startDate: string;
  endDate: string;
};

/** Up to 50 unarchived sprints, newest first, summary fields only. */
export async function listSprints(userId: string): Promise<SprintSummary[]> {
  return withUser(userId, async (db) => {
    const { rows } = await db.query<SprintSummary>(
      `select id::text as id, revision,
         state->>'stage' as stage,
         state->'goals'->0->>'title' as "goalTitle",
         state->>'intention' as intention,
         state->>'startDate' as "startDate",
         state->>'endDate' as "endDate"
       from public.ls_sprints
       where user_id=$1 and state->>'archivedAt' is null
       order by updated_at desc limit 50`,
      [userId],
    );
    return rows;
  }).catch(dbError("Could not load your saved sprints."));
}

export type ActiveRow = {
  id: string;
  endDate: string | null;
  timezone: string | null;
  archivedAt: string | null;
};

/** This user's sprints in the active stage, for plan limits. */
export async function activeSprints(userId: string): Promise<ActiveRow[]> {
  return withUser(userId, async (db) => {
    const { rows } = await db.query<ActiveRow>(
      `select id::text as id, state->>'endDate' as "endDate",
         state->>'timezone' as timezone, state->>'archivedAt' as "archivedAt"
       from public.ls_sprints where user_id=$1 and state->>'stage'='active'`,
      [userId],
    );
    return rows;
  }).catch(dbError("Could not check your active sprints."));
}
