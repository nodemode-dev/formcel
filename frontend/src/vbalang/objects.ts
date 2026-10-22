import { HostObject, MISSING, NULLV, VArray, VbaError, VError, VUdt, fail, isObj, toBool, toNum, toStr } from './values';

export function named(args: unknown[], spec: string[]): unknown[] {
  const names = (args as unknown as { names?: (string | undefined)[] }).names;
  if (!names) return args;
  const out: unknown[] = new Array(Math.max(args.length, spec.length)).fill(MISSING);
  let pos = 0;
  for (let i = 0; i < args.length; i++) {
    const n = names[i];
    if (n) {
      const at = spec.indexOf(n.toLowerCase());
      if (at < 0) fail(448, `Named argument not found: ${n}`);
      out[at] = args[i];
    } else out[pos++] = args[i];
  }
  return out;
}

export const has = (v: unknown): boolean => v !== undefined && v !== MISSING;

export class VCollection extends HostObject {
  readonly typeName = 'Collection';
  items: { key: string | null; value: unknown }[] = [];

  find(k: unknown): number {
    if (typeof k === 'string') {
      const l = k.toLowerCase();
      return this.items.findIndex((x) => x.key !== null && x.key.toLowerCase() === l);
    }
    const i = toNum(k);
    if (i < 1 || i > this.items.length || i !== Math.floor(i)) fail(9);
    return i - 1;
  }

  member(name: string, args: unknown[], _mode: 0 | 1 | 2): unknown {
    switch (name) {
      case '':
      case 'item': {
        const i = this.find(args[0]);
        if (i < 0) fail(5);
        return this.items[i].value;
      }
      case 'count':
        return this.items.length;
      case 'add': {
        const [item, key, before, after] = named(args, ['item', 'key', 'before', 'after']);
        const k = has(key) ? toStr(key) : null;
        if (k !== null && this.items.some((x) => x.key !== null && x.key.toLowerCase() === k.toLowerCase())) fail(457);
        const entry = { key: k, value: item };
        if (has(before)) this.items.splice(this.find(before), 0, entry);
        else if (has(after)) this.items.splice(this.find(after) + 1, 0, entry);
        else this.items.push(entry);
        return undefined;
      }
      case 'remove': {
        const i = this.find(args[0]);
        if (i < 0) fail(5);
        this.items.splice(i, 1);
        return undefined;
      }
      case 'clear':
        this.items = [];
        return undefined;
      default:
        return fail(438);
    }
  }

  enumerate(): unknown[] {
    return this.items.map((x) => x.value);
  }
}

function dictKey(k: unknown, text: boolean): string {
  if (typeof k === 'string') return `s:${text ? k.toLowerCase() : k}`;
  if (typeof k === 'number') return `n:${k}`;
  if (typeof k === 'boolean') return `n:${k ? -1 : 0}`;
  if (k === undefined || k === MISSING) return 'e:';
  if (k !== null && typeof k === 'object' && 'serial' in (k as object)) return `n:${(k as { serial: number }).serial}`;
  return `o:${objId(k)}`;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
function objId(o: unknown): number {
  if (o === null || typeof o !== 'object') return 0;
  let id = ids.get(o);
  if (!id) ids.set(o, (id = nextId++));
  return id;
}

export class VDictionary extends HostObject {
  readonly typeName = 'Dictionary';
  map = new Map<string, { key: unknown; value: unknown }>();
  textMode = false;

  member(name: string, args: unknown[], mode: 0 | 1 | 2, value?: unknown): unknown {
    switch (name) {
      case '':
      case 'item': {
        const k = dictKey(args[0], this.textMode);
        if (mode === 0) {
          const e = this.map.get(k);
          if (e) return e.value;
          this.map.set(k, { key: args[0], value: undefined });
          return undefined;
        }
        const e = this.map.get(k);
        if (e) e.value = value;
        else this.map.set(k, { key: args[0], value });
        return undefined;
      }
      case 'key': {
        const k = dictKey(args[0], this.textMode);
        const e = this.map.get(k);
        if (!e) fail(32811, 'Application-defined or object-defined error');
        this.map.delete(k);
        this.map.set(dictKey(value, this.textMode), { key: value, value: e.value });
        return undefined;
      }
      case 'add': {
        const k = dictKey(args[0], this.textMode);
        if (this.map.has(k)) fail(457);
        this.map.set(k, { key: args[0], value: args[1] });
        return undefined;
      }
      case 'exists':
        return this.map.has(dictKey(args[0], this.textMode));
      case 'remove': {
        const k = dictKey(args[0], this.textMode);
        if (!this.map.has(k)) fail(32811, 'Application-defined or object-defined error');
        this.map.delete(k);
        return undefined;
      }
      case 'removeall':
        this.map.clear();
        return undefined;
      case 'count':
        return this.map.size;
      case 'keys':
        return arrayOf([...this.map.values()].map((e) => e.key));
      case 'items':
        return arrayOf([...this.map.values()].map((e) => e.value));
      case 'comparemode':
        if (mode === 0) return this.textMode ? 1 : 0;
        this.textMode = toNum(value) === 1;
        return undefined;
      default:
        return fail(438);
    }
  }

  enumerate(): unknown[] {
    return [...this.map.values()].map((e) => e.key);
  }
}

export function arrayOf(list: unknown[], lb = 0): VArray {
  return new VArray([lb], [lb + list.length - 1], [...list], false, 'variant');
}

export class ErrObject extends HostObject {
  readonly typeName = 'ErrObject';
  number = 0;
  description = '';
  source = '';
  helpContext = 0;
  helpFile = '';
  lastDllError = 0;

  set(e: VbaError): void {
    this.number = e.number;
    this.description = e.description;
    this.source = e.source;
  }

  clear(): void {
    this.number = 0;
    this.description = '';
    this.source = '';
  }

  member(name: string, args: unknown[], mode: 0 | 1 | 2, value?: unknown): unknown {
    switch (name) {
      case '':
      case 'number':
        if (mode === 0) return this.number;
        this.number = toNum(value);
        return undefined;
      case 'description':
        if (mode === 0) return this.description;
        this.description = toStr(value);
        return undefined;
      case 'source':
        if (mode === 0) return this.source;
        this.source = toStr(value);
        return undefined;
      case 'helpcontext':
        return this.helpContext;
      case 'helpfile':
        return this.helpFile;
      case 'lastdllerror':
        return this.lastDllError;
      case 'clear':
        this.clear();
        return undefined;
      case 'raise': {
        const [n, src, desc] = named(args, ['number', 'source', 'description', 'helpfile', 'helpcontext']);
        const num = toNum(n);
        throw new VbaError(num, has(desc) ? toStr(desc) : this.describe(num), has(src) ? toStr(src) : 'VBAProject');
      }
      default:
        return fail(438);
    }
  }

  describe(n: number): string {
    return MESSAGE_LOOKUP(n);
  }
}

let MESSAGE_LOOKUP: (n: number) => string = () => 'Application-defined or object-defined error';
export function setMessageLookup(f: (n: number) => string): void {
  MESSAGE_LOOKUP = f;
}

export class DebugObject extends HostObject {
  readonly typeName = 'Debug';
  constructor(private readonly out: (text: string) => void) {
    super();
  }

  member(name: string, args: unknown[]): unknown {
    if (name === 'print') {
      this.out(args.map((a) => toStr(a)).join(' '));
      return undefined;
    }
    if (name === 'assert') {
      if (!toBool(args[0])) fail(1004, 'Assertion failed');
      return undefined;
    }
    return fail(438);
  }
}

export function describeValue(v: unknown): string {
  if (v === undefined || v === MISSING) return 'Empty';
  if (v === null) return 'Nothing';
  if (v === NULLV) return 'Null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return toStr(v);
  if (v instanceof VError) return `Error ${v.code}`;
  if (v instanceof VArray) return `${v.dims}-dim array (${v.lb.map((l, i) => `${l} To ${v.ub[i]}`).join(', ')})`;
  if (v instanceof VUdt) return `{${v.typeName}}`;
  if (isObj(v)) return `<${(v as { typeName?: string }).typeName ?? 'Object'}>`;
  try {
    return toStr(v);
  } catch {
    return String(v);
  }
}
