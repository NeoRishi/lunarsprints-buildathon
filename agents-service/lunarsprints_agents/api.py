"""HTTP API for the LunarSprints agent service.

POST /v1/roles/{role}  takes the role's request schema, returns
                       { result, usage: { model, input_tokens, output_tokens, latency_ms } }.
GET  /healthz          liveness only, no secrets or configuration.

Errors return { "error": { "code": ... } } with no internal detail.
"""

from __future__ import annotations

import hmac
import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .agents import build_all
from .config import ROLES, Settings, load_settings
from .runner import AgentError, AgentRunner
from .schemas import dump, request_model

log = logging.getLogger("lunarsprints_agents")


def quiet_vendor_logs() -> None:
    """ADK and google-genai log tracebacks that can quote model answers, which
    may echo user text. The service writes its own metadata-only lines instead."""
    for name in ("google_adk", "google_genai", "google.adk", "google.genai"):
        logging.getLogger(name).setLevel(logging.CRITICAL + 1)


def error(code: str, status: int) -> JSONResponse:
    return JSONResponse({"error": {"code": code}}, status_code=status)


# --- Caller check -----------------------------------------------------------
# Local and Step 2A: a shared token in X-Service-Token, compared in constant
# time. Step 2B replaces this one dependency with Cloud Run IAM (only the web
# app's service account may invoke the service), so nothing else changes.

ServiceCheck = Callable[[Request], Awaitable[None]]


def token_check(settings: Settings) -> ServiceCheck:
    expected = (settings.service_token or "").encode()

    async def check(request: Request) -> None:
        given = request.headers.get("x-service-token", "").encode()
        # An unset token refuses every call rather than allowing them.
        if not expected or not hmac.compare_digest(given, expected):
            raise AgentError("unauthorized", 401)

    return check


def create_app(
    settings: Settings | None = None,
    runner: AgentRunner | None = None,
    service_check: ServiceCheck | None = None,
) -> FastAPI:
    quiet_vendor_logs()
    settings = settings or load_settings()
    state: dict[str, Any] = {"runner": runner}
    check = service_check or token_check(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if state["runner"] is None:
            state["runner"] = AgentRunner(settings, build_all(settings))
        if not settings.service_token and service_check is None:
            log.warning("AGENTS_SERVICE_TOKEN is not set. Every /v1 call will be refused.")
        yield

    app = FastAPI(
        title="LunarSprints agents",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.exception_handler(AgentError)
    async def agent_error(_request: Request, exc: AgentError) -> JSONResponse:
        return error(exc.code, exc.status)

    async def caller(request: Request) -> None:
        await check(request)

    @app.get("/healthz")
    async def healthz() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/v1/roles/{role}", dependencies=[Depends(caller)])
    async def run_role(role: str, request: Request) -> JSONResponse:
        if role not in ROLES:
            return error("invalid_request", 404)
        try:
            body = json.loads(await request.body())
        except ValueError:
            return error("invalid_request", 422)
        task = body.get("task") if isinstance(body, dict) else None
        active: AgentRunner = state["runner"]
        if not isinstance(task, str) or not active.has(role, task):
            return error("invalid_request", 422)
        try:
            parsed = request_model(settings.contracts_dir, role, task).model_validate(body)
        except ValidationError:
            return error("invalid_request", 422)
        data = dump(parsed)
        result, usage = await active.run(role, task, data["input"], data["requestId"])
        return JSONResponse({"result": result, "usage": usage.as_dict()})

    return app
