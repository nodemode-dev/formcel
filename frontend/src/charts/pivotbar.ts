import { FUNCS, type PivotDef } from '../ui/pivot';
import { pivotLabel } from './pivotchart';

export interface BarHooks {
  items(name: string, field: string): Promise<string[]>;
  filter(name: string, field: string, items: string[]): Promise<void>;
}

type Zone = 'filter' | 'axis' | 'legend' | 'values';

const ZONES: [Zone, string][] = [['filter', 'Filter'], ['axis', 'Axis (Categories)'], ['legend', 'Legend (Series)'], ['values', 'Values']];

let drop: HTMLElement | null = null;
let closer: ((e: Event) => void) | null = null;

function closeDrop(): void {
  if (drop) drop.hidden = true;
  if (closer) document.removeEventListener('pointerdown', closer, true);
  closer = null;
}

async function openDrop(btn: HTMLElement, def: PivotDef, field: string, hooks: BarHooks): Promise<void> {
  if (!drop) {
    drop = document.createElement('div');
    drop.className = 'fc-pivot-drop';
    drop.hidden = true;
    drop.setAttribute('role', 'dialog');
    document.getElementById('overlay-root')!.appendChild(drop);
  }
  const root = drop;
  const items = await hooks.items(def.name, field);
  const chosen = def.filters.find((f) => f.field === field)?.items ?? [];
  const on = new Set(chosen.length ? chosen : items);
  root.setAttribute('aria-label', `Filter ${field}`);
  const rows: HTMLElement[] = [];
  const all = document.createElement('label');
  const allBox = document.createElement('input');
  allBox.type = 'checkbox';
  all.append(allBox, '(Select All)');
  rows.push(all);
  const boxes: [string, HTMLInputElement][] = [];
  for (const it of items) {
    const l = document.createElement('label');
    const b = document.createElement('input');
    b.type = 'checkbox';
    b.checked = on.has(it);
    l.append(b, it === '' ? '(blank)' : it);
    boxes.push([it, b]);
    rows.push(l);
  }
  const syncAll = () => {
    const n = boxes.filter(([, b]) => b.checked).length;
    allBox.checked = n === boxes.length;
    allBox.indeterminate = n > 0 && n < boxes.length;
  };
  syncAll();
  allBox.addEventListener('change', () => {
    for (const [, b] of boxes) b.checked = allBox.checked;
    syncAll();
  });
  for (const [, b] of boxes) b.addEventListener('change', syncAll);
  const acts = document.createElement('div');
  acts.className = 'fc-pivot-drop-acts';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'fc-btn';
  cancel.textContent = 'Cancel';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'fc-btn fc-btn-primary';
  ok.textContent = 'OK';
  cancel.addEventListener('click', closeDrop);
  ok.addEventListener('click', () => {
    const picked = boxes.filter(([, b]) => b.checked).map(([v]) => v);
    closeDrop();
    if (!picked.length) return;
    void hooks.filter(def.name, field, picked.length === boxes.length ? [] : picked);
  });
  acts.append(cancel, ok);
  root.replaceChildren(...rows, acts);
  root.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = root.getBoundingClientRect();
  root.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - w.width - 4))}px`;
  root.style.top = `${Math.max(4, Math.min(r.bottom + 2, window.innerHeight - w.height - 4))}px`;
  closer = (e) => {
    if (!root.contains(e.target as Node) && !btn.contains(e.target as Node)) closeDrop();
  };
  document.addEventListener('pointerdown', closer, true);
  root.querySelector<HTMLElement>('input')?.focus();
}

function valueLabel(v: PivotDef['values'][number]): string {
  if (v.name) return v.name;
  const f = FUNCS.find(([id]) => id === v.func)?.[1] ?? 'Sum';
  return `${f} of ${v.field}`;
}

export function makeBar(hooks: BarHooks, current: () => PivotDef | null): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'fc-chart-filters fc-chart-pbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'PivotChart field buttons');
  for (const [zone, caption] of ZONES) {
    const z = document.createElement('span');
    z.className = 'fc-chart-zone';
    z.dataset.zone = zone;
    z.hidden = true;
    const name = document.createElement('span');
    name.className = 'fc-chart-zone-name';
    name.textContent = caption;
    z.appendChild(name);
    bar.appendChild(z);
  }
  bar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.fc-chart-btn[data-field]');
    const def = current();
    if (!btn || !def || btn.dataset.zone === 'values') return;
    if (drop && !drop.hidden) {
      closeDrop();
      return;
    }
    void openDrop(btn, def, btn.dataset.field ?? '', hooks);
  });
  return bar;
}

export function syncBar(bar: HTMLElement, def: PivotDef): void {
  const picked = (f: string) => !!def.filters.find((x) => x.field === f)?.items.length;
  const wanted: Record<Zone, { field: string; label: string; on: boolean; title: string }[]> = {
    filter: def.filters.filter((f) => !def.rows.includes(f.field) && !def.cols.includes(f.field)).map((f) => ({ field: f.field, label: f.field, on: f.items.length > 0, title: `${f.field}: ${pivotLabel(def, f.field)}` })),
    axis: def.rows.map((f) => ({ field: f, label: f, on: picked(f), title: `${f}: ${pivotLabel(def, f)}` })),
    legend: def.cols.map((f) => ({ field: f, label: f, on: picked(f), title: `${f}: ${pivotLabel(def, f)}` })),
    values: def.values.map((v) => ({ field: v.name || v.field, label: valueLabel(v), on: false, title: valueLabel(v) })),
  };
  for (const [zone] of ZONES) {
    const z = bar.querySelector<HTMLElement>(`.fc-chart-zone[data-zone="${zone}"]`)!;
    const list = wanted[zone];
    z.hidden = !list.length;
    const have = new Map<string, HTMLButtonElement>();
    z.querySelectorAll<HTMLButtonElement>('.fc-chart-btn').forEach((b) => have.set(b.dataset.field ?? '', b));
    const keep = new Set(list.map((x) => x.field));
    for (const [f, b] of have) if (!keep.has(f)) b.remove();
    list.forEach((x, i) => {
      let b = have.get(x.field);
      if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'fc-chart-btn';
        b.dataset.zone = zone;
        b.dataset.field = x.field;
        const t = document.createElement('span');
        t.className = 'fc-chart-btn-text';
        b.appendChild(t);
        if (zone !== 'values') {
          const c = document.createElement('span');
          c.className = 'fc-chart-caret';
          c.setAttribute('aria-hidden', 'true');
          b.appendChild(c);
        }
      }
      const text = b.firstElementChild as HTMLElement;
      if (text.textContent !== x.label) text.textContent = x.label;
      b.title = x.title;
      b.style.fontWeight = x.on ? '700' : '';
      b.setAttribute('aria-label', zone === 'values' ? x.label : `${x.field}, field button, ${x.on ? 'filtered' : 'all items'}`);
      if (z.children[i + 1] !== b) z.insertBefore(b, z.children[i + 1] ?? null);
    });
  }
}
