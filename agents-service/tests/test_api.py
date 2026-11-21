from typing import Any

import pytest
from fastapi.testclient import TestClient

from lunarsprints_agents.api import create_app
from lunarsprints_agents.config import Settings
from lunarsprints_agents.runner import AgentError, Usage
from tests.conftest import NOTES_INPUT, envelope

TOKEN = {"x-service-token": "test-token-not-a-secret"}
BODY = {
    "requestId": "6f1c2b8e-3b0a-4c1e-9f55-2f6a3c1d9e70",
    "task": "schedule_notes",
    "input": NOTES_INPUT,
}


class FakeRunner:
    def __init__(self, error: AgentError | None = None) -> None:
        self.error = error
        self.calls: list[tuple[str, str, dict[str, Any], str]] = []

    def has(self, role: str, task: str) -> bool:
        return (role, task) == ("scheduling", "schedule_notes")

    async def run(
        self, role: str, task: str, data: dict[str, Any], request_id: str
    ) -> tuple[dict[str, Any], Usage]:
        self.calls.append((role, task, data, request_id))
        if self.error:
            raise self.error
        return envelope("scheduling", {"notes": []}), Usage("test-flash-model", None, None, 12)


def client(settings: Settings, runner: FakeRunner) -> TestClient:
    return TestClient(create_app(settings, runner))  # type: ignore[arg-type]


def test_health_needs_no_token(settings: Settings) -> None:
    with client(settings, FakeRunner()) as c:
        assert c.get("/healthz").json() == {"ok": True}


@pytest.mark.parametrize("headers", [{}, {"x-service-token": "wrong"}, {"x-service-token": ""}])
def test_calls_without_the_right_token_are_unauthorized(
    settings: Settings, headers: dict[str, str]
) -> None:
    runner = FakeRunner()
    with client(settings, runner) as c:
        r = c.post("/v1/roles/scheduling", json=BODY, headers=headers)
    assert r.status_code == 401
    assert r.json() == {"error": {"code": "unauthorized"}}
    assert runner.calls == []


def test_unset_service_token_refuses_everything(settings: Settings) -> None:
    unset = Settings(models=settings.models, service_token=None)
    with client(unset, FakeRunner()) as c:
        r = c.post("/v1/roles/scheduling", json=BODY, headers={"x-service-token": ""})
    assert r.status_code == 401


def test_success_returns_result_and_usage_with_null_tokens(settings: Settings) -> None:
    runner = FakeRunner()
    with client(settings, runner) as c:
        r = c.post("/v1/roles/scheduling", json=BODY, headers=TOKEN)
    assert r.status_code == 200
    assert r.json()["usage"] == {
        "model": "test-flash-model",
        "input_tokens": None,
        "output_tokens": None,
        "latency_ms": 12,
    }
    assert runner.calls[0][3] == BODY["requestId"]


@pytest.mark.parametrize(
    ("code", "status"),
    [("ai_timeout", 504), ("ai_unavailable", 503), ("invalid_ai_output", 502)],
)
def test_errors_return_only_a_code(settings: Settings, code: str, status: int) -> None:
    with client(settings, FakeRunner(AgentError(code, status))) as c:
        r = c.post("/v1/roles/scheduling", json=BODY, headers=TOKEN)
    assert r.status_code == status
    assert r.json() == {"error": {"code": code}}


def test_unknown_role_is_not_served(settings: Settings) -> None:
    with client(settings, FakeRunner()) as c:
        r = c.post("/v1/roles/reflection", json=BODY, headers=TOKEN)
    assert r.status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {**BODY, "task": "something_else"},
        {**BODY, "requestId": "not-a-uuid"},
        {**BODY, "input": {"startDate": "2026-12-01"}},
    ],
)
def test_bad_requests_are_invalid_request_without_detail(
    settings: Settings, body: dict[str, Any]
) -> None:
    runner = FakeRunner()
    with client(settings, runner) as c:
        r = c.post("/v1/roles/scheduling", json=body, headers=TOKEN)
    assert r.status_code == 422
    assert r.json() == {"error": {"code": "invalid_request"}}
    assert runner.calls == []


def test_not_json_is_invalid_request(settings: Settings) -> None:
    with client(settings, FakeRunner()) as c:
        r = c.post(
            "/v1/roles/scheduling",
            content=b"not json",
            headers={**TOKEN, "content-type": "application/json"},
        )
    assert r.status_code == 422


def test_no_api_docs_are_exposed(settings: Settings) -> None:
    with client(settings, FakeRunner()) as c:
        assert c.get("/docs").status_code == 404
        assert c.get("/openapi.json").status_code == 404
