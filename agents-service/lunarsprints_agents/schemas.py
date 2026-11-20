"""Pydantic models built from the committed JSON Schema files.

The files in contracts/schemas/ are generated from the zod contract in the
web app (npm run contracts:build). Building the Python models from those same
files means the two languages cannot drift apart.

Only the JSON Schema features zod emits for this contract are supported. An
unknown feature raises at start-up instead of being silently ignored.
"""

from __future__ import annotations

import json
import re
from functools import cache
from pathlib import Path
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, create_model

_SUPPORTED_KEYS = {
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "enum",
    "const",
    "anyOf",
    "$ref",
    "description",
    "title",
    "default",
}


class SchemaError(RuntimeError):
    pass


def _model_name(path: str) -> str:
    parts = re.split(r"[^A-Za-z0-9]+", path)
    return "".join(p[:1].upper() + p[1:] for p in parts if p) or "Model"


class _Builder:
    def __init__(self, root: dict[str, Any], name: str, strict: bool = True) -> None:
        self.root = root
        self.name = name
        # strict=False keeps the structure but drops length, size and pattern
        # limits. Gemini rejects schemas with that many limits as too complex,
        # so the model generates against the loose form and the service then
        # checks the answer against the strict form.
        self.strict = strict

    def resolve(self, node: dict[str, Any]) -> dict[str, Any]:
        ref = node.get("$ref")
        if not ref:
            return node
        if not ref.startswith("#/$defs/"):
            raise SchemaError(f"Unsupported $ref {ref} in {self.name}")
        target: dict[str, Any] = self.root["$defs"][ref.removeprefix("#/$defs/")]
        return target

    def build(self, node: dict[str, Any], path: str) -> Any:
        node = self.resolve(node)
        unknown = set(node) - _SUPPORTED_KEYS
        if unknown:
            raise SchemaError(f"Unsupported schema keys {sorted(unknown)} at {path}")
        if "anyOf" in node:
            options = [self.build(o, f"{path}_{i}") for i, o in enumerate(node["anyOf"])]
            return Union[tuple(options)]  # noqa: UP007
        if "const" in node:
            return Literal[node["const"]]
        if "enum" in node:
            return Literal[tuple(node["enum"])]
        kind = node.get("type")
        if isinstance(kind, list):
            options = [self.build({**node, "type": k}, f"{path}_{k}") for k in kind]
            return Union[tuple(options)]  # noqa: UP007
        if kind == "null":
            return type(None)
        if kind == "boolean":
            return bool
        if kind == "string" and not self.strict:
            return str
        if kind == "string":
            return Annotated[
                str,
                StringConstraints(
                    min_length=node.get("minLength"),
                    max_length=node.get("maxLength"),
                    pattern=node.get("pattern"),
                ),
            ]
        if kind in ("integer", "number"):
            base: type = int if kind == "integer" else float
            if not self.strict:
                return base
            return Annotated[
                base,
                Field(
                    ge=node.get("minimum"),
                    le=node.get("maximum"),
                    gt=node.get("exclusiveMinimum"),
                    lt=node.get("exclusiveMaximum"),
                ),
            ]
        if kind == "array":
            item = self.build(node.get("items", {}), f"{path}_item")
            if not self.strict:
                return list[item]  # type: ignore[valid-type]
            return Annotated[
                list[item],  # type: ignore[valid-type]
                Field(min_length=node.get("minItems"), max_length=node.get("maxItems")),
            ]
        if kind == "object":
            return self.object(node, path)
        raise SchemaError(f"Unsupported schema type {kind!r} at {path}")

    def object(self, node: dict[str, Any], path: str) -> type[BaseModel]:
        props: dict[str, Any] = node.get("properties", {})
        required = set(node.get("required", []))
        fields: dict[str, Any] = {}
        for i, (key, sub) in enumerate(props.items()):
            annotation = self.build(sub, f"{path}_{key}")
            # Field names are positional so JSON keys never clash with
            # pydantic's own attributes; the JSON key is the alias.
            if key in required:
                fields[f"f{i}"] = (annotation, Field(alias=key))
            else:
                fields[f"f{i}"] = (annotation | None, Field(default=None, alias=key))
        # Unknown keys are dropped, never kept, exactly as zod objects strip
        # them. Gemini's response schema does not accept additionalProperties.
        config = ConfigDict(extra="ignore", populate_by_name=False, serialize_by_alias=True)
        model: type[BaseModel] = create_model(_model_name(path), __config__=config, **fields)
        return model


def build_model(
    root: dict[str, Any], node: dict[str, Any], name: str, strict: bool = True
) -> type[BaseModel]:
    built = _Builder(root, name, strict).build(node, name)
    if not (isinstance(built, type) and issubclass(built, BaseModel)):
        raise SchemaError(f"{name} must be a JSON object schema")
    return built


@cache
def _load(path: Path) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(path.read_text())
    return data


def load_file(contracts_dir: Path, name: str) -> dict[str, Any]:
    path = contracts_dir / name
    if not path.exists():
        raise SchemaError(f"Missing contract file {name}. Run npm run contracts:build.")
    return _load(path)


def tasks_for(contracts_dir: Path, role: str) -> list[str]:
    return list(load_file(contracts_dir, f"{role}.response.json")["$defs"].keys())


@cache
def output_model(contracts_dir: Path, role: str, task: str) -> type[BaseModel]:
    """The answer the model must give for one task, with every limit checked."""
    root = load_file(contracts_dir, f"{role}.response.json")
    return build_model(root, root["$defs"][task], f"{role}_{task}_answer")


@cache
def generation_model(contracts_dir: Path, role: str, task: str) -> type[BaseModel]:
    """The same answer shape without size limits, sent to Gemini as the response schema."""
    root = load_file(contracts_dir, f"{role}.response.json")
    return build_model(root, root["$defs"][task], f"{role}_{task}_shape", strict=False)


@cache
def request_model(contracts_dir: Path, role: str, task: str) -> type[BaseModel]:
    root = load_file(contracts_dir, f"{role}.request.json")
    return build_model(root, root["$defs"][task], f"{role}_{task}_request")


def dump(model: BaseModel) -> dict[str, Any]:
    """JSON-ready dict with the original keys, keeping explicit nulls."""
    data: dict[str, Any] = model.model_dump(mode="json", by_alias=True)
    return data
