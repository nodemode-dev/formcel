import { getCommand, runCommand } from './commands';
import { icon } from './icons';

export interface MenuLeaf {
  cmd?: string;
  label?: string;
  keys?: string;
  run?: () => void;
  checked?: () => boolean;
  enabled?: () => boolean;
}

export interface MenuSub {
  label: string;
  items: MenuSpec[];
}

export type MenuSpec = '-' | string | MenuLeaf | MenuSub;

export interface MenuDef {
  label: string;
  items: MenuSpec[] | (() => MenuSpec[]);
}

export interface Resolved {
  id: string;
  run: (() => void) | null;
  label: string;
  keys: string;
  enabled: boolean;
  checked: boolean | null;
}

export const MENUS_IN_WINDOW_KEY = 'formcel.menusInWindow';

export const isMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform);

export function menusInWindow(): boolean {
  try {
    return localStorage.getItem(MENUS_IN_WINDOW_KEY) === '1';
  } catch {
    return false;
  }
}

export function prettyKeys(keys: string): string {
  if (!keys) return '';
  const mac = isMac();
  return keys
    .split('+')
    .map((k, i, all) => {
      if (k === '' && i === all.length - 1) return '+';
      if (k === 'Mod') return mac ? '⌘' : 'Ctrl';
      if (k === 'Shift') return mac ? '⇧' : 'Shift';
      if (k === 'Alt') return mac ? '⌥' : 'Alt';
      if (k === 'Ctrl') return mac ? '⌃' : 'Ctrl';
      return k;
    })
    .filter((k, i, all) => !(k === '+' && all[i - 1] === '+'))
    .join(mac ? '' : '+');
}

export function isSub(s: MenuSpec): s is MenuSub {
  return typeof s === 'object' && 'items' in s;
}

export function resolve(s: string | MenuLeaf): Resolved {
  const own = typeof s === 'object' ? s : null;
  const id = typeof s === 'string' ? s : s.cmd ?? '';
  const c = id ? getCommand(id) : undefined;
  const label = own?.label || c?.title || id;
  const keys = own?.keys || c?.keys || '';
  if (own?.run) {
    return { id, run: own.run, label, keys, enabled: own.enabled ? own.enabled() : true, checked: own.checked ? own.checked() : null };
  }
  return {
    id,
    run: null,
    label,
    keys,
    enabled: !!c && (c.enabled ? c.enabled() : true),
    checked: c?.checked ? c.checked() : null,
  };
}

function build(tag: string, cls: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

class Popup {
  readonly el = build('div', 'fc-mb-menu');
  private sub: Popup | null = null;
  private subFor: HTMLElement | null = null;

  constructor(specs: MenuSpec[], private readonly act: (r: Resolved) => void, readonly parent: Popup | null = null) {
    this.el.setAttribute('role', 'menu');
    this.el.dataset.depth = parent ? '1' : '0';
    for (const s of specs) this.el.appendChild(this.row(s));
    this.el.addEventListener('keydown', (e) => this.key(e));
  }

  private row(s: MenuSpec): HTMLElement {
    if (s === '-') {
      const sep = build('div', 'fc-mb-sep');
      sep.setAttribute('role', 'separator');
      return sep;
    }
    const b = build('button', 'fc-mb-item') as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    const mark = build('span', 'fc-mb-mark');
    const label = build('span', 'fc-mb-label');
    const keys = build('span', 'fc-mb-keys');
    b.append(mark, label, keys);
    if (isSub(s)) {
      label.textContent = s.label;
      keys.innerHTML = icon('chevronRight');
      b.classList.add('has-sub');
      b.setAttribute('aria-haspopup', 'menu');
      b.addEventListener('pointerenter', () => this.openSub(b, s));
      b.addEventListener('click', () => this.openSub(b, s, true));
      return b;
    }
    const r = resolve(s);
    label.textContent = r.label;
    keys.textContent = prettyKeys(r.keys);
    b.disabled = !r.enabled;
    if (r.checked !== null) {
      b.setAttribute('role', 'menuitemcheckbox');
      b.setAttribute('aria-checked', String(r.checked));
      if (r.checked) mark.innerHTML = icon('check');
    }
    b.addEventListener('pointerenter', () => this.closeSub());
    b.addEventListener('click', () => this.act(r));
    return b;
  }

  items(): HTMLElement[] {
    return [...this.el.querySelectorAll<HTMLElement>(':scope > .fc-mb-item:not(:disabled)')];
  }

  openSub(b: HTMLElement, s: MenuSub, focus = false): void {
    if (this.subFor === b && this.sub) {
      if (focus) this.sub.items()[0]?.focus();
      return;
    }
    this.closeSub();
    const p = new Popup(s.items, this.act, this);
    this.sub = p;
    this.subFor = b;
    b.classList.add('is-open');
    document.getElementById('overlay-root')!.appendChild(p.el);
    const r = b.getBoundingClientRect();
    p.place(r.right - 2, r.top - 5, r.left + 2);
    if (focus) p.items()[0]?.focus();
  }

  closeSub(): void {
    this.sub?.destroy();
    this.sub = null;
    this.subFor?.classList.remove('is-open');
    this.subFor = null;
  }

  place(x: number, y: number, flipX = x): void {
    const st = this.el.style;
    st.left = '0px';
    st.top = '0px';
    st.visibility = 'hidden';
    const r = this.el.getBoundingClientRect();
    const left = x + r.width > window.innerWidth - 4 ? Math.max(4, flipX - r.width) : x;
    st.left = `${left}px`;
    st.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
    st.visibility = '';
  }

  destroy(): void {
    this.closeSub();
    this.el.remove();
  }

  contains(n: Node): boolean {
    return this.el.contains(n) || !!this.sub?.contains(n);
  }

  private key(e: KeyboardEvent): void {
    const items = this.items();
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'ArrowRight' && document.activeElement?.classList.contains('has-sub')) {
      e.preventDefault();
      (document.activeElement as HTMLElement).click();
    } else if (e.key === 'ArrowLeft' && this.parent) {
      e.preventDefault();
      const host = this.parent.subFor;
      this.parent.closeSub();
      host?.focus();
    }
  }
}

export class MenuBar {
  private readonly buttons: HTMLButtonElement[] = [];
  private popup: Popup | null = null;
  private openIndex = -1;
  private returnTo: HTMLElement | null = null;

  constructor(host: HTMLElement, private readonly menus: MenuDef[]) {
    host.setAttribute('role', 'menubar');
    menus.forEach((m, i) => {
      const b = build('button', 'fc-mb-btn', m.label) as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => (this.openIndex === i ? this.close() : this.open(i)));
      b.addEventListener('pointerenter', () => {
        if (this.openIndex >= 0 && this.openIndex !== i) this.open(i, false);
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.open(i);
        } else if (e.key === 'ArrowRight') this.buttons[(i + 1) % this.buttons.length].focus();
        else if (e.key === 'ArrowLeft') this.buttons[(i - 1 + this.buttons.length) % this.buttons.length].focus();
      });
      this.buttons.push(b);
      host.appendChild(b);
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.openIndex < 0) return;
      const n = e.target as Node;
      if (host.contains(n) || this.popup?.contains(n)) return;
      this.close();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (this.openIndex < 0) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.key === 'ArrowRight' && !(document.activeElement as HTMLElement | null)?.classList.contains('has-sub')) {
        this.open((this.openIndex + 1) % this.menus.length);
      } else if (e.key === 'ArrowLeft' && !(document.activeElement as HTMLElement | null)?.closest('.fc-mb-menu[data-depth="1"]')) {
        this.open((this.openIndex - 1 + this.menus.length) % this.menus.length);
      }
    }, true);
    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => this.close());
  }

  get isOpen(): boolean {
    return this.openIndex >= 0;
  }

  open(i: number, focus = true): void {
    if (this.openIndex < 0) this.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.popup?.destroy();
    const def = this.menus[i];
    const specs = typeof def.items === 'function' ? def.items() : def.items;
    const p = new Popup(specs, (r) => this.run(r));
    this.popup = p;
    this.openIndex = i;
    this.buttons.forEach((b, k) => {
      b.classList.toggle('is-open', k === i);
      b.setAttribute('aria-expanded', String(k === i));
    });
    document.getElementById('overlay-root')!.appendChild(p.el);
    const r = this.buttons[i].getBoundingClientRect();
    p.place(r.left, r.bottom + 2);
    if (focus) p.items()[0]?.focus();
  }

  close(): void {
    if (this.openIndex < 0) return;
    this.popup?.destroy();
    this.popup = null;
    this.openIndex = -1;
    for (const b of this.buttons) {
      b.classList.remove('is-open');
      b.setAttribute('aria-expanded', 'false');
    }
    const back = this.returnTo;
    this.returnTo = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }

  private run(r: Resolved): void {
    this.close();
    if (r.run) r.run();
    else void runCommand(r.id);
  }
}

export class ContextMenu {
  private popup: Popup | null = null;
  private returnTo: HTMLElement | null = null;

  constructor() {
    document.addEventListener('pointerdown', (e) => {
      if (this.popup && !this.popup.contains(e.target as Node)) this.close();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (this.popup && e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    }, true);
    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => this.close());
  }

  show(x: number, y: number, specs: MenuSpec[], keepOpen = false): void {
    this.close();
    this.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const p = new Popup(specs, (r) => {
      if (!keepOpen) this.close();
      if (r.run) r.run();
      else void runCommand(r.id);
      if (keepOpen) this.show(x, y, specs, keepOpen);
    });
    this.popup = p;
    document.getElementById('overlay-root')!.appendChild(p.el);
    p.place(x, y - p.el.getBoundingClientRect().height);
    p.items()[0]?.focus();
  }

  close(): void {
    if (!this.popup) return;
    this.popup.destroy();
    this.popup = null;
    const back = this.returnTo;
    this.returnTo = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }
}
