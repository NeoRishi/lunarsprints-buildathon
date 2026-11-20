import { z } from "zod";
import {
  allocationSchema,
  clarificationSchema,
  clarificationResponseSchema,
  dailyMinutesSchema,
  goalPlanningSchema,
  goalSchema,
  intentSchema,
  localDate,
  MAX_SPRINT_DAYS,
  MIN_SPRINT_DAYS,
  planningResponseSchema,
  scopeReadinessSchema,
  storiesSchema,
  envelope,
  compactEnvelope,
  type Role,
} from "../contracts";
import { assert } from "../domain";
import { clarificationOutcome } from "./outcomes";

/**
 * The output contract every agent engine must honour. Any engine builds its
 * schema and accepts answers through these functions, so the rest of the app
 * sees identical results whichever model produced them.
 */
export type AgentContract = ReturnType<typeof agentContract>;

export function agentContract(
  role: Role,
  schema: z.ZodType,
  data: unknown,
  compact: boolean,
) {
  const payloadSchema = planningResponseSchema(
    clarificationResponseSchema(schema, data),
    data,
  );
  const resultSchema = (compact ? compactEnvelope : envelope)(
    role,
    payloadSchema,
  );
  // Assessment and clarification are successful analyses even when facts are
  // missing. They must return the uncertainty or questionnaire payload rather
  // than escaping through a nullable final-goal payload.
  const analysisMayNeedAnswers =
    role === "intent_alignment" || Object.is(schema, clarificationSchema);
  const modelSchema = analysisMayNeedAnswers
    ? resultSchema.extend({ payload: payloadSchema })
    : resultSchema;
  const jsonSchema = z.toJSONSchema(modelSchema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return {
    compact,
    contractVersion: compact ? "2.1" : "2.0",
    resultSchema,
    analysisMayNeedAnswers,
    jsonSchema,
  };
}

/** Validates a parsed model answer and returns the stage payload, or throws. */
export function acceptAgentOutput<T extends z.ZodType>(
  role: Role,
  schema: T,
  contract: AgentContract,
  raw: unknown,
): z.infer<T> {
  const output = contract.resultSchema.parse(raw);
  const requestedInput = clarificationOutcome(
    role,
    output,
    contract.analysisMayNeedAnswers,
  );
  if (requestedInput) throw requestedInput;
  assert(
    (output.status === "ok" ||
      (contract.analysisMayNeedAnswers &&
        output.status === "needs_clarification")) &&
      output.payload,
    "The AI needs more information or could not produce this proposal. " +
      output.missingFields.join(", "),
    "needs_clarification",
    422,
  );
  if (!contract.analysisMayNeedAnswers)
    assert(
      !output.warnings.some((w) => w.severity === "blocker"),
      output.warnings
        .filter((w) => w.severity === "blocker")
        .map((w) => w.message)
        .join(" "),
      "needs_clarification",
      422,
    );
  return schema.parse(output.payload);
}

/* ------------------------------------------------------------------------ */
/* Agent service contract (Step 3). One source for TypeScript and Python.    */
/* `npm run contracts:build` writes these as JSON Schema files into          */
/* contracts/schemas/, and the Python service builds its models from them.   */
/* ------------------------------------------------------------------------ */

/** Roles the Python agent service answers today. Others stay unconnected. */
export const SERVICE_ROLES = [
  "intent_alignment",
  "smart_goal",
  "story_decomposer",
  "scheduling",
] as const;
export type ServiceRole = (typeof SERVICE_ROLES)[number];

/** Short optional notes about a schedule the app has already checked. */
export const scheduleNotesSchema = z.object({
  notes: z.array(z.string()).max(3),
});

/** A planning fact as the user gave or confirmed it. */
const factSchema = z.object({
  id: z.string(),
  question: z.string(),
  value: z.string(),
  source: z.string(),
  status: z.string(),
});

const planningContextSchema = z.object({
  selectedIntents: z.array(intentSchema.shape.intents.element).max(8),
  startDate: localDate,
  endDate: localDate,
  sprintDays: z.number().int().min(MIN_SPRINT_DAYS).max(MAX_SPRINT_DAYS),
  timezone: z.string(),
  capacityMinutes: z.number().int().nullable(),
  dailyMinutes: dailyMinutesSchema,
  bufferPercent: z.number().int().min(0).max(50),
  skippedTopics: z.array(z.string()),
  discoveryRequested: z.boolean(),
  scopeReadiness: scopeReadinessSchema.nullable(),
  confirmedFacts: z.array(factSchema),
});

const capacitySchema = z.object({
  planned: z.number(),
  buffer: z.number(),
  usable: z.number().nullable(),
  dayLoads: z.array(z.number()),
  overbooked: z.number(),
  unknown: z.boolean(),
  dailyOverload: z.boolean(),
  dailyBufferOverload: z.boolean(),
  byGoal: z.array(
    z.object({ id: z.string(), title: z.string(), minutes: z.number() }),
  ),
});

/**
 * Every task the service runs: the input it receives (only what the role
 * needs, never an email, sign-in token or account ID) and the payload the
 * model must return inside the answer envelope.
 */
export const SERVICE_TASKS = {
  intent_alignment: {
    assess: {
      input: z.object({
        intention: z.string().max(10000),
        startDate: localDate,
        endDate: localDate,
        confirmedFacts: z.array(factSchema),
      }),
      output: intentSchema,
    },
  },
  smart_goal: {
    clarify: { input: planningContextSchema, output: clarificationSchema },
    goals: {
      input: planningContextSchema.extend({
        previousProposals: z.array(goalSchema),
        feedback: z.string().nullable(),
        clarificationSkipped: z.boolean(),
      }),
      output: goalPlanningSchema,
    },
    readiness: {
      input: planningContextSchema.extend({
        approvedGoals: z.array(goalSchema),
      }),
      output: scopeReadinessSchema,
    },
  },
  story_decomposer: {
    stories: {
      input: planningContextSchema.extend({
        approvedGoals: z.array(goalSchema),
      }),
      output: storiesSchema,
    },
  },
  scheduling: {
    schedule_notes: {
      input: z.object({
        validatedAllocations: z.array(allocationSchema),
        capacity: capacitySchema,
        startDate: localDate,
        endDate: localDate,
        confirmedFacts: z.array(factSchema),
      }),
      output: scheduleNotesSchema,
    },
  },
} as const satisfies Record<
  ServiceRole,
  Record<string, { input: z.ZodObject; output: z.ZodType }>
>;

/** The service task for this role and stage schema, or null if unconnected. */
export function serviceTaskFor(role: Role, schema: z.ZodType) {
  if (!(SERVICE_ROLES as readonly string[]).includes(role)) return null;
  const tasks = SERVICE_TASKS[role as ServiceRole] as Record<
    string,
    { input: z.ZodObject; output: z.ZodType }
  >;
  const found = Object.entries(tasks).find(([, t]) =>
    Object.is(t.output, schema),
  );
  return found ? { task: found[0], ...found[1] } : null;
}

/** Usage the service reports. Unknown token counts are null, never 0. */
export const serviceUsageSchema = z.object({
  model: z.string(),
  input_tokens: z.number().int().min(0).nullable(),
  output_tokens: z.number().int().min(0).nullable(),
  latency_ms: z.number().int().min(0),
});

export const SERVICE_ERROR_CODES = [
  "ai_timeout",
  "ai_unavailable",
  "invalid_ai_output",
  "unauthorized",
  "invalid_request",
] as const;
export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];

export const serviceErrorSchema = z.object({
  error: z.object({ code: z.enum(SERVICE_ERROR_CODES) }),
});

/** The request body for one service call. */
export function serviceRequestSchema(role: ServiceRole, task: string) {
  const t = (SERVICE_TASKS[role] as Record<string, { input: z.ZodObject }>)[
    task
  ];
  return z.object({
    requestId: z.uuid(),
    task: z.literal(task),
    input: t.input,
  });
}

/** The JSON Schema the model must answer with for one task. */
export function serviceOutputJsonSchema(role: ServiceRole, task: string) {
  const t = (SERVICE_TASKS[role] as Record<string, { output: z.ZodType }>)[
    task
  ];
  return agentContract(role, t.output, {}, true).jsonSchema;
}

function withoutDialect(schema: Record<string, unknown>) {
  const copy = { ...schema };
  delete copy.$schema;
  return copy;
}

/**
 * The committed JSON Schema files, by file name. Each task's schema sits in
 * $defs under the task name so the Python service can pick it directly.
 */
export function serviceJsonSchemaFiles() {
  const files: Record<string, unknown> = {};
  for (const role of SERVICE_ROLES) {
    const tasks = Object.keys(SERVICE_TASKS[role]);
    const requestDefs = Object.fromEntries(
      tasks.map((task) => [
        task,
        withoutDialect(
          z.toJSONSchema(serviceRequestSchema(role, task), { io: "input" }),
        ),
      ]),
    );
    const outputDefs = Object.fromEntries(
      tasks.map((task) => [task, serviceOutputJsonSchema(role, task)]),
    );
    files[`${role}.request.json`] = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: `${role} request`,
      description:
        "Generated from src/features/lunarsprints/agents/contract.ts by npm run contracts:build. Do not edit.",
      anyOf: tasks.map((task) => ({ $ref: `#/$defs/${task}` })),
      $defs: requestDefs,
    };
    files[`${role}.response.json`] = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: `${role} response`,
      description:
        "Generated from src/features/lunarsprints/agents/contract.ts by npm run contracts:build. Do not edit. $defs holds the answer the model must give for each task.",
      type: "object",
      properties: {
        result: { anyOf: tasks.map((task) => ({ $ref: `#/$defs/${task}` })) },
        usage: withoutDialect(z.toJSONSchema(serviceUsageSchema)),
      },
      required: ["result", "usage"],
      additionalProperties: false,
      $defs: outputDefs,
    };
  }
  return files;
}
