import { z } from "zod";

export const text = z.string().trim().min(1).max(6000);
/** Inclusive calendar-day bounds for one sprint. Plan limits may narrow these. */
export const MIN_SPRINT_DAYS = 3;
export const MAX_SPRINT_DAYS = 45;
/** Upper bound for any minute total inside one sprint (45 days x 16 hours). */
export const MAX_SPRINT_MINUTES = MAX_SPRINT_DAYS * 960;
/** One entry per calendar day of the sprint; length is checked against its dates. */
export const dailyMinutesSchema = z
  .array(z.number().int().min(0).max(960))
  .min(MIN_SPRINT_DAYS)
  .max(MAX_SPRINT_DAYS);
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const roles = [
  "orchestrator",
  "intent_alignment",
  "smart_goal",
  "capacity",
  "story_decomposer",
  "rhythm",
  "scheduling",
  "daily_execution",
  "adaptive_backlog",
  "reflection",
] as const;
export type Role = (typeof roles)[number];
export const envelope = <T extends z.ZodType>(role: Role, payload: T) =>
  z.object({
    schemaVersion: z.literal("1.0"),
    agentId: z.literal(role),
    status: z.enum(["ok", "needs_clarification", "blocked", "error"]),
    payload: payload.nullable(),
    missingFields: z.array(z.string()),
    assumptions: z.array(z.string()),
    warnings: z.array(
      z.object({
        code: z.string(),
        message: z.string(),
        severity: z.enum(["info", "warning", "blocker"]),
      }),
    ),
    evidence: z.array(
      z.object({
        claim: z.string(),
        sourceType: z.enum([
          "USER_STATED",
          "OBSERVED",
          "DERIVED",
          "ESTIMATED",
          "TRADITIONAL",
          "UNKNOWN",
        ]),
        sourceRef: z.string().nullable(),
        explanation: z.string().nullable(),
      }),
    ),
    userApprovalRequired: z.boolean(),
    proposedNextAction: z.enum([
      "ask_user",
      "show_proposal",
      "invoke_agent",
      "validate",
      "request_approval",
      "finish",
      "retry_later",
    ]),
    clarification: z
      .object({ question: z.string(), options: z.array(z.string()) })
      .nullable(),
  });
/** Stage-specific provenance remains in payloads, without unused narrative duplication. */
export const compactEnvelope = <T extends z.ZodType>(role: Role, payload: T) =>
  z.object({
    schemaVersion: z.literal("2.1"),
    agentId: z.literal(role),
    status: z.enum(["ok", "needs_clarification", "blocked", "error"]),
    payload: payload.nullable(),
    missingFields: z.array(z.string()),
    clarification: z
      .object({ question: z.string(), options: z.array(z.string()).max(4) })
      .nullable(),
    warnings: z.array(
      z.object({
        code: z.string(),
        message: z.string(),
        severity: z.enum(["info", "warning", "blocker"]),
      }),
    ),
  });
export const intentSchema = z.object({
  intents: z
    .array(
      z.object({
        id: text,
        outcome: text,
        why: z.string().nullable(),
        priority: z.number().nullable(),
        conflicts: z.array(z.string()),
      }),
    )
    .min(1)
    .max(8),
  facts: z.array(
    z.object({ key: text, value: text, source: z.literal("user_utterance") }),
  ),
  uncertainties: z.array(z.string()),
  baseline: z.string().nullable(),
  constraints: z.array(z.string()),
  recommendation: z.string(),
});
export const optionSchema = z.object({
  id: text,
  text: text,
  recommended: z.boolean(),
  recommendationReason: z.string().nullable(),
  recommendationBasis: z.enum([
    "user_fact",
    "explicit_tentative_suggestion",
    "none",
  ]),
});
export const questionSchema = z.object({
  id: text,
  intentId: text,
  category: z.enum([
    "specific",
    "measurable",
    "achievable",
    "relevant",
    "time_bound",
    "baseline",
    "constraints",
    "priority",
    "dependency",
    "other",
  ]),
  question: text,
  rationale: text,
  required: z.boolean(),
  options: z.array(optionSchema).max(4),
});
export const clarificationSchema = z.object({
  existingFacts: z.array(
    z.object({
      key: text,
      value: text,
      source: z.enum(["user_utterance", "user_confirmed"]),
    }),
  ),
  missingFacts: z.array(z.string()),
  questions: z.array(questionSchema).max(5),
  canProposeGoalNow: z.boolean(),
  requiresBlockingClarification: z.boolean(),
});
export function clarificationForIntents(ids: [string, ...string[]]) {
  return clarificationSchema.extend({
    questions: z.array(questionSchema.extend({ intentId: z.enum(ids) })).max(5),
  });
}
export function clarificationResponseSchema(
  schema: z.ZodType,
  data: unknown,
): z.ZodType {
  if (
    schema !== clarificationSchema ||
    typeof data !== "object" ||
    data === null ||
    !("selectedIntents" in data) ||
    !Array.isArray(data.selectedIntents)
  )
    return schema;
  const ids = data.selectedIntents.flatMap((item: unknown) =>
    typeof item === "object" &&
    item !== null &&
    "id" in item &&
    typeof item.id === "string"
      ? [item.id]
      : [],
  );
  return ids.length
    ? clarificationForIntents(ids as [string, ...string[]])
    : schema;
}
export const answerSchema = z.object({
  questionId: text,
  optionId: z.string().nullable(),
  customText: z.string().max(2000).nullable(),
  status: z.enum(["confirmed", "skipped", "unanswered"]),
  source: z.enum(["user_selected", "user_custom", "not_answered"]),
});
export const goalSchema = z.object({
  id: text,
  intentId: text,
  title: text,
  statement: text,
  smart: z.object({
    specific: text,
    measurable: text,
    achievable: text,
    relevant: text,
    timeBound: text,
  }),
  completionCriteria: z.array(text).min(1).max(12),
  definitionOfSuccess: text,
  deadline: localDate,
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  feasibility: z.literal("provisional"),
});
export const goalsSchema = z.object({
  goals: z.array(goalSchema).min(1).max(8),
});
export const scopeReadinessSchema = z.object({
  status: z.enum(["ready", "needs_scope"]),
  mode: z.enum(["delivery", "discovery"]),
  scopeSummary: text.nullable(),
  rationale: text,
  evidenceRefs: z.array(text).min(1).max(16),
  clarification: z
    .object({ question: text, options: z.array(text).max(4) })
    .nullable(),
});
export const goalPlanningSchema = goalsSchema.extend({
  readiness: scopeReadinessSchema,
});
export function planningResponseSchema(
  schema: z.ZodType,
  data: unknown,
): z.ZodType {
  if (schema !== goalPlanningSchema && schema !== scopeReadinessSchema)
    return schema;
  if (
    typeof data !== "object" ||
    data === null ||
    !("confirmedFacts" in data) ||
    !Array.isArray(data.confirmedFacts)
  )
    return schema;
  const ids = data.confirmedFacts.flatMap((f: unknown) =>
    typeof f === "object" && f !== null && "id" in f && typeof f.id === "string"
      ? [f.id]
      : [],
  );
  if (!ids.length) return schema;
  const scoped = scopeReadinessSchema.extend({
    evidenceRefs: z
      .array(z.enum(ids as [string, ...string[]]))
      .min(1)
      .max(16),
  });
  return schema === goalPlanningSchema
    ? goalPlanningSchema.extend({ readiness: scoped })
    : scoped;
}
export const clarificationReplySchema = z.object({
  questionId: text,
  status: z.enum(["confirmed", "unknown"]),
  optionId: z.string().nullable(),
  customText: z.string().trim().max(3000).nullable(),
});
export type ClarificationReply = {
  questionId: string;
  question: string;
  value: string;
  source: "user_selected" | "user_custom" | "user_unknown";
  status: "confirmed" | "unknown";
  requestsDiscovery?: boolean;
};
export type PendingClarification = {
  id: string;
  role: Role;
  question: string;
  options: { id: string; text: string }[];
  reason: string;
  missingFields: string[];
  resumeAction: Command["action"];
  resumeData: unknown;
  baseHash: string;
  requiresConsent: boolean;
  consentGranted: boolean;
  reply: ClarificationReply | null;
  createdAt: string;
};
export const subtaskSchema = z.object({
  id: text,
  title: text,
  minutes: z.number().int().min(1).max(25),
  definitionOfDone: text,
});
export const taskSchema = z.object({
  id: text,
  title: text,
  motivation: text,
  minutes: z.number().int().min(1).max(60),
  definitionOfDone: text,
  subtasks: z.array(subtaskSchema).max(8),
});
export const storySchema = z.object({
  id: text,
  goalId: text,
  title: text,
  description: text,
  definitionOfDone: z.array(text).min(1).max(8),
  priority: z.number().int().min(1).max(3),
  dependencyIds: z.array(text),
  coveredCriteria: z.array(z.number().int().min(0)),
  tasks: z.array(taskSchema).min(1).max(30),
});
export const storiesSchema = z.object({
  stories: z.array(storySchema).min(1).max(30),
  uncoveredCriteria: z.array(z.string()),
  warnings: z.array(z.string()),
});
export const allocationSchema = z.object({
  taskId: text,
  date: localDate,
  minutes: z.number().int().min(1).max(60),
});
export const scheduleSchema = z.object({
  allocations: z.array(allocationSchema).max(300),
  notes: z.array(z.string()),
});
export const replySchema = z.object({
  message: text,
  nextUiAction: text,
  displayedAssumptions: z.array(z.string()),
});
export const nextActionSchema = z.object({
  taskId: z.string().nullable(),
  actionTitle: z.string().nullable(),
  minutes: z.number().int().min(1).max(25).nullable(),
  reason: text,
  readiness: z.enum(["ready", "blocked", "none"]),
});
export const replanSchema = z.object({
  impactSummary: text,
  options: z
    .array(z.object({ action: text, reason: text, taskIds: z.array(text) }))
    .max(3),
});
export const replanChangeKindSchema = z.enum([
  "reschedule",
  "reduce_scope",
  "split_task",
  "defer_task",
  "adjust_dependency",
  "retain",
]);
export const replanChangeSchema = z.object({
  kind: replanChangeKindSchema,
  storyId: text,
  taskId: z.string().nullable(),
  summary: text,
  reason: text,
});
export const agentReplanSchema = z.object({
  impactSummary: text,
  stories: z.array(storySchema).min(1).max(30),
  allocations: z.array(allocationSchema).min(1).max(300),
  changes: z.array(replanChangeSchema).min(1).max(60),
  notes: z.array(z.string()).max(6),
});
export const replanScopeDiffItemSchema = z.object({
  storyId: text,
  storyTitle: text,
  taskId: z.string().nullable(),
  taskTitle: z.string().nullable(),
  change: z.enum(["added", "modified", "reduced", "unchanged"]),
  beforeMinutes: z.number().int().min(0).max(MAX_SPRINT_MINUTES),
  afterMinutes: z.number().int().min(0).max(MAX_SPRINT_MINUTES),
  deltaMinutes: z
    .number()
    .int()
    .min(-MAX_SPRINT_MINUTES)
    .max(MAX_SPRINT_MINUTES),
  summary: text,
});
export const replanDateDiffItemSchema = z.object({
  taskId: text,
  taskTitle: text,
  storyId: text,
  fromDate: localDate.nullable(),
  toDate: localDate.nullable(),
  beforeMinutes: z.number().int().min(0).max(60),
  afterMinutes: z.number().int().min(0).max(60),
});
export const replanDependencyDiffItemSchema = z.object({
  storyId: text,
  storyTitle: text,
  beforeDependsOn: z.array(text),
  afterDependsOn: z.array(text),
});
export const replanCapacityDiffSchema = z.object({
  beforePlannedMinutes: z.number().int().min(0).max(MAX_SPRINT_MINUTES),
  afterPlannedMinutes: z.number().int().min(0).max(MAX_SPRINT_MINUTES),
  deltaPlannedMinutes: z
    .number()
    .int()
    .min(-MAX_SPRINT_MINUTES)
    .max(MAX_SPRINT_MINUTES),
  beforeUsableMinutes: z
    .number()
    .int()
    .min(0)
    .max(MAX_SPRINT_MINUTES)
    .nullable(),
  afterUsableMinutes: z
    .number()
    .int()
    .min(0)
    .max(MAX_SPRINT_MINUTES)
    .nullable(),
  beforeOverbookedMinutes: z.number().int().min(0).max(MAX_SPRINT_MINUTES),
  afterOverbookedMinutes: z.number().int().min(0).max(MAX_SPRINT_MINUTES),
  beforeOverloadedDays: z.number().int().min(0).max(MAX_SPRINT_DAYS),
  afterOverloadedDays: z.number().int().min(0).max(MAX_SPRINT_DAYS),
});
export const replanDiffSchema = z.object({
  scope: z.array(replanScopeDiffItemSchema),
  dates: z.array(replanDateDiffItemSchema),
  dependencies: z.array(replanDependencyDiffItemSchema),
  capacity: replanCapacityDiffSchema,
});
export const pendingReplanSchema = z.object({
  source: z.enum(["agent", "manual"]),
  reason: text,
  impactSummary: text,
  stories: z.array(storySchema).min(1).max(30),
  allocations: z.array(allocationSchema).min(1).max(300),
  capacityMinutes: z.number().int().min(1).max(MAX_SPRINT_MINUTES).nullable(),
  dailyMinutes: dailyMinutesSchema,
  bufferPercent: z.number().int().min(0).max(50),
  changes: z.array(replanChangeSchema).max(60),
  notes: z.array(z.string()).max(6),
  diff: replanDiffSchema,
  createdAt: z.string(),
});
export const requestReplanInputSchema = z.object({
  reason: z.string().max(1000).optional(),
  capacityMinutes: z
    .number()
    .int()
    .min(1)
    .max(MAX_SPRINT_MINUTES)
    .nullable()
    .optional(),
  dailyMinutes: dailyMinutesSchema.optional(),
  bufferPercent: z.number().int().min(0).max(50).optional(),
});
export const editReplanInputSchema = z.object({
  stories: z.array(storySchema).min(1).max(30).optional(),
  allocations: z.array(allocationSchema).min(1).max(300),
  capacityMinutes: z
    .number()
    .int()
    .min(1)
    .max(MAX_SPRINT_MINUTES)
    .nullable()
    .optional(),
  dailyMinutes: dailyMinutesSchema.optional(),
  bufferPercent: z.number().int().min(0).max(50).optional(),
  reason: z.string().max(1000).optional(),
  notes: z.array(z.string()).max(6).optional(),
});
export const reflectionSchema = z.object({
  completedOutcomes: z.array(z.string()),
  partialOutcomes: z.array(z.string()),
  actualMinutes: z.number().nullable(),
  estimatedMinutes: z.number(),
  question: z.string().nullable(),
  suggestions: z.array(z.string()),
});
export const capacityAdviceSchema = z.object({
  assessment: text,
  options: z.array(z.string()).max(3),
});
export const rhythmSchema = z.object({
  dataStatus: z.enum(["verified", "partial", "unavailable"]),
  sources: z.array(z.string()),
  suggestions: z.array(z.string()),
});

export type IntentAssessment = z.infer<typeof intentSchema>;
export type ClarificationPlan = z.infer<typeof clarificationSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type Story = z.infer<typeof storySchema>;
export type Allocation = z.infer<typeof allocationSchema>;
export type NextAction = z.infer<typeof nextActionSchema>;
export type ReplanChange = z.infer<typeof replanChangeSchema>;
export type ReplanDiff = z.infer<typeof replanDiffSchema>;
export type PendingReplan = z.infer<typeof pendingReplanSchema>;
export type Progress = {
  status: "todo" | "in_progress" | "partial" | "blocked" | "done";
  percent: number;
  dodConfirmed: boolean;
  completedSubtaskIds: string[];
  note: string;
  actualMinutes: number | null;
  updatedAt: string;
};
export type Approval = {
  kind: "goals" | "stories" | "schedule" | "activation" | "replan";
  hash: string;
  revision: number;
  at: string;
  riskAcknowledged?: boolean;
};
export type Sprint = {
  id: string;
  revision: number;
  stage:
    | "intention"
    | "select"
    | "clarify"
    | "goals"
    | "stories"
    | "schedule"
    | "review"
    | "active";
  startDate: string;
  endDate: string;
  timezone: string;
  originalIntention: string;
  intention: string;
  intentionHistory: string[];
  assessment: IntentAssessment | null;
  selectedIntentIds: string[];
  clarification: ClarificationPlan | null;
  answers: Answer[];
  goals: Goal[];
  stories: Story[];
  allocations: Allocation[];
  capacityMinutes: number | null;
  dailyMinutes: number[];
  bufferPercent: number;
  notes: string[];
  approvals: Approval[];
  progress: Record<string, Progress>;
  pendingSchedule: Allocation[] | null;
  pendingReplan?: PendingReplan | null;
  pendingClarification?: PendingClarification | null;
  clarificationHistory?: ClarificationReply[];
  scopeReadiness?:
    (z.infer<typeof scopeReadinessSchema> & { goalsHash: string }) | null;
  scheduleConflict?: {
    code: string;
    message: string;
    storyId: string;
    taskId: string | null;
    goalId: string;
    actions: string[];
  } | null;
  scheduleAdvice?: {
    status: "ready" | "unavailable";
    notes: string[];
    forHash: string;
  } | null;
  nextAction: NextAction | null;
  assistantMessage: string;
  createdAt: string;
  updatedAt: string;
};
export const createInput = z.object({
  startDate: localDate,
  /** Inclusive last day. Omitted by older clients, which meant a 15-day sprint. */
  endDate: localDate.optional(),
  timezone: text,
  capacityMinutes: z.number().int().min(1).max(MAX_SPRINT_MINUTES).nullable(),
  dailyMinutes: dailyMinutesSchema,
  bufferPercent: z.number().int().min(0).max(50),
});
export const commandSchema = z.object({
  sprintId: z.string().uuid(),
  expectedRevision: z.number().int().min(-1),
  idempotencyKey: z.string().uuid(),
  action: z.enum([
    "create",
    "capture",
    "assess",
    "select_intents",
    "answer",
    "answer_clarification",
    "consent_clarification",
    "resume_clarification",
    "confirm_availability",
    "synthesize",
    "edit_goals",
    "approve_goals",
    "regenerate_goals",
    "generate_stories",
    "edit_stories",
    "approve_stories",
    "schedule",
    "request_schedule_advice",
    "edit_schedule",
    "approve_schedule",
    "activate",
    "progress",
    "propose_replan",
    "request_replan",
    "edit_replan",
    "reject_replan",
    "approve_replan",
    "next_action",
    "reflect",
  ]),
  hash: z.string().optional(),
  data: z.unknown(),
});
export type Command = z.infer<typeof commandSchema>;
