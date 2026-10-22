import { strip } from './tsStrip';
import { Ctx, ENUMS, Workbook } from './officeApi';
import type { In, Out, Snapshot } from './officeTypes';

export type { In, Op, Out, Snapshot } from './officeTypes';

const send = (self as unknown as Worker).postMessage.bind(self);
const BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'WebTransport', 'Worker', 'SharedWorker', 'WebAssembly', 'postMessage', 'addEventListener', 'removeEventListener', 'close', 'XMLHttpRequestUpload', 'Request', 'Response', 'Headers', 'FormData'];

function lockdown(): void {
  let o: object | null = self;
  while (o && o !== Object.prototype) {
    for (const n of BLOCKED) {
      try {
        if (Object.getOwnPropertyDescriptor(o, n)) Object.defineProperty(o, n, { value: undefined, writable: false, configurable: false });
      } catch {
        try {
          delete (o as Record<string, unknown>)[n];
        } catch {
          continue;
        }
      }
    }
    o = Object.getPrototypeOf(o) as object | null;
  }
  for (const n of BLOCKED) {
    try {
      Object.defineProperty(self, n, { value: undefined, writable: false, configurable: false });
    } catch {
      continue;
    }
  }
}

const waiting = new Map<number, (s: Snapshot) => void>();
const fnCache = new Map<string, Record<string, (...a: unknown[]) => unknown>>();

function show(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function consoleFor(id: number) {
  const mk = (level: string) => (...a: unknown[]) => send({ t: 'log', id, level, text: a.map(show).join(' ') } satisfies Out);
  return { log: mk('log'), info: mk('info'), warn: mk('warn'), error: mk('error'), debug: mk('log') };
}

const FORBIDDEN = /\bimport\s*\(|\bimportScripts\b|\bimport\s+[\w{*]/;

function compile(code: string): string {
  if (FORBIDDEN.test(code)) throw new Error('Scripts cannot import code or reach the network.');
  return strip(code);
}

function scan(code: string): string[] {
  const names: string[] = [];
  const re = /@customfunction[\s\S]*?\bfunction\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) names.push(m[1]);
  return names;
}

const ERROR_CODES = { invalidValue: '#VALUE!', notAvailable: '#N/A', divisionByZero: '#DIV/0!', invalidNumber: '#NUM!', nullReference: '#NULL!', invalidName: '#NAME?', invalidReference: '#REF!' };

class CustomFunctionError extends Error {
  readonly excelCode: string;
  constructor(code: string, message?: string) {
    super(message ?? String(code));
    this.excelCode = String(code);
  }
}

const CustomFunctions = { Error: CustomFunctionError, ErrorCode: ERROR_CODES };
const invocations = new Set<{ onCanceled?: () => void }>();

type Table = { main?: (w: unknown, e?: unknown) => unknown; fns: Record<string, (...a: unknown[]) => unknown> };

function table(code: string, con: ReturnType<typeof consoleFor>, wb?: Workbook, event?: unknown): Table {
  const names = scan(code);
  const js = compile(code);
  const body = `${js}\n;return { main: typeof main === 'function' ? main : undefined, fns: { ${names.map((n) => `${JSON.stringify(n)}: ${n}`).join(', ')} } };`;
  const factory = new Function('console', 'workbook', 'event', 'CustomFunctions', 'ExcelScript', `"use strict";\n${body}`) as (c: unknown, w: unknown, e: unknown, cf: unknown, xs: unknown) => Table;
  return factory(con, wb, event, CustomFunctions, ENUMS);
}

let booted = false;

function boot(): void {
  if (booted) return;
  booted = true;
  lockdown();
}

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  boot();
  if (m.t === 'snapshot') {
    waiting.get(m.id)?.(m.snap);
    waiting.delete(m.id);
    return;
  }
  if (m.t === 'scan') {
    send({ t: 'scanned', id: m.id, names: scan(m.code) } satisfies Out);
    return;
  }
  if (m.t === 'call') {
    try {
      let t = fnCache.get(m.code);
      if (!t) {
        t = table(m.code, consoleFor(m.id)).fns;
        fnCache.set(m.code, t);
      }
      const fn = t[m.name];
      if (!fn) throw new Error(`${m.name} is not a custom function.`);
      let inv: { setResult(v: unknown): void; onCanceled?: () => void; address: string } | null = null;
      if (m.stream) {
        const live = { setResult: (v: unknown) => send({ t: 'streamed', id: m.id, value: v } satisfies Out), onCanceled: undefined as (() => void) | undefined, address: '' };
        invocations.add(live);
        inv = live;
      }
      let value = await fn(...m.args, ...(inv ? [inv] : []));
      if (value === undefined) value = '';
      if (inv && value !== '') inv.setResult(value);
      send({ t: 'called', id: m.id, ok: true, value: inv ? '' : value } satisfies Out);
    } catch (err) {
      send({ t: 'called', id: m.id, ok: false, error: err instanceof Error ? err.message : String(err), code: err instanceof CustomFunctionError ? err.excelCode : undefined } satisfies Out);
    }
    return;
  }
  if (m.t === 'cancel') {
    for (const i of invocations) {
      try {
        i.onCanceled?.();
      } catch {
        continue;
      }
    }
    invocations.clear();
    return;
  }
  const ctx = new Ctx();
  ctx.id = m.id;
  ctx.load(m.snap);
  ctx.flusher = async () => {
    const ops = ctx.ops.splice(0);
    await new Promise<void>((resolve) => {
      waiting.set(ctx.id, (snap) => {
        ctx.load(snap);
        resolve();
      });
      send({ t: 'flush', id: ctx.id, ops } satisfies Out);
    });
  };
  const con = consoleFor(m.id);
  try {
    const wb = new Workbook(ctx);
    const t = table(m.code, con, wb, m.event);
    if (!t.main) throw new Error('Write a function main(workbook) { ... } and run again.');
    const result = await t.main(wb, m.event);
    send({ t: 'done', id: m.id, ok: true, ops: ctx.ops, result } satisfies Out);
  } catch (err) {
    send({ t: 'done', id: m.id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), ops: ctx.ops } satisfies Out);
  }
};
