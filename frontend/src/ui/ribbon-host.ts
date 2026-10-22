import { rangeLabel } from '../charts/data';
import type { FloatObject } from '../charts/types';
import { CHART_TYPES } from '../charts/types';
import { engine } from '../engine';
import { colName } from '../grid/a1';
import type { BorderKind, Grid } from '../grid/grid';
import { TABLE_STYLES } from '../grid/tables';
import { SIZE_PRESETS, stepSize } from '../grid/fonts';
import { fontPickerOpen, closeFontPicker, openFontPicker } from './fontpicker';
import { FUNCTIONS } from './autocomplete';
import type { MenuItem } from './menu';
import { el, escapeHtml } from './rb-dom';
import { rbIcon } from './rb-icons';
import type { MItem, Palette, Tile } from './rb-menu';
import { rbState } from './rb-state';

export interface HostHooks {
  book(): number;
  open(): boolean;
  cfItems(): MenuItem[];
  styleBox(name: string): void;
  say(text: string, bad?: boolean): void;
  formulaText(): string;
  selectedObject(): FloatObject | null;
  sparkHere(): boolean;
  inPivot(): boolean;
  fnPick(name: string): void;
  run(id: string, anchor?: HTMLElement | null): void;
}

const STANDARD = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
const NUM_NAMES: [string, string][] = [
  ['', 'General'], ['#,##0.00', 'Number'], ['$#,##0.00_);($#,##0.00)', 'Currency'], ['_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)', 'Accounting'], ['0%', 'Percentage'], ['0.00E+00', 'Scientific'],
  ['# ?/?', 'Fraction'], ['m/d/yyyy', 'Short Date'], ['d-mmm-yy', 'Date'], ['dddd, mmmm d, yyyy', 'Long Date'], ['h:mm AM/PM', 'Time'], ['h:mm:ss AM/PM', 'Time'], ['@', 'Text'],
];
const SYMBOLS = ['°', '±', '×', '÷', '≠', '≤', '≥', '∞', 'π', 'Σ', 'Δ', 'Ω', 'µ', '©', '®', '™', '€', '£', '¥', '¢', '✓', '✗', '←', '↑', '→', '↓', '•', '…'];
const SLOTS = ['lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
const THEME_KEYS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

const CHART_ICON: Record<string, string> = {
  column: 'chColumn', 'column-stacked': 'chColumnStacked', 'column-100': 'chColumn100', bar: 'chBar', 'bar-stacked': 'chBarStacked', 'bar-100': 'chBar100', line: 'chLine', area: 'chArea',
  'area-stacked': 'chAreaStacked', 'area-100': 'chArea100', pie: 'chPie', doughnut: 'chDoughnut', scatter: 'chScatter', bubble: 'chBubble', combo: 'chCombo', histogram: 'chHistogram', box: 'chBox',
  waterfall: 'chWaterfall', candlestick: 'chCandle', treemap: 'chTreemap', sunburst: 'chSunburst', funnel: 'chFunnel', gauge: 'chGauge', scorecard: 'chScorecard', radar: 'chRadar', timeline: 'chTimeline', org: 'chOrg', map: 'chMap',
};

const CHART_MENUS: { id: string; label: string; icon: string; types: string[] }[] = [
  { id: 'colbar', label: 'Insert Column or Bar Chart', icon: 'chColumn', types: ['column', 'column-stacked', 'column-100', 'bar', 'bar-stacked', 'bar-100'] },
  { id: 'hier', label: 'Insert Hierarchy Chart', icon: 'chTreemap', types: ['treemap', 'sunburst', 'org'] },
  { id: 'lineArea', label: 'Insert Line or Area Chart', icon: 'chLine', types: ['line', 'area', 'area-stacked', 'area-100'] },
  { id: 'pie', label: 'Insert Pie or Doughnut Chart', icon: 'chPie', types: ['pie', 'doughnut'] },
  { id: 'stat', label: 'Insert Statistic Chart', icon: 'chHistogram', types: ['histogram', 'box'] },
  { id: 'scatter', label: 'Insert Scatter (X, Y) or Bubble Chart', icon: 'chScatter', types: ['scatter', 'bubble'] },
  { id: 'wf', label: 'Insert Waterfall, Funnel, Stock, Surface or Radar Chart', icon: 'chWaterfall', types: ['waterfall', 'funnel', 'candlestick', 'radar', 'gauge', 'scorecard', 'timeline'] },
  { id: 'combo', label: 'Insert Combo Chart', icon: 'chCombo', types: ['combo'] },
];

export function chartMenus(): typeof CHART_MENUS {
  return CHART_MENUS;
}

export class RibbonHost {
  private lastKind: BorderKind = 'bottom';
  private line = 'thin';
  private lineColor = '000000';
  private readonly last: Record<'fc' | 'bg', string> = { fc: '#ff0000', bg: '#ffff00' };

  constructor(private readonly grid: Grid, private readonly hooks: HostHooks) {
    try {
      const raw = JSON.parse(localStorage.getItem('formcel.ribbon.colors') ?? '{}') as Partial<Record<'fc' | 'bg', string>>;
      if (raw.fc) this.last.fc = raw.fc;
      if (raw.bg) this.last.bg = raw.bg;
    } catch { return; }
  }

  run(id: string, anchor?: HTMLElement | null): void {
    this.hooks.run(id, anchor);
  }

  copy(): void {
    this.grid.focus();
    document.execCommand('copy');
  }

  cut(): void {
    this.grid.focus();
    document.execCommand('cut');
  }

  paste(): void {
    const g = this.grid;
    g.focus();
    if (g.canPasteSpecial()) {
      void g.pasteSpecial('all');
      return;
    }
    const cb = navigator.clipboard;
    if (!cb?.readText) { this.hooks.say('Press Ctrl+V to paste.'); return; }
    void cb.readText().then((text) => {
      if (!text) return;
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      g.focus();
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, () => this.hooks.say('Press Ctrl+V to paste.'));
  }

  pasteMenu(): MItem[] {
    return [
      { label: 'Paste', run: () => this.paste() },
      { label: 'Paste Special...', cmd: 'edit.paste-special' },
      { label: 'Paste Special Options...', cmd: 'edit.paste-ops' },
    ];
  }

  sizeMenu(): MItem[] {
    const cur = this.grid.activeStyle().size ?? 10;
    return SIZE_PRESETS.map((n) => ({ label: String(n), checked: n === cur, run: () => this.setSize(n) }));
  }

  fontPicker(anchor: HTMLElement, input?: HTMLInputElement): { filter(q: string): void; pickActive(): boolean; close(): void } {
    return openFontPicker({
      anchor,
      current: this.grid.activeStyle().font ?? '',
      theme: () => this.grid.look,
      used: () => this.grid.usedFonts(),
      defaultLabel: `${this.grid.look.body} (default)`,
      filterInput: input,
      onPick: (name) => this.setFont(name),
    });
  }

  setFont(name: string): void {
    const clean = name.trim().replace(/["\\]/g, '');
    void this.grid.styleSelection(clean ? `ff:${clean}` : 'ff:').then(() => this.grid.focus());
  }

  setSize(n: number): void {
    if (!Number.isFinite(n) || n < 1 || n > 409) return;
    void this.grid.styleSelection(n === 10 ? 'sz:' : `sz:${n}`).then(() => this.grid.focus());
  }

  stepSize(dir: 1 | -1): void {
    const cur = this.grid.activeStyle().size ?? 10;
    this.setSize(stepSize(cur, dir));
  }

  palette(kind: 'fc' | 'bg'): Palette {
    const g = this.grid;
    const c = g.look.colors;
    const theme = [c[1], c[0], c[3], c[2], c[4], c[5], c[6], c[7], c[8], c[9]].map((h) => (h.startsWith('#') ? h : `#${h}`));
    return {
      theme,
      standard: STANDARD,
      current: g.activeStyle()[kind] ?? '',
      none: kind === 'fc' ? 'Automatic' : 'No Fill',
      pick: (hex) => this.applyColor(kind, hex),
      pickTheme: (i) => {
        if (i < 2) { this.applyColor(kind, theme[i]); return; }
        void g.styleSelection(`${kind}:t:${SLOTS[i - 2]}`).then(() => g.focus());
      },
    };
  }

  colorMenu(kind: 'fc' | 'bg'): MItem[] {
    return [{ palette: this.palette(kind) }];
  }

  applyColor(kind: 'fc' | 'bg', hex: string): void {
    if (hex) {
      this.last[kind] = hex;
      try { localStorage.setItem('formcel.ribbon.colors', JSON.stringify(this.last)); } catch { return; }
      this.paintSwatches();
    }
    void this.grid.styleSelection(`${kind}:${hex.replace('#', '')}`).then(() => this.grid.focus());
  }

  applyLast(kind: 'fc' | 'bg'): void {
    this.applyColor(kind, this.last[kind]);
  }

  paintSwatches(): void {
    rbState.swatch.set('format.text-color', this.last.fc);
    rbState.swatch.set('format.fill-color', this.last.bg);
    rbState.changed();
  }

  borderMenu(): MItem[] {
    const g = this.grid;
    const go = (kind: BorderKind, line = this.line): (() => void) => () => { this.lastKind = kind; void g.borders(kind, line, this.lineColor).then(() => g.focus()); };
    const lines: [string, string][] = [['thin', 'Thin'], ['medium', 'Medium'], ['thick', 'Thick'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double']];
    return [
      { label: 'Bottom Border', icon: 'bdBottom', run: go('bottom') },
      { label: 'Top Border', icon: 'bdTop', run: go('top') },
      { label: 'Left Border', icon: 'bdLeft', run: go('left') },
      { label: 'Right Border', icon: 'bdRight', run: go('right') },
      { sep: true },
      { label: 'No Border', icon: 'bdNone', cmd: 'format.no-border' },
      { label: 'All Borders', icon: 'bdAll', run: go('all') },
      { label: 'Outside Borders', icon: 'bdOutside', cmd: 'format.outline-border' },
      { label: 'Inside Borders', icon: 'bdInside', run: go('inside') },
      { sep: true },
      { label: 'Thick Outside Borders', icon: 'bdOutside', run: go('outside', 'thick') },
      { label: 'Double Bottom Border', icon: 'bdBottom', run: go('bottom', 'double') },
      { label: 'Thick Bottom Border', icon: 'bdBottom', run: go('bottom', 'thick') },
      { sep: true },
      { label: 'Line Color', icon: 'fillColor', sub: [{ palette: { theme: this.palette('fc').theme, standard: STANDARD, none: 'Automatic', pick: (hex) => { this.lineColor = hex ? hex.slice(1) : '000000'; } } }] },
      { label: 'Line Style', icon: 'borders', sub: lines.map(([k, l]) => ({ label: l, checked: k === this.line, run: () => { this.line = k; } })) },
    ];
  }

  applyBorder(): void {
    void this.grid.borders(this.lastKind, this.line, this.lineColor).then(() => this.grid.focus());
  }

  mergeMenu(): MItem[] {
    return [
      { label: 'Merge & Center', cmd: 'format.merge-center', icon: 'merge' },
      { label: 'Merge Across', cmd: 'format.merge-across', icon: 'mergeAcross' },
      { label: 'Merge Cells', cmd: 'format.merge-cells', icon: 'merge' },
      { label: 'Unmerge Cells', cmd: 'format.unmerge', icon: 'unmerge' },
    ];
  }

  numberFormatName(): Promise<string> {
    return this.grid.formatAtActive().then((code) => NUM_NAMES.find(([c]) => c === code)?.[1] ?? 'Custom');
  }

  numberMenu(): MItem[] {
    const ids = ['general', 'number', 'currency', 'accounting', 'date-short', 'date-long', 'time', 'percent', 'fraction', 'scientific', 'text'];
    const icons: Record<string, string> = { general: 'numGeneral', number: 'numFormat', currency: 'numCurrency', accounting: 'numAccounting', 'date-short': 'numDate', 'date-long': 'numDate', time: 'clock', percent: 'numPercent', fraction: 'numFraction', scientific: 'numSci', text: 'numText' };
    const labels: Record<string, string> = { general: 'General', number: 'Number', currency: 'Currency', accounting: 'Accounting', 'date-short': 'Short Date', 'date-long': 'Long Date', time: 'Time', percent: 'Percentage', fraction: 'Fraction', scientific: 'Scientific', text: 'Text' };
    return [
      ...ids.map((id): MItem => ({ label: labels[id], cmd: `format.${id}`, icon: icons[id] })),
      { sep: true },
      { label: 'More Number Formats...', cmd: 'format.number-dialog', icon: 'numFormat' },
      { label: 'Custom Number Format...', cmd: 'format.custom', icon: 'numFormat' },
    ];
  }

  cfMenu(): MItem[] {
    const items = this.hooks.cfItems().filter((i): i is Extract<MenuItem, { label: string }> => 'label' in i);
    const conv = (i: Extract<MenuItem, { label: string }>): MItem => ({ label: i.label, danger: i.danger, run: () => void i.run() });
    const pick = (test: (l: string) => boolean): MItem[] => items.filter((i) => test(i.label)).map(conv);
    const highlight = pick((l) => /^(Greater|Less|Between|Equal|Text that|A date|Duplicate)/.test(l));
    const unique = pick((l) => l.startsWith('Unique'));
    const top = pick((l) => /^(Top |Bottom |Above|Below)/.test(l));
    const bars = pick((l) => l.startsWith('Data bars')).map((i) => ({ ...i, icon: 'cfBars' } as MItem));
    const scales = pick((l) => l.startsWith('Colour scale')).map((i) => ({ ...i, icon: 'cfScale' } as MItem));
    const icons = pick((l) => l.startsWith('Icons')).map((i) => ({ ...i, icon: 'cfIcons' } as MItem));
    const clear = pick((l) => l.startsWith('Clear rules'));
    return [
      { label: 'Highlight Cells Rules', icon: 'cfHighlight', sub: [...highlight, ...unique] },
      { label: 'Top/Bottom Rules', icon: 'cfTop', sub: top },
      { label: 'Data Bars', icon: 'cfBars', sub: bars },
      { label: 'Color Scales', icon: 'cfScale', sub: scales },
      { label: 'Icon Sets', icon: 'cfIcons', sub: icons },
      { sep: true },
      ...pick((l) => l.startsWith('New rule')).map((i) => ({ ...i, icon: 'plus' } as MItem)),
      { label: 'Clear Rules', icon: 'clearFormat', sub: clear },
      ...pick((l) => l.startsWith('Manage')).map((i) => ({ ...i, icon: 'cfManage' } as MItem)),
    ];
  }

  private themeColor(slot: string): string {
    const c = this.grid.look.colors;
    const h = c[THEME_KEYS.indexOf(slot)] ?? '#000000';
    return h.startsWith('#') ? h : `#${h}`;
  }

  private styleTile(name: string, parts: string, current: boolean): Tile {
    let fg = '', bg = '', bold = false, size = 0;
    let border = '';
    for (const p of parts.split(';')) {
      if (p === 'b') bold = true;
      else if (p.startsWith('fc:')) fg = p.startsWith('fc:t:') ? this.themeColor(p.slice(5)) : `#${p.slice(3)}`;
      else if (p.startsWith('bg:')) bg = p.startsWith('bg:t:') ? this.themeColor(p.slice(5)) : `#${p.slice(3)}`;
      else if (p.startsWith('sz:')) size = Number(p.slice(3));
      else if (p.startsWith('bb:') && !border) border = p.includes(':t:') ? this.themeColor(p.split(':t:')[1].split(':')[0]) : `#${p.split(':')[2]}`;
      else if (p.startsWith('br:') && !border) border = `#${p.split(':')[2]}`;
    }
    const style = [fg && `color:${fg}`, bg && `background:${bg}`, bold && 'font-weight:700', size && `font-size:${Math.min(15, Math.max(10, size - 2))}px`, border && `box-shadow:inset 0 -2px 0 ${border}`].filter(Boolean).join(';');
    return { label: name, current, html: `<span class="rb-sty" style="${escapeHtml(style)}">${escapeHtml(name)}</span>`, title: name, run: () => void this.grid.applyNamed(name).then(() => this.grid.focus()) };
  }

  async stylesMenu(): Promise<MItem[]> {
    const lines = (await engine().namedStyles(this.hooks.book())).map((l) => l.split('\t'));
    const by = new Map(lines.map((l) => [l[0], l]));
    const current = this.grid.activeStyle().cs ?? 'Normal';
    const section = (head: string, names: string[]): MItem[] => {
      const tiles = names.filter((n) => by.has(n)).map((n) => this.styleTile(n, by.get(n)?.[1] ?? '', n === current));
      return tiles.length ? [{ head }, { tiles, cols: 4, wide: true }] : [];
    };
    const known = new Set<string>();
    const take = (names: string[]): string[] => { names.forEach((n) => known.add(n)); return names; };
    const out: MItem[] = [
      ...section('Good, Bad and Neutral', take(['Normal', 'Bad', 'Good', 'Neutral'])),
      ...section('Data and Model', take(['Calculation', 'Input', 'Output', 'Warning Text', 'Note'])),
      ...section('Titles and Headings', take(['Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Title', 'Total'])),
      ...section('Themed Cell Styles', take(['Accent 1', 'Accent 2', 'Accent 3', 'Accent 4', 'Accent 5', 'Accent 6'])),
      ...section('Number Format', take(['Comma', 'Currency', 'Percent'])),
    ];
    const custom = lines.map((l) => l[0]).filter((n) => !known.has(n));
    if (custom.length) out.push(...section('Custom', custom));
    out.push({ sep: true }, { label: 'New Cell Style...', icon: 'plus', run: () => this.hooks.styleBox('') });
    if (current !== 'Normal') out.push({ label: `Update ${current} to Match Selection`, run: () => this.hooks.styleBox(current) });
    return out;
  }

  themesMenu(): MItem[] {
    const g = this.grid;
    return g.themeNames.map((n) => ({ label: n, icon: 'theme', checked: n === g.look.name, run: () => void g.setTheme(n).then(() => g.focus()) }));
  }

  private tableTile(id: string, label: string): string {
    const m = /^TableStyle(Light|Medium|Dark)(\d+)$/.exec(id);
    const accents = [4, 5, 6, 7, 8, 9].map((i) => this.grid.look.colors[i]).map((h) => (h.startsWith('#') ? h : `#${h}`));
    if (!m) return `<span class="rb-ts" style="--h:transparent;--b:transparent;--l:var(--border-light)"><i></i><i></i><i></i></span>`;
    const n = Number(m[2]);
    const idx = (n - 1) % 7;
    const base = idx === 0 ? '#595959' : accents[idx - 1];
    void label;
    if (m[1] === 'Light') return `<span class="rb-ts" style="--h:transparent;--b:color-mix(in srgb, ${base} 18%, transparent);--l:${base};--t:${base}"><i></i><i></i><i></i></span>`;
    if (m[1] === 'Medium') return `<span class="rb-ts" style="--h:${base};--b:color-mix(in srgb, ${base} 28%, transparent);--l:${base};--t:#fff"><i></i><i></i><i></i></span>`;
    return `<span class="rb-ts" style="--h:#222;--b:color-mix(in srgb, ${base} 55%, #222);--l:${base};--t:#fff"><i></i><i></i><i></i></span>`;
  }

  tableTiles(): Tile[] {
    const t = this.grid.activeTable();
    return TABLE_STYLES.map(([id, label]) => ({ label, title: label, html: this.tableTile(id, label), current: t?.style === id, run: () => void this.applyTableStyle(id) }));
  }

  async applyTableStyle(id: string): Promise<void> {
    const g = this.grid;
    let t = g.activeTable();
    if (!t) {
      const { range, header } = await g.sortTarget();
      await g.createTable(range, header);
      t = g.activeTable();
    }
    if (!t) return;
    const parts = t.line.split('\t').slice(1);
    parts[3] = id;
    await g.setTable(t.name, parts.join('\t'));
    g.focus();
  }

  tableStylesMenu(): MItem[] {
    const tiles = this.tableTiles();
    const pick = (prefix: string): Tile[] => tiles.filter((_x, i) => TABLE_STYLES[i][0].startsWith(prefix));
    return [
      { head: 'Light' }, { tiles: pick('TableStyleLight'), cols: 7, wide: true },
      { head: 'Medium' }, { tiles: pick('TableStyleMedium'), cols: 7, wide: true },
      { head: 'Dark' }, { tiles: pick('TableStyleDark'), cols: 7, wide: true },
      { sep: true },
      { label: 'No Style', run: () => void this.applyTableStyle('None') },
      { label: 'Table Design...', cmd: 'table.create' },
    ];
  }

  chartMenu(id: string): MItem[] {
    const spec = CHART_MENUS.find((m) => m.id === id);
    if (!spec) return [];
    const tiles: Tile[] = spec.types.map((t) => ({ label: CHART_TYPES.find((c) => c.id === t)?.label ?? t, icon: CHART_ICON[t] ?? 'chart', run: () => void this.insertChart(t) }));
    return [{ head: spec.label.replace('Insert ', '') }, { tiles, cols: Math.min(3, tiles.length), wide: false }, { sep: true }, { label: 'More Charts...', cmd: 'insert.chart', icon: 'chart' }];
  }

  mapMenu(): MItem[] {
    return [{ tiles: [{ label: 'Filled Map', icon: 'chMap', run: () => void this.insertChart('map') }], cols: 1 }];
  }

  async insertChart(type: string): Promise<void> {
    if (!this.hooks.open()) return;
    const g = this.grid;
    const s = g.selection();
    let r = s;
    if (s.r0 === s.r1 && s.c0 === s.c1) {
      const [row, col] = g.activeCell();
      const { area } = await engine().region(this.hooks.book(), g.sheetIndex, row, col);
      r = { r0: area[0], c0: area[1], r1: area[2], c1: area[3] };
    }
    document.dispatchEvent(new CustomEvent('fc-ai-chart', { detail: { type, range: rangeLabel(r), title: '', byRows: false } }));
    g.focus();
  }

  autosumMenu(): MItem[] {
    const fn = (name: string, label: string): MItem => ({ label, run: () => void this.autosum(name) });
    return [fn('SUM', 'Sum'), fn('AVERAGE', 'Average'), fn('COUNT', 'Count Numbers'), fn('MAX', 'Max'), fn('MIN', 'Min'), { sep: true }, { label: 'More Functions...', cmd: 'formula.insert-function' }];
  }

  async autosum(name: string): Promise<void> {
    const g = this.grid;
    const s = g.selection();
    const book = this.hooks.book();
    if (s.r0 !== s.r1 || s.c0 !== s.c1) {
      g.startEdit(`=${name}(${rangeLabel(s)})`);
      return;
    }
    const [r, c] = g.activeCell();
    const vals = await engine().readValues(book, g.sheetIndex, Math.max(0, r - 200), c, Math.max(0, r - 1), c);
    const have = new Set(vals.filter(([, , v]) => v !== '' && !Number.isNaN(Number(String(v).replace(/,/g, '')))).map(([row]) => row));
    let top = r;
    while (top - 1 >= 0 && have.has(top - 1)) top--;
    if (top < r) {
      g.startEdit(`=${name}(${colName(c)}${top + 1}:${colName(c)}${r})`);
      return;
    }
    const left = await engine().readValues(book, g.sheetIndex, r, Math.max(0, c - 100), r, Math.max(0, c - 1));
    const haveCols = new Set(left.filter(([, , v]) => v !== '' && !Number.isNaN(Number(String(v).replace(/,/g, '')))).map(([, col]) => col));
    let first = c;
    while (first - 1 >= 0 && haveCols.has(first - 1)) first--;
    g.startEdit(first < c ? `=${name}(${colName(first)}${r + 1}:${colName(c - 1)}${r + 1})` : `=${name}()`);
  }

  functionMenu(...cats: string[]): MItem[] {
    const names = FUNCTIONS.filter((f) => f.kind === 'function' && cats.includes(f.category ?? 'Other')).map((f) => f.name).sort();
    const items: MItem[] = names.map((n) => ({ label: n, run: () => this.hooks.fnPick(n) }));
    return [...items, { sep: true }, { label: 'Insert Function...', cmd: 'formula.insert-function', icon: 'insertFn' }];
  }

  moreFunctions(): MItem[] {
    const groups: [string, string[]][] = [
      ['Statistical', ['Statistical']], ['Engineering', ['Engineering']], ['Information', ['Information', 'Info']], ['Database', ['Database']],
      ['Web', ['Web']], ['Compatibility', ['Compatibility']], ['Other', ['Other', 'Filter', 'Google', 'Operator']],
    ];
    return groups.map(([label, cats]): MItem => ({ label, icon: 'moreFn', sub: () => this.functionMenu(...cats) }));
  }

  recentMenu(): MItem[] {
    let list: string[] = [];
    try { const raw = JSON.parse(localStorage.getItem('fc-recent-functions') ?? '[]') as unknown; list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []; } catch { list = []; }
    const items: MItem[] = list.map((n) => ({ label: n, run: () => this.hooks.fnPick(n) }));
    return items.length ? items : [{ label: 'No functions used yet', disabled: true }];
  }

  symbolMenu(): MItem[] {
    const tiles: Tile[] = SYMBOLS.map((s) => ({ label: s, html: `<span class="rb-sym">${escapeHtml(s)}</span>`, title: `Insert ${s}`, run: () => this.insertText(s) }));
    return [{ tiles, cols: 7, wide: false }];
  }

  insertText(s: string): void {
    const a = document.activeElement;
    if (a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && a.type === 'text')) {
      document.execCommand('insertText', false, s);
      return;
    }
    this.grid.startEdit(this.hooks.formulaText() + s);
  }

  context(): { ids: string[]; labels: Record<string, string> } {
    const ids: string[] = [];
    const labels: Record<string, string> = {};
    if (!this.hooks.open()) return { ids, labels };
    if (this.grid.activeTable()) ids.push('tabledesign');
    if (this.hooks.inPivot()) ids.push('pivotanalyze', 'pivotdesign');
    const o = this.hooks.selectedObject();
    if (o?.kind === 'chart') ids.push('chartdesign', 'chartformat');
    else if (o?.kind === 'shape' || o?.kind === 'text') ids.push('shapeformat');
    else if (o?.kind === 'picture') ids.push('pictureformat');
    if (o?.kind === 'spark' || this.hooks.sparkHere()) ids.push('sparkline');
    return { ids, labels };
  }

  combo(kind: 'font' | 'size'): HTMLElement {
    const id = kind === 'font' ? 'format.font' : 'format.size';
    const node = el(`<div class="rb-combo is-${kind}"><input class="rb-combo-in" type="text" spellcheck="false" autocomplete="off" aria-label="${kind === 'font' ? 'Font' : 'Font Size'}"><button class="rb-combo-btn" type="button" tabindex="-1" aria-haspopup="menu" aria-label="${kind === 'font' ? 'Font list' : 'Font size list'}">${rbIcon('chevronDown', 10)}</button></div>`);
    const input = node.querySelector('input') as HTMLInputElement;
    const btn = node.querySelector('button') as HTMLButtonElement;
    const paint = (): void => {
      const v = rbState.text.get(id) ?? '';
      if (document.activeElement !== input && input.value !== v) input.value = v;
    };
    rbState.on(paint);
    paint();
    let picker: { filter(q: string): void; pickActive(): boolean; close(): void } | null = null;
    const showPicker = (): void => {
      if (!fontPickerOpen()) picker = this.fontPicker(node, input);
    };
    const commit = (): void => {
      const v = input.value.trim();
      if (kind === 'font') {
        if (picker && fontPickerOpen() && picker.pickActive()) return;
        closeFontPicker();
        this.setFont(v === 'Inter (default)' || v === `${this.grid.look.body} (default)` ? '' : v);
      } else this.setSize(Number(v));
    };
    if (kind === 'font') {
      input.addEventListener('input', () => { showPicker(); picker?.filter(input.value); });
      btn.addEventListener('click', () => {
        if (fontPickerOpen()) { closeFontPicker(); return; }
        showPicker();
        input.focus({ preventScroll: true });
      });
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
      else if (e.key === 'Escape') { e.stopPropagation(); closeFontPicker(); input.value = rbState.text.get(id) ?? ''; this.grid.focus(); }
      else if (kind === 'font' && e.key === 'ArrowDown' && !fontPickerOpen()) { e.preventDefault(); showPicker(); }
    });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('blur', () => paint());
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    return node;
  }

  numberBox(): HTMLElement {
    const node = el(`<div class="rb-combo is-num"><button class="rb-combo-main" type="button" aria-haspopup="menu" aria-label="Number Format" title="Number Format"><span class="rb-combo-t">General</span>${rbIcon('chevronDown', 10)}</button></div>`);
    const t = node.querySelector('.rb-combo-t') as HTMLElement;
    const paint = (): void => {
      const v = rbState.text.get('format.menu') ?? 'General';
      if (t.textContent !== v) t.textContent = v;
    };
    rbState.on(paint);
    paint();
    node.querySelector('button')?.addEventListener('mousedown', (e) => e.preventDefault());
    return node;
  }

  refreshState(): void {
    if (!this.hooks.open() || this.hooks.book() < 0) return;
    void this.numberFormatName().then((n) => {
      if (rbState.text.get('format.menu') !== n) { rbState.text.set('format.menu', n); rbState.changed(); }
    }, () => undefined);
    this.paintSwatches();
    const named = this.grid.activeStyle().font ?? this.grid.look.body;
    const font = named === 'Inter' ? 'Aptos Narrow' : named;
    rbState.text.set('format.font', font);
    rbState.text.set('format.size', String(this.grid.activeStyle().size ?? (this.grid.opts.defaultSize !== 10 ? this.grid.opts.defaultSize : 11)));
    rbState.changed();
  }
}
