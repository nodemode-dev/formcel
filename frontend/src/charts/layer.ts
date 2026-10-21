import type { EngineClient } from '../engine';
import type { Grid, ObjectsHook } from '../grid/grid';
import type { PivotDef } from '../ui/pivot';
import { anchorOf, frameOf, fromLine, toLine } from './anchor';
import { build, readMatrix, resolveRange } from './data';
import { OrgEditor } from './orgedit';
import { makeBar, syncBar } from './pivotbar';
import { FILTER_BAR, pivotChartData } from './pivotchart';
import { contrast, isLine, shapeSvg } from './shapes';
import { renderChartAsync } from './svg';
import { isFloat, newId, type FloatObject, type ShapeSpec } from './types';

export interface LayerIo {
  book(): number;
  sheetNames(): string[];
  load(): Promise<FloatObject[][]>;
  save(sheet: number, list: FloatObject[]): void;
  pivots?(): PivotDef[];
  pivotItems?(name: string, field: string): Promise<string[]>;
  pivotFilter?(name: string, field: string, items: string[]): Promise<void>;
  say?(text: string): void;
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
  art: string;
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
  private readonly org: OrgEditor;
  onEdit: (o: FloatObject) => void = () => undefined;
  onData: () => void = () => undefined;
  onAlt: (o: FloatObject) => void = () => undefined;
  onFormat: (o: FloatObject) => void = () => undefined;
  onScript: (o: FloatObject) => void = () => undefined;
  onRun: (o: FloatObject) => void = () => undefined;

  constructor(private readonly grid: Grid, private readonly eng: EngineClient, private readonly io: LayerIo) {
    this.org = new OrgEditor({
      eng,
      grid,
      book: () => io.book(),
      sheetNames: () => io.sheetNames(),
      sheetNo: () => this.sheetNo,
      update: (o) => this.update(o),
      say: (t) => io.say?.(t),
    });
    this.el = document.createElement('div');
    this.el.className = 'fc-objects';
    this.el.setAttribute('aria-label', 'Charts, pictures and shapes');
    this.bar = document.createElement('div');
    this.bar.className = 'fc-obj-bar';
    this.bar.hidden = true;
    this.bar.innerHTML = '<button type="button" class="fc-btn" data-a="edit">Edit</button><button type="button" class="fc-btn" data-a="format" hidden>Format button</button><button type="button" class="fc-btn" data-a="script" hidden>Assign script</button><button type="button" class="fc-btn" data-a="alt">Alt text</button><button type="button" class="fc-btn" data-a="front">Bring to front</button><button type="button" class="fc-btn" data-a="back">Send to back</button><button type="button" class="fc-btn" data-a="delete">Delete</button>';
    this.bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.bar.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      const n = this.selected ? this.nodes.get(this.selected) : null;
      if (!a || !n) return;
      if (a === 'edit') this.onEdit(n.obj);
      if (a === 'format') this.onFormat(n.obj);
      if (a === 'script') this.onScript(n.obj);
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

  preview(o: FloatObject): void {
    const n = this.nodes.get(o.id);
    if (!n) return;
    n.obj = o;
    const list = this.list();
    const i = list.findIndex((x) => x.id === o.id);
    if (i >= 0) list[i] = o;
    this.fill(n);
    this.place();
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
    n.el.setAttribute('role', o.script || o.scriptName ? 'button' : o.kind === 'chart' || o.kind === 'picture' ? 'img' : 'group');
    n.el.classList.toggle('fc-obj-run', !!(o.script || o.scriptName));
    n.el.title = o.script || o.scriptName ? `Runs ${o.scriptName ? `the script ${o.scriptName}` : 'its script'}. Ctrl+click selects it.` : '';
    if (o.script || o.scriptName) n.el.tabIndex = 0;
    else n.el.tabIndex = -1;
    const text = o.shape?.text || o.text?.text || '';
    if ((o.script || o.scriptName) && !label && text) n.el.setAttribute('aria-label', text);
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

  deselect(): void {
    this.select(null);
  }

  private select(id: string | null): void {
    if (this.selected) this.nodes.get(this.selected)?.el.classList.remove('fc-obj-sel');
    this.selected = id;
    if (id) this.nodes.get(id)?.el.classList.add('fc-obj-sel');
    this.bar.hidden = !id;
    this.barButtons();
    this.place();
  }

  private barButtons(): void {
    const o = this.selected ? this.nodes.get(this.selected)?.obj : null;
    const set = (a: string, on: boolean) => {
      const b = this.bar.querySelector<HTMLButtonElement>(`[data-a="${a}"]`);
      if (b && b.hidden === on) b.hidden = !on;
    };
    set('script', !!o && (o.kind === 'shape' || o.kind === 'picture' || o.kind === 'text'));
    set('format', !!o && o.kind === 'shape' && !!o.shape?.button);
  }

  refreshBar(): void {
    this.barButtons();
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
    el.style.transformOrigin = '50% 50%';
    const body = document.createElement('div');
    body.className = 'fc-obj-body';
    el.appendChild(body);
    for (const h of HANDLES) {
      const s = document.createElement('span');
      s.className = `fc-obj-h fc-obj-h-${h}`;
      s.dataset.h = h;
      el.appendChild(s);
    }
    const n: Node = { obj: o, el, body, html: '', moving: false, dw: o.w, dh: o.h, bar: null, barKey: '', art: '' };
    el.addEventListener('pointerdown', (e) => this.down(e, n));
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && (n.obj.script || n.obj.scriptName) && e.target === el) {
        e.preventDefault();
        e.stopPropagation();
        this.onRun(n.obj);
      }
    });
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
      this.fillShape(n, o.shape);
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

  private fillShape(n: Node, s: ShapeSpec): void {
    let art = n.body.querySelector<HTMLElement>('.fc-shape-art');
    let label = n.body.querySelector<HTMLElement>('.fc-obj-label');
    if (!art || !label) {
      art = document.createElement('div');
      art.className = 'fc-shape-art';
      label = document.createElement('div');
      label.className = 'fc-obj-label';
      n.body.replaceChildren(art, label);
      n.art = '';
    }
    const svg = shapeSvg(s, Math.max(1, n.obj.w), Math.max(1, n.obj.h));
    if (svg !== n.art) {
      n.art = svg;
      art.innerHTML = svg;
    }
    if (label.contentEditable !== 'true' && label.textContent !== s.text) label.textContent = s.text;
    const st = label.style;
    st.fontSize = `${(s.size ?? 11) * (96 / 72)}px`;
    st.color = s.color || contrast(s.noFill ? '#ffffff' : s.fill);
    st.fontWeight = s.bold ? '700' : '';
    st.fontStyle = s.italic ? 'italic' : '';
    st.textDecoration = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ');
    st.fontFamily = s.font ?? '';
    st.textAlign = s.align === 'l' ? 'left' : s.align === 'r' ? 'right' : s.align === 'j' ? 'justify' : 'center';
    st.justifyContent = s.valign === 't' ? 'flex-start' : s.valign === 'b' ? 'flex-end' : 'center';
    label.hidden = isLine(s.shape);
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
      const rot = o.kind === 'shape' ? o.shape?.rot ?? 0 : 0;
      s.transform = `translate(${x}px, ${y}px)${rot ? ` rotate(${rot}deg)` : ''}`;
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
    if ((n.obj.script || n.obj.scriptName) && this.selected !== n.obj.id && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const sx = e.clientX;
      const sy = e.clientY;
      n.el.setPointerCapture(e.pointerId);
      const release = (u: PointerEvent) => {
        n.el.removeEventListener('pointerup', release);
        if (Math.abs(u.clientX - sx) + Math.abs(u.clientY - sy) < 6) this.onRun(n.obj);
      };
      n.el.addEventListener('pointerup', release);
      return;
    }
    this.select(n.obj.id);
    if (n.obj.chart?.type === 'org' && this.org.pointerDown(e, n)) return;
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
      else html = await renderChartAsync(this.eng, spec, data, n.obj.w, Math.max(40, n.obj.h - (spec.pivotButtons === false ? 0 : FILTER_BAR)));
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
    if (spec.type === 'org') this.org.attach(n);
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
    const shown = n.obj.chart?.pivotButtons !== false;
    const key = JSON.stringify([shown, def.name, def.rows, def.cols, def.filters, def.values.map((v) => [v.field, v.func, v.name])]);
    if (!n.bar) {
      const bar = makeBar({
        items: (name, field) => this.io.pivotItems?.(name, field) ?? Promise.resolve([]),
        filter: (name, field, items) => this.io.pivotFilter?.(name, field, items) ?? Promise.resolve(),
      }, () => (n.obj.chart?.pivot ? this.io.pivots?.().find((p) => p.name === n.obj.chart?.pivot) ?? null : null));
      n.el.insertBefore(bar, n.body);
      n.bar = bar;
    }
    if (key === n.barKey) return;
    n.barKey = key;
    n.bar.hidden = !shown;
    n.body.style.top = shown ? `${FILTER_BAR}px` : '0px';
    syncBar(n.bar, def);
  }
}
