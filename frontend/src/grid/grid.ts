import type { Cell, Changed, Dir, Effect, EngineClient, Shift } from '../engine';
import { Axis, type AxisState } from './axis';
import { MAX_COLS, MAX_ROWS, a1, colName, parseRef, rangeText, type Range } from './a1';
import { fillSeries } from './fill';

export interface SheetView {
  rows?: AxisState;
  cols?: AxisState;
  fr?: number;
  fc?: number;
  zoom?: number;
  color?: string;
  split?: [number, number] | null;
}

export type MenuKind = 'rows' | 'cols' | 'cells';

type Pane = 0 | 1;
type Band = [number, number, number, number, Pane];

export const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const HEAD_H = 24;
const HEAD_W = 60;
const KEY = (r: number, c: number) => r * MAX_COLS + c;
const NUMERIC = /^-?\$?-?(\d[\d,]*\.?\d*|\.\d+)(e[+-]?\d+)?%?$|^\d{1,2}\/\d{1,2}\/\d{4}( \d{1,2}:\d{2}(:\d{2})?( [AP]M)?)?$|^\d{1,2}:\d{2}(:\d{2})?( [AP]M)?$/i;
const ERRORS = new Set(['#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#N/A', '#NUM!', '#NULL!', '#ERROR!']);
const OUTLINE_PAD = 3;
const OUTLINE_STEP = 16;

interface Palette {
  bg: string;
  grid: string;
  headBg: string;
  headFg: string;
  headOn: string;
  fg: string;
  sel: string;
  edge: string;
  frozen: string;
}

export interface GridEvents {
  onActive(text: string, ref: string, range: Range): void;
  onHistory(undo: boolean, redo: boolean): void;
  onChanged(changes: Changed[]): void;
  onSheet(sheet: number): SheetView;
  onShift(shift: Shift): void;
  onView(sheet: number, view: SheetView): void;
  onMenu(kind: MenuKind, x: number, y: number): void;
  onGoto(): void;
}

export class Grid {
  readonly rows = new Axis(MAX_ROWS, 24, 8);
  readonly cols = new Axis(MAX_COLS, 100, 12);
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly og: HTMLCanvasElement;
  private readonly octx: CanvasRenderingContext2D;
  private gw = 0;
  private gh = 0;
  readonly editor: HTMLTextAreaElement;
  editorHook: ((e: KeyboardEvent) => boolean) | null = null;
  private readonly cache = new Map<number, string>();
  private readonly fx = new Map<number, string>();
  private wins: (Range | null)[] = [null, null, null, null];
  private pendingWins: (Range | null)[] = [null, null, null, null];
  private sh = 0;
  private sw = 0;
  private syT = 0;
  private sxL = 0;
  private pr: Pane = 1;
  private pc: Pane = 1;
  private apr: Pane = 1;
  private apc: Pane = 1;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private sx = 0;
  private sy = 0;
  private fr = 0;
  private fc = 0;
  private ar = 0;
  private ac = 0;
  private fr2 = 0;
  private fc2 = 0;
  private editing = false;
  private tabStart = -1;
  private raf = 0;
  private queue: Promise<void> = Promise.resolve();
  private sheet = 0;
  private z = 1;
  private viewColor: string | undefined;
  private fillTo: { r: number; c: number } | null = null;
  private pal!: Palette;
  private drag: null | { kind: 'cells' | 'rows' | 'cols' | 'fill' | 'split-r' | 'split-c' } | { kind: 'resize-col' | 'resize-row'; index: number; start: number; size: number } = null;

  constructor(
    host: HTMLElement,
    private readonly engine: EngineClient,
    private book: number,
    private readonly events: GridEvents,
  ) {
    this.el = host;
    this.el.innerHTML = '<canvas class="fc-outline" aria-hidden="true"></canvas><canvas class="fc-grid-canvas"></canvas><textarea class="fc-editor" spellcheck="false" hidden aria-label="Cell editor"></textarea>';
    this.og = this.el.querySelector('.fc-outline')!;
    this.octx = this.og.getContext('2d')!;
    this.canvas = this.el.querySelector('.fc-grid-canvas')!;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.editor = this.el.querySelector('textarea')!;
    this.readPalette();
    new ResizeObserver(() => this.resize()).observe(this.el);
    new MutationObserver(() => {
      this.readPalette();
      this.paint();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme', 'class'] });
    this.bind();
    this.resize();
    this.announce();
  }

  private readPalette(): void {
    const s = getComputedStyle(document.documentElement);
    const v = (n: string) => s.getPropertyValue(n).trim();
    this.pal = {
      bg: v('--cell-bg') || v('--canvas-bg'),
      grid: v('--cell-grid') || v('--border-color'),
      headBg: v('--cell-head-bg') || v('--bg-secondary'),
      headFg: v('--cell-head-fg') || v('--text-secondary'),
      headOn: v('--accent-color-dim'),
      fg: v('--cell-fg') || v('--text-primary'),
      sel: v('--cell-select') || v('--accent-color-dim'),
      edge: v('--cell-select-edge') || v('--accent-color'),
      frozen: v('--border-light'),
    };
  }

  private resize(): void {
    const r = this.el.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.gw = gutter(this.rows);
    this.gh = gutter(this.cols);
    const fw = Math.max(1, Math.floor(r.width));
    const fh = Math.max(1, Math.floor(r.height));
    const cw = Math.max(1, fw - this.gw);
    const ch = Math.max(1, fh - this.gh);
    this.w = cw / this.z;
    this.h = ch / this.z;
    this.canvas.width = Math.floor(cw * this.dpr);
    this.canvas.height = Math.floor(ch * this.dpr);
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.canvas.style.left = `${this.gw}px`;
    this.canvas.style.top = `${this.gh}px`;
    this.og.hidden = !this.gw && !this.gh;
    if (!this.og.hidden) {
      this.og.width = Math.floor(fw * this.dpr);
      this.og.height = Math.floor(fh * this.dpr);
      this.og.style.width = `${fw}px`;
      this.og.style.height = `${fh}px`;
    }
    this.clampScroll();
    this.paintNow();
  }

  private frozenH(): number {
    return this.rows.offsetOf(this.fr);
  }

  private frozenW(): number {
    return this.cols.offsetOf(this.fc);
  }

  private th(): number {
    return this.sh || this.frozenH();
  }

  private lw(): number {
    return this.sw || this.frozenW();
  }

  private clampScroll(): void {
    const clamp = (v: number, max: number) => Math.min(Math.max(0, v), Math.max(0, max));
    const ty = this.rows.total();
    const tx = this.cols.total();
    if (this.sh) {
      this.sh = Math.min(this.sh, Math.max(0, this.h - HEAD_H - 24));
      this.syT = clamp(this.syT, ty - this.sh);
      this.sy = clamp(this.sy, ty - (this.h - HEAD_H - this.sh));
    } else this.sy = clamp(this.sy, ty - this.frozenH() - (this.h - HEAD_H - this.frozenH()));
    if (this.sw) {
      this.sw = Math.min(this.sw, Math.max(0, this.w - HEAD_W - 40));
      this.sxL = clamp(this.sxL, tx - this.sw);
      this.sx = clamp(this.sx, tx - (this.w - HEAD_W - this.sw));
    } else this.sx = clamp(this.sx, tx - this.frozenW() - (this.w - HEAD_W - this.frozenW()));
  }

  private y(r: number, pane: Pane = this.pr): number {
    if (this.sh) return pane ? HEAD_H + this.sh + this.rows.offsetOf(r) - this.sy : HEAD_H + this.rows.offsetOf(r) - this.syT;
    return r < this.fr ? HEAD_H + this.rows.offsetOf(r) : HEAD_H + this.rows.offsetOf(r) - this.sy;
  }

  private x(c: number, pane: Pane = this.pc): number {
    if (this.sw) return pane ? HEAD_W + this.sw + this.cols.offsetOf(c) - this.sx : HEAD_W + this.cols.offsetOf(c) - this.sxL;
    return c < this.fc ? HEAD_W + this.cols.offsetOf(c) : HEAD_W + this.cols.offsetOf(c) - this.sx;
  }

  private paneRows(p: Pane): [number, number] {
    const { rows, h } = this;
    if (this.sh) {
      const s = p ? this.sy : this.syT;
      const len = p ? h - HEAD_H - this.sh : this.sh;
      return [rows.indexAt(s), Math.min(MAX_ROWS - 1, rows.indexAt(s + len) + 1)];
    }
    if (!p) return [0, this.fr - 1];
    return [rows.indexAt(this.frozenH() + this.sy), Math.min(MAX_ROWS - 1, rows.indexAt(this.sy + h - HEAD_H) + 1)];
  }

  private paneCols(p: Pane): [number, number] {
    const { cols, w } = this;
    if (this.sw) {
      const s = p ? this.sx : this.sxL;
      const len = p ? w - HEAD_W - this.sw : this.sw;
      return [cols.indexAt(s), Math.min(MAX_COLS - 1, cols.indexAt(s + len) + 1)];
    }
    if (!p) return [0, this.fc - 1];
    return [cols.indexAt(this.frozenW() + this.sx), Math.min(MAX_COLS - 1, cols.indexAt(this.sx + w - HEAD_W) + 1)];
  }

  private bands(): [Band[], Band[]] {
    const top = this.th();
    const left = this.lw();
    const rowSets: Band[] = [];
    const colSets: Band[] = [];
    if (this.sh || this.fr) rowSets.push([...this.paneRows(0), HEAD_H, HEAD_H + top, 0]);
    rowSets.push([...this.paneRows(1), HEAD_H + top, this.h, 1]);
    if (this.sw || this.fc) colSets.push([...this.paneCols(0), HEAD_W, HEAD_W + left, 0]);
    colSets.push([...this.paneCols(1), HEAD_W + left, this.w, 1]);
    return [rowSets, colSets];
  }

  private dropWindows(): void {
    this.cache.clear();
    this.fx.clear();
    this.wins = [null, null, null, null];
    this.pendingWins = [null, null, null, null];
  }

  private ensureData(v: Range, slot: number): void {
    if (this.book < 0 || v.r1 < v.r0 || v.c1 < v.c0) return;
    const inside = (w: Range | null) => !!w && v.r0 >= w.r0 && v.r1 <= w.r1 && v.c0 >= w.c0 && v.c1 <= w.c1;
    if (this.wins.some(inside) || inside(this.pendingWins[slot])) return;
    const rows = v.r1 - v.r0 + 1;
    const cols = v.c1 - v.c0 + 1;
    const want: Range = {
      r0: Math.max(0, v.r0 - rows * 2),
      r1: Math.min(MAX_ROWS - 1, v.r1 + rows * 2),
      c0: Math.max(0, v.c0 - cols),
      c1: Math.min(MAX_COLS - 1, v.c1 + cols),
    };
    this.pendingWins[slot] = want;
    const book = this.book;
    const sheet = this.sheet;
    void this.engine.read(book, want.r0, want.c0, want.r1, want.c1, sheet).then((cells: Cell[]) => {
      if (this.pendingWins[slot] !== want || this.book !== book || this.sheet !== sheet) return;
      this.pendingWins[slot] = null;
      const old = this.wins[slot];
      this.wins[slot] = want;
      if (old) {
        const keep = (r: number, c: number) => this.wins.some((w) => !!w && r >= w.r0 && r <= w.r1 && c >= w.c0 && c <= w.c1);
        for (const k of [...this.cache.keys()]) {
          const r = Math.floor(k / MAX_COLS);
          const c = k % MAX_COLS;
          if (r >= old.r0 && r <= old.r1 && c >= old.c0 && c <= old.c1 && !keep(r, c)) {
            this.cache.delete(k);
            this.fx.delete(k);
          }
        }
      }
      for (const k of [...this.cache.keys()]) {
        const r = Math.floor(k / MAX_COLS);
        const c = k % MAX_COLS;
        if (r >= want.r0 && r <= want.r1 && c >= want.c0 && c <= want.c1) {
          this.cache.delete(k);
          this.fx.delete(k);
        }
      }
      for (const [r, c, t, f] of cells) {
        this.cache.set(KEY(r, c), t);
        if (f !== undefined) this.fx.set(KEY(r, c), f);
      }
      if (!this.editing && this.ar >= want.r0 && this.ar <= want.r1 && this.ac >= want.c0 && this.ac <= want.c1) this.announce();
      this.paint();
    });
  }

  paint(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.paintNow();
    });
  }

  private paintNow(): void {
    const { ctx, pal, w, h } = this;
    const [rowSets, colSets] = this.bands();
    for (const [ra, rb, , , pr] of rowSets) {
      for (const [ca, cb, , , pc] of colSets) this.ensureData({ r0: ra, r1: rb, c0: ca, c1: cb }, pr * 2 + pc);
    }
    ctx.setTransform(this.dpr * this.z, 0, 0, this.dpr * this.z, 0, 0);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, w, h);
    const fh = this.frozenH();
    const fw = this.frozenW();
    ctx.font = '13px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    for (const [ra, rb, ytop, ybot, pr] of rowSets) {
      for (const [ca, cb, xl, xr, pc] of colSets) {
        this.pr = pr;
        this.pc = pc;
        ctx.save();
        ctx.beginPath();
        ctx.rect(xl, ytop, xr - xl, ybot - ytop);
        ctx.clip();
        this.paintCells(ra, rb, ca, cb);
        ctx.restore();
      }
    }
    this.paintSelection(rowSets, colSets);
    this.paintHeaders(rowSets, colSets);
    this.pr = this.apr;
    this.pc = this.apc;
    ctx.strokeStyle = pal.frozen;
    ctx.lineWidth = 2;
    if (this.fr) this.line(HEAD_W, HEAD_H + fh, w, HEAD_H + fh);
    if (this.fc) this.line(HEAD_W + fw, HEAD_H, HEAD_W + fw, h);
    ctx.fillStyle = pal.frozen;
    if (this.sh) ctx.fillRect(0, HEAD_H + this.sh - 2, w, 4);
    if (this.sw) ctx.fillRect(HEAD_W + this.sw - 2, 0, 4, h);
    if (!this.og.hidden) this.paintOutline();
    if (this.editing) this.placeEditor();
  }

  private paintOutline(): void {
    const { octx: o, pal, gw, gh, z } = this;
    const W = this.og.width / this.dpr;
    const H = this.og.height / this.dpr;
    o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    o.fillStyle = pal.headBg;
    o.fillRect(0, 0, W, H);
    o.strokeStyle = pal.grid;
    o.lineWidth = 1;
    o.beginPath();
    if (gw) {
      o.moveTo(gw - 0.5, 0);
      o.lineTo(gw - 0.5, H);
    }
    if (gh) {
      o.moveTo(0, gh - 0.5);
      o.lineTo(W, gh - 0.5);
    }
    o.stroke();
    o.font = '600 10px Inter, system-ui, sans-serif';
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    const button = (cx: number, cy: number, label: string) => {
      o.fillStyle = pal.bg;
      o.fillRect(cx - 6.5, cy - 6.5, 13, 13);
      o.strokeStyle = pal.headFg;
      o.strokeRect(cx - 6.5, cy - 6.5, 13, 13);
      o.fillStyle = pal.headFg;
      o.fillText(label, cx, cy + 0.5);
    };
    const levels = (axis: Axis, along: 'x' | 'y') => {
      const n = axis.maxLevel() + 1;
      for (let i = 0; i < n; i++) {
        const p = OUTLINE_PAD + i * OUTLINE_STEP + OUTLINE_STEP / 2;
        if (along === 'x') button(p, gh + (HEAD_H * z) / 2, String(i + 1));
        else button(gw + (HEAD_W * z) / 2, p, String(i + 1));
      }
    };
    if (gw) {
      levels(this.rows, 'x');
      for (const pane of (this.sh ? [0, 1] : [1]) as Pane[]) {
        const y0 = gh + (HEAD_H + (this.sh && pane ? this.sh : 0)) * z;
        const y1 = this.sh && !pane ? gh + (HEAD_H + this.sh) * z : H;
        o.save();
        o.beginPath();
        o.rect(0, y0, gw, y1 - y0);
        o.clip();
        for (const r of this.rows.runs()) {
          const cx = OUTLINE_PAD + (r.level - 1) * OUTLINE_STEP + OUTLINE_STEP / 2;
          const top = gh + this.y(r.a, pane) * z;
          const end = r.b + 1 < MAX_ROWS ? r.b + 1 : r.b;
          const by = gh + (this.y(end, pane) + this.rows.size(end) / 2) * z;
          if (by < gh || top > H) continue;
          if (!this.rows.isFolded(r)) {
            o.strokeStyle = pal.headFg;
            o.beginPath();
            o.moveTo(cx - 4, top + 2.5);
            o.lineTo(cx + 0.5, top + 2.5);
            o.lineTo(cx + 0.5, by - 7);
            o.stroke();
          }
          button(cx, by, this.rows.isFolded(r) ? '+' : '−');
        }
        o.restore();
      }
    }
    if (gh) {
      levels(this.cols, 'y');
      for (const pane of (this.sw ? [0, 1] : [1]) as Pane[]) {
        const x0 = gw + (HEAD_W + (this.sw && pane ? this.sw : 0)) * z;
        const x1 = this.sw && !pane ? gw + (HEAD_W + this.sw) * z : W;
        o.save();
        o.beginPath();
        o.rect(x0, 0, x1 - x0, gh);
        o.clip();
        for (const r of this.cols.runs()) {
          const cy = OUTLINE_PAD + (r.level - 1) * OUTLINE_STEP + OUTLINE_STEP / 2;
          const left = gw + this.x(r.a, pane) * z;
          const end = r.b + 1 < MAX_COLS ? r.b + 1 : r.b;
          const bx = gw + (this.x(end, pane) + this.cols.size(end) / 2) * z;
          if (bx < gw || left > W) continue;
          if (!this.cols.isFolded(r)) {
            o.strokeStyle = pal.headFg;
            o.beginPath();
            o.moveTo(left + 2.5, cy - 4);
            o.lineTo(left + 2.5, cy + 0.5);
            o.lineTo(bx - 7, cy + 0.5);
            o.stroke();
          }
          button(bx, cy, this.cols.isFolded(r) ? '+' : '−');
        }
        o.restore();
      }
    }
  }

  private outlineHit(px: number, py: number): void {
    const { gw, gh, z } = this;
    const slot = (p: number) => Math.floor((p - OUTLINE_PAD) / OUTLINE_STEP);
    const near = (a: number, b: number) => Math.abs(a - b) <= 8;
    let axis: Axis | null = null;
    let done = false;
    if (px < gw && py >= gh && py < gh + HEAD_H * z) {
      const n = slot(px);
      if (n >= 0 && n <= this.rows.maxLevel()) {
        this.rows.showLevel(n + 1);
        axis = this.rows;
        done = true;
      }
    } else if (py < gh && px >= gw && px < gw + HEAD_W * z) {
      const n = slot(py);
      if (n >= 0 && n <= this.cols.maxLevel()) {
        this.cols.showLevel(n + 1);
        axis = this.cols;
        done = true;
      }
    } else if (px < gw && py > gh) {
      const level = slot(px) + 1;
      const pane = this.hit(HEAD_W, (py - gh) / z).pr;
      for (const r of this.rows.runs()) {
        if (r.level !== level) continue;
        const end = r.b + 1 < MAX_ROWS ? r.b + 1 : r.b;
        if (near(py, gh + (this.y(end, pane) + this.rows.size(end) / 2) * z)) {
          this.rows.fold(r, !this.rows.isFolded(r));
          axis = this.rows;
          done = true;
          break;
        }
      }
    } else if (py < gh && px > gw) {
      const level = slot(py) + 1;
      const pane = this.hit((px - gw) / z, HEAD_H).pc;
      for (const r of this.cols.runs()) {
        if (r.level !== level) continue;
        const end = r.b + 1 < MAX_COLS ? r.b + 1 : r.b;
        if (near(px, gw + (this.x(end, pane) + this.cols.size(end) / 2) * z)) {
          this.cols.fold(r, !this.cols.isFolded(r));
          axis = this.cols;
          done = true;
          break;
        }
      }
    }
    if (!done || !axis) return;
    if (axis === this.rows) this.ar = this.fr2 = this.rows.nextVisible(this.ar, 1);
    else this.ac = this.fc2 = this.cols.nextVisible(this.ac, 1);
    this.clampScroll();
    this.emitView();
    this.announce();
    this.paint();
  }

  group(rows: boolean, d: 1 | -1): void {
    const s = this.sel();
    const changed = rows
      ? this.rows.group(s.r0, Math.min(s.r1, s.r0 + 100000), d)
      : this.cols.group(s.c0, Math.min(s.c1, s.c0 + 16384), d);
    if (!changed) return;
    this.resize();
    this.emitView();
  }

  groupAuto(d: 1 | -1): void {
    this.group(!this.wholeCols(), d);
  }

  private line(x0: number, y0: number, x1: number, y1: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.stroke();
  }

  private paintCells(r0: number, r1: number, c0: number, c1: number): void {
    const { ctx, pal } = this;
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = r0; r <= r1 + 1; r++) {
      const yy = Math.round(this.y(r)) + 0.5;
      ctx.moveTo(this.x(c0), yy);
      ctx.lineTo(this.x(c1 + 1), yy);
    }
    for (let c = c0; c <= c1 + 1; c++) {
      const xx = Math.round(this.x(c)) + 0.5;
      ctx.moveTo(xx, this.y(r0));
      ctx.lineTo(xx, this.y(r1 + 1));
    }
    ctx.stroke();
    ctx.fillStyle = pal.fg;
    for (let r = r0; r <= r1; r++) {
      const yy = this.y(r);
      const rh = this.rows.size(r);
      if (!rh) continue;
      for (let c = c0; c <= c1; c++) {
        const t = this.cache.get(KEY(r, c));
        if (!t) continue;
        const xx = this.x(c);
        const cw = this.cols.size(c);
        if (!cw) continue;
        const text = t.split('\n', 1)[0];
        ctx.save();
        ctx.beginPath();
        ctx.rect(xx + 1, yy, cw - 2, rh);
        ctx.clip();
        if (NUMERIC.test(text)) {
          ctx.textAlign = 'right';
          ctx.fillText(text, xx + cw - 5, yy + rh / 2);
        } else if (text === 'TRUE' || text === 'FALSE' || ERRORS.has(text)) {
          ctx.textAlign = 'center';
          ctx.fillText(text, xx + cw / 2, yy + rh / 2);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText(text, xx + 5, yy + rh / 2);
        }
        ctx.restore();
      }
    }
  }

  private sel(): Range {
    return { r0: Math.min(this.ar, this.fr2), r1: Math.max(this.ar, this.fr2), c0: Math.min(this.ac, this.fc2), c1: Math.max(this.ac, this.fc2) };
  }

  private paintSelection(rowSets: Band[], colSets: Band[]): void {
    const { ctx, pal } = this;
    const s = this.sel();
    for (const [, , ytop, ybot, pr] of rowSets) {
      for (const [, , xl, xr, pc] of colSets) {
        this.pr = pr;
        this.pc = pc;
        ctx.save();
        ctx.beginPath();
        ctx.rect(xl, ytop, xr - xl, ybot - ytop);
        ctx.clip();
        const x0 = this.x(s.c0);
        const y0 = this.y(s.r0);
        const x1 = this.x(s.c1 + 1);
        const y1 = this.y(s.r1 + 1);
        if (s.r0 !== s.r1 || s.c0 !== s.c1) {
          ctx.fillStyle = pal.sel;
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
          ctx.fillStyle = pal.bg;
          const ax = this.x(this.ac);
          const ay = this.y(this.ar);
          ctx.globalAlpha = 0.85;
          ctx.fillRect(ax + 1, ay + 1, this.cols.size(this.ac) - 1, this.rows.size(this.ar) - 1);
          ctx.globalAlpha = 1;
          const t = this.cache.get(KEY(this.ar, this.ac));
          if (t) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(ax + 1, ay, this.cols.size(this.ac) - 2, this.rows.size(this.ar));
            ctx.clip();
            this.paintCells(this.ar, this.ar, this.ac, this.ac);
            ctx.restore();
          }
        }
        ctx.strokeStyle = pal.edge;
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
        const f = this.fillRange();
        if (f) {
          ctx.setLineDash([4, 3]);
          ctx.lineWidth = 1;
          const fx0 = this.x(f.c0);
          const fy0 = this.y(f.r0);
          ctx.strokeRect(fx0 + 0.5, fy0 + 0.5, this.x(f.c1 + 1) - fx0 - 1, this.y(f.r1 + 1) - fy0 - 1);
          ctx.setLineDash([]);
        }
        if (s.r1 < MAX_ROWS - 1 || s.c1 < MAX_COLS - 1) {
          ctx.fillStyle = pal.bg;
          ctx.fillRect(x1 - 4.5, y1 - 4.5, 8, 8);
          ctx.fillStyle = pal.edge;
          ctx.fillRect(x1 - 3.5, y1 - 3.5, 6, 6);
        }
        ctx.restore();
      }
    }
  }

  private paintHeaders(rowSets: Band[], colSets: Band[]): void {
    const { ctx, pal, w, h } = this;
    const s = this.sel();
    ctx.fillStyle = pal.headBg;
    ctx.fillRect(0, 0, w, HEAD_H);
    ctx.fillRect(0, 0, HEAD_W, h);
    ctx.font = '11px "JetBrains Mono", ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    for (const [ca, cb, xl, xr, pc] of colSets) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(xl, 0, xr - xl, HEAD_H);
      ctx.clip();
      for (let c = ca; c <= cb; c++) {
        const xx = this.x(c, pc);
        const cw = this.cols.size(c);
        if (!cw) continue;
        if (c >= s.c0 && c <= s.c1) {
          ctx.fillStyle = pal.headOn;
          ctx.fillRect(xx, 0, cw, HEAD_H);
        }
        ctx.fillStyle = pal.headFg;
        ctx.fillText(colName(c), xx + cw / 2, HEAD_H / 2);
        ctx.strokeStyle = pal.grid;
        ctx.lineWidth = 1;
        this.line(Math.round(xx + cw) + 0.5, 0, Math.round(xx + cw) + 0.5, HEAD_H);
      }
      ctx.restore();
    }
    for (const [ra, rb, ytop, ybot, pr] of rowSets) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, ytop, HEAD_W, ybot - ytop);
      ctx.clip();
      for (let r = ra; r <= rb; r++) {
        const yy = this.y(r, pr);
        const rh = this.rows.size(r);
        if (!rh) continue;
        if (r >= s.r0 && r <= s.r1) {
          ctx.fillStyle = pal.headOn;
          ctx.fillRect(0, yy, HEAD_W, rh);
        }
        ctx.fillStyle = pal.headFg;
        ctx.fillText(String(r + 1), HEAD_W / 2, yy + rh / 2);
        ctx.strokeStyle = pal.grid;
        ctx.lineWidth = 1;
        this.line(0, Math.round(yy + rh) + 0.5, HEAD_W, Math.round(yy + rh) + 0.5);
      }
      ctx.restore();
    }
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    this.line(0, HEAD_H + 0.5, w, HEAD_H + 0.5);
    this.line(HEAD_W + 0.5, 0, HEAD_W + 0.5, h);
  }

  private hit(px: number, py: number): { row: number; col: number; pr: Pane; pc: Pane } {
    const ly = py - HEAD_H;
    const lx = px - HEAD_W;
    const pr: Pane = (this.sh || this.fr) && ly < this.th() ? 0 : 1;
    const pc: Pane = (this.sw || this.fc) && lx < this.lw() ? 0 : 1;
    let row: number;
    let col: number;
    if (this.sh) row = this.rows.indexAt(pr ? ly - this.sh + this.sy : Math.max(0, ly) + this.syT);
    else row = ly < this.frozenH() ? this.rows.indexAt(Math.max(0, ly)) : this.rows.indexAt(ly + this.sy);
    if (this.sw) col = this.cols.indexAt(pc ? lx - this.sw + this.sx : Math.max(0, lx) + this.sxL);
    else col = lx < this.frozenW() ? this.cols.indexAt(Math.max(0, lx)) : this.cols.indexAt(lx + this.sx);
    return { row: Math.min(MAX_ROWS - 1, row), col: Math.min(MAX_COLS - 1, col), pr, pc };
  }

  private splitBar(px: number, py: number): 'split-r' | 'split-c' | null {
    if (this.sh && Math.abs(py - (HEAD_H + this.sh)) <= 3) return 'split-r';
    if (this.sw && Math.abs(px - (HEAD_W + this.sw)) <= 3) return 'split-c';
    return null;
  }

  private boundary(px: number, py: number): { kind: 'col' | 'row'; index: number } | null {
    if (py < HEAD_H && px > HEAD_W) {
      const { col, pc } = this.hit(px, HEAD_H);
      const right = this.x(col, pc) + this.cols.size(col);
      if (Math.abs(px - right) <= 4) return { kind: 'col', index: col };
      if (col > 0 && Math.abs(px - this.x(col, pc)) <= 4) return { kind: 'col', index: col - 1 };
    }
    if (px < HEAD_W && py > HEAD_H) {
      const { row, pr } = this.hit(HEAD_W, py);
      const bottom = this.y(row, pr) + this.rows.size(row);
      if (Math.abs(py - bottom) <= 3) return { kind: 'row', index: row };
      if (row > 0 && Math.abs(py - this.y(row, pr)) <= 3) return { kind: 'row', index: row - 1 };
    }
    return null;
  }

  select(r0: number, c0: number, r1 = r0, c1 = c0, reveal = true): void {
    this.tabStart = -1;
    this.ar = clampR(r0);
    this.ac = clampC(c0);
    this.fr2 = clampR(r1);
    this.fc2 = clampC(c1);
    if (reveal) this.reveal(this.fr2, this.fc2);
    this.announce();
    this.paint();
  }

  private extendTo(r: number, c: number): void {
    this.fr2 = clampR(r);
    this.fc2 = clampC(c);
    const allRows = this.ar === 0 && this.fr2 === MAX_ROWS - 1;
    const allCols = this.ac === 0 && this.fc2 === MAX_COLS - 1;
    this.reveal(allRows ? -1 : this.fr2, allCols ? -1 : this.fc2);
    this.announce();
    this.paint();
  }

  reveal(r: number, c: number): void {
    const fit = (s: number, a: number, b: number, len: number) => (a < s ? a : b > s + len ? b - len : s);
    if (r >= 0 && this.sh) {
      const a = this.rows.offsetOf(r);
      const b = a + this.rows.size(r);
      if (this.apr) this.sy = fit(this.sy, a, b, this.h - HEAD_H - this.sh);
      else this.syT = fit(this.syT, a, b, this.sh);
    } else if (r >= this.fr && r >= 0) {
      const top = this.rows.offsetOf(r) - this.frozenH();
      this.sy = fit(this.sy, top, top + this.rows.size(r), this.h - HEAD_H - this.frozenH());
    }
    if (c >= 0 && this.sw) {
      const a = this.cols.offsetOf(c);
      const b = a + this.cols.size(c);
      if (this.apc) this.sx = fit(this.sx, a, b, this.w - HEAD_W - this.sw);
      else this.sxL = fit(this.sxL, a, b, this.sw);
    } else if (c >= this.fc && c >= 0) {
      const left = this.cols.offsetOf(c) - this.frozenW();
      this.sx = fit(this.sx, left, left + this.cols.size(c), this.w - HEAD_W - this.frozenW());
    }
    this.clampScroll();
  }

  private announce(): void {
    const k = KEY(this.ar, this.ac);
    this.events.onActive(this.fx.get(k) ?? this.cache.get(k) ?? '', rangeText(this.sel()), this.sel());
  }

  goTo(ref: string): boolean {
    const r = parseRef(ref);
    if (!r) return false;
    this.select(r.r0, r.c0, r.r1, r.c1, false);
    this.reveal(r.r0, r.c0);
    this.paint();
    this.focus();
    return true;
  }

  focus(): void {
    this.el.focus({ preventScroll: true });
  }

  freeze(rows: number, cols: number): void {
    this.fr = Math.max(0, Math.min(rows, 1000));
    this.fc = Math.max(0, Math.min(cols, 200));
    this.sh = this.sw = this.syT = this.sxL = 0;
    this.pr = this.pc = this.apr = this.apc = 1;
    this.sx = 0;
    this.sy = 0;
    this.clampScroll();
    this.emitView();
    this.paint();
  }

  freezeAtActive(): void {
    this.freeze(this.ar, this.ac);
  }

  get split(): boolean {
    return !!(this.sh || this.sw);
  }

  toggleSplit(): void {
    if (this.sh || this.sw) {
      if (this.sh) this.sy = this.syT;
      if (this.sw) this.sx = this.sxL;
      this.sh = this.sw = this.syT = this.sxL = 0;
    } else {
      this.fr = this.fc = 0;
      let sh = this.y(this.ar) - HEAD_H;
      let sw = this.x(this.ac) - HEAD_W;
      const inView = sh >= 0 && sw >= 0 && sh < this.h - HEAD_H && sw < this.w - HEAD_W;
      if (!inView || (sh <= 0 && sw <= 0)) {
        sh = Math.round((this.h - HEAD_H) / 2);
        sw = Math.round((this.w - HEAD_W) / 2);
      }
      this.sh = Math.max(0, sh);
      this.sw = Math.max(0, sw);
      this.syT = this.sy;
      this.sxL = this.sx;
      if (this.sh) this.sy += this.sh;
      if (this.sw) this.sx += this.sw;
    }
    this.pr = this.pc = this.apr = this.apc = 1;
    this.clampScroll();
    this.emitView();
    this.paint();
  }

  show(book: number, sheet: number, view: SheetView = {}): void {
    if (this.editing) {
      this.editing = false;
      this.editor.hidden = true;
    }
    this.book = book;
    this.sheet = sheet;
    this.dropWindows();
    this.rows.restore(view.rows);
    this.cols.restore(view.cols);
    this.fr = view.fr ?? 0;
    this.fc = view.fc ?? 0;
    this.sh = view.split?.[0] ?? 0;
    this.sw = view.split?.[1] ?? 0;
    this.syT = this.sxL = 0;
    this.pr = this.pc = this.apr = this.apc = 1;
    this.z = view.zoom ?? 1;
    this.viewColor = view.color;
    this.ar = this.fr2 = this.rows.nextVisible(0, 1);
    this.ac = this.fc2 = this.cols.nextVisible(0, 1);
    this.sx = this.sy = 0;
    this.resize();
    this.announce();
    this.paint();
  }

  get sheetIndex(): number {
    return this.sheet;
  }

  patch(changed: Changed[]): void {
    let hit = false;
    for (const [s, r, c, t, f] of changed) {
      if (s !== this.sheet) continue;
      const k = KEY(r, c);
      if (this.cache.get(k) === t && this.fx.get(k) === f) continue;
      hit = true;
      if (t || f !== undefined) this.cache.set(k, t);
      else this.cache.delete(k);
      if (f !== undefined) this.fx.set(k, f);
      else this.fx.delete(k);
    }
    if (!hit) return;
    this.announce();
    this.paint();
  }

  private async commitEdits(changed: Changed[]): Promise<void> {
    if (changed.length && changed.every(([s]) => s !== this.sheet)) {
      this.show(this.book, changed[0][0], this.events.onSheet(changed[0][0]));
    }
    for (const [s, r, c, t, f] of changed) {
      if (s !== this.sheet) continue;
      if (t || f !== undefined) this.cache.set(KEY(r, c), t);
      else this.cache.delete(KEY(r, c));
      if (f !== undefined) this.fx.set(KEY(r, c), f);
      else this.fx.delete(KEY(r, c));
    }
    if (changed.length) this.events.onChanged(changed);
    const hst = await this.engine.history(this.book);
    this.events.onHistory(hst.undo, hst.redo);
    this.announce();
    this.paint();
  }

  async setActive(raw: string): Promise<void> {
    await this.commitEdits(await this.engine.apply(this.book, [[this.ar, this.ac, raw]], this.sheet));
  }

  async clearSelection(): Promise<void> {
    const s = this.sel();
    const area = (s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1);
    let edits: [number, number, string][];
    if (area <= 4096) {
      edits = [];
      for (let r = s.r0; r <= s.r1; r++) for (let c = s.c0; c <= s.c1; c++) edits.push([r, c, '']);
    } else {
      edits = (await this.engine.read(this.book, s.r0, s.c0, s.r1, s.c1, this.sheet)).map(([r, c]) => [r, c, '']);
    }
    if (edits.length) await this.commitEdits(await this.engine.apply(this.book, edits, this.sheet));
  }

  async undo(): Promise<void> {
    await this.applyEffect(await this.engine.undo(this.book));
  }

  async redo(): Promise<void> {
    await this.applyEffect(await this.engine.redo(this.book));
  }

  private async applyEffect(e: Effect): Promise<void> {
    if (e.shift) this.afterShift(e.shift);
    await this.commitEdits(e.changes);
  }

  private afterShift(s: Shift): void {
    if (s.sheet !== this.sheet) {
      this.show(this.book, s.sheet, this.events.onSheet(s.sheet));
    }
    const axis = s.rows ? this.rows : this.cols;
    const before = gutter(axis);
    axis.shift(s.at, s.delta);
    if (gutter(axis) !== before) this.resize();
    this.dropWindows();
    this.events.onShift(s);
    this.emitView();
    this.paint();
  }

  private wholeRows(): boolean {
    const s = this.sel();
    return s.c0 === 0 && s.c1 === MAX_COLS - 1;
  }

  private wholeCols(): boolean {
    const s = this.sel();
    return s.r0 === 0 && s.r1 === MAX_ROWS - 1 && !this.wholeRows();
  }

  async insert(rows: boolean, after = false): Promise<void> {
    const s = this.sel();
    const n = rows ? s.r1 - s.r0 + 1 : s.c1 - s.c0 + 1;
    const at = rows ? (after ? s.r1 + 1 : s.r0) : (after ? s.c1 + 1 : s.c0);
    if (n > 10000) return;
    const sh = await this.engine.shift(this.book, this.sheet, rows, Math.min(at, rows ? MAX_ROWS - 1 : MAX_COLS - 1), n, true);
    this.afterShift(sh);
    await this.refreshHistory();
  }

  async remove(rows: boolean): Promise<void> {
    const s = this.sel();
    const n = rows ? s.r1 - s.r0 + 1 : s.c1 - s.c0 + 1;
    const sh = await this.engine.shift(this.book, this.sheet, rows, rows ? s.r0 : s.c0, n, false);
    this.afterShift(sh);
    await this.refreshHistory();
  }

  async insertAuto(): Promise<void> {
    await this.insert(!this.wholeCols());
  }

  async removeAuto(): Promise<void> {
    await this.remove(!this.wholeCols());
  }

  hide(rows: boolean, on: boolean): void {
    const s = this.sel();
    if (rows) this.rows.setHidden(s.r0, Math.min(s.r1, s.r0 + 100000), on);
    else this.cols.setHidden(s.c0, Math.min(s.c1, s.c0 + 16384), on);
    if (on) {
      if (rows) this.ar = this.fr2 = this.rows.nextVisible(s.r1 + 1 < MAX_ROWS ? s.r1 + 1 : s.r0, 1);
      else this.ac = this.fc2 = this.cols.nextVisible(s.c1 + 1 < MAX_COLS ? s.c1 + 1 : s.c0, 1);
    }
    this.clampScroll();
    this.emitView();
    this.announce();
    this.paint();
  }

  get zoom(): number {
    return this.z;
  }

  setColor(c: string | undefined): void {
    this.viewColor = c;
  }

  setZoom(z: number): void {
    const v = Math.min(2, Math.max(0.5, Math.round(z * 100) / 100));
    if (v === this.z) return;
    this.z = v;
    this.resize();
    if (this.editing) this.placeEditor();
    this.emitView();
  }

  zoomStep(dir: 1 | -1): void {
    const i = ZOOMS.findIndex((v) => v >= this.z - 0.001);
    const next = dir > 0 ? ZOOMS.find((v) => v > this.z + 0.001) : [...ZOOMS].reverse().find((v) => v < this.z - 0.001);
    this.setZoom(next ?? ZOOMS[Math.max(0, i)]);
  }

  view(): SheetView {
    return {
      rows: this.rows.state(),
      cols: this.cols.state(),
      fr: this.fr,
      fc: this.fc,
      zoom: this.z,
      color: this.viewColor,
      split: this.sh || this.sw ? [this.sh, this.sw] : null,
    };
  }

  private emitView(): void {
    if (this.book >= 0) this.events.onView(this.sheet, this.view());
  }

  private async refreshHistory(): Promise<void> {
    const hst = await this.engine.history(this.book);
    this.events.onHistory(hst.undo, hst.redo);
  }

  private fillRange(): Range | null {
    const t = this.fillTo;
    if (!t) return null;
    const s = this.sel();
    if (t.r > s.r1) return { r0: s.r1 + 1, r1: t.r, c0: s.c0, c1: s.c1 };
    if (t.r < s.r0) return { r0: t.r, r1: s.r0 - 1, c0: s.c0, c1: s.c1 };
    if (t.c > s.c1) return { r0: s.r0, r1: s.r1, c0: s.c1 + 1, c1: t.c };
    if (t.c < s.c0) return { r0: s.r0, r1: s.r1, c0: t.c, c1: s.c0 - 1 };
    return null;
  }

  private onFillHandle(px: number, py: number): boolean {
    const s = this.sel();
    if (s.r1 === MAX_ROWS - 1 && s.c1 === MAX_COLS - 1) return false;
    return Math.abs(px - this.x(s.c1 + 1)) <= 5 && Math.abs(py - this.y(s.r1 + 1)) <= 5;
  }

  async fill(target: Range): Promise<void> {
    const s = this.sel();
    const down = target.r0 > s.r1;
    const up = target.r1 < s.r0;
    const right = target.c0 > s.c1;
    const vertical = down || up;
    const src = await this.engine.read(this.book, s.r0, s.c0, s.r1, s.c1, this.sheet);
    const map = new Map(src.map(([r, c, t, f]) => [KEY(r, c), f || t]));
    const edits: [number, number, string][] = [];
    const moves: [string, number, number][] = [];
    const moved: number[] = [];
    const lane = (cells: [number, number][], targets: [number, number][]) => {
      const seq = cells.map(([r, c]) => map.get(KEY(r, c)) ?? '');
      if (!seq.some((v) => v.startsWith('='))) {
        fillSeries(seq, targets.length).forEach((v, i) => edits.push([targets[i][0], targets[i][1], v]));
        return;
      }
      targets.forEach(([tr, tc], i) => {
        const k = i % seq.length;
        const [sr, sc] = cells[k];
        if (seq[k].startsWith('=')) {
          moved.push(edits.length);
          moves.push([seq[k], tr - sr, tc - sc]);
        }
        edits.push([tr, tc, seq[k]]);
      });
    };
    if (vertical) {
      const n = target.r1 - target.r0 + 1;
      for (let c = s.c0; c <= s.c1; c++) {
        let cells: [number, number][] = [];
        for (let r = s.r0; r <= s.r1; r++) cells.push([r, c]);
        if (up) cells = cells.reverse();
        lane(cells, Array.from({ length: n }, (_, i) => [down ? target.r0 + i : target.r1 - i, c] as [number, number]));
      }
    } else {
      const n = target.c1 - target.c0 + 1;
      for (let r = s.r0; r <= s.r1; r++) {
        let cells: [number, number][] = [];
        for (let c = s.c0; c <= s.c1; c++) cells.push([r, c]);
        if (!right) cells = cells.reverse();
        lane(cells, Array.from({ length: n }, (_, i) => [r, right ? target.c0 + i : target.c1 - i] as [number, number]));
      }
    }
    const texts = await this.engine.offset(moves);
    texts.forEach((t, i) => (edits[moved[i]][2] = t));
    if (edits.length) await this.commitEdits(await this.engine.apply(this.book, edits, this.sheet));
    this.select(Math.min(s.r0, target.r0), Math.min(s.c0, target.c0), Math.max(s.r1, target.r1), Math.max(s.c1, target.c1), false);
    this.ar = s.r0;
    this.ac = s.c0;
  }

  private async fillDownToData(): Promise<void> {
    const s = this.sel();
    const probe = s.c0 > 0 ? s.c0 - 1 : s.c1 + 1;
    if (probe >= MAX_COLS) return;
    const bottom = await this.engine.edge(this.book, s.r1, probe, 'down', this.sheet);
    const last = this.cache.get(KEY(s.r1 + 1, probe)) !== undefined || bottom[0] > s.r1 ? bottom[0] : s.r1;
    if (last > s.r1) await this.fill({ r0: s.r1 + 1, r1: last, c0: s.c0, c1: s.c1 });
  }

  private async selectionTSV(): Promise<string> {
    const s = this.sel();
    const cells = await this.engine.read(this.book, s.r0, s.c0, s.r1, s.c1, this.sheet);
    const map = new Map(cells.map(([r, c, t]) => [KEY(r, c), t]));
    const out: string[] = [];
    for (let r = s.r0; r <= s.r1; r++) {
      const row: string[] = [];
      for (let c = s.c0; c <= s.c1; c++) row.push(tsvCell(map.get(KEY(r, c)) ?? ''));
      out.push(row.join('\t'));
    }
    return out.join('\n');
  }

  private async paste(text: string): Promise<void> {
    const grid = parseTSV(text);
    const edits: [number, number, string][] = [];
    grid.forEach((row, i) => row.forEach((v, j) => {
      const r = this.ar + i;
      const c = this.ac + j;
      if (r < MAX_ROWS && c < MAX_COLS) edits.push([r, c, v]);
    }));
    if (!edits.length) return;
    await this.commitEdits(await this.engine.apply(this.book, edits, this.sheet));
    const rows = grid.length;
    const cols = Math.max(...grid.map((r) => r.length));
    this.select(this.ar, this.ac, this.ar + rows - 1, this.ac + cols - 1);
  }

  private async autofit(col: number): Promise<void> {
    const ext = await this.engine.extent(this.book, this.sheet);
    if (!ext) return;
    const cells = await this.engine.read(this.book, 0, col, Math.min(ext[0], 20000), col, this.sheet);
    this.ctx.font = '13px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
    let wmax = 40;
    for (const [, , t] of cells) wmax = Math.max(wmax, this.ctx.measureText(t.split('\n', 1)[0]).width + 12);
    this.cols.setSize(col, Math.min(800, wmax));
    this.paint();
  }

  startEdit(initial?: string): void {
    if (this.editing) return;
    this.editing = true;
    const k = KEY(this.ar, this.ac);
    this.editor.value = initial ?? this.fx.get(k) ?? this.cache.get(k) ?? '';
    this.reveal(this.ar, this.ac);
    this.placeEditor();
    this.editor.hidden = false;
    this.editor.focus({ preventScroll: true });
    const end = this.editor.value.length;
    this.editor.setSelectionRange(end, end);
    this.editor.dispatchEvent(new Event('input'));
    this.paint();
  }

  private placeEditor(): void {
    const st = this.editor.style;
    const z = this.z;
    st.left = `${this.gw + this.x(this.ac) * z}px`;
    st.top = `${this.gh + this.y(this.ar) * z}px`;
    st.width = `${Math.max(this.cols.size(this.ac), 60) * z}px`;
    st.height = `${Math.max(this.rows.size(this.ar), 16) * z}px`;
    st.fontSize = `${13 * z}px`;
    st.lineHeight = `${16 * z}px`;
  }

  private async endEdit(commit: boolean, move?: Dir, key?: 'Tab' | 'Enter'): Promise<void> {
    if (!this.editing) return;
    this.editing = false;
    const value = this.editor.value;
    this.editor.hidden = true;
    this.focus();
    const start = this.tabStart;
    if (commit) await this.setActive(value);
    this.tabStart = start;
    if (move && key) this.step(key, move);
    else if (move) this.move(move, false);
    this.paint();
  }

  private step(key: 'Tab' | 'Enter', dir: Dir): void {
    const start = this.tabStart;
    if (key === 'Enter' && dir === 'down' && start >= 0) {
      this.select(this.rows.nextVisible(clampR(this.ar + 1), 1), start);
      return;
    }
    const from = this.ac;
    this.move(dir, false);
    if (key === 'Tab') this.tabStart = start >= 0 ? start : from;
  }

  private move(dir: Dir, extend: boolean): void {
    const [dr, dc] = dir === 'up' ? [-1, 0] : dir === 'down' ? [1, 0] : dir === 'left' ? [0, -1] : [0, 1];
    const fromR = extend ? this.fr2 : this.ar;
    const fromC = extend ? this.fc2 : this.ac;
    const r = dr ? this.rows.nextVisible(clampR(fromR + dr), dr as 1 | -1) : fromR;
    const c = dc ? this.cols.nextVisible(clampC(fromC + dc), dc as 1 | -1) : fromC;
    if (extend) this.extendTo(r, c);
    else this.select(r, c);
  }

  private async jump(dir: Dir, extend: boolean): Promise<void> {
    const from: [number, number] = extend ? [this.fr2, this.fc2] : [this.ar, this.ac];
    const [r, c] = await this.engine.edge(this.book, from[0], from[1], dir, this.sheet);
    if (extend) this.extendTo(r, c);
    else this.select(r, c);
  }

  private pageRows(): number {
    const len = this.sh ? (this.apr ? this.h - HEAD_H - this.sh : this.sh) : this.h - HEAD_H - this.frozenH();
    return Math.max(1, Math.floor(len / this.rows.base) - 1);
  }

  private bind(): void {
    const el = this.el;
    el.tabIndex = 0;
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        this.zoomStep(e.deltaY < 0 ? 1 : -1);
        return;
      }
      const k = e.deltaMode === 1 ? this.rows.base : e.deltaMode === 2 ? this.h : 1;
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      const p = this.local(e);
      if (this.sw && p.x - HEAD_W < this.sw) this.sxL += dx * k;
      else this.sx += dx * k;
      if (this.sh && p.y - HEAD_H < this.sh) this.syT += dy * k;
      else this.sy += dy * k;
      this.clampScroll();
      if (this.editing) void this.endEdit(true);
      this.paint();
    }, { passive: false });

    el.addEventListener('pointermove', (e) => {
      if (e.target !== this.canvas) return;
      const p = this.local(e);
      if (this.drag?.kind === 'split-r' || this.drag?.kind === 'split-c') {
        if (this.drag.kind === 'split-r') this.sh = Math.max(1, Math.round(p.y - HEAD_H));
        else this.sw = Math.max(1, Math.round(p.x - HEAD_W));
        this.clampScroll();
        this.paint();
        return;
      }
      if (this.drag && (this.drag.kind === 'resize-col' || this.drag.kind === 'resize-row')) {
        const d = this.drag;
        if (d.kind === 'resize-col') this.cols.setSize(d.index, d.size + p.x - d.start);
        else this.rows.setSize(d.index, d.size + p.y - d.start);
        this.clampScroll();
        this.paint();
        return;
      }
      if (this.drag?.kind === 'fill') {
        const { row, col } = this.hit(p.x, p.y);
        const s = this.sel();
        const dy = row > s.r1 ? row - s.r1 : row < s.r0 ? s.r0 - row : 0;
        const dx = col > s.c1 ? col - s.c1 : col < s.c0 ? s.c0 - col : 0;
        this.fillTo = dy >= dx ? { r: row, c: s.c0 } : { r: s.r0, c: col };
        if (!dy && !dx) this.fillTo = null;
        this.reveal(row, col);
        this.paint();
        return;
      }
      if (this.drag) {
        const { row, col } = this.hit(p.x, p.y);
        const kind = this.drag.kind;
        this.enqueue(() => {
          if (kind === 'cols') this.extendTo(MAX_ROWS - 1, col);
          else if (kind === 'rows') this.extendTo(row, MAX_COLS - 1);
          else this.extendTo(row, col);
        });
        return;
      }
      const b = this.boundary(p.x, p.y);
      const bar = this.splitBar(p.x, p.y);
      this.canvas.style.cursor = bar ? (bar === 'split-r' ? 'row-resize' : 'col-resize') : this.onFillHandle(p.x, p.y) ? 'crosshair' : b ? (b.kind === 'col' ? 'col-resize' : 'row-resize') : 'cell';
    });

    this.og.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.focus();
      const r = this.og.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      this.enqueue(() => this.outlineHit(x, y));
    });

    el.addEventListener('pointerdown', (e) => {
      if (e.target !== this.canvas || e.button !== 0) return;
      e.preventDefault();
      if (this.editing) void this.endEdit(true);
      this.focus();
      const p = this.local(e);
      this.canvas.setPointerCapture(e.pointerId);
      const bar = this.splitBar(p.x, p.y);
      if (bar) {
        this.drag = { kind: bar };
        return;
      }
      if (this.onFillHandle(p.x, p.y)) {
        this.drag = { kind: 'fill' };
        this.fillTo = null;
        return;
      }
      const b = this.boundary(p.x, p.y);
      if (b) {
        this.drag = b.kind === 'col'
          ? { kind: 'resize-col', index: b.index, start: p.x, size: this.cols.size(b.index) }
          : { kind: 'resize-row', index: b.index, start: p.y, size: this.rows.size(b.index) };
        return;
      }
      const { row, col, pr, pc } = this.hit(p.x, p.y);
      const shift = e.shiftKey;
      const pane = (r: boolean, c: boolean) => {
        if (shift) return;
        if (r) this.pr = this.apr = pr;
        if (c) this.pc = this.apc = pc;
      };
      if (p.y < HEAD_H && p.x < HEAD_W) {
        this.enqueue(() => this.select(0, 0, MAX_ROWS - 1, MAX_COLS - 1, false));
      } else if (p.y < HEAD_H) {
        this.drag = { kind: 'cols' };
        this.enqueue(() => (pane(false, true), shift ? this.extendTo(MAX_ROWS - 1, col) : this.select(0, col, MAX_ROWS - 1, col, false)));
      } else if (p.x < HEAD_W) {
        this.drag = { kind: 'rows' };
        this.enqueue(() => (pane(true, false), shift ? this.extendTo(row, MAX_COLS - 1) : this.select(row, 0, row, MAX_COLS - 1, false)));
      } else {
        this.drag = { kind: 'cells' };
        this.enqueue(() => (pane(true, true), shift ? this.extendTo(row, col) : this.select(row, col)));
      }
    });

    el.addEventListener('pointerup', (e) => {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      const d = this.drag;
      this.drag = null;
      if (d?.kind === 'fill') {
        const f = this.fillRange();
        this.fillTo = null;
        if (f) this.enqueue(() => this.fill(f));
        else this.paint();
      } else if (d?.kind === 'resize-col' || d?.kind === 'resize-row' || d?.kind === 'split-r' || d?.kind === 'split-c') this.emitView();
    });

    el.addEventListener('dblclick', (e) => {
      if (e.target !== this.canvas) return;
      const p = this.local(e);
      if (this.splitBar(p.x, p.y)) {
        this.enqueue(() => this.toggleSplit());
        return;
      }
      if (this.onFillHandle(p.x, p.y)) {
        this.enqueue(() => this.fillDownToData());
        return;
      }
      const b = this.boundary(p.x, p.y);
      if (b?.kind === 'col') void this.autofit(b.index).then(() => this.emitView());
      else if (b?.kind === 'row') {
        this.rows.setSize(b.index, this.rows.base);
        this.emitView();
        this.paint();
      } else if (p.x > HEAD_W && p.y > HEAD_H) this.startEdit();
    });

    el.addEventListener('contextmenu', (e) => {
      if (e.target !== this.canvas) return;
      e.preventDefault();
      const p = this.local(e);
      const { row, col } = this.hit(p.x, p.y);
      const s = this.sel();
      let kind: MenuKind = 'cells';
      if (p.y < HEAD_H && p.x > HEAD_W) {
        kind = 'cols';
        if (!(this.wholeCols() && col >= s.c0 && col <= s.c1)) this.select(0, col, MAX_ROWS - 1, col, false);
      } else if (p.x < HEAD_W && p.y > HEAD_H) {
        kind = 'rows';
        if (!(this.wholeRows() && row >= s.r0 && row <= s.r1)) this.select(row, 0, row, MAX_COLS - 1, false);
      } else if (!(row >= s.r0 && row <= s.r1 && col >= s.c0 && col <= s.c1)) this.select(row, col);
      this.events.onMenu(kind, e.clientX, e.clientY);
    });

    el.addEventListener('keydown', (e) => {
      if (e.target === this.editor) {
        this.editorKey(e);
        return;
      }
      if (e.target !== el || !wants(e)) return;
      e.preventDefault();
      this.enqueue(() => this.gridKey(e));
    });

    this.editor.addEventListener('blur', () => {
      if (this.editing) void this.endEdit(true);
    });

    document.addEventListener('copy', (e) => {
      if (document.activeElement !== el) return;
      this.writeClipboard(e);
    });

    document.addEventListener('cut', (e) => {
      if (document.activeElement !== el) return;
      this.writeClipboard(e);
      void this.clearSelection();
    });

    document.addEventListener('paste', (e) => {
      if (document.activeElement !== el) return;
      const text = e.clipboardData?.getData('text/plain');
      e.preventDefault();
      if (text) void this.paste(text);
    });
  }

  private writeClipboard(e: ClipboardEvent): void {
    {
      const s = this.sel();
      const inCache = this.wins.some((w) => !!w && s.r0 >= w.r0 && s.r1 <= w.r1 && s.c0 >= w.c0 && s.c1 <= w.c1) && (s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1) <= 100000;
      e.preventDefault();
      if (inCache && e.clipboardData) {
        const out: string[] = [];
        for (let r = s.r0; r <= s.r1; r++) {
          const row: string[] = [];
          for (let c = s.c0; c <= s.c1; c++) row.push(tsvCell(this.cache.get(KEY(r, c)) ?? ''));
          out.push(row.join('\t'));
        }
        e.clipboardData.setData('text/plain', out.join('\n'));
      } else {
        void this.selectionTSV().then((t) => navigator.clipboard?.writeText(t)).catch(() => undefined);
      }
    }
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.z, y: (e.clientY - r.top) / this.z };
  }

  private enqueue(fn: () => void | Promise<void>): void {
    this.queue = this.queue.then(fn).catch((err: unknown) => console.error(err));
  }

  private editorKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.altKey) {
      e.preventDefault();
      const dir = e.shiftKey ? 'up' : 'down';
      this.enqueue(() => this.endEdit(true, dir, 'Enter'));
    } else if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      const t = this.editor;
      const at = t.selectionStart;
      t.setRangeText('\n', at, t.selectionEnd, 'end');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const dir = e.shiftKey ? 'left' : 'right';
      this.enqueue(() => this.endEdit(true, dir, 'Tab'));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.enqueue(() => this.endEdit(false));
    }
  }

  private async gridKey(e: KeyboardEvent): Promise<void> {
    const mod = e.ctrlKey || e.metaKey;
    const dir = ARROWS[e.key];
    if (this.editing) {
      if (this.editorHook?.(e)) return;
      const before = this.editor.value;
      if (e.key === 'Enter' && e.altKey) this.editor.value += '\n';
      else if (e.key === 'Enter') await this.endEdit(true, e.shiftKey ? 'up' : 'down', 'Enter');
      else if (e.key === 'Tab') await this.endEdit(true, e.shiftKey ? 'left' : 'right', 'Tab');
      else if (e.key === 'Escape') await this.endEdit(false);
      else if (dir && !mod) await this.endEdit(true, dir);
      else if (e.key === 'Backspace') this.editor.value = this.editor.value.slice(0, -1);
      else if (e.key.length === 1 && !mod) this.editor.value += e.key;
      if (this.editing && this.editor.value !== before) this.editor.dispatchEvent(new Event('input'));
      return;
    }
    if (dir && e.altKey && e.shiftKey && !mod && (dir === 'left' || dir === 'right')) {
      this.groupAuto(dir === 'right' ? 1 : -1);
      return;
    }
    if (dir) {
      if (mod) await this.jump(dir, e.shiftKey);
      else this.move(dir, e.shiftKey);
      return;
    }
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === '+' || k === '=') return this.insertAuto();
      if (k === '-' || k === '_') return this.removeAuto();
      if (e.code === 'Digit9') return this.hide(true, !e.shiftKey);
      if (e.code === 'Digit0') return this.hide(false, !e.shiftKey);
      if (k === 'g') return this.events.onGoto();
      if (k === 'z' && !e.shiftKey) return this.undo();
      if (k === 'y' || k === 'z') return this.redo();
      if (k === 'a') return this.select(0, 0, MAX_ROWS - 1, MAX_COLS - 1, false);
      if (e.key === 'Home') return this.select(0, 0);
      if (e.key === 'End') {
        const x = await this.engine.extent(this.book, this.sheet);
        return this.select(x ? x[0] : 0, x ? x[1] : 0);
      }
      return;
    }
    switch (e.key) {
      case 'Enter':
        return this.step('Enter', e.shiftKey ? 'up' : 'down');
      case 'Tab':
        return this.step('Tab', e.shiftKey ? 'left' : 'right');
      case 'Home':
        return this.select(this.ar, 0);
      case 'PageDown':
      case 'PageUp': {
        const n = this.pageRows() * (e.key === 'PageDown' ? 1 : -1);
        this.sy += n * this.rows.base;
        this.clampScroll();
        if (e.shiftKey) this.extendTo(this.fr2 + n, this.fc2);
        else this.select(this.ar + n, this.ac);
        return;
      }
      case 'F2':
        return this.startEdit();
      case 'F5':
        return this.events.onGoto();
      case 'Delete':
        return this.clearSelection();
      case 'Backspace':
        return this.startEdit('');
    }
    if (this.editing) {
      this.editor.value += e.key;
      this.editor.dispatchEvent(new Event('input'));
      return;
    }
    this.startEdit(e.key);
  }
}

const ARROWS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function wants(e: KeyboardEvent): boolean {
  if (ARROWS[e.key]) return true;
  const mod = e.ctrlKey || e.metaKey;
  if (mod) return !e.altKey && (['z', 'y', 'a', 'home', 'end', '+', '=', '-', '_', 'g'].includes(e.key.toLowerCase()) || e.code === 'Digit9' || e.code === 'Digit0');
  if (['Enter', 'Tab', 'Escape', 'Home', 'PageDown', 'PageUp', 'F2', 'F5', 'Delete', 'Backspace'].includes(e.key)) return true;
  return e.key.length === 1 && !e.altKey;
}

function gutter(axis: Axis): number {
  const n = axis.maxLevel();
  return n ? OUTLINE_PAD * 2 + OUTLINE_STEP * (n + 1) : 0;
}

function clampR(r: number): number {
  return Math.max(0, Math.min(MAX_ROWS - 1, r));
}

function clampC(c: number): number {
  return Math.max(0, Math.min(MAX_COLS - 1, c));
}

function tsvCell(t: string): string {
  return /[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function parseTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  const s = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === '\t') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows;
}

export { a1 };
