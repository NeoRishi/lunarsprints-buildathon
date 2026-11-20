"""Builds one ADK LlmAgent per role task. Models come only from Settings."""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.models.google_llm import Gemini
from google.genai import types

from ..config import ROLE_THINKING, Settings
from ..instructions import instruction_for
from ..schemas import generation_model, tasks_for


def _static(text: str) -> object:
    # A callable instruction is passed through as is. A plain string would be
    # scanned for {placeholders} and filled from session state.
    def provide(_context: ReadonlyContext) -> str:
        return text

    return provide


def build_task_agent(settings: Settings, role: str, task: str) -> LlmAgent:
    thinking = ROLE_THINKING.get(role)
    config = types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(thinking_level=thinking) if thinking else None,
    )
    return LlmAgent(
        name=f"{role}__{task}",
        description=f"LunarSprints {role} ({task}). Proposes only.",
        # attempts=1: one call, no automatic retry.
        model=Gemini(
            model=settings.model_for(role),
            retry_options=types.HttpRetryOptions(attempts=1),
        ),
        instruction=_static(instruction_for(role, task)),  # type: ignore[arg-type]
        output_schema=generation_model(settings.contracts_dir, role, task),
        output_key="answer",
        generate_content_config=config,
        include_contents="default",
        disallow_transfer_to_parent=True,
        disallow_transfer_to_peers=True,
    )


def build_role_agents(settings: Settings, role: str) -> dict[str, LlmAgent]:
    return {
        task: build_task_agent(settings, role, task)
        for task in tasks_for(settings.contracts_dir, role)
    }
