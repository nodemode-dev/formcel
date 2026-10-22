import { formatValue } from './format';
import { arrayOf, has, named, VCollection, VDictionary } from './objects';
import {
  DAYS,
  HostObject,
  MISSING,
  MONTHS,
  NULLV,
  VArray,
  VDate,
  VError,
  VUdt,
  cmpText,
  coerce,
  compare,
  dateSerial,
  fail,
  isNumeric,
  isObj,
  numText,
  parseDate,
  parseNumber,
  parts,
  roundTo,
  timeSerial,
  toBool,
  toDate,
  toInt,
  toNum,
  toStr,
  typeNameOf,
  valPrefix,
  varType,
  isDateText,
  bankers,
} from './values';
import type { VbaHost } from './types';

export interface BuiltinCtx {
  host: VbaHost;
  textMode: boolean;
  base: number;
  rnd: { seed: number; last: number };
  now(): number;
  out(text: string): void;
  createObject(progId: string): unknown;
  callByName(obj: unknown, name: string, mode: number, args: unknown[]): Promise<unknown>;
  yieldNow(): Promise<void>;
}

type Fn = (a: unknown[], c: BuiltinCtx) => unknown;

const str = (v: unknown) => toStr(v);
const num = (v: unknown) => toNum(v);

function cmpMode(v: unknown, c: BuiltinCtx): boolean {
  if (!has(v)) return c.textMode;
  const n = num(v);
  return n === 1 ? true : n === 0 ? false : c.textMode;
}

function indexOfText(hay: string, needle: string, from: number, text: boolean): number {
  if (text) return hay.toLowerCase().indexOf(needle.toLowerCase(), from);
  return hay.indexOf(needle, from);
}

function dateArg(v: unknown): number {
  if (v instanceof VDate) return v.serial;
  return toDate(v).serial;
}

function normalYear(y: number): number {
  if (y >= 0 && y < 30) return 2000 + y;
  if (y >= 30 && y < 100) return 1900 + y;
  return y;
}

function addInterval(interval: string, n: number, serial: number): number {
  const p = parts(serial);
  const frac = serial - Math.floor(serial);
  switch (interval.toLowerCase()) {
    case 'yyyy':
      return dateSerial(p.y + n, p.m, Math.min(p.d, daysIn(p.y + n, p.m))) + frac;
    case 'q':
      return addInterval('m', n * 3, serial);
    case 'm': {
      const total = p.y * 12 + (p.m - 1) + n;
      const y = Math.floor(total / 12);
      const m = (total % 12 + 12) % 12 + 1;
      return dateSerial(y, m, Math.min(p.d, daysIn(y, m))) + frac;
    }
    case 'y':
    case 'd':
    case 'w':
      return serial + n;
    case 'ww':
      return serial + n * 7;
    case 'h':
      return serial + n / 24;
    case 'n':
      return serial + n / 1440;
    case 's':
      return serial + n / 86400;
    default:
      return fail(5);
  }
}

function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function dateDiff(interval: string, a: number, b: number, firstDow = 1): number {
  const p = parts(a);
  const q = parts(b);
  switch (interval.toLowerCase()) {
    case 'yyyy':
      return q.y - p.y;
    case 'q':
      return (q.y - p.y) * 4 + Math.floor((q.m - 1) / 3) - Math.floor((p.m - 1) / 3);
    case 'm':
      return (q.y - p.y) * 12 + q.m - p.m;
    case 'y':
    case 'd':
      return Math.floor(b) - Math.floor(a);
    case 'w':
    case 'ww': {
      const shift = (d: number) => Math.floor((Math.floor(d) - (firstDow - 1) + 6) / 7);
      if (interval.toLowerCase() === 'w') return Math.trunc((Math.floor(b) - Math.floor(a)) / 7);
      return shift(b + 0) - shift(a + 0) + (0 + 0);
    }
    case 'h':
      return Math.floor(b * 24 + 1e-9) - Math.floor(a * 24 + 1e-9);
    case 'n':
      return Math.floor(b * 1440 + 1e-9) - Math.floor(a * 1440 + 1e-9);
    case 's':
      return Math.round(b * 86400) - Math.round(a * 86400);
    default:
      return fail(5);
  }
}

function datePart(interval: string, serial: number, firstDow = 1): number {
  const p = parts(serial);
  switch (interval.toLowerCase()) {
    case 'yyyy':
      return p.y;
    case 'q':
      return Math.ceil(p.m / 3);
    case 'm':
      return p.m;
    case 'y':
      return Math.floor(serial) - dateSerial(p.y, 1, 1) + 1;
    case 'd':
      return p.d;
    case 'w':
      return ((p.dow - firstDow + 7) % 7) + 1;
    case 'ww': {
      const jan1 = dateSerial(p.y, 1, 1);
      const off = (parts(jan1).dow - firstDow + 7) % 7;
      return Math.floor((Math.floor(serial) - jan1 + off) / 7) + 1;
    }
    case 'h':
      return p.h;
    case 'n':
      return p.n;
    case 's':
      return p.s;
    default:
      return fail(5);
  }
}

function strConv(s: string, mode: number): string {
  const m = mode & 3;
  if (m === 1) return s.toUpperCase();
  if (m === 2) return s.toLowerCase();
  if (m === 3) return s.toLowerCase().replace(/(^|[^A-Za-z0-9'])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  return s;
}

function lbOf(a: unknown, d: number): VArray {
  if (!(a instanceof VArray)) fail(13);
  if (d < 1 || d > a.dims) fail(9);
  return a;
}

function formatNumberStr(n: number, dec: number, lead: number, paren: number, group: number): string {
  const d = dec < 0 ? 2 : dec;
  let s = Math.abs(roundTo(n, d)).toFixed(d);
  if (group !== 0) s = s.replace(/^(\d+)/, (m) => m.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  if (lead === 0 && s.startsWith('0.')) s = s.slice(1);
  if (n < 0 && roundTo(n, d) !== 0) return paren === -1 ? `(${s})` : `-${s}`;
  return s;
}

function isoStringOf(v: unknown): string {
  return str(v);
}

export class VRegExp extends HostObject {
  readonly typeName = 'RegExp';
  pattern = '';
  global = false;
  ignoreCase = false;
  multiLine = false;

  private rx(extra = ''): RegExp {
    return new RegExp(this.pattern, `${this.global ? 'g' : ''}${this.ignoreCase ? 'i' : ''}${this.multiLine ? 'm' : ''}${extra}`);
  }

  member(name: string, args: unknown[], mode: 0 | 1 | 2, value?: unknown): unknown {
    switch (name) {
      case 'pattern':
        if (mode === 0) return this.pattern;
        this.pattern = str(value);
        return undefined;
      case 'global':
        if (mode === 0) return this.global;
        this.global = toBool(value);
        return undefined;
      case 'ignorecase':
        if (mode === 0) return this.ignoreCase;
        this.ignoreCase = toBool(value);
        return undefined;
      case 'multiline':
        if (mode === 0) return this.multiLine;
        this.multiLine = toBool(value);
        return undefined;
      case 'test':
        return new RegExp(this.pattern, `${this.ignoreCase ? 'i' : ''}${this.multiLine ? 'm' : ''}`).test(str(args[0]));
      case 'replace':
        return str(args[0]).replace(this.rx(), (...m) => {
          const rep = str(args[1]);
          const groups = m.slice(0, -2) as string[];
          return rep.replace(/\$(\d|&)/g, (_x, g: string) => (g === '&' ? groups[0] : groups[Number(g)] ?? ''));
        });
      case 'execute': {
        const col = new VCollection();
        const rx = new RegExp(this.pattern, `g${this.ignoreCase ? 'i' : ''}${this.multiLine ? 'm' : ''}`);
        const text = str(args[0]);
        let m: RegExpExecArray | null;
        while ((m = rx.exec(text))) {
          col.items.push({ key: null, value: new VMatch(m) });
          if (!this.global) break;
          if (m[0] === '') rx.lastIndex++;
        }
        return col;
      }
      default:
        return fail(438);
    }
  }
}

class VMatch extends HostObject {
  readonly typeName = 'Match';
  constructor(private readonly m: RegExpExecArray) {
    super();
    this.defaultProp = 'value';
  }

  member(name: string): unknown {
    switch (name) {
      case '':
      case 'value':
        return this.m[0];
      case 'firstindex':
        return this.m.index;
      case 'length':
        return this.m[0].length;
      case 'submatches': {
        const c = new VCollection();
        for (let i = 1; i < this.m.length; i++) c.items.push({ key: null, value: this.m[i] ?? '' });
        return c;
      }
      default:
        return fail(438);
    }
  }
}

let seedBase = 327680;
export function newRnd(): { seed: number; last: number } {
  return { seed: seedBase, last: 0.7055475 };
}

function rnd(c: BuiltinCtx, a: unknown[]): number {
  const x = a.length && has(a[0]) ? num(a[0]) : 1;
  if (x < 0) {
    const buf = new DataView(new ArrayBuffer(4));
    buf.setFloat32(0, x);
    const b = buf.getUint32(0);
    c.rnd.seed = ((b & 0xffffff) + ((b >>> 24) & 0xff)) & 0xffffff;
  }
  if (x === 0) return c.rnd.last;
  c.rnd.seed = (Math.imul(c.rnd.seed, 1140671485) + 12820163) & 0xffffff;
  c.rnd.last = c.rnd.seed / 16777216;
  return c.rnd.last;
}

export const BUILTINS: Record<string, Fn> = {
  len: (a) => (a[0] === NULLV ? NULLV : isObj(a[0]) || a[0] instanceof VUdt ? 0 : str(a[0]).length),
  lenb: (a) => str(a[0]).length * 2,
  left: (a) => {
    const n = num(a[1]);
    if (n < 0) fail(5);
    return str(a[0]).slice(0, n);
  },
  right: (a) => {
    const n = num(a[1]);
    if (n < 0) fail(5);
    const s = str(a[0]);
    return n === 0 ? '' : s.slice(-n);
  },
  mid: (a) => {
    const s = str(a[0]);
    const st = num(a[1]);
    if (st < 1) fail(5);
    if (a.length > 2 && has(a[2])) {
      const n = num(a[2]);
      if (n < 0) fail(5);
      return s.substr(st - 1, n);
    }
    return s.slice(st - 1);
  },
  trim: (a) => str(a[0]).replace(/^ +| +$/g, ''),
  ltrim: (a) => str(a[0]).replace(/^ +/, ''),
  rtrim: (a) => str(a[0]).replace(/ +$/, ''),
  ucase: (a) => str(a[0]).toUpperCase(),
  lcase: (a) => str(a[0]).toLowerCase(),
  space: (a) => ' '.repeat(Math.max(0, num(a[0]))),
  string: (a) => {
    const n = num(a[0]);
    const c = typeof a[1] === 'number' ? String.fromCharCode(a[1]) : str(a[1]).charAt(0);
    return c.repeat(Math.max(0, n));
  },
  instr: (a, c) => {
    let start = 1;
    let i = 0;
    if (a.length >= 3) {
      start = num(a[0]);
      i = 1;
    }
    if (start < 1) fail(5);
    const hay = str(a[i]);
    const needle = str(a[i + 1]);
    const text = cmpMode(a[i + 2], c);
    if (start > hay.length) return 0;
    if (needle === '') return start;
    return indexOfText(hay, needle, start - 1, text) + 1;
  },
  instrrev: (a, c) => {
    const hay = str(a[0]);
    const needle = str(a[1]);
    const start = a.length > 2 && has(a[2]) && num(a[2]) !== -1 ? num(a[2]) : hay.length;
    const text = cmpMode(a[3], c);
    const h = text ? hay.toLowerCase() : hay;
    const n = text ? needle.toLowerCase() : needle;
    if (n === '') return start;
    return h.lastIndexOf(n, start - n.length) + 1;
  },
  replace: (a, c) => {
    const s = str(a[0]);
    const find = str(a[1]);
    const rep = str(a[2]);
    const start = a.length > 3 && has(a[3]) ? num(a[3]) : 1;
    const count = a.length > 4 && has(a[4]) ? num(a[4]) : -1;
    const text = cmpMode(a[5], c);
    if (find === '') return s.slice(start - 1);
    let out = '';
    let pos = start - 1;
    let n = 0;
    const hay = text ? s.toLowerCase() : s;
    const nd = text ? find.toLowerCase() : find;
    for (;;) {
      if (count >= 0 && n >= count) break;
      const i = hay.indexOf(nd, pos);
      if (i < 0) break;
      out += s.slice(pos, i) + rep;
      pos = i + find.length;
      n++;
    }
    return out + s.slice(pos);
  },
  strcomp: (a, c) => {
    const r = cmpText(str(a[0]), str(a[1]), cmpMode(a[2], c));
    return r;
  },
  strreverse: (a) => [...str(a[0])].reverse().join(''),
  strconv: (a) => strConv(str(a[0]), num(a[1])),
  chr: (a) => {
    const n = num(a[0]);
    if (n < 0 || n > 65535) fail(5);
    return String.fromCharCode(n);
  },
  chrw: (a) => String.fromCharCode(num(a[0]) & 0xffff),
  chrb: (a) => String.fromCharCode(num(a[0]) & 0xff),
  asc: (a) => {
    const s = str(a[0]);
    if (!s) fail(5);
    return s.charCodeAt(0);
  },
  ascw: (a) => {
    const s = str(a[0]);
    if (!s) fail(5);
    return s.charCodeAt(0);
  },
  str: (a) => {
    const n = num(a[0]);
    return (n >= 0 ? ' ' : '') + numText(n);
  },
  val: (a) => valPrefix(str(a[0])),
  hex: (a) => {
    const n = bankers(num(a[0]));
    return (n < 0 ? n >>> 0 : n).toString(16).toUpperCase();
  },
  oct: (a) => {
    const n = bankers(num(a[0]));
    return (n < 0 ? n >>> 0 : n).toString(8);
  },
  format: (a) => formatValue(a[0], has(a[1]) ? str(a[1]) : undefined),
  formatnumber: (a) => {
    const n = num(a[0]);
    const lead = a.length > 2 && has(a[2]) ? num(a[2]) : -1;
    const paren = a.length > 3 && has(a[3]) ? num(a[3]) : 0;
    const grp = a.length > 4 && has(a[4]) ? num(a[4]) : -1;
    return formatNumberStr(n, a.length > 1 && has(a[1]) ? num(a[1]) : -1, lead === -2 ? -1 : lead, paren === -2 ? 0 : paren, grp === -2 ? -1 : grp);
  },
  formatcurrency: (a) => {
    const n = num(a[0]);
    const s = formatNumberStr(Math.abs(n), a.length > 1 && has(a[1]) ? num(a[1]) : -1, -1, 0, -1);
    return n < 0 ? (a.length > 3 && num(a[3]) === -1 ? `($${s})` : `-$${s}`) : `$${s}`;
  },
  formatpercent: (a) => `${formatNumberStr(num(a[0]) * 100, a.length > 1 && has(a[1]) ? num(a[1]) : -1, -1, 0, -1)}%`,
  formatdatetime: (a) => {
    const d = dateArg(a[0]);
    const f = a.length > 1 && has(a[1]) ? num(a[1]) : 0;
    const names = ['General Date', 'Long Date', 'Short Date', 'Long Time', 'Short Time'];
    return formatValue(new VDate(d), names[f] ?? names[0]);
  },
  join: (a) => {
    const arr = a[0];
    if (!(arr instanceof VArray)) fail(13);
    const d = a.length > 1 && has(a[1]) ? str(a[1]) : ' ';
    return arr.data.map((x) => str(x)).join(d);
  },
  split: (a, c) => {
    const s = str(a[0]);
    const d = a.length > 1 && has(a[1]) ? str(a[1]) : ' ';
    const limit = a.length > 2 && has(a[2]) ? num(a[2]) : -1;
    const text = cmpMode(a[3], c);
    if (s === '') return new VArray([0], [-1], [], false, 'string');
    let parts: string[];
    if (d === '') parts = [s];
    else if (text) parts = s.split(new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    else parts = s.split(d);
    if (limit > 0 && parts.length > limit) {
      const head = parts.slice(0, limit - 1);
      let consumed = 0;
      for (const p of head) consumed += p.length + d.length;
      parts = [...head, s.slice(consumed)];
    }
    return new VArray([0], [parts.length - 1], parts, false, 'string');
  },
  filter: (a, c) => {
    const arr = a[0];
    if (!(arr instanceof VArray)) fail(13);
    const m = str(a[1]);
    const inc = a.length > 2 && has(a[2]) ? toBool(a[2]) : true;
    const text = cmpMode(a[3], c);
    const out = arr.data.map((x) => str(x)).filter((s) => (indexOfText(s, m, 0, text) >= 0) === inc);
    return new VArray([0], [out.length - 1], out, false, 'string');
  },
  array: (a, c) => new VArray([c.base], [c.base + a.length - 1], [...a], false, 'variant'),
  lbound: (a) => lbOf(a[0], a.length > 1 ? num(a[1]) : 1).lb[(a.length > 1 ? num(a[1]) : 1) - 1],
  ubound: (a) => lbOf(a[0], a.length > 1 ? num(a[1]) : 1).ub[(a.length > 1 ? num(a[1]) : 1) - 1],
  abs: (a) => Math.abs(num(a[0])),
  sgn: (a) => Math.sign(num(a[0])),
  int: (a) => Math.floor(num(a[0])),
  fix: (a) => Math.trunc(num(a[0])),
  round: (a) => roundTo(num(a[0]), a.length > 1 && has(a[1]) ? num(a[1]) : 0),
  sqr: (a) => {
    const n = num(a[0]);
    if (n < 0) fail(5);
    return Math.sqrt(n);
  },
  exp: (a) => Math.exp(num(a[0])),
  log: (a) => {
    const n = num(a[0]);
    if (n <= 0) fail(5);
    return Math.log(n);
  },
  sin: (a) => Math.sin(num(a[0])),
  cos: (a) => Math.cos(num(a[0])),
  tan: (a) => Math.tan(num(a[0])),
  atn: (a) => Math.atan(num(a[0])),
  rnd: (a, c) => rnd(c, a),
  randomize: (a, c) => {
    const s = a.length && has(a[0]) ? num(a[0]) : Date.now() % 65536;
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, s);
    const hi = buf.getUint32(0);
    c.rnd.seed = (((c.rnd.seed & 0xff) << 16) | ((hi >>> 8) & 0xffff)) & 0xffffff;
    return undefined;
  },
  cint: (a) => toInt(a[0], -32768, 32767),
  clng: (a) => toInt(a[0], -2147483648, 2147483647),
  clnglng: (a) => toInt(a[0], -9223372036854775808, 9223372036854775807),
  clngptr: (a) => toInt(a[0], -9223372036854775808, 9223372036854775807),
  cbyte: (a) => toInt(a[0], 0, 255),
  cdbl: (a) => num(a[0]),
  csng: (a) => Math.fround(num(a[0])),
  ccur: (a) => Math.round(num(a[0]) * 10000) / 10000,
  cdec: (a) => num(a[0]),
  cstr: (a) => str(a[0]),
  cbool: (a) => toBool(a[0]),
  cdate: (a) => toDate(a[0]),
  cvar: (a) => a[0],
  cverr: (a) => new VError(num(a[0])),
  isnumeric: (a) => isNumeric(a[0]) || a[0] === undefined,
  isdate: (a) => a[0] instanceof VDate || (typeof a[0] === 'string' && isDateText(a[0])),
  isempty: (a) => a[0] === undefined || a[0] === MISSING,
  isnull: (a) => a[0] === NULLV,
  isobject: (a) => a[0] === null || (isObj(a[0]) && !(a[0] instanceof VArray)),
  isarray: (a) => a[0] instanceof VArray,
  iserror: (a) => a[0] instanceof VError,
  ismissing: (a) => a[0] === MISSING,
  typename: (a) => typeNameOf(a[0]),
  vartype: (a) => varType(a[0]),
  iif: (a) => (toBool(a[0]) ? a[1] : a[2]),
  choose: (a) => {
    const i = Math.trunc(num(a[0]));
    return i >= 1 && i < a.length ? a[i] : NULLV;
  },
  switch: (a) => {
    for (let i = 0; i + 1 < a.length; i += 2) if (toBool(a[i])) return a[i + 1];
    return NULLV;
  },
  now: (_a, c) => new VDate(c.now()),
  date: (_a, c) => new VDate(Math.floor(c.now())),
  time: (_a, c) => new VDate(c.now() - Math.floor(c.now())),
  timer: (_a, c) => Math.round((c.now() - Math.floor(c.now())) * 86400 * 100) / 100,
  dateserial: (a) => {
    let y = bankers(num(a[0]));
    y = normalYear(y);
    return new VDate(dateSerial(y, bankers(num(a[1])), bankers(num(a[2]))));
  },
  timeserial: (a) => {
    const t = bankers(num(a[0])) * 3600 + bankers(num(a[1])) * 60 + bankers(num(a[2]));
    const f = ((t % 86400) + 86400) % 86400;
    return new VDate(f / 86400);
  },
  datevalue: (a) => {
    const d = typeof a[0] === 'string' ? parseDate(a[0]) : dateArg(a[0]);
    if (d === null) fail(13);
    return new VDate(Math.floor(d));
  },
  timevalue: (a) => {
    const d = typeof a[0] === 'string' ? parseDate(a[0]) : dateArg(a[0]);
    if (d === null) fail(13);
    return new VDate(d - Math.floor(d));
  },
  year: (a) => parts(dateArg(a[0])).y,
  month: (a) => parts(dateArg(a[0])).m,
  day: (a) => parts(dateArg(a[0])).d,
  hour: (a) => parts(dateArg(a[0])).h,
  minute: (a) => parts(dateArg(a[0])).n,
  second: (a) => parts(dateArg(a[0])).s,
  weekday: (a) => {
    const fd = a.length > 1 && has(a[1]) && num(a[1]) > 0 ? num(a[1]) : 1;
    return ((parts(dateArg(a[0])).dow - fd + 7) % 7) + 1;
  },
  dateadd: (a) => {
    const base = dateArg(a[2]);
    const r = addInterval(str(a[0]), Math.trunc(num(a[1])), base);
    return new VDate(r);
  },
  datediff: (a) => dateDiff(str(a[0]), dateArg(a[1]), dateArg(a[2]), a.length > 3 && has(a[3]) && num(a[3]) > 0 ? num(a[3]) : 1),
  datepart: (a) => datePart(str(a[0]), dateArg(a[1]), a.length > 2 && has(a[2]) && num(a[2]) > 0 ? num(a[2]) : 1),
  monthname: (a) => {
    const m = num(a[0]);
    if (m < 1 || m > 12) fail(5);
    return a.length > 1 && has(a[1]) && toBool(a[1]) ? MONTHS[m - 1].slice(0, 3) : MONTHS[m - 1];
  },
  weekdayname: (a) => {
    const fd = a.length > 2 && has(a[2]) && num(a[2]) > 0 ? num(a[2]) : 1;
    const d = num(a[0]);
    if (d < 1 || d > 7) fail(5);
    const n = DAYS[(d - 1 + fd - 1) % 7];
    return a.length > 1 && has(a[1]) && toBool(a[1]) ? n.slice(0, 3) : n;
  },
  rgb: (a) => (num(a[0]) & 255) + (num(a[1]) & 255) * 256 + (num(a[2]) & 255) * 65536,
  qbcolor: (a) => [0, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0, 0x808080, 0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff][num(a[0]) & 15],
  environ: (a) => {
    const k = str(a[0]).toUpperCase();
    return k === 'USERNAME' ? 'user' : k === 'COMPUTERNAME' ? 'formcel' : '';
  },
  createobject: (a, c) => c.createObject(str(a[0])),
  getobject: () => fail(429),
  callbyname: (a, c) => c.callByName(a[0], str(a[1]), num(a[2]), a.slice(3)),
  msgbox: async (a, c) => {
    const [prompt, buttons, title] = named(a, ['prompt', 'buttons', 'title']);
    return c.host.msgBox(has(prompt) ? str(prompt) : '', has(buttons) ? num(buttons) : 0, has(title) ? str(title) : 'FormCel');
  },
  inputbox: async (a, c) => {
    const [prompt, title, def] = named(a, ['prompt', 'title', 'default']);
    const r = await c.host.inputBox(has(prompt) ? str(prompt) : '', has(title) ? str(title) : 'FormCel', has(def) ? str(def) : '');
    return r === null ? '' : r;
  },
  doevents: async (_a, c) => {
    await c.yieldNow();
    return 0;
  },
  beep: () => undefined,
  sendkeys: () => undefined,
  shell: () => fail(53),
  dir: () => '',
  kill: () => fail(53),
  spc: (a) => ' '.repeat(Math.max(0, num(a[0]))),
  tab: (a) => ({ tabTo: a.length ? num(a[0]) : 0 }),
  error: (a) => (a.length ? str(a[0]) : ''),
  isobjectnothing: (a) => a[0] === null,
  stringcompare: (a) => compare(a[0], a[1], false),
};

export const NO_ARG_FUNCS = new Set(['now', 'date', 'time', 'timer', 'rnd', 'randomize', 'doevents', 'beep', 'dir', 'error', 'environ']);

export const VB_CONSTS: Record<string, unknown> = {
  vbcrlf: '\r\n',
  vbcr: '\r',
  vblf: '\n',
  vbnewline: '\r\n',
  vbtab: '\t',
  vbback: '\b',
  vbformfeed: '\f',
  vbverticaltab: '\v',
  vbnullchar: '\0',
  vbnullstring: '',
  vbokonly: 0,
  vbokcancel: 1,
  vbabortretryignore: 2,
  vbyesnocancel: 3,
  vbyesno: 4,
  vbretrycancel: 5,
  vbcritical: 16,
  vbquestion: 32,
  vbexclamation: 48,
  vbinformation: 64,
  vbdefaultbutton1: 0,
  vbdefaultbutton2: 256,
  vbdefaultbutton3: 512,
  vbapplicationmodal: 0,
  vbsystemmodal: 4096,
  vbmsgboxhelpbutton: 16384,
  vbmsgboxsetforeground: 65536,
  vbok: 1,
  vbcancel: 2,
  vbabort: 3,
  vbretry: 4,
  vbignore: 5,
  vbyes: 6,
  vbno: 7,
  vbbinarycompare: 0,
  vbtextcompare: 1,
  vbdatabasecompare: 2,
  vbempty: 0,
  vbnull: 1,
  vbinteger: 2,
  vblong: 3,
  vbsingle: 4,
  vbdouble: 5,
  vbcurrency: 6,
  vbdate: 7,
  vbstring: 8,
  vbobject: 9,
  vberror: 10,
  vbboolean: 11,
  vbvariant: 12,
  vbdataobject: 13,
  vbdecimal: 14,
  vbbyte: 17,
  vblonglong: 20,
  vbuserdefinedtype: 36,
  vbarray: 8192,
  vbuppercase: 1,
  vblowercase: 2,
  vbpropercase: 3,
  vbwide: 4,
  vbunicode: 64,
  vbsunday: 1,
  vbmonday: 2,
  vbtuesday: 3,
  vbwednesday: 4,
  vbthursday: 5,
  vbfriday: 6,
  vbsaturday: 7,
  vbusesystemdayofweek: 0,
  vbfirstjan1: 1,
  vbfirstfourdays: 2,
  vbfirstfullweek: 3,
  vbusesystem: 0,
  vbgeneraldate: 0,
  vblongdate: 1,
  vbshortdate: 2,
  vblongtime: 3,
  vbshorttime: 4,
  vbtrue: -1,
  vbfalse: 0,
  vbusedefault: -2,
  vbblack: 0,
  vbred: 255,
  vbgreen: 65280,
  vbyellow: 65535,
  vbblue: 16711680,
  vbmagenta: 16711935,
  vbcyan: 16776960,
  vbwhite: 16777215,
  vbobjecterror: -2147221504,
  vbget: 2,
  vblet: 4,
  vbset: 8,
  vbmethod: 1,
  vbnormal: 0,
  vbhidden: 2,
  vbreadonly: 1,
  vbsystem: 4,
  vbdirectory: 16,
  vbarchive: 32,
};

export function makeDictionary(): VDictionary {
  return new VDictionary();
}

export { arrayOf, coerce, timeSerial, parseNumber, isoStringOf };
