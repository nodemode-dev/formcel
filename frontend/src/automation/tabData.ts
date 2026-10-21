import { engine } from '../engine';
import { colName, parseRef } from '../grid/a1';
import { api, el, esc, setText } from './dom';
import { uid, type Env, type Query, type Step } from './model';
import { PictureImport } from './picture';

interface QueryResult {
  columns: string[];
  rows: string[][];
}

const STEPS: Record<string, { label: string; fields: [string, string, string][] }> = {
  promote_headers: { label: 'Use first row as headers', fields: [] },
  demote_headers: { label: 'Use headers as first row', fields: [] },
  remove_columns: { label: 'Remove columns', fields: [['columns', 'Columns (comma separated)', 'text']] },
  keep_columns: { label: 'Keep columns', fields: [['columns', 'Columns (comma separated)', 'text']] },
  rename: { label: 'Rename column', fields: [['from', 'Column', 'text'], ['to', 'New name', 'text']] },
  filter: { label: 'Filter rows', fields: [['column', 'Column', 'text'], ['cmp', 'Is', 'cmp'], ['value', 'Value', 'text']] },
  change_type: { label: 'Change type', fields: [['column', 'Column', 'text'], ['type', 'To', 'type']] },
  sort: { label: 'Sort rows', fields: [['column', 'Column', 'text'], ['desc', 'Descending', 'check']] },
  group: { label: 'Group by', fields: [['by', 'Group columns (comma separated)', 'text'], ['agg', 'Aggregate', 'agg'], ['column', 'Of column', 'text'], ['as', 'Result name', 'text']] },
  remove_duplicates: { label: 'Remove duplicate rows', fields: [] },
  top: { label: 'Keep top rows', fields: [['n', 'How many', 'num']] },
  skip: { label: 'Remove top rows', fields: [['n', 'How many', 'num']] },
  split_column: { label: 'Split column', fields: [['column', 'Column', 'text'], ['delimiter', 'Delimiter (use \\t for a tab)', 'text'], ['length', 'Or every N characters', 'num'], ['max', 'At most this many parts', 'num']] },
  merge_columns: { label: 'Merge columns', fields: [['columns', 'Columns (comma separated)', 'text'], ['separator', 'Separator', 'text'], ['as', 'Result name', 'text']] },
  fill_down: { label: 'Fill down', fields: [['columns', 'Columns (empty for all)', 'text']] },
  fill_up: { label: 'Fill up', fields: [['columns', 'Columns (empty for all)', 'text']] },
  replace_values: { label: 'Replace values', fields: [['column', 'Column (empty for all)', 'text'], ['find', 'Find', 'text'], ['with', 'Replace with', 'text'], ['whole', 'Whole value only', 'check']] },
  text_transform: { label: 'Format text', fields: [['column', 'Column (empty for all)', 'text'], ['how', 'Make it', 'how']] },
  unpivot: { label: 'Unpivot columns', fields: [['keep', 'Columns to keep (comma separated)', 'text'], ['attribute', 'Name column', 'text'], ['value', 'Value column', 'text']] },
  pivot: { label: 'Pivot column', fields: [['column', 'Column whose values become headers', 'text'], ['values', 'Values column', 'text'], ['agg', 'Combine with', 'agg2']] },
  add_column: { label: 'Add custom column', fields: [['as', 'New column name', 'text'], ['expression', 'Expression, such as [Price] * [Qty] or Text.Upper([Name])', 'text']] },
  date_part: { label: 'Add date part', fields: [['column', 'Date column', 'text'], ['part', 'Part', 'part'], ['as', 'New column name', 'text']] },
  add_index: { label: 'Add index column', fields: [['start', 'Start at', 'num'], ['as', 'Name', 'text']] },
  reorder: { label: 'Choose column order', fields: [['columns', 'Columns first (comma separated)', 'text']] },
  transpose: { label: 'Transpose', fields: [] },
  remove_blank_rows: { label: 'Remove blank rows', fields: [] },
  append: { label: 'Append query', fields: [['query', 'Rows from', 'query']] },
  merge: { label: 'Merge with query', fields: [['query', 'Merge with', 'query'], ['left', 'Match columns here (comma separated)', 'text'], ['right', 'Match columns there (comma separated)', 'text'], ['join', 'Join', 'join']] },
};

const SELECTS: Record<string, [string, string][]> = {
  how: [['trim', 'Trimmed'], ['clean', 'Cleaned of unprintable characters'], ['upper', 'UPPERCASE'], ['lower', 'lowercase'], ['proper', 'Proper Case']],
  agg2: [['sum', 'Sum'], ['count', 'Count'], ['average', 'Average'], ['min', 'Minimum'], ['max', 'Maximum'], ['first', 'First value']],
  part: [['year', 'Year'], ['month', 'Month'], ['day', 'Day'], ['quarter', 'Quarter'], ['weekday', 'Day of week'], ['monthname', 'Month name']],
  join: [['left', 'Left outer (all rows here)'], ['inner', 'Inner (only matches)'], ['right', 'Right outer (all rows there)'], ['full', 'Full outer'], ['leftanti', 'Left anti (no match there)']],
};
const LISTS = ['columns', 'by', 'keep', 'left', 'right'];

const CMP: [string, string][] = [['=', 'equal to'], ['<>', 'not equal to'], ['>', 'greater than'], ['>=', 'greater than or equal to'], ['<', 'less than'], ['<=', 'less than or equal to'], ['contains', 'containing'], ['notcontains', 'not containing'], ['begins', 'beginning with'], ['ends', 'ending with'], ['blank', 'blank'], ['notblank', 'not blank']];
const TYPES: [string, string][] = [['number', 'Number'], ['text', 'Text'], ['date', 'Date'], ['logical', 'True or false']];
const AGGS: [string, string][] = [['count', 'Count rows'], ['sum', 'Sum'], ['average', 'Average'], ['min', 'Minimum'], ['max', 'Maximum']];

export class DataTab {
  readonly root = el('div', 'fc-auto-pane');
  private readonly saved: HTMLElement;
  private readonly web: HTMLElement;
  private readonly ed: HTMLElement;
  private readonly stepsEl: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly pic: PictureImport;
  private editing: Query | null = null;
  private timer = 0;

  constructor(private readonly env: Env) {
    this.root.innerHTML = `
      <h3 class="fc-auto-h">From the web</h3>
      <div class="fc-auto-row"><input class="fc-auto-input fc-grow" data-f="weburl" placeholder="https://example.com/page" aria-label="Web page address" spellcheck="false" autocomplete="off"><button type="button" class="fc-btn" data-a="find">Find tables</button></div>
      <div class="fc-auto-list" data-l="web"></div>
      <h3 class="fc-auto-h">Queries</h3>
      <div class="fc-auto-list" data-l="saved"></div>
      <div class="fc-auto-row"><button type="button" class="fc-btn" data-a="newq">New query</button><button type="button" class="fc-btn" data-a="refresh-all">Refresh web functions</button></div>
      <p class="fc-auto-hint fc-dmsg" aria-live="polite"></p>
      <form class="fc-qed" hidden>
        <input class="fc-auto-input" data-f="name" aria-label="Query name" placeholder="Query name" spellcheck="false" autocomplete="off">
        <label>Source<select class="fc-auto-input" data-f="kind"><option value="csv">CSV from an address</option><option value="text">CSV pasted here</option><option value="json">JSON from an address</option><option value="html">Table from a web page</option><option value="sheet">Range of this workbook</option><option value="excel">Excel, FormCel or CSV file</option><option value="folder">Folder of files (combine)</option><option value="sqlite">SQLite database (SELECT)</option><option value="postgres">PostgreSQL (SELECT)</option><option value="mysql">MySQL (SELECT)</option></select></label>
        <div class="fc-qsrc" data-k="csv json html"><input class="fc-auto-input" data-f="url" placeholder="Address" spellcheck="false"></div>
        <div class="fc-qsrc" data-k="html"><input class="fc-auto-input" data-f="table" type="number" min="1" placeholder="Table number (1 is the first)"></div>
        <div class="fc-qsrc" data-k="text"><textarea class="fc-auto-input" data-f="text" rows="4" placeholder="Paste CSV"></textarea></div>
        <div class="fc-qsrc" data-k="sheet"><input class="fc-auto-input" data-f="range" placeholder="Sheet1!A1:D20 (empty for the whole used range)" spellcheck="false"></div>
        <div class="fc-qsrc" data-k="excel"><input class="fc-auto-input" data-f="xpath" placeholder="/path/to/Book.xlsx, .xls, .fcel or .csv" spellcheck="false"><input class="fc-auto-input" data-f="sheet" placeholder="Sheet name (empty for the first)" spellcheck="false"><input class="fc-auto-input" data-f="xrange" placeholder="Range such as A1:D50 (empty for all)" spellcheck="false"></div>
        <div class="fc-qsrc" data-k="folder"><input class="fc-auto-input" data-f="fpath" placeholder="/path/to/folder" spellcheck="false"><input class="fc-auto-input" data-f="pattern" placeholder="File name pattern, such as sales-*.xlsx" spellcheck="false"><label><input type="checkbox" data-f="subfolders"> Include subfolders</label><label><input type="checkbox" data-f="flist"> List the files instead of combining them</label></div>
        <div class="fc-qsrc" data-k="sqlite"><input class="fc-auto-input" data-f="path" placeholder="/path/to/file.db" spellcheck="false"></div>
        <div class="fc-qsrc" data-k="postgres mysql"><div class="fc-auto-row"><input class="fc-auto-input fc-grow" data-f="host" placeholder="Server" spellcheck="false"><input class="fc-auto-num" data-f="port" type="number" min="1" placeholder="Port"></div><div class="fc-auto-row"><input class="fc-auto-input fc-grow" data-f="user" placeholder="User" spellcheck="false" autocomplete="off"><input class="fc-auto-input fc-grow" data-f="password" type="password" placeholder="Password" autocomplete="off"></div><input class="fc-auto-input" data-f="database" placeholder="Database" spellcheck="false"><p class="fc-auto-hint">The password is saved inside this workbook's automation data. Use a read-only account.</p></div>
        <div class="fc-qsrc" data-k="sqlite postgres mysql"><div class="fc-auto-row"><button type="button" class="fc-btn" data-a="schema">Show tables</button></div><div class="fc-auto-list fc-dbtables"></div><textarea class="fc-auto-input" data-f="sql" rows="4" placeholder="SELECT * FROM table" spellcheck="false"></textarea></div>
        <div class="fc-auto-h">Steps</div>
        <div class="fc-qsteps"></div>
        <div class="fc-auto-row"><select class="fc-auto-input fc-grow" data-f="addstep"><option value="">Add a step</option>${Object.entries(STEPS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></div>
        <div class="fc-auto-row fc-auto-small"><label>Load into <input class="fc-auto-input fc-auto-short" data-f="tsheet" placeholder="Sheet name"></label><label>at <input class="fc-auto-input fc-auto-short" data-f="tcell" placeholder="A1"></label><label>refresh every <input class="fc-auto-num" type="number" min="0" data-f="every"> min</label><label>or daily at <input class="fc-auto-input fc-auto-short" data-f="daily" placeholder="HH:MM" maxlength="5"></label></div>
        <div class="fc-auto-row fc-auto-small"><label><input type="checkbox" data-f="onopen"> Refresh when the workbook opens</label><label><input type="checkbox" data-f="astable"> Make the loaded range a table</label></div>
        <div class="fc-auto-row"><button type="button" class="fc-btn" data-a="preview">Preview</button><button type="submit" class="fc-btn fc-btn-primary">Save and load into sheet</button><button type="button" class="fc-btn fc-btn-ghost" data-a="cancel">Close</button></div>
        <div class="fc-qprev"></div>
      </form>`;
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.saved = q('[data-l="saved"]');
    this.web = q('[data-l="web"]');
    this.ed = q('.fc-qed');
    this.stepsEl = q('.fc-qsteps');
    this.preview = q('.fc-qprev');
    this.msg = q('.fc-dmsg');
    this.pic = new PictureImport(env);
    this.root.appendChild(this.pic.root);
    this.root.addEventListener('click', (e) => void this.click(e));
    this.root.addEventListener('input', (e) => this.input(e));
    this.root.addEventListener('change', (e) => this.input(e));
    this.ed.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.save();
    });
  }

  private f<T extends HTMLElement>(name: string): T {
    return this.root.querySelector<T>(`[data-f="${name}"]`)!;
  }

  reload(): void {
    this.paintSaved();
    this.ed.hidden = true;
    this.editing = null;
    void this.pic.load();
  }

  openOnOpen(): void {
    for (const q of this.env.auto.queries) if (q.onOpen) void this.apply(q);
  }

  private paintSaved(): void {
    const list = this.env.auto.queries;
    this.saved.innerHTML = list.length
      ? list.map((x) => `<div class="fc-auto-item" data-q="${x.id}"><span class="fc-grow">${esc(x.name)}<small>${esc(x.target.sheet)}!${esc(x.target.cell)}${x.every ? ` · every ${x.every} min` : ''}</small></span><button type="button" class="fc-btn" data-a="run" data-id="${x.id}">Refresh</button><button type="button" class="fc-btn" data-a="edit" data-id="${x.id}">Edit</button><button type="button" class="fc-btn fc-btn-danger" data-a="del" data-id="${x.id}">Delete</button></div>`).join('')
      : '<p class="fc-auto-hint">No saved queries. Import a web table or make a new query.</p>';
  }

  private async click(e: Event): Promise<void> {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    const id = b.dataset.id ?? '';
    try {
      if (a === 'find') await this.find();
      else if (a === 'import') await this.importTable(Number(b.dataset.i));
      else if (a === 'newq') this.openEditor(null);
      else if (a === 'edit') this.openEditor(this.env.auto.queries.find((x) => x.id === id) ?? null);
      else if (a === 'run') await this.refresh(id);
      else if (a === 'del') {
        this.env.auto.queries = this.env.auto.queries.filter((x) => x.id !== id);
        this.env.changed();
        this.paintSaved();
      } else if (a === 'refresh-all') {
        setText(this.msg, 'Refreshing');
        await this.env.calls.drain(true, true);
        setText(this.msg, 'Web functions refreshed.');
      } else if (a === 'preview') await this.runPreview();
      else if (a === 'cancel') {
        this.ed.hidden = true;
        this.editing = null;
      } else if (a === 'rmstep') {
        this.editing?.steps.splice(Number(b.dataset.i), 1);
        this.paintSteps();
      } else if (a === 'stepup' || a === 'stepdown') {
        const steps = this.editing?.steps;
        const i = Number(b.dataset.i);
        const j = a === 'stepup' ? i - 1 : i + 1;
        if (steps && j >= 0 && j < steps.length) {
          [steps[i], steps[j]] = [steps[j], steps[i]];
          this.paintSteps();
        }
      } else if (a === 'stepprev') await this.runPreview(Number(b.dataset.i) + 1);
      else if (a === 'schema') await this.schema();
      else if (a === 'dbtable') {
        this.f<HTMLTextAreaElement>('sql').value = `SELECT * FROM ${b.dataset.t ?? ''}`;
      }
    } catch (err) {
      setText(this.msg, err instanceof Error ? err.message : String(err));
    }
  }

  private input(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (!this.editing) return;
    if (t.dataset.f === 'addstep' && t.value) {
      this.editing.steps.push({ op: t.value });
      t.value = '';
      this.paintSteps();
      return;
    }
    if (t.dataset.f === 'kind') this.showSource(t.value);
    if (t.dataset.sf) {
      const row = t.closest<HTMLElement>('[data-si]');
      const step = this.editing.steps[Number(row?.dataset.si)];
      if (step) step[t.dataset.sf] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
    }
  }

  private showSource(kind: string): void {
    for (const d of this.root.querySelectorAll<HTMLElement>('.fc-qsrc')) d.hidden = !d.dataset.k!.split(' ').includes(kind);
  }

  private openEditor(q: Query | null): void {
    const sheets = this.env.sheets();
    const sel = this.env.selection();
    const fresh = !q;
    const draft: Query = q ?? { id: uid(), name: `Query ${this.env.auto.queries.length + 1}`, source: { kind: 'csv' }, steps: [{ op: 'promote_headers' }], target: { sheet: sheets[this.env.grid.sheetIndex] ?? 'Sheet1', cell: `${colName(sel.c0)}${sel.r0 + 1}` }, every: 0 };
    this.editing = draft;
    (this.editing as Query & { fresh?: boolean }).fresh = fresh;
    const s = draft.source as Record<string, string>;
    this.f<HTMLInputElement>('name').value = draft.name;
    this.f<HTMLSelectElement>('kind').value = s.kind ?? 'csv';
    const isExcel = s.kind === 'excel';
    for (const k of ['url', 'table', 'text', 'path', 'sql', 'sheet', 'pattern', 'host', 'port', 'user', 'password', 'database']) this.f<HTMLInputElement>(k).value = s[k] ?? '';
    this.f<HTMLInputElement>('range').value = isExcel ? '' : s.range ?? '';
    this.f<HTMLInputElement>('xrange').value = isExcel ? s.range ?? '' : '';
    this.f<HTMLInputElement>('xpath').value = isExcel ? s.path ?? '' : '';
    this.f<HTMLInputElement>('fpath').value = s.kind === 'folder' ? s.path ?? '' : '';
    this.f<HTMLInputElement>('path').value = s.kind === 'sqlite' ? s.path ?? '' : '';
    this.f<HTMLInputElement>('subfolders').checked = !!(draft.source as Record<string, unknown>).subfolders;
    this.f<HTMLInputElement>('flist').checked = !!(draft.source as Record<string, unknown>).list;
    this.f<HTMLInputElement>('tsheet').value = draft.target.sheet;
    this.f<HTMLInputElement>('tcell').value = draft.target.cell;
    this.f<HTMLInputElement>('every').value = draft.every ? String(draft.every) : '';
    this.f<HTMLInputElement>('daily').value = draft.daily ?? '';
    this.f<HTMLInputElement>('onopen').checked = !!draft.onOpen;
    this.f<HTMLInputElement>('astable').checked = !!draft.asTable;
    this.root.querySelector('.fc-dbtables')!.replaceChildren();
    this.showSource(s.kind ?? 'csv');
    this.paintSteps();
    this.preview.textContent = '';
    this.ed.hidden = false;
  }

  private choices(kind: string): [string, string][] | null {
    if (kind === 'cmp') return CMP;
    if (kind === 'type') return TYPES;
    if (kind === 'agg') return AGGS;
    if (kind === 'query') return [['', 'Choose a query'], ...this.env.auto.queries.filter((x) => x.id !== this.editing?.id).map((x): [string, string] => [x.id, x.name])];
    return SELECTS[kind] ?? null;
  }

  private paintSteps(): void {
    const steps = this.editing?.steps ?? [];
    this.stepsEl.innerHTML = steps
      .map((s, i) => {
        const def = STEPS[s.op];
        const fields = def.fields
          .map(([k, label, kind]) => {
            const v = s[k];
            if (kind === 'check') return `<label>${esc(label)} <input type="checkbox" data-sf="${k}" ${v ? 'checked' : ''}></label>`;
            const list = this.choices(kind);
            if (list) return `<label>${esc(label)} <select class="fc-auto-input" data-sf="${k}">${list.map(([o, l]) => `<option value="${esc(o)}" ${String(v ?? list[0]?.[0]) === o ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
            return `<label>${esc(label)} <input class="fc-auto-input" data-sf="${k}" type="${kind === 'num' ? 'number' : 'text'}" value="${esc(String(v ?? ''))}" spellcheck="false"></label>`;
          })
          .join('');
        for (const [k, , kind] of def.fields) {
          const list = this.choices(kind);
          if (s[k] === undefined && list && list[0]) s[k] = list[0][0];
        }
        const last = steps.length - 1;
        return `<div class="fc-step" data-si="${i}"><strong>${i + 1}. ${esc(def.label)}</strong>${fields}<span class="fc-step-tools"><button type="button" class="fc-btn fc-btn-ghost" data-a="stepprev" data-i="${i}" aria-label="Preview the result after step ${i + 1}">Preview here</button><button type="button" class="fc-btn fc-btn-ghost" data-a="stepup" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move step ${i + 1} up">Up</button><button type="button" class="fc-btn fc-btn-ghost" data-a="stepdown" data-i="${i}" ${i === last ? 'disabled' : ''} aria-label="Move step ${i + 1} down">Down</button><button type="button" class="fc-btn fc-btn-ghost" data-a="rmstep" data-i="${i}" aria-label="Remove step ${i + 1}">Remove</button></span></div>`;
      })
      .join('');
  }

  private collect(): Query | null {
    const q = this.editing;
    if (!q) return null;
    q.name = this.f<HTMLInputElement>('name').value.trim() || q.name;
    const kind = this.f<HTMLSelectElement>('kind').value;
    const src: Record<string, unknown> = { kind };
    const keys: Record<string, string[]> = {
      csv: ['url'], json: ['url'], html: ['url'], text: ['text'], sheet: ['range'], sqlite: ['path', 'sql'],
      excel: ['xpath:path', 'sheet', 'xrange:range'], folder: ['fpath:path', 'pattern', 'sheet'],
      postgres: ['host', 'port', 'user', 'password', 'database', 'sql'], mysql: ['host', 'port', 'user', 'password', 'database', 'sql'],
    };
    for (const spec of keys[kind] ?? []) {
      const [field, key = field] = spec.split(':');
      const v = this.f<HTMLInputElement>(field).value;
      if (v) src[key] = v;
    }
    if (kind === 'folder') {
      src.subfolders = this.f<HTMLInputElement>('subfolders').checked;
      src.list = this.f<HTMLInputElement>('flist').checked;
    }
    const t = Number(this.f<HTMLInputElement>('table').value);
    if (kind === 'html') src.table = t || 1;
    if (kind === 'sheet') src.workbook = this.env.id();
    q.source = src;
    q.daily = /^\d{1,2}:\d{2}$/.test(this.f<HTMLInputElement>('daily').value.trim()) ? this.f<HTMLInputElement>('daily').value.trim() : undefined;
    q.onOpen = this.f<HTMLInputElement>('onopen').checked || undefined;
    q.asTable = this.f<HTMLInputElement>('astable').checked || undefined;
    q.target = { sheet: this.f<HTMLInputElement>('tsheet').value.trim() || 'Sheet1', cell: this.f<HTMLInputElement>('tcell').value.trim().toUpperCase() || 'A1' };
    q.every = Number(this.f<HTMLInputElement>('every').value) || 0;
    q.steps = q.steps.map((s): Step => {
      const out: Step = { ...s };
      for (const k of LISTS) if (typeof s[k] === 'string') out[k] = (s[k] as string).split(',').map((x) => x.trim()).filter(Boolean);
      return out;
    });
    return q;
  }

  private async runQuery(q: Query, upto?: number): Promise<QueryResult> {
    const wire = { ...q, steps: (upto === undefined ? q.steps : q.steps.slice(0, upto)).map((s) => {
      const out: Step = { ...s };
      for (const k of LISTS) if (typeof s[k] === 'string') out[k] = (s[k] as string).split(',').map((x) => x.trim()).filter(Boolean);
      return out;
    }) };
    if (wire.source.kind === 'sheet') wire.source = { ...wire.source, workbook: this.env.id() };
    const library: Record<string, Query> = {};
    for (const x of this.env.auto.queries) library[x.id] = x;
    return api<QueryResult>('POST', '/api/queries/run', { query: wire, fresh: true, library });
  }

  private async schema(): Promise<void> {
    const q = this.collect();
    if (!q) return;
    const r = await api<{ tables: { name: string; columns: string[] }[] }>('POST', '/api/db/schema', { source: q.source });
    this.root.querySelector('.fc-dbtables')!.innerHTML = r.tables.length
      ? r.tables.map((t) => `<div class="fc-auto-item"><span class="fc-grow">${esc(t.name)}<small>${esc(t.columns.join(', ').slice(0, 120))}</small></span><button type="button" class="fc-btn" data-a="dbtable" data-t="${esc(t.name)}">Use</button></div>`).join('')
      : '<p class="fc-auto-hint">No tables found.</p>';
  }

  private async runPreview(upto?: number): Promise<void> {
    const q = this.collect();
    if (!q) return;
    const res = await this.runQuery(q, upto);
    const rows = res.rows.slice(0, 25);
    this.preview.innerHTML = `<table><tbody>${rows.map((r, i) => `<tr>${r.map((c) => `<${i ? 'td' : 'th'}>${esc(c.startsWith("'") ? c.slice(1) : c)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table><p class="fc-auto-hint">${res.rows.length - 1} rows, ${res.columns.length} columns${res.rows.length > 25 ? '; showing the first 24' : ''}.</p>`;
  }

  private async save(): Promise<void> {
    const q = this.collect();
    if (!q) return;
    const list = this.env.auto.queries;
    const i = list.findIndex((x) => x.id === q.id);
    delete (q as Query & { fresh?: boolean }).fresh;
    if (i >= 0) list[i] = q;
    else list.push(q);
    this.env.changed();
    await this.apply(q);
    this.paintSaved();
    this.ed.hidden = true;
    this.editing = null;
  }

  async refresh(id: string): Promise<void> {
    const q = this.env.auto.queries.find((x) => x.id === id);
    if (q) await this.apply(q);
  }

  async apply(q: Query): Promise<void> {
    const book = this.env.book();
    if (book < 0) return;
    setText(this.msg, `Running ${q.name}`);
    try {
      const res = await this.runQuery(q);
      let sheets = this.env.sheets();
      let i = sheets.indexOf(q.target.sheet);
      if (i < 0) i = await this.env.addSheet(q.target.sheet);
      sheets = this.env.sheets();
      const at = parseRef(q.target.cell) ?? { r0: 0, c0: 0, r1: 0, c1: 0 };
      const h = res.rows.length;
      const w = Math.max(0, ...res.rows.map((r) => r.length));
      const edits: [number, number, string][] = [];
      res.rows.forEach((row, r) => row.forEach((v, c) => edits.push([at.r0 + r, at.c0 + c, v])));
      const old = q.last ?? { rows: 0, cols: 0 };
      for (let r = 0; r < Math.max(old.rows, h); r++) for (let c = 0; c < Math.max(old.cols, w); c++) if (r >= h || c >= w) edits.push([at.r0 + r, at.c0 + c, '']);
      const e = engine();
      const mark = await e.undoMark(book);
      await this.env.grid.commitEdits(await e.apply(book, edits, i));
      let tableNote = '';
      if (q.asTable && !q.tabled && h > 1 && w > 0) {
        try {
          await this.env.grid.applyPivot(await e.createTable(book, i, at.r0, at.c0, at.r0 + h - 1, at.c0 + w - 1, true));
          q.tabled = true;
        } catch (err) {
          tableNote = ` It could not be made a table: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      await e.undoGroup(book, mark);
      q.last = { rows: h, cols: w };
      q.refreshed = Date.now() / 1000;
      this.env.changed();
      setText(this.msg, `${q.name}: ${h - 1} rows loaded into ${sheets[i]}!${q.target.cell}.${tableNote}`);
      await this.env.calls.drain();
    } catch (err) {
      setText(this.msg, err instanceof Error ? err.message : String(err));
    }
  }

  private async find(): Promise<void> {
    const url = this.f<HTMLInputElement>('weburl').value.trim();
    if (!url) return;
    setText(this.msg, 'Fetching');
    const r = await api<{ tables: { rows: number; cols: number; preview: string[][] }[] }>('POST', '/api/web/tables', { url });
    this.web.innerHTML = r.tables.length
      ? r.tables.map((t, i) => `<div class="fc-auto-item fc-webtable"><span class="fc-grow">Table ${i + 1}<small>${t.rows} rows, ${t.cols} columns</small><span class="fc-qprev"><table><tbody>${t.preview.slice(0, 4).map((row) => `<tr>${row.slice(0, 6).map((c) => `<td>${esc(String(c).slice(0, 24))}</td>`).join('')}</tr>`).join('')}</tbody></table></span></span><button type="button" class="fc-btn" data-a="import" data-i="${i}">Import</button></div>`).join('')
      : '<p class="fc-auto-hint">That page has no HTML tables.</p>';
    setText(this.msg, '');
  }

  private async importTable(i: number): Promise<void> {
    const url = this.f<HTMLInputElement>('weburl').value.trim();
    const sel = this.env.selection();
    const sheets = this.env.sheets();
    const q: Query = { id: uid(), name: `Web table ${i + 1} of ${url.replace(/^https?:\/\//, '').slice(0, 40)}`, source: { kind: 'html', url, table: i + 1 }, steps: [{ op: 'promote_headers' }], target: { sheet: sheets[this.env.grid.sheetIndex] ?? 'Sheet1', cell: `${colName(sel.c0)}${sel.r0 + 1}` }, every: 0 };
    this.env.auto.queries.push(q);
    this.env.changed();
    await this.apply(q);
    this.paintSaved();
  }

  tick(): void {
    const now = Date.now() / 1000;
    for (const q of this.env.auto.queries) {
      if (q.every > 0 && now - (q.refreshed ?? 0) >= q.every * 60) {
        q.refreshed = now;
        void this.apply(q);
      }
    }
  }

  start(): void {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 20000);
  }

  stop(): void {
    window.clearInterval(this.timer);
  }
}
