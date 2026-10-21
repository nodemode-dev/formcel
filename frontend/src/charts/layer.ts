import type { EngineClient } from '../engine';
import type { Grid, ObjectsHook } from '../grid/grid';
import type { PivotDef } from '../ui/pivot';
import { anchorOf, frameOf, fromLine, toLine } from './anchor';
import { build, readMatrix, resolveRange } from './data';
import { FILTER_BAR, pivotChartData, pivotLabel } from './pivotchart';
import { renderChartAsync } from './svg';
import { isFloat, newId, type FloatObject } from './types';

export interface LayerIo {
  book(): number;
  sheetNames(): string[];
  load(): Promise<FloatObject[][]>;
  save(sheet: number, list: FloatObject[]): void;
  pivots?(): PivotDef[];
  pivotItems?(name: string, field: string): Promise<string[]>;
  pivotFilter?(name: string, field: string, items: string[]): Promise<void>;
}

interface Node {
  obj: FloatObject;
  el: HTMLElement;
  body: HTMLElement;
  html: string;
  moving: boolean;
  dw: number;
  dh: number;
  bar: HTMLElement | null;
  barKey: string;
}

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN = 24;

export class ObjectLayer implements ObjectsHook {
  readonly el: HTMLElement;
  private all: FloatObject[][] = [];
  private nodes = new Map<string, Node>();
  private sheetNo = 0;
  private selected: string | null = null;
  private readonly bar: HTMLElement;
  private timer = 0;
  private saveTimer = 0;
  private frameKey = '';
  onEdit: (o: FloatObject) => void = () => undefined;
  onData: () => void = () => undefined;
  onAlt: (o: FloatObject) => void = () => undefined;

  constructor(private readonly grid: Grid, private readonly eng: EngineClient, private readonly io: LayerIo) {
    this.el = document.createElement('div');
    this.el.className = 'fc-objects';
    this.el.setAttribute('aria-label', 'Charts, pictures and shapes');
    this.bar = document.createElement('div');
    this.bar.className = 'fc-obj-bar';
    this.bar.hidden = true;
    this.bar.innerHTML = '<button type="button" class="fc-btn" data-a="edit">Edit</button><button type="button" class="fc-btn" data-a="alt">Alt text</button><button type="button" class="fc-btn" data-a="front">Bring to front</button><button type="button" class="fc-btn" data-a="back">Send to back</button><button type="button" class="fc-btn" data-a="delete">Delete</button>';
    this.bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.bar.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      const n = this.selected ? this.nodes.get(this.selected) : null;
      if (!a || !n) return;
      if (a === 'edit') this.onEdit(n.obj);
      if (a === 'alt') this.onAlt(n.obj);
      if (a === 'delete') this.remove(n.obj.id);
      if (a === 'front' || a === 'back') this.reorder(n.obj.id, a === 'front');
    });
    this.el.appendChild(this.bar);
    grid.el.appendChild(this.el);
    grid.objectsHook = this;
    grid.el.addEventListener('pointerdown', (e) => {
      if (this.selected && !(e.target as HTMLElement).closest('.fc-obj, .fc-obj-bar')) this.select(null);
    }, true);
    document.addEventListener('keydown', (e) => this.key(e), true);
  }

  async open(): Promise<void> {
    this.all = await this.io.load().catch(() => []);
    for (let i = 0; i < this.all.length; i++) {
      const list = this.all[i] ?? [];
      if (list.length && list.every((o) => o.anchor)) await this.eng.loadObjects(this.io.book(), i, list.map(toLine));
    }
  }

  private async seed(sheet: number): Promise<void> {
    const list = this.all[sheet] ?? [];
    if (!list.length || list.every((o) => o.anchor)) return;
    for (const o of list) o.anchor = anchorOf(this.grid.rows, this.grid.cols, o);
    await this.eng.loadObjects(this.io.book(), sheet, list.map(toLine));
  }

  private commit(): void {
    const sheet = this.sheetNo;
    const list = this.list();
    for (const o of list) {
      if (o.anchor && !this.nodes.has(o.id)) Object.assign(o, frameOf(this.grid.rows, this.grid.cols, o.anchor));
      o.anchor = anchorOf(this.grid.rows, this.grid.cols, o);
    }
    void this.eng.setObjects(this.io.book(), sheet, list.map(toLine));
    this.persist();
    this.onData();
  }

  async shifted(sheet: number): Promise<void> {
    if (sheet === this.sheetNo) await this.seed(sheet);
    const lines = await this.eng.objectLines(this.io.book(), sheet);
    const next = lines.map(fromLine).filter((o): o is FloatObject => !!o);
    const had = this.all[sheet] ?? [];
    if (!next.length && (!had.length || had.some((o) => !o.anchor))) return;
    this.all[sheet] = next;
    if (sheet !== this.sheetNo) {
      this.io.save(sheet, [...next]);
      return;
    }
    const keep = new Set(next.filter(isFloat).map((o) => o.id));
    for (const [id, n] of [...this.nodes]) {
      if (keep.has(id)) continue;
      n.el.remove();
      this.nodes.delete(id);
      if (this.selected === id) this.select(null);
    }
    next.forEach((o, k) => {
      if (!isFloat(o)) return;
      const n = this.nodes.get(o.id);
      if (n) {
        n.obj = o;
        this.fill(n);
        this.describe(n);
        if (o.kind === 'chart') void this.draw(n);
      } else {
        this.mount(o);
        if (o.kind === 'chart') void this.draw(this.nodes.get(o.id)!);
      }
      this.nodes.get(o.id)!.el.style.order = String(k);
    });
    this.place();
    this.persist();
  }

  list(): FloatObject[] {
    return this.all[this.sheetNo] ?? (this.all[this.sheetNo] = []);
  }

  sheet(i: number): void {
    this.sheetNo = i;
    this.select(null);
    for (const n of this.nodes.values()) n.el.remove();
    this.nodes.clear();
    for (const o of this.list()) if (isFloat(o)) this.mount(o);
    this.place();
    this.data();
    void this.seed(i).then(() => this.onData());
  }

  paint(): void {
    this.place();
  }

  data(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.refresh(), 90);
  }

  async refresh(): Promise<void> {
    for (const n of this.nodes.values()) if (n.obj.kind === 'chart') await this.draw(n);
    this.onData();
  }

  edit(remove: string[], add: FloatObject[]): void {
    const gone = new Set(remove);
    const list = this.list();
    for (let i = list.length - 1; i >= 0; i--) if (gone.has(list[i].id)) list.splice(i, 1);
    list.push(...add);
    this.commit();
  }

  private key(e: KeyboardEvent): void {
    if (!this.selected) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      this.remove(this.selected);
    } else if (e.key === 'Escape') this.select(null);
    else if (e.key.startsWith('Arrow') && !e.ctrlKey && !e.metaKey) {
      const n = this.nodes.get(this.selected);
      if (!n) return;
      e.preventDefault();
      e.stopPropagation();
      const d = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') n.obj.x -= d;
      if (e.key === 'ArrowRight') n.obj.x += d;
      if (e.key === 'ArrowUp') n.obj.y -= d;
      if (e.key === 'ArrowDown') n.obj.y += d;
      n.obj.anchor = anchorOf(this.grid.rows, this.grid.cols, n.obj);
      this.place();
      this.commit();
    }
  }

  add(o: Omit<FloatObject, 'id'>): FloatObject {
    const obj: FloatObject = { ...o, id: newId() };
    this.list().push(obj);
    this.mount(obj);
    this.place();
    this.select(obj.id);
    this.commit();
    if (obj.kind === 'chart') void this.draw(this.nodes.get(obj.id)!);
    return obj;
  }

  viewOrigin(): { x: number; y: number } {
    const f = this.grid.objectFrame();
    return { x: Math.round((f.left - f.ox) / f.z) + 24, y: Math.round((f.top - f.oy) / f.z) + 24 };
  }

  update(o: FloatObject): void {
    const n = this.nodes.get(o.id);
    if (!n) return;
    n.obj = o;
    const list = this.list();
    const i = list.findIndex((x) => x.id === o.id);
    if (i >= 0) list[i] = o;
    this.fill(n);
    this.describe(n);
    this.commit();
    if (o.kind === 'chart') void this.draw(n);
  }

  setAlt(id: string, text: string, decorative = false): void {
    const o = this.list().find((x) => x.id === id);
    if (!o) return;
    o.alt = decorative ? '' : text;
    if (decorative) o.decorative = true;
    else delete o.decorative;
    const n = this.nodes.get(id);
    if (n) this.describe(n);
    this.commit();
  }

  private describe(n: Node): void {
    const o = n.obj;
    const label = o.alt || (o.kind === 'picture' ? o.picture?.name : o.kind === 'chart' ? o.chart?.title : '') || '';
    if (o.decorative) n.el.setAttribute('aria-hidden', 'true');
    else n.el.removeAttribute('aria-hidden');
    if (label) n.el.setAttribute('aria-label', label);
    else n.el.removeAttribute('aria-label');
    n.el.setAttribute('role', o.kind === 'chart' || o.kind === 'picture' ? 'img' : 'group');
    const img = n.body.querySelector('img');
    if (img) img.alt = o.decorative ? '' : label;
  }

  find(id: string, sheet: number): FloatObject | null {
    return (this.all[sheet] ?? []).find((x) => x.id === id) ?? null;
  }

  focusObject(id: string): void {
    this.select(id);
    this.nodes.get(id)?.el.focus();
  }

  selectedObject(): FloatObject | null {
    return this.selected ? this.nodes.get(this.selected)?.obj ?? null : null;
  }

  remove(id: string): void {
    const n = this.nodes.get(id);
    if (!n) return;
    n.el.remove();
    this.nodes.delete(id);
    const list = this.list();
    list.splice(list.findIndex((x) => x.id === id), 1);
    if (this.selected === id) this.select(null);
    this.commit();
  }

  private reorder(id: string, front: boolean): void {
    const list = this.list();
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [o] = list.splice(i, 1);
    if (front) list.push(o);
    else list.unshift(o);
    list.forEach((x, k) => {
      const n = this.nodes.get(x.id);
      if (n) n.el.style.order = String(k);
    });
    this.commit();
  }

  private select(id: string | null): void {
    if (this.selected) this.nodes.get(this.selected)?.el.classList.remove('fc-obj-sel');
    this.selected = id;
    if (id) this.nodes.get(id)?.el.classList.add('fc-obj-sel');
    this.bar.hidden = !id;
    this.place();
  }

  private persist(): void {
    window.clearTimeout(this.saveTimer);
    const sheet = this.sheetNo;
    this.saveTimer = window.setTimeout(() => this.io.save(sheet, [...(this.all[sheet] ?? [])]), 250);
  }

  flush(): void {
    if (!this.saveTimer) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    this.io.save(this.sheetNo, [...this.list()]);
  }

  private mount(o: FloatObject): void {
    const el = document.createElement('div');
    el.className = `fc-obj fc-obj-${o.kind}`;
    el.dataset.id = o.id;
    el.tabIndex = -1;
    const body = document.createElement('div');
    body.className = 'fc-obj-body';
    el.appendChild(body);
    for (const h of HANDLES) {
      const s = document.createElement('span');
      s.className = `fc-obj-h fc-obj-h-${h}`;
      s.dataset.h = h;
      el.appendChild(s);
    }
    const n: Node = { obj: o, el, body, html: '', moving: false, dw: o.w, dh: o.h, bar: null, barKey: '' };
    el.addEventListener('pointerdown', (e) => this.down(e, n));
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (o.kind === 'chart') this.onEdit(n.obj);
      else if (o.kind === 'shape' || o.kind === 'text') this.editText(n);
    });
    this.el.insertBefore(el, this.bar);
    this.nodes.set(o.id, n);
    this.fill(n);
    this.describe(n);
  }

  private fill(n: Node): void {
    const o = n.obj;
    n.html = '';
    if (o.kind === 'picture' && o.picture) {
      let img = n.body.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.draggable = false;
        img.alt = o.picture.name;
        n.body.replaceChildren(img);
      }
      if (img.getAttribute('src') !== o.picture.src) img.src = o.picture.src;
    } else if (o.kind === 'shape' && o.shape) {
      const s = o.shape;
      const w = Math.max(1, o.w);
      const h = Math.max(1, o.h);
      const g = s.shape === 'ellipse'
        ? `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 1.5}" ry="${h / 2 - 1.5}"/>`
        : s.shape === 'arrow'
          ? `<polygon points="1.5,${h * 0.3} ${w * 0.62},${h * 0.3} ${w * 0.62},1.5 ${w - 1.5},${h / 2} ${w * 0.62},${h - 1.5} ${w * 0.62},${h * 0.7} 1.5,${h * 0.7}"/>`
          : `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="3"/>`;
      n.body.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="none"><g fill="${s.fill}" stroke="${s.stroke}" stroke-width="2" vector-effect="non-scaling-stroke">${g}</g></svg><div class="fc-obj-label"></div>`;
      n.body.querySelector<HTMLElement>('.fc-obj-label')!.textContent = s.text;
    } else if (o.kind === 'text' && o.text) {
      let label = n.body.querySelector<HTMLElement>('.fc-obj-text');
      if (!label) {
        label = document.createElement('div');
        label.className = 'fc-obj-text';
        n.body.replaceChildren(label);
      }
      if (label.textContent !== o.text.text) label.textContent = o.text.text;
      label.style.fontSize = `${o.text.size}px`;
      label.style.color = o.text.color;
    }
  }

  private editText(n: Node): void {
    const target = n.body.querySelector<HTMLElement>('.fc-obj-label, .fc-obj-text');
    if (!target) return;
    target.contentEditable = 'true';
    target.focus();
    const sel = getSelection();
    sel?.selectAllChildren(target);
    const done = () => {
      target.contentEditable = 'false';
      target.removeEventListener('blur', done);
      const t = target.textContent ?? '';
      if (n.obj.shape) n.obj.shape.text = t;
      if (n.obj.text) n.obj.text.text = t;
      this.commit();
    };
    target.addEventListener('blur', done);
    target.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') target.blur();
    });
  }

  private place(): void {
    const f = this.grid.objectFrame();
    const r = this.grid.el.getBoundingClientRect();
    const key = `${f.left}|${f.top}|${r.width}|${r.height}`;
    if (key !== this.frameKey) {
      this.frameKey = key;
      this.el.style.left = `${f.left}px`;
      this.el.style.top = `${f.top}px`;
      this.el.style.width = `${Math.max(0, r.width - f.left)}px`;
      this.el.style.height = `${Math.max(0, r.height - f.top)}px`;
    }
    for (const n of this.nodes.values()) {
      const o = n.obj;
      const s = n.el.style;
      if (o.anchor && !n.moving) {
        const b = frameOf(this.grid.rows, this.grid.cols, o.anchor);
        o.x = b.x;
        o.y = b.y;
        o.w = b.w;
        o.h = b.h;
      }
      if (Math.abs(o.w - n.dw) > 0.5 || Math.abs(o.h - n.dh) > 0.5) {
        n.dw = o.w;
        n.dh = o.h;
        if (!n.moving) {
          if (o.kind === 'chart') void this.draw(n);
          else this.fill(n);
        }
      }
      const x = f.ox - f.left + o.x * f.z;
      const y = f.oy - f.top + o.y * f.z;
      s.transform = `translate(${x}px, ${y}px)`;
      const w = `${o.w * f.z}px`;
      const h = `${o.h * f.z}px`;
      if (s.width !== w) s.width = w;
      if (s.height !== h) s.height = h;
    }
    const sel = this.selected ? this.nodes.get(this.selected) : null;
    if (sel) {
      const x = f.ox - f.left + sel.obj.x * f.z;
      const y = f.oy - f.top + sel.obj.y * f.z;
      this.bar.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y - 34)}px)`;
    }
  }

  private down(e: PointerEvent, n: Node): void {
    if (e.button !== 0 || (e.target as HTMLElement).isContentEditable) return;
    if ((e.target as HTMLElement).closest('.fc-chart-filters')) {
      e.stopPropagation();
      this.select(n.obj.id);
      return;
    }
    e.stopPropagation();
    this.select(n.obj.id);
    const h = (e.target as HTMLElement).dataset.h as Handle | undefined;
    const z = this.grid.objectFrame().z;
    const start = { x: e.clientX, y: e.clientY, ox: n.obj.x, oy: n.obj.y, ow: n.obj.w, oh: n.obj.h };
    n.el.setPointerCapture(e.pointerId);
    let moved = false;
    let raf = 0;
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - start.x) / z;
      const dy = (m.clientY - start.y) / z;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 2 / z) return;
      moved = true;
      n.moving = true;
      const o = n.obj;
      if (!h) {
        o.x = Math.round(start.ox + dx);
        o.y = Math.round(start.oy + dy);
      } else {
        let x = start.ox;
        let y = start.oy;
        let w = start.ow;
        let hh = start.oh;
        if (h.includes('e')) w = Math.max(MIN, start.ow + dx);
        if (h.includes('s')) hh = Math.max(MIN, start.oh + dy);
        if (h.includes('w')) {
          w = Math.max(MIN, start.ow - dx);
          x = start.ox + start.ow - w;
        }
        if (h.includes('n')) {
          hh = Math.max(MIN, start.oh - dy);
          y = start.oy + start.oh - hh;
        }
        o.x = Math.round(x);
        o.y = Math.round(y);
        o.w = Math.round(w);
        o.h = Math.round(hh);
      }
      this.place();
      if (h && !raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (o.kind === 'chart') void this.draw(n);
          else this.fill(n);
        });
      }
    };
    const up = () => {
      n.el.removeEventListener('pointermove', move);
      n.el.removeEventListener('pointerup', up);
      n.el.removeEventListener('pointercancel', up);
      if (moved) {
        n.moving = false;
        this.commit();
        if (n.obj.kind === 'chart') void this.draw(n);
      }
    };
    n.el.addEventListener('pointermove', move);
    n.el.addEventListener('pointerup', up);
    n.el.addEventListener('pointercancel', up);
  }

  private async draw(n: Node): Promise<void> {
    const spec = n.obj.chart;
    if (!spec) return;
    let html: string;
    let def: PivotDef | null = null;
    if (spec.pivot) {
      def = this.io.pivots?.().find((p) => p.name === spec.pivot) ?? null;
      const data = def ? await pivotChartData(this.eng, this.io.book(), def) : null;
      if (!def) html = `<div class="fc-chart-empty">The PivotTable ${spec.pivot} no longer exists. Delete this chart or edit it to pick another source.</div>`;
      else if (!data) html = '<div class="fc-chart-empty">The PivotTable has no values to chart yet. Add fields to its Rows and Values.</div>';
      else html = await renderChartAsync(this.eng, spec, data, n.obj.w, Math.max(40, n.obj.h - FILTER_BAR));
    } else {
      const ref = await resolveRange(this.eng, this.io.book(), spec.range);
      if (!ref) html = `<div class="fc-chart-empty">The data range ${spec.range ? `"${spec.range}"` : ''} is not a range. Edit the chart to pick one.</div>`;
      else {
        const sheet = ref.sheet ? this.io.sheetNames().indexOf(ref.sheet) : this.sheetNo;
        if (sheet < 0) html = `<div class="fc-chart-empty">There is no sheet named ${ref.sheet}.</div>`;
        else {
          const m = await readMatrix(this.eng, this.io.book(), sheet, ref.range);
          html = await renderChartAsync(this.eng, spec, build(m, spec.byRows, spec.type), n.obj.w, n.obj.h);
        }
      }
    }
    if (this.nodes.get(n.obj.id) !== n) return;
    this.filters(n, def);
    if (html !== n.html) {
      n.html = html;
      n.body.innerHTML = html;
    }
  }

  private filters(n: Node, def: PivotDef | null): void {
    if (!def) {
      if (n.bar) {
        n.bar.remove();
        n.bar = null;
        n.barKey = '';
        n.body.style.top = '';
      }
      return;
    }
    const key = JSON.stringify([def.name, def.rows, def.cols, def.filters]);
    if (!n.bar) {
      const bar = document.createElement('div');
      bar.className = 'fc-chart-filters';
      bar.addEventListener('change', (e) => {
        const sel = e.target as HTMLSelectElement;
        const field = sel.dataset.field;
        if (!field || !n.obj.chart?.pivot || sel.value.startsWith('\u0000')) return;
        void this.io.pivotFilter?.(n.obj.chart.pivot, field, sel.value === '' ? [] : [sel.value]);
      });
      n.el.insertBefore(bar, n.body);
      n.bar = bar;
      n.body.style.top = `${FILTER_BAR}px`;
    }
    if (key === n.barKey) return;
    n.barKey = key;
    const bar = n.bar;
    const have = new Map<string, HTMLSelectElement>();
    bar.querySelectorAll<HTMLSelectElement>('select').forEach((s) => have.set(s.dataset.field ?? '', s));
    const wanted = def.filters.map((f) => f.field);
    for (const [field, el] of have) if (!wanted.includes(field)) el.parentElement?.remove();
    for (const f of def.filters) {
      let sel = have.get(f.field);
      if (!sel) {
        const wrap = document.createElement('label');
        wrap.className = 'fc-chart-filter';
        const cap = document.createElement('span');
        cap.textContent = f.field;
        sel = document.createElement('select');
        sel.dataset.field = f.field;
        sel.setAttribute('aria-label', `Filter ${f.field}`);
        wrap.append(cap, sel);
        bar.appendChild(wrap);
      }
      const current = f.items.length === 1 ? f.items[0] : '';
      const label = pivotLabel(def, f.field);
      const target = sel;
      const fill = (items: string[]) => {
        const opts = [['', '(All)'], ...items.map((i) => [i, i])];
        if (f.items.length > 1) opts.push(['\u0000multi', '(Multiple Items)']);
        target.replaceChildren(...opts.map(([v, t]) => new Option(t, v)));
        target.value = f.items.length > 1 ? '\u0000multi' : current;
      };
      fill(f.items.length === 1 ? [f.items[0]] : []);
      target.title = label;
      void this.io.pivotItems?.(def.name, f.field).then((items) => {
        if (n.barKey === key) fill(items);
      });
    }
    for (const t of [...def.rows, ...def.cols]) {
      if (bar.querySelector(`[data-axis="${CSS.escape(t)}"]`)) continue;
      const chip = document.createElement('span');
      chip.className = 'fc-chart-axis-chip';
      chip.dataset.axis = t;
      chip.textContent = t;
      bar.appendChild(chip);
    }
    bar.querySelectorAll<HTMLElement>('[data-axis]').forEach((c) => {
      if (![...def.rows, ...def.cols].includes(c.dataset.axis ?? '')) c.remove();
    });
  }
}
