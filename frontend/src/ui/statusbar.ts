import { engine } from '../engine';
import type { Grid } from '../grid/grid';
import type { Range } from '../grid/a1';
import { runCommand } from './commands';
import { listJobs, onJobs } from './jobs';
import { JobsList } from './jobs-list';
import { ContextMenu, type MenuSpec } from './menubar';

export type ViewMode = 'normal' | 'layout' | 'break';

export interface StatusHooks {
  grid: Grid;
  book(): number;
  sheet(): number;
  viewMode(): ViewMode;
  setViewMode(m: ViewMode): void;
  a11y(): Promise<{ bad: number; tips: number } | null>;
}

type StatKey = 'average' | 'count' | 'numcount' | 'min' | 'max' | 'sum';
type ItemKey = 'cellMode' | 'a11y' | 'caps' | 'num' | 'scroll' | 'page' | 'average' | 'count' | 'numcount' | 'min' | 'max' | 'sum' | 'views' | 'zoomSlider' | 'zoom' | 'engine';

const STORE = 'formcel.statusItems';
const VISIBLE_KEY = 'formcel.statusBar';

const DEFAULTS: Record<ItemKey, boolean> = {
  cellMode: true, a11y: true, caps: true, num: false, scroll: false, page: true,
  average: true, count: true, numcount: false, min: false, max: false, sum: true,
  views: true, zoomSlider: true, zoom: true, engine: true,
};

const MENU: [ItemKey, string][] = [
  ['cellMode', 'Cell Mode'],
  ['a11y', 'Accessibility Checker'],
  ['caps', 'Caps Lock'],
  ['num', 'Num Lock'],
  ['scroll', 'Scroll Lock'],
  ['page', 'Page Number'],
  ['average', 'Average'],
  ['count', 'Count'],
  ['numcount', 'Numerical Count'],
  ['min', 'Minimum'],
  ['max', 'Maximum'],
  ['sum', 'Sum'],
  ['engine', 'Engine Version'],
  ['views', 'View Shortcuts'],
  ['zoomSlider', 'Zoom Slider'],
  ['zoom', 'Zoom'],
];

const STATS: [StatKey, string][] = [['average', 'Average'], ['count', 'Count'], ['numcount', 'Numerical Count'], ['min', 'Minimum'], ['max', 'Maximum'], ['sum', 'Sum']];

const NUM = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const MODE_TEXT = { ready: 'Ready', enter: 'Enter', edit: 'Edit', point: 'Point' } as const;

export function statusBarVisible(): boolean {
  try {
    return localStorage.getItem(VISIBLE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setStatusBarVisible(on: boolean): void {
  document.documentElement.classList.toggle('fc-no-statusbar', !on);
  try {
    localStorage.setItem(VISIBLE_KEY, on ? '1' : '0');
  } catch {
    return;
  }
}

function readItems(): Record<ItemKey, boolean> {
  const out = { ...DEFAULTS };
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Record<ItemKey, unknown>>;
    for (const k of Object.keys(out) as ItemKey[]) if (typeof v[k] === 'boolean') out[k] = v[k] as boolean;
  } catch {
    return out;
  }
  return out;
}

function fmt(n: number): string {
  return Number(n.toPrecision(15)).toLocaleString(undefined, { maximumFractionDigits: 10 });
}

export class StatusBar {
  private readonly items = readItems();
  private readonly menu = new ContextMenu();
  private readonly jobs = new JobsList();
  private readonly mode: HTMLElement;
  private readonly a11yBtn: HTMLButtonElement;
  private readonly a11yText: HTMLElement;
  private readonly caps: HTMLElement;
  private readonly num: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly page: HTMLElement;
  private readonly busy: HTMLButtonElement;
  private readonly busyBar: HTMLElement;
  private readonly busySteps: HTMLElement;
  private readonly engineEl: HTMLElement;
  private readonly statEls = new Map<StatKey, HTMLElement>();
  private readonly views: HTMLElement;
  private readonly zoom: HTMLElement;
  private range: Range | null = null;
  private statRun = 0;
  private statTimer = 0;
  private a11yTimer = 0;
  private a11yRun = 0;
  private busyTimer = 0;
  private busyShownAt = 0;

  constructor(host: HTMLElement, private readonly hooks: StatusHooks) {
    const q = <T extends HTMLElement>(s: string): T => host.querySelector<T>(s)!;
    this.mode = q('.fc-st-mode');
    this.a11yBtn = q<HTMLButtonElement>('.fc-st-a11y');
    this.a11yText = q('.fc-st-a11y-text');
    this.caps = q('.fc-st-caps');
    this.num = q('.fc-st-num');
    this.scroll = q('.fc-st-scroll');
    this.page = q('.fc-st-page');
    this.busy = q<HTMLButtonElement>('.fc-st-busy');
    this.busyBar = q('.fc-st-bar');
    this.busySteps = q('.fc-st-steps');
    this.engineEl = q('.fc-st-engine');
    this.views = q('.fc-st-views');
    this.zoom = q('.fc-zoom');
    for (const [k] of STATS) this.statEls.set(k, q(`[data-stat="${k}"]`));
    this.apply();
    setStatusBarVisible(statusBarVisible());

    const ed = hooks.grid.editor;
    const mode = (): void => this.syncMode();
    for (const ev of ['input', 'keyup', 'keydown', 'pointerup', 'focus', 'blur'] as const) ed.addEventListener(ev, mode);
    new MutationObserver(mode).observe(ed, { attributes: true, attributeFilter: ['hidden', 'style'] });
    hooks.grid.el.addEventListener('keyup', mode);
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === ed) mode();
    });

    const locks = (e: KeyboardEvent | PointerEvent): void => {
      this.setHidden(this.caps, !(e.getModifierState('CapsLock') && this.items.caps));
      this.setHidden(this.num, !(e.getModifierState('NumLock') && this.items.num));
      this.setHidden(this.scroll, !(e.getModifierState('ScrollLock') && this.items.scroll));
    };
    window.addEventListener('keydown', locks, true);
    window.addEventListener('keyup', locks, true);
    window.addEventListener('pointerdown', locks, true);

    this.a11yBtn.addEventListener('click', () => void runCommand('a11y.check'));
    this.busy.addEventListener('click', () => this.jobs.toggle(this.busy));
    onJobs(() => this.syncBusy());
    for (const b of this.views.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      b.addEventListener('click', () => hooks.setViewMode(b.dataset.view as ViewMode));
    }
    document.addEventListener('fc-viewmode', () => this.syncViews());
    host.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.menu.show(e.clientX, e.clientY, this.specs(), true);
    });
    this.syncViews();
    this.syncMode();
  }

  private setHidden(n: HTMLElement, hidden: boolean): void {
    if (n.hidden !== hidden) n.hidden = hidden;
  }

  private specs(): MenuSpec[] {
    return MENU.map(([k, label]): MenuSpec => ({
      label,
      checked: () => this.items[k],
      run: () => {
        this.items[k] = !this.items[k];
        try {
          localStorage.setItem(STORE, JSON.stringify(this.items));
        } catch {
          return;
        }
        this.apply();
        this.queueStats();
        this.syncPage();
      },
    }));
  }

  private apply(): void {
    const it = this.items;
    this.setHidden(this.mode, !it.cellMode);
    this.setHidden(this.a11yBtn, !it.a11y);
    this.setHidden(this.engineEl, !it.engine);
    this.setHidden(this.views, !it.views);
    const slider = this.zoom.querySelector<HTMLElement>('.fc-zoom-slider')!;
    this.setHidden(slider, !it.zoomSlider);
    for (const b of this.zoom.querySelectorAll<HTMLElement>('[data-zoom]')) this.setHidden(b, !it.zoomSlider);
    this.setHidden(this.zoom.querySelector<HTMLElement>('.fc-zoom-val')!, !it.zoom);
  }

  syncMode(): void {
    const t = MODE_TEXT[this.hooks.grid.editorMode()];
    if (this.mode.textContent !== t) this.mode.textContent = t;
  }

  select(range: Range): void {
    this.range = range;
    this.queueStats();
    this.syncPage();
  }

  changed(): void {
    this.queueStats();
    this.touch();
  }

  private queueStats(): void {
    if (this.statTimer) return;
    this.statTimer = window.setTimeout(() => {
      this.statTimer = 0;
      void this.stats();
    }, 80);
  }

  private async stats(): Promise<void> {
    const r = this.range;
    const book = this.hooks.book();
    const run = ++this.statRun;
    const show = (v: Partial<Record<StatKey, number>> | null): void => {
      for (const [k] of STATS) {
        const el = this.statEls.get(k)!;
        const val = v && this.items[k] && v[k] !== undefined ? fmt(v[k] as number) : '';
        const on = val !== '';
        this.setHidden(el, !on);
        const b = el.querySelector<HTMLElement>('b')!;
        if (b.textContent !== val) b.textContent = val;
      }
    };
    if (!r || book < 0) return show(null);
    const cells = (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1);
    if (cells < 2) return show(null);
    const vals = await engine().readValues(book, this.hooks.sheet(), r.r0, r.c0, r.r1, r.c1);
    if (run !== this.statRun) return;
    let count = 0;
    let n = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const [, , raw] of vals) {
      if (raw === '') continue;
      count++;
      if (NUM.test(raw)) {
        const v = Number(raw);
        n++;
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (count === 0) return show(null);
    if (n === 0) return show(count > 1 ? { count } : null);
    show({ average: sum / n, count, numcount: n, min, max, sum });
  }

  private syncPage(): void {
    const view = this.hooks.grid.breakView;
    let text = '';
    if (this.items.page && view && this.hooks.viewMode() !== 'normal') {
      const [ar, ac] = this.hooks.grid.activeCell();
      const at = view.pages.find((p) => ar >= p.r0 && ar <= p.r1 && ac >= p.c0 && ac <= p.c1);
      text = `Page: ${at ? at.n : 1} of ${view.pages.length}`;
    }
    if (this.page.textContent !== text) this.page.textContent = text;
    this.setHidden(this.page, text === '');
  }

  private syncViews(): void {
    const m = this.hooks.viewMode();
    for (const b of this.views.querySelectorAll<HTMLButtonElement>('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === m));
    window.setTimeout(() => this.syncPage(), 60);
  }

  touch(): void {
    window.clearTimeout(this.a11yTimer);
    this.a11yTimer = window.setTimeout(() => void this.checkA11y(), 2500);
  }

  private async checkA11y(): Promise<void> {
    const run = ++this.a11yRun;
    let res: { bad: number; tips: number } | null = null;
    try {
      res = await this.hooks.a11y();
    } catch {
      res = null;
    }
    if (run !== this.a11yRun) return;
    const t = !res ? 'Accessibility: Check' : res.bad === 0 ? 'Accessibility: Good to go' : 'Accessibility: Investigate';
    if (this.a11yText.textContent !== t) this.a11yText.textContent = t;
    this.a11yBtn.dataset.state = !res ? '' : res.bad === 0 ? 'good' : 'bad';
    const tip = res ? `${res.bad} to fix, ${res.tips} tips. Click to open the checker.` : 'Open the accessibility checker.';
    if (this.a11yBtn.title !== tip) this.a11yBtn.title = tip;
  }

  private syncBusy(): void {
    const jobs = listJobs();
    if (jobs.length === 0) {
      window.clearTimeout(this.busyTimer);
      this.busyTimer = 0;
      if (!this.busy.hidden) {
        const wait = Math.max(0, 250 - (Date.now() - this.busyShownAt));
        this.busyTimer = window.setTimeout(() => {
          this.busyTimer = 0;
          if (!listJobs().length) this.setHidden(this.busy, true);
        }, wait);
      }
      return;
    }
    const j = jobs[0];
    const pct = j.total > 0 ? Math.min(100, Math.round((j.done / j.total) * 100)) : 100;
    this.busyBar.style.setProperty('--p', `${pct}%`);
    this.busyBar.classList.toggle('is-indeterminate', j.total <= 0);
    const steps = j.total > 0 ? `${j.done} of ${j.total} · ${pct}%` : jobs.length > 1 ? `${jobs.length} jobs` : j.name;
    if (this.busySteps.textContent !== steps) this.busySteps.textContent = steps;
    if (this.busy.hidden && !this.busyTimer) {
      this.busyTimer = window.setTimeout(() => {
        this.busyTimer = 0;
        if (listJobs().length) {
          this.busyShownAt = Date.now();
          this.setHidden(this.busy, false);
        }
      }, 300);
    }
  }
}
