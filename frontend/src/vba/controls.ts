import type { Grid } from '../grid/grid';
import { icon, type IconName } from '../ui/icons';
import { actions, field, makeModal } from '../ui/modal';
import { parseRef } from '../grid/a1';
import { callCommand } from '../ui/commands';

export const CONTROL_COMMANDS = ['report.run'];

export type CtlType = 'button' | 'check' | 'combo' | 'list' | 'option' | 'spin' | 'scroll' | 'label' | 'group' | 'text' | 'date' | 'grid';

export interface Ctl {
  id: string;
  type: CtlType;
  sheet: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  macro: string;
  py: string;
  cmd?: string;
  args?: Record<string, string>;
  link: string;
  range: string;
  value: number;
  min: number;
  max: number;
  step: number;
  page: number;
  checked: boolean;
}

export const CONTROL_TYPES: [CtlType, string, IconName, [number, number]][] = [
  ['button', 'Button', 'ctlButton', [96, 28]],
  ['combo', 'Combo Box', 'ctlCombo', [140, 26]],
  ['check', 'Check Box', 'ctlCheck', [120, 24]],
  ['spin', 'Spin Button', 'ctlSpin', [26, 40]],
  ['list', 'List Box', 'ctlList', [140, 90]],
  ['option', 'Option Button', 'ctlOption', [130, 24]],
  ['group', 'Group Box', 'ctlGroup', [180, 110]],
  ['label', 'Label', 'ctlLabel', [110, 22]],
  ['scroll', 'Scroll Bar', 'ctlScroll', [160, 20]],
  ['text', 'Text Field', 'ctlText', [150, 26]],
  ['date', 'Date Field', 'ctlDate', [150, 26]],
  ['grid', 'Data Grid', 'ctlGrid', [280, 140]],
];

export function isoDate(shown: string): string {
  const s = shown.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = s ? Date.parse(s) : NaN;
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface ControlsHost {
  grid: Grid;
  sheet(): number;
  active(): boolean;
  load(): Ctl[];
  save(list: Ctl[]): void;
  macros(): string[];
  run(macro: string): void;
  pyHandlers(): string[];
  runPy(name: string): Promise<{ writes: [string, unknown][] }>;
  read(ref: string): string;
  readRange(ref: string): string[];
  write(ref: string, value: string): void;
  say(text: string, bad?: boolean): void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export function blankControl(type: CtlType, sheet: number, x: number, y: number): Ctl {
  const t = CONTROL_TYPES.find((c) => c[0] === type)!;
  return { id: uid(), type, sheet, x, y, w: t[3][0], h: t[3][1], text: type === 'button' ? 'Button' : type === 'check' ? 'Check Box' : type === 'option' ? 'Option Button' : type === 'group' ? 'Group Box' : type === 'label' ? 'Label' : '', macro: '', py: '', link: '', range: '', value: 0, min: 0, max: 100, step: 1, page: 10, checked: false };
}

interface Node {
  c: Ctl;
  el: HTMLElement;
  key: string;
}

export class FormControls {
  readonly el: HTMLElement;
  private list: Ctl[] = [];
  private readonly nodes = new Map<string, Node>();
  private selected = '';
  private frame = '';
  private raf = 0;
  private drag: { id: string; mode: 'move' | 'size'; px: number; py: number; ox: number; oy: number } | null = null;
  private readonly bar: HTMLElement;

  constructor(private readonly h: ControlsHost) {
    this.el = document.createElement('div');
    this.el.className = 'fc-objects fc-formctl';
    this.el.setAttribute('aria-label', 'Form controls');
    this.bar = document.createElement('div');
    this.bar.className = 'fc-obj-bar fc-formctl-bar';
    this.bar.hidden = true;
    this.bar.innerHTML = '<button type="button" class="fc-btn" data-a="format">Format Control</button><button type="button" class="fc-btn" data-a="macro">Assign Macro</button><button type="button" class="fc-btn" data-a="delete">Delete</button>';
    this.bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.bar.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      const n = this.nodes.get(this.selected);
      if (!a || !n) return;
      if (a === 'format') this.format(n.c);
      else if (a === 'macro') this.assign(n.c);
      else this.remove(n.c.id);
    });
    this.el.appendChild(this.bar);
    h.grid.el.appendChild(this.el);
    document.addEventListener('pointermove', (e) => this.move(e));
    document.addEventListener('pointerup', () => this.up());
    document.addEventListener('pointerdown', (e) => {
      if (this.selected && !(e.target as HTMLElement).closest('.fc-formctl')) this.select('');
    });
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && (e.target as HTMLElement).closest('.fc-formctl')) {
        e.preventDefault();
        this.remove(this.selected);
      }
    });
  }

  reload(empty = false): void {
    this.list = empty ? [] : this.h.load();
    for (const n of this.nodes.values()) n.el.remove();
    this.nodes.clear();
    this.selected = '';
    this.sync();
  }

  count(): number {
    return this.list.length;
  }

  add(type: CtlType): Ctl {
    const g = this.h.grid;
    const f = g.objectFrame();
    const c = blankControl(type, g.sheetIndex, Math.round((f.left - f.ox) / f.z) + 32 + (this.list.length % 8) * 36, Math.round((f.top - f.oy) / f.z) + 32 + (this.list.length % 8) * 36);
    this.list.push(c);
    this.h.save(this.list);
    this.sync();
    this.select(c.id);
    return c;
  }

  private remove(id: string): void {
    this.list = this.list.filter((c) => c.id !== id);
    this.nodes.get(id)?.el.remove();
    this.nodes.delete(id);
    this.selected = '';
    this.bar.hidden = true;
    this.h.save(this.list);
  }

  sync(): void {
    const sheet = this.h.grid.sheetIndex;
    const here = this.list.filter((c) => c.sheet === sheet);
    for (const [id, n] of [...this.nodes]) {
      if (!here.some((c) => c.id === id)) {
        n.el.remove();
        this.nodes.delete(id);
      }
    }
    for (const c of here) {
      let n = this.nodes.get(c.id);
      if (!n) {
        const el = document.createElement('div');
        el.className = `fc-fctl fc-fctl-${c.type}`;
        el.dataset.id = c.id;
        el.addEventListener('pointerdown', (e) => this.down(e, c.id));
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.select(c.id);
        });
        this.el.insertBefore(el, this.bar);
        n = { c, el, key: '' };
        this.nodes.set(c.id, n);
      }
      n.c = c;
      this.fill(n);
    }
    this.place();
    this.loop();
  }

  private loop(): void {
    window.cancelAnimationFrame(this.raf);
    if (!this.list.length) return;
    this.raf = window.requestAnimationFrame(() => {
      if (this.h.active()) {
        if (this.h.grid.sheetIndex !== this.lastSheet) {
          this.lastSheet = this.h.grid.sheetIndex;
          this.sync();
          return;
        }
        this.place();
      }
      this.loop();
    });
  }

  private lastSheet = -1;

  private link(c: Ctl): string {
    return c.link ? this.h.read(c.link) : '';
  }

  private fire(c: Ctl): void {
    if (c.cmd && CONTROL_COMMANDS.includes(c.cmd)) {
      void callCommand(c.cmd, { ...(c.args ?? {}), ...(c.args?.out ? { overwrite: true } : {}) }).catch((err: unknown) => this.h.say(err instanceof Error ? err.message : String(err), true));
    } else if (c.py) {
      void this.h.runPy(c.py).then((r) => {
        for (const [ref, v] of r.writes) this.h.write(ref, v === null || v === undefined ? '' : String(v));
      }, (err: unknown) => this.h.say(err instanceof Error ? err.message : String(err), true));
    } else if (c.macro) this.h.run(c.macro);
  }

  private fillField(n: Node): void {
    const c = n.c;
    const b = c.type === 'grid' && c.range ? parseRef(c.range) : null;
    const cols = b ? b.c1 - b.c0 + 1 : 0;
    const rows = b ? Math.min(b.r1 - b.r0 + 1, Math.floor(500 / Math.max(cols, 1))) : 0;
    const key = JSON.stringify([c.type, c.link, c.range]);
    if (key !== n.key) {
      n.key = key;
      if (c.type === 'grid') {
        const wrap = Object.assign(document.createElement('div'), { className: 'fc-fctl-gridwrap' });
        const t = Object.assign(document.createElement('table'), { className: 'fc-fctl-grid' });
        const body = t.createTBody();
        for (let r = 0; r < rows; r++) {
          const tr = body.insertRow();
          tr.dataset.r = String(r + 1);
          for (let k = 0; k < cols; k++) tr.insertCell();
        }
        t.addEventListener('click', (e) => {
          const tr = (e.target as HTMLElement).closest<HTMLElement>('tr');
          if (!tr || e.ctrlKey || e.metaKey) return;
          if (c.link) this.h.write(c.link, tr.dataset.r ?? '');
          this.markRow(n, Number(tr.dataset.r));
          this.fire(c);
        });
        wrap.appendChild(t);
        n.el.replaceChildren(wrap);
      } else {
        const i = Object.assign(document.createElement('input'), { type: c.type === 'date' ? 'date' : 'text', className: 'fc-auto-input fc-fctl-field', spellcheck: false });
        i.setAttribute('aria-label', c.type === 'date' ? 'Date Field' : 'Text Field');
        i.addEventListener('change', () => {
          if (c.link) this.h.write(c.link, i.value);
          this.fire(c);
        });
        n.el.replaceChildren(i);
      }
      for (const ev of ['keydown', 'dblclick']) n.el.addEventListener(ev, (e) => e.stopPropagation());
    }
    if (c.type === 'grid') {
      const vals = c.range ? this.h.readRange(c.range) : [];
      const trs = n.el.querySelectorAll('tr');
      trs.forEach((tr, r) => {
        for (let k = 0; k < tr.cells.length; k++) {
          const v = vals[r * cols + k] ?? '';
          if (tr.cells[k].textContent !== v) tr.cells[k].textContent = v;
        }
      });
      this.markRow(n, Number(this.link(c)));
    } else {
      const i = n.el.querySelector('input')!;
      const v = c.type === 'date' ? isoDate(this.link(c)) : this.link(c);
      if (document.activeElement !== i && i.value !== v) i.value = v;
    }
    n.el.dataset.macro = c.macro || c.py ? '1' : '';
    this.grip(n);
  }

  private markRow(n: Node, row: number): void {
    n.el.querySelectorAll<HTMLElement>('tr').forEach((tr) => {
      const on = Number(tr.dataset.r) === row;
      if (tr.classList.contains('is-on') !== on) tr.classList.toggle('is-on', on);
    });
  }

  private fill(n: Node): void {
    const c = n.c;
    if (c.type === 'text' || c.type === 'date' || c.type === 'grid') {
      this.fillField(n);
      return;
    }
    const items = c.type === 'combo' || c.type === 'list' ? (c.range ? this.h.readRange(c.range) : []) : [];
    const key = JSON.stringify([c.type, c.text, c.link, c.range, c.min, c.max, c.step, c.page, c.checked, c.value, items, c.link ? this.link(c) : '']);
    if (key === n.key) return;
    n.key = key;
    const el = n.el;
    const stop = (e: Event) => e.stopPropagation();
    const run = () => this.fire(c);
    const num = () => {
      const v = Number(this.link(c));
      return Number.isFinite(v) && c.link ? v : c.value;
    };
    const setv = (v: number) => {
      c.value = v;
      if (c.link) this.h.write(c.link, String(v));
      this.h.save(this.list);
    };
    el.replaceChildren();
    if (c.type === 'button') {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'fc-btn', textContent: c.text });
      b.addEventListener('click', (e) => {
        if (!e.ctrlKey && !e.metaKey) run();
      });
      el.appendChild(b);
    } else if (c.type === 'check' || c.type === 'option') {
      const lab = document.createElement('label');
      const i = Object.assign(document.createElement('input'), { type: c.type === 'check' ? 'checkbox' : 'radio' });
      const state = c.link ? (c.type === 'check' ? /^true$/i.test(this.link(c)) : Number(this.link(c)) === this.optionIndex(c)) : c.checked;
      i.checked = state;
      i.addEventListener('change', () => {
        c.checked = i.checked;
        if (c.link) this.h.write(c.link, c.type === 'check' ? (i.checked ? 'TRUE' : 'FALSE') : String(this.optionIndex(c)));
        this.h.save(this.list);
        run();
      });
      lab.append(i, document.createTextNode(c.text));
      el.appendChild(lab);
    } else if (c.type === 'combo' || c.type === 'list') {
      const s = document.createElement('select');
      s.className = 'fc-auto-input';
      if (c.type === 'list') s.size = Math.max(2, Math.floor(c.h / 18));
      s.replaceChildren(...items.map((t, i) => Object.assign(document.createElement('option'), { value: String(i + 1), textContent: t })));
      const cur = num();
      if (cur >= 1 && cur <= items.length) s.value = String(cur);
      else s.selectedIndex = c.type === 'combo' ? -1 : -1;
      s.addEventListener('change', () => {
        setv(Number(s.value));
        run();
      });
      el.appendChild(s);
    } else if (c.type === 'spin') {
      const wrap = document.createElement('div');
      wrap.className = 'fc-fctl-spin';
      for (const [d, ic] of [[1, 'up'], [-1, 'down']] as const) {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'fc-btn', innerHTML: `<svg viewBox="0 0 10 6" aria-hidden="true"><path d="${ic === 'up' ? 'M1 5l4-4 4 4' : 'M1 1l4 4 4-4'}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>` });
        b.setAttribute('aria-label', ic === 'up' ? 'Increase' : 'Decrease');
        b.addEventListener('click', (e) => {
          if (e.ctrlKey || e.metaKey) return;
          setv(Math.max(c.min, Math.min(c.max, num() + d * c.step)));
          run();
        });
        wrap.appendChild(b);
      }
      el.appendChild(wrap);
    } else if (c.type === 'scroll') {
      const r = Object.assign(document.createElement('input'), { type: 'range', className: 'fc-fctl-range', min: String(c.min), max: String(c.max), step: String(c.step), value: String(num()) });
      r.addEventListener('input', () => setv(Number(r.value)));
      r.addEventListener('change', run);
      el.appendChild(r);
    } else if (c.type === 'group') {
      el.innerHTML = '<fieldset><legend></legend></fieldset>';
      el.querySelector('legend')!.textContent = c.text;
    } else {
      const d = Object.assign(document.createElement('div'), { className: 'fc-fctl-label', textContent: c.text });
      el.appendChild(d);
    }
    for (const ev of ['keydown', 'dblclick']) el.addEventListener(ev, stop);
    el.dataset.macro = c.macro || c.py || c.cmd ? '1' : '';
    this.grip(n);
  }

  private grip(n: Node): void {
    const has = n.el.querySelector('.fc-fctl-grip');
    if (n.c.id === this.selected && !has) n.el.appendChild(Object.assign(document.createElement('i'), { className: 'fc-fctl-grip' }));
    else if (n.c.id !== this.selected && has) has.remove();
  }

  private optionIndex(c: Ctl): number {
    return this.list.filter((o) => o.type === 'option' && o.sheet === c.sheet && o.link === c.link).findIndex((o) => o.id === c.id) + 1;
  }

  refresh(): void {
    for (const n of this.nodes.values()) this.fill(n);
  }

  private place(): void {
    const g = this.h.grid;
    const f = g.objectFrame();
    const r = g.el.getBoundingClientRect();
    const key = `${f.left}|${f.top}|${f.ox}|${f.oy}|${f.z}|${r.width}|${r.height}`;
    if (key !== this.frame) {
      this.frame = key;
      this.el.style.left = `${f.left}px`;
      this.el.style.top = `${f.top}px`;
      this.el.style.width = `${Math.max(0, r.width - f.left)}px`;
      this.el.style.height = `${Math.max(0, r.height - f.top)}px`;
      for (const n of this.nodes.values()) {
        const x = f.ox - f.left + n.c.x * f.z;
        const y = f.oy - f.top + n.c.y * f.z;
        n.el.style.transform = `translate(${x}px, ${y}px)`;
        n.el.style.width = `${n.c.w * f.z}px`;
        n.el.style.height = `${n.c.h * f.z}px`;
      }
      const s = this.nodes.get(this.selected);
      if (s) this.bar.style.transform = `translate(${Math.max(0, f.ox - f.left + s.c.x * f.z)}px, ${Math.max(0, f.oy - f.top + s.c.y * f.z - 34)}px)`;
    }
  }

  private select(id: string): void {
    this.selected = id;
    for (const [k, n] of this.nodes) {
      n.el.classList.toggle('is-selected', k === id);
      this.grip(n);
    }
    this.bar.hidden = !id;
    this.frame = '';
    this.place();
  }

  private down(e: PointerEvent, id: string): void {
    const n = this.nodes.get(id);
    if (!n) return;
    const sel = e.ctrlKey || e.metaKey || e.button === 2 || this.selected === id;
    if (!sel) return;
    e.preventDefault();
    e.stopPropagation();
    this.select(id);
    if (e.button !== 0) return;
    const grip = (e.target as HTMLElement).closest('.fc-fctl-grip');
    this.drag = { id, mode: grip ? 'size' : 'move', px: e.clientX, py: e.clientY, ox: grip ? n.c.w : n.c.x, oy: grip ? n.c.h : n.c.y };
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    const n = d ? this.nodes.get(d.id) : null;
    if (!d || !n) return;
    const z = this.h.grid.objectFrame().z;
    const dx = (e.clientX - d.px) / z;
    const dy = (e.clientY - d.py) / z;
    if (d.mode === 'move') {
      n.c.x = Math.round(d.ox + dx);
      n.c.y = Math.round(d.oy + dy);
    } else {
      n.c.w = Math.max(16, Math.round(d.ox + dx));
      n.c.h = Math.max(14, Math.round(d.oy + dy));
    }
    this.frame = '';
    this.place();
  }

  private up(): void {
    if (this.drag) this.h.save(this.list);
    this.drag = null;
  }

  assign(c: Ctl): void {
    const m = makeModal('Assign Macro');
    const sel = Object.assign(document.createElement('select'), { className: 'fc-auto-input' });
    sel.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: '(none)' }), ...this.h.macros().map((n) => Object.assign(document.createElement('option'), { value: n, textContent: n })));
    const py = this.h.pyHandlers();
    if (py.length) {
      const g = Object.assign(document.createElement('optgroup'), { label: 'Python handlers' });
      g.append(...py.map((n) => Object.assign(document.createElement('option'), { value: `py:${n}`, textContent: n })));
      sel.appendChild(g);
    }
    if (c.type === 'button') {
      const g = Object.assign(document.createElement('optgroup'), { label: 'Commands' });
      g.append(Object.assign(document.createElement('option'), { value: 'cmd:report.run', textContent: 'Run a report (report.run)' }));
      sel.appendChild(g);
    }
    sel.value = c.cmd ? `cmd:${c.cmd}` : c.py ? `py:${c.py}` : c.macro;
    const arg = (k: string) => Object.assign(document.createElement('input'), { className: 'fc-auto-input', value: c.args?.[k] ?? '', spellcheck: false });
    const args: [string, string, HTMLInputElement][] = c.type === 'button' ? [['template', 'Report template (FormTxt document id)', arg('template')], ['sql', 'Report SQL', arg('sql')], ['out', 'Save the PDF to', arg('out')]] : [];
    const paint = () => { for (const [, , i] of args) i.disabled = !sel.value.startsWith('cmd:'); };
    sel.addEventListener('change', paint);
    paint();
    const done = () => {
      m.close();
      m.el.remove();
    };
    m.body.append(field('Macro name', sel), ...args.map(([, label, i]) => field(label, i)), actions('OK', () => {
      c.cmd = sel.value.startsWith('cmd:') ? sel.value.slice(4) : '';
      c.args = c.cmd ? Object.fromEntries(args.map(([k, , i]) => [k, i.value.trim()])) : {};
      c.py = sel.value.startsWith('py:') ? sel.value.slice(3) : '';
      c.macro = c.py || c.cmd ? '' : sel.value;
      this.h.save(this.list);
      this.fill({ c, el: this.nodes.get(c.id)!.el, key: '' } as Node);
      done();
    }, done));
    m.open(sel);
  }

  format(c: Ctl): void {
    const m = makeModal(`Format Control: ${CONTROL_TYPES.find((t) => t[0] === c.type)![1]}`);
    const inp = (v: string | number, cls = 'fc-auto-input') => Object.assign(document.createElement('input'), { className: cls, value: String(v), spellcheck: false });
    const text = inp(c.text);
    const link = inp(c.link);
    const range = inp(c.range);
    const min = inp(c.min);
    const max = inp(c.max);
    const step = inp(c.step);
    const rows: HTMLElement[] = [];
    if (['button', 'check', 'option', 'group', 'label'].includes(c.type)) rows.push(field('Text', text));
    if (['combo', 'list', 'grid'].includes(c.type)) rows.push(field('Input range', range, c.type === 'grid' ? 'Cells the grid shows, such as A1:D20' : 'Cells that hold the items, such as A1:A10'));
    if (['check', 'option', 'combo', 'list', 'spin', 'scroll', 'text', 'date', 'grid'].includes(c.type)) rows.push(field('Cell link', link, c.type === 'grid' ? 'The cell that receives the selected row number, such as B1' : 'The cell that receives the value, such as B1'));
    if (['spin', 'scroll'].includes(c.type)) rows.push(field('Minimum value', min), field('Maximum value', max), field('Incremental change', step));
    const done = () => {
      m.close();
      m.el.remove();
    };
    m.body.append(...rows, actions('OK', () => {
      if (link.value && !parseRef(link.value.toUpperCase())) {
        this.h.say('The cell link must be a cell such as B1', true);
        return;
      }
      c.text = text.value;
      c.link = link.value.trim().toUpperCase();
      c.range = range.value.trim().toUpperCase();
      c.min = Number(min.value) || 0;
      c.max = Number(max.value) || 100;
      c.step = Number(step.value) || 1;
      this.h.save(this.list);
      const n = this.nodes.get(c.id);
      if (n) {
        n.key = '';
        this.fill(n);
      }
      done();
    }, done));
    m.open(rows.length ? (rows[0].querySelector('input') as HTMLElement) : undefined);
  }
}

export function pickerHtml(): string {
  return CONTROL_TYPES.map(([id, label, ic]) => `<button type="button" class="fc-btn fc-ctl-pick" data-t="${id}">${icon(ic)}<span>${label}</span></button>`).join('');
}
