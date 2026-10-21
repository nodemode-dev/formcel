import { engine, type Edit } from '../engine';
import type { Grid } from '../grid/grid';
import type { In, Op, Out, Snapshot } from './scriptWorker';

export interface RunHooks {
  book(): number;
  sheets(): string[];
  title(): string;
  grid: Grid;
  addSheet(name: string): Promise<number>;
  log(level: string, text: string): void;
}

export interface RunResult {
  ok: boolean;
  error?: string;
  result?: unknown;
}

const LIMIT_MS = 15000;

export class ScriptRunner {
  private worker: Worker | null = null;
  private fnWorker: Worker | null = null;
  private seq = 0;
  private current: { id: number; stop: (err: string) => void } | null = null;
  busy = false;

  constructor(private readonly h: RunHooks) {}

  private spawn(): Worker {
    return new Worker(new URL('./scriptWorker.ts', import.meta.url), { type: 'module' });
  }

  stop(): void {
    this.current?.stop('The script was stopped.');
  }

  private async snapshot(): Promise<Snapshot> {
    const book = this.h.book();
    const e = engine();
    const names = this.h.sheets();
    const sheets: Snapshot['sheets'] = [];
    for (let i = 0; i < names.length; i++) {
      const ext = await e.extent(book, i);
      if (!ext) {
        sheets.push({ name: names[i], cells: [] });
        continue;
      }
      const [vals, cells] = await Promise.all([e.readValues(book, i, 0, 0, ext[0], ext[1]), e.read(book, 0, 0, ext[0], ext[1], i)]);
      const formulas = new Map<number, string | undefined>(cells.map((c) => [c[0] * 16384 + c[1], c[3]]));
      const nums = new Map<number, boolean>(cells.map((c) => [c[0] * 16384 + c[1], !!c[4]]));
      sheets.push({ name: names[i], cells: vals.map(([r, c, v]) => [r, c, v, formulas.get(r * 16384 + c), nums.get(r * 16384 + c) ?? false]) });
    }
    const g = this.h.grid;
    const s = g.selection();
    return { sheets, active: names[g.sheetIndex] ?? names[0], selection: { sheet: names[g.sheetIndex] ?? names[0], r0: s.r0, c0: s.c0, r1: s.r1, c1: s.c1 } };
  }

  async run(code: string, event?: unknown): Promise<RunResult> {
    if (this.busy) return { ok: false, error: 'Another script is still running.' };
    const book = this.h.book();
    if (book < 0) return { ok: false, error: 'Open a workbook first.' };
    this.busy = true;
    const w = (this.worker ??= this.spawn());
    const id = ++this.seq;
    const mark = await engine().undoMark(book);
    try {
      const snap = await this.snapshot();
      const result = await new Promise<RunResult>((resolve) => {
        const timer = window.setTimeout(() => finish({ ok: false, error: `The script ran longer than ${LIMIT_MS / 1000} seconds and was stopped.` }, true), LIMIT_MS);
        const finish = (r: RunResult, kill = false) => {
          window.clearTimeout(timer);
          w.removeEventListener('message', onMsg);
          this.current = null;
          if (kill) {
            w.terminate();
            if (this.worker === w) this.worker = null;
          }
          resolve(r);
        };
        const onMsg = (ev: MessageEvent<Out>) => {
          const m = ev.data;
          if (m.id !== id) return;
          if (m.t === 'log') this.h.log(m.level, m.text);
          else if (m.t === 'flush') {
            void this.apply(m.ops).then(async () => {
              w.postMessage({ t: 'snapshot', id, snap: await this.snapshot() } satisfies In);
            });
          } else if (m.t === 'done') {
            void this.apply(m.ops).then(
              () => {
                finish({ ok: m.ok, error: m.error, result: m.result });
              },
              (err: unknown) => finish({ ok: false, error: err instanceof Error ? err.message : String(err) }),
            );
          }
        };
        this.current = { id, stop: (err) => finish({ ok: false, error: err }, true) };
        w.addEventListener('message', onMsg);
        w.postMessage({ t: 'run', id, code, snap, event } satisfies In);
      });
      return result;
    } finally {
      await engine().undoGroup(book, mark);
      this.busy = false;
    }
  }

  private async apply(ops: Op[]): Promise<void> {
    const book = this.h.book();
    const g = this.h.grid;
    const e = engine();
    let batch: { sheet: string; edits: Edit[] } | null = null;
    const flushBatch = async () => {
      if (!batch) return;
      const idx = this.h.sheets().indexOf(batch.sheet);
      const b = batch;
      batch = null;
      if (idx >= 0 && b.edits.length) await g.commitEdits(await e.apply(book, b.edits, idx));
    };
    for (const op of ops) {
      if (op.k === 'edit') {
        if (batch && (batch as { sheet: string }).sheet !== op.sheet) await flushBatch();
        if (!batch) batch = { sheet: op.sheet, edits: [] };
        (batch as { edits: Edit[] }).edits.push([op.r, op.c, op.raw]);
        continue;
      }
      await flushBatch();
      if (op.k === 'sheet') {
        if (!this.h.sheets().includes(op.name)) await this.h.addSheet(op.name);
        continue;
      }
      const i = this.h.sheets().indexOf(op.sheet);
      if (i < 0) continue;
      if (op.k === 'format') await g.applyEffect(await e.setFormat(book, i, op.r0, op.c0, op.r1, op.c1, op.code));
      else if (op.k === 'style') await g.applyEffect(await e.setStyles(book, i, [[op.r0, op.c0, op.r1, op.c1, op.patch]]));
      else if (op.k === 'sort') await g.applyEffect(await e.sort(book, i, op.r0, op.c0, op.r1, op.c1, op.keys, op.header));
    }
    await flushBatch();
  }

  async scan(code: string): Promise<string[]> {
    const w = (this.fnWorker ??= this.spawn());
    const id = ++this.seq;
    return new Promise((resolve) => {
      const on = (ev: MessageEvent<Out>) => {
        if (ev.data.t === 'scanned' && ev.data.id === id) {
          w.removeEventListener('message', on);
          resolve(ev.data.names);
        }
      };
      w.addEventListener('message', on);
      w.postMessage({ t: 'scan', id, code } satisfies In);
    });
  }

  async call(code: string, name: string, args: unknown[]): Promise<unknown> {
    const w = (this.fnWorker ??= this.spawn());
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        w.removeEventListener('message', on);
        w.terminate();
        if (this.fnWorker === w) this.fnWorker = null;
        reject(new Error('The custom function ran longer than 5 seconds.'));
      }, 5000);
      const on = (ev: MessageEvent<Out>) => {
        const m = ev.data;
        if (m.t !== 'called' || m.id !== id) return;
        window.clearTimeout(timer);
        w.removeEventListener('message', on);
        if (m.ok) resolve(m.value);
        else reject(new Error(m.error));
      };
      w.addEventListener('message', on);
      w.postMessage({ t: 'call', id, code, name, args } satisfies In);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.fnWorker?.terminate();
    this.worker = null;
    this.fnWorker = null;
  }
}
