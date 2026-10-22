import { el, escapeHtml } from './rb-dom';
import { rbIcon } from './rb-icons';

export interface Palette {
  theme: string[];
  standard: string[];
  current?: string;
  none?: string;
  pick: (hex: string) => void;
  pickTheme?: (index: number) => void;
}

export interface Tile {
  label: string;
  html?: string;
  icon?: string;
  title?: string;
  current?: boolean;
  run: () => void;
}

export type MItem =
  | { sep: true }
  | { head: string }
  | { label: string; cmd?: string; run?: () => void; icon?: string; keys?: string; sub?: MenuSrc; checked?: boolean; disabled?: boolean; danger?: boolean; font?: string }
  | { palette: Palette; more?: boolean }
  | { tiles: Tile[]; cols: number; wide?: boolean };

export type MenuSrc = MItem[] | (() => MItem[] | Promise<MItem[]>);

export interface MenuHost {
  run: (cmd: string, anchor: HTMLElement) => void;
  label: (cmd: string) => string;
  keys: (cmd: string) => string;
  icon: (cmd: string) => string;
  has: (cmd: string) => boolean;
}

interface Level {
  panel: HTMLElement;
  owner: HTMLElement | null;
}

export class RbMenus {
  private readonly levels: Level[] = [];
  private anchor: HTMLElement | null = null;
  private onClose: (() => void) | null = null;
  private seq = 0;
  private picker: HTMLInputElement | null = null;

  constructor(private readonly host: MenuHost) {
    document.addEventListener('pointerdown', (e) => {
      if (!this.levels.length) return;
      const t = e.target as Node;
      if (this.levels.some((l) => l.panel.contains(t))) return;
      if (this.anchor && this.anchor.contains(t)) return;
      this.close(false);
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.levels.length || this.levels.some((l) => l.panel.contains(e.target as Node))) return;
      e.stopPropagation();
      this.close(true);
    }, true);
    window.addEventListener('blur', () => this.close(false));
    window.addEventListener('resize', () => this.close(false));
  }

  get isOpen(): boolean {
    return this.levels.length > 0;
  }

  get anchorNode(): HTMLElement | null {
    return this.anchor;
  }

  async open(src: MenuSrc, anchor: HTMLElement, onClose?: () => void): Promise<void> {
    this.close(false);
    const mine = ++this.seq;
    const items = typeof src === 'function' ? await src() : src;
    if (mine !== this.seq) return;
    this.anchor = anchor;
    this.onClose = onClose ?? null;
    const r = anchor.getBoundingClientRect();
    this.push(items, null, r.left, r.bottom + 1, r.top);
    this.levels[0]?.panel.querySelector<HTMLElement>('.rb-mi:not(:disabled)')?.focus({ preventScroll: true });
  }

  close(restore: boolean): void {
    if (!this.levels.length) {
      return;
    }
    this.seq++;
    for (const l of this.levels) l.panel.remove();
    this.levels.length = 0;
    const a = this.anchor;
    const cb = this.onClose;
    this.anchor = null;
    this.onClose = null;
    cb?.();
    if (restore) a?.focus();
  }

  private trim(depth: number): void {
    while (this.levels.length > depth) this.levels.pop()?.panel.remove();
  }

  private push(items: MItem[], owner: HTMLElement | null, x: number, y: number, altY: number): void {
    const panel = el('<div class="rb-menu" role="menu"></div>');
    for (const it of items) {
      if ('sep' in it) {
        panel.appendChild(el('<div class="rb-msep" role="separator"></div>'));
      } else if ('head' in it) {
        panel.appendChild(el(`<div class="rb-mhead">${escapeHtml(it.head)}</div>`));
      } else if ('palette' in it) {
        panel.appendChild(this.paletteBlock(it));
      } else if ('tiles' in it) {
        panel.appendChild(this.tileBlock(it));
      } else {
        panel.appendChild(this.row(it, this.levels.length));
      }
    }
    panel.style.visibility = 'hidden';
    document.getElementById('overlay-root')?.appendChild(panel);
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const left = Math.max(4, Math.min(x, window.innerWidth - w - 4));
    const top = y + h <= window.innerHeight - 4 ? y : Math.max(4, Math.min(altY - h, window.innerHeight - h - 4));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.visibility = '';
    this.levels.push({ panel, owner });
    panel.addEventListener('keydown', (e) => this.key(e, panel));
  }

  private row(it: Extract<MItem, { label: string }>, depth: number): HTMLElement {
    const cmd = it.cmd;
    const ic = it.icon ?? (cmd ? this.host.icon(cmd) : '');
    const keys = it.keys ?? (cmd ? this.host.keys(cmd) : '');
    const b = el<HTMLButtonElement>(`<button class="rb-mi${it.danger ? ' is-danger' : ''}${it.checked ? ' is-checked' : ''}" type="button" role="menuitem"><span class="rb-mi-ic">${ic ? rbIcon(ic, 16) : ''}</span><span class="rb-mi-t"></span><span class="rb-mi-k"></span>${it.sub ? `<span class="rb-mi-sub">${rbIcon('chevronRight', 12)}</span>` : ''}</button>`);
    const text = b.querySelector('.rb-mi-t') as HTMLElement;
    text.textContent = it.label;
    if (it.font) text.style.fontFamily = `"${it.font}", var(--font-ui)`;
    (b.querySelector('.rb-mi-k') as HTMLElement).textContent = keys;
    b.disabled = !!it.disabled;
    if (it.sub) {
      const open = (): void => {
        this.trim(depth + 1);
        const r = b.getBoundingClientRect();
        const src = it.sub as MenuSrc;
        const mine = this.seq;
        void Promise.resolve(typeof src === 'function' ? src() : src).then((items) => {
          if (mine !== this.seq || this.levels.length !== depth + 1) return;
          this.push(items, b, r.right - 2, r.top - 4, r.bottom);
        });
      };
      b.addEventListener('click', open);
      b.addEventListener('pointerenter', () => { if (!b.disabled) open(); });
    } else {
      b.addEventListener('pointerenter', () => this.trim(depth + 1));
      b.addEventListener('click', () => {
        const anchor = this.anchor ?? b;
        this.close(false);
        if (it.run) it.run();
        else if (cmd) this.host.run(cmd, anchor);
      });
    }
    return b;
  }

  private paletteBlock(it: Extract<MItem, { palette: Palette }>): HTMLElement {
    const p = it.palette;
    const root = el('<div class="rb-pal"></div>');
    const cur = (p.current ?? '').toLowerCase();
    if (p.none !== undefined) {
      const none = el<HTMLButtonElement>('<button class="rb-mi rb-pal-none" type="button" role="menuitem"><span class="rb-mi-ic"></span><span class="rb-mi-t"></span></button>');
      (none.querySelector('.rb-mi-t') as HTMLElement).textContent = p.none;
      none.addEventListener('click', () => { this.close(false); p.pick(''); });
      root.appendChild(none);
    }
    const section = (title: string, colors: string[], themed: boolean): void => {
      root.appendChild(el(`<div class="rb-mhead">${escapeHtml(title)}</div>`));
      const row = el('<div class="rb-pal-row"></div>');
      colors.forEach((c, i) => {
        const b = el<HTMLButtonElement>('<button class="rb-sw" type="button" role="menuitem"></button>');
        b.style.setProperty('--sw', c);
        b.title = c.toUpperCase();
        b.setAttribute('aria-label', `${title} ${c}`);
        if (cur && cur === c.toLowerCase()) b.setAttribute('aria-pressed', 'true');
        b.addEventListener('click', () => {
          this.close(false);
          if (themed && p.pickTheme) p.pickTheme(i);
          else p.pick(c);
        });
        row.appendChild(b);
      });
      root.appendChild(row);
    };
    section('Theme Colors', p.theme, true);
    section('Standard Colors', p.standard, false);
    if (it.more !== false) {
      const more = el<HTMLButtonElement>('<button class="rb-mi" type="button" role="menuitem"><span class="rb-mi-ic"></span><span class="rb-mi-t">More Colors...</span></button>');
      more.addEventListener('click', () => {
        this.close(false);
        const input = (this.picker ??= (() => {
          const i = document.createElement('input');
          i.type = 'color';
          i.className = 'rb-sr';
          i.setAttribute('aria-label', 'More colours');
          document.body.appendChild(i);
          return i;
        })());
        input.value = /^#[0-9a-f]{6}$/i.test(p.current ?? '') ? (p.current as string) : '#ff0000';
        input.onchange = () => p.pick(input.value);
        input.click();
      });
      root.appendChild(more);
    }
    return root;
  }

  private tileBlock(it: Extract<MItem, { tiles: Tile[] }>): HTMLElement {
    const root = el(`<div class="rb-tiles${it.wide ? ' is-wide' : ''}" style="--cols:${it.cols}"></div>`);
    for (const t of it.tiles) {
      const b = el<HTMLButtonElement>(`<button class="rb-tile${t.current ? ' is-on' : ''}" type="button" role="menuitem"><span class="rb-tile-art">${t.html ?? (t.icon ? rbIcon(t.icon, 32) : '')}</span><span class="rb-tile-t"></span></button>`);
      (b.querySelector('.rb-tile-t') as HTMLElement).textContent = t.label;
      b.title = t.title ?? t.label;
      b.addEventListener('click', () => { this.close(false); t.run(); });
      root.appendChild(b);
    }
    return root;
  }

  private key(e: KeyboardEvent, panel: HTMLElement): void {
    const rows = Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const depth = this.levels.findIndex((l) => l.panel === panel);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (depth > 0) { const o = this.levels[depth].owner; this.trim(depth); o?.focus(); } else this.close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!rows.length) return;
      rows[(at + (e.key === 'ArrowDown' ? 1 : rows.length - 1) + (at < 0 ? 1 : 0)) % rows.length].focus();
    } else if (e.key === 'ArrowRight') {
      const cur = document.activeElement as HTMLElement;
      if (cur?.querySelector('.rb-mi-sub')) { e.preventDefault(); cur.click(); window.setTimeout(() => this.levels[depth + 1]?.panel.querySelector<HTMLElement>('button:not(:disabled)')?.focus(), 30); }
    } else if (e.key === 'ArrowLeft' && depth > 0) {
      e.preventDefault();
      const o = this.levels[depth].owner;
      this.trim(depth);
      o?.focus();
    }
  }
}
