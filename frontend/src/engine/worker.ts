import type { Cell, Changed, Request, Response, Value } from './protocol';

interface Exports {
  memory: WebAssembly.Memory;
  fc_out_ptr(): number;
  fc_alloc(len: number): number;
  fc_free(ptr: number, len: number): void;
  fc_version(): number;
  fc_workbook_new(): number;
  fc_set(book: number, sheet: number, a1: number, a1Len: number, raw: number, rawLen: number): number;
  fc_get(book: number, sheet: number, a1: number, a1Len: number): number;
  fc_apply(book: number, sheet: number, edits: number, len: number): number;
  fc_load(book: number, sheet: number, edits: number, len: number): number;
  fc_add_sheet(book: number, name: number, len: number): number;
  fc_sheet_names(book: number): number;
  fc_undo(book: number): number;
  fc_redo(book: number): number;
  fc_history(book: number): number;
  fc_read(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): number;
  fc_extent(book: number, sheet: number): number;
  fc_edge(book: number, sheet: number, row: number, col: number, dir: number): number;
}

const DIRS = { up: 0, down: 1, left: 2, right: 3 } as const;

function escape(s: string): string {
  return s.replace(/[\\\t\n\r]/g, (c) => (c === '\\' ? '\\\\' : c === '\t' ? '\\t' : c === '\n' ? '\\n' : '\\r'));
}

function unescape(s: string): string {
  return s.indexOf('\\') < 0 ? s : s.replace(/\\(.)/g, (_, c: string) => (c === 't' ? '\t' : c === 'n' ? '\n' : c === 'r' ? '\r' : c));
}

function lines(s: string): string[][] {
  return s ? s.split('\n').filter(Boolean).map((l) => l.split('\t')) : [];
}

function cells(s: string): Cell[] {
  return lines(s).map(([r, c, t]) => [Number(r), Number(c), unescape(t ?? '')]);
}

function changed(s: string): Changed[] {
  return lines(s).map(([sh, r, c, t]) => [Number(sh), Number(r), Number(c), unescape(t ?? '')]);
}

function pair(s: string): [number, number] | null {
  if (!s) return null;
  const [r, c] = s.split('\t');
  return [Number(r), Number(c)];
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const ready: Promise<Exports> = WebAssembly.instantiateStreaming(fetch('/engine/formcel.wasm'), {}).then(
  (r) => r.instance.exports as unknown as Exports,
);

function out(x: Exports, len: number): string {
  if (len < 0) throw new Error('The engine refused that cell address or sheet.');
  return dec.decode(new Uint8Array(x.memory.buffer, x.fc_out_ptr(), len));
}

function withStrings<T>(x: Exports, parts: string[], fn: (args: number[]) => T): T {
  const held: [number, number][] = [];
  const args: number[] = [];
  for (const s of parts) {
    const bytes = enc.encode(s);
    const len = Math.max(bytes.length, 1);
    const ptr = x.fc_alloc(len);
    new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
    held.push([ptr, len]);
    args.push(ptr, bytes.length);
  }
  try {
    return fn(args);
  } finally {
    for (const [p, l] of held) x.fc_free(p, l);
  }
}

function run(x: Exports, req: Request): Value {
  switch (req.op) {
    case 'version':
      return out(x, x.fc_version());
    case 'workbook.new':
      return x.fc_workbook_new();
    case 'cell.set':
      return withStrings(x, [req.a1, req.raw], ([a, al, r, rl]) => out(x, x.fc_set(req.book, req.sheet, a, al, r, rl)));
    case 'cell.get':
      return withStrings(x, [req.a1], ([a, al]) => out(x, x.fc_get(req.book, req.sheet, a, al)));
    case 'apply': {
      const body = req.edits.map(([r, c, raw]) => `${r}\t${c}\t${escape(raw)}`).join('\n');
      return withStrings(x, [body], ([p, l]) => changed(out(x, x.fc_apply(req.book, req.sheet, p, l))));
    }
    case 'load': {
      const body = req.edits.map(([r, c, raw]) => `${r}\t${c}\t${escape(raw)}`).join('\n');
      return withStrings(x, [body], ([p, l]) => {
        const n = x.fc_load(req.book, req.sheet, p, l);
        if (n < 0) throw new Error('The engine refused that workbook data.');
        return n;
      });
    }
    case 'sheet.add':
      return withStrings(x, [req.name], ([p, l]) => x.fc_add_sheet(req.book, p, l));
    case 'sheet.names':
      return out(x, x.fc_sheet_names(req.book)).split('\n').filter(Boolean).map(unescape);
    case 'undo':
    case 'redo': {
      const n = req.op === 'undo' ? x.fc_undo(req.book) : x.fc_redo(req.book);
      return n === -2 ? [] : changed(out(x, n));
    }
    case 'history':
      return x.fc_history(req.book);
    case 'read':
      return cells(out(x, x.fc_read(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1)));
    case 'extent':
      return pair(out(x, x.fc_extent(req.book, req.sheet)));
    case 'edge':
      return pair(out(x, x.fc_edge(req.book, req.sheet, req.row, req.col, DIRS[req.dir])));
  }
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  let res: Response;
  try {
    res = { id: req.id, ok: true, value: run(await ready, req) };
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(res);
};
