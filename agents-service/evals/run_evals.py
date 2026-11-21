"""Live evals for the planning agents. Uses the Gemini key; never run in CI.

    npm run eval:agents                 every role
    npm run eval:agents -- smart_goal   one role

Each *.evalset.json file is an ADK EvalSet. A case's session state names the
role and task, the user message is the planning data, and each rubric id
names a deterministic check below (for example "check:status:ok"). Cases run
once each, one at a time, through the same AgentRunner the API uses.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from google.adk.evaluation.eval_set import EvalSet

from lunarsprints_agents.agents import build_all
from lunarsprints_agents.api import quiet_vendor_logs
from lunarsprints_agents.config import load_settings
from lunarsprints_agents.runner import AgentError, AgentRunner
from lunarsprints_agents.schemas import dump, request_model

HERE = Path(__file__).resolve().parent
Answer = dict[str, Any]
Data = dict[str, Any]

# Words the person must never see, from .agents/skills/copy-quality.
BANNED = re.compile(
    r"—|\bSMART\b|\bstor(y|ies)\b|\b(sub)?tasks?\b|Definition of Done|\bagents?\b|"
    r"\bspecialist\b|\borchestrator\b|\bpayload\b|\bvalidated\b|\breplan\b|\bseamless|"
    r"\beffortless|\bunlock|\bsupercharge|\bempower|\brevolutionary|game-changing|"
    r"cutting-edge|AI-powered|\belevate|\bdelve|\bleverage|next-level|world-class|\bjourney",
    re.IGNORECASE,
)
# Values the person reads. Ids, enums and dates are not prose.
SKIP_KEYS = {
    "id",
    "intentId",
    "goalId",
    "taskId",
    "dependencyIds",
    "evidenceRefs",
    "schemaVersion",
    "agentId",
    "status",
    "mode",
    "category",
    "recommendationBasis",
    "source",
    "code",
    "severity",
    "deadline",
    "date",
    "missingFields",
    "feasibility",
    "confidence",
    "key",
}


# The person's own deliverable may be a "short story": that is not jargon.
ALLOWED = re.compile(r"short stor(y|ies)", re.IGNORECASE)


def visible_text(node: Any, key: str = "") -> list[str]:
    if key in SKIP_KEYS:
        return []
    if isinstance(node, str):
        return [node]
    if isinstance(node, list):
        return [t for item in node for t in visible_text(item, key)]
    if isinstance(node, dict):
        return [t for k, v in node.items() for t in visible_text(v, k)]
    return []


def warned(a: Answer) -> bool:
    p = a.get("payload") or {}
    goal_notes = any(g.get("warnings") or g.get("assumptions") for g in p.get("goals", []))
    return bool(a["warnings"] or p.get("warnings") or goal_notes)


def asked(a: Answer) -> bool:
    p = a.get("payload") or {}
    return (
        (a["status"] == "needs_clarification" and bool(a.get("clarification")))
        or bool(p.get("questions"))
        or p.get("status") == "needs_scope"
        or (p.get("readiness") or {}).get("status") == "needs_scope"
    )


def check_question_rules(a: Answer, d: Data) -> str | None:
    ids = {i["id"] for i in d.get("selectedIntents", [])}
    for q in (a.get("payload") or {}).get("questions", []):
        if q["intentId"] not in ids:
            return f"question uses unknown intention id {q['intentId']}"
        if q["options"] and not 2 <= len(q["options"]) <= 4:
            return "a question has fewer than 2 options"
        recommended = [o for o in q["options"] if o["recommended"]]
        if len(recommended) > 1:
            return "more than one option recommended"
        if any(o["recommendationBasis"] == "none" for o in recommended):
            return "recommended option has no basis"
    return None


def check_goal_rules(a: Answer, d: Data) -> str | None:
    ids = {i["id"] for i in d.get("selectedIntents", [])}
    goals = (a.get("payload") or {}).get("goals", [])
    if a["status"] == "ok" and not goals:
        return "no goals returned"
    for g in goals:
        if g["intentId"] not in ids:
            return f"goal uses unknown intention id {g['intentId']}"
        if not d["startDate"] <= g["deadline"] <= d["endDate"]:
            return f"deadline {g['deadline']} outside the sprint"
    return None


def check_evidence(a: Answer, d: Data) -> str | None:
    p = a.get("payload") or {}
    readiness = p.get("readiness") or (p if "evidenceRefs" in p else None)
    if not readiness:
        return None if a["status"] != "ok" else "no readiness returned"
    known = {f["id"] for f in d["confirmedFacts"]}
    unknown = [r for r in readiness["evidenceRefs"] if r not in known]
    return f"unknown evidence ids {unknown}" if unknown else None


def check_covered(a: Answer, d: Data) -> str | None:
    p = a.get("payload") or {}
    if a["status"] != "ok":
        return f"status {a['status']}, expected a breakdown"
    for g in d["approvedGoals"]:
        covered = {i for s in p["stories"] if s["goalId"] == g["id"] for i in s["coveredCriteria"]}
        missing = set(range(len(g["completionCriteria"]))) - covered
        if missing:
            return f"criteria {sorted(missing)} of {g['id']} not covered"
    return "uncoveredCriteria not empty" if p["uncoveredCriteria"] else None


def check_steps(a: Answer, _d: Data) -> str | None:
    stories = (a.get("payload") or {}).get("stories", [])
    ids = [s["id"] for s in stories]
    all_ids = ids + [t["id"] for s in stories for t in s["tasks"]]
    if len(all_ids) != len(set(all_ids)):
        return "ids are not unique"
    for s in stories:
        if s["id"] in s["dependencyIds"] or any(x not in ids for x in s["dependencyIds"]):
            return f"bad dependency on {s['id']}"
        for t in s["tasks"]:
            if t["subtasks"] and sum(x["minutes"] for x in t["subtasks"]) != t["minutes"]:
                return f"focus steps of {t['id']} do not add up"
    return None


def total_minutes(a: Answer) -> int:
    stories = (a.get("payload") or {}).get("stories", [])
    return sum(t["minutes"] for s in stories for t in s["tasks"])


def check_fits(a: Answer, d: Data) -> str | None:
    if asked(a) or d.get("capacityMinutes") is None:
        return None
    usable = d["capacityMinutes"] * (1 - d["bufferPercent"] / 100)
    total = total_minutes(a)
    if total <= usable or warned(a):
        return None
    return f"{total} minutes planned, {int(usable)} usable, no warning"


def check_between(a: Answer, arg: str) -> str | None:
    low, high = (int(x) for x in arg.split("-"))
    n = len((a.get("payload") or {}).get("stories", []))
    return None if low <= n <= high else f"{n} milestones, expected {arg}"


def check_mentions(a: Answer, arg: str) -> str | None:
    notes = " ".join((a.get("payload") or {}).get("notes", []))
    return None if re.search(arg, notes, re.IGNORECASE) else "no note mentions it"


def payload(a: Answer) -> Answer:
    return a.get("payload") or {}


def run_check(name: str, arg: str | None, a: Answer, d: Data) -> str | None:
    p = payload(a)
    simple: dict[str, Callable[[], str | None]] = {
        "valid": lambda: None,
        "plain_copy": lambda: next(
            (
                f"plain words: {m.group(0)!r} in {t[:60]!r}"
                for t in visible_text(p)
                + visible_text(a.get("clarification") or {})
                + [w["message"] for w in a["warnings"]]
                if (m := BANNED.search(ALLOWED.sub("", t)))
            ),
            None,
        ),
        "status": lambda: None if a["status"] == arg else f"status {a['status']}, expected {arg}",
        "status_in": lambda: (
            None
            if a["status"] in (arg or "").split("|")
            else f"status {a['status']}, expected {arg}"
        ),
        "asks_clarification": lambda: None if asked(a) else "did not ask a question",
        "intents_min": lambda: (
            None
            if len(p.get("intents", [])) >= int(arg or 0)
            else f"{len(p.get('intents', []))} intentions, expected at least {arg}"
        ),
        "has_uncertainties": lambda: None if p.get("uncertainties") else "no uncertainties",
        "has_constraints": lambda: None if p.get("constraints") else "no constraints captured",
        "baseline_null": lambda: None if p.get("baseline") is None else "invented a baseline",
        "baseline_set": lambda: None if p.get("baseline") else "stated progress not captured",
        "flags_tension": lambda: (
            None
            if (
                p.get("uncertainties")
                or any(i.get("conflicts") for i in p.get("intents", []))
                or a["warnings"]
            )
            else "no conflict, uncertainty or warning raised"
        ),
        "questions_min": lambda: (
            None
            if len(p.get("questions", [])) >= int(arg or 0) or asked(a)
            else "no questions asked"
        ),
        "questions_max": lambda: (
            None
            if len(p.get("questions", [])) <= int(arg or 0)
            else f"{len(p.get('questions', []))} questions, expected at most {arg}"
        ),
        "question_rules": lambda: check_question_rules(a, d),
        "goal_rules": lambda: check_goal_rules(a, d),
        "evidence_known": lambda: check_evidence(a, d),
        "readiness": lambda: (
            None
            if (p.get("readiness") or p).get("status") == arg
            else f"readiness {(p.get('readiness') or p).get('status')}, expected {arg}"
        ),
        "mode": lambda: (
            None
            if (p.get("readiness") or {}).get("mode") == arg
            else f"mode {(p.get('readiness') or {}).get('mode')}, expected {arg}"
        ),
        "warns_or_asks": lambda: None if warned(a) or asked(a) else "no warning and no question",
        "criteria_covered": lambda: check_covered(a, d),
        "step_rules": lambda: check_steps(a, d),
        "milestones_between": lambda: check_between(a, arg or "0-0"),
        "fits_or_warns": lambda: check_fits(a, d),
        "notes_max": lambda: (
            None
            if len(p.get("notes", [])) <= int(arg or 0)
            and all(len(n.split()) <= 30 for n in p.get("notes", []))
            else "too many or too long notes"
        ),
        "mentions": lambda: check_mentions(a, arg or ""),
    }
    if name not in simple:
        return f"unknown check {name}"
    return simple[name]()


async def run_case(runner: AgentRunner, contracts: Path, case: Any) -> tuple[str, list[str], int]:
    state = case.session_input.state
    role, task = state["role"], state["task"]
    data = json.loads(case.conversation[0].user_content.parts[0].text)
    body = {"requestId": str(uuid.uuid4()), "task": task, "input": data}
    clean = dump(request_model(contracts, role, task).model_validate(body))
    try:
        answer, usage = await runner.run(role, task, clean["input"], clean["requestId"])
    except AgentError as error:
        status = getattr(error.__cause__, "code", None)
        reason = error.reason or (status if isinstance(status, int) else None)
        detail = f" ({reason})" if reason else ""
        return role, [f"call failed: {error.code}{detail}"], 0
    failures = []
    for rubric in case.rubrics or []:
        _, name, *rest = rubric.rubric_id.split(":", 2)
        problem = run_check(name, rest[0] if rest else None, answer, data)
        if problem:
            failures.append(f"{name}: {problem}")
    return role, failures, usage.latency_ms


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("roles", nargs="*")
    parser.add_argument("--pause", type=float, default=3.0, help="seconds between calls")
    args = parser.parse_args()
    quiet_vendor_logs()
    settings = load_settings()
    runner = AgentRunner(settings, build_all(settings))
    files = sorted(HERE.glob("*.evalset.json"))
    results: dict[str, list[tuple[str, str, list[str], int]]] = {}
    for file in files:
        eval_set = EvalSet.model_validate(json.loads(file.read_text()))
        for case in eval_set.eval_cases:
            role = case.session_input.state["role"]  # type: ignore[union-attr]
            if args.roles and role not in args.roles:
                continue
            _, failures, ms = await run_case(runner, settings.contracts_dir, case)
            summary = case.session_input.state.get("summary", "")  # type: ignore[union-attr]
            results.setdefault(role, []).append((case.eval_id, summary, failures, ms))
            mark = "PASS" if not failures else "FAIL"
            print(f"{mark} {case.eval_id} ({ms / 1000:.1f} s) {summary}", flush=True)
            for f in failures:
                print(f"     - {f}", flush=True)
            await asyncio.sleep(args.pause)
    print("\nPass rate per role (model):")
    for role, rows in results.items():
        passed = sum(1 for r in rows if not r[2])
        print(f"  {role:<18} {passed}/{len(rows)}  ({settings.model_for(role)})")
    print("\nFailed cases:")
    failed = [(role, r) for role, rows in results.items() for r in rows if r[2]]
    for role, (eid, _summary, failures, _ms) in failed:
        print(f"  {role}/{eid}: {failures[0]}")
    if not failed:
        print("  none")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
