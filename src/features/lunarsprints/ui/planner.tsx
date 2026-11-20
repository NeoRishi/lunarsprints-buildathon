"use client";
import { useState } from "react";
import { ArrowLeft, Check, CircleHelp, Pencil } from "lucide-react";
import type { Answer, Goal, Question, Sprint } from "../contracts";
import { displayDate } from "../domain";
import { Button, CheckList, NextButton, Notice, SectionTitle } from "./shared";
import { VoiceInput } from "./voice";
import { StoryEditor } from "./story-editor";
import { ScheduleEditor, CapacitySummary } from "./schedule-editor";
import type { Send } from "./workspace";
/** Plain-language names for the SMART fields, which stay internal. */
const smartLabels: Record<string, string> = {
  specific: "What you’ll finish",
  measurable: "How you’ll know it’s done",
  achievable: "Does it fit your time",
  relevant: "Why it matters to you",
  timeBound: "By when",
};
type Props = {
  sprint: Sprint;
  hashes: Record<string, string>;
  busy: boolean;
  send: Send;
};
export function Planner({ sprint: s, busy, send }: Props) {
  const [editingIntention, setEditingIntention] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, Answer>>({});
  const editIntention = () => setEditingIntention(true);
  if (s.stage === "intention" || editingIntention)
    return (
      <IntentionStep
        key={s.intention}
        sprint={s}
        busy={busy}
        onSubmit={async (intention) => {
          const saved = await send("capture", { intention });
          if (saved) {
            setEditingIntention(false);
            setQuestionIndex(0);
            setDraftAnswers({});
            await send("assess");
          }
        }}
        onCancel={
          editingIntention ? () => setEditingIntention(false) : undefined
        }
        onAssess={() => void send("assess")}
      />
    );
  if (s.stage === "select")
    return (
      <IntentSelection
        sprint={s}
        busy={busy}
        send={send}
        onBack={editIntention}
      />
    );
  if (s.stage === "clarify") {
    const questions = s.clarification?.questions ?? [];
    const index = Math.min(questionIndex, Math.max(0, questions.length - 1));
    const question = questions[index];
    async function saveCurrentDraft() {
      const draft = question && draftAnswers[question.id];
      if (
        !draft ||
        JSON.stringify(draft) ===
          JSON.stringify(s.answers.find((a) => a.questionId === question.id))
      )
        return true;
      return Boolean(await send("answer", draft));
    }
    return (
      <>
        <SectionTitle
          title="A little clarity goes a long way."
          description={s.assistantMessage}
        />
        {question ? (
          <QuestionCard
            key={question.id}
            question={question}
            answer={
              draftAnswers[question.id] ??
              s.answers.find((a) => a.questionId === question.id)
            }
            index={index}
            total={questions.length}
            busy={busy}
            onSave={(answer) => {
              setDraftAnswers((previous) => ({
                ...previous,
                [question.id]: answer,
              }));
              return send("answer", answer);
            }}
            onDraft={(answer) =>
              setDraftAnswers((previous) => ({
                ...previous,
                [question.id]: answer,
              }))
            }
            onMove={setQuestionIndex}
            onFinish={() => void send("synthesize", {})}
          />
        ) : (
          <NextButton busy={busy} onClick={() => void send("synthesize", {})}>
            Draft my goal
          </NextButton>
        )}
        <div className="question-summary" aria-label="Clarification answers">
          {questions.map((q, i) => {
            const a = s.answers.find((a) => a.questionId === q.id);
            return (
              <button
                key={q.id}
                disabled={busy}
                onClick={async () => {
                  if (await saveCurrentDraft()) setQuestionIndex(i);
                }}
                className={i === index ? "summary-chip active" : "summary-chip"}
              >
                Q{i + 1}:{" "}
                {a?.status === "confirmed"
                  ? a.customText ||
                    q.options.find((o) => o.id === a.optionId)?.text
                  : a?.status === "skipped"
                    ? "Skipped"
                    : "Unanswered"}
              </button>
            );
          })}
        </div>
        <div className="row between bottom-links">
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              if (await saveCurrentDraft()) editIntention();
            }}
          >
            <ArrowLeft size={14} /> Edit intention
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              if (await saveCurrentDraft())
                await send("synthesize", { skip: true });
            }}
          >
            Skip optional clarification
          </button>
        </div>
      </>
    );
  }
  if (s.stage === "goals")
    return (
      <GoalsStep sprint={s} busy={busy} send={send} onBack={editIntention} />
    );
  if (s.stage === "stories")
    return (
      <StoryEditor
        key={`${s.id}-${s.revision}`}
        sprint={s}
        busy={busy}
        send={send}
      />
    );
  if (s.stage === "schedule")
    return (
      <ScheduleEditor
        key={`${s.id}-${s.revision}`}
        sprint={s}
        busy={busy}
        send={send}
      />
    );
  if (s.stage === "review")
    return (
      <>
        <SectionTitle
          title="A plan you can stand behind."
          description="Look over your goal, steps and dates one last time. Starting the sprint locks in this exact version."
        />
        <div className="review-goals">
          {s.goals.map((g) => (
            <section key={g.id}>
              <span className="badge success">
                <Check size={12} /> Approved goal
              </span>
              <h2>{g.title}</h2>
              <p>{g.statement}</p>
              <CheckList items={g.completionCriteria} />
            </section>
          ))}
        </div>
        <CapacitySummary sprint={s} />
        <div className="review-stories">
          {s.stories.map((st, i) => (
            <details key={st.id}>
              <summary>
                <span className="mono">S{i + 1}</span> {st.title}
                <span className="small">{st.tasks.length} tasks</span>
              </summary>
              <p className="small">
                Goal: {s.goals.find((g) => g.id === st.goalId)?.title}
              </p>
              <CheckList items={st.definitionOfDone} />
              {st.tasks.map((t) => {
                const a = s.allocations.find((a) => a.taskId === t.id)!;
                return (
                  <div className="review-task" key={t.id}>
                    <div>
                      <strong>{t.title}</strong>
                      <p>{t.definitionOfDone}</p>
                    </div>
                    <span>
                      {displayDate(a.date)}, {a.minutes}m
                    </span>
                  </div>
                );
              })}
            </details>
          ))}
        </div>
        {s.notes.length > 0 && (
          <Notice>
            <CheckList items={s.notes} />
          </Notice>
        )}
        <div className="step-actions">
          <Button
            secondary
            busy={busy}
            onClick={() =>
              void send("edit_schedule", {
                allocations: s.allocations,
                capacityMinutes: s.capacityMinutes,
                dailyMinutes: s.dailyMinutes,
                bufferPercent: s.bufferPercent,
              })
            }
          >
            Back to schedule
          </Button>
          <NextButton
            busy={busy}
            onClick={() => void send("activate", {}, "activation")}
          >
            Confirm & activate sprint
          </NextButton>
        </div>
      </>
    );
  return null;
}
function IntentionStep({
  sprint: s,
  busy,
  onSubmit,
  onCancel,
  onAssess,
}: {
  sprint: Sprint;
  busy: boolean;
  onSubmit: (t: string) => Promise<void>;
  onCancel?: () => void;
  onAssess: () => void;
}) {
  const [value, setValue] = useState(s.intention);
  return (
    <>
      <SectionTitle
        title="What’s on your mind?"
        description="Start with your own words. Share what you want, what’s already done, and any constraints you know."
      />
      <VoiceInput disabled={busy} onTranscript={setValue} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(value);
        }}
      >
        <label className="intention-label" htmlFor="intention">
          Your intention <span>Speak or type, then edit</span>
        </label>
        <textarea
          id="intention"
          name="intention"
          rows={7}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          maxLength={10000}
          placeholder="I’ve been meaning to…"
        />
        <p className="small">
          Your original words stay preserved. Nothing is approved at this step.
        </p>
        {s.goals.length > 0 && (
          <Notice warning>
            Changing your intention will replace the current questionnaire and
            reopen goal, steps and schedule approval. Previous versions remain
            in your history.
          </Notice>
        )}
        <div className="step-actions">
          {onCancel ? (
            <Button type="button" secondary onClick={onCancel}>
              Cancel edit
            </Button>
          ) : (
            <span />
          )}
          <NextButton type="submit" busy={busy} disabled={!value.trim()}>
            Use this intention
          </NextButton>
        </div>
      </form>
      {s.intention && s.stage === "intention" && (
        <button className="text-button" disabled={busy} onClick={onAssess}>
          Try again with my saved intention
        </button>
      )}
    </>
  );
}
function IntentSelection({
  sprint: s,
  busy,
  send,
  onBack,
}: {
  sprint: Sprint;
  busy: boolean;
  send: Send;
  onBack: () => void;
}) {
  const [ids, setIds] = useState<string[]>(s.selectedIntentIds);
  return (
    <>
      <SectionTitle
        title="What belongs in this sprint?"
        description="One primary focus is a good starting point. Add other goals if they can share your available time."
      />
      {s.assessment?.intents.map((i) => (
        <label
          key={i.id}
          className={`option ${ids.includes(i.id) ? "chosen" : ""}`}
        >
          <input
            type="checkbox"
            checked={ids.includes(i.id)}
            onChange={() =>
              setIds(
                ids.includes(i.id)
                  ? ids.filter((id) => id !== i.id)
                  : [...ids, i.id],
              )
            }
          />
          <span>
            <strong>{i.outcome}</strong>
            {i.why && <span>{i.why}</span>}
            {i.conflicts.map((c) => (
              <small key={c}>{c}</small>
            ))}
          </span>
        </label>
      ))}
      <Notice>
        Unselected intentions stay in your saved original text. They won’t
        quietly become commitments.
      </Notice>
      <div className="step-actions">
        <Button secondary onClick={onBack}>
          Edit intention
        </Button>
        <NextButton
          disabled={!ids.length}
          busy={busy}
          onClick={() => void send("select_intents", ids)}
        >
          Include {ids.length || "selected"} goal{ids.length === 1 ? "" : "s"}
        </NextButton>
      </div>
    </>
  );
}
function QuestionCard({
  question: q,
  answer,
  index,
  total,
  busy,
  onSave,
  onDraft,
  onMove,
  onFinish,
}: {
  question: Question;
  answer: Answer | undefined;
  index: number;
  total: number;
  busy: boolean;
  onSave: (a: Answer) => Promise<Sprint | null>;
  onDraft: (a: Answer) => void;
  onMove: (i: number) => void;
  onFinish: () => void;
}) {
  const [option, setOption] = useState(answer?.optionId ?? "");
  const [custom, setCustom] = useState(answer?.customText ?? "");
  const hasAnswer = Boolean(custom.trim() || option);
  function value(
    skip = false,
    nextOption = option,
    nextCustom = custom,
  ): Answer {
    const answered = Boolean(nextCustom.trim() || nextOption);
    return {
      questionId: q.id,
      optionId: skip || nextCustom.trim() ? null : nextOption || null,
      customText: skip ? null : nextCustom.trim() || null,
      status: skip ? "skipped" : answered ? "confirmed" : "unanswered",
      source:
        skip || !answered
          ? "not_answered"
          : nextCustom.trim()
            ? "user_custom"
            : "user_selected",
    };
  }
  async function move(to: number, skip = false) {
    const saved = await onSave(value(skip));
    if (!saved) return;
    if (to >= total) onFinish();
    else onMove(to);
  }
  return (
    <div className="question-card">
      <div className="question-number">
        Question {index + 1} of {total} {q.required && <span>Required</span>}
      </div>
      <h2 id="question-title">{q.question}</h2>
      <p className="question-rationale">{q.rationale}</p>
      <div
        role="radiogroup"
        aria-labelledby="question-title"
        className="options"
      >
        {q.options.map((o) => (
          <label
            key={o.id}
            className={`option ${!custom && option === o.id ? "chosen" : ""}`}
          >
            <input
              type="radio"
              name={q.id}
              value={o.id}
              checked={!custom && option === o.id}
              onChange={() => {
                setOption(o.id);
                setCustom("");
                onDraft(value(false, o.id, ""));
              }}
            />
            <span>
              <strong>
                {o.text}{" "}
                {o.recommended && (
                  <span className="badge">
                    {o.recommendationBasis === "user_fact"
                      ? "Recommended from your words"
                      : "A suggestion"}
                  </span>
                )}
              </strong>
              {o.recommended && o.recommendationReason && (
                <small>{o.recommendationReason}</small>
              )}
            </span>
          </label>
        ))}
        <div className={`option custom-option ${custom ? "chosen" : ""}`}>
          <CircleHelp size={18} />
          <div>
            <label htmlFor={`custom-${q.id}`}>
              {q.options.length ? "Other: write my own answer" : "Your answer"}
            </label>
            <input
              id={`custom-${q.id}`}
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setOption("");
                onDraft(value(false, "", e.target.value));
              }}
              maxLength={2000}
              placeholder="Type your answer here…"
            />
          </div>
        </div>
      </div>
      <div className="question-footer">
        <Button
          secondary
          disabled={index === 0 || busy}
          onClick={() => void move(index - 1)}
        >
          Back
        </Button>
        <div className="dots" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={i === index ? "active" : ""} />
          ))}
        </div>
        <div className="actions">
          {!q.required && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void move(index + 1, true)}
            >
              Skip question
            </button>
          )}
          <NextButton
            busy={busy}
            disabled={!hasAnswer}
            onClick={() => void move(index + 1)}
          >
            {index === total - 1 ? "Draft my goal" : "Continue"}
          </NextButton>
        </div>
      </div>
    </div>
  );
}
function GoalsStep({
  sprint: s,
  busy,
  send,
  onBack,
}: {
  sprint: Sprint;
  busy: boolean;
  send: Send;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [goals, setGoals] = useState<Goal[]>(structuredClone(s.goals));
  const [feedback, setFeedback] = useState("");
  function patch(i: number, part: Partial<Goal>) {
    setGoals(goals.map((g, j) => (i === j ? { ...g, ...part } : g)));
  }
  if (!s.goals.length)
    return (
      <>
        <SectionTitle
          title="Let’s make it concrete."
          description={s.assistantMessage}
        />
        <NextButton busy={busy} onClick={() => void send("synthesize", {})}>
          Draft my goal
        </NextButton>
        <div className="bottom-links">
          <button className="text-button" onClick={onBack}>
            <ArrowLeft size={14} /> Edit intention
          </button>
        </div>
      </>
    );
  return (
    <>
      <SectionTitle
        title="Does this feel like your goal?"
        description={s.assistantMessage}
      />
      {s.scopeReadiness?.mode === "discovery" && (
        <Notice warning>
          <div>
            <strong>A first discovery milestone, for your approval</strong>
            <p>
              This narrows the sprint to defining or learning what is needed. It
              does not claim to complete your full original outcome.
            </p>
          </div>
        </Notice>
      )}
      {s.scopeReadiness?.scopeSummary && (
        <p className="small">
          <strong>Scope for this proposal:</strong>{" "}
          {s.scopeReadiness.scopeSummary}
        </p>
      )}
      {(editing ? goals : s.goals).map((g, i) => (
        <section className="goal-card" key={g.id}>
          <div className="row between">
            <span className="badge">
              {i === 0 ? "Main goal" : `Goal ${i + 1}`}, proposed
            </span>
            <span className="small">By {displayDate(g.deadline)}</span>
          </div>
          {editing ? (
            <>
              <label>
                Goal title
                <input
                  value={g.title}
                  onChange={(e) => patch(i, { title: e.target.value })}
                />
              </label>
              <label>
                Goal statement
                <textarea
                  rows={3}
                  value={g.statement}
                  onChange={(e) => patch(i, { statement: e.target.value })}
                />
              </label>
              <label>
                Done when (one check per line)
                <textarea
                  value={g.completionCriteria.join("\n")}
                  onChange={(e) =>
                    patch(i, { completionCriteria: e.target.value.split("\n") })
                  }
                />
              </label>
              <label>
                Done means
                <textarea
                  value={g.definitionOfSuccess}
                  onChange={(e) =>
                    patch(i, { definitionOfSuccess: e.target.value })
                  }
                />
              </label>
              <label>
                Deadline
                <input
                  type="date"
                  min={s.startDate}
                  max={s.endDate}
                  value={g.deadline}
                  onChange={(e) => patch(i, { deadline: e.target.value })}
                />
              </label>
              <details>
                <summary>Why this wording</summary>
                {Object.entries(g.smart).map(([k, v]) => (
                  <label key={k}>
                    {smartLabels[k] ?? k}
                    <textarea
                      value={v}
                      onChange={(e) =>
                        patch(i, { smart: { ...g.smart, [k]: e.target.value } })
                      }
                    />
                  </label>
                ))}
              </details>
            </>
          ) : (
            <>
              <h2>{g.title}</h2>
              <p className="goal-statement">{g.statement}</p>
              <CheckList items={g.completionCriteria} />
              <div className="success-definition">
                <strong>Done means</strong>
                <p>{g.definitionOfSuccess}</p>
              </div>
              <details className="why-wording">
                <summary>Why this wording</summary>
                <div className="smart-grid">
                  {Object.entries(g.smart).map(([label, description]) => (
                    <div key={label}>
                      <div>
                        <strong>{smartLabels[label] ?? label}</strong>
                        <p>{description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
              {g.assumptions.length > 0 && (
                <Notice warning>
                  <strong>Assumptions to review</strong>
                  <CheckList items={g.assumptions} />
                </Notice>
              )}
              {g.warnings.length > 0 && (
                <Notice warning>
                  <CheckList items={g.warnings} />
                </Notice>
              )}
              <p className="small">
                We’ll check whether this fits your time once the steps are
                estimated.
              </p>
            </>
          )}
        </section>
      ))}
      {editing ? (
        <div className="step-actions">
          <Button
            secondary
            onClick={() => {
              setGoals(structuredClone(s.goals));
              setEditing(false);
            }}
          >
            Cancel edits
          </Button>
          <Button
            busy={busy}
            onClick={async () => {
              if (await send("edit_goals", { goals })) setEditing(false);
            }}
          >
            Save my changes
          </Button>
        </div>
      ) : (
        <>
          <div className="step-actions">
            <Button
              secondary
              onClick={() => {
                setGoals(structuredClone(s.goals));
                setEditing(true);
              }}
            >
              <Pencil size={15} /> Modify
            </Button>
            <NextButton
              busy={busy}
              onClick={() => void send("approve_goals", {}, "goals")}
            >
              Approve goal{s.goals.length > 1 ? "s" : ""}
            </NextButton>
          </div>
          <details className="regenerate">
            <summary>Ask for a different version</summary>
            <label>
              What should change?
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="A smaller scope, a different measure of success…"
              />
            </label>
            <Button
              secondary
              busy={busy}
              onClick={() => void send("regenerate_goals", { feedback })}
            >
              Reject & regenerate
            </Button>
          </details>
        </>
      )}
      <button className="text-button bottom-links" onClick={onBack}>
        <ArrowLeft size={14} /> Edit original intention
      </button>
    </>
  );
}
