import type { Cell, Changed, Effect, Request, Response, Shift, Value } from './protocol';

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
  fc_shift(book: number, sheet: number, rows: number, at: number, n: number, insert: number): number;
  fc_delete_sheet(book: number, sheet: number): number;
  fc_move_sheet(book: number, from: number, to: number): number;
  fc_rename_sheet(book: number, sheet: number, name: number, len: number): number;
  fc_undo(book: number): number;
  fc_redo(book: number): number;
  fc_history(book: number): number;
  fc_read(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): number;
  fc_extent(book: number, sheet: number): number;
  fc_edge(book: number, sheet: number, row: number, col: number, dir: number): number;
  fc_offset(src: number, len: number, dr: number, dc: number): number;
  fc_set_clock(serial: number): void;
}

function localSerial(): number {
  const now = Date.now();
  return (now - new Date(now).getTimezoneOffset() * 60000) / 86400000 + 25569;
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
  return lines(s).map(([r, c, t, f]) => {
    const cell: Cell = [Number(r), Number(c), unescape(t ?? '')];
    if (f !== undefined) cell.push(unescape(f));
    return cell;
  });
}

function changed(s: string): Changed[] {
  return lines(s).map(([sh, r, c, t, f]) => {
    const ch: Changed = [Number(sh), Number(r), Number(c), unescape(t ?? '')];
    if (f !== undefined) ch.push(unescape(f));
    return ch;
  });
}

function shiftOf(line: string): Shift {
  const [, sheet, axis, at, delta] = line.split('\t');
  return { sheet: Number(sheet), rows: axis === 'r', at: Number(at), delta: Number(delta) };
}

function effect(s: string): Effect {
  if (!s.startsWith('#')) return { changes: changed(s), shift: null };
  const nl = s.indexOf('\n');
  return { shift: shiftOf(s.slice(0, nl)), changes: changed(s.slice(nl + 1)) };
}

function ok(n: number, what: string): number {
  if (n < 0) throw new Error(what);
  return n;
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
      return n === -2 ? { changes: [], shift: null } : effect(out(x, n));
    }
    case 'shift':
      return shiftOf(out(x, x.fc_shift(req.book, req.sheet, req.rows ? 1 : 0, req.at, req.n, req.insert ? 1 : 0)).trim());
    case 'sheet.delete':
      return ok(x.fc_delete_sheet(req.book, req.sheet), 'A workbook keeps at least one sheet.');
    case 'sheet.move':
      return ok(x.fc_move_sheet(req.book, req.sheet, req.to), 'That sheet cannot move there.');
    case 'sheet.rename':
      return withStrings(x, [req.name], ([p, l]) => ok(x.fc_rename_sheet(req.book, req.sheet, p, l), 'That sheet cannot be renamed.'));
    case 'history':
      return x.fc_history(req.book);
    case 'read':
      return cells(out(x, x.fc_read(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1)));
    case 'extent':
      return pair(out(x, x.fc_extent(req.book, req.sheet)));
    case 'edge':
      return pair(out(x, x.fc_edge(req.book, req.sheet, req.row, req.col, DIRS[req.dir])));
    case 'offset':
      return req.items.map(([src, dr, dc]) => withStrings(x, [src], ([p, l]) => out(x, x.fc_offset(p, l, dr, dc))));
  }
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  let res: Response;
  try {
    const x = await ready;
    x.fc_set_clock(localSerial());
    res = { id: req.id, ok: true, value: run(x, req) };
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(res);
};
