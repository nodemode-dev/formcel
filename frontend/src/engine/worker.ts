import type { Request, Response } from './protocol';

interface Exports {
  memory: WebAssembly.Memory;
  fc_out_ptr(): number;
  fc_alloc(len: number): number;
  fc_free(ptr: number, len: number): void;
  fc_version(): number;
  fc_workbook_new(): number;
  fc_set(book: number, sheet: number, a1: number, a1Len: number, raw: number, rawLen: number): number;
  fc_get(book: number, sheet: number, a1: number, a1Len: number): number;
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

function run(x: Exports, req: Request): string | number {
  switch (req.op) {
    case 'version':
      return out(x, x.fc_version());
    case 'workbook.new':
      return x.fc_workbook_new();
    case 'cell.set':
      return withStrings(x, [req.a1, req.raw], ([a, al, r, rl]) => out(x, x.fc_set(req.book, req.sheet, a, al, r, rl)));
    case 'cell.get':
      return withStrings(x, [req.a1], ([a, al]) => out(x, x.fc_get(req.book, req.sheet, a, al)));
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
