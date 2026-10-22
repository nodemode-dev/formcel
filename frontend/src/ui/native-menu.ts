import { getCommand, runCommand } from './commands';
import { isSub, menusInWindow, resolve, type MenuDef, type MenuSpec } from './menubar';

const FORCE_KEY = 'formcel.forceNativeMenus';

function forced(): boolean {
  try {
    return localStorage.getItem(FORCE_KEY) === '1' || /[?&]native-menus\b/.test(location.search);
  } catch {
    return false;
  }
}

export const wantsNativeMenus = (): boolean =>
  '__TAURI_INTERNALS__' in window && (/Mac/.test(navigator.platform) || forced()) && !menusInWindow();

export function accelerator(combo: string | undefined): string | null {
  if (!combo) return null;
  const parts = combo.endsWith('++') ? [...combo.slice(0, -2).split('+'), 'Plus'] : combo.split('+');
  const names: Record<string, string> = { Mod: 'CmdOrCtrl', Alt: 'Alt', Shift: 'Shift', Ctrl: 'Ctrl', '=': '=', '-': '-', ',': ',', '/': '/', Delete: 'Delete', Backspace: 'Backspace', Escape: 'Escape', Enter: 'Enter', Tab: 'Tab', Space: 'Space', Plus: 'Plus' };
  const out: string[] = [];
  for (const p of parts) {
    if (names[p]) out.push(names[p]);
    else if (/^[A-Za-z0-9]$/.test(p)) out.push(p.toUpperCase());
    else if (/^F([1-9]|1[0-2])$/.test(p)) out.push(p);
    else return null;
  }
  return out.join('+');
}

type Api = typeof import('@tauri-apps/api/menu');
type Live = { id: string; item: { setEnabled(on: boolean): Promise<void>; setChecked?(on: boolean): Promise<void> } };

const TEXT_EDITS: Record<string, string> = { 'edit.undo': 'undo', 'edit.redo': 'redo', 'edit.cut': 'cut', 'edit.copy': 'copy', 'edit.paste': 'paste', 'edit.select-all': 'select-all' };
const NOT_TEXT = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image']);

export function textFieldFocused(): boolean {
  const a = document.activeElement;
  if (a instanceof HTMLTextAreaElement) return !a.readOnly && !a.disabled;
  if (a instanceof HTMLInputElement) return !NOT_TEXT.has(a.type) && !a.readOnly && !a.disabled;
  return a instanceof HTMLElement && a.isContentEditable;
}

export class NativeMenus {
  private items: Live[] = [];
  private building = false;
  private again = false;
  private stateTimer = 0;

  constructor(private readonly menus: () => MenuDef[]) {
    for (const ev of ['pointerup', 'keyup', 'focusin', 'focusout'] as const) {
      window.addEventListener(ev, () => {
        if (this.items.length) this.refresh();
      }, { passive: true });
    }
  }

  async build(): Promise<void> {
    if (this.building) {
      this.again = true;
      return;
    }
    this.building = true;
    try {
      const api: Api = await import('@tauri-apps/api/menu');
      const items: Live[] = [];
      const make = async (spec: MenuSpec): Promise<unknown> => {
        if (spec === '-') return api.PredefinedMenuItem.new({ item: 'Separator' });
        if (isSub(spec)) {
          const kids = (await Promise.all(spec.items.map(make))).filter(Boolean);
          return api.Submenu.new({ text: spec.label, items: kids as never[] });
        }
        const r = resolve(spec);
        if (!getCommand(r.id)) return null;
        const acc = accelerator(r.keys);
        const opts = {
          text: r.label,
          enabled: this.enabled(r.id),
          action: () => {
            const edit = TEXT_EDITS[r.id];
            if (edit && textFieldFocused()) {
              void import('@tauri-apps/api/core')
                .then((m) => m.invoke('text_edit', { action: edit }))
                .catch(() => {
                  document.execCommand(edit === 'select-all' ? 'selectAll' : edit);
                });
            } else void runCommand(r.id);
            this.refresh();
          },
        };
        let item;
        if (r.checked !== null) {
          const c = { ...opts, checked: r.checked };
          try {
            item = await api.CheckMenuItem.new(acc ? { ...c, accelerator: acc } : c);
          } catch {
            item = await api.CheckMenuItem.new(c);
          }
        } else {
          try {
            item = await api.MenuItem.new(acc ? { ...opts, accelerator: acc } : opts);
          } catch {
            item = await api.MenuItem.new(opts);
          }
        }
        items.push({ id: r.id, item });
        return item;
      };
      const top: unknown[] = [];
      top.push(await api.Submenu.new({
        text: 'FormCel',
        items: [
          await api.PredefinedMenuItem.new({ item: { About: { name: 'FormCel' } }, text: 'About FormCel' }),
          await api.PredefinedMenuItem.new({ item: 'Separator' }),
          ...(getCommand('app.settings') ? [await make({ cmd: 'app.settings', label: 'Preferences...', keys: 'Mod+,' })] : []),
          await api.PredefinedMenuItem.new({ item: 'Separator' }),
          await api.PredefinedMenuItem.new({ item: 'Hide' }),
          await api.PredefinedMenuItem.new({ item: 'Quit' }),
        ] as never[],
      }));
      for (const def of this.menus()) {
        const list = typeof def.items === 'function' ? def.items() : def.items;
        const kids = (await Promise.all(list.map(make))).filter(Boolean);
        top.push(await api.Submenu.new({ text: def.label, items: kids as never[] }));
      }
      const menu = await api.Menu.new({ items: top as never[] });
      await menu.setAsAppMenu();
      this.items = items;
      document.documentElement.classList.add('has-native-menus');
    } finally {
      this.building = false;
      if (this.again) {
        this.again = false;
        void this.build();
      }
    }
  }

  private enabled(id: string): boolean {
    if (TEXT_EDITS[id] && textFieldFocused()) return true;
    return resolve(id).enabled;
  }

  refresh(): void {
    if (this.stateTimer) return;
    this.stateTimer = window.setTimeout(() => {
      this.stateTimer = 0;
      for (const { id, item } of this.items) {
        const r = resolve(id);
        void item.setEnabled(this.enabled(id)).catch(() => undefined);
        if (r.checked !== null && item.setChecked) void item.setChecked(r.checked).catch(() => undefined);
      }
    }, 150);
  }
}
