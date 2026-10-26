"use strict";
const vm = require("vm");
const fs = require("fs");

let pending = "";
function readLine() {
  const buf = Buffer.alloc(65536);
  for (;;) {
    const i = pending.indexOf("\n");
    if (i >= 0) {
      const line = pending.slice(0, i);
      pending = pending.slice(i + 1);
      return line;
    }
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if (e.code === "EAGAIN") continue;
      if (e.code === "EOF") n = 0;
      else throw e;
    }
    if (n === 0) throw new Error("the engine closed the connection");
    pending += buf.toString("utf8", 0, n);
  }
}

function rpc(msg) {
  fs.writeSync(1, JSON.stringify(msg) + "\n");
  const r = JSON.parse(readLine());
  if (r.error) throw new Error(r.error);
  return r;
}

const req = JSON.parse(readLine());
const logs = [];
const toasts = [];
const alerts = [];
const menus = [];
let ops = [];
let sheets = req.book.sheets.map((s) => ({ name: s.name, values: s.values, formulas: s.formulas }));
let active = req.book.active;
let dirtyFormula = false;
let fetches = 0;

const fmt = (v) => (typeof v === "string" ? v : typeof v === "function" ? "[function]" : v instanceof Error ? v.message : typeof v === "object" ? JSON.stringify(v) : String(v));
const Logger = {
  log(a, ...rest) {
    let t = fmt(a);
    rest.forEach((x, i) => { t = t.replace("%s", fmt(x)); });
    logs.push(t);
  },
  getLog() { return logs.join("\n"); },
};
const quiet = {};
for (const k of ["log", "info", "warn", "error", "debug"]) quiet[k] = (...a) => logs.push((k === "log" || k === "info" ? "" : k + ": ") + a.map(fmt).join(" "));

function colName(c) {
  let n = c + 1, s = "";
  while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function colIndex(s) {
  let c = 0;
  for (const ch of s.toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
  return c - 1;
}
function parseA1(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)?(?::\$?([A-Za-z]{1,3})\$?(\d+)?)?$/.exec(ref.trim());
  if (!m) throw new Error("The range could not be found: " + ref);
  const c0 = colIndex(m[1]);
  const r0 = m[2] ? Number(m[2]) - 1 : 0;
  const c1 = m[3] ? colIndex(m[3]) : c0;
  const r1 = m[4] ? Number(m[4]) - 1 : m[3] ? 1048575 : r0;
  return [Math.min(r0, r1), Math.min(c0, c1), Math.max(r0, r1), Math.max(c0, c1)];
}

function flush() {
  if (!ops.length) return;
  const r = rpc({ rpc: "apply", ops });
  ops = [];
  dirtyFormula = false;
  sheets = r.book.sheets.map((s) => ({ name: s.name, values: s.values, formulas: s.formulas }));
  if (!sheets.some((s) => s.name === active)) active = sheets[0].name;
}

function sheetData(name) {
  const s = sheets.find((x) => x.name === name);
  if (!s) throw new Error("Sheet not found: " + name);
  return s;
}
function cellAt(s, key, r, c) {
  const row = s[key][r];
  return row && c < row.length ? row[c] : "";
}
function rawOf(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10) === v.toISOString() ? v.toISOString() : v.toISOString().replace("T", " ").slice(0, 19);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
function setCell(s, r, c, v) {
  const raw = rawOf(v);
  while (s.values.length <= r) s.values.push([]);
  for (const key of ["values", "formulas"]) {
    while (s[key].length <= r) s[key].push([]);
    const row = s[key][r];
    while (row.length <= c) row.push("");
  }
  const isF = typeof v === "string" && v.startsWith("=");
  s.formulas[r][c] = isF ? raw : "";
  s.values[r][c] = isF ? "" : typeof v === "number" || typeof v === "boolean" ? v : v instanceof Date ? v : raw !== "" && /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(raw.trim()) ? Number(raw) : raw;
  if (isF) dirtyFormula = true;
  ops.push({ k: "edit", sheet: s.name, r, c, raw });
}
function extent(s) {
  let rows = 0, cols = 0;
  s.values.forEach((row, r) => {
    row.forEach((v, c) => { if (v !== "" && v !== null || (s.formulas[r] && s.formulas[r][c])) { rows = Math.max(rows, r + 1); cols = Math.max(cols, c + 1); } });
  });
  return [rows, cols];
}
const WEIGHT = { bold: "b", normal: "!b" };

class Range {
  constructor(sheet, r0, c0, r1, c1) { this.sheet = sheet; this.r0 = r0; this.c0 = c0; this.r1 = r1; this.c1 = c1; }
  data() { if (dirtyFormula) flush(); return sheetData(this.sheet.getName()); }
  grid(key) {
    const s = this.data();
    const out = [];
    for (let r = this.r0; r <= this.r1; r++) {
      const row = [];
      for (let c = this.c0; c <= this.c1; c++) row.push(cellAt(s, key, r, c));
      out.push(row);
    }
    return out;
  }
  getSheet() { return this.sheet; }
  getValues() { return this.grid("values"); }
  getDisplayValues() { return this.grid("values").map((r) => r.map((v) => (v === null ? "" : String(v)))); }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValue() { return String(this.getValue()); }
  getFormulas() { return this.grid("formulas"); }
  getFormula() { return this.getFormulas()[0][0]; }
  getA1Notation() {
    const a = colName(this.c0) + (this.r0 + 1);
    return this.r0 === this.r1 && this.c0 === this.c1 ? a : a + ":" + colName(this.c1) + (this.r1 + 1);
  }
  getRow() { return this.r0 + 1; }
  getColumn() { return this.c0 + 1; }
  getLastRow() { return this.r1 + 1; }
  getLastColumn() { return this.c1 + 1; }
  getNumRows() { return this.r1 - this.r0 + 1; }
  getNumColumns() { return this.c1 - this.c0 + 1; }
  getCell(r, c) { return new Range(this.sheet, this.r0 + r - 1, this.c0 + c - 1, this.r0 + r - 1, this.c0 + c - 1); }
  offset(dr, dc, nr, nc) { return new Range(this.sheet, this.r0 + dr, this.c0 + dc, this.r0 + dr + (nr || this.getNumRows()) - 1, this.c0 + dc + (nc || this.getNumColumns()) - 1); }
  isBlank() { return this.grid("values").every((r) => r.every((v) => v === "" || v === null)); }
  put(rows, key) {
    if (!Array.isArray(rows) || rows.length !== this.getNumRows() || rows.some((r) => !Array.isArray(r) || r.length !== this.getNumColumns())) {
      throw new Error("The number of rows or columns in the data does not match the number in the range. The data has " + (Array.isArray(rows) ? rows.length : 0) + " rows but the range has " + this.getNumRows() + " rows.");
    }
    const s = sheetData(this.sheet.getName());
    rows.forEach((row, i) => row.forEach((v, j) => setCell(s, this.r0 + i, this.c0 + j, v)));
    return this;
  }
  setValues(rows) { return this.put(rows); }
  setFormulas(rows) { return this.put(rows); }
  setValue(v) {
    const s = sheetData(this.sheet.getName());
    for (let r = this.r0; r <= this.r1; r++) for (let c = this.c0; c <= this.c1; c++) setCell(s, r, c, v);
    return this;
  }
  setFormula(f) { return this.setValue(f); }
  clear() { return this.setValue(""); }
  clearContent() { return this.setValue(""); }
  clearContents() { return this.setValue(""); }
  style(patch) { ops.push({ k: "style", sheet: this.sheet.getName(), r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, patch }); return this; }
  setBackground(c) { return this.style("bg:" + String(c).replace("#", "").toLowerCase()); }
  setFontColor(c) { return this.style("fc:" + String(c).replace("#", "").toLowerCase()); }
  setFontWeight(w) { return this.style(WEIGHT[w] || "b"); }
  setFontStyle(w) { return this.style(w === "italic" ? "i" : "!i"); }
  setFontSize(n) { return this.style("sz:" + n); }
  setFontFamily(f) { return this.style("ff:" + f); }
  setWrap(on) { return this.style(on ? "wrap" : "!wrap"); }
  setHorizontalAlignment(a) { return this.style("ha:" + a); }
  setNumberFormat(code) { ops.push({ k: "format", sheet: this.sheet.getName(), r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, code }); return this; }
  sort(spec) {
    const keys = (Array.isArray(spec) ? spec : [spec]).map((x) => (typeof x === "number" ? [x - 1, true] : [(x.column || 1) - 1, x.ascending !== false]));
    ops.push({ k: "sort", sheet: this.sheet.getName(), r0: this.r0, c0: this.c0, r1: this.r1, c1: this.c1, keys, header: false });
    flush();
    return this;
  }
}

class Sheet {
  constructor(name) { this.name = name; }
  getName() { return this.name; }
  setName(n) { const s = sheetData(this.name); ops.push({ k: "rename", sheet: this.name, name: n }); s.name = n; this.name = n; return this; }
  getSheetName() { return this.name; }
  getIndex() { return sheets.findIndex((s) => s.name === this.name) + 1; }
  getParent() { return ss; }
  getLastRow() { if (dirtyFormula) flush(); return extent(sheetData(this.name))[0]; }
  getLastColumn() { if (dirtyFormula) flush(); return extent(sheetData(this.name))[1]; }
  getMaxRows() { return 1000; }
  getMaxColumns() { return 26; }
  getRange(a, b, c, d) {
    if (typeof a === "string") { const [r0, c0, r1, c1] = parseA1(a); return new Range(this, r0, c0, r1, c1); }
    if (!(a >= 1) || !(b >= 1)) throw new Error("The coordinates of the range are outside the dimensions of the sheet.");
    const nr = c === undefined ? 1 : c, nc = d === undefined ? 1 : d;
    return new Range(this, a - 1, b - 1, a - 1 + nr - 1, b - 1 + nc - 1);
  }
  getDataRange() {
    const [r, c] = extent(sheetData(this.name));
    return new Range(this, 0, 0, Math.max(r, 1) - 1, Math.max(c, 1) - 1);
  }
  getActiveCell() { return new Range(this, 0, 0, 0, 0); }
  getActiveRange() { return new Range(this, 0, 0, 0, 0); }
  appendRow(row) {
    if (!Array.isArray(row)) throw new Error("appendRow needs an array of values.");
    const at = this.getLastRow();
    this.getRange(at + 1, 1, 1, row.length).setValues([row]);
    return this;
  }
  clear() { const [r, c] = extent(sheetData(this.name)); if (r) this.getRange(1, 1, r, c).clear(); return this; }
  clearContents() { return this.clear(); }
  deleteRow(n) { return this.deleteRows(n, 1); }
  deleteRows(n, k) { flush(); rpc({ rpc: "shift", sheet: this.name, rows: true, at: n - 1, n: k || 1, insert: false }); const r = rpc({ rpc: "book" }); sheets = r.book.sheets; return this; }
  insertRowBefore(n) { return this.insertRows(n, 1); }
  insertRowAfter(n) { return this.insertRows(n + 1, 1); }
  insertRows(n, k) { flush(); rpc({ rpc: "shift", sheet: this.name, rows: true, at: n - 1, n: k || 1, insert: true }); sheets = rpc({ rpc: "book" }).book.sheets; return this; }
  activate() { active = this.name; return this; }
  getSheetId() { return this.getIndex() - 1; }
  setFrozenRows() { return this; }
  setColumnWidth() { return this; }
  autoResizeColumns() { return this; }
  hideSheet() { return this; }
}

function ensureSheet(name) {
  if (sheets.some((s) => s.name === name)) throw new Error("A sheet with the name \"" + name + "\" already exists. Please enter another name.");
  ops.push({ k: "sheet", name });
  sheets.push({ name, values: [], formulas: [] });
}

const ss = {
  getName() { return req.book.title; },
  getId() { return req.book.id; },
  getUrl() { return "formcel://" + req.book.id; },
  getSheets() { return sheets.map((s) => new Sheet(s.name)); },
  getSheetByName(n) { return sheets.some((s) => s.name === n) ? new Sheet(n) : null; },
  getSheetId() { return 0; },
  getActiveSheet() { return new Sheet(active); },
  getActiveRange() { return new Sheet(active).getActiveRange(); },
  getActiveCell() { return new Sheet(active).getActiveCell(); },
  setActiveSheet(sh) { active = sh.getName(); return sh; },
  getRange(a) { return new Sheet(active).getRange(a); },
  getSpreadsheetTimeZone() { return req.tz; },
  insertSheet(name) { const n = name || "Sheet" + (sheets.length + 1); ensureSheet(n); return new Sheet(n); },
  deleteSheet(sh) { flush(); rpc({ rpc: "deleteSheet", sheet: sh.getName() }); sheets = rpc({ rpc: "book" }).book.sheets; },
  getNumSheets() { return sheets.length; },
  toast(msg, title, secs) { toasts.push({ message: String(msg), title: title || "", seconds: secs || 5 }); },
  rename(n) { req.book.title = n; },
  flush() { flush(); },
  getSpreadsheetLocale() { return "en_US"; },
};

function Menu(name, parent) {
  this.name = name; this.items = []; this.parent = parent;
}
Menu.prototype.addItem = function (caption, fn) { this.items.push({ caption, fn }); return this; };
Menu.prototype.addSeparator = function () { this.items.push({ separator: true }); return this; };
Menu.prototype.addSubMenu = function (m) { this.items.push({ caption: m.name, items: m.items }); return this; };
Menu.prototype.addToUi = function () { menus.push({ name: this.name, items: this.items }); };
const Ui = {
  createMenu(name) { return new Menu(name); },
  alert(a, b) { alerts.push(String(b && typeof b === "string" ? b : a)); return "OK"; },
  showModalDialog() {},
  showSidebar() {},
  prompt() { return { getSelectedButton: () => "CANCEL", getResponseText: () => "" }; },
  ButtonSet: { OK: "OK", OK_CANCEL: "OK_CANCEL", YES_NO: "YES_NO", YES_NO_CANCEL: "YES_NO_CANCEL" },
  Button: { OK: "OK", CANCEL: "CANCEL", YES: "YES", NO: "NO", CLOSE: "CLOSE" },
};

const SpreadsheetApp = {
  getActiveSpreadsheet() { return ss; },
  getActive() { return ss; },
  getActiveSheet() { return ss.getActiveSheet(); },
  getActiveRange() { return ss.getActiveRange(); },
  getUi() { return Ui; },
  openById(id) { if (id !== req.book.id) throw new Error("Unexpected error while getting the method or property openById on object SpreadsheetApp."); return ss; },
  flush() { flush(); },
  create() { throw new Error("Creating spreadsheets from a script is not available."); },
};

function Props(scope) {
  const d = req.props[scope];
  const touch = () => rpc({ rpc: "props", scope, data: d });
  return {
    getProperty(k) { return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
    getProperties() { return Object.assign({}, d); },
    getKeys() { return Object.keys(d); },
    setProperty(k, v) { d[String(k)] = String(v); touch(); return this; },
    setProperties(o, del) { if (del) for (const k of Object.keys(d)) delete d[k]; for (const k of Object.keys(o)) d[k] = String(o[k]); touch(); return this; },
    deleteProperty(k) { delete d[k]; touch(); return this; },
    deleteAllProperties() { for (const k of Object.keys(d)) delete d[k]; touch(); return this; },
  };
}
const PropertiesService = {
  getScriptProperties: () => Props("script"),
  getUserProperties: () => Props("user"),
  getDocumentProperties: () => Props("document"),
};

function Response(r) {
  return {
    getResponseCode: () => r.status,
    getContentText: () => r.text,
    getHeaders: () => r.headers,
    getAllHeaders: () => r.headers,
    getBlob: () => ({ getDataAsString: () => r.text, getBytes: () => Array.from(Buffer.from(r.text, "utf8")) }),
  };
}
const UrlFetchApp = {
  fetch(url, params) {
    if (++fetches > 20) throw new Error("Service invoked too many times in one run: urlfetch.");
    const p = params || {};
    const r = rpc({ rpc: "fetch", url: String(url), method: (p.method || "get").toUpperCase(), payload: p.payload === undefined ? null : typeof p.payload === "string" ? p.payload : JSON.stringify(p.payload), headers: p.headers || {}, contentType: p.contentType || "" });
    if (r.status >= 400 && !p.muteHttpExceptions) throw new Error("Request failed for " + new URL(String(url)).origin + " returned code " + r.status + ". Truncated server response: " + r.text.slice(0, 200));
    return Response(r);
  },
};

const Utilities = {
  getUuid: () => rpc({ rpc: "uuid" }).value,
  sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(Number(ms) || 0, 5000)); },
  base64Encode: (s) => Buffer.from(String(s), "utf8").toString("base64"),
  base64Decode: (s) => Array.from(Buffer.from(String(s), "base64")),
  newBlob: (s) => ({ getDataAsString: () => String(s) }),
  formatDate(d, tz, f) {
    const p = (n, w = 2) => String(n).padStart(w, "0");
    const o = { yyyy: d.getUTCFullYear(), MM: p(d.getUTCMonth() + 1), dd: p(d.getUTCDate()), HH: p(d.getUTCHours()), mm: p(d.getUTCMinutes()), ss: p(d.getUTCSeconds()), yy: p(d.getUTCFullYear() % 100) };
    return String(f).replace(/yyyy|MM|dd|HH|mm|ss|yy/g, (k) => o[k]);
  },
  formatString(f, ...a) { let i = 0; return String(f).replace(/%[sd]/g, () => String(a[i++])); },
  jsonStringify: (o) => JSON.stringify(o),
  jsonParse: (s) => JSON.parse(s),
};
const Session = {
  getActiveUser: () => ({ getEmail: () => req.user || "" }),
  getEffectiveUser: () => ({ getEmail: () => req.user || "" }),
  getScriptTimeZone: () => req.tz,
  getTimeZone: () => req.tz,
};

function TriggerBuilder(fn) {
  const t = { fn, type: "", every: 0, daily: "", weekday: "" };
  const b = {
    timeBased() { t.type = "time"; return b; },
    forSpreadsheet() { return b; },
    onOpen() { t.type = "open"; return b; },
    onEdit() { t.type = "edit"; return b; },
    onChange() { t.type = "change"; return b; },
    onFormSubmit() { t.type = "form"; return b; },
    everyMinutes(n) { t.every = n; return b; },
    everyHours(n) { t.every = n * 60; return b; },
    everyDays(n) { t.every = n * 1440; return b; },
    everyWeeks(n) { t.every = n * 10080; return b; },
    atHour(h) { t.daily = String(h).padStart(2, "0") + ":00"; t.every = 0; return b; },
    nearMinute() { return b; },
    onWeekDay(d) { t.weekday = String(d); return b; },
    inTimezone() { return b; },
    create() {
      if (!t.type) throw new Error("Select a trigger type before creating it.");
      const r = rpc({ rpc: "trigger.create", trigger: t });
      return { getUniqueId: () => r.id, getHandlerFunction: () => fn, getEventType: () => t.type };
    },
  };
  return b;
}
const ScriptApp = {
  newTrigger: (fn) => TriggerBuilder(fn),
  getProjectTriggers: () => rpc({ rpc: "trigger.list" }).triggers.map((t) => ({ getUniqueId: () => t.id, getHandlerFunction: () => t.fn, getEventType: () => t.type })),
  deleteTrigger: (t) => { rpc({ rpc: "trigger.delete", id: t.getUniqueId() }); },
  EventType: { CLOCK: "CLOCK", ON_OPEN: "ON_OPEN", ON_EDIT: "ON_EDIT", ON_CHANGE: "ON_CHANGE" },
  AuthMode: { NONE: "NONE", LIMITED: "LIMITED", FULL: "FULL" },
};
const Browser = { msgBox(m) { alerts.push(String(m)); return "ok"; } };

const sandbox = { Logger, console: quiet, SpreadsheetApp, PropertiesService, UrlFetchApp, Utilities, Session, ScriptApp, Browser, ContentService: { createTextOutput: (t) => ({ getContent: () => t }) } };
const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
for (const k of ["fetch", "WebSocket", "EventSource", "require", "module", "exports"]) delete globalThis[k];
process.mainModule = undefined;
process.getBuiltinModule = undefined;
process.kill = undefined;

function eventOf(e) {
  if (!e) return undefined;
  if (e.type === "edit" || e.type === "change") {
    const s = new Sheet(e.sheet);
    const range = new Range(s, e.row, e.col, e.row + (e.rows || 1) - 1, e.col + (e.cols || 1) - 1);
    return { source: ss, range, value: e.value, oldValue: e.oldValue, user: { getEmail: () => req.user || "", email: req.user || "" }, authMode: "FULL", changeType: e.changeType || "EDIT", triggerUid: e.uid || "" };
  }
  if (e.type === "time") {
    const d = new Date(e.at * 1000);
    return { "trigger-uid": e.uid || "", authMode: "FULL", year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, "day-of-month": d.getUTCDate(), "day-of-week": d.getUTCDay() || 7, hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), weekday: d.getUTCDay() || 7, timezone: req.tz };
  }
  return { source: ss, authMode: "FULL", user: req.user || "" };
}

let result = null;
let error = "";
let line = 0;
try {
  new vm.Script('"use strict";\n' + req.js, { filename: "project.gs" }).runInContext(ctx, { timeout: 5000 });
  if (req.fn) {
    const f = vm.runInContext("typeof " + req.fn + " === 'function' ? " + req.fn + " : null", ctx);
    if (!f) throw new Error("Script function not found: " + req.fn);
    const v = f.apply(null, req.fn === "" ? [] : req.args && req.args.length ? req.args : [eventOf(req.event)]);
    result = v === undefined ? null : v;
    try { JSON.stringify(result); } catch (e) { result = String(result); }
  }
  flush();
} catch (e) {
  error = String(e && e.message ? e.message : e);
  const m = e && e.stack ? /project\.gs:(\d+)/.exec(e.stack) : null;
  if (m) line = Number(m[1]) - 1;
  try { flush(); } catch (e2) { error += " (" + e2.message + ")"; }
}
fs.writeSync(1, JSON.stringify({ done: true, ok: !error, error, line, result, logs, toasts, alerts, menus, active }) + "\n");
