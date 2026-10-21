import { icon } from './icons';

export interface WorkbookMeta {
  id: string;
  title: string;
  modified: string;
  sheets: string[];
  preview: string[][];
}

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  featured: boolean;
  source: string;
  sheets: string[];
  rows: number;
  preview: string[][];
}

export interface HomeHooks {
  open(id: string): void;
  create(template?: string): void;
  importFile(file: File): void;
  trash(id: string): void;
  restore(id: string): void;
  purge(id: string): void;
}

type Page = 'start' | 'recent' | 'templates' | 'trash';

const NUMERIC = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('div');
  t.innerHTML = html.trim();
  return t.firstElementChild as T;
}

function setText(n: Element | null, v: string): void {
  if (n && n.textContent !== v) n.textContent = v;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'Edited just now';
  if (s < 3600) return `Edited ${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `Edited ${Math.floor(s / 3600)} h ago`;
  return `Edited ${new Date(iso).toLocaleDateString()}`;
}

function patch<T>(host: HTMLElement, items: T[], key: (t: T) => string, make: (t: T) => HTMLElement, update: (n: HTMLElement, t: T) => void): void {
  const have = new Map<string, HTMLElement>();
  for (const c of [...host.children] as HTMLElement[]) {
    if (c.dataset.key) have.set(c.dataset.key, c);
  }
  const keep = new Set(items.map(key));
  for (const [k, n] of have) if (!keep.has(k)) n.remove();
  let prev: Element | null = null;
  for (const t of items) {
    const k = key(t);
    let n = have.get(k);
    if (!n) {
      n = make(t);
      n.dataset.key = k;
    }
    update(n, t);
    const want: Element | null = prev ? prev.nextElementSibling : host.firstElementChild;
    if (want !== n) host.insertBefore(n, want);
    prev = n;
  }
}

function drawThumb(c: HTMLCanvasElement, grid: string[][]): void {
  const sig = JSON.stringify(grid);
  if (c.dataset.sig === sig) return;
  c.dataset.sig = sig;
  const dpr = window.devicePixelRatio || 1;
  const w = 240;
  const h = 120;
  c.width = w * dpr;
  c.height = h * dpr;
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  g.fillStyle = v('--cell-bg') || '#1c1b1d';
  g.fillRect(0, 0, w, h);
  const rows = 8;
  const cols = 6;
  const rh = h / rows;
  const cw = w / cols;
  g.strokeStyle = v('--border-color') || '#2a2a2a';
  g.lineWidth = 1;
  g.beginPath();
  for (let r = 1; r < rows; r++) { g.moveTo(0, Math.round(r * rh) + 0.5); g.lineTo(w, Math.round(r * rh) + 0.5); }
  for (let k = 1; k < cols; k++) { g.moveTo(Math.round(k * cw) + 0.5, 0); g.lineTo(Math.round(k * cw) + 0.5, h); }
  g.stroke();
  g.font = '9px Inter, system-ui, sans-serif';
  g.textBaseline = 'middle';
  grid.slice(0, rows).forEach((row, r) => row.slice(0, cols).forEach((t, k) => {
    if (!t) return;
    g.save();
    g.beginPath();
    g.rect(k * cw + 1, r * rh, cw - 2, rh);
    g.clip();
    g.fillStyle = r === 0 ? v('--text-primary') : v('--text-secondary');
    const num = NUMERIC.test(t);
    g.textAlign = num ? 'right' : 'left';
    g.fillText(t, num ? (k + 1) * cw - 3 : k * cw + 3, r * rh + rh / 2);
    g.restore();
  }));
}

export class Home {
  private page: Page = 'start';
  private cat = 'Spreadsheets';
  private query = '';
  private templates: TemplateMeta[] = [];
  private cats: { name: string; count: number }[] = [];

  constructor(private readonly root: HTMLElement, private readonly hooks: HomeHooks) {
    const skel = (n: number) => Array.from({ length: n }, (_, i) => `<div class="fc-card is-skeleton" data-key="__s${i}" aria-hidden="true"><span class="fc-thumb"></span><span class="fc-card-body"><span class="fc-card-name">&nbsp;</span><span class="fc-card-meta">&nbsp;</span></span></div>`).join('');
    root.innerHTML = `
      <nav class="fc-home-nav" aria-label="Home">
        <button type="button" class="fc-nav" data-page="start" aria-current="page">${icon('home')}<span>Start</span></button>
        <button type="button" class="fc-nav" data-page="recent">${icon('clock')}<span>Recent</span></button>
        <button type="button" class="fc-nav" data-page="templates">${icon('template')}<span>Templates</span></button>
        <button type="button" class="fc-nav" data-page="trash">${icon('trash')}<span>Trash</span></button>
        <div class="fc-nav-foot">${icon('cloudOff')}<span>Workbooks stay on this computer, in ~/FormCel</span></div>
      </nav>
      <div class="fc-home-body">
        <div data-page="start">
          <header class="fc-home-head"><div><h1 class="fc-home-title">Hello</h1><p class="fc-home-sub">Start a workbook, pick a template, or carry on where you left off.</p></div><div class="fc-home-actions"><button type="button" class="fc-btn" data-a="openfile">${icon('upload')}Open a file</button><button type="button" class="fc-btn fc-btn-primary" data-a="blank">${icon('plus')}Blank workbook</button><input type="file" class="fc-file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" hidden></div></header>
          <section class="fc-home-section"><div class="fc-home-section-head"><h2>Recent workbooks</h2><button type="button" class="fc-btn fc-btn-ghost" data-go="recent">See all</button></div><div class="fc-cards fc-one-row fc-start-recent">${skel(4)}</div><p class="fc-none fc-start-none" hidden>No workbooks yet. Start a blank one or pick a template.</p></section>
          <section class="fc-home-section"><div class="fc-home-section-head"><h2>Spreadsheet templates</h2><button type="button" class="fc-btn fc-btn-ghost" data-go="templates">See all 36</button></div><div class="fc-cards fc-two-rows fc-start-tpl">${skel(8)}</div></section>
        </div>
        <div data-page="recent" hidden>
          <header class="fc-home-head"><div><h1>Recent workbooks</h1><p class="fc-home-sub">Everything in ~/FormCel, newest first. Workbooks save as you type.</p></div></header>
          <div class="fc-cards fc-recent-all"></div><p class="fc-none fc-recent-none" hidden>No workbooks yet.</p>
        </div>
        <div data-page="templates" hidden>
          <header class="fc-home-head"><div><h1>Templates</h1><p class="fc-home-sub">Six spreadsheets made for FormCel, and the data templates and example projects from form.md, each with real rows.</p></div></header>
          <div class="fc-tpl-tools"><div class="fc-chips" role="tablist" aria-label="Categories"></div><label class="fc-search">${icon('search')}<input type="search" class="fc-tpl-q" placeholder="Search templates" aria-label="Search templates"></label></div>
          <div class="fc-cards fc-tpl-all"></div><p class="fc-none fc-tpl-none" hidden>No template matches that search.</p>
        </div>
        <div data-page="trash" hidden>
          <header class="fc-home-head"><div><h1>Trash</h1><p class="fc-home-sub">Workbooks wait here until you restore them or delete them for good.</p></div></header>
          <div class="fc-trash"></div><p class="fc-none fc-trash-none" hidden>The Trash is empty.</p>
        </div>
      </div>`;
    const h = new Date().getHours();
    setText(root.querySelector('.fc-home-title'), h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
    root.addEventListener('click', (e) => this.click(e));
    const file = root.querySelector<HTMLInputElement>('.fc-file')!;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) this.hooks.importFile(f);
    });
    let depth = 0;
    const carries = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    root.addEventListener('dragenter', (e) => {
      if (!carries(e)) return;
      e.preventDefault();
      if (depth++ === 0) root.classList.add('is-dropping');
    });
    root.addEventListener('dragover', (e) => {
      if (carries(e)) e.preventDefault();
    });
    root.addEventListener('dragleave', () => {
      if (depth > 0 && --depth === 0) root.classList.remove('is-dropping');
    });
    root.addEventListener('drop', (e) => {
      if (!carries(e)) return;
      e.preventDefault();
      depth = 0;
      root.classList.remove('is-dropping');
      const f = e.dataTransfer?.files?.[0];
      if (f) this.hooks.importFile(f);
    });
    root.querySelector<HTMLInputElement>('.fc-tpl-q')!.addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value.trim().toLowerCase();
      this.renderTemplates();
    });
  }

  private click(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const nav = t.closest<HTMLElement>('[data-page]');
    if (nav?.classList.contains('fc-nav')) return this.go(nav.dataset.page as Page);
    const go = t.closest<HTMLElement>('[data-go]');
    if (go) return this.go(go.dataset.go as Page);
    const chip = t.closest<HTMLElement>('[data-cat]');
    if (chip) {
      this.cat = chip.dataset.cat!;
      return this.renderTemplates();
    }
    const act = t.closest<HTMLElement>('[data-a]');
    if (!act) return;
    const id = act.closest<HTMLElement>('[data-key]')?.dataset.key ?? '';
    switch (act.dataset.a) {
      case 'blank': return this.hooks.create();
      case 'openfile': return this.root.querySelector<HTMLInputElement>('.fc-file')!.click();
      case 'open': return this.hooks.open(id);
      case 'use': return this.hooks.create(id);
      case 'trash': return this.hooks.trash(id);
      case 'restore': return this.hooks.restore(id);
      case 'purge':
        if (act.dataset.armed) return this.hooks.purge(id);
        act.dataset.armed = '1';
        setText(act, 'Click again to delete');
        window.setTimeout(() => {
          delete act.dataset.armed;
          setText(act, 'Delete for good');
        }, 3000);
        return;
    }
  }

  say(text: string, error = false): void {
    const sub = this.root.querySelector<HTMLElement>('[data-page="start"] .fc-home-sub')!;
    sub.dataset.state = error ? 'error' : text ? 'busy' : '';
    setText(sub, text || 'Start a workbook, pick a template, or carry on where you left off.');
  }

  go(page: Page): void {
    this.page = page;
    for (const n of this.root.querySelectorAll<HTMLElement>('.fc-home-body > [data-page]')) n.hidden = n.dataset.page !== page;
    for (const n of this.root.querySelectorAll<HTMLElement>('.fc-nav')) {
      if (n.dataset.page === page) n.setAttribute('aria-current', 'page');
      else n.removeAttribute('aria-current');
    }
  }

  get current(): Page {
    return this.page;
  }

  private workbookCard = (): HTMLElement =>
    el(`<div class="fc-card"><button type="button" class="fc-card-open" data-a="open"><canvas class="fc-thumb" aria-hidden="true"></canvas><span class="fc-card-body"><span class="fc-card-name"></span><span class="fc-card-meta"></span></span></button><button type="button" class="fc-tool fc-card-more" data-a="trash" title="Move to Trash" aria-label="Move to Trash">${icon('trash')}</button></div>`);

  private updateWorkbook = (n: HTMLElement, w: WorkbookMeta): void => {
    setText(n.querySelector('.fc-card-name'), w.title);
    setText(n.querySelector('.fc-card-meta'), `${ago(w.modified)} · ${w.sheets.length} ${w.sheets.length === 1 ? 'sheet' : 'sheets'}`);
    drawThumb(n.querySelector('canvas')!, w.preview);
  };

  setWorkbooks(list: WorkbookMeta[]): void {
    patch(this.root.querySelector('.fc-start-recent')!, list.slice(0, 4), (w) => w.id, this.workbookCard, this.updateWorkbook);
    patch(this.root.querySelector('.fc-recent-all')!, list, (w) => w.id, this.workbookCard, this.updateWorkbook);
    this.root.querySelector<HTMLElement>('.fc-start-none')!.hidden = list.length > 0;
    this.root.querySelector<HTMLElement>('.fc-recent-none')!.hidden = list.length > 0;
  }

  private templateCard = (): HTMLElement =>
    el(`<div class="fc-card"><button type="button" class="fc-card-open" data-a="use"><canvas class="fc-thumb" aria-hidden="true"></canvas><span class="fc-card-body"><span class="fc-card-name"></span><span class="fc-card-meta"></span></span></button></div>`);

  private updateTemplate = (n: HTMLElement, t: TemplateMeta): void => {
    setText(n.querySelector('.fc-card-name'), t.name);
    setText(n.querySelector('.fc-card-meta'), `${t.sheets.length} ${t.sheets.length === 1 ? 'sheet' : 'sheets'} · ${t.rows} rows${t.source === 'form.md' ? ' · from form.md' : ''}`);
    n.querySelector('.fc-card-open')!.setAttribute('title', t.description);
    drawThumb(n.querySelector('canvas')!, t.preview);
  };

  setTemplates(cats: { name: string; count: number }[], list: TemplateMeta[]): void {
    this.cats = cats;
    this.templates = list;
    patch(this.root.querySelector('.fc-start-tpl')!, list.filter((t) => t.category === 'Spreadsheets' || t.featured).slice(0, 8), (t) => t.id, this.templateCard, this.updateTemplate);
    setText(this.root.querySelector('[data-go="templates"]'), `See all ${list.length}`);
    this.renderTemplates();
  }

  private renderTemplates(): void {
    patch(this.root.querySelector('.fc-chips')!, this.cats, (c) => c.name,
      () => el('<button type="button" class="fc-chip" role="tab"></button>'),
      (n, c) => {
        n.dataset.cat = c.name;
        setText(n, `${c.name} ${c.count}`);
        n.setAttribute('aria-selected', String(c.name === this.cat));
      });
    const q = this.query;
    const shown = this.templates.filter((t) => (q ? `${t.name} ${t.description} ${t.tags.join(' ')} ${t.category}`.toLowerCase().includes(q) : t.category === this.cat));
    patch(this.root.querySelector('.fc-tpl-all')!, shown, (t) => t.id, this.templateCard, this.updateTemplate);
    this.root.querySelector<HTMLElement>('.fc-tpl-none')!.hidden = shown.length > 0;
  }

  setTrash(list: WorkbookMeta[]): void {
    patch(this.root.querySelector('.fc-trash')!, list, (w) => w.id,
      () => el(`<div class="fc-trash-row"><span class="fc-trash-name"></span><span class="fc-trash-meta"></span><button type="button" class="fc-btn" data-a="restore">${icon('restore')}Restore</button><button type="button" class="fc-btn fc-btn-danger" data-a="purge">Delete for good</button></div>`),
      (n, w) => {
        setText(n.querySelector('.fc-trash-name'), w.title);
        setText(n.querySelector('.fc-trash-meta'), ago(w.modified));
      });
    this.root.querySelector<HTMLElement>('.fc-trash-none')!.hidden = list.length > 0;
  }
}
