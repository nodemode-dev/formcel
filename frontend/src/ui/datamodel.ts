import type { Effect } from '../engine/protocol';
import { engine } from '../engine';
import { icon } from './icons';

export interface ModelHost {
  book(): number;
  tables(): { name: string; sheet: number; area: [number, number, number, number] }[];
  sheetName(i: number): string;
  selection(): { sheet: number; r0: number; c0: number; r1: number; c1: number };
  activeTable(): string | null;
  changed(effect: Effect, lines: string[]): Promise<void>;
  say(msg: string, bad?: boolean): void;
}

interface MCol { name: string; calc: string; fmt: string; kind: string; err: string }
interface MTable { name: string; source: string; ref: string; rows: number; cols: MCol[] }
interface MRel { from: [string, string]; to: [string, string]; active: boolean; err: string }
interface MMeasure { table: string; name: string; expr: string; fmt: string; err: string }
interface MHier { table: string; name: string; levels: string[] }
interface MKpi { name: string; value: string; goal: string; lo: number; hi: number }
interface MConn { name: string; text: string }
interface Info { tables: MTable[]; rels: MRel[]; measures: MMeasure[]; hiers: MHier[]; kpis: MKpi[]; conns: MConn[] }

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
const cmd = (...p: string[]) => p.map(esc).join('\t');
const LIST = '\u001f';
const PAGE = 200;
const FMTS: [string, string][] = [['', 'General'], ['int', 'Whole number'], ['dec2', 'Decimal (2 places)'], ['pct', 'Percentage']];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function btn(label: string, cls = 'fc-btn'): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  return b;
}

function sel(options: [string, string][], value = ''): HTMLSelectElement {
  const s = el('select', 'fc-fmt-input');
  for (const [v, t] of options) {
    const o = el('option', '', t);
    o.value = v;
    s.appendChild(o);
  }
  s.value = value;
  return s;
}

function input(ph = '', mono = false): HTMLInputElement {
  const i = el('input', mono ? 'fc-fmt-input fc-dm-mono' : 'fc-fmt-input');
  i.placeholder = ph;
  i.spellcheck = false;
  i.autocomplete = 'off';
  return i;
}

export class DataModelWindow {
  readonly el: HTMLElement;
  private info: Info = { tables: [], rels: [], measures: [], hiers: [], kpis: [], conns: [] };
  private tab: 'data' | 'diagram' | 'measures' = 'data';
  private current = '';
  private from = 0;
  private panes: Record<string, HTMLElement> = {};
  private tabBtns: Record<string, HTMLButtonElement> = {};
  private foot = el('div', 'fc-dm-foot');
  private strip = el('div', 'fc-dm-strip');
  private pos = new Map<string, { x: number; y: number }>();
  private chosen = -1;
  private grid = el('div', 'fc-dm-grid');
  private fbar = el('div', 'fc-dm-fbar');
  private canvas = el('div', 'fc-dm-canvas');
  private side = el('div', 'fc-dm-side');
  private lines: SVGSVGElement;
  private editing = '';
  private busy = false;

  constructor(private readonly host: ModelHost) {
    const root = (this.el = el('section', 'fc-dm'));
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Data Model');
    const head = el('div', 'fc-dm-head');
    const title = el('div', 'fc-dm-title');
    title.innerHTML = `${icon('dataModel')}<span>Data Model</span><small>ThisWorkbookDataModel</small>`;
    const close = btn('', 'fc-tool fc-dm-close');
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = icon('close');
    close.addEventListener('click', () => this.close());
    const tabs = el('div', 'fc-dm-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [k, t] of [['data', 'Data View'], ['diagram', 'Diagram View'], ['measures', 'Measures and KPIs']] as const) {
      const b = btn(t, 'fc-dm-tab');
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.show(k));
      this.tabBtns[k] = b;
      tabs.appendChild(b);
    }
    head.append(title, tabs, close);
    const bar = el('div', 'fc-dm-bar');
    const add = btn('Add selection');
    add.title = 'Add the active table, or the selected range with a header row, to the Data Model';
    add.addEventListener('click', () => void this.addSelection());
    const pick = sel([['', 'Add table...']]);
    pick.className = 'fc-fmt-input fc-dm-pick';
    pick.addEventListener('focus', () => this.fillPicker(pick));
    pick.addEventListener('mousedown', () => this.fillPicker(pick));
    pick.addEventListener('change', () => {
      if (pick.value) void this.addTable(pick.value);
      pick.value = '';
    });
    const refresh = btn('Refresh all');
    refresh.addEventListener('click', () => void this.refresh(''));
    const remove = btn('Remove table');
    remove.addEventListener('click', () => void this.removeTable());
    bar.append(add, pick, refresh, remove);
    const body = el('div', 'fc-dm-body');
    this.panes.data = this.dataPane();
    this.panes.diagram = this.diagramPane();
    this.panes.measures = this.measuresPane();
    body.append(this.panes.data, this.panes.diagram, this.panes.measures);
    this.lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    root.append(head, bar, body, this.foot);
    document.getElementById('overlay-root')!.appendChild(root);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    });
  }

  isOpen(): boolean {
    return !this.el.hidden;
  }

  async open(tab?: 'data' | 'diagram' | 'measures'): Promise<void> {
    this.el.hidden = false;
    await this.load();
    this.show(tab ?? this.tab);
    this.tabBtns[this.tab].focus();
  }

  close(): void {
    this.el.hidden = true;
  }

  private say(msg: string, bad = false): void {
    this.foot.textContent = msg;
    this.foot.dataset.bad = bad ? '1' : '';
    this.host.say(msg, bad);
  }

  private async run(...p: string[]): Promise<{ text: string; ok: boolean; effect: Effect }> {
    const r = await engine().model(this.host.book(), cmd(...p));
    const bad = r.text.startsWith('error\t');
    return { text: bad ? r.text.slice(6) : r.text, ok: !bad, effect: r.effect };
  }

  private async commit(r: { effect: Effect }): Promise<void> {
    const lines = await engine().modelLines(this.host.book());
    await this.host.changed(r.effect, lines);
    await this.load();
  }

  private async load(): Promise<void> {
    const r = await this.run('info');
    try {
      this.info = JSON.parse(r.text) as Info;
    } catch {
      this.info = { tables: [], rels: [], measures: [], hiers: [], kpis: [], conns: [] };
    }
    if (!this.info.tables.some((t) => t.name === this.current)) {
      this.current = this.info.tables[0]?.name ?? '';
      this.from = 0;
    }
    this.paint();
  }

  private paint(): void {
    this.paintStrip();
    void this.paintGrid();
    this.paintDiagram();
    this.paintMeasures();
    this.foot.textContent ||= this.info.tables.length ? `${this.info.tables.length} table${this.info.tables.length === 1 ? '' : 's'}, ${this.info.rels.length} relationship${this.info.rels.length === 1 ? '' : 's'}, ${this.info.measures.length} measure${this.info.measures.length === 1 ? '' : 's'}` : 'The Data Model is empty. Add a table to start.';
  }

  private show(t: 'data' | 'diagram' | 'measures'): void {
    this.tab = t;
    for (const [k, p] of Object.entries(this.panes)) p.hidden = k !== t;
    for (const [k, b] of Object.entries(this.tabBtns)) {
      b.setAttribute('aria-selected', String(k === t));
      b.dataset.on = k === t ? '1' : '';
    }
    if (t === 'diagram') this.drawLines();
  }

  private fillPicker(pick: HTMLSelectElement): void {
    const have = new Set(this.info.tables.map((t) => t.name.toLowerCase()));
    const opts = this.host.tables().filter((t) => !have.has(t.name.toLowerCase()));
    pick.replaceChildren();
    const first = el('option', '', opts.length ? 'Add table...' : 'No other workbook tables');
    first.value = '';
    pick.appendChild(first);
    for (const t of opts) {
      const o = el('option', '', `${t.name} (${this.host.sheetName(t.sheet)})`);
      o.value = t.name;
      pick.appendChild(o);
    }
  }

  private async addTable(name: string): Promise<void> {
    const r = await this.run('addtable', name, 'table', name);
    if (!r.ok) return this.say(r.text, true);
    this.current = name;
    this.say(`Added ${name} to the Data Model.`);
    await this.commit(r);
  }

  private async addSelection(): Promise<void> {
    const t = this.host.activeTable();
    if (t) return this.addTable(t);
    const s = this.host.selection();
    const col = (c: number) => {
      let n = c + 1;
      let out = '';
      while (n > 0) {
        out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
        n = Math.floor((n - 1) / 26);
      }
      return out;
    };
    const ref = `'${this.host.sheetName(s.sheet).replace(/'/g, "''")}'!${col(s.c0)}${s.r0 + 1}:${col(s.c1)}${s.r1 + 1}`;
    let k = 1;
    while (this.info.tables.some((x) => x.name.toLowerCase() === `range${k}`)) k++;
    const name = window.prompt('Name for the table in the Data Model (the first row of the selection is its header)', `Range${k}`);
    if (!name) return;
    const r = await this.run('addtable', name.trim(), 'range', ref);
    if (!r.ok) return this.say(r.text, true);
    this.current = name.trim();
    this.say(`Added ${name.trim()} to the Data Model.`);
    await this.commit(r);
  }

  private async removeTable(): Promise<void> {
    if (!this.current) return;
    if (!window.confirm(`Remove ${this.current} from the Data Model? Its relationships and measures go with it.`)) return;
    const r = await this.run('removetable', this.current);
    if (!r.ok) return this.say(r.text, true);
    this.say(`Removed ${this.current}.`);
    await this.commit(r);
  }

  private async refresh(name: string): Promise<void> {
    const r = await this.run('refresh', name);
    if (!r.ok) return this.say(r.text, true);
    this.say('Refreshed from the workbook. CUBE formulas and Data Model PivotTables are recalculated.');
    await this.commit(r);
  }

  private dataPane(): HTMLElement {
    const p = el('div', 'fc-dm-pane fc-dm-data');
    const add = el('div', 'fc-dm-addcol');
    const name = input('New column name');
    const f = input('= calculated column formula, e.g. =[Quantity] * [Price]', true);
    const go = btn('Add calculated column');
    const save = btn('Save formula');
    save.hidden = true;
    const del = btn('Delete column');
    del.hidden = true;
    add.append(name, f, go, save, del);
    this.fbar = add;
    go.addEventListener('click', async () => {
      if (!this.current) return this.say('Add a table first.', true);
      const r = await this.run('setcol', this.current, name.value, f.value);
      if (!r.ok) return this.say(r.text, true);
      name.value = '';
      f.value = '';
      this.say('Calculated column added.');
      await this.commit(r);
    });
    save.addEventListener('click', async () => {
      const r = await this.run('setcol', this.current, this.editing, f.value);
      if (!r.ok) return this.say(r.text, true);
      this.say('Formula saved.');
      await this.commit(r);
    });
    del.addEventListener('click', async () => {
      const r = await this.run('delcol', this.current, this.editing);
      if (!r.ok) return this.say(r.text, true);
      this.editing = '';
      await this.commit(r);
    });
    this.grid.className = 'fc-dm-grid';
    this.strip.className = 'fc-dm-strip';
    p.append(add, this.grid, this.strip);
    return p;
  }

  private paintStrip(): void {
    const have = [...this.strip.children] as HTMLButtonElement[];
    const names = this.info.tables.map((t) => t.name);
    if (have.length !== names.length || have.some((b, i) => b.dataset.t !== names[i])) {
      this.strip.replaceChildren(
        ...names.map((n) => {
          const b = btn(n, 'fc-dm-ttab');
          b.dataset.t = n;
          b.addEventListener('click', () => {
            this.current = n;
            this.from = 0;
            this.editing = '';
            this.paintStrip();
            void this.paintGrid();
          });
          return b;
        }),
      );
    }
    for (const b of this.strip.children as HTMLCollectionOf<HTMLElement>) b.dataset.on = b.dataset.t === this.current ? '1' : '';
  }

  private async paintGrid(): Promise<void> {
    const t = this.info.tables.find((x) => x.name === this.current);
    if (!t) {
      this.grid.replaceChildren(el('p', 'fc-dm-empty', 'The Data Model has no tables. Select a table or a range with a header row in the sheet and choose Add selection.'));
      return;
    }
    const r = await this.run('data', t.name, String(this.from), String(PAGE));
    let rows: string[][] = [];
    try {
      rows = JSON.parse(r.text) as string[][];
    } catch {
      rows = [];
    }
    const table = el('table', 'fc-dm-table');
    const hr = el('tr');
    hr.appendChild(el('th', 'fc-dm-rn', ''));
    t.cols.forEach((c) => {
      const th = el('th', c.calc ? 'fc-dm-calc' : '', '');
      th.append(c.calc ? el('i', '', 'fx ') : '', c.name);
      if (c.err) th.title = c.err;
      th.addEventListener('click', () => this.pickColumn(c));
      hr.appendChild(th);
    });
    const head = el('thead');
    head.appendChild(hr);
    const bodyEl = el('tbody');
    rows.forEach((row, i) => {
      const tr = el('tr');
      tr.appendChild(el('td', 'fc-dm-rn', String(this.from + i + 1)));
      row.forEach((v, j) => {
        const td = el('td', t.cols[j]?.kind === 'n' ? 'fc-dm-num' : '', v);
        tr.appendChild(td);
      });
      bodyEl.appendChild(tr);
    });
    table.append(head, bodyEl);
    const more = el('div', 'fc-dm-more');
    const total = t.rows;
    more.append(`Rows ${total ? this.from + 1 : 0} to ${Math.min(this.from + PAGE, total)} of ${total}  `);
    const prev = btn('Previous');
    prev.disabled = this.from === 0;
    prev.addEventListener('click', () => {
      this.from = Math.max(0, this.from - PAGE);
      void this.paintGrid();
    });
    const next = btn('Next');
    next.disabled = this.from + PAGE >= total;
    next.addEventListener('click', () => {
      this.from += PAGE;
      void this.paintGrid();
    });
    more.append(prev, next, el('span', 'fc-dm-src', `Source: ${t.source === 'manual' ? 'pasted data' : `${t.source} ${t.ref}`}`));
    this.grid.replaceChildren(table, more);
  }

  private pickColumn(c: MCol): void {
    const inputs = this.fbar.querySelectorAll('input');
    const [save, del] = [this.fbar.querySelectorAll('button')[1], this.fbar.querySelectorAll('button')[2]];
    if (c.calc) {
      this.editing = c.name;
      inputs[0].value = c.name;
      inputs[0].disabled = true;
      inputs[1].value = `=${c.calc.replace(/^=/, '')}`;
      save.hidden = false;
      del.hidden = false;
    } else {
      this.editing = c.name;
      inputs[0].disabled = false;
      inputs[0].value = '';
      inputs[1].value = '';
      save.hidden = true;
      del.hidden = false;
    }
  }

  private diagramPane(): HTMLElement {
    const p = el('div', 'fc-dm-pane fc-dm-diagram');
    p.hidden = true;
    this.lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.lines.setAttribute('class', 'fc-dm-lines');
    this.canvas.append(this.lines);
    this.side.className = 'fc-dm-side';
    p.append(this.canvas, this.side);
    return p;
  }

  private box(t: MTable, i: number): HTMLElement {
    const b = el('div', 'fc-dm-box');
    b.dataset.t = t.name;
    const pos = this.pos.get(t.name) ?? { x: 24 + (i % 3) * 270, y: 24 + Math.floor(i / 3) * 250 };
    this.pos.set(t.name, pos);
    b.style.left = `${pos.x}px`;
    b.style.top = `${pos.y}px`;
    const h = el('div', 'fc-dm-box-head', t.name);
    h.addEventListener('pointerdown', (e) => {
      const sx = e.clientX - pos.x;
      const sy = e.clientY - pos.y;
      h.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => {
        pos.x = Math.max(0, m.clientX - sx);
        pos.y = Math.max(0, m.clientY - sy);
        b.style.left = `${pos.x}px`;
        b.style.top = `${pos.y}px`;
        this.drawLines();
      };
      const up = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
    });
    const list = el('div', 'fc-dm-flds');
    for (const c of t.cols) {
      const f = el('div', c.calc ? 'fc-dm-fld fc-dm-fcalc' : 'fc-dm-fld', c.name);
      f.dataset.t = t.name;
      f.dataset.c = c.name;
      f.addEventListener('pointerdown', (e) => this.dragRel(e, f));
      list.appendChild(f);
    }
    b.append(h, list);
    for (const hi of this.info.hiers.filter((x) => x.table === t.name)) {
      const hh = el('div', 'fc-dm-hier', hi.name);
      hh.title = hi.levels.join(' > ');
      b.appendChild(hh);
    }
    return b;
  }

  private anchor(t: string, c: string, side: 'l' | 'r'): { x: number; y: number } | null {
    const box = this.canvas.querySelector<HTMLElement>(`.fc-dm-box[data-t="${CSS.escape(t)}"]`);
    if (!box) return null;
    const f = [...box.querySelectorAll<HTMLElement>('.fc-dm-fld')].find((n) => n.dataset.c === c);
    const y = box.offsetTop + (f ? f.offsetTop + f.offsetHeight / 2 : 14);
    return { x: box.offsetLeft + (side === 'r' ? box.offsetWidth : 0), y };
  }

  private drawLines(): void {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = this.lines;
    if (this.panes.diagram.hidden) return;
    svg.replaceChildren();
    this.info.rels.forEach((r, i) => {
      const a = this.anchor(r.from[0], r.from[1], 'r');
      const b = this.anchor(r.to[0], r.to[1], 'l');
      if (!a || !b) return;
      const left = (this.pos.get(r.from[0])?.x ?? 0) > (this.pos.get(r.to[0])?.x ?? 0);
      const A = left ? this.anchor(r.from[0], r.from[1], 'l')! : a;
      const B = left ? this.anchor(r.to[0], r.to[1], 'r')! : b;
      const mid = (A.x + B.x) / 2;
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', `M${A.x},${A.y} C${mid},${A.y} ${mid},${B.y} ${B.x},${B.y}`);
      path.setAttribute('class', `fc-dm-rel${r.active ? '' : ' fc-dm-off'}${r.err ? ' fc-dm-bad' : ''}${i === this.chosen ? ' fc-dm-sel' : ''}`);
      const hit = document.createElementNS(ns, 'path');
      hit.setAttribute('d', path.getAttribute('d')!);
      hit.setAttribute('class', 'fc-dm-hit');
      hit.addEventListener('click', () => {
        this.chosen = i;
        this.paintSide();
        this.drawLines();
      });
      const lab = (txt: string, p: { x: number; y: number }, dx: number) => {
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('x', String(p.x + dx));
        t.setAttribute('y', String(p.y - 4));
        t.setAttribute('class', 'fc-dm-lab');
        t.textContent = txt;
        return t;
      };
      svg.append(path, hit, lab('*', A, left ? -12 : 4), lab('1', B, left ? 4 : -12));
    });
  }

  private dragRel(e: PointerEvent, f: HTMLElement): void {
    e.preventDefault();
    const ns = 'http://www.w3.org/2000/svg';
    const cr = this.canvas.getBoundingClientRect();
    const start = { x: e.clientX - cr.left + this.canvas.scrollLeft, y: e.clientY - cr.top + this.canvas.scrollTop };
    const ghost = document.createElementNS(ns, 'line');
    ghost.setAttribute('class', 'fc-dm-ghost');
    ghost.setAttribute('x1', String(start.x));
    ghost.setAttribute('y1', String(start.y));
    ghost.setAttribute('x2', String(start.x));
    ghost.setAttribute('y2', String(start.y));
    this.lines.appendChild(ghost);
    const move = (m: PointerEvent) => {
      ghost.setAttribute('x2', String(m.clientX - cr.left + this.canvas.scrollLeft));
      ghost.setAttribute('y2', String(m.clientY - cr.top + this.canvas.scrollTop));
    };
    const up = async (m: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost.remove();
      const target = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>('.fc-dm-fld');
      if (!target || target.dataset.t === f.dataset.t) return;
      const r = await this.run('addrel', f.dataset.t!, f.dataset.c!, target.dataset.t!, target.dataset.c!, '1');
      if (!r.ok) return this.say(r.text, true);
      this.say(r.text.includes('inactive') ? 'Relationship created as inactive: another active path already joins those tables.' : 'Relationship created: many on the dragged column, one on the column it was dropped on.');
      await this.commit(r);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private paintDiagram(): void {
    const keep = this.lines;
    const boxes = this.info.tables.map((t, i) => this.box(t, i));
    this.canvas.replaceChildren(keep, ...boxes);
    this.drawLines();
    this.paintSide();
  }

  private paintSide(): void {
    const s = this.side;
    s.replaceChildren();
    const r = this.info.rels[this.chosen];
    s.appendChild(el('h3', '', 'Relationships'));
    if (!this.info.rels.length) s.appendChild(el('p', 'fc-dm-empty', 'Drag a column from one table onto a column of another table. The dragged column is the many side; the column you drop on must hold unique values.'));
    this.info.rels.forEach((x, i) => {
      const row = el('button', 'fc-dm-relrow', `${x.from[0]}[${x.from[1]}]  *  to  1  ${x.to[0]}[${x.to[1]}]${x.active ? '' : '  (inactive)'}`);
      row.type = 'button';
      row.dataset.on = i === this.chosen ? '1' : '';
      row.addEventListener('click', () => {
        this.chosen = i;
        this.paintSide();
        this.drawLines();
      });
      s.appendChild(row);
    });
    if (r) {
      if (r.err) s.appendChild(el('p', 'fc-dm-err', r.err));
      const act = btn(r.active ? 'Make inactive' : 'Make active');
      act.addEventListener('click', async () => {
        const out = await this.run('setrel', String(this.chosen), r.active ? '0' : '1');
        if (!out.ok) return this.say(out.text, true);
        await this.commit(out);
      });
      const del = btn('Delete relationship');
      del.addEventListener('click', async () => {
        const out = await this.run('delrel', String(this.chosen));
        this.chosen = -1;
        if (!out.ok) return this.say(out.text, true);
        await this.commit(out);
      });
      s.append(act, del, el('p', 'fc-dm-hint', 'Inactive relationships are used only by a measure that names them with USERELATIONSHIP.'));
    }
    s.appendChild(el('h3', '', 'Hierarchies'));
    const table = sel(this.info.tables.map((t) => [t.name, t.name] as [string, string]), this.current);
    const name = input('Hierarchy name');
    const levels = el('select', 'fc-fmt-input fc-dm-levels');
    levels.multiple = true;
    const fill = () => {
      levels.replaceChildren();
      const t = this.info.tables.find((x) => x.name === table.value);
      for (const c of t?.cols ?? []) {
        const o = el('option', '', c.name);
        o.value = c.name;
        levels.appendChild(o);
      }
    };
    table.addEventListener('change', fill);
    fill();
    const save = btn('Create hierarchy');
    save.addEventListener('click', async () => {
      const picked = [...levels.selectedOptions].map((o) => o.value);
      const out = await this.run('sethier', table.value, name.value, picked.join(LIST));
      if (!out.ok) return this.say(out.text, true);
      await this.commit(out);
    });
    s.append(table, name, levels, el('p', 'fc-dm-hint', 'Pick the levels in the order they should nest (Ctrl-click to choose several; they keep the table column order).'), save);
    for (const h of this.info.hiers) {
      const row = el('div', 'fc-dm-hrow');
      row.append(el('span', '', `${h.table}: ${h.name} (${h.levels.join(' > ')})`));
      const x = btn('Delete');
      x.addEventListener('click', async () => {
        const out = await this.run('delhier', h.table, h.name);
        await this.commit(out);
      });
      row.appendChild(x);
      s.appendChild(row);
    }
  }

  private measuresPane(): HTMLElement {
    const p = el('div', 'fc-dm-pane fc-dm-meas');
    p.hidden = true;
    return p;
  }

  private paintMeasures(): void {
    if (this.busy) return;
    const p = this.panes.measures;
    p.replaceChildren();
    const left = el('div', 'fc-dm-mlist');
    left.appendChild(el('h3', '', 'Measures'));
    const nw = btn('New measure');
    left.appendChild(nw);
    for (const m of this.info.measures) {
      const b = el('button', 'fc-dm-mrow');
      b.type = 'button';
      b.dataset.on = m.name === this.editingMeasure ? '1' : '';
      b.append(el('b', '', m.name), el('small', '', `${m.table}: ${m.expr}`));
      if (m.err) b.title = m.err;
      b.addEventListener('click', () => {
        this.editingMeasure = m.name;
        this.paintMeasures();
      });
      left.appendChild(b);
    }
    nw.addEventListener('click', () => {
      this.editingMeasure = '';
      this.paintMeasures();
    });
    const form = el('div', 'fc-dm-mform');
    const cur = this.info.measures.find((m) => m.name === this.editingMeasure);
    form.appendChild(el('h3', '', cur ? 'Edit measure' : 'New measure'));
    const table = sel(this.info.tables.map((t) => [t.name, t.name] as [string, string]), cur?.table ?? this.current);
    const name = input('Measure name, e.g. Total Sales');
    name.value = cur?.name ?? '';
    const expr = el('textarea', 'fc-fmt-input fc-dm-expr');
    expr.spellcheck = false;
    expr.placeholder = 'DAX formula, e.g. SUM(Sales[Amount])  or  DIVIDE([Total Sales], CALCULATE([Total Sales], ALL(Products)))';
    expr.value = cur?.expr ?? '';
    const fmt = sel(FMTS, cur?.fmt ?? '');
    const out = el('div', 'fc-dm-result', cur?.err ? cur.err : '');
    const check = btn('Check formula');
    check.addEventListener('click', async () => {
      const r = await this.run('check', expr.value, table.value);
      out.textContent = r.ok ? `The formula is valid. ${r.text.replace(/^ok\t?/, 'Value now: ') || ''}` : r.text;
      out.dataset.bad = r.ok ? '' : '1';
    });
    const save = btn('Save measure', 'fc-btn fc-btn-primary');
    save.addEventListener('click', async () => {
      const r = await this.run('setmeasure', table.value, name.value, expr.value, fmt.value, cur?.name ?? '');
      if (!r.ok) {
        out.textContent = r.text;
        out.dataset.bad = '1';
        return;
      }
      this.editingMeasure = name.value.trim();
      this.say('Measure saved. CUBE formulas and Data Model PivotTables are recalculated.');
      await this.commit(r);
    });
    const del = btn('Delete');
    del.hidden = !cur;
    del.addEventListener('click', async () => {
      const r = await this.run('delmeasure', cur?.name ?? '');
      this.editingMeasure = '';
      await this.commit(r);
    });
    const tl = el('label', 'fc-fmt-label', 'Table');
    tl.appendChild(table);
    const fl = el('label', 'fc-fmt-label', 'Format');
    fl.appendChild(fmt);
    const actions = el('div', 'fc-csv-actions');
    actions.append(del, check, save);
    form.append(tl, name, expr, fl, actions, out, el('p', 'fc-dm-hint', 'Functions: SUM, AVERAGE, COUNT, COUNTA, COUNTROWS, DISTINCTCOUNT, MIN, MAX, SUMX, AVERAGEX, CALCULATE, FILTER, ALL, ALLEXCEPT, VALUES, RELATED, USERELATIONSHIP, DIVIDE, IF, SWITCH, IFERROR, SELECTEDVALUE, and arithmetic.'));
    const kp = el('div', 'fc-dm-kpis');
    kp.appendChild(el('h3', '', 'KPIs'));
    const kname = input('KPI name');
    const base = sel(this.info.measures.map((m) => [m.name, m.name] as [string, string]));
    const goal = input('Goal: a measure name or a number');
    const lo = input('Red below (ratio)');
    lo.value = '0.4';
    const hi = input('Green from (ratio)');
    hi.value = '0.8';
    const ksave = btn('Save KPI');
    ksave.addEventListener('click', async () => {
      const r = await this.run('setkpi', kname.value, base.value, goal.value, lo.value, hi.value);
      if (!r.ok) return this.say(r.text, true);
      await this.commit(r);
    });
    kp.append(kname, base, goal, lo, hi, ksave);
    for (const k of this.info.kpis) {
      const row = el('div', 'fc-dm-hrow');
      row.append(el('span', '', `${k.name}: value ${k.value}, goal ${k.goal}`));
      const x = btn('Delete');
      x.addEventListener('click', async () => await this.commit(await this.run('delkpi', k.name)));
      row.appendChild(x);
      kp.appendChild(row);
    }
    const cn = el('div', 'fc-dm-conns');
    cn.appendChild(el('h3', '', 'OLAP connections'));
    cn.appendChild(el('p', 'fc-dm-hint', 'A connection definition is stored and written to .xlsx. Querying an external OLAP server is untested in FormCel: CUBE formulas that name it return #N/A. ThisWorkbookDataModel is the Data Model above.'));
    const cname = input('Connection name');
    const ctext = input('Provider=MSOLAP;Data Source=server;Initial Catalog=cube', true);
    const csave = btn('Save connection');
    csave.addEventListener('click', async () => {
      const r = await this.run('setconn', cname.value, ctext.value);
      if (!r.ok) return this.say(r.text, true);
      await this.commit(r);
    });
    cn.append(cname, ctext, csave);
    for (const c of this.info.conns) {
      const row = el('div', 'fc-dm-hrow');
      row.append(el('span', '', `${c.name}: ${c.text}`));
      const x = btn('Delete');
      x.addEventListener('click', async () => await this.commit(await this.run('delconn', c.name)));
      row.appendChild(x);
      cn.appendChild(row);
    }
    const right = el('div', 'fc-dm-mright');
    right.append(form, kp, cn);
    p.append(left, right);
  }

  private editingMeasure = '';
}
