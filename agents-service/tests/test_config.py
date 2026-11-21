from pathlib import Path

import pytest

from lunarsprints_agents.config import ROLES, ConfigError, load_settings
from tests.conftest import ENV


def test_each_role_reads_its_own_model_then_the_default() -> None:
    s = load_settings(ENV)
    assert s.model_for("smart_goal") == "test-pro-model"
    assert s.model_for("scheduling") == "test-flash-model"
    assert s.model_for("story_decomposer") == "test-default-model"
    assert s.model_for("intent_alignment") == "test-default-model"


def test_missing_model_names_the_setting_not_a_value() -> None:
    with pytest.raises(ConfigError, match="GEMINI_MODEL_DEFAULT"):
        load_settings({})


def test_timeout_defaults_to_45_seconds() -> None:
    assert load_settings({"GEMINI_MODEL_DEFAULT": "m"}).timeout_seconds == 45.0


def test_no_model_name_is_hardcoded_in_service_code() -> None:
    code = Path(__file__).resolve().parent.parent / "lunarsprints_agents"
    for file in code.rglob("*.py"):
        assert "gemini-" not in file.read_text(), file.name


def test_roles_match_the_contract_files() -> None:
    files = Path(__file__).resolve().parents[2] / "contracts" / "schemas"
    found = [p.name.removesuffix(".response.json") for p in files.glob("*.response.json")]
    assert sorted(ROLES) == sorted(found)
