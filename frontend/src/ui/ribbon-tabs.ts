import { chartMenus, type RibbonHost } from './ribbon-host';
import type { MItem, MenuSrc } from './rb-menu';
import type { GroupDef, Item, Rows, TabDef, Unit } from './ribbon';
import { CONTROL_TYPES } from '../vba/controls';

const L = (id: string, label: string, icon: string, o: Partial<Item> = {}): Item => ({ k: 'cmd', id, label, icon, ...o });
const T = (id: string, label: string, icon: string, o: Partial<Item> = {}): Item => ({ k: 'cmd', id, label, icon, text: true, ...o });
const I = (id: string, label: string, icon: string, o: Partial<Item> = {}): Item => ({ k: 'cmd', id, label, icon, ...o });
const S = (id: string, label: string, icon: string, menu: MenuSrc, o: Partial<Item> = {}): Item => ({ k: 'split', id, label, icon, menu, ...o });
const M = (id: string, label: string, icon: string, menu: MenuSrc, o: Partial<Item> = {}): Item => ({ k: 'menu', id, label, icon, menu, ...o });
const A = (id: string, label: string, icon: string, run: (anchor: HTMLElement) => void, o: Partial<Item> = {}): Item => ({ k: 'act', id, label, icon, run, ...o });
const X = (id: string): Item => ({ k: 'slot', id });
const R = (...rows: Item[][]): Rows => ({ rows });
const G = (id: string, label: string, ...units: Unit[]): GroupDef => ({ id, label, units });
const c = (id: string, label: string, icon?: string): MItem => ({ label, cmd: id, icon });

export function ribbonTabs(h: RibbonHost): TabDef[] {
  const sortFilter: MItem[] = [c('data.sort-asc', 'Sort A to Z', 'sortAsc'), c('data.sort-desc', 'Sort Z to A', 'sortDesc'), c('data.sort', 'Custom Sort...', 'sort'), { sep: true }, c('data.filter', 'Filter', 'filter'), c('data.filter-clear', 'Clear', 'filterClear'), c('data.filter-reapply', 'Reapply', 'filterReapply')];
  const findSelect: MItem[] = [c('edit.find', 'Find...', 'search'), c('edit.replace', 'Replace...', 'replace'), c('nav.goto', 'Go To...', 'goto'), c('nav.goto', 'Go To Special...', 'goto')];
  const clearMenu: MItem[] = [
    { label: 'Clear All', icon: 'clearAll', run: () => { h.run('edit.clear'); window.setTimeout(() => h.run('format.clear'), 120); } },
    c('format.clear', 'Clear Formats', 'clearFormat'), c('edit.clear', 'Clear Contents', 'clearAll'), c('edit.link-remove', 'Clear Hyperlinks', 'unlink'),
  ];
  const fillMenu: MItem[] = [c('edit.series', 'Series...', 'fill'), c('data.flash-fill', 'Flash Fill', 'flash')];
  const insertMenu: MItem[] = [c('edit.insert-cells', 'Insert Cells...', 'insertCells'), c('rows.insert-above', 'Insert Sheet Rows Above', 'rowInsert'), c('rows.insert-below', 'Insert Sheet Rows Below', 'rowInsert'), c('cols.insert-left', 'Insert Sheet Columns Left', 'colInsert'), c('cols.insert-right', 'Insert Sheet Columns Right', 'colInsert'), c('sheet.add', 'Insert Sheet', 'sheet')];
  const deleteMenu: MItem[] = [c('edit.delete-cells', 'Delete Cells...', 'deleteCells'), c('rows.delete', 'Delete Sheet Rows', 'rowDelete'), c('cols.delete', 'Delete Sheet Columns', 'colDelete')];
  const hideMenu: MItem[] = [c('rows.hide', 'Hide Rows', 'hide'), c('cols.hide', 'Hide Columns', 'hide'), c('sheet.hide', 'Hide Sheet', 'hide'), { sep: true }, c('rows.unhide', 'Unhide Rows', 'unhide'), c('cols.unhide', 'Unhide Columns', 'unhide')];
  const formatMenu: MItem[] = [
    { head: 'Cell Size' }, c('rows.height', 'Row Height...', 'rowHeight'), c('rows.autofit', 'AutoFit Row Height', 'autofit'), c('cols.width', 'Column Width...', 'colWidth'), c('cols.autofit', 'AutoFit Column Width', 'autofit'), c('cols.standard', 'Default Width...', 'colWidth'),
    { head: 'Visibility' }, { label: 'Hide & Unhide', icon: 'hide', sub: hideMenu },
    { head: 'Protection' }, c('protect.sheet', 'Protect Sheet...', 'lock'), c('protect.cells', 'Lock Cell', 'lock'), c('sheet.ungroup', 'Ungroup Sheets', 'unhide'),
    { sep: true }, c('format.number-dialog', 'Format Cells...', 'formatCells'),
  ];
  const sparkItems = (label: string, icon: string): Item => T('insert.sparkline', label, icon);
  const printArea: MItem[] = [c('page.area-set', 'Set Print Area', 'printArea'), c('page.area-clear', 'Clear Print Area', 'printArea')];
  const breaks: MItem[] = [c('page.break-insert', 'Insert Page Break', 'breaks'), c('page.break-remove', 'Remove Page Break', 'breaks'), c('page.break-reset', 'Reset All Page Breaks', 'breaks')];
  const groupMenu: MItem[] = [c('rows.group', 'Group Rows', 'group'), c('cols.group', 'Group Columns', 'group')];
  const ungroupMenu: MItem[] = [c('rows.ungroup', 'Ungroup Rows', 'ungroup'), c('cols.ungroup', 'Ungroup Columns', 'ungroup')];
  const freezeMenu: MItem[] = [c('view.freeze-panes', 'Freeze Panes', 'freezePanes'), c('view.freeze-top-row', 'Freeze Top Row', 'freezeRow'), c('view.freeze-first-column', 'Freeze First Column', 'freezeCol'), c('view.unfreeze', 'Unfreeze Panes', 'unfreeze')];
  const whatIfMenu: MItem[] = [c('data.scenarios', 'Scenario Manager...', 'scenario'), c('data.goal-seek', 'Goal Seek...', 'goalSeek'), c('data.data-table', 'Data Table...', 'dataTable'), { sep: true }, c('data.datatable-refresh', 'Recalculate Data Tables', 'refresh'), c('data.whatif', 'All Analysis Tools...', 'whatIf')];
  const calcMenu: MItem[] = [c('calc.options', 'Automatic or Manual...', 'calcOpts'), c('calc.iterate', 'Iterative Calculation', 'iterate'), c('calc.r1c1', 'R1C1 Reference Style', 'r1c1'), c('data.links', 'Edit Links...', 'extLink')];
  const validMenu: MItem[] = [c('data.validation', 'Data Validation...', 'validation'), c('data.circle-invalid', 'Circle Invalid Data', 'circleInvalid'), c('data.clear-circles', 'Clear Validation Circles', 'clearCircles')];
  const autoMenu: MItem[] = [c('data.flash-auto', 'Automatically Flash Fill', 'flash'), c('edit.autocomplete', 'AutoComplete', 'autocomplete')];
  const errMenu: MItem[] = [c('errors.check', 'Error Checking...', 'errCheck'), c('errors.trace', 'Trace Error', 'errTrace'), c('errors.options', 'Error Checking Options...', 'errOpts'), c('errors.menu', 'All Error Tools...', 'errCheck')];
  const nameMenu: MItem[] = [c('names.manager', 'Define Name...', 'names'), c('names.apply', 'Apply Names...', 'nameApply')];
  const linkMenu: MItem[] = [c('edit.link', 'Insert Link...', 'link'), c('edit.link-open', 'Open Link', 'linkOpen'), c('edit.link-remove', 'Remove Link', 'unlink')];
  const pivotMenu: MItem[] = [c('pivot.create', 'From Table/Range...', 'pivot'), c('pivot.fields', 'PivotTable Fields', 'pivotFields'), c('pivot.refresh', 'Refresh', 'refresh'), c('pivot.refresh-all', 'Refresh All PivotTables', 'refresh')];
  const refreshMenu: MItem[] = [c('data.refresh', 'Refresh All', 'refreshAll'), c('pivot.refresh-all', 'Refresh All PivotTables', 'refresh'), c('data.datatable-refresh', 'Recalculate Data Tables', 'refresh')];
  const macroMenu: MItem[] = [c('vba.macros', 'View Macros', 'macros'), c('vba.record', 'Record Macro...', 'record'), c('automate.run', 'Run Script...', 'script')];
  const accessMenu: MItem[] = [c('a11y.check', 'Check Accessibility', 'access'), c('view.access', 'Accessibility and Language...', 'access'), c('insert.alt-text', 'Alt Text...', 'altText')];
  const calcOptions = (): MItem[] => calcMenu;
  const controlsMenu: MItem[] = [c('insert.button', 'Button', 'buttonShape'), c('data.checkbox-insert', 'Checkbox', 'checkbox'), c('data.checkbox-remove', 'Remove Checkboxes', 'checkbox')];

  const home: TabDef = {
    id: 'home', label: 'Home', groups: [
      { ...G('clipboard', 'Clipboard',
        S('edit.paste-special', 'Paste', 'paste', h.pasteMenu(), { run: () => h.paste() }),
        R([A('act:cut', 'Cut', 'cut', () => h.cut(), { text: true })], [A('act:copy', 'Copy', 'copy', () => h.copy(), { text: true })], [T('format.painter', 'Format Painter', 'painter')])), rank: -2 },
      { ...G('font', 'Font',
        R([X('font'), X('size'), A('act:grow', 'Increase Font Size', 'growFont', () => h.stepSize(1)), A('act:shrink', 'Decrease Font Size', 'shrinkFont', () => h.stepSize(-1))],
          [I('format.bold', 'Bold', 'bold'), I('format.italic', 'Italic', 'italic'), I('format.underline', 'Underline', 'underline'), I('format.strike', 'Strikethrough', 'strike'),
            S('format.borders', 'Borders', 'borders', () => h.borderMenu(), { run: () => h.applyBorder() }),
            S('format.fill-color', 'Fill Color', 'fillColor', () => h.colorMenu('bg'), { swatch: true, run: () => h.applyLast('bg') }),
            S('format.text-color', 'Font Color', 'textColor', () => h.colorMenu('fc'), { swatch: true, run: () => h.applyLast('fc') })])), rank: -1 },
      G('alignment', 'Alignment',
        R([I('format.valign-top', 'Top Align', 'alignTop'), I('format.valign-middle', 'Middle Align', 'alignMiddle'), I('format.valign-bottom', 'Bottom Align', 'alignBottom'), I('format.rotate', 'Orientation', 'rotate'), T('format.wrap', 'Wrap Text', 'wrap')],
          [I('format.align-left', 'Align Left', 'alignLeft'), I('format.align-center', 'Center', 'alignCenter'), I('format.align-right', 'Align Right', 'alignRight'), I('format.indent-less', 'Decrease Indent', 'indentLess'), I('format.indent-more', 'Increase Indent', 'indentMore'),
            S('format.merge', 'Merge & Center', 'merge', h.mergeMenu(), { text: true, run: () => h.run('format.merge-center') })])),
      G('number', 'Number',
        R([X('numfmt')], [I('format.accounting', 'Accounting Number Format', 'numCurrency'), I('format.percent', 'Percent Style', 'numPercent'), I('format.number', 'Comma Style', 'numComma'), I('format.decimals-more', 'Increase Decimal', 'decMore'), I('format.decimals-less', 'Decrease Decimal', 'decLess')])),
      G('styles', 'Styles',
        M('cf', 'Conditional Formatting', 'cf', () => h.cfMenu(), { cmdId: 'format.cf' }),
        M('fat', 'Format as Table', 'formatTable', () => h.tableStylesMenu(), { cmdId: 'table.create' }),
        M('cs', 'Cell Styles', 'cellStyles', () => h.stylesMenu(), { cmdId: 'format.styles' })),
      G('cells', 'Cells',
        S('edit.insert-cells', 'Insert', 'insertCells', insertMenu),
        S('edit.delete-cells', 'Delete', 'deleteCells', deleteMenu),
        M('fmtcells', 'Format', 'formatCells', formatMenu)),
      G('editing', 'Editing',
        R([S('act:autosum', 'AutoSum', 'autosum', () => h.autosumMenu(), { text: true, run: () => void h.autosum('SUM') })], [M('fill', 'Fill', 'fill', fillMenu, { text: true })], [M('clear', 'Clear', 'clearAll', clearMenu, { text: true })]),
        M('sortfilter', 'Sort & Filter', 'sort', sortFilter),
        M('findsel', 'Find & Select', 'search', findSelect)),
      G('analysis', 'Analysis', L('data.analyze', 'Analyze Data', 'analyze')),
    ],
  };

  const insert: TabDef = {
    id: 'insert', label: 'Insert', groups: [
      G('tables', 'Tables', S('pivot.create', 'PivotTable', 'pivot', pivotMenu), L('table.create', 'Table', 'table')),
      G('illustrations', 'Illustrations', L('insert.picture', 'Pictures', 'picture'), L('insert.cell-picture', 'Picture in Cell', 'cellPicture'), L('insert.shapes', 'Shapes', 'shapes')),
      G('charts', 'Charts',
        L('insert.chart-recommended', 'Recommended Charts', 'chartRecommended'),
        R(...[0, 3, 6].map((i) => chartMenus().slice(i, i + 3).map((m) => M(`ch:${m.id}`, m.label.replace('Insert ', ''), m.icon, () => h.chartMenu(m.id))))),
        L('insert.chart', 'All Charts', 'chart'),
        R([M('ch:map', 'Maps', 'chMap', () => h.mapMenu(), { text: true })]),
        S('insert.pivot-chart', 'PivotChart', 'pivotChart', [c('insert.pivot-chart', 'PivotChart', 'pivotChart'), c('pivotchart.field-buttons', 'Field Buttons', 'pivotFields')])),
      G('sparklines', 'Sparklines', R([sparkItems('Line', 'sparkline')], [sparkItems('Column', 'sparkColumn')], [sparkItems('Win/Loss', 'sparkWinLoss')])),
      G('filters', 'Filters', L('data.slicer', 'Slicer', 'slicer')),
      G('links', 'Links', S('edit.link', 'Link', 'link', linkMenu)),
      G('comments', 'Comments', L('review.comment', 'Comment', 'comment'), L('review.note', 'Note', 'note')),
      G('text', 'Text', L('insert.textbox', 'Text Box', 'textBox'), L('page.setup', 'Header & Footer', 'header'), L('insert.chip', 'Smart Chip', 'smartChip')),
      G('controls', 'Controls', M('controls', 'Controls', 'controls', controlsMenu)),
      G('symbols', 'Symbols', M('symbol', 'Symbol', 'symbol', () => h.symbolMenu())),
    ],
  };

  const draw: TabDef = {
    id: 'draw', label: 'Draw', groups: [
      G('shapes', 'Shapes', L('insert.shape-rect', 'Rectangle', 'shapeRect'), L('insert.shape-ellipse', 'Ellipse', 'shapeEllipse'), L('insert.shape-arrow', 'Arrow', 'shapeArrow'), L('insert.shapes', 'More Shapes', 'shapes')),
      G('objects', 'Objects', L('insert.textbox', 'Text Box', 'textBox'), L('insert.button', 'Button', 'buttonShape'), L('format.shape', 'Format Shape', 'formatShape'), L('insert.alt-text', 'Alt Text', 'altText')),
      G('pictures', 'Pictures', L('insert.picture', 'Pictures', 'picture'), L('insert.cell-picture', 'Picture in Cell', 'cellPicture')),
    ],
  };

  const pagelayout: TabDef = {
    id: 'pagelayout', label: 'Page Layout', groups: [
      G('themes', 'Themes', M('themes', 'Themes', 'theme', () => h.themesMenu(), { cmdId: 'format.theme' })),
      G('pagesetup', 'Page Setup', L('page.setup', 'Margins', 'margins'), L('page.setup', 'Orientation', 'orientation'), L('page.setup', 'Size', 'paperSize'), M('printarea', 'Print Area', 'printArea', printArea), M('breaks', 'Breaks', 'breaks', breaks), L('page.setup', 'Print Titles', 'printTitles'), L('page.menu', 'Page Options', 'page')),
      G('scale', 'Scale to Fit', R([T('page.setup', 'Width: Automatic', 'scaleFit')], [T('page.setup', 'Height: Automatic', 'scaleFit')], [T('page.setup', 'Scale: 100%', 'scaleFit')])),
      G('sheetopts', 'Sheet Options', R([T('page.setup', 'Gridlines: Print', 'gridlines')], [T('page.setup', 'Headings: Print', 'headings')])),
    ],
  };

  const funcs = (label: string, icon: string, ...cats: string[]): Item => M(`fn:${label}`, label, icon, () => h.functionMenu(...cats), { text: true });
  const formulas: TabDef = {
    id: 'formulas', label: 'Formulas', groups: [
      G('library', 'Function Library',
        L('formula.insert-function', 'Insert Function', 'insertFn'),
        S('act:autosum2', 'AutoSum', 'autosum', () => h.autosumMenu(), { run: () => void h.autosum('SUM') }),
        M('fn:recent', 'Recently Used', 'recent', () => h.recentMenu()),
        R([funcs('Financial', 'financial', 'Financial')], [funcs('Logical', 'logical', 'Logical')], [funcs('Text', 'textFn', 'Text')]),
        R([funcs('Date & Time', 'dateTime', 'Date and time', 'Date')], [funcs('Lookup & Reference', 'lookup', 'Lookup and reference', 'Look and reference')], [funcs('Math & Trig', 'mathTrig', 'Math and trigonometry')]),
        M('fn:more', 'More Functions', 'moreFn', () => h.moreFunctions()),
        R([T('formula.arguments', 'Function Arguments', 'fnArgs')], [T('formula.array', 'Array Formula', 'arrayFormula')], [T('python.cell', 'Insert Python', 'python')])),
      G('names', 'Defined Names',
        L('names.manager', 'Name Manager', 'names'),
        R([M('names:define', 'Define Name', 'nameDefine', nameMenu, { text: true })], [T('names.paste', 'Use in Formula', 'namePaste')], [T('names.create', 'Create from Selection', 'nameCreate')]),
        R([T('names.functions', 'Named Functions', 'namedFn')], [T('nav.namebox', 'Go to Name Box', 'nameBox')])),
      G('auditing', 'Formula Auditing',
        R([T('audit.precedents', 'Trace Precedents', 'tracePrec')], [T('audit.dependents', 'Trace Dependents', 'traceDep')], [T('audit.remove-arrows', 'Remove Arrows', 'removeArrows')]),
        R([S('errors.check', 'Error Checking', 'errCheck', errMenu, { text: true })], [T('audit.evaluate', 'Evaluate Formula', 'evalFormula')], [T('audit.watch', 'Watch Window', 'watch')])),
      G('calc', 'Calculation',
        M('calc', 'Calculation Options', 'calcOpts', calcOptions, { cmdId: 'calc.menu' }),
        R([T('calc.now', 'Calculate Now', 'calcNow')], [T('calc.sheet', 'Calculate Sheet', 'calcSheet')], [T('calc.full', 'Full Calculation', 'calcFull')]),
        R([T('calc.rebuild', 'Rebuild Dependencies', 'calcRebuild')])),
    ],
  };

  const data: TabDef = {
    id: 'data', label: 'Data', groups: [
      G('get', 'Get & Transform Data', L('data.panel', 'Get Data', 'dataConn'), R([T('table.create', 'From Table/Range', 'table')])),
      G('queries', 'Queries & Connections', S('data.refresh', 'Refresh All', 'refreshAll', refreshMenu), R([T('data.panel', 'Queries & Connections', 'queries')], [T('data.links', 'Edit Links', 'extLink')])),
      G('types', 'Data Types', L('datatypes.stocks', 'Stocks', 'stocks'), L('datatypes.currencies', 'Currencies', 'currency'), L('datatypes.providers', 'Data Providers', 'refreshAll')),
      G('sort', 'Sort & Filter',
        R([I('data.sort-asc', 'Sort A to Z', 'sortAsc')], [I('data.sort-desc', 'Sort Z to A', 'sortDesc')]),
        L('data.sort', 'Sort', 'sort'), L('data.filter', 'Filter', 'filter'),
        R([T('data.filter-clear', 'Clear', 'filterClear')], [T('data.filter-reapply', 'Reapply', 'filterReapply')], [T('data.advanced-filter', 'Advanced', 'advFilter')]),
        L('data.filter-views', 'Filter Views', 'filterViews')),
      G('tools', 'Data Tools',
        L('data.text-to-columns', 'Text to Columns', 'textToCols'),
        R([T('data.flash-fill', 'Flash Fill', 'flash')], [T('data.dedupe', 'Remove Duplicates', 'dedupe')], [S('data.validation', 'Data Validation', 'validation', validMenu, { text: true })]),
        R([T('data.consolidate', 'Consolidate', 'consolidate')], [T('datamodel.manage', 'Manage Data Model', 'dataModel')], [M('autoopts', 'Auto Options', 'autocomplete', autoMenu, { text: true })]),
        R([T('data.cleanup', 'Data Cleanup', 'cleanup')], [T('data.trim', 'Trim Whitespace', 'trim')], [T('data.column-type', 'Column Type', 'columnType')]),
        L('data.tools', 'More Data Tools', 'dataTools')),
      G('forecast', 'Forecast', S('data.whatif', 'What-If Analysis', 'whatIf', whatIfMenu), L('data.forecast-sheet', 'Forecast Sheet', 'forecast')),
      G('outline', 'Outline',
        S('rows.group', 'Group', 'group', groupMenu), S('rows.ungroup', 'Ungroup', 'ungroup', ungroupMenu), L('data.subtotal', 'Subtotal', 'subtotal'),
        R([T('data.auto-outline', 'Auto Outline', 'autoOutline')], [T('data.clear-outline', 'Clear Outline', 'clearOutline')], [T('data.outline-settings', 'Outline Settings', 'outlineSettings')]),
        R([T('cols.group', 'Group Columns', 'group')], [T('cols.ungroup', 'Ungroup Columns', 'ungroup')])),
      G('analysis', 'Analysis', L('data.analysis', 'Data Analysis', 'dataAnalysis'), L('data.solver', 'Solver', 'solver'), R([T('data.describe', 'Descriptive Statistics', 'describe')], [T('data.regression', 'Regression', 'regression')], [T('data.analyze', 'Analyze Data', 'analyze')])),
    ],
  };

  const review: TabDef = {
    id: 'review', label: 'Review', groups: [
      G('proofing', 'Proofing', L('review.spelling', 'Spelling', 'spell')),
      G('accessibility', 'Accessibility', S('a11y.check', 'Check Accessibility', 'access', accessMenu)),
      G('insights', 'Insights', L('assistant.panel', 'Assistant', 'assistant')),
      G('comments', 'Comments', L('review.comment', 'New Comment', 'comment'), L('review.panel', 'Show Comments', 'commentsPanel')),
      G('notes', 'Notes', L('review.note', 'Note', 'note')),
      G('changes', 'Changes', L('review.changes', 'Show Changes', 'changes'), L('history.panel', 'Version History', 'clock'), R([T('review.inbox', 'Inbox', 'inbox')], [T('review.people', 'People', 'people')], [T('review.watch', 'Notify Me', 'notify')]), R([T('review.user', 'Your Name', 'user')])),
      G('protect', 'Protect', L('protect.sheet', 'Protect Sheet', 'lock'), L('protect.book', 'Protect Workbook', 'protectBook'), L('protect.ranges', 'Allow Edit Ranges', 'allowRanges'), R([T('protect.cells', 'Cell Protection', 'lock')], [T('protect.final', 'Mark as Final', 'markFinal')], [T('protect.menu', 'More Protection', 'lock')])),
      G('share', 'Share', L('share.panel', 'Share', 'share')),
    ],
  };

  const view: TabDef = {
    id: 'view', label: 'View', groups: [
      G('sheetview', 'Sheet View', L('data.filter-views', 'Filter Views', 'filterViews')),
      G('workbook', 'Workbook Views', L('page.preview', 'Page Break Preview', 'pageBreakPreview'), L('view.timeline', 'Timeline View', 'timeline')),
      G('show', 'Show', R([T('view.formula-bar', 'Formula Bar', 'formulaBar')], [T('nav.namebox', 'Name Box', 'nameBox')])),
      G('zoom', 'Zoom', L('view.zoom-reset', 'Zoom 100%', 'zoom100'), L('view.zoom-in', 'Zoom In', 'zoomIn'), L('view.zoom-out', 'Zoom Out', 'zoomOut')),
      G('window', 'Window', S('view.freeze-panes', 'Freeze Panes', 'freezePanes', freezeMenu), L('view.split', 'Split', 'split')),
      G('macros', 'Macros', S('vba.macros', 'Macros', 'macros', macroMenu), L('vba.record', 'Record Macro', 'record')),
    ],
  };

  const automate: TabDef = {
    id: 'automate', label: 'Automate', groups: [
      G('scripts', 'Office Scripts', L('automate.record', 'Record Actions', 'record'), L('automate.run', 'Run Script', 'play'), L('automate.panel', 'All Scripts', 'script')),
      G('python', 'Python', L('python.cell', 'Python Cell', 'python')),
      G('assist', 'Assistant', L('assistant.panel', 'Assistant', 'assistant')),
    ],
  };

  const developer: TabDef = {
    id: 'developer', label: 'Developer', groups: [
      G('code', 'Code', L('vba.editor', 'Visual Basic', 'vba'), L('vba.macros', 'Macros', 'macros'), L('vba.record', 'Record Macro', 'record'), L('vba.security', 'Macro Security', 'protectBook')),
      G('controls', 'Controls', M('devcontrols', 'Insert', 'controls', [...CONTROL_TYPES.map(([t, label, icon]) => c(`vba.control.${t}`, label, icon)), ...controlsMenu]), L('vba.controls', 'Form Controls', 'controls'), L('vba.view-code', 'View Code', 'vba')),
    ],
  };

  const help: TabDef = {
    id: 'help', label: 'Help', groups: [
      G('help', 'Help', L('a11y.shortcuts', 'Keyboard Shortcuts', 'keyboard'), L('view.access', 'Accessibility', 'access')),
      G('ribbon', 'Ribbon', L('ribbon.customize', 'Customize Ribbon', 'customize'), L('qat.customize', 'Customize Quick Access', 'qat'), L('ribbon.collapse', 'Collapse Ribbon', 'chevronUp')),
    ],
  };

  const tabledesign: TabDef = {
    id: 'tabledesign', label: 'Table Design', ctx: true, groups: [
      G('props', 'Properties', L('table.create', 'Table Properties', 'table')),
      G('tools', 'Tools', L('pivot.create', 'Summarize with PivotTable', 'pivot'), L('data.dedupe', 'Remove Duplicates', 'dedupe'), L('table.create', 'Convert to Range', 'convertRange'), L('data.slicer', 'Insert Slicer', 'slicer'), L('data.column-type', 'Column Type', 'columnType')),
      G('styles', 'Table Styles', M('tablestyles', 'Quick Styles', 'formatTable', () => h.tableStylesMenu(), { cmdId: 'table.create' })),
    ],
  };
  const pivotanalyze: TabDef = {
    id: 'pivotanalyze', label: 'PivotTable Analyze', ctx: true, groups: [
      G('pivot', 'PivotTable', L('pivot.fields', 'Fields', 'pivotFields'), L('pivot.create', 'Options', 'pivot')),
      G('data', 'Data', L('pivot.refresh', 'Refresh', 'refresh'), L('pivot.refresh-all', 'Refresh All', 'refreshAll')),
      G('tools', 'Tools', L('insert.pivot-chart', 'PivotChart', 'pivotChart'), L('data.slicer', 'Insert Slicer', 'slicer'), L('cube.convert', 'OLAP Tools: Convert to Formulas', 'cube')),
      G('show', 'Show', L('pivotchart.field-buttons', 'Field Buttons', 'pivotFields')),
    ],
  };
  const pivotdesign: TabDef = {
    id: 'pivotdesign', label: 'Design', ctx: true, groups: [
      G('layout', 'Layout', L('pivot.fields', 'Report Layout', 'pivotFields')),
      G('styles', 'PivotTable Styles', L('format.styles', 'Cell Styles', 'cellStyles'), L('format.cf', 'Conditional Formatting', 'cf')),
    ],
  };
  const chartdesign: TabDef = {
    id: 'chartdesign', label: 'Chart Design', ctx: true, groups: [
      G('type', 'Type', L('chart.edit', 'Change Chart Type', 'chart')),
      G('data', 'Data', L('chart.edit', 'Select Data', 'dataConn'), L('pivotchart.field-buttons', 'Field Buttons', 'pivotFields')),
      G('access', 'Accessibility', L('insert.alt-text', 'Alt Text', 'altText')),
    ],
  };
  const chartformat: TabDef = {
    id: 'chartformat', label: 'Format', ctx: true, groups: [
      G('insert', 'Insert Shapes', L('insert.shapes', 'Shapes', 'shapes'), L('insert.textbox', 'Text Box', 'textBox')),
      G('access', 'Accessibility', L('insert.alt-text', 'Alt Text', 'altText')),
    ],
  };
  const shapeformat: TabDef = {
    id: 'shapeformat', label: 'Shape Format', ctx: true, groups: [
      G('insert', 'Insert Shapes', L('insert.shape-rect', 'Rectangle', 'shapeRect'), L('insert.shape-ellipse', 'Ellipse', 'shapeEllipse'), L('insert.shape-arrow', 'Arrow', 'shapeArrow'), L('insert.shapes', 'More Shapes', 'shapes')),
      G('format', 'Shape Styles', L('format.shape', 'Format Shape', 'formatShape')),
      G('access', 'Accessibility', L('insert.alt-text', 'Alt Text', 'altText')),
    ],
  };
  const pictureformat: TabDef = {
    id: 'pictureformat', label: 'Picture Format', ctx: true, groups: [
      G('adjust', 'Adjust', L('insert.picture', 'Change Picture', 'picture'), L('insert.cell-picture', 'Picture in Cell', 'cellPicture')),
      G('access', 'Accessibility', L('insert.alt-text', 'Alt Text', 'altText')),
    ],
  };
  const sparkline: TabDef = {
    id: 'sparkline', label: 'Sparkline', ctx: true, groups: [
      G('sparkline', 'Sparkline', L('insert.sparkline', 'Edit Data', 'sparkline'), L('insert.sparkline-clear', 'Clear', 'clearAll')),
      G('type', 'Type', L('insert.sparkline', 'Line', 'sparkline'), L('insert.sparkline', 'Column', 'sparkColumn'), L('insert.sparkline', 'Win/Loss', 'sparkWinLoss')),
    ],
  };

  return [home, insert, draw, pagelayout, formulas, data, review, view, automate, developer, help, tabledesign, pivotanalyze, pivotdesign, chartdesign, chartformat, shapeformat, pictureformat, sparkline];
}

export function simpleItems(h: RibbonHost): Item[] {
  return [
    I('edit.undo', 'Undo', 'undo'), I('edit.redo', 'Redo', 'redo'),
    I('format.bold', 'Bold', 'bold'), I('format.italic', 'Italic', 'italic'), I('format.underline', 'Underline', 'underline'),
    S('format.fill-color', 'Fill Color', 'fillColor', () => h.colorMenu('bg'), { swatch: true, run: () => h.applyLast('bg') }),
    S('format.text-color', 'Font Color', 'textColor', () => h.colorMenu('fc'), { swatch: true, run: () => h.applyLast('fc') }),
    S('format.borders', 'Borders', 'borders', () => h.borderMenu(), { run: () => h.applyBorder() }),
    I('format.align-left', 'Align Left', 'alignLeft'), I('format.align-center', 'Center', 'alignCenter'), I('format.align-right', 'Align Right', 'alignRight'), I('format.wrap', 'Wrap Text', 'wrap'),
    S('format.merge', 'Merge & Center', 'merge', h.mergeMenu(), { run: () => h.run('format.merge-center') }),
    I('format.accounting', 'Accounting Number Format', 'numCurrency'), I('format.percent', 'Percent Style', 'numPercent'), I('format.decimals-more', 'Increase Decimal', 'decMore'),
    I('data.sort-asc', 'Sort A to Z', 'sortAsc'), I('data.filter', 'Filter', 'filter'), I('formula.insert-function', 'Insert Function', 'insertFn'), I('insert.chart', 'Chart', 'chart'),
  ];
}
