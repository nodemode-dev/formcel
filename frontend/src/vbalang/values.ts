export const MISSING = Symbol('vba-missing');

export class VError {
  constructor(readonly code: number) {}
  get text(): string {
    return ERR_TEXT[this.code] ?? '#VALUE!';
  }
}

export const ERR_TEXT: Record<number, string> = { 2000: '#NULL!', 2007: '#DIV/0!', 2015: '#VALUE!', 2023: '#REF!', 2029: '#NAME?', 2036: '#NUM!', 2042: '#N/A' };
export const ERR_CODE: Record<string, number> = { '#NULL!': 2000, '#DIV/0!': 2007, '#VALUE!': 2015, '#REF!': 2023, '#NAME?': 2029, '#NUM!': 2036, '#N/A': 2042 };

export class VDate {
  constructor(readonly serial: number) {}
}

export const NULLV = Object.freeze({ vbaNull: true });

export class VbaError extends Error {
  constructor(readonly number: number, readonly description: string, readonly source = 'VBAProject') {
    super(description);
  }
}

export const MESSAGES: Record<number, string> = {
  3: 'Return without GoSub',
  5: 'Invalid procedure call or argument',
  6: 'Overflow',
  7: 'Out of memory',
  9: 'Subscript out of range',
  10: 'This array is fixed or temporarily locked',
  11: 'Division by zero',
  13: 'Type mismatch',
  20: 'Resume without error',
  28: 'Out of stack space',
  35: 'Sub or Function not defined',
  48: 'Error in loading DLL',
  53: 'File not found',
  58: 'File already exists',
  70: 'Permission denied',
  75: 'Path/File access error',
  76: 'Path not found',
  91: 'Object variable or With block variable not set',
  92: 'For loop not initialized',
  94: 'Invalid use of Null',
  424: 'Object required',
  429: "ActiveX component can't create object",
  430: 'Class does not support Automation or does not support expected interface',
  438: "Object doesn't support this property or method",
  449: 'Argument not optional',
  450: 'Wrong number of arguments or invalid property assignment',
  451: 'Property let procedure not defined and property get procedure did not return an object',
  457: 'This key is already associated with an element of this collection',
  458: 'Variable uses an Automation type not supported in Visual Basic',
  1004: 'Application-defined or object-defined error',
};

export function fail(n: number, text?: string): never {
  throw new VbaError(n, text ?? MESSAGES[n] ?? `Application-defined or object-defined error`);
}

export abstract class HostObject {
  abstract readonly typeName: string;
  defaultProp: string | null = null;
  abstract member(name: string, args: unknown[], mode: 0 | 1 | 2, value?: unknown): unknown;
  enumerate?(): unknown[] | Promise<unknown[]>;
  identity?(): string;
}

export class VArray {
  constructor(public lb: number[], public ub: number[], public data: unknown[], public fixed = true, public elType = 'variant') {}

  static make(lb: number[], ub: number[], fill: () => unknown, fixed = true, elType = 'variant'): VArray {
    let n = 1;
    for (let i = 0; i < lb.length; i++) {
      if (ub[i] < lb[i] - 1) fail(9);
      n *= ub[i] - lb[i] + 1;
      if (n > 50_000_000) fail(7);
    }
    const data = new Array<unknown>(n);
    for (let i = 0; i < n; i++) data[i] = fill();
    return new VArray([...lb], [...ub], data, fixed, elType);
  }

  get dims(): number {
    return this.lb.length;
  }

  offset(idx: number[]): number {
    if (idx.length !== this.lb.length) fail(9);
    let o = 0;
    for (let i = 0; i < idx.length; i++) {
      const k = idx[i];
      if (k < this.lb[i] || k > this.ub[i]) fail(9);
      o = o * (this.ub[i] - this.lb[i] + 1) + (k - this.lb[i]);
    }
    return o;
  }

  get(idx: number[]): unknown {
    return this.data[this.offset(idx)];
  }

  set(idx: number[], v: unknown): void {
    this.data[this.offset(idx)] = v;
  }

  clone(): VArray {
    return new VArray([...this.lb], [...this.ub], this.data.map((x) => (x instanceof VArray ? x.clone() : x instanceof VUdt ? x.clone() : x)), this.fixed, this.elType);
  }

  count(): number {
    return this.data.length;
  }
}

export class VUdt {
  constructor(readonly typeName: string, public fields: Map<string, unknown>) {}
  clone(): VUdt {
    const m = new Map<string, unknown>();
    for (const [k, v] of this.fields) m.set(k, v instanceof VArray ? v.clone() : v instanceof VUdt ? v.clone() : v);
    return new VUdt(this.typeName, m);
  }
}

export function isObj(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !(v instanceof VDate) && !(v instanceof VError) && !(v instanceof VArray) && !(v instanceof VUdt) && v !== NULLV;
}

export function bankers(n: number): number {
  const f = Math.floor(n);
  const d = n - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

export function roundTo(n: number, places: number): number {
  const m = Math.pow(10, places);
  const x = n * m;
  const f = Math.floor(x);
  const d = x - f;
  const r = Math.abs(d - 0.5) < 1e-9 * Math.max(1, Math.abs(x)) ? (f % 2 === 0 ? f : f + 1) : Math.round(x);
  return r / m;
}

const NUM_RX = /^[+-]?(\d{1,3}(,\d{3})+|\d*)(\.\d*)?([eEdD][+-]?\d+)?$/;

export function parseNumber(s: string): number | null {
  let t = s.trim();
  if (t === '') return null;
  const h = /^&h([0-9a-f]+)&?$/i.exec(t);
  if (h) {
    const v = parseInt(h[1], 16);
    return h[1].length <= 4 && v > 0x7fff ? v - 0x10000 : v > 0x7fffffff && h[1].length <= 8 ? v - 0x100000000 : v;
  }
  const o = /^&o([0-7]+)&?$/i.exec(t);
  if (o) return parseInt(o[1], 8);
  let pct = false;
  if (t.endsWith('%')) {
    pct = true;
    t = t.slice(0, -1).trim();
  }
  if (t.startsWith('$')) t = t.slice(1);
  else if (/^[+-]\$/.test(t)) t = t[0] + t.slice(2);
  if (/^\(.*\)$/.test(t)) t = '-' + t.slice(1, -1);
  if (!NUM_RX.test(t) || !/\d/.test(t)) return null;
  const n = Number(t.replace(/,/g, '').replace(/[dD]/, 'e'));
  if (Number.isNaN(n)) return null;
  return pct ? n / 100 : n;
}

export function valPrefix(s: string): number {
  const t = s.replace(/\s+/g, '');
  const h = /^&h([0-9a-f]+)/i.exec(t);
  if (h) return parseInt(h[1], 16);
  const o = /^&o([0-7]+)/i.exec(t);
  if (o) return parseInt(o[1], 8);
  const m = /^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?/.exec(t);
  return m ? Number(m[0].replace(/[dD]/, 'e')) : 0;
}

const DAY = 86400000;
export const EPOCH = 25569;

export function serialToMs(s: number): number {
  return Math.round((s - EPOCH) * DAY);
}

export function msToSerial(ms: number): number {
  return ms / DAY + EPOCH;
}

export interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  n: number;
  s: number;
  dow: number;
}

export function parts(serial: number): Parts {
  const ms = Math.round(serialToMs(serial) / 1000) * 1000;
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), n: dt.getUTCMinutes(), s: dt.getUTCSeconds(), dow: dt.getUTCDay() + 1 };
}

export function dateSerial(y: number, m: number, d: number): number {
  const base = Date.UTC(2000, 0, 1);
  const dt = new Date(base);
  dt.setUTCFullYear(y, m - 1, d);
  dt.setUTCHours(0, 0, 0, 0);
  return Math.floor(msToSerial(dt.getTime()) + 1e-9);
}

export function timeSerial(h: number, n: number, s: number): number {
  const t = (h * 3600 + n * 60 + s) / 86400;
  return t - Math.floor(t);
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function parseDate(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  let datePart: number | null = null;
  let timePart: number | null = null;
  let rest = t;
  const tm = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m?)?\s*$/i.exec(rest);
  if (tm) {
    let h = Number(tm[1]);
    const ap = tm[4]?.toLowerCase();
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap.startsWith('p') && h < 12) h += 12;
      if (ap.startsWith('a') && h === 12) h = 0;
    }
    if (h > 23 || Number(tm[2]) > 59 || Number(tm[3] ?? 0) > 59) return null;
    timePart = timeSerial(h, Number(tm[2]), Number(tm[3] ?? 0));
    rest = rest.slice(0, tm.index).trim();
  } else {
    const ap = /^(\d{1,2})\s*([ap]m?)$/i.exec(rest);
    if (ap) {
      let h = Number(ap[1]);
      if (ap[2].toLowerCase().startsWith('p') && h < 12) h += 12;
      if (ap[2].toLowerCase().startsWith('a') && h === 12) h = 0;
      return timeSerial(h, 0, 0);
    }
  }
  if (rest) {
    let m = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/.exec(rest);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const c = Number(m[3]);
      let y: number;
      let mo: number;
      let d: number;
      if (m[1].length === 4) {
        y = a;
        mo = b;
        d = c;
      } else {
        mo = a;
        d = b;
        y = c < 30 && m[3].length <= 2 ? 2000 + c : c < 100 && m[3].length <= 2 ? 1900 + c : c;
      }
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      datePart = dateSerial(y, mo, d);
      if (parts(datePart).d !== d) return null;
    } else if ((m = /^(\d{1,2})[/\-.](\d{1,2})$/.exec(rest))) {
      const mo = Number(m[1]);
      const d = Number(m[2]);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      datePart = dateSerial(new Date().getFullYear(), mo, d);
    } else {
      const names = MONTHS.map((x) => x.toLowerCase());
      const low = rest.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').replace(/(\d)(st|nd|rd|th)\b/g, '$1');
      m = /^(?:[a-z]+day\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:\s+(\d{2,4}))?$/.exec(low);
      let mi = -1;
      let d = 0;
      let y = new Date().getFullYear();
      if (m) {
        mi = names.findIndex((x) => x === m![1] || (m![1].length >= 3 && x.startsWith(m![1])));
        d = Number(m[2]);
        if (m[3]) y = Number(m[3]) < 100 ? (Number(m[3]) < 30 ? 2000 : 1900) + Number(m[3]) : Number(m[3]);
      } else if ((m = /^(\d{1,2})\s+([a-z]{3,9})\.?(?:\s+(\d{2,4}))?$/.exec(low))) {
        mi = names.findIndex((x) => x === m![2] || (m![2].length >= 3 && x.startsWith(m![2])));
        d = Number(m[1]);
        if (m[3]) y = Number(m[3]) < 100 ? (Number(m[3]) < 30 ? 2000 : 1900) + Number(m[3]) : Number(m[3]);
      }
      if (mi < 0) return null;
      datePart = dateSerial(y, mi + 1, d);
    }
  }
  if (datePart === null && timePart === null) return null;
  return (datePart ?? 0) + (timePart ?? 0);
}

export function isDateText(s: string): boolean {
  return parseNumber(s) === null && parseDate(s) !== null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function dateText(serial: number): string {
  const p = parts(serial);
  const day = Math.floor(serial);
  const hasTime = serial - day > 1e-9;
  const date = `${p.m}/${p.d}/${p.y}`;
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  const time = `${h12}:${pad(p.n)}:${pad(p.s)} ${p.h < 12 ? 'AM' : 'PM'}`;
  if (!hasTime) return date;
  if (day === 0) return time;
  return `${date} ${time}`;
}

export function numText(n: number): string {
  if (Number.isNaN(n)) return '1.#QNAN';
  if (!Number.isFinite(n)) return n > 0 ? '1.#INF' : '-1.#INF';
  if (n === 0) return '0';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const a = Math.abs(n);
  if (Math.fround(n) === n && a >= 1e-3 && a < 1e7 && String(n).replace(/[-.]/g, '').length > 9) return n.toPrecision(7).replace(/\.?0+$/, '');
  if (a >= 1e15 || a < 1e-3) {
    const e = n.toExponential(14).replace(/\.?0+e/, 'e');
    const m = /^(-?[\d.]+)e([+-])(\d+)$/.exec(e);
    if (!m) return String(n);
    return `${m[1]}E${m[2]}${m[3].padStart(2, '0')}`;
  }
  let s = n.toPrecision(15);
  if (s.includes('e')) return String(n);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

export function toStr(v: unknown): string {
  if (v === undefined || v === MISSING) return '';
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return numText(v);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (v instanceof VDate) return dateText(v.serial);
  if (v instanceof VError) fail(13);
  if (v === NULLV) fail(94);
  if (v instanceof VArray) fail(13);
  fail(13);
}

export function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v === undefined || v === MISSING) return 0;
  if (typeof v === 'boolean') return v ? -1 : 0;
  if (v instanceof VDate) return v.serial;
  if (typeof v === 'string') {
    const n = parseNumber(v);
    if (n === null) {
      const d = parseDate(v);
      if (d !== null && /[/\-:]/.test(v)) return d;
      fail(13);
    }
    return n;
  }
  if (v === NULLV) fail(94);
  fail(13);
}

export function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === undefined || v === MISSING) return false;
  if (typeof v === 'string') {
    const l = v.trim().toLowerCase();
    if (l === 'true') return true;
    if (l === 'false') return false;
    const n = parseNumber(v);
    if (n === null) fail(13);
    return n !== 0;
  }
  if (v instanceof VDate) return v.serial !== 0;
  if (v === NULLV) fail(94);
  fail(13);
}

export function isNumeric(v: unknown): boolean {
  if (typeof v === 'number') return true;
  if (typeof v === 'boolean' || v instanceof VDate) return typeof v === 'boolean';
  if (typeof v === 'string') return parseNumber(v) !== null;
  return false;
}

export function toDate(v: unknown): VDate {
  if (v instanceof VDate) return v;
  if (typeof v === 'string') {
    const d = parseDate(v);
    if (d === null) {
      const n = parseNumber(v);
      if (n !== null) return new VDate(n);
      fail(13);
    }
    return new VDate(d);
  }
  return new VDate(toNum(v));
}

export function toInt(v: unknown, lo: number, hi: number): number {
  const n = toNum(v);
  const r = bankers(n);
  if (!Number.isFinite(r) || r < lo || r > hi) fail(6);
  return r === 0 ? 0 : r;
}

export function typeNameOf(v: unknown): string {
  if (v === undefined || v === MISSING) return 'Empty';
  if (v === null) return 'Nothing';
  if (v === NULLV) return 'Null';
  if (typeof v === 'string') return 'String';
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 32768 ? 'Integer' : Number.isInteger(v) && Math.abs(v) < 2147483648 ? 'Long' : 'Double';
  if (typeof v === 'boolean') return 'Boolean';
  if (v instanceof VDate) return 'Date';
  if (v instanceof VError) return 'Error';
  if (v instanceof VArray) return `${v.elType === 'variant' ? 'Variant' : cap(v.elType)}(${v.dims > 1 ? ','.repeat(v.dims - 1) : ''})`;
  if (v instanceof VUdt) return v.typeName;
  if (v instanceof HostObject) return v.typeName;
  const t = (v as { typeName?: string }).typeName;
  return t ?? 'Object';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function varType(v: unknown): number {
  if (v === undefined || v === MISSING) return 0;
  if (v === NULLV) return 1;
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 32768 ? 2 : Number.isInteger(v) && Math.abs(v) < 2147483648 ? 3 : 5;
  if (typeof v === 'string') return 8;
  if (typeof v === 'boolean') return 11;
  if (v instanceof VDate) return 7;
  if (v instanceof VError) return 10;
  if (v instanceof VArray) return 8192 | 12;
  if (v instanceof VUdt) return 36;
  return 9;
}

export interface TypeRef {
  name: string;
  len?: number;
  isNew?: boolean;
}

export const VARIANT: TypeRef = { name: 'variant' };

export const NUMERIC_TYPES = new Set(['integer', 'long', 'longlong', 'byte', 'single', 'double', 'currency', 'decimal']);

export function coerce(v: unknown, t: TypeRef): unknown {
  switch (t.name) {
    case 'variant':
      return v;
    case 'integer':
      return toInt(v, -32768, 32767);
    case 'long':
      return toInt(v, -2147483648, 2147483647);
    case 'longlong':
      return toInt(v, -9223372036854775808, 9223372036854775807);
    case 'byte':
      return toInt(v, 0, 255);
    case 'single':
      return Math.fround(toNum(v));
    case 'double':
    case 'decimal':
      return toNum(v);
    case 'currency':
      return Math.round(toNum(v) * 10000) / 10000;
    case 'string': {
      const s = toStr(v);
      return t.len ? s.slice(0, t.len).padEnd(t.len, ' ') : s;
    }
    case 'boolean':
      return toBool(v);
    case 'date':
      return toDate(v);
    default:
      if (v === undefined || v === MISSING) return null;
      return v;
  }
}

export function defaultOf(t: TypeRef): unknown {
  switch (t.name) {
    case 'variant':
      return undefined;
    case 'integer':
    case 'long':
    case 'longlong':
    case 'byte':
    case 'single':
    case 'double':
    case 'currency':
    case 'decimal':
      return 0;
    case 'string':
      return t.len ? ' '.repeat(t.len) : '';
    case 'boolean':
      return false;
    case 'date':
      return new VDate(0);
    default:
      return null;
  }
}

export function cmpText(a: string, b: string, text: boolean): number {
  if (text) {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compare(a: unknown, b: unknown, text: boolean): number | null {
  if (a === NULLV || b === NULLV) return null;
  const ea = a === undefined || a === MISSING;
  const eb = b === undefined || b === MISSING;
  if (ea && eb) return 0;
  if (typeof a === 'string' && typeof b === 'string') return cmpText(a, b, text);
  if (ea && typeof b === 'string') return cmpText('', b, text);
  if (eb && typeof a === 'string') return cmpText(a, '', text);
  if (typeof a === 'string' || typeof b === 'string') {
    const s = typeof a === 'string' ? a : (b as string);
    const other = typeof a === 'string' ? b : a;
    if (other instanceof VDate && typeof s === 'string') {
      const d = parseDate(s);
      if (d !== null) {
        const x = typeof a === 'string' ? d : other.serial;
        const y = typeof a === 'string' ? other.serial : d;
        return x < y ? -1 : x > y ? 1 : 0;
      }
    }
    const n = parseNumber(s);
    if (n === null) {
      if (typeof a === 'string') return 1;
      return -1;
    }
    const x = typeof a === 'string' ? n : toNum(a);
    const y = typeof b === 'string' ? n : toNum(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (a instanceof VError || b instanceof VError) return a instanceof VError && b instanceof VError && a.code === b.code ? 0 : null;
  const x = toNum(a);
  const y = toNum(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function likePattern(pattern: string, text: boolean): RegExp {
  let rx = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '?') rx += '[\\s\\S]';
    else if (c === '*') rx += '[\\s\\S]*';
    else if (c === '#') rx += '\\d';
    else if (c === '[') {
      const j = pattern.indexOf(']', i + 1);
      if (j < 0) {
        rx += '\\[';
        continue;
      }
      let set = pattern.slice(i + 1, j);
      let neg = false;
      if (set.startsWith('!')) {
        neg = true;
        set = set.slice(1);
      }
      if (set === '') {
        rx += neg ? '[\\s\\S]' : '(?!)';
      } else rx += `[${neg ? '^' : ''}${set.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')}]`;
      i = j;
    } else rx += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(`${rx}$`, text ? 'i' : '');
}
