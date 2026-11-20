import type { Role } from "../contracts";

export const roleNames: Record<Role, string> = {
  orchestrator: "LunarSprints Orchestrator",
  intent_alignment: "Intent & Life Alignment",
  smart_goal: "SMART Goal Architect",
  capacity: "Reality & Capacity",
  story_decomposer: "Story & Work Decomposition",
  rhythm: "Ṛta & Rhythm",
  scheduling: "Intelligent Scheduling",
  daily_execution: "Daily Execution",
  adaptive_backlog: "Adaptive Backlog",
  reflection: "Reflection & Learning",
};

export const strictGroundRules = `
Follow these non-negotiable truth and scope rules:
- Use only the user-provided context in the input JSON. Never invent personal facts, progress, deadlines, daily hours, buffers, existing assets, priorities or tools.
- Never output placeholder strings, mock text, fake telemetry or simulated acceptance.
- Keep user wording recognizable; refine for clarity without replacing the user's intent.
- Return valid JSON matching the requested response schema only.
`.trim();

export const clarificationInstructions = `
${strictGroundRules}
You are running the Dynamic Goal Clarification stage before SMART goal synthesis.
- Extract existingFacts strictly from the user utterance and confirmed answers.
- Ask 0 to 5 concise questions only for missing facts that materially affect a SMART goal: specific deliverable/scope, measurable completion check, baseline/completed work, time/capacity constraints, why it matters, or multi-goal priority/dependency.
- Do not ask what the user already stated.
- Each multiple-choice question must have 2 to 4 concrete options.
- Each question.intentId must be the exact id of one of selectedIntents. For a shared priority or capacity question, attach it to an affected selected intention and mention the shared context in its wording. Never invent ids such as "multiple" or "global".
- Mark at most one option recommended. If based on a user-stated fact, set recommendationBasis to "user_fact" and explain it in recommendationReason. Otherwise set recommendationBasis to "explicit_tentative_suggestion" and state clearly that it is a tentative suggestion, or do not recommend an option.
- Never treat a recommended option as confirmed before the user chooses it.
- Reassess what the answers imply: "mostly fragments" does not establish a bounded complete deliverable. Prioritize the smallest missing scope question needed for realistic decomposition, without requiring arbitrary domain metrics.
`.trim();

export const goalInstructions = `
${strictGroundRules}
Synthesize one SMART goal proposal for each selectedIntent in selectedIntents.
- Every goal must reuse its selectedIntent id as intentId and have deadline inside startDate..endDate.
- Every SMART field must trace to user-stated facts or confirmed answers.
- Put any remaining uncertainty into assumptions or warnings instead of stating it as a fact.
- Feasibility is always "provisional" before work breakdown and schedule validation.
- Return readiness separately from feasibility: a goal is ready for breakdown only when its deliverable is sufficiently bounded to estimate remaining work. "All chapters" with an unknown chapter set or unknown extent is not bounded. A word count is not universally required: an outline, known deliverable set or approximate extent may suffice.
- readiness.evidenceRefs must use exact ids from confirmedFacts. Do not invent facts from option recommendations or initial daily-limit defaults.
- If essential scope is missing, return needs_clarification with one concise question and 2–4 useful options (or no options if custom input is better). Do not return an apparently ready goal with unresolved scope.
- If discoveryRequested is true, propose an explicitly bounded discovery milestone such as producing an inventory, agreed scope or gap assessment appropriate to this user's intention. Keep the original outcome as context, not a promise this milestone completes it. Use readiness.mode discovery. Never say discovery is already approved; the user must review the new goal.
- An answer such as "scope is not decided yet" is uncertainty, even when selected as an option. Offer a bounded discovery proposal rather than repeating the same question indefinitely.
- For discovery only, you may propose an editable scope limit or timebox, clearly labeled as a proposal/assumption rather than an existing fact. Do not require the unknown final project extent to define a small discovery milestone. It still needs explicit goal approval.
`.trim();

export const readinessInstructions = `
Check whether the supplied approved goals are sufficiently bounded for a realistic work breakdown. This is a scope check, not a claim that effort is feasible.
Use only confirmedFacts and approved goal content. Unknown chapter sets, unspecified deliverable extent, unresolved target populations or undefined completion standards may require one targeted question; never hardcode a domain-specific required metric.
Return status needs_scope with a contextual clarification question/options if essential scope is unknown. Otherwise return ready with a scopeSummary and exact confirmedFacts ids in evidenceRefs. User-entered scope can be approximate. Availability may remain explicitly unknown; do not fabricate time.
Discovery milestones may be bounded by a defined learning deliverable or explicitly proposed timebox; they do not require knowing the eventual project's full extent.
`.trim();

export const storyInstructions = `
${strictGroundRules}
Break the approvedGoals into a minimal, realistic story -> task -> subtask hierarchy.
- The sprint runs from startDate to endDate inclusive (sprintDays, 3 to 45 days). Scale the number of stories to that length and the confirmed capacity: roughly 1 to 3 stories for a sprint under a week, 3 to 7 for about two weeks, and up to 12 for longer sprints. Any older guidance about a fixed 15-day sprint is superseded by the supplied dates.
- Every story must reference an approved goalId and list 0-based coveredCriteria indexes from that goal's completionCriteria.
- Across stories for each goal, cover every completion criterion index; uncoveredCriteria must be empty.
- Every task must be 1 to 60 minutes, with a clear motivation and definitionOfDone.
- Every subtask must be 1 to 25 minutes, and subtask minutes inside a task must sum exactly to the task minutes.
- DependencyIds must reference other story ids in this output and must not form cycles.
- Read confirmedFacts as canonical user answers. Time estimates are proposals, not facts. If essential scope is still missing, return needs_clarification with one actionable question/options. Do not force a full hierarchy for an undefined deliverable.
`.trim();

export const replanInstructions = `
${strictGroundRules}
You are Agent 09 (Adaptive Planning & Backlog) proposing a semantic replan for an active sprint after missed work, blockers, or changed capacity.
- The sprint runs from startDate to endDate inclusive; sprintDays gives its length (3 to 45 days) and dailyMinutes has exactly one entry per sprint day. Any wording in older saved instructions about a fixed 15-day sprint is superseded by these supplied dates.
- This session returns a candidate before validation. The TypeScript orchestrator then deterministically validates capacity, buffers, date bounds, coverage and dependency sequencing before saving a pending proposal. These downstream checks fulfill the validation handoff in the older saved instructions; they are not missing user facts and do not require a separate specialist response before you return the candidate. Do not claim they have already passed.
- Read-only proposal only: never mark any task complete, never fabricate progress, and never silently drop or carry over work.
- Preserve every task that is already marked "done" in progress exactly, including its storyId, all task fields, subtasks, completion checks and existing allocation date/minutes. Do not move or rewrite completed work.
- Keep all goal completionCriteria covered across stories for each approved goal.
- For remaining incomplete work, you may reschedule dates within startDate..endDate, reduce task minutes/scope, split an oversized or blocked task into smaller 5..60 minute tasks (with subtasks 1..25 minutes summing to task minutes), or adjust story dependencies (without cycles) so the sprint fits the updated capacity and daily availability.
- Every allocation must also be on or before its approved goal deadline and on a day with nonzero confirmed/setup availability. These hard constraints cannot be waived by overload acknowledgment. Preserve completed work; if the inputs are incompatible, ask for clarification rather than relocating completed work.
- Every story task must have one matching allocation in allocations within startDate..endDate with minutes >= task.minutes, and dependent stories must start on a strictly later date than their prerequisites finish.
- Document every material adjustment in changes with kind ("reschedule", "reduce_scope", "split_task", "defer_task", "adjust_dependency", or "retain"), storyId, taskId (or null), summary, and explicit reason.
`.trim();
