export type EnterDir = 'down' | 'right' | 'up' | 'left';
export type MacroPolicy = 'disable' | 'notify' | 'enable';

export interface Prefs {
  startScreen: boolean;
  defaultFont: string;
  defaultSize: number;
  defaultView: 'normal' | 'pagebreak';
  newSheets: number;
  density: '' | 'compact' | 'comfortable';
  accent: string;
  pivotGrandRows: boolean;
  pivotGrandCols: boolean;
  pivotSubtotals: boolean;
  pivotAuto: boolean;
  importConvert: boolean;
  importWizard: boolean;
  importMaxRows: number;
  spellAsYouType: boolean;
  spellLanguage: string;
  acReplace: boolean;
  acSentence: boolean;
  acInitials: boolean;
  acDays: boolean;
  acQuotes: boolean;
  acList: [string, string][];
  autosaveSeconds: number;
  defaultFormat: 'fcel' | 'xlsx';
  reduceMotion: boolean;
  enterMove: boolean;
  enterDir: EnterDir;
  autoDecimal: boolean;
  decimals: number;
  fillHandle: boolean;
  dragDrop: boolean;
  editInCell: boolean;
  showFormulaBar: boolean;
  showStatusBar: boolean;
  gridlines: boolean;
  gridColor: string;
  macroPolicy: MacroPolicy;
  trusted: string[];
}

export const DEFAULT_AC: [string, string][] = [
  ['(c)', '©'],
  ['(r)', '®'],
  ['(tm)', '™'],
  ['teh', 'the'],
  ['recieve', 'receive'],
  ['adn', 'and'],
  ['taht', 'that'],
  ['seperate', 'separate'],
  ['definately', 'definitely'],
  ['occurence', 'occurrence'],
];

export const DEFAULTS: Prefs = {
  startScreen: true,
  defaultFont: '',
  defaultSize: 10,
  defaultView: 'normal',
  newSheets: 1,
  density: '',
  accent: '',
  pivotGrandRows: true,
  pivotGrandCols: true,
  pivotSubtotals: true,
  pivotAuto: true,
  importConvert: true,
  importWizard: true,
  importMaxRows: 1048576,
  spellAsYouType: true,
  spellLanguage: 'en-US',
  acReplace: false,
  acSentence: false,
  acInitials: false,
  acDays: false,
  acQuotes: false,
  acList: DEFAULT_AC,
  autosaveSeconds: 0.4,
  defaultFormat: 'fcel',
  reduceMotion: false,
  enterMove: true,
  enterDir: 'down',
  autoDecimal: false,
  decimals: 2,
  fillHandle: true,
  dragDrop: true,
  editInCell: true,
  showFormulaBar: true,
  showStatusBar: true,
  gridlines: true,
  gridColor: '',
  macroPolicy: 'notify',
  trusted: [],
};

export const KEY = 'formcel.options';
export const CHANGED = 'formcel:prefs';

const flag = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d);
const hex = (v: unknown, d: string): string => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : d);
const text = (v: unknown, d: string, max = 80): string => (typeof v === 'string' ? v.slice(0, max) : d);

function pairs(v: unknown): [string, string][] {
  if (!Array.isArray(v)) return DEFAULT_AC.map((p) => [...p]);
  const out: [string, string][] = [];
  for (const p of v) {
    if (Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string' && p[0] && out.length < 500) out.push([p[0].slice(0, 60), p[1].slice(0, 120)]);
  }
  return out;
}

function clean(r: Record<string, unknown>): Prefs {
  const d = DEFAULTS;
  return {
    startScreen: flag(r.startScreen, d.startScreen),
    defaultFont: text(r.defaultFont, d.defaultFont, 60),
    defaultSize: num(r.defaultSize, 6, 36, d.defaultSize),
    defaultView: pick(r.defaultView, ['normal', 'pagebreak'], d.defaultView),
    newSheets: Math.round(num(r.newSheets, 1, 50, d.newSheets)),
    density: pick(r.density, ['', 'compact', 'comfortable'], d.density),
    accent: r.accent === '' ? '' : hex(r.accent, ''),
    pivotGrandRows: flag(r.pivotGrandRows, d.pivotGrandRows),
    pivotGrandCols: flag(r.pivotGrandCols, d.pivotGrandCols),
    pivotSubtotals: flag(r.pivotSubtotals, d.pivotSubtotals),
    pivotAuto: flag(r.pivotAuto, d.pivotAuto),
    importConvert: flag(r.importConvert, d.importConvert),
    importWizard: flag(r.importWizard, d.importWizard),
    importMaxRows: Math.round(num(r.importMaxRows, 1000, 1048576, d.importMaxRows)),
    spellAsYouType: flag(r.spellAsYouType, d.spellAsYouType),
    spellLanguage: text(r.spellLanguage, d.spellLanguage, 12),
    acReplace: flag(r.acReplace, d.acReplace),
    acSentence: flag(r.acSentence, d.acSentence),
    acInitials: flag(r.acInitials, d.acInitials),
    acDays: flag(r.acDays, d.acDays),
    acQuotes: flag(r.acQuotes, d.acQuotes),
    acList: pairs(r.acList),
    autosaveSeconds: num(r.autosaveSeconds, 0.4, 600, d.autosaveSeconds),
    defaultFormat: pick(r.defaultFormat, ['fcel', 'xlsx'], d.defaultFormat),
    reduceMotion: flag(r.reduceMotion, d.reduceMotion),
    enterMove: flag(r.enterMove, d.enterMove),
    enterDir: pick(r.enterDir, ['down', 'right', 'up', 'left'], d.enterDir),
    autoDecimal: flag(r.autoDecimal, d.autoDecimal),
    decimals: Math.round(num(r.decimals, 1, 8, d.decimals)),
    fillHandle: flag(r.fillHandle, d.fillHandle),
    dragDrop: flag(r.dragDrop, d.dragDrop),
    editInCell: flag(r.editInCell, d.editInCell),
    showFormulaBar: flag(r.showFormulaBar, d.showFormulaBar),
    showStatusBar: flag(r.showStatusBar, d.showStatusBar),
    gridlines: flag(r.gridlines, d.gridlines),
    gridColor: r.gridColor === '' ? '' : hex(r.gridColor, ''),
    macroPolicy: pick(r.macroPolicy, ['disable', 'notify', 'enable'], d.macroPolicy),
    trusted: Array.isArray(r.trusted) ? r.trusted.filter((x): x is string => typeof x === 'string' && x.length > 0).map((x) => x.slice(0, 300)).slice(0, 200) : [],
  };
}

export function loadPrefs(): Prefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return clean(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});
  } catch {
    return clean({});
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    return;
  }
}

let current: Prefs | null = null;

export function prefs(): Prefs {
  return (current ??= loadPrefs());
}

export function updatePrefs(patch: Partial<Prefs>): Prefs {
  current = clean({ ...prefs(), ...patch });
  savePrefs(current);
  window.dispatchEvent(new CustomEvent<{ keys: string[] }>(CHANGED, { detail: { keys: Object.keys(patch) } }));
  return current;
}

export function resetPrefs(): void {
  current = clean({});
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('formcel.') || k.startsWith('fc-')) localStorage.removeItem(k);
  } catch {
    return;
  }
}

export function pivotFlags(): string {
  const p = prefs();
  return `${p.pivotGrandRows ? 'r' : ''}${p.pivotGrandCols ? 'c' : ''}${p.pivotSubtotals ? 's' : ''}${p.pivotAuto ? 'a' : ''}`;
}

export const macroPolicy =(): MacroPolicy => prefs().macroPolicy;
export const trustedLocations = (): string[] => prefs().trusted;
export const isTrusted = (path: string): boolean => prefs().trusted.some((t) => path === t || path.startsWith(t.endsWith('/') || t.endsWith('\\') ? t : `${t}/`) || path.startsWith(`${t}\\`));
