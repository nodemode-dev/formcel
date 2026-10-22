import { icon, type IconName } from './icons';
import { MARGIN_PRESETS, PAPERS, type PageSetup, type Scale } from './pagesetup';
import { setTheme, theme, type ThemeName } from './a11y';
import { runCommand } from './commands';
import { VERSION } from '../version';

export interface BackstageHost {
  current(): { id: string; title: string; sheets: string[]; sheet: number; macros: boolean } | null;
  settle(): Promise<void>;
  openWorkbook(id: string): void;
  create(template?: string): void;
  importFile(file: File): void;
  page(sheet: number): PageSetup;
  setPage(sheet: number, page: PageSetup): Promise<void>;
  closed(): void;
}

export type PaneId = 'home' | 'new' | 'open' | 'info' | 'save' | 'saveas' | 'copy' | 'print' | 'share' | 'export' | 'publish' | 'close' | 'account';

interface Meta {
  id: string;
  title: string;
  modified: string;
  sheets: string[];
  preview: string[][];
}

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  featured: boolean;
  sheets: string[];
  rows: number;
  preview: string[][];
}

interface Pane {
  el: HTMLElement;
  update(): void | Promise<void>;
}

interface Fmt {
  id: string;
  label: string;
  ext: string;
  desc: string;
  scope: 'none' | 'sheet' | 'either';
}

const FORMATS: Fmt[] = [
  { id: 'xlsx', label: 'Excel Workbook', ext: 'xlsx', desc: 'Every sheet with formulas, formats, charts and tables. Opens in Excel and anything that reads .xlsx.', scope: 'none' },
  { id: 'xlsm', label: 'Excel Macro-Enabled Workbook', ext: 'xlsm', desc: 'The workbook with the macros it was opened with. FormCel keeps them but does not run them.', scope: 'none' },
  { id: 'ods', label: 'OpenDocument Spreadsheet', ext: 'ods', desc: 'For LibreOffice and other open-format spreadsheets.', scope: 'none' },
  { id: 'pdf', label: 'PDF', ext: 'pdf', desc: 'Laid out with the sheet\'s Page Setup: paper, orientation, margins, scaling and headers.', scope: 'either' },
  { id: 'html', label: 'Web Page', ext: 'html', desc: 'Values, basic formatting and merged cells as an .html page.', scope: 'either' },
  { id: 'csv', label: 'CSV (Comma delimited)', ext: 'csv', desc: 'The values of one sheet as shown, separated by commas.', scope: 'sheet' },
  { id: 'tsv', label: 'Text (Tab delimited)', ext: 'tsv', desc: 'The values of one sheet as shown, separated by tabs.', scope: 'sheet' },
  { id: 'fcel', label: 'FormCel Workbook', ext: 'fcel', desc: 'FormCel\'s own file, with everything including collaboration history. Open it again from Open > Browse.', scope: 'none' },
];

const NUMERIC = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function setText(n: Element | null, v: string): void {
  if (n && n.textContent !== v) n.textContent = v;
}

function button(label: string, cls = 'fc-btn', run?: () => void, ic?: IconName): HTMLButtonElement {
  const b = h('button', cls);
  b.type = 'button';
  if (ic) b.insertAdjacentHTML('afterbegin', icon(ic));
  b.append(label);
  if (run) b.addEventListener('click', run);
  return b;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.json().then((j: { detail?: string }) => j.detail ?? `HTTP ${r.status}`).catch(() => `HTTP ${r.status}`));
  return (r.status === 204 ? null : await r.json()) as T;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function drawThumb(c: HTMLCanvasElement, grid: string[][]): void {
  const sig = JSON.stringify(grid);
  if (c.dataset.sig === sig) return;
  c.dataset.sig = sig;
  const dpr = window.devicePixelRatio || 1;
  const w = 240;
  const hh = 120;
  c.width = w * dpr;
  c.height = hh * dpr;
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  g.fillStyle = v('--cell-bg') || '#1c1b1d';
  g.fillRect(0, 0, w, hh);
  const rows = 8;
  const cols = 6;
  const rh = hh / rows;
  const cw = w / cols;
  g.strokeStyle = v('--cell-grid') || '#2a2a2a';
  g.beginPath();
  for (let r = 1; r < rows; r++) { g.moveTo(0, Math.round(r * rh) + 0.5); g.lineTo(w, Math.round(r * rh) + 0.5); }
  for (let k = 1; k < cols; k++) { g.moveTo(Math.round(k * cw) + 0.5, 0); g.lineTo(Math.round(k * cw) + 0.5, hh); }
  g.stroke();
  g.font = '9px "Aptos Narrow", Calibri, Carlito, Inter, system-ui, sans-serif';
  g.textBaseline = 'middle';
  grid.slice(0, rows).forEach((row, r) => row.slice(0, cols).forEach((t, k) => {
    if (!t) return;
    g.save();
    g.beginPath();
    g.rect(k * cw + 1, r * rh, cw - 2, rh);
    g.clip();
    g.fillStyle = r === 0 ? v('--cell-fg') : v('--text-secondary');
    const num = NUMERIC.test(t);
    g.textAlign = num ? 'right' : 'left';
    g.fillText(t, num ? (k + 1) * cw - 3 : k * cw + 3, r * rh + rh / 2);
    g.restore();
  }));
}

function patch<T>(host: HTMLElement, items: T[], key: (t: T) => string, make: (t: T) => HTMLElement, update: (n: HTMLElement, t: T) => void): void {
  const have = new Map<string, HTMLElement>();
  for (const c of [...host.children] as HTMLElement[]) if (c.dataset.key) have.set(c.dataset.key, c);
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

function section(title: string, sub = ''): { el: HTMLElement; head: HTMLElement } {
  const el = h('div', 'fc-bs-pane');
  const head = h('header', 'fc-bs-head');
  head.append(h('h1', '', title));
  if (sub) head.append(h('p', 'fc-bs-sub', sub));
  el.append(head);
  return { el, head };
}

function select(options: [string, string][], value: string, on: (v: string) => void): HTMLSelectElement {
  const s = h('select', 'fc-bs-select');
  for (const [v, t] of options) s.append(new Option(t, v));
  s.value = value;
  s.addEventListener('change', () => on(s.value));
  return s;
}

function row(label: string, control: HTMLElement): HTMLElement {
  const r = h('label', 'fc-bs-field');
  r.append(h('span', '', label), control);
  return r;
}

const MENU: { id: PaneId | 'back' | 'options'; label: string; icon: IconName; needs?: boolean; sep?: boolean; foot?: boolean }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'new', label: 'New', icon: 'bsNew' },
  { id: 'open', label: 'Open', icon: 'bsOpen', sep: true },
  { id: 'info', label: 'Info', icon: 'bsInfo', needs: true },
  { id: 'save', label: 'Save', icon: 'bsSave', needs: true },
  { id: 'saveas', label: 'Save As', icon: 'bsSaveAs', needs: true },
  { id: 'copy', label: 'Save a Copy', icon: 'bsCopy', needs: true },
  { id: 'print', label: 'Print', icon: 'bsPrint', needs: true },
  { id: 'share', label: 'Share', icon: 'share', needs: true },
  { id: 'export', label: 'Export', icon: 'bsExport', needs: true },
  { id: 'publish', label: 'Publish', icon: 'bsGlobe', needs: true },
  { id: 'close', label: 'Close', icon: 'bsClose', needs: true },
  { id: 'account', label: 'Account', icon: 'bsUser', foot: true },
  { id: 'options', label: 'Options', icon: 'bsGear' },
];

export class Backstage {
  readonly root: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly body: HTMLElement;
  private readonly panes = new Map<PaneId, Pane>();
  private pane: PaneId = 'home';
  private recent: Meta[] = [];
  private library: Meta[] = [];
  private templates: Template[] = [];
  private cats: { name: string; count: number }[] = [];
  private cat = 'Spreadsheets';
  private query = '';
  private lib = '';
  private openTab: 'recent' | 'library' | 'browse' = 'recent';
  private fmt = 'xlsx';
  private scope: 'sheet' | 'all' = 'sheet';
  private sheet = 0;
  private fname = '';
  private notes = new Map<string, HTMLElement>();
  private previewTimer = 0;
  private previewPage = 0;
  private previewPages = 1;
  private previewGen = 0;
  private printScope: 'sheet' | 'all' = 'sheet';
  private printFrom = 0;
  private printTo = 0;
  private busy = false;

  constructor(parent: HTMLElement, private readonly host: BackstageHost) {
    this.root = h('div', 'fc-backstage');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'File');
    this.rail = h('nav', 'fc-bs-rail');
    this.rail.setAttribute('aria-label', 'File');
    const back = button('', 'fc-bs-back', () => this.hide());
    back.title = 'Back (Esc)';
    back.setAttribute('aria-label', 'Back');
    back.insertAdjacentHTML('afterbegin', icon('bsBack'));
    this.rail.append(back);
    const foot = h('div', 'fc-bs-foot');
    for (const m of MENU) {
      const b = h('button', 'fc-bs-item');
      b.type = 'button';
      b.dataset.id = m.id;
      b.insertAdjacentHTML('afterbegin', icon(m.icon));
      b.append(h('span', '', m.label));
      b.addEventListener('click', () => this.choose(m.id as PaneId | 'options'));
      if (m.sep) this.rail.append(b, h('div', 'fc-bs-sep'));
      else if (m.foot) {
        foot.append(b);
      } else if (m.id === 'options') foot.append(b);
      else this.rail.append(b);
    }
    this.rail.append(foot);
    this.body = h('div', 'fc-bs-body');
    this.root.append(this.rail, this.body);
    parent.append(this.root);
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || document.querySelector('.fc-modal:not([hidden])') || document.querySelector('.fc-pw:not([hidden])')) return;
      e.preventDefault();
      e.stopPropagation();
      this.hide();
    });
    document.addEventListener('keydown', (e) => {
      if (document.querySelector('.fc-modal:not([hidden])') || e.altKey || e.shiftKey) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const pane: PaneId | null = mod && key === 'o' ? 'open' : mod && key === 'p' && this.host.current() ? 'print' : !mod && e.key === 'F12' && this.host.current() ? 'saveas' : null;
      if (!pane) return;
      e.preventDefault();
      this.show(pane);
    });
    const file = h('input');
    file.type = 'file';
    file.hidden = true;
    file.accept = '.xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt,.html,.htm,.pdf,.fcel';
    file.className = 'fc-bs-file';
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) {
        this.hide(false);
        this.host.importFile(f);
      }
    });
    this.root.append(file);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(pane?: PaneId): void {
    const open = !!this.host.current();
    const first = pane ?? (open ? 'info' : 'home');
    this.root.hidden = false;
    this.go(first === 'home' || first === 'new' || first === 'open' || first === 'account' || open ? first : 'home');
    void this.reload();
    this.rail.querySelector<HTMLElement>(`[data-id="${this.pane}"]`)?.focus();
  }

  hide(refocus = true): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    window.clearTimeout(this.previewTimer);
    if (refocus) this.host.closed();
  }

  private choose(id: PaneId | 'options'): void {
    if (id === 'options') {
      void runCommand('app.settings').then((ok) => {
        if (ok) this.hide(false);
        else this.noteOn(this.pane, 'Options are not available in this build.', true);
      });
      return;
    }
    if (id === 'save') return void this.quickSave();
    if (id === 'close') return void this.closeWorkbook();
    this.go(id);
  }

  private async quickSave(): Promise<void> {
    await this.host.settle();
    this.hide();
  }

  private async closeWorkbook(): Promise<void> {
    await this.host.settle();
    this.hide(false);
    void runCommand('file.home');
  }

  private go(id: PaneId): void {
    if (id !== this.pane || this.root.hidden) {
      if (id === 'saveas' || id === 'copy' || id === 'export') {
        this.fmt = id === 'export' ? 'pdf' : id === 'copy' ? 'library' : 'xlsx';
        this.fname = '';
      }
    }
    this.pane = id;
    const open = !!this.host.current();
    for (const b of this.rail.querySelectorAll<HTMLButtonElement>('.fc-bs-item')) {
      const m = MENU.find((x) => x.id === b.dataset.id);
      b.disabled = !!m?.needs && !open;
      if (b.dataset.id === id) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    let p = this.panes.get(id);
    if (!p) {
      p = this.build(id);
      this.panes.set(id, p);
      this.body.append(p.el);
    }
    for (const [k, v] of this.panes) v.el.hidden = k !== id;
    void p.update();
    if (id === 'print') this.queuePreview(0);
  }

  private async reload(): Promise<void> {
    try {
      const [list, tpl] = await Promise.all([
        api<Meta[]>('GET', '/workbooks'),
        this.templates.length ? Promise.resolve(null) : api<{ categories: { name: string; count: number }[]; templates: Template[] }>('GET', '/templates'),
      ]);
      this.library = list;
      this.recent = [...list].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
      if (tpl) {
        this.templates = tpl.templates;
        this.cats = tpl.categories;
      }
    } catch {
      return;
    }
    if (this.root.hidden) return;
    for (const b of this.rail.querySelectorAll<HTMLButtonElement>('.fc-bs-item')) {
      const m = MENU.find((x) => x.id === b.dataset.id);
      b.disabled = !!m?.needs && !this.host.current();
    }
    const p = this.panes.get(this.pane);
    if (p) void p.update();
  }

  private noteOn(id: string, text: string, bad = false): void {
    const n = this.notes.get(id);
    if (!n) return;
    n.dataset.state = bad ? 'error' : text ? 'ok' : '';
    setText(n, text);
  }

  private note(id: string): HTMLElement {
    const n = h('p', 'fc-bs-note');
    n.setAttribute('role', 'status');
    n.setAttribute('aria-live', 'polite');
    this.notes.set(id, n);
    return n;
  }

  private build(id: PaneId): Pane {
    switch (id) {
      case 'home': return this.buildHome();
      case 'new': return this.buildNew();
      case 'open': return this.buildOpen();
      case 'info': return this.buildInfo();
      case 'saveas': return this.buildFormats('saveas');
      case 'copy': return this.buildFormats('copy');
      case 'export': return this.buildFormats('export');
      case 'print': return this.buildPrint();
      case 'share': return this.buildShare('share');
      case 'publish': return this.buildShare('publish');
      case 'account': return this.buildAccount();
      default: return this.buildHome();
    }
  }

  private workbookRow(): HTMLElement {
    const r = h('button', 'fc-bs-wrow');
    r.type = 'button';
    r.insertAdjacentHTML('afterbegin', icon('sheet'));
    const t = h('span', 'fc-bs-wtext');
    t.append(h('span', 'fc-bs-wname'), h('span', 'fc-bs-wmeta'));
    r.append(t, h('span', 'fc-bs-wwhen'));
    r.addEventListener('click', () => {
      this.hide(false);
      this.host.openWorkbook(r.dataset.key!);
    });
    return r;
  }

  private updateWorkbookRow = (n: HTMLElement, w: Meta): void => {
    setText(n.querySelector('.fc-bs-wname'), w.title);
    setText(n.querySelector('.fc-bs-wmeta'), `${w.sheets.length} ${w.sheets.length === 1 ? 'sheet' : 'sheets'}: ${w.sheets.slice(0, 3).join(', ')}${w.sheets.length > 3 ? '...' : ''}`);
    setText(n.querySelector('.fc-bs-wwhen'), ago(w.modified));
  };

  private tplCard(blank = false): HTMLElement {
    const c = h('button', 'fc-bs-card');
    c.type = 'button';
    if (blank) {
      const t = h('span', 'fc-bs-blank');
      t.insertAdjacentHTML('afterbegin', icon('plus'));
      c.append(t);
    } else c.append(h('canvas', 'fc-bs-thumb'));
    const body = h('span', 'fc-bs-cbody');
    body.append(h('span', 'fc-bs-cname'), h('span', 'fc-bs-cmeta'));
    c.append(body);
    c.addEventListener('click', () => {
      this.hide(false);
      this.host.create(blank ? undefined : c.dataset.key);
    });
    return c;
  }

  private updateTplCard = (n: HTMLElement, t: Template): void => {
    setText(n.querySelector('.fc-bs-cname'), t.name);
    setText(n.querySelector('.fc-bs-cmeta'), `${t.sheets.length} ${t.sheets.length === 1 ? 'sheet' : 'sheets'} · ${t.rows} rows`);
    n.title = t.description;
    const cv = n.querySelector('canvas');
    if (cv) drawThumb(cv, t.preview);
  };

  private buildHome(): Pane {
    const { el } = section('', '');
    const head = el.querySelector('header')!;
    head.replaceChildren(h('h1', 'fc-bs-greet'));
    const hour = new Date().getHours();
    head.firstElementChild!.textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const newHead = h('h2', 'fc-bs-h2', 'New');
    const cards = h('div', 'fc-bs-cards fc-bs-one');
    const blank = this.tplCard(true);
    blank.dataset.key = '__blank';
    setText(blank.querySelector('.fc-bs-cname'), 'Blank workbook');
    setText(blank.querySelector('.fc-bs-cmeta'), 'Start from an empty sheet');
    cards.append(blank);
    const more = button('More templates', 'fc-btn fc-btn-ghost', () => this.go('new'), 'bsRight');
    const recentHead = h('h2', 'fc-bs-h2', 'Recent');
    const list = h('div', 'fc-bs-wlist');
    const none = h('p', 'fc-bs-none', 'No workbooks yet. Start a blank one or pick a template.');
    const nh = h('div', 'fc-bs-rowhead');
    nh.append(newHead, more);
    el.append(nh, cards, recentHead, list, none);
    return {
      el,
      update: () => {
        const feat = this.templates.filter((t) => t.featured || t.category === 'Spreadsheets').slice(0, 5);
        const have = [...cards.children].filter((c) => (c as HTMLElement).dataset.key !== '__blank');
        for (const c of have) if (!feat.find((t) => t.id === (c as HTMLElement).dataset.key)) c.remove();
        for (const t of feat) {
          let c = [...cards.children].find((x) => (x as HTMLElement).dataset.key === t.id) as HTMLElement | undefined;
          if (!c) {
            c = this.tplCard();
            c.dataset.key = t.id;
            cards.append(c);
          }
          this.updateTplCard(c, t);
        }
        patch(list, this.recent.slice(0, 8), (w) => w.id, () => this.workbookRow(), this.updateWorkbookRow);
        none.hidden = this.recent.length > 0;
      },
    };
  }

  private buildNew(): Pane {
    const { el } = section('New', 'Start from a blank workbook or a template with real rows.');
    const tools = h('div', 'fc-bs-tools');
    const chips = h('div', 'fc-bs-chips');
    const q = h('input', 'fc-bs-search');
    q.type = 'search';
    q.placeholder = 'Search templates';
    q.setAttribute('aria-label', 'Search templates');
    q.addEventListener('input', () => {
      this.query = q.value.trim().toLowerCase();
      void paneRef.update();
    });
    tools.append(chips, q);
    const grid = h('div', 'fc-bs-cards');
    const blank = this.tplCard(true);
    setText(blank.querySelector('.fc-bs-cname'), 'Blank workbook');
    setText(blank.querySelector('.fc-bs-cmeta'), 'Start from an empty sheet');
    const cards = h('div', 'fc-bs-contents');
    grid.append(blank, cards);
    const none = h('p', 'fc-bs-none', 'No template matches that search.');
    el.append(tools, grid, none);
    const paneRef: Pane = {
      el,
      update: () => {
        patch(chips, this.cats, (c) => c.name, () => {
          const b = h('button', 'fc-bs-chip');
          b.type = 'button';
          b.addEventListener('click', () => {
            this.cat = b.dataset.key!;
            q.value = '';
            this.query = '';
            void paneRef.update();
          });
          return b;
        }, (n, c) => {
          setText(n, `${c.name} ${c.count}`);
          n.setAttribute('aria-pressed', String(c.name === this.cat && !this.query));
        });
        const shown = this.templates.filter((t) => (this.query ? `${t.name} ${t.description} ${t.tags.join(' ')} ${t.category}`.toLowerCase().includes(this.query) : t.category === this.cat));
        patch(cards, shown, (t) => t.id, () => this.tplCard(), this.updateTplCard);
        none.hidden = shown.length > 0;
        blank.hidden = !!this.query;
      },
    };
    return paneRef;
  }

  private buildOpen(): Pane {
    const { el } = section('Open', 'Pick up where you left off, browse the library, or open a file from this computer.');
    const tabs = h('div', 'fc-bs-tabs');
    tabs.setAttribute('role', 'tablist');
    const defs: ['recent' | 'library' | 'browse', string][] = [['recent', 'Recent'], ['library', 'Library'], ['browse', 'Browse']];
    for (const [id, label] of defs) {
      const b = button(label, 'fc-bs-tab', () => {
        this.openTab = id;
        void ref.update();
      });
      b.dataset.tab = id;
      b.setAttribute('role', 'tab');
      tabs.append(b);
    }
    const search = h('input', 'fc-bs-search');
    search.type = 'search';
    search.placeholder = 'Search the library';
    search.setAttribute('aria-label', 'Search the library');
    search.addEventListener('input', () => {
      this.lib = search.value.trim().toLowerCase();
      void ref.update();
    });
    const list = h('div', 'fc-bs-wlist');
    const none = h('p', 'fc-bs-none', 'No workbooks here yet.');
    const browse = h('div', 'fc-bs-browse');
    const big = button('Browse for a file', 'fc-btn fc-btn-primary', () => this.root.querySelector<HTMLInputElement>('.fc-bs-file')!.click(), 'bsOpen');
    browse.append(big, h('p', 'fc-bs-sub', 'Opens .xlsx, .xlsm, .xls, .ods, .csv, .tsv, .txt, .html, .pdf and .fcel files. Drop a file here, or use the button.'));
    for (const t of ['dragenter', 'dragover']) browse.addEventListener(t, (e) => { e.preventDefault(); browse.classList.add('is-dropping'); });
    for (const t of ['dragleave', 'drop']) browse.addEventListener(t, () => browse.classList.remove('is-dropping'));
    browse.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = (e as DragEvent).dataTransfer?.files?.[0];
      if (f) {
        this.hide(false);
        this.host.importFile(f);
      }
    });
    el.append(tabs, search, list, none, browse);
    const ref: Pane = {
      el,
      update: () => {
        for (const b of tabs.children) b.setAttribute('aria-selected', String((b as HTMLElement).dataset.tab === this.openTab));
        const src = this.openTab === 'recent' ? this.recent.slice(0, 12) : this.openTab === 'library' ? this.library.filter((w) => !this.lib || w.title.toLowerCase().includes(this.lib)).sort((a, b) => a.title.localeCompare(b.title)) : [];
        search.hidden = this.openTab !== 'library';
        browse.hidden = this.openTab !== 'browse';
        list.hidden = this.openTab === 'browse';
        patch(list, src, (w) => w.id, () => this.workbookRow(), this.updateWorkbookRow);
        none.hidden = this.openTab === 'browse' || src.length > 0;
      },
    };
    return ref;
  }

  private buildInfo(): Pane {
    const { el } = section('Info');
    const title = h('h2', 'fc-bs-doctitle');
    const where = h('p', 'fc-bs-sub');
    el.querySelector('header')!.append(title, where);
    const cols = h('div', 'fc-bs-cols');
    const left = h('div', 'fc-bs-colmain');
    const right = h('aside', 'fc-bs-props');
    cols.append(left, right);
    el.append(cols);

    const block = (ic: IconName, name: string): { box: HTMLElement; text: HTMLElement; actions: HTMLElement } => {
      const box = h('section', 'fc-bs-block');
      const icBox = h('div', 'fc-bs-bicon');
      icBox.insertAdjacentHTML('afterbegin', icon(ic));
      const t = h('div', 'fc-bs-btext');
      t.append(h('h3', '', name));
      const text = h('p', '');
      const actions = h('div', 'fc-bs-actions');
      t.append(text, actions);
      box.append(icBox, t);
      left.append(box);
      return { box, text, actions };
    };
    const run = (id: string) => () => void runCommand(id).then(() => this.hide(false));
    const prot = block('bsShield', 'Protect Workbook');
    setText(prot.text, 'Control what people can do with this workbook: mark it as final, lock its structure, or protect a sheet.');
    prot.actions.append(button('Mark as Final', 'fc-btn', run('protect.final')), button('Protect Structure', 'fc-btn', run('protect.book')), button('Protect Current Sheet', 'fc-btn', run('protect.sheet')), button('Encrypt with Password', 'fc-btn', run('file.download-xlsx-password')));
    const insp = block('bsInspect', 'Inspect Workbook');
    const found = h('span', 'fc-bs-found');
    insp.text.append(found);
    insp.actions.append(button('Check Accessibility', 'fc-btn', run('a11y.check')), button('Document Properties', 'fc-btn', run('file.properties')), button('Check for Errors', 'fc-btn', run('errors.menu')));
    const ver = block('clock', 'Version History');
    const vlist = h('ul', 'fc-bs-versions');
    ver.text.append(vlist);
    ver.actions.append(button('Save a Version Now', 'fc-btn', () => void this.saveVersion(ver.box)), button('Open Version History', 'fc-btn', run('history.panel')));
    const man = block('bsLayers', 'Manage Workbook');
    setText(man.text, 'Keep a template of this workbook, or move it to the Trash. Workbooks save as you type, so there is nothing to recover.');
    man.actions.append(button('Save as Template', 'fc-btn', run('file.save-template')), button('Move to Trash', 'fc-btn fc-btn-danger', () => void this.trashCurrent()));
    left.append(this.note('info'));

    const propRows: [string, string][] = [['Sheets', 'sheets'], ['Cells with data', 'cells'], ['Formulas', 'formulas'], ['Names', 'names'], ['Tables', 'tables'], ['Notes', 'notes'], ['Macros', 'macros'], ['Last modified', 'modified'], ['Created', 'created'], ['Title', 'title'], ['Author', 'author'], ['Tags', 'tags']];
    right.append(h('h3', '', 'Properties'));
    const dl = h('dl', 'fc-bs-dl');
    for (const [label, k] of propRows) {
      const dt = h('dt', '', label);
      const dd = h('dd');
      dd.dataset.k = k;
      dl.append(dt, dd);
    }
    right.append(dl, button('Show All Properties', 'fc-btn fc-btn-ghost', run('file.properties')));

    return {
      el,
      update: async () => {
        const cur = this.host.current();
        if (!cur) return;
        setText(title, cur.title);
        setText(where, `Library · ${cur.title}.fcel`);
        const set = (k: string, v: string) => setText(dl.querySelector(`[data-k="${k}"]`), v || 'Not set');
        set('macros', cur.macros ? 'Yes (kept, not run)' : 'None');
        try {
          const [props, a11y, vers] = await Promise.all([
            api<{ props: Record<string, string>; created: string; modified: string; title: string; stats: Record<string, number> }>('GET', `/workbooks/${cur.id}/properties`),
            api<{ level: string }[]>('GET', `/workbooks/${cur.id}/accessibility`),
            api<{ versions: { id: string; time: string; name: string; why: string }[] }>('GET', `/workbooks/${cur.id}/versions`),
          ]);
          for (const k of ['sheets', 'cells', 'formulas', 'names', 'tables', 'notes']) set(k, String(props.stats[k] ?? 0));
          set('modified', new Date(props.modified).toLocaleString());
          set('created', new Date(props.created).toLocaleString());
          set('title', props.props.title || props.title);
          set('author', props.props.author ?? '');
          set('tags', props.props.tags ?? '');
          const n = (l: string) => a11y.filter((x) => x.level === l).length;
          setText(found, a11y.length ? `Accessibility: ${n('error')} errors, ${n('warning')} warnings, ${n('tip')} tips. Run the checker to see where.` : 'Accessibility: no issues found.');
          patch(vlist, vers.versions.slice(0, 5), (v) => v.id, () => h('li'), (li, v) => setText(li, `${new Date(v.time).toLocaleString()}${v.name ? ` · ${v.name}` : ''}${v.why === 'autosave' ? ' · autosave' : ''}`));
          if (!vers.versions.length) setText(vlist, 'No earlier versions yet.');
        } catch (e) {
          this.noteOn('info', e instanceof Error ? e.message : 'Could not read the workbook details.', true);
        }
      },
    };
  }

  private async saveVersion(host: HTMLElement): Promise<void> {
    const cur = this.host.current();
    if (!cur) return;
    await this.host.settle();
    try {
      await api('POST', `/workbooks/${cur.id}/versions`, { name: 'Saved from File' });
      this.noteOn('info', 'Version saved.');
      await this.panes.get('info')?.update();
    } catch (e) {
      this.noteOn('info', e instanceof Error ? e.message : 'The version was not saved.', true);
    }
    host.focus();
  }

  private async trashCurrent(): Promise<void> {
    const cur = this.host.current();
    if (!cur) return;
    const ok = window.confirm(`Move "${cur.title}" to the Trash? You can restore it from Home.`);
    if (!ok) return;
    await this.host.settle();
    try {
      await api('DELETE', `/workbooks/${cur.id}`);
      this.hide(false);
      void runCommand('file.home');
    } catch (e) {
      this.noteOn('info', e instanceof Error ? e.message : 'The workbook was not moved.', true);
    }
  }

  private buildFormats(kind: 'saveas' | 'copy' | 'export'): Pane {
    const titles = { saveas: 'Save As', copy: 'Save a Copy', export: 'Export' };
    const subs = {
      saveas: 'Choose a file type, name it, and FormCel hands you the file. The workbook itself stays in the library and keeps saving as you type.',
      copy: 'Make a copy without changing this workbook: duplicate it in the library, or download it in any file type.',
      export: 'Create a PDF of the printed pages, or change the file type to share the data.',
    };
    const { el } = section(titles[kind], subs[kind]);
    const split = h('div', 'fc-bs-split');
    const list = h('div', 'fc-bs-formats');
    list.setAttribute('role', 'radiogroup');
    const opts = h('div', 'fc-bs-opts');
    split.append(list, opts);
    el.append(split, this.note(kind));
    const order = kind === 'export' ? ['pdf', 'xlsx', 'ods', 'csv', 'tsv', 'html', 'fcel', 'xlsm'] : kind === 'copy' ? ['library', 'xlsx', 'xlsm', 'ods', 'pdf', 'html', 'csv', 'tsv', 'fcel'] : ['xlsx', 'xlsm', 'ods', 'pdf', 'html', 'csv', 'tsv', 'fcel'];
    const all: Fmt[] = [{ id: 'library', label: 'FormCel Library', ext: 'fcel', desc: 'Duplicate this workbook in the library. It opens separately and keeps its own history.', scope: 'none' }, ...FORMATS];
    const items = order.map((id) => all.find((f) => f.id === id)!);
    for (const f of items) {
      const b = h('button', 'fc-bs-fmt');
      b.type = 'button';
      b.dataset.id = f.id;
      b.setAttribute('role', 'radio');
      const t = h('span', 'fc-bs-ftext');
      t.append(h('span', 'fc-bs-fname', f.label), h('span', 'fc-bs-fext', f.id === 'library' ? 'Library' : `.${f.ext}`));
      b.append(t);
      b.addEventListener('click', () => {
        this.fmt = f.id;
        render();
      });
      list.append(b);
    }
    const name = h('input', 'fc-bs-input');
    name.type = 'text';
    name.spellcheck = false;
    name.setAttribute('aria-label', 'File name');
    name.addEventListener('input', () => { this.fname = name.value; });
    const ext = h('span', 'fc-bs-extlabel');
    const nameRow = h('div', 'fc-bs-namerow');
    nameRow.append(name, ext);
    const desc = h('p', 'fc-bs-fdesc');
    const scopeSel = select([['sheet', 'One sheet'], ['all', 'Every sheet']], 'sheet', (v) => { this.scope = v as 'sheet' | 'all'; render(); });
    const sheetSel = select([], '0', (v) => { this.sheet = Number(v); });
    const go = button('', 'fc-btn fc-btn-primary', () => void this.exportNow(kind));
    opts.append(h('h2', 'fc-bs-h2', ''), desc, row('File name', nameRow), row('Include', scopeSel), row('Sheet', sheetSel), go);
    const render = () => {
      const cur = this.host.current();
      const f = items.find((x) => x.id === this.fmt) ?? items[0];
      if (f.id !== this.fmt) this.fmt = f.id;
      for (const b of list.children) {
        const on = (b as HTMLElement).dataset.id === f.id;
        b.setAttribute('aria-checked', String(on));
        const fm = (b as HTMLElement).dataset.id;
        (b as HTMLButtonElement).hidden = fm === 'xlsm' && !cur?.macros;
      }
      setText(opts.querySelector('h2'), f.label);
      setText(desc, f.desc);
      setText(ext, f.id === 'library' ? '' : `.${f.ext}`);
      const scoped = f.scope === 'either';
      scopeSel.closest('label')!.hidden = !scoped;
      sheetSel.closest('label')!.hidden = f.scope === 'none' || (scoped && this.scope === 'all');
      if (name.value !== this.fname) name.value = this.fname;
      go.replaceChildren(f.id === 'library' ? 'Make a Copy' : kind === 'export' && f.id === 'pdf' ? 'Create PDF' : kind === 'copy' ? 'Save a Copy' : 'Save');
      scopeSel.value = this.scope;
      sheetSel.value = String(this.sheet);
    };
    return {
      el,
      update: () => {
        const cur = this.host.current();
        if (!cur) return;
        if (this.fmt === 'xlsm' && !cur.macros) this.fmt = 'xlsx';
        if (!this.fname || el.dataset.for !== cur.id) {
          this.fname = kind === 'copy' && this.fmt === 'library' ? `${cur.title} copy` : cur.title;
          this.sheet = cur.sheet;
          el.dataset.for = cur.id;
        }
        const wanted = cur.sheets.join('\u0000');
        if (sheetSel.dataset.sig !== wanted) {
          sheetSel.dataset.sig = wanted;
          sheetSel.replaceChildren(...cur.sheets.map((s, i) => new Option(s, String(i))));
        }
        render();
      },
    };
  }

  private async exportNow(kind: string): Promise<void> {
    const cur = this.host.current();
    if (!cur || this.busy) return;
    const base = this.fname.trim().replace(/[\\/:*?"<>|]/g, '') || cur.title;
    this.busy = true;
    try {
      await this.host.settle();
      if (this.fmt === 'library') {
        const m = await api<Meta>('POST', `/workbooks/${cur.id}/copy`, { title: base });
        this.noteOn(kind, `Copied as "${m.title}" in the library.`);
        const open = button('Open the copy', 'fc-btn fc-btn-ghost', () => { this.hide(false); this.host.openWorkbook(m.id); });
        this.notes.get(kind)?.append(' ', open);
        return;
      }
      const f = FORMATS.find((x) => x.id === this.fmt)!;
      const q = f.scope === 'either' && this.scope === 'all' ? '?scope=all' : f.scope === 'none' ? '' : `?sheet=${this.sheet}`;
      const url = `/api/workbooks/${cur.id}/export.${f.ext}${q}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(await r.json().then((j: { detail?: string }) => j.detail ?? `HTTP ${r.status}`).catch(() => `HTTP ${r.status}`));
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${base}.${f.ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      this.noteOn(kind, `${base}.${f.ext} was made (${blob.size < 1024 ? `${blob.size} bytes` : `${Math.round(blob.size / 1024)} KB`}) and sent to your downloads.`);
    } catch (e) {
      this.noteOn(kind, e instanceof Error ? e.message : 'The file could not be made.', true);
    } finally {
      this.busy = false;
    }
  }

  private buildPrint(): Pane {
    const el = h('div', 'fc-bs-pane fc-bs-print');
    const side = h('div', 'fc-bs-pset');
    side.append(h('h1', '', 'Print'));
    const go = button('Print', 'fc-bs-printbtn', () => void this.printNow(), 'bsPrint');
    side.append(go);
    const printer = h('p', 'fc-bs-printer');
    printer.append(h('strong', '', 'Printer'), h('span', '', 'Your browser\'s print dialog: pick a printer or Save as PDF there.'));
    const sheets = select([['sheet', 'Print Active Sheet'], ['all', 'Print Entire Workbook']], 'sheet', (v) => { this.printScope = v as 'sheet' | 'all'; this.printPageReset(); this.queuePreview(0); });
    const from = h('input', 'fc-bs-num');
    from.type = 'number';
    from.min = '1';
    from.placeholder = 'All';
    from.setAttribute('aria-label', 'From page');
    const to = h('input', 'fc-bs-num');
    to.type = 'number';
    to.min = '1';
    to.placeholder = 'All';
    to.setAttribute('aria-label', 'To page');
    const range = h('div', 'fc-bs-range');
    range.append(from, h('span', '', 'to'), to);
    from.addEventListener('input', () => { this.printFrom = Number(from.value) || 0; });
    to.addEventListener('input', () => { this.printTo = Number(to.value) || 0; });
    const edit = (fn: (p: PageSetup) => void) => async () => {
      const cur = this.host.current();
      if (!cur) return;
      const p = structuredClone(this.host.page(cur.sheet));
      fn(p);
      await this.host.setPage(cur.sheet, p);
      this.queuePreview(200);
    };
    const orient = select([['portrait', 'Portrait Orientation'], ['landscape', 'Landscape Orientation']], 'portrait', (v) => void edit((p) => { p.orient = v as PageSetup['orient']; })());
    const paper = select(Object.keys(PAPERS).map((k) => [k, k]), 'Letter', (v) => void edit((p) => { p.paper = v; })());
    const margins = select([['normal', 'Normal Margins'], ['wide', 'Wide Margins'], ['narrow', 'Narrow Margins'], ['custom', 'Custom Margins']], 'normal', (v) => void edit((p) => {
      p.margins = v as PageSetup['margins'];
      if (v !== 'custom') p.m = [...MARGIN_PRESETS[v]];
    })());
    const scale = select([['none', 'No Scaling'], ['fit-sheet', 'Fit Sheet on One Page'], ['fit-cols', 'Fit All Columns on One Page'], ['custom', 'Custom Scaling']], 'none', (v) => void edit((p) => { p.scale = v as Scale; })());
    const pct = h('input', 'fc-bs-num');
    pct.type = 'number';
    pct.min = '10';
    pct.max = '400';
    pct.setAttribute('aria-label', 'Scale percent');
    pct.addEventListener('change', () => void edit((p) => { p.pct = Math.max(10, Math.min(400, Number(pct.value) || 100)); p.scale = 'custom'; })());
    const pctRow = row('Scale (%)', pct);
    const lines = h('label', 'fc-bs-check');
    const grid = h('input');
    grid.type = 'checkbox';
    lines.append(grid, 'Print gridlines');
    grid.addEventListener('change', () => void edit((p) => { p.grid = grid.checked; })());
    const heads = h('label', 'fc-bs-check');
    const hd = h('input');
    hd.type = 'checkbox';
    heads.append(hd, 'Print row and column headings');
    hd.addEventListener('change', () => void edit((p) => { p.heads = hd.checked; })());
    const setup = button('Page Setup', 'fc-btn fc-btn-ghost', () => void runCommand('page.setup'));
    side.append(printer, h('h2', 'fc-bs-h2', 'Settings'), row('Sheets', sheets), row('Pages', range), row('Orientation', orient), row('Paper size', paper), row('Margins', margins), row('Scaling', scale), pctRow, lines, heads, h('p', 'fc-bs-sub', 'Settings change the page setup of the active sheet. In an entire workbook each sheet keeps its own.'), setup, this.note('print'));
    const view = h('div', 'fc-bs-pview');
    const stage = h('div', 'fc-bs-stage');
    const img = h('img', 'fc-bs-page');
    img.alt = 'Print preview of the page';
    const empty = h('p', 'fc-bs-none', 'Nothing to preview yet.');
    stage.append(img, empty);
    const nav = h('div', 'fc-bs-pnav');
    const prev = button('', 'fc-tool', () => { this.queuePreview(0, this.previewPage - 1); }, 'bsLeft');
    prev.setAttribute('aria-label', 'Previous page');
    const next = button('', 'fc-tool', () => { this.queuePreview(0, this.previewPage + 1); }, 'bsRight');
    next.setAttribute('aria-label', 'Next page');
    const count = h('span', 'fc-bs-pcount');
    nav.append(prev, count, next);
    view.append(stage, nav);
    el.append(side, view);
    this.previewEls = { img, empty, count, prev, next };
    return {
      el,
      update: () => {
        const cur = this.host.current();
        if (!cur) return;
        const p = this.host.page(cur.sheet);
        sheets.value = this.printScope;
        orient.value = p.orient;
        paper.value = p.paper;
        margins.value = p.margins;
        scale.value = p.scale;
        if (document.activeElement !== pct) pct.value = String(p.pct);
        pctRow.hidden = p.scale !== 'custom';
        grid.checked = p.grid;
        hd.checked = p.heads;
        go.disabled = false;
      },
    };
  }

  private previewEls: { img: HTMLImageElement; empty: HTMLElement; count: HTMLElement; prev: HTMLButtonElement; next: HTMLButtonElement } | null = null;

  private printPageReset(): void {
    this.previewPage = 0;
  }

  private queuePreview(delay: number, page = this.previewPage): void {
    window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => void this.loadPreview(page), delay);
  }

  private async loadPreview(page: number): Promise<void> {
    const cur = this.host.current();
    const e = this.previewEls;
    if (!cur || !e || this.root.hidden || this.pane !== 'print') return;
    const gen = ++this.previewGen;
    await this.host.settle();
    const p = Math.max(0, Math.min(page, this.previewPages - 1));
    try {
      const r = await fetch(`/api/workbooks/${cur.id}/print-preview.png?sheet=${cur.sheet}&scope=${this.printScope}&page=${p}&scale=1.5`);
      if (gen !== this.previewGen) return;
      if (!r.ok) {
        e.empty.hidden = false;
        e.img.hidden = true;
        setText(e.count, '');
        return;
      }
      this.previewPages = Number(r.headers.get('X-Pages')) || 1;
      this.previewPage = Math.min(p, this.previewPages - 1);
      const url = URL.createObjectURL(await r.blob());
      const probe = new Image();
      probe.src = url;
      await probe.decode().catch(() => undefined);
      if (gen !== this.previewGen) {
        URL.revokeObjectURL(url);
        return;
      }
      const old = e.img.src;
      e.img.src = url;
      if (old.startsWith('blob:')) URL.revokeObjectURL(old);
      e.img.hidden = false;
      e.empty.hidden = true;
      setText(e.count, `${this.previewPage + 1} of ${this.previewPages}`);
      e.prev.disabled = this.previewPage <= 0;
      e.next.disabled = this.previewPage >= this.previewPages - 1;
    } catch {
      return;
    }
  }

  private async printNow(): Promise<void> {
    const cur = this.host.current();
    if (!cur || this.busy) return;
    this.busy = true;
    this.noteOn('print', 'Preparing the pages');
    try {
      await this.host.settle();
      const total = this.previewPages;
      const a = Math.max(1, this.printFrom || 1);
      const b = Math.min(total, this.printTo || total);
      const urls: string[] = [];
      for (let i = a - 1; i < b; i++) {
        const r = await fetch(`/api/workbooks/${cur.id}/print-preview.png?sheet=${cur.sheet}&scope=${this.printScope}&page=${i}&scale=2.4`);
        if (!r.ok) throw new Error('A page could not be rendered.');
        urls.push(URL.createObjectURL(await r.blob()));
      }
      if (!urls.length) throw new Error('There are no pages in that range.');
      const frame = document.createElement('iframe');
      frame.className = 'fc-bs-printframe';
      frame.setAttribute('aria-hidden', 'true');
      document.body.appendChild(frame);
      const doc = frame.contentDocument!;
      doc.open();
      doc.write(`<!doctype html><title>${cur.title.replace(/[<&]/g, '')}</title><style>@page{margin:0}html,body{margin:0}img{display:block;width:100%;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}</style>${urls.map((u) => `<img src="${u}">`).join('')}`);
      doc.close();
      await Promise.all([...doc.images].map((i) => i.decode().catch(() => undefined)));
      const done = () => {
        frame.remove();
        for (const u of urls) URL.revokeObjectURL(u);
      };
      frame.contentWindow!.addEventListener('afterprint', done, { once: true });
      window.setTimeout(done, 120000);
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
      this.noteOn('print', `Sent ${urls.length} ${urls.length === 1 ? 'page' : 'pages'} to the print dialog.`);
    } catch (e) {
      this.noteOn('print', e instanceof Error ? e.message : 'Printing failed.', true);
    } finally {
      this.busy = false;
    }
  }

  private buildShare(kind: 'share' | 'publish'): Pane {
    const share = kind === 'share';
    const { el } = section(share ? 'Share' : 'Publish', share ? 'Make a link people on your network can open to view, comment or edit this workbook.' : 'Publish a sheet or the whole workbook as a web page or CSV that updates when you change it.');
    const form = h('div', 'fc-bs-shareform');
    const perm = select([['view', 'Can view'], ['comment', 'Can comment'], ['edit', 'Can edit']], 'view', () => undefined);
    const scope = select([['sheet', 'The active sheet'], ['workbook', 'The whole workbook']], 'sheet', () => undefined);
    const fmt = select([['html', 'Web page'], ['csv', 'CSV']], 'html', () => undefined);
    const live = h('input');
    live.type = 'checkbox';
    live.checked = true;
    const liveRow = h('label', 'fc-bs-check');
    liveRow.append(live, 'Keep it up to date as the workbook changes');
    if (share) form.append(row('Permission', perm), row('Scope', scope));
    else form.append(row('What to publish', scope), row('Format', fmt), liveRow);
    const create = button(share ? 'Create Link' : 'Publish', 'fc-btn fc-btn-primary', async () => {
      const cur = this.host.current();
      if (!cur) return;
      try {
        await this.host.settle();
        await api('POST', `/workbooks/${cur.id}/shares`, { sheet: cur.sheet, kind, perm: perm.value, scope: scope.value === 'workbook' ? 'book' : 'sheet', format: fmt.value, live: share ? true : live.checked });
        this.noteOn(kind, share ? 'Link created.' : 'Published.');
        await ref.update();
      } catch (e) {
        this.noteOn(kind, e instanceof Error ? e.message : 'That did not work.', true);
      }
    }, share ? 'share' : 'bsGlobe');
    form.append(create, button('Open the Sharing Panel', 'fc-btn fc-btn-ghost', () => void runCommand('share.panel').then(() => this.hide(false))));
    const list = h('div', 'fc-bs-links');
    list.append(h('h2', 'fc-bs-h2', share ? 'Links' : 'Published'));
    const rows = h('div', 'fc-bs-wlist');
    const none = h('p', 'fc-bs-none', share ? 'No links yet.' : 'Nothing is published yet.');
    list.append(rows, none);
    el.append(form, list, this.note(kind));
    const ref: Pane = {
      el,
      update: async () => {
        const cur = this.host.current();
        if (!cur) return;
        try {
          const r = await api<{ shares: { token: string; kind: string; perm: string; url: string; embed: string; scope?: string }[]; lan: { on: boolean } }>('GET', `/workbooks/${cur.id}/shares`);
          const mine = r.shares.filter((s) => s.kind === kind);
          patch(rows, mine, (s) => s.token, () => {
            const n = h('div', 'fc-bs-link');
            n.append(h('span', 'fc-bs-lurl'), h('span', 'fc-bs-lperm'));
            const copy = button('Copy link', 'fc-btn', undefined, 'bsCopy');
            const emb = button('Copy embed code', 'fc-btn fc-btn-ghost');
            const revoke = button('Revoke', 'fc-btn fc-btn-danger');
            n.append(copy, emb, revoke);
            return n;
          }, (n, s) => {
            setText(n.querySelector('.fc-bs-lurl'), s.url);
            setText(n.querySelector('.fc-bs-lperm'), share ? s.perm : 'view');
            const [copy, emb, revoke] = [...n.querySelectorAll('button')] as HTMLButtonElement[];
            copy.onclick = () => void navigator.clipboard.writeText(s.url).then(() => this.noteOn(kind, 'Link copied.'), () => this.noteOn(kind, 'The link could not be copied.', true));
            emb.onclick = () => void navigator.clipboard.writeText(s.embed).then(() => this.noteOn(kind, 'Embed code copied.'), () => this.noteOn(kind, 'The code could not be copied.', true));
            revoke.onclick = () => void api('DELETE', `/workbooks/${cur.id}/shares/${s.token}`).then(() => ref.update());
          });
          none.hidden = mine.length > 0;
        } catch (e) {
          this.noteOn(kind, e instanceof Error ? e.message : 'Could not read the links.', true);
        }
      },
    };
    return ref;
  }

  private buildAccount(): Pane {
    const { el } = section('Account', 'FormCel works on this computer. There is no sign-in and nothing leaves the machine unless you share it.');
    const who = h('div', 'fc-bs-block');
    const ic = h('div', 'fc-bs-bicon');
    ic.insertAdjacentHTML('afterbegin', icon('bsUser'));
    const t = h('div', 'fc-bs-btext');
    t.append(h('h3', '', 'User name'), h('p', '', 'The name on your notes, comments, edits and presence.'));
    const a = h('div', 'fc-bs-actions');
    a.append(button('Change Name', 'fc-btn', () => void runCommand('review.user').then(() => this.hide(false))));
    t.append(a);
    who.append(ic, t);
    const th = h('div', 'fc-bs-block');
    const ic2 = h('div', 'fc-bs-bicon');
    ic2.insertAdjacentHTML('afterbegin', icon('theme'));
    const t2 = h('div', 'fc-bs-btext');
    t2.append(h('h3', '', 'Theme'));
    const ts = select([['dark', 'Dark (default)'], ['light', 'Light, like Excel'], ['contrast', 'High contrast']], theme(), (v) => setTheme(v as ThemeName));
    ts.className = 'fc-bs-select';
    t2.append(ts);
    th.append(ic2, t2);
    const about = h('div', 'fc-bs-block');
    const ic3 = h('div', 'fc-bs-bicon');
    ic3.insertAdjacentHTML('afterbegin', icon('bsInfo'));
    const t3 = h('div', 'fc-bs-btext');
    t3.append(h('h3', '', 'About FormCel'), h('p', '', `FormCel ${VERSION}. A local-first spreadsheet in the form family.`));
    about.append(ic3, t3);
    const wrap = h('div', 'fc-bs-colmain');
    wrap.append(who, th, about);
    el.append(wrap);
    return { el, update: () => { ts.value = theme(); } };
  }
}
