"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import type { Sprint, Story } from "../contracts";
import { estimatedMinutes } from "../domain";
import { Button, CheckList, NextButton, Notice, SectionTitle } from "./shared";
import type { Send } from "./workspace";
export function StoryEditor({
  sprint: s,
  busy,
  send,
}: {
  sprint: Sprint;
  busy: boolean;
  send: Send;
}) {
  const [stories, setStories] = useState<Story[]>(structuredClone(s.stories));
  const [edit, setEdit] = useState(false);
  const dirty = JSON.stringify(stories) !== JSON.stringify(s.stories);
  function patch(id: string, fn: (s: Story) => Story) {
    setStories(stories.map((st) => (st.id === id ? fn(st) : st)));
  }
  function move(index: number, delta: number) {
    const next = [...stories];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setStories(next);
  }
  const total = stories.reduce((n, st) => n + estimatedMinutes(st), 0);
  return (
    <>
      <SectionTitle
        title="Meaningful outcomes. Manageable steps."
        description={s.assistantMessage}
      />
      {!stories.length ? (
        <>
          <Notice>
            Your goal{s.goals.length > 1 ? "s are" : " is"} approved. Next,
            we’ll draft the steps to get there.
          </Notice>
          <NextButton busy={busy} onClick={() => void send("generate_stories")}>
            Draft the steps
          </NextButton>
        </>
      ) : (
        <>
          <div className="breakdown-summary">
            <div>
              <strong>{stories.length}</strong>
              <span>milestones</span>
            </div>
            <div>
              <strong>{stories.flatMap((st) => st.tasks).length}</strong>
              <span>steps, up to 60m each</span>
            </div>
            <div>
              <strong>{(total / 60).toFixed(1)}h</strong>
              <span>estimated effort</span>
            </div>
            <button className="text-button" onClick={() => setEdit(!edit)}>
              {edit ? "Preview" : "Customize breakdown"}
            </button>
          </div>
          {s.capacityMinutes !== null &&
            total > s.capacityMinutes * (1 - s.bufferPercent / 100) && (
              <Notice warning>
                The combined work estimate exceeds your budget after buffer.
                Reduce scope or adjust availability before you commit to the
                schedule.
              </Notice>
            )}
          <div className="stories">
            {stories.map((st, index) => (
              <details key={st.id} open={edit || undefined} className="story">
                <summary>
                  <span className="story-number">S{index + 1}</span>
                  <div>
                    <strong>{st.title}</strong>
                    <span>
                      {s.goals.find((g) => g.id === st.goalId)?.title}
                    </span>
                  </div>
                  <span className="badge">P{st.priority}</span>
                  <span className="mono">{estimatedMinutes(st)}m</span>
                </summary>
                <div className="story-body">
                  {edit ? (
                    <>
                      <div className="row between">
                        <div className="actions">
                          <button
                            aria-label={`Move ${st.title} up`}
                            className="icon-button"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            aria-label={`Move ${st.title} down`}
                            className="icon-button"
                            disabled={index === stories.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown size={16} />
                          </button>
                        </div>
                        <button
                          className="text-button danger"
                          onClick={() =>
                            setStories(stories.filter((x) => x.id !== st.id))
                          }
                        >
                          <Trash2 size={14} /> Remove milestone
                        </button>
                      </div>
                      <label>
                        Milestone title
                        <input
                          value={st.title}
                          onChange={(e) =>
                            patch(st.id, (x) => ({
                              ...x,
                              title: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Description
                        <textarea
                          value={st.description}
                          onChange={(e) =>
                            patch(st.id, (x) => ({
                              ...x,
                              description: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Goal
                        <select
                          value={st.goalId}
                          onChange={(e) =>
                            patch(st.id, (x) => ({
                              ...x,
                              goalId: e.target.value,
                              coveredCriteria: [],
                            }))
                          }
                        >
                          {s.goals.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Done means (one check per line)
                        <textarea
                          value={st.definitionOfDone.join("\n")}
                          onChange={(e) =>
                            patch(st.id, (x) => ({
                              ...x,
                              definitionOfDone: e.target.value.split("\n"),
                            }))
                          }
                        />
                      </label>
                      <label>
                        Priority
                        <select
                          value={st.priority}
                          onChange={(e) =>
                            patch(st.id, (x) => ({
                              ...x,
                              priority: Number(e.target.value),
                            }))
                          }
                        >
                          <option value={1}>Essential</option>
                          <option value={2}>Core</option>
                          <option value={3}>Nice to have</option>
                        </select>
                      </label>
                      <fieldset>
                        <legend>Success criteria covered</legend>
                        {s.goals
                          .find((g) => g.id === st.goalId)
                          ?.completionCriteria.map((c, i) => (
                            <label key={i} className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={st.coveredCriteria.includes(i)}
                                onChange={() =>
                                  patch(st.id, (x) => ({
                                    ...x,
                                    coveredCriteria: x.coveredCriteria.includes(
                                      i,
                                    )
                                      ? x.coveredCriteria.filter((n) => n !== i)
                                      : [...x.coveredCriteria, i],
                                  }))
                                }
                              />
                              {c}
                            </label>
                          ))}
                      </fieldset>
                      <fieldset>
                        <legend>Must finish first, on an earlier day</legend>
                        {stories
                          .filter((x) => x.id !== st.id)
                          .map((other) => (
                            <label key={other.id} className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={st.dependencyIds.includes(other.id)}
                                onChange={() =>
                                  patch(st.id, (x) => ({
                                    ...x,
                                    dependencyIds: x.dependencyIds.includes(
                                      other.id,
                                    )
                                      ? x.dependencyIds.filter(
                                          (id) => id !== other.id,
                                        )
                                      : [...x.dependencyIds, other.id],
                                  }))
                                }
                              />
                              {other.title}
                            </label>
                          ))}
                      </fieldset>
                    </>
                  ) : (
                    <>
                      <p>{st.description}</p>
                      <strong className="small">Done means</strong>
                      <CheckList items={st.definitionOfDone} />
                    </>
                  )}
                  {st.tasks.map((t, ti) => (
                    <div className="task-review" key={t.id}>
                      <div className="row between">
                        <span className="mono">
                          T{index + 1}.{ti + 1}
                        </span>
                        <span className="badge">{t.minutes}m estimate</span>
                      </div>
                      {edit ? (
                        <>
                          <label>
                            Step title
                            <input
                              value={t.title}
                              onChange={(e) =>
                                patch(st.id, (x) => ({
                                  ...x,
                                  tasks: x.tasks.map((a) =>
                                    a.id === t.id
                                      ? { ...a, title: e.target.value }
                                      : a,
                                  ),
                                }))
                              }
                            />
                          </label>
                          <label>
                            Minutes (1 to 60)
                            <input
                              type="number"
                              min={1}
                              max={60}
                              value={t.minutes}
                              onChange={(e) =>
                                patch(st.id, (x) => ({
                                  ...x,
                                  tasks: x.tasks.map((a) =>
                                    a.id === t.id
                                      ? {
                                          ...a,
                                          minutes: Number(e.target.value),
                                        }
                                      : a,
                                  ),
                                }))
                              }
                            />
                          </label>
                          <label>
                            Why this matters
                            <input
                              value={t.motivation}
                              onChange={(e) =>
                                patch(st.id, (x) => ({
                                  ...x,
                                  tasks: x.tasks.map((a) =>
                                    a.id === t.id
                                      ? { ...a, motivation: e.target.value }
                                      : a,
                                  ),
                                }))
                              }
                            />
                          </label>
                          <label>
                            Done means
                            <textarea
                              value={t.definitionOfDone}
                              onChange={(e) =>
                                patch(st.id, (x) => ({
                                  ...x,
                                  tasks: x.tasks.map((a) =>
                                    a.id === t.id
                                      ? {
                                          ...a,
                                          definitionOfDone: e.target.value,
                                        }
                                      : a,
                                  ),
                                }))
                              }
                            />
                          </label>
                          {t.subtasks.map((sub) => (
                            <div className="subtask-edit" key={sub.id}>
                              <label>
                                Subtask
                                <input
                                  value={sub.title}
                                  onChange={(e) =>
                                    patch(st.id, (x) => ({
                                      ...x,
                                      tasks: x.tasks.map((a) =>
                                        a.id === t.id
                                          ? {
                                              ...a,
                                              subtasks: a.subtasks.map((b) =>
                                                b.id === sub.id
                                                  ? {
                                                      ...b,
                                                      title: e.target.value,
                                                    }
                                                  : b,
                                              ),
                                            }
                                          : a,
                                      ),
                                    }))
                                  }
                                />
                              </label>
                              <label>
                                Minutes (1 to 25)
                                <input
                                  type="number"
                                  min={1}
                                  max={25}
                                  value={sub.minutes}
                                  onChange={(e) =>
                                    patch(st.id, (x) => ({
                                      ...x,
                                      tasks: x.tasks.map((a) =>
                                        a.id === t.id
                                          ? {
                                              ...a,
                                              subtasks: a.subtasks.map((b) =>
                                                b.id === sub.id
                                                  ? {
                                                      ...b,
                                                      minutes: Number(
                                                        e.target.value,
                                                      ),
                                                    }
                                                  : b,
                                              ),
                                            }
                                          : a,
                                      ),
                                    }))
                                  }
                                />
                              </label>
                              <label>
                                Completion check
                                <input
                                  value={sub.definitionOfDone}
                                  onChange={(e) =>
                                    patch(st.id, (x) => ({
                                      ...x,
                                      tasks: x.tasks.map((a) =>
                                        a.id === t.id
                                          ? {
                                              ...a,
                                              subtasks: a.subtasks.map((b) =>
                                                b.id === sub.id
                                                  ? {
                                                      ...b,
                                                      definitionOfDone:
                                                        e.target.value,
                                                    }
                                                  : b,
                                              ),
                                            }
                                          : a,
                                      ),
                                    }))
                                  }
                                />
                              </label>
                              <button
                                className="text-button danger"
                                onClick={() =>
                                  patch(st.id, (x) => ({
                                    ...x,
                                    tasks: x.tasks.map((a) =>
                                      a.id === t.id
                                        ? {
                                            ...a,
                                            subtasks: a.subtasks.filter(
                                              (b) => b.id !== sub.id,
                                            ),
                                          }
                                        : a,
                                    ),
                                  }))
                                }
                              >
                                Remove sub-step
                              </button>
                            </div>
                          ))}
                          <div className="row between">
                            <button
                              className="text-button"
                              onClick={() =>
                                patch(st.id, (x) => ({
                                  ...x,
                                  tasks: x.tasks.map((a) =>
                                    a.id === t.id
                                      ? {
                                          ...a,
                                          subtasks: [
                                            ...a.subtasks,
                                            {
                                              id: crypto.randomUUID(),
                                              title: "",
                                              minutes: 15,
                                              definitionOfDone: "",
                                            },
                                          ],
                                        }
                                      : a,
                                  ),
                                }))
                              }
                            >
                              + Subtask
                            </button>
                            <button
                              className="text-button danger"
                              onClick={() =>
                                patch(st.id, (x) => ({
                                  ...x,
                                  tasks: x.tasks.filter((a) => a.id !== t.id),
                                }))
                              }
                            >
                              Remove step
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <h3>{t.title}</h3>
                          <p>{t.motivation}</p>
                          <p className="task-dod">
                            <Check size={14} />
                            {t.definitionOfDone}
                          </p>
                          {t.subtasks.map((sub) => (
                            <div className="subtask-preview" key={sub.id}>
                              <span>
                                {sub.title}
                                <small>{sub.definitionOfDone}</small>
                              </span>
                              <span>{sub.minutes}m</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  ))}
                  {edit && (
                    <button
                      className="text-button"
                      onClick={() =>
                        patch(st.id, (x) => ({
                          ...x,
                          tasks: [
                            ...x.tasks,
                            {
                              id: crypto.randomUUID(),
                              title: "",
                              minutes: 30,
                              motivation: "",
                              definitionOfDone: "",
                              subtasks: [],
                            },
                          ],
                        }))
                      }
                    >
                      <Plus size={14} /> Add step
                    </button>
                  )}
                </div>
              </details>
            ))}
          </div>
          {edit && (
            <>
              <p className="small">
                If a step has sub-steps, their minutes must add up to the step’s
                estimate. Editing scope requires a fresh review.
              </p>
              <Button
                secondary
                onClick={() =>
                  setStories([
                    ...stories,
                    {
                      id: crypto.randomUUID(),
                      goalId: s.goals[0].id,
                      title: "",
                      description: "",
                      definitionOfDone: [""],
                      priority: 2,
                      dependencyIds: [],
                      coveredCriteria: [],
                      tasks: [
                        {
                          id: crypto.randomUUID(),
                          title: "",
                          minutes: 30,
                          motivation: "",
                          definitionOfDone: "",
                          subtasks: [],
                        },
                      ],
                    },
                  ])
                }
              >
                <Plus size={14} /> Add milestone
              </Button>
            </>
          )}
          <div className="step-actions">
            {dirty ? (
              <>
                <Button
                  secondary
                  onClick={() => {
                    setStories(structuredClone(s.stories));
                    setEdit(false);
                  }}
                >
                  Discard unsaved edits
                </Button>
                <Button
                  busy={busy}
                  onClick={() =>
                    void send("edit_stories", {
                      stories,
                      uncoveredCriteria: [],
                      warnings: s.notes,
                    })
                  }
                >
                  Save my changes
                </Button>
              </>
            ) : (
              <>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void send("generate_stories")}
                >
                  Regenerate breakdown
                </button>
                <NextButton
                  busy={busy}
                  onClick={() => void send("approve_stories", {}, "stories")}
                >
                  Approve these steps
                </NextButton>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
