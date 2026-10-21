import type { Area, Cell, Changed, Dir, Effect, EngineClient, FormatChange, FormatItem, LinkChange, MergeMode, Shift, SortKeySpec, StyleChange, StyleOp } from '../engine';
import { light, parseStyle, PLAIN, themeOf, tint, type CellStyle, type Look } from './style';

interface Mark {
  style?: CellStyle;
  bar?: [number, number, string];
  icon?: [string, number];
}

export type PasteKind ='all' | 'formulas' | 'values' | 'formats' | 'values-formats' | 'formulas-formats' | 'no-borders' | 'widths';
const KEEP = '~';

export type BorderKind ='all' | 'outside' | 'inside' | 'top' | 'bottom' | 'left' | 'right' | 'none';
import { Axis, type AxisState } from './axis';
import { MAX_COLS, MAX_ROWS, a1, colName, parseRef, rangeText, type Range } from './a1';
import { fillSeries } from './fill';
import { runCommand } from '../ui/commands';
import { markAction } from '../ui/action';
import { parseTable, tablePaint, type TableInfo } from './tables';
import { drawImageCell, IMAGE_CODE } from '../charts/picture';
import { drawSpark, SPARK_CODE } from '../charts/spark';

export interface ObjectsHook {
  paint(): void;
  data(): void;
  sheet(i: number): void;
  shifted?(sheet: number): unknown;
}

export interface CellDecor {
  cells(r0: number, r1: number, c0: number, c1: number): [number, number][];
  paint(ctx: CanvasRenderingContext2D, r: number, c: number, x: number, y: number, w: number, h: number): void;
}

export interface ObjectFrame {
  left: number;
  top: number;
  ox: number;
  oy: number;
  z: number;
}

export interface SheetView {
  rows?: AxisState;
  cols?: AxisState;
  fr?: number;
  fc?: number;
  zoom?: number;
  color?: string;
  split?: [number, number] | null;
  hidden?: boolean | null;
  fviews?: { name: string; text: string }[] | null;
  sviews?: { name: string; text: string; rows: AxisState; cols: AxisState }[] | null;
  slicers?: { id: string; col: number; title: string; x: number; y: number; multi?: boolean; cols?: number; style?: string; pivot?: string; field?: string }[] | null;
}

export type MenuKind = 'rows' | 'cols' | 'cells';

export interface BreakView {
  area: [number, number, number, number];
  rowBreaks: number[];
  colBreaks: number[];
  manualRows: Set<number>;
  manualCols: Set<number>;
  pages: { r0: number; r1: number; c0: number; c1: number; n: number }[];
}

type Pane = 0 | 1;
type Band = [number, number, number, number, Pane];

export const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const HEAD_H = 24;
const HEAD_W = 60;
const KEY = (r: number, c: number) => r * MAX_COLS + c;
const FILTER_BTN = 16;
const LIST_BTN = 16;
const unescapeField = (s: string) => s.replace(/\\(.)/g, (_, ch: string) => (ch === 't' ? '\t' : ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch));
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
  link: string;
}

export type Recorded =
  | { k: 'edit'; sheet: number; r: number; c: number; raw: string }
  | { k: 'style'; sheet: number; ops: [number, number, number, number, string][] }
  | { k: 'format'; sheet: number; r0: number; c0: number; r1: number; c1: number; code: string }
  | { k: 'sort'; sheet: number; r0: number; c0: number; r1: number; c1: number; keys: SortKeySpec[]; header: boolean; across?: boolean };

export interface GridEvents {
  onActive(text: string, ref: string, range: Range): void;
  onHistory(undo: boolean, redo: boolean): void;
  onChanged(changes: Changed[]): void;
  onSheet(sheet: number): SheetView;
  onShift(shift: Shift): void;
  onFormats(formats: FormatChange[]): void;
  onStyles(styles: FormatChange[]): void;
  onMerges(sheet: number, areas: Area[]): void;
  onPainter(state: 'on' | 'sticky' | 'off'): void;
  onLook(): void;
  onPasteMenu(x: number, y: number): void;
  onRules(sheet: number, lines: string[]): void;
  onFilter(sheet: number, text: string): void;
  onFilterMenu(col: number): void;
  onFilterKey(): void;
  onValid(sheet: number, lines: string[]): void;
  onInvalid(rule: string[]): Promise<'retry' | 'accept' | 'cancel'>;
  onRule(rule: string[] | null, at: DOMRect | null): void;
  onList(): void;
  onTables(lines: string[]): void;
  onTableKey(): void;
  onLinks(changes: LinkChange[]): void;
  onOpenLink(): void;
  onLinkBox(): void;
  onView(sheet: number, view: SheetView): void;
  onBreakMove?(axis: 'row' | 'col', from: number, to: number): void;
  onMenu(kind: MenuKind, x: number, y: number): void;
  onGoto(): void;
  onError?(message: string): void;
  onHover?(row: number, col: number, x: number, y: number): void;
}

export interface Presence {
  row: number;
  col: number;
  color: string;
  name: string;
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
  objectsHook: ObjectsHook | null = null;
  decor: CellDecor | null = null;

  objectFrame(): ObjectFrame {
    const z = this.z;
    return { left: this.gw + HEAD_W * z, top: this.gh + HEAD_H * z, ox: this.gw + (HEAD_W - this.sx) * z, oy: this.gh + (HEAD_H - this.sy) * z, z };
  }

  recorder: ((a: Recorded) => void) | null = null;
  private readonly cache = new Map<number, string>();
  private readonly fx = new Map<number, string>();
  private readonly nums = new Set<number>();
  private readonly colors = new Map<number, string>();
  private readonly linked = new Set<number>();
  private readonly styles = new Map<number, CellStyle>();
  private merges: Area[] = [];
  private marks = new Map<number, string>();
  private others: Presence[] = [];
  private masked = new Set<number>();
  private readonly cfs = new Map<number, Mark>();
  private ruleLines: string[] = [];
  private filterArea: Area | null = null;
  private filterCols = new Map<number, string[]>();
  private filterText = '';
  private validLines: string[] = [];
  private tableList: TableInfo[] = [];
  private rule: string[] | null = null;
  private ruleSeq = 0;
  look: Look = themeOf('');
  themeText = '';
  themeNames: string[] = [];
  private painter: { h: number; w: number; items: Map<number, [string, string]>; sticky: boolean } | null = null;
  private copied: {
    text: string;
    h: number;
    w: number;
    items: Map<number, [string, string]>;
    raw: Map<number, string>;
    values: Map<number, string>;
    widths: number[];
    r0: number;
    c0: number;
    sheet: number;
  } | null = null;
  private overlay: ((ctx: CanvasRenderingContext2D, box: (r0: number, c0: number, r1: number, c1: number) => [number, number, number, number]) => void) | null = null;
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
  private drag: null | { kind: 'cells' | 'rows' | 'cols' | 'fill' | 'split-r' | 'split-c' } | { kind: 'resize-col' | 'resize-row'; index: number; start: number; size: number } | { kind: 'break'; axis: 'row' | 'col'; from: number; to: number } = null;

  constructor(
    host: HTMLElement,
    private readonly engine: EngineClient,
    private book: number,
    private readonly events: GridEvents,
  ) {
    this.el = host;
    this.el.innerHTML = '<canvas class="fc-outline" aria-hidden="true"></canvas><canvas class="fc-grid-canvas"></canvas><textarea class="fc-editor" spellcheck="true" hidden aria-label="Cell editor"></textarea>';
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
      link: v('--cell-link') || '#60a5fa',
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
    this.nums.clear();
    this.colors.clear();
    this.linked.clear();
    this.styles.clear();
    this.cfs.clear();
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
    void Promise.all([
      this.engine.read(book, want.r0, want.c0, want.r1, want.c1, sheet),
      this.engine.readStyles(book, sheet, want.r0, want.c0, want.r1, want.c1),
    ]).then(([cells, sts]: [Cell[], [number, number, string][]]) => {
      if (this.pendingWins[slot] !== want || this.book !== book || this.sheet !== sheet) return;
      this.pendingWins[slot] = null;
      const old = this.wins[slot];
      this.wins[slot] = want;
      if (old) {
        const keep = (r: number, c: number) => this.wins.some((w) => !!w && r >= w.r0 && r <= w.r1 && c >= w.c0 && c <= w.c1);
        for (const k of [...this.cache.keys(), ...this.styles.keys()]) {
          const r = Math.floor(k / MAX_COLS);
          const c = k % MAX_COLS;
          if (r >= old.r0 && r <= old.r1 && c >= old.c0 && c <= old.c1 && !keep(r, c)) {
            this.forget(k);
            this.styles.delete(k);
          }
        }
      }
      for (const k of [...this.cache.keys()]) {
        const r = Math.floor(k / MAX_COLS);
        const c = k % MAX_COLS;
        if (r >= want.r0 && r <= want.r1 && c >= want.c0 && c <= want.c1) this.forget(k);
      }
      for (const k of [...this.styles.keys()]) {
        const r = Math.floor(k / MAX_COLS);
        const c = k % MAX_COLS;
        if (r >= want.r0 && r <= want.r1 && c >= want.c0 && c <= want.c1) this.styles.delete(k);
      }
      for (const [r, c, t, f, n, col, l] of cells) this.store(KEY(r, c), t, f, n, col, l);
      for (const [r, c, st] of sts) this.styles.set(KEY(r, c), parseStyle(st, this.look));
      if (this.ruleLines.length) void this.refreshCf(want);
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

  paintHook: (() => void) | null = null;

  visibleWindow(): Range {
    const rows = this.paneRows(1);
    const cols = this.paneCols(1);
    return { r0: this.sh || this.fr ? 0 : rows[0], r1: rows[1], c0: this.sw || this.fc ? 0 : cols[0], c1: cols[1] };
  }

  private paintNow(): void {
    this.paintHook?.();
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
        this.paintFilterButtons(ra, rb, ca, cb);
        this.paintMarks(ra, rb, ca, cb);
        ctx.restore();
      }
    }
    this.paintBreaks(rowSets, colSets);
    this.paintSelection(rowSets, colSets);
    this.paintHeaders(rowSets, colSets);
    this.pr = this.apr;
    this.pc = this.apc;
    this.paintListArrow();
    if (this.overlay) {
      ctx.save();
      this.overlay(ctx, (r0, c0, r1, c1) => this.areaRect(r0, c0, r1, c1));
      ctx.restore();
    }
    ctx.strokeStyle = pal.frozen;
    ctx.lineWidth = 2;
    if (this.fr) this.line(HEAD_W, HEAD_H + fh, w, HEAD_H + fh);
    if (this.fc) this.line(HEAD_W + fw, HEAD_H, HEAD_W + fw, h);
    ctx.fillStyle = pal.frozen;
    if (this.sh) ctx.fillRect(0, HEAD_H + this.sh - 2, w, 4);
    if (this.sw) ctx.fillRect(HEAD_W + this.sw - 2, 0, 4, h);
    if (!this.og.hidden) this.paintOutline();
    this.objectsHook?.paint();
    if (this.editing) this.placeEditor();
  }

  setMarks(marks: Map<number, string>): void {
    this.marks = marks;
    this.paint();
  }

  setOthers(others: Presence[]): void {
    this.others = others;
    this.paint();
  }

  setMasked(keys: Set<number>): void {
    this.masked = keys;
    this.announce();
  }

  keyOf(row: number, col: number): number {
    return KEY(row, col);
  }

  private paintMarks(r0: number, r1: number, c0: number, c1: number): void {
    if (!this.marks.size && !this.others.length) return;
    const { ctx } = this;
    for (const [k, color] of this.marks) {
      const r = Math.floor(k / MAX_COLS);
      const c = k - r * MAX_COLS;
      if (r < r0 || r > r1 || c < c0 || c > c1 || !this.rows.size(r) || !this.cols.size(c)) continue;
      const right = this.x(c) + this.cols.size(c);
      const top = this.y(r);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(right - 8, top + 1);
      ctx.lineTo(right - 1, top + 1);
      ctx.lineTo(right - 1, top + 8);
      ctx.closePath();
      ctx.fill();
    }
    for (const o of this.others) {
      if (o.row < r0 || o.row > r1 || o.col < c0 || o.col > c1) continue;
      const [x, y, w, h] = this.areaRect(o.row, o.col, o.row, o.col);
      ctx.strokeStyle = o.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.font = '11px Inter, system-ui, sans-serif';
      const tw = ctx.measureText(o.name).width + 8;
      ctx.fillStyle = o.color;
      ctx.fillRect(x + 1, y - 14, tw, 14);
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.name, x + 5, y - 7);
    }
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
          const end = this.rows.summaryAt(r);
          const by = gh + (this.y(end, pane) + this.rows.size(end) / 2) * z;
          if (by < gh || top > H) continue;
          if (!this.rows.isFolded(r)) {
            o.strokeStyle = pal.headFg;
            o.beginPath();
            if (this.rows.before) {
              const bottom = gh + this.y(r.b + 1, pane) * z - 2.5;
              o.moveTo(cx - 4, bottom);
              o.lineTo(cx + 0.5, bottom);
              o.lineTo(cx + 0.5, by + 7);
            } else {
              o.moveTo(cx - 4, top + 2.5);
              o.lineTo(cx + 0.5, top + 2.5);
              o.lineTo(cx + 0.5, by - 7);
            }
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
          const end = this.cols.summaryAt(r);
          const bx = gw + (this.x(end, pane) + this.cols.size(end) / 2) * z;
          if (bx < gw || left > W) continue;
          if (!this.cols.isFolded(r)) {
            o.strokeStyle = pal.headFg;
            o.beginPath();
            if (this.cols.before) {
              const right = gw + this.x(r.b + 1, pane) * z - 2.5;
              o.moveTo(right, cy - 4);
              o.lineTo(right, cy + 0.5);
              o.lineTo(bx + 7, cy + 0.5);
            } else {
              o.moveTo(left + 2.5, cy - 4);
              o.lineTo(left + 2.5, cy + 0.5);
              o.lineTo(bx - 7, cy + 0.5);
            }
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
        const end = this.rows.summaryAt(r);
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
        const end = this.cols.summaryAt(r);
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
    const merged = this.merges.length ? (r: number, c: number) => !!this.mergeAt(r, c) : () => false;
    const shown = this.merges.filter(([a, b, cc, d]) => a <= r1 && cc >= r0 && b <= c1 && d >= c0);
    for (const [mr0, mc0, mr1, mc1] of shown) {
      const [x, y, w, h] = this.areaRect(mr0, mc0, mr1, mc1);
      ctx.fillStyle = this.styleOf(KEY(mr0, mc0))?.bg ?? pal.bg;
      ctx.fillRect(x + 1, y + 1, w - 1, h - 1);
    }
    if (this.styles.size || this.cfs.size || this.tableList.length) {
      for (let r = r0; r <= r1; r++) {
        const rh = this.rows.size(r);
        if (!rh) continue;
        for (let c = c0; c <= c1; c++) {
          const bg = this.styleOf(KEY(r, c))?.bg;
          const cw = this.cols.size(c);
          if (!bg || !cw || merged(r, c)) continue;
          ctx.fillStyle = bg;
          ctx.fillRect(Math.round(this.x(c)) + 1, Math.round(this.y(r)) + 1, Math.round(this.x(c) + cw) - Math.round(this.x(c)) - 1, Math.round(this.y(r) + rh) - Math.round(this.y(r)) - 1);
        }
      }
    }
    ctx.textBaseline = 'alphabetic';
    const ca = Math.max(0, c0 - OVERFLOW_COLS);
    const cb = Math.min(MAX_COLS - 1, c1 + OVERFLOW_COLS);
    for (let r = r0; r <= r1; r++) {
      const rh = this.rows.size(r);
      if (!rh) continue;
      for (let c = ca; c <= cb; c++) {
        const k = KEY(r, c);
        const t = this.cache.get(k);
        if (!t || !this.cols.size(c) || merged(r, c)) continue;
        const box = this.checkRule(r, c);
        if (box && (t === box.on || t === box.off)) {
          if (c >= c0 && c <= c1) this.paintCheck(t === box.on, this.x(c), this.y(r), this.cols.size(c), rh);
          continue;
        }
        const chip = this.chips.length ? this.chipRule(r, c) : null;
        if (chip) {
          if (c >= c0 && c <= c1) this.paintChips(chip, t, this.x(c), this.y(r), this.cols.size(c), rh);
          continue;
        }
        const span = this.textSpan(k, t, r, c, merged);
        if ((c < c0 || c > c1) && span[1] - span[0] <= this.cols.size(c)) continue;
        this.cellText(k, t, span[0], span[1], this.y(r), rh);
      }
    }
    for (const [mr0, mc0, mr1, mc1] of shown) {
      const t = this.cache.get(KEY(mr0, mc0));
      if (!t) continue;
      const [x, y, w, h] = this.areaRect(mr0, mc0, mr1, mc1);
      this.cellText(KEY(mr0, mc0), t, x, x + w, y, h);
    }
    if (this.decor) {
      for (const [r, c] of this.decor.cells(r0, r1, c0, c1)) {
        const cw = this.cols.size(c);
        const rh = this.rows.size(r);
        if (cw && rh) this.decor.paint(ctx, r, c, this.x(c), this.y(r), cw, rh);
      }
    }
    for (const [k, text] of this.ghost) {
      const r = Math.floor(k / MAX_COLS);
      const c = k % MAX_COLS;
      if (r < r0 || r > r1 || c < ca || c > cb || this.cache.get(k) || !this.cols.size(c) || !this.rows.size(r)) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.x(c) + 1, this.y(r), this.cols.size(c) - 2, this.rows.size(r));
      ctx.clip();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = pal.fg;
      ctx.font = 'italic 13px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(text.split('\n', 1)[0], this.x(c) + 5, this.y(r) + this.rows.size(r) - 6);
      ctx.restore();
    }
    if (this.circles.size) this.paintCircles(r0, r1, c0, c1);
    ctx.textBaseline = 'middle';
    ctx.font = '13px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
    if (!this.styles.size && !this.cfs.size) return;
    for (let r = r0; r <= r1; r++) {
      const rh = this.rows.size(r);
      if (!rh) continue;
      for (let c = c0; c <= c1; c++) {
        const cw = this.cols.size(c);
        if (cw && !merged(r, c)) this.cellBorders(KEY(r, c), this.x(c), this.y(r), cw, rh);
      }
    }
    for (const [mr0, mc0, mr1, mc1] of shown) this.cellBorders(KEY(mr0, mc0), ...this.areaRect(mr0, mc0, mr1, mc1));
    ctx.setLineDash([]);
  }

  private areaRect(r0: number, c0: number, r1: number, c1: number): [number, number, number, number] {
    const x = this.x(c0);
    const y = this.y(r0);
    return [x, y, this.x(c1 + 1) - x, this.y(r1 + 1) - y];
  }

  private mergeAt(r: number, c: number): Area | undefined {
    for (const m of this.merges) if (r >= m[0] && r <= m[2] && c >= m[1] && c <= m[3]) return m;
    return undefined;
  }

  private font(st: CellStyle): number {
    const px = st.size ? Math.round(st.size * 13.333) / 10 : 13;
    const face = st.font ?? this.look.body;
    this.ctx.font = `${st.i ? 'italic ' : ''}${st.b ? '700 ' : ''}${px}px ${face !== 'Inter' ? `"${face}", ` : ''}Inter, system-ui, -apple-system, "Segoe UI", sans-serif`;
    return px;
  }

  private align(k: number, t: string, st: CellStyle): 'left' | 'center' | 'right' {
    return st.ha ?? (this.nums.has(k) ? 'right' : t === 'TRUE' || t === 'FALSE' || ERRORS.has(t) ? 'center' : 'left');
  }

  private styleOf(k: number): CellStyle | undefined {
    const base = this.tabled(k, this.styles.get(k));
    const cf = this.cfs.get(k)?.style;
    if (!cf) return base;
    const b = base ?? PLAIN;
    return {
      ...b,
      b: b.b || cf.b,
      i: b.i || cf.i,
      u: b.u || cf.u,
      s: b.s || cf.s,
      fc: cf.fc ?? b.fc,
      bg: cf.bg ?? b.bg,
      borders: b.borders.map((x, i) => cf.borders[i] ?? x),
    };
  }

  private tabled(k: number, own: CellStyle | undefined): CellStyle | undefined {
    if (!this.tableList.length) return own;
    const r = Math.floor(k / MAX_COLS);
    const c = k % MAX_COLS;
    for (const t of this.tableList) {
      const p = tablePaint(t, r, c, this.look);
      if (!p) continue;
      const b = own ?? PLAIN;
      return { ...b, b: b.b || p.b, bg: b.bg ?? p.bg, fc: b.fc ?? p.fc };
    }
    return own;
  }

  tables(): TableInfo[] {
    return this.tableList;
  }

  activeTable(): TableInfo | null {
    return this.tableList.find((t) => this.ar >= t.area[0] && this.ar <= t.area[2] && this.ac >= t.area[1] && this.ac <= t.area[3]) ?? null;
  }

  async loadTables(): Promise<void> {
    if (this.book < 0) return;
    const sheet = this.sheet;
    const all = (await this.engine.tables(this.book)).map(parseTable).filter((t): t is TableInfo => !!t);
    if (sheet !== this.sheet) return;
    const mine = all.filter((t) => t.sheet === sheet);
    const same = mine.length === this.tableList.length && mine.every((t, i) => t.line === this.tableList[i].line);
    this.tableList = mine;
    if (!same) {
      this.paint();
      void this.loadRule();
    }
  }

  private async tablesMoved(): Promise<void> {
    const lines = await this.engine.tables(this.book);
    const before = this.tableList.map((t) => t.line).join('\n');
    await this.loadTables();
    if (this.tableList.map((t) => t.line).join('\n') !== before) {
      this.events.onTables(lines);
      const f = await this.engine.filter(this.book, this.sheet);
      if (f !== this.filterText) {
        await this.loadFilter();
        this.events.onFilter(this.sheet, f);
      }
    }
  }

  async createTable(range: Range, header: boolean): Promise<void> {
    await this.applyEffect(await this.engine.createTable(this.book, this.sheet, range.r0, range.c0, range.r1, range.c1, header));
  }

  async applyPivot(e: Effect): Promise<void> {
    await this.applyEffect(e);
  }

  async setTable(name: string, line: string): Promise<void> {
    await this.applyEffect(await this.engine.setTable(this.book, name, line));
  }

  async removeTable(name: string, keep: StyleOp[]): Promise<void> {
    const mark = await this.engine.undoMark(this.book);
    await this.applyEffect(await this.engine.removeTable(this.book, name));
    if (keep.length) await this.setStyles(keep);
    await this.engine.undoGroup(this.book, mark);
  }

  tablePaintAt(t: TableInfo, r: number, c: number): { bg?: string; fc?: string; b: boolean } | null {
    return tablePaint(t, r, c, this.look);
  }

  private textSpan(k: number, t: string, r: number, c: number, merged: (r: number, c: number) => boolean): [number, number] {
    const st = this.styleOf(k) ?? PLAIN;
    if (t.charCodeAt(0) === SPARK_CODE || t.charCodeAt(0) === IMAGE_CODE || this.cfs.get(k)?.icon) return [this.x(c), this.x(c) + this.cols.size(c)];
    let left = this.x(c);
    let right = left + this.cols.size(c);
    if (st.wrap || st.rot || st.vertical || this.nums.has(k)) return [left, right];
    this.font(st);
    const ha = this.align(k, t, st);
    const need = this.ctx.measureText(t.split('\n', 1)[0]).width + 10 + st.indent * INDENT_PX;
    const empty = (cc: number) => cc >= 0 && cc < MAX_COLS && !this.cache.has(KEY(r, cc)) && !merged(r, cc);
    for (let cc = c + 1; ha !== 'right' && right - left < need && empty(cc) && cc <= c + OVERFLOW_COLS; cc++) right += this.cols.size(cc);
    for (let cc = c - 1; ha !== 'left' && right - left < need && empty(cc) && cc >= c - OVERFLOW_COLS; cc--) left -= this.cols.size(cc);
    return [left, right];
  }

  private cellText(k: number, t: string, left: number, right: number, yy: number, rh: number): void {
    const { ctx, pal } = this;
    if (t.charCodeAt(0) === SPARK_CODE && drawSpark(ctx, t, left, right, yy, rh, pal.fg)) return;
    if (t.charCodeAt(0) === IMAGE_CODE && drawImageCell(ctx, t, left, right, yy, rh, () => this.paint(), pal.fg)) return;
    const own = this.styleOf(k) ?? PLAIN;
    const st = this.linked.has(k) ? { ...own, u: true, fc: own.fc ?? pal.link } : own;
    const px = this.font(st);
    const ha = this.align(k, t, st);
    const mark = this.cfs.get(k);
    const pad = 5 + st.indent * INDENT_PX + (mark?.icon && ha === 'left' ? 16 : 0);
    const lh = Math.round(px * 1.3);
    const dark = /^#[0-9a-f]{6}$/i.test(pal.bg) && !light(pal.bg);
    const peak = (c: string) => Math.max(...[1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
    const auto = (c: string) => (c === '#000000' ? pal.fg : !st.bg && /^#[0-9a-f]{6}$/i.test(c) && (dark ? peak(c) < 128 : light(c)) ? tint(c, dark ? 60 : -60) : c);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left + 1, yy, right - left - 2, rh);
    ctx.clip();
    if (mark?.bar) {
      const [from, to, color] = mark.bar;
      const inner = right - left - 4;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = color;
      ctx.fillRect(left + 2 + from * inner, yy + 3, Math.max(1, (to - from) * inner), rh - 6);
      ctx.globalAlpha = 1;
    }
    if (mark?.icon) drawIcon(ctx, mark.icon[0], mark.icon[1], left + 4, yy + rh / 2);
    this.font(st);
    ctx.fillStyle = st.fc ? auto(st.fc) : this.colors.get(k) ?? (st.bg ? (light(st.bg) ? '#1a1a1a' : '#f5f5f5') : pal.fg);
    if (st.vertical) {
      ctx.textAlign = 'center';
      const chars = [...t.split('\n', 1)[0]];
      const x = ha === 'left' ? left + pad + px / 2 : ha === 'right' ? right - pad - px / 2 : (left + right) / 2;
      let base = yy + lh - 2;
      for (const ch of chars) {
        ctx.fillText(ch, x, base);
        base += lh;
      }
    } else if (st.rot) {
      const a = (st.rot * Math.PI) / 180;
      const up = st.rot > 0;
      const lift = up ? px * 0.8 * Math.sin(a) : 0;
      ctx.translate(ha === 'right' ? right - pad : left + pad + lift, up ? yy + rh - 5 : yy + 5);
      ctx.rotate(-a);
      ctx.textAlign = 'left';
      ctx.fillText(t.split('\n', 1)[0], 0, 0);
    } else {
      const lines = st.wrap ? wrapLines(ctx, t, right - left - 10) : [t.split('\n', 1)[0]];
      const va = st.va ?? 'bottom';
      const block = lh * lines.length;
      let base = va === 'top' ? yy + lh - 4 : va === 'middle' ? yy + (rh - block) / 2 + lh - 4 : yy + rh - block + lh - 5;
      ctx.textAlign = ha;
      const tx = ha === 'right' ? right - pad : ha === 'center' ? (left + right) / 2 : left + pad;
      for (const ln of lines) {
        ctx.fillText(ln, tx, base);
        if (st.u || st.s) {
          const w = ctx.measureText(ln).width;
          const x0 = ha === 'right' ? tx - w : ha === 'center' ? tx - w / 2 : tx;
          if (st.u) ctx.fillRect(x0, base + 2, w, Math.max(1, px / 13));
          if (st.s) ctx.fillRect(x0, base - px * 0.3, w, Math.max(1, px / 13));
        }
        base += lh;
      }
    }
    ctx.restore();
  }

  private cellBorders(k: number, x: number, y: number, w: number, h: number): void {
    const st = this.styleOf(k);
    if (!st || st.borders.every((b) => !b)) return;
    const x0 = Math.round(x) + 0.5;
    const y0 = Math.round(y) + 0.5;
    const x1 = Math.round(x + w) + 0.5;
    const y1 = Math.round(y + h) + 0.5;
    const ends: [number, number, number, number][] = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x0, y1, x1, y1], [x0, y0, x0, y1]];
    st.borders.forEach((b, i) => {
      if (b) this.edge(ends[i], b.line, b.color === '#000000' ? this.pal.fg : b.color, i % 2 === 0);
    });
  }

  private edge([ax, ay, bx, by]: [number, number, number, number], line: string, color: string, flat: boolean): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = line === 'medium' ? 2 : line === 'thick' ? 3 : 1;
    ctx.setLineDash(line === 'dashed' ? [4, 2] : line === 'dotted' ? [1, 2] : []);
    if (line === 'double') {
      const dx = flat ? 0 : 1.5;
      const dy = flat ? 1.5 : 0;
      this.line(ax - dx, ay - dy, bx - dx, by - dy);
      this.line(ax + dx, ay + dy, bx + dx, by + dy);
    } else this.line(ax, ay, bx, by);
  }

  private sel(): Range {
    const s = { r0: Math.min(this.ar, this.fr2), r1: Math.max(this.ar, this.fr2), c0: Math.min(this.ac, this.fc2), c1: Math.max(this.ac, this.fc2) };
    for (let grew = this.merges.length > 0; grew; ) {
      grew = false;
      for (const [a, b, c, d] of this.merges) {
        if (a > s.r1 || c < s.r0 || b > s.c1 || d < s.c0) continue;
        if (a < s.r0 || c > s.r1 || b < s.c0 || d > s.c1) {
          s.r0 = Math.min(s.r0, a);
          s.r1 = Math.max(s.r1, c);
          s.c0 = Math.min(s.c0, b);
          s.c1 = Math.max(s.c1, d);
          grew = true;
        }
      }
    }
    return s;
  }

  private activeArea(): [number, number, number, number] {
    const m = this.mergeAt(this.ar, this.ac);
    return m ? this.areaRect(m[0], m[1], m[2], m[3]) : [this.x(this.ac), this.y(this.ar), this.cols.size(this.ac), this.rows.size(this.ar)];
  }

  private async loadMerges(): Promise<void> {
    if (this.book < 0) return;
    const sheet = this.sheet;
    const list = await this.engine.merges(this.book, sheet);
    if (sheet !== this.sheet) return;
    this.merges = list;
    this.paint();
  }

  async sortTarget(): Promise<{ range: Range; header: boolean }> {
    const s = this.sel();
    if (s.r0 === s.r1 && s.c0 === s.c1) {
      const { area, header } = await this.engine.region(this.book, this.sheet, s.r0, s.c0);
      return { range: { r0: area[0], c0: area[1], r1: area[2], c1: area[3] }, header };
    }
    return { range: s, header: await this.engine.guessHeader(this.book, this.sheet, s.r0, s.c0, s.r1, s.c1) };
  }

  async sortRange(range: Range, keys: SortKeySpec[], header: boolean, caseSensitive = false, across = false): Promise<void> {
    markAction(`Sorted ${rangeText(range)}`);
    this.recorder?.({ k: 'sort', sheet: this.sheet, r0: range.r0, c0: range.c0, r1: range.r1, c1: range.c1, keys, header, across });
    await this.applyEffect(await this.engine.sort(this.book, this.sheet, range.r0, range.c0, range.r1, range.c1, keys, header, caseSensitive, across));
    this.select(range.r0, range.c0, range.r1, range.c1, false);
  }

  async quickSort(descending: boolean): Promise<void> {
    const col = this.ac;
    const { range, header } = await this.sortTarget();
    await this.sortRange(range, [[col, descending]], header);
  }

  activeRow(): number {
    return this.ar;
  }

  activeColumn(): number {
    return this.ac;
  }

  filterInfo(): { area: Range; cols: Map<number, string[]>; text: string } | null {
    if (!this.filterArea) return null;
    const [r0, c0, r1, c1] = this.filterArea;
    return { area: { r0, c0, r1, c1 }, cols: this.filterCols, text: this.filterText };
  }

  async setFilter(text: string): Promise<void> {
    await this.applyEffect(await this.engine.setFilter(this.book, this.sheet, text));
  }

  async reapplyFilter(): Promise<void> {
    await this.applyEffect(await this.engine.reapplyFilter(this.book, this.sheet));
  }

  async sortFilterColumn(col: number, descending: boolean): Promise<void> {
    const a = this.filterArea;
    if (!a) return;
    const mark = await this.engine.undoMark(this.book);
    markAction(`Sorted ${rangeText({ r0: a[0], c0: a[1], r1: a[2], c1: a[3] })} by column ${colName(col)}`);
    await this.applyEffect(await this.engine.sort(this.book, this.sheet, a[0], a[1], a[2], a[3], [[col, descending]], true, false));
    await this.applyEffect(await this.engine.reapplyFilter(this.book, this.sheet));
    await this.engine.undoGroup(this.book, mark);
  }

  filterButton(col: number): DOMRect | null {
    const a = this.filterArea;
    if (!a || col < a[1] || col > a[3] || !this.cols.size(col) || !this.rows.size(a[0])) return null;
    const r = this.canvas.getBoundingClientRect();
    const right = (this.x(col + 1) - 2) * this.z;
    const top = (this.y(a[0]) + this.rows.size(a[0]) / 2 - FILTER_BTN / 2) * this.z;
    return new DOMRect(r.left + right - FILTER_BTN * this.z, r.top + top, FILTER_BTN * this.z, FILTER_BTN * this.z);
  }

  private async loadFilter(): Promise<void> {
    if (this.book < 0) return;
    const sheet = this.sheet;
    const text = await this.engine.filter(this.book, sheet);
    if (sheet !== this.sheet) return;
    this.filterText = text;
    this.filterArea = null;
    this.filterCols = new Map();
    let hidden: number[] = [];
    for (const line of text.split('\n')) {
      const p = line.split('\t');
      if (p[0] === 'area') {
        const n = p[1].split(',').map(Number);
        this.filterArea = [n[0], n[1], n[2], n[3]];
      } else if (p[0] === 'col') this.filterCols.set(Number(p[1]), p.slice(2).map(unescapeField));
      else if (p[0] === 'hidden') {
        hidden = [];
        for (const part of (p[1] ?? '').split(',').filter(Boolean)) {
          const [x, y] = part.split('-').map(Number);
          for (let i = x; i <= (y ?? x); i++) hidden.push(i);
        }
      }
    }
    this.rows.setFiltered(hidden);
    if (this.rows.isFiltered(this.ar)) this.ar = this.fr2 = this.rows.nextVisible(this.ar, 1);
    this.paint();
  }

  private paintFilterButtons(r0: number, r1: number, c0: number, c1: number): void {
    const a = this.filterArea;
    if (!a || a[0] < r0 || a[0] > r1 || !this.rows.size(a[0])) return;
    const { ctx, pal } = this;
    const cy = this.y(a[0]) + this.rows.size(a[0]) / 2;
    for (let c = Math.max(c0, a[1]); c <= Math.min(c1, a[3]); c++) {
      if (!this.cols.size(c)) continue;
      const x = Math.round(this.x(c + 1) - 2 - FILTER_BTN) + 0.5;
      const y = Math.round(cy - FILTER_BTN / 2) + 0.5;
      const on = this.filterCols.has(c);
      ctx.fillStyle = pal.headBg;
      ctx.fillRect(x, y, FILTER_BTN, FILTER_BTN);
      ctx.strokeStyle = on ? pal.edge : pal.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, FILTER_BTN, FILTER_BTN);
      ctx.fillStyle = on ? pal.edge : pal.headFg;
      ctx.beginPath();
      const m = x + FILTER_BTN / 2;
      if (on) {
        ctx.moveTo(m - 5, y + 4);
        ctx.lineTo(m + 5, y + 4);
        ctx.lineTo(m + 1, y + 9);
        ctx.lineTo(m + 1, y + 13);
        ctx.lineTo(m - 1, y + 12);
        ctx.lineTo(m - 1, y + 9);
      } else {
        ctx.moveTo(m - 4, y + 6.5);
        ctx.lineTo(m + 4, y + 6.5);
        ctx.lineTo(m, y + 10.5);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  private onFilterButton(px: number, py: number, row: number, col: number, pr: Pane, pc: Pane): boolean {
    const a = this.filterArea;
    if (!a || row !== a[0] || col < a[1] || col > a[3]) return false;
    const right = this.x(col + 1, pc) - 2;
    const cy = this.y(a[0], pr) + this.rows.size(a[0]) / 2;
    return px >= right - FILTER_BTN - 1 && px <= right + 1 && Math.abs(py - cy) <= FILTER_BTN / 2 + 1;
  }

  async merge(mode: MergeMode): Promise<void> {
    const s = this.sel();
    await this.applyEffect(await this.engine.merge(this.book, this.sheet, s.r0, s.c0, s.r1, s.c1, mode));
  }

  activeMerged(): boolean {
    return !!this.mergeAt(this.ar, this.ac);
  }

  private async formatsOf(s: Range): Promise<Map<number, [string, string]>> {
    const items = new Map<number, [string, string]>();
    if ((s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1) > 100000) return items;
    const [sts, codes] = await Promise.all([
      this.engine.readStyles(this.book, this.sheet, s.r0, s.c0, s.r1, s.c1),
      this.engine.readFormats(this.book, this.sheet, s.r0, s.c0, s.r1, s.c1),
    ]);
    for (const [r, c, st] of sts) items.set(KEY(r - s.r0, c - s.c0), [st, '']);
    for (const [r, c, code] of codes) {
      const k = KEY(r - s.r0, c - s.c0);
      items.set(k, [items.get(k)?.[0] ?? '', code]);
    }
    return items;
  }

  private tiled(items: Map<number, [string, string]>, h: number, w: number, t: Range): FormatItem[] {
    const out: FormatItem[] = [];
    if ((t.r1 - t.r0 + 1) * (t.c1 - t.c0 + 1) > 100000) return out;
    for (let r = t.r0; r <= t.r1; r++) {
      for (let c = t.c0; c <= t.c1; c++) {
        const [st, code] = items.get(KEY((r - t.r0) % h, (c - t.c0) % w)) ?? ['', ''];
        out.push([r, c, st, code]);
      }
    }
    return out;
  }

  async startPainter(sticky: boolean): Promise<void> {
    const s = this.sel();
    this.painter = { h: s.r1 - s.r0 + 1, w: s.c1 - s.c0 + 1, items: await this.formatsOf(s), sticky };
    this.canvas.style.cursor = 'copy';
    this.events.onPainter(sticky ? 'sticky' : 'on');
  }

  painting(): boolean {
    return !!this.painter;
  }

  stopPainter(): void {
    if (!this.painter) return;
    this.painter = null;
    this.canvas.style.cursor = '';
    this.events.onPainter('off');
  }

  private async applyPainter(): Promise<void> {
    const p = this.painter;
    if (!p) return;
    const s = this.sel();
    const t = s.r0 === s.r1 && s.c0 === s.c1 ? { r0: s.r0, c0: s.c0, r1: Math.min(MAX_ROWS - 1, s.r0 + p.h - 1), c1: Math.min(MAX_COLS - 1, s.c0 + p.w - 1) } : s;
    if (!p.sticky) this.stopPainter();
    const items = this.tiled(p.items, p.h, p.w, t);
    if (items.length) await this.applyEffect(await this.engine.putFormats(this.book, this.sheet, items));
    this.select(t.r0, t.c0, t.r1, t.c1, false);
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
        const am = this.mergeAt(this.ar, this.ac);
        const single = am ? am[0] === s.r0 && am[1] === s.c0 && am[2] === s.r1 && am[3] === s.c1 : s.r0 === s.r1 && s.c0 === s.c1;
        if (!single) {
          ctx.fillStyle = pal.sel;
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
          ctx.fillStyle = pal.bg;
          const [ax, ay, aw, ah] = this.activeArea();
          ctx.globalAlpha = 0.85;
          ctx.fillRect(ax + 1, ay + 1, aw - 1, ah - 1);
          ctx.globalAlpha = 1;
          const t = this.cache.get(KEY(this.ar, this.ac));
          if (t) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(ax + 1, ay, aw - 2, ah);
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
        const fa = this.filterArea;
        ctx.fillStyle = fa && this.filterCols.size && r > fa[0] && r <= fa[2] ? pal.link : pal.headFg;
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

  private breakAt(px: number, py: number): { axis: 'row' | 'col'; index: number } | null {
    const v = this.breakView;
    if (!v || px <= HEAD_W || py <= HEAD_H) return null;
    const { pr, pc } = this.hit(px, py);
    const [ar0, ac0, ar1, ac1] = v.area;
    if (px >= this.x(ac0, pc) - 4 && px <= this.x(ac1 + 1, pc) + 4) {
      for (const r of v.rowBreaks) if (Math.abs(py - this.y(r, pr)) <= 4) return { axis: 'row', index: r };
    }
    if (py >= this.y(ar0, pr) - 4 && py <= this.y(ar1 + 1, pr) + 4) {
      for (const c of v.colBreaks) if (Math.abs(px - this.x(c, pc)) <= 4) return { axis: 'col', index: c };
    }
    return null;
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
    const m = r0 === r1 && c0 === c1 ? this.mergeAt(r0, c0) : undefined;
    if (m) [r0, c0, r1, c1] = [m[0], m[1], m[0], m[1]];
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
    this.events.onActive(this.masked.has(k) ? this.cache.get(k) ?? '' : this.fx.get(k) ?? this.cache.get(k) ?? '', rangeText(this.sel()), this.sel());
    void this.loadRule();
  }

  private async loadValid(): Promise<void> {
    if (this.book < 0) return;
    const sheet = this.sheet;
    const lines = await this.engine.validations(this.book, sheet);
    if (sheet !== this.sheet) return;
    this.validLines = lines;
    const parsed = lines.map((l) => l.split('\t').map(unescapeField));
    const box = (p: string[]) => p[0].split(',').map(Number) as [number, number, number, number];
    this.checks = parsed.filter((p) => p[1] === 'checkbox').map((p) => ({ area: box(p), on: p[3]?.trim() || 'TRUE', off: p[4]?.trim() || 'FALSE' }));
    this.chips = parsed.filter((p) => (p[1] === 'list' || p[1] === 'custom') && (p[5] ?? '').includes('c')).map((p) => ({
      area: box(p),
      multi: (p[5] ?? '').includes('m'),
      colors: new Map((p[11] ?? '').split(';').map((s) => s.split('=')).filter((kv) => kv.length === 2 && kv[0].trim() && kv[1].trim()).map(([k, v]) => [k.trim().toLowerCase(), v.trim()] as [string, string])),
    }));
    this.paint();
    await this.loadRule();
    if (this.circles.size) await this.refreshCircles();
  }

  private checks: { area: [number, number, number, number]; on: string; off: string }[] = [];
  private chips: { area: [number, number, number, number]; multi: boolean; colors: Map<string, string> }[] = [];
  private circles = new Set<number>();

  private checkRule(r: number, c: number): { on: string; off: string } | null {
    return this.checks.find(({ area: a }) => r >= a[0] && r <= a[2] && c >= a[1] && c <= a[3]) ?? null;
  }

  private isCheck(r: number, c: number): boolean {
    return !!this.checkRule(r, c);
  }

  private chipRule(r: number, c: number): { multi: boolean; colors: Map<string, string> } | null {
    return this.chips.find(({ area: a }) => r >= a[0] && r <= a[2] && c >= a[1] && c <= a[3]) ?? null;
  }

  async circleInvalid(): Promise<number> {
    const ext = await this.engine.extent(this.book, this.sheet);
    const found = ext ? await this.engine.invalidIn(this.book, this.sheet, 0, 0, ext[0], ext[1]) : [];
    this.circles = new Set(found.map(([r, c]) => KEY(r, c)));
    this.paint();
    return this.circles.size;
  }

  clearCircles(): void {
    if (!this.circles.size) return;
    this.circles.clear();
    this.paint();
  }

  private async refreshCircles(): Promise<void> {
    const ext = await this.engine.extent(this.book, this.sheet);
    const found = ext ? await this.engine.invalidIn(this.book, this.sheet, 0, 0, ext[0], ext[1]) : [];
    const now = new Set(found.map(([r, c]) => KEY(r, c)));
    this.circles = new Set([...this.circles].filter((k) => now.has(k)));
    this.paint();
  }

  private paintChips(rule: { multi: boolean; colors: Map<string, string> }, t: string, x: number, y: number, w: number, h: number): void {
    const { ctx } = this;
    const parts = rule.multi ? t.split(',').map((s) => s.trim()).filter(Boolean) : [t];
    const ch = Math.min(h - 6, 20);
    if (ch < 8) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y, w - 2, h);
    ctx.clip();
    ctx.font = '12px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    let cx = x + 4;
    const top = y + (h - ch) / 2;
    for (const part of parts) {
      const tw = ctx.measureText(part).width;
      const fill = rule.colors.get(part.toLowerCase()) ?? '#e3e6ea';
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(cx, top, tw + 12, ch, ch / 2);
      ctx.fill();
      const n = parseInt(fill.slice(1), 16);
      const lum = /^#[0-9a-f]{6}$/i.test(fill) ? (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 : 1;
      ctx.fillStyle = lum > 0.6 ? '#1f2328' : '#ffffff';
      ctx.fillText(part, cx + 6, top + ch / 2 + 0.5);
      cx += tw + 18;
      if (cx > x + w) break;
    }
    ctx.restore();
  }

  private paintCircles(r0: number, r1: number, c0: number, c1: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = '#d93025';
    ctx.lineWidth = 2;
    for (const k of this.circles) {
      const r = Math.floor(k / MAX_COLS);
      const c = k % MAX_COLS;
      if (r < r0 || r > r1 || c < c0 || c > c1) continue;
      const w = this.cols.size(c);
      const h = this.rows.size(r);
      if (!w || !h) continue;
      ctx.beginPath();
      ctx.ellipse(this.x(c) + w / 2, this.y(r) + h / 2, w / 2 - 1, h / 2 - 1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private paintCheck(on: boolean, x: number, y: number, w: number, h: number): void {
    const { ctx, pal } = this;
    const s = Math.min(14, h - 6, w - 6);
    if (s < 6) return;
    const bx = Math.round(x + (w - s) / 2) + 0.5;
    const by = Math.round(y + (h - s) / 2) + 0.5;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = on ? '#f97316' : pal.headFg;
    if (on) {
      ctx.fillStyle = '#f97316';
      ctx.fillRect(bx, by, s, s);
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(bx + s * 0.22, by + s * 0.52);
      ctx.lineTo(bx + s * 0.43, by + s * 0.74);
      ctx.lineTo(bx + s * 0.78, by + s * 0.28);
      ctx.stroke();
    } else {
      ctx.strokeRect(bx, by, s, s);
    }
    ctx.restore();
  }

  autoComplete = true;

  private async suggest(e: InputEvent): Promise<void> {
    const ed = this.editor;
    const typed = ed.value;
    if (!this.autoComplete || !this.editing || e.inputType !== 'insertText' || ed.selectionStart !== typed.length || ed.selectionEnd !== typed.length || /[\n=]/.test(typed.slice(0, 1) + (typed.includes('\n') ? '\n' : '')) || this.book < 0) return;
    const done = await this.engine.tool(this.book, this.sheet, 'complete', String(this.ar), String(this.ac), typed);
    const full = done.message ?? '';
    if (!full || ed.value !== typed || !this.editing || ed.selectionStart !== typed.length || full.length <= typed.length) return;
    ed.value = typed + full.slice(typed.length);
    ed.setSelectionRange(typed.length, ed.value.length);
    ed.dispatchEvent(new Event('input'));
  }

  async toggleCheck(r = this.ar, c = this.ac): Promise<boolean> {
    const box = this.checkRule(r, c);
    if (!box) return false;
    const on = this.cache.get(KEY(r, c)) === box.on;
    await this.commitEdits(await this.engine.apply(this.book, [[r, c, on ? box.off : box.on]], this.sheet));
    return true;
  }

  checkAt(px: number, py: number): { row: number; col: number } | null {
    const { row, col } = this.hit(px, py);
    return this.isCheck(row, col) ? { row, col } : null;
  }

  async runTool(...fields: string[]): Promise<string> {
    const e = await this.engine.tool(this.book, this.sheet, ...fields);
    await this.applyEffect(e);
    await this.refreshHistory();
    return e.message ?? '';
  }

  async pasteWith(what: string, op: string, skip: boolean, transpose: boolean): Promise<string> {
    const src = this.copied;
    if (!src || this.book < 0) return '';
    const area = `${src.r0},${src.c0},${src.r0 + src.h - 1},${src.c0 + src.w - 1}`;
    return this.runTool('pastespecial', area, String(this.ar), String(this.ac), what, op, skip ? '1' : '0', transpose ? '1' : '0', String(src.sheet));
  }

  async visibleAreas(): Promise<Range[]> {
    let s = this.sel();
    if (s.r0 === s.r1 && s.c0 === s.c1) {
      const ext = await this.engine.extent(this.book, this.sheet);
      if (!ext) return [];
      s = { r0: 0, c0: 0, r1: ext[0], c1: ext[1] };
    }
    const runs = (a: number, b: number, hidden: (i: number) => boolean) => {
      const out: [number, number][] = [];
      for (let i = a; i <= b; i++) {
        if (hidden(i)) continue;
        const last = out[out.length - 1];
        if (last && last[1] === i - 1) last[1] = i;
        else out.push([i, i]);
      }
      return out;
    };
    const rows = runs(s.r0, Math.min(s.r1, s.r0 + 100000), (i) => this.rows.isHidden(i));
    const cols = runs(s.c0, Math.min(s.c1, s.c0 + 2000), (i) => this.cols.isHidden(i));
    return rows.flatMap(([r0, r1]) => cols.map(([c0, c1]) => ({ r0, c0, r1, c1 })));
  }

  private ghost = new Map<number, string>();

  clearGhost(): void {
    if (!this.ghost.size) return;
    this.ghost.clear();
    this.paint();
  }

  async flashPreview(row: number, col: number): Promise<void> {
    this.ghost.clear();
    if (this.book >= 0) {
      try {
        const e = await this.engine.tool(this.book, this.sheet, 'flash', String(row), String(col), '1');
        for (const line of (e.message ?? '').split('\n').slice(1)) {
          const [r, c, ...rest] = line.split('\t');
          if (rest.length) this.ghost.set(KEY(Number(r), Number(c)), rest.join('\t'));
        }
      } catch {
        this.ghost.clear();
      }
    }
    this.paint();
  }

  async acceptGhost(): Promise<void> {
    const edits: [number, number, string][] = [...this.ghost].map(([k, v]) => [Math.floor(k / MAX_COLS), k % MAX_COLS, v]);
    this.ghost.clear();
    if (edits.length) await this.commitEdits(await this.engine.apply(this.book, edits, this.sheet));
    this.paint();
  }

  copiedSource(): { sheet: number; r0: number; c0: number; r1: number; c1: number } | null {
    const s = this.copied;
    return s ? { sheet: s.sheet, r0: s.r0, c0: s.c0, r1: s.r0 + s.h - 1, c1: s.c0 + s.w - 1 } : null;
  }

  async pasteLayers(layers: string, transpose: boolean): Promise<string> {
    const s = this.copiedSource();
    if (!s || this.book < 0) return '';
    return this.runTool('pastelayers', `${s.r0},${s.c0},${s.r1},${s.c1}`, String(this.ar), String(this.ac), transpose ? '1' : '0', String(s.sheet), layers);
  }

  autoOutline(rows: [number, number][], cols: [number, number][]): void {
    this.rows.clearOutline();
    this.cols.clearOutline();
    for (const [a, b] of rows) this.rows.group(a, b, 1);
    for (const [a, b] of cols) this.cols.group(a, b, 1);
    this.resize();
    this.emitView();
    this.paint();
  }

  clearOutline(): void {
    this.autoOutline([], []);
  }

  summary(): { rowsBelow: boolean; colsRight: boolean } {
    return { rowsBelow: !this.rows.before, colsRight: !this.cols.before };
  }

  setSummary(rowsBelow: boolean, colsRight: boolean): void {
    this.rows.before = !rowsBelow;
    this.cols.before = !colsRight;
    this.emitView();
    this.paint();
  }

  outlineRows(groups: [number, number][], clear: [number, number] | null): void {
    if (clear) for (let n = 0; n < 7; n++) if (!this.rows.group(clear[0], clear[1], -1)) break;
    for (const [a, b] of groups) this.rows.group(a, b, 1);
    this.resize();
    this.emitView();
    this.paint();
  }

  private async loadRule(): Promise<void> {
    const seq = ++this.ruleSeq;
    const had = this.rule;
    let rule: string[] | null = null;
    if (this.validLines.length && this.book >= 0) {
      const line = await this.engine.validationAt(this.book, this.sheet, this.ar, this.ac);
      if (seq !== this.ruleSeq) return;
      rule = line ? line.split('\t').map(unescapeField) : null;
    }
    this.rule = rule;
    if (!had && !rule) return;
    this.events.onRule(rule, rule ? this.cellRect() : null);
    this.paint();
  }

  cellRect(): DOMRect {
    const r = this.canvas.getBoundingClientRect();
    const [x, y, w, h] = this.activeArea();
    return new DOMRect(r.left + x * this.z, r.top + y * this.z, w * this.z, h * this.z);
  }

  activeRule(): string[] | null {
    return this.rule;
  }

  validations(): string[] {
    return this.validLines;
  }

  async setValidation(line: string): Promise<void> {
    const s = this.sel();
    await this.applyEffect(await this.engine.setValidation(this.book, this.sheet, s.r0, s.c0, s.r1, s.c1, line));
  }

  async listItems(): Promise<string[]> {
    return this.engine.listItems(this.book, this.sheet, this.ar, this.ac);
  }

  private hasList(): boolean {
    return (!!this.rule && this.rule[1] === 'list' && (this.rule[5] ?? '').includes('d')) || !!this.totalsCell();
  }

  totalsCell(): TableInfo | null {
    const t = this.activeTable();
    return t && t.flags.includes('t') && this.ar === t.area[2] ? t : null;
  }

  private listArrow(): [number, number, number, number] | null {
    if (!this.hasList() || this.editing) return null;
    const [x, y, w, h] = this.activeArea();
    return [x + w + 1, y, LIST_BTN, Math.min(h, 24)];
  }

  private paintListArrow(): void {
    const b = this.listArrow();
    if (!b) return;
    const { ctx, pal } = this;
    const [x, y, w, h] = b;
    ctx.fillStyle = pal.headBg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, w - 1, h - 1);
    ctx.fillStyle = pal.headFg;
    ctx.beginPath();
    const mx = x + w / 2;
    const my = y + h / 2;
    ctx.moveTo(mx - 4, my - 2);
    ctx.lineTo(mx + 4, my - 2);
    ctx.lineTo(mx, my + 2.5);
    ctx.closePath();
    ctx.fill();
  }

  listButton(): DOMRect | null {
    const b = this.listArrow();
    if (!b) return null;
    const r = this.canvas.getBoundingClientRect();
    return new DOMRect(r.left + b[0] * this.z, r.top + b[1] * this.z, b[2] * this.z, b[3] * this.z);
  }

  private onListArrow(px: number, py: number): boolean {
    const b = this.listArrow();
    return !!b && px >= b[0] && px <= b[0] + b[2] && py >= b[1] && py <= b[1] + b[3];
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
    this.ghost.clear();
    this.dropWindows();
    this.merges = [];
    this.ruleLines = [];
    this.filterArea = null;
    this.filterCols = new Map();
    this.filterText = '';
    this.rows.setFiltered([]);
    this.validLines = [];
    this.tableList = [];
    void this.loadTables();
    if (this.rule) this.events.onRule(null, null);
    this.rule = null;
    void this.loadValid();
    void this.loadMerges();
    void this.loadRules();
    void this.loadFilter();
    void this.loadTheme();
    this.rows.restore(view.rows);
    this.cols.restore(view.cols);
    this.pushHidden();
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
    this.objectsHook?.sheet(sheet);
  }

  axes(): { rows: AxisState; cols: AxisState } {
    return { rows: this.rows.state(), cols: this.cols.state() };
  }

  applyAxes(rows: AxisState, cols: AxisState): void {
    this.rows.restore(rows);
    this.cols.restore(cols);
    this.pushHidden();
    this.resize();
    this.emitView();
    this.paint();
  }

  get sheetIndex(): number {
    return this.sheet;
  }

  patch(changed: Changed[]): void {
    let hit = false;
    for (const [s, r, c, t, f, n, col, l] of changed) {
      if (s !== this.sheet) continue;
      const k = KEY(r, c);
      if (this.cache.get(k) === t && this.fx.get(k) === f && this.nums.has(k) === !!n && this.colors.get(k) === col && this.linked.has(k) === !!l) continue;
      hit = true;
      this.store(k, t, f, n, col, l);
    }
    if (!hit) return;
    this.announce();
    this.paint();
    this.objectsHook?.data();
  }

  private store(k: number, t: string, f: string | undefined, n: boolean | undefined, color?: string, link?: boolean): void {
    if (link) this.linked.add(k);
    else this.linked.delete(k);
    if (t || f !== undefined) this.cache.set(k, t);
    else this.cache.delete(k);
    if (f !== undefined) this.fx.set(k, f);
    else this.fx.delete(k);
    if (n) this.nums.add(k);
    else this.nums.delete(k);
    if (color) this.colors.set(k, color);
    else this.colors.delete(k);
  }

  private forget(k: number): void {
    this.cache.delete(k);
    this.fx.delete(k);
    this.nums.delete(k);
    this.colors.delete(k);
    this.linked.delete(k);
  }

  activeLinked(): boolean {
    return this.linked.has(KEY(this.ar, this.ac));
  }

  activeCell(): [number, number] {
    return [this.ar, this.ac];
  }

  shownAt(r: number, c: number): string {
    return this.cache.get(KEY(r, c)) ?? '';
  }

  breakView: BreakView | null = null;

  setBreakView(v: BreakView | null): void {
    this.breakView = v;
    this.paint();
  }

  private paintBreaks(rowSets: Band[], colSets: Band[]): void {
    const v = this.breakView;
    if (!v) return;
    const { ctx } = this;
    const [ar0, ac0, ar1, ac1] = v.area;
    for (const [, , ytop, ybot, pr] of rowSets) {
      for (const [, , xl, xr, pc] of colSets) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(xl, ytop, xr - xl, ybot - ytop);
        ctx.clip();
        const left = this.x(ac0, pc);
        const right = this.x(ac1 + 1, pc);
        const top = this.y(ar0, pr);
        const bottom = this.y(ar1 + 1, pr);
        ctx.fillStyle = 'rgba(37, 99, 235, 0.07)';
        ctx.fillRect(left, top, right - left, bottom - top);
        ctx.font = '600 44px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(37, 99, 235, 0.28)';
        for (const p of v.pages) {
          const x0 = this.x(p.c0, pc);
          const x1 = this.x(p.c1 + 1, pc);
          const y0 = this.y(p.r0, pr);
          const y1 = this.y(p.r1 + 1, pr);
          if (x1 < xl || x0 > xr || y1 < ytop || y0 > ybot) continue;
          ctx.fillText(`Page ${p.n}`, (Math.max(x0, xl) + Math.min(x1, xr)) / 2, (Math.max(y0, ytop) + Math.min(y1, ybot)) / 2);
        }
        ctx.textAlign = 'start';
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        const edges: [number, number, number, number, boolean][] = [[left, top, right, top, false], [left, bottom, right, bottom, false], [left, top, left, bottom, false], [right, top, right, bottom, false]];
        const moving = this.drag?.kind === 'break' ? this.drag : null;
        for (const r of v.rowBreaks) {
          const at = moving && moving.axis === 'row' && moving.from === r ? moving.to : r;
          edges.push([left, this.y(at, pr), right, this.y(at, pr), at !== r || v.manualRows.has(r)]);
        }
        for (const c of v.colBreaks) {
          const at = moving && moving.axis === 'col' && moving.from === c ? moving.to : c;
          edges.push([this.x(at, pc), top, this.x(at, pc), bottom, at !== c || v.manualCols.has(c)]);
        }
        for (const [x0, y0, x1, y1, manual] of edges) {
          ctx.setLineDash(manual || x0 === x1 && (x0 === left || x0 === right) || y0 === y1 && (y0 === top || y0 === bottom) ? [] : [6, 4]);
          this.line(x0, y0, x1, y1);
        }
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  setOverlay(fn: ((ctx: CanvasRenderingContext2D, box: (r0: number, c0: number, r1: number, c1: number) => [number, number, number, number]) => void) | null): void {
    this.overlay = fn;
    this.paint();
  }

  async linkTarget(): Promise<string> {
    return this.book < 0 ? '' : this.engine.linkAt(this.book, this.sheet, this.ar, this.ac);
  }

  async setLink(target: string, display?: string): Promise<void> {
    await this.applyEffect(await this.engine.setLink(this.book, this.sheet, this.ar, this.ac, target, display));
  }

  async removeLinks(): Promise<void> {
    const s = this.sel();
    await this.applyEffect(await this.engine.removeLinks(this.book, this.sheet, s.r0, s.c0, s.r1, s.c1));
  }

  activeRect(): DOMRect {
    const [x, y, w, h] = this.activeArea();
    const r = this.canvas.getBoundingClientRect();
    return new DOMRect(r.left + x * this.z, r.top + y * this.z, w * this.z, h * this.z);
  }

  activeStyle(): CellStyle {
    return this.styles.get(KEY(this.ar, this.ac)) ?? PLAIN;
  }

  async styleSelection(patch: string): Promise<void> {
    const s = this.sel();
    await this.setStyles([[s.r0, s.c0, s.r1, s.c1, patch]]);
  }

  async setStyles(ops: StyleOp[]): Promise<void> {
    if (this.book < 0 || !ops.length) return;
    this.recorder?.({ k: 'style', sheet: this.sheet, ops });
    const peers = this.peers();
    const mark = peers.length ? await this.engine.undoMark(this.book) : -1;
    await this.applyEffect(await this.engine.setStyles(this.book, this.sheet, ops));
    for (const p of peers) {
      const e = await this.engine.setStyles(this.book, p, ops);
      if (e.styles.length) this.events.onStyles(e.styles.map(([s, r, c, raw]) => [s, r, c, raw]));
    }
    if (mark >= 0) await this.engine.undoGroup(this.book, mark);
  }

  peers: () => number[] = () => [];

  async toggle(flag: 'b' | 'i' | 'u' | 's' | 'wrap'): Promise<void> {
    await this.styleSelection(this.activeStyle()[flag] ? `!${flag}` : flag);
  }

  async borders(kind: BorderKind, line = 'thin', color = '000000'): Promise<void> {
    const s = this.sel();
    const b = (edges: string[]) => edges.map((e) => `${e}:${line}:${color}`).join(';');
    const ops: StyleOp[] = [];
    const add = (r0: number, c0: number, r1: number, c1: number, p: string) => {
      if (r0 <= r1 && c0 <= c1) ops.push([r0, c0, r1, c1, p]);
    };
    if (kind === 'none') add(s.r0, s.c0, s.r1, s.c1, 'bt:;br:;bb:;bl:');
    if (kind === 'all') add(s.r0, s.c0, s.r1, s.c1, b(['bt', 'br', 'bb', 'bl']));
    if (kind === 'inside') {
      add(s.r0, s.c0, s.r1 - 1, s.c1, b(['bb']));
      add(s.r0, s.c0, s.r1, s.c1 - 1, b(['br']));
    }
    if (kind === 'top' || kind === 'outside') add(s.r0, s.c0, s.r0, s.c1, b(['bt']));
    if (kind === 'bottom' || kind === 'outside') add(s.r1, s.c0, s.r1, s.c1, b(['bb']));
    if (kind === 'left' || kind === 'outside') add(s.r0, s.c0, s.r1, s.c0, b(['bl']));
    if (kind === 'right' || kind === 'outside') add(s.r0, s.c1, s.r1, s.c1, b(['br']));
    await this.setStyles(ops);
  }

  rules(): string[] {
    return this.ruleLines;
  }

  selection(): Range {
    return this.sel();
  }

  async setRules(lines: string[]): Promise<void> {
    await this.applyEffect(await this.engine.setRules(this.book, this.sheet, lines));
  }

  private async loadRules(): Promise<void> {
    if (this.book < 0) return;
    const sheet = this.sheet;
    const lines = await this.engine.rules(this.book, sheet);
    if (sheet !== this.sheet) return;
    this.ruleLines = lines;
    if (!lines.length) {
      if (this.cfs.size) {
        this.cfs.clear();
        this.paint();
      }
      return;
    }
    await this.refreshCf();
  }

  private async refreshCf(only?: Range): Promise<void> {
    const book = this.book;
    const sheet = this.sheet;
    const wins = only ? [only] : this.wins.filter((w): w is Range => !!w);
    const results = await Promise.all(wins.map((w) => this.engine.readCf(book, sheet, w.r0, w.c0, w.r1, w.c1)));
    if (book !== this.book || sheet !== this.sheet) return;
    wins.forEach((w, i) => {
      for (const k of [...this.cfs.keys()]) {
        const r = Math.floor(k / MAX_COLS);
        const c = k % MAX_COLS;
        if (r >= w.r0 && r <= w.r1 && c >= w.c0 && c <= w.c1) this.cfs.delete(k);
      }
      for (const [r, c, st, bar, icon] of results[i]) {
        const m: Mark = {};
        if (st) m.style = parseStyle(st, this.look);
        if (bar) {
          const [f, t, col] = bar.split(',');
          m.bar = [Number(f), Number(t), `#${col}`];
        }
        if (icon) {
          const [set, n] = icon.split(':');
          m.icon = [set, Number(n)];
        }
        this.cfs.set(KEY(r, c), m);
      }
    });
    this.paint();
  }

  async setTheme(name: string): Promise<void> {
    await this.applyEffect(await this.engine.setTheme(this.book, name));
  }

  async applyNamed(name: string): Promise<void> {
    const s = this.sel();
    await this.applyEffect(await this.engine.applyStyle(this.book, this.sheet, s.r0, s.c0, s.r1, s.c1, name));
  }

  async defineNamed(name: string, parts: string): Promise<void> {
    await this.applyEffect(await this.engine.defineStyle(this.book, this.sheet, this.ar, this.ac, name, parts));
  }

  async deleteNamed(name: string): Promise<void> {
    await this.applyEffect(await this.engine.deleteStyle(this.book, name));
  }

  async loadTheme(): Promise<void> {
    if (this.book < 0) return;
    const t = await this.engine.theme(this.book);
    this.themeText = t.current;
    this.themeNames = t.names;
    this.look = themeOf(t.current);
    for (const [k, st] of this.styles) this.styles.set(k, parseStyle(st.text, this.look));
    this.announce();
    this.paint();
  }

  private applyStyles(changes: StyleChange[]): void {
    let hit = false;
    const rows = new Set<number>();
    for (const [sh, r, c, , text] of changes) {
      if (sh !== this.sheet) continue;
      hit = true;
      const before = this.styles.get(KEY(r, c));
      const after = text ? parseStyle(text, this.look) : null;
      if (after) this.styles.set(KEY(r, c), after);
      else this.styles.delete(KEY(r, c));
      if (before?.wrap !== after?.wrap || before?.size !== after?.size || before?.rot !== after?.rot || before?.vertical !== after?.vertical) rows.add(r);
    }
    if (!hit) return;
    this.fitRows(rows);
    this.announce();
    this.paint();
  }

  async setFormat(code: string): Promise<void> {
    const s = this.sel();
    this.recorder?.({ k: 'format', sheet: this.sheet, r0: s.r0, c0: s.c0, r1: s.r1, c1: s.c1, code });
    const peers = this.peers();
    const mark = peers.length ? await this.engine.undoMark(this.book) : -1;
    const e = await this.engine.setFormat(this.book, this.sheet, s.r0, s.c0, s.r1, s.c1, code);
    await this.applyEffect(e);
    for (const p of peers) {
      const f = await this.engine.setFormat(this.book, p, s.r0, s.c0, s.r1, s.c1, code);
      if (f.formats.length) this.events.onFormats(f.formats);
    }
    if (mark >= 0) await this.engine.undoGroup(this.book, mark);
  }

  async formatAtActive(): Promise<string> {
    return this.engine.formatAt(this.book, this.sheet, this.ar, this.ac);
  }

  async commitEdits(changed: Changed[]): Promise<void> {
    if (changed.length && changed.every(([s]) => s !== this.sheet)) {
      this.show(this.book, changed[0][0], this.events.onSheet(changed[0][0]));
    }
    const fit = new Set<number>();
    for (const [s, r, c, t, f, n, col, l] of changed) {
      if (s !== this.sheet) continue;
      this.store(KEY(r, c), t, f, n, col, l);
      const st = this.styles.get(KEY(r, c));
      if (st && (st.wrap || st.size || st.rot || st.vertical)) fit.add(r);
    }
    if (!this.replaying) {
      const broken: StyleOp[] = [];
      for (const [s, r, c, t, f] of changed) if (s === this.sheet && !f && t.includes('\n') && !this.styles.get(KEY(r, c))?.wrap) broken.push([r, c, r, c, 'wrap']);
      if (broken.length) {
        await this.setStyles(broken);
        for (const op of broken) fit.add(op[0]);
      }
    }
    this.fitRows(fit);
    if (changed.length) this.events.onChanged(changed);
    if (changed.length && this.ruleLines.length) void this.refreshCf();
    if (changed.length && this.circles.size) void this.refreshCircles();
    const links = await this.engine.takeLinks(this.book);
    if (links.length) this.events.onLinks(links);
    const hst = await this.engine.history(this.book);
    this.events.onHistory(hst.undo, hst.redo);
    this.announce();
    this.paint();
    if (changed.length) this.objectsHook?.data();
  }

  localForms = false;

  async localise(text: string, toLocal: boolean): Promise<string> {
    if (!this.localForms || this.book < 0 || !text.trimStart().startsWith('=')) return text;
    return (await this.engine.tool(this.book, this.sheet, 'localform', toLocal ? 'to' : 'from', text)).message ?? text;
  }

  async setActive(entered: string): Promise<boolean> {
    const raw = await this.localise(entered, false);
    if (this.validLines.length && raw !== '') {
      const line = await this.engine.checkInput(this.book, this.sheet, this.ar, this.ac, raw);
      if (line) {
        const choice = await this.events.onInvalid(line.split('\t').map(unescapeField));
        if (choice === 'retry') {
          this.startEdit(entered);
          this.editor.select();
          return false;
        }
        if (choice === 'cancel') {
          this.paint();
          return false;
        }
      }
    }
    if (this.tableList.length && raw !== '' && this.activeTable()) {
      const typed = await this.engine.tool(this.book, this.sheet, 'typecheck', String(this.ar), String(this.ac), raw);
      if (typed.message) {
        const choice = await this.events.onInvalid(['', 'custom', '', '', '', 'e', 'warning', '', '', 'Column type', typed.message]);
        if (choice === 'retry') {
          this.startEdit(entered);
          this.editor.select();
          return false;
        }
        if (choice === 'cancel') {
          this.paint();
          return false;
        }
      }
    }
    this.recorder?.({ k: 'edit', sheet: this.sheet, r: this.ar, c: this.ac, raw });
    try {
      await this.commitEdits(await this.engine.apply(this.book, [[this.ar, this.ac, raw]], this.sheet));
    } catch (err) {
      this.events.onError?.(err instanceof Error ? err.message : String(err));
      this.paint();
      return true;
    }
    if (this.tableList.length) await this.tablesMoved();
    return true;
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
    if (edits.length) {
      if (this.recorder) for (const [r, c, raw] of edits) this.recorder({ k: 'edit', sheet: this.sheet, r, c, raw });
      await this.commitEdits(await this.engine.apply(this.book, edits, this.sheet));
    }
  }

  async whatif(cmd: string): Promise<string> {
    const r = await this.engine.whatif(this.book, cmd);
    await this.applyEffect(r.effect);
    return r.text;
  }

  replaying = false;

  async undo(): Promise<void> {
    this.replaying = true;
    try {
      await this.applyEffect(await this.engine.undo(this.book));
    } finally {
      this.replaying = false;
    }
  }

  async redo(): Promise<void> {
    this.replaying = true;
    try {
      await this.applyEffect(await this.engine.redo(this.book));
    } finally {
      this.replaying = false;
    }
  }

  async applyEffect(e: Effect): Promise<void> {
    for (const s of e.more ?? []) this.afterShift(s);
    if (e.shift) this.afterShift(e.shift);
    if (e.formats.length) this.events.onFormats(e.formats);
    if (e.objects != null) void this.objectsHook?.shifted?.(e.objects);
    if (e.styles.length) {
      this.applyStyles(e.styles);
      this.events.onStyles(e.styles.map(([s, r, c, raw]) => [s, r, c, raw]));
    }
    if (e.theme) await this.loadTheme();
    if (e.named) {
      this.dropWindows();
      this.paint();
    }
    if (e.theme || e.named) this.events.onLook();
    if (e.rules !== null) {
      const sheet = e.rules;
      const lines = await this.engine.rules(this.book, sheet);
      if (sheet === this.sheet) await this.loadRules();
      this.events.onRules(sheet, lines);
    }
    if (e.filter !== null) {
      const sheet = e.filter;
      const text = await this.engine.filter(this.book, sheet);
      if (sheet === this.sheet) await this.loadFilter();
      this.events.onFilter(sheet, text);
    }
    if (e.tables) {
      await this.loadTables();
      this.events.onTables(await this.engine.tables(this.book));
    }
    if (e.valid !== null) {
      const sheet = e.valid;
      const lines = await this.engine.validations(this.book, sheet);
      if (sheet === this.sheet) await this.loadValid();
      this.events.onValid(sheet, lines);
    }
    if (e.merges !== null) {
      const sheet = e.merges;
      const list = await this.engine.merges(this.book, sheet);
      if (sheet === this.sheet) this.merges = list;
      this.events.onMerges(sheet, list);
    }
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
    void this.objectsHook?.shifted?.(s.sheet);
    void this.loadMerges();
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
    const peers = this.peers();
    const mark = peers.length ? await this.engine.undoMark(this.book) : -1;
    const sh = await this.engine.shift(this.book, this.sheet, rows, Math.min(at, rows ? MAX_ROWS - 1 : MAX_COLS - 1), n, true);
    this.afterShift(sh);
    for (const p of peers) this.events.onShift(await this.engine.shift(this.book, p, rows, sh.at, n, true));
    if (mark >= 0) await this.engine.undoGroup(this.book, mark);
    await this.refreshHistory();
  }

  async remove(rows: boolean): Promise<void> {
    const s = this.sel();
    const n = rows ? s.r1 - s.r0 + 1 : s.c1 - s.c0 + 1;
    const peers = this.peers();
    const mark = peers.length ? await this.engine.undoMark(this.book) : -1;
    const sh = await this.engine.shift(this.book, this.sheet, rows, rows ? s.r0 : s.c0, n, false);
    this.afterShift(sh);
    for (const p of peers) this.events.onShift(await this.engine.shift(this.book, p, rows, sh.at, n, false));
    if (mark >= 0) await this.engine.undoGroup(this.book, mark);
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
    this.pushHidden();
  }

  private hiddenKey = '';

  private pushHidden(): void {
    if (this.book < 0) return;
    const rows = [...this.rows.state().hidden];
    const key = `${this.book}:${this.sheet}:${rows.join(',')}`;
    if (key === this.hiddenKey) return;
    this.hiddenKey = key;
    void this.engine.setHiddenRows(this.book, this.sheet, rows).then((e) => this.applyEffect(e));
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
    const pairs: [number, number, number, number][] = [];
    const lane = (cells: [number, number][], targets: [number, number][]) => {
      targets.forEach(([tr, tc], i) => pairs.push([tr, tc, cells[i % cells.length][0], cells[i % cells.length][1]]));
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
    const mark = await this.engine.undoMark(this.book);
    const fmts = await this.formatsOf(s);
    if (edits.length) await this.commitEdits(await this.engine.apply(this.book, edits, this.sheet));
    if (pairs.length <= 100000) {
      const items: FormatItem[] = pairs.map(([tr, tc, sr, sc]) => {
        const [st, code] = fmts.get(KEY(sr - s.r0, sc - s.c0)) ?? ['', ''];
        return [tr, tc, st, code];
      });
      await this.applyEffect(await this.engine.putFormats(this.book, this.sheet, items));
    }
    await this.engine.undoGroup(this.book, mark);
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
    if (this.copied?.text.replace(/\r/g, '') === text.replace(/\r/g, '')) {
      await this.pasteSpecial('all');
      return;
    }
    await this.commitEdits(await this.engine.apply(this.book, edits, this.sheet));
    const rows = grid.length;
    const cols = Math.max(...grid.map((r) => r.length));
    this.select(this.ar, this.ac, this.ar + rows - 1, this.ac + cols - 1);
  }

  private fitRows(rows: Set<number>): void {
    if (!rows.size || rows.size > 2000) return;
    const want = new Map<number, number>();
    for (const [k, st] of this.styles) {
      const r = Math.floor(k / MAX_COLS);
      if (!rows.has(r) || (!st.wrap && !st.size && !st.rot && !st.vertical) || this.mergeAt(r, k % MAX_COLS)) continue;
      const t = this.cache.get(k) ?? '';
      const px = this.font(st);
      const lh = Math.round(px * 1.3);
      let need: number;
      if (st.vertical) need = [...t.split('\n', 1)[0]].length * lh + 8;
      else if (st.rot) need = Math.abs(Math.sin((st.rot * Math.PI) / 180)) * this.ctx.measureText(t.split('\n', 1)[0]).width + lh + 8;
      else need = (st.wrap && t ? wrapLines(this.ctx, t, this.cols.size(k % MAX_COLS) - 10).length : 1) * lh + 8;
      want.set(r, Math.max(want.get(r) ?? 0, need));
    }
    let moved = false;
    for (const r of rows) {
      const h = Math.min(400, Math.max(this.rows.base, want.get(r) ?? 0));
      if (this.rows.isHidden(r) || this.rows.size(r) === h) continue;
      this.rows.setSize(r, h);
      moved = true;
    }
    if (!moved) return;
    this.emitView();
    this.paint();
  }

  sizeAtActive(): { row: number; col: number; base: number } {
    return { row: this.rows.size(this.ar), col: this.cols.size(this.ac), base: this.cols.base };
  }

  setSelectionSize(rows: boolean, px: number): void {
    const s = this.sel();
    const axis = rows ? this.rows : this.cols;
    const [a, b] = rows ? [s.r0, Math.min(s.r1, s.r0 + 10000)] : [s.c0, Math.min(s.c1, s.c0 + 2000)];
    for (let i = a; i <= b; i++) axis.setSize(i, px);
    this.resize();
    this.emitView();
    this.paint();
  }

  setStandardWidth(px: number): void {
    this.cols.setBase(px);
    this.resize();
    this.emitView();
    this.paint();
  }

  async autofitSelection(rows: boolean): Promise<void> {
    const s = this.sel();
    if (rows) {
      const set = new Set<number>();
      for (let r = s.r0; r <= Math.min(s.r1, s.r0 + 2000); r++) set.add(r);
      for (const r of set) if (!this.rows.isHidden(r)) this.rows.setSize(r, this.rows.base);
      this.fitRows(set);
      this.emitView();
      this.paint();
      return;
    }
    for (let c = s.c0; c <= Math.min(s.c1, s.c0 + 200); c++) await this.autofit(c);
    this.emitView();
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
    this.editor.value = initial ?? (this.masked.has(k) ? this.cache.get(k) : this.fx.get(k) ?? this.cache.get(k)) ?? '';
    this.reveal(this.ar, this.ac);
    this.placeEditor();
    this.editor.hidden = false;
    this.editor.focus({ preventScroll: true });
    const end = this.editor.value.length;
    this.editor.setSelectionRange(end, end);
    this.editor.dispatchEvent(new Event('input'));
    if (initial === undefined && this.localForms && this.editor.value.startsWith('=')) {
      const shown = this.editor.value;
      void this.localise(shown, true).then((v) => {
        if (!this.editing || this.editor.value !== shown || v === shown) return;
        this.editor.value = v;
        this.editor.setSelectionRange(v.length, v.length);
        this.editor.dispatchEvent(new Event('input'));
      });
    }
    this.paint();
  }

  private placeEditor(): void {
    const st = this.editor.style;
    const z = this.z;
    st.left = `${this.gw + this.x(this.ac) * z}px`;
    st.top = `${this.gh + this.y(this.ar) * z}px`;
    const [, , aw, ah] = this.activeArea();
    st.width = `${Math.max(aw, 60) * z}px`;
    st.height = `${Math.max(ah, 16) * z}px`;
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
    if (commit && !(await this.setActive(value))) return;
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
    const m = extend ? undefined : this.mergeAt(this.ar, this.ac);
    const fromR = extend ? this.fr2 : m ? (dr > 0 ? m[2] : m[0]) : this.ar;
    const fromC = extend ? this.fc2 : m ? (dc > 0 ? m[3] : m[1]) : this.ac;
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
      if (this.drag?.kind === 'break') {
        const at = this.hit(p.x, p.y);
        const to = this.drag.axis === 'row' ? at.row : at.col;
        if (to > 0 && to !== this.drag.to) {
          this.drag.to = to;
          this.paint();
        }
        return;
      }
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
      if (this.events.onHover) {
        const h = p.x > HEAD_W && p.y > HEAD_H ? this.hit(p.x, p.y) : null;
        this.events.onHover(h ? h.row : -1, h ? h.col : -1, e.clientX, e.clientY);
      }
      const b = this.boundary(p.x, p.y);
      const bar = this.splitBar(p.x, p.y);
      const brk = this.breakAt(p.x, p.y);
      if (brk) {
        this.canvas.style.cursor = brk.axis === 'row' ? 'row-resize' : 'col-resize';
        return;
      }
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
      const brk = this.breakAt(p.x, p.y);
      if (brk) {
        this.drag = { kind: 'break', axis: brk.axis, from: brk.index, to: brk.index };
        return;
      }
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
      } else if (!shift && this.onListArrow(p.x, p.y)) {
        this.enqueue(() => this.events.onList());
      } else if (!shift && this.onFilterButton(p.x, p.y, row, col, pr, pc)) {
        this.enqueue(() => {
          pane(true, true);
          this.select(row, col);
          this.events.onFilterMenu(col);
        });
      } else {
        this.drag = { kind: 'cells' };
        const open = (e.ctrlKey || e.metaKey) && !shift && this.linked.has(KEY(row, col));
        const box = !shift && !e.ctrlKey && !e.metaKey && this.isCheck(row, col) && Math.abs(p.x - (this.x(col) + this.cols.size(col) / 2)) <= 9 && Math.abs(p.y - (this.y(row) + this.rows.size(row) / 2)) <= 9;
        this.enqueue(async () => {
          pane(true, true);
          if (shift) this.extendTo(row, col);
          else this.select(row, col);
          if (box) await this.toggleCheck(row, col);
          if (open) this.events.onOpenLink();
        });
      }
    });

    el.addEventListener('pointerup', (e) => {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      const d = this.drag;
      this.drag = null;
      if (d?.kind === 'break') {
        if (d.to !== d.from) this.events.onBreakMove?.(d.axis, d.from, d.to);
        this.paint();
      } else if (this.painter && (d?.kind === 'cells' || d?.kind === 'rows' || d?.kind === 'cols')) this.enqueue(() => this.applyPainter());
      else if (d?.kind === 'fill') {
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
        this.fitRows(new Set([b.index]));
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

    this.editor.addEventListener('input', (e) => void this.suggest(e as InputEvent));

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

  private remember(text: string, s: Range): void {
    this.copied = null;
    if ((s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1) > 100000) return;
    const book = this.book;
    const sheet = this.sheet;
    void Promise.all([
      this.formatsOf(s),
      this.engine.read(book, s.r0, s.c0, s.r1, s.c1, sheet),
      this.engine.readValues(book, sheet, s.r0, s.c0, s.r1, s.c1),
    ]).then(([items, cells, vals]) => {
      const raw = new Map<number, string>();
      for (const [r, c, t, f] of cells) raw.set(KEY(r - s.r0, c - s.c0), f ?? t);
      const values = new Map<number, string>();
      for (const [r, c, v] of vals) values.set(KEY(r - s.r0, c - s.c0), v);
      const widths = Array.from({ length: s.c1 - s.c0 + 1 }, (_, i) => this.cols.size(s.c0 + i));
      this.copied = { text, h: s.r1 - s.r0 + 1, w: s.c1 - s.c0 + 1, items, raw, values, widths, r0: s.r0, c0: s.c0, sheet };
    });
  }

  canPasteSpecial(): boolean {
    return !!this.copied;
  }

  async pasteSpecial(kind: PasteKind, transpose = false): Promise<void> {
    const src = this.copied;
    if (!src || this.book < 0) return;
    const h = transpose ? src.w : src.h;
    const w = transpose ? src.h : src.w;
    const top = this.ar;
    const left = this.ac;
    const from = (i: number, j: number) => (transpose ? KEY(j, i) : KEY(i, j));
    const content = kind !== 'formats' && kind !== 'widths';
    const formats = kind === 'all' || kind === 'formats' || kind === 'no-borders';
    const codes = formats || kind === 'values-formats' || kind === 'formulas-formats';
    const mark = await this.engine.undoMark(this.book);
    if (content) {
      const edits: [number, number, string][] = [];
      const moves: [string, number, number][] = [];
      const moved: number[] = [];
      for (let i = 0; i < h && top + i < MAX_ROWS; i++) {
        for (let j = 0; j < w && left + j < MAX_COLS; j++) {
          const k = from(i, j);
          const si = Math.floor(k / MAX_COLS);
          const sj = k % MAX_COLS;
          const raw = src.raw.get(k) ?? '';
          const formulas = kind === 'all' || kind === 'formulas' || kind === 'formulas-formats' || kind === 'no-borders';
          if (formulas && raw.startsWith('=')) {
            moved.push(edits.length);
            moves.push([raw, top + i - (src.r0 + si), left + j - (src.c0 + sj)]);
          }
          edits.push([top + i, left + j, formulas ? raw : src.values.get(k) ?? '']);
        }
      }
      const texts = await this.engine.offset(moves);
      texts.forEach((t, n) => (edits[moved[n]][2] = t));
      if (edits.length) await this.commitEdits(await this.engine.apply(this.book, edits, this.sheet));
    }
    if (codes) {
      const items: FormatItem[] = [];
      for (let i = 0; i < h && top + i < MAX_ROWS; i++) {
        for (let j = 0; j < w && left + j < MAX_COLS; j++) {
          const [st, code] = src.items.get(from(i, j)) ?? ['', ''];
          const style = !formats ? KEEP : kind === 'no-borders' ? st.split(';').filter((t) => !/^b[trbl]:/.test(t)).join(';') : st;
          items.push([top + i, left + j, style, code]);
        }
      }
      await this.applyEffect(await this.engine.putFormats(this.book, this.sheet, items));
    }
    if (kind === 'widths') {
      src.widths.forEach((px, j) => {
        if (left + j < MAX_COLS) this.cols.setSize(left + j, px);
      });
      this.emitView();
    }
    await this.engine.undoGroup(this.book, mark);
    this.select(top, left, Math.min(MAX_ROWS - 1, top + h - 1), Math.min(MAX_COLS - 1, left + w - 1));
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
        this.remember(out.join('\n'), s);
      } else {
        void this.selectionTSV().then((t) => {
          this.remember(t, s);
          return navigator.clipboard?.writeText(t);
        }).catch(() => undefined);
      }
    }
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.z, y: (e.clientY - r.top) / this.z };
  }

  private enqueue(fn: () => void | Promise<void>): void {
    this.queue = this.queue.then(fn).catch((err: unknown) => {
      console.error(err);
      if (err instanceof Error && this.events.onError) this.events.onError(err.message);
    });
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
    if (this.ghost.size && !this.editing) {
      if (e.key === 'Enter' && !mod) {
        await this.acceptGhost();
        return;
      }
      this.clearGhost();
      if (e.key === 'Escape') return;
    }
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
    if (e.key === 'Escape' && this.painter) {
      this.stopPainter();
      return;
    }
    if (mod && e.altKey && e.code === 'KeyV') {
      const [x, y, , h] = this.activeArea();
      const r = this.canvas.getBoundingClientRect();
      this.events.onPasteMenu(r.left + x * this.z, r.top + (y + h) * this.z);
      return;
    }
    if (dir && e.altKey && e.shiftKey && !mod && (dir === 'left' || dir === 'right')) {
      this.groupAuto(dir === 'right' ? 1 : -1);
      return;
    }
    if (dir === 'down' && e.altKey && !e.shiftKey && !mod && this.filterArea && this.ar === this.filterArea[0] && this.ac >= this.filterArea[1] && this.ac <= this.filterArea[3]) {
      this.events.onFilterMenu(this.ac);
      return;
    }
    if (dir === 'down' && e.altKey && !e.shiftKey && !mod && this.hasList()) {
      this.events.onList();
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
      if (e.shiftKey && e.code === 'Minus') return this.borders('none');
      if (e.shiftKey && e.code === 'Digit7') return this.borders('outside');
      if (!e.shiftKey && e.code in TOGGLE_KEYS) return this.toggle(TOGGLE_KEYS[e.code]);
      if (k === '-' || k === '_') return this.removeAuto();
      if (e.code === 'Digit9') return this.hide(true, !e.shiftKey);
      if (e.code === 'Digit0') return this.hide(false, !e.shiftKey);
      if (e.shiftKey && e.code in SHORT_FORMATS) return this.setFormat(SHORT_FORMATS[e.code]);
      if (k === 'g') return this.events.onGoto();
      if (!e.shiftKey && (k === 'e' || k === 'f' || k === 'h')) return void (await runCommand(k === 'e' ? 'data.flash-fill' : k === 'f' ? 'edit.find' : 'edit.replace'));
      if (e.shiftKey && e.code === 'KeyL') return this.events.onFilterKey();
      if (!e.shiftKey && e.code === 'KeyT') return this.events.onTableKey();
      if (k === 'k' && !e.shiftKey) return this.events.onLinkBox();
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
      case ' ':
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && this.isCheck(this.ar, this.ac)) {
          e.preventDefault();
          return void (await this.toggleCheck());
        }
        break;
      case 'F2':
        return this.startEdit();
      case 'F5':
        return this.events.onGoto();
      case 'Delete':
        return this.clearSelection();
      case 'Backspace':
        return this.startEdit('');
      case 'Escape':
        return;
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

const ICON_COLOURS = ['#d9363e', '#e8a33d', '#e6c229', '#7cb342', '#2e9d58'];

export function drawIcon(ctx: CanvasRenderingContext2D, set: string, i: number, x: number, cy: number): void {
  const n = set.startsWith('5') ? 5 : set.startsWith('4') ? 4 : 3;
  const tone = n === 3 ? [0, 2, 4][i] : n === 4 ? [0, 1, 3, 4][i] : i;
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = ICON_COLOURS[tone] ?? ICON_COLOURS[2];
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cx = x + 6;
  if (set.includes('arrows')) {
    const angle = n === 3 ? [90, 0, -90][i] : n === 4 ? [90, 45, -45, -90][i] : [90, 45, 0, -45, -90][i];
    ctx.translate(cx, cy);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(5, 0);
    ctx.moveTo(1.5, -3.5);
    ctx.lineTo(5, 0);
    ctx.lineTo(1.5, 3.5);
    ctx.stroke();
  } else if (set === '3traffic') {
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
  } else if (set === '3flags') {
    ctx.fillRect(cx - 4, cy - 6, 1.5, 12);
    ctx.beginPath();
    ctx.moveTo(cx - 2.5, cy - 6);
    ctx.lineTo(cx + 5, cy - 3.5);
    ctx.lineTo(cx - 2.5, cy - 1);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    if (i === 0) {
      ctx.moveTo(cx - 2.5, cy - 2.5);
      ctx.lineTo(cx + 2.5, cy + 2.5);
      ctx.moveTo(cx + 2.5, cy - 2.5);
      ctx.lineTo(cx - 2.5, cy + 2.5);
    } else if (i === 1) {
      ctx.moveTo(cx, cy - 3);
      ctx.lineTo(cx, cy + 0.5);
      ctx.moveTo(cx, cy + 3);
      ctx.lineTo(cx, cy + 3);
    } else {
      ctx.moveTo(cx - 3, cy);
      ctx.lineTo(cx - 0.5, cy + 2.5);
      ctx.lineTo(cx + 3, cy - 2.5);
    }
    ctx.stroke();
  }
  ctx.restore();
}

const TOGGLE_KEYS: Record<string, 'b' | 'i' | 'u' | 's'> = { KeyB: 'b', Digit2: 'b', KeyI: 'i', Digit3: 'i', KeyU: 'u', Digit4: 'u', Digit5: 's' };
const OVERFLOW_COLS = 8;
const INDENT_PX = 10;

function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const word of para.split(' ')) {
      const next = cur ? `${cur} ${word}` : word;
      if (!cur || ctx.measureText(next).width <= width) cur = next;
      else {
        out.push(cur);
        cur = word;
      }
    }
    out.push(cur);
  }
  return out;
}

export const SHORT_FORMATS: Record<string, string> = {
  Backquote: '',
  Digit1: '#,##0.00',
  Digit2: 'h:mm AM/PM',
  Digit3: 'd-mmm-yy',
  Digit4: '$#,##0.00_);($#,##0.00)',
  Digit5: '0%',
  Digit6: '0.00E+00',
};

function wants(e: KeyboardEvent): boolean {
  if (ARROWS[e.key]) return true;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.altKey && e.code === 'KeyV') return true;
  if (mod) return !e.altKey && (['z', 'y', 'a', 'home', 'end', '+', '=', '-', '_', 'g', 'k', 'e', 'f', 'h'].includes(e.key.toLowerCase()) || (e.shiftKey && e.code === 'KeyL') || (!e.shiftKey && e.code === 'KeyT') || e.code === 'Digit9' || e.code === 'Digit0' || (e.shiftKey && (e.code in SHORT_FORMATS || e.code === 'Digit7')) || (!e.shiftKey && e.code in TOGGLE_KEYS));
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
