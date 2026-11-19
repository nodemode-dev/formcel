import { runHandler } from '../automation/pyHandlers';
import { callCommand, registerCommand } from '../ui/commands';
import { actions, el, field, makeModal, type Modal } from '../ui/modal';
import { FormStore, kindOf, quoteName, type DataFormDef, type FormsHost } from './store';

interface Rows {
  columns: string[];
  rows: unknown[][];
}

export interface DataFormsHost extends FormsHost {
  status(text: string, error?: boolean): void;
}

type Rec = Record<string, unknown>;

const uid = () => Math.random().toString(36).slice(2, 10);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function query(path: string, sql: string, params?: Rec): Promise<Rows> {
  return (await callCommand('data.dbQuery', { path, sql, params })) as Rows;
}

class FormView {
  private readonly m: Modal;
  private readonly inputs = new Map<string, HTMLInputElement>();
  private readonly count: HTMLElement;
  private readonly note: HTMLElement;
  private rows: Rec[] = [];
  private i = 0;
  private fresh = false;
  private busy = false;

  constructor(private readonly host: DataFormsHost, private readonly def: DataFormDef, private readonly done: () => void) {
    this.m = makeModal(`Data Form: ${def.name}`, { onClose: () => this.closed() });
    const grid = el('div', 'fc-dform-fields');
    for (const f of def.fields) {
      const i = Object.assign(document.createElement('input'), { className: 'fc-auto-input', type: f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : 'text', spellcheck: false });
      if (f.kind === 'number') i.step = 'any';
      i.dataset.f = f.name;
      this.inputs.set(f.name, i);
      grid.appendChild(field(f.label, i));
    }
    const nav = el('div', 'fc-dform-nav');
    for (const [a, label] of [['first', 'First'], ['prev', 'Previous'], ['next', 'Next'], ['last', 'Last']]) {
      const b = el('button', 'fc-btn', label);
      b.type = 'button';
      b.dataset.a = a;
      nav.appendChild(b);
    }
    this.count = el('span', 'fc-dform-count');
    nav.appendChild(this.count);
    const add = el('button', 'fc-btn', 'New');
    add.type = 'button';
    add.dataset.a = 'new';
    const del = el('button', 'fc-btn fc-btn-danger', 'Delete');
    del.type = 'button';
    del.dataset.a = 'delete';
    this.note = el('p', 'fc-note fc-dform-note');
    this.note.setAttribute('aria-live', 'polite');
    this.m.body.append(grid, nav, this.note, actions('Save', () => void this.save(), () => this.m.close(), [add, del], 'Close'));
    this.m.body.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('.fc-dform-nav [data-a], .fc-csv-actions [data-a]')?.dataset.a;
      if (a === 'first') void this.show(0);
      else if (a === 'prev') void this.show(this.i - 1);
      else if (a === 'next') void this.show(this.i + 1);
      else if (a === 'last') void this.show(this.rows.length - 1);
      else if (a === 'new') this.blank();
      else if (a === 'delete') void this.remove();
    });
  }

  async open(): Promise<void> {
    this.m.open(this.inputs.values().next().value ?? null);
    await this.reload();
    await this.show(0);
  }

  private closed(): void {
    this.m.el.remove();
    this.done();
  }

  private say(t: string): void {
    if (this.note.textContent !== t) this.note.textContent = t;
  }

  private select(): string {
    const d = this.def;
    return d.key === 'rowid' ? `select rowid, * from ${quoteName(d.table)} order by rowid` : `select * from ${quoteName(d.table)} order by ${quoteName(d.key)}`;
  }

  private async reload(): Promise<void> {
    const r = await query(this.def.path, this.select());
    this.rows = r.rows.map((row) => Object.fromEntries(r.columns.map((c, k) => [c, row[k]])));
  }

  private paintCount(): void {
    const t = this.fresh ? 'New record' : this.rows.length ? `${this.i + 1} of ${this.rows.length}` : 'No records';
    if (this.count.textContent !== t) this.count.textContent = t;
  }

  private fill(rec: Rec): void {
    for (const f of this.def.fields) {
      const i = this.inputs.get(f.name)!;
      const v = rec[f.name];
      const s = v === null || v === undefined ? '' : String(v);
      if (i.value !== s) i.value = s;
    }
  }

  private async show(i: number): Promise<void> {
    if (!this.rows.length) {
      this.blank();
      return;
    }
    this.i = Math.max(0, Math.min(this.rows.length - 1, i));
    this.fresh = false;
    let rec = { ...this.rows[this.i] };
    if (this.def.onLoad) {
      try {
        rec = (await runHandler(this.host.id(), this.def.onLoad, { type: 'load', today: today() }, rec)).record ?? rec;
      } catch (err) {
        this.say(message(err));
      }
    }
    this.fill(rec);
    this.paintCount();
  }

  private blank(): void {
    this.fresh = true;
    this.fill({});
    this.paintCount();
    this.say('');
    this.inputs.values().next().value?.focus();
  }

  private read(): Rec {
    const out: Rec = {};
    for (const f of this.def.fields) {
      const v = this.inputs.get(f.name)!.value;
      out[f.name] = v === '' ? null : f.kind === 'number' && Number.isFinite(Number(v)) ? Number(v) : v;
    }
    return out;
  }

  private async exec(sql: string, params: Rec): Promise<{ rowcount: number; lastrowid: number }> {
    return (await callCommand('data.dbExec', { path: this.def.path, sql, params })) as { rowcount: number; lastrowid: number };
  }

  private async save(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      let rec = this.read();
      if (this.def.onSave) rec = (await runHandler(this.host.id(), this.def.onSave, { type: 'save', today: today() }, rec)).record ?? rec;
      const d = this.def;
      const cols = d.fields.map((f) => f.name).filter((c) => !(this.fresh && c === d.key && (rec[c] === null || rec[c] === undefined)));
      const params: Rec = {};
      cols.forEach((c, k) => { params[`p${k}`] = rec[c] ?? null; });
      if (this.fresh) {
        const r = await this.exec(`insert into ${quoteName(d.table)} (${cols.map(quoteName).join(', ')}) values (${cols.map((_, k) => `@p${k}`).join(', ')})`, params);
        await this.reload();
        const keyOf = (row: Rec) => (d.key === 'rowid' ? row.rowid : row[d.key]);
        const want = d.key in rec && rec[d.key] !== null ? rec[d.key] : r.lastrowid;
        const at = this.rows.findIndex((row) => String(keyOf(row)) === String(want));
        await this.show(at < 0 ? this.rows.length - 1 : at);
        this.say('Saved a new record.');
      } else {
        params.key = this.rows[this.i][d.key];
        await this.exec(`update ${quoteName(d.table)} set ${cols.map((c, k) => `${quoteName(c)} = @p${k}`).join(', ')} where ${d.key === 'rowid' ? 'rowid' : quoteName(d.key)} = @key`, params);
        await this.reload();
        await this.show(this.i);
        this.say('Saved.');
      }
    } catch (err) {
      this.say(message(err));
    } finally {
      this.busy = false;
    }
  }

  private async remove(): Promise<void> {
    if (this.fresh || !this.rows.length || this.busy) return;
    this.busy = true;
    try {
      const d = this.def;
      await this.exec(`delete from ${quoteName(d.table)} where ${d.key === 'rowid' ? 'rowid' : quoteName(d.key)} = @key`, { key: this.rows[this.i][d.key] });
      await this.reload();
      await this.show(this.i);
      this.say('Deleted.');
    } catch (err) {
      this.say(message(err));
    } finally {
      this.busy = false;
    }
  }
}

export class DataForms {
  readonly store: FormStore;
  private view: FormView | null = null;

  constructor(private readonly h: DataFormsHost) {
    this.store = new FormStore(h);
    registerCommand({ id: 'form.new', title: 'New data form', description: 'Make a data form over a table of a SQLite file: one field per column. Params: table, path (defaults to the workbook database), name, onLoad, onSave (Python handler names).', changes: true, run: (p) => this.create(p ?? {}) });
    registerCommand({ id: 'form.open', title: 'Data Form', description: 'Open a data form to browse, add, change and delete records one at a time. Params: id or name (defaults to the first form).', changes: false, run: (p) => this.open(p ?? {}) });
    registerCommand({ id: 'form.list', title: 'List data forms', description: 'List the data forms of this workbook.', changes: false, run: () => this.store.all().map(({ id, name, path, table, key, onLoad, onSave }) => ({ id, name, path, table, key, onLoad, onSave })) });
    registerCommand({ id: 'form.delete', title: 'Delete a data form', description: 'Delete a data form from this workbook; the database is not changed. Params: id or name.', changes: true, run: (p) => this.remove(p ?? {}) });
  }

  private async tables(path: string): Promise<string[]> {
    const r = await query(path, "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name");
    return r.rows.map((x) => String(x[0]));
  }

  private pickTable(names: string[]): Promise<string> {
    return new Promise((ok) => {
      let chosen = '';
      const m = makeModal('New data form', { onClose: () => { m.el.remove(); ok(chosen); } });
      const sel = Object.assign(document.createElement('select'), { className: 'fc-auto-input' });
      sel.replaceChildren(...names.map((n) => Object.assign(document.createElement('option'), { value: n, textContent: n })));
      m.body.append(field('Table', sel), actions('Create', () => { chosen = sel.value; m.close(); }, () => m.close()));
      m.open(sel);
    });
  }

  async create(p: Rec): Promise<DataFormDef> {
    if (!this.h.id()) throw new Error('Open a workbook first.');
    const path = text(p.path) || text(this.h.setting<string>('dbPath'));
    if (!path) throw new Error('Name a database file with path=/path/to/file.db.');
    const names = await this.tables(path);
    if (!names.length) throw new Error(`${path} has no tables.`);
    const table = text(p.table) || (await this.pickTable(names));
    if (!table) throw new Error('No table was chosen.');
    if (!names.includes(table)) throw new Error(`${path} has no table named ${table}.`);
    const info = await query(path, 'select name, type, pk from pragma_table_info(@t) order by cid', { t: table });
    const cols = info.rows.map((r) => ({ name: String(r[0]), type: String(r[1] ?? ''), pk: Number(r[2]) }));
    const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
    const def: DataFormDef = {
      id: uid(),
      name: text(p.name) || table,
      path,
      table,
      key: pk.length === 1 ? pk[0].name : 'rowid',
      fields: cols.map((c) => ({ name: c.name, label: c.name, kind: kindOf(c.type, c.name) })),
      onLoad: text(p.onLoad),
      onSave: text(p.onSave),
    };
    this.store.put(def);
    this.h.status(`Data form ${def.name} made over ${table}`);
    return def;
  }

  async open(p: Rec): Promise<{ id: string; name: string }> {
    const def = this.store.find(p.id ?? p.name);
    if (!def) throw new Error(this.store.all().length ? 'No data form has that id or name. Run form.list.' : 'This workbook has no data form yet. Run form.new.');
    if (this.view) return { id: def.id, name: def.name };
    this.view = new FormView(this.h, def, () => { this.view = null; });
    void this.view.open().catch((err: unknown) => this.h.status(message(err), true));
    return { id: def.id, name: def.name };
  }

  remove(p: Rec): { deleted: boolean } {
    const def = this.store.find(p.id ?? p.name);
    if (!def || !(p.id ?? p.name)) throw new Error('Name the data form with id= or name=.');
    return { deleted: this.store.remove(def.id) };
  }
}
