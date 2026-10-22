import { icon } from './icons';
import { drawThumb } from './thumb';

export interface FileItem {
  id: string;
  title: string;
  modified: string;
  sheets: string[];
  preview: string[][];
  macros?: boolean;
}

export interface HomeFilesDeps {
  open(id: string): void;
  trash(id: string): void;
}

type Sort = 'opened' | 'name' | 'sheets' | 'kind';
type View = 'grid' | 'list';

const PREFS = 'formcel.home';

function readPrefs(): { sort: Sort; view: View } {
  const out = { sort: 'opened' as Sort, view: 'grid' as View };
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<typeof out>;
    if (v.sort === 'opened' || v.sort === 'name' || v.sort === 'sheets' || v.sort === 'kind') out.sort = v.sort;
    if (v.view === 'grid' || v.view === 'list') out.view = v.view;
  } catch {
    return out;
  }
  return out;
}

function whenText(iso: string): string {
  const t = Date.parse(iso);
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function setText(n: Element, v: string): void {
  if (n.textContent !== v) n.textContent = v;
}

const kindOf = (i: FileItem): string => (i.macros ? 'Macro workbook' : 'Workbook');

export class HomeFiles {
  readonly root = document.createElement('div');
  private readonly items: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly filter: HTMLInputElement;
  private readonly sort: HTMLSelectElement;
  private prefs = readPrefs();
  private all: FileItem[] = [];

  constructor(private readonly d: HomeFilesDeps, private readonly opts: { limit?: number; compact?: boolean; onCount?: (n: number) => void } = {}) {
    this.root.className = `fc-hf${opts.compact ? ' is-compact' : ''}`;
    this.root.innerHTML = `
      <div class="fc-hf-bar">
        <label class="fc-hf-filter">${icon('search')}<input class="fc-hf-input" type="search" placeholder="Filter workbooks" aria-label="Filter workbooks" spellcheck="false"></label>
        <label class="fc-hf-sortbox"><span>Sort</span><select class="fc-hf-sort" aria-label="Sort by"><option value="opened">Most recent</option><option value="name">Name</option><option value="sheets">Sheets</option><option value="kind">Kind</option></select></label>
        <div class="fc-hf-views" role="group" aria-label="View"><button class="fc-hf-view" type="button" data-view="grid" title="Thumbnails" aria-label="Thumbnails">${icon('viewGrid')}</button><button class="fc-hf-view" type="button" data-view="list" title="List" aria-label="List">${icon('viewList')}</button></div>
      </div>
      <div class="fc-hf-head" aria-hidden="true"><span></span><span>Name</span><span>Kind</span><span>Sheets</span><span>Modified</span><span></span></div>
      <div class="fc-hf-items" role="list"></div>
      <p class="fc-hf-empty" hidden></p>`;
    this.items = this.root.querySelector('.fc-hf-items')!;
    this.empty = this.root.querySelector('.fc-hf-empty')!;
    this.filter = this.root.querySelector('.fc-hf-input')!;
    this.sort = this.root.querySelector('.fc-hf-sort')!;
    if (opts.compact) this.prefs.view = 'grid';
    this.sort.value = this.prefs.sort;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.fc-hf-view')) {
      b.addEventListener('click', () => {
        this.prefs.view = b.dataset.view as View;
        this.save();
        this.chrome();
      });
    }
    this.sort.addEventListener('change', () => {
      this.prefs.sort = this.sort.value as Sort;
      this.save();
      this.render();
    });
    this.filter.addEventListener('input', () => this.render());
    this.items.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>('.fc-hf-item');
      if (!row) return;
      if (t.closest('.fc-hf-remove')) return this.d.trash(row.dataset.key!);
      if (t.closest('.fc-hf-open')) this.d.open(row.dataset.key!);
    });
    this.chrome();
  }

  private save(): void {
    try {
      const keep = readPrefs();
      localStorage.setItem(PREFS, JSON.stringify({ sort: this.prefs.sort, view: this.opts.compact ? keep.view : this.prefs.view }));
    } catch {
      return;
    }
  }

  private chrome(): void {
    for (const b of this.root.querySelectorAll<HTMLElement>('.fc-hf-view')) {
      const on = b.dataset.view === this.prefs.view;
      b.classList.toggle('is-active', on);
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
    }
    this.root.classList.toggle('is-list', this.prefs.view === 'list');
  }

  set(list: FileItem[]): void {
    this.all = list;
    this.opts.onCount?.(list.length);
    this.render();
  }

  private render(): void {
    const f = this.filter.value.trim().toLowerCase();
    const shown = this.all.filter((i) => !f || i.title.toLowerCase().includes(f));
    const sort = this.prefs.sort;
    if (sort === 'name') shown.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    else if (sort === 'sheets') shown.sort((a, b) => b.sheets.length - a.sheets.length);
    else if (sort === 'kind') shown.sort((a, b) => kindOf(a).localeCompare(kindOf(b)) || a.title.localeCompare(b.title));
    else shown.sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
    if (this.opts.limit) shown.splice(this.opts.limit);
    const have = new Map<string, HTMLElement>();
    for (const c of [...this.items.children] as HTMLElement[]) have.set(c.dataset.key ?? '', c);
    const keep = new Set(shown.map((i) => i.id));
    for (const [k, n] of have) if (!keep.has(k)) n.remove();
    let prev: Element | null = null;
    for (const i of shown) {
      let n = have.get(i.id);
      if (!n) n = this.row(i);
      this.fill(n, i);
      const want: Element | null = prev ? prev.nextElementSibling : this.items.firstElementChild;
      if (want !== n) this.items.insertBefore(n, want);
      prev = n;
    }
    const none = this.all.length === 0 ? 'Workbooks you create or open appear here.' : 'No workbooks match the filter.';
    setText(this.empty, none);
    this.empty.hidden = shown.length > 0;
  }

  private row(i: FileItem): HTMLElement {
    const n = document.createElement('div');
    n.className = 'fc-hf-item';
    n.setAttribute('role', 'listitem');
    n.dataset.key = i.id;
    n.innerHTML = `<button class="fc-hf-open" type="button"><span class="fc-hf-thumb"><canvas aria-hidden="true"></canvas></span><span class="fc-hf-name"></span><span class="fc-hf-kind"></span><span class="fc-hf-size"></span><span class="fc-hf-when"></span></button><button class="fc-hf-remove" type="button" title="Move to Trash" aria-label="Move to Trash">${icon('close')}</button>`;
    return n;
  }

  private fill(n: HTMLElement, i: FileItem): void {
    setText(n.querySelector('.fc-hf-name')!, i.title);
    setText(n.querySelector('.fc-hf-kind')!, kindOf(i));
    setText(n.querySelector('.fc-hf-size')!, `${i.sheets.length} ${i.sheets.length === 1 ? 'sheet' : 'sheets'}`);
    setText(n.querySelector('.fc-hf-when')!, whenText(i.modified));
    drawThumb(n.querySelector('canvas')!, i.preview);
  }
}
