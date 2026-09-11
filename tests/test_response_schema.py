import asyncio
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from aiohttp import web
from middleware.cache_middleware import cache_control

from custom_nodes.ComfyUI_Gemini_Expanded_API import GeminiExtension
from custom_nodes.ComfyUI_Gemini_Expanded_API.response_schema import (
    SSL_GeminiResponseSchema, compile_schema, default_entry, default_state, parse_state,
)


def add(state, parent, kind, name="", item=False):
    identifier = f"n{state['next_id']}"
    state["next_id"] += 1
    entry = default_entry(kind)
    entry["name"] = name
    state["entries"][identifier] = entry
    if item:
        state["entries"][parent]["item"] = identifier
    else:
        state["entries"][parent]["fields"].append(identifier)
    return identifier


def compile_state(state):
    output = SSL_GeminiResponseSchema.execute(json.dumps(state))
    assert output[0] == json.loads(output[1])
    assert output.ui.as_dict() == {"text": (output[1],)}
    return output[0]


def test_registration_and_dom_state_input():
    assert SSL_GeminiResponseSchema in asyncio.run(GeminiExtension().get_node_list())
    definition = SSL_GeminiResponseSchema.INPUT_TYPES()
    assert list(definition["required"]) == ["schema_state"]
    kind, metadata = definition["required"]["schema_state"]
    assert kind == "GEMINI_SCHEMA_BUILDER"
    assert metadata["socketless"] is True
    assert metadata["state_version"] == 1
    assert "templates" not in metadata
    assert len(json.dumps(definition)) < 2000
    assert compile_state(default_state()) == {"type": "object", "properties": {}}


def test_named_fields_order_and_required():
    state = default_state()
    add(state, "n0", "string", " title ")
    second = add(state, "n0", "number", "score")
    state["entries"][second]["required"] = False
    assert compile_state(state) == {
        "type": "object", "properties": {"title": {"type": "string"}, "score": {"type": "number"}}, "required": ["title"],
    }


@pytest.mark.parametrize("count", [1, 9, 20])
def test_field_counts(count):
    state = default_state()
    for index in range(count):
        add(state, "n0", "boolean", f"field_{index}")
    result = compile_state(state)
    assert list(result["properties"]) == [f"field_{index}" for index in range(count)]
    assert all(schema == {"type": "boolean"} for schema in result["properties"].values())


@pytest.mark.parametrize("kinds", [["object", "object"], ["object", "array", "object"], ["array", "array"], ["object", "array"] * 4])
def test_nested_containers(kinds):
    state = default_state()
    state["entries"]["n0"]["type"] = kinds[0]
    current = "n0"
    expected = {"type": "string"}
    for kind in reversed(kinds):
        expected = {"type": "array", "items": expected} if kind == "array" else {
            "type": "object", "properties": {"child": expected}, "required": ["child"],
        }
    for kind in kinds[1:] + ["string"]:
        current = add(state, current, kind, "child", item=state["entries"][current]["type"] == "array")
    assert compile_state(state) == expected


def test_disabled_and_inactive_state():
    state = default_state()
    field = add(state, "n0", "disabled")
    child = add(state, field, "number")
    state["entries"][child].update(minimum_mode="set", minimum="invalid")
    assert compile_state(state) == {"type": "object", "properties": {}}
    state["entries"][field].update(type="string", name="visible", choices="duplicate\nduplicate")
    assert compile_state(state)["properties"] == {"visible": {"type": "string"}}


def test_unicode_names_and_description():
    state = default_state()
    state["entries"]["n0"]["description"] = "  "
    field = add(state, "n0", "string", "猫.[]")
    state["entries"][field]["description"] = " Résumé\n続き "
    result = compile_state(state)
    assert "description" not in result
    assert result["properties"]["猫.[]"]["description"] == " Résumé\n続き "


@pytest.mark.parametrize("kind", ["string", "integer", "number", "boolean"])
def test_root_types_and_constraints(kind):
    state = default_state()
    root = state["entries"]["n0"]
    root["type"] = kind
    expected = {"type": kind}
    if kind == "string":
        root.update(allowed_values="listed", choices=" positive\n\nnegative ")
        expected["enum"] = ["positive", "negative"]
    elif kind in ("integer", "number"):
        root.update(minimum_mode="set", minimum=-2, maximum_mode="set", maximum=0)
        expected.update(minimum=-2, maximum=0)
    assert compile_state(state) == expected


@pytest.mark.parametrize("changes, path", [
    ({"type": "string", "allowed_values": "listed", "choices": ""}, "choices"),
    ({"type": "string", "allowed_values": "listed", "choices": "a\na"}, "choices"),
    ({"type": "number", "minimum_mode": "set", "minimum": True}, "minimum"),
    ({"type": "number", "minimum_mode": "set", "minimum": "1"}, "minimum"),
    ({"type": "number", "minimum_mode": "set", "minimum": float("inf")}, "minimum"),
    ({"type": "number", "maximum_mode": "set", "maximum": float("nan")}, "maximum"),
    ({"type": "integer", "minimum_mode": "set", "minimum": 0.5}, "minimum"),
    ({"type": "number", "minimum_mode": "set", "minimum": 2, "maximum_mode": "set", "maximum": 1}, "minimum"),
    ({"type": "array"}, "items"),
])
def test_invalid_active_settings(changes, path):
    state = default_state()
    state["entries"]["n0"].update(changes)
    with pytest.raises(ValueError, match=path):
        compile_state(state)


def test_name_errors_and_disabled_item():
    state = default_state()
    first = add(state, "n0", "string")
    with pytest.raises(ValueError, match="name"):
        compile_state(state)
    state["entries"][first]["name"] = "same"
    add(state, "n0", "number", "same")
    with pytest.raises(ValueError, match="duplicate"):
        compile_state(state)
    state = default_state()
    state["entries"]["n0"]["type"] = "array"
    add(state, "n0", "disabled", item=True)
    with pytest.raises(ValueError, match="disabled"):
        compile_state(state)


@pytest.mark.parametrize("damage", ["root", "version", "cycle", "shared", "missing", "allocator", "orphan", "type", "mode"])
def test_invalid_structure(damage):
    state = default_state()
    field = add(state, "n0", "string", "name")
    if damage == "root": state["root"] = "n99"
    elif damage == "version": state["version"] = 2
    elif damage == "cycle": state["entries"][field]["fields"] = ["n0"]
    elif damage == "shared": state["entries"]["n0"]["fields"].append(field)
    elif damage == "missing": state["entries"]["n0"]["fields"].append("n99")
    elif damage == "allocator": state["next_id"] = 1
    elif damage == "orphan": state["entries"]["n0"]["fields"] = []
    elif damage == "type": state["entries"][field]["type"] = "invalid"
    elif damage == "mode": state["entries"][field]["allowed_values"] = "invalid"
    with pytest.raises(ValueError): parse_state(json.dumps(state))


def test_old_prototype_state_is_not_silently_replaced():
    for value in ["object", "{", '{"type":"object"}', "[]"]:
        with pytest.raises(ValueError): compile_schema(value)


@pytest.mark.parametrize("key, value", [("type", []), ("minimum_mode", []), ("item", 3), ("required", 1)])
def test_malformed_setting_shapes_report_validation_errors(key, value):
    state = default_state()
    state["entries"]["n0"][key] = value
    with pytest.raises(ValueError):
        compile_state(state)


@pytest.mark.parametrize("bound, value", [("minimum", 0), ("maximum", -1)])
def test_independent_numeric_bounds(bound, value):
    state = default_state()
    root = state["entries"]["n0"]
    root.update(type="number", **{f"{bound}_mode": "set", bound: value})
    assert compile_state(state) == {"type": "number", bound: value}


def test_browser_state_compiles_through_node():
    module = (Path(__file__).resolve().parents[1] / "web" / "response_schema_model.js").as_uri()
    script = f"""import {{ createState, addField, updateSetting, serializeState }} from {json.dumps(module)};
const state = createState();
const id = addField(state, state.root, 'string');
updateSetting(state, id, 'name', 'from_widgets');
console.log(serializeState(state));"""
    result = subprocess.run(["node", "--input-type=module"], input=script, check=True, text=True, capture_output=True)
    assert SSL_GeminiResponseSchema.execute(result.stdout)[0] == {
        "type": "object", "properties": {"from_widgets": {"type": "string"}}, "required": ["from_widgets"],
    }


def test_browser_modules_receive_comfy_no_store_headers():
    directory = Path(__file__).resolve().parents[1] / "web"
    assert not list(directory.glob("*.mjs"))

    async def check():
        async def handler(_request):
            return web.Response(text="module")
        for module in directory.glob("*.js"):
            request = SimpleNamespace(path=f"/extensions/ComfyUI_Gemini_Expanded_API/{module.name}")
            response = await cache_control(request, handler)
            assert response.headers["Cache-Control"] == "no-store"
    asyncio.run(check())
