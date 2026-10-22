import { engine, type Edit } from '../engine';
import type { Grid, SheetView } from '../grid/grid';
import { parseTable } from '../grid/tables';
import type { ObjectLayer } from '../charts/layer';
import type { ChartSpec, ChartType, FloatObject } from '../charts/types';
import { emptyPivot, formatPivot, parseFields, parsePivot, type PivotDef } from '../ui/pivot';
import type { ChartPatch, In, Op, Out, PivotSnap, Snapshot } from './officeTypes';
import { colName } from './officeApi';

export interface ScriptHost {
  views(): SheetView[];
  patchView(sheet: number, part: Partial<SheetView>): void;
  sheetOp(op: 'rename' | 'delete' | 'move' | 'tab' | 'visible' | 'show', sheet: number, arg: string | number): Promise<void>;
  names(): [string, string][];
  defineName(name: string, refers: string): Promise<void>;
  layer(): ObjectLayer;
  pivotsChanged(): Promise<void>;
}

export interface RunHooks {
  book(): number;
  sheets(): string[];
  title(): string;
  grid: Grid;
  addSheet(name: string): Promise<number>;
  renameSheet?(index: number, name: string): Promise<void>;
  deleteSheet?(index: number): Promise<void>;
  showSheet?(index: number): void;
  log(level: string, text: string): void;
  host: ScriptHost;
}

export interface RunResult {
  ok: boolean;
  error?: string;
  result?: unknown;
}

const LIMIT_MS = 15000;
const KEY = 16384;
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

const a1 = (r0: number, c0: number, r1: number, c1: number) => `${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}`;

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
    const views = this.h.host.views();
    const merged = await Promise.all(names.map((_, i) => e.merges(book, i)));
    const sheets: Snapshot['sheets'] = [];
    for (let i = 0; i < names.length; i++) {
      const view = views[i] ?? {};
      const axis = (a: SheetView['cols']): [number, number][] => [...(a?.sizes ?? []), ...(a?.hidden ?? []).map((k): [number, number] => [k, 0])];
      const base = {
        name: names[i],
        merges: merged[i].map((m) => [...m] as [number, number, number, number]),
        visible: (view.hidden ? 'Hidden' : 'Visible') as 'Visible' | 'Hidden',
        tab: (view.color ?? '').replace('#', '').toLowerCase(),
        grid: true,
        freeze: [view.fr ?? 0, view.fc ?? 0] as [number, number],
        cols: axis(view.cols),
        rows: axis(view.rows),
      };
      const ext = await e.extent(book, i);
      if (!ext) {
        sheets.push({ ...base, cells: [], styles: [], formats: [] });
        continue;
      }
      const [vals, cells, styles, formats] = await Promise.all([e.readValues(book, i, 0, 0, ext[0], ext[1]), e.read(book, 0, 0, ext[0], ext[1], i), e.readStyles(book, i, 0, 0, ext[0], ext[1]), e.readFormats(book, i, 0, 0, ext[0], ext[1])]);
      const info = new Map<number, [string | undefined, boolean, string]>(cells.map((c) => [c[0] * KEY + c[1], [c[3], !!c[4], c[2]]]));
      sheets.push({
        ...base,
        cells: vals.map(([r, c, v]) => {
          const x = info.get(r * KEY + c);
          return [r, c, v, x?.[0], x?.[1] ?? false, x?.[2] ?? v];
        }),
        styles: styles.map(([r, c, s]) => [r, c, s] as [number, number, string]),
        formats: formats.map(([r, c, s]) => [r, c, s] as [number, number, string]),
      });
    }
    const tables = (await e.tables(book)).map(parseTable).filter((t): t is NonNullable<typeof t> => !!t).map((t) => ({ name: t.name, sheet: names[t.sheet] ?? '', area: t.area, flags: t.flags, style: t.style, cols: t.cols }));
    const pivots: PivotSnap[] = [];
    for (const line of await e.pivots(book)) {
      const d = parsePivot(line);
      if (!d) continue;
      const [r0, c0, r1, c1] = d.src.split(',').map(Number);
      const heads = Number.isFinite(c1) ? await e.readValues(book, d.srcSheet, r0, c0, r0, c1) : [];
      const fields = Array.from({ length: Math.max(0, c1 - c0 + 1) }, (_, k) => (heads.find((x) => x[1] === c0 + k)?.[2] ?? '').replace(/^'/, ''));
      pivots.push({
        name: d.name,
        sheet: names[d.sheet] ?? '',
        row: d.row,
        col: d.col,
        src: a1(r0, c0, r1, c1),
        srcSheet: names[d.srcSheet] ?? '',
        rows: d.rows,
        cols: d.cols,
        values: d.values.map((v) => ({ field: v.field, func: v.func, name: v.name || `${v.func.charAt(0).toUpperCase()}${v.func.slice(1)} of ${v.field}` })),
        filters: d.filters.map((f) => f.field),
        fields,
      });
    }
    const layer = this.h.host.layer();
    const charts: Snapshot['charts'] = [];
    names.forEach((n, i) => {
      for (const o of layer.listOf(i)) {
        if (o.kind !== 'chart' || !o.chart || !o.anchor) continue;
        charts.push({ id: o.id, sheet: n, name: o.name ?? `Chart ${charts.length + 1}`, type: o.chart.type, title: o.chart.title, range: o.chart.range, legend: o.chart.legend, anchor: [o.anchor.r0, o.anchor.c0, o.anchor.r1, o.anchor.c1] });
      }
    });
    const g = this.h.grid;
    const s = g.selection();
    return {
      sheets,
      active: names[g.sheetIndex] ?? names[0],
      selection: { sheet: names[g.sheetIndex] ?? names[0], r0: s.r0, c0: s.c0, r1: s.r1, c1: s.c1 },
      tables,
      charts,
      pivots,
      names: this.h.host.names(),
      title: this.h.title(),
    };
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
            void this.apply(m.ops).then(
              async () => {
                w.postMessage({ t: 'snapshot', id, snap: await this.snapshot() } satisfies In);
              },
              (err: unknown) => finish({ ok: false, error: err instanceof Error ? err.message : String(err) }, true),
            );
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

  private chartSpec(p: ChartPatch, base?: ChartSpec): ChartSpec {
    const spec: ChartSpec = base ?? { type: 'column', range: '', byRows: false, title: '', xTitle: '', yTitle: '', legend: 'right', labels: false, secondary: [] };
    if (p.type) spec.type = p.type as ChartType;
    if (p.title !== undefined) spec.title = p.title;
    if (p.xTitle !== undefined) spec.xTitle = p.xTitle;
    if (p.yTitle !== undefined) spec.yTitle = p.yTitle;
    if (p.legend) spec.legend = p.legend as ChartSpec['legend'];
    if (p.range) spec.range = p.range;
    if (p.byRows !== undefined) spec.byRows = p.byRows;
    return spec;
  }

  private async apply(ops: Op[]): Promise<void> {
    const book = this.h.book();
    const g = this.h.grid;
    const e = engine();
    const host = this.h.host;
    const touched = new Set<number>();
    let batch: { sheet: string; edits: Edit[] } | null = null;
    const idx = (name: string) => this.h.sheets().indexOf(name);
    const flushBatch = async () => {
      if (!batch) return;
      const i = idx(batch.sheet);
      const b = batch;
      batch = null;
      if (i >= 0 && b.edits.length) await g.commitEdits(await e.apply(book, b.edits, i));
    };
    const tableOf = async (name: string) => (await e.tables(book)).map(parseTable).find((t) => t?.name === name) ?? null;
    const pivotOf = async (name: string): Promise<PivotDef | null> => (await e.pivots(book)).map(parsePivot).find((p) => p?.name === name) ?? null;
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
      if (op.k === 'name') {
        await host.defineName(op.name, op.refers);
        continue;
      }
      const i = idx('sheet' in op ? op.sheet : '');
      if (i < 0) continue;
      if (op.k === 'filter') await g.applyEffect(await e.setFilter(book, i, op.text));
      else if (op.k === 'fill') {
        if (i !== g.sheetIndex) this.h.showSheet?.(i);
        const [sr0, sc0, sr1, sc1] = op.src;
        const [dr0, dc0, dr1, dc1] = op.dest;
        g.select(sr0, sc0, sr1, sc1, false);
        if (dr1 > sr1) await g.fill({ r0: sr1 + 1, c0: sc0, r1: dr1, c1: sc1 });
        else if (dr0 < sr0) await g.fill({ r0: dr0, c0: sc0, r1: sr0 - 1, c1: sc1 });
        else if (dc1 > sc1) await g.fill({ r0: sr0, c0: sc1 + 1, r1: sr1, c1: dc1 });
        else if (dc0 < sc0) await g.fill({ r0: sr0, c0: dc0, r1: sr1, c1: sc0 - 1 });
      } else if (op.k === 'format') await g.applyEffect(await e.setFormat(book, i, op.r0, op.c0, op.r1, op.c1, op.code));
      else if (op.k === 'style') await g.applyEffect(await e.setStyles(book, i, [[op.r0, op.c0, op.r1, op.c1, op.patch]]));
      else if (op.k === 'sort') await g.applyEffect(await e.sort(book, i, op.r0, op.c0, op.r1, op.c1, op.keys, op.header));
      else if (op.k === 'merge') await g.applyEffect(await e.merge(book, i, op.r0, op.c0, op.r1, op.c1, op.mode === 'all' ? 'cells' : op.mode));
      else if (op.k === 'shift') await g.shiftSheet(i, op.rows, op.at, op.n, op.insert);
      else if (op.k === 'link') await g.applyEffect(await e.setLink(book, i, op.r, op.c, op.target, op.display || undefined));
      else if (op.k === 'unlink') await g.applyEffect(await e.removeLinks(book, i, op.r0, op.c0, op.r1, op.c1));
      else if (op.k === 'validation') await g.applyEffect(await e.setValidation(book, i, op.r0, op.c0, op.r1, op.c1, op.line));
      else if (op.k === 'size') this.axis(i, !op.cols, op.i0, op.i1, op.px, null);
      else if (op.k === 'hide') this.axis(i, op.rows, op.i0, op.i1, null, op.on);
      else if (op.k === 'sheetOp') {
        if (op.op === 'freeze') {
          if (i === g.sheetIndex) g.freeze(op.rows ?? 0, op.cols ?? 0);
          else host.patchView(i, { fr: op.rows ?? 0, fc: op.cols ?? 0 });
        }
        else if (op.op === 'rename') await host.sheetOp('rename', i, op.name ?? '');
        else if (op.op === 'move') await host.sheetOp('move', i, op.to ?? 0);
        else if (op.op === 'tab') await host.sheetOp('tab', i, op.value ?? '');
        else if (op.op === 'visible') await host.sheetOp('visible', i, op.value ?? 'Visible');
        else if (op.op === 'show') await host.sheetOp('show', i, 0);
        else if (op.op === 'delete') await host.sheetOp('delete', i, 0);
      } else if (op.k === 'table') {
        if (op.action === 'create' && op.area) {
          const [r0, c0, r1, c1] = op.area;
          await g.applyEffect(await e.createTable(book, i, r0, c0, r1, c1, true));
          const made = (await e.tables(book)).map(parseTable).find((t) => t && t.sheet === i && t.area[0] === r0 && t.area[1] === c0);
          if (made && made.name !== op.name) await g.applyEffect(await e.setTable(book, made.name, this.tableLine(made, { name: op.name })));
        } else if (op.action === 'delete') await g.applyEffect(await e.removeTable(book, op.name));
        else if (op.action === 'set') {
          const t = await tableOf(op.name);
          if (t) await g.applyEffect(await e.setTable(book, op.name, this.tableLine(t, { name: op.rename, area: op.area, flags: op.flags, style: op.style, cols: op.cols })));
        }
      } else if (op.k === 'chart') {
        const list = host.layer().listOf(i);
        if (op.action === 'add') {
          const p = op.patch;
          const a = p.anchor ?? [0, 0, 15, 8];
          list.push({ id: op.id, kind: 'chart', x: 0, y: 0, w: 0, h: 0, name: p.name, anchor: { r0: a[0], c0: a[1], dy0: 0, dx0: 0, r1: a[2], c1: a[3], dy1: 0, dx1: 0 }, chart: this.chartSpec(p) } satisfies FloatObject);
        } else {
          const at = list.findIndex((o) => o.id === op.id);
          if (at >= 0 && op.action === 'delete') list.splice(at, 1);
          else if (at >= 0) {
            const o = list[at];
            if (o.chart) this.chartSpec(op.patch, o.chart);
            if (op.patch.name) o.name = op.patch.name;
            const a = op.patch.anchor;
            if (a) o.anchor = { r0: a[0], c0: a[1], dy0: 0, dx0: 0, r1: a[2], c1: a[3], dy1: 0, dx1: 0 };
          }
        }
        touched.add(i);
      } else if (op.k === 'pivot') {
        if (op.action === 'add' && op.src) {
          const bang = op.src.lastIndexOf('!');
          const srcSheet = idx(op.src.slice(0, bang));
          const fields = parseFields(await e.pivotSource(book, srcSheet, `${this.quote(op.src.slice(0, bang))}!${op.src.slice(bang + 1)}`));
          const def = { ...emptyPivot(fields, i, op.row ?? 0, op.col ?? 0), name: op.name };
          await g.applyPivot(await e.createPivot(book, formatPivot(def)));
        } else if (op.action === 'delete') await g.applyPivot(await e.removePivot(book, op.name));
        else if (op.action === 'refresh') await g.applyPivot(await e.refreshPivot(book, op.name));
        else if (op.action === 'set' && op.patch) {
          const d = await pivotOf(op.name);
          if (d) {
            const p = op.patch;
            const next: PivotDef = {
              ...d,
              rows: p.rows ?? d.rows,
              cols: p.cols ?? d.cols,
              values: p.values ? p.values.map((v) => ({ field: v.field, func: v.func, show: 'none', name: v.name, baseField: '', baseItem: '' })) : d.values,
              filters: p.filters ? p.filters.map((f) => d.filters.find((x) => x.field === f) ?? { field: f, items: [] }) : d.filters,
            };
            await g.applyPivot(await e.setPivot(book, op.name, formatPivot(next)));
          }
        }
        await host.pivotsChanged();
      }
    }
    await flushBatch();
    const layer = host.layer();
    for (const i of touched) layer.store(i);
  }

  private axis(sheet: number, rows: boolean, a: number, b: number, px: number | null, hidden: boolean | null): void {
    const g = this.h.grid;
    if (sheet === g.sheetIndex) {
      g.setAxis(rows, a, b, px, hidden);
      return;
    }
    const host = this.h.host;
    const view = host.views()[sheet] ?? {};
    const key = rows ? 'rows' : 'cols';
    const old = view[key] ?? { sizes: [], hidden: [] };
    const sizes = new Map(old.sizes);
    const gone = new Set(old.hidden);
    const last = Math.min(b, a + (rows ? 10000 : 2000));
    for (let k = a; k <= last; k++) {
      if (px !== null) {
        sizes.set(k, px);
        gone.delete(k);
      }
      if (hidden !== null) {
        if (hidden) gone.add(k);
        else gone.delete(k);
      }
    }
    host.patchView(sheet, { [key]: { ...old, sizes: [...sizes], hidden: [...gone] } });
  }

  private quote(sheet: string): string {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`;
  }

  private tableLine(t: NonNullable<ReturnType<typeof parseTable>>, p: { name?: string; area?: [number, number, number, number]; flags?: string; style?: string; cols?: string[] }): string {
    const area = p.area ?? t.area;
    const cols = p.cols ?? t.cols;
    const n = cols.length;
    const pad = (list: string[]) => Array.from({ length: n }, (_, k) => list[k] ?? '');
    return [p.name ?? t.name, area.join(','), p.flags ?? t.flags, p.style ?? t.style, String(n), ...cols, ...pad(t.calc), ...pad(t.kept), ...pad(t.types)].map(esc).join('\t');
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

  cancelStreams(): void {
    this.fnWorker?.postMessage({ t: 'cancel' } satisfies In);
  }

  async call(code: string, name: string, args: unknown[], stream?: (v: unknown) => void): Promise<unknown> {
    const w = (this.fnWorker ??= this.spawn());
    const id = ++this.seq;
    if (stream) {
      const feed = (ev: MessageEvent<Out>) => {
        if (ev.data.t === 'streamed' && ev.data.id === id) stream(ev.data.value);
      };
      w.addEventListener('message', feed);
    }
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
        else reject(Object.assign(new Error(m.error), { excelCode: m.code }));
      };
      w.addEventListener('message', on);
      w.postMessage({ t: 'call', id, code, name, args, stream: !!stream } satisfies In);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.fnWorker?.terminate();
    this.worker = null;
    this.fnWorker = null;
  }
}
