"""Agent instruction text, adapted from the original saved agents.

Each role file has a base section and one "## Task: <name>" section per task.
An agent receives the shared rules, its role base and only its own task.
"""

from __future__ import annotations

import re
from functools import cache
from pathlib import Path

_DIR = Path(__file__).resolve().parent
_TASK = re.compile(r"^## Task: ([a-z_]+)\s*$", re.MULTILINE)


class InstructionError(RuntimeError):
    pass


@cache
def role_sections(role: str) -> tuple[str, dict[str, str]]:
    text = (_DIR / f"{role}.md").read_text()
    parts = _TASK.split(text)
    base, rest = parts[0].strip(), parts[1:]
    tasks = {rest[i]: rest[i + 1].strip() for i in range(0, len(rest), 2)}
    return base, tasks


@cache
def instruction_for(role: str, task: str) -> str:
    shared = (_DIR / "_shared.md").read_text().strip()
    base, tasks = role_sections(role)
    if task not in tasks:
        raise InstructionError(f"No instructions for {role}.{task}")
    return f"{shared}\n\n{base}\n\n## Your task now: {task}\n\n{tasks[task]}\n"
