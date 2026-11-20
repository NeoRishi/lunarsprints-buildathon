"use client";
import { useState } from "react";
import Link from "next/link";
import type { Sprint } from "../contracts";
import type { Send } from "./workspace";
import { Button, NextButton, Notice, SectionTitle } from "./shared";

export function ClarificationContinuation({
  sprint: s,
  send,
  busy,
}: {
  sprint: Sprint;
  send: Send;
  busy: boolean;
}) {
  const p = s.pendingClarification!;
  const scopeContinuation = [
    "generate_stories",
    "synthesize",
    "regenerate_goals",
  ].includes(p.resumeAction);
  const [option, setOption] = useState(
    p.reply?.source === "user_selected"
      ? (p.options.find((o) => o.text === p.reply?.value)?.id ?? "")
      : "",
  );
  const [custom, setCustom] = useState(
    p.reply?.source === "user_custom" ? p.reply.value : "",
  );
  const value =
    custom.trim() || p.options.find((o) => o.id === option)?.text || "";
  const dirty = Boolean(
    value && (p.reply?.status !== "confirmed" || p.reply.value !== value),
  );
  const count =
    (s.clarification?.questions.length ?? 0) +
    (s.clarificationHistory?.length ?? 0) +
    1;
  if (!p.consentGranted)
    return (
      <>
        <SectionTitle
          title="One extra question could help."
          description="This would go beyond the default five-question limit. Continue only if you want to clarify this additional detail."
        />
        <Notice>{p.reason}</Notice>
        <NextButton
          busy={busy}
          onClick={() => void send("consent_clarification")}
        >
          Continue with one extra question
        </NextButton>
        <p>
          <Link href="/app">Pause and return later</Link>. Your draft and
          approvals stay saved.
        </p>
      </>
    );
  return (
    <>
      <SectionTitle
        title="One detail before we continue."
        description={p.reason}
      />
      <span className="badge">
        Question {count}
        {count <= 5 ? " of up to five" : ", an extra one you allowed"}
      </span>
      {s.approvals.some((a) => a.kind === "goals") && (
        <Notice>
          Your approved goal and earlier answers are preserved. Any revised goal
          will need your approval.
        </Notice>
      )}
      <section className="question-card" aria-label="Planning clarification">
        <h2>{p.question}</h2>
        <fieldset className="options" disabled={busy}>
          <legend className="sr-only">
            Choose an answer or write your own
          </legend>
          {p.options.map((o) => (
            <label
              key={o.id}
              className={`option ${option === o.id && !custom ? "chosen" : ""}`}
            >
              <input
                type="radio"
                name={`followup-${p.id}`}
                checked={option === o.id && !custom}
                onChange={() => {
                  setOption(o.id);
                  setCustom("");
                }}
              />
              <span>{o.text}</span>
            </label>
          ))}
          <label className="field">
            {p.options.length ? "Other: write my own answer" : "Your answer"}
            <textarea
              rows={3}
              maxLength={3000}
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setOption("");
              }}
              placeholder="Describe the scope or detail in your own words…"
            />
          </label>
        </fieldset>
        <div className="actions">
          <Button
            busy={busy}
            disabled={!dirty}
            onClick={() =>
              void send("answer_clarification", {
                questionId: p.id,
                status: "confirmed",
                optionId: custom.trim() ? null : option || null,
                customText: custom.trim() || null,
              })
            }
          >
            Save answer
          </Button>
          <Button
            secondary
            busy={busy}
            onClick={() =>
              void send("answer_clarification", {
                questionId: p.id,
                status: "unknown",
                optionId: null,
                customText: null,
              })
            }
          >
            I don’t know yet
          </Button>
        </div>
        {p.reply && (
          <Notice>
            <div>
              <strong>Saved answer</strong>
              <p>
                {p.reply.status === "unknown"
                  ? scopeContinuation
                    ? "Not known yet. A bounded discovery milestone can be proposed for your review."
                    : "Not known yet. This uncertainty stays explicit in the next proposal."
                  : p.reply.value}
              </p>
            </div>
          </Notice>
        )}
        {p.reply?.status === "unknown" && scopeContinuation && (
          <p>
            The original outcome stays saved. A discovery proposal narrows this
            sprint to learning or defining what is needed; it will not claim the
            full outcome is complete.
          </p>
        )}
        <NextButton
          busy={busy}
          disabled={!p.reply || dirty}
          onClick={() => void send("resume_clarification")}
        >
          {p.reply?.status === "unknown" && scopeContinuation
            ? "Propose a discovery milestone"
            : "Continue planning"}
        </NextButton>
      </section>
      <details>
        <summary>Your earlier answers remain saved</summary>
        {s.answers
          .filter((a) => a.status === "confirmed")
          .map((a) => {
            const q = s.clarification?.questions.find(
              (q) => q.id === a.questionId,
            );
            return (
              <p key={a.questionId}>
                <strong>{q?.question}</strong>
                <br />
                {a.customText ||
                  q?.options.find((o) => o.id === a.optionId)?.text}
              </p>
            );
          })}
        {s.clarificationHistory?.map((a) => (
          <p key={a.questionId}>
            <strong>{a.question}</strong>
            <br />
            {a.status === "unknown" ? "Not known yet" : a.value}
          </p>
        ))}
      </details>
      <p>
        <Link href="/app">Pause and return later</Link>. Your saved question
        will be here when you return.
      </p>
    </>
  );
}

export function AvailabilityConfirmation({
  sprint: s,
  send,
  busy,
}: {
  sprint: Sprint;
  send: Send;
  busy: boolean;
}) {
  const [hours, setHours] = useState(
    String(s.dailyMinutes.reduce((n, m) => n + m, 0) / 60),
  );
  const [open, setOpen] = useState(false);
  if (
    s.capacityMinutes !== null ||
    s.stories.length > 0 ||
    !["goals", "stories"].includes(s.stage) ||
    s.pendingClarification
  )
    return null;
  return (
    <section
      className="notice warning"
      aria-label="Confirm planning availability"
    >
      <div>
        <strong>Your time budget is still unconfirmed.</strong>
        <p>
          Answers about time remain estimates until you confirm a budget.
          Current daily limits are setup values; please verify them.
        </p>
        <Button secondary busy={busy} onClick={() => setOpen((v) => !v)}>
          Confirm or edit availability
        </Button>
        {open && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send("confirm_availability", {
                capacityMinutes: Math.round(Number(hours) * 60),
                dailyMinutes: s.dailyMinutes,
                bufferPercent: s.bufferPercent,
              });
            }}
          >
            <label>
              Available hours for this sprint
              <input
                type="number"
                min=".02"
                max={s.dailyMinutes.reduce((n, m) => n + m, 0) / 60}
                step="any"
                required
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </label>
            <p>
              Confirm only time you can protect. The {s.bufferPercent}% buffer
              will be reserved from this budget. You can also continue with
              availability explicitly unknown.
            </p>
            <Button type="submit" busy={busy}>
              Confirm time budget
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
