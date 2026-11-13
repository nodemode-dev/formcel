import { icon } from './icons';
import { brandMark } from './brand';
import { DEMOS, demoTemplate, registerDemoCommands, type DemoId } from '../demos';
import { HomeFiles } from './home-files';
import { runCommand } from './commands';
import { drawThumb } from './thumb';
import { onPreviewGesture, openPreview, paintThumb, thumbBox, type Visual } from './tplgallery';

export interface WorkbookMeta {
  id: string;
  title: string;
  modified: string;
  sheets: string[];
  preview: string[][];
  macros?: boolean;
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
  visuals?: Visual[];
}

export interface HomeHooks {
  open(id: string): void;
  create(template?: string): void | Promise<void>;
  importFile(file: File): void;
  pasteData(text?: string, html?: string): void;
  trash(id: string): void;
  restore(id: string): void;
  purge(id: string): void;
}

type Page = 'start' | 'recent' | 'templates' | 'trash';

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

export class Home {
  private page: Page = 'start';
  private cat = 'Spreadsheets';
  private query = '';
  private templates: TemplateMeta[] = [];
  private cats: { name: string; count: number }[] = [];
  private lastId: string | null = null;
  private readonly startFiles: HomeFiles;
  private readonly recentFiles: HomeFiles;

  constructor(private readonly root: HTMLElement, private readonly hooks: HomeHooks) {
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
    const navItem = (v: Page, ic: Parameters<typeof icon>[0], label: string): string => `<button class="fc-home-nav-item" type="button" data-v="${v}">${icon(ic)}<span>${label}</span>${v === 'start' ? '' : '<span class="fc-home-count">0</span>'}</button>`;
    const cmdItem = (attr: string, ic: Parameters<typeof icon>[0], label: string): string => `<button class="fc-home-nav-item" type="button" ${attr}>${icon(ic)}<span>${label}</span></button>`;
    const key = (k: string): string => `<kbd class="fc-key">${mod}</kbd><kbd class="fc-key">${k}</kbd>`;
    const formats = ['XLSX', 'XLSM', 'XLS', 'ODS', 'CSV', 'TSV', 'HTML', 'PDF'].map((f) => `<span class="fc-home-format">${f}</span>`).join('');
    root.innerHTML = `
      <nav class="fc-home-nav" aria-label="Home">
        <div class="fc-home-brand">${brandMark(26)}formcel <span translate="no">by nodemode.ai</span></div>
        <div class="fc-home-nav-scroll">${navItem('start', 'home', 'Start')}${navItem('recent', 'clock', 'Recent')}${navItem('templates', 'template', 'Templates')}${navItem('trash', 'trash', 'Trash')}
        <div class="fc-home-nav-sep"></div>
        <div class="fc-home-nav-title">Create</div>
        ${cmdItem('data-a="blank"', 'newFile', 'New workbook')}${cmdItem('data-a="openfile"', 'folderOpen', 'Open')}${cmdItem('data-a="pastedata"', 'clipboard', 'Paste data')}
        <div class="fc-home-nav-sep"></div>
        <div class="fc-home-nav-title">Agents</div>
        ${cmdItem('data-cmd="claude-code"', 'agent', 'Claude Code')}${cmdItem('data-cmd="claude-chat"', 'agentChat', 'Chat')}${cmdItem('data-cmd="terminal-toggle"', 'terminal', 'Terminal')}</div>
        <div class="fc-home-nav-foot"><button class="fc-home-nav-item fc-home-back" type="button" data-a="back" hidden>${icon('chevronLeft')}<span>Back to workbook</span></button>${cmdItem('data-cmd="app.settings"', 'settings', 'Preferences')}${cmdItem('data-cmd="a11y.shortcuts"', 'info', 'Help')}</div>
      </nav>
      <div class="fc-home-resizer" role="separator" aria-orientation="vertical" aria-label="Resize the side panel"></div>
      <button class="fc-home-nav-hide" type="button" title="Hide the side panel" aria-label="Hide the side panel">${icon('chevronLeft')}</button>
      <button class="fc-home-nav-show" type="button" title="Show the side panel" aria-label="Show the side panel">${icon('chevronRight')}</button>
      <div class="fc-home-body">
        <div class="fc-home-narrow">${navItem('start', 'home', 'Start')}${navItem('recent', 'clock', 'Recent')}${navItem('templates', 'template', 'Templates')}${navItem('trash', 'trash', 'Trash')}</div>
        <div class="fc-home-page" data-page="start">
          <div class="fc-home-head"><div><h1 class="fc-home-title"></h1><p class="fc-home-sub">Open a spreadsheet, or start a new workbook.</p></div></div>
          <div class="fc-home-hero">
            <span class="fc-home-hero-icon">${icon('fileSheet')}</span>
            <div class="fc-home-hero-text"><div class="fc-home-hero-title">Start from a file</div>
              <div class="fc-home-hero-sub">Drop a spreadsheet, CSV or PDF anywhere in the window to open it. Workbooks keep every formula, format, chart and table editable.</div>
              <div class="fc-home-formats">${formats}</div></div>
            <div class="fc-home-hero-actions">
              <button class="fc-home-action is-primary" type="button" data-a="blank">${icon('newFile')}<span class="fc-home-label">New workbook...</span>${key('N')}</button>
              <button class="fc-home-action" type="button" data-a="openfile">${icon('folderOpen')}<span class="fc-home-label">Open...</span>${key('O')}</button>
              <button class="fc-home-action is-ghost" type="button" data-a="pastedata">${icon('clipboard')}<span class="fc-home-label">Paste data</span></button>
              <input type="file" class="fc-file" accept=".xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt,.html,.htm,.pdf" hidden>
            </div>
          </div>
          <section class="fc-home-section" data-home-section="demos"><div class="fc-home-section-head"><h2 class="fc-home-section-title">Demos</h2><span class="fc-home-section-note">Each opens as a new workbook. Nothing of yours is changed.</span></div><div class="fc-home-demos">${DEMOS.map((d) => `<button class="fc-home-demo" type="button" data-demo="${d.id}" aria-busy="false"><span class="fc-home-demo-pic">${d.cover()}</span><span class="fc-home-demo-title">${d.title}</span><span class="fc-home-demo-blurb">${d.blurb}</span></button>`).join('')}</div></section>
          <section class="fc-home-section"><div class="fc-home-section-head"><h2 class="fc-home-section-title">Recent</h2><button class="fc-btn fc-btn-ghost" type="button" data-v="recent">See all</button></div><div class="fc-home-slot" data-slot="start"></div></section>
          <section class="fc-home-section"><div class="fc-home-section-head"><h2 class="fc-home-section-title">New workbook</h2><button class="fc-btn fc-btn-ghost" type="button" data-v="templates">More templates...</button></div><div class="fc-home-sizes"><button class="fc-home-size" type="button" data-a="blank" data-key="__blank"><span class="fc-home-size-box"><span class="fc-home-blank" style="aspect-ratio: 4 / 3"></span></span><span class="fc-home-size-name">Blank workbook</span><span class="fc-home-size-meta">One empty sheet</span></button><span class="fc-home-tpls"></span></div></section>
        </div>
        <div class="fc-home-page" data-page="recent" hidden>
          <div class="fc-home-head"><div><h1>Recent</h1><p class="fc-home-sub">Workbooks you created, opened or saved, newest first.</p></div></div>
          <div class="fc-home-slot" data-slot="recent"></div>
        </div>
        <div class="fc-home-page" data-page="templates" hidden>
          <div class="fc-home-head"><div><h1>Templates</h1><p class="fc-home-sub">Finished workbooks with real data: dashboards, charts and formulas that update as you edit the data sheets.</p></div></div>
          <div class="fc-tpl-tools"><div class="fc-chips" role="tablist" aria-label="Categories"></div><label class="fc-search">${icon('search')}<input type="search" class="fc-tpl-q" placeholder="Search templates" aria-label="Search templates"></label></div>
          <div class="fc-cards fc-tpl-all"></div><p class="fc-none fc-tpl-none" hidden>No template matches that search.</p>
        </div>
        <div class="fc-home-page" data-page="trash" hidden>
          <div class="fc-home-head"><div><h1>Trash</h1><p class="fc-home-sub">Workbooks wait here until you restore them or delete them for good.</p></div></div>
          <div class="fc-trash"></div><p class="fc-none fc-trash-none" hidden>The Trash is empty.</p>
        </div>
      </div>`;
    root.addEventListener('click', (e) => this.click(e));
    const file = root.querySelector<HTMLInputElement>('.fc-file')!;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) this.hooks.importFile(f);
    });
    document.addEventListener('paste', (e) => {
      const t = e.target as HTMLElement | null;
      if (root.hidden || t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const html = e.clipboardData?.getData('text/html') ?? '';
      if (!text.trim() && !html) return;
      e.preventDefault();
      this.hooks.pasteData(text, html);
    });
    const count = (v: Page) => (n: number): void => {
      for (const c of this.root.querySelectorAll<HTMLElement>(`[data-v="${v}"] .fc-home-count`)) setText(c, String(n));
    };
    const deps = { open: (id: string) => this.hooks.open(id), trash: (id: string) => this.hooks.trash(id) };
    this.startFiles = new HomeFiles(deps, { limit: 8, compact: true, onCount: count('recent') });
    this.recentFiles = new HomeFiles(deps, { onCount: count('recent') });
    root.querySelector('[data-slot="start"]')!.appendChild(this.startFiles.root);
    root.querySelector('[data-slot="recent"]')!.appendChild(this.recentFiles.root);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !root.hidden && this.lastId && !document.querySelector('.fc-modal:not([hidden])') && !(e.target as HTMLElement).closest('input, textarea, select')) this.hooks.open(this.lastId);
    });
    root.querySelector<HTMLInputElement>('.fc-tpl-q')!.addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value.trim().toLowerCase();
      this.renderTemplates();
    });
    this.sidePanel();
    registerDemoCommands((id) => void this.openDemo(id));
    this.paint();
    this.go(this.page);
  }

  private demoBusy = false;

  async openDemo(id: DemoId): Promise<void> {
    const d = DEMOS.find((x) => x.id === id);
    if (!d || this.demoBusy) return;
    this.demoBusy = true;
    const card = this.root.querySelector<HTMLElement>(`[data-demo="${id}"]`);
    card?.setAttribute('aria-busy', 'true');
    this.say(`Opening the ${d.title} demo as a new workbook`);
    try {
      await this.hooks.create(demoTemplate(id));
      this.say('');
    } catch {
      this.say(`The ${d.title} demo could not open.`, true);
    } finally {
      card?.setAttribute('aria-busy', 'false');
      this.demoBusy = false;
    }
  }

  private sidePanel(): void {
    const root = this.root;
    const bar = root.querySelector<HTMLElement>('.fc-home-resizer')!;
    const save = (): void => {
      try {
        localStorage.setItem('formcel.homeNav', root.style.getPropertyValue('--fc-home-nav-w'));
        localStorage.setItem('formcel.homeNavHidden', root.classList.contains('is-nav-hidden') ? '1' : '0');
      } catch { return; }
    };
    const hide = (on: boolean): void => { root.classList.toggle('is-nav-hidden', on); save(); };
    try {
      const w = localStorage.getItem('formcel.homeNav');
      if (w) root.style.setProperty('--fc-home-nav-w', w.trim());
      if (localStorage.getItem('formcel.homeNavHidden') === '1') root.classList.add('is-nav-hidden');
    } catch { void 0; }
    root.querySelector('.fc-home-nav-hide')!.addEventListener('click', () => hide(true));
    root.querySelector('.fc-home-nav-show')!.addEventListener('click', () => hide(false));
    const list = root.querySelector<HTMLElement>('.fc-home-nav-scroll')!;
    const more = (): void => {
      const above = list.scrollTop > 1;
      const below = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
      const v = above && below ? 'both' : above ? 'above' : below ? 'below' : '';
      if ((list.dataset.more ?? '') === v) return;
      if (v) list.dataset.more = v;
      else delete list.dataset.more;
    };
    list.addEventListener('scroll', more, { passive: true });
    new ResizeObserver(more).observe(list);
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const x0 = e.clientX;
      const start = root.querySelector('.fc-home-nav')!.getBoundingClientRect().width || 232;
      bar.classList.add('is-dragging');
      const mv = (ev: PointerEvent): void => {
        const raw = start + ev.clientX - x0;
        const collapse = raw < 120;
        if (root.classList.contains('is-nav-hidden') !== collapse) root.classList.toggle('is-nav-hidden', collapse);
        if (!collapse) root.style.setProperty('--fc-home-nav-w', `${Math.round(Math.max(180, Math.min(420, raw)))}px`);
      };
      const up = (): void => {
        bar.classList.remove('is-dragging');
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        save();
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
  }

  private paint(): void {
    const h = new Date().getHours();
    setText(this.root.querySelector('[data-page="start"] .fc-home-title'), h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
  }

  setLast(id: string | null): void {
    this.lastId = id;
    this.root.querySelector<HTMLElement>('.fc-home-back')!.hidden = !id;
    this.paint();
  }

  private click(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const nav = t.closest<HTMLElement>('[data-v]');
    if (nav) return this.go(nav.dataset.v as Page);
    const cmd = t.closest<HTMLElement>('[data-cmd]');
    if (cmd) return void runCommand(cmd.dataset.cmd!);
    const demo = t.closest<HTMLElement>('[data-demo]');
    if (demo) return void this.openDemo(demo.dataset.demo as DemoId);
    const chip = t.closest<HTMLElement>('[data-cat]');
    if (chip) {
      this.cat = chip.dataset.cat!;
      return this.renderTemplates();
    }
    const act = t.closest<HTMLElement>('[data-a]');
    if (!act) return;
    const id = act.closest<HTMLElement>('[data-key]')?.dataset.key ?? '';
    switch (act.dataset.a) {
      case 'blank': return void this.hooks.create();
      case 'openfile': return void runCommand('file.open');
      case 'back': return this.lastId ? this.hooks.open(this.lastId) : undefined;
      case 'pastedata': return this.hooks.pasteData();
      case 'open': return this.hooks.open(id);
      case 'use': return void this.hooks.create(id);
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
    setText(sub, text || 'Open a spreadsheet, or start a new workbook.');
  }

  go(page: Page): void {
    this.page = page;
    for (const n of this.root.querySelectorAll<HTMLElement>('.fc-home-page')) n.hidden = n.dataset.page !== page;
    for (const n of this.root.querySelectorAll<HTMLElement>('.fc-home-nav-item[data-v]')) n.classList.toggle('is-active', n.dataset.v === page);
  }

  get current(): Page {
    return this.page;
  }

  setWorkbooks(list: WorkbookMeta[]): void {
    this.startFiles.set(list);
    this.recentFiles.set(list);
    if (this.lastId && !list.some((w) => w.id === this.lastId)) this.setLast(null);
  }

  private templateCard = (t: TemplateMeta): HTMLElement => {
    const card = el(`<div class="fc-card"><button type="button" class="fc-card-open"><span class="fc-card-body"><span class="fc-card-name"></span><span class="fc-card-meta"></span></span></button></div>`);
    const open = card.querySelector<HTMLElement>('.fc-card-open')!;
    open.prepend(thumbBox());
    onPreviewGesture(open, () => openPreview(t, (id) => this.hooks.create(id)), () => this.hooks.create(t.id));
    return card;
  };

  private updateTemplate = (n: HTMLElement, t: TemplateMeta): void => {
    setText(n.querySelector('.fc-card-name'), t.name);
    setText(n.querySelector('.fc-card-meta'), `${t.sheets.length} ${t.sheets.length === 1 ? 'sheet' : 'sheets'} · ${t.rows} rows${t.source === 'form.md' ? ' · from form.md' : ''}`);
    n.querySelector('.fc-card-open')!.setAttribute('title', t.description);
    paintThumb(n.querySelector('.fc-tt')!, t);
  };

  setTemplates(cats: { name: string; count: number }[], list: TemplateMeta[]): void {
    this.cats = cats;
    this.templates = list;
    patch(this.root.querySelector('.fc-home-tpls')!, list.filter((t) => t.category === 'Spreadsheets' || t.featured).slice(0, 7), (t) => t.id, this.presetTile, this.updatePreset);
    for (const c of this.root.querySelectorAll<HTMLElement>('[data-v="templates"] .fc-home-count')) setText(c, String(list.length));
    this.renderTemplates();
  }

  private presetTile = (): HTMLElement =>
    el('<button class="fc-home-size" type="button" data-a="use"><span class="fc-home-size-box"><canvas aria-hidden="true"></canvas></span><span class="fc-home-size-name"></span><span class="fc-home-size-meta"></span></button>');

  private updatePreset = (n: HTMLElement, t: TemplateMeta): void => {
    setText(n.querySelector('.fc-home-size-name'), t.name);
    setText(n.querySelector('.fc-home-size-meta'), `${t.sheets.length} ${t.sheets.length === 1 ? 'sheet' : 'sheets'} · ${t.rows} rows`);
    n.setAttribute('title', t.description);
    drawThumb(n.querySelector('canvas')!, t.preview);
  };

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
    for (const c of this.root.querySelectorAll<HTMLElement>('[data-v="trash"] .fc-home-count')) setText(c, String(list.length));
  }
}
