import { engine, type Area, type Changed, type Effect, type FormatChange, type LinkChange, type Name, type RecordItem, type Shift, type SortKeySpec } from './engine';
import { loadSortLists, saveSortList } from './ui/sortlists';
import { cascadeDates, collectDates, dateTree, DATE_FILTERS, iconSwatch } from './ui/filterx';
import { colName, parseRef, type Range } from './grid/a1';
import { Autocomplete, FUNCTIONS, type Suggestion } from './ui/autocomplete';
import { ChipPicker } from './ui/chippicker';
import { chipHref } from './grid/smartchips';
import { SIZE_PRESETS } from './grid/fonts';
import { Charts } from './charts';
import type { FloatObject } from './charts/types';
import { Automation } from './automation';
import type { ScriptHost } from './automation/scripts';
import { Grid, type BorderKind, type MenuKind, type PasteKind, type SheetView } from './grid/grid';
import { paint } from './grid/style';
import { TABLE_STYLES, customId, parseCustom, parseTable } from './grid/tables';
import { listCommands, registerCommand, runCommand, setCommandState } from './ui/commands';
import { mountChrome } from './ui/shell-mount';
import { autoShowHome } from './ui/shellcmds';
import { withJob } from './ui/jobs';
import type { StatusBar, ViewMode } from './ui/statusbar';
import { mountRibbon, type RibbonMount } from './ui/ribbon-mount';
import { ribbonButton } from './ui/rb-state';
import { Home, type TemplateMeta, type WorkbookMeta } from './ui/home';
import { Menu, type MenuItem } from './ui/menu';
import { Collab, identityHeaders } from './ui/collab';
import { isNetworkFailure, keep, replay, waiting } from './ui/offline';
import { takeAction } from './ui/action';
import { DataTools, type DocProps } from './ui/datatools';
import type { ShellParts } from './ui/shell';
import { icon } from './ui/icons';
import { emptyPivot, formatPivot, outArea, parseFields, parsePivot, PivotDialog, PivotPanel, type PivotDef } from './ui/pivot';
import { WhatIf } from './ui/whatif';
import { Audit } from './ui/audit';
import { Names, wireArgs } from './ui/names';
import { Functions } from './ui/functions';
import { lambdaOf, NamedFunctions } from './ui/namedfn';
import { Calc, type CalcDoc } from './ui/calc';
import { DATE_PERIODS, describe, parseRule, PRESETS, rangeText, ruleLine, withStop } from './ui/rules';
import { ScreenReaderGrid } from './ui/srgrid';
import { bindShortcuts, Checker, initPrefs, liveRegion, setTextSize, setTheme, Shortcuts, textSize, theme, type TextSize, type ThemeName } from './ui/a11y';
import { cleanPage, layoutOf, PageSetupDialog, type PageSetup } from './ui/pagesetup';
import { NumberFormatDialog } from './ui/numberformat';
import { hasHtmlTable } from './grid/pastedata';
import { SpellCheck } from './ui/spell';
import { installSettings, setLayoutSummary } from './ui/settings';
import { macroPolicy, pivotFlags, prefs } from './ui/prefs';
import { userName } from './ui/collab';
import { mountSheetChrome } from './ui/sheetchrome';
import { Backstage } from './ui/backstage';
import { Vba } from './vba';
import { DataModelWindow } from './ui/datamodel';
import { DataTypes } from './datatypes';

const LOCALES: [string, string][] = [['en-US', 'English (United States)'], ['en-GB', 'English (United Kingdom)'], ['de-DE', 'Deutsch (Deutschland)'], ['fr-FR', 'Francais (France)'], ['ja-JP', 'Japanese (Japan)'], ['es-ES', 'Espanol (Espana)'], ['it-IT', 'Italiano (Italia)'], ['pt-BR', 'Portugues (Brasil)'], ['nl-NL', 'Nederlands (Nederland)'], ['sv-SE', 'Svenska (Sverige)'], ['pl-PL', 'Polski (Polska)'], ['ru-RU', 'Russian (Russia)'], ['zh-CN', 'Chinese (China)'], ['ko-KR', 'Korean (Korea)']];

interface CsvPreview {
  name: string;
  delimiter: string;
  encoding: string;
  rows: number;
  columns: { label: string; as: string }[];
  sample: string[][];
}

interface FilterForm {
  form: HTMLFormElement;
  col: number;
  title: HTMLElement;
  colors: HTMLElement;
  op1: HTMLSelectElement;
  dateOps: HTMLOptGroupElement;
  v1: HTMLInputElement;
  join: HTMLSelectElement;
  op2: HTMLSelectElement;
  v2: HTMLInputElement;
  search: HTMLInputElement;
  all: HTMLInputElement;
  list: HTMLElement;
  hint: HTMLElement;
}

const FILTER_OPS: [string, string][] = [
  ['', 'None'], ['eq', 'Equals'], ['ne', 'Does not equal'], ['gt', 'Greater than'], ['ge', 'Greater than or equal to'], ['lt', 'Less than'], ['le', 'Less than or equal to'],
  ['begins', 'Begins with'], ['notbegins', 'Does not begin with'], ['ends', 'Ends with'], ['notends', 'Does not end with'], ['contains', 'Contains'], ['notcontains', 'Does not contain'],
  ['between', 'Between'], ['top', 'Top N items'], ['bottom', 'Bottom N items'], ['top%', 'Top N percent'], ['bottom%', 'Bottom N percent'], ['above', 'Above average'], ['below', 'Below average'],
];

const fieldEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

interface ValidForm {
  form: HTMLFormElement;
  title: HTMLElement;
  f: Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
  labelA: HTMLElement;
  labelB: HTMLElement;
  hint: HTMLElement;
  colors: HTMLElement;
  colorKey: string;
  saved: string;
}

interface AlertForm {
  form: HTMLFormElement;
  icon: HTMLElement;
  title: HTMLElement;
  text: HTMLElement;
  buttons: HTMLElement;
  done: ((c: 'retry' | 'accept' | 'cancel') => void) | null;
}

const VALID_KINDS: [string, string][] = [['any', 'Any value'], ['whole', 'Whole number'], ['decimal', 'Decimal'], ['list', 'List'], ['date', 'Date'], ['time', 'Time'], ['length', 'Text length'], ['custom', 'Custom'], ['checkbox', 'Checkbox']];
const VALID_OPS: [string, string][] = [['between', 'between'], ['notbetween', 'not between'], ['eq', 'equal to'], ['ne', 'not equal to'], ['gt', 'greater than'], ['lt', 'less than'], ['ge', 'greater than or equal to'], ['le', 'less than or equal to']];
const TOTALS: [string, number][] = [['Average', 101], ['Count', 103], ['Count Numbers', 102], ['Max', 104], ['Min', 105], ['Sum', 109], ['StdDev', 107], ['Var', 110]];
const ALERT_TEXT ='The value you entered is not allowed in this cell.';

interface SortForm {
  form: HTMLFormElement;
  title: HTMLElement;
  levels: HTMLElement;
  header: HTMLInputElement;
  caseSensitive: HTMLInputElement;
  across: HTMLInputElement;
  newList: HTMLInputElement;
  lists: string[][];
  hint: HTMLElement;
  range: Range | null;
  names: [number, string][];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

interface PasswordForm {
  form: HTMLFormElement;
  title: HTMLElement;
  hint: HTMLElement;
  input: HTMLInputElement;
  again: HTMLInputElement;
  againLabel: HTMLElement;
  submit: ((password: string) => Promise<string | null>) | null;
}

interface CsvForm {
  form: HTMLFormElement;
  file: File | null;
  title: HTMLElement;
  meta: HTMLElement;
  delim: HTMLSelectElement;
  thead: HTMLElement;
  tbody: HTMLElement;
}

interface Opened {
  id: string;
  book: number;
  title: string;
  sheets: string[];
  views: SheetView[];
  names: Name[];
  macros: boolean;
  pages: PageSetup[];
  locale: string;
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

interface RuleAsk {
  values?: number;
  date?: boolean;
  first?: string;
  formula?: boolean;
}

interface RuleForm {
  form: HTMLFormElement;
  title: HTMLElement;
  v1: HTMLInputElement;
  v2: HTMLInputElement;
  date: HTMLSelectElement;
  preset: HTMLSelectElement;
  hint: HTMLElement;
  kind: string;
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
    headers: { ...identityHeaders(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
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
  private readonly backstage: Backstage;
  private readonly grid: Grid;
  private readonly charts: Charts;
  private ribbon!: RibbonMount;
  private readonly audit: Audit;
  private readonly nameTools: Names;
  private readonly fnTools: Functions;
  private readonly namedFns: NamedFunctions;
  private nameNoteMap = new Map<string, string>();
  private open: Opened | null = null;
  private pending = new Map<number, Map<string, [number, number, string]>>();
  private timer = 0;
  private offlineTimer = 0;
  private saving: Promise<void> = Promise.resolve();
  private current = '';
  private currentRef = 'A1';
  private currentRange: Range = { r0: 0, c0: 0, r1: 0, c1: 0 };
  private readonly menu = new Menu();
  private collab!: Collab;
  private whatIf!: WhatIf;
  private viewTimers = new Map<number, number>();
  private importNotes: string[] = [];
  private preview = false;
  private readonly pageDialog = new PageSetupDialog();
  private readonly shortcuts = new Shortcuts();
  private readonly say = liveRegion();
  private readonly checker = new Checker({
    fetch: async () => {
      this.charts.layer.flush();
      await this.saving;
      return api('GET', `/api/workbooks/${this.open?.id}/accessibility`);
    },
    go: (sheet, where) => {
      this.showSheet(sheet);
      if (this.charts.layer.find(where, sheet)) this.charts.layer.focusObject(where);
      else this.grid.goTo(where);
    },
    alt: (sheet, name, text) => void this.setAlt(sheet, name, text),
    decorative: (sheet, name) => {
      if (this.grid.sheetIndex !== sheet) this.showSheet(sheet);
      this.charts.layer.setAlt(name, '', true);
    },
    rename: (sheet, name) => this.renameSheetTo(sheet, name),
    unmerge: async (sheet, areas) => {
      if (this.grid.sheetIndex !== sheet) this.showSheet(sheet);
      const o = this.open;
      const mark = o ? await engine().undoMark(o.book) : 0;
      for (const [r0, c0, r1, c1] of areas) {
        this.grid.select(r0, c0, r1, c1);
        await this.grid.merge('unmerge');
      }
      if (o && (await engine().undoMark(o.book)) > mark + 1) await engine().undoGroup(o.book, mark);
    },
    contrast: async (sheet, fixes) => {
      if (this.grid.sheetIndex !== sheet) this.showSheet(sheet);
      await this.grid.setStyles(fixes.map(([r, c, col]) => [r, c, r, c, `fc:${col.replace('#', '')}`] as [number, number, number, number, string]));
    },
  });
  private readonly auto: Automation;
  private readonly vba: Vba;
  private dtypes!: DataTypes;
  private tools!: DataTools;
  private calc!: Calc;
  private grouped = new Set<number>();
  private homeLoaded: Promise<unknown> = Promise.resolve();
  readonly ready: Promise<unknown>;
  private statusBar!: StatusBar;
  private viewState: ViewMode = 'normal';
  private canUndo = false;
  private canRedo = false;

  constructor(private readonly p: ShellParts) {
    initPrefs();
    this.home = new Home(p.home, {
      open: (id) => void this.openWorkbook(id),
      create: (template) => void this.create(template),
      importFile: (file) => void withJob(`Opening ${file.name}`, () => this.importFile(file)),
      pasteData: (text, html) => this.pasteData(text, html),
      trash: (id) => void this.act(() => api('DELETE', `/api/workbooks/${id}`)),
      restore: (id) => void this.act(() => api('POST', `/api/trash/${id}/restore`)),
      purge: (id) => void this.act(() => api('DELETE', `/api/trash/${id}`)),
    });
    this.backstage = new Backstage(document.getElementById('app')!, {
      current: () => (this.open ? { id: this.open.id, title: this.open.title, sheets: this.open.sheets, sheet: this.grid.sheetIndex, macros: this.open.macros } : null),
      settle: async () => {
        this.flush();
        await this.saving;
      },
      openWorkbook: (id) => void this.openWorkbook(id),
      create: (template) => void this.create(template),
      importFile: (file) => void this.importFile(file),
      page: (sheet) => this.pageOf(sheet),
      setPage: async (sheet, page) => {
        const o = this.open;
        if (!o) return;
        o.pages[sheet] = page;
        await api('PATCH', `/api/workbooks/${o.id}/sheets/${sheet}`, { view: { page } }).catch(() => this.status('Page setup not saved', true));
        void this.refreshBreaks();
      },
      closed: () => this.grid.focus(),
    });
    this.grid = new Grid(p.grid, engine(), -1, {
      onActive: (text, ref, range) => {
        this.current = text;
        this.currentRange = range;
        this.statusBar?.select(range);
        this.currentRef = this.nameOf(range) ?? ref;
        if (document.activeElement !== p.nameBox) p.nameBox.value = this.currentRef;
        if (document.activeElement !== p.formulaBar) {
          p.formulaBar.value = text;
          if (this.grid?.localForms && text.startsWith('=')) {
            void this.grid.localise(text, true).then((v) => {
              if (this.current === text && document.activeElement !== p.formulaBar) p.formulaBar.value = v;
            });
          }
        }
        if (this.grid) {
          const [ar, ac] = this.grid.activeCell();
          void this.whatIf?.tableText(ar, ac).then((t) => {
            const [nr, nc] = this.grid.activeCell();
            if (t && nr === ar && nc === ac && document.activeElement !== p.formulaBar) p.formulaBar.value = t;
          });
          if (text.startsWith('=')) this.say(`${this.currentRef}, formula ${text}`);
        }
        this.formatBar();
        this.linkChip();
        this.collab?.active();
        this.dtypes?.selected();
        this.pivotFollow(range);
        this.calc?.active();
      },
      onError: (message) => this.collab?.refused(message),
      onTypeIcon: (row, col) => void this.dtypes?.openCard(row, col),
      onHover: (row, col, x, y) => this.collab?.hover(row, col, x, y),
      onHistory: (undo, redo) => {
        this.canUndo = undo;
        this.canRedo = redo;
        this.button('edit.undo').disabled = !undo;
        this.button('edit.redo').disabled = !redo;
        void this.whatIf?.sync();
      },
      onChanged: (changes) => {
        this.queueSave(changes);
        this.auto.edited(changes);
        this.pivotAuto(changes);
        this.whatIf?.changed();
        this.audit.invalidate();
        void this.audit.refresh();
        this.statusBar?.changed();
        void this.mirror(changes);
        this.autoFlash(changes);
        this.calc?.changed();
      },
      onSheet: (sheet) => {
        this.markTab(sheet);
        queueMicrotask(() => this.calc?.changed());
        queueMicrotask(() => this.tools.syncSlicers());
        queueMicrotask(() => this.zoomLabel());
        queueMicrotask(() => this.collab?.sheetChanged());
        return this.open?.views[sheet] ?? {};
      },
      onShift: (s) => this.sendShift(s),
      onFormats: (f) => this.sendFormats(f),
      onStyles: (s) => this.sendFormats(s, 'styles'),
      onMerges: (sheet, areas) => this.sendMerges(sheet, areas),
      onLook: () => this.sendLook(),
      onPasteMenu: (x, y) => this.pasteMenu(x, y),
      onRules: (sheet, lines) => this.sendRules(sheet, lines),
      onFilter: (sheet, text) => {
        if (!this.tools.isTemp(sheet)) this.sendFilter(sheet, text);
        void this.tools.refreshSlicers();
      },
      onFilterMenu: (col) => void this.filterBox(col),
      onFilterKey: () => void runCommand('data.filter'),
      onValid: (sheet, lines) => this.sendValid(sheet, lines),
      onInvalid: (rule) => this.invalidBox(rule),
      onRule: (rule, at) => this.showPrompt(rule, at),
      onList: () => void this.dropList(),
      onTables: (lines) => {
        this.sendTables(lines);
        void this.pivotSync();
      },
      onTableKey: () => void runCommand('table.create'),
      onLinks: (changes) => this.sendLinks(changes),
      onChips: (changes) => this.sendChips(changes),
      onRecords: (items) => this.sendRecords(items),
      onChipOpen: (_r, _c, chip) => {
        const href = chipHref(chip);
        if (href) window.open(href, '_blank', 'noopener');
      },
      onOpenLink: () => void this.grid.linkTarget().then((t) => this.followLink(t)),
      onLinkBox: () => this.linkBox(),
      onPainter: (state) => this.button('format.painter').setAttribute('aria-pressed', String(state !== 'off')),
      onView: (sheet, view) => this.saveView(sheet, view),
      onBreakMove: (axis, from, to) => this.moveBreak(axis, from, to),
      onMenu: (kind, x, y) => this.cellMenu(kind, x, y),
      onGoto: () => this.tools.goToDialog(),
    });
    new ScreenReaderGrid(this.grid, () => this.open?.sheets[this.grid.sheetIndex] ?? '');
    this.grid.peers = () => (this.grouped.size > 1 && this.grouped.has(this.grid.sheetIndex) ? [...this.grouped].filter((s) => s !== this.grid.sheetIndex) : []);
    this.whatIf = new WhatIf({
      grid: this.grid,
      book: () => this.open?.book ?? -1,
      sheetNames: () => this.open?.sheets ?? [],
      makeSheet: (base) => this.makeSheet(base),
      persist: (lines) => this.sendWhatif(lines),
      pivotsChanged: () => this.pivotSync(),
      showSheet: (i) => this.showSheet(i),
      newBook: async (title, cells) => {
        const meta = await api<WorkbookMeta>('POST', '/api/workbooks', { title });
        await api('POST', `/api/workbooks/${meta.id}/cells`, { sheet: 0, cells });
        window.open(`${location.pathname}#w-${meta.id}`, '_blank');
      },
    });
    this.tools = new DataTools({
      grid: this.grid,
      menu: this.menu,
      status: (t, e) => this.status(t, e),
      sheetNames: () => this.open?.sheets ?? [],
      views: () => this.open?.views ?? [],
      patchView: (s, part) => this.patchView(s, part),
      workbookId: () => this.open?.id ?? '',
      headers: async (r) => {
        const o = this.open;
        const out: string[] = Array.from({ length: r.c1 - r.c0 + 1 }, () => '');
        if (!o) return out;
        for (const [, c, t] of await engine().readValues(o.book, this.grid.sheetIndex, r.r0, r.c0, r.r0, r.c1)) out[c - r.c0] = t.replace(/^'/, '');
        return out;
      },
      filterValues: async (col) => {
        const o = this.open;
        const l = o ? await engine().filterValues(o.book, this.grid.sheetIndex, col) : { values: [], blanks: false };
        return { values: l.values, blanks: l.blanks };
      },
      names: () => this.open?.names ?? [],
      workbooks: async () => (await api<{ id: string; title: string; sheets: string[] }[]>('GET', '/api/workbooks')).map((b) => ({ id: b.id, title: b.title, sheets: b.sheets })),
      moveCopy: (sheet, dest, name, before, copy) => this.moveCopySheet(sheet, dest, name, before, copy),
      properties: async () => {
        const o = this.open;
        if (!o) return null;
        this.flush();
        await this.saving;
        return api<DocProps>('GET', `/api/workbooks/${o.id}/properties`);
      },
      saveProperties: async (props) => {
        const o = this.open;
        if (o) await api('PUT', `/api/workbooks/${o.id}/properties`, props);
      },
      jump: (text) => this.jumpTo(text),
      tableNames: async () => {
        const o = this.open;
        return o ? (await engine().tables(o.book)).map((l) => parseTable(l)?.name ?? '').filter(Boolean) : [];
      },
      noteCells: (sheet) => this.collab.noteCells(sheet),
      pasteNotes: (src, dr, dc, t) => this.collab.pasteNotes(src, dr, dc, t),
      goTo: (s, r, c) => {
        if (s !== this.grid.sheetIndex) this.showSheet(s);
        this.grid.goTo(`${colName(c)}${r + 1}`);
      },
      pivots: () => this.pivotDefs().map((d) => ({ name: d.name, filters: d.filters })),
      pivotFields: async (name) => parseFields(await engine().pivotFields(this.open?.book ?? -1, name)).fields.map((f) => f.name),
      pivotItems: (name, field) => engine().pivotItems(this.open?.book ?? -1, name, field),
      pivotFilter: async (name, field, items) => {
        const d = this.pivotDefs().find((x) => x.name === name);
        if (!d) return;
        const had = d.filters.some((f) => f.field === field);
        if (!had && !items.length) return;
        const next: PivotDef = { ...d, filters: had ? d.filters.map((f) => (f.field === field ? { field, items } : f)) : [...d.filters, { field, items }] };
        await this.pivotApply((book) => engine().setPivot(book, name, formatPivot(next)));
      },
      tableAt: () => {
        const t = this.grid.activeTable();
        if (!t) return null;
        const p = t.line.split('\t');
        const n = t.cols.length;
        return { name: t.name, area: t.area, cols: t.cols, types: p.length >= 6 + 4 * n ? p.slice(6 + 3 * n, 6 + 4 * n).map((s) => s.replace(/\\(.)/g, '$1')) : [] };
      },
    });
    try {
      if (localStorage.getItem('fc-autocomplete') === '0') this.grid.autoComplete = false;
    } catch {
      this.grid.autoComplete = true;
    }
    const suggestions = (): Suggestion[] => [
      ...FUNCTIONS,
      ...(this.open?.names ?? []).filter(([name]) => !name.includes('!')).map(([name, refers]): Suggestion => {
        const f = lambdaOf(name, refers, this.nameNoteMap.get(name) ?? '');
        return f ? { name, kind: 'function', summary: f.comment || refers, args: f.params.length ? f.params : [] } : { name, kind: 'name', summary: this.nameNoteMap.get(name) || refers };
      }),
      ...this.grid.tables().map((t): Suggestion => ({ name: t.name, kind: 'table', summary: `Table, ${t.cols.length} columns` })),
    ];
    const tableHints = () => this.grid.tables().map((t) => ({ name: t.name, cols: t.cols }));
    new Autocomplete(p.formulaBar, suggestions, tableHints);
    const cellAc = new Autocomplete(this.grid.editor, suggestions, tableHints);
    this.grid.editorHook = (e) => cellAc.take(e);
    new ChipPicker(this.grid.editor, () => this.collab?.knownPeople() ?? [], (chip, at, replaced) => this.grid.addEditChip(chip, at, replaced));    this.charts = new Charts(this.grid, engine(), {
      book: () => this.open?.book ?? -1,
      sheetNames: () => this.open?.sheets ?? [],
      active: () => !!this.open,
      load: async () => (this.open ? (await api<{ objects: FloatObject[][] }>('GET', `/api/workbooks/${this.open.id}/objects`)).objects : []),
      save: (sheet, list) => this.sendObjects(sheet, list),
      pivots: () => this.pivotDefs(),
      pivotHere: () => {
        const s = this.grid.selection();
        const defs = this.pivotDefs();
        return (this.pivotAt(this.grid.sheetIndex, s.r0, s.c0) ?? (defs.length === 1 ? defs[0] : null))?.name ?? null;
      },
      pivotItems: (name, field) => engine().pivotItems(this.open?.book ?? -1, name, field),
      pivotFilter: async (name, field, items) => {
        const d = this.pivotDefs().find((x) => x.name === name);
        if (d) await this.pivotApply((book) => engine().setPivot(book, name, formatPivot({ ...d, filters: d.filters.map((f) => (f.field === field ? { field, items } : f)) })));
      },
      say: (t) => this.status(t),
      timeline: (sheet) => this.open?.views[sheet]?.timeline ?? null,
      saveTimeline: (sheet, view) => this.patchView(sheet, { timeline: view }),
      scripts: () => [...this.auto.scriptList(), ...this.vba.macroList()],
      runScript: (id, name) => (this.vba.runById(id) ? undefined : this.auto.runForObject(id, name)),
    });
    document.addEventListener('fc-ai-pivot', (e) => {
      const d = (e as CustomEvent<{ src: string; layout: string }>).detail;
      this.pivotCreate(d.src, null, d.layout).catch((err: unknown) => this.status(err instanceof Error ? err.message : 'The PivotTable was not made', true));
    });
    this.audit = new Audit({
      grid: this.grid,
      engine: engine(),
      book: () => this.open?.book ?? null,
      sheets: () => this.open?.sheets ?? [],
      save: (w) => {
        const id = this.open?.id;
        if (id) void api('PUT', `/api/workbooks/${id}/watches`, { watches: w }).catch(() => this.status('Could not save the watch list', true));
      },
      say: (t, bad) => {
        if (t) this.status(t, !!bad);
      },
      goto: (sheet, row, col) => {
        if (sheet !== this.grid.sheetIndex) this.showSheet(sheet);
        this.grid.goTo(`${colName(col)}${row + 1}`);
      },
    });
    this.nameTools = new Names({
      grid: this.grid,
      engine: engine(),
      book: () => this.open?.book ?? null,
      sheets: () => this.open?.sheets ?? [],
      selection: () => this.currentRange,
      sheet: () => this.grid.sheetIndex,
      refreshNames: async () => {
        const o = this.open;
        if (o) {
          o.names = await engine().names(o.book);
          this.nameNoteMap = new Map(await engine().nameNotes(o.book));
        }
      },
      sync: async (op, args) => {
        const id = this.open?.id;
        if (id) await api('PUT', `/api/workbooks/${id}/names/tool`, { op, args: wireArgs(args) });
      },
      syncName: async (name, refers) => {
        const id = this.open?.id;
        if (id) await api('PUT', `/api/workbooks/${id}/names`, { name, refers });
      },
      say: (t, bad) => this.status(t, !!bad),
    });
    this.namedFns = new NamedFunctions({
      engine: engine(),
      book: () => this.open?.book ?? null,
      id: () => this.open?.id ?? null,
      refreshNames: async () => {
        const o = this.open;
        if (o) {
          o.names = await engine().names(o.book);
          this.nameNoteMap = new Map(await engine().nameNotes(o.book));
        }
      },
      sync: async (op, args) => {
        const id = this.open?.id;
        if (id) await api('PUT', `/api/workbooks/${id}/names/tool`, { op, args: wireArgs(args) });
      },
      syncName: async (name, refers) => {
        const id = this.open?.id;
        if (id) await api('PUT', `/api/workbooks/${id}/names`, { name, refers });
      },
      workbooks: async () => (await api<WorkbookMeta[]>('GET', '/api/workbooks')).map((w) => ({ id: w.id, title: w.title })),
      workbook: async (wid) => {
        const d = await api<{ names?: [string, string][]; nameNotes?: [string, string][] }>('GET', `/api/workbooks/${wid}`);
        return { names: d.names ?? [], nameNotes: d.nameNotes ?? [] };
      },
      say: (t, bad) => this.status(t, !!bad),
    });
    this.fnTools = new Functions({
      grid: this.grid,
      engine: engine(),
      book: () => this.open?.book ?? null,
      say: (t, bad) => this.status(t, !!bad),
      named: () => suggestions().filter((s) => s.kind === 'function' && !FUNCTIONS.includes(s)),
    });
    this.calc = new Calc({
      grid: this.grid,
      menu: this.menu,
      engine: engine(),
      sheetBar: p.statusbar,
      gridBox: p.grid,
      formulaBar: p.formulaBar,
      book: () => this.open?.book ?? -1,
      sheets: () => this.open?.sheets ?? [],
      say: (t, bad) => this.status(t, !!bad),
      anchor: (c) => this.button(c).getBoundingClientRect(),
      post: (body) => api('POST', `/api/workbooks/${this.open?.id}/calc`, body),
      evaluate: () => void this.audit.evaluate(),
      arrows: (r, c, l) => this.audit.showArrows(r, c, l),
      drain: (f, a) => this.auto.drain(f, a),
      goSheet: (s) => this.showSheet(s),
    });
    this.button('edit.undo').disabled = true;
    this.button('edit.redo').disabled = true;
    this.collab = new Collab({
      grid: this.grid,
      menu: this.menu,
      open: () => (this.open ? { id: this.open.id, book: this.open.book, sheets: this.open.sheets } : null),
      status: (text, error) => this.status(text, error),
      reload: () => {
        if (this.open) void this.openWorkbook(this.open.id, false);
      },
    });
    window.addEventListener('unhandledrejection', (e) => {
      if (!(e.reason instanceof Error)) return;
      e.preventDefault();
      this.collab.refused(e.reason.message);
    });
    this.auto = new Automation({ grid: this.grid, book: () => this.open?.book ?? -1, id: () => this.open?.id ?? '', sheets: () => this.open?.sheets ?? [], title: () => this.open?.title ?? '', status: (t, e) => this.status(t, e), addSheet: (n) => this.addSheetNamed(n), renameSheet: async (i, n) => this.renameSheetTo(i, n), deleteSheet: (i) => this.deleteSheet(i), showSheet: (i) => this.showSheet(i), script: this.scriptHost() });
    this.dtypes = new DataTypes({ grid: this.grid, book: () => this.open?.book ?? -1, id: () => this.open?.id ?? '', sheets: () => this.open?.sheets ?? [], status: (t, e) => (e ? this.collab.refused(t) : this.status(t)) });
    this.vba = new Vba({ grid: this.grid, id: () => this.open?.id ?? '', book: () => this.open?.book ?? -1, title: () => this.open?.title ?? '', sheets: () => this.open?.sheets ?? [], status: (t, e) => this.status(t, e), settings: { get: (k) => this.auto.setting(k), set: (k, v) => this.auto.setSetting(k, v) }, toolbar: this.p.toolbar });
    this.commands();
    installSettings({
      grid: this.grid,
      calc: this.calc,
      locales: LOCALES,
      hasWorkbook: () => !!this.open,
      locale: () => this.open?.locale ?? null,
      setLocale: (tag) => this.setLocale(tag),
      userName,
      setUserName: (v) => this.collab.setUserName(v),
      autocomplete: () => this.grid.autoComplete,
      setAutocomplete: (on) => {
        if (on !== this.grid.autoComplete) this.toggleAutoComplete();
      },
      flashAuto: () => this.flashAuto,
      setFlashAuto: (on) => {
        if (on !== this.flashAuto) this.toggleFlashAuto();
      },
      pageBreaks: () => this.preview,
      say: (t, bad) => this.status(t, !!bad),
    });
    this.grid.opts.barEdit = () => {
      this.p.formulaBar.focus();
    };
    this.dtypes.commands((id, title, description, changes, run, keys) => registerCommand({ id, title, description, changes, run, keys }));
    this.calc.commands((id, title, description, changes, run, keys) => registerCommand({ id, title, description, changes, run, keys }));
    this.collab.commands((id, title, description, changes, run, keys) => registerCommand({ id, title, description, changes, run, keys }));
    this.ribbon = mountRibbon(p.toolbar, this.grid, {
      book: () => this.open?.book ?? -1,
      open: () => !!this.open,
      cfItems: () => this.cfItems(),
      styleBox: (name) => this.styleBox(name),
      say: (t, bad) => this.status(t, !!bad),
      formulaText: () => p.formulaBar.value,
      selectedObject: () => this.charts.layer.selectedObject(),
      sparkHere: () => false,
      inPivot: () => {
        const s = this.grid.selection();
        return !!this.pivotAt(this.grid.sheetIndex, s.r0, s.c0);
      },
      fnPick: (name) => this.fnTools.pick(name),
      after: () => {
        if (!this.menu.open && document.activeElement?.closest('#overlay-root, .fc-fmt-custom, .rb-menu, .rb-combo, .fc-modal') == null) this.grid.focus();
      },
    });
    setLayoutSummary('ribbon', () => {
      const tabs = p.toolbar.querySelectorAll('.rb-tab:not(.is-ctx):not([hidden])').length;
      const groups = p.toolbar.querySelectorAll('.rb-panel .rb-group:not([hidden])').length;
      return `${tabs} tabs with ${groups} groups, plus contextual tabs that appear with a table, chart, picture or PivotTable.`;
    });
    setLayoutSummary('qat', () => `${this.ribbon.qat.items.length} commands on the Quick Access Toolbar.`);
    bindShortcuts(this.shortcuts, () => !!this.open);
    this.bindChrome();
    mountSheetChrome(p, { grid: this.grid, extent: async () => (this.open ? engine().extent(this.open.book, this.grid.sheetIndex) : null) });
    this.statusBar = mountChrome(p, {
      grid: this.grid,
      hasBook: () => !!this.open,
      book: () => this.open?.book ?? -1,
      sheet: () => this.grid.sheetIndex,
      importFile: (file) => this.importFile(file),
      save: () => {
        this.flush();
        void this.saving.then(() => this.status('Saved'));
      },
      viewMode: () => this.viewState,
      setViewMode: (m) => this.setView(m),
      a11y: async () => {
        const o = this.open;
        if (!o) return null;
        const issues = await api<{ level: string }[]>('GET', `/api/workbooks/${o.id}/accessibility`);
        return { bad: issues.filter((i) => i.level !== 'tip').length, tips: issues.filter((i) => i.level === 'tip').length };
      },
      toast: (t) => this.status(t),
    });
    setCommandState('page.preview', { checked: () => this.viewState === 'break' });
    setCommandState('edit.undo', { enabled: () => this.canUndo });
    setCommandState('edit.redo', { enabled: () => this.canRedo });
    window.addEventListener('hashchange', () => void this.route());
    window.addEventListener('beforeunload', () => this.flush());
    this.ready = this.route().catch(() => undefined).then(() => this.homeLoaded);
  }

  private button(cmd: string): HTMLButtonElement {
    return ribbonButton(cmd);
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
    cmd('file.backstage', 'File', 'Open the File view: Home, New, Open, Info, Save, Save As, Save a Copy, Print, Share, Export, Publish, Close, Account and Options.', false, () => this.backstage.show());
    cmd('file.info', 'Info', 'Open the File view on Info: properties, protect, inspect, version history and manage workbook.', false, () => this.backstage.show('info'));
    cmd('file.open', 'Open', 'Open the File view on Open: recent workbooks, the library, or a file from this computer.', false, () => this.backstage.show('open'), 'Mod+O');
    cmd('file.save-as', 'Save As', 'Open the File view on Save As, with every file type FormCel writes.', false, () => this.backstage.show('saveas'), 'F12');
    cmd('file.print', 'Print', 'Open the File view on Print with a preview of the pages and the page settings.', false, () => this.backstage.show('print'), 'Mod+P');
    cmd('file.home', 'Home', 'Save and go to the home screen.', false, () => { location.hash = ''; });
    cmd('file.new', 'New blank workbook', 'Create an empty workbook and open it.', true, () => this.create());
    cmd('file.download', 'Download', 'Choose a file format to download this workbook or sheet in.', false, () => this.downloadMenu());
    cmd('file.download-default', 'Save a copy', 'Save a copy of this workbook in the format chosen in Preferences, Save: FormCel Workbook (.fcel) or Excel Workbook (.xlsx).', false, () => this.download(prefs().defaultFormat));
    cmd('file.download-fcel', 'Download as .fcel', 'Save a copy of this workbook as a FormCel Workbook, with every feature kept.', false, () => this.download('fcel'));
    cmd('file.download-xlsx', 'Download as .xlsx', 'Save a copy of this workbook as an Excel workbook in your downloads.', false, () => this.download('xlsx'));
    cmd('file.download-xlsm', 'Download as .xlsm', 'Save a copy as an Excel macro-enabled workbook with its macros, including the ones edited in the Visual Basic Editor.', false, () => this.download('xlsm'));
    cmd('file.download-xlsx-password', 'Download as .xlsx with a password', 'Save a copy as an Excel workbook that asks for a password to open.', false, () => this.downloadLocked());
    cmd('file.download-pdf', 'Download sheet as PDF', 'Save this sheet as a PDF, laid out with its Page Setup (Letter portrait unless you changed it).', false, () => this.download('pdf'));
    cmd('file.download-pdf-all', 'Download workbook as PDF', 'Save every sheet in one PDF, each laid out with its own Page Setup.', false, () => this.download('pdf-all'));
    cmd('file.download-ods', 'Download as .ods', 'Save a copy of this workbook as an OpenDocument spreadsheet.', false, () => this.download('ods'));
    cmd('file.download-csv', 'Download sheet as .csv', 'Save the values of this sheet, as shown, separated by commas.', false, () => this.download('csv'));
    cmd('file.download-tsv', 'Download sheet as .tsv', 'Save the values of this sheet, as shown, separated by tabs.', false, () => this.download('tsv'));
    cmd('file.download-html', 'Download sheet as web page', 'Save this sheet as a web page (.html) with its values, basic formatting and merged cells.', false, () => this.download('html'));
    cmd('file.download-html-all', 'Download workbook as web page', 'Save every sheet in one web page (.html).', false, () => this.download('html-all'));
    cmd('page.menu', 'Page layout', 'Page setup, print area, page breaks and page break preview.', false, () => this.pageMenu());
    cmd('page.setup', 'Page Setup', 'Set orientation, paper size, margins, scaling, print area, print titles, gridlines, headings, headers and footers for this sheet.', false, () => this.pageSetup());
    cmd('page.preview', 'Page Break Preview', 'Show where each printed page starts, with blue lines and page numbers over the sheet.', false, () => this.togglePreview());
    cmd('page.break-insert', 'Insert page break', 'Start a new printed page above and to the left of the active cell.', false, () => this.pageBreak('insert'));
    cmd('page.break-remove', 'Remove page break', 'Remove the manual page break above or to the left of the active cell.', false, () => this.pageBreak('remove'));
    cmd('page.break-reset', 'Reset all page breaks', 'Remove every manual page break on this sheet.', false, () => this.pageBreak('reset'));
    cmd('page.area-set', 'Set print area', 'Print only the selected cells.', false, () => this.printArea(true));
    cmd('page.area-clear', 'Clear print area', 'Print the whole sheet again.', false, () => this.printArea(false));
    cmd('view.access', 'Accessibility and language', 'Accessibility checker, keyboard shortcuts, theme, text size and spreadsheet locale.', false, () => this.accessMenu());
    cmd('a11y.check', 'Check accessibility', 'Look for merged cells, default sheet names, hard-to-read colours, missing alternative text and unnamed table headers.', false, () => this.checker.show());
    cmd('a11y.shortcuts', 'Keyboard shortcuts', 'List the keyboard shortcuts and set your own for a command.', false, () => this.shortcuts.show(), 'Mod+/');
    cmd('sheet.add', 'Add a sheet', 'Add a sheet after the last one and show it.', true, () => this.addSheet());
    cmd('rows.insert-above', 'Insert rows above', 'Insert as many rows as are selected, above the selection.', true, () => g.insert(true), 'Mod++');
    cmd('rows.insert-below', 'Insert rows below', 'Insert as many rows as are selected, below the selection.', true, () => g.insert(true, true));
    cmd('cols.insert-left', 'Insert columns left', 'Insert as many columns as are selected, left of the selection.', true, () => g.insert(false));
    cmd('cols.insert-right', 'Insert columns right', 'Insert as many columns as are selected, right of the selection.', true, () => g.insert(false, true));
    cmd('rows.delete', 'Delete rows', 'Delete the selected rows and move the rows below up.', true, () => g.remove(true), 'Mod+-');
    cmd('cols.delete', 'Delete columns', 'Delete the selected columns and move the columns on the right left.', true, () => g.remove(false));
    cmd('rows.height', 'Row height', 'Set the height in points of the selected rows.', true, () => this.tools.sizeDialog('rowheight'));
    cmd('cols.width', 'Column width', 'Set the width in characters of the selected columns.', true, () => this.tools.sizeDialog('colwidth'));
    cmd('cols.standard', 'Standard width', 'Set the width in characters that columns have unless they were sized on their own.', true, () => this.tools.sizeDialog('stdwidth'));
    cmd('rows.autofit', 'AutoFit row height', 'Size the selected rows to fit their wrapped text, line breaks and large fonts.', true, () => g.autofitSelection(true));
    cmd('cols.autofit', 'AutoFit column width', 'Size the selected columns to fit their longest entry.', true, () => g.autofitSelection(false));
    cmd('rows.hide', 'Hide rows', 'Hide the selected rows.', false, () => g.hide(true, true), 'Mod+9');
    cmd('rows.unhide', 'Unhide rows', 'Show hidden rows inside the selection.', false, () => g.hide(true, false), 'Mod+Shift+9');
    cmd('cols.hide', 'Hide columns', 'Hide the selected columns.', false, () => g.hide(false, true), 'Mod+0');
    cmd('cols.unhide', 'Unhide columns', 'Show hidden columns inside the selection.', false, () => g.hide(false, false), 'Mod+Shift+0');
    cmd('data.auto-outline', 'Auto Outline', 'Group the detail rows and columns that summary formulas such as SUM and SUBTOTAL add up, one level for each nested summary.', true, () => this.tools.autoOutline());
    cmd('data.clear-outline', 'Clear Outline', 'Remove every row and column group from the sheet and show the rows and columns they hid.', true, () => this.grid.clearOutline());
    cmd('data.outline-settings', 'Outline settings', 'Choose whether summary rows sit below or above their detail rows and summary columns to the right or left of theirs.', true, () => this.tools.outlineSettings());
    cmd('rows.group', 'Group rows', 'Add the selected rows to an outline group one level deeper, up to 7 levels.', false, () => g.group(true, 1), 'Alt+Shift+Right');
    cmd('rows.ungroup', 'Ungroup rows', 'Take the selected rows out of one outline level.', false, () => g.group(true, -1), 'Alt+Shift+Left');
    cmd('cols.group', 'Group columns', 'Add the selected columns to an outline group one level deeper, up to 7 levels.', false, () => g.group(false, 1));
    cmd('cols.ungroup', 'Ungroup columns', 'Take the selected columns out of one outline level.', false, () => g.group(false, -1));
    cmd('view.zoom-in', 'Zoom in', 'Make the sheet bigger, up to 200%.', false, () => g.zoomStep(1));
    cmd('view.zoom-out', 'Zoom out', 'Make the sheet smaller, down to 50%.', false, () => g.zoomStep(-1));
    cmd('view.zoom-reset', 'Zoom to 100%', 'Show the sheet at its normal size.', false, () => g.setZoom(1));
    cmd('nav.goto', 'Go To and Go To Special', 'Jump to a cell, range or defined name from a list, or select blanks, constants, formulas by type, notes, conditional formats, data validation, visible cells only, the current region, the last cell, row or column differences, precedents or dependents, one range at a time.', false, () => this.tools.goToDialog(), 'F5');
    cmd('nav.namebox', 'Name Box', 'Move the cursor to the Name Box to type a cell, a range or a new name.', false, () => { this.p.nameBox.focus(); this.p.nameBox.select(); });
    cmd('format.menu', 'Number format', 'Choose how the selected cells show numbers, dates and times.', true, () => this.formatMenu());
    cmd('format.decimals-more', 'Increase decimal places', 'Show one more decimal place in the selected cells.', true, () => this.bumpDecimals(1));
    cmd('format.decimals-less', 'Decrease decimal places', 'Show one fewer decimal place in the selected cells.', true, () => this.bumpDecimals(-1));
    cmd('format.number-dialog', 'Format Cells: Number', 'Open the Number tab with every category (General, Number, Currency, Accounting, Date, Time, Percentage, Fraction, Scientific, Text, Special, Custom), a live sample and formats that follow the workbook locale.', true, () => this.numberDialog(), 'Mod+1');
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
    cmd('view.formula-bar', 'Expand or collapse formula bar', 'Show the formula bar several lines tall with wrapped text and a drag handle to resize it, or fold it back to one line.', false, () => this.toggleFormulaBar(), 'Mod+Shift+U');
    cmd('edit.link', 'Insert link', 'Link the active cell to a web page, an email address or a place in the workbook, or change its link.', true, () => this.linkBox(), 'Mod+K');
    cmd('edit.link-open', 'Open link', 'Open the link in the active cell. Ctrl+click a linked cell does the same.', false, () => this.grid.linkTarget().then((t) => this.followLink(t)));
    cmd('edit.link-remove', 'Remove link', 'Remove the links from the selected cells and keep their text.', true, () => this.grid.removeLinks());
    cmd('audit.precedents', 'Trace precedents', 'Draw arrows from the cells the active formula reads to the active cell. Click again to go one level further back.', false, () => this.audit.trace('p'));
    cmd('audit.dependents', 'Trace dependents', 'Draw arrows from the active cell to the formulas that read it. Click again to go one level further out.', false, () => this.audit.trace('d'));
    cmd('audit.remove-arrows', 'Remove arrows', 'Take the trace arrows off the sheet.', false, () => this.audit.removeArrows());
    cmd('audit.evaluate', 'Evaluate formula', 'Step through the active formula one part at a time and see each result.', false, () => this.audit.evaluate());
    cmd('names.manager', 'Name Manager', 'Create, edit, filter and delete names, set their scope and comments, and change what they refer to.', true, () => this.nameTools.open(), 'Mod+F3');
    cmd('names.create', 'Create names from selection', 'Name cells after the labels in the top row, left column, bottom row or right column of the selection.', true, () => this.nameTools.createFromSelection(), 'Mod+Shift+F3');
    cmd('names.functions', 'Named functions', 'Save a LAMBDA under a name with a description and argument placeholders, or import named functions from another workbook.', true, () => this.namedFns.open());
    cmd('names.apply', 'Apply names', 'Replace cell references in formulas with the names that point at them.', true, () => this.nameTools.applyDialog());
    cmd('names.paste', 'Paste name', 'Paste a name into the formula you are editing, or list every name on the sheet.', false, () => this.nameTools.pasteName(), 'F3');
    cmd('formula.insert-function', 'Insert function', 'Search every function by name or category and fill in its arguments with a preview of each value and the result.', true, () => this.fnTools.insertFunction(), 'Shift+F3');
    cmd('formula.arguments', 'Function arguments', 'Open the arguments of the function at the caret in the formula you are editing.', true, () => this.fnArguments(), 'Ctrl+A');
    cmd('review.spelling', 'Check spelling', 'Check the text cells in the selection, or on the whole sheet when one cell is selected, against the bundled English word list and your own dictionary. Ignore a word once or everywhere, change it once or everywhere, or add it to your dictionary.', false, () => void this.spellCheck(), 'F7');
    cmd('audit.watch', 'Watch window', 'Show or hide a panel that lists watched cells with their value and formula, and keeps them current.', false, () => this.audit.toggleWatch());
    cmd('format.cf', 'Conditional formatting', 'Format cells by rules on their values: highlights, top and bottom, data bars, colour scales, icons and formulas.', true, () => this.cfMenu());
    cmd('format.cf-manage', 'Manage conditional formatting rules', 'See, reorder, stop and delete the rules on this sheet.', false, () => this.openPanel());
    cmd('format.styles', 'Cell styles', 'Apply a named cell style, or make one from the selection.', true, () => this.stylesMenu());
    cmd('format.theme', 'Theme', 'Choose the workbook theme: the colours and fonts that styles and the default text use.', true, () => this.themeMenu());
    cmd('edit.paste-special', 'Paste special', 'Paste only formulas, values, formats or column widths, or transpose, from the last FormCel copy.', true, () => {
      const r = this.p.grid.getBoundingClientRect();
      this.pasteMenu(r.left + 80, r.top + 40);
    }, 'Mod+Alt+V');
    cmd('data.sort-asc', 'Sort A to Z', 'Sort the rows of the selection, or the data around the active cell, by the active column, smallest first.', true, () => this.sorted(g.quickSort(false)));
    cmd('data.sort-desc', 'Sort Z to A', 'Sort the rows of the selection, or the data around the active cell, by the active column, largest first.', true, () => this.sorted(g.quickSort(true)));
    cmd('data.sort', 'Custom sort', 'Sort by several columns, each A to Z or Z to A, with or without a header row.', true, () => this.sortBox());
    cmd('data.filter', 'Filter', 'Add filter buttons to the header row of the data around the active cell, or take them off.', true, () => this.toggleFilter(), 'Mod+Shift+L');
    cmd('table.create', 'Table', 'Turn the data around the active cell into a table with a header row, banded rows and filter buttons, or change the table the active cell is in.', true, () => (g.activeTable() ? this.designBox() : this.tableBox()), 'Mod+T');
    cmd('pivot.create', 'PivotTable', 'Summarize the data around the active cell in a PivotTable on a new sheet or a chosen cell, with recommended layouts to start from. Inside a PivotTable this opens its fields panel instead.', true, () => this.pivotBox());
    cmd('datamodel.manage', 'Data Model', 'Open the Data Model window: the tables added to the workbook model, their relationships, calculated columns, measures, hierarchies and KPIs.', false, () => this.modelWindow().open());
    cmd('datamodel.add', 'Add to Data Model', 'Add the table or the selected range with a header row to the Data Model.', true, async () => {
      const w = this.modelWindow();
      await w.open('data');
    });
    cmd('datamodel.pivot', 'PivotTable from Data Model', 'Insert a PivotTable that reads the Data Model, with its relationships and measures.', true, () => this.pivotCreate('@model', null, null).catch((err: unknown) => this.status(err instanceof Error ? err.message : 'The PivotTable was not made', true)));
    cmd('cube.convert', 'Convert to Formulas', 'Replace the Data Model PivotTable under the active cell with CUBEMEMBER, CUBEVALUE and CUBESET formulas.', true, () => this.cubeConvert());
    cmd('pivot.fields', 'PivotTable fields', 'Choose which fields of the PivotTable under the active cell go in Rows, Columns, Values and Filters, how values are summarized and shown, and add calculated fields.', false, () => this.pivotFields());
    cmd('pivot.refresh', 'Refresh PivotTable', 'Recompute the PivotTable under the active cell from its current source data, or every PivotTable when the active cell is not in one.', true, () => this.pivotRefresh(false));
    cmd('pivot.refresh-all', 'Refresh all PivotTables', 'Recompute every PivotTable in the workbook from its current source data.', true, () => this.pivotRefresh(true));
    cmd('data.whatif', 'What-If Analysis and data analysis', 'Open the menu of Goal Seek, Data Table, Scenario Manager, Solver, Forecast Sheet, Descriptive Statistics, Regression and Analyze Data.', false, () => this.whatIfMenu());
    cmd('data.goal-seek', 'Goal Seek', 'Find the input value that makes a formula give the result you want, and apply it as one undo step.', true, () => this.whatIf.goalSeek());
    cmd('data.data-table', 'Data Table', 'Fill a grid of results by putting a list of values into one or two input cells and recalculating a formula for each.', true, () => this.whatIf.dataTable());
    cmd('data.scenarios', 'Scenario Manager', 'Save named sets of values for changing cells, show one on the sheet, or write a summary of them to a new sheet.', true, () => this.whatIf.scenarios());
    cmd('data.solver', 'Solver', 'Find the maximum, minimum or a set value of an objective cell by changing variable cells within constraints.', true, () => this.whatIf.solver());
    cmd('data.forecast-sheet', 'Forecast Sheet', 'Write a table of historical and forecast values, with confidence bounds, to a new sheet using FORECAST.ETS.', true, () => this.whatIf.forecast());
    cmd('data.describe', 'Descriptive Statistics', 'Write the mean, median, spread and other statistics of the selected numbers to a new sheet.', true, () => this.whatIf.describe());
    cmd('data.regression', 'Regression', 'Fit a least-squares line to selected Y and X columns and write the statistics and coefficients to a new sheet.', true, () => this.whatIf.regression());
    cmd('data.analysis', 'Data Analysis', 'Pick an analysis tool such as ANOVA, correlation, histogram, moving average, t-test or random numbers, and write its tables to a new sheet.', true, () => this.whatIf.dataAnalysis());
    cmd('data.analyze', 'Analyze Data', 'Open a panel of simple insights about the selected data: totals, top values, trends and unusual numbers.', false, () => this.whatIf.analyze());
    cmd('data.datatable-refresh', 'Recalculate data tables', 'Recalculate every data table now.', true, () => this.whatIf.refresh());
    cmd('data.validation', 'Data validation', 'Limit what can be typed in the selected cells, offer a dropdown list, show a message when a cell is selected and an alert when a value is not allowed.', true, () => this.validBox());
    const T = () => this.tools;
    cmd('data.tools', 'Data tools', 'Open the list of data tools: remove duplicates, text to columns, cleanup, consolidate, subtotals, advanced filter, flash fill, checkboxes, filter views and slicers.', false, () => this.dataMenu());
    cmd('data.dedupe', 'Remove duplicates', 'Delete rows that repeat the values of the columns you choose, keeping the first, and report how many were removed.', true, () => T().dedupe());
    cmd('data.text-to-columns', 'Text to columns', 'Split the text of a column into several columns at tabs, commas, semicolons, spaces or another delimiter, or at fixed positions.', true, () => T().textToColumns());
    cmd('data.trim', 'Trim whitespace', 'Remove leading, trailing and repeated spaces from the text in the selected cells.', true, () => T().trim());
    cmd('data.cleanup', 'Data cleanup', 'Find extra spaces, inconsistent letter case, numbers stored as text and duplicate rows, and fix the ones you pick.', true, () => T().cleanup());
    cmd('data.consolidate', 'Consolidate', 'Combine ranges from one or more sheets with sum, count, average, max or min, by position or by their row and column labels.', true, () => T().consolidate());
    cmd('data.subtotal', 'Subtotal', 'Insert SUBTOTAL rows at each change in a column, group the detail rows in an outline and add a grand total, or remove them all.', true, () => T().subtotal());
    cmd('data.advanced-filter', 'Advanced filter', 'Filter a list in place or copy the matching records elsewhere using a criteria range, with unique records only if you want.', true, () => T().advancedFilter());
    cmd('data.flash-auto', 'Automatically Flash Fill', 'Turn on or off the grey Flash Fill suggestion that appears under an example you type next to your data; Enter accepts it, Esc or any other key dismisses it.', false, () => this.toggleFlashAuto());
    cmd('data.flash-fill', 'Flash Fill', 'Fill the cells next to your data by following the pattern of the examples you typed.', true, () => T().flashFill(), 'Mod+E');
    cmd('data.circle-invalid', 'Circle invalid data', 'Draw a red circle around every cell whose value breaks its data validation rule.', true, () => this.grid.circleInvalid().then((n) => this.status(n ? `${n} cell${n === 1 ? '' : 's'} circled.` : 'No invalid data found.')));
    cmd('data.clear-circles', 'Clear validation circles', 'Remove the red circles drawn by Circle invalid data.', true, () => this.grid.clearCircles());
    cmd('data.checkbox-insert', 'Insert checkboxes', 'Turn the selected cells into checkboxes that hold TRUE or FALSE. Click one or press Space to toggle it.', true, () => T().checkboxes(true));
    cmd('data.checkbox-remove', 'Remove checkboxes', 'Turn the selected checkbox cells back into plain cells.', true, () => T().checkboxes(false));
    cmd('data.column-type', 'Table column type', 'Set a type for a table column: text, number, date, dropdown or checkbox. Entries of another type ask before they are kept.', true, () => T().columnType());
    cmd('data.filter-views', 'Filter views', 'Save the current filter as a named view and switch between saved views.', false, () => this.tools.filterViewsMenu(...this.below('data.tools')));
    cmd('data.slicer', 'Insert slicer', 'Add a floating panel with a button for each value of a filter column; clicking buttons filters that column.', false, () => T().insertSlicer());
    cmd('edit.find', 'Find', 'Search the sheet or the workbook for text or numbers, with match case, entire cell and values or formulas options.', false, () => T().openFind(false), 'Mod+F');
    cmd('edit.replace', 'Find and replace', 'Replace text or numbers in the sheet or the workbook as one undo step.', true, () => T().openFind(true), 'Mod+H');
    cmd('edit.paste-ops', 'Paste special options', 'Paste values, formulas or formats with add, subtract, multiply or divide, skipping blanks or transposing.', true, () => T().pasteOps());
    cmd('edit.autocomplete', 'AutoComplete', 'Turn on or off suggesting a completion from other text in the same column while you type.', false, () => this.toggleAutoComplete());
    cmd('edit.series', 'Fill series', 'Fill the selection with a linear, growth, date or AutoFill series with a step and stop value, or fit a linear or growth trend to the numbers already there.', true, () => T().series());
    cmd('edit.insert-cells', 'Insert cells', 'Insert blank cells in the selection and shift the cells below them down or the cells to their right over.', true, () => this.cellsMenu(true));
    cmd('edit.delete-cells', 'Delete cells', 'Delete the selected cells and shift the cells below up or the cells to the right left.', true, () => this.cellsMenu(false));
    cmd('file.properties', 'Document properties', 'Edit the title, subject, author, manager, company, categories, tags, status and comments saved with the workbook and written to .xlsx, and see its dates and statistics.', false, () => T().docProps());
    cmd('file.save-template', 'Save as template', 'Save a copy of this workbook in your personal templates.', false, () => this.saveTemplate());
    cmd('sheet.hide', 'Hide sheet', 'Hide the active sheet tab. The sheet and its data stay in the workbook.', true, () => this.hideSheet(this.grid.sheetIndex, true));
    cmd('sheet.ungroup', 'Ungroup sheets', 'Stop editing several sheets together.', false, () => {
      this.grouped.clear();
      this.renderTabs();
    });
    cmd('data.filter-clear', 'Clear filter', 'Show every row again and keep the filter buttons.', true, () => this.filterWith(null));
    cmd('data.filter-reapply', 'Reapply filter', 'Run the filter again over the current values, taking in rows added below it.', true, () => g.reapplyFilter());
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
    cmd('format.font', 'Font', 'Choose the typeface of the selected cells.', true, () => document.querySelector<HTMLButtonElement>('.rb-combo.is-font .rb-combo-btn')?.click());
    cmd('format.size', 'Font size', 'Choose the text size of the selected cells, in points.', true, () => this.listMenu('format.size', SIZE_PRESETS.map((n) => [String(n), n === 10 ? 'sz:' : `sz:${n}`]), String(g.activeStyle().size ?? 10)));
    void api('PUT', '/api/commands', listCommands()).catch(() => undefined);
  }

  private bindChrome(): void {
    const p = this.p;
    p.homeBtn.addEventListener('click', () => void runCommand('file.home'));
    p.formulaBar.parentElement?.querySelector('.fc-fx')?.addEventListener('mousedown', (e) => e.preventDefault());
    p.formulaBar.parentElement?.querySelector('.fc-fx')?.addEventListener('click', () => void runCommand('formula.arguments'));
    document.addEventListener('keydown', (e) => {
      if (!this.open || document.querySelector('.fc-modal:not([hidden])')) return;
      const mod = e.ctrlKey || e.metaKey;
      const sheetUp = !!document.querySelector('.fc-sheet:not([hidden])');
      if (!sheetUp) return;
      let id = '';
      if (e.key === 'F3' && mod && e.shiftKey) id = 'names.create';
      else if (e.key === 'F3' && mod) id = 'names.manager';
      else if (e.key === 'F3' && e.shiftKey) id = 'formula.insert-function';
      else if (e.key === 'F3' && !e.altKey) id = 'names.paste';
      else if (e.key === 'F7' && !mod && !e.altKey && !e.shiftKey) id = 'review.spelling';
      else if (mod && e.altKey && e.shiftKey && e.key.toLowerCase() === 'p') id = 'python.cell';
      else if (mod && e.shiftKey && !e.altKey && e.code === 'KeyU') id = 'view.formula-bar';
      else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a' && (e.target === p.formulaBar || e.target === this.grid.editor) && String((e.target as HTMLInputElement).value).startsWith('=')) id = 'formula.arguments';
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      void runCommand(id);
    }, true);
    this.button('format.painter').addEventListener('dblclick', () => void this.grid.startPainter(true).then(() => this.grid.focus()));
    p.addSheet.addEventListener('click', () => void runCommand('sheet.add'));
    p.tabs.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-sheet]');
      if (!t || !this.open || t.contentEditable === 'true') return;
      const i = Number(t.dataset.sheet);
      const at = this.grid.sheetIndex;
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        if (!this.grouped.size) this.grouped.add(at);
        if (e.shiftKey) {
          for (let k = Math.min(at, i); k <= Math.max(at, i); k++) if (!this.open.views[k]?.hidden) this.grouped.add(k);
        } else if (this.grouped.has(i) && i !== at) this.grouped.delete(i);
        else this.grouped.add(i);
        if (this.grouped.size < 2) this.grouped.clear();
        this.renderTabs();
        this.status(this.grouped.size ? `Group mode: ${this.grouped.size} sheets edit together` : 'Sheets ungrouped');
        return;
      }
      if (this.grouped.size && !this.grouped.has(i)) {
        this.grouped.clear();
        this.status('Sheets ungrouped');
      }
      this.showSheet(i);
      this.renderTabs();
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
    p.zoom.querySelector<HTMLInputElement>('.fc-zoom-slider')!.addEventListener('input', (e) => this.grid.setZoom(Number((e.target as HTMLInputElement).value) / 100));
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
    p.formulaToggle.addEventListener('click', () => this.toggleFormulaBar());
    p.formulaGrip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const y0 = e.clientY;
      const h0 = p.formulaBar.offsetHeight;
      const move = (m: PointerEvent) => p.formulaBox.style.setProperty('--fbar-h', `${Math.max(52, Math.min(360, h0 + m.clientY - y0))}px`);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        try {
          localStorage.setItem('fc-fbar-h', String(p.formulaBar.offsetHeight));
        } catch {
          return;
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    try {
      const h = Number(localStorage.getItem('fc-fbar-h'));
      if (h >= 52 && h <= 360) p.formulaBox.style.setProperty('--fbar-h', `${h}px`);
    } catch {
      p.formulaBox.style.removeProperty('--fbar-h');
    }
    p.formulaBar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.altKey) {
        e.preventDefault();
        const f = p.formulaBar;
        f.setRangeText('\n', f.selectionStart, f.selectionEnd, 'end');
        f.dispatchEvent(new Event('input'));
        if (!this.fbarOpen()) this.toggleFormulaBar(true);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (p.formulaBar.value.startsWith('{=TABLE(')) {
          this.grid.focus();
          return;
        }
        void this.grid.setActive(p.formulaBar.value).then(() => this.grid.focus());
      } else if (e.key === 'Escape') {
        e.preventDefault();
        p.formulaBar.value = this.current;
        void this.grid.localise(this.current, true).then((v) => (p.formulaBar.value = v));
        this.grid.focus();
      }
    });
  }

  private flashAuto = ((): boolean => {
    try {
      return localStorage.getItem('fc-flash-auto') !== '0';
    } catch {
      return true;
    }
  })();

  private autoFlash(changes: Changed[]): void {
    const at = this.grid.sheetIndex;
    if (!this.flashAuto || this.grid.replaying || changes.length !== 1) return;
    const [s, r, c, t, f] = changes[0];
    if (s !== at || f || !t) return;
    void this.grid.flashPreview(r, c);
  }

  private toggleFlashAuto(): void {
    this.flashAuto = !this.flashAuto;
    if (!this.flashAuto) this.grid.clearGhost();
    try {
      localStorage.setItem('fc-flash-auto', this.flashAuto ? '1' : '0');
    } catch {
      this.status('Flash Fill setting changed for this session only');
      return;
    }
    this.status(`Automatically Flash Fill ${this.flashAuto ? 'on: suggestions appear in grey, press Enter to accept' : 'off: use Ctrl+E'}`);
  }

  private fbarOpen(): boolean {
    return this.p.formulaBox.dataset.open === 'true';
  }

  private toggleFormulaBar(force?: boolean): void {
    const p = this.p;
    const on = force ?? !this.fbarOpen();
    p.formulaBox.dataset.open = String(on);
    p.formulaBar.wrap = on ? 'soft' : 'off';
    p.formulaGrip.hidden = !on;
    p.formulaToggle.setAttribute('aria-expanded', String(on));
    const label = on ? 'Collapse formula bar (Ctrl+Shift+U)' : 'Expand formula bar (Ctrl+Shift+U)';
    p.formulaToggle.title = label;
    p.formulaToggle.setAttribute('aria-label', label.replace(' (Ctrl+Shift+U)', ''));
    p.formulaBar.focus();
  }

  private async route(): Promise<void> {
    const m = /^#w-([a-z0-9]+)$/.exec(location.hash);
    if (m) {
      if (this.open?.id !== m[1]) await this.openWorkbook(m[1], false);
      return;
    }
    this.flush();
    await this.saving;
    if (!this.launched) {
      this.launched = true;
      if (!autoShowHome()) {
        const list = await api<WorkbookMeta[]>('GET', '/api/workbooks').catch(() => [] as WorkbookMeta[]);
        const last = [...list].sort((a, b) => String(b.modified).localeCompare(String(a.modified)))[0];
        if (last) {
          location.hash = `w-${last.id}`;
          return;
        }
        await this.create();
        return;
      }
    }
    this.showHome();
  }

  private launched = false;

  private showHome(): void {
    const p = this.p;
    if (this.open) this.home.setLast(this.open.id);
    this.open = null;
    this.collab.detach();
    this.dtypes.closed();
    this.auto.closed();
    this.vba.closed();
    this.grouped.clear();
    this.tools.resetTemp();
    this.tools.syncSlicers();
    p.sheet.hidden = true;
    p.home.hidden = false;
    p.homeBtn.hidden = true;
    p.title.hidden = true;
    p.groupBadge.hidden = true;
    p.save.hidden = true;
    document.title = 'FormCel';
    this.homeLoaded = this.refresh().catch(() => undefined);
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
    if (!template) {
      for (let n = meta.sheets.length; n < prefs().newSheets; n++) await api('POST', `/api/workbooks/${meta.id}/sheets`, { name: `Sheet${n + 1}` }).catch(() => undefined);
    }
    location.hash = `w-${meta.id}`;
  }

  private async sorted(p: Promise<void>): Promise<void> {
    try {
      await p;
    } catch (e) {
      this.status(e instanceof Error ? e.message : 'Not sorted', true);
    }
  }

  private async sortBox(): Promise<void> {
    const o = this.open;
    if (!o) return;
    const { range, header } = await this.grid.sortTarget();
    const f = this.sortForm ??= this.makeSortForm();
    f.range = range;
    f.header.checked = header;
    f.caseSensitive.checked = false;
    f.across.checked = false;
    f.lists = [...(await engine().sortLists()), ...loadSortLists()];
    await this.sortNames(f);
    f.levels.replaceChildren();
    const active = this.grid.activeColumn();
    this.addSortLevel(f, active >= range.c0 && active <= range.c1 ? active : range.c0, false);
    f.title.textContent = `Sort ${colName(range.c0)}${range.r0 + 1}:${colName(range.c1)}${range.r1 + 1}`;
    f.hint.textContent = '';
    f.form.dataset.state = '';
    f.form.hidden = false;
    f.levels.querySelector('select')?.focus();
  }

  private async sortNames(f: SortForm): Promise<void> {
    const o = this.open;
    const range = f.range;
    if (!o || !range) return;
    f.names = [];
    if (f.across.checked) {
      const heads = await engine().readValues(o.book, this.grid.sheetIndex, range.r0, range.c0, range.r1, range.c0);
      for (let r = range.r0; r <= range.r1; r++) f.names.push([r, heads.find(([rr]) => rr === r)?.[2].replace(/^'/, '') ?? '']);
      return;
    }
    const heads = await engine().readValues(o.book, this.grid.sheetIndex, range.r0, range.c0, range.r0, range.c1);
    for (let c = range.c0; c <= range.c1; c++) f.names.push([c, heads.find(([, cc]) => cc === c)?.[2].replace(/^'/, '') ?? '']);
  }

  private sortLabel(f: SortForm, c: number, h: string): string {
    if (f.header.checked && h) return h;
    return f.across.checked ? `Row ${c + 1}` : `Column ${colName(c)}`;
  }

  private async sortOrderOptions(f: SortForm, row: HTMLElement, pick: string): Promise<void> {
    const o = this.open;
    const on = row.querySelector<HTMLSelectElement>('.fc-sort-on')!.value;
    const dir = row.querySelector<HTMLSelectElement>('.fc-sort-dir')!;
    const opts: string[] = [];
    if (on === 'v') {
      opts.push('<option value="a">A to Z</option>', '<option value="d">Z to A</option>');
      f.lists.forEach((l, i) => opts.push(`<option value="l:${i}">${escapeHtml(l.slice(0, 4).join(', '))}${l.length > 4 ? ', ...' : ''}</option>`));
    } else if (o && f.range) {
      const key = Number(row.querySelector<HTMLSelectElement>('.fc-sort-col')!.value);
      const r = f.range;
      const found = await engine().sortChoices(o.book, this.grid.sheetIndex, r.r0, r.c0, r.r1, r.c1, f.header.checked, f.across.checked, key);
      const list = on === 'fill' ? found.fills : on === 'font' ? found.fonts : found.icons;
      const none = on === 'fill' ? 'No fill' : on === 'font' ? 'Automatic' : 'No icon';
      for (const v of list) {
        const name = v === 'none' || v === 'auto' ? none : v;
        opts.push(`<option value="${escapeHtml(v)}|top">${escapeHtml(name)} on top</option>`, `<option value="${escapeHtml(v)}|bottom">${escapeHtml(name)} on bottom</option>`);
      }
    }
    dir.innerHTML = opts.join('');
    dir.value = [...dir.options].some((x) => x.value === pick) ? pick : dir.options[0]?.value ?? '';
  }

  private addSortLevel(f: SortForm, col: number, descending: boolean): void {
    if (f.levels.children.length >= 64) return;
    const row = document.createElement('div');
    row.className = 'fc-sort-level';
    const label = f.levels.children.length ? 'Then by' : 'Sort by';
    const opts = f.names.map(([c, h]) => `<option value="${c}">${escapeHtml(this.sortLabel(f, c, h))}</option>`).join('');
    row.innerHTML = `<span class="fc-sort-by">${label}</span><select class="fc-fmt-input fc-sort-col" aria-label="${label}">${opts}</select><select class="fc-fmt-input fc-sort-on" aria-label="Sort on"><option value="v">Cell values</option><option value="fill">Cell colour</option><option value="font">Font colour</option><option value="icon">Conditional formatting icon</option></select><select class="fc-fmt-input fc-sort-dir" aria-label="Order"></select><button type="button" class="fc-tool" data-a="drop" title="Remove this level" aria-label="Remove this level">${icon('close')}</button>`;
    row.querySelector<HTMLSelectElement>('.fc-sort-col')!.value = String(col);
    f.levels.appendChild(row);
    void this.sortOrderOptions(f, row, descending ? 'd' : 'a');
  }

  private makeSortForm(): SortForm {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom fc-pw fc-sort';
    form.hidden = true;
    form.setAttribute('role', 'dialog');
    form.innerHTML = '<span class="fc-fmt-title"></span><div class="fc-sort-levels"></div><button type="button" class="fc-btn fc-sort-add" data-a="add">Add level</button><label class="fc-sort-check"><input type="checkbox" class="fc-sort-header"> My data has headers</label><label class="fc-sort-check"><input type="checkbox" class="fc-sort-case"> Case sensitive</label><label class="fc-sort-check"><input type="checkbox" class="fc-sort-across"> Sort left to right</label><div class="fc-sort-newlist"><input class="fc-fmt-input fc-sort-list-text" placeholder="New custom list, items separated by commas" aria-label="New custom list" spellcheck="false" autocomplete="off"><button type="button" class="fc-btn" data-a="addlist">Add list</button></div><span class="fc-fmt-hint" aria-live="polite"></span><div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="cancel">Cancel</button><button type="submit" class="fc-btn fc-btn-primary">Sort</button></div>';
    document.getElementById('overlay-root')!.appendChild(form);
    const f: SortForm = {
      form,
      title: form.querySelector<HTMLElement>('.fc-fmt-title')!,
      levels: form.querySelector<HTMLElement>('.fc-sort-levels')!,
      header: form.querySelector<HTMLInputElement>('.fc-sort-header')!,
      caseSensitive: form.querySelector<HTMLInputElement>('.fc-sort-case')!,
      across: form.querySelector<HTMLInputElement>('.fc-sort-across')!,
      newList: form.querySelector<HTMLInputElement>('.fc-sort-list-text')!,
      lists: [],
      hint: form.querySelector<HTMLElement>('.fc-fmt-hint')!,
      range: null,
      names: [],
    };
    const refreshAll = () => { for (const row of f.levels.querySelectorAll<HTMLElement>('.fc-sort-level')) void this.sortOrderOptions(f, row, row.querySelector<HTMLSelectElement>('.fc-sort-dir')!.value); };
    const close = () => { form.hidden = true; this.grid.focus(); };
    form.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'cancel') close();
      if (a === 'add') this.addSortLevel(f, f.names[Math.min(f.levels.children.length, f.names.length - 1)]?.[0] ?? 0, false);
      if (a === 'addlist') {
        const items = f.newList.value.split(',').map((s) => s.trim()).filter(Boolean);
        if (items.length < 2) {
          f.form.dataset.state = 'error';
          f.hint.textContent = 'A custom list needs at least two items.';
          return;
        }
        saveSortList(items);
        f.lists.push(items);
        f.newList.value = '';
        f.form.dataset.state = '';
        f.hint.textContent = 'List added.';
        refreshAll();
      }
      if (a === 'drop' && f.levels.children.length > 1) {
        (e.target as HTMLElement).closest('.fc-sort-level')?.remove();
        const first = f.levels.querySelector('.fc-sort-by');
        if (first) first.textContent = 'Sort by';
      }
    });
    f.header.addEventListener('change', () => {
      for (const sel of f.levels.querySelectorAll<HTMLSelectElement>('.fc-sort-col')) {
        for (const opt of sel.options) {
          const h = f.names.find(([c]) => String(c) === opt.value)?.[1] ?? '';
          opt.textContent = this.sortLabel(f, Number(opt.value), h);
        }
      }
      refreshAll();
    });
    f.across.addEventListener('change', () => {
      void this.sortNames(f).then(() => {
        f.levels.replaceChildren();
        this.addSortLevel(f, f.names[0]?.[0] ?? 0, false);
      });
    });
    form.addEventListener('change', (e) => {
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>('.fc-sort-level');
      if (row && (t.classList.contains('fc-sort-on') || t.classList.contains('fc-sort-col'))) void this.sortOrderOptions(f, row, '');
    });
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!f.range) return;
      const keys = [...f.levels.querySelectorAll('.fc-sort-level')].map((row): SortKeySpec => {
        const col = Number(row.querySelector<HTMLSelectElement>('.fc-sort-col')!.value);
        const on = row.querySelector<HTMLSelectElement>('.fc-sort-on')!.value;
        const pick = row.querySelector<HTMLSelectElement>('.fc-sort-dir')!.value;
        if (on === 'v') {
          return pick.startsWith('l:') ? [col, false, 'list', (f.lists[Number(pick.slice(2))] ?? []).join('\u001f')] : [col, pick === 'd'];
        }
        const cut = pick.lastIndexOf('|');
        return [col, pick.slice(cut + 1) === 'bottom', on as 'fill' | 'font' | 'icon', pick.slice(0, cut)];
      });
      void this.grid.sortRange(f.range, keys, f.header.checked, f.caseSensitive.checked, f.across.checked).then(close, (err: unknown) => {
        form.dataset.state = 'error';
        f.hint.textContent = err instanceof Error ? err.message : 'Not sorted';
      });
    });
    return f;
  }

  private async tableBox(): Promise<void> {
    const o = this.open;
    if (!o) return;
    const { range, header } = await this.grid.sortTarget();
    const f = this.tableForm ??= this.makeTableForm();
    f.querySelector<HTMLInputElement>('[data-k="range"]')!.value = `${colName(range.c0)}${range.r0 + 1}:${colName(range.c1)}${range.r1 + 1}`;
    f.querySelector<HTMLInputElement>('[data-k="header"]')!.checked = header || range.r0 === range.r1;
    f.querySelector<HTMLElement>('.fc-fmt-hint')!.textContent = '';
    f.dataset.state = '';
    f.hidden = false;
    f.querySelector<HTMLInputElement>('[data-k="range"]')!.select();
  }

  private makeTableForm(): HTMLFormElement {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom fc-pw';
    form.hidden = true;
    form.setAttribute('role', 'dialog');
    form.innerHTML = '<span class="fc-fmt-title">Create table</span><label class="fc-fmt-label">Where is the data for your table?<input class="fc-fmt-input" data-k="range" spellcheck="false" autocomplete="off"></label><label class="fc-sort-check"><input type="checkbox" data-k="header"> My table has headers</label><span class="fc-fmt-hint" aria-live="polite"></span><div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="cancel">Cancel</button><button type="submit" class="fc-btn fc-btn-primary">OK</button></div>';
    document.getElementById('overlay-root')!.appendChild(form);
    const close = () => { form.hidden = true; this.grid.focus(); };
    const hint = form.querySelector<HTMLElement>('.fc-fmt-hint')!;
    form.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-a="cancel"]')) close(); });
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const r = parseRef(form.querySelector<HTMLInputElement>('[data-k="range"]')!.value.replace(/\$/g, ''));
      if (!r) {
        form.dataset.state = 'error';
        hint.textContent = 'Type a range such as A1:D20.';
        return;
      }
      void this.grid.createTable(r, form.querySelector<HTMLInputElement>('[data-k="header"]')!.checked).then(close, (err: unknown) => {
        form.dataset.state = 'error';
        hint.textContent = err instanceof Error ? err.message : 'No table made';
      });
    });
    return form;
  }

  private designBox(): void {
    const t = this.grid.activeTable();
    if (!t) return;
    const f = this.designForm ??= this.makeDesignForm();
    const q = <T extends HTMLElement>(k: string) => f.querySelector<T>(`[data-k="${k}"]`)!;
    f.dataset.table = t.name;
    q<HTMLInputElement>('name').value = t.name;
    const parsed = parseCustom(t.style);
    if (parsed) this.useCustomStyle(q<HTMLSelectElement>('style'), t.style);
    q<HTMLSelectElement>('style').value = t.style;
    if (parsed) {
      q<HTMLInputElement>('cname').value = parsed.name;
      q<HTMLInputElement>('chead').value = `#${parsed.head}`;
      q<HTMLInputElement>('cband').value = `#${parsed.band}`;
      q<HTMLInputElement>('ctext').value = `#${parsed.text}`;
    }
    const [r0, c0, r1, c1] = t.area;
    q<HTMLInputElement>('range').value = `${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}`;
    for (const [k, ch] of [['totals', 't'], ['rows', 'r'], ['cols', 'c'], ['first', 'f'], ['last', 'l'], ['button', 'b']]) q<HTMLInputElement>(k).checked = t.flags.includes(ch);
    q<HTMLInputElement>('header').checked = !t.flags.includes('n');
    const holder = q<HTMLElement>('types');
    holder.replaceChildren();
    const kinds = ['text', 'number', 'date', 'dropdown', 'checkbox', 'people'];
    t.cols.forEach((name, i) => {
      const cur = t.types[i] ?? '';
      const base = cur.split(':')[0] || 'text';
      const row = document.createElement('div');
      row.className = 'fc-tabled-type';
      const label = document.createElement('span');
      label.textContent = name || `Column ${i + 1}`;
      const sel = document.createElement('select');
      sel.className = 'fc-fmt-input';
      sel.dataset.col = String(i);
      sel.dataset.was = cur;
      for (const k of kinds) sel.add(new Option(k[0].toUpperCase() + k.slice(1), k, false, k === base));
      const items = document.createElement('input');
      items.className = 'fc-fmt-input';
      items.placeholder = 'Items, separated by commas';
      items.value = cur.split(':').slice(1).join(':').replace(/\|/g, ', ');
      items.hidden = base !== 'dropdown';
      sel.addEventListener('change', () => { items.hidden = sel.value !== 'dropdown'; });
      row.append(label, sel, items);
      holder.appendChild(row);
    });
    f.querySelector<HTMLElement>('.fc-fmt-hint')!.textContent = '';
    f.dataset.state = '';
    f.hidden = false;
    q<HTMLInputElement>('name').select();
  }

  private useCustomStyle(sel: HTMLSelectElement, id: string): void {
    const group = sel.querySelector<HTMLElement>('[data-k="customgroup"]')!;
    let opt = Array.from(group.querySelectorAll('option')).find((o) => o.value === id);
    if (!opt) {
      opt = new Option(parseCustom(id)?.name ?? id, id);
      group.appendChild(opt);
    }
    sel.value = id;
  }

  private makeDesignForm(): HTMLFormElement {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom fc-pw fc-tabled';
    form.hidden = true;
    form.setAttribute('role', 'dialog');
    const group = (k: string) => `<optgroup label="${k}">${TABLE_STYLES.filter(([id]) => id.startsWith(`TableStyle${k}`)).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</optgroup>`;
    const styles = `<option value="None">None</option>${group('Light')}${group('Medium')}${group('Dark')}<optgroup label="Custom" data-k="customgroup"></optgroup>`;
    const box = (k: string, label: string) => `<label class="fc-sort-check"><input type="checkbox" data-k="${k}"> ${label}</label>`;
    form.innerHTML = `<span class="fc-fmt-title">Table design</span><label class="fc-fmt-label">Table name<input class="fc-fmt-input" data-k="name" spellcheck="false" autocomplete="off"></label><label class="fc-fmt-label">Table style<select class="fc-fmt-input" data-k="style">${styles}</select></label><label class="fc-fmt-label">Resize table (keep the top-left cell)<input class="fc-fmt-input" data-k="range" spellcheck="false" autocomplete="off"></label><div class="fc-tabled-opts">${box('header', 'Header row')}${box('totals', 'Total row')}${box('rows', 'Banded rows')}${box('cols', 'Banded columns')}${box('first', 'First column')}${box('last', 'Last column')}${box('button', 'Filter button')}</div><div class="fc-tabled-custom"><input class="fc-fmt-input" data-k="cname" placeholder="Custom style name" spellcheck="false" autocomplete="off"><label>Header <input type="color" data-k="chead" value="#1f6feb"></label><label>Bands <input type="color" data-k="cband" value="#dbe7fb"></label><label>Header text <input type="color" data-k="ctext" value="#ffffff"></label><button type="button" class="fc-btn" data-a="customstyle">Use custom style</button></div><span class="fc-fmt-title">Column types</span><div class="fc-tabled-types" data-k="types"></div><div class="fc-tabled-tools"><button type="button" class="fc-btn" data-a="dedupe">Remove duplicates</button><button type="button" class="fc-btn" data-a="pivot">Summarize with PivotTable</button><button type="button" class="fc-btn" data-a="slicer">Insert slicer</button></div><span class="fc-fmt-hint" aria-live="polite"></span><div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="convert">Convert to range</button><button type="button" class="fc-btn" data-a="cancel">Cancel</button><button type="submit" class="fc-btn fc-btn-primary">OK</button></div>`;
    document.getElementById('overlay-root')!.appendChild(form);
    const q = <T extends HTMLElement>(k: string) => form.querySelector<T>(`[data-k="${k}"]`)!;
    const hint = form.querySelector<HTMLElement>('.fc-fmt-hint')!;
    const close = () => { form.hidden = true; this.grid.focus(); };
    const fail = (err: unknown) => {
      form.dataset.state = 'error';
      hint.textContent = err instanceof Error ? err.message : 'Not changed';
    };
    form.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'cancel') close();
      if (a === 'customstyle') {
        const hex = (k: string) => q<HTMLInputElement>(k).value.slice(1);
        const name = q<HTMLInputElement>('cname').value.trim();
        if (!name) return fail(new Error('Name the custom style.'));
        this.useCustomStyle(q<HTMLSelectElement>('style'), customId({ name, head: hex('chead'), band: hex('cband'), text: hex('ctext') }));
      }
      if (a === 'dedupe' || a === 'pivot' || a === 'slicer') {
        close();
        void runCommand(a === 'dedupe' ? 'data.dedupe' : a === 'pivot' ? 'pivot.create' : 'data.slicer');
      }
      if (a === 'convert') {
        const t = this.grid.tables().find((x) => x.name === form.dataset.table);
        if (!t) return;
        const keep: [number, number, number, number, string][] = [];
        const [r0, c0, r1, c1] = t.area;
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const p = this.grid.tablePaintAt(t, r, c);
            const edges = (p?.borders ?? []).map((bd, i) => (bd ? `${['bt', 'br', 'bb', 'bl'][i]}:${bd.line}:${bd.color.slice(1)}` : ''));
            const parts = [p?.bg ? `bg:${p.bg.slice(1)}` : '', p?.fc ? `fc:${p.fc.slice(1)}` : '', p?.b ? 'b' : '', ...edges].filter(Boolean);
            if (parts.length) keep.push([r, c, r, c, parts.join(';')]);
          }
        }
        void this.grid.removeTable(t.name, keep).then(close, fail);
      }
    });
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = this.grid.tables().find((x) => x.name === form.dataset.table);
      if (!t) return;
      if (q<HTMLInputElement>('header').checked === t.flags.includes('n')) {
        const [a0, a1, a2, a3] = t.area;
        const unchanged = q<HTMLInputElement>('range').value === `${colName(a1)}${a0 + 1}:${colName(a3)}${a2 + 1}`;
        void this.grid.runTool('tableheader', t.name, q<HTMLInputElement>('header').checked ? '1' : '0').then(async () => {
          await this.grid.loadTables();
          const now = this.grid.tables().find((x) => x.name === t.name);
          if (now && unchanged) q<HTMLInputElement>('range').value = `${colName(now.area[1])}${now.area[0] + 1}:${colName(now.area[3])}${now.area[2] + 1}`;
          form.requestSubmit();
        }, fail);
        return;
      }
      const r = parseRef(q<HTMLInputElement>('range').value.replace(/\$/g, ''));
      if (!r) return fail(new Error('Type a range such as A1:D20.'));
      const name = q<HTMLInputElement>('name').value.trim();
      const flags = [['totals', 't'], ['rows', 'r'], ['cols', 'c'], ['first', 'f'], ['last', 'l'], ['button', 'b']].filter(([k]) => q<HTMLInputElement>(k).checked).map(([, c]) => c).join('');
      let r1 = r.r1;
      if (flags.includes('t') !== t.flags.includes('t') && r.r1 === t.area[2]) r1 = t.area[2];
      const w = r.c1 - r.c0 + 1;
      const cols = Array.from({ length: w }, (_, i) => t.cols[i] ?? '');
      const pad = (list: string[]) => Array.from({ length: w }, (_, i) => list[i] ?? '');
      const lead = t.flags.includes('n') ? 'n' : '';
      const parts = [name, `${r.r0},${r.c0},${r1},${r.c1}`, lead + (t.flags.includes('t') ? `${flags.replace('t', '')}t` : flags.replace('t', '')), q<HTMLSelectElement>('style').value, String(w), ...cols, ...pad(t.calc), ...pad(t.kept), ...pad(t.types)];
      const want = flags.includes('t');
      const picks: [number, string][] = [];
      for (const sel of form.querySelectorAll<HTMLSelectElement>('[data-col]')) {
        const items = (sel.nextElementSibling as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean).join('|');
        const kind = sel.value === 'dropdown' ? `dropdown:${items}` : sel.value === 'text' && !sel.dataset.was ? '' : sel.value;
        if (sel.value === 'dropdown' && !items) return fail(new Error('Type the dropdown items.'));
        if (kind !== (sel.dataset.was ?? '') && Number(sel.dataset.col) < w) picks.push([Number(sel.dataset.col), kind]);
      }
      void (async () => {
        await this.grid.setTable(t.name, parts.map(fieldEsc).join('\t'));
        for (const [col, kind] of picks) await this.grid.runTool('tabletype', name, String(col), kind);
        if (want !== t.flags.includes('t')) {
          const now = this.grid.tables().find((x) => x.name === name) ?? t;
          const p2 = now.line.split('\t').slice(1);
          p2[2] = want ? `${p2[2]}t` : p2[2].replace('t', '');
          await this.grid.setTable(now.name, p2.join('\t'));
        }
      })().then(close, fail);
    });
    return form;
  }

  private validBox(): void {
    const v = this.validForm ??= this.makeValidForm();
    const rule = this.grid.activeRule();
    const s = this.grid.selection();
    v.title.textContent = `Data validation for ${colName(s.c0)}${s.r0 + 1}${s.r0 === s.r1 && s.c0 === s.c1 ? '' : `:${colName(s.c1)}${s.r1 + 1}`}`;
    const [, kind = 'any', op = 'between', a = '', b = '', flags = 'bde', style = 'stop', pt = '', pm = '', et = '', em = '', colors = ''] = rule ?? [];
    const f = v.f;
    f.kind.value = kind;
    f.op.value = op || 'between';
    f.a.value = a;
    f.b.value = b;
    (f.blank as HTMLInputElement).checked = flags.includes('b');
    (f.drop as HTMLInputElement).checked = !rule || flags.includes('d');
    (f.prompt as HTMLInputElement).checked = !rule || flags.includes('p');
    (f.alert as HTMLInputElement).checked = !rule || flags.includes('e');
    (f.chips as HTMLInputElement).checked = flags.includes('c');
    (f.multi as HTMLInputElement).checked = flags.includes('m');
    v.saved = colors;
    v.colorKey = '';
    v.colors.replaceChildren();
    f.style.value = style;
    f.pt.value = pt;
    f.pm.value = pm;
    f.et.value = et;
    f.em.value = em;
    v.hint.textContent = '';
    v.form.dataset.state = '';
    this.validTab(v, 'settings');
    this.validSync(v);
    v.form.hidden = false;
    f.kind.focus();
  }

  private validTab(v: ValidForm, tab: string): void {
    for (const b of v.form.querySelectorAll<HTMLElement>('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const p of v.form.querySelectorAll<HTMLElement>('[data-panel]')) p.hidden = p.dataset.panel !== tab;
  }

  private validSync(v: ValidForm): void {
    const kind = v.f.kind.value;
    const op = v.f.op.value;
    const ranged = !['any', 'list', 'custom', 'checkbox'].includes(kind);
    const two = ranged && (op === 'between' || op === 'notbetween');
    v.f.op.disabled = !ranged;
    v.f.a.disabled = kind === 'any';
    v.f.b.disabled = !two && kind !== 'checkbox';
    v.f.drop.disabled = kind !== 'list';
    v.f.chips.disabled = kind !== 'list';
    v.f.multi.disabled = kind !== 'list';
    v.f.blank.disabled = kind === 'checkbox';
    const chips = kind === 'list' && (v.f.chips as HTMLInputElement).checked;
    v.colors.hidden = !chips;
    if (chips) void this.validColors(v);
    const word = kind === 'date' ? ['Start date', 'End date', 'Date'] : kind === 'time' ? ['Start time', 'End time', 'Time'] : kind === 'length' ? ['Minimum length', 'Maximum length', 'Length'] : ['Minimum', 'Maximum', 'Value'];
    v.labelA.textContent = kind === 'list' ? 'Source (items separated by commas, or a range such as =$E$1:$E$9)' : kind === 'custom' ? 'Formula (TRUE when the value is allowed)' : kind === 'checkbox' ? 'Checked value (blank for TRUE)' : kind === 'any' ? 'Value' : two ? word[0] : word[2];
    v.labelB.textContent = kind === 'checkbox' ? 'Unchecked value (blank for FALSE)' : word[1];
  }

  private async validColors(v: ValidForm): Promise<void> {
    const a = v.f.a.value.trim();
    const typed = a.startsWith('=') ? await this.grid.listItems() : a.split(',').map((s) => s.trim()).filter(Boolean);
    const items = [...new Set(typed)];
    const key = items.join('\u001f');
    if (key === v.colorKey) return;
    v.colorKey = key;
    const prev = new Map<string, string>();
    for (const part of v.saved.split(';')) {
      const [k, c] = part.split('=');
      if (k && c) prev.set(k.trim().toLowerCase(), c.trim());
    }
    for (const input of v.colors.querySelectorAll<HTMLInputElement>('input[data-item]')) prev.set(input.dataset.item!.toLowerCase(), input.value);
    const palette = ['#d2e3fc', '#ceead6', '#fce8b2', '#fad2cf', '#e8d0f4', '#d1e7e9', '#fde2c5', '#e0e3e7'];
    v.colors.replaceChildren(...items.slice(0, 60).map((item, i) => {
      const row = document.createElement('label');
      row.className = 'fc-valid-color';
      const input = document.createElement('input');
      input.type = 'color';
      input.dataset.item = item;
      const saved = prev.get(item.toLowerCase()) ?? palette[i % palette.length];
      input.value = /^#[0-9a-f]{6}$/i.test(saved) ? saved : palette[i % palette.length];
      const name = document.createElement('span');
      name.textContent = item;
      row.append(input, name);
      return row;
    }));
  }

  private makeValidForm(): ValidForm {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom fc-pw fc-valid';
    form.hidden = true;
    form.setAttribute('role', 'dialog');
    const opt = (list: [string, string][]) => list.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    form.innerHTML = `<span class="fc-fmt-title"></span><div class="fc-valid-tabs" role="tablist"><button type="button" role="tab" class="fc-btn" data-tab="settings">Settings</button><button type="button" role="tab" class="fc-btn" data-tab="input">Input message</button><button type="button" role="tab" class="fc-btn" data-tab="error">Error alert</button></div>
<div class="fc-valid-panel" data-panel="settings"><label class="fc-fmt-label">Allow<select class="fc-fmt-input" data-k="kind">${opt(VALID_KINDS)}</select></label><label class="fc-fmt-label">Data<select class="fc-fmt-input" data-k="op">${opt(VALID_OPS)}</select></label><label class="fc-fmt-label"><span class="fc-valid-a"></span><input class="fc-fmt-input" data-k="a" spellcheck="false" autocomplete="off"></label><label class="fc-fmt-label"><span class="fc-valid-b"></span><input class="fc-fmt-input" data-k="b" spellcheck="false" autocomplete="off"></label><label class="fc-sort-check"><input type="checkbox" data-k="blank"> Ignore blank</label><label class="fc-sort-check"><input type="checkbox" data-k="drop"> In-cell dropdown</label><label class="fc-sort-check"><input type="checkbox" data-k="chips"> Show items as coloured chips</label><label class="fc-sort-check"><input type="checkbox" data-k="multi"> Allow multiple selections</label><div class="fc-valid-colors" hidden></div></div>
<div class="fc-valid-panel" data-panel="input" hidden><label class="fc-sort-check"><input type="checkbox" data-k="prompt"> Show input message when cell is selected</label><label class="fc-fmt-label">Title<input class="fc-fmt-input" data-k="pt" maxlength="225" autocomplete="off"></label><label class="fc-fmt-label">Input message<textarea class="fc-fmt-input fc-valid-text" data-k="pm" maxlength="225"></textarea></label></div>
<div class="fc-valid-panel" data-panel="error" hidden><label class="fc-sort-check"><input type="checkbox" data-k="alert"> Show error alert after invalid data is entered</label><label class="fc-fmt-label">Style<select class="fc-fmt-input" data-k="style"><option value="stop">Stop</option><option value="warning">Warning</option><option value="info">Information</option></select></label><label class="fc-fmt-label">Title<input class="fc-fmt-input" data-k="et" maxlength="225" autocomplete="off"></label><label class="fc-fmt-label">Error message<textarea class="fc-fmt-input fc-valid-text" data-k="em" maxlength="225"></textarea></label></div>
<span class="fc-fmt-hint" aria-live="polite"></span><div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="clear">Clear all</button><button type="button" class="fc-btn" data-a="cancel">Cancel</button><button type="submit" class="fc-btn fc-btn-primary">OK</button></div>`;
    document.getElementById('overlay-root')!.appendChild(form);
    const f: ValidForm['f'] = {};
    for (const el of form.querySelectorAll<HTMLInputElement>('[data-k]')) f[el.dataset.k!] = el;
    const v: ValidForm = { form, title: form.querySelector('.fc-fmt-title')!, f, labelA: form.querySelector('.fc-valid-a')!, labelB: form.querySelector('.fc-valid-b')!, hint: form.querySelector('.fc-fmt-hint')!, colors: form.querySelector('.fc-valid-colors')!, colorKey: '', saved: '' };
    const close = () => { form.hidden = true; this.grid.focus(); };
    const fail = (err: unknown) => {
      form.dataset.state = 'error';
      v.hint.textContent = err instanceof Error ? err.message : 'Not saved';
    };
    form.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-a], [data-tab]');
      if (t?.dataset.tab) this.validTab(v, t.dataset.tab);
      if (t?.dataset.a === 'cancel') close();
      if (t?.dataset.a === 'clear') void this.grid.setValidation('').then(close, fail);
    });
    form.addEventListener('change', () => this.validSync(v));
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const kind = f.kind.value;
      const a = f.a.value.trim();
      if (kind === 'checkbox') {
        const s = this.grid.selection();
        void this.grid.runTool('checkbox', `${s.r0},${s.c0},${s.r1},${s.c1}`, '1', a, f.b.value.trim()).then(close, fail);
        return;
      }
      if (kind !== 'any' && !a) {
        form.dataset.state = 'error';
        v.hint.textContent = kind === 'list' ? 'Enter the items or a range for the list.' : kind === 'custom' ? 'Enter a formula.' : 'Enter a value.';
        return;
      }
      const flags = [['blank', 'b'], ['drop', 'd'], ['prompt', 'p'], ['alert', 'e'], ['chips', 'c'], ['multi', 'm']].filter(([k]) => (f[k] as HTMLInputElement).checked && !f[k].disabled).map(([, c]) => c).join('');
      const formula = kind === 'custom' && !a.startsWith('=') ? `=${a}` : a;
      const chipColors = flags.includes('c') ? [...v.colors.querySelectorAll<HTMLInputElement>('input[data-item]')].map((i) => `${i.dataset.item!.replace(/[;=]/g, ' ')}=${i.value}`).join(';') : '';
      const parts = [kind, f.op.disabled ? '' : f.op.value, kind === 'any' ? '' : formula, f.b.disabled ? '' : f.b.value.trim(), flags, f.style.value, f.pt.value, f.pm.value, f.et.value, f.em.value, chipColors];
      void this.grid.setValidation(parts.map(fieldEsc).join('\t')).then(close, fail);
    });
    return v;
  }

  private invalidBox(rule: string[]): Promise<'retry' | 'accept' | 'cancel'> {
    const [, , , , , flags = '', style = 'stop', , , et = '', em = ''] = rule;
    if (!flags.includes('e')) return Promise.resolve('accept');
    const f = this.alertForm ??= this.makeAlertForm();
    f.title.textContent = et || 'FormCel';
    f.text.textContent = em || ALERT_TEXT;
    f.icon.dataset.style = style;
    f.icon.textContent = style === 'stop' ? 'Stop' : style === 'warning' ? 'Warning' : 'Information';
    const btn = (a: string, label: string, primary = false) => `<button type="button" class="fc-btn${primary ? ' fc-btn-primary' : ''}" data-a="${a}">${label}</button>`;
    f.buttons.innerHTML = style === 'stop' ? btn('cancel', 'Cancel') + btn('retry', 'Retry', true)
      : style === 'warning' ? `<span class="fc-alert-ask">Continue?</span>${btn('cancel', 'Cancel')}${btn('retry', 'No')}${btn('accept', 'Yes', true)}`
        : btn('cancel', 'Cancel') + btn('accept', 'OK', true);
    f.form.hidden = false;
    f.buttons.querySelector<HTMLElement>('.fc-btn-primary')?.focus();
    return new Promise((resolve) => { f.done = resolve; });
  }

  private makeAlertForm(): AlertForm {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom fc-pw fc-alert';
    form.hidden = true;
    form.setAttribute('role', 'alertdialog');
    form.innerHTML = '<span class="fc-fmt-title"></span><div class="fc-alert-body"><span class="fc-alert-icon"></span><p class="fc-alert-text"></p></div><div class="fc-csv-actions"></div>';
    document.getElementById('overlay-root')!.appendChild(form);
    const f: AlertForm = { form, icon: form.querySelector('.fc-alert-icon')!, title: form.querySelector('.fc-fmt-title')!, text: form.querySelector('.fc-alert-text')!, buttons: form.querySelector('.fc-csv-actions')!, done: null };
    const finish = (c: 'retry' | 'accept' | 'cancel') => {
      form.hidden = true;
      const d = f.done;
      f.done = null;
      d?.(c);
    };
    form.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'retry' || a === 'accept' || a === 'cancel') finish(a);
    });
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish('cancel'); });
    form.addEventListener('submit', (e) => e.preventDefault());
    return f;
  }

  private showPrompt(rule: string[] | null, at: DOMRect | null): void {
    const [, , , , , flags = '', , pt = '', pm = ''] = rule ?? [];
    const on = !!rule && !!at && flags.includes('p') && !!(pt || pm);
    if (!on) {
      if (this.prompt) this.prompt.hidden = true;
      return;
    }
    if (!this.prompt) {
      this.prompt = document.createElement('div');
      this.prompt.className = 'fc-prompt';
      this.prompt.setAttribute('role', 'tooltip');
      this.prompt.hidden = true;
      this.prompt.innerHTML = '<strong class="fc-prompt-title"></strong><span class="fc-prompt-text"></span>';
      document.getElementById('overlay-root')!.appendChild(this.prompt);
    }
    const el = this.prompt;
    el.querySelector('.fc-prompt-title')!.textContent = pt;
    el.querySelector('.fc-prompt-text')!.textContent = pm;
    el.style.left = `${Math.min(at!.right + 20, innerWidth - 248)}px`;
    el.style.top = `${Math.min(at!.bottom + 6, innerHeight - 120)}px`;
    el.hidden = false;
  }

  private async dropList(): Promise<void> {
    const at = this.grid.listButton();
    if (!at) return;
    const tot = this.grid.totalsCell();
    if (tot) {
      const name = tot.cols[this.grid.activeColumn() - tot.area[1]] ?? '';
      const ref = /^[A-Za-z0-9 ]+$/.test(name) && !/^ | $/.test(name) ? `[${name}]` : `[[${name.replace(/[[\]#'@]/g, "'$&")}]]`;
      const cell = this.grid.cellRect();
      const pick = (raw: string) => () => void this.grid.setActive(raw).then(() => this.grid.focus());
      this.menu.show(cell.left, cell.bottom + 2, [{ label: 'None', run: pick('') }, ...TOTALS.map(([label, n]) => ({ label, run: pick(`=SUBTOTAL(${n},${ref})`) })), { sep: true }, { label: 'More functions (custom formula)', run: () => this.tools.customTotal(`=SUM(${ref})`) }], () => this.grid.focus());
      return;
    }
    const items = await this.grid.listItems();
    if (!items.length) return;
    if (this.prompt) this.prompt.hidden = true;
    const cell = this.grid.cellRect();
    const rule = this.grid.activeRule();
    if (rule && rule[1] === 'list' && (rule[5] ?? '').includes('m')) {
      const o = this.open;
      const cur = o ? (await engine().readValues(o.book, this.grid.sheetIndex, this.grid.activeRow(), this.grid.activeColumn(), this.grid.activeRow(), this.grid.activeColumn()))[0]?.[2] ?? '' : '';
      const chosen = new Set(cur.replace(/^'/, '').split(',').map((s) => s.trim()).filter(Boolean));
      const toggle = (label: string) => () => {
        if (chosen.has(label)) chosen.delete(label);
        else chosen.add(label);
        const value = items.filter((i) => chosen.has(i)).join(', ');
        void this.grid.setActive(value).then(() => this.dropList());
      };
      this.menu.show(cell.left, cell.bottom + 2, items.map((label) => ({ label: `${chosen.has(label) ? '[x]' : '[ ]'} ${label}`, run: toggle(label) })), () => this.grid.focus());
      return;
    }
    this.menu.show(cell.left, cell.bottom + 2, items.map((label) => ({ label, run: () => void this.grid.setActive(label).then(() => this.grid.focus()) })), () => this.grid.focus());
  }

  private async toggleFilter(): Promise<void> {
    const g = this.grid;
    if (g.filterInfo()) return g.setFilter('');
    const { range } = await g.sortTarget();
    if (range.r1 <= range.r0) {
      this.status('Select a range with a header row and data under it', true);
      return;
    }
    await g.setFilter(`area\t${range.r0},${range.c0},${range.r1},${range.c1}\n`);
  }

  private async filterWith(col: number | null, parts?: string[]): Promise<void> {
    const info = this.grid.filterInfo();
    if (!info) return;
    const a = info.area;
    let text = `area\t${a.r0},${a.c0},${a.r1},${a.c1}\n`;
    if (col !== null) {
      for (const [c, p] of info.cols) if (c !== col) text += `col\t${c}\t${p.map(fieldEsc).join('\t')}\n`;
      if (parts) text += `col\t${col}\t${parts.map(fieldEsc).join('\t')}\n`;
    }
    await this.grid.setFilter(text);
  }

  private async filterBox(col: number): Promise<void> {
    const o = this.open;
    const info = this.grid.filterInfo();
    const at = this.grid.filterButton(col);
    if (!o || !info || !at) return;
    const f = this.filterForm ??= this.makeFilterForm();
    const list = await engine().filterValues(o.book, this.grid.sheetIndex, col);
    const crit = info.cols.get(col);
    f.col = col;
    const head = (await engine().readValues(o.book, this.grid.sheetIndex, info.area.r0, col, info.area.r0, col))[0]?.[2].replace(/^'/, '');
    f.title.textContent = head ? `Filter ${head}` : `Filter column ${colName(col)}`;
    const keep = crit?.[0] === 'values' ? new Set(crit.slice(2).map((s) => s.toLowerCase())) : null;
    const blanksOn = crit?.[0] === 'values' || crit?.[0] === 'dates' ? crit[1] === '1' : true;
    const dated = list.days.length > 0;
    f.list.dataset.mode = dated ? 'dates' : '';
    f.dateOps.hidden = f.dateOps.disabled = !dated;
    if (dated) {
      f.list.innerHTML = dateTree(list.days, crit?.[0] === 'dates' ? new Set(crit.slice(2)) : null, list.blanks, blanksOn);
    } else {
      const items = list.values.map((v) => `<label class="fc-filter-item"><input type="checkbox" value="${escapeHtml(v)}"${!keep || keep.has(v.toLowerCase()) ? ' checked' : ''}> <span>${escapeHtml(v)}</span></label>`);
      if (list.blanks) items.push(`<label class="fc-filter-item"><input type="checkbox" data-blank="1"${blanksOn ? ' checked' : ''}> <span>(Blanks)</span></label>`);
      f.list.innerHTML = items.join('');
    }
    f.hint.textContent = list.more ? 'Showing the first 10,000 different entries.' : '';
    f.search.value = '';
    const swatch = (kind: 'fill' | 'font', v: string) => {
      const none = v === 'none' || v === 'auto';
      const css = none ? 'transparent' : paint(v, this.grid.look);
      const label = kind === 'fill' ? (none ? 'No fill' : 'Cells with this fill') : none ? 'Automatic text colour' : 'Text in this colour';
      return `<button type="button" class="fc-filter-swatch" data-a="${kind}" data-v="${escapeHtml(v)}" title="${label}" aria-label="${label}"${kind === 'fill' ? ` style="background:${css}"` : ''}>${kind === 'font' ? `<span style="color:${none ? 'currentColor' : css}">A</span>` : ''}</button>`;
    };
    const rows: string[] = [];
    if (list.fills.length > 1) rows.push(`<span class="fc-sort-by">By fill colour</span><div class="fc-filter-swatches">${list.fills.map((v) => swatch('fill', v)).join('')}</div>`);
    if (list.fonts.length > 1) rows.push(`<span class="fc-sort-by">By text colour</span><div class="fc-filter-swatches">${list.fonts.map((v) => swatch('font', v)).join('')}</div>`);
    f.colors.innerHTML = rows.join('');
    if (list.icons.length > 1) {
      const label = document.createElement('span');
      label.className = 'fc-sort-by';
      label.textContent = 'By icon';
      const box = document.createElement('div');
      box.className = 'fc-filter-swatches';
      for (const id of list.icons) box.appendChild(iconSwatch(id, 'Cells with this icon'));
      f.colors.append(label, box);
    }
    f.colors.hidden = !f.colors.childElementCount;
    f.op1.value = f.op2.value = '';
    f.v1.value = f.v2.value = '';
    f.join.value = 'and';
    if (crit?.[0] === 'cond') {
      f.join.value = crit[1] === 'or' ? 'or' : 'and';
      f.op1.value = crit[2] ?? '';
      f.v1.value = crit[3] ?? '';
      f.op2.value = crit[4] ?? '';
      f.v2.value = crit[5] ?? '';
      if (crit[1] !== 'or' && crit[2] === 'ge' && crit[4] === 'le') {
        f.op1.value = 'between';
        f.op2.value = '';
      }
    } else if (crit?.[0] === 'dyn') f.op1.value = `dyn:${crit[1] ?? ''}`;
    else if (crit?.[0] === 'top') {
      f.op1.value = (crit[1] === 'bottom' ? 'bottom' : 'top') + (crit[3] === '%' ? '%' : '');
      f.v1.value = crit[2] ?? '10';
    } else if (crit?.[0] === 'avg') f.op1.value = crit[1] === 'below' ? 'below' : 'above';
    this.filterSync(f);
    f.form.dataset.state = '';
    const w = 300;
    f.form.style.left = `${Math.max(8, Math.min(at.left, innerWidth - w - 8))}px`;
    f.form.style.top = `${Math.max(8, Math.min(at.bottom + 4, innerHeight - 520))}px`;
    f.form.hidden = false;
    f.search.focus();
  }

  private filterSync(f: FilterForm): void {
    const op = f.op1.value;
    const between = op === 'between';
    const single = !op || between || op.startsWith('dyn:') || ['top', 'bottom', 'top%', 'bottom%', 'above', 'below'].includes(op);
    f.v1.disabled = !op || op === 'above' || op === 'below' || op.startsWith('dyn:');
    f.join.disabled = f.op2.disabled = single;
    f.v2.disabled = between ? false : single || !f.op2.value;
    const boxes = [...f.list.querySelectorAll<HTMLInputElement>('.fc-filter-item:not([hidden]) input')];
    const on = boxes.filter((b) => b.checked).length;
    f.all.checked = on === boxes.length && on > 0;
    f.all.indeterminate = on > 0 && on < boxes.length;
  }

  private makeFilterForm(): FilterForm {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom fc-filter';
    form.hidden = true;
    form.setAttribute('role', 'dialog');
    const ops = FILTER_OPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') + `<optgroup label="Date filters" data-dates hidden disabled>${DATE_FILTERS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</optgroup>`;
    const ops2 = FILTER_OPS.slice(0, 13).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    form.innerHTML = `<span class="fc-fmt-title"></span><div class="fc-filter-sorts"><button type="button" class="fc-btn" data-a="asc">${icon('sortAsc')} Sort A to Z</button><button type="button" class="fc-btn" data-a="desc">${icon('sortDesc')} Sort Z to A</button></div><div class="fc-filter-colors" hidden></div><span class="fc-sort-by">By condition</span><div class="fc-filter-cond"><select class="fc-fmt-input" data-k="op1" aria-label="Condition">${ops}</select><input class="fc-fmt-input" data-k="v1" aria-label="Value" spellcheck="false" autocomplete="off"><select class="fc-fmt-input" data-k="join" aria-label="Join"><option value="and">And</option><option value="or">Or</option></select><select class="fc-fmt-input" data-k="op2" aria-label="Second condition">${ops2}</select><input class="fc-fmt-input" data-k="v2" aria-label="Second value" spellcheck="false" autocomplete="off"></div><span class="fc-sort-by">By values</span><input type="search" class="fc-fmt-input fc-filter-search" placeholder="Search" aria-label="Search values" spellcheck="false" autocomplete="off"><label class="fc-sort-check"><input type="checkbox" class="fc-filter-all"> Select all</label><div class="fc-filter-list" role="group" aria-label="Values"></div><span class="fc-fmt-hint" aria-live="polite"></span><div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="clear">Clear</button><button type="button" class="fc-btn" data-a="cancel">Cancel</button><button type="submit" class="fc-btn fc-btn-primary">OK</button></div>`;
    document.getElementById('overlay-root')!.appendChild(form);
    const q = <T extends HTMLElement>(s: string) => form.querySelector<T>(s)!;
    const f: FilterForm = {
      form,
      col: 0,
      title: q('.fc-fmt-title'),
      colors: q('.fc-filter-colors'),
      op1: q('[data-k="op1"]'),
      dateOps: q('optgroup[data-dates]'),
      v1: q('[data-k="v1"]'),
      join: q('[data-k="join"]'),
      op2: q('[data-k="op2"]'),
      v2: q('[data-k="v2"]'),
      search: q('.fc-filter-search'),
      all: q('.fc-filter-all'),
      list: q('.fc-filter-list'),
      hint: q('.fc-fmt-hint'),
    };
    const close = () => { form.hidden = true; this.grid.focus(); };
    const done = (p: Promise<void>) => void p.then(close, (err: unknown) => {
      form.dataset.state = 'error';
      f.hint.textContent = err instanceof Error ? err.message : 'Not filtered';
    });
    form.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      const a = b?.dataset.a;
      if (a === 'cancel') close();
      if (a === 'clear') done(this.filterWith(f.col));
      if (a === 'asc' || a === 'desc') done(this.grid.sortFilterColumn(f.col, a === 'desc'));
      if (a === 'fill' || a === 'font' || a === 'icon') done(this.filterWith(f.col, [a, b!.dataset.v ?? '']));
      if (a === 'twist') {
        const kids = b!.closest('.fc-filter-node')?.querySelector<HTMLElement>(':scope > .fc-filter-kids');
        if (kids) {
          kids.hidden = !kids.hidden;
          b!.setAttribute('aria-expanded', String(!kids.hidden));
          b!.setAttribute('aria-label', kids.hidden ? 'Expand' : 'Collapse');
        }
      }
    });
    form.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (f.list.dataset.mode === 'dates' && t.dataset.key) cascadeDates(t);
      if (e.target === f.all) {
        for (const box of f.list.querySelectorAll<HTMLInputElement>('.fc-filter-item:not([hidden]) input')) box.checked = f.all.checked;
      }
      this.filterSync(f);
    });
    f.search.addEventListener('input', () => {
      const s = f.search.value.trim().toLowerCase();
      for (const item of f.list.children as HTMLCollectionOf<HTMLElement>) item.hidden = !!s && !item.textContent!.toLowerCase().includes(s);
      this.filterSync(f);
    });
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.addEventListener('pointerdown', (e) => { if (!form.hidden && !form.contains(e.target as Node)) form.hidden = true; });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const op = f.op1.value;
      if (op === 'above' || op === 'below') return done(this.filterWith(f.col, ['avg', op]));
      if (op.startsWith('top') || op.startsWith('bottom')) {
        const n = Number(f.v1.value);
        if (!(n >= 1 && n <= 500)) {
          form.dataset.state = 'error';
          f.hint.textContent = 'Enter a number from 1 to 500.';
          return;
        }
        return done(this.filterWith(f.col, ['top', op.startsWith('bottom') ? 'bottom' : 'top', String(n), op.endsWith('%') ? '%' : '']));
      }
      if (op.startsWith('dyn:')) return done(this.filterWith(f.col, ['dyn', op.slice(4)]));
      if (op === 'between') return done(this.filterWith(f.col, ['cond', 'and', 'ge', f.v1.value, 'le', f.v2.value]));
      if (op) {
        const parts = ['cond', f.join.value, op, f.v1.value];
        if (f.op2.value) parts.push(f.op2.value, f.v2.value);
        return done(this.filterWith(f.col, parts));
      }
      if (f.list.dataset.mode === 'dates' && !f.search.value.trim()) {
        const got = collectDates(f.list);
        if (got.all) return done(this.filterWith(f.col));
        return done(this.filterWith(f.col, ['dates', got.blanks ? '1' : '0', ...got.keys]));
      }
      const boxes = [...f.list.querySelectorAll<HTMLInputElement>('.fc-filter-item input')];
      const searching = !!f.search.value.trim();
      const on = boxes.filter((b) => b.checked && !(searching && (b.closest('.fc-filter-item') as HTMLElement).hidden));
      if (!searching && on.length === boxes.length) return done(this.filterWith(f.col));
      const blank = on.some((b) => b.dataset.blank);
      done(this.filterWith(f.col, ['values', blank ? '1' : '0', ...on.filter((b) => !b.dataset.blank).map((b) => b.value)]));
    });
    return f;
  }

  private downloadMenu(): void {
    const b = this.button('file.download').getBoundingClientRect();
    const run = (id: string) => () => runCommand(id).then(() => this.grid.focus());
    this.menu.show(b.left, b.bottom + 4, [
      { label: 'FormCel workbook (.fcel)', keys: prefs().defaultFormat === 'fcel' ? 'Default' : '', run: run('file.download-fcel') },
      { label: 'Excel workbook (.xlsx)', keys: prefs().defaultFormat === 'xlsx' ? 'Default' : '', run: run('file.download-xlsx') },
      ...(this.open?.macros ? [{ label: 'Excel macro-enabled workbook (.xlsm), with the macros it was opened with', run: run('file.download-xlsm') }] : []),
      { label: 'Excel workbook with a password (.xlsx)', run: run('file.download-xlsx-password') },
      { label: 'OpenDocument spreadsheet (.ods)', run: run('file.download-ods') },
      { label: 'This sheet as PDF (.pdf)', run: run('file.download-pdf') },
      { label: 'Every sheet as one PDF (.pdf)', run: run('file.download-pdf-all') },
      { label: 'This sheet as a web page (.html)', run: run('file.download-html') },
      { label: 'Every sheet as one web page (.html)', run: run('file.download-html-all') },
      { label: 'This sheet as comma-separated values (.csv)', run: run('file.download-csv') },
      { label: 'This sheet as tab-separated values (.tsv)', run: run('file.download-tsv') },
    ], () => this.grid.focus());
  }

  private pageOf(sheet = this.grid.sheetIndex): PageSetup {
    const o = this.open!;
    return (o.pages[sheet] ??= cleanPage(null));
  }

  private sendPage(sheet: number): void {
    const o = this.open;
    if (!o) return;
    void api('PATCH', `/api/workbooks/${o.id}/sheets/${sheet}`, { view: { page: o.pages[sheet] } }).catch(() => this.status('Page setup not saved', true));
    void this.refreshBreaks();
  }

  private async refreshBreaks(): Promise<void> {
    const o = this.open;
    if (!o || !this.preview) return this.grid.setBreakView(null);
    const sheet = this.grid.sheetIndex;
    const ext = await engine().extent(o.book, sheet);
    if (sheet !== this.grid.sheetIndex || !this.preview) return;
    const l = layoutOf(this.pageOf(sheet), { row: (i) => this.grid.rows.size(i), col: (i) => this.grid.cols.size(i) }, ext ? [ext[0] + 1, ext[1] + 1] : [1, 1]);
    this.grid.setBreakView(l);
  }

  private pageSetup(): void {
    const o = this.open;
    if (!o) return;
    const sheet = this.grid.sheetIndex;
    this.pageDialog.show(this.pageOf(sheet), (p) => {
      o.pages[sheet] = p;
      this.sendPage(sheet);
      this.grid.focus();
    });
  }

  private togglePreview(): void {
    this.setView(this.viewState === 'break' ? 'normal' : 'break');
  }

  private setView(m: ViewMode): void {
    this.viewState = m;
    this.preview = m !== 'normal';
    if (this.open) this.status(m === 'break' ? 'Page Break Preview on' : m === 'layout' ? 'Page Layout on' : 'Normal view');
    void this.refreshBreaks();
    document.dispatchEvent(new Event('fc-viewmode'));
    this.grid.focus();
  }

  private pageBreak(kind: 'insert' | 'remove' | 'reset'): void {
    if (!this.open) return;
    const sheet = this.grid.sheetIndex;
    const p = this.pageOf(sheet);
    const [r, c] = this.grid.activeCell();
    if (kind === 'reset') {
      p.rowBreaks = [];
      p.colBreaks = [];
    } else if (kind === 'insert') {
      if (r > 0) p.rowBreaks = [...new Set([...p.rowBreaks, r])].sort((a, b) => a - b);
      if (c > 0) p.colBreaks = [...new Set([...p.colBreaks, c])].sort((a, b) => a - b);
    } else {
      p.rowBreaks = p.rowBreaks.filter((x) => x !== r);
      p.colBreaks = p.colBreaks.filter((x) => x !== c);
    }
    this.sendPage(sheet);
    this.grid.focus();
  }

  private moveBreak(axis: 'row' | 'col', from: number, to: number): void {
    if (!this.open || to < 1) return;
    const sheet = this.grid.sheetIndex;
    const p = this.pageOf(sheet);
    const key = axis === 'row' ? 'rowBreaks' : 'colBreaks';
    p[key] = [...new Set([...p[key].filter((x) => x !== from), to])].sort((a, b) => a - b);
    this.sendPage(sheet);
  }

  private printArea(set: boolean): void {
    if (!this.open) return;
    const sheet = this.grid.sheetIndex;
    const r = this.currentRange;
    this.pageOf(sheet).area = set ? `${colName(r.c0)}${r.r0 + 1}:${colName(r.c1)}${r.r1 + 1}` : '';
    this.sendPage(sheet);
    this.grid.focus();
  }

  private pageMenu(): void {
    const b = this.button('page.menu').getBoundingClientRect();
    const run = (id: string) => () => runCommand(id).then(() => { if (!this.pageDialogOpen()) this.grid.focus(); });
    this.menu.show(b.left, b.bottom + 4, [
      { label: 'Page Setup', run: run('page.setup') },
      { label: this.preview ? 'Leave Page Break Preview' : 'Page Break Preview', run: run('page.preview') },
      { sep: true },
      { label: 'Insert page break above and left of the active cell', run: run('page.break-insert') },
      { label: 'Remove page break at the active cell', run: run('page.break-remove') },
      { label: 'Reset all page breaks', run: run('page.break-reset') },
      { sep: true },
      { label: 'Set print area to the selection', run: run('page.area-set') },
      { label: 'Clear print area', run: run('page.area-clear') },
      { sep: true },
      { label: 'Download this sheet as PDF', run: run('file.download-pdf') },
    ], () => this.grid.focus());
  }

  private pageDialogOpen(): boolean {
    return !!document.querySelector('.fc-modal:not([hidden])');
  }

  private accessMenu(): void {
    const b = this.button('view.access').getBoundingClientRect();
    const o = this.open;
    const run = (id: string) => () => void runCommand(id);
    const mark = (on: boolean, text: string) => (on ? `${text} (current)` : text);
    const themes: [ThemeName, string][] = [['dark', 'Dark theme'], ['light', 'Light theme'], ['contrast', 'High contrast theme']];
    const sizes: [TextSize, string][] = [['normal', 'Normal text size'], ['large', 'Large text size'], ['xlarge', 'Extra large text size']];
    this.menu.show(b.left, b.bottom + 4, [
      { label: 'Preferences...', keys: 'Ctrl+,', run: run('app.settings') },
      { sep: true },
      { label: 'Check accessibility', run: run('a11y.check') },
      { label: 'Keyboard shortcuts', keys: 'Ctrl+/', run: run('a11y.shortcuts') },
      { sep: true },
      ...themes.map(([id, label]): MenuItem => ({ label: mark(theme() === id, label), run: () => setTheme(id) })),
      { sep: true },
      ...sizes.map(([id, label]): MenuItem => ({ label: mark(textSize() === id, label), run: () => setTextSize(id) })),
      { sep: true },
      ...LOCALES.map(([id, label]): MenuItem => ({ label: mark(o?.locale === id, `Locale: ${label}`), run: () => this.setLocale(id), disabled: !o })),
      { sep: true },
      { label: 'Spelling is underlined by your browser while you type in a cell', run: () => undefined, disabled: true },
    ], () => this.grid.focus());
  }

  private async setLocale(tag: string): Promise<void> {
    const o = this.open;
    if (!o || tag === o.locale) return;
    this.flush();
    await this.saving;
    try {
      await api('PUT', `/api/workbooks/${o.id}/locale`, { locale: tag });
    } catch (err) {
      this.status(err instanceof Error ? err.message : 'Locale not changed', true);
      return;
    }
    await this.openWorkbook(o.id, false);
    this.status(`Locale ${tag}`);
  }

  private async setAlt(sheet: number, name: string, text: string): Promise<void> {
    if (!this.open) return;
    if (this.grid.sheetIndex !== sheet) this.showSheet(sheet);
    this.charts.layer.setAlt(name, text);
  }

  private downloadLocked(): void {
    const o = this.open;
    if (!o) return;
    this.passwordBox('Download with a password', 'Anyone who opens the file needs this password. FormCel does not keep it, and a lost password cannot be recovered.', true, async (password) => {
      this.flush();
      await this.saving;
      const r = await fetch(`/api/workbooks/${o.id}/export.xlsx`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) }).catch(() => null);
      if (!r || !r.ok) return 'The file could not be made.';
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${o.title || 'Workbook'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.grid.focus();
      return null;
    });
  }

  private async download(kind: 'fcel' | 'xlsx' | 'xlsm' | 'ods' | 'csv' | 'tsv' | 'pdf' | 'pdf-all' | 'html' | 'html-all'): Promise<void> {
    const o = this.open;
    if (!o) return;
    this.flush();
    await withJob(`Preparing the ${kind.toUpperCase()} download`, () => this.saving);
    const a = document.createElement('a');
    const sheet = this.grid.sheetIndex;
    a.href = kind === 'csv' || kind === 'tsv' || kind === 'pdf' || kind === 'html' ? `/api/workbooks/${o.id}/export.${kind}?sheet=${sheet}` : kind === 'pdf-all' || kind === 'html-all' ? `/api/workbooks/${o.id}/export.${kind.slice(0, -4)}?scope=all` : `/api/workbooks/${o.id}/export.${kind}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  private async csvPreview(file: File, delimiter?: string): Promise<CsvPreview | null> {
    const q = `name=${encodeURIComponent(file.name)}${delimiter ? `&delimiter=${delimiter}` : ''}`;
    const r = await fetch(`/api/import/preview?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file }).catch(() => null);
    if (!r || !r.ok) {
      const detail = r ? await r.json().then((j: { detail?: string }) => j.detail).catch(() => undefined) : undefined;
      this.home.say(detail ?? `${file.name} could not be read.`, true);
      return null;
    }
    return (await r.json()) as CsvPreview;
  }

  private async csvBox(file: File): Promise<void> {
    this.home.say(`Reading ${file.name}`);
    const pv = await this.csvPreview(file);
    if (!pv) return;
    this.home.say('');
    const f = this.csvForm ??= this.makeCsvForm();
    f.file = file;
    f.title.textContent = `Open ${file.name}`;
    f.delim.value = pv.delimiter;
    this.fillCsv(f, pv);
    f.form.hidden = false;
    f.delim.focus();
  }

  private async csvQuick(file: File): Promise<void> {
    this.home.say(`Reading ${file.name}`);
    const pv = await this.csvPreview(file);
    if (!pv) return;
    const convert = prefs().importConvert;
    const text = pv.columns.map((c, i) => ((convert ? c.as : 'text') === 'text' ? i : -1)).filter((i) => i >= 0).join(',');
    await this.importFile(file, `&delimiter=${pv.delimiter}&text=${text}`);
  }

  private fillCsv(f: CsvForm, pv: CsvPreview): void {
    f.meta.textContent = `${pv.rows.toLocaleString()} row${pv.rows === 1 ? '' : 's'} · ${pv.encoding}`;
    const head = document.createElement('tr');
    pv.columns.forEach((c, i) => {
      const th = document.createElement('th');
      th.innerHTML = `<select class="fc-csv-as" data-col="${i}" aria-label="Column ${i + 1} as"><option value="general">General</option><option value="text">Text</option></select><span class="fc-csv-kind"></span>`;
      th.querySelector<HTMLSelectElement>('select')!.value = prefs().importConvert ? c.as : 'text';
      th.querySelector('.fc-csv-kind')!.textContent = c.label;
      head.appendChild(th);
    });
    const body = document.createDocumentFragment();
    for (const row of pv.sample) {
      const tr = document.createElement('tr');
      for (let i = 0; i < pv.columns.length; i++) {
        const td = document.createElement('td');
        td.textContent = row[i] ?? '';
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    f.thead.replaceChildren(head);
    f.tbody.replaceChildren(body);
  }

  private makeCsvForm(): CsvForm {
    const form = document.createElement('form');
    form.className = 'fc-csv';
    form.hidden = true;
    form.setAttribute('role', 'dialog');
    form.setAttribute('aria-label', 'Open a text file');
    form.innerHTML = '<div class="fc-csv-head"><span class="fc-fmt-title"></span><span class="fc-csv-meta"></span></div><label class="fc-fmt-label fc-csv-delim-label">Separated by<select class="fc-fmt-input fc-csv-delim"><option value="comma">Comma</option><option value="semicolon">Semicolon</option><option value="tab">Tab</option><option value="pipe">Vertical bar</option></select></label><div class="fc-csv-table"><table><thead></thead><tbody></tbody></table></div><span class="fc-fmt-hint">Columns set to Text keep what is written exactly, such as 00123. Formulas in the file stay text.</span><div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="cancel">Cancel</button><button type="submit" class="fc-btn fc-btn-primary">Open</button></div>';
    document.getElementById('overlay-root')!.appendChild(form);
    const f: CsvForm = {
      form, file: null,
      title: form.querySelector<HTMLElement>('.fc-fmt-title')!,
      meta: form.querySelector<HTMLElement>('.fc-csv-meta')!,
      delim: form.querySelector<HTMLSelectElement>('.fc-csv-delim')!,
      thead: form.querySelector<HTMLElement>('thead')!,
      tbody: form.querySelector<HTMLElement>('tbody')!,
    };
    const close = () => { form.hidden = true; f.file = null; };
    form.querySelector('[data-a="cancel"]')!.addEventListener('click', close);
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    f.delim.addEventListener('change', () => {
      if (!f.file) return;
      void this.csvPreview(f.file, f.delim.value).then((pv) => { if (pv && f.file) this.fillCsv(f, pv); });
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!f.file) return;
      const text = [...form.querySelectorAll<HTMLSelectElement>('.fc-csv-as')].filter((s) => s.value === 'text').map((s) => s.dataset.col).join(',');
      const file = f.file;
      close();
      void this.importFile(file, `&delimiter=${f.delim.value}&text=${text}`);
    });
    return f;
  }

  private passwordBox(title: string, hint: string, confirm: boolean, submit: (password: string) => Promise<string | null>): void {
    const f = this.pwForm ??= this.makePasswordForm();
    f.title.textContent = title;
    f.hint.textContent = hint;
    f.form.dataset.state = '';
    f.input.value = '';
    f.again.value = '';
    f.againLabel.hidden = !confirm;
    f.submit = submit;
    f.form.hidden = false;
    f.input.focus();
  }

  private makePasswordForm(): PasswordForm {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom fc-pw';
    form.hidden = true;
    form.setAttribute('role', 'dialog');
    form.innerHTML = '<span class="fc-fmt-title"></span><label class="fc-fmt-label">Password<input type="password" class="fc-fmt-input fc-pw-input" autocomplete="off"></label><label class="fc-fmt-label fc-pw-again-label">Type it again<input type="password" class="fc-fmt-input fc-pw-again" autocomplete="off"></label><span class="fc-fmt-hint" aria-live="polite"></span><div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="cancel">Cancel</button><button type="submit" class="fc-btn fc-btn-primary">OK</button></div>';
    document.getElementById('overlay-root')!.appendChild(form);
    const f: PasswordForm = {
      form,
      title: form.querySelector<HTMLElement>('.fc-fmt-title')!,
      hint: form.querySelector<HTMLElement>('.fc-fmt-hint')!,
      input: form.querySelector<HTMLInputElement>('.fc-pw-input')!,
      again: form.querySelector<HTMLInputElement>('.fc-pw-again')!,
      againLabel: form.querySelector<HTMLElement>('.fc-pw-again-label')!,
      submit: null,
    };
    const close = () => { form.hidden = true; f.input.value = ''; f.again.value = ''; f.submit = null; };
    form.querySelector('[data-a="cancel"]')!.addEventListener('click', close);
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!f.submit || !f.input.value) return;
      if (!f.againLabel.hidden && f.input.value !== f.again.value) {
        form.dataset.state = 'error';
        f.hint.textContent = 'The two passwords are not the same.';
        return;
      }
      void f.submit(f.input.value).then((err) => {
        if (err === null) return close();
        form.dataset.state = 'error';
        f.hint.textContent = err;
        f.input.select();
      });
    });
    return f;
  }

  private spellBox: SpellCheck | null = null;

  private async spellCheck(): Promise<void> {
    if (!this.open) return;
    this.spellBox ??= new SpellCheck({
      area: async () => {
        const g = this.grid;
        const s = g.selection();
        const single = s.r0 === s.r1 && s.c0 === s.c1;
        const ext = single ? await engine().extent(this.open!.book, g.sheetIndex) : null;
        const box = single ? (ext ? { r0: 0, c0: 0, r1: ext[0], c1: ext[1] } : null) : s;
        const cells = box ? await engine().read(this.open!.book, box.r0, box.c0, box.r1, box.c1, g.sheetIndex) : [];
        return { cells: cells.map((c): [number, number, string] => [c[0], c[1], c[3] || c[2]]), label: single ? 'the sheet' : 'the selection' };
      },
      show: (row, col) => this.grid.select(row, col),
      edit: async (row, col, raw) => {
        await this.grid.commitEdits(await engine().apply(this.open!.book, [[row, col, raw]], this.grid.sheetIndex));
      },
      say: (text, bad) => this.status(text, bad),
    });
    await this.spellBox.start();
  }

  private pasteData(text?: string, html?: string): void {
    if (text === undefined && html === undefined) {
      const f = this.pasteForm ??= this.makePasteForm();
      f.form.hidden = false;
      f.area.value = '';
      f.area.focus();
      return;
    }
    const file = hasHtmlTable(html ?? '') ? new File([html ?? ''], 'Pasted table.html', { type: 'text/html' }) : new File([text ?? ''], 'Pasted data.paste');
    void this.importFile(file);
  }

  private makePasteForm(): { form: HTMLFormElement; area: HTMLTextAreaElement } {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom fc-pw fc-paste';
    form.hidden = true;
    form.setAttribute('role', 'dialog');
    form.setAttribute('aria-label', 'Paste data');
    form.innerHTML = '<span class="fc-fmt-title">Paste data</span><label class="fc-fmt-label">Tab, comma, semicolon or bar separated text, or an HTML table<textarea class="fc-fmt-input fc-paste-area" rows="9" spellcheck="false" aria-label="Pasted data"></textarea></label><div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="cancel">Cancel</button><button type="submit" class="fc-btn fc-btn-primary">Make workbook</button></div>';
    document.getElementById('overlay-root')!.appendChild(form);
    const area = form.querySelector<HTMLTextAreaElement>('.fc-paste-area')!;
    const close = () => { form.hidden = true; area.value = ''; };
    form.querySelector('[data-a="cancel"]')!.addEventListener('click', close);
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = area.value;
      if (!value.trim()) return;
      close();
      this.pasteData(hasHtmlTable(value) ? '' : value, hasHtmlTable(value) ? value : '');
    });
    return { form, area };
  }

  private async importFile(file: File, options?: string, password?: string): Promise<string | null> {
    const textFile = /\.(csv|tsv|txt)$/i.test(file.name);
    if (options === undefined && textFile) {
      void (prefs().importWizard ? this.csvBox(file) : this.csvQuick(file));
      return null;
    }
    this.home.say(`Opening ${file.name}`);
    const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
    if (password) headers['x-formcel-password'] = password;
    const cap = textFile && prefs().importMaxRows < 1048576 ? `&max_rows=${prefs().importMaxRows}` : '';
    const r = await fetch(`/api/import?name=${encodeURIComponent(file.name)}${options ?? ''}${cap}`, { method: 'POST', headers, body: file }).catch(() => null);
    if (r && (r.status === 401 || r.status === 403)) {
      this.home.say('');
      if (r.status === 403) return 'That password does not open the file.';
      this.passwordBox(`Open ${file.name}`, 'This file is protected with a password. FormCel uses it once to open the file and does not keep it.', false, (pw) => this.importFile(file, options, pw));
      return null;
    }
    if (!r || !r.ok) {
      const detail = r ? await r.json().then((j: { detail?: string }) => j.detail).catch(() => undefined) : undefined;
      this.home.say(detail ?? `${file.name} could not be opened.`, true);
      return null;
    }
    this.home.say('');
    const meta = (await r.json()) as WorkbookMeta & { notes?: string[] };
    this.importNotes = meta.notes ?? [];
    location.hash = `w-${meta.id}`;
    return null;
  }

  private async openWorkbook(id: string, setHash = true): Promise<void> {
    this.flush();
    await this.saving;
    this.collab.detach();
    let doc: WorkbookMeta & { collab?: { notes: Record<string, { text: string; author: string; time: string }>; threads: never[]; people: string[] }; protection?: { book: string[]; sheets: string[][] }; cells: [number, number, string][][]; formats?: [number, number, string][][]; styles?: [number, number, string][][]; merges?: Area[][]; rules?: string[][]; filters?: string[]; validations?: string[][]; tables?: string[]; pivots?: string[]; model?: string[]; whatif?: string[]; links?: [number, number, string][][]; theme?: string; cellStyles?: string[]; views?: SheetView[]; names?: Name[]; nameNotes?: [string, string][]; watches?: [number, number, number][] };
    try {
      doc = await api('GET', `/api/workbooks/${id}`);
    } catch {
      location.hash = '';
      return;
    }
    const e = engine();
    await e.setLocale((doc as { locale?: string }).locale ?? 'en-US');
    const book = await e.newWorkbook();
    await e.loadTheme(book, doc.theme ?? '');
    await e.loadNamed(book, doc.cellStyles ?? []);
    await e.loadRecords(book, (doc as { records?: RecordItem[] }).records ?? []);
    for (let i = 0; i < doc.sheets.length; i++) {
      if (i) await e.addSheet(book, doc.sheets[i]);
      else if (doc.sheets[0] !== 'Sheet1') await e.renameSheet(book, 0, doc.sheets[0]);
      await e.loadFormats(book, i, doc.formats?.[i] ?? []);
      await e.loadStyles(book, i, doc.styles?.[i] ?? []);
      await e.loadMerges(book, i, doc.merges?.[i] ?? []);
      await e.loadRules(book, i, doc.rules?.[i] ?? []);
      await e.loadFilter(book, i, doc.filters?.[i] ?? '');
      await e.loadValidations(book, i, doc.validations?.[i] ?? []);
      await e.loadLinks(book, i, doc.links?.[i] ?? []);
      if (doc.cells[i]?.length) await e.load(book, doc.cells[i], i);
      await e.loadChips(book, i, (doc as { chips?: [number, number, string][][] }).chips?.[i] ?? []);
    }
    for (const [n, f] of doc.names ?? []) await e.defineName(book, n, f).catch(() => []);
    for (const [n, c] of doc.nameNotes ?? []) await e.nameComment(book, n, c).catch(() => undefined);
    this.nameNoteMap = new Map(doc.nameNotes ?? []);
    await e.loadTables(book, doc.tables ?? []);
    await e.loadModel(book, doc.model ?? []);
    this.modelLines = doc.model ?? [];
    await e.loadPivots(book, doc.pivots ?? []);
    this.pivotLines = doc.pivots ?? [];
    this.pivotPanel?.hide();
    await e.loadWhatif(book, doc.whatif ?? []);
    this.whatIf.load(doc.whatif ?? []);
    const calcDoc = doc as unknown as CalcDoc;
    const names = doc.names?.length ? await e.names(book) : [];
    this.grouped.clear();
    this.grid.localForms = ((doc as { locale?: string }).locale ?? 'en-US') !== 'en-US';
    this.open = { id, book, title: doc.title, sheets: doc.sheets, views: doc.sheets.map((_, i) => doc.views?.[i] ?? {}), names, macros: !!doc.macros, pages: doc.sheets.map((_, i) => cleanPage((doc.views?.[i] as { page?: unknown } | undefined)?.page)), locale: (doc as { locale?: string }).locale ?? 'en-US' };
    this.preview = false;
    this.viewState = 'normal';
    document.dispatchEvent(new Event('fc-viewmode'));
    this.grid.setBreakView(null);
    const p = this.p;
    this.vba.preopen(id, !!doc.macros);
    p.home.hidden = true;
    p.sheet.hidden = false;
    this.statusBar?.touch();
    p.homeBtn.hidden = false;
    p.title.hidden = false;
    p.title.value = doc.title;
    p.save.hidden = false;
    this.status(this.importNotes.length ? `Opened, with ${this.importNotes.length} note${this.importNotes.length === 1 ? '' : 's'} on what changed` : 'Saved');
    p.save.title = this.importNotes.join('\n');
    this.importNotes = [];
    document.title = `${doc.title} · FormCel`;
    this.renderTabs();
    await this.charts.layer.open();
    this.audit.load((doc.watches ?? []) as [number, number, number][]);
    this.tools.resetTemp();
    await this.calc.load(book, calcDoc);
    this.showSheet(0);
    if (prefs().defaultView === 'pagebreak') {
      this.preview = true;
      void this.refreshBreaks();
    }
    if (doc.macros && macroPolicy() !== 'disable') this.status(macroPolicy() === 'enable' ? 'This workbook has macros, and Preferences allow them to run.' : 'This workbook has macros. They are off; change Macro settings in Preferences, Trust Center.');
    this.button('edit.undo').disabled = true;
    this.button('edit.redo').disabled = true;
    this.grid.focus();
    window.setTimeout(() => void this.tools.openLink((i) => this.showSheet(i)), 300);
    this.auto.opened(id, (doc as unknown as { automation?: Parameters<Automation['opened']>[1] }).automation);
    void this.vba.opened(id);
    if (setHash && location.hash !== `#w-${id}`) location.hash = `w-${id}`;
    this.collab.attach(id, book, doc.sheets, doc.collab, doc.protection);
    void this.dtypes.opened();
    void waiting(id).then((n) => {
      if (!n) return;
      this.status('Offline changes waiting to be sent');
      this.watchOffline(id);
      window.setTimeout(() => {
        this.saving = this.saving.then(() => this.drainOffline(id)).catch(() => undefined);
      }, 500);
    });
  }

  private nameOf(r: Range): string | null {
    const o = this.open;
    if (!o?.names.length) return null;
    const refers = `=${sheetPrefix(o.sheets[this.grid.sheetIndex] ?? '')}${absRange(r)}`.toLowerCase();
    return o.names.find(([, f]) => f.toLowerCase() === refers)?.[0] ?? null;
  }

  private fnArguments(): void {
    this.fnTools.argumentsAtCaret();
  }

  private nameBoxResult(problem: string | null): void {
    const box = this.p.nameBox;
    box.setAttribute('aria-invalid', String(problem !== null));
    box.title = problem ?? '';
  }

  private async jumpToTable(text: string): Promise<boolean> {
    const o = this.open;
    if (!o || !/^[\w.\\]+(\[.*\])?$/.test(text)) return false;
    const found = (await engine().tool(o.book, this.grid.sheetIndex, 'tablearea', text)).message ?? '';
    if (!found) return false;
    const [s, r0, c0, r1, c1] = found.split('\t').map(Number);
    if (s !== this.grid.sheetIndex) this.showSheet(s);
    return this.grid.goTo(`${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}`);
  }

  private async jumpTo(text: string): Promise<boolean> {
    const o = this.open;
    if (this.grid.goTo(text)) return true;
    const hit = o?.names.find(([n]) => n.toLowerCase() === text.toLowerCase());
    const m = hit ? /^=(?:'((?:[^']|'')+)'|([^!']+))!([$A-Za-z0-9:]+)$/.exec(hit[1]) : null;
    const sheet = o && m ? o.sheets.findIndex((s) => s.toLowerCase() === (m[1] ?? m[2]).replace(/''/g, "'").toLowerCase()) : -1;
    if (!m || sheet < 0) return this.jumpToTable(text);
    if (sheet !== this.grid.sheetIndex) this.showSheet(sheet);
    return this.grid.goTo(m[3].replace(/\$/g, ''));
  }

  private async nameBoxEnter(text: string): Promise<void> {
    const o = this.open;
    if (this.grid.goTo(text)) return this.nameBoxResult(null);
    if (!o || !text) return this.nameBoxResult('Type a cell like B12, a range like B2:D9, or a name.');
    if (await this.jumpToTable(text)) return this.nameBoxResult(null);
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
      t.hidden = !!o.views[i]?.hidden;
      t.classList.toggle('is-grouped', this.grouped.has(i));
      if (t.textContent !== name) t.textContent = name;
      const colour = o.views[i]?.color;
      if (colour) t.style.setProperty('--tab', colour);
      else t.style.removeProperty('--tab');
    });
    for (const t of have.slice(o.sheets.length)) t.remove();
    const group = this.grouped.size > 1;
    const title = `${o.title}${group ? ' [Group]' : ''} · FormCel`;
    if (document.title !== title) document.title = title;
    this.p.groupBadge.hidden = false;
    this.p.groupBadge.dataset.on = String(group);
  }

  private showSheet(i: number): void {
    const o = this.open;
    if (!o) return;
    this.grid.show(o.book, i, o.views[i] ?? {});
    void this.refreshBreaks();
    this.markTab(i);
    this.tools.syncSlicers();
    this.zoomLabel();
    this.grid.focus();
  }

  private zoomLabel(): void {
    const v = `${Math.round(this.grid.zoom * 100)}%`;
    if (this.p.zoomVal.textContent !== v) this.p.zoomVal.textContent = v;
    const slider = this.p.zoom.querySelector<HTMLInputElement>('.fc-zoom-slider');
    if (slider && slider.value !== String(Math.round(this.grid.zoom * 100))) slider.value = String(Math.round(this.grid.zoom * 100));
  }

  private patchView(sheet: number, part: Partial<SheetView>): void {
    const o = this.open;
    if (!o) return;
    o.views[sheet] = { ...(o.views[sheet] ?? {}), ...part };
    this.renderTabs();
    void api('PATCH', `/api/workbooks/${o.id}/sheets/${sheet}`, { view: Object.fromEntries(Object.entries(part).map(([k, v]) => [k, v ?? null])) }).catch(() => this.status('View not saved', true));
  }

  private async mirror(changes: Changed[]): Promise<void> {
    const o = this.open;
    const at = this.grid.sheetIndex;
    if (!o || this.grid.replaying || this.grouped.size < 2 || !this.grouped.has(at)) return;
    const edits: [number, number, string][] = changes.filter(([s]) => s === at).map(([, r, c, t, f]) => [r, c, f ?? t]);
    if (!edits.length) return;
    const e = engine();
    const end = await e.undoMark(o.book);
    for (const s of this.grouped) {
      if (s === at) continue;
      this.queueSave(await e.apply(o.book, edits, s));
    }
    if (end > 0) await e.undoGroup(o.book, end - 1);
  }

  private saveView(sheet: number, view: SheetView): void {
    const o = this.open;
    if (!o) return;
    const old = o.views[sheet] ?? {};
    o.views[sheet] = { ...view, hidden: old.hidden, fviews: old.fviews, sviews: old.sviews, slicers: old.slicers, timeline: old.timeline };
    this.zoomLabel();
    if (this.preview) void this.refreshBreaks();
    window.clearTimeout(this.viewTimers.get(sheet));
    if (this.tools.isTemp(sheet)) return;
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

  private sendLinks(changes: LinkChange[]): void {
    const o = this.open;
    if (!o) return;
    const bySheet = new Map<number, [number, number, string][]>();
    for (const [s, r, c, t] of changes) {
      let list = bySheet.get(s);
      if (!list) bySheet.set(s, (list = []));
      list.push([r, c, t]);
    }
    this.flush();
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        for (const [sheet, cells] of bySheet) await api('POST', `/api/workbooks/${o.id}/links`, { sheet, cells });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
    this.linkChip();
  }

  private sendRecords(items: RecordItem[]): void {
    const o = this.open;
    if (!o) return;
    this.saving = this.saving.then(async () => {
      try {
        await api('POST', `/api/workbooks/${o.id}/records`, { records: items });
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
  }

  private sendChips(changes: LinkChange[]): void {
    const o = this.open;
    if (!o) return;
    const bySheet = new Map<number, [number, number, string][]>();
    for (const [s, r, c, t] of changes) {
      let list = bySheet.get(s);
      if (!list) bySheet.set(s, (list = []));
      list.push([r, c, t]);
    }
    this.flush();
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        for (const [sheet, cells] of bySheet) await api('POST', `/api/workbooks/${o.id}/cellchips`, { sheet, cells });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
  }

  private followLink(target: string): void {
    const o = this.open;
    if (!target || !o) return;
    if (!target.startsWith('#')) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    const ref = target.slice(1);
    const m = /^(?:'((?:[^']|'')+)'|([^!']+))!(.+)$/.exec(ref);
    if (m) {
      const name = (m[1] ?? m[2]).replace(/''/g, "'").toLowerCase();
      const sheet = o.sheets.findIndex((s) => s.toLowerCase() === name);
      if (sheet < 0) return this.status(`There is no sheet ${m[1] ?? m[2]} to go to.`, true);
      if (sheet !== this.grid.sheetIndex) this.showSheet(sheet);
      this.grid.goTo(m[3].replace(/\$/g, ''));
      return;
    }
    if (this.grid.goTo(ref.replace(/\$/g, ''))) return;
    const hit = o.names.find(([n]) => n.toLowerCase() === ref.toLowerCase());
    if (hit) void this.nameBoxEnter(hit[0]);
  }

  private chip: { el: HTMLElement; text: Text } | null = null;
  private chipSeq = 0;

  private linkChip(): void {
    const g = this.grid as Grid | undefined;
    if (!g) return;
    const seq = ++this.chipSeq;
    if (!g.activeLinked()) {
      if (this.chip && !this.chip.el.hidden) this.chip.el.hidden = true;
      return;
    }
    void g.linkTarget().then((t) => {
      if (seq !== this.chipSeq) return;
      if (!this.chip) {
        const el = document.createElement('div');
        el.className = 'fc-link-chip';
        el.hidden = true;
        el.innerHTML = '<span class="fc-link-url"></span><button type="button" class="fc-btn" data-act="open">Open</button><button type="button" class="fc-btn" data-act="edit">Edit</button><button type="button" class="fc-btn" data-act="remove">Remove</button>';
        document.getElementById('overlay-root')!.appendChild(el);
        const text = el.querySelector('.fc-link-url')!.appendChild(document.createTextNode(''));
        el.addEventListener('click', (e) => {
          const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
          if (act === 'open') void this.grid.linkTarget().then((u) => this.followLink(u));
          if (act === 'edit') this.linkBox();
          if (act === 'remove') void this.grid.removeLinks().then(() => this.grid.focus());
        });
        this.p.grid.addEventListener('wheel', () => {
          if (this.chip) this.chip.el.hidden = true;
        }, { passive: true });
        this.chip = { el, text };
      }
      const c = this.chip;
      if (!t) {
        c.el.hidden = true;
        return;
      }
      if (c.text.nodeValue !== t) c.text.nodeValue = t;
      const r = g.activeRect();
      c.el.style.left = `${Math.round(r.left)}px`;
      c.el.style.top = `${Math.round(r.bottom + 4)}px`;
      c.el.hidden = false;
    });
  }

  private linkForm: { form: HTMLFormElement; text: HTMLInputElement; url: HTMLInputElement; hint: HTMLElement } | null = null;
  private csvForm: CsvForm | null = null;
  private pwForm: PasswordForm | null = null;
  private pasteForm: { form: HTMLFormElement; area: HTMLTextAreaElement } | null = null;
  private sortForm: SortForm | null = null;
  private validForm: ValidForm | null = null;
  private tableForm: HTMLFormElement | null = null;
  private designForm: HTMLFormElement | null = null;
  private alertForm: AlertForm | null = null;
  private prompt: HTMLElement | null = null;
  private filterForm: FilterForm | null = null;

  private linkBox(): void {
    const g = this.grid;
    const f = this.linkForm ??= this.makeLinkForm();
    const r = g.activeRect();
    f.form.style.left = `${Math.round(r.left)}px`;
    f.form.style.top = `${Math.round(r.bottom + 4)}px`;
    f.form.dataset.state = '';
    f.hint.textContent = 'A web address, an email address, or a place in this workbook such as #Sheet2!A1.';
    const formula = this.current.trim().toUpperCase().startsWith('=HYPERLINK(');
    f.text.value = formula ? '' : this.current;
    f.url.value = '';
    f.form.hidden = false;
    if (formula) {
      f.form.dataset.state = 'error';
      f.hint.textContent = 'This link comes from a HYPERLINK formula. Edit the formula in the formula bar to change where it goes.';
    }
    void g.linkTarget().then((t) => {
      if (!formula) f.url.value = t;
      (f.text.value ? f.url : f.text).focus();
    });
  }

  private makeLinkForm(): { form: HTMLFormElement; text: HTMLInputElement; url: HTMLInputElement; hint: HTMLElement } {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom';
    form.hidden = true;
    form.innerHTML = '<label class="fc-fmt-label">Text to display<input class="fc-fmt-input fc-link-text" spellcheck="false" autocomplete="off"></label><label class="fc-fmt-label">Link<input class="fc-fmt-input fc-link-url-input" spellcheck="false" autocomplete="off" placeholder="https://"></label><span class="fc-fmt-hint" aria-live="polite"></span><button type="submit" class="fc-btn fc-btn-primary">Apply</button>';
    document.getElementById('overlay-root')!.appendChild(form);
    const text = form.querySelector<HTMLInputElement>('.fc-link-text')!;
    const url = form.querySelector<HTMLInputElement>('.fc-link-url-input')!;
    const hint = form.querySelector<HTMLElement>('.fc-fmt-hint')!;
    const close = () => {
      form.hidden = true;
      this.grid.focus();
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.current.trim().toUpperCase().startsWith('=HYPERLINK(')) return close();
      const display = text.value === this.current ? undefined : text.value;
      void this.grid.setLink(url.value, display).then(close, (err: unknown) => {
        form.dataset.state = 'error';
        hint.textContent = err instanceof Error ? err.message : String(err);
      });
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!form.hidden && !form.contains(e.target as Node)) form.hidden = true;
    }, true);
    return { form, text, url, hint };
  }

  private sendTables(lines: string[]): void {
    const o = this.open;
    if (!o) return;
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        await api('PUT', `/api/workbooks/${o.id}/tables`, { lines });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
  }

  private pivotLines: string[] = [];
  private pivotPanel: PivotPanel | null = null;
  private pivotForm: PivotDialog | null = null;
  private pivotBusy = false;
  private pivotTimer = 0;

  private pivotDefs(): PivotDef[] {
    return this.pivotLines.map(parsePivot).filter((d): d is PivotDef => !!d);
  }

  private pivotAt(sheet: number, r: number, c: number): PivotDef | null {
    return this.pivotDefs().find((d) => {
      const o = outArea(d);
      return !!o && o.sheet === sheet && r >= o.area[0] && r <= o.area[2] && c >= o.area[1] && c <= o.area[3];
    }) ?? null;
  }

  private sendPivots(lines: string[]): void {
    const o = this.open;
    if (!o) return;
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        await api('PUT', `/api/workbooks/${o.id}/pivots`, { lines });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
  }

  private modelWin: DataModelWindow | null = null;
  private modelLines: string[] = [];

  private modelWindow(): DataModelWindow {
    if (this.modelWin) return this.modelWin;
    const g = this.grid;
    return (this.modelWin = new DataModelWindow({
      book: () => this.open?.book ?? 0,
      tables: () => g.tables().map((t) => ({ name: t.name, sheet: t.sheet, area: t.area })),
      sheetName: (i) => this.open?.sheets[i] ?? `Sheet${i + 1}`,
      selection: () => {
        const s = g.selection();
        return { sheet: g.sheetIndex, r0: s.r0, c0: s.c0, r1: s.r1, c1: s.c1 };
      },
      activeTable: () => g.activeTable()?.name ?? null,
      say: (m, bad) => this.status(m, !!bad),
      changed: async (effect, lines) => {
        await g.applyPivot(effect);
        if (lines.join('\n') !== this.modelLines.join('\n')) {
          this.modelLines = lines;
          this.sendModel(lines);
        }
        await this.pivotSync();
      },
    }));
  }

  private sendModel(lines: string[]): void {
    const o = this.open;
    if (!o) return;
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        await api('PUT', `/api/workbooks/${o.id}/model`, { lines });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
  }

  private async cubeConvert(): Promise<void> {
    const o = this.open;
    if (!o) return;
    const s = this.grid.selection();
    const d = this.pivotAt(this.grid.sheetIndex, s.r0, s.c0);
    if (!d || !d.table.startsWith('@model')) {
      this.status('Select a cell inside a PivotTable made from the Data Model first.', true);
      return;
    }
    const r = await engine().model(o.book, `tofx\t${d.name}`);
    if (r.text.startsWith('error\t')) {
      this.status(r.text.slice(6), true);
      return;
    }
    this.pivotBusy = true;
    try {
      await this.grid.applyPivot(r.effect);
    } finally {
      this.pivotBusy = false;
    }
    await this.pivotSync();
    this.status('Converted to CUBE formulas.');
  }

  private async pivotSync(): Promise<void> {
    const o = this.open;
    if (!o) return;
    const lines = await engine().pivots(o.book);
    if (lines.join('\n') === this.pivotLines.join('\n')) return;
    this.pivotLines = lines;
    this.sendPivots(lines);
    const p = this.pivotPanel;
    if (p && !p.el.hidden) {
      const d = this.pivotDefs().find((x) => x.name === p.name);
      if (d) p.sync(d);
      else p.hide();
    }
  }

  private async pivotApply(run: (book: number) => Promise<Effect>): Promise<void> {
    const o = this.open;
    if (!o) return;
    this.pivotBusy = true;
    try {
      await this.grid.applyPivot(await run(o.book));
    } finally {
      this.pivotBusy = false;
    }
    await this.pivotSync();
    void this.tools.refreshSlicers();
  }

  private pivotAuto(changes: Changed[]): void {
    if (this.pivotBusy || !this.pivotLines.length) return;
    const hit = this.pivotDefs().some((d) => {
      if (!d.flags.includes('a')) return false;
      const out = outArea(d);
      return changes.some((c) => c[0] === d.srcSheet && !(out && out.sheet === c[0] && c[1] >= out.area[0] && c[1] <= out.area[2] && c[2] >= out.area[1] && c[2] <= out.area[3]));
    });
    if (!hit) return;
    window.clearTimeout(this.pivotTimer);
    this.pivotTimer = window.setTimeout(() => void this.pivotAutoRun(), 350);
  }

  private async pivotAutoRun(): Promise<void> {
    const o = this.open;
    if (!o) return;
    const e = engine();
    const mark = await e.undoMark(o.book);
    for (const d of this.pivotDefs().filter((x) => x.flags.includes('a'))) {
      try {
        await this.pivotApply((book) => e.refreshPivot(book, d.name));
      } catch {
        continue;
      }
    }
    if (mark > 0 && (await e.undoMark(o.book)) > mark) await e.undoGroup(o.book, mark - 1);
  }

  private pivotFollow(range: Range): void {
    const p = this.pivotPanel;
    if (!p || p.el.hidden || !this.pivotLines.length) return;
    const d = this.pivotAt(this.grid.sheetIndex, range.r0, range.c0);
    if (d && d.name !== p.name) void this.pivotShow(d);
  }

  private async pivotShow(d: PivotDef): Promise<void> {
    const o = this.open;
    if (!o) return;
    let p = this.pivotPanel;
    if (!p) {
      p = this.pivotPanel = new PivotPanel({
        change: (def) => this.pivotApply((book) => engine().setPivot(book, def.name, formatPivot(def))),
        refresh: (name) => this.pivotApply((book) => engine().refreshPivot(book, name)),
        remove: async (name) => {
          await this.pivotApply((book) => engine().removePivot(book, name));
          this.pivotPanel?.hide();
        },
        items: (name, field) => engine().pivotItems(this.open?.book ?? -1, name, field),
        fields: async (name) => parseFields(await engine().pivotFields(this.open?.book ?? -1, name)).fields,
        close: () => {
          this.pivotPanel?.hide();
          this.grid.focus();
        },
      });
      document.getElementById('overlay-root')!.appendChild(p.el);
    }
    const f = parseFields(await engine().pivotFields(o.book, d.name));
    p.show(d, f.fields);
  }

  private pivotFields(): void {
    const s = this.grid.selection();
    const here = this.pivotAt(this.grid.sheetIndex, s.r0, s.c0);
    const d = here ?? (this.pivotDefs().filter((x) => outArea(x)?.sheet === this.grid.sheetIndex).length === 1 ? this.pivotDefs().find((x) => outArea(x)?.sheet === this.grid.sheetIndex) ?? null : null);
    if (!d) {
      this.status('Select a cell inside a PivotTable first');
      return;
    }
    void this.pivotShow(d);
  }

  private async pivotRefresh(all: boolean): Promise<void> {
    const s = this.grid.selection();
    const here = all ? null : this.pivotAt(this.grid.sheetIndex, s.r0, s.c0);
    if (!this.pivotLines.length) {
      this.status('There are no PivotTables to refresh');
      return;
    }
    await this.pivotApply((book) => engine().refreshPivot(book, here?.name ?? ''));
  }

  private async pivotBox(): Promise<void> {
    const o = this.open;
    if (!o) return;
    const s = this.grid.selection();
    const here = this.pivotAt(this.grid.sheetIndex, s.r0, s.c0);
    if (here) {
      await this.pivotShow(here);
      return;
    }
    const f = this.pivotForm ??= new PivotDialog({
      create: (src, dest, layout) => this.pivotCreate(src, dest, layout),
      suggest: (src) => engine().pivotSuggest(this.open?.book ?? -1, this.grid.sheetIndex, src),
    }, () => this.grid.focus());
    const t = this.grid.activeTable();
    const { range } = await this.grid.sortTarget();
    const prefix = sheetPrefix(o.sheets[this.grid.sheetIndex] ?? '');
    const src = t ? t.name : `${prefix}${colName(range.c0)}${range.r0 + 1}:${colName(range.c1)}${range.r1 + 1}`;
    f.open(src, `${prefix}${colName(range.c1 + 2)}${range.r0 + 1}`);
  }

  private async pivotCreate(src: string, dest: string | null, layout: string | null): Promise<void> {
    const o = this.open;
    if (!o) throw new Error('Open a workbook first.');
    const e = engine();
    const fields = parseFields(await e.pivotSource(o.book, this.grid.sheetIndex, src));
    let sheet = this.grid.sheetIndex;
    let row = 2;
    let col = 0;
    if (dest !== null) {
      const bang = dest.lastIndexOf('!');
      const name = bang < 0 ? null : dest.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'");
      const at = parseRef(dest.slice(bang + 1).replace(/\$/g, ''));
      if (!at) throw new Error('Type a cell such as H2 for the PivotTable to start in.');
      if (name !== null) {
        sheet = o.sheets.indexOf(name);
        if (sheet < 0) throw new Error(`There is no sheet called ${name}.`);
      }
      row = at.r0;
      col = at.c0;
    } else {
      await this.addSheet();
      sheet = o.sheets.length - 1;
    }
    if (sheet !== this.grid.sheetIndex) this.showSheet(sheet);
    const base = (layout ? parsePivot(layout) : null) ?? { ...emptyPivot(fields, sheet, row, col), flags: pivotFlags() };
    const def = { ...base, sheet, row, col, name: '', out: '', flags: base.flags || pivotFlags() };
    await this.pivotApply((book) => e.createPivot(book, formatPivot(def)));
    this.grid.select(row, col);
    const made = this.pivotDefs().find((d) => d.sheet === sheet && d.row === row && d.col === col);
    if (made) await this.pivotShow(made);
  }

  private sendValid(sheet: number, lines: string[]): void {
    const o = this.open;
    if (!o) return;
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        await api('PUT', `/api/workbooks/${o.id}/validations`, { sheet, lines });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
  }

  private sendFilter(sheet: number, text: string): void {
    const o = this.open;
    if (!o) return;
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        await api('PUT', `/api/workbooks/${o.id}/filter`, { sheet, text });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
  }

  private sendRules(sheet: number, lines: string[]): void {
    const o = this.open;
    if (!o) return;
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        await api('PUT', `/api/workbooks/${o.id}/rules`, { sheet, lines });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
    if (this.panel && !this.panel.el.hidden) this.fillPanel();
  }

  private addRule(kind: string, args: string[], style = ''): Promise<void> {
    const g = this.grid;
    return g.setRules([ruleLine(g.selection(), kind, args, style), ...g.rules()]).then(() => g.focus());
  }

  private cfMenu(): void {
    const [x, y] = this.below('format.cf');
    this.menu.show(x, y, this.cfItems(), () => this.grid.focus());
  }

  private cfItems(): MenuItem[] {
    const box = (title: string, kind: string, opts: RuleAsk) => () => this.ruleBox(title, kind, opts);
    const scale = (colors: string) => () => this.addRule('scale', [colors.split(',').length === 3 ? 'low,pctl:50,high' : 'low,high', colors]);
    const items: MenuItem[] = [
      { label: 'Greater than...', run: box('Format cells greater than', 'cell:gt', { values: 1 }) },
      { label: 'Less than...', run: box('Format cells less than', 'cell:lt', { values: 1 }) },
      { label: 'Between...', run: box('Format cells between', 'cell:between', { values: 2 }) },
      { label: 'Equal to...', run: box('Format cells equal to', 'cell:eq', { values: 1 }) },
      { label: 'Text that contains...', run: box('Format cells whose text contains', 'text:contains', { values: 1 }) },
      { label: 'A date occurring...', run: box('Format cells with a date occurring', 'date', { date: true }) },
      { label: 'Duplicate values...', run: box('Format duplicate values', 'dup:dup', {}) },
      { label: 'Unique values...', run: box('Format unique values', 'dup:unique', {}) },
      { sep: true },
      { label: 'Top 10 items...', run: box('Format the top items', 'top:top', { values: 1, first: '10' }) },
      { label: 'Top 10%...', run: box('Format the top percent', 'top:top:%', { values: 1, first: '10' }) },
      { label: 'Bottom 10 items...', run: box('Format the bottom items', 'top:bottom', { values: 1, first: '10' }) },
      { label: 'Bottom 10%...', run: box('Format the bottom percent', 'top:bottom:%', { values: 1, first: '10' }) },
      { label: 'Above average...', run: box('Format values above average', 'avg:above', {}) },
      { label: 'Below average...', run: box('Format values below average', 'avg:below', {}) },
      { sep: true },
      { label: 'Data bars: blue', run: () => this.addRule('bar', ['638ec6', 'low', 'high']) },
      { label: 'Data bars: green', run: () => this.addRule('bar', ['63c384', 'low', 'high']) },
      { label: 'Data bars: orange', run: () => this.addRule('bar', ['ffb628', 'low', 'high']) },
      { label: 'Colour scale: red low, yellow, green high', run: scale('f8696b,ffeb84,63be7b') },
      { label: 'Colour scale: green low, yellow, red high', run: scale('63be7b,ffeb84,f8696b') },
      { label: 'Colour scale: white low, green high', run: scale('fcfcff,63be7b') },
      { label: 'Colour scale: white low, red high', run: scale('fcfcff,f8696b') },
      { label: 'Icons: 3 arrows', run: () => this.addRule('icons', ['3arrows']) },
      { label: 'Icons: 3 traffic lights', run: () => this.addRule('icons', ['3traffic']) },
      { label: 'Icons: 3 flags', run: () => this.addRule('icons', ['3flags']) },
      { label: 'Icons: 3 symbols', run: () => this.addRule('icons', ['3symbols']) },
      { label: 'Icons: 5 arrows', run: () => this.addRule('icons', ['5arrows']) },
      { sep: true },
      { label: 'New rule with a formula...', run: box('Format cells where this formula is true', 'formula', { values: 1, formula: true }) },
      { label: 'Manage rules...', run: () => this.openPanel() },
      { label: 'Clear rules from selected cells', run: () => this.clearRules(true) },
      { label: 'Clear rules from this sheet', danger: true, run: () => this.clearRules(false) },
    ];
    return items;
  }

  private clearRules(selection: boolean): Promise<void> {
    const g = this.grid;
    const s = g.selection();
    const keep = selection ? g.rules().filter((l) => {
      const a = parseRule(l).area;
      return a.r1 < s.r0 || a.r0 > s.r1 || a.c1 < s.c0 || a.c0 > s.c1;
    }) : [];
    return g.setRules(keep).then(() => g.focus());
  }

  private ruleForm: RuleForm | null = null;

  private ruleBox(title: string, kind: string, opts: RuleAsk): void {
    const f = this.ruleForm ??= this.makeRuleForm();
    const [x, y] = this.below('format.cf');
    f.form.style.left = `${Math.round(x)}px`;
    f.form.style.top = `${Math.round(y)}px`;
    f.title.textContent = title;
    f.kind = kind;
    f.v1.parentElement!.hidden = !opts.values;
    f.v2.parentElement!.hidden = (opts.values ?? 0) < 2;
    f.date.parentElement!.hidden = !opts.date;
    f.v1.value = opts.first ?? '';
    f.v2.value = '';
    f.v1.placeholder = opts.formula ? '=$B1="Yes"' : 'A value, or a formula starting with =';
    f.hint.textContent = opts.formula ? 'Write the formula for the first cell of the selection; references move for the other cells.' : '';
    f.form.dataset.state = '';
    f.form.hidden = false;
    (opts.values ? f.v1 : f.preset).focus();
  }

  private makeRuleForm(): RuleForm {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom';
    form.hidden = true;
    form.innerHTML = `<strong class="fc-fmt-title"></strong>
      <label class="fc-fmt-label">Value<input class="fc-fmt-input fc-rule-v1" spellcheck="false" autocomplete="off"></label>
      <label class="fc-fmt-label">And<input class="fc-fmt-input fc-rule-v2" spellcheck="false" autocomplete="off"></label>
      <label class="fc-fmt-label">Period<select class="fc-fmt-input fc-rule-date">${DATE_PERIODS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label class="fc-fmt-label">Format with<select class="fc-fmt-input fc-rule-preset">${PRESETS.map(([l, s]) => `<option value="${s}">${l}</option>`).join('')}</select></label>
      <span class="fc-fmt-hint" aria-live="polite"></span>
      <button type="submit" class="fc-btn fc-btn-primary">Add rule</button>`;
    document.getElementById('overlay-root')!.appendChild(form);
    const q = <T extends HTMLElement>(s: string) => form.querySelector<T>(s)!;
    const f: RuleForm = { form, title: q('.fc-fmt-title'), v1: q('.fc-rule-v1'), v2: q('.fc-rule-v2'), date: q('.fc-rule-date'), preset: q('.fc-rule-preset'), hint: q('.fc-fmt-hint'), kind: '' };
    const close = () => {
      form.hidden = true;
      this.grid.focus();
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const [kind, a = '', b = ''] = f.kind.split(':');
      const args = kind === 'cell' ? [a, f.v1.value, f.v2.value]
        : kind === 'text' ? [a, f.v1.value]
        : kind === 'date' ? [f.date.value]
        : kind === 'top' ? [a, f.v1.value, b]
        : kind === 'formula' ? [f.v1.value.trim().startsWith('=') ? f.v1.value.trim() : `=${f.v1.value.trim()}`]
        : [a];
      void this.addRule(kind, args, f.preset.value).then(close, (err: unknown) => {
        form.dataset.state = 'error';
        f.hint.textContent = err instanceof Error ? err.message : String(err);
      });
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!form.hidden && !form.contains(e.target as Node)) form.hidden = true;
    }, true);
    return f;
  }

  private panel: { el: HTMLElement; list: HTMLElement; title: Text } | null = null;

  private openPanel(): void {
    if (!this.panel) {
      const el = document.createElement('section');
      el.className = 'fc-rules';
      el.hidden = true;
      el.setAttribute('aria-label', 'Conditional formatting rules');
      el.innerHTML = '<header class="fc-rules-head"><strong></strong><button type="button" class="fc-tool" data-act="close" title="Close" aria-label="Close"></button></header><ol class="fc-rules-list"></ol><p class="fc-rules-note">Rules higher in the list win when two set the same thing. New rules go to the top.</p>';
      el.querySelector('[data-act="close"]')!.innerHTML = icon('close');
      document.getElementById('overlay-root')!.appendChild(el);
      const title = el.querySelector('strong')!.appendChild(document.createTextNode(''));
      const list = el.querySelector<HTMLElement>('.fc-rules-list')!;
      el.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'close') {
          el.hidden = true;
          this.grid.focus();
          return;
        }
        const i = Number(b.closest<HTMLElement>('[data-i]')?.dataset.i);
        const lines = [...this.grid.rules()];
        if (b.dataset.act === 'up' && i > 0) [lines[i - 1], lines[i]] = [lines[i], lines[i - 1]];
        else if (b.dataset.act === 'down' && i < lines.length - 1) [lines[i + 1], lines[i]] = [lines[i], lines[i + 1]];
        else if (b.dataset.act === 'delete') lines.splice(i, 1);
        else return;
        void this.grid.setRules(lines);
      });
      el.addEventListener('change', (e) => {
        const box = e.target as HTMLInputElement;
        const i = Number(box.closest<HTMLElement>('[data-i]')?.dataset.i);
        const lines = [...this.grid.rules()];
        if (!Number.isNaN(i) && lines[i]) {
          lines[i] = withStop(lines[i], box.checked);
          void this.grid.setRules(lines);
        }
      });
      this.panel = { el, list, title };
    }
    this.fillPanel();
    this.panel.el.hidden = false;
  }

  private fillPanel(): void {
    const p = this.panel;
    if (!p) return;
    const lines = this.grid.rules();
    const name = this.open?.sheets[this.grid.sheetIndex] ?? '';
    if (p.title.nodeValue !== `Rules on ${name}`) p.title.nodeValue = `Rules on ${name}`;
    const rows = [...p.list.children] as HTMLElement[];
    lines.forEach((line, i) => {
      let row = rows[i];
      if (!row) {
        row = document.createElement('li');
        row.className = 'fc-rule';
        row.innerHTML = '<span class="fc-rule-what"></span><span class="fc-rule-where"></span><label class="fc-rule-stop"><input type="checkbox"> Stop if true</label><span class="fc-rule-acts"><button type="button" class="fc-btn" data-act="up">Up</button><button type="button" class="fc-btn" data-act="down">Down</button><button type="button" class="fc-btn" data-act="delete">Delete</button></span>';
        p.list.appendChild(row);
      }
      row.dataset.i = String(i);
      const r = parseRule(line);
      const what = row.querySelector('.fc-rule-what')!;
      const where = row.querySelector('.fc-rule-where')!;
      const text = describe(line);
      if (what.textContent !== text) what.textContent = text;
      const at = rangeText(r.area);
      if (where.textContent !== at) where.textContent = at;
      const box = row.querySelector<HTMLInputElement>('input')!;
      if (box.checked !== r.stop) box.checked = r.stop;
    });
    for (let i = rows.length - 1; i >= lines.length; i--) rows[i].remove();
    if (!lines.length && !p.list.dataset.empty) p.list.dataset.empty = '1';
    else if (lines.length && p.list.dataset.empty) delete p.list.dataset.empty;
  }

  private sendLook(): void {
    const o = this.open;
    if (!o) return;
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        const e = engine();
        const [t, cellStyles] = await Promise.all([e.theme(o.book), e.namedStyles(o.book)]);
        await api('PUT', `/api/workbooks/${o.id}/look`, { theme: t.current, cell_styles: cellStyles });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
  }

  private pasteMenu(x: number, y: number): void {
    const g = this.grid;
    const done = () => g.focus();
    const run = (kind: PasteKind, t = false) => () => g.pasteSpecial(kind, t).then(done);
    if (!g.canPasteSpecial()) {
      this.menu.show(x, y, [{ label: 'Copy cells in FormCel first to paste them in special ways', disabled: true, run: () => undefined }], done);
      return;
    }
    this.menu.show(x, y, [
      { label: 'All', run: run('all') },
      { label: 'Formulas', run: run('formulas') },
      { label: 'Values', run: run('values') },
      { label: 'Formats', run: run('formats') },
      { label: 'Formulas and number formats', run: run('formulas-formats') },
      { label: 'Values and number formats', run: run('values-formats') },
      { label: 'All except borders', run: run('no-borders') },
      { label: 'Column widths', run: run('widths') },
      { label: 'Validation', run: () => void g.pasteWith('validation', 'none', false, false).then((m) => { if (m) this.status(m); done(); }) },
      { sep: true },
      { label: 'Transpose', run: run('all', true) },
      { label: 'Values, transposed', run: run('values', true) },
      { sep: true },
      { label: 'Paste link', run: () => void g.pasteLayers('link', false).then(done) },
      { label: 'Paste special dialog (validation, notes, operations, skip blanks)', run: () => void runCommand('edit.paste-ops') },
    ], done);
  }

  private async stylesMenu(): Promise<void> {
    const g = this.grid;
    const o = this.open;
    if (!o) return;
    const lines = await engine().namedStyles(o.book);
    const named = lines.map((l) => l.split('\t')).map(([name, , , , builtin]) => ({ name, builtin: builtin === '1' }));
    const current = g.activeStyle().cs ?? 'Normal';
    const [x, y] = this.below('format.styles');
    const groups = [['Normal', 'Good', 'Bad', 'Neutral'], ['Title', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Total'], ['Input', 'Output', 'Calculation', 'Note', 'Warning Text'], ['Accent 1', 'Accent 2', 'Accent 3', 'Accent 4', 'Accent 5', 'Accent 6'], ['Comma', 'Currency', 'Percent']];
    const known = new Set(groups.flat());
    const custom = named.filter((n) => !known.has(n.name)).map((n) => n.name);
    const items: MenuItem[] = [];
    const add = (name: string) => items.push({ label: name === current ? `${name} (current)` : name, run: () => g.applyNamed(name).then(() => g.focus()) });
    for (const group of [...groups.map((gr) => gr.filter((n) => named.some((d) => d.name === n))), custom]) {
      if (!group.length) continue;
      if (items.length) items.push({ sep: true });
      group.forEach(add);
    }
    items.push({ sep: true }, { label: 'New cell style from selection...', run: () => this.styleBox('') });
    if (current !== 'Normal') {
      items.push({ label: `Update ${current} to match selection`, run: () => this.styleBox(current) });
      items.push({ label: `Delete ${current}`, danger: true, confirm: `Click again to delete ${current} from every cell`, run: () => g.deleteNamed(current).then(() => g.focus()) });
    }
    this.menu.show(x, y, items, () => g.focus());
  }

  private styleForm: { form: HTMLFormElement; name: HTMLInputElement; hint: HTMLElement; parts: HTMLInputElement[] } | null = null;

  private styleBox(name: string): void {
    const box = this.styleForm ??= this.makeStyleForm();
    const [x, y] = this.below('format.styles');
    box.form.style.left = `${Math.round(x)}px`;
    box.form.style.top = `${Math.round(y)}px`;
    box.name.value = name;
    box.hint.textContent = 'The style takes the checked parts of the active cell’s formatting.';
    box.form.dataset.state = '';
    box.form.hidden = false;
    box.name.focus();
    box.name.select();
  }

  private makeStyleForm(): { form: HTMLFormElement; name: HTMLInputElement; hint: HTMLElement; parts: HTMLInputElement[] } {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom';
    form.hidden = true;
    const parts: [string, string][] = [['n', 'Number'], ['a', 'Alignment'], ['f', 'Font'], ['b', 'Border'], ['p', 'Fill']];
    form.innerHTML = `<label class="fc-fmt-label">Style name<input class="fc-fmt-input" spellcheck="false" autocomplete="off" maxlength="64"></label><div class="fc-fmt-parts">${parts.map(([k, l]) => `<label><input type="checkbox" value="${k}" checked> ${l}</label>`).join('')}</div><span class="fc-fmt-hint" aria-live="polite"></span><button type="submit" class="fc-btn fc-btn-primary">Save style</button>`;
    document.getElementById('overlay-root')!.appendChild(form);
    const name = form.querySelector<HTMLInputElement>('.fc-fmt-input')!;
    const hint = form.querySelector<HTMLElement>('.fc-fmt-hint')!;
    const boxes = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    const close = () => {
      form.hidden = true;
      this.grid.focus();
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const picked = boxes.filter((b) => b.checked).map((b) => b.value).join('');
      void this.grid.defineNamed(name.value, picked).then(close, (err: unknown) => {
        form.dataset.state = 'error';
        hint.textContent = err instanceof Error ? err.message : String(err);
      });
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!form.hidden && !form.contains(e.target as Node)) form.hidden = true;
    }, true);
    return { form, name, hint, parts: boxes };
  }

  private themeMenu(): void {
    const g = this.grid;
    const [x, y] = this.below('format.theme');
    this.menu.show(x, y, g.themeNames.map((n) => ({
      label: n === g.look.name ? `${n} (current)` : n,
      run: () => g.setTheme(n).then(() => g.focus()),
    })), () => g.focus());
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
    const slots = ['dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
    const themed = slots.map((s) => g.look.colors[['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].indexOf(s)]);
    const pickTheme = (c: string) => void g.styleSelection(`${key}:t:${slots[themed.indexOf(c)]}`).then(() => g.focus());
    this.menu.show(x, y, [
      { swatches: themed, current: st[key] ?? '', pick: pickTheme, name: `Theme colour (${g.look.name})` },
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
    const label = st.font ?? g.look.body;
    if (font.textContent !== label) font.textContent = label;
    const size = this.button('format.size');
    const sz = String(st.size ?? 10);
    if (size.textContent !== sz) size.textContent = sz;
    this.button('format.text-color').style.setProperty('--swatch', st.fc ?? 'currentColor');
    this.button('format.fill-color').style.setProperty('--swatch', st.bg ?? 'currentColor');
    this.ribbon?.refresh();
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
      items.push({ sep: true }, { label: 'More number formats...', keys: 'Ctrl+1', run: run('format.number-dialog') }, { label: 'Custom format...', run: run('format.custom') });
      this.menu.show(b.left, b.bottom + 4, items, () => g.focus());
    });
  }

  private async bumpDecimals(dir: 1 | -1): Promise<void> {
    const g = this.grid;
    const code = await g.formatAtActive();
    const next = bumpCode(code, this.current, dir);
    if (next !== code) await g.setFormat(next);
  }

  private numberBox: NumberFormatDialog | null = null;

  private numberDialog(): void {
    const box = this.numberBox ??= new NumberFormatDialog({
      current: async () => {
        const raw = this.current.trim();
        return { code: await this.grid.formatAtActive(), sample: raw && !raw.startsWith('=') && !Number.isNaN(Number(raw.replace(/,/g, ''))) ? raw : '1234.5678' };
      },
      preview: async (code, sample) => {
        const o = this.open;
        return o ? (await engine().tool(o.book, this.grid.sheetIndex, 'fmtpreview', code, sample)).message ?? '' : '';
      },
      specials: async () => {
        const o = this.open;
        const text = o ? (await engine().tool(o.book, this.grid.sheetIndex, 'fmtspecials')).message ?? '' : '';
        return text.split('\n').filter(Boolean).map((l) => l.split('\t') as [string, string]);
      },
      apply: (code) => this.grid.setFormat(code),
      locale: () => this.open?.locale ?? 'en-US',
    });
    void box.open();
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

  private dataMenu(): void {
    const [x, y] = this.below('data.tools');
    const run = (id: string) => () => runCommand(id).then(() => undefined);
    const auto = this.grid.autoComplete;
    this.menu.show(x, y, [
      { label: 'Remove duplicates', run: run('data.dedupe') },
      { label: 'Text to columns', run: run('data.text-to-columns') },
      { label: 'Trim whitespace', run: run('data.trim') },
      { label: 'Data cleanup', run: run('data.cleanup') },
      { label: 'Flash Fill', keys: 'Ctrl+E', run: run('data.flash-fill') },
      { label: this.flashAuto ? 'Automatically Flash Fill: on' : 'Automatically Flash Fill: off', run: run('data.flash-auto') },
      { sep: true },
      { label: 'Consolidate', run: run('data.consolidate') },
      { label: 'Subtotal', run: run('data.subtotal') },
      { label: 'Auto Outline', run: run('data.auto-outline') },
      { label: 'Clear Outline', run: run('data.clear-outline') },
      { label: 'Outline settings...', run: run('data.outline-settings') },
      { label: 'Advanced filter', run: run('data.advanced-filter') },
      { label: 'Filter views', run: run('data.filter-views') },
      { label: 'Insert slicer', run: run('data.slicer') },
      { sep: true },
      { label: 'Circle invalid data', run: run('data.circle-invalid') },
      { label: 'Clear validation circles', run: run('data.clear-circles') },
      { label: 'Insert checkboxes', run: run('data.checkbox-insert') },
      { label: 'Remove checkboxes', run: run('data.checkbox-remove') },
      { label: 'Table column type', run: run('data.column-type') },
      { sep: true },
      { label: 'Find', keys: 'Ctrl+F', run: run('edit.find') },
      { label: 'Find and replace', keys: 'Ctrl+H', run: run('edit.replace') },
      { label: 'Insert cells', run: run('edit.insert-cells') },
      { label: 'Delete cells', run: run('edit.delete-cells') },
      { label: 'Fill series', run: run('edit.series') },
      { label: 'Paste special options', run: run('edit.paste-ops') },
      { label: auto ? 'AutoComplete: on' : 'AutoComplete: off', run: run('edit.autocomplete') },
      { sep: true },
      { label: 'Document properties', run: run('file.properties') },
      { label: 'Save as template', run: run('file.save-template') },
    ], () => this.grid.focus());
  }

  private toggleAutoComplete(): void {
    this.grid.autoComplete = !this.grid.autoComplete;
    try {
      localStorage.setItem('fc-autocomplete', this.grid.autoComplete ? '1' : '0');
    } catch {
      this.status('AutoComplete changed for this session only');
    }
    this.status(`AutoComplete ${this.grid.autoComplete ? 'on' : 'off'}`);
  }

  private cellsMenu(insert: boolean): void {
    this.tools.cellsDialog(insert);
  }

  private async saveTemplate(): Promise<void> {
    const o = this.open;
    if (!o) return;
    this.flush();
    await this.saving;
    this.tools.askTemplate(async (name, description) => {
      await api('POST', `/api/workbooks/${o.id}/template`, { name, description });
      return `Saved ${name} in your personal templates.`;
    }, o.title);
  }

  private hideSheet(i: number, on: boolean): void {
    const o = this.open;
    if (!o) return;
    if (on && o.sheets.filter((_, k) => k !== i && !o.views[k]?.hidden).length === 0) {
      this.status('A workbook keeps at least one visible sheet.', true);
      return;
    }
    this.grouped.delete(i);
    this.patchView(i, { hidden: on || null });
    if (on && this.grid.sheetIndex === i) {
      const next = o.sheets.findIndex((_, k) => k > i && !o.views[k]?.hidden);
      let prev = i - 1;
      while (prev > 0 && o.views[prev]?.hidden) prev--;
      this.showSheet(next >= 0 ? next : Math.max(0, prev));
    }
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
    if (kind === 'cells') {
      const linked = g.activeLinked();
      items.push({ label: linked ? 'Edit link' : 'Insert link', keys: 'Ctrl+K', run: run('edit.link') });
      if (linked) items.push({ label: 'Open link', run: run('edit.link-open') }, { label: 'Remove link', run: run('edit.link-remove') });
    }
    if (kind === 'cells') items.push({ label: 'Insert cells', run: run('edit.insert-cells') }, { label: 'Delete cells', run: run('edit.delete-cells') });
    items.push({ label: 'Clear contents', keys: 'Delete', run: run('edit.clear') }, { label: 'Paste special', keys: 'Ctrl+Alt+V', disabled: !g.canPasteSpecial(), run: () => this.pasteMenu(x, y) }, { sep: true });
    if (kind === 'rows' || kind === 'cells') items.push({ label: 'Hide rows', keys: 'Ctrl+9', run: run('rows.hide') }, { label: 'Unhide rows', keys: 'Ctrl+Shift+9', run: run('rows.unhide') });
    if (kind === 'cols' || kind === 'cells') items.push({ label: 'Hide columns', keys: 'Ctrl+0', run: run('cols.hide') }, { label: 'Unhide columns', keys: 'Ctrl+Shift+0', run: run('cols.unhide') });
    items.push({ sep: true });
    if (kind !== 'cols') items.push({ label: 'Row height...', run: run('rows.height') }, { label: 'AutoFit row height', run: run('rows.autofit') });
    if (kind !== 'rows') items.push({ label: 'Column width...', run: run('cols.width') }, { label: 'AutoFit column width', run: run('cols.autofit') }, { label: 'Standard width...', run: run('cols.standard') });
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
      { label: 'Copy sheet', run: () => void this.moveCopySheet(i, o.id, '', i + 1, true).then((m) => this.status(m)).catch((err: unknown) => this.status(err instanceof Error ? err.message : 'Could not copy the sheet', true)) },
      { label: 'Move or copy...', run: () => void this.tools.moveCopy(i) },
      { sep: true },
      { label: 'Hide sheet', disabled: o.sheets.filter((_, k) => !o.views[k]?.hidden).length < 2, run: () => this.hideSheet(i, true) },
      ...o.sheets.map((n, k) => ({ n, k })).filter(({ k }) => o.views[k]?.hidden).map(({ n, k }): MenuItem => ({ label: `Unhide ${n}`, run: () => this.hideSheet(k, false) })),
      { label: 'Ungroup sheets', disabled: !this.grouped.size, run: () => { this.grouped.clear(); this.renderTabs(); } },
      { sep: true },
      { swatches: TAB_COLOURS, current: o.views[i]?.color ?? '', pick: (c) => this.colourSheet(i, c) },
      { sep: true },
      { label: 'Delete sheet', danger: true, disabled: o.sheets.length === 1, confirm: 'Click again to delete this sheet', run: () => this.deleteSheet(i) },
    ]);
  }

  private scriptHost(): ScriptHost {
    return {
      views: () => this.open?.views ?? [],
      patchView: (s, part) => this.patchView(s, part),
      names: () => this.open?.names ?? [],
      layer: () => this.charts.layer,
      pivotsChanged: () => this.pivotSync(),
      defineName: async (name, refers) => {
        const o = this.open;
        if (!o) return;
        this.grid.patch(await engine().defineName(o.book, name, refers));
        o.names = await engine().names(o.book);
        await api('PUT', `/api/workbooks/${o.id}/names`, { name, refers });
      },
      sheetOp: async (op, i, arg) => {
        if (op === 'rename') this.renameSheetTo(i, String(arg));
        else if (op === 'move') await this.moveSheet(i, Number(arg));
        else if (op === 'delete') await this.deleteSheet(i);
        else if (op === 'tab') this.colourSheet(i, String(arg));
        else if (op === 'visible') this.hideSheet(i, arg !== 'Visible');
        else this.showSheet(i);
      },
    };
  }

  private renameSheetTo(i: number, raw: string): void {
    const o = this.open;
    const t = this.p.tabs.querySelector<HTMLElement>(`[data-sheet="${i}"]`);
    const name = raw.replace(/[\\/?*[\]:]/g, '').trim().slice(0, 31);
    if (!o || !name || name === o.sheets[i] || o.sheets.some((s) => s.toLowerCase() === name.toLowerCase())) return;
    this.grid.recorder?.({ k: 'sheetop', op: 'rename', sheet: i, name: o.sheets[i], to: name });
    o.sheets[i] = name;
    if (t) t.textContent = name;
    void engine().renameSheet(o.book, i, name).then(() => this.refreshNames());
    void api('PATCH', `/api/workbooks/${o.id}/sheets/${i}`, { name }).catch(() => this.status('Name not saved', true));
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
        this.grid.recorder?.({ k: 'sheetop', op: 'rename', sheet: i, name: before, to: name });
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
    await this.charts.layer.open();
    this.renderTabs();
    this.showSheet(to);
    this.button('edit.undo').disabled = true;
    this.button('edit.redo').disabled = true;
  }

  private async moveCopySheet(i: number, dest: string, name: string, before: number | null, copy: boolean): Promise<string> {
    const o = this.open;
    if (!o) return '';
    this.flush();
    await this.saving;
    const same = !dest || dest === o.id;
    if (same && !copy) {
      const to = before === null ? o.sheets.length - 1 : before > i ? before - 1 : before;
      if (to !== i) await this.moveSheet(i, to);
      return `Moved ${o.sheets[to]}.`;
    }
    const r = await api<{ dest: string; index: number; name: string; sheets: string[] }>('POST', `/api/workbooks/${o.id}/sheets/${i}/copy`, { dest: same ? null : dest, name: name || null, to: before });
    if (!same) {
      if (!copy) await this.deleteSheet(i);
      return `${copy ? 'Copied' : 'Moved'} ${o.sheets[i] ?? r.name} to ${r.name} in the other workbook.`;
    }
    const doc = await api<{ cells: [number, number, string][][]; formats?: [number, number, string][][]; styles?: [number, number, string][][]; merges?: Area[][]; rules?: string[][]; filters?: string[]; validations?: string[][]; links?: [number, number, string][][]; views?: SheetView[]; sheets: string[]; collab?: Parameters<Collab['attach']>[3]; protection?: Parameters<Collab['attach']>[4] }>('GET', `/api/workbooks/${o.id}`);
    const e = engine();
    const k = r.index;
    const last = await e.addSheet(o.book, r.name);
    await e.loadFormats(o.book, last, doc.formats?.[k] ?? []);
    await e.loadStyles(o.book, last, doc.styles?.[k] ?? []);
    await e.loadMerges(o.book, last, doc.merges?.[k] ?? []);
    await e.loadRules(o.book, last, doc.rules?.[k] ?? []);
    await e.loadFilter(o.book, last, doc.filters?.[k] ?? '');
    await e.loadValidations(o.book, last, doc.validations?.[k] ?? []);
    await e.loadLinks(o.book, last, doc.links?.[k] ?? []);
    if (doc.cells[k]?.length) await e.load(o.book, doc.cells[k], last);
    await e.loadChips(o.book, last, (doc as { chips?: [number, number, string][][] }).chips?.[k] ?? []);
    if (k !== last) await e.moveSheet(o.book, last, k);
    o.sheets = doc.sheets;
    o.views = doc.sheets.map((_, n) => doc.views?.[n] ?? {});
    o.pages = doc.sheets.map((_, n) => cleanPage((doc.views?.[n] as { page?: unknown } | undefined)?.page));
    this.grouped.clear();
    this.collab.detach();
    this.collab.attach(o.id, o.book, doc.sheets, doc.collab, doc.protection);
    await this.charts.layer.open();
    this.renderTabs();
    this.showSheet(k);
    this.button('edit.undo').disabled = true;
    this.button('edit.redo').disabled = true;
    return `Copied to ${r.name}.`;
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
    this.grid.recorder?.({ k: 'sheetop', op: 'delete', sheet: i, name: o.sheets[i] });
    this.flush();
    await this.saving;
    await engine().deleteSheet(o.book, i);
    await api('DELETE', `/api/workbooks/${o.id}/sheets/${i}`);
    o.sheets.splice(i, 1);
    o.views.splice(i, 1);
    await this.charts.layer.open();
    this.renderTabs();
    this.showSheet(Math.min(i, o.sheets.length - 1));
    this.button('edit.undo').disabled = true;
    this.button('edit.redo').disabled = true;
  }

  private markTab(sheet: number): void {
    for (const t of this.p.tabs.children) t.setAttribute('aria-selected', String((t as HTMLElement).dataset.sheet === String(sheet)));
  }

  private async addSheetNamed(name: string): Promise<number> {
    const o = this.open;
    if (!o) return 0;
    const at = o.sheets.indexOf(name);
    if (at >= 0) return at;
    await api('POST', `/api/workbooks/${o.id}/sheets`, { name });
    const i = await engine().addSheet(o.book, name);
    o.sheets.push(name);
    o.views.push({});
    this.renderTabs();
    return i;
  }

  private async addSheet(): Promise<void> {
    const o = this.open;
    if (!o) return;
    let n = o.sheets.length + 1;
    while (o.sheets.includes(`Sheet${n}`)) n++;
    const name = `Sheet${n}`;
    this.grid.recorder?.({ k: 'sheetop', op: 'add', sheet: o.sheets.length, name });
    await api('POST', `/api/workbooks/${o.id}/sheets`, { name });
    const i = await engine().addSheet(o.book, name);
    o.sheets.push(name);
    o.views.push({});
    this.renderTabs();
    this.showSheet(i);
  }

  private async makeSheet(base: string): Promise<number> {
    const o = this.open;
    if (!o) throw new Error('No workbook is open.');
    let name = base;
    for (let n = 2; o.sheets.includes(name); n++) name = `${base} ${n}`;
    await api('POST', `/api/workbooks/${o.id}/sheets`, { name });
    const i = await engine().addSheet(o.book, name);
    o.sheets.push(name);
    o.views.push({});
    this.renderTabs();
    return i;
  }

  private whatIfMenu(): void {
    const b = this.button('data.whatif').getBoundingClientRect();
    const run = (id: string) => () => void runCommand(id);
    this.menu.show(b.left, b.bottom + 4, [
      { label: 'Goal Seek', run: run('data.goal-seek') },
      { label: 'Data Table', run: run('data.data-table') },
      { label: 'Scenario Manager', run: run('data.scenarios') },
      { label: 'Solver', run: run('data.solver') },
      { sep: true },
      { label: 'Forecast Sheet', run: run('data.forecast-sheet') },
      { label: 'Descriptive Statistics', run: run('data.describe') },
      { label: 'Regression', run: run('data.regression') },
      { label: 'Data Analysis', run: run('data.analysis') },
      { label: 'Analyze Data', run: run('data.analyze') },
      { sep: true },
      { label: 'Recalculate data tables', run: run('data.datatable-refresh') },
    ], () => this.grid.focus());
  }

  private sendWhatif(lines: string[]): void {
    const o = this.open;
    if (!o) return;
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        await api('PUT', `/api/workbooks/${o.id}/whatif`, { lines });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
  }

  private status(text: string, error = false): void {
    this.p.saveText.nodeValue = text;
    this.p.save.dataset.state = error ? 'error' : 'ok';
    if (this.p.save.title !== text) this.p.save.title = text;
  }

  private queueSave(changes: Changed[]): void {
    for (const [s, r, c, t, f] of changes) {
      if (f?.startsWith('{=')) continue;
      let m = this.pending.get(s);
      if (!m) this.pending.set(s, (m = new Map()));
      m.set(`${r}:${c}`, [r, c, f ?? t]);
    }
    this.status('Saving');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), Math.round(prefs().autosaveSeconds * 1000));
  }

  private sendObjects(sheet: number, list: FloatObject[]): void {
    const o = this.open;
    if (!o) return;
    this.status('Saving');
    this.saving = this.saving.then(async () => {
      try {
        await api('PUT', `/api/workbooks/${o.id}/objects`, { sheet, objects: list });
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        this.status('Not saved', true);
        this.p.save.title = err instanceof Error ? err.message : '';
      }
    });
  }

  private async drainOffline(id: string): Promise<void> {
    if (!(await waiting(id))) return;
    const sent = await replay(id, async (sheet, cells) => {
      try {
        await api('POST', `/api/workbooks/${id}/cells?why=${encodeURIComponent('Sent after being offline')}`, { sheet, cells });
      } catch (err) {
        if (isNetworkFailure(err)) throw err;
        this.collab?.refused(`A change made while offline was refused: ${err instanceof Error ? err.message : 'not saved'}`);
      }
    });
    if (sent) this.status(`Sent ${sent} change${sent === 1 ? '' : 's'} kept while offline`);
  }

  private watchOffline(id: string): void {
    window.clearTimeout(this.offlineTimer);
    this.offlineTimer = window.setTimeout(() => {
      if (this.open?.id !== id) return;
      this.saving = this.saving.then(async () => {
        try {
          await this.drainOffline(id);
          if (!this.pending.size) this.status('Saved');
          this.p.save.title = '';
        } catch {
          this.watchOffline(id);
        }
      });
    }, 15000);
  }

  private flush(): void {
    this.charts.layer.flush();
    window.clearTimeout(this.timer);
    const o = this.open;
    if (!o || !this.pending.size) return;
    const batches = [...this.pending.entries()];
    this.pending = new Map();
    const why = takeAction();
    this.saving = this.saving.then(async () => {
      try {
        await this.drainOffline(o.id);
        let first = true;
        for (const [sheet, m] of batches) {
          await api('POST', `/api/workbooks/${o.id}/cells${first && why ? `?why=${encodeURIComponent(why)}` : ''}`, { sheet, cells: await this.calc.canonical([...m.values()]) });
          first = false;
        }
        if (!this.pending.size) this.status('Saved');
      } catch (err) {
        if (isNetworkFailure(err)) {
          try {
            for (const [sheet, m] of batches) await keep(o.id, sheet, [...m.values()]);
            this.status('Offline: changes kept on this computer');
            this.p.save.title = 'The engine could not be reached. FormCel keeps your changes on this computer and sends them when it can.';
            this.watchOffline(o.id);
            return;
          } catch {
            this.status('Not saved', true);
          }
        }
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
