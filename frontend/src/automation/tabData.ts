import { engine } from '../engine';
import { colName, parseRef } from '../grid/a1';
import { api, el, esc, setText } from './dom';
import { uid, type Env, type Query, type Step } from './model';
import { PictureImport } from './picture';
import { findTable, needsResize, resizedLine } from './tableFit';

interface QueryResult {
  columns: string[];
  rows: string[][];
}

interface Graph {
  nodes: { id: string; name: string; kind: string; uses: string[]; usedBy: string[] }[];
  order: string[];
  cycles: string[][];
}

interface Sched {
  enabled: boolean;
  minutes: number;
  platform: string;
  active: boolean;
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
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastSnap = '';
  private textMode = false;

  constructor(private readonly env: Env) {
    this.root.innerHTML = `
      <h3 class="fc-auto-h">From the web</h3>
      <div class="fc-auto-row"><input class="fc-auto-input fc-grow" data-f="weburl" placeholder="https://example.com/page" aria-label="Web page address" spellcheck="false" autocomplete="off"><button type="button" class="fc-btn" data-a="find">Find tables</button></div>
      <div class="fc-auto-list" data-l="web"></div>
      <h3 class="fc-auto-h">Queries</h3>
      <div class="fc-auto-list" data-l="saved"></div>
      <div class="fc-auto-row"><button type="button" class="fc-btn" data-a="newq">New query</button><button type="button" class="fc-btn" data-a="refresh-queries">Refresh all queries</button><button type="button" class="fc-btn" data-a="refresh-all">Refresh web functions</button><button type="button" class="fc-btn" data-a="deps">Dependencies</button></div>
      <p class="fc-auto-hint fc-dmsg" aria-live="polite"></p>
      <div class="fc-qgraph" hidden></div>
      <h3 class="fc-auto-h">Refresh when FormCel is closed</h3>
      <div class="fc-auto-row fc-auto-small"><label><input type="checkbox" data-f="ossched"> Keep scheduled queries refreshed by the operating system</label><label>every <input class="fc-auto-num" type="number" min="1" max="1440" value="15" data-f="osmin"> min</label></div>
      <p class="fc-auto-hint fc-osmsg" aria-live="polite"></p>
      <form class="fc-qed" hidden>
        <input class="fc-auto-input" data-f="name" aria-label="Query name" placeholder="Query name" spellcheck="false" autocomplete="off">
        <label>Source<select class="fc-auto-input" data-f="kind"><option value="csv">CSV from an address</option><option value="text">CSV pasted here</option><option value="json">JSON from an address</option><option value="html">Table from a web page</option><option value="sheet">Range of this workbook</option><option value="excel">Excel, FormCel or CSV file</option><option value="folder">Folder of files (combine)</option><option value="sqlite">SQLite database (SELECT)</option><option value="postgres">PostgreSQL (SELECT)</option><option value="mysql">MySQL (SELECT)</option><option value="query">Another query (reference)</option></select></label>
        <div class="fc-qsrc" data-k="query"><select class="fc-auto-input" data-f="refq" aria-label="Query to start from"></select></div>
        <div class="fc-qsrc" data-k="csv json html"><input class="fc-auto-input" data-f="url" placeholder="Address" spellcheck="false"></div>
        <div class="fc-qsrc" data-k="html"><input class="fc-auto-input" data-f="table" type="number" min="1" placeholder="Table number (1 is the first)"></div>
        <div class="fc-qsrc" data-k="text"><textarea class="fc-auto-input" data-f="text" rows="4" placeholder="Paste CSV"></textarea></div>
        <div class="fc-qsrc" data-k="sheet"><input class="fc-auto-input" data-f="range" placeholder="Sheet1!A1:D20 (empty for the whole used range)" spellcheck="false"></div>
        <div class="fc-qsrc" data-k="excel"><input class="fc-auto-input" data-f="xpath" placeholder="/path/to/Book.xlsx, .xls, .fcel or .csv" spellcheck="false"><input class="fc-auto-input" data-f="sheet" placeholder="Sheet name (empty for the first)" spellcheck="false"><input class="fc-auto-input" data-f="xrange" placeholder="Range such as A1:D50 (empty for all)" spellcheck="false"></div>
        <div class="fc-qsrc" data-k="folder"><input class="fc-auto-input" data-f="fpath" placeholder="/path/to/folder" spellcheck="false"><input class="fc-auto-input" data-f="pattern" placeholder="File name pattern, such as sales-*.xlsx" spellcheck="false"><label><input type="checkbox" data-f="subfolders"> Include subfolders</label><label><input type="checkbox" data-f="flist"> List the files instead of combining them</label></div>
        <div class="fc-qsrc" data-k="sqlite"><input class="fc-auto-input" data-f="path" placeholder="/path/to/file.db" spellcheck="false"></div>
        <div class="fc-qsrc" data-k="postgres mysql"><div class="fc-auto-row"><input class="fc-auto-input fc-grow" data-f="host" placeholder="Server" spellcheck="false"><input class="fc-auto-num" data-f="port" type="number" min="1" placeholder="Port"></div><div class="fc-auto-row"><input class="fc-auto-input fc-grow" data-f="user" placeholder="User" spellcheck="false" autocomplete="off"><input class="fc-auto-input fc-grow" data-f="password" type="password" placeholder="Password" autocomplete="off"></div><input class="fc-auto-input" data-f="database" placeholder="Database" spellcheck="false"><p class="fc-auto-hint">The password is saved inside this workbook's automation data. Use a read-only account.</p></div>
        <div class="fc-qsrc" data-k="sqlite postgres mysql"><div class="fc-auto-row"><button type="button" class="fc-btn" data-a="schema">Show tables</button></div><div class="fc-auto-list fc-dbtables"></div><textarea class="fc-auto-input" data-f="sql" rows="4" placeholder="SELECT * FROM table WHERE region = @region" spellcheck="false"></textarea></div>
        <div class="fc-auto-h">Parameters</div>
        <div class="fc-params"></div>
        <div class="fc-auto-row"><button type="button" class="fc-btn" data-a="addparam">Add parameter</button></div>
        <p class="fc-auto-hint">Write @name in a SQL statement to pass a parameter safely to the server, or {{name}} anywhere else (addresses, paths, filter values). A value that starts with = reads a cell, such as =Sheet1!B2.</p>
        <div class="fc-auto-row"><div class="fc-auto-h fc-grow">Steps</div><button type="button" class="fc-btn fc-btn-ghost" data-a="hundo" aria-label="Undo the last change to the steps" disabled>Undo</button><button type="button" class="fc-btn fc-btn-ghost" data-a="hredo" aria-label="Redo the change to the steps" disabled>Redo</button><button type="button" class="fc-btn fc-btn-ghost" data-a="mtext" aria-pressed="false">Edit as text</button></div>
        <div class="fc-mtext" hidden><textarea class="fc-auto-input fc-mono" data-f="mtext" rows="12" spellcheck="false" aria-label="Query steps as text"></textarea><div class="fc-auto-row"><button type="button" class="fc-btn fc-btn-primary" data-a="mapply">Apply text</button><button type="button" class="fc-btn fc-btn-ghost" data-a="mreset">Reset from steps</button></div><p class="fc-auto-hint fc-mmsg" aria-live="polite"></p></div>
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
    this.ed.addEventListener('keydown', (e) => this.keys(e));
    q<HTMLInputElement>('[data-f="ossched"]').addEventListener('change', () => void this.setSchedule());
    q<HTMLInputElement>('[data-f="osmin"]').addEventListener('change', () => {
      if (q<HTMLInputElement>('[data-f="ossched"]').checked) void this.setSchedule();
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
    void this.loadSchedule();
  }

  private snap(): string {
    const q = this.editing;
    return q ? JSON.stringify({ source: q.source, steps: q.steps }) : '';
  }

  private remember(): void {
    const now = this.snap();
    if (!this.editing || now === this.lastSnap) return;
    this.undoStack.push(this.lastSnap);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.lastSnap = now;
    this.paintHistory();
  }

  private paintHistory(): void {
    const u = this.root.querySelector<HTMLButtonElement>('[data-a="hundo"]')!;
    const r = this.root.querySelector<HTMLButtonElement>('[data-a="hredo"]')!;
    u.disabled = !this.undoStack.length;
    r.disabled = !this.redoStack.length;
  }

  private travel(back: boolean): void {
    const q = this.editing;
    const from = back ? this.undoStack : this.redoStack;
    const to = back ? this.redoStack : this.undoStack;
    const target = from.pop();
    if (!q || target === undefined) return;
    this.collect();
    to.push(this.snap());
    const state = JSON.parse(target) as { source: Record<string, unknown>; steps: Step[] };
    q.source = state.source;
    q.steps = state.steps;
    this.openEditor(q, true);
    this.lastSnap = target;
    this.paintHistory();
  }

  private keys(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.matches('input[type="text"], input:not([type]), input[type="number"], input[type="password"], textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.travel(true);
    } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault();
      this.travel(false);
    }
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
    if (a === 'dbtable' || a === 'dbcols') e.preventDefault();
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
        this.remember();
      } else if (a === 'stepup' || a === 'stepdown') {
        const steps = this.editing?.steps;
        const i = Number(b.dataset.i);
        const j = a === 'stepup' ? i - 1 : i + 1;
        if (steps && j >= 0 && j < steps.length) {
          [steps[i], steps[j]] = [steps[j], steps[i]];
          this.paintSteps();
          this.remember();
        }
      } else if (a === 'stepprev') await this.runPreview(Number(b.dataset.i) + 1);
      else if (a === 'schema') await this.schema();
      else if (a === 'dbtable') {
        this.f<HTMLTextAreaElement>('sql').value = `SELECT * FROM ${b.dataset.t ?? ''}`;
      } else if (a === 'dbcols') {
        this.f<HTMLTextAreaElement>('sql').value = `SELECT ${b.dataset.cols ?? '*'}\nFROM ${b.dataset.t ?? ''}`;
      } else if (a === 'dbcol') {
        const ta = this.f<HTMLTextAreaElement>('sql');
        const at = ta.selectionStart ?? ta.value.length;
        ta.setRangeText(b.dataset.t ?? '', at, ta.selectionEnd ?? at, 'end');
        ta.focus();
      } else if (a === 'deps') await this.deps();
      else if (a === 'refresh-queries') await this.refreshAll();
      else if (a === 'hundo') this.travel(true);
      else if (a === 'hredo') this.travel(false);
      else if (a === 'mtext') await this.toggleText();
      else if (a === 'mapply') await this.applyText();
      else if (a === 'mreset') await this.showText();
      else if (a === 'addparam' && this.editing) {
        (this.editing.params ??= []).push({ name: '', type: 'text', value: '' });
        this.paintParams();
      } else if (a === 'rmparam' && this.editing?.params) {
        this.editing.params.splice(Number(b.dataset.i), 1);
        this.paintParams();
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
      this.remember();
      return;
    }
    if (t.dataset.f === 'kind') {
      this.showSource(t.value);
      this.headerStep(t.value);
    }
    if (t.dataset.sf) {
      const row = t.closest<HTMLElement>('[data-si]');
      const step = this.editing.steps[Number(row?.dataset.si)];
      if (step) step[t.dataset.sf] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
    }
    if (t.dataset.pf) {
      const row = t.closest<HTMLElement>('[data-pi]');
      const p = this.editing.params?.[Number(row?.dataset.pi)];
      if (p) (p as Record<string, string>)[t.dataset.pf] = t.value;
    }
    if (e.type === 'change' && (t.dataset.sf || ['kind', 'url', 'table', 'text', 'range', 'xpath', 'sheet', 'xrange', 'fpath', 'pattern', 'path', 'sql', 'host', 'port', 'user', 'password', 'database', 'refq'].includes(t.dataset.f ?? ''))) {
      this.collect();
      this.remember();
    }
  }

  private showSource(kind: string): void {
    for (const d of this.root.querySelectorAll<HTMLElement>('.fc-qsrc')) d.hidden = !d.dataset.k!.split(' ').includes(kind);
  }

  private headerStep(kind: string): void {
    const q = this.editing as (Query & { fresh?: boolean }) | null;
    if (!q?.fresh) return;
    const named = ['sqlite', 'postgres', 'mysql', 'query'].includes(kind);
    const has = q.steps[0]?.op === 'promote_headers';
    if (named && has) q.steps.shift();
    else if (!named && !has && !q.steps.length) q.steps.unshift({ op: 'promote_headers' });
    else return;
    this.paintSteps();
    this.remember();
  }

  private openEditor(q: Query | null, keepHistory = false): void {
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
    const refq = this.f<HTMLSelectElement>('refq');
    refq.innerHTML = [['', 'Choose a query'] as [string, string], ...this.env.auto.queries.filter((x) => x.id !== draft.id).map((x): [string, string] => [x.id, x.name])].map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    refq.value = s.kind === 'query' ? s.query ?? '' : '';
    this.showSource(s.kind ?? 'csv');
    this.paintSteps();
    this.paintParams();
    this.preview.textContent = '';
    this.ed.hidden = false;
    this.setTextMode(false);
    if (!keepHistory) {
      this.undoStack = [];
      this.redoStack = [];
      this.lastSnap = this.snap();
    }
    this.paintHistory();
  }

  private paintParams(): void {
    const list = this.editing?.params ?? [];
    this.root.querySelector('.fc-params')!.innerHTML = list
      .map((p, i) => `<div class="fc-auto-row" data-pi="${i}"><input class="fc-auto-input fc-grow" data-pf="name" value="${esc(p.name)}" placeholder="name" aria-label="Parameter name" spellcheck="false"><select class="fc-auto-input" data-pf="type" aria-label="Parameter type">${[['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['logical', 'True or false']].map(([k, l]) => `<option value="${k}" ${(p.type ?? 'text') === k ? 'selected' : ''}>${l}</option>`).join('')}</select><input class="fc-auto-input fc-grow" data-pf="value" value="${esc(p.value)}" placeholder="value or =Sheet1!B2" aria-label="Parameter value" spellcheck="false"><button type="button" class="fc-btn fc-btn-ghost" data-a="rmparam" data-i="${i}" aria-label="Remove parameter ${i + 1}">Remove</button></div>`)
      .join('');
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
    if (kind === 'query') src.query = this.f<HTMLSelectElement>('refq').value;
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
    for (const x of this.env.auto.queries) library[x.id] = x.id === q.id ? wire : x;
    for (const k of Object.keys(library)) library[k] = await this.withParams(library[k]);
    return api<QueryResult>('POST', '/api/queries/run', { query: await this.withParams(wire), fresh: true, library });
  }

  private async withParams(q: Query): Promise<Query> {
    const list = (q.params ?? []).filter((p) => p.name.trim());
    if (!list.length) return q;
    const book = this.env.book();
    const out = [];
    for (const p of list) {
      let value = p.value;
      if (value.trim().startsWith('=') && book >= 0) {
        const m = /^=\s*(?:(?:'((?:[^']|'')+)'|([^!']+))!)?\$?([A-Za-z]{1,3})\$?(\d+)\s*$/.exec(value.trim());
        if (!m) throw new Error(`Parameter ${p.name}: ${value} is not a cell reference such as =Sheet1!B2.`);
        const name = (m[1] ?? m[2])?.replace(/''/g, "'");
        const names = this.env.sheets();
        const sheet = name ? names.findIndex((n) => n.toLowerCase() === name.toLowerCase()) : this.env.grid.sheetIndex;
        if (sheet < 0) throw new Error(`Parameter ${p.name}: there is no sheet ${name}.`);
        const ref = parseRef(`${m[3]}${m[4]}`);
        const got = ref ? await engine().readValues(book, sheet, ref.r0, ref.c0, ref.r0, ref.c0) : [];
        value = got[0] ? String(got[0][2]) : '';
      }
      out.push({ ...p, name: p.name.trim(), value });
    }
    return { ...q, params: out };
  }

  private async schema(): Promise<void> {
    const q = this.collect();
    if (!q) return;
    setText(this.msg, 'Reading the schema');
    const r = await api<{ tables: { name: string; ref: string; kind: string; columns: string[]; types: string[] }[] }>('POST', '/api/db/schema', { source: q.source });
    setText(this.msg, '');
    const quote = (c: string, _ref?: string) => (q.source.kind === 'mysql' ? `\`${c.replace(/`/g, '``')}\`` : /^[a-z_][a-z0-9_]*$/.test(c) ? c : `"${c.replace(/"/g, '""')}"`);
    this.root.querySelector('.fc-dbtables')!.innerHTML = r.tables.length
      ? r.tables
          .map((t) => `<details class="fc-dbt"><summary><span class="fc-grow">${esc(t.name)}<small>${esc(t.kind)}, ${t.columns.length} columns</small></span><button type="button" class="fc-btn" data-a="dbtable" data-t="${esc(t.ref)}">Select all</button><button type="button" class="fc-btn fc-btn-ghost" data-a="dbcols" data-t="${esc(t.ref)}" data-cols="${esc(t.columns.map((c) => quote(c, t.ref)).join(', '))}">Select columns</button></summary><div class="fc-dbcols">${t.columns.map((c, i) => `<button type="button" class="fc-btn fc-btn-ghost" data-a="dbcol" data-t="${esc(quote(c, t.ref))}">${esc(c)}<small>${esc(t.types[i] ?? '')}</small></button>`).join('')}</div></details>`)
          .join('')
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

  private library(): Record<string, Query> {
    const lib: Record<string, Query> = {};
    for (const x of this.env.auto.queries) lib[x.id] = x;
    return lib;
  }

  private async refreshAll(): Promise<void> {
    const list = this.env.auto.queries;
    if (!list.length) {
      setText(this.msg, 'There are no saved queries to refresh.');
      return;
    }
    const g = await api<Graph>('POST', '/api/queries/graph', { library: this.library() });
    if (g.cycles.length) throw new Error(`Queries refer to each other in a circle: ${g.cycles[0].map((id) => g.nodes.find((n) => n.id === id)?.name ?? id).join(' to ')}.`);
    let ok = 0;
    const failed: string[] = [];
    for (const id of g.order) {
      const q = list.find((x) => x.id === id);
      if (!q) continue;
      setText(this.msg, `Refreshing ${q.name} (${ok + failed.length + 1} of ${g.order.length})`);
      if (await this.apply(q)) ok++;
      else failed.push(q.name);
    }
    setText(this.msg, failed.length ? `Refreshed ${ok} of ${ok + failed.length} queries. Failed: ${failed.join(', ')}.` : `Refreshed all ${ok} queries, dependencies first.`);
    this.paintSaved();
  }

  private async deps(): Promise<void> {
    const box = this.root.querySelector<HTMLElement>('.fc-qgraph')!;
    if (!box.hidden) {
      box.hidden = true;
      return;
    }
    const g = await api<Graph>('POST', '/api/queries/graph', { library: this.library() });
    if (!g.nodes.length) {
      setText(this.msg, 'There are no saved queries yet.');
      return;
    }
    const depth: Record<string, number> = {};
    const level = (id: string, seen: string[] = []): number => {
      if (depth[id] !== undefined) return depth[id];
      if (seen.includes(id)) return 0;
      const n = g.nodes.find((x) => x.id === id);
      depth[id] = n && n.uses.length ? 1 + Math.max(...n.uses.map((u) => level(u, [...seen, id]))) : 0;
      return depth[id];
    };
    g.nodes.forEach((n) => level(n.id));
    const cols: string[][] = [];
    g.nodes.forEach((n) => (cols[depth[n.id]] ??= []).push(n.id));
    const pos: Record<string, [number, number]> = {};
    cols.forEach((ids, c) => ids?.forEach((id, r) => (pos[id] = [10 + c * 176, 10 + r * 40])));
    const rowsMax = Math.max(...cols.map((c) => c?.length ?? 0));
    const edges = g.nodes.flatMap((n) => n.uses.filter((u) => pos[u]).map((u) => `<path d="M${pos[u][0] + 150} ${pos[u][1] + 14} C${pos[u][0] + 163} ${pos[u][1] + 14} ${pos[n.id][0] - 13} ${pos[n.id][1] + 14} ${pos[n.id][0]} ${pos[n.id][1] + 14}" class="fc-qedge"/>`));
    const nodes = g.nodes.map((n) => `<g><rect x="${pos[n.id][0]}" y="${pos[n.id][1]}" width="150" height="28" rx="4" class="fc-qnode"/><text x="${pos[n.id][0] + 8}" y="${pos[n.id][1] + 18}" class="fc-qlabel">${esc(n.name.length > 20 ? `${n.name.slice(0, 19)}…` : n.name)}</text></g>`);
    const names = new Map(g.nodes.map((n) => [n.id, n.name]));
    const lines = g.nodes.map((n) => `<li><strong>${esc(n.name)}</strong> ${esc(n.kind ? `reads ${n.kind}` : '')}${n.uses.length ? `, builds on ${esc(n.uses.map((u) => names.get(u) ?? u).join(', '))}` : ''}${n.usedBy.length ? `; used by ${esc(n.usedBy.map((u) => names.get(u) ?? u).join(', '))}` : ''}</li>`);
    box.innerHTML = `<svg viewBox="0 0 ${20 + cols.length * 176} ${20 + rowsMax * 40}" width="${20 + cols.length * 176}" height="${20 + rowsMax * 40}" role="img" aria-label="Query dependency diagram"><g class="fc-qedges">${edges.join('')}</g>${nodes.join('')}</svg><ul class="fc-qdeplist">${lines.join('')}</ul><p class="fc-auto-hint">Refresh order: ${esc(g.order.map((id) => names.get(id) ?? id).join(', then '))}.${g.cycles.length ? ` A circle was found through ${esc(g.cycles[0].map((id) => names.get(id) ?? id).join(', '))}.` : ''}</p>`;
    box.hidden = false;
  }

  private setTextMode(on: boolean): void {
    this.textMode = on;
    this.root.querySelector<HTMLElement>('.fc-mtext')!.hidden = !on;
    this.stepsEl.hidden = on;
    const b = this.root.querySelector<HTMLButtonElement>('[data-a="mtext"]')!;
    b.setAttribute('aria-pressed', String(on));
    setText(b, on ? 'Back to steps' : 'Edit as text');
  }

  private async toggleText(): Promise<void> {
    if (this.textMode) {
      this.setTextMode(false);
      return;
    }
    await this.showText();
    this.setTextMode(true);
  }

  private async showText(): Promise<void> {
    const q = this.collect();
    if (!q) return;
    const r = await api<{ text: string }>('POST', '/api/queries/text', { query: { source: q.source, steps: q.steps }, library: this.library() });
    this.f<HTMLTextAreaElement>('mtext').value = r.text;
    setText(this.root.querySelector('.fc-mmsg')!, '');
  }

  private async applyText(): Promise<void> {
    const q = this.collect();
    const msg = this.root.querySelector<HTMLElement>('.fc-mmsg')!;
    if (!q) return;
    try {
      const r = await api<{ source: Record<string, unknown>; steps: Step[] }>('POST', '/api/queries/parse', { text: this.f<HTMLTextAreaElement>('mtext').value, library: this.library() });
      q.source = r.source;
      q.steps = r.steps;
      this.openEditor(q, true);
      this.remember();
      await this.showText();
      this.setTextMode(true);
      setText(msg, `Applied: a ${r.source.kind} source and ${r.steps.length} step${r.steps.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setText(msg, err instanceof Error ? err.message : String(err));
    }
  }

  private async loadSchedule(): Promise<void> {
    const msg = this.root.querySelector<HTMLElement>('.fc-osmsg')!;
    try {
      const s = await api<Sched>('GET', '/api/settings/schedule');
      this.f<HTMLInputElement>('ossched').checked = s.enabled;
      this.f<HTMLInputElement>('osmin').value = String(s.minutes);
      setText(msg, this.schedText(s, []));
    } catch {
      setText(msg, 'The engine process could not be reached.');
    }
  }

  private schedText(s: Sched, notes: string[]): string {
    const how = s.platform === 'linux' ? 'a systemd user timer (formcel-refresh.timer)' : s.platform === 'macos' ? 'a launchd agent' : s.platform === 'windows' ? 'a Task Scheduler task' : 'the system scheduler';
    const state = s.enabled ? `On: ${how} runs every ${s.minutes} minutes${s.active ? ' and is active' : ' (written, not active yet)'}.` : `Off. Turn it on to let ${how} refresh queries that have an interval or a daily time while FormCel is closed.`;
    return [state, ...notes].join(' ');
  }

  private async setSchedule(): Promise<void> {
    const on = this.f<HTMLInputElement>('ossched').checked;
    const minutes = Math.max(1, Math.min(1440, Number(this.f<HTMLInputElement>('osmin').value) || 15));
    const msg = this.root.querySelector<HTMLElement>('.fc-osmsg')!;
    try {
      const r = await api<{ status: Sched; notes: string[] }>('PUT', '/api/settings/schedule', { enabled: on, minutes });
      this.f<HTMLInputElement>('osmin').value = String(r.status.minutes);
      setText(msg, this.schedText(r.status, r.notes ?? []));
    } catch (err) {
      this.f<HTMLInputElement>('ossched').checked = !on;
      setText(msg, err instanceof Error ? err.message : String(err));
    }
  }

  async apply(q: Query): Promise<boolean> {
    const book = this.env.book();
    if (book < 0) return false;
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
      const tablesBefore = (await e.tables(book)).join('\n');
      await this.env.grid.commitEdits(await e.apply(book, edits, i));
      let tableNote = '';
      if (q.asTable && h > 1 && w > 0) {
        try {
          const found = findTable(await e.tables(book), i, q.tableName, at.r0, at.c0);
          if (!found) {
            await this.env.grid.applyPivot(await e.createTable(book, i, at.r0, at.c0, at.r0 + h - 1, at.c0 + w - 1, true));
            q.tableName = findTable(await e.tables(book), i, undefined, at.r0, at.c0)?.name;
          } else {
            q.tableName = found.name;
            if (needsResize(found, at.r0 + h - 1, at.c0 + w - 1)) await this.env.grid.applyPivot(await e.setTable(book, found.name, resizedLine(found, at.r0 + h - 1, at.c0 + w - 1)));
          }
          q.tabled = !!q.tableName;
        } catch (err) {
          tableNote = ` It could not be made a table: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      if ((await e.tables(book)).join('\n') !== tablesBefore) await this.env.grid.syncTables();
      await e.undoGroup(book, mark);
      q.last = { rows: h, cols: w };
      q.refreshed = Date.now() / 1000;
      this.env.changed();
      setText(this.msg, `${q.name}: ${h - 1} rows loaded into ${sheets[i]}!${q.target.cell}.${tableNote}`);
      await this.env.calls.drain();
      return true;
    } catch (err) {
      setText(this.msg, err instanceof Error ? err.message : String(err));
      return false;
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
