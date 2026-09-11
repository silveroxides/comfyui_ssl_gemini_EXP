import test from "node:test";
import assert from "node:assert/strict";
import { createState, addField, removeField, selectType, updateSetting, serializeState, restoreState, visibleChildren } from "../web/response_schema_model.js";

test("default has no stored placeholder and nodes never share state", () => {
  const a = createState(), b = createState();
  addField(a, a.root, "string");
  assert.deepEqual(b.entries.n0.fields, []);
  assert.equal(Object.keys(a.entries).length, 2);
});

test("20 fields keep creation order and independent IDs through rename", () => {
  const state = createState();
  const ids = Array.from({ length: 20 }, () => addField(state, state.root, "string"));
  updateSetting(state, ids[0], "name", "猫.[]");
  assert.deepEqual(ids, Array.from({ length: 20 }, (_, i) => `n${i + 1}`));
  assert.deepEqual(visibleChildren(state, state.root), ids);
  assert.deepEqual(restoreState(serializeState(state)), state);
});

test("type changes retain object children, items, choices and bounds", () => {
  const state = createState();
  const id = addField(state, state.root, "object");
  const child = addField(state, id, "string");
  updateSetting(state, id, "choices", "a\nb");
  updateSetting(state, id, "minimum", -1);
  selectType(state, id, "array", "field");
  const item = state.entries[id].item;
  selectType(state, id, "disabled", "field");
  assert.deepEqual(visibleChildren(state, id), []);
  selectType(state, id, "object", "field");
  assert.deepEqual(visibleChildren(state, id), [child]);
  selectType(state, id, "array", "field");
  assert.equal(state.entries[id].item, item);
  assert.equal(state.entries[id].choices, "a\nb");
  assert.equal(state.entries[id].minimum, -1);
  const clone = restoreState(serializeState(state));
  updateSetting(clone, id, "name", "independent");
  assert.equal(state.entries[id].name, "");
});

test("arrays can nest beyond three containers without preallocating future children", () => {
  const state = createState();
  selectType(state, state.root, "array", "root");
  let id = state.entries[state.root].item;
  for (let i = 0; i < 8; i++) {
    selectType(state, id, "array", "item");
    id = state.entries[id].item;
  }
  assert.equal(Object.keys(state.entries).length, 10);
  assert.equal(state.entries[id].type, "string");
  assert.deepEqual(restoreState(serializeState(state)), state);
});

for (const damage of ["version", "cycle", "shared", "orphan", "missing", "allocator", "type", "mode", "disabled_root", "disabled_item"]) {
  test(`restore rejects ${damage}`, () => {
    const state = createState();
    const field = addField(state, state.root, "string");
    if (damage === "version") state.version = 2;
    if (damage === "cycle") state.entries[field].fields.push(state.root);
    if (damage === "shared") state.entries.n0.fields.push(field);
    if (damage === "orphan") state.entries.n0.fields = [];
    if (damage === "missing") state.entries.n0.fields.push("n99");
    if (damage === "allocator") state.next_id = 1;
    if (damage === "type") state.entries[field].type = "invalid";
    if (damage === "mode") state.entries[field].allowed_values = "invalid";
    if (damage === "disabled_root") state.entries.n0.type = "disabled";
    if (damage === "disabled_item") {
      selectType(state, state.root, "array", "root");
      state.entries[state.entries.n0.item].type = "disabled";
    }
    assert.throws(() => restoreState(JSON.stringify(state)));
  });
}

test("old prototype data and nonfinite serialized numbers fail explicitly", () => {
  for (const value of ["object", "{", "[]", '{"type":"object"}']) assert.throws(() => restoreState(value));
  const state = createState();
  state.entries.n0.minimum = Infinity;
  assert.throws(() => serializeState(state), /finite/);
  assert.throws(() => selectType(createState(), "n0", "disabled", "root"));
});

test("removal deletes disabled fields and retained subtrees without touching siblings or reusing IDs", () => {
  const state = createState();
  const first = addField(state, "n0", "string");
  const group = addField(state, "n0", "object");
  addField(state, group, "array");
  selectType(state, group, "array", "field");
  selectType(state, group, "disabled", "field");
  const last = addField(state, "n0", "number");
  const next = state.next_id;
  assert.equal(removeField(state, group), "n0");
  assert.deepEqual(Object.keys(state.entries), ["n0", first, last]);
  assert.deepEqual(state.entries.n0.fields, [first, last]);
  assert.deepEqual(restoreState(serializeState(state)), state);
  assert.equal(addField(state, "n0", "boolean"), `n${next}`);
  assert.throws(() => removeField(state, "n0"));
});
