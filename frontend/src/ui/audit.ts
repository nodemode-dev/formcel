import type { Arrow, EngineClient, EvalStep } from '../engine';
import type { Grid } from '../grid/grid';
import { colName } from '../grid/a1';
import { icon } from './icons';

export type Watch = [sheet: number, row: number, col: number];

export interface AuditHost {
  grid: Grid;
  engine: EngineClient;
  book(): number | null;
  sheets(): string[];
  save(watches: Watch[]): void;
  say(text: string, bad?: boolean): void;
  goto(sheet: number, row: number, col: number): void;
}

type Box = [number, number, number, number];
type Traced = { sheet: number; row: number; col: number; kind: 'p' | 'd'; levels: number; arrows: Arrow[] };

const MAX_WATCH_RANGE = 50;

function cellRef(row: number, col: number): string {
  return `${colName(col)}${row + 1}`;
}

function quoted(name: string): string {
  return /^[\p{L}\p{N}_]+$/u.test(name) && !/^\d/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

function parseCells(text: string, fallback: number, sheets: string[]): Watch[] | null {
  const m = /^(?:'((?:[^']|'')+)'|([^!']+))!(.+)$/.exec(text.trim());
  const body = (m ? m[3] : text).replace(/\$/g, '').trim();
  let sheet = fallback;
  if (m) {
    const name = (m[1] ?? m[2]).replace(/''/g, "'").toLowerCase();
    sheet = sheets.findIndex((s) => s.toLowerCase() === name);
    if (sheet < 0) return null;
  }
  const r = /^([A-Za-z]{1,3})(\d{1,7})(?::([A-Za-z]{1,3})(\d{1,7}))?$/.exec(body);
  if (!r) return null;
  const col = (s: string) => [...s.toUpperCase()].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const [c0, r0] = [col(r[1]), Number(r[2]) - 1];
  const [c1, r1] = r[3] ? [col(r[3]), Number(r[4]) - 1] : [c0, r0];
  const out: Watch[] = [];
  for (let row = Math.min(r0, r1); row <= Math.max(r0, r1); row++) {
    for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) {
      if (row < 0 || c < 0) return null;
      if (out.length < MAX_WATCH_RANGE) out.push([sheet, row, c]);
    }
  }
  return out;
}

export class Audit {
  private traced: Traced[] = [];
  private evalForm: HTMLFormElement | null = null;
  private steps: EvalStep[] = [];
  private stepAt = 0;
  private refText = '';
  private stack: { steps: EvalStep[]; stepAt: number; refText: string }[] = [];
  private evalParts: { ref: HTMLElement; before: Text; now: HTMLElement; after: Text; count: HTMLElement; go: HTMLButtonElement; restart: HTMLButtonElement; into: HTMLButtonElement; out: HTMLButtonElement } | null = null;
  private panel: HTMLElement | null = null;
  private watches: Watch[] = [];
  private rows = new Map<string, { tr: HTMLTableRowElement; cells: HTMLTableCellElement[] }>();
  private picked = new Set<string>();
  private body: HTMLTableSectionElement | null = null;
  private empty: HTMLElement | null = null;
  private seq = 0;
  private color = '#3b82f6';

  constructor(private readonly host: AuditHost) {
    host.grid.setOverlay((ctx, box) => this.draw(ctx, box));
  }

  private key(w: Watch): string {
    return `${w[0]}:${w[1]}:${w[2]}`;
  }

  async trace(kind: 'p' | 'd'): Promise<void> {
    const book = this.host.book();
    if (book === null) return;
    const g = this.host.grid;
    const [row, col] = g.activeCell();
    const sheet = g.sheetIndex;
    const found = this.traced.find((t) => t.kind === kind && t.sheet === sheet && t.row === row && t.col === col);
    const levels = (found?.levels ?? 0) + 1;
    const arrows = await this.host.engine.trace(book, row, col, kind === 'd', levels, sheet);
    if (!arrows.length) {
      this.host.say(kind === 'p' ? 'Trace Precedents needs the active cell to hold a formula that refers to other cells.' : 'No formula refers to the active cell.', true);
      return;
    }
    if (found) {
      if (arrows.length === found.arrows.length) {
        this.host.say(kind === 'p' ? 'There are no more precedents to trace.' : 'There are no more dependents to trace.');
        return;
      }
      found.levels = levels;
      found.arrows = arrows;
    } else this.traced.push({ sheet, row, col, kind, levels, arrows });
    this.host.say('');
    g.setOverlay((ctx, box) => this.draw(ctx, box));
  }

  removeArrows(): void {
    if (!this.traced.length) return;
    this.traced = [];
    this.host.grid.setOverlay((ctx, box) => this.draw(ctx, box));
  }

  invalidate(): void {
    if (this.traced.length) this.removeArrows();
  }

  private draw(ctx: CanvasRenderingContext2D, box: (r0: number, c0: number, r1: number, c1: number) => Box): void {
    if (!this.traced.length) return;
    const sheet = this.host.grid.sheetIndex;
    const css = getComputedStyle(document.documentElement).getPropertyValue('--cell-link').trim();
    this.color = css || this.color;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    for (const t of this.traced) {
      for (const a of t.arrows) {
        const [fs, r0, c0, r1, c1, ts, tr, tc] = a;
        const here = fs === sheet;
        const there = ts === sheet;
        if (!here && !there) continue;
        if (here && there) {
          const [x, y, w, h] = box(r0, c0, r1, c1);
          const [tx, ty, , th] = box(tr, tc, tr, tc);
          if (r0 !== r1 || c0 !== c1) {
            ctx.setLineDash([]);
            ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
          }
          const single = r0 === r1 && c0 === c1;
          const sx = single ? x + Math.min(w / 2, 14) : x + 6;
          const sy = single ? y + h / 2 : y + 6;
          const ex = tx + 6;
          const ey = ty + th / 2;
          if (single && r0 === tr && c0 === tc) continue;
          this.arrow(ctx, sx, sy, ex, ey, true);
        } else {
          const [x, y, w, h] = here ? box(r0, c0, r1, c1) : box(tr, tc, tr, tc);
          const out = here;
          const ix = out ? x + w + 36 : x - 36;
          const iy = y + h / 2;
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = '#8a8a8b';
          ctx.fillStyle = '#8a8a8b';
          ctx.strokeRect(ix - 8, iy - 6, 16, 12);
          ctx.beginPath();
          ctx.moveTo(ix - 8, iy - 1);
          ctx.lineTo(ix + 8, iy - 1);
          ctx.stroke();
          this.arrow(ctx, out ? x + w / 2 : ix + 8, out ? iy : iy, out ? ix - 8 : x + 6, iy, out);
          ctx.setLineDash([]);
          ctx.strokeStyle = this.color;
          ctx.fillStyle = this.color;
        }
      }
    }
  }

  private arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, dot: boolean): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const ux = dx / len;
    const uy = dy / len;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * 9 - uy * 4, y1 - uy * 9 + ux * 4);
    ctx.lineTo(x1 - ux * 9 + uy * 4, y1 - uy * 9 - ux * 4);
    ctx.closePath();
    ctx.fill();
    if (dot) {
      ctx.beginPath();
      ctx.arc(x0, y0, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  async evaluate(): Promise<void> {
    const book = this.host.book();
    if (book === null) return;
    const g = this.host.grid;
    const [row, col] = g.activeCell();
    const steps = await this.host.engine.evalSteps(book, row, col, g.sheetIndex);
    if (!steps.length) {
      this.host.say('Evaluate Formula needs the active cell to hold a formula.', true);
      return;
    }
    const f = (this.evalForm ??= this.makeEval());
    this.steps = steps;
    this.stepAt = 0;
    this.stack = [];
    this.refText = `${quoted(this.host.sheets()[g.sheetIndex] ?? '')}!$${colName(col)}$${row + 1}`;
    this.showStep();
    f.hidden = false;
    this.evalParts!.go.focus();
  }

  private showStep(): void {
    const p = this.evalParts!;
    const [before, now, after, into] = this.steps[this.stepAt];
    p.before.nodeValue = before;
    p.now.textContent = now;
    p.after.nodeValue = after;
    const last = this.stepAt >= this.steps.length - 1;
    p.go.disabled = last;
    p.ref.textContent = this.refText;
    p.count.textContent = `Step ${this.stepAt + 1} of ${this.steps.length}`;
    p.restart.disabled = this.stepAt === 0 && this.stack.length === 0;
    p.into.disabled = !into;
    p.out.disabled = this.stack.length === 0;
  }

  private async stepIn(): Promise<void> {
    const into = this.steps[this.stepAt]?.[3];
    const book = this.host.book();
    if (!into || book === null) return;
    const [sheet, row, col] = into.split(':').map(Number);
    const steps = await this.host.engine.evalSteps(book, row, col, sheet);
    if (!steps.length) return;
    this.stack.push({ steps: this.steps, stepAt: this.stepAt, refText: this.refText });
    this.steps = steps;
    this.stepAt = 0;
    this.refText = `${quoted(this.host.sheets()[sheet] ?? '')}!$${colName(col)}$${row + 1}`;
    this.showStep();
  }

  private stepOut(): void {
    const parent = this.stack.pop();
    if (!parent) return;
    this.steps = parent.steps;
    this.stepAt = Math.min(parent.stepAt + 1, parent.steps.length - 1);
    this.refText = parent.refText;
    this.showStep();
  }

  private makeEval(): HTMLFormElement {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom fc-pw fc-eval';
    form.hidden = true;
    form.setAttribute('role', 'dialog');
    form.setAttribute('aria-label', 'Evaluate Formula');
    form.innerHTML =
      '<span class="fc-fmt-title">Evaluate Formula</span><div class="fc-eval-ref" data-k="ref"></div><div class="fc-eval-box" data-k="box" aria-live="polite"></div><span class="fc-eval-count" data-k="count"></span><div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="restart">Restart</button><button type="button" class="fc-btn" data-a="into">Step In</button><button type="button" class="fc-btn" data-a="out">Step Out</button><button type="submit" class="fc-btn fc-btn-primary" data-a="go">Evaluate</button><button type="button" class="fc-btn" data-a="close">Close</button></div>';
    document.getElementById('overlay-root')!.appendChild(form);
    const box = form.querySelector<HTMLElement>('[data-k="box"]')!;
    const before = document.createTextNode('');
    const now = document.createElement('span');
    now.className = 'fc-eval-now';
    const after = document.createTextNode('');
    box.append(before, now, after);
    this.evalParts = {
      ref: form.querySelector<HTMLElement>('[data-k="ref"]')!,
      before,
      now,
      after,
      count: form.querySelector<HTMLElement>('[data-k="count"]')!,
      go: form.querySelector<HTMLButtonElement>('[data-a="go"]')!,
      restart: form.querySelector<HTMLButtonElement>('[data-a="restart"]')!,
      into: form.querySelector<HTMLButtonElement>('[data-a="into"]')!,
      out: form.querySelector<HTMLButtonElement>('[data-a="out"]')!,
    };
    const close = () => {
      form.hidden = true;
      this.host.grid.focus();
    };
    form.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'close') close();
      if (a === 'restart') {
        const first = this.stack[0];
        if (first) {
          this.steps = first.steps;
          this.refText = first.refText;
          this.stack = [];
        }
        this.stepAt = 0;
        this.showStep();
      }
      if (a === 'into') void this.stepIn();
      if (a === 'out') this.stepOut();
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.stepAt < this.steps.length - 1) {
        this.stepAt++;
        this.showStep();
      }
    });
    return form;
  }

  load(watches: Watch[]): void {
    this.watches = watches.filter((w) => w.length === 3);
    this.removeArrows();
    if (this.panel) this.rebuild();
  }

  toggleWatch(): void {
    const p = (this.panel ??= this.makeWatch());
    p.hidden = !p.hidden;
    if (!p.hidden) {
      this.rebuild();
      void this.refresh();
      p.querySelector<HTMLInputElement>('[data-k="ref"]')!.focus();
    } else this.host.grid.focus();
  }

  private makeWatch(): HTMLElement {
    const p = document.createElement('section');
    p.className = 'fc-watch';
    p.hidden = true;
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'Watch Window');
    p.innerHTML =
      `<div class="fc-watch-head" data-k="head"><span class="fc-watch-title">Watch Window</span><button type="button" class="fc-tool" data-a="close" title="Close" aria-label="Close">${icon('close')}</button></div>` +
      '<div class="fc-watch-bar"><input class="fc-fmt-input" data-k="ref" spellcheck="false" autocomplete="off" placeholder="Cell to watch, such as B2 or Sheet2!C5" aria-label="Cell to watch"><button type="button" class="fc-btn" data-a="add">Add watch</button><button type="button" class="fc-btn" data-a="del">Delete watch</button></div>' +
      '<div class="fc-watch-list"><table class="fc-watch-table"><thead><tr><th>Sheet</th><th>Cell</th><th>Value</th><th>Formula</th></tr></thead><tbody></tbody></table><div class="fc-watch-empty">No cells are watched. Type a cell above, or leave it empty to watch the active cell.</div></div>';
    document.getElementById('overlay-root')!.appendChild(p);
    this.body = p.querySelector('tbody');
    this.empty = p.querySelector('.fc-watch-empty');
    const input = p.querySelector<HTMLInputElement>('[data-k="ref"]')!;
    const add = () => {
      const g = this.host.grid;
      const sheets = this.host.sheets();
      const text = input.value.trim();
      const list = text ? parseCells(text, g.sheetIndex, sheets) : [[g.sheetIndex, ...g.activeCell()] as Watch];
      if (!list) {
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      input.removeAttribute('aria-invalid');
      let added = false;
      for (const w of list) {
        if (!this.watches.some((x) => this.key(x) === this.key(w))) {
          this.watches.push(w);
          added = true;
        }
      }
      input.value = '';
      if (added) {
        this.rebuild();
        void this.refresh();
        this.host.save(this.watches);
      }
    };
    const del = () => {
      if (!this.picked.size) return;
      this.watches = this.watches.filter((w) => !this.picked.has(this.key(w)));
      this.picked.clear();
      this.rebuild();
      this.host.save(this.watches);
    };
    p.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'close') this.toggleWatch();
      if (a === 'add') add();
      if (a === 'del') del();
      const tr = t.closest<HTMLTableRowElement>('tbody tr');
      if (tr?.dataset.k) {
        if (!(e.ctrlKey || e.metaKey)) this.picked.clear();
        if (this.picked.has(tr.dataset.k) && (e.ctrlKey || e.metaKey)) this.picked.delete(tr.dataset.k);
        else this.picked.add(tr.dataset.k);
        for (const [k, r] of this.rows) r.tr.setAttribute('aria-selected', String(this.picked.has(k)));
      }
    });
    p.addEventListener('dblclick', (e) => {
      const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>('tbody tr');
      if (!tr?.dataset.k) return;
      const [s, r, c] = tr.dataset.k.split(':').map(Number);
      this.host.goto(s, r, c);
    });
    p.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.toggleWatch();
      else if (e.key === 'Enter' && e.target === input) {
        e.preventDefault();
        add();
      } else if (e.key === 'Delete' && e.target !== input) del();
    });
    const head = p.querySelector<HTMLElement>('[data-k="head"]')!;
    head.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const r = p.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      p.style.left = `${r.left}px`;
      p.style.top = `${r.top}px`;
      p.style.right = 'auto';
      p.style.bottom = 'auto';
      head.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => {
        p.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, m.clientX - dx))}px`;
        p.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, m.clientY - dy))}px`;
      };
      const up = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
    return p;
  }

  private rebuild(): void {
    const body = this.body;
    if (!body) return;
    const names = this.host.sheets();
    const keep = new Set<string>();
    const ordered: HTMLTableRowElement[] = [];
    for (const w of this.watches) {
      if (w[0] >= names.length) continue;
      const k = this.key(w);
      keep.add(k);
      let row = this.rows.get(k);
      if (!row) {
        const tr = document.createElement('tr');
        tr.dataset.k = k;
        tr.setAttribute('aria-selected', 'false');
        const cells = [0, 1, 2, 3].map(() => document.createElement('td'));
        tr.append(...cells);
        cells[0].textContent = names[w[0]];
        cells[1].textContent = cellRef(w[1], w[2]);
        row = { tr, cells };
        this.rows.set(k, row);
      }
      ordered.push(row.tr);
    }
    for (const [k, r] of this.rows) {
      if (!keep.has(k)) {
        r.tr.remove();
        this.rows.delete(k);
      }
    }
    ordered.forEach((tr, i) => {
      if (body.children[i] !== tr) body.insertBefore(tr, body.children[i] ?? null);
    });
    if (this.empty) this.empty.hidden = ordered.length > 0;
  }

  async refresh(): Promise<void> {
    const book = this.host.book();
    if (book === null || !this.panel || this.panel.hidden) return;
    const seq = ++this.seq;
    const names = this.host.sheets();
    const reads = await Promise.all(
      this.watches.filter((w) => w[0] < names.length).map(async (w) => {
        const [cell] = await this.host.engine.read(book, w[1], w[2], w[1], w[2], w[0]);
        return [w, cell] as const;
      }),
    );
    if (seq !== this.seq) return;
    for (const [w, cell] of reads) {
      const row = this.rows.get(this.key(w));
      if (!row) continue;
      const value = cell?.[2] ?? '';
      const formula = cell?.[3] ?? '';
      if (row.cells[2].textContent !== value) row.cells[2].textContent = value;
      if (row.cells[3].textContent !== formula) row.cells[3].textContent = formula;
      row.cells[0].textContent = names[w[0]];
    }
  }
}
