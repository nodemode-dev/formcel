import type { Changed, EngineClient, NameRow } from '../engine';
import type { Grid } from '../grid/grid';
import { colName, type Range } from '../grid/a1';
import { actions, el, field, makeModal, type Modal } from './modal';

export interface NamesHost {
  grid: Grid;
  engine: EngineClient;
  book(): number | null;
  sheets(): string[];
  selection(): Range;
  sheet(): number;
  refreshNames(): Promise<void>;
  sync(op: 'comment' | 'rename' | 'select' | 'apply', args: string[]): Promise<void>;
  syncName(name: string, refers: string): Promise<void>;
  say(text: string, bad?: boolean): void;
}

type Row = NameRow & { table: boolean };

const FILTERS: [string, string][] = [
  ['all', 'All names'],
  ['sheet', 'Names scoped to worksheet'],
  ['book', 'Names scoped to workbook'],
  ['errors', 'Names with errors'],
  ['ok', 'Names without errors'],
  ['defined', 'Defined names'],
  ['tables', 'Table names'],
];

export function wireArgs(args: string[]): string {
  return args.map((a) => a.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r')).join('\t');
}

function quoted(name: string): string {
  return /^[\p{L}\p{N}_]+$/u.test(name) && !/^\d/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

function absRange(r: Range): string {
  const cell = (row: number, col: number) => `$${colName(col)}$${row + 1}`;
  return r.r0 === r.r1 && r.c0 === r.c1 ? cell(r.r0, r.c0) : `${cell(r.r0, r.c0)}:${cell(r.r1, r.c1)}`;
}

function fullName(r: { name: string; scope: string }): string {
  return r.scope ? `${quoted(r.scope)}!${r.name}` : r.name;
}

function button(text: string, cls = 'fc-btn'): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  return b;
}

export class Names {
  private manager: Modal | null = null;
  private rows: Row[] = [];
  private picked = '';
  private body!: HTMLTableSectionElement;
  private empty!: HTMLElement;
  private filter!: HTMLSelectElement;
  private search!: HTMLInputElement;
  private refers!: HTMLInputElement;
  private note!: HTMLElement;
  private del!: HTMLButtonElement;
  private edit!: HTMLButtonElement;
  private trs = new Map<string, HTMLTableRowElement>();
  private armed = false;
  private target: HTMLInputElement | HTMLTextAreaElement | null = null;

  constructor(private readonly host: NamesHost) {}

  private get book(): number {
    return this.host.book() ?? -1;
  }

  private async load(): Promise<void> {
    if (this.book < 0) return;
    const rows = (await this.host.engine.nameRows(this.book)).map((r): Row => ({ ...r, table: false }));
    const sheets = this.host.sheets();
    for (const t of this.host.grid.tables()) {
      const area = { r0: t.area[0], c0: t.area[1], r1: t.area[2], c1: t.area[3] };
      rows.push({ name: t.name, scope: '', refers: `=${quoted(sheets[t.sheet] ?? '')}!${absRange(area)}`, comment: '', value: '', table: true });
    }
    this.rows = rows;
  }

  private visible(): Row[] {
    const f = this.filter?.value ?? 'all';
    const q = (this.search?.value ?? '').trim().toLowerCase();
    return this.rows.filter((r) => {
      const bad = r.value.startsWith('#');
      const ok =
        f === 'all' ||
        (f === 'sheet' && r.scope !== '') ||
        (f === 'book' && r.scope === '') ||
        (f === 'errors' && bad) ||
        (f === 'ok' && !bad) ||
        (f === 'defined' && !r.table) ||
        (f === 'tables' && r.table);
      return ok && (!q || r.name.toLowerCase().includes(q) || r.refers.toLowerCase().includes(q) || r.comment.toLowerCase().includes(q));
    });
  }

  private paint(): void {
    const list = this.visible();
    const keep = new Set<string>();
    list.forEach((r, i) => {
      const k = `${r.table ? 't' : 'n'}:${fullName(r)}`;
      keep.add(k);
      let tr = this.trs.get(k);
      if (!tr) {
        tr = document.createElement('tr');
        tr.dataset.k = k;
        tr.append(...[0, 1, 2, 3, 4].map(() => document.createElement('td')));
        this.trs.set(k, tr);
      }
      const cells = [r.name, r.table ? '' : r.value, r.refers, r.scope || 'Workbook', r.comment];
      cells.forEach((t, j) => {
        const td = tr!.children[j] as HTMLElement;
        if (td.textContent !== t) {
          td.textContent = t;
          td.title = t;
        }
      });
      tr.setAttribute('aria-selected', String(k === this.picked));
      if (this.body.children[i] !== tr) this.body.insertBefore(tr, this.body.children[i] ?? null);
    });
    for (const [k, tr] of this.trs) {
      if (!keep.has(k)) {
        tr.remove();
        this.trs.delete(k);
      }
    }
    if (this.picked && !keep.has(this.picked)) this.pick('');
    this.empty.hidden = list.length > 0;
  }

  private current(): Row | undefined {
    return this.rows.find((r) => `${r.table ? 't' : 'n'}:${fullName(r)}` === this.picked);
  }

  private pick(k: string): void {
    this.picked = k;
    this.armed = false;
    for (const [key, tr] of this.trs) tr.setAttribute('aria-selected', String(key === k));
    const r = this.current();
    this.refers.value = r && !r.table ? r.refers : '';
    this.refers.disabled = !r || r.table;
    this.edit.disabled = !r;
    this.del.disabled = !r;
    this.del.textContent = 'Delete';
    this.note.textContent = '';
  }

  private fail(err: unknown): void {
    this.note.textContent = err instanceof Error ? err.message : String(err);
    this.note.dataset.state = 'error';
  }

  private async define(full: string, refers: string): Promise<void> {
    this.host.grid.patch(await this.host.engine.defineName(this.book, full, refers));
    await this.host.syncName(full, refers);
  }

  private async afterChange(): Promise<void> {
    await this.host.refreshNames();
    await this.load();
    this.paint();
  }

  open(): void {
    if (this.book < 0) return;
    const m = (this.manager ??= this.makeManager());
    void this.load().then(() => {
      this.paint();
      this.pick(this.picked);
    });
    m.open(this.search);
  }

  private makeManager(): Modal {
    const m = makeModal('Name Manager', { wide: true });
    m.el.classList.add('fc-names');
    const bar = el('div', 'fc-names-bar');
    const add = button('New...');
    this.edit = button('Edit...');
    this.del = button('Delete');
    this.filter = el('select', 'fc-fmt-input');
    this.filter.setAttribute('aria-label', 'Filter');
    for (const [v, t] of FILTERS) this.filter.append(new Option(t, v));
    this.search = el('input', 'fc-fmt-input');
    this.search.type = 'search';
    this.search.placeholder = 'Search names';
    this.search.setAttribute('aria-label', 'Search names');
    this.search.spellcheck = false;
    bar.append(add, this.edit, this.del, this.filter, this.search);
    const wrap = el('div', 'fc-names-list');
    const table = el('table', 'fc-watch-table fc-names-table');
    table.innerHTML = '<thead><tr><th>Name</th><th>Value</th><th>Refers to</th><th>Scope</th><th>Comment</th></tr></thead><tbody></tbody>';
    this.body = table.querySelector('tbody')!;
    this.empty = el('div', 'fc-watch-empty', 'No names match. Select cells and use New, or type a name in the Name Box.');
    wrap.append(table, this.empty);
    this.refers = el('input', 'fc-fmt-input');
    this.refers.spellcheck = false;
    this.refers.setAttribute('aria-label', 'Refers to');
    const accept = button('Apply');
    const cancel = button('Cancel');
    const refRow = el('div', 'fc-names-refers');
    refRow.append(field('Refers to', this.refers), cancel, accept);
    this.note = el('p', 'fc-fmt-hint');
    this.note.setAttribute('role', 'status');
    const fromSel = button('Create from selection...');
    const apply = button('Apply names...');
    const paste = button('Paste list');
    const foot = actions('Close', () => m.close(), () => m.close(), [fromSel, apply, paste], '');
    m.body.append(bar, wrap, refRow, this.note, foot);
    this.pick('');

    this.body.addEventListener('click', (e) => {
      const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr');
      if (tr?.dataset.k) this.pick(tr.dataset.k);
    });
    this.body.addEventListener('dblclick', () => void this.editDialog(this.current()));
    this.filter.addEventListener('change', () => this.paint());
    this.search.addEventListener('input', () => this.paint());
    add.addEventListener('click', () => void this.editDialog());
    this.edit.addEventListener('click', () => void this.editDialog(this.current()));
    this.del.addEventListener('click', () => {
      const r = this.current();
      if (!r) return;
      if (r.table) {
        this.fail(new Error('Delete a table from the Table menu.'));
        return;
      }
      if (!this.armed) {
        this.armed = true;
        this.del.textContent = 'Click again to delete';
        return;
      }
      this.armed = false;
      this.del.textContent = 'Delete';
      void this.define(fullName(r), '').then(() => this.afterChange(), (err: unknown) => this.fail(err));
    });
    const commit = () => {
      const r = this.current();
      if (!r || r.table) return;
      void this.define(fullName(r), this.refers.value).then(() => this.afterChange(), (err: unknown) => this.fail(err));
    };
    accept.addEventListener('click', commit);
    cancel.addEventListener('click', () => {
      const r = this.current();
      this.refers.value = r && !r.table ? r.refers : '';
    });
    this.refers.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
    });
    fromSel.addEventListener('click', () => this.fromSelection());
    apply.addEventListener('click', () => this.applyDialog());
    paste.addEventListener('click', () => void this.pasteList().then(() => m.close()));
    return m;
  }

  private editModal: { m: Modal; name: HTMLInputElement; scope: HTMLSelectElement; comment: HTMLTextAreaElement; refers: HTMLInputElement; hint: HTMLElement; ok: HTMLButtonElement; title: HTMLElement } | null = null;
  private editing: Row | null = null;

  private async editDialog(row?: Row): Promise<void> {
    if (row?.table) {
      this.fail(new Error('Edit a table from the Table menu.'));
      return;
    }
    const box = (this.editModal ??= this.makeEdit());
    this.editing = row ?? null;
    box.title.textContent = row ? 'Edit Name' : 'New Name';
    const sheets = this.host.sheets();
    box.scope.replaceChildren(new Option('Workbook', ''), ...sheets.map((s) => new Option(s, s)));
    box.name.value = row?.name ?? '';
    box.scope.value = row?.scope ?? '';
    box.scope.disabled = !!row;
    box.comment.value = row?.comment ?? '';
    box.refers.value = row?.refers ?? `=${quoted(sheets[this.host.sheet()] ?? '')}!${absRange(this.host.selection())}`;
    box.hint.textContent = '';
    box.m.open(box.name);
  }

  private makeEdit() {
    const m = makeModal('New Name');
    const title = m.el.querySelector<HTMLElement>('h2')!;
    const name = el('input', 'fc-fmt-input');
    name.spellcheck = false;
    name.autocomplete = 'off';
    name.maxLength = 255;
    const scope = el('select', 'fc-fmt-input');
    const comment = el('textarea', 'fc-fmt-input');
    comment.rows = 2;
    comment.maxLength = 255;
    const refers = el('input', 'fc-fmt-input');
    refers.spellcheck = false;
    const hint = el('p', 'fc-fmt-hint');
    hint.setAttribute('role', 'status');
    const use = button('Use selection');
    const row = el('div', 'fc-names-refers');
    row.append(field('Refers to', refers), use);
    const done = actions('OK', () => void submit(), () => m.close());
    const ok = done.querySelector<HTMLButtonElement>('.fc-btn-primary')!;
    m.body.append(field('Name', name), field('Scope', scope), field('Comment', comment), row, hint, done);
    const submit = async () => {
      const row0 = this.editing;
      const nm = name.value.trim();
      const target = row0 ? { name: row0.name, scope: row0.scope } : { name: nm, scope: scope.value };
      try {
        if (row0 && nm !== row0.name) {
          this.host.grid.patch(await this.host.engine.renameName(this.book, fullName(row0), fullName({ name: nm, scope: row0.scope })));
          await this.host.sync('rename', [fullName(row0), fullName({ name: nm, scope: row0.scope })]);
          target.name = nm;
        }
        if (!row0 || refers.value.trim() !== row0.refers) await this.define(fullName(target), refers.value.trim());
        if (comment.value !== (row0?.comment ?? '')) {
          await this.host.engine.nameComment(this.book, fullName(target), comment.value);
          await this.host.sync('comment', [fullName(target), comment.value]);
        }
        m.close();
        await this.afterChange();
        this.pick(`n:${fullName(target)}`);
      } catch (err) {
        hint.textContent = err instanceof Error ? err.message : String(err);
        hint.dataset.state = 'error';
      }
    };
    use.addEventListener('click', () => {
      refers.value = `=${quoted(this.host.sheets()[this.host.sheet()] ?? '')}!${absRange(this.host.selection())}`;
    });
    m.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target !== comment) {
        e.preventDefault();
        void submit();
      }
    });
    return { m, name, scope, comment, refers, hint, ok, title };
  }

  private fromModal: { m: Modal; boxes: Record<'top' | 'left' | 'bottom' | 'right', HTMLInputElement>; replace: HTMLInputElement; hint: HTMLElement } | null = null;

  async createFromSelection(): Promise<void> {
    if (this.book < 0) return;
    const box = (this.fromModal ??= this.makeFrom());
    const s = this.host.selection();
    const cells = await this.host.engine.read(this.book, s.r0, s.c0, s.r1, s.c1, this.host.sheet());
    const text = (r: number, c: number) => cells.find((x) => x[0] === r && x[1] === c)?.[2] ?? '';
    const label = (v: string) => v !== '' && Number.isNaN(Number(v));
    let top = true;
    for (let c = s.c0; c <= s.c1; c++) if (!label(text(s.r0, c)) && text(s.r0, c) !== '') top = false;
    box.boxes.top.checked = top && s.r1 > s.r0;
    box.boxes.left.checked = !box.boxes.top.checked && s.c1 > s.c0;
    box.boxes.bottom.checked = false;
    box.boxes.right.checked = false;
    box.replace.checked = false;
    box.hint.textContent = '';
    box.m.open(box.boxes.top);
  }

  private fromSelection(): void {
    void this.createFromSelection();
  }

  private makeFrom() {
    const m = makeModal('Create Names from Selection');
    const boxes = {} as Record<'top' | 'left' | 'bottom' | 'right', HTMLInputElement>;
    const group = el('div', 'fc-fmt-parts');
    for (const [k, t] of [['top', 'Top row'], ['left', 'Left column'], ['bottom', 'Bottom row'], ['right', 'Right column']] as const) {
      const l = el('label');
      const i = el('input');
      i.type = 'checkbox';
      boxes[k] = i;
      l.append(i, ` ${t}`);
      group.append(l);
    }
    const replace = el('input');
    replace.type = 'checkbox';
    const rl = el('label');
    rl.append(replace, ' Replace names that already exist');
    const hint = el('p', 'fc-fmt-hint');
    hint.setAttribute('role', 'status');
    m.body.append(el('p', 'fc-fmt-hint', 'Create names from the labels in the selected cells.'), group, rl, hint, actions('OK', () => void go(), () => m.close()));
    const go = async () => {
      const s = this.host.selection();
      const edges = { top: boxes.top.checked, left: boxes.left.checked, bottom: boxes.bottom.checked, right: boxes.right.checked };
      if (!Object.values(edges).some(Boolean)) {
        hint.textContent = 'Check at least one of the edges that holds labels.';
        hint.dataset.state = 'error';
        return;
      }
      try {
        const area: [number, number, number, number] = [s.r0, s.c0, s.r1, s.c1];
        const res = await this.host.engine.namesFromSelection(this.book, this.host.sheet(), area, edges, replace.checked);
        await this.host.sync('select', [String(this.host.sheet()), ...area.map(String), [edges.top, edges.left, edges.bottom, edges.right, replace.checked].map((b) => (b ? '1' : '0')).join('')]);
        m.close();
        await this.host.refreshNames();
        await this.load();
        if (this.manager?.isOpen()) this.paint();
        this.host.say(`Created ${res.made.length} ${res.made.length === 1 ? 'name' : 'names'}${res.skipped.length ? `; left out ${res.skipped.length} (already used or not valid names)` : ''}.`, res.made.length === 0);
      } catch (err) {
        hint.textContent = err instanceof Error ? err.message : String(err);
        hint.dataset.state = 'error';
      }
    };
    return { m, boxes, replace, hint };
  }

  private applyModal: { m: Modal; list: HTMLElement; ignore: HTMLInputElement; hint: HTMLElement } | null = null;

  applyDialog(): void {
    if (this.book < 0) return;
    const box = (this.applyModal ??= this.makeApply());
    void this.load().then(() => {
      box.list.replaceChildren(
        ...this.rows
          .filter((r) => !r.table && /^=('?[^'!]+'?)!\$[A-Z]+\$\d+(:\$[A-Z]+\$\d+)?$/.test(r.refers))
          .map((r) => {
            const l = el('label', 'fc-names-pick');
            const i = el('input');
            i.type = 'checkbox';
            i.value = fullName(r);
            l.append(i, ` ${r.name}`, el('span', 'fc-fmt-hint', ` ${r.refers}`));
            return l;
          }),
      );
      if (!box.list.children.length) box.list.append(el('div', 'fc-watch-empty', 'No names refer to a cell or a range yet.'));
      box.hint.textContent = '';
      box.m.open(box.list.querySelector<HTMLElement>('input'));
    });
  }

  private makeApply() {
    const m = makeModal('Apply Names');
    const list = el('div', 'fc-names-picks');
    const ignore = el('input');
    ignore.type = 'checkbox';
    ignore.checked = true;
    const il = el('label');
    il.append(ignore, ' Ignore relative and absolute');
    const hint = el('p', 'fc-fmt-hint');
    hint.setAttribute('role', 'status');
    m.body.append(el('p', 'fc-fmt-hint', 'Replace cell references in formulas with the names that point at them. Formulas in the selection are changed; with one cell selected, the whole sheet is.'), list, il, hint, actions('OK', () => void go(), () => m.close()));
    const go = async () => {
      const names = [...list.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
      if (!names.length) {
        hint.textContent = 'Pick at least one name.';
        hint.dataset.state = 'error';
        return;
      }
      const s = this.host.selection();
      const single = s.r0 === s.r1 && s.c0 === s.c1;
      const area: [number, number, number, number] = single ? [0, 0, 1048575, 16383] : [s.r0, s.c0, s.r1, s.c1];
      try {
        const res = await this.host.engine.applyNames(this.book, { sheet: this.host.sheet(), area }, names, ignore.checked);
        this.host.grid.patch(res.changed);
        await this.host.sync('apply', [String(this.host.sheet()), '1', ...area.map(String), ignore.checked ? '1' : '0', ...names]);
        m.close();
        this.host.say(res.count ? `Applied names in ${res.count} ${res.count === 1 ? 'formula' : 'formulas'}.` : 'No formula held a reference to those names.');
        this.host.grid.focus();
      } catch (err) {
        hint.textContent = err instanceof Error ? err.message : String(err);
        hint.dataset.state = 'error';
      }
    };
    return { m, list, ignore, hint };
  }

  private async pasteList(): Promise<void> {
    if (this.book < 0) return;
    await this.load();
    const s = this.host.selection();
    const rows = this.rows.filter((r) => !r.table);
    if (!rows.length) {
      this.host.say('There are no names to list.', true);
      return;
    }
    const edits = rows.flatMap((r, i): [number, number, string][] => [
      [s.r0 + i, s.c0, `'${fullName(r)}`],
      [s.r0 + i, s.c0 + 1, `'${r.refers}`],
    ]);
    const changed: Changed[] = await this.host.engine.apply(this.book, edits, this.host.sheet());
    await this.host.grid.commitEdits(changed);
    this.host.say(`Listed ${rows.length} ${rows.length === 1 ? 'name' : 'names'}.`);
  }

  private pasteModal: { m: Modal; list: HTMLSelectElement } | null = null;

  pasteName(): void {
    if (this.book < 0) return;
    const active = document.activeElement;
    this.target = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
    const box = (this.pasteModal ??= this.makePaste());
    void this.load().then(() => {
      box.list.replaceChildren(...this.rows.map((r) => new Option(`${r.name}${r.scope ? ` (${r.scope})` : ''}  ${r.refers}`, r.name)));
      box.m.open(box.list);
    });
  }

  private makePaste() {
    const m = makeModal('Paste Name');
    const list = el('select', 'fc-fmt-input fc-names-paste');
    list.size = 10;
    list.setAttribute('aria-label', 'Names');
    const go = () => {
      const name = list.value;
      if (!name) return;
      m.close();
      this.insert(name);
    };
    const every = button('Paste list');
    every.addEventListener('click', () => void this.pasteList().then(() => m.close()));
    m.body.append(list, actions('Paste', go, () => m.close(), [every]));
    list.addEventListener('dblclick', go);
    list.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        go();
      }
    });
    return { m, list };
  }

  private insert(name: string): void {
    const f = this.target;
    const grid = this.host.grid;
    if (f && document.contains(f) && (f === grid.editor || f.classList.contains('fc-fbar'))) {
      f.focus();
      const v = f.value;
      const [a, b] = [(f as HTMLInputElement).selectionStart ?? v.length, (f as HTMLInputElement).selectionEnd ?? v.length];
      const head = v.startsWith('=') ? v.slice(0, a) : '=';
      f.value = head + name + (v.startsWith('=') ? v.slice(b) : '');
      const pos = head.length + name.length;
      (f as HTMLInputElement).setSelectionRange(pos, pos);
      f.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    grid.startEdit(`=${name}`);
  }
}
