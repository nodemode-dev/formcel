export type MenuItem =
  | { label: string; keys?: string; run: () => void | Promise<void>; danger?: boolean; disabled?: boolean; confirm?: string }
  | { sep: true }
  | { swatches: string[]; current?: string; pick: (c: string) => void; name?: string; none?: string };

export class Menu {
  private readonly el: HTMLElement;
  private onClose: (() => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'fc-menu';
    this.el.setAttribute('role', 'menu');
    this.el.hidden = true;
    document.getElementById('overlay-root')!.appendChild(this.el);
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target as Node)) this.close();
    }, true);
    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => this.close());
    this.el.addEventListener('keydown', (e) => this.key(e));
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(x: number, y: number, items: MenuItem[], onClose?: () => void): void {
    this.onClose = onClose ?? null;
    this.el.replaceChildren(...items.map((it) => this.item(it)));
    this.el.style.left = '0px';
    this.el.style.top = '0px';
    this.el.style.visibility = 'hidden';
    this.el.hidden = false;
    const r = this.el.getBoundingClientRect();
    this.el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
    this.el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
    this.el.style.visibility = '';
    this.el.querySelector<HTMLElement>('.fc-menu-item:not([disabled])')?.focus();
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private item(it: MenuItem): HTMLElement {
    if ('sep' in it) {
      const s = document.createElement('div');
      s.className = 'fc-menu-sep';
      s.setAttribute('role', 'separator');
      return s;
    }
    if ('swatches' in it) {
      const row = document.createElement('div');
      row.className = 'fc-menu-swatches';
      for (const c of it.swatches) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'fc-swatch';
        const what = it.name ?? 'Tab colour';
        b.title = c ? what : it.none ?? 'No colour';
        b.setAttribute('aria-label', c ? `${what} ${c}` : it.none ?? 'No tab colour');
        b.style.setProperty('--sw', c || 'transparent');
        if ((it.current ?? '') === c) b.setAttribute('aria-pressed', 'true');
        b.addEventListener('click', () => {
          it.pick(c);
          this.close();
        });
        row.appendChild(b);
      }
      return row;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `fc-menu-item${it.danger ? ' is-danger' : ''}`;
    b.setAttribute('role', 'menuitem');
    b.disabled = !!it.disabled;
    const label = document.createElement('span');
    label.textContent = it.label;
    b.appendChild(label);
    if (it.keys) {
      const k = document.createElement('span');
      k.className = 'fc-menu-keys';
      k.textContent = it.keys;
      b.appendChild(k);
    }
    b.addEventListener('click', () => {
      if (it.confirm && !b.dataset.armed) {
        b.dataset.armed = '1';
        label.textContent = it.confirm;
        return;
      }
      this.close();
      void it.run();
    });
    return b;
  }

  private key(e: KeyboardEvent): void {
    const items = [...this.el.querySelectorAll<HTMLElement>('.fc-menu-item:not([disabled])')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  }
}
