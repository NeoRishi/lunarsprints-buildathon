"""Service settings, read from the environment only.

Model names are never written in agent code. Each role reads
GEMINI_MODEL_<ROLE>, then GEMINI_MODEL_DEFAULT. Secrets (GOOGLE_API_KEY,
AGENTS_SERVICE_TOKEN) are read here and never logged.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from google.genai.types import ThinkingLevel

ROLES = ("intent_alignment", "smart_goal", "story_decomposer", "scheduling")
Role = Literal["intent_alignment", "smart_goal", "story_decomposer", "scheduling"]

# How hard each role should think. The original agents ran with "low" reasoning
# per session. Scheduling only writes short notes about a checked schedule.
ROLE_THINKING: dict[str, ThinkingLevel | None] = {
    "intent_alignment": ThinkingLevel.LOW,
    "smart_goal": ThinkingLevel.LOW,
    "story_decomposer": ThinkingLevel.LOW,
    "scheduling": None,
}

DEFAULT_CONTRACTS_DIR = Path(__file__).resolve().parent.parent.parent / "contracts" / "schemas"


class ConfigError(RuntimeError):
    """A required setting is missing. The message names the setting, never its value."""


@dataclass(frozen=True)
class Settings:
    models: dict[str, str]
    service_token: str | None
    timeout_seconds: float = 45.0
    contracts_dir: Path = field(default=DEFAULT_CONTRACTS_DIR)

    def model_for(self, role: str) -> str:
        return self.models[role]


def load_settings(env: dict[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env
    default = source.get("GEMINI_MODEL_DEFAULT", "").strip()
    models: dict[str, str] = {}
    for role in ROLES:
        model = source.get(f"GEMINI_MODEL_{role.upper()}", "").strip() or default
        if not model:
            raise ConfigError(
                f"Set GEMINI_MODEL_DEFAULT or GEMINI_MODEL_{role.upper()} before starting."
            )
        models[role] = model
    timeout = float(source.get("AGENTS_TIMEOUT_SECONDS", "45") or 45)
    contracts = source.get("AGENTS_CONTRACTS_DIR", "").strip()
    return Settings(
        models=models,
        service_token=source.get("AGENTS_SERVICE_TOKEN") or None,
        timeout_seconds=timeout,
        contracts_dir=Path(contracts) if contracts else DEFAULT_CONTRACTS_DIR,
    )
