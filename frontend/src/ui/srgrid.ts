import { MAX_COLS, MAX_ROWS, colName } from '../grid/a1';
import type { Grid } from '../grid/grid';

interface Row {
  el: HTMLElement;
  head: HTMLElement;
  cells: Map<number, HTMLElement>;
}

const MAX_WINDOW_ROWS = 80;
const MAX_WINDOW_COLS = 30;

function role(el: HTMLElement, r: string, label?: string): HTMLElement {
  el.setAttribute('role', r);
  if (label) el.setAttribute('aria-label', label);
  return el;
}

export class ScreenReaderGrid {
  private readonly group = document.createElement('div');
  private readonly top = document.createElement('div');
  private readonly rows = new Map<number, Row>();
  private readonly heads = new Map<number, HTMLElement>();
  private timer = 0;
  private active = '';

  constructor(private readonly grid: Grid, private readonly sheetName: () => string) {
    const host = grid.el;
    host.setAttribute('aria-rowcount', String(MAX_ROWS + 1));
    host.setAttribute('aria-colcount', String(MAX_COLS + 1));
    host.setAttribute('aria-multiselectable', 'true');
    this.group.className = 'fc-sr-only fc-sr-grid';
    this.group.setAttribute('role', 'rowgroup');
    this.top.setAttribute('role', 'row');
    this.top.setAttribute('aria-rowindex', '1');
    const corner = document.createElement('div');
    role(corner, 'columnheader', 'Row and column');
    corner.setAttribute('aria-colindex', '1');
    this.top.appendChild(corner);
    this.group.appendChild(this.top);
    host.appendChild(this.group);
    grid.paintHook = () => this.schedule();
    this.schedule();
  }

  schedule(): void {
    if (this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.sync();
    }, 90);
  }

  private window(): { r0: number; r1: number; c0: number; c1: number } {
    const v = this.grid.visibleWindow();
    const [ar, ac] = this.grid.activeCell();
    let r0 = Math.max(0, Math.min(v.r0, ar));
    let r1 = Math.min(MAX_ROWS - 1, Math.max(v.r1, ar));
    let c0 = Math.max(0, Math.min(v.c0, ac));
    let c1 = Math.min(MAX_COLS - 1, Math.max(v.c1, ac));
    if (r1 - r0 + 1 > MAX_WINDOW_ROWS) {
      r0 = Math.max(0, Math.min(ar - Math.floor(MAX_WINDOW_ROWS / 2), MAX_ROWS - MAX_WINDOW_ROWS));
      r1 = r0 + MAX_WINDOW_ROWS - 1;
    }
    if (c1 - c0 + 1 > MAX_WINDOW_COLS) {
      c0 = Math.max(0, Math.min(ac - Math.floor(MAX_WINDOW_COLS / 2), MAX_COLS - MAX_WINDOW_COLS));
      c1 = c0 + MAX_WINDOW_COLS - 1;
    }
    return { r0, r1, c0, c1 };
  }

  private place(parent: HTMLElement, el: HTMLElement, key: number, siblings: Map<number, HTMLElement>): void {
    let next: HTMLElement | null = null;
    let best = Infinity;
    for (const [k, node] of siblings) {
      if (k > key && k < best && node !== el) {
        best = k;
        next = node;
      }
    }
    parent.insertBefore(el, next);
  }

  private sync(): void {
    const w = this.window();
    const sel = this.grid.selection();
    const [ar, ac] = this.grid.activeCell();
    for (const [r, row] of [...this.rows]) {
      if (r < w.r0 || r > w.r1) {
        row.el.remove();
        this.rows.delete(r);
      }
    }
    for (const [c, el] of [...this.heads]) {
      if (c < w.c0 || c > w.c1) {
        el.remove();
        this.heads.delete(c);
      }
    }
    for (let c = w.c0; c <= w.c1; c++) {
      let h = this.heads.get(c);
      if (!h) {
        h = document.createElement('div');
        role(h, 'columnheader');
        h.setAttribute('aria-colindex', String(c + 2));
        h.textContent = colName(c);
        this.heads.set(c, h);
        this.place(this.top, h, c, this.heads);
      }
    }
    for (let r = w.r0; r <= w.r1; r++) {
      let row = this.rows.get(r);
      if (!row) {
        const el = document.createElement('div');
        role(el, 'row');
        el.setAttribute('aria-rowindex', String(r + 2));
        const head = document.createElement('div');
        role(head, 'rowheader');
        head.setAttribute('aria-colindex', '1');
        head.textContent = String(r + 1);
        el.appendChild(head);
        row = { el, head, cells: new Map() };
        this.rows.set(r, row);
        const map = new Map<number, HTMLElement>();
        for (const [k, v] of this.rows) if (k !== r) map.set(k, v.el);
        this.place(this.group, el, r, map);
      }
      for (const [c, cell] of [...row.cells]) {
        if (c < w.c0 || c > w.c1) {
          cell.remove();
          row.cells.delete(c);
        }
      }
      for (let c = w.c0; c <= w.c1; c++) {
        let cell = row.cells.get(c);
        if (!cell) {
          cell = document.createElement('div');
          role(cell, 'gridcell');
          cell.id = `fc-sr-r${r}c${c}`;
          cell.setAttribute('aria-colindex', String(c + 2));
          row.cells.set(c, cell);
          this.place(row.el, cell, c, row.cells);
        }
        const text = this.grid.shownAt(r, c);
        if (cell.textContent !== text) cell.textContent = text;
        const picked = r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1;
        if (picked !== (cell.getAttribute('aria-selected') === 'true')) {
          if (picked) cell.setAttribute('aria-selected', 'true');
          else cell.removeAttribute('aria-selected');
        }
      }
    }
    const id = `fc-sr-r${ar}c${ac}`;
    if (id !== this.active) {
      this.active = id;
      this.grid.el.setAttribute('aria-activedescendant', id);
    }
    const label = this.sheetName();
    if (label && this.grid.el.getAttribute('aria-label') !== label) this.grid.el.setAttribute('aria-label', label);
  }
}
