import { el, patchList, setClass, setDisabled, setTitle } from './rb-dom';
import { rbIcon } from './rb-icons';
import { rbState, type RbCommands } from './rb-state';

export const QAT_KEY = 'formcel.qat';
export const DEFAULT_QAT = ['edit.undo', 'edit.redo'];

interface QatState { items: string[]; below?: boolean; v?: number }

export class Qat {
  readonly node: HTMLElement;
  items: string[] = [...DEFAULT_QAT];
  below = false;
  onChange: (() => void) | null = null;
  onContext: ((id: string | null, x: number, y: number) => void) | null = null;
  onMore: ((anchor: HTMLElement) => void) | null = null;
  onRun: (() => void) | null = null;
  onPlace: ((below: boolean) => void) | null = null;
  private readonly list: HTMLElement;
  private readonly more: HTMLButtonElement;
  private shown = '';

  constructor(private readonly commands: RbCommands) {
    this.node = el(`<div class="rb-qat" role="toolbar" aria-label="Quick Access Toolbar"><div class="rb-qat-list"></div><button class="rb-qat-more" type="button" aria-haspopup="menu" aria-label="Customize Quick Access Toolbar" title="Customize Quick Access Toolbar">${rbIcon('chevronDown', 12)}</button></div>`);
    this.list = this.node.querySelector('.rb-qat-list') as HTMLElement;
    this.more = this.node.querySelector('.rb-qat-more') as HTMLButtonElement;
    this.load();
    this.node.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); });
    this.node.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b || b.disabled) return;
      if (b === this.more) { this.onMore?.(b); return; }
      if (b.dataset.cmd) { rbState.anchor = b; this.commands.run(b.dataset.cmd, b); this.sync(); this.onRun?.(); }
    });
    this.node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-cmd]');
      this.onContext?.(b?.dataset.cmd ?? null, e.clientX, e.clientY);
    });
    this.node.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const all = Array.from(this.node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const at = all.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      e.preventDefault();
      e.stopPropagation();
      all[(at + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length].focus();
    });
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(QAT_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<QatState>;
      if (Array.isArray(s.items)) this.items = s.items.filter((x): x is string => typeof x === 'string');
      this.below = !!s.below;
    } catch { return; }
  }

  private save(): void {
    try { localStorage.setItem(QAT_KEY, JSON.stringify({ items: this.items, below: this.below, v: 1 } satisfies QatState)); } catch { return; }
  }

  has(id: string): boolean { return this.items.includes(id); }

  add(id: string): void { if (!this.has(id)) this.set([...this.items, id]); }

  remove(id: string): void { this.set(this.items.filter((x) => x !== id)); }

  toggle(id: string): void { if (this.has(id)) this.remove(id); else this.add(id); }

  reset(): void { this.set([...DEFAULT_QAT]); }

  setBelow(on: boolean): void {
    if (this.below === on) return;
    this.below = on;
    this.save();
    this.onPlace?.(on);
  }

  set(items: string[]): void {
    this.items = Array.from(new Set(items));
    this.save();
    this.render();
    this.onChange?.();
  }

  render(): void {
    const ids = this.items;
    const key = ids.join('|');
    if (key === this.shown) return;
    this.shown = key;
    patchList(this.list, ids, {
      key: (id) => id,
      create: (id) => {
        const b = el<HTMLButtonElement>(`<button class="rb-qat-btn" type="button" data-cmd="${id}"></button>`);
        b.innerHTML = rbIcon(this.commands.icon(id), 16);
        return b;
      },
    });
    this.patch();
  }

  private patch(): void {
    for (const b of Array.from(this.list.querySelectorAll<HTMLButtonElement>('button[data-cmd]'))) {
      const id = b.dataset.cmd as string;
      const label = this.commands.label(id);
      const keys = this.commands.keys(id);
      setTitle(b, keys ? `${label} (${keys})` : label);
      if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
      setDisabled(b, !this.commands.enabled(id));
      setClass(b, 'is-on', this.commands.checked(id));
    }
  }

  sync(): void {
    this.render();
    this.patch();
  }
}
