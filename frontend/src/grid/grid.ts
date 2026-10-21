import type { Cell, Changed, Dir, EngineClient } from '../engine';
import { Axis } from './axis';
import { MAX_COLS, MAX_ROWS, a1, colName, parseRef, rangeText, type Range } from './a1';

const HEAD_H = 24;
const HEAD_W = 60;
const KEY = (r: number, c: number) => r * MAX_COLS + c;
const NUMERIC = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

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
  onSheet(sheet: number): void;
}

export class Grid {
  readonly rows = new Axis(MAX_ROWS, 24, 8);
  readonly cols = new Axis(MAX_COLS, 100, 12);
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly editor: HTMLTextAreaElement;
  private readonly cache = new Map<number, string>();
  private win: Range = { r0: 0, c0: 0, r1: -1, c1: -1 };
  private pendingWin: Range | null = null;
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
  private raf = 0;
  private queue: Promise<void> = Promise.resolve();
  private sheet = 0;
  private pal!: Palette;
  private drag: null | { kind: 'cells' | 'rows' | 'cols' } | { kind: 'resize-col' | 'resize-row'; index: number; start: number; size: number } = null;

  constructor(
    host: HTMLElement,
    private readonly engine: EngineClient,
    private book: number,
    private readonly events: GridEvents,
  ) {
    this.el = host;
    this.el.innerHTML = '<canvas class="fc-grid-canvas"></canvas><textarea class="fc-editor" spellcheck="false" hidden aria-label="Cell editor"></textarea>';
    this.canvas = this.el.querySelector('canvas')!;
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
    this.w = Math.max(1, Math.floor(r.width));
    this.h = Math.max(1, Math.floor(r.height));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.clampScroll();
    this.paintNow();
  }

  private frozenH(): number {
    return this.rows.offsetOf(this.fr);
  }

  private frozenW(): number {
    return this.cols.offsetOf(this.fc);
  }

  private clampScroll(): void {
    const maxY = Math.max(0, this.rows.total() - this.frozenH() - (this.h - HEAD_H - this.frozenH()));
    const maxX = Math.max(0, this.cols.total() - this.frozenW() - (this.w - HEAD_W - this.frozenW()));
    this.sy = Math.min(Math.max(0, this.sy), maxY);
    this.sx = Math.min(Math.max(0, this.sx), maxX);
  }

  private y(r: number): number {
    return r < this.fr ? HEAD_H + this.rows.offsetOf(r) : HEAD_H + this.rows.offsetOf(r) - this.sy;
  }

  private x(c: number): number {
    return c < this.fc ? HEAD_W + this.cols.offsetOf(c) : HEAD_W + this.cols.offsetOf(c) - this.sx;
  }

  private visible(): Range {
    const r0 = this.rows.indexAt(this.frozenH() + this.sy);
    const r1 = Math.min(MAX_ROWS - 1, this.rows.indexAt(this.sy + this.h - HEAD_H) + 1);
    const c0 = this.cols.indexAt(this.frozenW() + this.sx);
    const c1 = Math.min(MAX_COLS - 1, this.cols.indexAt(this.sx + this.w - HEAD_W) + 1);
    return { r0, c0, r1, c1 };
  }

  private ensureData(v: Range): void {
    if (this.book < 0) return;
    const need = { r0: Math.min(v.r0, this.fr ? 0 : v.r0), c0: Math.min(v.c0, this.fc ? 0 : v.c0), r1: v.r1, c1: v.c1 };
    const inside = (w: Range | null) => !!w && need.r0 >= w.r0 && need.r1 <= w.r1 && need.c0 >= w.c0 && need.c1 <= w.c1;
    if (inside(this.win) || inside(this.pendingWin)) return;
    const rows = v.r1 - v.r0 + 1;
    const cols = v.c1 - v.c0 + 1;
    const want: Range = {
      r0: Math.max(0, Math.min(need.r0, v.r0 - rows * 2)),
      r1: Math.min(MAX_ROWS - 1, v.r1 + rows * 2),
      c0: Math.max(0, Math.min(need.c0, v.c0 - cols)),
      c1: Math.min(MAX_COLS - 1, v.c1 + cols),
    };
    this.pendingWin = want;
    void this.engine.read(this.book, want.r0, want.c0, want.r1, want.c1, this.sheet).then((cells: Cell[]) => {
      if (this.pendingWin !== want) return;
      this.pendingWin = null;
      this.cache.clear();
      for (const [r, c, t] of cells) this.cache.set(KEY(r, c), t);
      this.win = want;
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
    const v = this.visible();
    this.ensureData(v);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, w, h);
    const fh = this.frozenH();
    const fw = this.frozenW();
    const rowSets: [number, number, number, number][] = [];
    const colSets: [number, number, number, number][] = [];
    if (this.fr) rowSets.push([0, this.fr - 1, HEAD_H, HEAD_H + fh]);
    rowSets.push([v.r0, v.r1, HEAD_H + fh, h]);
    if (this.fc) colSets.push([0, this.fc - 1, HEAD_W, HEAD_W + fw]);
    colSets.push([v.c0, v.c1, HEAD_W + fw, w]);
    ctx.font = '13px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    for (const [ra, rb, ytop, ybot] of rowSets) {
      for (const [ca, cb, xl, xr] of colSets) {
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
    ctx.strokeStyle = pal.frozen;
    ctx.lineWidth = 2;
    if (this.fr) this.line(HEAD_W, HEAD_H + fh, w, HEAD_H + fh);
    if (this.fc) this.line(HEAD_W + fw, HEAD_H, HEAD_W + fw, h);
    if (this.editing) this.placeEditor();
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
      for (let c = c0; c <= c1; c++) {
        const t = this.cache.get(KEY(r, c));
        if (!t) continue;
        const xx = this.x(c);
        const cw = this.cols.size(c);
        const text = t.split('\n', 1)[0];
        ctx.save();
        ctx.beginPath();
        ctx.rect(xx + 1, yy, cw - 2, rh);
        ctx.clip();
        if (NUMERIC.test(text)) {
          ctx.textAlign = 'right';
          ctx.fillText(text, xx + cw - 5, yy + rh / 2);
        } else if (text === 'TRUE' || text === 'FALSE') {
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

  private paintSelection(rowSets: [number, number, number, number][], colSets: [number, number, number, number][]): void {
    const { ctx, pal } = this;
    const s = this.sel();
    for (const [, , ytop, ybot] of rowSets) {
      for (const [, , xl, xr] of colSets) {
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
        ctx.restore();
      }
    }
  }

  private paintHeaders(rowSets: [number, number, number, number][], colSets: [number, number, number, number][]): void {
    const { ctx, pal, w, h } = this;
    const s = this.sel();
    ctx.fillStyle = pal.headBg;
    ctx.fillRect(0, 0, w, HEAD_H);
    ctx.fillRect(0, 0, HEAD_W, h);
    ctx.font = '11px "JetBrains Mono", ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    for (const [ca, cb, xl, xr] of colSets) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(xl, 0, xr - xl, HEAD_H);
      ctx.clip();
      for (let c = ca; c <= cb; c++) {
        const xx = this.x(c);
        const cw = this.cols.size(c);
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
    for (const [ra, rb, ytop, ybot] of rowSets) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, ytop, HEAD_W, ybot - ytop);
      ctx.clip();
      for (let r = ra; r <= rb; r++) {
        const yy = this.y(r);
        const rh = this.rows.size(r);
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

  private hit(px: number, py: number): { row: number; col: number } {
    const fh = this.frozenH();
    const fw = this.frozenW();
    const ly = py - HEAD_H;
    const lx = px - HEAD_W;
    const row = ly < fh ? this.rows.indexAt(Math.max(0, ly)) : this.rows.indexAt(ly + this.sy);
    const col = lx < fw ? this.cols.indexAt(Math.max(0, lx)) : this.cols.indexAt(lx + this.sx);
    return { row: Math.min(MAX_ROWS - 1, row), col: Math.min(MAX_COLS - 1, col) };
  }

  private boundary(px: number, py: number): { kind: 'col' | 'row'; index: number } | null {
    if (py < HEAD_H && px > HEAD_W) {
      const { col } = this.hit(px, HEAD_H);
      const right = this.x(col) + this.cols.size(col);
      if (Math.abs(px - right) <= 4) return { kind: 'col', index: col };
      if (col > 0 && Math.abs(px - this.x(col)) <= 4) return { kind: 'col', index: col - 1 };
    }
    if (px < HEAD_W && py > HEAD_H) {
      const { row } = this.hit(HEAD_W, py);
      const bottom = this.y(row) + this.rows.size(row);
      if (Math.abs(py - bottom) <= 3) return { kind: 'row', index: row };
      if (row > 0 && Math.abs(py - this.y(row)) <= 3) return { kind: 'row', index: row - 1 };
    }
    return null;
  }

  select(r0: number, c0: number, r1 = r0, c1 = c0, reveal = true): void {
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
    this.reveal(this.fr2, this.fc2);
    this.announce();
    this.paint();
  }

  reveal(r: number, c: number): void {
    const viewH = this.h - HEAD_H - this.frozenH();
    const viewW = this.w - HEAD_W - this.frozenW();
    if (r >= this.fr) {
      const top = this.rows.offsetOf(r) - this.frozenH();
      const bottom = top + this.rows.size(r);
      if (top < this.sy) this.sy = top;
      else if (bottom > this.sy + viewH) this.sy = bottom - viewH;
    }
    if (c >= this.fc) {
      const left = this.cols.offsetOf(c) - this.frozenW();
      const right = left + this.cols.size(c);
      if (left < this.sx) this.sx = left;
      else if (right > this.sx + viewW) this.sx = right - viewW;
    }
    this.clampScroll();
  }

  private announce(): void {
    this.events.onActive(this.cache.get(KEY(this.ar, this.ac)) ?? '', rangeText(this.sel()), this.sel());
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
    this.sx = 0;
    this.sy = 0;
    this.clampScroll();
    this.paint();
  }

  freezeAtActive(): void {
    this.freeze(this.ar, this.ac);
  }

  show(book: number, sheet: number): void {
    if (this.editing) {
      this.editing = false;
      this.editor.hidden = true;
    }
    this.book = book;
    this.sheet = sheet;
    this.cache.clear();
    this.win = { r0: 0, c0: 0, r1: -1, c1: -1 };
    this.pendingWin = null;
    this.ar = this.ac = this.fr2 = this.fc2 = 0;
    this.sx = this.sy = 0;
    this.fr = this.fc = 0;
    this.announce();
    this.paint();
  }

  get sheetIndex(): number {
    return this.sheet;
  }

  private async commitEdits(changed: Changed[]): Promise<void> {
    if (changed.length && changed.every(([s]) => s !== this.sheet)) {
      this.events.onSheet(changed[0][0]);
      this.show(this.book, changed[0][0]);
    }
    for (const [s, r, c, t] of changed) {
      if (s !== this.sheet) continue;
      if (t) this.cache.set(KEY(r, c), t);
      else this.cache.delete(KEY(r, c));
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
    await this.commitEdits(await this.engine.undo(this.book));
  }

  async redo(): Promise<void> {
    await this.commitEdits(await this.engine.redo(this.book));
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
    this.editor.value = initial ?? this.cache.get(KEY(this.ar, this.ac)) ?? '';
    this.reveal(this.ar, this.ac);
    this.placeEditor();
    this.editor.hidden = false;
    this.editor.focus({ preventScroll: true });
    const end = this.editor.value.length;
    this.editor.setSelectionRange(end, end);
    this.paint();
  }

  private placeEditor(): void {
    const st = this.editor.style;
    st.left = `${this.x(this.ac)}px`;
    st.top = `${this.y(this.ar)}px`;
    st.width = `${Math.max(this.cols.size(this.ac), 60)}px`;
    st.height = `${this.rows.size(this.ar)}px`;
  }

  private async endEdit(commit: boolean, move?: Dir): Promise<void> {
    if (!this.editing) return;
    this.editing = false;
    const value = this.editor.value;
    this.editor.hidden = true;
    this.focus();
    if (commit) await this.setActive(value);
    if (move) this.move(move, false);
    this.paint();
  }

  private move(dir: Dir, extend: boolean): void {
    const [dr, dc] = dir === 'up' ? [-1, 0] : dir === 'down' ? [1, 0] : dir === 'left' ? [0, -1] : [0, 1];
    if (extend) this.extendTo(this.fr2 + dr, this.fc2 + dc);
    else this.select(this.ar + dr, this.ac + dc);
  }

  private async jump(dir: Dir, extend: boolean): Promise<void> {
    const from: [number, number] = extend ? [this.fr2, this.fc2] : [this.ar, this.ac];
    const [r, c] = await this.engine.edge(this.book, from[0], from[1], dir, this.sheet);
    if (extend) this.extendTo(r, c);
    else this.select(r, c);
  }

  private pageRows(): number {
    return Math.max(1, Math.floor((this.h - HEAD_H - this.frozenH()) / this.rows.base) - 1);
  }

  private bind(): void {
    const el = this.el;
    el.tabIndex = 0;
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = e.deltaMode === 1 ? this.rows.base : e.deltaMode === 2 ? this.h : 1;
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      this.sx += dx * k;
      this.sy += dy * k;
      this.clampScroll();
      if (this.editing) void this.endEdit(true);
      this.paint();
    }, { passive: false });

    el.addEventListener('pointermove', (e) => {
      if (e.target !== this.canvas) return;
      const p = this.local(e);
      if (this.drag && (this.drag.kind === 'resize-col' || this.drag.kind === 'resize-row')) {
        const d = this.drag;
        if (d.kind === 'resize-col') this.cols.setSize(d.index, d.size + p.x - d.start);
        else this.rows.setSize(d.index, d.size + p.y - d.start);
        this.clampScroll();
        this.paint();
        return;
      }
      if (this.drag) {
        const { row, col } = this.hit(p.x, p.y);
        if (this.drag.kind === 'cols') this.extendTo(MAX_ROWS - 1, col);
        else if (this.drag.kind === 'rows') this.extendTo(row, MAX_COLS - 1);
        else this.extendTo(row, col);
        return;
      }
      const b = this.boundary(p.x, p.y);
      this.canvas.style.cursor = b ? (b.kind === 'col' ? 'col-resize' : 'row-resize') : 'cell';
    });

    el.addEventListener('pointerdown', (e) => {
      if (e.target !== this.canvas || e.button !== 0) return;
      e.preventDefault();
      if (this.editing) void this.endEdit(true);
      this.focus();
      const p = this.local(e);
      this.canvas.setPointerCapture(e.pointerId);
      const b = this.boundary(p.x, p.y);
      if (b) {
        this.drag = b.kind === 'col'
          ? { kind: 'resize-col', index: b.index, start: p.x, size: this.cols.size(b.index) }
          : { kind: 'resize-row', index: b.index, start: p.y, size: this.rows.size(b.index) };
        return;
      }
      const { row, col } = this.hit(p.x, p.y);
      if (p.y < HEAD_H && p.x < HEAD_W) {
        this.select(0, 0, MAX_ROWS - 1, MAX_COLS - 1, false);
      } else if (p.y < HEAD_H) {
        this.drag = { kind: 'cols' };
        if (e.shiftKey) this.extendTo(MAX_ROWS - 1, col);
        else this.select(0, col, MAX_ROWS - 1, col, false);
      } else if (p.x < HEAD_W) {
        this.drag = { kind: 'rows' };
        if (e.shiftKey) this.extendTo(row, MAX_COLS - 1);
        else this.select(row, 0, row, MAX_COLS - 1, false);
      } else {
        this.drag = { kind: 'cells' };
        if (e.shiftKey) this.extendTo(row, col);
        else this.select(row, col);
      }
    });

    el.addEventListener('pointerup', (e) => {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      this.drag = null;
    });

    el.addEventListener('dblclick', (e) => {
      if (e.target !== this.canvas) return;
      const p = this.local(e);
      const b = this.boundary(p.x, p.y);
      if (b?.kind === 'col') void this.autofit(b.index);
      else if (b?.kind === 'row') {
        this.rows.setSize(b.index, this.rows.base);
        this.paint();
      } else if (p.x > HEAD_W && p.y > HEAD_H) this.startEdit();
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
      const inCache = s.r0 >= this.win.r0 && s.r1 <= this.win.r1 && s.c0 >= this.win.c0 && s.c1 <= this.win.c1 && (s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1) <= 100000;
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
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private enqueue(fn: () => void | Promise<void>): void {
    this.queue = this.queue.then(fn).catch((err: unknown) => console.error(err));
  }

  private editorKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.altKey) {
      e.preventDefault();
      const dir = e.shiftKey ? 'up' : 'down';
      this.enqueue(() => this.endEdit(true, dir));
    } else if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      const t = this.editor;
      const at = t.selectionStart;
      t.setRangeText('\n', at, t.selectionEnd, 'end');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const dir = e.shiftKey ? 'left' : 'right';
      this.enqueue(() => this.endEdit(true, dir));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.enqueue(() => this.endEdit(false));
    }
  }

  private async gridKey(e: KeyboardEvent): Promise<void> {
    const mod = e.ctrlKey || e.metaKey;
    const dir = ARROWS[e.key];
    if (this.editing) {
      if (e.key === 'Enter' && e.altKey) this.editor.value += '\n';
      else if (e.key === 'Enter') await this.endEdit(true, e.shiftKey ? 'up' : 'down');
      else if (e.key === 'Tab') await this.endEdit(true, e.shiftKey ? 'left' : 'right');
      else if (e.key === 'Escape') await this.endEdit(false);
      else if (dir && !mod) await this.endEdit(true, dir);
      else if (e.key === 'Backspace') this.editor.value = this.editor.value.slice(0, -1);
      else if (e.key.length === 1 && !mod) this.editor.value += e.key;
      return;
    }
    if (dir) {
      if (mod) await this.jump(dir, e.shiftKey);
      else this.move(dir, e.shiftKey);
      return;
    }
    if (mod) {
      const k = e.key.toLowerCase();
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
        return this.move(e.shiftKey ? 'up' : 'down', false);
      case 'Tab':
        return this.move(e.shiftKey ? 'left' : 'right', false);
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
      case 'Delete':
        return this.clearSelection();
      case 'Backspace':
        return this.startEdit('');
    }
    if (this.editing) {
      this.editor.value += e.key;
      return;
    }
    this.startEdit(e.key);
  }
}

const ARROWS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function wants(e: KeyboardEvent): boolean {
  if (ARROWS[e.key]) return true;
  const mod = e.ctrlKey || e.metaKey;
  if (mod) return !e.altKey && ['z', 'y', 'a', 'home', 'end'].includes(e.key.toLowerCase());
  if (['Enter', 'Tab', 'Escape', 'Home', 'PageDown', 'PageUp', 'F2', 'Delete', 'Backspace'].includes(e.key)) return true;
  return e.key.length === 1 && !e.altKey;
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
