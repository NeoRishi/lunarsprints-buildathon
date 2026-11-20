import plans from "../../../config/plans.json";
import { MAX_SPRINT_DAYS } from "./contracts";
import { assert, todayIn } from "./domain";

export type PlanId = "free" | "plus";
export type PlanLimits = { maxActiveSprints: number; maxSprintDays: number };
export type Plan = PlanLimits & { id: PlanId };

/**
 * Resolves the caller's plan. There is no payment provider yet, so everyone is
 * on the free plan unless their id is listed in LUNARSPRINTS_PLUS_USER_IDS.
 * When billing arrives, this becomes a read of the verified entitlement record;
 * a checkout return URL must never grant access.
 */
export function planFor(
  userId: string,
  plusUserIds: string | undefined = process.env.LUNARSPRINTS_PLUS_USER_IDS,
): Plan {
  const plus = (plusUserIds ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
  const id: PlanId = plus ? "plus" : "free";
  const limits = plans[id] as PlanLimits;
  return {
    id,
    maxActiveSprints: limits.maxActiveSprints,
    maxSprintDays: Math.min(limits.maxSprintDays, MAX_SPRINT_DAYS),
  };
}

export type ActiveSprintSummary = {
  id: string;
  endDate: string;
  timezone: string;
  archivedAt?: string | null;
};

/** A sprint stops counting as active once its last day has passed. */
export function stillRunning(s: ActiveSprintSummary, now = new Date()) {
  if (s.archivedAt) return false;
  let today: string;
  try {
    today = todayIn(s.timezone);
  } catch {
    today = now.toISOString().slice(0, 10);
  }
  return s.endDate >= today;
}

export function assertCanActivate(
  plan: Plan,
  sprintId: string,
  activeSprints: ActiveSprintSummary[],
) {
  const others = activeSprints.filter(
    (s) => s.id !== sprintId && stillRunning(s),
  );
  assert(
    others.length < plan.maxActiveSprints,
    plan.maxActiveSprints === 1
      ? "You already have an active sprint. Finish or archive it before activating another."
      : `Your plan allows ${plan.maxActiveSprints} active sprints at a time. Finish or archive one before activating another.`,
    "plan_limit",
    402,
  );
}
