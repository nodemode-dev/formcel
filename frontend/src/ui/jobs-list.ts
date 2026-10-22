import { listJobs, onJobs } from './jobs';

export class JobsList {
  private readonly el = document.createElement('div');
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private anchor: HTMLElement | null = null;

  constructor() {
    const el = this.el;
    el.className = 'fc-jobs';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Background jobs');
    el.hidden = true;
    el.innerHTML = '<div class="fc-jobs-head"><span class="fc-jobs-title">Background jobs</span><span class="fc-jobs-count">0</span></div><div class="fc-jobs-list"></div><p class="fc-jobs-empty">No background jobs are running.</p>';
    this.count = el.querySelector('.fc-jobs-count')!;
    this.list = el.querySelector('.fc-jobs-list')!;
    this.empty = el.querySelector('.fc-jobs-empty')!;
    document.getElementById('overlay-root')!.appendChild(el);
    onJobs(() => {
      if (!el.hidden) this.render();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!el.hidden && !el.contains(e.target as Node) && !this.anchor?.contains(e.target as Node)) this.hide();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (!el.hidden && e.key === 'Escape') this.hide();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(anchor: HTMLElement): void {
    if (this.isOpen) this.hide();
    else this.show(anchor);
  }

  show(anchor: HTMLElement): void {
    this.anchor = anchor;
    this.render();
    this.el.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = this.el.getBoundingClientRect().width;
    this.el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    this.el.style.bottom = `${window.innerHeight - r.top + 6}px`;
  }

  hide(): void {
    this.el.hidden = true;
  }

  private render(): void {
    const jobs = listJobs();
    const have = new Map<string, HTMLElement>();
    for (const c of [...this.list.children] as HTMLElement[]) have.set(c.dataset.job ?? '', c);
    const keep = new Set(jobs.map((j) => String(j.id)));
    for (const [k, n] of have) if (!keep.has(k)) n.remove();
    for (const j of jobs) {
      let n = have.get(String(j.id));
      if (!n) {
        n = document.createElement('div');
        n.className = 'fc-jobs-row';
        n.dataset.job = String(j.id);
        n.innerHTML = '<span class="fc-jobs-name"></span><span class="fc-jobs-bar"><i></i></span><span class="fc-jobs-pct"></span>';
        this.list.appendChild(n);
      }
      const pct = j.total > 0 ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0;
      const name = n.querySelector<HTMLElement>('.fc-jobs-name')!;
      if (name.textContent !== j.name) name.textContent = j.name;
      n.querySelector<HTMLElement>('.fc-jobs-bar')!.style.setProperty('--p', `${j.total > 0 ? pct : 100}%`);
      n.classList.toggle('is-indeterminate', j.total <= 0);
      const t = n.querySelector<HTMLElement>('.fc-jobs-pct')!;
      const v = j.total > 0 ? `${pct}%` : '';
      if (t.textContent !== v) t.textContent = v;
    }
    const c = String(jobs.length);
    if (this.count.textContent !== c) this.count.textContent = c;
    this.empty.hidden = jobs.length > 0;
  }
}
