"""Compilation of response schemas authored in the node's DOM editor."""

import json
import math
import re

from comfy_api.latest import IO, UI


SCHEMA_TYPES = {"object", "array", "string", "integer", "number", "boolean"}
SchemaBuilder = IO.Custom("GEMINI_SCHEMA_BUILDER")
ResponseSchema = IO.Custom("GEMINI_RESPONSE_SCHEMA")


def default_entry(kind="object"):
    return {
        "type": kind, "name": "", "required": True, "description": "",
        "fields": [], "item": None, "allowed_values": "any", "choices": "",
        "minimum_mode": "unbounded", "minimum": 0,
        "maximum_mode": "unbounded", "maximum": 0,
    }


def default_state():
    return {"version": 1, "root": "n0", "next_id": 1, "entries": {"n0": default_entry()}}




def parse_state(serialized):
    if not isinstance(serialized, str):
        raise ValueError("schema_state: expected a serialized builder state.")
    try:
        state = json.loads(serialized)
    except json.JSONDecodeError as error:
        raise ValueError("schema_state: invalid JSON; recreate an old prototype node.") from error
    if not isinstance(state, dict) or type(state.get("version")) is not int or state["version"] != 1:
        raise ValueError("schema_state.version: expected version 1; recreate an old prototype node.")
    entries = state.get("entries")
    root = state.get("root")
    if not isinstance(entries, dict) or not isinstance(root, str) or root not in entries:
        raise ValueError("schema_state.root: missing root entry.")
    next_id = state.get("next_id")
    if type(next_id) is not int or next_id < 1:
        raise ValueError("schema_state.next_id: invalid allocator.")
    for identifier, entry in entries.items():
        if re.fullmatch(r"n(?:0|[1-9][0-9]*)", identifier) is None or int(identifier[1:]) >= next_id:
            raise ValueError(f"entries.{identifier}: inconsistent allocator or invalid entry ID.")
        if not isinstance(entry, dict) or not isinstance(entry.get("type"), str) or entry["type"] not in SCHEMA_TYPES | {"disabled"}:
            raise ValueError(f"entries.{identifier}.type: invalid type.")
        for key in ("name", "description", "choices"):
            if not isinstance(entry.get(key), str):
                raise ValueError(f"entries.{identifier}.{key}: expected text.")
        if type(entry.get("required")) is not bool:
            raise ValueError(f"entries.{identifier}.required: expected a boolean.")
        for key, values in (("allowed_values", {"any", "listed"}), ("minimum_mode", {"unbounded", "set"}), ("maximum_mode", {"unbounded", "set"})):
            if not isinstance(entry.get(key), str) or entry[key] not in values:
                raise ValueError(f"entries.{identifier}.{key}: invalid mode.")
        if not isinstance(entry.get("fields"), list) or any(not isinstance(child, str) for child in entry["fields"]):
            raise ValueError(f"entries.{identifier}.fields: expected entry IDs.")
        if "item" not in entry or (entry["item"] is not None and not isinstance(entry["item"], str)):
            raise ValueError(f"entries.{identifier}.item: expected an entry ID.")
        if "minimum" not in entry or "maximum" not in entry:
            raise ValueError(f"entries.{identifier}: missing bound settings.")
    if entries[root]["type"] == "disabled":
        raise ValueError("root.type: root cannot be disabled.")
    seen = set()
    stack = [(root, "root")]
    while stack:
        identifier, path = stack.pop()
        if identifier not in entries:
            raise ValueError(f"{path}: missing entry {identifier}.")
        if identifier in seen:
            raise ValueError(f"{path}: cycle or shared child entry {identifier}.")
        seen.add(identifier)
        entry = entries[identifier]
        stack.extend((child, f"{path}.fields[{index}]") for index, child in enumerate(entry["fields"]))
        if entry["item"] is not None:
            stack.append((entry["item"], f"{path}.items"))
    if seen != set(entries):
        raise ValueError("schema_state.entries: disconnected entries.")
    return state


def compile_schema(serialized):
    state = parse_state(serialized)
    entries = state["entries"]
    result = {}
    stack = [(state["root"], "root", result)]
    while stack:
        identifier, path, target = stack.pop()
        entry = entries[identifier]
        kind = entry["type"]
        if kind == "disabled":
            raise ValueError(f"{path}.type: active definition cannot be disabled.")
        target["type"] = kind
        if entry["description"].strip():
            target["description"] = entry["description"]
        if kind == "object":
            properties = {}
            required = []
            target["properties"] = properties
            for index, child_id in enumerate(entry["fields"]):
                child = entries[child_id]
                if child["type"] == "disabled":
                    continue
                child_path = f"{path}.fields[{index}]"
                name = child["name"].strip()
                if not name:
                    raise ValueError(f"{child_path}.name: field name must not be blank.")
                if name in properties:
                    raise ValueError(f"{child_path}.name: duplicate field name {name!r}.")
                properties[name] = {}
                if child["required"]:
                    required.append(name)
                stack.append((child_id, f"{child_path} ({name})", properties[name]))
            if required:
                target["required"] = required
        elif kind == "array":
            if entry["item"] is None:
                raise ValueError(f"{path}.items: array needs an item definition.")
            target["items"] = {}
            stack.append((entry["item"], f"{path}.items", target["items"]))
        elif kind == "string" and entry["allowed_values"] == "listed":
            choices = [line.strip() for line in entry["choices"].splitlines() if line.strip()]
            if not choices or len(set(choices)) != len(choices):
                raise ValueError(f"{path}.choices: enter nonempty, distinct allowed values.")
            target["enum"] = choices
        elif kind in ("integer", "number"):
            for bound in ("minimum", "maximum"):
                if entry[f"{bound}_mode"] != "set":
                    continue
                value = entry[bound]
                if type(value) not in (int, float) or not math.isfinite(value):
                    raise ValueError(f"{path}.{bound}: bound must be a finite number.")
                if kind == "integer" and value != int(value):
                    raise ValueError(f"{path}.{bound}: integer bound must be a whole number.")
                target[bound] = int(value) if kind == "integer" else value
            if "minimum" in target and "maximum" in target and target["minimum"] > target["maximum"]:
                raise ValueError(f"{path}.minimum: minimum must not exceed maximum.")
    return result


class SSL_GeminiResponseSchema(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="SSL_GeminiResponseSchema",
            display_name="Configure Gemini Response Schema",
            category="API/Gemini",
            description="Choose what the AI should put in its answer. Use Add a field to give each part a name and instructions. A group holds fields; a list holds several items. This node prepares the answer format without calling the AI.",
            inputs=[SchemaBuilder.Input("schema_state", extra_dict={
                "socketless": True, "default": json.dumps(default_state()), "state_version": 1,
            })],
            outputs=[ResponseSchema.Output("schema"), IO.String.Output("schema_json")],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, schema_state: str):
        schema = compile_schema(schema_state)
        text = json.dumps(schema, ensure_ascii=False, indent=2, allow_nan=False)
        return IO.NodeOutput(schema, text, ui=UI.PreviewText(text))
