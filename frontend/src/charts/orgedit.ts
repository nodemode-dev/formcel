import type { EngineClient } from '../engine';
import type { Grid } from '../grid/grid';
import { actions, el, field, makeModal } from '../ui/modal';
import { rangeLabel, readMatrix, resolveRange, shape } from './data';
import type { ChartSpec, FloatObject } from './types';

export interface OrgEnv {
  eng: EngineClient;
  grid: Grid;
  book(): number;
  sheetNames(): string[];
  sheetNo(): number;
  update(o: FloatObject): void;
  say(text: string): void;
}

export interface OrgNode {
  obj: FloatObject;
  el: HTMLElement;
  body: HTMLElement;
}

interface Source {
  sheet: number;
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  first: number;
  rows: string[][];
  prefix: string;
}

const plain = (s: string) => (s.startsWith("'") ? s.slice(1) : s);

export class OrgEditor {
  private readonly sel = new Map<string, number>();
  private readonly bars = new Map<string, HTMLElement>();

  constructor(private readonly env: OrgEnv) {}

  private async source(spec: ChartSpec): Promise<Source | null> {
    const ref = await resolveRange(this.env.eng, this.env.book(), spec.range);
    if (!ref) return null;
    const sheet = ref.sheet ? this.env.sheetNames().indexOf(ref.sheet) : this.env.sheetNo();
    if (sheet < 0) return null;
    const m = await readMatrix(this.env.eng, this.env.book(), sheet, ref.range);
    const first = shape(m).header ? 1 : 0;
    const prefix = /^.*!/.exec(spec.range.trim())?.[0] ?? '';
    return { sheet, r0: ref.range.r0, c0: ref.range.c0, r1: ref.range.r0 + m.length - 1, c1: ref.range.c0 + (m[0]?.length ?? 1) - 1, first, rows: m.slice(first), prefix };
  }

  private async write(src: Source, edits: [number, number, string][]): Promise<void> {
    if (!edits.length) return;
    const book = this.env.book();
    const mark = await this.env.eng.undoMark(book);
    await this.env.grid.commitEdits(await this.env.eng.apply(book, edits, src.sheet));
    await this.env.eng.undoGroup(book, mark);
  }

  private names(src: Source): string[] {
    return src.rows.map((r) => plain(r[0] ?? ''));
  }

  private parents(src: Source): string[] {
    return src.rows.map((r) => plain(r[1] ?? ''));
  }

  private descendants(src: Source, i: number): Set<number> {
    const names = this.names(src);
    const parent = this.parents(src);
    const out = new Set<number>([i]);
    let grew = true;
    while (grew) {
      grew = false;
      parent.forEach((p, k) => {
        if (out.has(k) || names[k] === '' || p === '') return;
        const at = names.indexOf(p);
        if (at >= 0 && out.has(at)) {
          out.add(k);
          grew = true;
        }
      });
    }
    return out;
  }

  attach(n: OrgNode): void {
    const id = n.obj.id;
    const i = this.sel.get(id);
    n.body.querySelectorAll<SVGElement>('.fc-org-node rect').forEach((r) => r.classList.remove('fc-org-sel', 'fc-org-drop'));
    if (i !== undefined) n.body.querySelector(`.fc-org-node[data-i="${i}"] rect`)?.classList.add('fc-org-sel');
    let bar = this.bars.get(id);
    if (!bar || !n.el.contains(bar)) {
      bar = el('div', 'fc-org-bar');
      bar.hidden = true;
      bar.style.left = '6px';
      bar.style.bottom = '6px';
      bar.innerHTML = '<button type="button" class="fc-btn" data-a="add">Add report</button><button type="button" class="fc-btn" data-a="del">Delete</button><button type="button" class="fc-btn" data-a="branch">Delete branch</button>';
      bar.addEventListener('pointerdown', (e) => e.stopPropagation());
      bar.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
        const cur = this.sel.get(n.obj.id);
        if (!a || cur === undefined) return;
        if (a === 'add') void this.add(n, cur);
        else void this.remove(n, cur, a === 'branch');
      });
      n.el.appendChild(bar);
      this.bars.set(id, bar);
    }
    bar.hidden = i === undefined;
  }

  private select(n: OrgNode, i: number | undefined): void {
    if (i === undefined) this.sel.delete(n.obj.id);
    else this.sel.set(n.obj.id, i);
    this.attach(n);
  }

  pointerDown(e: PointerEvent, n: OrgNode): boolean {
    const t = e.target as Element;
    const spec = n.obj.chart;
    if (!spec || spec.type !== 'org') return false;
    const tog = t.closest<SVGElement>('[data-toggle]');
    if (tog) {
      void this.toggle(n, Number(tog.dataset.toggle));
      return true;
    }
    const g = t.closest<SVGElement>('.fc-org-node');
    if (!g) {
      this.select(n, undefined);
      return false;
    }
    const i = Number(g.dataset.i);
    this.select(n, i);
    const start = { x: e.clientX, y: e.clientY };
    let ghost: HTMLElement | null = null;
    let over: SVGElement | null = null;
    const label = g.querySelector('text')?.textContent ?? '';
    n.el.setPointerCapture(e.pointerId);
    const hit = (x: number, y: number): SVGElement | null => {
      for (const node of document.elementsFromPoint(x, y)) {
        const h = node.closest<SVGElement>('.fc-org-node');
        if (h && n.body.contains(h) && Number(h.dataset.i) !== i) return h;
      }
      return null;
    };
    const move = (m: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(m.clientX - start.x, m.clientY - start.y) < 5) return;
        ghost = el('div', 'fc-org-ghost', label);
        document.getElementById('overlay-root')!.appendChild(ghost);
      }
      ghost.style.transform = `translate(${m.clientX + 10}px, ${m.clientY + 10}px)`;
      const h = hit(m.clientX, m.clientY);
      if (h !== over) {
        over?.querySelector('rect')?.classList.remove('fc-org-drop');
        h?.querySelector('rect')?.classList.add('fc-org-drop');
        over = h;
      }
    };
    const done = (u: PointerEvent, drop: boolean) => {
      n.el.removeEventListener('pointermove', move);
      n.el.removeEventListener('pointerup', up);
      n.el.removeEventListener('pointercancel', cancel);
      n.el.releasePointerCapture(u.pointerId);
      ghost?.remove();
      over?.querySelector('rect')?.classList.remove('fc-org-drop');
      const target = drop && ghost ? hit(u.clientX, u.clientY) : null;
      if (target) void this.reparent(n, i, Number(target.dataset.i));
    };
    const up = (u: PointerEvent) => done(u, true);
    const cancel = (u: PointerEvent) => done(u, false);
    n.el.addEventListener('pointermove', move);
    n.el.addEventListener('pointerup', up);
    n.el.addEventListener('pointercancel', cancel);
    return true;
  }

  private async toggle(n: OrgNode, i: number): Promise<void> {
    const spec = n.obj.chart;
    if (!spec) return;
    const src = await this.source(spec);
    if (!src) return;
    const name = this.names(src)[i];
    if (!name) return;
    const set = new Set(spec.collapsed ?? []);
    if (!set.delete(name)) set.add(name);
    this.env.update({ ...n.obj, chart: { ...spec, collapsed: set.size ? [...set] : undefined } });
  }

  async reparent(n: OrgNode, i: number, target: number): Promise<void> {
    const spec = n.obj.chart;
    if (!spec) return;
    const src = await this.source(spec);
    if (!src) return;
    const names = this.names(src);
    if (!names[i] || !names[target]) return;
    if (this.descendants(src, i).has(target)) {
      this.env.say(`${names[i]} cannot report to ${names[target]}, who already reports to ${names[i]}.`);
      return;
    }
    if (this.parents(src)[i] === names[target]) return;
    await this.write(src, [[src.r0 + src.first + i, src.c0 + 1, names[target]]]);
  }

  private async add(n: OrgNode, i: number): Promise<void> {
    const spec = n.obj.chart;
    if (!spec) return;
    const src = await this.source(spec);
    if (!src) return;
    const boss = this.names(src)[i];
    const got = await this.ask(`Add a person who reports to ${boss}`);
    if (!got) return;
    const row = src.r1 + 1;
    const below = await readMatrix(this.env.eng, this.env.book(), src.sheet, { r0: row, c0: src.c0, r1: row, c1: src.c1 });
    if (below[0]?.some((c) => c !== '')) {
      this.env.say('The row under the org chart data is not empty. Make room below it first.');
      return;
    }
    const edits: [number, number, string][] = [[row, src.c0, got.name], [row, src.c0 + 1, boss]];
    if (got.title && src.c1 >= src.c0 + 2) edits.push([row, src.c0 + 2, got.title]);
    await this.write(src, edits);
    const range = `${src.prefix}${rangeLabel({ r0: src.r0, c0: src.c0, r1: row, c1: src.c1 })}`;
    this.env.update({ ...n.obj, chart: { ...spec, range } });
  }

  private ask(title: string): Promise<{ name: string; title: string } | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v: { name: string; title: string } | null) => {
        if (settled) return;
        settled = true;
        modal.close();
        modal.el.remove();
        resolve(v);
      };
      const modal = makeModal('Add to org chart', { onClose: () => finish(null) });
      const name = el('input', 'fc-fmt-input');
      name.autocomplete = 'off';
      const role = el('input', 'fc-fmt-input');
      role.autocomplete = 'off';
      const ok = () => {
        if (name.value.trim()) finish({ name: name.value.trim(), title: role.value.trim() });
      };
      modal.body.append(el('p', 'fc-fmt-hint', title), field('Name', name), field('Title (optional)', role), actions('Add', ok, () => finish(null)));
      modal.el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          ok();
        }
      });
      modal.open(name);
    });
  }

  private async remove(n: OrgNode, i: number, branch: boolean): Promise<void> {
    const spec = n.obj.chart;
    if (!spec) return;
    const src = await this.source(spec);
    if (!src) return;
    const names = this.names(src);
    const parents = this.parents(src);
    const gone = branch ? this.descendants(src, i) : new Set<number>([i]);
    const up = parents[i];
    const keep: string[][] = [];
    src.rows.forEach((row, k) => {
      if (gone.has(k)) return;
      const copy = [...row];
      if (!branch && plain(copy[1] ?? '') === names[i]) copy[1] = up;
      keep.push(copy);
    });
    const width = src.c1 - src.c0 + 1;
    const top = src.r0 + src.first;
    const edits: [number, number, string][] = [];
    const total = src.rows.length;
    for (let p = Math.min(...gone); p < total; p++) {
      const row = p < keep.length ? keep[p] : null;
      for (let c = 0; c < width; c++) edits.push([top + p, src.c0 + c, row ? row[c] ?? '' : '']);
    }
    await this.write(src, edits);
    this.sel.delete(n.obj.id);
    const range = `${src.prefix}${rangeLabel({ r0: src.r0, c0: src.c0, r1: Math.max(src.r0 + src.first, src.r1 - gone.size), c1: src.c1 })}`;
    const left = new Set(spec.collapsed ?? []);
    for (const k of gone) left.delete(names[k]);
    this.env.update({ ...n.obj, chart: { ...spec, range, collapsed: left.size ? [...left] : undefined } });
  }
}
