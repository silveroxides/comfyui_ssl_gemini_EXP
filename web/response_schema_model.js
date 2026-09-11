export const TYPES = ["object", "array", "string", "integer", "number", "boolean"];
const own = (object, key) => Object.hasOwn(object, key);

export function createEntry(type = "object") {
  return {
    type, name: "", required: true, description: "", fields: [], item: null,
    allowed_values: "any", choices: "", minimum_mode: "unbounded", minimum: 0,
    maximum_mode: "unbounded", maximum: 0,
  };
}

export function createState() {
  return { version: 1, root: "n0", next_id: 1, entries: { n0: createEntry() } };
}

export function validateState(state) {
  const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
  if (!state || state.version !== 1) fail("schema_state.version", "expected version 1; recreate an old prototype node");
  const entries = state.entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries) || !own(entries, state.root)) {
    fail("schema_state.root", "missing root entry");
  }
  if (!Number.isSafeInteger(state.next_id) || state.next_id < 1) fail("schema_state.next_id", "invalid allocator");
  for (const [id, entry] of Object.entries(entries)) {
    if (!/^n(?:0|[1-9]\d*)$/.test(id) || !Number.isSafeInteger(Number(id.slice(1))) || Number(id.slice(1)) >= state.next_id) {
      fail(id, "inconsistent allocator or invalid ID");
    }
    if (!entry || ![...TYPES, "disabled"].includes(entry.type)) fail(`${id}.type`, "invalid type");
    for (const key of ["name", "description", "choices"]) {
      if (typeof entry[key] !== "string") fail(`${id}.${key}`, "expected text");
    }
    if (typeof entry.required !== "boolean") fail(`${id}.required`, "expected a boolean");
    for (const [key, values] of [["allowed_values", ["any", "listed"]], ["minimum_mode", ["unbounded", "set"]], ["maximum_mode", ["unbounded", "set"]]]) {
      if (!values.includes(entry[key])) fail(`${id}.${key}`, "invalid mode");
    }
    if (!Array.isArray(entry.fields) || entry.fields.some(id => typeof id !== "string")) fail(`${id}.fields`, "expected entry IDs");
    if (entry.item !== null && typeof entry.item !== "string") fail(`${id}.item`, "expected entry ID");
    if (!own(entry, "minimum") || !own(entry, "maximum")) fail(id, "missing bounds");
  }
  if (entries[state.root].type === "disabled") fail("root.type", "root cannot be disabled");
  const seen = new Set();
  const stack = [[state.root, "root"]];
  while (stack.length) {
    const [id, path] = stack.pop();
    if (!own(entries, id)) fail(path, `missing entry ${id}`);
    if (seen.has(id)) fail(path, `cycle or shared child ${id}`);
    seen.add(id);
    const entry = entries[id];
    entry.fields.forEach((child, index) => stack.push([child, `${path}.fields[${index}]`]));
    if (entry.item !== null) stack.push([entry.item, `${path}.items`]);
  }
  if (seen.size !== Object.keys(entries).length) fail("entries", "disconnected entries");
  const active = [state.root];
  while (active.length) {
    const entry = entries[active.pop()];
    if (entry.type === "object") active.push(...entry.fields.filter(id => entries[id].type !== "disabled"));
    if (entry.type === "array") {
      if (entry.item === null || entries[entry.item].type === "disabled") fail("items", "array needs an active item definition");
      active.push(entry.item);
    }
  }
  return state;
}

export function restoreState(serialized) {
  let state;
  try { state = JSON.parse(serialized); }
  catch { throw new Error("Invalid builder state; recreate an old prototype node."); }
  return validateState(state);
}

export function serializeState(state) {
  return JSON.stringify(state, (_key, value) => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("A numeric setting is not finite.");
    return value;
  });
}

function allocate(state, type) {
  if (!Number.isSafeInteger(state.next_id + 1)) throw new Error("Entry ID allocator exhausted.");
  const id = `n${state.next_id++}`;
  state.entries[id] = createEntry(type);
  return id;
}

export function ensureItem(state, id) {
  const entry = state.entries[id];
  if (entry.item === null) entry.item = allocate(state, "string");
  return entry.item;
}

export function addField(state, objectId, type) {
  if (!TYPES.includes(type)) throw new Error("Choose a concrete field type.");
  if (state.entries[objectId].type !== "object") throw new Error("Fields belong to objects.");
  const id = allocate(state, type);
  state.entries[objectId].fields.push(id);
  if (type === "array") ensureItem(state, id);
  return id;
}

export function removeField(state, id) {
  const parent = Object.entries(state.entries).find(([, entry]) => entry.fields.includes(id));
  if (!parent || id === state.root) throw new Error("Only object fields can be removed.");
  const [parentId, entry] = parent;
  entry.fields.splice(entry.fields.indexOf(id), 1);
  const pending = [id];
  while (pending.length) {
    const current = pending.pop();
    const child = state.entries[current];
    pending.push(...child.fields);
    if (child.item !== null) pending.push(child.item);
    delete state.entries[current];
  }
  return parentId;
}

export function selectType(state, id, type, role) {
  if (!TYPES.includes(type) && !(type === "disabled" && role === "field")) throw new Error("Invalid type selection.");
  state.entries[id].type = type;
  if (type === "array") ensureItem(state, id);
}

export function updateSetting(state, id, key, value) {
  if (!["name", "required", "description", "allowed_values", "choices", "minimum_mode", "minimum", "maximum_mode", "maximum"].includes(key)) {
    throw new Error(`Unknown field setting: ${key}`);
  }
  state.entries[id][key] = value;
}

export function visibleChildren(state, id) {
  const entry = state.entries[id];
  if (entry.type === "object") return [...entry.fields];
  if (entry.type === "array") return [entry.item];
  return [];
}
