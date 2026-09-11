import { addField, removeField, restoreState, selectType, serializeState, updateSetting } from "./response_schema_model.js";
import { EDITOR_CSS } from "./response_schema_style.js";

const registered = new WeakSet();
const TYPES = [
  ["string", "Text", "Write words or sentences."],
  ["integer", "Integer", "Return a whole number without decimals."],
  ["number", "Number", "Return a number, with decimals if needed."],
  ["boolean", "Boolean", "Answer yes or no."],
  ["object", "Object", "Keep several named fields together."],
  ["array", "Array", "Return a list of items, all following the same instructions."],
];
const HELP = {
  name: "Give this part of the answer a name, such as title or age.",
  required: "When checked, the AI must include this field in its answer.",
  description: "Describe the information the AI should put here.",
  allowed_values: "Allow any text, or provide the answers the AI may choose from.",
  choices: "Enter one allowed answer per line. The AI will choose one of them.",
  minimum_mode: "Set the smallest number the AI may return, or leave it unrestricted.",
  maximum_mode: "Set the largest number the AI may return, or leave it unrestricted.",
  minimum: "The AI may return this number or a larger number.",
  maximum: "The AI may return this number or a smaller number.",
};

export function editorNodeSize(current, contentHeight, minimumNodeHeight, manual) {
  const width = Math.max(320, current[0]);
  const height = manual
    ? Math.max(minimumNodeHeight, current[1])
    : minimumNodeHeight + Math.max(0, Math.min(560, contentHeight + 8) - 140);
  return [width, Math.ceil(height)];
}

export class SchemaController {
  constructor(node, inputName, data, app, document = globalThis.document) {
    this.node = node;
    this.app = app;
    this.document = document;
    this.window = document.defaultView;
    this.raw = data[1].default;
    this.error = null;
    this.disposed = false;
    this.layoutFrame = 0;
    this.manualSize = false;
    this.applyingSize = false;
    this.didLayout = false;
    this.node.properties ??= {};
    this.abort = new this.window.AbortController();
    this.element = document.createElement("div");
    Object.assign(this.element.style, { width: "100%", height: "100%", minWidth: "0", minHeight: "0", boxSizing: "border-box", overflow: "hidden" });
    this.shadow = this.element.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = EDITOR_CSS;
    this.editor = this.el("div", "editor");
    this.editor.setAttribute("aria-label", "Response format editor");
    this.content = this.el("div", "content");
    this.editor.append(this.content);
    this.shadow.append(style, this.editor);
    this.restore(this.raw);

    this.carrier = node.addDOMWidget(inputName, "gemini_schema_editor", this.element, {
      socketless: true,
      hideOnZoom: false,
      margin: 4,
      getMinHeight: () => 140,
      getValue: () => this.error ? this.raw : serializeState(this.state),
      setValue: value => this.restore(value),
      afterResize: () => {
        if (this.didLayout && !this.applyingSize) this.manualSize = true;
        this.scheduleLayout();
      },
    });
    this.carrier.options.socketless = true;
    this.carrier.serializeValue = () => {
      if (this.error) throw new Error(this.error);
      if (this.disposed) throw new Error("Schema node was removed.");
      return serializeState(this.state);
    };
    const nativeRemove = this.carrier.onRemove;
    this.carrier.onRemove = (...args) => {
      this.dispose();
      nativeRemove?.apply(this.carrier, args);
    };
    const options = { signal: this.abort.signal };
    this.editor.addEventListener("input", event => this.handleEdit(event), options);
    this.editor.addEventListener("change", event => this.handleEdit(event), options);
    this.editor.addEventListener("click", event => this.handleRemove(event), options);
    this.editor.addEventListener("click", event => this.handleCollapse(event), options);
    this.editor.addEventListener("keydown", event => {
      if (event.target.matches("input,textarea,select,button")) event.stopPropagation();
    }, options);
    this.editor.addEventListener("pointerdown", event => {
      if (event.button !== 1 && event.target.closest("input,textarea,select,button,label")) event.stopPropagation();
    }, options);
    this.editor.addEventListener("wheel", event => {
      if (event.ctrlKey || event.metaKey) return;
      const canScroll = event.deltaY < 0
        ? this.editor.scrollTop > 0
        : this.editor.scrollTop + this.editor.clientHeight < this.editor.scrollHeight;
      if (canScroll) event.stopPropagation();
    }, options);
    this.resizeObserver = new this.window.ResizeObserver(() => this.scheduleLayout());
    this.resizeObserver.observe(this.element);
    this.resizeObserver.observe(this.content);
    this.scheduleLayout();
  }

  el(tag, className, text) {
    const element = this.document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  control(tag, id, key, label, tooltip) {
    const wrapper = this.el("label", "control");
    const caption = this.el("span", "caption", label);
    const input = this.el(tag);
    input.dataset.entry = id;
    input.dataset.setting = key;
    input.setAttribute("aria-label", label);
    wrapper.title = tooltip;
    input.title = tooltip;
    wrapper.append(caption, input);
    return { wrapper, input };
  }

  select(id, key, label, choices, value, help) {
    const control = this.control("select", id, key, label, help);
    for (const [value, text, title] of choices) {
      const option = this.el("option", "", text);
      option.value = value;
      if (title) option.title = title;
      control.input.append(option);
    }
    control.input.value = value;
    return control;
  }

  textControl(id, key, label, entry, multiline = false) {
    const control = this.control(multiline ? "textarea" : "input", id, key, label, HELP[key]);
    control.input.value = entry[key];
    if (multiline) control.input.rows = key === "choices" ? 3 : 2;
    else control.input.type = "text";
    control.input.placeholder = key === "name" ? "Name" : "";
    return control;
  }

  renderEntry(id, role) {
    const entry = this.state.entries[id];
    const section = this.el("section", "entry");
    section.dataset.entry = id;
    section.setAttribute("aria-label", role === "root" ? "Response" : role === "item" ? "List item" : entry.name.trim() || "Unnamed field");
    const header = this.el("div", "entry-header");
    if (role === "field" && entry.type !== "disabled") {
      const name = this.textControl(id, "name", "Name", entry);
      name.wrapper.classList.add("name");
      name.input.required = true;
      header.append(name.wrapper);
    } else {
      header.append(this.el("strong", "entry-title", role === "root" ? "Response" : role === "item" ? "List item" : entry.name.trim() || "Disabled field"));
    }
    const choices = role === "field" ? [["disabled", "Disabled", "Leave this field out of the answer."], ...TYPES] : TYPES;
    const type = this.select(id, "type", "Type", choices, entry.type,
      "Choose whether this part contains text, a number, named fields, or a list of items.");
    type.input.dataset.role = role;
    header.append(type.wrapper);
    if (role === "field" && entry.type !== "disabled") {
      const required = this.control("input", id, "required", "Required", HELP.required);
      required.input.type = "checkbox";
      required.input.checked = entry.required;
      required.wrapper.classList.add("check");
      required.wrapper.prepend(required.input);
      header.append(required.wrapper);
    }
    if (role === "field") {
      const remove = this.el("button", "remove-field", "Remove");
      remove.type = "button";
      remove.dataset.remove = id;
      remove.title = "Delete this field and all fields inside it, including saved settings.";
      remove.setAttribute("aria-label", `Remove ${entry.name.trim() || "field"}`);
      header.append(remove);
    }
    section.append(header);
    if (entry.type === "disabled") return section;
    const collapsed = (this.node.properties.gemini_schema_collapsed ?? []).includes(id);
    const toggle = this.el("button", "collapse-entry", collapsed ? "Expand" : "Collapse");
    toggle.type = "button";
    toggle.dataset.collapse = id;
    toggle.title = "Show or hide this section's settings. Its information stays in the answer format.";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-controls", `schema-entry-${id}`);
    header.append(toggle);
    const body = this.el("div", "entry-body");
    body.id = `schema-entry-${id}`;
    body.hidden = collapsed;
    const description = this.textControl(id, "description", "Description", entry);
    description.wrapper.classList.add("description", "single-line");
    body.append(description.wrapper);
    if (entry.type === "string") {
      const allowed = this.select(id, "allowed_values", "Allowed values",
        [["any", "Any text"], ["listed", "From list"]], entry.allowed_values, HELP.allowed_values);
      body.append(allowed.wrapper);
      if (entry.allowed_values === "listed") {
        const choices = this.textControl(id, "choices", "One answer per line", entry, true);
        choices.wrapper.classList.add("description");
        body.append(choices.wrapper);
      }
    }
    if (entry.type === "number" || entry.type === "integer") {
      const bounds = this.el("div", "bounds");
      for (const bound of ["minimum", "maximum"]) {
        const group = this.el("div", "bound");
        const mode = this.select(id, `${bound}_mode`, bound === "minimum" ? "Minimum" : "Maximum",
          [["unbounded", "No limit"], ["set", "Set limit"]], entry[`${bound}_mode`], HELP[`${bound}_mode`]);
        group.append(mode.wrapper);
        if (entry[`${bound}_mode`] === "set") {
          const limit = this.control("input", id, bound, "Value", HELP[bound]);
          limit.input.type = "number";
          limit.input.step = entry.type === "integer" ? "1" : "any";
          limit.input.value = entry[bound];
          group.append(limit.wrapper);
        }
        bounds.append(group);
      }
      body.append(bounds);
    }
    if (entry.type === "object") {
      const children = this.el("div", "children");
      children.setAttribute("aria-label", "Fields");
      for (const child of entry.fields) children.append(this.renderEntry(child, "field"));
      const add = this.select(id, "add", "Add field",
        [["disabled", "Choose type…"], ...TYPES], "disabled", "Choose a type to add another named field to this group.");
      add.wrapper.classList.add("add-field");
      children.append(add.wrapper);
      body.append(children);
    } else if (entry.type === "array") {
      const children = this.el("div", "children");
      children.append(this.renderEntry(entry.item, "item"));
      body.append(children);
    }
    section.append(body);
    return section;
  }

  restore(serialized) {
    if (this.disposed) return;
    this.raw = serialized;
    try {
      this.state = restoreState(serialized);
      this.error = null;
      this.render();
    } catch (error) {
      this.error = error.message;
      const message = this.el("div", "error", `${error.message} Recreate nodes from the older prototype.`);
      message.setAttribute("role", "alert");
      this.content.replaceChildren(message);
    }
    this.scheduleLayout();
  }

  render(focus = null) {
    const scroll = this.editor.scrollTop;
    this.content.replaceChildren(this.renderEntry(this.state.root, "root"));
    if (focus) {
      const target = [...this.content.querySelectorAll("[data-setting]")].find(element =>
        element.dataset.entry === focus.id && element.dataset.setting === focus.key);
      target?.focus({ preventScroll: true });
    }
    this.editor.scrollTop = scroll;
    this.scheduleLayout();
  }

  handleCollapse(event) {
    const button = event.target.closest?.("button[data-collapse]");
    if (this.disposed || this.error || !button || !this.content.contains(button)) return;
    const id = button.dataset.collapse;
    const body = this.shadow.getElementById(`schema-entry-${id}`);
    if (!body) return;
    event.stopPropagation();
    this.node.graph?.beforeChange(this.node);
    try {
      const collapsed = new Set(this.node.properties.gemini_schema_collapsed ?? []);
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
      this.node.properties.gemini_schema_collapsed = [...collapsed].filter(key => Object.hasOwn(this.state.entries, key));
      body.hidden = collapsed.has(id);
      button.textContent = body.hidden ? "Expand" : "Collapse";
      button.setAttribute("aria-expanded", String(!body.hidden));
      this.scheduleLayout();
    } finally {
      this.node.graph?.afterChange(this.node);
      this.app.canvas?.setDirty(true, true);
    }
  }

  handleRemove(event) {
    const button = event.target.closest?.("button[data-remove]");
    if (this.disposed || this.error || !button || !this.content.contains(button)) return;
    event.stopPropagation();
    this.node.graph?.beforeChange(this.node);
    try {
      const parentId = removeField(this.state, button.dataset.remove);
      if (this.node.properties.gemini_schema_collapsed) {
        this.node.properties.gemini_schema_collapsed = this.node.properties.gemini_schema_collapsed.filter(id => Object.hasOwn(this.state.entries, id));
      }
      this.render({ id: parentId, key: "add" });
    } finally {
      this.node.graph?.afterChange(this.node);
      this.app.canvas?.setDirty(true, true);
    }
  }

  handleEdit(event) {
    if (this.disposed || this.error) return;
    const input = event.target;
    const { entry: id, setting: key } = input.dataset ?? {};
    if (!id || !key || !this.content.contains(input)) return;
    const structural = input.tagName === "SELECT" || input.type === "checkbox";
    if ((structural && event.type !== "change") || (!structural && event.type !== "input")) return;
    const value = input.type === "checkbox" ? input.checked : input.type === "number"
      ? (input.value === "" ? "" : Number(input.value)) : input.value;
    if (key === "add" && value === "disabled") return;
    if (key !== "add" && this.state.entries[id][key] === value) return;
    this.node.graph?.beforeChange(this.node);
    try {
      if (key === "add") {
        const newId = addField(this.state, id, value);
        this.render({ id: newId, key: "name" });
      } else if (key === "type") {
        selectType(this.state, id, value, input.dataset.role);
        this.render({ id, key });
      } else {
        updateSetting(this.state, id, key, value);
        if (key === "allowed_values" || key.endsWith("_mode")) this.render({ id, key });
        if (key === "name") input.closest(".entry").setAttribute("aria-label", value.trim() || "Unnamed field");
      }
    } finally {
      this.node.graph?.afterChange(this.node);
      this.app.canvas?.setDirty(true, true);
    }
  }

  scheduleLayout() {
    if (!this.window || this.layoutFrame || this.disposed) return;
    this.layoutFrame = this.window.requestAnimationFrame(() => {
      this.layoutFrame = 0;
      this.updateLayout();
    });
  }

  updateLayout() {
    if (this.disposed || !this.carrier || !this.element.isConnected) return;
    const minimum = this.node.computeSize([this.node.size[0], this.node.size[1]])[1];
    const next = editorNodeSize(this.node.size, this.content.scrollHeight, minimum, this.manualSize);
    if (next[0] !== this.node.size[0] || next[1] !== this.node.size[1]) {
      this.applyingSize = true;
      try { this.node.setSize(next); }
      finally { this.applyingSize = false; }
    }
    this.didLayout = true;
    this.app.canvas?.setDirty(true, true);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.resizeObserver?.disconnect();
    if (this.layoutFrame) this.window.cancelAnimationFrame(this.layoutFrame);
    this.layoutFrame = 0;
    this.content.replaceChildren();
  }
}

export function createWidgetRegistry(app) {
  return {
    GEMINI_SCHEMA_BUILDER(node, name, data) {
      const controller = new SchemaController(node, name, data, app);
      return { widget: controller.carrier, minWidth: 320, minHeight: 140 };
    },
  };
}

export function registerResponseSchema(app) {
  if (registered.has(app)) return;
  app.registerExtension({
    name: "GeminiExpanded.ResponseSchema",
    getCustomWidgets() { return createWidgetRegistry(app); },
  });
  registered.add(app);
}
