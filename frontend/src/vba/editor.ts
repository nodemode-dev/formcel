import { icon, type IconName } from '../ui/icons';
import { CodeView } from './codeview';
import { fullSource, splitSource, type VbaStore } from './model';
import { procAt } from './procs';
import type { VbaKind } from './runtime';
import type { Session } from './session';

export interface VbeHost {
  store: VbaStore;
  session: Session;
  title(): string;
  leave(): void;
  macros(): void;
  say(text: string, bad?: boolean): void;
}

interface View {
  name: string;
  code: CodeView;
  tab: HTMLElement;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TOOLS: ([string, IconName, string, string] | null)[] = [
  ['excel', 'sheet', 'View Microsoft Excel (Alt+F11)', 'Excel'],
  null,
  ['insert-module', 'moduleFile', 'Insert a Module', 'Module'],
  ['insert-class', 'classFile', 'Insert a Class Module', 'Class'],
  ['insert-form', 'userForm', 'Insert a UserForm', 'UserForm'],
  ['import', 'upload', 'Import File (.bas, .cls)', 'Import'],
  ['export', 'download', 'Export File (.bas, .cls)', 'Export'],
  ['remove', 'trash', 'Remove the selected module', 'Remove'],
  null,
  ['run', 'play', 'Run Sub/UserForm, or continue (F5)', 'Run'],
  ['reset', 'stop', 'Reset (stop the macro)', 'Reset'],
  ['into', 'stepInto', 'Step Into (F8)', 'Step Into'],
  ['over', 'stepOver', 'Step Over (Shift+F8)', 'Step Over'],
  ['out', 'stepOut', 'Step Out (Ctrl+Shift+F8)', 'Step Out'],
  ['break', 'breakpoint', 'Toggle Breakpoint (F9)', 'Breakpoint'],
  ['macros', 'macro', 'Macros (Alt+F8)', 'Macros'],
];

const KIND_LABEL: Record<VbaKind, string> = { std: 'Module', class: 'Class Module', document: 'Document', form: 'UserForm' };

export class Vbe {
  readonly el: HTMLElement;
  private readonly titleText: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly host_: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly tree: HTMLElement;
  private readonly props: HTMLElement;
  private readonly pos: HTMLElement;
  private readonly runState: HTMLElement;
  private readonly immLog: HTMLElement;
  private readonly immIn: HTMLInputElement;
  private readonly locals: HTMLElement;
  private readonly watch: HTMLElement;
  private readonly watchIn: HTMLInputElement;
  private readonly file: HTMLInputElement;
  private readonly views = new Map<string, View>();
  private readonly nodes = new Map<string, HTMLElement>();
  private readonly watches: string[] = [];
  private readonly history: string[] = [];
  private histAt = 0;
  private active = '';
  private selected = '';

  constructor(private readonly host: VbeHost) {
    const el = (this.el = h('section', 'fc-vbe'));
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Visual Basic Editor');
    el.innerHTML = `<header class="fc-vbe-title"><span class="fc-vbe-appicon">${icon('vbe')}</span><span class="fc-vbe-tt"></span><button type="button" class="fc-tool" data-a="close" title="Close and return to Microsoft Excel (Alt+Q)" aria-label="Close">${icon('close')}</button></header>
<div class="fc-vbe-bar" role="toolbar" aria-label="Standard">${TOOLS.map((t) => (t ? `<button type="button" class="fc-vbe-btn" data-a="${t[0]}" title="${t[2]}" aria-label="${t[2]}">${icon(t[1])}<span>${t[3]}</span></button>` : '<span class="fc-tool-sep" aria-hidden="true"></span>')).join('')}</div>
<div class="fc-vbe-body">
  <aside class="fc-vbe-side">
    <div class="fc-vbe-pane fc-vbe-explorer"><div class="fc-vbe-panehead">Project - VBAProject</div><div class="fc-vbe-tree" role="tree" aria-label="Project Explorer"></div></div>
    <div class="fc-vbe-pane fc-vbe-properties"><div class="fc-vbe-panehead">Properties</div><div class="fc-vbe-props"></div></div>
  </aside>
  <div class="fc-vbe-center">
    <div class="fc-vbe-tabs" role="tablist"></div>
    <div class="fc-vbe-host"><div class="fc-vbe-empty">Open a module from the Project Explorer, or insert a new one, to write macros.</div></div>
    <div class="fc-vbe-status"><span class="fc-vbe-run"></span><span class="fc-vbe-pos"></span></div>
  </div>
  <div class="fc-vbe-dock">
    <div class="fc-vbe-docktabs" role="tablist"><button type="button" data-d="imm" aria-selected="true">Immediate</button><button type="button" data-d="loc" aria-selected="false">Locals</button><button type="button" data-d="watch" aria-selected="false">Watches</button></div>
    <div class="fc-vbe-dockbody" data-p="imm"><div class="fc-vbe-imlog" aria-live="polite"></div><input class="fc-vbe-imin" spellcheck="false" autocomplete="off" aria-label="Immediate window" placeholder="Type a statement, or ? expression, and press Enter"></div>
    <div class="fc-vbe-dockbody" data-p="loc" hidden></div>
    <div class="fc-vbe-dockbody" data-p="watch" hidden><div class="fc-vbe-wadd"><input class="fc-vbe-win" spellcheck="false" autocomplete="off" aria-label="Add watch expression" placeholder="Add a watch expression"></div><div class="fc-vbe-wlist"></div></div>
  </div>
</div>
<input type="file" class="fc-file" accept=".bas,.cls,.txt" hidden>`;
    this.titleText = el.querySelector('.fc-vbe-tt')!;
    this.tabs = el.querySelector('.fc-vbe-tabs')!;
    this.host_ = el.querySelector('.fc-vbe-host')!;
    this.empty = el.querySelector('.fc-vbe-empty')!;
    this.tree = el.querySelector('.fc-vbe-tree')!;
    this.props = el.querySelector('.fc-vbe-props')!;
    this.pos = el.querySelector('.fc-vbe-pos')!;
    this.runState = el.querySelector('.fc-vbe-run')!;
    this.immLog = el.querySelector('.fc-vbe-imlog')!;
    this.immIn = el.querySelector('.fc-vbe-imin')!;
    this.locals = el.querySelector('[data-p="loc"]')!;
    this.watch = el.querySelector('.fc-vbe-wlist')!;
    this.watchIn = el.querySelector('.fc-vbe-win')!;
    this.file = el.querySelector('input[type="file"]')!;
    document.getElementById('overlay-root')!.appendChild(el);
    this.buildTree();
    this.wire();
    host.store.on((c, name) => this.stored(c, name));
    host.session.on((e, data) => this.debugged(e, data));
    this.syncButtons();
  }

  isOpen(): boolean {
    return !this.el.hidden;
  }

  open(module?: string, line?: number): void {
    this.el.hidden = false;
    this.syncTitle();
    this.syncTree();
    if (module) this.show(module, line);
    else if (!this.active) {
      const first = this.host.store.mods.find((m) => m.kind === 'std') ?? this.host.store.mods[0];
      if (first && first.code.trim()) this.show(first.name);
    }
    this.focusCode();
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    void this.host.store.flush();
  }

  focusImmediate(): void {
    this.el.hidden = false;
    this.dock('imm');
    this.immIn.focus();
  }

  private focusCode(): void {
    this.views.get(this.active)?.code.ta.focus();
  }

  private syncTitle(): void {
    const sub = this.active ? ` - [${this.active} (Code)]` : '';
    const t = `Microsoft Visual Basic for Applications - ${this.host.title()}${sub}`;
    if (this.titleText.textContent !== t) this.titleText.textContent = t;
  }

  private wire(): void {
    const el = this.el;
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (b && !b.hasAttribute('disabled')) this.action(b.dataset.a!);
      const d = (e.target as HTMLElement).closest<HTMLElement>('[data-d]');
      if (d) this.dock(d.dataset.d!);
    });
    this.tree.addEventListener('click', (e) => {
      const n = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
      if (!n) return;
      if (n.dataset.k === 'VBAProject') {
        this.select('VBAProject');
        return;
      }
      if (n.dataset.group) {
        n.parentElement?.classList.toggle('is-closed');
        return;
      }
      this.select(n.dataset.k!);
    });
    this.tree.addEventListener('dblclick', (e) => {
      const n = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
      if (n && !n.dataset.group) this.show(n.dataset.k!);
    });
    this.tree.addEventListener('keydown', (e) => {
      const n = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
      if (n && e.key === 'Enter' && !n.dataset.group) this.show(n.dataset.k!);
    });
    this.tabs.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (!t) return;
      if ((e.target as HTMLElement).closest('[data-x]')) this.closeTab(t.dataset.tab!);
      else this.show(t.dataset.tab!);
    });
    this.file.addEventListener('change', () => {
      const f = this.file.files?.[0];
      if (f) void f.text().then((t) => this.importText(f.name, t));
      this.file.value = '';
    });
    el.addEventListener('keydown', (e) => this.keys(e));
    this.immIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.immIn.value.trim();
        this.immIn.value = '';
        if (text) void this.immediate(text);
      } else if (e.key === 'ArrowUp' && this.history.length) {
        e.preventDefault();
        this.histAt = Math.max(0, this.histAt - 1);
        this.immIn.value = this.history[this.histAt] ?? '';
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.histAt = Math.min(this.history.length, this.histAt + 1);
        this.immIn.value = this.history[this.histAt] ?? '';
      }
    });
    this.watchIn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !this.watchIn.value.trim()) return;
      e.preventDefault();
      this.watches.push(this.watchIn.value.trim());
      this.watchIn.value = '';
      this.paintWatches();
    });
    this.watch.addEventListener('click', (e) => {
      const x = (e.target as HTMLElement).closest<HTMLElement>('[data-w]');
      if (x) {
        this.watches.splice(Number(x.dataset.w), 1);
        this.paintWatches();
      }
    });
  }

  private keys(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    let a = '';
    if (k === 'F5' && !e.shiftKey && !mod) a = 'run';
    else if (k === 'F8' && !e.shiftKey && !mod) a = 'into';
    else if (k === 'F8' && e.shiftKey && !mod) a = 'over';
    else if (k === 'F8' && e.shiftKey && mod) a = 'out';
    else if (k === 'F9' && !mod && !e.shiftKey) a = 'break';
    else if (k === 'F11' && e.altKey) a = 'excel';
    else if (k.toLowerCase() === 'q' && e.altKey) a = 'excel';
    else if (k.toLowerCase() === 'g' && mod) {
      e.preventDefault();
      this.dock('imm');
      this.immIn.focus();
      return;
    } else if (k.toLowerCase() === 's' && mod) a = 'save';
    else if (k === 'F5' && e.shiftKey) a = 'reset';
    else if (k === 'F8' && e.altKey) a = 'macros';
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    this.action(a);
  }

  private action(a: string): void {
    const s = this.host.store;
    const se = this.host.session;
    switch (a) {
      case 'close':
      case 'excel':
        this.host.leave();
        break;
      case 'save':
        void s.flush().then(() => this.host.say(s.error ? s.error : 'The macros are saved in the workbook', !!s.error));
        break;
      case 'insert-module':
        this.show(s.add('std').name);
        break;
      case 'insert-class':
        this.show(s.add('class').name);
        break;
      case 'insert-form':
        this.show(s.add('form').name);
        break;
      case 'import':
        this.file.click();
        break;
      case 'export':
        this.exportSelected();
        break;
      case 'remove':
        this.removeSelected();
        break;
      case 'run':
        if (se.state === 'paused') se.step('continue');
        else this.runHere(false);
        break;
      case 'reset':
        se.reset();
        break;
      case 'into':
        if (se.state === 'paused') se.step('into');
        else this.runHere(true);
        break;
      case 'over':
        if (se.state === 'paused') se.step('over');
        else this.runHere(true);
        break;
      case 'out':
        if (se.state === 'paused') se.step('out');
        break;
      case 'break': {
        const v = this.views.get(this.active);
        if (v) se.toggleBreak(this.active, v.code.caretLine());
        break;
      }
      case 'macros':
        this.host.macros();
        break;
    }
  }

  runHere(into: boolean): void {
    const v = this.views.get(this.active);
    const m = v ? this.host.store.get(this.active) : undefined;
    if (!v || !m) {
      this.host.macros();
      return;
    }
    const p = procAt(m, v.code.caretLine());
    if (!p || p.params !== '' || p.type === 'Property') {
      this.host.macros();
      return;
    }
    void this.host.session.run(m.name, p.name, into);
  }

  private select(name: string): void {
    this.selected = name;
    for (const [k, n] of this.nodes) n.classList.toggle('is-selected', k === name);
    this.paintProps();
  }

  show(name: string, line?: number): void {
    const store = this.host.store;
    const m = store.get(name) ?? (this.sheetCode(name) ? store.document(name) : undefined);
    if (!m) return;
    let v = this.views.get(m.name);
    if (!v) {
      const code = new CodeView({
        changed: (t) => store.setCode(m.name, t),
        toggleBreak: (l) => this.host.session.toggleBreak(m.name, l),
        caret: (l, c) => {
          const t = `Ln ${l}, Col ${c}`;
          if (this.pos.textContent !== t) this.pos.textContent = t;
        },
      });
      code.onBreaksMoved = (b) => this.host.session.setBreaks(m.name, b);
      code.setText(m.code);
      code.setBreaks(this.host.session.breakpoints.get(m.name) ?? new Set());
      code.el.hidden = true;
      this.host_.appendChild(code.el);
      const tab = h('button', 'fc-vbe-tab');
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.dataset.tab = m.name;
      tab.innerHTML = `<span>${esc(m.name)}</span><i data-x title="Close" aria-label="Close ${esc(m.name)}">${icon('close')}</i>`;
      this.tabs.appendChild(tab);
      v = { name: m.name, code, tab };
      this.views.set(m.name, v);
    }
    this.active = m.name;
    for (const w of this.views.values()) {
      w.code.el.hidden = w !== v;
      w.tab.setAttribute('aria-selected', String(w === v));
    }
    this.empty.hidden = true;
    this.select(m.name);
    this.syncTitle();
    this.syncTree();
    if (line) v.code.goto(line);
    else v.code.ta.focus();
  }

  private sheetCode(name: string): boolean {
    const s = this.host.store;
    return name === s.workbook || s.sheets.some((x, i) => (x.codeName || `Sheet${i + 1}`) === name);
  }

  private closeTab(name: string): void {
    const v = this.views.get(name);
    if (!v) return;
    v.code.el.remove();
    v.tab.remove();
    this.views.delete(name);
    if (this.active === name) {
      this.active = '';
      const next = [...this.views.keys()].pop();
      if (next) this.show(next);
      else {
        this.empty.hidden = false;
        this.syncTitle();
      }
    }
  }

  private stored(c: string, name?: string): void {
    if (c === 'load') {
      for (const k of [...this.views.keys()]) this.closeTab(k);
      this.active = '';
      this.watches.length = 0;
      this.paintWatches();
      this.syncTree();
      return;
    }
    if (c === 'modules') {
      for (const k of [...this.views.keys()]) {
        if (!this.host.store.get(k)) {
          const renamedTo = name && this.host.store.get(name) && !this.views.has(name) ? name : '';
          if (renamedTo) this.renameView(k, renamedTo);
          else this.closeTab(k);
        }
      }
      this.syncTree();
      this.paintProps();
    }
    if (c === 'code' && name === this.selected) this.paintProps();
    if (c === 'saved' || c === 'error') this.syncSave();
  }

  private renameView(from: string, to: string): void {
    const v = this.views.get(from);
    if (!v) return;
    this.views.delete(from);
    v.name = to;
    v.tab.dataset.tab = to;
    v.tab.querySelector('span')!.textContent = to;
    this.views.set(to, v);
    if (this.active === from) this.active = to;
    if (this.selected === from) this.selected = to;
    this.syncTitle();
  }

  private syncSave(): void {
    const e = this.host.store.error;
    if (e) this.host.say(e, true);
  }

  private buildTree(): void {
    this.tree.innerHTML = ['root'].map(() => `<div class="fc-vbe-node fc-vbe-root" data-k="VBAProject" data-group="1">${icon('folder')}<span class="fc-vbe-pn">VBAProject</span></div>`).join('');
    const root = this.tree.firstElementChild as HTMLElement;
    const wrap = h('div', 'fc-vbe-children');
    for (const [id, label] of [['objects', 'Microsoft Excel Objects'], ['forms', 'Forms'], ['modules', 'Modules'], ['classes', 'Class Modules']] as const) {
      const g = h('div', 'fc-vbe-group');
      g.dataset.g = id;
      g.innerHTML = `<div class="fc-vbe-node" data-k="group:${id}" data-group="1" role="treeitem">${icon('folder')}<span>${label}</span></div><div class="fc-vbe-children"></div>`;
      wrap.appendChild(g);
    }
    root.insertAdjacentElement('afterend', wrap);
  }

  private syncTree(): void {
    const s = this.host.store;
    const rootName = this.tree.querySelector('.fc-vbe-pn')!;
    const label = `${s.projectName} (${this.host.title()})`;
    if (rootName.textContent !== label) rootName.textContent = label;
    const head = this.el.querySelector('.fc-vbe-explorer .fc-vbe-panehead')!;
    const ht = `Project - ${s.projectName}`;
    if (head.textContent !== ht) head.textContent = ht;
    const objects: [string, string, IconName][] = [];
    s.sheets.forEach((sh, i) => objects.push([sh.codeName || `Sheet${i + 1}`, `${sh.codeName || `Sheet${i + 1}`} (${sh.name})`, 'sheet']));
    objects.push([s.workbook, s.workbook, 'sheet']);
    const groups: Record<string, [string, string, IconName][]> = {
      objects,
      forms: s.mods.filter((m) => m.kind === 'form').map((m) => [m.name, m.name, 'userForm']),
      modules: s.mods.filter((m) => m.kind === 'std').map((m) => [m.name, m.name, 'moduleFile']),
      classes: s.mods.filter((m) => m.kind === 'class').map((m) => [m.name, m.name, 'classFile']),
    };
    for (const [g, items] of Object.entries(groups)) {
      const box = this.tree.querySelector<HTMLElement>(`[data-g="${g}"] > .fc-vbe-children`)!;
      const have = new Map<string, HTMLElement>();
      for (const c of [...box.children] as HTMLElement[]) have.set(c.dataset.k!, c);
      const keys = new Set(items.map((i) => i[0]));
      for (const [k, c] of have) if (!keys.has(k)) {
        c.remove();
        this.nodes.delete(k);
      }
      items.forEach(([key, text, ic], i) => {
        let n = have.get(key);
        if (!n) {
          n = h('div', 'fc-vbe-node fc-vbe-leaf');
          n.dataset.k = key;
          n.tabIndex = 0;
          n.setAttribute('role', 'treeitem');
          n.innerHTML = `${icon(ic)}<span></span>`;
          box.appendChild(n);
          this.nodes.set(key, n);
        }
        const span = n.querySelector('span:last-child')!;
        if (span.textContent !== text) span.textContent = text;
        if (box.children[i] !== n) box.insertBefore(n, box.children[i] ?? null);
        n.classList.toggle('is-selected', key === this.selected);
      });
      const gnode = this.tree.querySelector<HTMLElement>(`[data-g="${g}"]`)!;
      gnode.hidden = g !== 'objects' && items.length === 0;
    }
  }

  private paintProps(): void {
    const s = this.host.store;
    const m = this.selected ? s.get(this.selected) : undefined;
    const sheet = s.sheets.find((x, i) => (x.codeName || `Sheet${i + 1}`) === this.selected);
    let rows: [string, string, boolean][] = [];
    if (m) rows = [['(Name)', m.name, m.kind === 'document'], ['Type', KIND_LABEL[m.kind], true], ['Lines', String(m.code ? m.code.split('\n').length : 0), true], ['Private', m.private ? 'True' : 'False', true]];
    else if (sheet) rows = [['(Name)', this.selected, true], ['Name', sheet.name, true], ['Type', 'Worksheet', true]];
    else if (this.selected === s.workbook) rows = [['(Name)', s.workbook, true], ['Type', 'Workbook', true]];
    else if (this.selected) rows = [['(Name)', s.projectName, true], ['Project protection', s.locked ? 'Locked' : 'Unlocked', true], ['Modules', String(s.mods.length), true]];
    const key = `${this.selected}|${rows.map((r) => r.join('=')).join('|')}`;
    if (this.props.dataset.key === key) return;
    this.props.dataset.key = key;
    this.props.innerHTML = rows.length ? `<table>${rows.map(([k, v, ro]) => `<tr><th scope="row">${esc(k)}</th><td>${k === '(Name)' && !ro ? `<input class="fc-vbe-name" value="${esc(v)}" spellcheck="false" aria-label="Module name">` : esc(v)}</td></tr>`).join('')}</table>` : '<p class="fc-vbe-note">Select an item in the Project Explorer.</p>';
    const inp = this.props.querySelector<HTMLInputElement>('.fc-vbe-name');
    inp?.addEventListener('change', () => {
      const err = s.rename(this.selected, inp.value.trim());
      if (err) {
        this.host.say(err, true);
        inp.value = this.selected;
      } else {
        const to = inp.value.trim();
        this.renameView(this.selected, to);
        this.selected = to;
        this.props.dataset.key = '';
        this.syncTree();
      }
    });
  }

  private exportSelected(): void {
    const m = this.host.store.get(this.selected || this.active);
    if (!m) {
      this.host.say('Select a module to export first', true);
      return;
    }
    const blob = new Blob([fullSource(m)], { type: 'text/plain' });
    const a = h('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${m.name}.${m.kind === 'std' ? 'bas' : 'cls'}`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  private removeSelected(): void {
    const s = this.host.store;
    const m = s.get(this.selected || this.active);
    if (!m) return;
    if (m.kind === 'document') {
      this.host.say('A sheet or workbook module cannot be removed', true);
      return;
    }
    if (!window.confirm(`Remove ${m.name}? This cannot be undone.`)) return;
    s.remove(m.name);
    this.selected = '';
    this.paintProps();
  }

  importText(filename: string, text: string): void {
    const s = this.host.store;
    const parts = splitSource(text);
    const named = parts.header.map((l) => /^\s*Attribute\s+VB_Name\s*=\s*"([^"]+)"/i.exec(l)?.[1]).find(Boolean);
    const ext = filename.toLowerCase().endsWith('.bas') ? 'std' : 'class';
    let name = (named ?? filename.replace(/\.[^.]+$/, '')).replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z]+/, 'M').slice(0, 31) || 'Module';
    if (s.get(name)) name = s.uniqueName(name.replace(/\d+$/, ''));
    const m = s.add(ext as VbaKind, name, parts.code);
    m.header = parts.header.length ? parts.header.map((l) => (/^\s*Attribute\s+VB_Name/i.test(l) ? `Attribute VB_Name = "${name}"` : l)) : m.header;
    m.procAttrs = parts.procAttrs;
    this.show(name);
    this.host.say(`Imported ${filename} as ${name}`);
  }

  private dock(tab: string): void {
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-d]')) b.setAttribute('aria-selected', String(b.dataset.d === tab));
    for (const p of this.el.querySelectorAll<HTMLElement>('[data-p]')) p.hidden = p.dataset.p !== tab;
  }

  private print(text: string, bad = false): void {
    const line = h('div', bad ? 'is-bad' : '');
    line.textContent = text;
    this.immLog.appendChild(line);
    while (this.immLog.children.length > 500) this.immLog.firstElementChild!.remove();
    this.immLog.scrollTop = this.immLog.scrollHeight;
  }

  private async immediate(text: string): Promise<void> {
    this.history.push(text);
    this.histAt = this.history.length;
    this.print(text);
    const expr = text.startsWith('?') ? `Debug.Print ${text.slice(1).trim()}` : text;
    try {
      const out = await this.host.session.evaluate(expr);
      if (out) this.print(out);
    } catch (e) {
      this.print(e instanceof Error ? e.message : String(e), true);
    }
  }

  private debugged(e: string, data?: unknown): void {
    const se = this.host.session;
    if (e === 'print') this.print(String(data));
    else if (e === 'breaks') {
      const m = String(data);
      this.views.get(m)?.code.setBreaks(se.breakpoints.get(m) ?? new Set());
    } else if (e === 'state') {
      this.syncButtons();
      const t = se.state === 'idle' ? 'Ready' : se.state === 'running' ? 'Running' : 'Break';
      if (this.runState.textContent !== t) this.runState.textContent = t;
      if (se.state !== 'paused') for (const v of this.views.values()) v.code.setExec(0);
    } else if (e === 'pause') {
      const s = se.paused;
      if (!s) return;
      this.el.hidden = false;
      this.show(s.frame.module, s.frame.line);
      this.views.get(s.frame.module)?.code.setExec(s.frame.line, s.reason === 'error');
      this.paintLocals();
      void this.paintWatches();
      if (s.message) this.print(s.message, true);
    } else if (e === 'done') {
      const r = se.last;
      if (r && !r.ok && r.error) {
        this.print(r.error, true);
        if (r.module && r.line) {
          this.show(r.module, r.line);
          this.views.get(r.module)?.code.setExec(r.line, true);
          this.runState.textContent = 'Error';
        } else this.host.say(r.error, true);
      }
    }
  }

  private syncButtons(): void {
    const st = this.host.session.state;
    const off: Record<string, boolean> = { reset: st === 'idle', out: st !== 'paused', run: st === 'running' };
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.fc-vbe-bar [data-a]')) {
      const d = !!off[b.dataset.a!];
      if (b.disabled !== d) b.disabled = d;
    }
  }

  private paintLocals(): void {
    const p = this.host.session.paused;
    const rows = p?.locals ?? [];
    const stack = p?.stack ?? [];
    this.locals.innerHTML = `<div class="fc-vbe-stack">${stack.map((f) => `<span>${esc(f.module)}.${esc(f.proc)}</span>`).join('')}</div><table><thead><tr><th>Expression</th><th>Value</th><th>Type</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.value)}</td><td>${esc(r.type)}</td></tr>`).join('')}</tbody></table>`;
  }

  private async paintWatches(): Promise<void> {
    const out: string[] = [];
    for (let i = 0; i < this.watches.length; i++) {
      let v = '';
      if (this.host.session.state === 'paused') {
        try {
          v = await this.host.session.evaluate(this.watches[i]);
        } catch {
          v = '<Out of context>';
        }
      } else v = '<Out of context>';
      out.push(`<tr><td>${esc(this.watches[i])}</td><td>${esc(v)}</td><td><button type="button" class="fc-tool" data-w="${i}" title="Delete watch" aria-label="Delete watch">${icon('close')}</button></td></tr>`);
    }
    this.watch.innerHTML = `<table><thead><tr><th>Expression</th><th>Value</th><th></th></tr></thead><tbody>${out.join('')}</tbody></table>`;
  }
}
