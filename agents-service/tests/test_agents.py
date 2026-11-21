from google.adk.models.google_llm import Gemini

from lunarsprints_agents.agents import build_all
from lunarsprints_agents.config import Settings
from lunarsprints_agents.instructions import instruction_for, role_sections
from lunarsprints_agents.schemas import generation_model

BANNED_ON_SCREEN = ("—", "seamless", "supercharge", "AI-powered")


def test_each_task_agent_uses_its_role_model_and_schema(settings: Settings) -> None:
    agents = build_all(settings)
    assert set(agents) == {"intent_alignment", "smart_goal", "story_decomposer", "scheduling"}
    for role, tasks in agents.items():
        for task, agent in tasks.items():
            assert isinstance(agent.model, Gemini)
            assert agent.model.model == settings.model_for(role)
            assert agent.output_schema is generation_model(settings.contracts_dir, role, task)
            assert agent.name == f"{role}__{task}"
            assert not agent.tools and not agent.sub_agents


def test_agents_never_retry(settings: Settings) -> None:
    for tasks in build_all(settings).values():
        for agent in tasks.values():
            assert isinstance(agent.model, Gemini)
            assert agent.model.retry_options is not None
            assert agent.model.retry_options.attempts == 1


def test_pro_and_flash_roles_differ_when_configured(settings: Settings) -> None:
    agents = build_all(settings)
    assert agents["smart_goal"]["goals"].model.model == "test-pro-model"  # type: ignore[union-attr]
    assert agents["scheduling"]["schedule_notes"].model.model == "test-flash-model"  # type: ignore[union-attr]


def test_every_task_has_instructions_with_shared_rules() -> None:
    for role, tasks in {
        "intent_alignment": ["assess"],
        "smart_goal": ["clarify", "goals", "readiness"],
        "story_decomposer": ["stories"],
        "scheduling": ["schedule_notes"],
    }.items():
        assert sorted(role_sections(role)[1]) == sorted(tasks)
        for task in tasks:
            text = instruction_for(role, task)
            assert "untrusted" in text
            assert "3 to 45 days" in text
            assert "Reality comes before lunar context" in text
            assert f"## Your task now: {task}" in text


def test_instructions_have_no_long_dash_or_vendor_words() -> None:
    for role in ("intent_alignment", "smart_goal", "story_decomposer", "scheduling"):
        for task in role_sections(role)[1]:
            text = instruction_for(role, task)
            for word in BANNED_ON_SCREEN:
                assert word not in text.replace("No hype words: seamless", "").replace(
                    "supercharge, empower", ""
                ).replace("AI-powered, elevate", "")
            for vendor in ("OpenAI", "Supabase", "Agents SDK", "15-day", "fifteen"):
                assert vendor not in text
