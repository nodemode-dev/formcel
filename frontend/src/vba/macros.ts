import { actions, field, makeModal, type Modal } from '../ui/modal';
import type { VbaStore } from './model';
import { macros, procedures, qualified, type Proc } from './procs';

export interface MacrosHost {
  store: VbaStore;
  run(module: string, proc: string, into: boolean): void;
  edit(module: string, line: number): void;
  say(text: string, bad?: boolean): void;
  enabled(): boolean;
}

const DESC = (n: string) => new RegExp(`^\\s*Attribute\\s+${n}\\.VB_Description\\s*=\\s*"(.*)"\\s*$`, 'i');
const KEY = (n: string) => new RegExp(`^\\s*Attribute\\s+${n}\\.VB_ProcData\\.VB_Invoke_Func\\s*=\\s*"(.)?\\\\n`, 'i');

export interface MacroInfo {
  description: string;
  key: string;
}

export function macroInfo(store: VbaStore, p: Proc): MacroInfo {
  const attrs = store.get(p.module)?.procAttrs[p.name] ?? [];
  let description = '';
  let key = '';
  for (const a of attrs) {
    const d = DESC(p.name).exec(a);
    if (d) description = d[1].replace(/""/g, '"');
    const k = KEY(p.name).exec(a);
    if (k && k[1] && k[1] !== ' ') key = k[1];
  }
  return { description, key };
}

export function setMacroInfo(store: VbaStore, p: Proc, info: MacroInfo): void {
  const m = store.get(p.module);
  if (!m) return;
  const lines: string[] = [];
  if (info.description) lines.push(`Attribute ${p.name}.VB_Description = "${info.description.replace(/"/g, '""')}"`);
  lines.push(`Attribute ${p.name}.VB_ProcData.VB_Invoke_Func = "${info.key || ' '}\\n14"`);
  const attrs = { ...m.procAttrs };
  if (!info.description && !info.key) delete attrs[p.name];
  else attrs[p.name] = lines;
  store.setAttrs(p.module, attrs);
}

export function shortcuts(store: VbaStore): Map<string, Proc> {
  const out = new Map<string, Proc>();
  for (const p of macros(store.mods)) {
    const k = macroInfo(store, p).key;
    if (k) out.set(k, p);
  }
  return out;
}

export class MacrosDialog {
  private readonly modal: Modal;
  private readonly name: HTMLInputElement;
  private readonly list: HTMLUListElement;
  private readonly desc: HTMLElement;
  private shown: Proc[] = [];

  constructor(private readonly host: MacrosHost) {
    this.modal = makeModal('Macro', { wide: true });
    const b = this.modal.body;
    b.classList.add('fc-macros');
    this.name = Object.assign(document.createElement('input'), { className: 'fc-auto-input', spellcheck: false });
    this.name.setAttribute('aria-label', 'Macro name');
    this.list = document.createElement('ul');
    this.list.className = 'fc-macro-list';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Macros');
    this.desc = document.createElement('p');
    this.desc.className = 'fc-auto-hint';
    const side = document.createElement('div');
    side.className = 'fc-macro-side';
    for (const [id, text] of [['run', 'Run'], ['into', 'Step Into'], ['edit', 'Edit'], ['create', 'Create'], ['delete', 'Delete'], ['options', 'Options...'], ['cancel', 'Cancel']] as const) {
      const btn = Object.assign(document.createElement('button'), { type: 'button', className: id === 'run' ? 'fc-btn fc-btn-primary' : 'fc-btn', textContent: text });
      btn.dataset.a = id;
      side.appendChild(btn);
    }
    const left = document.createElement('div');
    left.className = 'fc-macro-main';
    left.append(field('Macro name', this.name), this.list, field('Macros in', Object.assign(document.createElement('select'), { className: 'fc-auto-input', innerHTML: '<option>This Workbook</option>' })), this.desc);
    const row = document.createElement('div');
    row.className = 'fc-macro-row';
    row.append(left, side);
    b.appendChild(row);
    this.list.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li');
      if (li) this.pick(Number(li.dataset.i));
    });
    this.list.addEventListener('dblclick', () => this.act('edit'));
    side.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a) this.act(a);
    });
    this.name.addEventListener('input', () => this.filter());
    this.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.act('run');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.list.querySelector<HTMLElement>('li')?.focus();
      }
    });
    this.list.addEventListener('keydown', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li');
      if (!li) return;
      if (e.key === 'ArrowDown') (li.nextElementSibling as HTMLElement | null)?.focus();
      else if (e.key === 'ArrowUp') (li.previousElementSibling as HTMLElement | null)?.focus();
      else if (e.key === 'Enter') this.act('run');
      else return;
      e.preventDefault();
    });
  }

  open(): void {
    this.name.value = '';
    this.filter();
    this.modal.open(this.name);
  }

  private filter(): void {
    const all = macros(this.host.store.mods).sort((a, b) => qualified(a).localeCompare(qualified(b)));
    const q = this.name.value.trim().toLowerCase();
    this.shown = q ? all.filter((p) => qualified(p).toLowerCase().includes(q)) : all;
    this.list.replaceChildren(
      ...this.shown.map((p, i) => {
        const li = document.createElement('li');
        li.tabIndex = 0;
        li.dataset.i = String(i);
        li.setAttribute('role', 'option');
        li.textContent = qualified(p);
        return li;
      }),
    );
    if (!this.shown.length) {
      const li = document.createElement('li');
      li.className = 'is-empty';
      li.textContent = this.host.store.mods.length ? 'No macros match.' : 'This workbook has no macros yet. Type a name and choose Create.';
      this.list.appendChild(li);
    }
    this.desc.textContent = '';
  }

  private pick(i: number): void {
    const p = this.shown[i];
    if (!p) return;
    this.name.value = qualified(p);
    for (const li of this.list.children) li.setAttribute('aria-selected', String((li as HTMLElement).dataset.i === String(i)));
    const info = macroInfo(this.host.store, p);
    this.desc.textContent = info.description ? info.description : '';
  }

  private target(): Proc | null {
    const t = this.name.value.trim().toLowerCase();
    return macros(this.host.store.mods).find((p) => qualified(p).toLowerCase() === t || (p.name.toLowerCase() === t && !t.includes('.'))) ?? null;
  }

  private act(a: string): void {
    const s = this.host.store;
    if (a === 'cancel') {
      this.modal.close();
      return;
    }
    if (a === 'create') {
      const raw = this.name.value.trim().replace(/^.*\./, '');
      if (!/^[A-Za-z][A-Za-z0-9_]{0,254}$/.test(raw)) {
        this.host.say('Type a macro name that starts with a letter and has no spaces', true);
        return;
      }
      if (procedures({ name: '', code: s.mods.map((m) => m.code).join('\n') }).some((p) => p.name.toLowerCase() === raw.toLowerCase())) {
        this.host.say(`${raw} already exists`, true);
        return;
      }
      const m = s.mods.find((x) => x.kind === 'std') ?? s.add('std');
      const at = m.code.replace(/\s+$/, '');
      s.setCode(m.name, `${at}${at ? '\n\n' : ''}Sub ${raw}()\n    \nEnd Sub\n`);
      this.modal.close();
      const line = s.get(m.name)!.code.split('\n').findIndex((l) => l.trim() === `Sub ${raw}()`) + 2;
      this.host.edit(m.name, line);
      return;
    }
    const p = this.target();
    if (!p) {
      this.host.say(this.name.value.trim() ? `The macro '${this.name.value.trim()}' cannot be found` : 'Pick a macro first', true);
      return;
    }
    if (a === 'run' || a === 'into') {
      if (!this.host.enabled()) {
        this.host.say('Macros are disabled. Choose Enable Content in the message bar first', true);
        return;
      }
      this.modal.close();
      this.host.run(p.module, p.name, a === 'into');
    } else if (a === 'edit') {
      this.modal.close();
      this.host.edit(p.module, p.line);
    } else if (a === 'delete') {
      if (!window.confirm(`Delete the macro ${qualified(p)}?`)) return;
      const m = s.get(p.module);
      if (!m) return;
      const lines = m.code.split('\n');
      lines.splice(p.line - 1, p.end - p.line + 1);
      const attrs = { ...m.procAttrs };
      delete attrs[p.name];
      s.setCode(p.module, lines.join('\n'));
      s.setAttrs(p.module, attrs);
      this.name.value = '';
      this.filter();
    } else if (a === 'options') this.options(p);
  }

  private options(p: Proc): void {
    const info = macroInfo(this.host.store, p);
    const m = makeModal(`Macro Options`);
    const key = Object.assign(document.createElement('input'), { className: 'fc-auto-input fc-auto-num', maxLength: 1, value: info.key, spellcheck: false });
    key.setAttribute('aria-label', 'Shortcut key');
    const keyRow = document.createElement('div');
    keyRow.className = 'fc-auto-row';
    keyRow.append('Ctrl+', key, Object.assign(document.createElement('span'), { className: 'fc-auto-hint', textContent: 'A capital letter adds Shift.' }));
    const desc = Object.assign(document.createElement('textarea'), { className: 'fc-auto-input', rows: 3, value: info.description });
    desc.setAttribute('aria-label', 'Description');
    const close = () => {
      m.close();
      m.el.remove();
      this.modal.open(this.name);
    };
    m.body.append(
      Object.assign(document.createElement('p'), { className: 'fc-auto-hint', textContent: `Macro name: ${qualified(p)}` }),
      field('Shortcut key', keyRow),
      field('Description', desc),
      actions('OK', () => {
        const k = key.value.trim();
        if (k && !/^[A-Za-z]$/.test(k)) {
          this.host.say('A shortcut key is one letter', true);
          return;
        }
        setMacroInfo(this.host.store, p, { description: desc.value.trim(), key: k });
        close();
        this.pick(this.shown.findIndex((x) => qualified(x) === qualified(p)));
      }, close),
    );
    this.modal.close();
    m.open(key);
  }
}
