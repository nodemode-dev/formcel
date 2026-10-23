import { listCommands, runCommand } from './commands';
import { actions, el, makeModal, type Modal } from './modal';

export type ThemeName = 'dark' | 'light' | 'contrast';
export type TextSize = 'normal' | 'large' | 'xlarge';

interface Prefs {
  theme: ThemeName;
  text: TextSize;
  keys: Record<string, string>;
}

const STORE = 'formcel.prefs';
const prefs: Prefs = { theme: 'dark', text: 'normal', keys: {} };

function load(): void {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return;
    const p = JSON.parse(raw) as Partial<Prefs>;
    if (p.theme === 'light' || p.theme === 'contrast' || p.theme === 'dark') prefs.theme = p.theme;
    if (p.text === 'large' || p.text === 'xlarge' || p.text === 'normal') prefs.text = p.text;
    if (p.keys && typeof p.keys === 'object') prefs.keys = { ...p.keys };
  } catch {
    return;
  }
}

function save(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(prefs));
  } catch {
    return;
  }
}

const PROFILES: Record<'light' | 'contrast', Record<string, string>> = {
  light: {
    '--accent-color': '#ea580c', '--accent-color-dim': '#ea580c26', '--accent-color-hover': '#c2410c',
    '--bg-primary': '#ffffff', '--bg-secondary': '#f3f3f3', '--bg-tertiary': '#e6e6e6', '--bg-node': '#fafafa',
    '--border-color': '#d1d1d1', '--border-light': '#bdbdbd', '--text-primary': '#242424', '--text-secondary': '#444444', '--text-muted': '#616161',
    '--canvas-bg': '#ffffff', '--grid-color': '#a1a1aa', '--cell-grid': '#d4d4d4', '--cell-head-bg': '#f3f3f3', '--cell-head-fg': '#444444',
    '--cell-head-on': '#fed7aa', '--cell-head-on-fg': '#7c2d12', '--cell-select': 'rgba(234, 88, 12, 0.1)', '--cell-select-edge': '#ea580c',
    '--cell-bg': '#ffffff', '--cell-fg': '#242424', '--cell-link': '#0563c1', '--ok': '#15803d', '--warn': '#a16207', '--bad': '#b91c1c',
  },
  contrast: {
    '--accent-color': '#ffd400', '--accent-color-dim': '#ffd40040', '--accent-color-hover': '#ffe566',
    '--bg-primary': '#000000', '--bg-secondary': '#000000', '--bg-tertiary': '#1a1a1a', '--bg-node': '#000000',
    '--border-color': '#ffffff', '--border-light': '#ffffff', '--text-primary': '#ffffff', '--text-secondary': '#ffffff', '--text-muted': '#e6e6e6',
    '--canvas-bg': '#000000', '--grid-color': '#ffffff', '--cell-grid': '#8c8c8c', '--cell-head-bg': '#000000', '--cell-head-fg': '#ffffff',
    '--cell-bg': '#000000', '--cell-fg': '#ffffff', '--cell-select-edge': '#ffd400', '--cell-link': '#5ce1ff', '--ok': '#3dff6e', '--warn': '#ffd400', '--bad': '#ff7b7b',
  },
};

const TOKEN_KEYS = [...new Set([...Object.keys(PROFILES.light), ...Object.keys(PROFILES.contrast)])];
let base: Record<string, string> | null = null;
let baseAttr = '';

export function applyPrefs(): void {
  const root = document.documentElement;
  if (!base) {
    base = Object.fromEntries([...TOKEN_KEYS, 'background', 'color-scheme'].map((k) => [k, root.style.getPropertyValue(k)]));
    baseAttr = root.getAttribute('data-theme') ?? 'dark';
  }
  const prof = prefs.theme === 'dark' ? null : PROFILES[prefs.theme];
  for (const k of TOKEN_KEYS) {
    const v = prof?.[k] ?? base[k];
    if (v) root.style.setProperty(k, v);
    else root.style.removeProperty(k);
  }
  const bg = prof ? prof['--bg-primary'] : base.background;
  if (bg) root.style.background = bg;
  else root.style.removeProperty('background');
  root.style.colorScheme = prefs.theme === 'light' ? 'light' : prefs.theme === 'contrast' ? 'dark' : base['color-scheme'] || 'dark';
  root.setAttribute('data-theme', prefs.theme === 'light' ? 'light' : prefs.theme === 'contrast' ? 'dark' : baseAttr);
  root.classList.toggle('fc-contrast', prefs.theme === 'contrast');
  root.classList.toggle('fc-text-large', prefs.text === 'large');
  root.classList.toggle('fc-text-xlarge', prefs.text === 'xlarge');
}

export function rebaseTheme(): void {
  base = null;
  applyPrefs();
}

export const theme = () => prefs.theme;
export const textSize = () => prefs.text;

export function setTheme(t: ThemeName): void {
  prefs.theme = t;
  save();
  applyPrefs();
}

export function setTextSize(t: TextSize): void {
  prefs.text = t;
  save();
  applyPrefs();
}

export function initPrefs(): void {
  load();
  applyPrefs();
}

export function liveRegion(): (text: string) => void {
  const r = el('div', 'fc-sr-only');
  r.setAttribute('role', 'status');
  r.setAttribute('aria-live', 'polite');
  r.setAttribute('aria-atomic', 'true');
  document.body.appendChild(r);
  let timer = 0;
  return (text) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (r.textContent !== text) r.textContent = text;
    }, 120);
  };
}

const NAMES: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc' };

export function combo(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key));
  return parts.join('+');
}

const pretty = (k: string) => k.replace(/^Mod\+/, /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd+' : 'Ctrl+').replace(/\+Mod\+/, '+Ctrl+');

const GENERAL: [string, string][] = [
  ['Arrow keys', 'Move the active cell'],
  ['Ctrl+Arrow', 'Jump to the edge of the data'],
  ['Home, Ctrl+Home, Ctrl+End', 'First cell in the row, A1, last used cell'],
  ['Page Up, Page Down', 'Move one screen up or down'],
  ['Shift+Arrow, Ctrl+A', 'Extend the selection, select all'],
  ['Enter, Tab', 'Commit an edit and move down or right (Shift reverses)'],
  ['F2', 'Edit the active cell'],
  ['Alt+Enter', 'New line inside a cell while editing'],
  ['Esc', 'Cancel an edit, close a menu or dialog'],
  ['Delete', 'Clear the selected cells'],
  ['Ctrl+C, Ctrl+X, Ctrl+V', 'Copy, cut, paste'],
  ['Ctrl+Z, Ctrl+Y', 'Undo, redo'],
  ['Ctrl+G or F5', 'Go to a cell'],
  ['Ctrl+Shift+L', 'Turn the filter on or off'],
  ['Ctrl+T', 'Create a table'],
  ['Ctrl+9, Ctrl+0', 'Hide rows, hide columns'],
  ['Ctrl+/ or F1', 'This list of shortcuts'],
];

export class Shortcuts {
  private readonly modal: Modal;
  private readonly table = el('table', 'fc-keys');
  private readonly mine = el('ul', 'fc-keys-mine');
  private readonly pick = el('select', 'fc-fmt-input');
  private readonly capture = el('input', 'fc-fmt-input');
  private readonly hint = el('p', 'fc-fmt-hint');
  private combo = '';
  private shown = false;

  constructor() {
    this.modal = makeModal('Keyboard shortcuts', { wide: true });
    const b = this.modal.body;
    this.table.setAttribute('aria-label', 'FormCel shortcuts');
    const mine = el('fieldset', 'fc-page-group');
    mine.appendChild(el('legend', '', 'Your shortcuts'));
    this.capture.readOnly = true;
    this.capture.placeholder = 'Press the keys here';
    this.capture.setAttribute('aria-label', 'New shortcut');
    this.pick.setAttribute('aria-label', 'Command for the new shortcut');
    const add = el('button', 'fc-btn', 'Add shortcut');
    add.type = 'button';
    const row = el('div', 'fc-page-row');
    row.append(this.pick, this.capture, add);
    mine.append(this.mine, row, this.hint);
    b.append(this.table, mine, actions('Close', () => this.modal.close(), () => this.modal.close(), [], ''));
    this.capture.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key === 'Escape') return;
      const c = combo(e);
      if (!c) return;
      e.preventDefault();
      e.stopPropagation();
      this.combo = c;
      this.capture.value = pretty(c);
    });
    add.addEventListener('click', () => {
      if (!this.combo || !this.pick.value) {
        this.hint.textContent = 'Choose a command and press the keys you want.';
        return;
      }
      const used = Object.entries(prefs.keys).find(([id, k]) => k === this.combo && id !== this.pick.value);
      if (used) {
        this.hint.textContent = `${pretty(this.combo)} is already used for ${this.titleOf(used[0])}.`;
        return;
      }
      prefs.keys[this.pick.value] = this.combo;
      save();
      this.combo = '';
      this.capture.value = '';
      this.hint.textContent = 'Saved on this device.';
      this.renderMine();
    });
    this.mine.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-remove]')?.dataset.remove;
      if (!id) return;
      delete prefs.keys[id];
      save();
      this.renderMine();
    });
  }

  private titleOf(id: string): string {
    return listCommands().find((c) => c.id === id)?.title ?? id;
  }

  private fill(): void {
    if (this.shown) return;
    this.shown = true;
    const rows: [string, string][] = [...listCommands().filter((c) => c.keys).map((c): [string, string] => [pretty(c.keys!), c.title]), ...GENERAL];
    const head = el('thead');
    const tr = el('tr');
    tr.append(el('th', '', 'Keys'), el('th', '', 'What it does'));
    head.appendChild(tr);
    const body = el('tbody');
    for (const [k, t] of rows) {
      const r = el('tr');
      r.append(el('td', 'fc-keys-k', k), el('td', '', t));
      body.appendChild(r);
    }
    this.table.append(head, body);
    for (const c of listCommands().sort((a, b) => a.title.localeCompare(b.title))) this.pick.add(new Option(c.title, c.id));
  }

  private renderMine(): void {
    const items = Object.entries(prefs.keys).map(([id, k]) => {
      const li = el('li');
      const rm = el('button', 'fc-btn fc-btn-ghost', 'Remove');
      rm.type = 'button';
      rm.dataset.remove = id;
      rm.setAttribute('aria-label', `Remove shortcut ${pretty(k)} for ${this.titleOf(id)}`);
      li.append(`${this.titleOf(id)}: ${pretty(k)} `, rm);
      return li;
    });
    if (!items.length) items.push(el('li', 'fc-fmt-hint', 'None yet. Pick a command, press the keys, then Add shortcut.'));
    this.mine.replaceChildren(...items);
  }

  show(): void {
    this.fill();
    this.renderMine();
    this.hint.textContent = '';
    this.modal.open();
  }
}

export function bindShortcuts(shortcuts: Shortcuts, gridHas: () => boolean): void {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F1' || ((e.ctrlKey || e.metaKey) && e.key === '/')) {
      e.preventDefault();
      shortcuts.show();
      return;
    }
    const c = combo(e);
    if (!c || !gridHas()) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const hit = Object.entries(prefs.keys).find(([, k]) => k === c);
    if (hit && !document.querySelector('.fc-modal:not([hidden])')) {
      e.preventDefault();
      void runCommand(hit[0]);
    }
  });
}

export interface A11yIssue {
  sheet: number | null;
  level: 'error' | 'warning' | 'tip';
  rule: string;
  where: string;
  text: string;
  fix: string;
  label?: string;
  suggestion?: string;
  areas?: [number, number, number, number][];
  fixes?: [number, number, string][];
}

export interface CheckerHooks {
  fetch(): Promise<A11yIssue[]>;
  go(sheet: number, where: string): void;
  alt(sheet: number, name: string, text: string): void;
  decorative?(sheet: number, name: string): void;
  rename?(sheet: number, name: string): void;
  unmerge?(sheet: number, areas: [number, number, number, number][]): Promise<void> | void;
  contrast?(sheet: number, fixes: [number, number, string][]): Promise<void> | void;
}

const LEVELS: [A11yIssue['level'], string][] = [['error', 'Errors'], ['warning', 'Warnings'], ['tip', 'Tips']];

export class Checker {
  private readonly modal: Modal;
  private readonly list = el('div', 'fc-checker-list');
  private readonly summary = el('p', 'fc-fmt-hint');

  constructor(private readonly hooks: CheckerHooks) {
    this.modal = makeModal('Accessibility Checker', { wide: true });
    this.summary.setAttribute('role', 'status');
    this.modal.body.append(this.summary, this.list, actions('Check again', () => void this.run(), () => this.modal.close(), [], 'Close'));
    this.list.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const goto = t.closest<HTMLElement>('[data-go]');
      if (goto) {
        this.modal.close();
        this.hooks.go(Number(goto.dataset.sheet), goto.dataset.go!);
      }
      const save = t.closest<HTMLElement>('[data-alt]');
      if (save) {
        const input = save.parentElement!.querySelector<HTMLInputElement>('input')!;
        if (input.value.trim()) {
          this.hooks.alt(Number(save.dataset.sheet), save.dataset.alt!, input.value.trim());
          void this.run();
        }
      }
      const fix = t.closest<HTMLElement>('[data-fix]');
      if (fix) void this.apply(fix, e);
    });
  }

  show(): void {
    this.modal.open();
    void this.run();
  }

  private issues: A11yIssue[] = [];

  private async apply(button: HTMLElement, _e: Event): Promise<void> {
    const issue = this.issues[Number(button.dataset.index)];
    if (!issue) return;
    const sheet = issue.sheet ?? 0;
    const kind = button.dataset.fix;
    if (kind === 'decorative') this.hooks.decorative?.(sheet, issue.where);
    else if (kind === 'rename') {
      const name = button.parentElement!.querySelector<HTMLInputElement>('input')!.value.trim();
      if (!name) return;
      this.hooks.rename?.(sheet, name);
    } else if (kind === 'unmerge' && issue.areas) await this.hooks.unmerge?.(sheet, issue.areas);
    else if (kind === 'contrast' && issue.fixes) await this.hooks.contrast?.(sheet, issue.fixes);
    await this.run();
  }

  private action(li: HTMLElement, index: number, i: A11yIssue): void {
    const make = (text: string, fix: string): HTMLButtonElement => {
      const b = el('button', 'fc-btn', text);
      b.type = 'button';
      b.dataset.fix = fix;
      b.dataset.index = String(index);
      return b;
    };
    const row = el('div', 'fc-page-row');
    if (i.rule === 'alt') {
      const input = el('input', 'fc-fmt-input');
      input.setAttribute('aria-label', `Alternative text for ${i.label ?? i.where}`);
      const save = el('button', 'fc-btn', 'Save alt text');
      save.type = 'button';
      save.dataset.alt = i.where;
      save.dataset.sheet = String(i.sheet ?? 0);
      row.append(input, save, make('Mark decorative', 'decorative'));
    } else if (i.rule === 'sheetname') {
      const input = el('input', 'fc-fmt-input');
      input.value = i.suggestion ?? '';
      input.setAttribute('aria-label', `New name for sheet ${i.sheet ?? 0}`);
      row.append(input, make('Rename sheet', 'rename'));
    } else if (i.rule === 'merged' && i.areas?.length) row.append(make('Unmerge cells', 'unmerge'));
    else if (i.rule === 'contrast' && i.fixes?.length) row.append(make('Use readable colours', 'contrast'));
    const go = el('button', 'fc-btn', i.rule === 'alt' ? 'Show' : 'Go to');
    go.type = 'button';
    go.dataset.go = i.where;
    go.dataset.sheet = String(i.sheet ?? 0);
    row.append(go);
    li.appendChild(row);
  }

  private async run(): Promise<void> {
    this.summary.textContent = 'Checking';
    let issues: A11yIssue[];
    try {
      issues = await this.hooks.fetch();
      this.issues = issues;
    } catch {
      this.summary.textContent = 'The check could not run.';
      return;
    }
    const groups: HTMLElement[] = [];
    for (const [level, title] of LEVELS) {
      const mine = issues.filter((i) => i.level === level);
      if (!mine.length) continue;
      const h = el('h3', 'fc-checker-head', `${title} (${mine.length})`);
      const ul = el('ul', `fc-checker-items fc-checker-${level}`);
      for (const i of mine) {
        const li = el('li');
        li.append(el('div', 'fc-checker-text', i.text), el('div', 'fc-fmt-hint', i.fix));
        this.action(li, issues.indexOf(i), i);
        ul.appendChild(li);
      }
      groups.push(h, ul);
    }
    this.list.replaceChildren(...groups);
    this.summary.textContent = issues.length ? `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} found.` : 'No accessibility issues found.';
  }
}
