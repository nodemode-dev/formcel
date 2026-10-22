export interface RbCommands {
  has(id: string): boolean;
  label(id: string): string;
  keys(id: string): string;
  enabled(id: string): boolean;
  checked(id: string): boolean;
  run(id: string, anchor?: HTMLElement | null): void;
  ids(): string[];
  icon(id: string): string;
}

class RbState {
  readonly disabled = new Set<string>();
  readonly pressed = new Set<string>();
  readonly text = new Map<string, string>();
  readonly swatch = new Map<string, string>();
  anchor: HTMLElement | null = null;
  root: HTMLElement | null = null;
  private readonly listeners = new Set<() => void>();
  private queued = 0;

  on(fn: () => void): void {
    this.listeners.add(fn);
  }

  changed(): void {
    if (this.queued) return;
    this.queued = requestAnimationFrame(() => {
      this.queued = 0;
      for (const fn of this.listeners) fn();
    });
  }
}

export const rbState = new RbState();

const visible = (n: HTMLElement): boolean => {
  const r = n.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

export function anchorRect(cmd: string): DOMRect {
  const root = rbState.root;
  if (root) {
    for (const n of Array.from(root.querySelectorAll<HTMLElement>(`[data-cmd="${cmd}"]`))) if (visible(n)) return n.getBoundingClientRect();
    const a = rbState.anchor;
    if (a?.isConnected && visible(a)) return a.getBoundingClientRect();
    const tabs = root.querySelector<HTMLElement>('.rb-tabs');
    if (tabs) return tabs.getBoundingClientRect();
  }
  return new DOMRect(80, 80, 0, 0);
}

export function ribbonButton(cmd: string): HTMLButtonElement {
  const apply = (): void => rbState.changed();
  const facade = {
    get disabled(): boolean {
      return rbState.disabled.has(cmd);
    },
    set disabled(v: boolean) {
      if (v === rbState.disabled.has(cmd)) return;
      if (v) rbState.disabled.add(cmd); else rbState.disabled.delete(cmd);
      apply();
    },
    get textContent(): string {
      return rbState.text.get(cmd) ?? '';
    },
    set textContent(v: string) {
      if (rbState.text.get(cmd) === v) return;
      rbState.text.set(cmd, v);
      apply();
    },
    getAttribute(name: string): string | null {
      return name === 'aria-pressed' ? String(rbState.pressed.has(cmd)) : null;
    },
    setAttribute(name: string, value: string): void {
      if (name !== 'aria-pressed') return;
      const on = value === 'true';
      if (on === rbState.pressed.has(cmd)) return;
      if (on) rbState.pressed.add(cmd); else rbState.pressed.delete(cmd);
      apply();
    },
    style: {
      setProperty(name: string, value: string): void {
        if (name !== '--swatch' || rbState.swatch.get(cmd) === value) return;
        rbState.swatch.set(cmd, value);
        apply();
      },
    },
    getBoundingClientRect(): DOMRect {
      return anchorRect(cmd);
    },
    addEventListener(type: string, fn: (e: Event) => void): void {
      rbState.root?.addEventListener(type, (e) => {
        if ((e.target as HTMLElement).closest?.(`[data-cmd="${cmd}"]`)) fn(e);
      });
    },
  };
  return facade as unknown as HTMLButtonElement;
}
