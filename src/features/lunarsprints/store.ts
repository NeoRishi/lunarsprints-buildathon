import { adminClient } from "@/lib/supabase/server";
import type { Command, Sprint } from "./contracts";
import { AppError } from "./domain";
import type { RunRecord } from "./agents/managed";
export async function replay(
  userId: string,
  key: string,
  requestHash: string,
): Promise<Sprint | null> {
  const db = adminClient();
  const { data, error } = await db
    .from("ls_commands")
    .select("request_hash,result")
    .eq("user_id", userId)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (error)
    throw new AppError(
      "database_unavailable",
      "Could not check the last saved command.",
      503,
    );
  if (data && data.request_hash !== requestHash)
    throw new AppError(
      "idempotency_conflict",
      "This retry key was used for a different request.",
      409,
    );
  return (data?.result as Sprint) ?? null;
}
export async function rateLimit(
  userId: string,
  bucket: string,
  limit: number,
  seconds: number,
) {
  const { data, error } = await adminClient().rpc("ls_claim_rate", {
    p_user: userId,
    p_bucket: bucket,
    p_limit: limit,
    p_seconds: seconds,
  });
  if (error)
    throw new AppError(
      "database_unavailable",
      "Usage protection is unavailable. Please try again.",
      503,
    );
  if (!data)
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
  const { data, error } = await adminClient().rpc("ls_commit", {
    p_user: userId,
    p_sprint: command.sprintId,
    p_expected: command.expectedRevision,
    p_key: command.idempotencyKey,
    p_request_hash: requestHash,
    p_action: command.action,
    p_state: state,
    p_approved_hash: command.hash ?? null,
  });
  if (error) {
    const conflict =
      /stale_revision|idempotency_conflict|invalid_revision/.test(
        error.message,
      );
    throw new AppError(
      conflict ? "stale_revision" : "database_unavailable",
      conflict
        ? "This plan changed in another session. Refresh and review the latest version."
        : "The database could not save this change. Your last saved plan is safe.",
      conflict ? 409 : 503,
    );
  }
  return data as Sprint;
}
export async function recordRuns(
  userId: string,
  sprintId: string,
  runs: RunRecord[],
) {
  if (!runs.length) return;
  const { error } = await adminClient()
    .from("ls_agent_runs")
    .insert(
      runs.map((r) => ({
        user_id: userId,
        sprint_id: sprintId,
        role: r.role,
        resource_id: r.resourceId,
        session_id: r.sessionId,
        turn_id: r.turnId,
        status: r.status,
        duration_ms: r.durationMs,
        error_code: r.errorCode,
        metrics: r.metrics,
      })),
    );
  if (error)
    console.error("Agent run telemetry write failed", { code: error.code });
}
