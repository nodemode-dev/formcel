import { icon } from './icons';

const LIST = '\u001f';
const PART = '\u001e';

export interface PivotValue {
  field: string;
  func: string;
  show: string;
  name: string;
}

export interface PivotDef {
  name: string;
  sheet: number;
  row: number;
  col: number;
  srcSheet: number;
  src: string;
  table: string;
  flags: string;
  out: string;
  rows: string[];
  cols: string[];
  values: PivotValue[];
  filters: { field: string; items: string[] }[];
  calc: { name: string; formula: string }[];
}

export interface PivotFields {
  sheet: number;
  area: [number, number, number, number];
  table: string;
  fields: { name: string; num: boolean }[];
}

export const FUNCS: [string, string][] = [
  ['sum', 'Sum'], ['count', 'Count'], ['average', 'Average'], ['max', 'Max'], ['min', 'Min'], ['product', 'Product'],
  ['countnums', 'Count Numbers'], ['stdev', 'StdDev'], ['stdevp', 'StdDevp'], ['var', 'Var'], ['varp', 'Varp'],
];

export const SHOWS: [string, string][] = [['none', 'No calculation'], ['grand', '% of grand total'], ['col', '% of column total'], ['row', '% of row total']];

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

function unesc(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') {
      out += s[i];
      continue;
    }
    const n = s[++i];
    out += n === 't' ? '\t' : n === 'n' ? '\n' : n === 'r' ? '\r' : (n ?? '\\');
  }
  return out;
}

const split = (s: string) => s.split(LIST).filter(Boolean);

export function parsePivot(line: string): PivotDef | null {
  const p = line.split('\t').map(unesc);
  if (p.length < 13) return null;
  const [r, c] = (p[2] ?? '').split(',');
  return {
    name: p[0] ?? '',
    sheet: Number(p[1]),
    row: Number(r),
    col: Number(c),
    srcSheet: Number(p[3]),
    src: p[4] ?? '',
    table: p[5] ?? '',
    flags: p[6] ?? '',
    out: p[7] ?? '',
    rows: split(p[8] ?? ''),
    cols: split(p[9] ?? ''),
    values: split(p[10] ?? '').map((v) => {
      const q = v.split(PART);
      return { field: q[0] ?? '', func: q[1] ?? 'sum', show: q[2] ?? 'none', name: q[3] ?? '' };
    }),
    filters: split(p[11] ?? '').map((v) => {
      const [field = '', ...items] = v.split(PART);
      return { field, items };
    }),
    calc: split(p[12] ?? '').map((v) => {
      const [name = '', formula = ''] = v.split(PART);
      return { name, formula };
    }),
  };
}

export function formatPivot(d: PivotDef): string {
  return [
    d.name,
    String(d.sheet),
    `${d.row},${d.col}`,
    String(d.srcSheet),
    d.src,
    d.table,
    d.flags,
    d.out,
    d.rows.join(LIST),
    d.cols.join(LIST),
    d.values.map((v) => [v.field, v.func, v.show, v.name].join(PART)).join(LIST),
    d.filters.map((f) => [f.field, ...f.items].join(PART)).join(LIST),
    d.calc.map((c) => [c.name, c.formula].join(PART)).join(LIST),
  ].map(esc).join('\t');
}

export function outArea(d: PivotDef): { sheet: number; area: [number, number, number, number] } | null {
  const m = /^(\d+):(\d+),(\d+),(\d+),(\d+)$/.exec(d.out);
  return m ? { sheet: Number(m[1]), area: [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])] } : null;
}

export function parseFields(line: string): PivotFields {
  const p = line.split('\t').map(unesc);
  const a = (p[1] ?? '').split(',').map(Number);
  return {
    sheet: Number(p[0]),
    area: [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0],
    table: p[2] ?? '',
    fields: p.slice(3).map((f) => ({ num: f.startsWith('n'), name: f.slice(1) })),
  };
}

export function emptyPivot(src: PivotFields, sheet: number, row: number, col: number): PivotDef {
  return { name: '', sheet, row, col, srcSheet: src.sheet, src: src.area.join(','), table: src.table, flags: 'rcsa', out: '', rows: [], cols: [], values: [], filters: [], calc: [] };
}

export function describe(d: PivotDef): string {
  const label = (v: PivotValue) => v.name || `${FUNCS.find((f) => f[0] === v.func)?.[1] ?? 'Sum'} of ${v.field}`;
  const vals = d.values.map(label).join(', ') || 'No values';
  const by = d.rows.join(' and ');
  const across = d.cols.join(' and ');
  return [vals, by && `by ${by}`, across && `across ${across}`].filter(Boolean).join(' ');
}

type Area = 'filters' | 'cols' | 'rows' | 'values';

const AREAS: [Area, string][] = [['filters', 'Filters'], ['cols', 'Columns'], ['rows', 'Rows'], ['values', 'Values']];

function reconcile(list: HTMLElement, keys: string[], make: (key: string) => HTMLElement, update: (el: HTMLElement, i: number) => void): void {
  const have = new Map<string, HTMLElement>();
  for (const el of Array.from(list.children) as HTMLElement[]) have.set(el.dataset.key ?? '', el);
  keys.forEach((k, i) => {
    let el = have.get(k);
    if (el) have.delete(k);
    else el = make(k);
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] ?? null);
    update(el, i);
  });
  for (const el of have.values()) el.remove();
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export interface PivotHost {
  change(def: PivotDef): Promise<void>;
  refresh(name: string): Promise<void>;
  remove(name: string): Promise<void>;
  items(name: string, field: string): Promise<string[]>;
  close(): void;
}

export class PivotPanel {
  readonly el: HTMLElement;
  private def: PivotDef | null = null;
  private fields: PivotFields['fields'] = [];
  private readonly fieldList: HTMLElement;
  private readonly lists = new Map<Area, HTMLElement>();
  private readonly calcList: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly title: HTMLElement;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly host: PivotHost) {
    const el = (this.el = document.createElement('section'));
    el.className = 'fc-pvt';
    el.hidden = true;
    el.setAttribute('aria-label', 'PivotTable fields');
    const areas = AREAS.map(([k, label]) => `<div class="fc-pvt-area" data-area="${k}"><span class="fc-pvt-label">${label}</span><ul class="fc-pvt-list"></ul></div>`).join('');
    el.innerHTML = `<header class="fc-pvt-head"><strong>PivotTable fields</strong><span class="fc-pvt-name"></span><button type="button" class="fc-tool" data-act="close" title="Close" aria-label="Close"></button></header>
<div class="fc-pvt-body">
<p class="fc-pvt-note">Tick a field to add it, or drag it into an area below.</p>
<ul class="fc-pvt-fields"></ul>
<div class="fc-pvt-areas">${areas}</div>
<div class="fc-pvt-calc"><span class="fc-pvt-label">Calculated fields</span><ul class="fc-pvt-calcs"></ul><div class="fc-pvt-calc-new"><input class="fc-fmt-input" data-k="cname" placeholder="Name" spellcheck="false" autocomplete="off"><input class="fc-fmt-input" data-k="cformula" placeholder="= Sales * 1.2" spellcheck="false" autocomplete="off"><button type="button" class="fc-btn" data-act="calc-add">Add</button></div></div>
<div class="fc-pvt-opts"><label class="fc-sort-check"><input type="checkbox" data-flag="r"> Grand totals for rows</label><label class="fc-sort-check"><input type="checkbox" data-flag="c"> Grand totals for columns</label><label class="fc-sort-check"><input type="checkbox" data-flag="s"> Subtotals</label><label class="fc-sort-check"><input type="checkbox" data-flag="a"> Refresh when the source data changes</label></div>
</div>
<footer class="fc-pvt-foot"><span class="fc-pvt-hint" aria-live="polite"></span><button type="button" class="fc-btn" data-act="refresh"></button><button type="button" class="fc-btn" data-act="remove">Delete</button></footer>`;
    el.querySelector('[data-act="close"]')!.innerHTML = icon('close');
    el.querySelector('[data-act="refresh"]')!.innerHTML = `${icon('refresh')} Refresh`;
    this.fieldList = el.querySelector<HTMLElement>('.fc-pvt-fields')!;
    this.calcList = el.querySelector<HTMLElement>('.fc-pvt-calcs')!;
    this.hint = el.querySelector<HTMLElement>('.fc-pvt-hint')!;
    this.title = el.querySelector<HTMLElement>('.fc-pvt-name')!;
    for (const [k] of AREAS) this.lists.set(k, el.querySelector<HTMLElement>(`[data-area="${k}"] .fc-pvt-list`)!);
    el.addEventListener('click', (e) => this.click(e));
    el.addEventListener('change', (e) => this.changed(e));
    el.addEventListener('dragstart', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-drag]');
      if (!t || !e.dataTransfer) return;
      e.dataTransfer.setData('text/plain', JSON.stringify({ field: t.dataset.drag, from: t.dataset.from ?? '' }));
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragover', (e) => {
      if (!(e.target as HTMLElement).closest('[data-area]')) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    el.addEventListener('drop', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-area]');
      if (!a || !e.dataTransfer) return;
      e.preventDefault();
      try {
        const d = JSON.parse(e.dataTransfer.getData('text/plain')) as { field: string; from: string };
        this.place(d.field, a.dataset.area as Area, d.from as Area | '');
      } catch {
        return;
      }
    });
  }

  get name(): string {
    return this.def?.name ?? '';
  }

  show(def: PivotDef, fields: PivotFields['fields']): void {
    this.fields = fields;
    this.sync(def);
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  sync(def: PivotDef): void {
    this.def = def;
    setText(this.title, def.name);
    const names = [...this.fields.map((f) => f.name), ...def.calc.map((c) => c.name)];
    const used = new Set([...def.rows, ...def.cols, ...def.filters.map((f) => f.field), ...def.values.map((v) => v.field)]);
    reconcile(this.fieldList, names, (k) => {
      const li = document.createElement('li');
      li.className = 'fc-pvt-field';
      li.dataset.key = k;
      li.dataset.drag = k;
      li.draggable = true;
      li.innerHTML = '<label class="fc-sort-check"><input type="checkbox"><span></span></label><select class="fc-fmt-input fc-pvt-move" aria-label="Move to"><option value="">Add to</option><option value="filters">Filters</option><option value="cols">Columns</option><option value="rows">Rows</option><option value="values">Values</option></select>';
      return li;
    }, (li, i) => {
      const k = names[i] ?? '';
      setText(li.querySelector('span')!, k);
      const box = li.querySelector<HTMLInputElement>('input')!;
      if (box.checked !== used.has(k)) box.checked = used.has(k);
    });
    this.fill('filters', def.filters.map((f) => f.field));
    this.fill('cols', def.cols);
    this.fill('rows', def.rows);
    this.fillValues(def);
    reconcile(this.calcList, def.calc.map((c) => c.name), (k) => {
      const li = document.createElement('li');
      li.className = 'fc-pvt-calc-item';
      li.dataset.key = k;
      li.innerHTML = '<span></span><button type="button" class="fc-btn" data-act="calc-del">Delete</button>';
      return li;
    }, (li, i) => setText(li.querySelector('span')!, `${def.calc[i]?.name ?? ''} = ${def.calc[i]?.formula ?? ''}`));
    for (const box of this.el.querySelectorAll<HTMLInputElement>('[data-flag]')) {
      const on = def.flags.includes(box.dataset.flag ?? '');
      if (box.checked !== on) box.checked = on;
    }
  }

  private fill(area: Area, items: string[]): void {
    const list = this.lists.get(area)!;
    reconcile(list, items, (k) => {
      const li = document.createElement('li');
      li.className = 'fc-pvt-chip';
      li.dataset.key = k;
      li.dataset.drag = k;
      li.dataset.from = area;
      li.draggable = true;
      li.innerHTML = '<span class="fc-pvt-chip-name"></span><span class="fc-pvt-chip-acts"><button type="button" class="fc-btn" data-act="up" title="Move up" aria-label="Move up">Up</button><button type="button" class="fc-btn" data-act="down" title="Move down" aria-label="Move down">Down</button><button type="button" class="fc-btn" data-act="items" title="Choose items">Items</button><button type="button" class="fc-btn" data-act="drop" title="Remove" aria-label="Remove">Remove</button></span><div class="fc-pvt-items" hidden></div>';
      return li;
    }, (li, i) => {
      setText(li.querySelector('.fc-pvt-chip-name')!, items[i] ?? '');
      li.querySelector<HTMLElement>('[data-act="items"]')!.hidden = area !== 'filters';
      li.querySelector<HTMLElement>('[data-act="up"]')!.hidden = area === 'filters';
      li.querySelector<HTMLElement>('[data-act="down"]')!.hidden = area === 'filters';
    });
  }

  private fillValues(def: PivotDef): void {
    const list = this.lists.get('values')!;
    const seen = new Map<string, number>();
    const keys = def.values.map((v) => {
      const n = (seen.get(v.field) ?? 0) + 1;
      seen.set(v.field, n);
      return `${v.field}#${n}`;
    });
    const calc = new Set(def.calc.map((c) => c.name.toLowerCase()));
    const opt = (list: [string, string][]) => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    reconcile(list, keys, (k) => {
      const li = document.createElement('li');
      li.className = 'fc-pvt-chip fc-pvt-value';
      li.dataset.key = k;
      li.dataset.drag = k.slice(0, k.lastIndexOf('#'));
      li.dataset.from = 'values';
      li.draggable = true;
      li.innerHTML = `<span class="fc-pvt-chip-name"></span><span class="fc-pvt-chip-acts"><button type="button" class="fc-btn" data-act="up" aria-label="Move up">Up</button><button type="button" class="fc-btn" data-act="down" aria-label="Move down">Down</button><button type="button" class="fc-btn" data-act="drop" aria-label="Remove">Remove</button></span><div class="fc-pvt-vset"><select class="fc-fmt-input" data-k="func" aria-label="Summarize values by">${opt(FUNCS)}</select><select class="fc-fmt-input" data-k="show" aria-label="Show values as">${opt(SHOWS)}</select><input class="fc-fmt-input" data-k="vname" placeholder="Custom name" spellcheck="false" autocomplete="off" aria-label="Custom name"></div>`;
      return li;
    }, (li, i) => {
      const v = def.values[i];
      if (!v) return;
      setText(li.querySelector('.fc-pvt-chip-name')!, v.field);
      const f = li.querySelector<HTMLSelectElement>('[data-k="func"]')!;
      const s = li.querySelector<HTMLSelectElement>('[data-k="show"]')!;
      const n = li.querySelector<HTMLInputElement>('[data-k="vname"]')!;
      if (f.value !== v.func) f.value = v.func;
      if (s.value !== v.show) s.value = v.show;
      if (document.activeElement !== n && n.value !== v.name) n.value = v.name;
      f.disabled = calc.has(v.field.toLowerCase());
    });
  }

  private clone(): PivotDef | null {
    return this.def ? (JSON.parse(JSON.stringify(this.def)) as PivotDef) : null;
  }

  private push(next: PivotDef): void {
    this.queue = this.queue.then(async () => {
      this.hint.textContent = '';
      try {
        await this.host.change(next);
      } catch (err) {
        this.hint.textContent = err instanceof Error ? err.message : 'Not changed';
        if (this.def) this.sync(this.def);
      }
    });
  }

  private place(field: string, area: Area, from: Area | ''): void {
    const d = this.clone();
    if (!d || !field) return;
    const calc = d.calc.some((c) => c.name === field);
    if (calc && area !== 'values') return;
    if (area === 'values') {
      if (from === 'values') return;
      const num = this.fields.find((f) => f.name === field)?.num ?? true;
      d.values.push({ field, func: num || calc ? 'sum' : 'count', show: 'none', name: '' });
    } else {
      d.rows = d.rows.filter((x) => x !== field);
      d.cols = d.cols.filter((x) => x !== field);
      d.filters = d.filters.filter((x) => x.field !== field);
      if (area === 'rows') d.rows.push(field);
      else if (area === 'cols') d.cols.push(field);
      else d.filters.push({ field, items: [] });
    }
    this.push(d);
  }

  private click(e: MouseEvent): void {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') return this.host.close();
    if (act === 'refresh') return void this.host.refresh(this.name).catch((err: unknown) => (this.hint.textContent = err instanceof Error ? err.message : 'Not refreshed'));
    if (act === 'remove') return void this.host.remove(this.name).catch((err: unknown) => (this.hint.textContent = err instanceof Error ? err.message : 'Not deleted'));
    const d = this.clone();
    if (!d) return;
    if (act === 'calc-add') {
      const q = (k: string) => this.el.querySelector<HTMLInputElement>(`[data-k="${k}"]`)!;
      const name = q('cname').value.trim();
      const formula = q('cformula').value.trim().replace(/^=/, '');
      if (!name || !formula) {
        this.hint.textContent = 'Give the calculated field a name and a formula such as Sales * 1.2.';
        return;
      }
      if (this.fields.some((f) => f.name.toLowerCase() === name.toLowerCase()) || d.calc.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        this.hint.textContent = 'A field with that name already exists.';
        return;
      }
      d.calc.push({ name, formula });
      q('cname').value = '';
      q('cformula').value = '';
      return this.push(d);
    }
    if (act === 'calc-del') {
      const name = b.closest<HTMLElement>('[data-key]')?.dataset.key ?? '';
      d.calc = d.calc.filter((c) => c.name !== name);
      d.values = d.values.filter((v) => v.field !== name);
      return this.push(d);
    }
    const chip = b.closest<HTMLElement>('.fc-pvt-chip');
    const area = chip?.closest<HTMLElement>('[data-area]')?.dataset.area as Area | undefined;
    if (!chip || !area) return;
    const idx = Array.from(chip.parentElement?.children ?? []).indexOf(chip);
    if (act === 'items') return void this.toggleItems(chip, d);
    const move = (arr: unknown[], by: number) => {
      const j = idx + by;
      if (j < 0 || j >= arr.length) return false;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return true;
    };
    if (act === 'drop') {
      if (area === 'rows') d.rows.splice(idx, 1);
      else if (area === 'cols') d.cols.splice(idx, 1);
      else if (area === 'filters') d.filters.splice(idx, 1);
      else d.values.splice(idx, 1);
      return this.push(d);
    }
    if (act === 'up' || act === 'down') {
      const arr = area === 'rows' ? d.rows : area === 'cols' ? d.cols : area === 'values' ? d.values : null;
      if (arr && move(arr, act === 'up' ? -1 : 1)) this.push(d);
    }
  }

  private async toggleItems(chip: HTMLElement, d: PivotDef): Promise<void> {
    const box = chip.querySelector<HTMLElement>('.fc-pvt-items')!;
    if (!box.hidden) {
      box.hidden = true;
      return;
    }
    const field = chip.dataset.key ?? '';
    let all: string[] = [];
    try {
      all = await this.host.items(d.name, field);
    } catch (err) {
      this.hint.textContent = err instanceof Error ? err.message : 'No items';
      return;
    }
    const kept = d.filters.find((f) => f.field === field)?.items ?? [];
    const chosen = new Set(kept.length ? kept : all);
    const parts = [`<label class="fc-sort-check"><input type="checkbox" data-all> (All)</label>`];
    all.forEach((_, i) => parts.push(`<label class="fc-sort-check"><input type="checkbox" data-item="${i}"> <span></span></label>`));
    box.innerHTML = parts.join('');
    const spans = box.querySelectorAll('span');
    all.forEach((it, i) => setText(spans[i]!, it));
    const boxes = Array.from(box.querySelectorAll<HTMLInputElement>('[data-item]'));
    boxes.forEach((b, i) => (b.checked = chosen.has(all[i] ?? '')));
    const allBox = box.querySelector<HTMLInputElement>('[data-all]')!;
    allBox.checked = boxes.every((b) => b.checked);
    box.onchange = (ev) => {
      ev.stopPropagation();
      const t = ev.target as HTMLInputElement;
      if (t.dataset.all !== undefined) boxes.forEach((b) => (b.checked = t.checked));
      else allBox.checked = boxes.every((b) => b.checked);
      const next = this.clone();
      if (!next) return;
      const picked = all.filter((_, i) => boxes[i]?.checked);
      const f = next.filters.find((x) => x.field === field);
      if (f) f.items = picked.length === all.length ? [] : picked;
      if (!picked.length) {
        boxes.forEach((b) => (b.checked = true));
        allBox.checked = true;
        if (f) f.items = [];
      }
      this.push(next);
    };
    box.hidden = false;
  }

  private changed(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const d = this.clone();
    if (!d) return;
    const field = t.closest<HTMLElement>('.fc-pvt-field');
    if (field && t instanceof HTMLInputElement) {
      const name = field.dataset.key ?? '';
      if (t.checked) {
        const num = this.fields.find((f) => f.name === name)?.num ?? true;
        const calc = d.calc.some((c) => c.name === name);
        this.place(name, num || calc ? 'values' : 'rows', '');
      } else {
        d.rows = d.rows.filter((x) => x !== name);
        d.cols = d.cols.filter((x) => x !== name);
        d.filters = d.filters.filter((x) => x.field !== name);
        d.values = d.values.filter((x) => x.field !== name);
        this.push(d);
      }
      return;
    }
    if (field && t instanceof HTMLSelectElement) {
      const to = t.value as Area | '';
      t.value = '';
      if (to) this.place(field.dataset.key ?? '', to, '');
      return;
    }
    if (t instanceof HTMLInputElement && t.dataset.flag) {
      const flag = t.dataset.flag;
      d.flags = d.flags.replace(flag, '') + (t.checked ? flag : '');
      return this.push(d);
    }
    const chip = t.closest<HTMLElement>('.fc-pvt-value');
    if (chip) {
      const idx = Array.from(chip.parentElement?.children ?? []).indexOf(chip);
      const v = d.values[idx];
      if (!v) return;
      if (t.dataset.k === 'func') v.func = t.value;
      else if (t.dataset.k === 'show') v.show = t.value;
      else if (t.dataset.k === 'vname') v.name = t.value.trim();
      this.push(d);
    }
  }
}

export interface PivotDialogHost {
  create(src: string, dest: string | null, layout: string | null): Promise<void>;
  suggest(src: string): Promise<string[]>;
}

export class PivotDialog {
  readonly form: HTMLFormElement;
  private readonly hint: HTMLElement;
  private readonly sugg: HTMLElement;
  private lines: string[] = [];
  private stamp = 0;

  constructor(private readonly host: PivotDialogHost, private readonly done: () => void) {
    const form = (this.form = document.createElement('form'));
    form.className = 'fc-fmt-custom fc-pw fc-pvt-dialog';
    form.hidden = true;
    form.setAttribute('role', 'dialog');
    form.innerHTML = `<span class="fc-fmt-title">Create PivotTable</span>
<label class="fc-fmt-label">Table or range<input class="fc-fmt-input" data-k="src" spellcheck="false" autocomplete="off" placeholder="Sheet1!A1:D20 or Table1"></label>
<fieldset class="fc-pvt-dest"><legend>Where do you want the PivotTable?</legend>
<label class="fc-sort-check"><input type="radio" name="pvt-dest" value="new" checked> New worksheet</label>
<label class="fc-sort-check"><input type="radio" name="pvt-dest" value="here"> Existing worksheet</label>
<input class="fc-fmt-input" data-k="dest" spellcheck="false" autocomplete="off" placeholder="Sheet1!H2" disabled></fieldset>
<span class="fc-pvt-label">Recommended PivotTables</span><div class="fc-pvt-sugg" aria-live="polite"></div>
<span class="fc-fmt-hint" aria-live="polite"></span>
<div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="cancel">Cancel</button><button type="submit" class="fc-btn fc-btn-primary">OK</button></div>`;
    document.getElementById('overlay-root')!.appendChild(form);
    this.hint = form.querySelector<HTMLElement>('.fc-fmt-hint')!;
    this.sugg = form.querySelector<HTMLElement>('.fc-pvt-sugg')!;
    const q = <T extends HTMLElement>(k: string) => form.querySelector<T>(`[data-k="${k}"]`)!;
    form.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-a="cancel"]')) return this.close();
      const s = t.closest<HTMLElement>('[data-sugg]');
      if (s) void this.submit(this.lines[Number(s.dataset.sugg)] ?? null);
    });
    form.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'pvt-dest') {
        q<HTMLInputElement>('dest').disabled = t.value !== 'here';
        if (t.value === 'here') q<HTMLInputElement>('dest').focus();
      }
      if (t.dataset.k === 'src') void this.suggest();
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit(null);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!form.hidden && !form.contains(e.target as Node)) form.hidden = true;
    }, true);
  }

  private close(): void {
    this.form.hidden = true;
    this.done();
  }

  private q(k: string): HTMLInputElement {
    return this.form.querySelector<HTMLInputElement>(`[data-k="${k}"]`)!;
  }

  open(src: string, here: string): void {
    this.q('src').value = src;
    this.q('dest').value = here;
    this.hint.textContent = '';
    this.form.dataset.state = '';
    this.form.hidden = false;
    this.q('src').select();
    void this.suggest();
  }

  private async suggest(): Promise<void> {
    const mine = ++this.stamp;
    let lines: string[] = [];
    try {
      lines = await this.host.suggest(this.q('src').value.trim());
    } catch {
      lines = [];
    }
    if (mine !== this.stamp) return;
    this.lines = lines;
    const defs = lines.map((l) => parsePivot(l));
    reconcile(this.sugg, defs.map((_, i) => String(i)), (k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fc-btn fc-pvt-pick';
      b.dataset.key = k;
      b.dataset.sugg = k;
      return b;
    }, (b, i) => {
      const d = defs[i];
      setText(b, d ? describe(d) : '');
    });
    this.sugg.dataset.empty = defs.length ? '' : '1';
  }

  private async submit(layout: string | null): Promise<void> {
    const src = this.q('src').value.trim();
    if (!src) {
      this.form.dataset.state = 'error';
      this.hint.textContent = 'Type the range or table name that holds your data, such as A1:D20.';
      return;
    }
    const here = this.form.querySelector<HTMLInputElement>('input[name="pvt-dest"][value="here"]')!.checked;
    const dest = here ? this.q('dest').value.trim() : null;
    if (here && !dest) {
      this.form.dataset.state = 'error';
      this.hint.textContent = 'Type the cell where the PivotTable should start, such as H2.';
      return;
    }
    try {
      await this.host.create(src, dest, layout);
      this.close();
    } catch (err) {
      this.form.dataset.state = 'error';
      this.hint.textContent = err instanceof Error ? err.message : 'No PivotTable made';
    }
  }
}
