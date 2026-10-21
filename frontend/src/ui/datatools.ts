import type { Grid, SheetView } from '../grid/grid';
import type { AxisState } from '../grid/axis';
import { colName, parseRef, rangeText, type Range } from '../grid/a1';
import type { Menu, MenuItem } from './menu';

type Val = string | boolean | string[];
type Values = Record<string, Val>;

interface Field {
  k: string;
  label: string;
  kind: 'text' | 'select' | 'check' | 'group' | 'area';
  options?: [string, string][];
}

interface Spec {
  id: string;
  title: string;
  ok: string;
  fields: Field[];
  extra?: [string, string][];
  width?: number;
}

interface Dlg {
  form: HTMLFormElement;
  title: HTMLElement;
  hint: HTMLElement;
  run: ((v: Values, button: string) => Promise<string>) | null;
}

export interface DataCtx {
  grid: Grid;
  menu: Menu;
  status(text: string, error?: boolean): void;
  sheetNames(): string[];
  views(): SheetView[];
  patchView(sheet: number, part: Partial<SheetView>): void;
  workbookId(): string;
  headers(range: Range): Promise<string[]>;
  filterValues(col: number): Promise<{ values: string[]; blanks: boolean }>;
  goTo(sheet: number, row: number, col: number): void;
  tableAt(): { name: string; area: [number, number, number, number]; cols: string[]; types: string[] } | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fieldEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
const unesc = (s: string) => s.replace(/\\(.)/g, (_, ch: string) => (ch === 't' ? '\t' : ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch));

const FUNCS: [string, string][] = [['sum', 'Sum'], ['count', 'Count'], ['average', 'Average'], ['max', 'Max'], ['min', 'Min']];
const SUB_FUNCS: [string, string][] = [['sum', 'Sum'], ['count', 'Count'], ['countnums', 'Count numbers'], ['average', 'Average'], ['max', 'Max'], ['min', 'Min'], ['product', 'Product'], ['stdev', 'StdDev'], ['stdevp', 'StdDevP'], ['var', 'Var'], ['varp', 'VarP']];
const COL_TYPES: [string, string][] = [['', 'Any'], ['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['dropdown', 'Dropdown'], ['checkbox', 'Checkbox']];

const SPECS: Spec[] = [
  { id: 'dedupe', title: 'Remove duplicates', ok: 'Remove duplicates', fields: [{ k: 'range', label: 'Range', kind: 'text' }, { k: 'header', label: 'My data has headers', kind: 'check' }, { k: 'cols', label: 'Columns', kind: 'group' }] },
  {
    id: 'textcols',
    title: 'Text to columns',
    ok: 'Split',
    fields: [
      { k: 'range', label: 'Column to split', kind: 'text' },
      { k: 'mode', label: 'Original data type', kind: 'select', options: [['d', 'Delimited'], ['f', 'Fixed width']] },
      { k: 'delims', label: 'Delimiters', kind: 'group', options: [['\t', 'Tab'], [',', 'Comma'], [';', 'Semicolon'], [' ', 'Space']] },
      { k: 'other', label: 'Other delimiter', kind: 'text' },
      { k: 'consecutive', label: 'Treat consecutive delimiters as one', kind: 'check' },
      { k: 'qualifier', label: 'Text qualifier', kind: 'select', options: [['"', '" (double quote)'], ["'", "' (single quote)"], ['', '(none)']] },
      { k: 'breaks', label: 'Break positions (fixed width, characters, comma separated)', kind: 'text' },
      { k: 'dest', label: 'Destination (first cell)', kind: 'text' },
    ],
  },
  { id: 'cleanup', title: 'Data cleanup', ok: 'Clean up', fields: [{ k: 'range', label: 'Range', kind: 'text' }, { k: 'header', label: 'My data has headers', kind: 'check' }, { k: 'steps', label: 'Suggestions', kind: 'group' }] },
  {
    id: 'consolidate',
    title: 'Consolidate',
    ok: 'Consolidate',
    fields: [
      { k: 'func', label: 'Function', kind: 'select', options: FUNCS },
      { k: 'refs', label: 'References (one per line, e.g. Sheet2!A1:C5)', kind: 'area' },
      { k: 'by', label: 'Combine by', kind: 'select', options: [['pos', 'Position'], ['labels', 'Labels']] },
      { k: 'top', label: 'Top row labels', kind: 'check' },
      { k: 'left', label: 'Left column labels', kind: 'check' },
      { k: 'link', label: 'Create links to source data', kind: 'check' },
      { k: 'dest', label: 'Destination (first cell)', kind: 'text' },
    ],
  },
  {
    id: 'subtotal',
    title: 'Subtotal',
    ok: 'OK',
    extra: [['remove', 'Remove all']],
    fields: [
      { k: 'range', label: 'Range (with header row)', kind: 'text' },
      { k: 'header', label: 'My data has headers', kind: 'check' },
      { k: 'at', label: 'At each change in', kind: 'select' },
      { k: 'func', label: 'Use function', kind: 'select', options: SUB_FUNCS },
      { k: 'cols', label: 'Add subtotal to', kind: 'group' },
      { k: 'replace', label: 'Replace current subtotals', kind: 'check' },
    ],
  },
  {
    id: 'advfilter',
    title: 'Advanced filter',
    ok: 'OK',
    fields: [
      { k: 'action', label: 'Action', kind: 'select', options: [['inplace', 'Filter the list, in place'], ['copy', 'Copy to another location']] },
      { k: 'list', label: 'List range (with headers)', kind: 'text' },
      { k: 'crit', label: 'Criteria range (headers and rows; a formula under a blank header is a formula criterion)', kind: 'text' },
      { k: 'dest', label: 'Copy to (first cell)', kind: 'text' },
      { k: 'unique', label: 'Unique records only', kind: 'check' },
    ],
  },
  { id: 'coltype', title: 'Table column type', ok: 'Set type', fields: [{ k: 'col', label: 'Column', kind: 'select' }, { k: 'type', label: 'Type', kind: 'select', options: COL_TYPES }, { k: 'items', label: 'Dropdown items (comma separated)', kind: 'text' }] },
  {
    id: 'pasteops',
    title: 'Paste special',
    ok: 'Paste',
    fields: [
      { k: 'what', label: 'Paste', kind: 'select', options: [['all', 'All'], ['values', 'Values'], ['formulas', 'Formulas'], ['formats', 'Formats'], ['validation', 'Validation']] },
      { k: 'op', label: 'Operation', kind: 'select', options: [['none', 'None'], ['add', 'Add'], ['subtract', 'Subtract'], ['multiply', 'Multiply'], ['divide', 'Divide']] },
      { k: 'skip', label: 'Skip blanks', kind: 'check' },
      { k: 'transpose', label: 'Transpose', kind: 'check' },
    ],
  },
  { id: 'template', title: 'Save as template', ok: 'Save', fields: [{ k: 'name', label: 'Template name', kind: 'text' }, { k: 'desc', label: 'Description', kind: 'text' }] },
  { id: 'fview', title: 'Save filter view', ok: 'Save', fields: [{ k: 'name', label: 'Name', kind: 'text' }, { k: 'where', label: 'Keep it', kind: 'select', options: [['file', 'In the file, for everyone who opens it'], ['mine', 'For me only, in this browser']] }] },
  { id: 'sview', title: 'Save sheet view', ok: 'Save', fields: [{ k: 'name', label: 'Name', kind: 'text' }] },
  { id: 'totalfn', title: 'Total row formula', ok: 'Set', fields: [{ k: 'formula', label: 'Formula for this total cell (structured references such as [Sales] are allowed)', kind: 'text' }] },
  { id: 'slicer', title: 'Insert slicer', ok: 'Insert', fields: [{ k: 'col', label: 'Column', kind: 'select' }] },
];

function fieldHtml(f: Field): string {
  const k = `data-k="${f.k}"`;
  const label = esc(f.label);
  if (f.kind === 'check') return `<label class="fc-sort-check"><input type="checkbox" ${k}> ${label}</label>`;
  if (f.kind === 'group') return `<div class="fc-dt-group-wrap" data-wrap="${f.k}"><span class="fc-sort-by">${label}</span><div class="fc-dt-group" ${k}></div></div>`;
  if (f.kind === 'select') return `<label class="fc-fmt-label">${label}<select class="fc-fmt-input" ${k}>${(f.options ?? []).map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select></label>`;
  if (f.kind === 'area') return `<label class="fc-fmt-label">${label}<textarea class="fc-fmt-input fc-valid-text" ${k} spellcheck="false"></textarea></label>`;
  return `<label class="fc-fmt-label">${label}<input class="fc-fmt-input" ${k} spellcheck="false" autocomplete="off"></label>`;
}

export class DataTools {
  private readonly dlgs = new Map<string, Dlg>();
  private readonly specs = new Map(SPECS.map((s) => [s.id, s]));
  private find: HTMLFormElement | null = null;
  private findState: { hits: [number, number, number, string][]; at: number } = { hits: [], at: -1 };
  private readonly slicerEls = new Map<string, HTMLElement>();
  private slicerHost: HTMLElement | null = null;

  constructor(private readonly c: DataCtx) {}

  private build(id: string): Dlg {
    const spec = this.specs.get(id)!;
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom fc-pw fc-dt';
    form.hidden = true;
    form.setAttribute('role', 'dialog');
    if (spec.width) form.style.width = `${spec.width}px`;
    const extra = (spec.extra ?? []).map(([a, t]) => `<button type="button" class="fc-btn" data-a="${a}">${esc(t)}</button>`).join('');
    form.innerHTML = `<span class="fc-fmt-title">${esc(spec.title)}</span>${spec.fields.map(fieldHtml).join('')}<span class="fc-fmt-hint" aria-live="polite"></span><div class="fc-csv-actions">${extra}<button type="button" class="fc-btn" data-a="cancel">Cancel</button><button type="submit" class="fc-btn fc-btn-primary" data-a="ok">${esc(spec.ok)}</button></div>`;
    document.getElementById('overlay-root')!.appendChild(form);
    const d: Dlg = { form, title: form.querySelector<HTMLElement>('.fc-fmt-title')!, hint: form.querySelector<HTMLElement>('.fc-fmt-hint')!, run: null };
    const close = () => {
      form.hidden = true;
      this.c.grid.focus();
    };
    const ok = form.querySelector<HTMLButtonElement>('[data-a="ok"]')!;
    const go = (button: string) => {
      if (!d.run) return;
      if (form.dataset.state === 'done') return close();
      d.form.dataset.state = '';
      d.run(this.read(spec, form), button).then(
        (msg) => {
          if (!msg) return close();
          this.c.status(msg);
          d.hint.textContent = msg;
          form.dataset.state = 'done';
          ok.textContent = 'Close';
        },
        (err: unknown) => {
          form.dataset.state = 'error';
          d.hint.textContent = err instanceof Error ? err.message : 'That did not work';
        },
      );
    };
    form.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'cancel') close();
      else if (a && a !== 'ok') go(a);
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      go('ok');
    });
    this.dlgs.set(id, d);
    return d;
  }

  private read(spec: Spec, form: HTMLFormElement): Values {
    const out: Values = {};
    for (const f of spec.fields) {
      const el = form.querySelector<HTMLElement>(`[data-k="${f.k}"]`)!;
      if (f.kind === 'check') out[f.k] = (el as HTMLInputElement).checked;
      else if (f.kind === 'group') out[f.k] = [...el.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
      else out[f.k] = (el as HTMLInputElement).value;
    }
    return out;
  }

  private put(id: string, k: string, v: Val): void {
    const el = this.dlgs.get(id)!.form.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
    if (typeof v === 'boolean') (el as HTMLInputElement).checked = v;
    else if (typeof v === 'string') (el as HTMLInputElement).value = v;
  }

  private options(id: string, k: string, items: [string, string][], on: string[] | 'all' | 'none'): void {
    const el = this.dlgs.get(id)!.form.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
    if (el instanceof HTMLSelectElement) {
      el.replaceChildren(...items.map(([v, t]) => new Option(t, v)));
      return;
    }
    el.replaceChildren(...items.map(([v, t]) => {
      const l = document.createElement('label');
      l.className = 'fc-sort-check';
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.value = v;
      i.checked = on === 'all' || (Array.isArray(on) && on.includes(v));
      l.append(i, ` ${t}`);
      return l;
    }));
  }

  private show(id: string, run: Dlg['run']): void {
    const d = this.dlgs.get(id)!;
    d.run = run;
    d.hint.textContent = '';
    d.form.dataset.state = '';
    const ok = d.form.querySelector<HTMLButtonElement>('[data-a="ok"]')!;
    ok.textContent = this.specs.get([...this.dlgs.entries()].find(([, v]) => v === d)![0])!.ok;
    d.form.hidden = false;
    d.form.querySelector<HTMLElement>('input:not([type=checkbox]), select, textarea')?.focus();
  }

  private prepare(id: string): Dlg {
    return this.dlgs.get(id) ?? this.build(id);
  }

  private async target(): Promise<{ range: Range; header: boolean }> {
    return this.c.grid.sortTarget();
  }

  private colLabels(range: Range, header: boolean, heads: string[]): [string, string][] {
    const out: [string, string][] = [];
    for (let c = range.c0; c <= range.c1; c++) out.push([String(c), header && heads[c - range.c0] ? heads[c - range.c0] : `Column ${colName(c)}`]);
    return out;
  }

  private rangeOf(text: string): Range {
    const r = parseRef(text.replace(/\$/g, ''));
    if (!r) throw new Error('Type a range such as A1:C20.');
    return r;
  }

  private cellOf(text: string): [number, number] | null {
    const r = parseRef(text.replace(/\$/g, ''));
    return r ? [r.r0, r.c0] : null;
  }

  private area(r: Range): string {
    return `${r.r0},${r.c0},${r.r1},${r.c1}`;
  }

  private line(msg: string): string {
    return msg.split('\n', 1)[0];
  }

  async dedupe(): Promise<void> {
    const { range, header } = await this.target();
    const d = this.prepare('dedupe');
    const heads = await this.c.headers(range);
    this.put('dedupe', 'range', rangeText(range));
    this.put('dedupe', 'header', header);
    this.options('dedupe', 'cols', this.colLabels(range, header, heads), 'all');
    d.form.querySelector<HTMLInputElement>('[data-k="header"]')!.onchange = () => {
      const on = d.form.querySelector<HTMLInputElement>('[data-k="header"]')!.checked;
      const keep = [...d.form.querySelectorAll<HTMLInputElement>('[data-k="cols"] input:checked')].map((i) => i.value);
      this.options('dedupe', 'cols', this.colLabels(range, on, heads), keep);
    };
    this.show('dedupe', async (v) => {
      const r = this.rangeOf(v.range as string);
      const cols = (v.cols as string[]).join(',');
      if (!cols) throw new Error('Choose at least one column.');
      const msg = await this.c.grid.runTool('dedupe', this.area(r), v.header ? '1' : '0', cols);
      return this.line(msg);
    });
  }

  async textToColumns(): Promise<void> {
    const sel = this.c.grid.selection();
    const range: Range = sel.r0 === sel.r1 && sel.c0 === sel.c1 ? (await this.target()).range : sel;
    const col: Range = { ...range, c1: range.c0 };
    this.prepare('textcols');
    this.options('textcols', 'delims', [['\t', 'Tab'], [',', 'Comma'], [';', 'Semicolon'], [' ', 'Space']], [',']);
    this.put('textcols', 'range', rangeText(col));
    this.put('textcols', 'mode', 'd');
    this.put('textcols', 'other', '');
    this.put('textcols', 'consecutive', false);
    this.put('textcols', 'qualifier', '"');
    this.put('textcols', 'breaks', '');
    this.put('textcols', 'dest', `${colName(col.c0 + 1)}${col.r0 + 1}`);
    this.show('textcols', async (v) => {
      const r = this.rangeOf(v.range as string);
      const dest = this.cellOf(v.dest as string);
      const fixed = v.mode === 'f';
      const delims = [...(v.delims as string[]), ...((v.other as string) ?? '')].join('');
      const msg = await this.c.grid.runTool('textcols', this.area({ ...r, c1: r.c0 }), fixed ? 'f' : 'd', fixed ? (v.breaks as string) : delims, v.consecutive ? '1' : '0', v.qualifier as string, dest ? `${dest[0]},${dest[1]}` : '');
      return this.line(msg);
    });
  }

  async trim(): Promise<void> {
    const { range } = await this.target();
    const sel = this.c.grid.selection();
    const r = sel.r0 === sel.r1 && sel.c0 === sel.c1 ? range : sel;
    this.c.status(this.line(await this.c.grid.runTool('trim', this.area(r))));
  }

  async cleanup(): Promise<void> {
    const { range, header } = await this.target();
    this.prepare('cleanup');
    this.put('cleanup', 'range', rangeText(range));
    this.put('cleanup', 'header', header);
    const scan = await this.c.grid.runTool('cleanscan', this.area(range), header ? '1' : '0');
    const n = Object.fromEntries(scan.split('\n').slice(1).map((l) => l.split('\t')));
    this.options('cleanup', 'steps', [
      ['trim', `Trim whitespace (${n.trim ?? 0} cells)`],
      ['case', `Fix inconsistent case (${n.case ?? 0} cells)`],
      ['numtext', `Convert text numbers (${n.numtext ?? 0} cells)`],
      ['dups', `Remove duplicate rows (${n.dups ?? 0} rows)`],
    ], ['trim', 'case', 'numtext', 'dups'].filter((k) => Number(n[k] ?? 0) > 0));
    this.show('cleanup', async (v) => {
      const r = this.rangeOf(v.range as string);
      const s = v.steps as string[];
      const f = (k: string) => (s.includes(k) ? '1' : '0');
      return this.line(await this.c.grid.runTool('cleanup', this.area(r), v.header ? '1' : '0', f('trim'), f('dups'), f('case'), f('numtext')));
    });
  }

  private sheetRef(text: string): [number, Range] {
    const names = this.c.sheetNames();
    const m = /^(?:'((?:[^']|'')+)'|([^!']+))!(.+)$/.exec(text.trim());
    let sheet = this.c.grid.sheetIndex;
    let body = text.trim();
    if (m) {
      const name = (m[1] ?? m[2]).replace(/''/g, "'").toLowerCase();
      sheet = names.findIndex((s) => s.toLowerCase() === name);
      if (sheet < 0) throw new Error(`There is no sheet ${m[1] ?? m[2]}.`);
      body = m[3];
    }
    return [sheet, this.rangeOf(body)];
  }

  async consolidate(): Promise<void> {
    const sel = this.c.grid.selection();
    this.prepare('consolidate');
    this.put('consolidate', 'func', 'sum');
    this.put('consolidate', 'refs', '');
    this.put('consolidate', 'by', 'pos');
    this.put('consolidate', 'top', false);
    this.put('consolidate', 'left', false);
    this.put('consolidate', 'link', false);
    this.put('consolidate', 'dest', `${colName(sel.c0)}${sel.r0 + 1}`);
    this.show('consolidate', async (v) => {
      const lines = (v.refs as string).split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) throw new Error('Add at least one reference.');
      const refs = lines.map((l) => {
        const [s, r] = this.sheetRef(l);
        return `${s},${r.r0},${r.c0},${r.r1},${r.c1}`;
      });
      const dest = this.cellOf(v.dest as string);
      if (!dest) throw new Error('Type the destination cell, such as H1.');
      return this.line(await this.c.grid.runTool('consolidate', v.func as string, v.by as string, v.top ? '1' : '0', v.left ? '1' : '0', String(dest[0]), String(dest[1]), refs.join(';'), v.link ? '1' : '0'));
    });
  }

  async subtotal(): Promise<void> {
    const { range, header } = await this.target();
    const d = this.prepare('subtotal');
    const heads = await this.c.headers(range);
    const labels = (h: boolean) => this.colLabels(range, h, heads);
    this.put('subtotal', 'range', rangeText(range));
    this.put('subtotal', 'header', true);
    this.options('subtotal', 'at', labels(true), 'none');
    this.options('subtotal', 'cols', labels(true), []);
    this.put('subtotal', 'func', 'sum');
    this.put('subtotal', 'replace', true);
    void header;
    const sheet = this.c.grid.sheetIndex;
    this.show('subtotal', async (v, button) => {
      const r = this.rangeOf(v.range as string);
      const gc = String(v.at || r.c0);
      let msg: string;
      if (button === 'remove') {
        msg = await this.c.grid.runTool('unsubtotal', this.area(r), v.header ? '1' : '0', gc);
      } else {
        const cols = (v.cols as string[]).join(',');
        if (!cols) throw new Error('Choose the columns to subtotal.');
        msg = await this.c.grid.runTool('subtotal', this.area(r), v.header ? '1' : '0', gc, v.func as string, cols, v.replace ? '1' : '0');
      }
      if (this.c.grid.sheetIndex === sheet) {
        const rows = msg.split('\n').slice(1).map((l) => l.split('\t'));
        const clear = rows.find((p) => p[0] === 'clear');
        const groups = rows.filter((p) => p[0] === 'g').map((p) => [Number(p[1]), Number(p[2])] as [number, number]);
        this.c.grid.outlineRows(groups, clear ? [Number(clear[1]), Number(clear[2])] : null);
      }
      return this.line(msg);
    });
    d.form.querySelector<HTMLInputElement>('[data-k="header"]')!.onchange = () => {
      const on = d.form.querySelector<HTMLInputElement>('[data-k="header"]')!.checked;
      const keep = [...d.form.querySelectorAll<HTMLInputElement>('[data-k="cols"] input:checked')].map((i) => i.value);
      this.options('subtotal', 'cols', labels(on), keep);
    };
  }

  async advancedFilter(): Promise<void> {
    const { range } = await this.target();
    this.prepare('advfilter');
    this.put('advfilter', 'action', 'inplace');
    this.put('advfilter', 'list', rangeText(range));
    this.put('advfilter', 'crit', '');
    this.put('advfilter', 'dest', '');
    this.put('advfilter', 'unique', false);
    this.show('advfilter', async (v) => {
      const list = this.rangeOf(v.list as string);
      const crit = this.rangeOf(v.crit as string);
      const copy = v.action === 'copy';
      const dest = this.cellOf(v.dest as string);
      if (copy && !dest) throw new Error('Type the cell to copy the results to.');
      return this.line(await this.c.grid.runTool('advfilter', this.area(list), this.area(crit), copy ? 'copy' : 'inplace', dest ? `${dest[0]},${dest[1]}` : '', v.unique ? '1' : '0'));
    });
  }

  async flashFill(): Promise<void> {
    const g = this.c.grid;
    const sel = g.selection();
    try {
      this.c.status(this.line(await g.runTool('flash', String(sel.r0), String(sel.c0))));
    } catch (err) {
      this.c.status(err instanceof Error ? err.message : 'Flash Fill failed', true);
    }
  }

  async checkboxes(on: boolean): Promise<void> {
    const s = this.c.grid.selection();
    this.c.status(this.line(await this.c.grid.runTool('checkbox', this.area(s), on ? '1' : '0')));
  }

  async columnType(): Promise<void> {
    const t = this.c.tableAt();
    if (!t) {
      this.c.status('Select a cell inside a table first.', true);
      return;
    }
    const d = this.prepare('coltype');
    this.options('coltype', 'col', t.cols.map((n, i) => [String(i), n || `Column ${i + 1}`]), 'none');
    const sync = () => {
      const i = Number(d.form.querySelector<HTMLSelectElement>('[data-k="col"]')!.value);
      const cur = t.types[i] ?? '';
      const [base, rest] = [cur.split(':')[0], cur.split(':').slice(1).join(':')];
      this.put('coltype', 'type', base);
      this.put('coltype', 'items', rest.replace(/\|/g, ', '));
    };
    const sel = this.c.grid.selection();
    this.put('coltype', 'col', String(Math.max(0, Math.min(t.cols.length - 1, sel.c0 - t.area[1]))));
    sync();
    d.form.querySelector<HTMLSelectElement>('[data-k="col"]')!.onchange = sync;
    this.show('coltype', async (v) => {
      const type = v.type as string;
      const items = (v.items as string).split(',').map((s) => s.trim()).filter(Boolean).join('|');
      if (type === 'dropdown' && !items) throw new Error('Type the dropdown items.');
      await this.c.grid.runTool('tabletype', t.name, v.col as string, type === 'dropdown' ? `dropdown:${items}` : type);
      return 'Column type saved.';
    });
  }

  async pasteOps(): Promise<void> {
    if (!this.c.grid.canPasteSpecial()) {
      this.c.status('Copy cells in FormCel first.', true);
      return;
    }
    this.prepare('pasteops');
    this.put('pasteops', 'what', 'all');
    this.put('pasteops', 'op', 'none');
    this.put('pasteops', 'skip', false);
    this.put('pasteops', 'transpose', false);
    this.show('pasteops', async (v) => this.line(await this.c.grid.pasteWith(v.what as string, v.op as string, v.skip as boolean, v.transpose as boolean)));
  }

  askTemplate(save: (name: string, desc: string) => Promise<string>, title: string): void {
    this.prepare('template');
    this.put('template', 'name', title);
    this.put('template', 'desc', '');
    this.show('template', async (v) => {
      if (!(v.name as string).trim()) throw new Error('Give the template a name.');
      return save((v.name as string).trim(), v.desc as string);
    });
  }

  customTotal(initial: string): void {
    this.prepare('totalfn');
    this.put('totalfn', 'formula', initial);
    this.show('totalfn', async (v) => {
      const f = (v.formula as string).trim();
      if (!f) throw new Error('Type a formula.');
      await this.c.grid.setActive(f.startsWith('=') ? f : `=${f}`);
      return '';
    });
  }

  private views(): { name: string; text: string }[] {
    return this.c.views()[this.c.grid.sheetIndex]?.fviews ?? [];
  }

  private readonly temp = new Map<number, { text: string; rows: AxisState; cols: AxisState; label: string }>();
  private bar: HTMLElement | null = null;

  private mineKey(): string {
    return `fc.fviews:${this.c.workbookId()}:${this.c.sheetNames()[this.c.grid.sheetIndex] ?? ''}`;
  }

  private mine(): { name: string; text: string }[] {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(this.mineKey()) ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is { name: string; text: string } => typeof x?.name === 'string' && typeof x?.text === 'string') : [];
    } catch {
      return [];
    }
  }

  private keepMine(list: { name: string; text: string }[]): void {
    try {
      localStorage.setItem(this.mineKey(), JSON.stringify(list));
    } catch {
      this.c.status('This browser would not keep the view.', true);
    }
  }

  isTemp(sheet: number): boolean {
    return this.temp.has(sheet);
  }

  resetTemp(): void {
    this.temp.clear();
    this.syncBar();
  }

  private syncBar(): void {
    const t = this.temp.get(this.c.grid.sheetIndex);
    if (!t) {
      if (this.bar) this.bar.hidden = true;
      return;
    }
    if (!this.bar) {
      const bar = document.createElement('div');
      bar.className = 'fc-viewbar';
      bar.setAttribute('role', 'status');
      bar.innerHTML = '<span class="fc-viewbar-text"></span><button type="button" class="fc-btn" data-a="exit">Exit view</button>';
      bar.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('[data-a="exit"]')) void this.exitTemp();
      });
      document.getElementById('overlay-root')!.appendChild(bar);
      this.bar = bar;
    }
    this.bar.querySelector<HTMLElement>('.fc-viewbar-text')!.textContent = `${t.label}: your own view of this sheet, not saved and not seen by anyone else.`;
    this.bar.hidden = false;
  }

  private baseText(): string {
    return (this.c.grid.filterInfo()?.text ?? '').split('\n').filter((l) => !l.startsWith('hidden\t')).join('\n');
  }

  private async startTemp(label: string, text: string | null, axes?: { rows: AxisState; cols: AxisState }): Promise<void> {
    const g = this.c.grid;
    const sheet = g.sheetIndex;
    if (!this.temp.has(sheet)) this.temp.set(sheet, { text: this.baseText(), ...g.axes(), label });
    else this.temp.get(sheet)!.label = label;
    if (text !== null) await g.setFilter(text);
    if (axes) g.applyAxes(axes.rows, axes.cols);
    this.syncBar();
  }

  async exitTemp(): Promise<void> {
    const g = this.c.grid;
    const sheet = g.sheetIndex;
    const t = this.temp.get(sheet);
    if (!t) return;
    this.temp.delete(sheet);
    await g.setFilter(t.text);
    g.applyAxes(t.rows, t.cols);
    this.syncBar();
    this.c.status('Back to the shared view.');
  }

  private linkOf(text: string): string {
    const payload = JSON.stringify({ s: this.c.sheetNames()[this.c.grid.sheetIndex] ?? '', t: text });
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(payload))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${location.origin}${location.pathname}?view=${b64}${location.hash}`;
  }

  private async copyLink(text: string): Promise<void> {
    const link = this.linkOf(text);
    try {
      await navigator.clipboard.writeText(link);
      this.c.status('Link to the view copied.');
    } catch {
      this.c.status('Copy was blocked; the link is in the address bar.', true);
      history.replaceState(null, '', link);
    }
  }

  async openLink(showSheet: (i: number) => void): Promise<void> {
    const raw = new URLSearchParams(location.search).get('view');
    if (!raw) return;
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
    try {
      const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
      const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))) as { s?: string; t?: string };
      const i = this.c.sheetNames().indexOf(data.s ?? '');
      if (i < 0 || typeof data.t !== 'string') throw new Error('bad');
      if (i !== this.c.grid.sheetIndex) showSheet(i);
      await new Promise((r) => window.setTimeout(r, 200));
      await this.startTemp('Shared view', data.t);
    } catch {
      this.c.status('The link to a view could not be read.', true);
    }
  }

  filterViewsMenu(x: number, y: number): void {
    const g = this.c.grid;
    const sheet = g.sheetIndex;
    const list = this.views();
    const mine = this.mine();
    const items: MenuItem[] = [{ label: 'Start a temporary view', run: () => this.startTemp('Temporary view', null) }, { label: 'Save current filter as a view', run: () => this.saveView() }];
    if (list.length || mine.length) items.push({ sep: true });
    for (const v of list) items.push({ label: `Open view: ${v.name}`, run: () => this.startTemp(v.name, v.text) });
    for (const v of mine) items.push({ label: `Open my view: ${v.name}`, run: () => this.startTemp(v.name, v.text) });
    if (list.length || mine.length) {
      items.push({ sep: true });
      for (const v of [...list, ...mine]) items.push({ label: `Copy link to view: ${v.name}`, run: () => this.copyLink(v.text) });
      for (const v of list) items.push({ label: `Delete view: ${v.name}`, danger: true, run: () => this.c.patchView(sheet, { fviews: this.views().filter((o) => o.name !== v.name) }) });
      for (const v of mine) items.push({ label: `Delete my view: ${v.name}`, danger: true, run: () => this.keepMine(this.mine().filter((o) => o.name !== v.name)) });
    }
    const sv = this.c.views()[sheet]?.sviews ?? [];
    items.push({ sep: true }, { label: 'Sheet view: Default', run: () => this.startTemp('Default view', '', this.openAxes()) });
    for (const v of sv) items.push({ label: `Sheet view: ${v.name}`, run: () => this.startTemp(v.name, v.text, { rows: v.rows, cols: v.cols }) });
    items.push({ label: 'Save current layout as a sheet view', run: () => this.saveSheetView() });
    for (const v of sv) items.push({ label: `Delete sheet view: ${v.name}`, danger: true, run: () => this.c.patchView(sheet, { sviews: (this.c.views()[sheet]?.sviews ?? []).filter((o) => o.name !== v.name) }) });
    items.push({ sep: true }, { label: this.temp.has(sheet) ? 'Exit view' : 'Clear filter', run: () => (this.temp.has(sheet) ? this.exitTemp() : g.setFilter('')) });
    this.c.menu.show(x, y, items);
  }

  private openAxes(): { rows: AxisState; cols: AxisState } {
    const a = this.c.grid.axes();
    return { rows: { ...a.rows, hidden: [] }, cols: { ...a.cols, hidden: [] } };
  }

  private saveSheetView(): void {
    const g = this.c.grid;
    const sheet = g.sheetIndex;
    const text = this.baseText();
    const axes = g.axes();
    this.prepare('sview');
    this.put('sview', 'name', `View ${(this.c.views()[sheet]?.sviews ?? []).length + 1}`);
    this.show('sview', async (v) => {
      const name = (v.name as string).trim();
      if (!name) throw new Error('Give the view a name.');
      const old = this.c.views()[sheet]?.sviews ?? [];
      this.c.patchView(sheet, { sviews: [...old.filter((o) => o.name !== name), { name, text, rows: axes.rows, cols: axes.cols }] });
      return `Saved sheet view ${name}.`;
    });
  }

  private saveView(): void {
    const info = this.c.grid.filterInfo();
    if (!info) {
      this.c.status('Turn on a filter and choose values first.', true);
      return;
    }
    const sheet = this.c.grid.sheetIndex;
    this.prepare('fview');
    this.put('fview', 'name', `Filter view ${this.views().length + this.mine().length + 1}`);
    this.put('fview', 'where', 'file');
    this.show('fview', async (v) => {
      const name = (v.name as string).trim();
      if (!name) throw new Error('Give the view a name.');
      const text = info.text.split('\n').filter((l) => !l.startsWith('hidden\t')).join('\n');
      if (v.where === 'mine') {
        this.keepMine([...this.mine().filter((o) => o.name !== name), { name, text }]);
        return `Saved filter view ${name} for you in this browser.`;
      }
      this.c.patchView(sheet, { fviews: [...this.views().filter((o) => o.name !== name), { name, text }] });
      return `Saved filter view ${name} in the file.`;
    });
  }

  insertSlicer(): void {
    const info = this.c.grid.filterInfo();
    if (!info) {
      this.c.status('Turn on filter buttons for the data first (Filter or a table).', true);
      return;
    }
    const sheet = this.c.grid.sheetIndex;
    this.prepare('slicer');
    this.c.headers({ r0: info.area.r0, c0: info.area.c0, r1: info.area.r0, c1: info.area.c1 }).then((heads) => {
      this.options('slicer', 'col', heads.map((h, i) => [String(info.area.c0 + i), h || `Column ${colName(info.area.c0 + i)}`]), 'none');
      this.put('slicer', 'col', String(Math.max(info.area.c0, Math.min(info.area.c1, this.c.grid.selection().c0))));
      this.show('slicer', async (v) => {
        const col = Number(v.col);
        const title = heads[col - info.area.c0] || `Column ${colName(col)}`;
        const list = this.c.views()[sheet]?.slicers ?? [];
        this.c.patchView(sheet, { slicers: [...list, { id: Math.random().toString(36).slice(2, 9), col, title, x: 120 + list.length * 24, y: 150 + list.length * 24 }] });
        this.syncSlicers();
        return `Slicer added for ${title}.`;
      });
    }, () => undefined);
  }

  private host(): HTMLElement {
    if (!this.slicerHost) {
      this.slicerHost = document.createElement('div');
      this.slicerHost.className = 'fc-slicers';
      document.getElementById('overlay-root')!.appendChild(this.slicerHost);
    }
    return this.slicerHost;
  }

  syncSlicers(): void {
    this.syncBar();
    const sheet = this.c.grid.sheetIndex;
    const list = this.c.views()[sheet]?.slicers ?? [];
    const keep = new Set(list.map((s) => s.id));
    for (const [id, el] of this.slicerEls) {
      if (!keep.has(id)) {
        el.remove();
        this.slicerEls.delete(id);
      }
    }
    for (const s of list) {
      let el = this.slicerEls.get(s.id);
      if (!el) {
        el = this.makeSlicer(s.id);
        this.slicerEls.set(s.id, el);
        this.host().appendChild(el);
      }
      el.style.left = `${s.x}px`;
      el.style.top = `${s.y}px`;
      el.querySelector<HTMLElement>('.fc-slicer-title')!.textContent = s.title;
      el.dataset.col = String(s.col);
      el.hidden = false;
    }
    void this.refreshSlicers();
  }

  hideSlicers(): void {
    for (const el of this.slicerEls.values()) el.hidden = true;
  }

  private makeSlicer(id: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'fc-slicer';
    el.dataset.id = id;
    el.innerHTML = `<div class="fc-slicer-head"><span class="fc-slicer-title"></span><button type="button" class="fc-tool" data-a="clear" title="Clear filter" aria-label="Clear filter">&times;</button><button type="button" class="fc-tool" data-a="drop" title="Delete slicer" aria-label="Delete slicer">Delete</button></div><div class="fc-slicer-list"></div>`;
    const head = el.querySelector<HTMLElement>('.fc-slicer-head')!;
    head.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const sx = e.clientX - el.offsetLeft;
      const sy = e.clientY - el.offsetTop;
      head.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => {
        el.style.left = `${Math.max(0, m.clientX - sx)}px`;
        el.style.top = `${Math.max(0, m.clientY - sy)}px`;
      };
      const up = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        const sheet = this.c.grid.sheetIndex;
        const list = (this.c.views()[sheet]?.slicers ?? []).map((s) => (s.id === id ? { ...s, x: el.offsetLeft, y: el.offsetTop } : s));
        this.c.patchView(sheet, { slicers: list });
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      const col = Number(el.dataset.col);
      if (a === 'drop') {
        const sheet = this.c.grid.sheetIndex;
        this.c.patchView(sheet, { slicers: (this.c.views()[sheet]?.slicers ?? []).filter((s) => s.id !== id) });
        this.syncSlicers();
      } else if (a === 'clear') void this.slicerSet(col, null);
      else if (t.closest('.fc-slicer-item')) void this.slicerToggle(col, (t.closest('.fc-slicer-item') as HTMLElement).dataset.v ?? '');
    });
    return el;
  }

  private current(col: number): { on: boolean; keep: string[]; blanks: boolean } {
    const info = this.c.grid.filterInfo();
    const p = info?.cols.get(col);
    if (p?.[0] === 'values') return { on: true, blanks: p[1] === '1', keep: p.slice(2) };
    return { on: false, blanks: true, keep: [] };
  }

  private async slicerToggle(col: number, v: string): Promise<void> {
    const cur = this.current(col);
    const all = (await this.c.filterValues(col)).values;
    const keep = new Set(cur.on ? cur.keep.map((s) => s.toLowerCase()) : []);
    const k = v.toLowerCase();
    if (!cur.on) keep.add(k);
    else if (keep.has(k)) keep.delete(k);
    else keep.add(k);
    const kept = all.filter((a) => keep.has(a.toLowerCase()));
    await this.slicerSet(col, kept.length === 0 || kept.length === all.length ? null : kept);
  }

  private async slicerSet(col: number, keep: string[] | null): Promise<void> {
    const info = this.c.grid.filterInfo();
    if (!info) return;
    const a = info.area;
    let text = `area\t${a.r0},${a.c0},${a.r1},${a.c1}\n`;
    for (const [c, p] of info.cols) if (c !== col) text += `col\t${c}\t${p.map(fieldEsc).join('\t')}\n`;
    if (keep) text += `col\t${col}\t${['values', '0', ...keep].map(fieldEsc).join('\t')}\n`;
    await this.c.grid.setFilter(text);
    await this.refreshSlicers();
  }

  async refreshSlicers(): Promise<void> {
    for (const el of this.slicerEls.values()) {
      if (el.hidden) continue;
      const col = Number(el.dataset.col);
      const { values } = await this.c.filterValues(col).catch(() => ({ values: [] as string[] }));
      const cur = this.current(col);
      const keep = new Set(cur.keep.map((s) => s.toLowerCase()));
      const list = el.querySelector<HTMLElement>('.fc-slicer-list')!;
      const have = [...list.children] as HTMLButtonElement[];
      values.forEach((v, i) => {
        let b = have[i];
        if (!b) {
          b = document.createElement('button');
          b.type = 'button';
          b.className = 'fc-slicer-item';
          list.appendChild(b);
        }
        if (b.dataset.v !== v) {
          b.dataset.v = v;
          b.textContent = v;
        }
        b.setAttribute('aria-pressed', String(cur.on && keep.has(v.toLowerCase())));
      });
      for (const b of have.slice(values.length)) b.remove();
    }
  }

  openFind(replace: boolean): void {
    const f = this.find ?? this.makeFind();
    const sel = this.c.grid.selection();
    const q = f.querySelector<HTMLInputElement>('[data-k="q"]')!;
    f.hidden = false;
    (replace && q.value ? f.querySelector<HTMLInputElement>('[data-k="r"]')! : q).focus();
    q.select();
    f.dataset.sel = sel.r0 === sel.r1 && sel.c0 === sel.c1 ? '' : this.area(sel);
  }

  private makeFind(): HTMLFormElement {
    const f = document.createElement('form');
    f.className = 'fc-fmt-custom fc-find';
    f.setAttribute('role', 'dialog');
    f.hidden = true;
    f.innerHTML = `<span class="fc-fmt-title">Find and replace</span>
<label class="fc-fmt-label">Find<input class="fc-fmt-input" data-k="q" spellcheck="false" autocomplete="off"></label>
<label class="fc-fmt-label" data-wrap="replace">Replace with<input class="fc-fmt-input" data-k="r" spellcheck="false" autocomplete="off"></label>
<div class="fc-dt-row"><label class="fc-sort-check"><input type="checkbox" data-k="case"> Match case</label><label class="fc-sort-check"><input type="checkbox" data-k="entire"> Match entire cell contents</label></div>
<div class="fc-dt-row"><label class="fc-fmt-label">Look in<select class="fc-fmt-input" data-k="look"><option value="values">Values</option><option value="formulas">Formulas</option></select></label><label class="fc-fmt-label">Within<select class="fc-fmt-input" data-k="within"><option value="sheet">Sheet</option><option value="book">Workbook</option></select></label></div>
<span class="fc-fmt-hint" aria-live="polite"></span>
<div class="fc-find-list" role="listbox" aria-label="Matches"></div>
<div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="all">Find all</button><button type="button" class="fc-btn" data-a="next">Find next</button><button type="button" class="fc-btn" data-a="one">Replace</button><button type="button" class="fc-btn" data-a="every">Replace all</button><button type="button" class="fc-btn" data-a="close">Close</button></div>`;
    document.getElementById('overlay-root')!.appendChild(f);
    const hint = f.querySelector<HTMLElement>('.fc-fmt-hint')!;
    const list = f.querySelector<HTMLElement>('.fc-find-list')!;
    const v = (k: string) => f.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-k="${k}"]`)!;
    const chk = (k: string) => ((v(k) as HTMLInputElement).checked ? '1' : '0');
    const names = () => this.c.sheetNames();
    const base = (mode: string, one = '') => ['find', v('q').value, v('r').value, chk('case'), chk('entire'), v('look').value === 'formulas' ? '1' : '0', v('within').value === 'book' ? '1' : '0', mode, v('within').value === 'sheet' ? f.dataset.sel ?? '' : '', one];
    const scan = async () => {
      if (!v('q').value) return;
      const msg = await this.c.grid.runTool(...base('find'));
      const rows = msg.split('\n');
      const hits = rows.slice(1).filter(Boolean).map((l) => l.split('\t')).map((p) => [Number(p[0]), Number(p[1]), Number(p[2]), unesc(p[3] ?? '')] as [number, number, number, string]);
      this.findState = { hits, at: -1 };
      hint.textContent = `${hits.length} found`;
      list.replaceChildren(...hits.slice(0, 300).map((h, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'fc-find-item';
        b.dataset.i = String(i);
        b.textContent = `${names()[h[0]] ?? ''}!${colName(h[2])}${h[1] + 1}  ${h[3]}`;
        return b;
      }));
    };
    const visit = (i: number) => {
      const hs = this.findState.hits;
      if (!hs.length) return;
      this.findState.at = ((i % hs.length) + hs.length) % hs.length;
      const [s, r, c] = hs[this.findState.at];
      this.c.goTo(s, r, c);
      for (const b of list.children) b.setAttribute('aria-selected', String((b as HTMLElement).dataset.i === String(this.findState.at)));
    };
    const guard = (fn: () => Promise<void>) => fn().catch((err: unknown) => {
      hint.textContent = err instanceof Error ? err.message : 'That did not work';
    });
    f.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const item = t.closest<HTMLElement>('.fc-find-item');
      if (item) return visit(Number(item.dataset.i));
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'close') {
        f.hidden = true;
        this.c.grid.focus();
      } else if (a === 'all') void guard(async () => scan());
      else if (a === 'next') void guard(async () => {
        if (this.findState.at < 0 || !this.findState.hits.length) await scan();
        visit(this.findState.at + 1);
      });
      else if (a === 'one') void guard(async () => {
        if (this.findState.at < 0) {
          await scan();
          visit(0);
          return;
        }
        const [s, r, c] = this.findState.hits[this.findState.at];
        await this.c.grid.runTool(...base('replace', `${s},${r},${c}`));
        await scan();
        visit(Math.max(0, this.findState.at));
      });
      else if (a === 'every') void guard(async () => {
        const msg = await this.c.grid.runTool(...base('replaceall'));
        this.findState = { hits: [], at: -1 };
        list.replaceChildren();
        hint.textContent = this.line(msg);
        this.c.status(this.line(msg));
      });
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      void guard(async () => {
        if (!this.findState.hits.length || this.findState.at < 0) await scan();
        visit(this.findState.at + 1);
      });
    });
    f.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        f.hidden = true;
        this.c.grid.focus();
      }
    });
    f.addEventListener('input', () => {
      this.findState = { hits: [], at: -1 };
    });
    return f;
  }
}
