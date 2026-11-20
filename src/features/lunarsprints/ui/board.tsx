"use client";
import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  GitCompareArrows,
  MoveRight,
  Sparkles,
  X,
} from "lucide-react";
import type {
  Allocation,
  Progress,
  ReplanChange,
  ReplanDiff,
  Sprint,
} from "../contracts";
import {
  addDays,
  capacity,
  computeReplanDiff,
  displayDate,
  sprintDays,
  todayIn,
} from "../domain";
import { Button, CheckList, Notice } from "./shared";
import { CapacitySummary } from "./schedule-editor";
import type { Send } from "./workspace";

/** Plain words for the kinds of change a suggested plan can make. */
const changeLabels: Record<ReplanChange["kind"], string> = {
  reschedule: "Moved",
  reduce_scope: "Made smaller",
  split_task: "Split",
  defer_task: "Moved later",
  adjust_dependency: "Order changed",
  retain: "Kept",
};
const scopeLabels: Record<ReplanDiff["scope"][number]["change"], string> = {
  added: "Added",
  modified: "Changed",
  reduced: "Made smaller",
  unchanged: "Unchanged",
};

export function Board({
  sprint: s,
  busy,
  send,
}: {
  sprint: Sprint;
  hashes: Record<string, string>;
  busy: boolean;
  send: Send;
}) {
  const today = todayIn(s.timezone);
  const [day, setDay] = useState(
    today >= s.startDate && today <= s.endDate ? today : "all",
  );
  const [goal, setGoal] = useState("all");
  const [mode, setMode] = useState<"board" | "stories">("board");
  const [selected, setSelected] = useState<string | null>(null);
  const [statusOverride, setStatusOverride] = useState<
    Progress["status"] | null
  >(null);
  const [risk, setRisk] = useState(false);
  const [showReplanForm, setShowReplanForm] = useState(false);
  const [replanReason, setReplanReason] = useState("");
  const [replanHours, setReplanHours] = useState(
    s.capacityMinutes === null ? 10 : s.capacityMinutes / 60,
  );
  const [replanUnknownCap, setReplanUnknownCap] = useState(
    s.capacityMinutes === null,
  );
  const [replanBuffer, setReplanBuffer] = useState(s.bufferPercent);
  const [editingReplan, setEditingReplan] = useState(false);
  const [draftAllocations, setDraftAllocations] = useState<Allocation[]>(
    s.pendingReplan?.allocations ?? s.pendingSchedule ?? s.allocations,
  );

  const [draftRevision, setDraftRevision] = useState(s.revision);
  if (draftRevision !== s.revision) {
    setDraftRevision(s.revision);
    setDraftAllocations(
      s.pendingReplan?.allocations ?? s.pendingSchedule ?? s.allocations,
    );
    setEditingReplan(false);
    setRisk(false);
  }

  const tasks = s.stories.flatMap((st) =>
    st.tasks.map((t) => ({
      ...t,
      story: st,
      allocation: s.allocations.find((a) => a.taskId === t.id)!,
    })),
  );
  const visible = tasks.filter(
    (t) =>
      (day === "all" || t.allocation.date === day) &&
      (goal === "all" || t.story.goalId === goal),
  );
  const done = tasks.filter((t) => s.progress[t.id]?.status === "done").length;
  const planned = tasks.reduce((n, t) => n + t.minutes, 0);
  const reported = tasks.reduce(
    (n, t) => n + (t.minutes * (s.progress[t.id]?.percent ?? 0)) / 100,
    0,
  );
  const actuals = Object.values(s.progress).filter(
    (p) => p.actualMinutes !== null,
  );
  const columns = [
    { key: "todo", name: "To do" },
    { key: "in_progress", name: "In progress" },
    { key: "partial", name: "Partially complete" },
    { key: "blocked", name: "Blocked" },
    { key: "done", name: "Done" },
  ] as const;

  function open(id: string, status: Progress["status"] | null = null) {
    setSelected(id);
    setStatusOverride(status);
  }

  async function proposeMove(taskId: string, date: string) {
    if (s.progress[taskId]?.status === "done") return;
    await send("propose_replan", {
      allocations: s.allocations.map((a) =>
        a.taskId === taskId ? { ...a, date } : a,
      ),
      notes: [`Moved task ${taskId} to ${date}.`],
    });
  }

  const activePendingReplan =
    s.pendingReplan ??
    (s.pendingSchedule
      ? {
          source: "manual" as const,
          reason: "Manual schedule adjustment.",
          impactSummary:
            "The approved schedule stays in place until you accept this exact change.",
          stories: s.stories,
          allocations: s.pendingSchedule,
          capacityMinutes: s.capacityMinutes,
          dailyMinutes: s.dailyMinutes,
          bufferPercent: s.bufferPercent,
          changes: [],
          notes: [],
          diff: computeReplanDiff(s, {
            stories: s.stories,
            allocations: s.pendingSchedule,
            capacityMinutes: s.capacityMinutes,
            dailyMinutes: s.dailyMinutes,
            bufferPercent: s.bufferPercent,
          }),
          createdAt: s.updatedAt,
        }
      : null);

  const pendingTaskLookup = new Map(
    (activePendingReplan?.stories ?? s.stories).flatMap((st) =>
      st.tasks.map((t) => [t.id, { task: t, story: st }] as const),
    ),
  );
  const task = tasks.find((t) => t.id === selected);

  return (
    <section className="execution">
      <div className="board-heading">
        <div>
          <span className="badge success">
            {displayDate(s.startDate)} to {displayDate(s.endDate)}
          </span>
          <h1>Your active sprint</h1>
          <p>{s.goals.map((g) => g.title).join(", ")}</p>
        </div>
        <div className="actions">
          <Button
            secondary
            busy={busy}
            onClick={() => setShowReplanForm((v) => !v)}
          >
            <GitCompareArrows size={16} /> Adjust the plan
          </Button>
          <Button secondary busy={busy} onClick={() => void send("reflect")}>
            Reflect
          </Button>
          <Button busy={busy} onClick={() => void send("next_action")}>
            <Sparkles size={16} /> Suggest next action
          </Button>
        </div>
      </div>
      <div className="execution-metrics">
        <div>
          <span>Steps done</span>
          <strong>
            {done}
            <small> / {tasks.length}</small>
          </strong>
        </div>
        <div>
          <span>Reported progress</span>
          <strong>
            {Math.round(planned ? (reported / planned) * 100 : 0)}
            <small>% of estimated effort</small>
          </strong>
        </div>
        <div>
          <span>Estimated time left</span>
          <strong>
            {((planned - reported) / 60).toFixed(1)}
            <small> hours</small>
          </strong>
        </div>
        <div>
          <span>Time you logged</span>
          <strong>
            {actuals.length
              ? actuals.reduce((n, p) => n + p.actualMinutes!, 0)
              : "None"}
            <small>{actuals.length ? " minutes" : " logged yet"}</small>
          </strong>
        </div>
      </div>
      {showReplanForm && (
        <section className="panel replan-request" aria-label="Adjust the plan">
          <div className="row between">
            <div>
              <span className="badge">Adjust the plan</span>
              <h2>Life changed? Rebalance what’s left.</h2>
            </div>
            <button
              className="icon-button"
              aria-label="Close replan form"
              onClick={() => setShowReplanForm(false)}
            >
              <X size={18} />
            </button>
          </div>
          <p>
            Missed a day, hit a blocker, or have less time? You’ll get a
            suggested new plan with every change shown side by side. Finished
            steps stay as they are, and nothing changes until you approve.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await send("request_replan", {
                reason:
                  replanReason.trim() ||
                  "Rebalance remaining work and schedule for current progress and capacity.",
                capacityMinutes: replanUnknownCap
                  ? null
                  : Math.round(replanHours * 60),
                dailyMinutes: s.dailyMinutes,
                bufferPercent: replanBuffer,
              });
              if (res) setShowReplanForm(false);
            }}
          >
            <label>
              What changed in your schedule or scope?
              <textarea
                rows={2}
                maxLength={1000}
                placeholder="Example: Missed two days due to travel; need to fit remaining tasks into 8 hours total."
                value={replanReason}
                onChange={(e) => setReplanReason(e.target.value)}
              />
            </label>
            <div className="field-grid">
              <label>
                Updated sprint budget (hours)
                <input
                  type="number"
                  step=".5"
                  min=".5"
                  max="360"
                  disabled={replanUnknownCap}
                  value={replanHours}
                  onChange={(e) => setReplanHours(Number(e.target.value))}
                />
              </label>
              <label>
                Buffer %
                <select
                  value={replanBuffer}
                  onChange={(e) => setReplanBuffer(Number(e.target.value))}
                >
                  {[0, 10, 15, 20, 25, 30].map((n) => (
                    <option key={n} value={n}>
                      {n}%
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={replanUnknownCap}
                onChange={(e) => setReplanUnknownCap(e.target.checked)}
              />{" "}
              Total capacity is unknown
            </label>
            <div className="actions">
              <Button type="submit" busy={busy}>
                <Sparkles size={15} /> Suggest a new plan
              </Button>
              <Button
                type="button"
                secondary
                onClick={() => setShowReplanForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </section>
      )}
      {s.nextAction && (
        <Notice>
          <Sparkles size={20} />
          <div>
            <strong>
              {s.nextAction.actionTitle ?? "No ready task at the moment"}
            </strong>
            <p>{s.nextAction.reason}</p>
          </div>
          {s.nextAction.taskId && (
            <Button secondary onClick={() => open(s.nextAction!.taskId!)}>
              Open task
            </Button>
          )}
        </Notice>
      )}
      {s.assistantMessage &&
        s.assistantMessage !==
          "Your sprint is active. Pick a day or a task to begin." && (
          <Notice>{s.assistantMessage}</Notice>
        )}
      <div className="board-calendar-header">
        <h2>Your {sprintDays(s)}-day horizon</h2>
        <div className="actions">
          <button
            className="text-button"
            onClick={() =>
              setDay(today >= s.startDate && today <= s.endDate ? today : "all")
            }
          >
            Today
          </button>
          <button className="text-button" onClick={() => setDay("all")}>
            All days
          </button>
        </div>
      </div>
      <div
        className="board-calendar"
        style={{ "--cols": Math.min(sprintDays(s), 15) } as React.CSSProperties}
      >
        {Array.from({ length: sprintDays(s) }, (_, i) => {
          const date = addDays(s.startDate, i);
          const items = tasks.filter((t) => t.allocation.date === date);
          const dayMinutes = items.reduce(
            (n, t) => n + t.allocation.minutes,
            0,
          );
          const isOverloaded = dayMinutes > s.dailyMinutes[i];
          return (
            <button
              key={date}
              className={`calendar-day ${day === date ? "selected" : ""} ${isOverloaded ? "overloaded" : ""}`}
              onClick={() => setDay(date)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void proposeMove(e.dataTransfer.getData("text/task-id"), date);
              }}
            >
              <span>{date === today ? "Today" : `Day ${i + 1}`}</span>
              <strong>{displayDate(date)}</strong>
              <small>
                {dayMinutes}m / {s.dailyMinutes[i]}m
              </small>
              <span className="day-progress">
                <i
                  style={{
                    width: `${items.length ? (items.filter((t) => s.progress[t.id]?.status === "done").length / items.length) * 100 : 0}%`,
                  }}
                />
              </span>
            </button>
          );
        })}
      </div>
      {activePendingReplan && (
        <section className="panel replan" aria-label="Pending replan review">
          <div className="row between">
            <div>
              <span className="badge">
                {activePendingReplan.source === "agent"
                  ? "Suggested new plan, waiting for your approval"
                  : "Pending approval"}
              </span>
              <h2>Review schedule change</h2>
            </div>
            <div className="actions">
              <button
                type="button"
                className="text-button"
                onClick={() => setEditingReplan((v) => !v)}
              >
                {editingReplan ? "Hide editor" : "Edit proposal"}
              </button>
            </div>
          </div>
          <p>{activePendingReplan.impactSummary}</p>
          {activePendingReplan.reason && (
            <p className="small">
              <strong>Reason:</strong> {activePendingReplan.reason}
            </p>
          )}
          <div className="replan-diff-grid">
            <div className="replan-diff-card">
              <span>Planned time</span>
              <strong>
                {activePendingReplan.diff.capacity.beforePlannedMinutes}m{" "}
                <MoveRight size={13} />{" "}
                {activePendingReplan.diff.capacity.afterPlannedMinutes}m
              </strong>
              <small>
                {activePendingReplan.diff.capacity.deltaPlannedMinutes === 0
                  ? "No change in total time"
                  : `${activePendingReplan.diff.capacity.deltaPlannedMinutes > 0 ? "+" : ""}${activePendingReplan.diff.capacity.deltaPlannedMinutes}m planned effort`}
              </small>
            </div>
            <div className="replan-diff-card">
              <span>Date changes</span>
              <strong>
                {activePendingReplan.diff.dates.length} step
                {activePendingReplan.diff.dates.length === 1 ? "" : "s"}
              </strong>
              <small>Rescheduled inside this sprint’s dates</small>
            </div>
            <div className="replan-diff-card">
              <span>Milestone order</span>
              <strong>
                {activePendingReplan.diff.dependencies.length
                  ? `${activePendingReplan.diff.dependencies.length} updated`
                  : "Unchanged"}
              </strong>
              <small>Order of milestones checked</small>
            </div>
            <div className="replan-diff-card">
              <span>Overloaded days</span>
              <strong>
                {activePendingReplan.diff.capacity.beforeOverloadedDays}{" "}
                <MoveRight size={13} />{" "}
                {activePendingReplan.diff.capacity.afterOverloadedDays}
              </strong>
              <small>
                Overbooked:{" "}
                {activePendingReplan.diff.capacity.beforeOverbookedMinutes}m →{" "}
                {activePendingReplan.diff.capacity.afterOverbookedMinutes}m
              </small>
            </div>
          </div>
          {activePendingReplan.changes.length > 0 && (
            <div className="replan-section">
              <h3>What changes and why</h3>
              {activePendingReplan.changes.map((ch, idx) => (
                <div
                  className="replan-diff"
                  key={`${ch.storyId}-${ch.taskId ?? idx}`}
                >
                  <div>
                    <span className="badge">{changeLabels[ch.kind]}</span>{" "}
                    <strong>{ch.summary}</strong>
                    <p className="small">{ch.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {activePendingReplan.diff.scope.some(
            (item) => item.change !== "unchanged",
          ) && (
            <div className="replan-section">
              <h3>Changes to steps and time</h3>
              {activePendingReplan.diff.scope
                .filter((item) => item.change !== "unchanged")
                .map((item) => (
                  <div
                    className="replan-diff"
                    key={`${item.storyId}-${item.taskId ?? item.storyTitle}`}
                  >
                    <div>
                      <span className="badge">{scopeLabels[item.change]}</span>{" "}
                      <strong>{item.taskTitle ?? item.storyTitle}</strong>
                      <p className="small">{item.summary}</p>
                    </div>
                    <span>
                      {item.beforeMinutes}m <MoveRight size={14} />{" "}
                      {item.afterMinutes}m
                    </span>
                  </div>
                ))}
            </div>
          )}
          {activePendingReplan.diff.dates.length > 0 && (
            <div className="replan-section">
              <h3>Date changes</h3>
              {activePendingReplan.diff.dates.map((d) => (
                <div className="replan-diff" key={d.taskId}>
                  <strong>
                    {pendingTaskLookup.get(d.taskId)?.task.title ?? d.taskTitle}
                  </strong>
                  <span>
                    {d.fromDate ? displayDate(d.fromDate) : "New"}{" "}
                    <MoveRight size={16} />{" "}
                    {d.toDate ? displayDate(d.toDate) : "Removed"},{" "}
                    {d.afterMinutes}m
                  </span>
                </div>
              ))}
            </div>
          )}
          {activePendingReplan.diff.dependencies.length > 0 && (
            <div className="replan-section">
              <h3>Changes to milestone order</h3>
              {activePendingReplan.diff.dependencies.map((dep) => (
                <div className="replan-diff" key={dep.storyId}>
                  <strong>{dep.storyTitle}</strong>
                  <span>
                    [{dep.beforeDependsOn.join(", ") || "none"}]{" "}
                    <MoveRight size={14} /> [
                    {dep.afterDependsOn.join(", ") || "none"}]
                  </span>
                </div>
              ))}
            </div>
          )}
          {editingReplan && (
            <div className="replan-editor">
              <h3>Edit dates and time before you approve</h3>
              {draftAllocations.map((alloc) => {
                const entry = pendingTaskLookup.get(alloc.taskId);
                return (
                  <div className="allocation-row" key={alloc.taskId}>
                    <span className="drag-handle">⋮</span>
                    <div>
                      <strong>{entry?.task.title ?? alloc.taskId}</strong>
                      <span>
                        {entry?.story.title ?? ""}, at least{" "}
                        {entry?.task.minutes ?? alloc.minutes}m
                      </span>
                    </div>
                    <label>
                      <span className="sr-only">Proposed date</span>
                      <input
                        type="date"
                        min={s.startDate}
                        max={
                          s.goals.find((g) => g.id === entry?.story.goalId)
                            ?.deadline ?? s.endDate
                        }
                        value={alloc.date}
                        onChange={(e) =>
                          setDraftAllocations((list) =>
                            list.map((a) =>
                              a.taskId === alloc.taskId
                                ? { ...a, date: e.target.value }
                                : a,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      <span className="sr-only">Proposed minutes</span>
                      <input
                        type="number"
                        min={entry?.task.minutes ?? 1}
                        max={60}
                        value={alloc.minutes}
                        onChange={(e) =>
                          setDraftAllocations((list) =>
                            list.map((a) =>
                              a.taskId === alloc.taskId
                                ? { ...a, minutes: Number(e.target.value) }
                                : a,
                            ),
                          )
                        }
                      />
                      <span>min</span>
                    </label>
                  </div>
                );
              })}
              <div className="actions">
                <Button
                  secondary
                  busy={busy}
                  onClick={() =>
                    void send("edit_replan", {
                      stories: activePendingReplan.stories,
                      allocations: draftAllocations,
                      capacityMinutes: activePendingReplan.capacityMinutes,
                      dailyMinutes: activePendingReplan.dailyMinutes,
                      bufferPercent: activePendingReplan.bufferPercent,
                      reason: activePendingReplan.reason,
                      notes: activePendingReplan.notes,
                    })
                  }
                >
                  Save proposal edits
                </Button>
              </div>
            </div>
          )}
          <CapacitySummary
            sprint={{
              ...s,
              stories: activePendingReplan.stories,
              capacityMinutes: activePendingReplan.capacityMinutes,
              dailyMinutes: activePendingReplan.dailyMinutes,
              bufferPercent: activePendingReplan.bufferPercent,
            }}
            allocations={activePendingReplan.allocations}
          />
          {(() => {
            const c = capacity(
              {
                ...s,
                stories: activePendingReplan.stories,
                capacityMinutes: activePendingReplan.capacityMinutes,
                dailyMinutes: activePendingReplan.dailyMinutes,
                bufferPercent: activePendingReplan.bufferPercent,
              },
              activePendingReplan.allocations,
            );
            return (
              (c.unknown ||
                c.overbooked ||
                c.dailyOverload ||
                c.dailyBufferOverload) && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={risk}
                    onChange={(e) => setRisk(e.target.checked)}
                  />{" "}
                  I understand the displayed capacity risk.
                </label>
              )
            );
          })()}
          <div className="actions">
            <Button
              busy={busy}
              onClick={() =>
                void send("approve_replan", { acknowledgeRisk: risk }, "replan")
              }
            >
              Approve schedule change
            </Button>
            <Button
              secondary
              busy={busy}
              onClick={() => void send("reject_replan", {})}
            >
              Keep my current plan
            </Button>
          </div>
        </section>
      )}
      <div className="board-toolbar">
        <div className="segmented">
          <button
            className={mode === "board" ? "selected" : ""}
            onClick={() => setMode("board")}
          >
            Board
          </button>
          <button
            className={mode === "stories" ? "selected" : ""}
            onClick={() => setMode("stories")}
          >
            Milestones
          </button>
        </div>
        <label className="filter-label">
          Goal
          <select value={goal} onChange={(e) => setGoal(e.target.value)}>
            <option value="all">All goals</option>
            {s.goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
        <span className="small">
          {day === "all" ? `All ${sprintDays(s)} days` : displayDate(day)},{" "}
          {visible.length} {visible.length === 1 ? "step" : "steps"}
        </span>
      </div>
      {mode === "board" ? (
        <div className="kanban">
          {columns.map((col) => {
            const items = visible.filter(
              (t) => (s.progress[t.id]?.status ?? "todo") === col.key,
            );
            return (
              <section
                className={`kanban-column ${col.key}`}
                key={col.key}
                aria-label={col.name}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/task-id");
                  if (id) open(id, col.key);
                }}
              >
                <div className="column-title">
                  <h2>{col.name}</h2>
                  <span>{items.length}</span>
                </div>
                {items.length ? (
                  items.map((t) => (
                    <button
                      key={t.id}
                      className="kanban-task"
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/task-id", t.id)
                      }
                      onClick={() => open(t.id)}
                    >
                      <div className="row between">
                        <span className="mono">P{t.story.priority}</span>
                        <span>{t.minutes}m</span>
                      </div>
                      <small>{t.story.title}</small>
                      <h3>{t.title}</h3>
                      <p>{t.definitionOfDone}</p>
                      <div className="task-progress">
                        <i
                          style={{
                            width: `${s.progress[t.id]?.percent ?? 0}%`,
                          }}
                        />
                      </div>
                      <div className="row between">
                        <span>{displayDate(t.allocation.date)}</span>
                        <span>
                          {s.progress[t.id]?.percent ?? 0}%{" "}
                          <ChevronRight size={12} />
                        </span>
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="column-empty">Nothing here yet.</p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="outcome-lanes">
          {s.stories
            .filter((st) => goal === "all" || st.goalId === goal)
            .map((st) => (
              <section className="panel" key={st.id}>
                <div className="row between">
                  <h2>{st.title}</h2>
                  <span>
                    {
                      st.tasks.filter(
                        (t) => s.progress[t.id]?.status === "done",
                      ).length
                    }
                    /{st.tasks.length} done
                  </span>
                </div>
                <p>{s.goals.find((g) => g.id === st.goalId)?.title}</p>
                <CheckList items={st.definitionOfDone} />
                <div className="outcome-tasks">
                  {st.tasks.map((t) => (
                    <button key={t.id} onClick={() => open(t.id)}>
                      <CheckCircle2
                        size={16}
                        className={
                          s.progress[t.id]?.status === "done"
                            ? "success-text"
                            : ""
                        }
                      />
                      {t.title}
                      <span>{s.progress[t.id]?.percent ?? 0}%</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
      <p className="small board-caption">
        Completion is based on your reports and completion checks. Moving a task
        opens a review; dates and status never change silently.
      </p>
      {task && (
        <TaskDialog
          key={task.id}
          task={task}
          progress={s.progress[task.id]}
          override={statusOverride}
          busy={busy}
          onClose={() => {
            setSelected(null);
            setStatusOverride(null);
          }}
          onSave={async (p) => {
            const saved = await send("progress", { taskId: task.id, ...p });
            if (saved) {
              setSelected(null);
              setStatusOverride(null);
            }
          }}
          onMove={(date) => proposeMove(task.id, date)}
          sprint={s}
        />
      )}
    </section>
  );
}

type BoardTask = Sprint["stories"][number]["tasks"][number] & {
  story: Sprint["stories"][number];
  allocation: Sprint["allocations"][number];
};

function TaskDialog({
  task: t,
  progress,
  override,
  busy,
  onClose,
  onSave,
  onMove,
  sprint: s,
}: {
  task: BoardTask;
  progress: Progress | undefined;
  override: Progress["status"] | null;
  busy: boolean;
  onClose: () => void;
  onSave: (p: Omit<Progress, "updatedAt">) => Promise<void>;
  onMove: (date: string) => Promise<void>;
  sprint: Sprint;
}) {
  const [status, setStatus] = useState<Progress["status"]>(
    override ?? progress?.status ?? "todo",
  );
  const [percent, setPercent] = useState(
    override === "done" ? 100 : (progress?.percent ?? 0),
  );
  const [dod, setDod] = useState(progress?.dodConfirmed ?? false);
  const [subs, setSubs] = useState<string[]>(
    progress?.completedSubtaskIds ?? [],
  );
  const [note, setNote] = useState(progress?.note ?? "");
  const [minutes, setMinutes] = useState(
    progress?.actualMinutes === null || progress?.actualMinutes === undefined
      ? ""
      : String(progress.actualMinutes),
  );
  const [date, setDate] = useState(t.allocation.date);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
    };
  }, []);
  return (
    <dialog ref={dialog} className="task-dialog" onCancel={onClose}>
      <div className="dialog-header">
        <span className="small">{t.story.title}</span>
        <button
          className="icon-button"
          aria-label="Close task"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <h2>{t.title}</h2>
      <p>{t.motivation}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({
            status,
            percent,
            dodConfirmed: dod,
            completedSubtaskIds: subs,
            note,
            actualMinutes: minutes === "" ? null : Number(minutes),
          });
        }}
      >
        <div className="task-completion">
          <h3>Done means</h3>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={dod}
              onChange={(e) => setDod(e.target.checked)}
            />
            {t.definitionOfDone}
          </label>
        </div>
        <h3>Subtask checks</h3>
        {t.subtasks.length ? (
          t.subtasks.map((sub) => (
            <label className="subtask-check" key={sub.id}>
              <input
                type="checkbox"
                checked={subs.includes(sub.id)}
                onChange={() =>
                  setSubs(
                    subs.includes(sub.id)
                      ? subs.filter((id) => id !== sub.id)
                      : [...subs, sub.id],
                  )
                }
              />
              <span>
                <strong>
                  {sub.title} <small>{sub.minutes}m estimate</small>
                </strong>
                <small>{sub.definitionOfDone}</small>
              </span>
            </label>
          ))
        ) : (
          <p className="small">This task has no separate subtasks.</p>
        )}
        <div className="field-grid">
          <label>
            Reported status
            <select
              value={status}
              onChange={(e) => {
                const next = e.target.value as Progress["status"];
                setStatus(next);
                if (next === "done") setPercent(100);
                else if (percent === 100) setPercent(0);
              }}
            >
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="partial">Partially complete</option>
              <option value="blocked">Blocked</option>
              <option value="done">Done, checks confirmed</option>
            </select>
          </label>
          <label>
            Reported completion %
            <input
              type="number"
              min="0"
              max={status === "done" ? 100 : 99}
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
            />
          </label>
          <label>
            Minutes worked so far
            <input
              type="number"
              min="0"
              max="21600"
              placeholder="Not recorded"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
        </div>
        <label>
          Progress note or blocker
          <textarea
            rows={3}
            maxLength={3000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="step-actions">
          <Button type="button" secondary onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            busy={busy}
            disabled={
              status === "done" &&
              (!dod || subs.length !== t.subtasks.length || percent !== 100)
            }
          >
            Save reported progress
          </Button>
        </div>
      </form>
      <details className="task-reschedule">
        <summary>Propose a different date</summary>
        <label>
          New date
          <input
            type="date"
            min={s.startDate}
            max={
              s.goals.find((g) => g.id === t.story.goalId)?.deadline ??
              s.endDate
            }
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <Button
          secondary
          disabled={
            busy || date === t.allocation.date || progress?.status === "done"
          }
          onClick={async () => {
            await onMove(date);
            onClose();
          }}
        >
          Review date change
        </Button>
        <p className="small">
          This creates a separate schedule proposal for your approval.
        </p>
      </details>
    </dialog>
  );
}
