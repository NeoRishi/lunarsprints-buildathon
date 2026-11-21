"""Start the agent service: uv run python -m lunarsprints_agents"""

from __future__ import annotations

import json
import logging
import os

import uvicorn

from .api import create_app

_FIELDS = (
    "role",
    "task",
    "model",
    "latency_ms",
    "input_tokens",
    "output_tokens",
    "outcome",
    "request_id",
    "error_type",
    "provider_status",
)


class MetadataFormatter(logging.Formatter):
    """One JSON line per event, with only the allowed metadata fields."""

    def format(self, record: logging.LogRecord) -> str:
        line = {"level": record.levelname, "message": record.getMessage()}
        line.update({k: getattr(record, k) for k in _FIELDS if hasattr(record, k)})
        return json.dumps(line)


def main() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(MetadataFormatter())
    logger = logging.getLogger("lunarsprints_agents")
    logger.handlers = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False
    uvicorn.run(
        create_app(),
        host=os.environ.get("AGENTS_HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8080")),
        # Access logs show paths only, never bodies. Keep them off anyway.
        access_log=False,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
