import type { EngineClient } from '../engine';
import type { Range } from '../grid/a1';
import type { CellDecor, Grid } from '../grid/grid';
import { frameOf } from './anchor';
import { parseRangeText, readMatrix } from './data';
import type { ObjectLayer } from './layer';
import { drawPicture } from './picture';
import { boundsOf, drawSparkGroup, groupKey, toSeries, type Bounds, type Series } from './sparkgroup';
import type { FloatObject } from './types';

const MAX_POINTS = 400;

export function boxRange(o: FloatObject): Range | null {
  const a = o.anchor;
  if (!a) return null;
  return { r0: a.r0, c0: a.c0, r1: Math.max(a.r0, a.dy1 === 0 ? a.r1 - 1 : a.r1), c1: Math.max(a.c0, a.dx1 === 0 ? a.c1 - 1 : a.c1) };
}

export class Decor implements CellDecor {
  private readonly series = new Map<string, Series>();
  private readonly groups = new Map<string, Bounds>();
  private timer = 0;
  private serial = 0;

  constructor(
    private readonly grid: Grid,
    private readonly eng: EngineClient,
    private readonly layer: ObjectLayer,
    private readonly book: () => number,
    private readonly names: () => string[],
  ) {
    grid.decor = this;
    layer.onData = () => this.schedule();
  }

  private items(): FloatObject[] {
    return this.layer.list().filter((o) => o.kind === 'spark' || (o.kind === 'picture' && o.inCell));
  }

  private cellOf(o: FloatObject): [number, number] {
    if (o.anchor) return [o.anchor.r0, o.anchor.c0];
    return [this.grid.rows.indexAt(o.y), this.grid.cols.indexAt(o.x)];
  }

  cells(r0: number, r1: number, c0: number, c1: number): [number, number][] {
    const out: [number, number][] = [];
    for (const o of this.items()) {
      const [r, c] = this.cellOf(o);
      if (r >= r0 && r <= r1 && c >= c0 && c <= c1) out.push([r, c]);
    }
    return out;
  }

  paint(ctx: CanvasRenderingContext2D, r: number, c: number, x: number, y: number, w: number, h: number): void {
    for (const o of this.items()) {
      const [rr, cc] = this.cellOf(o);
      if (rr !== r || cc !== c) continue;
      if (o.kind === 'picture' && o.picture) {
        drawPicture(ctx, { sizing: 0, height: null, width: null, alt: o.alt ?? o.picture.name, source: o.picture.src }, x, y, w, h, () => this.grid.paint(), '#888888');
      } else if (o.spark) {
        const vals = this.series.get(o.id);
        if (vals) drawSparkGroup(ctx, o.spark, vals, x, y, w, h, this.groups.get(groupKey(o.spark)) ?? null);
      }
    }
  }

  schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.load(), 60);
  }

  private async load(): Promise<void> {
    const mine = ++this.serial;
    const list = this.layer.list();
    const byId = new Map(list.map((o) => [o.id, o]));
    const next = new Map<string, Series>();
    for (const o of list) {
      if (o.kind !== 'spark' || !o.spark) continue;
      let sheet = this.grid.sheetIndex;
      let range: Range | null = null;
      if (o.spark.dataId) {
        const box = byId.get(o.spark.dataId);
        range = box ? boxRange(box) : null;
      } else if (o.spark.data) {
        const ref = parseRangeText(o.spark.data);
        if (ref) {
          range = ref.range;
          if (ref.sheet) sheet = this.names().indexOf(ref.sheet);
        }
      }
      if (!range || sheet < 0) continue;
      const clipped: Range = { ...range, r1: Math.min(range.r1, range.r0 + MAX_POINTS - 1), c1: Math.min(range.c1, range.c0 + MAX_POINTS - 1) };
      const m = await readMatrix(this.eng, this.book(), sheet, clipped);
      next.set(o.id, toSeries(m.flat(), o.spark.empty));
    }
    if (mine !== this.serial) return;
    this.series.clear();
    for (const [k, v] of next) this.series.set(k, v);
    this.groups.clear();
    const spread = new Map<string, Bounds>();
    for (const o of list) {
      if (o.kind !== 'spark' || !o.spark) continue;
      const b = boundsOf(next.get(o.id) ?? []);
      if (!b) continue;
      const k = groupKey(o.spark);
      const g = spread.get(k);
      spread.set(k, g ? { lo: Math.min(g.lo, b.lo), hi: Math.max(g.hi, b.hi) } : b);
    }
    for (const [k, v] of spread) this.groups.set(k, v);
    this.grid.paint();
  }

  frame(o: FloatObject): { x: number; y: number; w: number; h: number } {
    return o.anchor ? frameOf(this.grid.rows, this.grid.cols, o.anchor) : o;
  }
}
