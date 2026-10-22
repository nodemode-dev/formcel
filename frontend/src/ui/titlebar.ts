import { listCommands, runCommand } from './commands';
import { colour, userName } from './collab';
import { customTitleBarOn, setCustomTitleBar, windowCall, wantsCustomTitleBar, wantsOverlayTitleBar } from './desktop';
import { icons } from './icons';

const interactive = 'button, input, textarea, select, a, [contenteditable], .fc-search-pop';

export class CaptionButtons {
  private readonly box: HTMLElement;
  private readonly max: HTMLButtonElement;

  constructor(header: HTMLElement) {
    const root = document.documentElement;
    this.box = header.querySelector<HTMLElement>('.fc-caption')!;
    this.max = this.box.querySelector<HTMLButtonElement>('[data-cap="max"]')!;
    if (wantsOverlayTitleBar()) root.classList.add('has-overlay-titlebar');
    header.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.detail > 1) return;
      if ((e.target as Element).closest(interactive) || !(wantsOverlayTitleBar() || this.active())) return;
      void windowCall('start_dragging');
    });
    header.addEventListener('dblclick', (e) => {
      if ((e.target as Element).closest(interactive) || !(wantsOverlayTitleBar() || this.active())) return;
      void windowCall('toggle_maximize').then(() => this.look());
    });
    this.box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cap]');
      if (!b) return;
      const act = b.dataset.cap;
      if (act === 'min') void windowCall('minimize');
      else if (act === 'max') void windowCall('toggle_maximize').then(() => this.look());
      else void windowCall('close');
    });
    window.addEventListener('resize', () => this.look());
    this.sync();
  }

  private active(): boolean {
    return wantsCustomTitleBar() && customTitleBarOn();
  }

  sync(): void {
    const want = this.active();
    this.box.hidden = !want;
    document.documentElement.classList.toggle('has-caption-buttons', want);
    if (wantsCustomTitleBar()) void windowCall('set_decorations', { value: !want });
    if (want) this.look();
  }

  toggle(): void {
    setCustomTitleBar(!customTitleBarOn());
    this.sync();
  }

  private look(): void {
    if (!this.active()) return;
    void windowCall<boolean>('is_maximized').then((on) => {
      const label = on ? 'Restore' : 'Maximize';
      const svg = on ? icons.capRestore : icons.capMax;
      if (this.max.getAttribute('aria-label') === label) return;
      this.max.setAttribute('aria-label', label);
      this.max.title = label;
      this.max.querySelector('.fc-icon')!.innerHTML = svg;
    });
  }
}

export class TitleTools {
  private readonly input: HTMLInputElement;
  private readonly pop: HTMLElement;
  private shown: string[] = [];
  private active = -1;

  constructor(private readonly header: HTMLElement) {
    this.input = header.querySelector<HTMLInputElement>('.fc-tb-search-input')!;
    this.pop = header.querySelector<HTMLElement>('.fc-search-pop')!;
    header.querySelector<HTMLElement>('.fc-tb-search-box')!.addEventListener('click', () => this.input.focus());
    this.input.addEventListener('input', () => this.find());
    this.input.addEventListener('focus', () => this.find());
    this.input.addEventListener('keydown', (e) => this.key(e));
    document.addEventListener('pointerdown', (e) => {
      if (!(e.target as Element).closest('.fc-tb-search')) this.close();
    });
    this.pop.addEventListener('pointerdown', (e) => e.preventDefault());
    this.pop.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (row) this.run(row.dataset.id!);
    });
    document.addEventListener('keydown', (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        this.input.focus();
        this.input.select();
      }
    });
    header.querySelector<HTMLElement>('.fc-tb-settings')!.addEventListener('click', () => void this.settings());
    header.querySelector<HTMLElement>('.fc-tb-share')!.addEventListener('click', () => void runCommand('share.panel'));
    const account = header.querySelector<HTMLButtonElement>('.fc-tb-account')!;
    account.addEventListener('click', () => void runCommand('review.panel'));
    this.account();
    window.addEventListener('storage', () => this.account());
  }

  account(): void {
    const btn = this.header.querySelector<HTMLElement>('.fc-tb-account')!;
    const name = userName();
    const initial = (name.trim()[0] ?? 'M').toUpperCase();
    if (btn.textContent !== initial) btn.textContent = initial;
    btn.style.background = colour(name);
    btn.title = `${name}: comments and changes`;
  }

  private async settings(): Promise<void> {
    if (!(await runCommand('app.settings'))) await runCommand('view.access');
  }

  private find(): void {
    const words = this.input.value.toLowerCase().split(/\s+/).filter(Boolean);
    const list = listCommands().filter((c) => words.every((w) => `${c.title} ${c.description}`.toLowerCase().includes(w))).slice(0, 8);
    const found = words.length ? list : [];
    const rows = this.pop.children;
    this.shown = found.map((c) => c.id);
    found.forEach((c, i) => {
      let row = rows[i] as HTMLElement | undefined;
      if (!row) {
        row = document.createElement('button');
        row.setAttribute('type', 'button');
        row.className = 'fc-search-row';
        row.setAttribute('role', 'option');
        row.innerHTML = '<span class="fc-search-name"></span><span class="fc-search-keys"></span>';
        this.pop.appendChild(row);
      }
      row.dataset.id = c.id;
      const name = row.firstElementChild!;
      if (name.textContent !== c.title) name.textContent = c.title;
      const keys = row.lastElementChild!;
      const k = (c.keys ?? '').replace('Mod', 'Ctrl');
      if (keys.textContent !== k) keys.textContent = k;
    });
    while (this.pop.children.length > found.length) this.pop.lastElementChild!.remove();
    this.pop.hidden = !words.length;
    if (words.length && !found.length) {
      this.pop.hidden = false;
      this.pop.dataset.empty = 'true';
    } else delete this.pop.dataset.empty;
    this.mark(found.length ? 0 : -1);
  }

  private mark(i: number): void {
    this.active = i;
    [...this.pop.children].forEach((r, n) => r.setAttribute('aria-selected', String(n === i)));
  }

  private key(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.shown.length;
      if (n) this.mark((this.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.shown[this.active]) this.run(this.shown[this.active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      this.input.blur();
    }
  }

  private run(id: string): void {
    this.close();
    this.input.blur();
    void runCommand(id);
  }

  private close(): void {
    this.pop.hidden = true;
    this.input.value = '';
  }
}
