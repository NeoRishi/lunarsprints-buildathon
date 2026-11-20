"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Download,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  PenLine,
} from "lucide-react";
import type { Command, Sprint } from "../contracts";
import { MAX_SPRINT_DAYS, MIN_SPRINT_DAYS } from "../contracts";
import { addDays, displayDate, sprintDays, todayIn } from "../domain";
import { Button, NextButton, Notice } from "./shared";
import { Planner } from "./planner";
import { Board } from "./board";
import {
  AvailabilityConfirmation,
  ClarificationContinuation,
} from "./clarification-continuation";
import { AuthPanel } from "./auth-panel";

export type View = { sprint: Sprint; hashes: Record<string, string> };
export type Send = (
  action: Command["action"],
  data?: unknown,
  hashKind?: string,
) => Promise<Sprint | null>;
type Saved = {
  id: string;
  title: string;
  stage: string;
  startDate: string;
  endDate: string;
};
type PlanSummary = {
  id: string;
  maxActiveSprints: number;
  maxSprintDays: number;
};
export function Workspace() {
  const [auth, setAuth] = useState<{
    configured: boolean;
    user: { id: string; email: string | null } | null;
    callbackUrl?: string;
  } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  const [screen, setScreen] = useState<"home" | "planning" | "board">("home");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const current = useRef<View | null>(null);
  const inFlight = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [canCancel, setCanCancel] = useState(false);
  const [failedCommand, setFailedCommand] = useState<Command | null>(null);
  const update = useCallback((next: View) => {
    current.current = next;
    setView(next);
    setScreen(next.sprint.stage === "active" ? "board" : "planning");
  }, []);
  const loadList = useCallback(async () => {
    const r = await fetch("/api/sprints");
    const b = await r.json();
    if (!r.ok)
      throw new Error(
        b.message ?? b.error?.message ?? "Could not load saved sprints.",
      );
    setSaved(b.sprints);
    if (b.plan) setPlan(b.plan);
  }, []);
  const load = useCallback(
    async (id: string) => {
      setBusy("Loading your saved sprint");
      setError("");
      try {
        const r = await fetch(`/api/sprints?id=${encodeURIComponent(id)}`);
        const b = await r.json();
        if (!r.ok) throw new Error(b.message ?? b.error?.message);
        update(b);
        history.replaceState(null, "", `/app?sprint=${id}`);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not load this sprint.",
        );
      } finally {
        setBusy("");
      }
    },
    [update],
  );
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/auth/session");
        const b = await r.json();
        if (!r.ok) throw new Error(b.message ?? b.error?.message);
        if (!alive) return;
        setAuth(b);
        if (b.user) {
          await loadList();
          const id = new URLSearchParams(location.search).get("sprint");
          if (id) await load(id);
        }
      } catch (e) {
        if (alive)
          setError(e instanceof Error ? e.message : "Could not load account.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [load, loadList]);
  const labels: Partial<Record<Command["action"], string>> = {
    assess: "Understanding your intention",
    select_intents: "Finding the details that matter",
    synthesize: "Drafting your goal",
    regenerate_goals: "Reworking your goal",
    generate_stories: "Drafting the steps",
    schedule: "Building a feasible date and effort plan",
    request_schedule_advice: "Explaining your saved schedule",
    request_replan: "Suggesting a new plan",
    next_action: "Finding your next useful action",
    reflect: "Reflecting on your reported progress",
    resume_clarification: "Using your answer to prepare the next proposal",
  };
  async function execute(command: Command) {
    if (inFlight.current) return null;
    inFlight.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setCanCancel(true);
    setBusy(labels[command.action] ?? "Saving your changes");
    setError("");
    setFailedCommand(command);
    try {
      const r = await fetch("/api/sprints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
        signal: controller.signal,
      });
      const body = await r.json();
      if (!r.ok)
        throw new Error(
          body.message ??
            body.error?.message ??
            "This change could not be saved.",
        );
      update(body);
      setFailedCommand(null);
      history.replaceState(null, "", `/app?sprint=${body.sprint.id}`);
      return body.sprint as Sprint;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError(
          "Stopped waiting. The server may still save this request; refresh the saved plan before making another change.",
        );
      } else {
        setError(
          e instanceof Error
            ? e.message
            : "Network unavailable. Retry the same request safely.",
        );
      }
      return null;
    } finally {
      abortRef.current = null;
      setCanCancel(false);
      inFlight.current = false;
      setBusy("");
    }
  }
  const send: Send = async (action, data = {}, hashKind) => {
    const v = current.current;
    if (!v) return null;
    return execute({
      sprintId: v.sprint.id,
      expectedRevision: v.sprint.revision,
      idempotencyKey: crypto.randomUUID(),
      action,
      data,
      ...(hashKind ? { hash: v.hashes[hashKind] } : {}),
    });
  };
  const sprint = view?.sprint;
  const step = sprint
    ? {
        intention: 0,
        select: 1,
        clarify: 1,
        goals: 2,
        stories: 3,
        schedule: 4,
        review: 5,
        active: 5,
      }[sprint.stage]
    : 0;
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="header-inner">
          <button
            className="brand"
            onClick={() => {
              setScreen("home");
              if (auth?.user) void loadList();
            }}
          >
            <span className="brand-mark">
              <Moon size={21} fill="currentColor" />
            </span>
            LunarSprints
          </button>
          <nav aria-label="Main navigation">
            <button
              className={
                screen === "planning" ? "nav-link selected" : "nav-link"
              }
              onClick={() => setScreen(sprint ? "planning" : "home")}
            >
              Planning
            </button>
            <button
              className={screen === "board" ? "nav-link selected" : "nav-link"}
              onClick={() => setScreen("board")}
            >
              Today & board
            </button>
          </nav>
          <div className="account">
            {auth?.user ? (
              <>
                {sprint && (
                  <a
                    href={`/api/sprints?id=${encodeURIComponent(sprint.id)}&export=1`}
                    className="icon-button"
                    title="Download a copy of this sprint"
                    aria-label="Download a copy of this sprint"
                  >
                    <Download size={16} />
                  </a>
                )}
                <span className="avatar">
                  {auth.user.email?.slice(0, 2).toUpperCase()}
                </span>
                <button
                  title="Sign out"
                  aria-label="Sign out"
                  className="icon-button"
                  onClick={async () => {
                    const r = await fetch("/api/auth/session", {
                      method: "DELETE",
                    });
                    const b = r.ok ? null : await r.json().catch(() => null);
                    if (!r.ok)
                      setError(
                        b?.error?.message ??
                          "Sign-out could not be completed. Please try again.",
                      );
                    // auth_unavailable means this device is signed out but other
                    // devices may not be. Any other failure kept the session.
                    if (r.ok || b?.error?.code === "auth_unavailable") {
                      setAuth({ ...auth, user: null });
                      setView(null);
                      current.current = null;
                      setSaved([]);
                      setScreen("home");
                      history.replaceState(null, "", "/app");
                    }
                  }}
                >
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <span className="header-note">Your sprint. Your pace.</span>
            )}
          </div>
        </div>
      </header>
      <main id="main-content" className="workspace">
        {error && (
          <div className="error-banner" role="alert">
            <div>
              <strong>This step needs attention</strong>
              <p>{error}</p>
            </div>
            <div className="actions">
              {failedCommand && (
                <Button
                  secondary
                  disabled={Boolean(busy)}
                  onClick={() => failedCommand && void execute(failedCommand)}
                >
                  Retry request
                </Button>
              )}
              {sprint && (
                <Button
                  secondary
                  disabled={Boolean(busy)}
                  onClick={() => void load(sprint.id)}
                >
                  Refresh saved plan
                </Button>
              )}
              <button className="text-button" onClick={() => setError("")}>
                Dismiss
              </button>
            </div>
          </div>
        )}
        {busy && (
          <div className="activity" role="status" aria-live="polite">
            <span className="activity-dot" />
            {busy}… <span>Your last saved plan stays safe.</span>
            {canCancel && (
              <button
                type="button"
                className="text-button"
                onClick={() => abortRef.current?.abort()}
              >
                Stop waiting
              </button>
            )}
          </div>
        )}
        {screen === "home" && (
          <>
            <div className="welcome">
              <div>
                <h1>
                  Write your intention.
                  <br />
                  <span>Make it a sprint.</span>
                </h1>
                <p>
                  A little clarity. A realistic plan. A paksha of meaningful
                  progress,
                  <br className="desktop-only" /> with you in control of every
                  commitment.
                </p>
                <div className="welcome-flow">
                  <span>
                    <PenLine size={16} /> In your own words
                  </span>
                  <ChevronRight size={14} />
                  <span>
                    <Sparkles size={16} /> Thoughtful questions
                  </span>
                  <ChevronRight size={14} />
                  <span>
                    <Check size={16} /> Your approved plan
                  </span>
                </div>
              </div>
              <div className="welcome-aside">
                <Moon size={38} />
                <p>
                  Less planning overhead.
                  <br />
                  More room for what matters.
                </p>
                <span>
                  One primary goal is a good place to start.
                  <br />
                  Additional goals share the same capacity.
                </span>
              </div>
            </div>
            {auth === null ? (
              <p role="status">Checking your workspace…</p>
            ) : !auth.configured ? (
              <Notice warning>
                <strong>LunarSprints is not available right now</strong>
                <p>
                  Sign-in and saving are temporarily unavailable. Please try
                  again shortly.
                </p>
              </Notice>
            ) : !auth.user ? (
              <AuthPanel
                callbackUrl={
                  auth.callbackUrl ??
                  new URL("/auth/callback", location.href).href
                }
                onAuthenticated={async () => {
                  const r = await fetch("/api/auth/session");
                  const a = await r.json();
                  if (!r.ok)
                    throw new Error(
                      a.message ??
                        a.error?.message ??
                        "Could not load your account.",
                    );
                  setAuth(a);
                  await loadList();
                }}
              />
            ) : (
              <>
                <div className="home-grid">
                  <StartForm
                    busy={Boolean(busy)}
                    maxDays={plan?.maxSprintDays ?? MAX_SPRINT_DAYS}
                    onStart={async (data) => {
                      const id = crypto.randomUUID();
                      await execute({
                        sprintId: id,
                        expectedRevision: -1,
                        idempotencyKey: crypto.randomUUID(),
                        action: "create",
                        data,
                      });
                    }}
                  />
                  <section className="saved-sprints">
                    <div className="row between">
                      <h2>Your sprints</h2>
                      <button
                        aria-label="Refresh sprint list"
                        className="icon-button"
                        onClick={() =>
                          void loadList().catch((e) => setError(e.message))
                        }
                      >
                        <RefreshCw size={16} />
                      </button>
                    </div>
                    {saved.length ? (
                      saved.map((s) => (
                        <div className="saved-sprint-row" key={s.id}>
                          <button
                            className="saved-sprint"
                            onClick={() => void load(s.id)}
                          >
                            <span className="badge">
                              {s.stage === "active" ? "Active" : "Draft"}
                            </span>
                            <strong>{s.title}</strong>
                            <span>
                              {displayDate(s.startDate)} –{" "}
                              {displayDate(s.endDate)}
                            </span>
                            <ChevronRight size={17} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title="Archive sprint"
                            aria-label={`Archive ${s.title}`}
                            onClick={async () => {
                              try {
                                const r = await fetch(
                                  `/api/sprints?id=${encodeURIComponent(s.id)}`,
                                  { method: "DELETE" },
                                );
                                if (!r.ok) {
                                  const b = await r.json();
                                  throw new Error(
                                    b.message ?? "Could not archive sprint.",
                                  );
                                }
                                if (sprint?.id === s.id) {
                                  setView(null);
                                  current.current = null;
                                }
                                await loadList();
                              } catch (e) {
                                setError(
                                  e instanceof Error
                                    ? e.message
                                    : "Could not archive sprint.",
                                );
                              }
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="empty-small">
                        <CalendarDays size={26} />
                        <p>Your first sprint starts here.</p>
                        <span>Drafts will be saved as you go.</span>
                      </div>
                    )}
                  </section>
                </div>
              </>
            )}
          </>
        )}
        {screen === "planning" && sprint && sprint.stage !== "active" && (
          <>
            <ol className="stepper" aria-label="Sprint planning steps">
              {[
                "Intention",
                "Clarify",
                "Goal",
                "Steps",
                "Schedule",
                "Review",
              ].map((title, i) => (
                <li
                  key={title}
                  className={
                    i === step ? "current" : i < step ? "complete" : ""
                  }
                  aria-current={i === step ? "step" : undefined}
                >
                  <span>{i < step ? <Check size={15} /> : i + 1}</span>
                  <strong>{title}</strong>
                </li>
              ))}
            </ol>
            <div className="planner-layout">
              <section className="panel main-panel" aria-busy={Boolean(busy)}>
                <AvailabilityConfirmation
                  key={`availability-${sprint.id}-${sprint.revision}`}
                  sprint={sprint}
                  send={send}
                  busy={Boolean(busy)}
                />
                {sprint.pendingClarification ? (
                  <ClarificationContinuation
                    key={`${sprint.pendingClarification.id}-${sprint.revision}`}
                    sprint={sprint}
                    send={send}
                    busy={Boolean(busy)}
                  />
                ) : (
                  <Planner
                    key={sprint.id}
                    sprint={sprint}
                    hashes={view!.hashes}
                    busy={Boolean(busy)}
                    send={send}
                  />
                )}
              </section>
              <aside className="panel planning-aside">
                <div>
                  <h3>Your original intention</h3>
                  <blockquote>
                    {sprint.originalIntention
                      ? `“${sprint.originalIntention}”`
                      : "Start with a thought. You don’t need to have it all figured out."}
                  </blockquote>
                  {sprint.intention !== sprint.originalIntention &&
                    sprint.intention && (
                      <p className="small">
                        Your revised wording is saved separately.
                      </p>
                    )}
                </div>
                <div className="aside-section">
                  <h3>Sprint horizon</h3>
                  <div className="info-line">
                    <CalendarDays size={21} />
                    <div>
                      <strong>
                        {displayDate(sprint.startDate)} –{" "}
                        {displayDate(sprint.endDate)}
                      </strong>
                      <span>
                        {sprintDays(sprint)} calendar days, {sprint.timezone}{" "}
                        time
                      </span>
                    </div>
                  </div>
                  <h3>Your capacity</h3>
                  <div className="info-line">
                    <Clock3 size={21} />
                    <div>
                      <strong>
                        {sprint.capacityMinutes === null
                          ? "Not known yet"
                          : `${(sprint.capacityMinutes / 60).toFixed(1)} hours`}
                      </strong>
                      <span>
                        Your estimate, with a {sprint.bufferPercent}% buffer
                      </span>
                    </div>
                  </div>
                </div>
                <Notice>
                  <ShieldCheck size={19} />
                  <div>
                    <strong>You stay in control.</strong>
                    <p>Every goal and plan is approved by you.</p>
                  </div>
                </Notice>
                <span className="saved-indicator">
                  <Check size={13} /> Saved
                </span>
              </aside>
            </div>
          </>
        )}
        {screen === "planning" && sprint?.stage === "active" && (
          <section className="panel empty-state">
            <ShieldCheck size={38} />
            <h1>Your sprint is active.</h1>
            <p>Your approved plan is ready on the execution board.</p>
            <NextButton onClick={() => setScreen("board")}>
              Open sprint board
            </NextButton>
          </section>
        )}
        {screen === "board" &&
          (sprint?.stage === "active" ? (
            sprint.pendingClarification ? (
              <section className="panel main-panel">
                <ClarificationContinuation
                  key={`${sprint.pendingClarification.id}-${sprint.revision}`}
                  sprint={sprint}
                  send={send}
                  busy={Boolean(busy)}
                />
              </section>
            ) : (
              <Board
                sprint={sprint}
                hashes={view!.hashes}
                send={send}
                busy={Boolean(busy)}
              />
            )
          ) : (
            <section className="panel empty-state">
              <CalendarDays size={36} />
              <h1>A clear plan comes first.</h1>
              <p>
                Your execution board opens after you approve and activate a
                sprint.
              </p>
              <NextButton
                onClick={() => setScreen(sprint ? "planning" : "home")}
              >
                {sprint ? "Continue planning" : "Start a sprint"}
              </NextButton>
            </section>
          ))}
        <footer className="app-footer">
          <span>
            <Moon size={13} /> LunarSprints
          </span>
          <span>A NeoRishi product</span>
        </footer>
      </main>
    </>
  );
}
function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}
const DURATION_PRESETS = [7, 15, 30, 45];
function StartForm({
  onStart,
  busy,
  maxDays,
}: {
  onStart: (data: unknown) => Promise<void>;
  busy: boolean;
  maxDays: number;
}) {
  const limit = Math.max(MIN_SPRINT_DAYS, Math.min(maxDays, MAX_SPRINT_DAYS));
  const [timezone, setTimezone] = useState(browserTimezone);
  const [start, setStart] = useState(() => todayIn(browserTimezone()));
  const [days, setDays] = useState(Math.min(15, limit));
  const [hours, setHours] = useState(Math.min(15, limit));
  const [unknown, setUnknown] = useState(false);
  const [buffer, setBuffer] = useState(20);
  const [daily, setDaily] = useState(
    Array<number>(Math.min(15, limit)).fill(60),
  );
  const end = start ? addDays(start, days - 1) : "";
  // Keep one availability value per day, preserving edits when the length changes.
  function resize(next: number) {
    const clamped = Math.max(
      MIN_SPRINT_DAYS,
      Math.min(limit, Math.round(next)),
    );
    setDays(clamped);
    setDaily((prev) =>
      Array.from({ length: clamped }, (_, i) => prev[i] ?? 60),
    );
  }
  function setEnd(value: string) {
    if (!start || !value) return;
    resize(sprintDays({ startDate: start, endDate: value }));
  }
  return (
    <section className="panel start-panel">
      <div className="row between">
        <h2>Your next {days} days</h2>
        <span className="badge">New sprint</span>
      </div>
      <p>
        Choose a horizon from {MIN_SPRINT_DAYS} to {limit} days and a budget you
        can comfortably protect.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onStart({
            startDate: start,
            endDate: end,
            timezone,
            capacityMinutes: unknown ? null : Math.round(hours * 60),
            dailyMinutes: daily,
            bufferPercent: buffer,
          });
        }}
      >
        <div className="field-grid">
          <label>
            Start date
            <input
              type="date"
              required
              min={todayIn(timezone)}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              required
              min={start ? addDays(start, MIN_SPRINT_DAYS - 1) : undefined}
              max={start ? addDays(start, limit - 1) : undefined}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <label>
            Length in days
            <input
              type="number"
              min={MIN_SPRINT_DAYS}
              max={limit}
              step="1"
              value={days}
              onChange={(e) => resize(Number(e.target.value))}
            />
          </label>
          <div
            className="duration-presets"
            role="group"
            aria-label="Quick lengths"
          >
            {DURATION_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={n === days ? "chip selected" : "chip"}
                disabled={n > limit}
                title={n > limit ? "Available on LunarSprints+" : undefined}
                aria-pressed={n === days}
                onClick={() => resize(n)}
              >
                {n} days
              </button>
            ))}
          </div>
          <label>
            Hours available this sprint
            <input
              type="number"
              step=".5"
              min=".5"
              max={days * 16}
              disabled={unknown}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </label>
          <label>
            Buffer for the unexpected
            <select
              value={buffer}
              onChange={(e) => setBuffer(Number(e.target.value))}
            >
              {[0, 10, 15, 20, 25, 30].map((n) => (
                <option key={n} value={n}>
                  {n}%{n === 20 ? " (suggested)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        {start && end ? (
          <p className="small">
            {displayDate(start)} to {displayDate(end)}, {days} calendar days
          </p>
        ) : null}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={unknown}
            onChange={(e) => setUnknown(e.target.checked)}
          />{" "}
          I don’t know my total capacity yet
        </label>
        <details>
          <summary>Daily availability & timezone</summary>
          <p className="small">
            A suggested starting point of 60 minutes per day. Confirm or adjust
            it, including rest days. These are effort budgets, not calendar
            appointments.
          </p>
          <div className="availability-grid">
            {daily.map((n, i) => (
              <label key={i}>
                Day {i + 1}
                <input
                  aria-label={`Day ${i + 1} available minutes`}
                  type="number"
                  min="0"
                  max="960"
                  step="5"
                  value={n}
                  onChange={(e) =>
                    setDaily(
                      daily.map((v, j) =>
                        i === j ? Number(e.target.value) : v,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <label>
            Timezone
            <input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              required
            />
          </label>
        </details>
        <NextButton type="submit" busy={busy}>
          Start planning
        </NextButton>
      </form>
    </section>
  );
}
