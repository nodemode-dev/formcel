import { engine, type Changed, type Shift } from './engine';
import { Grid, type MenuKind, type SheetView } from './grid/grid';
import { listCommands, registerCommand, runCommand } from './ui/commands';
import { Home, type TemplateMeta, type WorkbookMeta } from './ui/home';
import { Menu, type MenuItem } from './ui/menu';
import type { ShellParts } from './ui/shell';

interface Opened {
  id: string;
  book: number;
  title: string;
  sheets: string[];
  views: SheetView[];
}

const TAB_COLOURS = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#94a3b8'];

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.json().then((j: { detail?: string }) => j.detail).catch(() => undefined);
    throw new Error(detail ?? `The engine answered ${r.status}.`);
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}

export class App {
  private readonly home: Home;
  private readonly grid: Grid;
  private open: Opened | null = null;
  private pending = new Map<number, Map<string, [number, number, string]>>();
  private timer = 0;
  private saving: Promise<void> = Promise.resolve();
  private current = '';
  private currentRef = 'A1';
  private readonly menu = new Menu();
  private viewTimers = new Map<number, number>();

  constructor(private readonly p: ShellParts) {
    this.home = new Home(p.home, {
      open: (id) => void this.openWorkbook(id),
      create: (template) => void this.create(template),
      trash: (id) => void this.act(() => api('DELETE', `/api/workbooks/${id}`)),
      restore: (id) => void this.act(() => api('POST', `/api/trash/${id}/restore`)),
      purge: (id) => void this.act(() => api('DELETE', `/api/trash/${id}`)),
    });
    this.grid = new Grid(p.grid, engine(), -1, {
      onActive: (text, ref) => {
        this.current = text;
        this.currentRef = ref;
        if (document.activeElement !== p.nameBox) p.nameBox.value = ref;
        if (document.activeElement !== p.formulaBar) p.formulaBar.value = text;
      },
      onHistory: (undo, redo) => {
        this.button('edit.undo').disabled = !undo;
        this.button('edit.redo').disabled = !redo;
      },
      onChanged: (changes) => this.queueSave(changes),
      onSheet: (sheet) => {
        this.markTab(sheet);
        queueMicrotask(() => this.zoomLabel());
        return this.open?.views[sheet] ?? {};
      },
      onShift: (s) => this.sendShift(s),
      onView: (sheet, view) => this.saveView(sheet, view),
      onMenu: (kind, x, y) => this.cellMenu(kind, x, y),
      onGoto: () => {
        p.nameBox.focus();
        p.nameBox.select();
      },
    });
    this.button('edit.undo').disabled = true;
    this.button('edit.redo').disabled = true;
    this.commands();
    this.bindChrome();
    window.addEventListener('hashchange', () => void this.route());
    window.addEventListener('beforeunload', () => this.flush());
    void this.route();
  }

  private button(cmd: string): HTMLButtonElement {
    return this.p.toolbar.querySelector<HTMLButtonElement>(`[data-cmd="${cmd}"]`)!;
  }

  private commands(): void {
    const g = this.grid;
    const cmd = (id: string, title: string, description: string, changes: boolean, run: () => void | Promise<void>, keys?: string) =>
      registerCommand({ id, title, description, changes, run, keys });
    cmd('edit.undo', 'Undo', 'Undo the last change to the workbook.', true, () => g.undo(), 'Mod+Z');
    cmd('edit.redo', 'Redo', 'Redo the last undone change.', true, () => g.redo(), 'Mod+Y');
    cmd('edit.clear', 'Clear contents', 'Clear the contents of the selected cells.', true, () => g.clearSelection(), 'Delete');
    cmd('view.freeze-top-row', 'Freeze top row', 'Keep row 1 visible while scrolling.', false, () => g.freeze(1, 0));
    cmd('view.freeze-first-column', 'Freeze first column', 'Keep column A visible while scrolling.', false, () => g.freeze(0, 1));
    cmd('view.freeze-panes', 'Freeze panes', 'Keep the rows above and the columns left of the active cell visible.', false, () => g.freezeAtActive());
    cmd('view.unfreeze', 'Unfreeze panes', 'Scroll every row and column again.', false, () => g.freeze(0, 0));
    cmd('file.home', 'Home', 'Save and go to the home screen.', false, () => { location.hash = ''; });
    cmd('file.new', 'New blank workbook', 'Create an empty workbook and open it.', true, () => this.create());
    cmd('sheet.add', 'Add a sheet', 'Add a sheet after the last one and show it.', true, () => this.addSheet());
    cmd('rows.insert-above', 'Insert rows above', 'Insert as many rows as are selected, above the selection.', true, () => g.insert(true), 'Mod++');
    cmd('rows.insert-below', 'Insert rows below', 'Insert as many rows as are selected, below the selection.', true, () => g.insert(true, true));
    cmd('cols.insert-left', 'Insert columns left', 'Insert as many columns as are selected, left of the selection.', true, () => g.insert(false));
    cmd('cols.insert-right', 'Insert columns right', 'Insert as many columns as are selected, right of the selection.', true, () => g.insert(false, true));
    cmd('rows.delete', 'Delete rows', 'Delete the selected rows and move the rows below up.', true, () => g.remove(true), 'Mod+-');
    cmd('cols.delete', 'Delete columns', 'Delete the selected columns and move the columns on the right left.', true, () => g.remove(false));
    cmd('rows.hide', 'Hide rows', 'Hide the selected rows.', false, () => g.hide(true, true), 'Mod+9');
    cmd('rows.unhide', 'Unhide rows', 'Show hidden rows inside the selection.', false, () => g.hide(true, false), 'Mod+Shift+9');
    cmd('cols.hide', 'Hide columns', 'Hide the selected columns.', false, () => g.hide(false, true), 'Mod+0');
    cmd('cols.unhide', 'Unhide columns', 'Show hidden columns inside the selection.', false, () => g.hide(false, false), 'Mod+Shift+0');
    cmd('rows.group', 'Group rows', 'Add the selected rows to an outline group one level deeper, up to 7 levels.', false, () => g.group(true, 1), 'Alt+Shift+Right');
    cmd('rows.ungroup', 'Ungroup rows', 'Take the selected rows out of one outline level.', false, () => g.group(true, -1), 'Alt+Shift+Left');
    cmd('cols.group', 'Group columns', 'Add the selected columns to an outline group one level deeper, up to 7 levels.', false, () => g.group(false, 1));
    cmd('cols.ungroup', 'Ungroup columns', 'Take the selected columns out of one outline level.', false, () => g.group(false, -1));
    cmd('view.zoom-in', 'Zoom in', 'Make the sheet bigger, up to 200%.', false, () => g.zoomStep(1));
    cmd('view.zoom-out', 'Zoom out', 'Make the sheet smaller, down to 50%.', false, () => g.zoomStep(-1));
    cmd('view.zoom-reset', 'Zoom to 100%', 'Show the sheet at its normal size.', false, () => g.setZoom(1));
    cmd('nav.goto', 'Go to', 'Type a cell or range to jump to it.', false, () => { this.p.nameBox.focus(); this.p.nameBox.select(); }, 'F5');
    void api('PUT', '/api/commands', listCommands()).catch(() => undefined);
  }

  private bindChrome(): void {
    const p = this.p;
    p.toolbar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cmd]');
      if (b && !b.disabled) void runCommand(b.dataset.cmd!).then(() => this.grid.focus());
    });
    p.homeBtn.addEventListener('click', () => void runCommand('file.home'));
    p.addSheet.addEventListener('click', () => void runCommand('sheet.add'));
    p.tabs.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-sheet]');
      if (t && this.open && t.contentEditable !== 'true') this.showSheet(Number(t.dataset.sheet));
    });
    p.tabs.addEventListener('dblclick', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-sheet]');
      if (t) this.renameTab(Number(t.dataset.sheet));
    });
    p.tabs.addEventListener('contextmenu', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-sheet]');
      if (!t) return;
      e.preventDefault();
      const i = Number(t.dataset.sheet);
      this.showSheet(i);
      this.tabMenu(i, e.clientX, e.clientY);
    });
    p.zoom.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-zoom]');
      if (b) this.grid.zoomStep(Number(b.dataset.zoom) as 1 | -1);
    });
    p.title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.grid.focus(); }
      if (e.key === 'Escape') { e.preventDefault(); p.title.value = this.open?.title ?? ''; this.grid.focus(); }
    });
    p.title.addEventListener('change', () => {
      const o = this.open;
      const title = p.title.value.trim();
      if (!o || !title || title === o.title) return;
      o.title = title;
      document.title = `${title} · FormCel`;
      void api('PATCH', `/api/workbooks/${o.id}`, { title }).then(() => this.status('Saved'), () => this.status('Name not saved', true));
    });
    p.nameBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const ok = this.grid.goTo(p.nameBox.value);
        p.nameBox.setAttribute('aria-invalid', String(!ok));
        p.nameBox.title = ok ? '' : 'Type a cell like B12 or a range like B2:D9.';
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.grid.focus();
      }
    });
    p.nameBox.addEventListener('blur', () => {
      p.nameBox.removeAttribute('aria-invalid');
      p.nameBox.value = this.currentRef;
    });
    p.formulaBar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.grid.setActive(p.formulaBar.value).then(() => this.grid.focus());
      } else if (e.key === 'Escape') {
        e.preventDefault();
        p.formulaBar.value = this.current;
        this.grid.focus();
      }
    });
  }

  private async route(): Promise<void> {
    const m = /^#w-([a-z0-9]+)$/.exec(location.hash);
    if (m) {
      if (this.open?.id !== m[1]) await this.openWorkbook(m[1], false);
      return;
    }
    this.flush();
    await this.saving;
    this.showHome();
  }

  private showHome(): void {
    const p = this.p;
    this.open = null;
    p.sheet.hidden = true;
    p.home.hidden = false;
    p.homeBtn.hidden = true;
    p.title.hidden = true;
    p.save.hidden = true;
    document.title = 'FormCel';
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const [list, tpl, trash] = await Promise.all([
      api<WorkbookMeta[]>('GET', '/api/workbooks'),
      api<{ categories: { name: string; count: number }[]; templates: TemplateMeta[] }>('GET', '/api/templates'),
      api<WorkbookMeta[]>('GET', '/api/trash'),
    ]);
    this.home.setWorkbooks(list);
    this.home.setTemplates(tpl.categories, tpl.templates);
    this.home.setTrash(trash);
  }

  private async act(fn: () => Promise<unknown>): Promise<void> {
    await fn();
    await this.refresh();
  }

  private async create(template?: string): Promise<void> {
    this.flush();
    const meta = await api<WorkbookMeta>('POST', '/api/workbooks', template ? { template } : {});
    location.hash = `w-${meta.id}`;
  }

  private async openWorkbook(id: string, setHash = true): Promise<void> {
    this.flush();
    await this.saving;
    let doc: WorkbookMeta & { cells: [number, number, string][][]; views?: SheetView[] };
    try {
      doc = await api('GET', `/api/workbooks/${id}`);
    } catch {
      location.hash = '';
      return;
    }
    const e = engine();
    const book = await e.newWorkbook();
    for (let i = 0; i < doc.sheets.length; i++) {
      if (i) await e.addSheet(book, doc.sheets[i]);
      if (doc.cells[i]?.length) await e.load(book, doc.cells[i], i);
    }
    this.open = { id, book, title: doc.title, sheets: doc.sheets, views: doc.sheets.map((_, i) => doc.views?.[i] ?? {}) };
    const p = this.p;
    p.home.hidden = true;
    p.sheet.hidden = false;
    p.homeBtn.hidden = false;
    p.title.hidden = false;
    p.title.value = doc.title;
    p.save.hidden = false;
    this.status('Saved');
    document.title = `${doc.title} · FormCel`;
    this.renderTabs();
    this.showSheet(0);
    this.button('edit.undo').disabled = true;
    this.button('edit.redo').disabled = true;
    this.grid.focus();
    if (setHash && location.hash !== `#w-${id}`) location.hash = `w-${id}`;
  }

  private renderTabs(): void {
    const o = this.open;
    if (!o) return;
    const host = this.p.tabs;
    const have = [...host.children] as HTMLElement[];
    o.sheets.forEach((name, i) => {
      let t = have[i];
      if (!t) {
        t = document.createElement('button');
        t.setAttribute('type', 'button');
        t.className = 'fc-tab';
        t.setAttribute('role', 'tab');
        host.appendChild(t);
      }
      t.dataset.sheet = String(i);
      if (t.textContent !== name) t.textContent = name;
      const colour = o.views[i]?.color;
      if (colour) t.style.setProperty('--tab', colour);
      else t.style.removeProperty('--tab');
    });
    for (const t of have.slice(o.sheets.length)) t.remove();
  }

  private showSheet(i: number): void {
    const o = this.open;
    if (!o) return;
    this.grid.show(o.book, i, o.views[i] ?? {});
    this.markTab(i);
    this.zoomLabel();
    this.grid.focus();
  }

  private zoomLabel(): void {
    const v = `${Math.round(this.grid.zoom * 100)}%`;
    if (this.p.zoomVal.textContent !== v) this.p.zoomVal.textContent = v;
  }

  private saveView(sheet: number, view: SheetView): void {
    const o = this.open;
    if (!o) return;
    o.views[sheet] = view;
    this.zoomLabel();
    window.clearTimeout(this.viewTimers.get(sheet));
    this.viewTimers.set(sheet, window.setTimeout(() => {
      void api('PATCH', `/api/workbooks/${o.id}/sheets/${sheet}`, { view }).catch(() => this.status('View not saved', true));
    }, 500));
  }

  private sendShift(s: Shift): void {
    const o = this.open;
    if (!o) return;
    this.flush();
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        await api('POST', `/api/workbooks/${o.id}/shift`, { sheet: s.sheet, rows: s.rows, at: s.at, n: Math.abs(s.delta), insert: s.delta > 0 });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
  }

  private cellMenu(kind: MenuKind, x: number, y: number): void {
    const g = this.grid;
    const run = (id: string) => () => runCommand(id).then(() => g.focus());
    const items: MenuItem[] = [];
    if (kind !== 'cols') {
      items.push({ label: 'Insert rows above', keys: 'Ctrl++', run: run('rows.insert-above') }, { label: 'Insert rows below', run: run('rows.insert-below') });
    }
    if (kind !== 'rows') {
      items.push({ label: 'Insert columns left', run: run('cols.insert-left') }, { label: 'Insert columns right', run: run('cols.insert-right') });
    }
    items.push({ sep: true });
    if (kind !== 'cols') items.push({ label: 'Delete rows', keys: 'Ctrl+-', run: run('rows.delete'), danger: true });
    if (kind !== 'rows') items.push({ label: 'Delete columns', run: run('cols.delete'), danger: true });
    items.push({ label: 'Clear contents', keys: 'Delete', run: run('edit.clear') }, { sep: true });
    if (kind === 'rows' || kind === 'cells') items.push({ label: 'Hide rows', keys: 'Ctrl+9', run: run('rows.hide') }, { label: 'Unhide rows', keys: 'Ctrl+Shift+9', run: run('rows.unhide') });
    if (kind === 'cols' || kind === 'cells') items.push({ label: 'Hide columns', keys: 'Ctrl+0', run: run('cols.hide') }, { label: 'Unhide columns', keys: 'Ctrl+Shift+0', run: run('cols.unhide') });
    if (kind === 'rows') items.push({ sep: true }, { label: 'Group rows', keys: 'Alt+Shift+Right', run: run('rows.group') }, { label: 'Ungroup rows', keys: 'Alt+Shift+Left', run: run('rows.ungroup') });
    if (kind === 'cols') items.push({ sep: true }, { label: 'Group columns', keys: 'Alt+Shift+Right', run: run('cols.group') }, { label: 'Ungroup columns', keys: 'Alt+Shift+Left', run: run('cols.ungroup') });
    this.menu.show(x, y, items, () => g.focus());
  }

  private tabMenu(i: number, x: number, y: number): void {
    const o = this.open;
    if (!o) return;
    this.menu.show(x, y, [
      { label: 'Rename', run: () => this.renameTab(i) },
      { label: 'Move left', disabled: i === 0, run: () => this.moveSheet(i, i - 1) },
      { label: 'Move right', disabled: i === o.sheets.length - 1, run: () => this.moveSheet(i, i + 1) },
      { sep: true },
      { swatches: TAB_COLOURS, current: o.views[i]?.color ?? '', pick: (c) => this.colourSheet(i, c) },
      { sep: true },
      { label: 'Delete sheet', danger: true, disabled: o.sheets.length === 1, confirm: 'Click again to delete this sheet', run: () => this.deleteSheet(i) },
    ]);
  }

  private renameTab(i: number): void {
    const o = this.open;
    const t = this.p.tabs.querySelector<HTMLElement>(`[data-sheet="${i}"]`);
    if (!o || !t) return;
    const before = o.sheets[i];
    t.contentEditable = 'true';
    t.focus();
    document.getSelection()?.selectAllChildren(t);
    const done = (commit: boolean) => {
      t.removeEventListener('keydown', onKey);
      t.removeEventListener('blur', onBlur);
      t.contentEditable = 'false';
      const name = (t.textContent ?? '').replace(/[\\/?*[\]:]/g, '').trim().slice(0, 31);
      if (!commit || !name || name === before || o.sheets.includes(name)) {
        t.textContent = before;
      } else {
        o.sheets[i] = name;
        t.textContent = name;
        void engine().renameSheet(o.book, i, name);
        void api('PATCH', `/api/workbooks/${o.id}/sheets/${i}`, { name }).catch(() => this.status('Name not saved', true));
      }
      this.grid.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
    };
    const onBlur = () => done(true);
    t.addEventListener('keydown', onKey);
    t.addEventListener('blur', onBlur);
  }

  private async moveSheet(from: number, to: number): Promise<void> {
    const o = this.open;
    if (!o) return;
    this.flush();
    await this.saving;
    await engine().moveSheet(o.book, from, to);
    await api('POST', `/api/workbooks/${o.id}/sheets/${from}/move`, { to });
    o.sheets.splice(to, 0, o.sheets.splice(from, 1)[0]);
    o.views.splice(to, 0, o.views.splice(from, 1)[0]);
    this.renderTabs();
    this.showSheet(to);
    this.button('edit.undo').disabled = true;
    this.button('edit.redo').disabled = true;
  }

  private colourSheet(i: number, colour: string): void {
    const o = this.open;
    if (!o) return;
    o.views[i] = { ...(o.views[i] ?? {}), color: colour || undefined };
    this.renderTabs();
    if (this.grid.sheetIndex === i) this.grid.setColor(colour || undefined);
    void api('PATCH', `/api/workbooks/${o.id}/sheets/${i}`, { view: { color: colour || null } }).catch(() => this.status('Colour not saved', true));
  }

  private async deleteSheet(i: number): Promise<void> {
    const o = this.open;
    if (!o || o.sheets.length === 1) return;
    this.flush();
    await this.saving;
    await engine().deleteSheet(o.book, i);
    await api('DELETE', `/api/workbooks/${o.id}/sheets/${i}`);
    o.sheets.splice(i, 1);
    o.views.splice(i, 1);
    this.renderTabs();
    this.showSheet(Math.min(i, o.sheets.length - 1));
    this.button('edit.undo').disabled = true;
    this.button('edit.redo').disabled = true;
  }

  private markTab(sheet: number): void {
    for (const t of this.p.tabs.children) t.setAttribute('aria-selected', String((t as HTMLElement).dataset.sheet === String(sheet)));
  }

  private async addSheet(): Promise<void> {
    const o = this.open;
    if (!o) return;
    let n = o.sheets.length + 1;
    while (o.sheets.includes(`Sheet${n}`)) n++;
    const name = `Sheet${n}`;
    await api('POST', `/api/workbooks/${o.id}/sheets`, { name });
    const i = await engine().addSheet(o.book, name);
    o.sheets.push(name);
    o.views.push({});
    this.renderTabs();
    this.showSheet(i);
  }

  private status(text: string, error = false): void {
    this.p.saveText.nodeValue = text;
    this.p.save.dataset.state = error ? 'error' : 'ok';
  }

  private queueSave(changes: Changed[]): void {
    for (const [s, r, c, t] of changes) {
      let m = this.pending.get(s);
      if (!m) this.pending.set(s, (m = new Map()));
      m.set(`${r}:${c}`, [r, c, t]);
    }
    this.status('Saving');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), 400);
  }

  private flush(): void {
    window.clearTimeout(this.timer);
    const o = this.open;
    if (!o || !this.pending.size) return;
    const batches = [...this.pending.entries()];
    this.pending = new Map();
    this.saving = this.saving.then(async () => {
      try {
        for (const [sheet, m] of batches) await api('POST', `/api/workbooks/${o.id}/cells`, { sheet, cells: [...m.values()] });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        for (const [sheet, m] of batches) {
          const cur = this.pending.get(sheet) ?? new Map();
          for (const [k, v] of m) if (!cur.has(k)) cur.set(k, v);
          this.pending.set(sheet, cur);
        }
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? `${err.message} FormCel tries again on your next change.` : '';
      }
    });
  }
}
