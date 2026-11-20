import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from lunarsprints_agents.config import DEFAULT_CONTRACTS_DIR as D
from lunarsprints_agents.schemas import (
    SchemaError,
    build_model,
    dump,
    generation_model,
    output_model,
    request_model,
    tasks_for,
)
from tests.conftest import NOTES_INPUT, envelope

EXPECTED = {
    "intent_alignment": ["assess"],
    "smart_goal": ["clarify", "goals", "readiness"],
    "story_decomposer": ["stories"],
    "scheduling": ["schedule_notes"],
}


def test_tasks_come_from_the_committed_files() -> None:
    for role, tasks in EXPECTED.items():
        assert tasks_for(D, role) == tasks


def test_every_task_builds_request_answer_and_generation_models() -> None:
    for role, tasks in EXPECTED.items():
        for task in tasks:
            assert request_model(D, role, task)
            assert output_model(D, role, task)
            assert generation_model(D, role, task)


def _keys(schema: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(schema, dict):
        for k, v in schema.items():
            found.add(k)
            found |= _keys(v)
    elif isinstance(schema, list):
        for v in schema:
            found |= _keys(v)
    return found


def test_generation_schema_keeps_shape_but_drops_limits() -> None:
    schema = generation_model(D, "story_decomposer", "stories").model_json_schema()
    keys = _keys(schema)
    for limit in ("maxLength", "minLength", "maximum", "minimum", "maxItems", "pattern"):
        assert limit not in keys
    text = json.dumps(schema)
    assert '"definitionOfDone"' in text and '"coveredCriteria"' in text


def test_answer_model_enforces_the_contract_limits() -> None:
    model = output_model(D, "story_decomposer", "stories")
    step = {
        "id": "m1-s1",
        "title": "Draft",
        "motivation": "Why",
        "minutes": 120,
        "definitionOfDone": "Done",
        "subtasks": [],
    }
    story = {
        "id": "m1",
        "goalId": "g1",
        "title": "Milestone",
        "description": "Why",
        "definitionOfDone": ["Done"],
        "priority": 1,
        "dependencyIds": [],
        "coveredCriteria": [0],
        "tasks": [step],
    }
    answer = envelope(
        "story_decomposer", {"stories": [story], "uncoveredCriteria": [], "warnings": []}
    )
    with pytest.raises(ValidationError):
        model.model_validate(answer)
    step["minutes"] = 60
    assert dump(model.model_validate(answer))["payload"]["stories"][0]["tasks"][0]["minutes"] == 60


def test_wrong_role_or_version_is_rejected() -> None:
    model = output_model(D, "scheduling", "schedule_notes")
    with pytest.raises(ValidationError):
        model.model_validate(envelope("smart_goal", {"notes": []}))
    bad = envelope("scheduling", {"notes": []})
    bad["schemaVersion"] = "1.0"
    with pytest.raises(ValidationError):
        model.model_validate(bad)


def test_dump_keeps_original_keys_and_explicit_nulls() -> None:
    model = output_model(D, "scheduling", "schedule_notes")
    out = dump(model.model_validate(envelope("scheduling", {"notes": ["One note."]})))
    assert out == envelope("scheduling", {"notes": ["One note."]})


def test_unknown_keys_are_dropped_like_zod() -> None:
    model = output_model(D, "scheduling", "schedule_notes")
    raw = envelope("scheduling", {"notes": [], "extra": 1})
    raw["unexpected"] = True
    out = dump(model.model_validate(raw))
    assert "unexpected" not in out and "extra" not in out["payload"]


def test_request_rejects_identity_fields_by_dropping_them() -> None:
    model = request_model(D, "scheduling", "schedule_notes")
    body = {
        "requestId": "6f1c2b8e-3b0a-4c1e-9f55-2f6a3c1d9e70",
        "task": "schedule_notes",
        "input": {**NOTES_INPUT, "email": "someone@example.com"},
    }
    assert "email" not in dump(model.model_validate(body))["input"]


def test_request_needs_a_uuid_request_id() -> None:
    model = request_model(D, "scheduling", "schedule_notes")
    with pytest.raises(ValidationError):
        model.model_validate({"requestId": "1", "task": "schedule_notes", "input": NOTES_INPUT})


def test_unsupported_schema_features_fail_loudly() -> None:
    with pytest.raises(SchemaError):
        build_model({}, {"type": "object", "properties": {"x": {"oneOf": []}}}, "bad")


def test_schema_files_are_generated_not_hand_edited() -> None:
    for file in Path(D).glob("*.json"):
        assert "npm run contracts:build" in json.loads(file.read_text())["description"]
