import { engine } from '../engine';
import { parseRef } from '../grid/a1';
import type { Grid } from '../grid/grid';
import { registerCommand } from '../ui/commands';
import { icon } from '../ui/icons';
import { actions, field, makeModal } from '../ui/modal';
import { CONTROL_TYPES, FormControls, pickerHtml, type Ctl, type CtlType } from './controls';
import { Vbe } from './editor';
import { MacrosDialog, setMacroInfo, shortcuts } from './macros';
import { VbaStore } from './model';
import { macros, procedures, qualified } from './procs';
import { generateVba } from './recordVba';
import { runtime } from './runtime';
import { Session } from './session';
import { forget, isTrusted, LEVEL_TEXT, loadTrust, setLevel, trust, type MacroLevel } from './trust';

export interface VbaHooks {
  grid: Grid;
  id(): string;
  book(): number;
  title(): string;
  sheets(): string[];
  status(text: string, error?: boolean): void;
  settings: {
    get<T>(key: string): T | undefined;
    set(key: string, value: unknown): void;
  };
  toolbar: HTMLElement;
}

const PREFIX = 'vba:';

export class Vba {
  readonly store = new VbaStore();
  readonly session = new Session(this.store);
  private readonly vbe: Vbe;
  private readonly dialog: MacrosDialog;
  private readonly controls: FormControls;
  private readonly bar: HTMLElement;
  private readonly pill: HTMLElement;
  private enabled = true;
  private hadMacros = false;
  private recording: { name: string; shortcut: string; description: string; start: number; acts: Parameters<NonNullable<Grid['recorder']>>[0][]; sheets: string[] } | null = null;
  private readonly pendingPrint: string[] = [];

  constructor(private readonly h: VbaHooks) {
    this.session.gate = () => (this.enabled ? null : 'Macros are disabled in this workbook. Choose Enable Content in the message bar to run them.');
    this.vbe = new Vbe({
      store: this.store,
      session: this.session,
      title: () => h.title() || 'Workbook',
      leave: () => this.leave(),
      macros: () => this.dialog.open(),
      say: (t, e) => h.status(t, e),
    });
    this.dialog = new MacrosDialog({
      store: this.store,
      run: (m, p, into) => void this.session.run(m, p, into).then((r) => this.ran(r.ok, r.error)),
      edit: (m, l) => this.edit(m, l),
      say: (t, e) => h.status(t, e),
      enabled: () => this.enabled,
    });
    this.controls = new FormControls({
      grid: h.grid,
      sheet: () => h.grid.sheetIndex,
      active: () => !!h.id(),
      load: () => h.settings.get<Ctl[]>('formControls') ?? [],
      save: (l) => h.settings.set('formControls', l),
      macros: () => macros(this.store.mods).map(qualified),
      run: (m) => this.runByName(m),
      read: (ref) => {
        const b = parseRef(ref);
        return b ? h.grid.shownAt(b.r0, b.c0) : '';
      },
      readRange: (ref) => {
        const b = parseRef(ref);
        const out: string[] = [];
        if (b) for (let r = b.r0; r <= b.r1 && out.length < 500; r++) for (let c = b.c0; c <= b.c1; c++) out.push(h.grid.shownAt(r, c));
        return out;
      },
      write: (ref, value) => {
        const b = parseRef(ref);
        if (!b) return;
        void engine()
          .apply(h.book(), [[b.r0, b.c0, value]], h.grid.sheetIndex)
          .then((c) => h.grid.commitEdits(c))
          .then(() => this.controls.refresh());
      },
      say: (t, e) => h.status(t, e),
    });
    this.bar = document.createElement('div');
    this.bar.className = 'fc-secbar';
    this.bar.hidden = true;
    this.bar.setAttribute('role', 'alert');
    this.bar.innerHTML = `<span class="fc-secbar-ic">${icon('lock')}</span><span class="fc-secbar-t"><b>SECURITY WARNING</b> <span class="fc-secbar-m"></span></span><button type="button" class="fc-btn" data-a="enable">Enable Content</button><button type="button" class="fc-tool" data-a="dismiss" title="Close" aria-label="Close">${icon('close')}</button>`;
    this.bar.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'enable') this.enable();
      else if (a === 'dismiss') this.bar.hidden = true;
    });
    h.toolbar.after(this.bar);
    this.pill = document.createElement('div');
    this.pill.className = 'fc-recpill';
    this.pill.hidden = true;
    this.pill.innerHTML = `<span class="fc-recpill-dot"></span><span class="fc-recpill-t"></span><button type="button" class="fc-btn" data-a="stop">Stop Recording</button>`;
    this.pill.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-a="stop"]')) this.stopRecording();
    });
    document.getElementById('overlay-root')!.appendChild(this.pill);
    this.session.on((e, d) => {
      if (e === 'print') this.pendingPrint.push(String(d));
    });
    document.addEventListener('keydown', (e) => this.key(e), true);
    this.store.on((c) => {
      if (c === 'code' || c === 'modules') this.afterEdit();
    });
    this.commands();
  }

  private key(e: KeyboardEvent): void {
    if (!this.h.id()) return;
    const modal = document.querySelector('.fc-modal:not([hidden])');
    if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'F11') {
      e.preventDefault();
      e.stopPropagation();
      if (this.vbe.isOpen() && !modal) this.leave();
      else this.edit();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'F8' && !modal) {
      e.preventDefault();
      e.stopPropagation();
      this.dialog.open();
      return;
    }
    if (this.vbe.isOpen() || modal || !(e.ctrlKey || e.metaKey) || e.altKey || e.key.length !== 1 || !/[A-Za-z]/.test(e.key)) return;
    const tgt = e.target as HTMLElement;
    if (tgt.closest('input, textarea, select') && tgt !== this.h.grid.editor) return;
    const hit = shortcuts(this.store).get(e.shiftKey ? e.key.toUpperCase() : e.key.toLowerCase());
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    this.runByName(qualified(hit));
  }

  private leave(): void {
    this.vbe.close();
    this.h.grid.focus();
  }

  edit(module?: string, line?: number): void {
    this.vbe.open(module, line);
  }

  private ran(ok: boolean, error?: string): void {
    if (ok) this.h.status('Macro finished');
    else if (error) this.h.status(error.slice(0, 160), true);
    this.controls.refresh();
  }

  private afterEdit(): void {
    if (this.hadMacros && !this.enabled) return;
    if (this.hadMacros && this.enabled && loadTrust().level !== 'all') trust(this.h.id(), this.store.signature());
  }

  macroList(): { id: string; name: string }[] {
    return macros(this.store.mods).map((p) => ({ id: PREFIX + qualified(p), name: qualified(p) }));
  }

  runById(id: string): boolean {
    if (!id.startsWith(PREFIX)) return false;
    this.runByName(id.slice(PREFIX.length));
    return true;
  }

  runByName(name: string): void {
    const [module, proc] = name.includes('.') ? (name.split('.') as [string, string]) : ['', name];
    this.h.status(`Running ${name}`);
    void this.session.run(module, proc).then((r) => {
      this.ran(r.ok, r.error);
      this.h.grid.focus();
    });
  }

  preopen(id: string, hadMacros: boolean): void {
    this.hadMacros = hadMacros;
    const t = loadTrust();
    if (!hadMacros || t.level === 'all') {
      this.enabled = true;
      this.paintBar('off');
    } else if (t.level === 'notify') {
      this.enabled = Object.prototype.hasOwnProperty.call(t.documents, id);
      this.paintBar(this.enabled ? 'off' : 'ask');
    } else {
      this.enabled = false;
      this.paintBar(t.level === 'signed' ? 'blocked' : 'off');
    }
  }

  async opened(id: string): Promise<void> {
    await this.store.load(id);
    this.controls.reload();
    if (!this.hadMacros) return;
    if (this.enabled && loadTrust().level === 'notify' && !isTrusted(id, this.store.signature())) {
      this.enabled = false;
      this.paintBar('ask');
    } else if (this.enabled) void this.fireOpen();
  }

  closed(): void {
    this.session.reset();
    this.vbe.close();
    this.bar.hidden = true;
    this.enabled = true;
    this.hadMacros = false;
    this.controls.reload(true);
  }

  private paintBar(mode: 'off' | 'on' | 'ask' | 'blocked'): void {
    const msg = this.bar.querySelector('.fc-secbar-m')!;
    const btn = this.bar.querySelector<HTMLElement>('[data-a="enable"]')!;
    const text = mode === 'ask' ? 'Macros have been disabled.' : mode === 'blocked' ? (loadTrust().level === 'signed' ? 'Macros have been disabled because FormCel cannot check their digital signatures.' : 'Macros have been disabled by your macro security setting.') : '';
    if (msg.textContent !== text) msg.textContent = text;
    btn.hidden = mode !== 'ask';
    const hide = mode === 'off' || mode === 'on' || (mode === 'blocked' && loadTrust().level === 'silent');
    if (this.bar.hidden !== hide) this.bar.hidden = hide;
  }

  private enable(): void {
    this.enabled = true;
    trust(this.h.id(), this.store.signature());
    this.bar.hidden = true;
    this.h.status('Macros enabled; trusted document');
    void this.fireOpen();
  }

  private async fireOpen(): Promise<void> {
    if (!runtime().ready) return;
    const wb = this.store.get(this.store.workbook);
    if (wb && procedures(wb).some((p) => p.name === 'Workbook_Open')) await this.session.run(wb.name, 'Workbook_Open');
  }

  private commands(): void {
    const cmd = (id: string, title: string, description: string, run: () => void | Promise<void>, keys?: string) => registerCommand({ id, title, description, changes: false, keys, run });
    cmd('vba.editor', 'Visual Basic', 'Open the Visual Basic Editor: the Project Explorer, a code window for each module, the Immediate, Locals and Watches windows.', () => {
      if (this.h.id()) this.edit();
    }, 'Alt+F11');
    cmd('vba.macros', 'Macros', 'List the macros in this workbook to run them, step through them, edit them, create or delete them, or set a shortcut key.', () => {
      if (this.h.id()) this.dialog.open();
    }, 'Alt+F8');
    cmd('vba.record', 'Record Macro', 'Record the edits, formats, sorts and sheet changes you make as a VBA Sub in a module. Choose it again to stop.', () => (this.recording ? this.stopRecording() : this.askRecording()));
    cmd('vba.view-code', 'View Code', 'Open the VBA code window of the active sheet.', () => {
      if (this.h.id()) this.edit(this.store.document(this.store.codeNameOf(this.h.grid.sheetIndex)).name);
    });
    cmd('vba.security', 'Macro Security', 'Choose how FormCel treats macros in workbooks you open, and clear the trusted documents.', () => this.security());
    cmd('vba.controls', 'Insert form controls', 'Insert a Button, Check Box, Combo Box, List Box, Option Button, Spin Button, Scroll Bar, Label or Group Box on the sheet and assign a macro to it.', () => this.pick());
    for (const [type, label] of CONTROL_TYPES) cmd(`vba.control.${type}`, label, `Insert a ${label} form control on the sheet.`, () => this.insertControl(type));
  }

  private insertControl(type: CtlType): void {
    if (!this.h.id()) return;
    this.controls.add(type);
    this.h.status(`${CONTROL_TYPES.find((t) => t[0] === type)![1]} added; Ctrl+click to select it`);
  }

  private pick(): void {
    if (!this.h.id()) return;
    const m = makeModal('Form Controls');
    const grid = document.createElement('div');
    grid.className = 'fc-ctl-picks';
    grid.innerHTML = pickerHtml();
    grid.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')?.dataset.t as CtlType | undefined;
      if (!t) return;
      m.close();
      m.el.remove();
      this.insertControl(t);
    });
    const done = () => {
      m.close();
      m.el.remove();
    };
    m.body.append(grid, actions('Close', done, done, [], ''));
    m.open();
  }

  private security(): void {
    const m = makeModal('Macro Settings', { wide: true });
    const cur = loadTrust().level;
    const box = document.createElement('div');
    box.className = 'fc-macro-levels';
    const order: MacroLevel[] = ['silent', 'notify', 'signed', 'all'];
    box.innerHTML = order.map((l) => `<label class="fc-macro-level"><input type="radio" name="lvl" value="${l}" ${l === cur ? 'checked' : ''}><span><b>${LEVEL_TEXT[l][0]}</b><small>${LEVEL_TEXT[l][1]}</small></span></label>`).join('');
    const clear = Object.assign(document.createElement('button'), { type: 'button', className: 'fc-btn', textContent: 'Clear trusted documents' });
    clear.addEventListener('click', () => {
      for (const k of Object.keys(loadTrust().documents)) forget(k);
      this.h.status('No workbook is a trusted document now');
    });
    const close = () => {
      m.close();
      m.el.remove();
    };
    m.body.append(box, field('Trusted Documents', clear), actions('OK', () => {
      const v = box.querySelector<HTMLInputElement>('input:checked')?.value as MacroLevel | undefined;
      if (v) setLevel(v);
      close();
    }, close));
    m.open();
  }

  private askRecording(): void {
    if (!this.h.id()) return;
    if (this.h.grid.recorder) {
      this.h.status('Another recording is already running. Stop it first.', true);
      return;
    }
    const taken = new Set(procedures({ name: '', code: this.store.mods.map((m) => m.code).join('\n') }).map((p) => p.name.toLowerCase()));
    let n = 1;
    while (taken.has(`macro${n}`)) n++;
    const m = makeModal('Record Macro');
    const name = Object.assign(document.createElement('input'), { className: 'fc-auto-input', value: `Macro${n}`, spellcheck: false });
    const key = Object.assign(document.createElement('input'), { className: 'fc-auto-input fc-auto-num', maxLength: 1, spellcheck: false });
    const where = Object.assign(document.createElement('select'), { className: 'fc-auto-input', innerHTML: '<option>This Workbook</option>' });
    const desc = Object.assign(document.createElement('textarea'), { className: 'fc-auto-input', rows: 3, value: `Macro recorded ${new Date().toLocaleDateString()}` });
    const keyRow = document.createElement('div');
    keyRow.className = 'fc-auto-row';
    keyRow.append('Ctrl+', key);
    const close = () => {
      m.close();
      m.el.remove();
    };
    m.body.append(field('Macro name', name), field('Shortcut key', keyRow), field('Store macro in', where), field('Description', desc), actions('OK', () => {
      const nm = name.value.trim();
      if (!/^[A-Za-z][A-Za-z0-9_]{0,254}$/.test(nm)) {
        this.h.status('A macro name starts with a letter and has no spaces', true);
        return;
      }
      if (taken.has(nm.toLowerCase())) {
        this.h.status(`${nm} already exists`, true);
        return;
      }
      if (key.value && !/^[A-Za-z]$/.test(key.value)) {
        this.h.status('A shortcut key is one letter', true);
        return;
      }
      close();
      this.startRecording(nm, key.value, desc.value.trim());
    }, close));
    m.open(name);
  }

  private startRecording(name: string, shortcut: string, description: string): void {
    const g = this.h.grid;
    this.recording = { name, shortcut, description, start: g.sheetIndex, acts: [], sheets: this.h.sheets().slice() };
    g.recorder = (a) => this.recording?.acts.push(a);
    this.pill.querySelector('.fc-recpill-t')!.textContent = `Recording ${name}`;
    this.pill.hidden = false;
    this.h.status(`Recording ${name}. Do the steps, then choose Stop Recording.`);
  }

  private stopRecording(): void {
    const r = this.recording;
    if (!r) return;
    this.recording = null;
    this.h.grid.recorder = null;
    this.pill.hidden = true;
    if (!r.acts.length) {
      this.h.status('Nothing was recorded');
      return;
    }
    const names = this.h.sheets();
    const out = generateVba(r.acts, (i) => names[i] ?? r.sheets[i] ?? names[0], r.name, r.start, r.description, r.shortcut);
    const mod = [...this.store.mods].reverse().find((m) => m.kind === 'std') ?? this.store.add('std');
    const at = mod.code.replace(/\s+$/, '');
    this.store.setCode(mod.name, `${at}${at ? '\n\n' : ''}${out.code}`);
    const p = procedures(this.store.get(mod.name)!).find((x) => x.name === r.name);
    if (p && (r.description || r.shortcut)) setMacroInfo(this.store, p, { description: r.description, key: r.shortcut });
    void this.store.flush();
    this.h.status(`Recorded ${r.acts.length} action${r.acts.length === 1 ? '' : 's'} as ${mod.name}.${r.name}${out.skipped ? `; ${out.skipped} could not be written as VBA` : ''}`);
  }

  sheetChanged(): void {
    this.controls.sync();
  }
}
