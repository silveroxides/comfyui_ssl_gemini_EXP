import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { SchemaController, editorNodeSize, registerResponseSchema } from "../web/response_schema_widgets.js";
import { createState, serializeState } from "../web/response_schema_model.js";
import { EDITOR_CSS } from "../web/response_schema_style.js";

function harness(t) {
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  const { window } = dom;
  const observers = [];
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; this.disconnected = false; observers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
  };
  const node = {
    widgets: [], size: [420, 220], nativeRemovals: 0,
    graph: { before: 0, after: 0, beforeChange() { this.before++; }, afterChange() { this.after++; } },
    addDOMWidget(name, type, element, options) {
      const widget = { name, type, element, options, onRemove: () => { this.nativeRemovals++; element.remove(); } };
      Object.defineProperty(widget, "value", {
        get: () => options.getValue(),
        set: value => { options.setValue(value); widget.callback?.(widget.value); },
      });
      this.widgets.push(widget);
      window.document.body.append(element);
      return widget;
    },
    computeSize() { return [320, 200]; },
    setSize(size) { this.size = size; this.widgets[0]?.options.afterResize(); },
  };
  const app = { canvas: { setDirty() {} } };
  const editor = new SchemaController(node, "schema_state", ["GEMINI_SCHEMA_BUILDER", { default: serializeState(createState()) }], app, window.document);
  const find = (id, key) => {
    const element = [...editor.shadow.querySelectorAll("[data-setting]")].find(el => el.dataset.entry === id && el.dataset.setting === key);
    assert.ok(element, `Missing ${id}.${key}`);
    return element;
  };
  const set = (id, key, value) => {
    const input = find(id, key);
    const structural = input.tagName === "SELECT" || input.type === "checkbox";
    if (input.type === "checkbox") input.checked = value;
    else input.value = value;
    input.dispatchEvent(new window.Event(structural ? "change" : "input", { bubbles: true, composed: true }));
  };
  t.after(() => { editor.carrier.onRemove(); dom.window.close(); });
  return { node, editor, find, set, window, observers, state: () => JSON.parse(editor.carrier.value) };
}

test("one DOM widget owns all controls and the serialized state", t => {
  const h = harness(t);
  assert.equal(h.node.widgets.length, 1);
  assert.equal(h.node.widgets[0].name, "schema_state");
  assert.equal(h.node.widgets[0].options.socketless, true);
  assert.equal(h.editor.shadow.querySelectorAll("section.entry").length, 1);
  assert.equal(h.find("n0", "add").value, "disabled");
  assert.deepEqual(h.state().entries.n0.fields, []);
  assert.equal(h.editor.element.style.boxSizing, "border-box");
  let calls = 0;
  const app = { registerExtension() { calls++; } };
  registerResponseSchema(app); registerResponseSchema(app);
  assert.equal(calls, 1);
});

test("fields and nested children live inside distinct parent borders", t => {
  const h = harness(t);
  h.set("n0", "add", "object");
  h.set("n1", "name", "Person");
  h.set("n1", "add", "string");
  h.set("n2", "name", "Name");
  h.set("n0", "add", "number");
  h.set("n3", "name", "Score");
  const person = h.editor.shadow.querySelector('section[data-entry="n1"]');
  const child = h.editor.shadow.querySelector('section[data-entry="n2"]');
  const sibling = h.editor.shadow.querySelector('section[data-entry="n3"]');
  assert.ok(person.querySelector(".children").contains(child));
  assert.ok(!person.contains(sibling));
  assert.ok(child.contains(h.find("n2", "description")));
  assert.ok(sibling.contains(h.find("n3", "minimum_mode")));
  assert.equal(person.getAttribute("aria-label"), "Person");
  assert.equal(h.find("n2", "required").closest("label").textContent, "Required");
  assert.match(h.find("n2", "required").title, /AI must include/);
});

test("20 fields grow without creating extra Comfy widgets", t => {
  const h = harness(t);
  for (let i = 1; i <= 20; i++) {
    h.set("n0", "add", "string");
    h.set(`n${i}`, "name", `field_${i}`);
  }
  assert.equal(h.state().entries.n0.fields.length, 20);
  assert.equal(h.editor.shadow.querySelectorAll('[data-setting="add"]').length, 1);
  assert.equal(h.node.widgets.length, 1);
});

test("typing keeps the same DOM input, focus and scroll position", t => {
  const h = harness(t);
  h.set("n0", "add", "string");
  const input = h.find("n1", "name");
  input.focus();
  h.editor.editor.scrollTop = 75;
  h.set("n1", "name", "Title");
  assert.equal(h.find("n1", "name"), input);
  assert.equal(h.editor.shadow.activeElement, input);
  assert.equal(h.editor.editor.scrollTop, 75);
  assert.equal(h.state().entries.n1.name, "Title");
  assert.equal(h.node.graph.before, h.node.graph.after);
});

test("type changes and disabling retain values and remove old DOM controls", t => {
  const h = harness(t);
  h.set("n0", "add", "object");
  h.set("n1", "name", "Parent");
  h.set("n1", "add", "string");
  h.set("n2", "name", "Child");
  const oldInput = h.find("n2", "name");
  h.set("n1", "type", "disabled");
  assert.ok(!h.editor.content.contains(oldInput));
  oldInput.value = "stale";
  oldInput.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal(h.state().entries.n2.name, "Child");
  h.set("n1", "type", "string");
  h.set("n1", "allowed_values", "listed");
  h.set("n1", "choices", "a\nb");
  h.set("n1", "allowed_values", "any");
  assert.ok(!h.editor.shadow.querySelector('[data-setting="choices"]'));
  h.set("n1", "allowed_values", "listed");
  assert.equal(h.find("n1", "choices").value, "a\nb");
  h.set("n1", "type", "object");
  assert.equal(h.find("n2", "name").value, "Child");
});

test("deep arrays restore and clone without shared DOM or state", t => {
  const h = harness(t);
  h.set("n0", "type", "array");
  for (let i = 1; i < 7; i++) h.set(`n${i}`, "type", "array");
  h.set("n7", "type", "number");
  h.set("n7", "minimum_mode", "set");
  h.set("n7", "minimum", "-2");
  const saved = h.editor.carrier.value;
  h.editor.carrier.value = saved;
  assert.equal(h.find("n7", "minimum").value, "-2");
  const clone = harness(t);
  clone.editor.carrier.value = saved;
  clone.set("n7", "minimum", "-9");
  assert.equal(h.state().entries.n7.minimum, -2);
  assert.equal(clone.state().entries.n7.minimum, -9);
  assert.deepEqual(JSON.parse(h.editor.carrier.serializeValue()), h.state());
});

test("keyboard editing stays in controls and scrolling stops only when consumed", t => {
  const h = harness(t);
  let keys = 0, wheels = 0;
  h.editor.element.addEventListener("keydown", () => keys++);
  h.editor.element.addEventListener("wheel", () => wheels++);
  h.find("n0", "description").dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, composed: true }));
  assert.equal(keys, 0);
  Object.defineProperties(h.editor.editor, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
  h.editor.editor.scrollTop = 20;
  h.editor.editor.dispatchEvent(new h.window.WheelEvent("wheel", { deltaY: 10, bubbles: true, composed: true }));
  assert.equal(wheels, 0);
  h.editor.editor.dispatchEvent(new h.window.WheelEvent("wheel", { deltaY: 10, ctrlKey: true, bubbles: true, composed: true }));
  assert.equal(wheels, 1);
});

test("layout caps automatic growth and preserves manual node dimensions", t => {
  const h = harness(t);
  assert.deepEqual(editorNodeSize([420, 220], 1000, 200, false), [420, 620]);
  assert.deepEqual(editorNodeSize([510, 700], 1000, 200, true), [510, 700]);
  assert.deepEqual(editorNodeSize([250, 100], 100, 200, true), [320, 200]);
  Object.defineProperty(h.editor.content, "scrollHeight", { value: 1000 });
  h.editor.updateLayout();
  assert.deepEqual(h.node.size, [420, 620]);
  h.node.setSize([500, 450]);
  h.editor.updateLayout();
  assert.deepEqual(h.node.size, [500, 450]);
  assert.equal(h.observers[0].targets.length, 2);
});

test("compact CSS uses contained borders, slight nesting and resizable text areas", () => {
  assert.match(EDITOR_CSS, /padding:4px/);
  assert.match(EDITOR_CSS, /padding-left:3px/);
  assert.match(EDITOR_CSS, /box-sizing:border-box/);
  assert.match(EDITOR_CSS, /resize:vertical/);
  assert.match(EDITOR_CSS, /padding:2px 4px/);
  assert.match(EDITOR_CSS, /overflow:auto/);
  assert.ok(!EDITOR_CSS.includes("position:fixed"));
  assert.ok(!EDITOR_CSS.includes("position:absolute"));
});

test("Remove deletes enabled and disabled entries, including nested fields, and survives reload", t => {
  const h = harness(t);
  h.set("n0", "add", "object");
  h.set("n1", "add", "array");
  h.set("n0", "add", "string");
  h.set("n4", "name", "Keep");
  h.set("n1", "type", "disabled");
  const before = h.node.graph.before;
  h.editor.shadow.querySelector('button[data-remove="n1"]').click();
  assert.deepEqual(h.state().entries.n0.fields, ["n4"]);
  assert.deepEqual(Object.keys(h.state().entries), ["n0", "n4"]);
  assert.equal(h.node.graph.before, before + 1);
  assert.equal(h.node.graph.before, h.node.graph.after);
  assert.equal(h.editor.shadow.activeElement, h.find("n0", "add"));
  h.editor.carrier.value = h.editor.carrier.value;
  assert.ok(!h.editor.shadow.querySelector('section[data-entry="n1"]'));
  assert.equal(h.find("n4", "name").value, "Keep");
  h.editor.shadow.querySelector('button[data-remove="n4"]').click();
  assert.deepEqual(h.state().entries.n0.fields, []);
  assert.equal(h.editor.shadow.querySelectorAll("section.entry").length, 1);
  assert.equal(h.editor.shadow.querySelectorAll('[data-setting="add"]').length, 1);
  assert.equal(h.editor.shadow.querySelectorAll("button[data-remove]").length, 0);
});

test("collapse hides a section without changing serialized schema state and restores with workflow properties", t => {
  const h = harness(t);
  h.set("n0", "add", "object");
  h.set("n1", "name", "Parent");
  h.set("n1", "add", "string");
  h.set("n2", "name", "Child");
  assert.equal(h.find("n2", "description").tagName, "INPUT");
  assert.equal(h.find("n2", "description").type, "text");
  const saved = h.editor.carrier.serializeValue();
  const toggle = h.editor.shadow.querySelector('[data-collapse="n1"]');
  toggle.click();
  assert.equal(h.editor.shadow.getElementById("schema-entry-n1").hidden, true);
  assert.equal(toggle.textContent, "Expand");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(h.editor.carrier.serializeValue(), saved);
  assert.ok(h.editor.content.contains(h.find("n1", "name")));
  const clone = harness(t);
  clone.node.properties = structuredClone(h.node.properties);
  clone.editor.carrier.value = saved;
  assert.equal(clone.editor.shadow.getElementById("schema-entry-n1").hidden, true);
  clone.editor.shadow.querySelector('[data-collapse="n1"]').click();
  assert.equal(clone.editor.shadow.getElementById("schema-entry-n1").hidden, false);
  assert.equal(clone.editor.carrier.serializeValue(), saved);
  h.editor.shadow.querySelector('button[data-remove="n1"]').click();
  assert.deepEqual(h.node.properties.gemini_schema_collapsed, []);
});

test("invalid old state is shown as an error, and removal cleans observers and listeners", t => {
  const h = harness(t);
  h.editor.carrier.value = "object";
  assert.equal(h.editor.carrier.value, "object");
  assert.ok(h.editor.shadow.querySelector('[role="alert"]'));
  assert.throws(() => h.editor.carrier.serializeValue(), /recreate/);
  h.editor.carrier.value = serializeState(createState());
  const input = h.find("n0", "description");
  h.editor.carrier.onRemove();
  input.value = "stale";
  input.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal(h.state().entries.n0.description, "");
  assert.equal(h.observers[0].disconnected, true);
  assert.equal(h.editor.layoutFrame, 0);
  assert.ok(!h.editor.element.isConnected);
  assert.throws(() => h.editor.carrier.serializeValue(), /removed/);
});
