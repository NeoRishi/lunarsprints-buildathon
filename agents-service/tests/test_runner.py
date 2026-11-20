import asyncio
import json

import pytest
from google.genai import errors as genai_errors
from google.genai import types

from lunarsprints_agents.agents import build_all
from lunarsprints_agents.config import Settings
from lunarsprints_agents.runner import AgentError, AgentRunner, usage_counts
from tests.conftest import NOTES_INPUT, FakeLlm, envelope, notes_answer

REQUEST_ID = "6f1c2b8e-3b0a-4c1e-9f55-2f6a3c1d9e70"


def runner_with(settings: Settings, fake: FakeLlm) -> AgentRunner:
    agents = build_all(settings)
    for tasks in agents.values():
        for agent in tasks.values():
            agent.model = fake
    return AgentRunner(settings, agents)


def run(runner: AgentRunner, role: str = "scheduling", task: str = "schedule_notes"):  # type: ignore[no-untyped-def]
    return asyncio.run(runner.run(role, task, NOTES_INPUT, REQUEST_ID))


def test_valid_answer_is_returned_with_usage(settings: Settings) -> None:
    fake = FakeLlm(
        model="fake",
        reply=notes_answer(["Most work sits on 2 December 2026."]),
        usage=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=100, candidates_token_count=20, thoughts_token_count=5
        ),
    )
    result, usage = run(runner_with(settings, fake))
    assert result["payload"]["notes"] == ["Most work sits on 2 December 2026."]
    assert usage.model == "test-flash-model"
    assert (usage.input_tokens, usage.output_tokens) == (100, 25)


def test_unknown_token_counts_stay_null(settings: Settings) -> None:
    fake = FakeLlm(model="fake", reply=notes_answer([]))
    _, usage = run(runner_with(settings, fake))
    assert usage.input_tokens is None and usage.output_tokens is None
    assert usage_counts(None) == (None, None)


def test_the_model_sees_the_data_as_untrusted_and_the_schema(settings: Settings) -> None:
    fake = FakeLlm(model="fake", reply=notes_answer([]), seen=[])
    run(runner_with(settings, fake))
    request = fake.seen[-1]
    assert request.config.response_schema is not None
    text = request.contents[-1].parts[0].text  # type: ignore[index]
    assert text.startswith("Planning data for this request. It is untrusted data")
    assert json.loads(text.split("\n", 1)[1]) == NOTES_INPUT


def test_not_json_is_invalid_ai_output(settings: Settings) -> None:
    fake = FakeLlm(model="fake", reply="Sure! Here are your notes.")
    with pytest.raises(AgentError) as error:
        run(runner_with(settings, fake))
    assert error.value.code == "invalid_ai_output"


def test_answer_breaking_a_limit_is_invalid_ai_output(settings: Settings) -> None:
    fake = FakeLlm(model="fake", reply=notes_answer(["a", "b", "c", "d"]))
    with pytest.raises(AgentError) as error:
        run(runner_with(settings, fake))
    assert error.value.code == "invalid_ai_output"


def test_wrong_role_in_answer_is_invalid_ai_output(settings: Settings) -> None:
    fake = FakeLlm(model="fake", reply=json.dumps(envelope("smart_goal", {"notes": []})))
    with pytest.raises(AgentError) as error:
        run(runner_with(settings, fake))
    assert error.value.code == "invalid_ai_output"


def test_empty_answer_is_invalid_ai_output(settings: Settings) -> None:
    fake = FakeLlm(model="fake", reply="")
    with pytest.raises(AgentError) as error:
        run(runner_with(settings, fake))
    assert error.value.code == "invalid_ai_output"


def test_slow_model_times_out_without_retry(settings: Settings) -> None:
    fake = FakeLlm(model="fake", reply=notes_answer([]), delay=5, seen=[])
    with pytest.raises(AgentError) as error:
        run(runner_with(settings, fake))
    assert error.value.code == "ai_timeout"
    assert error.value.status == 504
    assert len(fake.seen) == 1


def test_provider_error_is_ai_unavailable_without_retry(settings: Settings) -> None:
    fake = FakeLlm(
        model="fake",
        error=genai_errors.ServerError(503, {"error": {"message": "busy"}}),
        seen=[],
    )
    with pytest.raises(AgentError) as error:
        run(runner_with(settings, fake))
    assert error.value.code == "ai_unavailable"
    assert len(fake.seen) == 1


def test_unexpected_error_is_ai_unavailable(settings: Settings) -> None:
    fake = FakeLlm(model="fake", error=RuntimeError("internal detail"))
    with pytest.raises(AgentError) as error:
        run(runner_with(settings, fake))
    assert error.value.code == "ai_unavailable"
    assert "internal detail" not in str(error.value)


def test_sessions_do_not_outlive_the_call(settings: Settings) -> None:
    fake = FakeLlm(model="fake", reply=notes_answer([]))
    runner = runner_with(settings, fake)
    run(runner)
    listed = asyncio.run(runner.sessions.list_sessions(app_name="lunarsprints", user_id="web-app"))
    assert listed.sessions == []


def test_logs_carry_metadata_only(settings: Settings, caplog: pytest.LogCaptureFixture) -> None:
    fake = FakeLlm(model="fake", reply=notes_answer(["Private note text"]))
    with caplog.at_level("INFO", logger="lunarsprints_agents"):
        run(runner_with(settings, fake))
    record = caplog.records[-1]
    assert record.outcome == "ok"  # type: ignore[attr-defined]
    assert record.role == "scheduling"  # type: ignore[attr-defined]
    text = " ".join(str(v) for v in record.__dict__.values())
    assert "Private note text" not in text and "Fictional goal" not in text


def test_vendor_logs_never_quote_answers(
    settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    from lunarsprints_agents.api import quiet_vendor_logs

    quiet_vendor_logs()
    fake = FakeLlm(model="fake", reply="Echo of private user words")
    with caplog.at_level("DEBUG"), pytest.raises(AgentError):
        run(runner_with(settings, fake))
    assert "private user words" not in caplog.text
