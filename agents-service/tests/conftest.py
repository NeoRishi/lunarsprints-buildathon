"""Shared fixtures. Nothing here touches the network or a real key."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator
from typing import Any

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from pydantic import Field

from lunarsprints_agents.config import Settings, load_settings

ENV = {
    "GEMINI_MODEL_DEFAULT": "test-default-model",
    "GEMINI_MODEL_SMART_GOAL": "test-pro-model",
    "GEMINI_MODEL_SCHEDULING": "test-flash-model",
    "AGENTS_SERVICE_TOKEN": "test-token-not-a-secret",
    "AGENTS_TIMEOUT_SECONDS": "2",
}


@pytest.fixture
def settings() -> Settings:
    return load_settings(ENV)


class FakeLlm(BaseLlm):
    """Stands in for Gemini. Returns a fixed answer, delays or raises."""

    reply: str = ""
    delay: float = 0.0
    error: Exception | None = None
    usage: types.GenerateContentResponseUsageMetadata | None = None
    seen: list[LlmRequest] = Field(default_factory=list)

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        self.seen.append(llm_request)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text=self.reply)]),
            usage_metadata=self.usage,
        )


def envelope(agent_id: str, payload: Any, status: str = "ok") -> dict[str, Any]:
    return {
        "schemaVersion": "2.1",
        "agentId": agent_id,
        "status": status,
        "payload": payload,
        "missingFields": [],
        "clarification": None,
        "warnings": [],
    }


def notes_answer(notes: list[str]) -> str:
    return json.dumps(envelope("scheduling", {"notes": notes}))


NOTES_INPUT: dict[str, Any] = {
    "validatedAllocations": [{"taskId": "m1-s1", "date": "2026-12-02", "minutes": 30}],
    "capacity": {
        "planned": 30,
        "buffer": 0,
        "usable": None,
        "dayLoads": [0, 30, 0],
        "overbooked": 0,
        "unknown": True,
        "dailyOverload": False,
        "dailyBufferOverload": False,
        "byGoal": [{"id": "g1", "title": "Fictional goal", "minutes": 30}],
    },
    "startDate": "2026-12-01",
    "endDate": "2026-12-03",
    "confirmedFacts": [],
}
