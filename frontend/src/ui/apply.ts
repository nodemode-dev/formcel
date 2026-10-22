import type { Grid } from '../grid/grid';
import { entryFilter } from './entry';
import { prefs } from './prefs';

const ACCENT_VARS = ['--accent-color', '--accent-color-dim', '--accent-color-hover'];
let base: Record<string, string> | null = null;

export function applyAccent(): void {
  const root = document.documentElement;
  base ??= Object.fromEntries(ACCENT_VARS.map((k) => [k, root.style.getPropertyValue(k)]));
  const a = prefs().accent;
  const contrast = root.classList.contains('fc-contrast');
  if (a && !contrast) {
    root.style.setProperty('--accent-color', a);
    root.style.setProperty('--accent-color-dim', `${a}33`);
    root.style.setProperty('--accent-color-hover', `color-mix(in srgb, ${a} 82%, #ffffff)`);
    return;
  }
  if (contrast) return;
  for (const k of ACCENT_VARS) {
    if (base[k]) root.style.setProperty(k, base[k]);
    else root.style.removeProperty(k);
  }
}

export function applyRoot(): void {
  const p = prefs();
  const root = document.documentElement;
  root.classList.toggle('fc-density-compact', p.density === 'compact');
  root.classList.toggle('fc-density-comfortable', p.density === 'comfortable');
  root.classList.toggle('fc-reduce-motion', p.reduceMotion);
  root.classList.toggle('fc-hide-formulabar', !p.showFormulaBar);
  root.classList.toggle('fc-hide-statusbar', !p.showStatusBar);
  applyAccent();
}

export function applyGrid(grid: Grid): void {
  const p = prefs();
  const o = grid.opts;
  o.fillHandle = p.fillHandle;
  o.dragDrop = p.dragDrop;
  o.enterMove = p.enterMove;
  o.enterDir = p.enterDir;
  o.editInCell = p.editInCell;
  o.gridlines = p.gridlines;
  o.gridColor = p.gridColor;
  o.defaultFont = p.defaultFont;
  o.defaultSize = p.defaultSize;
  o.entryFilter = p.autoDecimal || p.acReplace || p.acSentence || p.acInitials || p.acDays || p.acQuotes ? entryFilter : null;
  grid.editor.spellcheck = p.spellAsYouType;
  grid.editor.lang = p.spellLanguage;
  grid.paint();
}
