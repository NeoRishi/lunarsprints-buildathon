"use client";
import { useState } from "react";
import type { Allocation, Sprint } from "../contracts";
import { addDays, capacity, displayDate, validateSchedule } from "../domain";
import { Button, NextButton, Notice, SectionTitle } from "./shared";
import type { Send } from "./workspace";
export function CapacitySummary({
  sprint: s,
  allocations,
}: {
  sprint: Sprint;
  allocations?: Allocation[];
}) {
  const c = capacity(s, allocations);
  return (
    <div className="capacity-summary">
      <div>
        <span>Planned effort</span>
        <strong>{(c.planned / 60).toFixed(1)}h</strong>
      </div>
      <div>
        <span>Your budget</span>
        <strong>
          {s.capacityMinutes === null
            ? "Unknown"
            : `${(s.capacityMinutes / 60).toFixed(1)}h`}
        </strong>
      </div>
      <div>
        <span>Protected buffer</span>
        <strong>
          {(c.buffer / 60).toFixed(1)}h <small>({s.bufferPercent}%)</small>
        </strong>
      </div>
      <div>
        <span>Capacity check</span>
        <strong
          className={
            c.unknown ||
            c.overbooked ||
            c.dailyOverload ||
            c.dailyBufferOverload
              ? "warning-text"
              : "success-text"
          }
        >
          {c.unknown
            ? "Not verified"
            : c.overbooked || c.dailyOverload || c.dailyBufferOverload
              ? "Review needed"
              : "Within budget"}
        </strong>
      </div>
    </div>
  );
}
export function ScheduleEditor({
  sprint: s,
  busy,
  send,
}: {
  sprint: Sprint;
  busy: boolean;
  send: Send;
}) {
  const [allocations, setAllocations] = useState(
    structuredClone(s.allocations),
  );
  const [hours, setHours] = useState(
    s.capacityMinutes === null ? "" : String(s.capacityMinutes / 60),
  );
  const [daily, setDaily] = useState([...s.dailyMinutes]);
  const [buffer, setBuffer] = useState(s.bufferPercent);
  const [risk, setRisk] = useState(false);
  const prospective = {
    ...s,
    capacityMinutes: hours === "" ? null : Math.round(Number(hours) * 60),
    dailyMinutes: daily,
    bufferPercent: buffer,
    allocations,
  };
  const c = capacity(prospective);
  const risky = Boolean(
    c.unknown || c.overbooked || c.dailyOverload || c.dailyBufferOverload,
  );
  const dirty =
    JSON.stringify(allocations) !== JSON.stringify(s.allocations) ||
    prospective.capacityMinutes !== s.capacityMinutes ||
    buffer !== s.bufferPercent ||
    JSON.stringify(daily) !== JSON.stringify(s.dailyMinutes);
  let invalid = "";
  try {
    if (allocations.length) validateSchedule(prospective, allocations);
  } catch (error) {
    invalid =
      error instanceof Error ? error.message : "Review schedule conflicts.";
  }
  const budgetFields = (
    <>
      <div className="field-grid schedule-budget">
        <label>
          Available hours for the sprint
          <input
            type="number"
            min=".5"
            max="360"
            step=".5"
            value={hours}
            placeholder="Unknown"
            onChange={(e) => setHours(e.target.value)}
          />
        </label>
        <label>
          Buffer %
          <input
            type="number"
            min="0"
            max="50"
            value={buffer}
            onChange={(e) => setBuffer(Number(e.target.value))}
          />
        </label>
      </div>
      <details>
        <summary>Adjust daily effort budgets</summary>
        <div className="availability-grid">
          {daily.map((n, i) => (
            <label key={i}>
              {displayDate(addDays(s.startDate, i))}
              <input
                type="number"
                min="0"
                max="960"
                value={n}
                onChange={(e) =>
                  setDaily(
                    daily.map((v, j) => (i === j ? Number(e.target.value) : v)),
                  )
                }
              />
            </label>
          ))}
        </div>
      </details>
    </>
  );
  return (
    <>
      <SectionTitle
        title="Give your plan some breathing room."
        description="Set dates and effort, protect rest days, and check the combined load. These are plans, not calendar bookings."
      />
      {s.scheduleConflict && (
        <Notice warning>
          <div role="status">
            <strong>This work needs a scheduling adjustment.</strong>
            <p>{s.scheduleConflict.message}</p>
            <ul>
              {s.scheduleConflict.actions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <p>
              Reviewed work:{" "}
              {s.stories
                .flatMap((st) => st.tasks)
                .reduce((n, t) => n + t.minutes, 0)}{" "}
              minutes. Your approved goal and work breakdown are preserved.
            </p>
          </div>
        </Notice>
      )}
      {!allocations.length ? (
        <>
          {budgetFields}
          <div className="step-actions">
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void send("edit_stories", {
                  stories: s.stories,
                  uncoveredCriteria: [],
                  warnings: s.notes,
                })
              }
            >
              Back to steps
            </button>
            <NextButton
              busy={busy}
              onClick={async () => {
                if (dirty) {
                  const saved = await send("confirm_availability", {
                    capacityMinutes: prospective.capacityMinutes,
                    dailyMinutes: daily,
                    bufferPercent: buffer,
                  });
                  if (!saved) return;
                }
                await send("schedule");
              }}
            >
              {dirty ? "Save availability & retry" : "Suggest a schedule"}
            </NextButton>
          </div>
        </>
      ) : (
        <>
          <CapacitySummary sprint={prospective} />
          {!dirty && (
            <section
              className="schedule-advice"
              aria-label="Optional schedule explanation"
            >
              <Button
                secondary
                busy={busy}
                disabled={
                  Boolean(invalid) || s.scheduleAdvice?.status === "ready"
                }
                onClick={() => void send("request_schedule_advice")}
              >
                Explain this schedule (optional)
              </Button>
              {s.scheduleAdvice && (
                <Notice warning={s.scheduleAdvice.status === "unavailable"}>
                  <ul>
                    {s.scheduleAdvice.notes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </Notice>
              )}
            </section>
          )}
          {budgetFields}
          {(risky || invalid) && (
            <Notice warning>
              {invalid && <p>{invalid}</p>}
              {c.dailyBufferOverload && !c.dailyOverload && (
                <p>
                  Some days use your protected buffer. Move work, revise
                  availability, or explicitly acknowledge this risk.
                </p>
              )}
              {c.unknown && (
                <p>
                  Capacity is unknown. This plan’s feasibility has not been
                  verified.
                </p>
              )}
              {c.overbooked > 0 && (
                <p>
                  The plan exceeds your available time after buffer by{" "}
                  {(c.overbooked / 60).toFixed(1)} hours. Reduce scope, add time
                  you can truly protect, or explicitly accept the risk.
                </p>
              )}
              {c.dailyOverload && (
                <p>
                  Some days exceed your entered availability. Move work or
                  revise your daily budgets.
                </p>
              )}
            </Notice>
          )}
          <div
            className="calendar-strip"
            aria-label={`${c.dayLoads.length}-day timeline`}
            style={
              {
                "--cols": Math.min(c.dayLoads.length, 15),
              } as React.CSSProperties
            }
          >
            {c.dayLoads.map((minutes, i) => {
              const date = addDays(s.startDate, i);
              return (
                <div
                  key={date}
                  className={`day-cell ${minutes > daily[i] ? "overloaded" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/task-id");
                    setAllocations(
                      allocations.map((a) =>
                        a.taskId === id ? { ...a, date } : a,
                      ),
                    );
                  }}
                >
                  <span>D{i + 1}</span>
                  <strong>{displayDate(date)}</strong>
                  <div className="day-bar">
                    <span
                      style={{
                        height: `${Math.min(100, (minutes / Math.max(1, daily[i])) * 100)}%`,
                      }}
                    />
                  </div>
                  <small>
                    {minutes}/{daily[i]}m
                  </small>
                </div>
              );
            })}
          </div>
          <div className="schedule-list">
            {s.stories.map((st, i) => (
              <section key={st.id}>
                <div className="row between">
                  <h3>
                    <span className="mono">S{i + 1}</span> {st.title}
                  </h3>
                  <span className="small">
                    {s.goals.find((g) => g.id === st.goalId)?.title}
                  </span>
                </div>
                {st.tasks.map((t) => {
                  const a = allocations.find((a) => a.taskId === t.id)!;
                  return (
                    <div
                      key={t.id}
                      className="allocation-row"
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/task-id", t.id)
                      }
                    >
                      <span className="drag-handle" aria-hidden="true">
                        ⠿
                      </span>
                      <div>
                        <strong>{t.title}</strong>
                        <span>
                          {t.minutes}m estimated. Drag to a day or edit below.
                        </span>
                      </div>
                      <label>
                        <span className="sr-only">Date for {t.title}</span>
                        <input
                          type="date"
                          min={s.startDate}
                          max={
                            s.goals.find((g) => g.id === st.goalId)?.deadline ??
                            s.endDate
                          }
                          value={a.date}
                          onChange={(e) =>
                            setAllocations(
                              allocations.map((v) =>
                                v.taskId === t.id
                                  ? { ...v, date: e.target.value }
                                  : v,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        <span className="sr-only">
                          Allocated minutes for {t.title}
                        </span>
                        <input
                          type="number"
                          min={t.minutes}
                          max={60}
                          value={a.minutes}
                          onChange={(e) =>
                            setAllocations(
                              allocations.map((v) =>
                                v.taskId === t.id
                                  ? { ...v, minutes: Number(e.target.value) }
                                  : v,
                              ),
                            )
                          }
                        />
                        <span className="small">minutes</span>
                      </label>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
          <div className="goal-loads">
            {c.byGoal.map((g) => (
              <div key={g.id}>
                <span>{g.title}</span>
                <strong>{(g.minutes / 60).toFixed(1)}h</strong>
              </div>
            ))}
          </div>
          {!dirty && risky && (
            <label className="checkbox-label risk-ack">
              <input
                type="checkbox"
                checked={risk}
                onChange={(e) => setRisk(e.target.checked)}
              />{" "}
              I’ve reviewed these capacity risks and choose to keep this plan.
            </label>
          )}
          <div className="step-actions">
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void send("edit_stories", {
                  stories: s.stories,
                  uncoveredCriteria: [],
                  warnings: s.notes,
                })
              }
            >
              Back to steps
            </button>
            {dirty ? (
              <Button
                busy={busy}
                disabled={Boolean(invalid)}
                onClick={() =>
                  void send("edit_schedule", {
                    allocations,
                    capacityMinutes: prospective.capacityMinutes,
                    dailyMinutes: daily,
                    bufferPercent: buffer,
                  })
                }
              >
                Save my changes
              </Button>
            ) : (
              <NextButton
                busy={busy}
                disabled={Boolean(invalid) || (risky && !risk)}
                onClick={() =>
                  void send(
                    "approve_schedule",
                    { acknowledgeRisk: risk },
                    "schedule",
                  )
                }
              >
                Approve schedule & review
              </NextButton>
            )}
          </div>
        </>
      )}
    </>
  );
}
