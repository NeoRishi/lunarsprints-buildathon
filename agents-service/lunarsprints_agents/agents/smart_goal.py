"""The smart_goal role: one ADK LlmAgent per task, each with its own output_schema."""

from __future__ import annotations

from google.adk.agents import LlmAgent

from ..config import Settings
from ._factory import build_role_agents

ROLE = "smart_goal"


def build(settings: Settings) -> dict[str, LlmAgent]:
    return build_role_agents(settings, ROLE)
