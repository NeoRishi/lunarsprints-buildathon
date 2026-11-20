import type {
  Allocation,
  Answer,
  ClarificationPlan,
  Goal,
  PendingReplan,
  ReplanChange,
  ReplanDiff,
  Sprint,
  Story,
} from "./contracts";
import { MAX_SPRINT_DAYS, MIN_SPRINT_DAYS } from "./contracts";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  message: string,
  code = "invalid_input",
  status = 400,
): asserts condition {
  if (!condition) throw new AppError(code, message, status);
}
export function validDate(date: string) {
  const parsed = new Date(date + "T00:00:00Z");
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}
export function addDays(date: string, days: number) {
  assert(validDate(date), "Use a valid calendar date.");
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function dateIndex(s: Sprint, date: string) {
  return Math.round(
    (Date.parse(date + "T00:00:00Z") - Date.parse(s.startDate + "T00:00:00Z")) /
      86400000,
  );
}
/** Inclusive number of calendar days from startDate to endDate. */
export function sprintDays(s: Pick<Sprint, "startDate" | "endDate">) {
  return (
    Math.round(
      (Date.parse(s.endDate + "T00:00:00Z") -
        Date.parse(s.startDate + "T00:00:00Z")) /
        86400000,
    ) + 1
  );
}
/** Checks a sprint window against the product bounds and an optional plan cap. */
export function validateWindow(
  startDate: string,
  endDate: string,
  maxDays: number = MAX_SPRINT_DAYS,
) {
  assert(
    validDate(startDate) && validDate(endDate),
    "Use valid calendar dates for the sprint.",
  );
  const days = sprintDays({ startDate, endDate });
  assert(
    days >= MIN_SPRINT_DAYS,
    `A sprint needs at least ${MIN_SPRINT_DAYS} days.`,
  );
  assert(
    days <= Math.min(maxDays, MAX_SPRINT_DAYS),
    `This plan allows sprints of up to ${Math.min(maxDays, MAX_SPRINT_DAYS)} days.`,
    maxDays < MAX_SPRINT_DAYS ? "plan_limit" : "invalid_input",
    maxDays < MAX_SPRINT_DAYS ? 402 : 400,
  );
  return days;
}
/** Daily availability must have exactly one entry per sprint day. */
export function assertDailyLength(
  s: Pick<Sprint, "startDate" | "endDate">,
  dailyMinutes: number[],
) {
  assert(
    dailyMinutes.length === sprintDays(s),
    `Daily availability needs one value for each of the ${sprintDays(s)} sprint days.`,
  );
}
export function displayDate(date: string) {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
export function todayIn(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}-${parts.find((p) => p.type === "day")!.value}`;
}
export function unique(ids: string[], what: string) {
  assert(new Set(ids).size === ids.length, `Duplicate ${what} identifiers.`);
}
export function validateQuestions(
  plan: ClarificationPlan,
  selectedIds: string[],
) {
  unique(
    plan.questions.map((q) => q.id),
    "question",
  );
  for (const q of plan.questions) {
    assert(
      selectedIds.includes(q.intentId),
      "A question refers to an unselected intention.",
    );
    assert(
      q.options.length === 0 || q.options.length >= 2,
      "A multiple-choice question needs 2–4 options.",
    );
    unique(
      q.options.map((o) => o.id),
      "option",
    );
    assert(
      q.options.filter((o) => o.recommended).length <= 1,
      "Only one option may be recommended.",
    );
    for (const o of q.options)
      if (o.recommended)
        assert(
          o.recommendationBasis !== "none" && o.recommendationReason?.trim(),
          "Recommendations need a stated basis and reason.",
        );
  }
  assert(
    plan.questions.length <= 5,
    "The default clarification limit is five questions.",
  );
}
export function validateAnswer(plan: ClarificationPlan, answer: Answer) {
  const q = plan.questions.find((q) => q.id === answer.questionId);
  assert(q, "This question is no longer current.", "stale_revision", 409);
  if (answer.status === "unanswered") {
    assert(
      answer.source === "not_answered" &&
        !answer.optionId &&
        !answer.customText,
      "Unanswered questions cannot contain confirmed facts.",
    );
    return;
  }
  if (answer.status === "skipped") {
    assert(!q.required, "This answer is needed to define the goal.");
    assert(
      answer.source === "not_answered" &&
        !answer.optionId &&
        !answer.customText,
      "Skipped answers cannot contain confirmed facts.",
    );
    return;
  }
  if (answer.source === "user_custom")
    assert(
      answer.customText?.trim() && !answer.optionId,
      "Enter your answer; custom input replaces an option.",
    );
  else
    assert(
      answer.source === "user_selected" &&
        q.options.some((o) => o.id === answer.optionId) &&
        !answer.customText,
      "Choose an available option.",
    );
}
export function validateGoals(s: Sprint, goals: Goal[]) {
  unique(
    goals.map((g) => g.id),
    "goal",
  );
  assert(
    goals.length === s.selectedIntentIds.length,
    "Review one goal for every selected intention.",
  );
  unique(
    goals.map((g) => g.intentId),
    "goal intention",
  );
  for (const g of goals) {
    assert(
      s.selectedIntentIds.includes(g.intentId),
      "Goal refers to an unselected intention.",
    );
    assert(
      validDate(g.deadline) &&
        g.deadline >= s.startDate &&
        g.deadline <= s.endDate,
      "Goal deadlines must be inside this sprint.",
    );
  }
}
export function validateStories(s: Sprint, stories: Story[]) {
  unique(
    stories.map((st) => st.id),
    "story",
  );
  const allTasks = stories.flatMap((st) => st.tasks);
  unique(
    allTasks.map((t) => t.id),
    "task",
  );
  unique(
    allTasks.flatMap((t) => t.subtasks.map((st) => st.id)),
    "subtask",
  );
  assert(
    allTasks.length <= 300,
    "This sprint has too many tasks; reduce the breakdown.",
  );
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string) {
    assert(!visiting.has(id), "Story dependencies form a cycle.");
    if (visited.has(id)) return;
    const st = stories.find((st) => st.id === id);
    assert(st, "Unknown story dependency.");
    visiting.add(id);
    for (const dep of st.dependencyIds) visit(dep);
    visiting.delete(id);
    visited.add(id);
  }
  for (const story of stories) {
    const goal = s.goals.find((g) => g.id === story.goalId);
    assert(goal, "Each story must belong to an approved goal in this sprint.");
    assert(
      story.coveredCriteria.every((i) => i < goal.completionCriteria.length),
      "Story coverage refers to an unknown success criterion.",
    );
    for (const task of story.tasks)
      assert(
        task.subtasks.length === 0 ||
          task.subtasks.reduce((a, b) => a + b.minutes, 0) === task.minutes,
        "Subtask estimates must sum to their task estimate.",
      );
    visit(story.id);
  }
  for (const goal of s.goals) {
    const coverage = new Set(
      stories
        .filter((st) => st.goalId === goal.id)
        .flatMap((st) => st.coveredCriteria),
    );
    assert(
      goal.completionCriteria.every((_, i) => coverage.has(i)),
      `The work plan does not cover all success criteria for ${goal.title}.`,
    );
  }
}
export function estimatedMinutes(story: Story) {
  return story.tasks.reduce((n, t) => n + t.minutes, 0);
}
export function capacity(s: Sprint, allocations: Allocation[] = s.allocations) {
  const planned = allocations.reduce((n, a) => n + a.minutes, 0);
  const buffer =
    s.capacityMinutes === null
      ? 0
      : Math.ceil((s.capacityMinutes * s.bufferPercent) / 100);
  const usable = s.capacityMinutes === null ? null : s.capacityMinutes - buffer;
  const dayLoads = Array.from({ length: sprintDays(s) }, (_, i) =>
    allocations
      .filter((a) => a.date === addDays(s.startDate, i))
      .reduce((n, a) => n + a.minutes, 0),
  );
  const dailyOverload = dayLoads.some((n, i) => n > s.dailyMinutes[i]);
  const dailyBufferOverload = dayLoads.some(
    (n, i) => n > Math.floor(s.dailyMinutes[i] * (1 - s.bufferPercent / 100)),
  );
  return {
    planned,
    buffer,
    usable,
    dayLoads,
    overbooked: usable !== null ? Math.max(0, planned - usable) : 0,
    unknown: s.capacityMinutes === null,
    dailyOverload,
    dailyBufferOverload,
    byGoal: s.goals.map((g) => ({
      id: g.id,
      title: g.title,
      minutes: s.stories
        .filter((st) => st.goalId === g.id)
        .flatMap((st) => st.tasks)
        .reduce(
          (n, t) =>
            n + (allocations.find((a) => a.taskId === t.id)?.minutes ?? 0),
          0,
        ),
    })),
  };
}
export function validateSchedule(s: Sprint, allocations: Allocation[]) {
  assertDailyLength(s, s.dailyMinutes);
  validateStories(s, s.stories);
  unique(
    allocations.map((a) => a.taskId),
    "allocation",
  );
  const tasks = s.stories.flatMap((st) => st.tasks);
  assert(
    allocations.length === tasks.length,
    "Every task needs one date and effort allocation.",
  );
  for (const a of allocations) {
    const t = tasks.find((t) => t.id === a.taskId);
    assert(t, "Schedule references an unknown task.");
    assert(
      validDate(a.date) && a.date >= s.startDate && a.date <= s.endDate,
      "Every date must be inside this sprint.",
    );
    const owner = s.stories.find((st) =>
      st.tasks.some((task) => task.id === t.id),
    )!;
    const goal = s.goals.find((g) => g.id === owner.goalId)!;
    assert(
      a.date <= goal.deadline,
      `“${t.title}” must finish by the goal deadline (${displayDate(goal.deadline)}).`,
      "schedule_deadline",
      422,
    );
    assert(
      s.dailyMinutes[dateIndex(s, a.date)] > 0,
      `“${t.title}” is on a rest day. Move it or explicitly edit availability.`,
      "schedule_rest_day",
      422,
    );
    assert(
      a.minutes >= t.minutes,
      "Allocated effort cannot be below the reviewed task estimate. Edit the work breakdown to reduce scope.",
    );
  }
  for (const story of s.stories) {
    const first = story.tasks
      .map((t) => allocations.find((a) => a.taskId === t.id)!.date)
      .sort()[0];
    for (const depId of story.dependencyIds) {
      const dep = s.stories.find((st) => st.id === depId)!;
      const last = dep.tasks
        .map((t) => allocations.find((a) => a.taskId === t.id)!.date)
        .sort()
        .at(-1)!;
      assert(
        last < first,
        `Finish “${dep.title}” before starting “${story.title}”. Dependencies require separate dates.`,
      );
    }
  }
}
/** A failed proposal retains reviewed work and exposes a local recovery action. */
export class SchedulingConflict extends AppError {
  constructor(public detail: NonNullable<Sprint["scheduleConflict"]>) {
    super("schedule_conflict", detail.message, 422);
  }
}
export function planSchedule(s: Sprint): Allocation[] {
  validateGoals(s, s.goals);
  validateStories(s, s.stories);
  const horizon = sprintDays(s);
  assertDailyLength(s, s.dailyMinutes);
  const loads = Array<number>(horizon).fill(0);
  const allocations: Allocation[] = [];
  const visited = new Set<string>();
  const latest = new Map<string, number>();
  // A prerequisite must finish a full calendar day before each successor starts.
  // Propagate earlier cross-goal deadlines before considering story priority.
  function latestDay(story: Story): number {
    if (latest.has(story.id)) return latest.get(story.id)!;
    const own = dateIndex(
      s,
      s.goals.find((g) => g.id === story.goalId)!.deadline,
    );
    const dependents = s.stories.filter((st) =>
      st.dependencyIds.includes(story.id),
    );
    const day = Math.min(own, ...dependents.map((st) => latestDay(st) - 1));
    latest.set(story.id, day);
    return day;
  }
  function conflict(
    story: Story,
    taskId: string | null,
    message: string,
  ): never {
    throw new SchedulingConflict({
      code: "window_unavailable",
      message,
      storyId: story.id,
      taskId,
      goalId: story.goalId,
      actions: [
        "Review task sizes or reduce sprint scope in Work breakdown.",
        "Edit the daily availability you can actually protect, then retry.",
        "If the deadline or dependencies must change, return to the relevant proposal and approve it again.",
      ],
    });
  }
  function place(story: Story) {
    if (visited.has(story.id)) return;
    for (const dep of story.dependencyIds)
      place(s.stories.find((st) => st.id === dep)!);
    const depDays = story.dependencyIds.flatMap((id) =>
      s.stories
        .find((st) => st.id === id)!
        .tasks.map((t) =>
          dateIndex(s, allocations.find((a) => a.taskId === t.id)!.date),
        ),
    );
    let earliest = depDays.length ? Math.max(...depDays) + 1 : 0;
    const last = latestDay(story);
    if (earliest > last)
      conflict(
        story,
        null,
        `“${story.title}” has no date between its prerequisites and the goal deadline. Review the deadline or dependency chain.`,
      );
    for (const task of story.tasks) {
      const days = Array.from(
        { length: Math.max(0, last - earliest + 1) },
        (_, i) => i + earliest,
      ).filter((i) => i >= 0 && i < horizon && s.dailyMinutes[i] > 0);
      if (!days.length)
        conflict(
          story,
          task.id,
          `“${task.title}” has no available day before its goal deadline. These dates are rest days or outside the dependency window.`,
        );
      // Prefer protected capacity, but expose buffer use rather than silently overfill a day.
      const buffered = days.find(
        (i) =>
          loads[i] + task.minutes <=
          Math.floor(s.dailyMinutes[i] * (1 - s.bufferPercent / 100)),
      );
      const day =
        buffered ??
        days.find((i) => loads[i] + task.minutes <= s.dailyMinutes[i]);
      if (day === undefined)
        conflict(
          story,
          task.id,
          `“${task.title}” needs a ${task.minutes}-minute slot before its goal deadline. No remaining daily slot fits. Split or reduce the task, or revise availability.`,
        );
      loads[day] += task.minutes;
      allocations.push({
        taskId: task.id,
        date: addDays(s.startDate, day),
        minutes: task.minutes,
      });
      earliest = day;
    }
    visited.add(story.id);
  }
  for (const story of [...s.stories].sort(
    (a, b) => latestDay(a) - latestDay(b) || a.priority - b.priority,
  ))
    place(story);
  validateSchedule(s, allocations);
  return allocations;
}
export type ReplanCandidate = {
  stories: Story[];
  allocations: Allocation[];
  capacityMinutes: number | null;
  dailyMinutes: number[];
  bufferPercent: number;
};
export function validateReplanProposal(s: Sprint, candidate: ReplanCandidate) {
  assertDailyLength(s, candidate.dailyMinutes);
  assert(
    candidate.capacityMinutes === null ||
      candidate.capacityMinutes <=
        candidate.dailyMinutes.reduce((n, m) => n + m, 0),
    "The sprint budget exceeds daily availability.",
  );
  const beforeTasks = s.stories.flatMap((st) =>
    st.tasks.map((t) => ({ storyId: st.id, task: t })),
  );
  const afterTasks = candidate.stories.flatMap((st) =>
    st.tasks.map((t) => ({ storyId: st.id, task: t })),
  );
  for (const { storyId, task } of beforeTasks) {
    if (s.progress[task.id]?.status === "done") {
      const kept = afterTasks.find((item) => item.task.id === task.id);
      assert(
        kept,
        `Completed task “${task.title}” cannot be removed by a replan.`,
      );
      assert(
        kept.storyId === storyId && canonical(kept.task) === canonical(task),
        `Completed task “${task.title}” must retain its original scope and story.`,
      );
      assert(
        canonical(candidate.allocations.find((a) => a.taskId === task.id)) ===
          canonical(s.allocations.find((a) => a.taskId === task.id)),
        `Completed task “${task.title}” must retain its recorded allocation.`,
      );
    }
  }
  const shadow: Sprint = {
    ...s,
    stories: candidate.stories,
    allocations: candidate.allocations,
    capacityMinutes: candidate.capacityMinutes,
    dailyMinutes: candidate.dailyMinutes,
    bufferPercent: candidate.bufferPercent,
  };
  validateStories(shadow, candidate.stories);
  validateSchedule(shadow, candidate.allocations);
}
export function computeReplanDiff(
  s: Sprint,
  candidate: ReplanCandidate,
): ReplanDiff {
  const beforeTaskMap = new Map(
    s.stories.flatMap((st) =>
      st.tasks.map((t) => [t.id, { story: st, task: t }] as const),
    ),
  );
  const afterTaskMap = new Map(
    candidate.stories.flatMap((st) =>
      st.tasks.map((t) => [t.id, { story: st, task: t }] as const),
    ),
  );
  const scope: ReplanDiff["scope"] = [];
  for (const [taskId, { story, task }] of afterTaskMap.entries()) {
    const prev = beforeTaskMap.get(taskId);
    if (!prev) {
      scope.push({
        storyId: story.id,
        storyTitle: story.title,
        taskId: task.id,
        taskTitle: task.title,
        change: "added",
        beforeMinutes: 0,
        afterMinutes: task.minutes,
        deltaMinutes: task.minutes,
        summary: `Added task “${task.title}” (${task.minutes}m) in “${story.title}”.`,
      });
      continue;
    }
    const delta = task.minutes - prev.task.minutes;
    const textChanged =
      task.title !== prev.task.title ||
      task.definitionOfDone !== prev.task.definitionOfDone ||
      task.motivation !== prev.task.motivation ||
      canonical(task.subtasks) !== canonical(prev.task.subtasks);
    if (delta < 0) {
      scope.push({
        storyId: story.id,
        storyTitle: story.title,
        taskId: task.id,
        taskTitle: task.title,
        change: "reduced",
        beforeMinutes: prev.task.minutes,
        afterMinutes: task.minutes,
        deltaMinutes: delta,
        summary: `Reduced “${task.title}” from ${prev.task.minutes}m to ${task.minutes}m (${delta}m).`,
      });
    } else if (delta > 0 || textChanged) {
      scope.push({
        storyId: story.id,
        storyTitle: story.title,
        taskId: task.id,
        taskTitle: task.title,
        change: "modified",
        beforeMinutes: prev.task.minutes,
        afterMinutes: task.minutes,
        deltaMinutes: delta,
        summary:
          delta !== 0
            ? `Updated “${task.title}” from ${prev.task.minutes}m to ${task.minutes}m (+${delta}m).`
            : `Refined scope/subtasks for “${task.title}” (${task.minutes}m).`,
      });
    } else {
      scope.push({
        storyId: story.id,
        storyTitle: story.title,
        taskId: task.id,
        taskTitle: task.title,
        change: "unchanged",
        beforeMinutes: prev.task.minutes,
        afterMinutes: task.minutes,
        deltaMinutes: 0,
        summary: `Retained “${task.title}” (${task.minutes}m).`,
      });
    }
  }
  for (const [taskId, { story, task }] of beforeTaskMap.entries()) {
    if (!afterTaskMap.has(taskId)) {
      scope.push({
        storyId: story.id,
        storyTitle: story.title,
        taskId: task.id,
        taskTitle: task.title,
        change: "reduced",
        beforeMinutes: task.minutes,
        afterMinutes: 0,
        deltaMinutes: -task.minutes,
        summary: `Deferred/consolidated “${task.title}” (-${task.minutes}m) from “${story.title}”.`,
      });
    }
  }
  const beforeAllocMap = new Map(s.allocations.map((a) => [a.taskId, a]));
  const afterAllocMap = new Map(
    candidate.allocations.map((a) => [a.taskId, a]),
  );
  const dates: ReplanDiff["dates"] = [];
  for (const [taskId, afterAlloc] of afterAllocMap.entries()) {
    const beforeAlloc = beforeAllocMap.get(taskId);
    const meta = afterTaskMap.get(taskId) ?? beforeTaskMap.get(taskId);
    if (
      !beforeAlloc ||
      beforeAlloc.date !== afterAlloc.date ||
      beforeAlloc.minutes !== afterAlloc.minutes
    ) {
      dates.push({
        taskId,
        taskTitle: meta?.task.title ?? taskId,
        storyId: meta?.story.id ?? "story",
        fromDate: beforeAlloc?.date ?? null,
        toDate: afterAlloc.date,
        beforeMinutes: beforeAlloc?.minutes ?? 0,
        afterMinutes: afterAlloc.minutes,
      });
    }
  }
  const beforeStoryMap = new Map(s.stories.map((st) => [st.id, st]));
  const dependencies: ReplanDiff["dependencies"] = [];
  for (const st of candidate.stories) {
    const prev = beforeStoryMap.get(st.id);
    const beforeDeps = prev ? [...prev.dependencyIds].sort() : [];
    const afterDeps = [...st.dependencyIds].sort();
    if (canonical(beforeDeps) !== canonical(afterDeps)) {
      dependencies.push({
        storyId: st.id,
        storyTitle: st.title,
        beforeDependsOn: prev?.dependencyIds ?? [],
        afterDependsOn: st.dependencyIds,
      });
    }
  }
  const beforeCap = capacity(s, s.allocations);
  const shadow: Sprint = {
    ...s,
    stories: candidate.stories,
    allocations: candidate.allocations,
    capacityMinutes: candidate.capacityMinutes,
    dailyMinutes: candidate.dailyMinutes,
    bufferPercent: candidate.bufferPercent,
  };
  const afterCap = capacity(shadow, candidate.allocations);
  const beforeOverloadedDays = beforeCap.dayLoads.filter(
    (load, i) => load > s.dailyMinutes[i],
  ).length;
  const afterOverloadedDays = afterCap.dayLoads.filter(
    (load, i) => load > candidate.dailyMinutes[i],
  ).length;
  return {
    scope,
    dates,
    dependencies,
    capacity: {
      beforePlannedMinutes: beforeCap.planned,
      afterPlannedMinutes: afterCap.planned,
      deltaPlannedMinutes: afterCap.planned - beforeCap.planned,
      beforeUsableMinutes: beforeCap.usable,
      afterUsableMinutes: afterCap.usable,
      beforeOverbookedMinutes: beforeCap.overbooked,
      afterOverbookedMinutes: afterCap.overbooked,
      beforeOverloadedDays,
      afterOverloadedDays,
    },
  };
}
export function buildPendingReplan(
  s: Sprint,
  input: {
    source: "agent" | "manual";
    reason: string;
    impactSummary: string;
    stories: Story[];
    allocations: Allocation[];
    capacityMinutes: number | null;
    dailyMinutes: number[];
    bufferPercent: number;
    changes?: ReplanChange[];
    notes?: string[];
    createdAt: string;
  },
): PendingReplan {
  validateReplanProposal(s, input);
  const diff = computeReplanDiff(s, input);
  const synthesizedChanges: ReplanChange[] =
    input.changes && input.changes.length
      ? input.changes
      : diff.dates.length
        ? diff.dates.map((d) => ({
            kind: "reschedule" as const,
            storyId: d.storyId,
            taskId: d.taskId,
            summary: `Move “${d.taskTitle}” from ${d.fromDate ?? "unscheduled"} to ${d.toDate ?? "unscheduled"}.`,
            reason: input.reason,
          }))
        : [
            {
              kind: "retain" as const,
              storyId: input.stories[0].id,
              taskId: null,
              summary: "Reviewed schedule and capacity settings.",
              reason: input.reason,
            },
          ];
  return {
    source: input.source,
    reason: input.reason,
    impactSummary: input.impactSummary,
    stories: input.stories,
    allocations: input.allocations,
    capacityMinutes: input.capacityMinutes,
    dailyMinutes: input.dailyMinutes,
    bufferPercent: input.bufferPercent,
    changes: synthesizedChanges.slice(0, 60),
    notes: (input.notes ?? []).slice(0, 6),
    diff,
    createdAt: input.createdAt,
  };
}
export function approvalPayload(
  s: Sprint,
  kind: "goals" | "stories" | "schedule" | "activation" | "replan",
) {
  if (kind === "goals") return s.goals;
  if (kind === "stories") return { goals: s.goals, stories: s.stories };
  if (kind === "replan") {
    if (s.pendingReplan) {
      return {
        pendingReplan: {
          source: s.pendingReplan.source,
          reason: s.pendingReplan.reason,
          impactSummary: s.pendingReplan.impactSummary,
          stories: s.pendingReplan.stories,
          allocations: s.pendingReplan.allocations,
          capacityMinutes: s.pendingReplan.capacityMinutes,
          dailyMinutes: s.pendingReplan.dailyMinutes,
          bufferPercent: s.pendingReplan.bufferPercent,
          changes: s.pendingReplan.changes,
          notes: s.pendingReplan.notes,
          diff: s.pendingReplan.diff,
        },
        goals: s.goals,
      };
    }
    return {
      pendingSchedule: s.pendingSchedule,
      goals: s.goals,
      stories: s.stories,
      capacityMinutes: s.capacityMinutes,
      dailyMinutes: s.dailyMinutes,
      bufferPercent: s.bufferPercent,
    };
  }
  return {
    startDate: s.startDate,
    endDate: s.endDate,
    timezone: s.timezone,
    goals: s.goals,
    stories: s.stories,
    allocations: s.allocations,
    capacityMinutes: s.capacityMinutes,
    dailyMinutes: s.dailyMinutes,
    bufferPercent: s.bufferPercent,
  };
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
export function hasApproval(s: Sprint, kind: "goals" | "stories" | "schedule") {
  return s.approvals.some((a) => a.kind === kind);
}
