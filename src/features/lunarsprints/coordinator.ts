import { createHash } from "node:crypto";
import { z } from "zod";
import {
  agentReplanSchema,
  allocationSchema,
  answerSchema,
  clarificationSchema,
  clarificationReplySchema,
  createInput,
  editReplanInputSchema,
  goalsSchema,
  goalPlanningSchema,
  scopeReadinessSchema,
  intentSchema,
  nextActionSchema,
  reflectionSchema,
  requestReplanInputSchema,
  scheduleSchema,
  storiesSchema,
  text,
  dailyMinutesSchema,
  MAX_SPRINT_MINUTES,
  type Command,
  type Sprint,
} from "./contracts";
import {
  addDays,
  approvalPayload,
  assert,
  assertDailyLength,
  sprintDays,
  todayIn,
  validateWindow,
  buildPendingReplan,
  canonical,
  capacity,
  hasApproval,
  planSchedule,
  validateAnswer,
  validateGoals,
  validateQuestions,
  validateReplanProposal,
  validateSchedule,
  SchedulingConflict,
  validateStories,
  unique,
} from "./domain";
import type { Intelligence } from "./agents/managed";
import { NeedsClarification } from "./agents/outcomes";
import { clarificationBase, planningFacts } from "./planning";
import {
  clarificationInstructions,
  goalInstructions,
  replanInstructions,
  storyInstructions,
  readinessInstructions,
} from "./agents/policies";

export function hash(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function hashes(s: Sprint) {
  return Object.fromEntries(
    (["goals", "stories", "schedule", "activation", "replan"] as const).map(
      (k) => [k, hash(approvalPayload(s, k))],
    ),
  );
}
export function newSprint(
  id: string,
  data: unknown,
  /** The route passes enforceStartWindow so tests can build fixed-date sprints. */
  options: { maxDays?: number; enforceStartWindow?: boolean } = {},
): Sprint {
  const input = createInput.parse(data);
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    assert(false, "Choose a valid IANA timezone.");
  }
  // Older clients sent no endDate and always meant 15 inclusive days.
  const endDate = input.endDate ?? addDays(input.startDate, 14);
  const days = validateWindow(input.startDate, endDate, options.maxDays);
  assertDailyLength(
    { startDate: input.startDate, endDate },
    input.dailyMinutes,
  );
  if (options.enforceStartWindow) {
    const today = todayIn(input.timezone);
    assert(input.startDate >= today, "Choose a start date from today onwards.");
    assert(
      input.startDate <= addDays(today, 90),
      "Choose a start date within the next 90 days.",
    );
  }
  assert(
    input.capacityMinutes === null ||
      input.capacityMinutes <= input.dailyMinutes.reduce((n, m) => n + m, 0),
    "Total capacity cannot exceed your daily availability.",
  );
  const at = new Date().toISOString();
  return {
    id,
    revision: 0,
    stage: "intention",
    ...input,
    endDate,
    originalIntention: "",
    intention: "",
    intentionHistory: [],
    assessment: null,
    selectedIntentIds: [],
    clarification: null,
    answers: [],
    goals: [],
    stories: [],
    allocations: [],
    notes: [],
    approvals: [],
    progress: {},
    scheduleConflict: null,
    scheduleAdvice: null,
    pendingSchedule: null,
    pendingReplan: null,
    pendingClarification: null,
    clarificationHistory: [],
    scopeReadiness: null,
    nextAction: null,
    assistantMessage: `What would you like to make room for in the next ${days} days?`,
    createdAt: at,
    updatedAt: at,
  };
}
export async function coordinate(
  current: Sprint,
  command: Command,
  ai: Intelligence,
): Promise<Sprint> {
  assert(
    current.revision === command.expectedRevision,
    "This sprint changed in another session. Refresh to review the latest version.",
    "stale_revision",
    409,
  );
  const s = structuredClone(current);
  s.pendingClarification ??= null;
  s.clarificationHistory ??= [];
  const resuming = command.action === "resume_clarification";
  if (s.pendingClarification && !resuming)
    assert(
      [
        "answer_clarification",
        "consent_clarification",
        "confirm_availability",
        "capture",
        "edit_goals",
        "progress",
      ].includes(command.action),
      "A question is already saved. Answer it and continue instead of generating it again.",
      "clarification_pending",
      409,
    );
  if (resuming) {
    const pending = s.pendingClarification;
    assert(pending?.reply, "Answer the saved question before continuing.");
    assert(
      pending.consentGranted,
      "Confirm continuation before answering an additional question.",
    );
    assert(
      pending.baseHash === hash(clarificationBase(s)),
      "The plan changed. Review the latest version before continuing.",
      "stale_proposal",
      409,
    );
    s.clarificationHistory.push(pending.reply);
    s.pendingClarification = null;
    // New scope information must be reflected in a newly reviewed goal, never
    // silently attached to a previously approved commitment.
    const reviewGoal = pending.resumeAction === "generate_stories";
    command = {
      ...command,
      action: reviewGoal ? "synthesize" : pending.resumeAction,
      data: reviewGoal
        ? {
            feedback:
              "Reconcile the newly supplied planning facts with the goal. Present any revised scope for explicit approval.",
          }
        : pending.resumeData,
    };
  }
  if (s.pendingReplan === undefined) s.pendingReplan = null;
  const at = new Date().toISOString();
  const activeActions = [
    "progress",
    "propose_replan",
    "request_replan",
    "edit_replan",
    "reject_replan",
    "approve_replan",
    "next_action",
    "reflect",
  ];
  if (s.stage === "active")
    assert(
      activeActions.includes(command.action) ||
        ["answer_clarification", "consent_clarification"].includes(
          command.action,
        ),
      "An active sprint can only change through an explicit replan.",
    );
  else
    assert(
      !activeActions.includes(command.action),
      "Activate the sprint before recording execution progress.",
    );
  const approve = (
    kind: "goals" | "stories" | "schedule" | "activation" | "replan",
  ) => {
    const expected = hash(approvalPayload(s, kind));
    assert(
      command.hash === expected,
      "The displayed proposal changed. Review it before approving.",
      "stale_proposal",
      409,
    );
    s.approvals.push({ kind, hash: expected, revision: s.revision, at });
  };
  const clearAfterGoals = () => {
    s.approvals = [];
    s.stories = [];
    s.allocations = [];
    s.notes = [];
    s.progress = {};
    s.scopeReadiness = null;
    s.scheduleAdvice = null;
    s.scheduleConflict = null;
  };
  const invoke: Intelligence["invoke"] = (role, schema, data, instructions) =>
    ai.invoke(
      role,
      schema,
      {
        ...(typeof data === "object" && data !== null ? data : { input: data }),
        confirmedFacts: planningFacts(s),
      },
      instructions,
    );
  const validateReadiness = (r: z.infer<typeof scopeReadinessSchema>) => {
    assert(
      r.evidenceRefs.every((id) => planningFacts(s).some((f) => f.id === id)),
      "The scope assessment refers to unknown evidence.",
      "invalid_model_output",
      422,
    );
    if (r.status !== "ready")
      throw new NeedsClarification("smart_goal", {
        question:
          r.clarification?.question || "What scope should this sprint cover?",
        options: r.clarification?.options ?? [],
        missingFields: ["deliverableScope"],
        reason: r.rationale,
      });
    assert(
      r.scopeSummary?.trim(),
      "The goal needs a bounded scope description.",
      "invalid_model_output",
      422,
    );
  };
  const planningContext = () => ({
    selectedIntents: s.assessment?.intents.filter((i) =>
      s.selectedIntentIds.includes(i.id),
    ),
    startDate: s.startDate,
    endDate: s.endDate,
    sprintDays: sprintDays(s),
    timezone: s.timezone,
    capacityMinutes: s.capacityMinutes,
    dailyMinutes: s.dailyMinutes,
    bufferPercent: s.bufferPercent,
    skippedTopics:
      s.clarification?.questions
        .filter((q) =>
          s.answers.some(
            (a) => a.questionId === q.id && a.status === "skipped",
          ),
        )
        .map((q) => q.question) ?? [],
    discoveryRequested:
      s.clarificationHistory?.at(-1)?.requestsDiscovery === true,
    scopeReadiness: s.scopeReadiness,
  });
  const clarify = async () => {
    s.clarification = await invoke(
      "smart_goal",
      clarificationSchema,
      planningContext(),
      clarificationInstructions,
    );
    validateQuestions(s.clarification, s.selectedIntentIds);
    s.stage = s.clarification.questions.length ? "clarify" : "goals";
    s.assistantMessage = s.clarification.questions.length
      ? "A few relevant questions. Your answers shape the plan."
      : "Your intention is clear enough. Generate an editable SMART proposal when you’re ready.";
  };
  try {
    switch (command.action) {
      case "consent_clarification": {
        assert(s.pendingClarification, "There is no saved question.");
        s.pendingClarification.consentGranted = true;
        break;
      }
      case "answer_clarification": {
        const p = s.pendingClarification;
        assert(
          p && p.consentGranted,
          "Confirm continuation before answering this question.",
        );
        assert(
          p.baseHash === hash(clarificationBase(s)),
          "The plan changed. Refresh before answering.",
          "stale_proposal",
          409,
        );
        const d = clarificationReplySchema.parse(command.data);
        assert(
          d.questionId === p.id,
          "This question is no longer current.",
          "stale_proposal",
          409,
        );
        const option = p.options.find((o) => o.id === d.optionId);
        if (d.status === "unknown") {
          assert(
            !d.optionId && !d.customText,
            "An unknown answer cannot confirm an option or custom value.",
          );
          p.reply = {
            questionId: p.id,
            question: p.question,
            value: "The user does not know this detail yet.",
            source: "user_unknown",
            status: "unknown",
            requestsDiscovery: [
              "generate_stories",
              "synthesize",
              "regenerate_goals",
            ].includes(p.resumeAction),
          };
        } else {
          assert(
            Boolean(d.customText) !== Boolean(d.optionId),
            "Choose an option or enter your own answer.",
          );
          assert(!d.optionId || option, "Choose an available option.");
          p.reply = {
            questionId: p.id,
            question: p.question,
            value: d.customText || option!.text,
            source: d.customText ? "user_custom" : "user_selected",
            status: "confirmed",
          };
        }
        break;
      }
      case "confirm_availability": {
        assert(
          s.stage !== "active",
          "Use an approved replan to change an active sprint's time budget.",
        );
        const d = createInput
          .omit({ startDate: true, endDate: true, timezone: true })
          .parse(command.data);
        assertDailyLength(s, d.dailyMinutes);
        assert(
          d.capacityMinutes === null ||
            d.capacityMinutes <= d.dailyMinutes.reduce((n, m) => n + m, 0),
          "The sprint budget exceeds daily availability.",
        );
        Object.assign(s, d);
        s.scheduleAdvice = null;
        s.scheduleConflict = null;
        // Time confirmation preserves reviewed work and dates; only schedule
        // approval needs another explicit review after a capacity change.
        s.approvals = s.approvals.filter(
          (a) => a.kind === "goals" || a.kind === "stories",
        );
        if (s.stage === "review") s.stage = "schedule";
        if (s.pendingClarification)
          s.pendingClarification.baseHash = hash(clarificationBase(s));
        s.assistantMessage =
          d.capacityMinutes === null
            ? "Your availability remains explicitly unknown."
            : "Your time budget is confirmed. Estimates will use this shared capacity.";
        break;
      }
      case "capture": {
        const { intention } = z
          .object({ intention: text.max(10000) })
          .parse(command.data);
        if (!s.originalIntention) s.originalIntention = intention;
        if (s.intention && s.intention !== intention)
          s.intentionHistory.push(s.intention);
        s.intention = intention;
        s.assessment = null;
        s.selectedIntentIds = [];
        s.clarification = null;
        s.answers = [];
        s.pendingClarification = null;
        s.clarificationHistory = [];
        s.goals = [];
        clearAfterGoals();
        s.stage = "intention";
        s.assistantMessage =
          "Your intention is saved. Let’s find the details that matter.";
        break;
      }
      case "assess": {
        assert(s.intention, "Enter or confirm an intention first.");
        assert(!s.goals.length, "Edit the intention before reassessing.");
        s.assessment = await invoke(
          "intent_alignment",
          intentSchema,
          {
            intention: s.intention,
            startDate: s.startDate,
            endDate: s.endDate,
          },
          "Your task in this session is intention extraction, not final goal drafting. Extract distinct intentions and only user-stated facts. Give each intent a unique id. Include baseline, uncertainties and constraints. No invented values or motivation. Return status ok with the assessment payload even when details are missing: put unknowns in uncertainties and use null for unstated facts. The SMART specialist owns the next clarification questionnaire; missing launch scope, progress or success measures must not block extraction of a recognizable intention.",
        );
        unique(
          s.assessment.intents.map((i) => i.id),
          "intention",
        );
        s.selectedIntentIds =
          s.assessment.intents.length === 1 ? [s.assessment.intents[0].id] : [];
        if (s.selectedIntentIds.length) await clarify();
        else {
          s.stage = "select";
          s.assistantMessage =
            "There are a few different intentions here. Choose what belongs in this sprint; the others remain in your saved intention.";
        }

        break;
      }
      case "select_intents": {
        assert(s.assessment, "Assess your intention first.");
        const ids = z.array(text).min(1).max(8).parse(command.data);
        unique(ids, "selected intention");
        assert(
          ids.every((id) => s.assessment!.intents.some((i) => i.id === id)),
          "Select only intentions in this assessment.",
        );
        s.selectedIntentIds = ids;
        s.answers = [];
        if (!resuming) s.clarificationHistory = [];
        s.goals = [];
        clearAfterGoals();
        await clarify();
        break;
      }
      case "answer": {
        assert(s.clarification, "There is no current questionnaire.");
        const answer = answerSchema.parse(command.data);
        validateAnswer(s.clarification, answer);
        s.answers = s.answers
          .filter((a) => a.questionId !== answer.questionId)
          .concat(answer);
        s.goals = [];
        clearAfterGoals();
        s.stage = "clarify";
        break;
      }
      case "synthesize":
      case "regenerate_goals": {
        assert(
          s.assessment && s.selectedIntentIds.length,
          "Confirm the intentions to include first.",
        );
        const feedback = z
          .object({
            feedback: z.string().max(3000).optional(),
            skip: z.boolean().optional(),
          })
          .parse(command.data ?? {});
        const missing =
          s.clarification?.questions.filter(
            (q) =>
              q.required &&
              !s.answers.some(
                (a) => a.questionId === q.id && a.status === "confirmed",
              ),
          ) ?? [];
        assert(
          !missing.length,
          "Answer the required questions before generating the goal.",
        );
        const result = goalPlanningSchema.parse(
          await invoke(
            "smart_goal",
            goalPlanningSchema,
            {
              ...planningContext(),
              previousProposals: s.goals,
              feedback: feedback.feedback ?? null,
              clarificationSkipped: feedback.skip ?? false,
            },
            goalInstructions,
          ),
        );
        validateReadiness(result.readiness);
        assert(
          !planningContext().discoveryRequested ||
            result.readiness.mode === "discovery",
          "The proposal must respect your request for a bounded discovery milestone.",
          "invalid_model_output",
          422,
        );
        validateGoals(s, result.goals);
        s.goals = result.goals;
        clearAfterGoals();
        s.scopeReadiness = { ...result.readiness, goalsHash: hash(s.goals) };
        s.stage = "goals";
        s.assistantMessage =
          "Here is a goal proposal based on your words. Edit anything that doesn’t feel right, then explicitly approve it.";
        break;
      }
      case "edit_goals": {
        s.pendingClarification = null;
        assert(
          s.selectedIntentIds.length,
          "Choose at least one intention first.",
        );
        const result = goalsSchema.parse(command.data);
        validateGoals(s, result.goals);
        s.goals = result.goals;
        clearAfterGoals();
        s.stage = "goals";
        break;
      }
      case "approve_goals":
        assert(
          s.stage === "goals" && s.goals.length,
          "There is no goal proposal to approve.",
        );
        validateGoals(s, s.goals);
        approve("goals");
        s.stage = "stories";
        s.assistantMessage =
          "Your goal is approved. Generate a small, editable work breakdown next.";
        break;
      case "generate_stories": {
        assert(
          hasApproval(s, "goals"),
          "Approve the SMART goals before generating stories.",
        );
        assert(
          s.stage === "stories",
          "Return to story review to generate a work plan.",
        );
        if (s.scopeReadiness?.goalsHash !== hash(s.goals)) {
          const readiness = scopeReadinessSchema.parse(
            await invoke(
              "smart_goal",
              scopeReadinessSchema,
              { ...planningContext(), approvedGoals: s.goals },
              readinessInstructions,
            ),
          );
          validateReadiness(readiness);
          s.scopeReadiness = { ...readiness, goalsHash: hash(s.goals) };
        }
        const proposal = await invoke(
          "story_decomposer",
          storiesSchema,
          {
            ...planningContext(),
            approvedGoals: s.goals,
            approvedGoalHash: s.approvals.find((a) => a.kind === "goals")!.hash,
          },
          storyInstructions,
        );
        assert(
          !proposal.uncoveredCriteria.length,
          "The proposed work leaves success criteria uncovered. Retry or edit the goal scope.",
          "invalid_model_output",
          422,
        );
        validateStories(s, proposal.stories);
        s.scheduleAdvice = null;
        s.scheduleConflict = null;
        s.stories = proposal.stories;
        s.notes = proposal.warnings;
        s.allocations = [];
        s.approvals = s.approvals.filter((a) => a.kind === "goals");
        s.assistantMessage =
          "Review the stories, task estimates and completion checks. Every estimate is a proposal.";
        break;
      }
      case "edit_stories": {
        assert(hasApproval(s, "goals"), "Approve your goals first.");
        const proposal = storiesSchema.parse(command.data);
        validateStories(s, proposal.stories);
        s.scheduleAdvice = null;
        s.scheduleConflict = null;
        s.stories = proposal.stories;
        s.notes = proposal.warnings;
        s.allocations = [];
        s.approvals = s.approvals.filter((a) => a.kind === "goals");
        s.stage = "stories";
        break;
      }
      case "approve_stories":
        assert(
          s.stories.length && hasApproval(s, "goals"),
          "Review a work breakdown for the approved goal first.",
        );
        validateStories(s, s.stories);
        approve("stories");
        s.stage = "schedule";
        s.assistantMessage =
          "Your work breakdown is approved. Let’s fit the work into the time you have.";
        break;
      case "schedule": {
        assert(
          hasApproval(s, "stories"),
          "Approve the story set before scheduling.",
        );
        try {
          s.allocations = planSchedule(s);
        } catch (error) {
          if (!(error instanceof SchedulingConflict)) throw error;
          s.scheduleConflict = error.detail;
          s.stage = "schedule";
          break;
        }
        s.scheduleAdvice = null;
        s.scheduleConflict = null;
        s.approvals = s.approvals.filter(
          (a) => a.kind === "goals" || a.kind === "stories",
        );
        s.stage = "schedule";
        break;
      }
      case "request_schedule_advice": {
        assert(
          s.stage === "schedule" &&
            hasApproval(s, "stories") &&
            s.allocations.length,
          "Save a validated schedule before requesting an explanation.",
        );
        validateSchedule(s, s.allocations);
        const forHash = hash(approvalPayload(s, "schedule"));
        if (
          s.scheduleAdvice?.status === "ready" &&
          s.scheduleAdvice.forHash === forHash
        )
          break;
        try {
          const advice = await invoke(
            "scheduling",
            z.object({ notes: z.array(z.string()).max(3) }),
            {
              validatedAllocations: s.allocations,
              capacity: capacity(s),
              startDate: s.startDate,
              endDate: s.endDate,
            },
            "The application has already validated this schedule. Return up to three concise optional notes, no dates or changes. Explain supplied risks without inventing availability. Unknown inputs stay unknown; do not request validation tools or block the saved plan.",
          );
          s.scheduleAdvice = { status: "ready", notes: advice.notes, forHash };
        } catch {
          s.scheduleAdvice = {
            status: "unavailable",
            notes: [
              "The optional explanation is unavailable. Your saved schedule is unchanged and can still be reviewed.",
            ],
            forHash,
          };
        }
        break;
      }
      case "edit_schedule": {
        assert(hasApproval(s, "stories"), "Approve the story set first.");
        const data = z
          .object({
            allocations: z.array(allocationSchema),
            capacityMinutes: z
              .number()
              .int()
              .min(1)
              .max(MAX_SPRINT_MINUTES)
              .nullable(),
            dailyMinutes: dailyMinutesSchema,
            bufferPercent: z.number().int().min(0).max(50),
          })
          .parse(command.data);
        Object.assign(s, data);
        s.scheduleAdvice = null;
        s.scheduleConflict = null;
        assert(
          s.capacityMinutes === null ||
            s.capacityMinutes <= s.dailyMinutes.reduce((n, m) => n + m, 0),
          "The sprint budget exceeds daily availability.",
        );
        validateSchedule(s, s.allocations);
        s.approvals = s.approvals.filter(
          (a) => a.kind === "goals" || a.kind === "stories",
        );
        s.stage = "schedule";
        break;
      }
      case "approve_schedule": {
        assert(
          s.stage === "schedule" && hasApproval(s, "stories"),
          "Approve your work breakdown and review the schedule.",
        );
        validateSchedule(s, s.allocations);
        const data = z
          .object({ acknowledgeRisk: z.boolean() })
          .parse(command.data);
        const c = capacity(s);
        assert(
          (!c.overbooked &&
            !c.dailyOverload &&
            !c.dailyBufferOverload &&
            !c.unknown) ||
            data.acknowledgeRisk,
          "Review and acknowledge the visible capacity risks, or reduce scope.",
        );
        approve("schedule");
        s.approvals.at(-1)!.riskAcknowledged = data.acknowledgeRisk;
        s.stage = "review";
        break;
      }
      case "activate":
        assert(
          s.stage === "review" &&
            hasApproval(s, "goals") &&
            hasApproval(s, "stories") &&
            hasApproval(s, "schedule"),
          "Complete each approval before activation.",
        );
        validateGoals(s, s.goals);
        validateStories(s, s.stories);
        validateSchedule(s, s.allocations);
        approve("activation");
        s.stage = "active";
        s.assistantMessage =
          "Your sprint is active. Pick a day or a task to begin.";
        break;
      case "progress": {
        const d = z
          .object({
            taskId: text,
            status: z.enum([
              "todo",
              "in_progress",
              "partial",
              "blocked",
              "done",
            ]),
            percent: z.number().int().min(0).max(100),
            dodConfirmed: z.boolean(),
            completedSubtaskIds: z.array(text),
            note: z.string().max(3000),
            actualMinutes: z.number().int().min(0).max(21600).nullable(),
          })
          .parse(command.data);
        const story = s.stories.find((st) =>
          st.tasks.some((t) => t.id === d.taskId),
        );
        const task = story?.tasks.find((t) => t.id === d.taskId);
        assert(story && task, "Task not found.", "not_found", 404);
        unique(d.completedSubtaskIds, "completed subtask");
        assert(
          d.completedSubtaskIds.every((id) =>
            task.subtasks.some((sub) => sub.id === id),
          ),
          "Unknown completed subtask.",
        );
        if (d.status === "in_progress" || d.status === "done")
          for (const dep of story.dependencyIds)
            assert(
              s.stories
                .find((st) => st.id === dep)!
                .tasks.every((t) => s.progress[t.id]?.status === "done"),
              "Complete prerequisite stories first.",
            );
        assert(
          d.status !== "done" ||
            (d.dodConfirmed &&
              d.percent === 100 &&
              d.completedSubtaskIds.length === task.subtasks.length),
          "Confirm all task and subtask completion checks before marking done.",
        );
        assert(
          d.status === "done" || d.percent < 100,
          "Only explicitly completed tasks can reach 100%.",
        );
        s.progress[d.taskId] = { ...d, updatedAt: at };
        s.pendingClarification = null;
        s.nextAction = null;
        // A proposal was generated against older progress and must be reviewed anew.
        s.pendingReplan = null;
        s.pendingSchedule = null;
        break;
      }
      case "propose_replan": {
        const d = scheduleSchema.parse(command.data);
        const reason =
          d.notes[0]?.trim() || "Manual task schedule date adjustment.";
        s.pendingReplan = buildPendingReplan(s, {
          source: "manual",
          reason,
          impactSummary:
            "Proposed schedule date adjustments. Review the before/after diff before approving.",
          stories: s.stories,
          allocations: d.allocations,
          capacityMinutes: s.capacityMinutes,
          dailyMinutes: s.dailyMinutes,
          bufferPercent: s.bufferPercent,
          notes: d.notes,
          createdAt: at,
        });
        s.pendingSchedule = d.allocations;
        break;
      }
      case "request_replan": {
        const input = requestReplanInputSchema.parse(command.data ?? {});
        const capacityMinutes =
          input.capacityMinutes !== undefined
            ? input.capacityMinutes
            : s.capacityMinutes;
        const dailyMinutes = input.dailyMinutes ?? s.dailyMinutes;
        const bufferPercent = input.bufferPercent ?? s.bufferPercent;
        const reason =
          input.reason?.trim() ||
          "Rebalance remaining sprint scope and dates based on current progress and available capacity.";
        assert(
          capacityMinutes === null ||
            capacityMinutes <= dailyMinutes.reduce((n, m) => n + m, 0),
          "The sprint budget exceeds daily availability.",
        );
        const proposal = await invoke(
          "adaptive_backlog",
          agentReplanSchema,
          {
            goals: s.goals,
            stories: s.stories,
            allocations: s.allocations,
            progress: s.progress,
            startDate: s.startDate,
            endDate: s.endDate,
            sprintDays: sprintDays(s),
            timezone: s.timezone,
            capacityMinutes,
            dailyMinutes,
            bufferPercent,
            reason,
            currentCapacity: capacity(s, s.allocations),
          },
          replanInstructions,
        );
        s.pendingReplan = buildPendingReplan(s, {
          source: "agent",
          reason,
          impactSummary: proposal.impactSummary,
          stories: proposal.stories,
          allocations: proposal.allocations,
          capacityMinutes,
          dailyMinutes,
          bufferPercent,
          changes: proposal.changes,
          notes: proposal.notes,
          createdAt: at,
        });
        s.pendingSchedule = s.pendingReplan.allocations;
        s.assistantMessage = proposal.impactSummary;
        break;
      }
      case "edit_replan": {
        assert(
          s.pendingReplan || s.pendingSchedule,
          "There is no pending replan to edit.",
        );
        const input = editReplanInputSchema.parse(command.data);
        const base = s.pendingReplan;
        const stories = input.stories ?? base?.stories ?? s.stories;
        const capacityMinutes =
          input.capacityMinutes !== undefined
            ? input.capacityMinutes
            : base
              ? base.capacityMinutes
              : s.capacityMinutes;
        const dailyMinutes =
          input.dailyMinutes ?? base?.dailyMinutes ?? s.dailyMinutes;
        const bufferPercent =
          input.bufferPercent ?? base?.bufferPercent ?? s.bufferPercent;
        const reason =
          input.reason?.trim() ||
          base?.reason ||
          "User-adjusted pending replan proposal.";
        const notes = input.notes ?? base?.notes ?? [];
        s.pendingReplan = buildPendingReplan(s, {
          source: base?.source ?? "manual",
          reason,
          impactSummary:
            base?.impactSummary ??
            "Edited pending replan proposal. Review the updated diff before approving.",
          stories,
          allocations: input.allocations,
          capacityMinutes,
          dailyMinutes,
          bufferPercent,
          changes: base?.changes,
          notes,
          createdAt: at,
        });
        s.pendingSchedule = s.pendingReplan.allocations;
        break;
      }
      case "reject_replan": {
        assert(
          s.pendingReplan || s.pendingSchedule,
          "There is no pending replan to reject.",
        );
        s.pendingReplan = null;
        s.pendingSchedule = null;
        s.assistantMessage =
          "Pending replan discarded. Your active sprint plan is unchanged.";
        break;
      }
      case "approve_replan": {
        assert(
          s.pendingReplan || s.pendingSchedule,
          "No pending schedule change.",
        );
        const d = z
          .object({ acknowledgeRisk: z.boolean() })
          .parse(command.data);
        s.nextAction = null;
        if (s.pendingReplan) {
          validateReplanProposal(s, s.pendingReplan);
          const shadow: Sprint = {
            ...s,
            stories: s.pendingReplan.stories,
            allocations: s.pendingReplan.allocations,
            capacityMinutes: s.pendingReplan.capacityMinutes,
            dailyMinutes: s.pendingReplan.dailyMinutes,
            bufferPercent: s.pendingReplan.bufferPercent,
          };
          const c = capacity(shadow, s.pendingReplan.allocations);
          assert(
            (!c.overbooked &&
              !c.dailyOverload &&
              !c.dailyBufferOverload &&
              !c.unknown) ||
              d.acknowledgeRisk,
            "Acknowledge the capacity risk before approving this change.",
          );
          approve("replan");
          s.approvals.at(-1)!.riskAcknowledged = d.acknowledgeRisk;
          s.stories = s.pendingReplan.stories;
          s.allocations = s.pendingReplan.allocations;
          s.capacityMinutes = s.pendingReplan.capacityMinutes;
          s.dailyMinutes = s.pendingReplan.dailyMinutes;
          s.bufferPercent = s.pendingReplan.bufferPercent;
          if (s.pendingReplan.notes.length) {
            s.notes = [...s.notes, ...s.pendingReplan.notes].slice(-12);
          }
          s.pendingReplan = null;
          s.pendingSchedule = null;
          s.assistantMessage =
            "Approved replan is now active. Completed tasks and audit history remain intact.";
        } else {
          validateSchedule(s, s.pendingSchedule!);
          const c = capacity(s, s.pendingSchedule!);
          assert(
            (!c.overbooked &&
              !c.dailyOverload &&
              !c.dailyBufferOverload &&
              !c.unknown) ||
              d.acknowledgeRisk,
            "Acknowledge the capacity risk before approving this change.",
          );
          approve("replan");
          s.approvals.at(-1)!.riskAcknowledged = d.acknowledgeRisk;
          s.allocations = s.pendingSchedule!;
          s.pendingSchedule = null;
        }
        break;
      }
      case "next_action": {
        const ready = s.stories
          .filter((st) =>
            st.dependencyIds.every((id) =>
              s.stories
                .find((t) => t.id === id)!
                .tasks.every((t) => s.progress[t.id]?.status === "done"),
            ),
          )
          .flatMap((st) => st.tasks)
          .filter(
            (t) =>
              !["done", "blocked"].includes(s.progress[t.id]?.status ?? "todo"),
          );
        s.nextAction = await invoke(
          "daily_execution",
          nextActionSchema,
          { readyTasks: ready, progress: s.progress },
          "Choose one of the supplied readyTasks by taskId, or return none. Do not change progress or claim a timer proves work happened.",
        );
        assert(
          !s.nextAction.taskId ||
            ready.some((t) => t.id === s.nextAction!.taskId),
          "The next action refers to unavailable work.",
          "invalid_model_output",
          422,
        );
        break;
      }
      case "reflect": {
        const result = await invoke(
          "reflection",
          reflectionSchema,
          { goals: s.goals, stories: s.stories, progress: s.progress },
          "Reflect only on the supplied user-reported progress. Missing actual minutes are UNKNOWN. Suggest one improvement; no lasting memory or health inference.",
        );
        s.assistantMessage = [
          ...result.completedOutcomes,
          ...result.suggestions,
          result.question,
        ]
          .filter(Boolean)
          .join(" ");
        break;
      }
      default:
        assert(false, "Unsupported action.");
    }
  } catch (error) {
    if (!(error instanceof NeedsClarification)) throw error;
    const asked =
      (s.clarification?.questions.length ?? 0) + s.clarificationHistory.length;
    const choices = [
      ...new Set(
        error.request.options
          .map((o) => o.trim())
          .filter((o) => o && o.toLowerCase() !== "other"),
      ),
    ].slice(0, 4);
    s.pendingClarification = {
      id: crypto.randomUUID(),
      role: error.role,
      question: error.request.question.trim().slice(0, 2000),
      options:
        choices.length >= 2
          ? choices.map((text, i) => ({ id: `option-${i}`, text }))
          : [],
      missingFields: error.request.missingFields,
      reason: error.request.reason,
      resumeAction: command.action,
      resumeData: command.data,
      baseHash: hash(clarificationBase(s)),
      requiresConsent: asked >= 5,
      consentGranted: asked < 5,
      reply: null,
      createdAt: at,
    };
    s.assistantMessage =
      "One more detail will help make the next proposal realistic. Your approved work is preserved.";
  }
  s.revision = current.revision + 1;
  s.updatedAt = at;
  return s;
}
