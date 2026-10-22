import { RULES, type CalcMode } from '../engine/calc';
import { el, setText } from '../automation/dom';
import type { Grid } from '../grid/grid';
import { rebaseTheme, setTextSize, setTheme, textSize, theme, type TextSize, type ThemeName } from './a11y';
import { FAMILY_THEMES, familyThemeId, setFamilyTheme } from './family-themes';
import { applyAccent, applyGrid, applyRoot } from './apply';
import type { Calc } from './calc';
import { listCommands, registerCommand, runCommand } from './commands';
import { fontField } from './fontpicker';
import { buttonRow, colorRow, note, numberRow, selectRow, textRow, toggleRow, type Row } from './controls';
import { Dialog } from './dialog';
import { icon, type IconName } from './icons';
import { CHANGED, DEFAULT_AC, prefs, resetPrefs, updatePrefs, type Prefs } from './prefs';
import { assistantPanel, dictionaryPanel, extensionsPanel, externalPanel, folderPanel, lanPanel, pythonPanel, recoveryPanel, schedulerPanel, tokenPanel, type Panel } from './settings-engine';

export interface SettingsHost {
  grid: Grid;
  calc: Calc;
  locales: [string, string][];
  hasWorkbook(): boolean;
  locale(): string | null;
  setLocale(tag: string): Promise<void>;
  userName(): string;
  setUserName(name: string): void;
  autocomplete(): boolean;
  setAutocomplete(on: boolean): void;
  flashAuto(): boolean;
  setFlashAuto(on: boolean): void;
  pageBreaks(): boolean;
  say(text: string, bad?: boolean): void;
}

const ICONS: Record<string, IconName> = {
  General: 'pfGeneral',
  Formulas: 'pfFormulas',
  Data: 'pfData',
  Proofing: 'pfProofing',
  Save: 'pfSave',
  Language: 'pfLanguage',
  Accessibility: 'pfAccess',
  Advanced: 'pfAdvanced',
  'Customize Ribbon': 'pfRibbon',
  'Quick Access Toolbar': 'pfQat',
  'Add-ins': 'pfAddins',
  'Trust Center': 'pfTrust',
  'Assistant and Services': 'pfAssistant',
};

export const SECTIONS = Object.keys(ICONS);

const MODES: [CalcMode, string][] = [['auto', 'Automatic'], ['tables', 'Automatic except for data tables'], ['manual', 'Manual']];
const SIZES: [string, string][] = [8, 9, 10, 11, 12, 14, 16].map((n) => [String(n), String(n)]);
const RAIL_KEY = 'formcel.prefsRailCollapsed';

const summaries: Partial<Record<'ribbon' | 'qat', () => string>> = {};

export function setLayoutSummary(kind: 'ribbon' | 'qat', fn: () => string): void {
  summaries[kind] = fn;
}

function toolbarSummary(): string {
  const bar = document.querySelector('.fc-toolbar');
  if (!bar) return 'The toolbar is not showing.';
  const tools = bar.querySelectorAll('[data-cmd]').length;
  const groups = bar.querySelectorAll('.fc-tool-sep').length + 1;
  return `${tools} commands in ${groups} groups.`;
}

export class SettingsDialog extends Dialog {
  private readonly sections = new Map<string, HTMLElement>();
  private readonly nav = el('div', 'fc-prefs-nav');
  private readonly pages = el('div', 'fc-prefs-pages');
  private readonly syncs: (() => void)[] = [];
  private readonly panels: Panel[] = [];
  private readonly summaryRibbon = note('', true);
  private readonly summaryQat = note('', true);
  private readonly shell: { rail: HTMLElement; port: HTMLElement; shade: SVGPathElement; line: SVGPathElement };
  private current = '';
  private spyRaf = 0;
  private spyMuted = 0;
  private wireRaf = 0;
  private wireD = '';
  private portY = -1;
  private calcRows: Row<unknown>[] = [];
  private calcSync: (() => void) | null = null;

  constructor(private readonly host: SettingsHost) {
    super('Preferences');
    this.nav.setAttribute('role', 'tablist');
    this.nav.setAttribute('aria-label', 'Preference sections');
    this.frame.classList.add('fc-prefs-dlg');
    this.head.prepend(el('span', 'fc-prefs-headicon', icon('settings')));
    this.build();
    const wrap = el('div', 'fc-prefs');
    wrap.append(this.pages);
    this.body.appendChild(wrap);
    let collapsed = false;
    try {
      collapsed = localStorage.getItem(RAIL_KEY) === '1';
    } catch {
      collapsed = false;
    }
    const fold = el('button', 'fc-prefs-fold', icon('pfFold')) as HTMLButtonElement;
    fold.type = 'button';
    const paintRail = (): void => {
      this.frame.classList.toggle('is-rail-collapsed', collapsed);
      fold.title = collapsed ? 'Expand tabs' : 'Collapse tabs';
      fold.setAttribute('aria-label', fold.title);
      fold.setAttribute('aria-expanded', String(!collapsed));
    };
    fold.addEventListener('click', () => {
      collapsed = !collapsed;
      try {
        localStorage.setItem(RAIL_KEY, collapsed ? '1' : '0');
      } catch {
        paintRail();
      }
      paintRail();
      this.queueWire();
    });
    paintRail();
    const rail = el('div', 'fc-prefs-rail');
    rail.append(this.nav, fold);
    const wire = el('div', '', '<svg class="fc-prefs-wire" aria-hidden="true"><path class="fc-prefs-wire-shade"></path><path class="fc-prefs-wire-line"></path></svg>').firstElementChild as SVGSVGElement;
    const port = el('span', 'fc-prefs-port');
    port.setAttribute('aria-hidden', 'true');
    this.frame.append(rail, wire, port);
    this.shell = { rail, port, shade: wire.querySelector<SVGPathElement>('.fc-prefs-wire-shade')!, line: wire.querySelector<SVGPathElement>('.fc-prefs-wire-line')! };
    this.pages.addEventListener('scroll', () => this.queueSpy(), { passive: true });
    new ResizeObserver(() => this.queueWire()).observe(this.frame);
    window.addEventListener('resize', () => this.queueWire());
    this.button('Done', 'primary', () => this.close());
    this.onClose = () => this.host.grid.focus();
  }

  private change(patch: Partial<Prefs>): void {
    updatePrefs(patch);
  }

  private reg<T>(row: Row<T>, get: () => T): HTMLElement {
    this.syncs.push(() => row.set(get()));
    return row.el;
  }

  private grp(label: string, ...content: HTMLElement[]): HTMLElement {
    const g = el('section', 'fc-prefs-group');
    g.append(el('h3', 'fc-prefs-label', label), ...content);
    return g;
  }

  private cols(...content: HTMLElement[]): HTMLElement {
    const c = el('div', 'fc-prefs-cols');
    c.append(...content);
    return c;
  }

  private add(name: string, ...content: HTMLElement[]): void {
    const ic = ICONS[name];
    const tab = el('button', 'fc-prefs-railtab', `<span class="fc-prefs-tabicon">${icon(ic)}</span><span class="fc-prefs-tablabel"></span>`) as HTMLButtonElement;
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.dataset.section = name;
    setText(tab.querySelector('.fc-prefs-tablabel')!, name);
    tab.title = name;
    tab.addEventListener('click', () => this.showSection(name, 'smooth'));
    this.nav.appendChild(tab);
    const page = el('section', 'fc-prefs-page fc-prefs-sec', `<button class="fc-prefs-sechead" type="button" aria-expanded="true"><span class="fc-prefs-secicon">${icon(ic)}</span><span class="fc-prefs-seclabel"></span><span class="fc-prefs-chev">${icon('chevronDown')}</span></button><div class="fc-prefs-secbody"></div>`);
    page.setAttribute('role', 'tabpanel');
    page.dataset.section = name;
    setText(page.querySelector('.fc-prefs-seclabel')!, name);
    page.querySelector('.fc-prefs-sechead')!.addEventListener('click', () => this.foldSection(name));
    page.querySelector('.fc-prefs-secbody')!.append(...content);
    this.pages.appendChild(page);
    this.sections.set(name, page);
  }

  private panel<P extends Panel>(p: P): HTMLElement {
    this.panels.push(p);
    return p.el;
  }

  private build(): void {
    this.add('General', ...this.general());
    this.add('Formulas', ...this.formulas());
    this.add('Data', ...this.data());
    this.add('Proofing', ...this.proofing());
    this.add('Save', ...this.save());
    this.add('Language', ...this.language());
    this.add('Accessibility', ...this.accessibility());
    this.add('Advanced', ...this.advanced());
    this.add('Customize Ribbon', ...this.customize());
    this.add('Quick Access Toolbar', ...this.qat());
    this.add('Add-ins', ...this.addins());
    this.add('Trust Center', ...this.trust());
    this.add('Assistant and Services', ...this.services());
  }

  private general(): HTMLElement[] {
    const name = textRow('User name', (v) => {
      const t = v.trim().slice(0, 60);
      if (t) this.host.setUserName(t);
    });
    const font = fontField('Default font for new sheets', 'Aptos Narrow (default)', (v) => this.change({ defaultFont: v }), { theme: () => ({ heading: 'Aptos Narrow', body: 'Aptos Narrow' }), used: () => [] });
    const size = selectRow('Default font size', SIZES, (v) => this.change({ defaultSize: Number(v) }));
    const view = selectRow('Default view for new sheets', [['normal', 'Normal'], ['pagebreak', 'Page Break Preview']], (v) => this.change({ defaultView: v as Prefs['defaultView'] }));
    const sheets = numberRow('Sheets in a new workbook', 1, 50, 1, (v) => this.change({ newSheets: Math.round(v) }));
    const start = toggleRow('Show the Home screen when FormCel starts', (v) => this.change({ startScreen: v }));
    const themeRow = selectRow('Theme', [['dark', 'Form family theme'], ['light', 'Light, like Excel'], ['contrast', 'High contrast']], (v) => {
      setTheme(v as ThemeName);
      applyAccent();
    });
    const familyRow = selectRow('Family theme', FAMILY_THEMES.map(([id, label]) => [id, label] as const), (v) => {
      setTheme('dark');
      setFamilyTheme(v);
      rebaseTheme();
      applyAccent();
      themeRow.set('dark');
    });
    const accent = colorRow('Accent colour', (v) => this.change({ accent: v }), '#f97316');
    const density = selectRow('Density', [['', 'Standard'], ['compact', 'Compact'], ['comfortable', 'Comfortable']], (v) => this.change({ density: v as Prefs['density'] }));
    const reset = buttonRow('Reset every preference', 'Reset All Preferences...', () => undefined, 'danger');
    let armed = 0;
    reset.button.addEventListener('click', () => {
      if (!armed) {
        setText(reset.button, 'Click again to reset and reload');
        armed = window.setTimeout(() => {
          armed = 0;
          setText(reset.button, 'Reset All Preferences...');
        }, 4000);
        return;
      }
      window.clearTimeout(armed);
      resetPrefs();
      location.reload();
    });
    this.syncs.push(() => name.set(this.host.userName()));
    return [
      this.grp('User', name.el),
      this.grp('New workbooks', this.reg(font, () => prefs().defaultFont), this.reg(size, () => String(prefs().defaultSize)), this.reg(view, () => prefs().defaultView), this.reg(sheets, () => prefs().newSheets), note('The font and size set how cells without their own font are drawn. A workbook opened in Page Break Preview shows its printed pages from the start.')),
      this.grp('Startup', this.reg(start, () => prefs().startScreen), note('When off, FormCel opens the workbook you used last, or a new blank one.')),
      this.grp('Appearance', this.reg(themeRow, () => theme()), this.reg(familyRow, () => familyThemeId()), this.reg(accent, () => prefs().accent), this.reg(density, () => prefs().density), note('The family theme is shared by every Form app on this computer. The light and high contrast themes bring their own accent colour.')),
      this.grp('Reset', reset.el, note('Preferences, the theme, text size, your shortcuts and remembered dialog positions go back to how FormCel comes. Workbooks are kept.')),
    ];
  }

  private formulas(): HTMLElement[] {
    const c = this.host.calc;
    const mode = selectRow('Workbook calculation', MODES, (v) => void c.apply({ mode: v }));
    const iter = toggleRow('Enable iterative calculation', (v) => void c.apply({ iterate: v ? 1 : 0 }));
    const count = numberRow('Maximum iterations', 1, 32767, 1, (v) => void c.apply({ iterations: Math.round(v) }));
    const delta = numberRow('Maximum change', 0, 1000000, 0.0001, (v) => void c.apply({ delta: v }));
    const r1c1 = toggleRow('R1C1 reference style', (v) => void c.apply({ style: v ? 'r1c1' : 'a1' }));
    const threads = selectRow('Calculation threads', [['0', 'Use all processors'], ['1', '1 thread'], ['2', '2 threads'], ['4', '4 threads'], ['8', '8 threads']], (v) => void c.apply({ threads: Number(v) }));
    const auto = toggleRow('Formula AutoComplete', (v) => {
      this.host.setAutocomplete(v);
    });
    const background = toggleRow('Enable background error checking', (v) => void c.apply({ rules: v ? 383 : 0 }));
    const rules = RULES.map(([bit, label]) => toggleRow(label, (v) => void c.apply({ rules: v ? c.current.rules | bit : c.current.rules & ~bit })));
    this.calcRows = [mode, iter, count, delta, r1c1, threads, background, ...rules];
    this.calcSync = () => {
      const s = c.current;
      const off = !this.host.hasWorkbook();
      mode.set(s.mode);
      iter.set(s.iterate);
      count.set(s.iterations);
      delta.set(s.delta);
      r1c1.set(s.style === 'r1c1');
      threads.set(String(s.threads));
      background.set(s.rules !== 0);
      RULES.forEach(([bit], i) => {
        rules[i].set((s.rules & bit) !== 0);
        rules[i].disable?.(off || s.rules === 0);
      });
      for (const r of this.calcRows) r.disable?.(off);
      hint.hidden = !off;
    };
    this.syncs.push(() => auto.set(this.host.autocomplete()));
    const hint = note('Open a workbook to change these: calculation settings are saved with each workbook.');
    return [
      this.grp('Calculation options', hint, mode.el, iter.el, this.cols(count.el, delta.el), threads.el, r1c1.el, note('The window calculates on one thread. The thread count applies to saving, exports and the engine process.')),
      this.grp('Working with formulas', this.reg(auto, () => this.host.autocomplete())),
      this.grp('Error checking', background.el, ...rules.map((r) => r.el), buttonRow('Ignored errors', 'Reset Ignored Errors', () => void c.run('resetignore')).el),
    ];
  }

  private data(): HTMLElement[] {
    const rows = toggleRow('Grand totals for rows', (v) => this.change({ pivotGrandRows: v }));
    const cols = toggleRow('Grand totals for columns', (v) => this.change({ pivotGrandCols: v }));
    const sub = toggleRow('Subtotals', (v) => this.change({ pivotSubtotals: v }));
    const auto = toggleRow('Refresh when the source changes', (v) => this.change({ pivotAuto: v }));
    const convert = toggleRow('Convert numbers, dates and times in imported text files', (v) => this.change({ importConvert: v }));
    const wizard = toggleRow('Show the text import options when opening .csv, .tsv and .txt files', (v) => this.change({ importWizard: v }));
    const limit = numberRow('Maximum rows to import from a text file', 1000, 1048576, 1000, (v) => this.change({ importMaxRows: Math.round(v) }));
    return [
      this.grp('Default PivotTable layout', this.reg(rows, () => prefs().pivotGrandRows), this.reg(cols, () => prefs().pivotGrandCols), this.reg(sub, () => prefs().pivotSubtotals), this.reg(auto, () => prefs().pivotAuto), note('These are the starting options of each new PivotTable. Change one later from its own settings.')),
      this.grp('Data import', this.reg(convert, () => prefs().importConvert), this.reg(wizard, () => prefs().importWizard), this.reg(limit, () => prefs().importMaxRows), note('With conversion off, every column is read as text, so 00123 and long numbers stay exactly as written. With the options off, files open straight away with a guessed delimiter.')),
    ];
  }

  private proofing(): HTMLElement[] {
    const as = toggleRow('Check spelling as you type in a cell', (v) => this.change({ spellAsYouType: v }));
    const lang = selectRow('Dictionary language', [['en-US', 'English (United States)']], (v) => this.change({ spellLanguage: v }));
    const replace = toggleRow('Replace text as you type', (v) => this.change({ acReplace: v }));
    const sentence = toggleRow('Capitalize the first letter of sentences', (v) => this.change({ acSentence: v }));
    const initials = toggleRow('Correct TWo INitial CApitals', (v) => this.change({ acInitials: v }));
    const days = toggleRow('Capitalize names of days', (v) => this.change({ acDays: v }));
    const quotes = toggleRow('Replace straight quotes with smart quotes', (v) => this.change({ acQuotes: v }));
    const list = el('div', 'fc-auto-list');
    const from = textRow('Replace', () => undefined);
    const to = textRow('With', () => undefined);
    const addBtn = el('button', 'fc-btn', 'Add') as HTMLButtonElement;
    const restore = el('button', 'fc-btn fc-btn-ghost', 'Restore defaults') as HTMLButtonElement;
    const bar = el('div', 'fc-row-actions');
    bar.append(addBtn, restore);
    const paint = (): void => {
      const items = prefs().acList;
      list.replaceChildren(
        ...(items.length
          ? items.map(([a, b], i) => {
              const item = el('div', 'fc-auto-item');
              const label = el('span', 'fc-grow');
              label.textContent = `${a}  →  ${b}`;
              const rm = el('button', 'fc-btn', 'Remove') as HTMLButtonElement;
              rm.type = 'button';
              rm.dataset.at = String(i);
              item.append(label, rm);
              return item;
            })
          : [note('No replacements.')]),
      );
    };
    list.addEventListener('click', (e) => {
      const at = (e.target as HTMLElement).closest<HTMLElement>('[data-at]')?.dataset.at;
      if (at === undefined) return;
      this.change({ acList: prefs().acList.filter((_, i) => i !== Number(at)) });
      paint();
    });
    addBtn.addEventListener('click', () => {
      const a = from.input.value;
      if (!a) return;
      this.change({ acList: [...prefs().acList.filter(([x]) => x !== a), [a, to.input.value]] });
      from.input.value = '';
      to.input.value = '';
      paint();
    });
    restore.addEventListener('click', () => {
      this.change({ acList: DEFAULT_AC.map((p) => [...p] as [string, string]) });
      paint();
    });
    this.syncs.push(paint);
    return [
      this.grp('Spelling', this.reg(as, () => prefs().spellAsYouType), this.reg(lang, () => prefs().spellLanguage), note('The browser underlines misspellings while you type. Review checks a whole sheet and uses your dictionary.')),
      this.grp('User dictionary', this.panel(dictionaryPanel())),
      this.grp('AutoCorrect options', this.reg(replace, () => prefs().acReplace), this.reg(sentence, () => prefs().acSentence), this.reg(initials, () => prefs().acInitials), this.reg(days, () => prefs().acDays), this.reg(quotes, () => prefs().acQuotes), note('Applies to text you type into cells. Formulas and numbers are left alone.')),
      this.grp('Replacements', list, this.cols(from.el, to.el), bar),
    ];
  }

  private save(): HTMLElement[] {
    const delay = selectRow('Save changes to the engine after', [['0.4', 'A moment (0.4 s)'], ['2', '2 seconds'], ['10', '10 seconds'], ['30', '30 seconds'], ['60', '1 minute']], (v) => this.change({ autosaveSeconds: Number(v) }));
    const format = selectRow('Save a copy in this format by default', [['fcel', 'FormCel Workbook (.fcel)'], ['xlsx', 'Excel Workbook (.xlsx)']], (v) => this.change({ defaultFormat: v as Prefs['defaultFormat'] }));
    return [
      this.grp('Autosave', this.reg(delay, () => String(prefs().autosaveSeconds)), note('FormCel saves as you work. This is how long it waits after an edit before sending it to the engine; edits are also sent when you leave the page.')),
      this.grp('Formats', this.reg(format, () => prefs().defaultFormat), note('Download uses this format when you run Save a Copy (Download in the default format).')),
      this.grp('Recovery', this.panel(recoveryPanel()), note('Changes made while the engine process is unreachable are kept on this computer and sent when it returns.')),
      this.grp('Default folder', this.panel(folderPanel())),
    ];
  }

  private language(): HTMLElement[] {
    const loc = selectRow('Spreadsheet locale of this workbook', this.host.locales, (v) => void this.host.setLocale(v));
    this.syncs.push(() => {
      loc.set(this.host.locale() ?? 'en-US');
      loc.disable?.(!this.host.hasWorkbook());
    });
    const shown = textRow('Display language', () => undefined);
    shown.input.value = 'English';
    shown.input.readOnly = true;
    return [
      this.grp('Display', shown.el, note('The interface is in English. More languages ship as translation tables.')),
      this.grp('Editing', loc.el, note('The locale sets list separators, decimal marks, date order and function name spelling for this workbook. Changing it reopens the workbook.')),
    ];
  }

  private accessibility(): HTMLElement[] {
    const size = selectRow('Text size', [['normal', 'Normal'], ['large', 'Large'], ['xlarge', 'Extra large']], (v) => setTextSize(v as TextSize));
    const motion = toggleRow('Reduce motion', (v) => this.change({ reduceMotion: v }));
    const check = buttonRow('Look for problems others may have reading this workbook', 'Check Accessibility', () => void runCommand('a11y.check'));
    const keys = buttonRow('See and change keyboard shortcuts', 'Keyboard Shortcuts', () => void runCommand('a11y.shortcuts'));
    return [
      this.grp('Display', this.reg(size, () => textSize()), this.reg(motion, () => prefs().reduceMotion), note('Choose the High contrast theme under General. Reduce motion also follows your system setting.')),
      this.grp('Tools', check.el, keys.el, note('The grid is exposed to screen readers with row and column headings, and changes are announced.')),
    ];
  }

  private advanced(): HTMLElement[] {
    const enter = toggleRow('After pressing Enter, move selection', (v) => this.change({ enterMove: v }));
    const dir = selectRow('Direction', [['down', 'Down'], ['right', 'Right'], ['up', 'Up'], ['left', 'Left']], (v) => this.change({ enterDir: v as Prefs['enterDir'] }));
    const decimal = toggleRow('Automatically insert a decimal point', (v) => this.change({ autoDecimal: v }));
    const places = numberRow('Places', 1, 8, 1, (v) => this.change({ decimals: Math.round(v) }));
    const fill = toggleRow('Enable fill handle', (v) => this.change({ fillHandle: v }));
    const drag = toggleRow('Allow drag and drop of cells', (v) => this.change({ dragDrop: v }));
    const inCell = toggleRow('Allow editing directly in cells', (v) => this.change({ editInCell: v }));
    const ac = toggleRow('Enable AutoComplete for cell values', (v) => this.host.setAutocomplete(v));
    const flash = toggleRow('Automatically Flash Fill', (v) => this.host.setFlashAuto(v));
    const bar = toggleRow('Show the formula bar', (v) => this.change({ showFormulaBar: v }));
    const status = toggleRow('Show the status bar', (v) => this.change({ showStatusBar: v }));
    const lines = toggleRow('Show gridlines', (v) => this.change({ gridlines: v }));
    const lineColor = colorRow('Gridline colour', (v) => this.change({ gridColor: v }), '#5e5e60');
    const breaks = toggleRow('Show page breaks', (v) => {
      if (v !== this.host.pageBreaks()) void runCommand('page.preview');
    });
    this.syncs.push(() => {
      ac.set(this.host.autocomplete());
      flash.set(this.host.flashAuto());
      breaks.set(this.host.pageBreaks());
      breaks.disable?.(!this.host.hasWorkbook());
    });
    return [
      this.grp('Editing options', this.reg(enter, () => prefs().enterMove), this.reg(dir, () => prefs().enterDir), this.reg(decimal, () => prefs().autoDecimal), this.reg(places, () => prefs().decimals), this.reg(fill, () => prefs().fillHandle), this.reg(drag, () => prefs().dragDrop), this.reg(inCell, () => prefs().editInCell), ac.el, flash.el, note('Shift+Enter moves the other way. With automatic decimals on, typing 1234 enters 12.34. When editing in cells is off, double-click and F2 edit in the formula bar.')),
      this.grp('Display options', this.reg(bar, () => prefs().showFormulaBar), this.reg(status, () => prefs().showStatusBar), this.reg(lines, () => prefs().gridlines), this.reg(lineColor, () => prefs().gridColor), breaks.el),
    ];
  }

  private customize(): HTMLElement[] {
    const open = buttonRow('Rearrange tabs, groups and commands', 'Customize the Ribbon...', () => void this.openCommand('ribbon.customize'));
    this.syncs.push(() => {
      open.button.disabled = !listCommands().some((c) => c.id === 'ribbon.customize');
      setText(this.summaryRibbon, (summaries.ribbon ?? toolbarSummary)());
    });
    return [this.grp('Current layout', this.summaryRibbon, open.el)];
  }

  private qat(): HTMLElement[] {
    const open = buttonRow('Choose the commands that are always one click away', 'Customize Quick Access Toolbar...', () => void this.openCommand('qat.customize'));
    this.syncs.push(() => {
      open.button.disabled = !listCommands().some((c) => c.id === 'qat.customize');
      setText(this.summaryQat, (summaries.qat ?? (() => 'The Quick Access Toolbar is not showing yet.'))());
    });
    return [this.grp('Current commands', this.summaryQat, open.el)];
  }

  private async openCommand(id: string): Promise<void> {
    this.close();
    await runCommand(id);
  }

  private addins(): HTMLElement[] {
    const scripts = buttonRow('Write, record and run scripts and custom functions', 'Open Scripts', () => void this.openCommand('automate.panel'));
    return [this.grp('Extensions and add-in packages', this.panel(extensionsPanel())), this.grp('Scripts', scripts.el)];
  }

  private trust(): HTMLElement[] {
    const policy = selectRow('Macro settings for VBA', [['disable', 'Disable all macros without notification'], ['notify', 'Disable all macros with notification'], ['signed', 'Disable all macros except digitally signed macros'], ['enable', 'Enable all macros (not recommended)']], (v) => this.change({ macroPolicy: v as Prefs['macroPolicy'] }));
    const policyNote = note('', true);
    const paintPolicy = (): void => {
      const p = prefs().macroPolicy;
      setText(policyNote, p === 'disable' ? 'Macros in workbooks you open never run, and FormCel does not mention them.' : p === 'notify' ? 'Macros in workbooks you open do not run until you enable them; FormCel tells you when a workbook has some.' : p === 'signed' ? 'FormCel cannot verify signatures yet, so every macro stays off and the message bar shows without Enable Content.' : 'Macros in every workbook you open are allowed to run. Use this only for files you trust.');
    };
    const list = el('div', 'fc-auto-list');
    const path = textRow('Folder', () => undefined, { placeholder: '/home/me/Documents/Trusted' });
    const add = el('button', 'fc-btn', 'Add location') as HTMLButtonElement;
    const bar = el('div', 'fc-row-actions');
    bar.append(add);
    const paintList = (): void => {
      const items = prefs().trusted;
      list.replaceChildren(
        ...(items.length
          ? items.map((p, i) => {
              const item = el('div', 'fc-auto-item');
              const label = el('span', 'fc-grow');
              label.textContent = p;
              const rm = el('button', 'fc-btn', 'Remove') as HTMLButtonElement;
              rm.type = 'button';
              rm.dataset.at = String(i);
              item.append(label, rm);
              return item;
            })
          : [note('No trusted locations. Workbooks from a trusted location open with their macros allowed.')]),
      );
    };
    list.addEventListener('click', (e) => {
      const at = (e.target as HTMLElement).closest<HTMLElement>('[data-at]')?.dataset.at;
      if (at === undefined) return;
      this.change({ trusted: prefs().trusted.filter((_, i) => i !== Number(at)) });
      paintList();
    });
    add.addEventListener('click', () => {
      const v = path.input.value.trim();
      if (!v || prefs().trusted.includes(v)) return;
      this.change({ trusted: [...prefs().trusted, v] });
      path.input.value = '';
      paintList();
    });
    this.syncs.push(paintPolicy, paintList);
    policy.el.querySelector('select')!.addEventListener('change', paintPolicy);
    return [
      this.grp('Macro settings', this.reg(policy, () => prefs().macroPolicy), policyNote),
      this.grp('Trusted locations', list, path.el, bar),
      this.grp('Python cells', this.panel(pythonPanel())),
      this.grp('External content', this.panel(externalPanel())),
    ];
  }

  private services(): HTMLElement[] {
    return [
      this.grp('Model endpoint for the assistant', this.panel(assistantPanel())),
      this.grp('REST API token', this.panel(tokenPanel())),
      this.grp('Sharing on the local network', this.panel(lanPanel())),
      this.grp('Scheduled refresh', this.panel(schedulerPanel())),
    ];
  }

  async show(section?: string): Promise<void> {
    for (const s of this.syncs) s();
    this.calcSync?.();
    if (!this.isOpen) this.open();
    const name = section && this.sections.has(section) ? section : this.current || 'General';
    this.showSection(name, null);
    this.scrollToSection(name, 'auto');
    this.queueWire();
    void this.host.calc.refresh().then(() => this.calcSync?.(), () => undefined);
    for (const p of this.panels) void p.refresh();
  }

  private showSection(name: string, scroll: ScrollBehavior | null): void {
    if (!this.sections.has(name)) return;
    this.markSection(name);
    if (scroll) this.scrollToSection(name, scroll);
  }

  private markSection(name: string): void {
    if (this.current === name) return;
    this.current = name;
    for (const [n, page] of this.sections) page.classList.toggle('is-current', n === name);
    for (const tab of Array.from(this.nav.children) as HTMLElement[]) {
      const on = tab.dataset.section === name;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
    }
    this.queueWire();
  }

  private scrollToSection(name: string, behavior: ScrollBehavior): void {
    const sec = this.sections.get(name);
    if (!sec) return;
    if (sec.classList.contains('is-folded')) this.foldSection(name);
    const top = sec.getBoundingClientRect().top - this.pages.getBoundingClientRect().top + this.pages.scrollTop - 12;
    this.spyMuted = performance.now() + 700;
    this.pages.scrollTo({ top, behavior });
  }

  private foldSection(name: string): void {
    const sec = this.sections.get(name);
    if (!sec) return;
    const folded = !sec.classList.contains('is-folded');
    sec.classList.toggle('is-folded', folded);
    sec.querySelector<HTMLElement>('.fc-prefs-secbody')!.hidden = folded;
    sec.querySelector('.fc-prefs-sechead')!.setAttribute('aria-expanded', String(!folded));
    this.queueWire();
    this.queueSpy();
  }

  private queueSpy(): void {
    if (this.spyRaf) return;
    this.spyRaf = requestAnimationFrame(() => {
      this.spyRaf = 0;
      const pages = this.pages;
      if (!pages.clientHeight || performance.now() < this.spyMuted) return;
      const edge = pages.getBoundingClientRect().top + 24;
      const names = Array.from(this.sections.keys());
      let best = '';
      let bestD = Infinity;
      if (pages.scrollHeight > pages.clientHeight + 4 && pages.scrollTop + pages.clientHeight >= pages.scrollHeight - 2) best = names[names.length - 1] ?? '';
      else {
        for (const [n, sec] of this.sections) {
          const top = sec.getBoundingClientRect().top;
          const d = top <= edge ? edge - top : top - edge + 100000;
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
      }
      if (best) this.markSection(best);
    });
  }

  private queueWire(): void {
    if (this.wireRaf) return;
    this.wireRaf = requestAnimationFrame(() => {
      this.wireRaf = 0;
      this.drawWire();
    });
  }

  private drawWire(): void {
    const s = this.shell;
    if (this.scrim.hidden) return;
    const F = this.frame.getBoundingClientRect();
    const tab = this.nav.querySelector<HTMLElement>('.fc-prefs-railtab.is-active');
    if (!F.width || !tab) return;
    const N = this.nav.getBoundingClientRect();
    let T = tab.getBoundingClientRect();
    if (T.top < N.top || T.bottom > N.bottom) {
      this.nav.scrollTop += T.top < N.top ? T.top - N.top - 6 : T.bottom - N.bottom + 6;
      T = tab.getBoundingClientRect();
    }
    const R = s.rail.getBoundingClientRect();
    const H = this.head.getBoundingClientRect();
    const portY = Math.round(H.bottom - F.top);
    const sx = Math.round(T.right - F.left);
    const ty = Math.round(T.top - F.top + T.height / 2);
    const rr = R.right - F.left;
    const trunk = Math.round(rr - rr * 0.45);
    const dy = portY - ty;
    const r = 10;
    const dir = dy > 0 ? 1 : -1;
    const d = Math.abs(dy) < 2 * r ? `M ${sx} ${ty} H ${trunk} V ${portY} H -7` : `M ${sx} ${ty} H ${trunk - r} a ${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${r} ${dir * r} V ${portY - dir * r} a ${r} ${r} 0 0 ${dir > 0 ? 0 : 1} ${r} ${dir * r} H -7`;
    if (d !== this.wireD) {
      this.wireD = d;
      s.shade.setAttribute('d', d);
      s.line.setAttribute('d', d);
    }
    if (portY !== this.portY) {
      this.portY = portY;
      s.port.style.transform = `translateY(${portY}px)`;
    }
  }
}

export function installSettings(host: SettingsHost): SettingsDialog {
  const dialog = new SettingsDialog(host);
  const apply = (): void => {
    applyRoot();
    applyGrid(host.grid);
  };
  apply();
  window.addEventListener(CHANGED, apply);
  registerCommand({
    id: 'app.settings',
    title: 'Preferences',
    description: 'Open Preferences, FormCel’s Options: general, formulas, data, proofing, saving, language, accessibility, advanced editing, the ribbon and Quick Access Toolbar, add-ins, the Trust Center and services.',
    changes: false,
    keys: 'Mod+,',
    run: () => dialog.show(),
  });
  document.addEventListener('fc:settings', (e) => void dialog.show((e as CustomEvent<{ section?: string }>).detail?.section));
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-cmd="app.settings"]')) void runCommand('app.settings');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== ',' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (dialog.isOpen || document.querySelector('.fc-modal:not([hidden])')) return;
    e.preventDefault();
    void dialog.show();
  });
  return dialog;
}
