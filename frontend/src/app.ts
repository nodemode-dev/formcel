import { engine, type Area, type Changed, type FormatChange, type Name, type Shift } from './engine';
import { colName, type Range } from './grid/a1';
import { Autocomplete, FUNCTIONS, type Suggestion } from './ui/autocomplete';
import { Grid, type BorderKind, type MenuKind, type SheetView } from './grid/grid';
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
  names: Name[];
}

function sheetPrefix(name: string): string {
  return /^[\p{L}\p{N}_]+$/u.test(name) && !/^\d/.test(name) ? `${name}!` : `'${name.replace(/'/g, "''")}'!`;
}

function absRange(r: Range): string {
  const cell = (row: number, col: number) => `$${colName(col)}$${row + 1}`;
  return r.r0 === r.r1 && r.c0 === r.c1 ? cell(r.r0, r.c0) : `${cell(r.r0, r.c0)}:${cell(r.r1, r.c1)}`;
}

const NUMBER_FORMATS: { id: string; label: string; description: string; code: string; keys?: string }[] = [
  { id: 'general', label: 'General', description: 'Show numbers as typed, with no set format.', code: '', keys: 'Mod+Shift+~' },
  { id: 'number', label: 'Number', description: 'Two decimal places, a thousands separator and a minus sign for negatives.', code: '#,##0.00', keys: 'Mod+Shift+!' },
  { id: 'currency', label: 'Currency', description: 'Dollars with two decimal places, negatives in parentheses.', code: '$#,##0.00_);($#,##0.00)', keys: 'Mod+Shift+$' },
  { id: 'accounting', label: 'Accounting', description: 'Dollar signs lined up at the left edge, zero as a dash.', code: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)' },
  { id: 'percent', label: 'Percent', description: 'Multiply by 100 and show a percent sign, no decimal places.', code: '0%', keys: 'Mod+Shift+%' },
  { id: 'scientific', label: 'Scientific', description: 'Exponent notation with two decimal places.', code: '0.00E+00', keys: 'Mod+Shift+^' },
  { id: 'fraction', label: 'Fraction', description: 'A whole number and a fraction of up to one digit.', code: '# ?/?' },
  { id: 'date-short', label: 'Short date', description: 'Month, day and four-digit year.', code: 'm/d/yyyy' },
  { id: 'date-day', label: 'Day, month, year', description: 'Day, short month name and two-digit year.', code: 'd-mmm-yy', keys: 'Mod+Shift+#' },
  { id: 'date-long', label: 'Long date', description: 'Weekday, month name, day and year.', code: 'dddd, mmmm d, yyyy' },
  { id: 'time', label: 'Time', description: 'Hour and minute with AM or PM.', code: 'h:mm AM/PM', keys: 'Mod+Shift+@' },
  { id: 'time-long', label: 'Time with seconds', description: 'Hour, minute and second with AM or PM.', code: 'h:mm:ss AM/PM' },
  { id: 'text', label: 'Text', description: 'Keep what is typed as text, even numbers and formulas.', code: '@' },
];

const FONTS = ['', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'JetBrains Mono'];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
const CELL_COLOURS = ['', '#000000', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#94a3b8'];
const BORDER_KINDS: [BorderKind, string][] = [
  ['all', 'All borders'], ['outside', 'Outside borders'], ['inside', 'Inside borders'], ['top', 'Top border'],
  ['bottom', 'Bottom border'], ['left', 'Left border'], ['right', 'Right border'], ['none', 'No border'],
];
const ROTATIONS: [string, string][] = [
  ['None', 'rot:'], ['Angle counterclockwise', 'rot:45'], ['Angle clockwise', 'rot:-45'], ['Vertical text', 'rot:v'], ['Rotate text up', 'rot:90'], ['Rotate text down', 'rot:-90'],
];

function rotationLabel(st: { rot: number; vertical: boolean }): string {
  if (st.vertical) return 'Vertical text';
  return ROTATIONS.find(([, p]) => p === `rot:${st.rot}`)?.[0] ?? (st.rot ? `${st.rot} degrees` : '');
}

const LINES: [string, string][] = [['thin', 'Thin'], ['medium', 'Medium'], ['thick', 'Thick'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double']];

function bumpCode(code: string, shown: string, dir: 1 | -1): string {
  if (!code || code.toLowerCase() === 'general') {
    const d = Math.max(0, (/\.(\d+)/.exec(shown)?.[1].length ?? 0) + dir);
    return d ? `0.${'0'.repeat(d)}` : '0';
  }
  return code.split(';').map((sec) => {
    const e = sec.search(/[Ee][+-]/);
    const head = e < 0 ? sec : sec.slice(0, e);
    const tail = e < 0 ? '' : sec.slice(e);
    const m = /\.([0#?]+)/.exec(head);
    if (m) {
      const n = m[1].length + dir;
      return head.slice(0, m.index) + (n > 0 ? `.${'0'.repeat(n)}` : '') + head.slice(m.index + m[0].length) + tail;
    }
    if (dir < 0) return sec;
    const last = Math.max(head.lastIndexOf('0'), head.lastIndexOf('#'), head.lastIndexOf('?'));
    return last < 0 ? sec : head.slice(0, last + 1) + '.0' + head.slice(last + 1) + tail;
  }).join(';');
}

const TAB_COLOURS =['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#94a3b8'];

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
  private currentRange: Range = { r0: 0, c0: 0, r1: 0, c1: 0 };
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
      onActive: (text, ref, range) => {
        this.current = text;
        this.currentRange = range;
        this.currentRef = this.nameOf(range) ?? ref;
        if (document.activeElement !== p.nameBox) p.nameBox.value = this.currentRef;
        if (document.activeElement !== p.formulaBar) p.formulaBar.value = text;
        this.formatBar();
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
      onFormats: (f) => this.sendFormats(f),
      onStyles: (s) => this.sendFormats(s, 'styles'),
      onMerges: (sheet, areas) => this.sendMerges(sheet, areas),
      onPainter: (state) => this.button('format.painter').setAttribute('aria-pressed', String(state !== 'off')),
      onView: (sheet, view) => this.saveView(sheet, view),
      onMenu: (kind, x, y) => this.cellMenu(kind, x, y),
      onGoto: () => {
        p.nameBox.focus();
        p.nameBox.select();
      },
    });
    const suggestions = (): Suggestion[] => [...FUNCTIONS, ...(this.open?.names ?? []).map(([name, refers]): Suggestion => ({ name, kind: 'name', summary: refers }))];
    new Autocomplete(p.formulaBar, suggestions);
    const cellAc = new Autocomplete(this.grid.editor, suggestions);
    this.grid.editorHook = (e) => cellAc.take(e);
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
    cmd('view.split', 'Split panes', 'Split the sheet above and left of the active cell into panes that scroll on their own, or remove the split. Drag a split bar to move it, double-click it to remove it.', false, () => g.toggleSplit());
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
    cmd('format.menu', 'Number format', 'Choose how the selected cells show numbers, dates and times.', true, () => this.formatMenu());
    cmd('format.decimals-more', 'Increase decimal places', 'Show one more decimal place in the selected cells.', true, () => this.bumpDecimals(1));
    cmd('format.decimals-less', 'Decrease decimal places', 'Show one fewer decimal place in the selected cells.', true, () => this.bumpDecimals(-1));
    cmd('format.custom', 'Custom number format', 'Type a number format code for the selected cells.', true, () => this.customFormat());
    for (const f of NUMBER_FORMATS) cmd(`format.${f.id}`, f.label, f.description, true, () => g.setFormat(f.code), f.keys);
    cmd('format.bold', 'Bold', 'Make the selected cells bold, or not bold.', true, () => g.toggle('b'), 'Mod+B');
    cmd('format.italic', 'Italic', 'Make the selected cells italic, or not italic.', true, () => g.toggle('i'), 'Mod+I');
    cmd('format.underline', 'Underline', 'Underline the selected cells, or remove the underline.', true, () => g.toggle('u'), 'Mod+U');
    cmd('format.strike', 'Strikethrough', 'Strike through the selected cells, or remove it.', true, () => g.toggle('s'), 'Mod+5');
    cmd('format.wrap', 'Wrap text', 'Wrap text onto several lines inside the cell, or let it overflow.', true, () => g.toggle('wrap'));
    const align = (key: 'ha' | 'va', v: string) => () => g.styleSelection(g.activeStyle()[key] === v ? `${key}:` : `${key}:${v}`);
    cmd('format.align-left', 'Align left', 'Line the text up at the left edge.', true, align('ha', 'left'));
    cmd('format.align-center', 'Center', 'Center the text across the cell.', true, align('ha', 'center'));
    cmd('format.align-right', 'Align right', 'Line the text up at the right edge.', true, align('ha', 'right'));
    cmd('format.valign-top', 'Top align', 'Line the text up at the top of the cell.', true, align('va', 'top'));
    cmd('format.valign-middle', 'Middle align', 'Center the text between top and bottom.', true, align('va', 'middle'));
    cmd('format.valign-bottom', 'Bottom align', 'Line the text up at the bottom of the cell.', true, align('va', 'bottom'));
    cmd('format.indent-more', 'Increase indent', 'Move the text one step in from its edge.', true, () => g.styleSelection('in:+1'));
    cmd('format.indent-less', 'Decrease indent', 'Move the text one step back toward its edge.', true, () => g.styleSelection('in:-1'));
    cmd('format.clear', 'Clear formats', 'Remove fonts, colours, borders, alignment and number formats from the selected cells.', true, async () => {
      const e = engine();
      const mark = this.open ? await e.undoMark(this.open.book) : 0;
      await g.styleSelection('clear');
      await g.setFormat('');
      if (this.open) await e.undoGroup(this.open.book, mark);
    });
    cmd('format.merge', 'Merge cells', 'Merge the selected cells into one, or split a merged cell.', true, () => this.mergeMenu());
    cmd('format.merge-center', 'Merge and center', 'Merge the selection into one cell and center its text. Only the upper-left value is kept.', true, () => g.merge('center'));
    cmd('format.merge-across', 'Merge across', 'Merge each selected row into one cell.', true, () => g.merge('across'));
    cmd('format.merge-cells', 'Merge cells without centering', 'Merge the selection into one cell.', true, () => g.merge('cells'));
    cmd('format.unmerge', 'Unmerge cells', 'Split merged cells in the selection back into single cells.', true, () => g.merge('unmerge'));
    cmd('format.rotate', 'Text rotation', 'Turn or stack the text in the selected cells.', true, () => this.listMenu('format.rotate', ROTATIONS, rotationLabel(g.activeStyle())));
    cmd('format.painter', 'Format painter', 'Copy the formatting of the selection onto the next cells you select. Double-click to keep it on until Escape.', true, () => (g.painting() ? g.stopPainter() : g.startPainter(false)));
    cmd('format.text-color', 'Text colour', 'Choose the colour of the text.', true, () => this.colorMenu('format.text-color', 'fc'));
    cmd('format.fill-color', 'Fill colour', 'Choose the colour behind the cells.', true, () => this.colorMenu('format.fill-color', 'bg'));
    cmd('format.borders', 'Borders', 'Draw or remove lines around and inside the selection.', true, () => this.borderMenu());
    cmd('format.outline-border', 'Outline border', 'Draw a line around the selection.', true, () => g.borders('outside'), 'Mod+Shift+&');
    cmd('format.no-border', 'No border', 'Remove the borders of the selected cells.', true, () => g.borders('none'), 'Mod+Shift+_');
    cmd('format.font', 'Font', 'Choose the typeface of the selected cells.', true, () => this.listMenu('format.font', FONTS.map((f) => [f || 'Inter (default)', f ? `ff:${f}` : 'ff:']), g.activeStyle().font ?? ''));
    cmd('format.size', 'Font size', 'Choose the text size of the selected cells, in points.', true, () => this.listMenu('format.size', SIZES.map((n) => [String(n), n === 10 ? 'sz:' : `sz:${n}`]), String(g.activeStyle().size ?? 10)));
    void api('PUT', '/api/commands', listCommands()).catch(() => undefined);
  }

  private bindChrome(): void {
    const p = this.p;
    p.toolbar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cmd]');
      if (b && !b.disabled) void runCommand(b.dataset.cmd!).then(() => this.grid.focus());
    });
    p.homeBtn.addEventListener('click', () => void runCommand('file.home'));
    this.button('format.painter').addEventListener('dblclick', () => void this.grid.startPainter(true).then(() => this.grid.focus()));
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
        void this.nameBoxEnter(p.nameBox.value.trim());
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
    let doc: WorkbookMeta & { cells: [number, number, string][][]; formats?: [number, number, string][][]; styles?: [number, number, string][][]; merges?: Area[][]; views?: SheetView[]; names?: Name[] };
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
      await e.loadFormats(book, i, doc.formats?.[i] ?? []);
      await e.loadStyles(book, i, doc.styles?.[i] ?? []);
      await e.loadMerges(book, i, doc.merges?.[i] ?? []);
      if (doc.cells[i]?.length) await e.load(book, doc.cells[i], i);
    }
    for (const [n, f] of doc.names ?? []) await e.defineName(book, n, f).catch(() => []);
    const names = doc.names?.length ? await e.names(book) : [];
    this.open = { id, book, title: doc.title, sheets: doc.sheets, views: doc.sheets.map((_, i) => doc.views?.[i] ?? {}), names };
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

  private nameOf(r: Range): string | null {
    const o = this.open;
    if (!o?.names.length) return null;
    const refers = `=${sheetPrefix(o.sheets[this.grid.sheetIndex] ?? '')}${absRange(r)}`.toLowerCase();
    return o.names.find(([, f]) => f.toLowerCase() === refers)?.[0] ?? null;
  }

  private nameBoxResult(problem: string | null): void {
    const box = this.p.nameBox;
    box.setAttribute('aria-invalid', String(problem !== null));
    box.title = problem ?? '';
  }

  private async nameBoxEnter(text: string): Promise<void> {
    const o = this.open;
    if (this.grid.goTo(text)) return this.nameBoxResult(null);
    if (!o || !text) return this.nameBoxResult('Type a cell like B12, a range like B2:D9, or a name.');
    const hit = o.names.find(([n]) => n.toLowerCase() === text.toLowerCase());
    if (hit) {
      const m = /^=(?:'((?:[^']|'')+)'|([^!']+))!([$A-Za-z0-9:]+)$/.exec(hit[1]);
      const sheet = m ? o.sheets.findIndex((s) => s.toLowerCase() === (m[1] ?? m[2]).replace(/''/g, "'").toLowerCase()) : -1;
      if (!m || sheet < 0) return this.nameBoxResult(`${hit[0]} is ${hit[1]}, which is not a range of cells.`);
      if (sheet !== this.grid.sheetIndex) this.showSheet(sheet);
      this.grid.goTo(m[3].replace(/\$/g, ''));
      return this.nameBoxResult(null);
    }
    const refers = `=${sheetPrefix(o.sheets[this.grid.sheetIndex])}${absRange(this.currentRange)}`;
    try {
      this.grid.patch(await engine().defineName(o.book, text, refers));
      o.names = await engine().names(o.book);
      this.nameBoxResult(null);
      this.currentRef = this.nameOf(this.currentRange) ?? this.currentRef;
      this.p.nameBox.value = this.currentRef;
      this.grid.focus();
      await api('PUT', `/api/workbooks/${o.id}/names`, { name: text, refers });
      this.status('Saved');
    } catch (err) {
      this.nameBoxResult(err instanceof Error ? err.message : String(err));
    }
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

  private async refreshNames(): Promise<void> {
    const o = this.open;
    if (o?.names.length) o.names = await engine().names(o.book);
  }

  private sendShift(s: Shift): void {
    const o = this.open;
    if (!o) return;
    void this.refreshNames();
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

  private sendFormats(formats: FormatChange[], what: 'formats' | 'styles' = 'formats'): void {
    const o = this.open;
    if (!o) return;
    const bySheet = new Map<number, [number, number, string][]>();
    for (const [s, r, c, code] of formats) {
      let list = bySheet.get(s);
      if (!list) bySheet.set(s, (list = []));
      list.push([r, c, code]);
    }
    this.flush();
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        for (const [sheet, cells] of bySheet) await api('POST', `/api/workbooks/${o.id}/${what}`, { sheet, cells });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
  }

  private sendMerges(sheet: number, areas: Area[]): void {
    const o = this.open;
    if (!o) return;
    this.flush();
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        await api('PUT', `/api/workbooks/${o.id}/merges`, { sheet, areas });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
  }

  private below(cmd: string): [number, number] {
    const b = this.button(cmd).getBoundingClientRect();
    return [b.left, b.bottom + 4];
  }

  private colorMenu(cmd: string, key: 'fc' | 'bg'): void {
    const g = this.grid;
    const st = g.activeStyle();
    const [x, y] = this.below(cmd);
    const pick = (c: string) => void g.styleSelection(`${key}:${c.slice(1)}`).then(() => g.focus());
    this.menu.show(x, y, [
      { swatches: CELL_COLOURS, current: st[key] ?? '', pick, name: key === 'fc' ? 'Text colour' : 'Fill colour', none: key === 'fc' ? 'Automatic' : 'No fill' },
    ], () => g.focus());
  }

  private mergeMenu(): void {
    const g = this.grid;
    const [x, y] = this.below('format.merge');
    const run = (id: string) => () => runCommand(id).then(() => g.focus());
    this.menu.show(x, y, [
      { label: 'Merge and center', run: run('format.merge-center') },
      { label: 'Merge across', run: run('format.merge-across') },
      { label: 'Merge cells', run: run('format.merge-cells') },
      { label: g.activeMerged() ? 'Unmerge cells (current)' : 'Unmerge cells', run: run('format.unmerge') },
    ], () => g.focus());
  }

  private borderLine = 'thin';

  private borderMenu(): void {
    const g = this.grid;
    const [x, y] = this.below('format.borders');
    const items: MenuItem[] = BORDER_KINDS.map(([kind, label]) => ({
      label,
      keys: kind === 'outside' ? 'Ctrl+Shift+&' : kind === 'none' ? 'Ctrl+Shift+_' : undefined,
      run: () => g.borders(kind, this.borderLine).then(() => g.focus()),
    }));
    items.push({ sep: true });
    for (const [line, label] of LINES) items.push({ label: line === this.borderLine ? `${label} line (current)` : `${label} line`, run: () => { this.borderLine = line; } });
    this.menu.show(x, y, items, () => g.focus());
  }

  private listMenu(cmd: string, options: [label: string, patch: string][], current: string): void {
    const g = this.grid;
    const [x, y] = this.below(cmd);
    this.menu.show(x, y, options.map(([label, patch]) => ({
      label: label === current || (current === '' && patch.endsWith(':')) ? `${label} (current)` : label,
      run: () => g.styleSelection(patch).then(() => g.focus()),
    })), () => g.focus());
  }

  private formatBar(): void {
    const g = this.grid as Grid | undefined;
    if (!g) return;
    const st = g.activeStyle();
    const press = (cmd: string, on: boolean) => {
      const b = this.button(cmd);
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
    };
    press('format.bold', st.b);
    press('format.italic', st.i);
    press('format.underline', st.u);
    press('format.strike', st.s);
    press('format.wrap', st.wrap);
    for (const h of ['left', 'center', 'right'] as const) press(`format.align-${h}`, st.ha === h);
    for (const v of ['top', 'middle', 'bottom'] as const) press(`format.valign-${v}`, st.va === v);
    const font = this.button('format.font');
    const label = st.font ?? 'Inter';
    if (font.textContent !== label) font.textContent = label;
    const size = this.button('format.size');
    const sz = String(st.size ?? 10);
    if (size.textContent !== sz) size.textContent = sz;
    this.button('format.text-color').style.setProperty('--swatch', st.fc ?? 'currentColor');
    this.button('format.fill-color').style.setProperty('--swatch', st.bg ?? 'currentColor');
  }

  private formatMenu(): void {
    const g = this.grid;
    const b = this.button('format.menu').getBoundingClientRect();
    const run = (id: string) => () => runCommand(id).then(() => g.focus());
    void g.formatAtActive().then((now) => {
      const items: MenuItem[] = NUMBER_FORMATS.map((f) => ({
        label: f.code === now ? `${f.label} (current)` : f.label,
        keys: f.keys?.replace('Mod', 'Ctrl'),
        run: run(`format.${f.id}`),
      }));
      items.push({ sep: true }, { label: 'Custom format...', run: run('format.custom') });
      this.menu.show(b.left, b.bottom + 4, items, () => g.focus());
    });
  }

  private async bumpDecimals(dir: 1 | -1): Promise<void> {
    const g = this.grid;
    const code = await g.formatAtActive();
    const next = bumpCode(code, this.current, dir);
    if (next !== code) await g.setFormat(next);
  }

  private customFormat(): void {
    const box = this.customBox ??= this.makeCustomBox();
    const b = this.button('format.menu').getBoundingClientRect();
    box.form.style.left = `${Math.round(b.left)}px`;
    box.form.style.top = `${Math.round(b.bottom + 4)}px`;
    box.hint.textContent = 'Sections split by ; are positive, negative, zero and text.';
    box.form.dataset.state = '';
    box.form.hidden = false;
    void this.grid.formatAtActive().then((code) => {
      box.input.value = code;
      box.input.focus();
      box.input.select();
    });
  }

  private customBox: { form: HTMLFormElement; input: HTMLInputElement; hint: HTMLElement } | null = null;

  private makeCustomBox(): { form: HTMLFormElement; input: HTMLInputElement; hint: HTMLElement } {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom';
    form.hidden = true;
    form.innerHTML = '<label class="fc-fmt-label">Number format code<input class="fc-fmt-input" spellcheck="false" autocomplete="off"></label><span class="fc-fmt-hint" aria-live="polite"></span>';
    document.getElementById('overlay-root')!.appendChild(form);
    const input = form.querySelector<HTMLInputElement>('.fc-fmt-input')!;
    const hint = form.querySelector<HTMLElement>('.fc-fmt-hint')!;
    const close = () => {
      form.hidden = true;
      this.grid.focus();
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.grid.setFormat(input.value).then(close, (err: unknown) => {
        form.dataset.state = 'error';
        hint.textContent = err instanceof Error ? err.message : String(err);
      });
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!form.hidden && !form.contains(e.target as Node)) form.hidden = true;
    }, true);
    return { form, input, hint };
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
        void engine().renameSheet(o.book, i, name).then(() => this.refreshNames());
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
    for (const [s, r, c, t, f] of changes) {
      let m = this.pending.get(s);
      if (!m) this.pending.set(s, (m = new Map()));
      m.set(`${r}:${c}`, [r, c, f ?? t]);
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
