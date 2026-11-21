"""All connected roles. Roles not listed here are not served."""

from __future__ import annotations

from google.adk.agents import LlmAgent

from ..config import Settings
from . import intent_alignment, scheduling, smart_goal, story_decomposer

_BUILDERS = {
    intent_alignment.ROLE: intent_alignment.build,
    smart_goal.ROLE: smart_goal.build,
    story_decomposer.ROLE: story_decomposer.build,
    scheduling.ROLE: scheduling.build,
}


def build_all(settings: Settings) -> dict[str, dict[str, LlmAgent]]:
    return {role: build(settings) for role, build in _BUILDERS.items()}
