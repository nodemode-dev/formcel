import { engine, type Changed } from './engine';
import { Grid } from './grid/grid';
import { listCommands, registerCommand, runCommand } from './ui/commands';
import { Home, type TemplateMeta, type WorkbookMeta } from './ui/home';
import type { ShellParts } from './ui/shell';

interface Opened {
  id: string;
  book: number;
  title: string;
  sheets: string[];
}

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
      onSheet: (sheet) => this.markTab(sheet),
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
      if (t && this.open) {
        const i = Number(t.dataset.sheet);
        this.grid.show(this.open.book, i);
        this.markTab(i);
        this.grid.focus();
      }
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
    let doc: WorkbookMeta & { cells: [number, number, string][][] };
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
    this.open = { id, book, title: doc.title, sheets: doc.sheets };
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
    this.grid.show(book, 0);
    this.markTab(0);
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
    });
    for (const t of have.slice(o.sheets.length)) t.remove();
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
    this.renderTabs();
    this.grid.show(o.book, i);
    this.markTab(i);
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
