import type { Arrow, EngineClient } from '../engine';
import { cmd, parseAreas, parseSettings, parseSpill, parseStatus, withSetting, type CalcMode, type CalcSettings, type CalcStatus, type SpillInfo } from '../engine/calc';
import { colName, type Range } from '../grid/a1';
import type { Grid } from '../grid/grid';
import { ErrCheck } from './errcheck';
import { EditLinks } from './links';
import type { Menu, MenuItem } from './menu';
import { actions, el, makeModal, type Modal } from './modal';

export interface CalcDoc {
  calc?: string;
  externals?: string[];
  arrays?: number[][][];
}

export interface CalcHost {
  grid: Grid;
  menu: Menu;
  engine: EngineClient;
  sheetBar: HTMLElement;
  gridBox: HTMLElement;
  formulaBar: HTMLTextAreaElement;
  book(): number;
  sheets(): string[];
  say(text: string, bad?: boolean): void;
  anchor(command: string): DOMRect;
  post(body: { cmd: string }): Promise<unknown>;
  evaluate(): void;
  arrows(row: number, col: number, list: Arrow[]): void;
  drain(fresh?: boolean, all?: boolean): Promise<void>;
  goSheet(index: number): void;
}

type Register = (id: string, title: string, description: string, changes: boolean, run: () => void | Promise<void>, keys?: string) => void;

const DEFAULTS: CalcSettings = { mode: 'auto', style: 'a1', iterate: false, iterations: 100, delta: 0.001, threads: 0, rules: 383 };
const MIRRORED = new Set(['set', 'load', 'calculate', 'array', 'loadarrays', 'ignore', 'resetignore', 'fix', 'extload', 'extchange', 'extbreak']);
const MODES: [CalcMode, string][] = [['auto', 'Automatic'], ['tables', 'Automatic except for data tables'], ['manual', 'Manual']];
const CIRCULAR_TEXT = 'There are one or more circular references where a formula refers to its own cell either directly or indirectly. This might cause them to calculate incorrectly. Try removing or changing these references, or moving the formulas to different cells.';

export class Calc {
  private settings: CalcSettings = DEFAULTS;
  private stat: CalcStatus = { mode: 'auto', stale: 0, circular: 0, tables: false, names: '' };
  private spill: SpillInfo | null = null;
  private spillColor = '#2563eb';
  private chain: Promise<unknown> = Promise.resolve();
  private arraySig = new Map<number, string>();
  private lastExt = '';
  private warned = '';
  private tableDirty = false;
  private timer = 0;
  private syncTimer = 0;
  private hostTimer = 0;
  private bar: { root: HTMLElement; calc: HTMLButtonElement; circ: HTMLElement };
  private options: { modal: Modal; read(): void } | null = null;
  private circularModal: Modal | null = null;
  readonly errors: ErrCheck;
  private readonly links: EditLinks;

  constructor(private readonly host: CalcHost) {
    this.errors = new ErrCheck({
      grid: host.grid,
      engine: host.engine,
      menu: host.menu,
      mount: host.gridBox,
      book: () => host.book(),
      settings: () => this.settings,
      run: (c) => this.run(c),
      say: (t, b) => host.say(t, b),
      evaluate: () => host.evaluate(),
      arrows: (r, c, l) => host.arrows(r, c, l),
      focusBar: () => {
        host.formulaBar.focus();
        host.formulaBar.select();
      },
      circular: () => this.circularNames(),
      goto: (w) => this.goto(w),
    });
    this.links = new EditLinks({ engine: host.engine, book: () => host.book(), run: (c) => this.run(c), drain: (f) => host.drain(f) });
    const root = el('div', 'fc-calcstat');
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    const calc = el('button', 'fc-calcstat-calc', 'Calculate');
    calc.type = 'button';
    calc.title = 'Calculate now (F9)';
    calc.dataset.on = '0';
    calc.addEventListener('click', () => void this.calculate('all'));
    const circ = el('span', 'fc-calcstat-circ');
    circ.dataset.on = '0';
    root.append(calc, circ);
    host.sheetBar.insertBefore(root, host.sheetBar.querySelector('.fc-zoom'));
    this.bar = { root, calc, circ };
    host.grid.arrayHook = (raw, area) => this.arrayEntry(raw, area);
    host.grid.setDecor((ctx, box, view) => this.draw(ctx, box, view));
    document.addEventListener('keydown', (e) => this.key(e), true);
    host.formulaBar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void this.arrayEntry(host.formulaBar.value, host.grid.selection()).then((done) => done && host.grid.focus());
      }
    }, true);
    document.addEventListener('fc-hosted', () => {
      window.clearTimeout(this.hostTimer);
      this.hostTimer = window.setTimeout(() => void this.syncExternals(), 500);
    });
  }

  get style(): 'a1' | 'r1c1' {
    return this.settings.style;
  }

  get current(): CalcSettings {
    return this.settings;
  }

  async canonical(cells: [number, number, string][]): Promise<[number, number, string][]> {
    const book = this.host.book();
    if (this.settings.style !== 'r1c1' || book < 0) return cells;
    const out: [number, number, string][] = [];
    for (const [r, c, raw] of cells) {
      const text = raw.trimStart().startsWith('=') ? (await this.host.engine.calc(book, cmd('convert', r, c, 0, raw))).text : raw;
      out.push([r, c, text]);
    }
    return out;
  }

  private circularNames(): string[] {
    return this.stat.names ? this.stat.names.split(', ').filter(Boolean) : [];
  }

  private goto(where: string): void {
    const bang = where.lastIndexOf('!');
    if (bang >= 0) {
      const name = where.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'");
      const at = this.host.sheets().findIndex((s) => s.toLowerCase() === name.toLowerCase());
      if (at >= 0 && at !== this.host.grid.sheetIndex) this.host.goSheet(at);
      this.host.grid.goTo(where.slice(bang + 1));
    } else this.host.grid.goTo(where);
  }

  async load(book: number, doc: CalcDoc): Promise<void> {
    const e = this.host.engine;
    this.arraySig.clear();
    this.spill = null;
    (doc.arrays ?? []).forEach((areas, i) => {
      if (areas.length) this.arraySig.set(i, '');
    });
    for (const [i, areas] of (doc.arrays ?? []).entries()) {
      if (areas.length) await e.calc(book, cmd('loadarrays', i, areas.map((a) => a.join('\t')).join('\n')));
    }
    this.lastExt = (doc.externals ?? []).join('\n');
    if (this.lastExt) await e.calc(book, cmd('extload', this.lastExt));
    if (doc.calc) await e.calc(book, cmd('load', doc.calc));
    this.settings = DEFAULTS;
    this.host.grid.colLabel = colName;
    await this.refresh();
    this.warned = this.stat.names;
    this.errors.clear();
    this.errors.invalidate();
  }

  async refresh(): Promise<void> {
    const book = this.host.book();
    if (book < 0) return;
    const next = parseSettings((await this.host.engine.calc(book, 'get')).text);
    const restyled = next.style !== this.settings.style;
    this.settings = next;
    if (restyled) {
      this.host.grid.colLabel = next.style === 'r1c1' ? (c) => String(c + 1) : colName;
      this.host.grid.reloadData();
    }
    await this.status();
    this.errors.invalidate();
  }

  private async status(): Promise<void> {
    const book = this.host.book();
    if (book < 0) return;
    this.stat = parseStatus((await this.host.engine.calc(book, 'status')).text);
    this.paintStatus();
  }

  private paintStatus(): void {
    const s = this.stat;
    const pending = (s.mode === 'manual' && s.stale > 0) || (s.mode === 'tables' && s.tables && this.tableDirty);
    const on = pending ? '1' : '0';
    if (this.bar.calc.dataset.on !== on) this.bar.calc.dataset.on = on;
    const names = this.circularNames();
    const text = names.length ? `Circular References: ${names[0]}` : '';
    if (this.bar.circ.textContent !== text) this.bar.circ.textContent = text;
    const circ = names.length ? '1' : '0';
    if (this.bar.circ.dataset.on !== circ) this.bar.circ.dataset.on = circ;
    this.bar.circ.title = names.join(', ');
  }

  changed(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.settle(), 120);
    this.errors.invalidate();
  }

  private async settle(): Promise<void> {
    if (this.stat.tables) this.tableDirty = true;
    await this.status();
    if (this.stat.circular && this.stat.names !== this.warned && !this.settings.iterate) {
      this.warned = this.stat.names;
      this.circularBox();
    } else if (!this.stat.circular) this.warned = '';
    await this.refreshSpill();
    window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => void this.syncArrays(), 700);
  }

  active(): void {
    void this.refreshSpill();
    void this.errors.refreshActive();
  }

  private async refreshSpill(): Promise<void> {
    const book = this.host.book();
    if (book < 0) return;
    const g = this.host.grid;
    const [r, c] = g.activeCell();
    const next = parseSpill((await this.host.engine.calc(book, cmd('spillat', g.sheetIndex, r, c))).text);
    if (JSON.stringify(next) === JSON.stringify(this.spill)) return;
    this.spill = next;
    g.paint();
  }

  private draw(ctx: CanvasRenderingContext2D, box: (r0: number, c0: number, r1: number, c1: number) => [number, number, number, number], view: { z: number; ox: number; oy: number }): void {
    const s = this.spill;
    if (s && !s.legacy) {
      const [x, y, w, h] = box(s.r0, s.c0, s.r1, s.c1);
      ctx.strokeStyle = this.spillColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, Math.max(2, w - 2), Math.max(2, h - 2));
    }
    this.errors.draw(ctx, box, view);
  }

  async run(command: string): Promise<void> {
    const book = this.host.book();
    if (book < 0) return;
    const reply = await this.host.engine.calc(book, command);
    await this.host.grid.applyEffect(reply.effect);
    const verb = command.split('\t', 1)[0];
    if (MIRRORED.has(verb)) this.forward(command);
    if (verb === 'set' || verb === 'load') await this.refresh();
    else await this.status();
    if (verb === 'array' || verb === 'fix' || verb === 'ignore') this.errors.invalidate();
    if (verb === 'extchange' || verb === 'extbreak') this.lastExt = '';
  }

  private forward(command: string): void {
    this.chain = this.chain.then(() => this.host.post({ cmd: command })).catch(() => this.host.say('A calculation setting could not be saved', true));
  }

  async calculate(scope: string): Promise<void> {
    this.tableDirty = false;
    await this.run(cmd('calculate', scope));
    if (scope === 'full' || scope === 'rebuild') await this.host.drain(true, true);
    this.paintStatus();
  }

  private key(e: KeyboardEvent): void {
    if (e.key !== 'F9' || this.host.book() < 0 || e.target === this.host.grid.editor) return;
    if (document.querySelector('.fc-modal:not([hidden])')) return;
    e.preventDefault();
    e.stopPropagation();
    const scope = e.ctrlKey && e.altKey ? (e.shiftKey ? 'rebuild' : 'full') : e.shiftKey ? `sheet:${this.host.grid.sheetIndex}` : 'all';
    void this.calculate(scope);
  }

  async arrayEntry(raw: string, area: Range): Promise<boolean> {
    const book = this.host.book();
    if (book < 0) return false;
    let text = raw.trim();
    if (text.startsWith('{') && text.endsWith('}')) text = text.slice(1, -1).trim();
    if (!text.startsWith('=') || text.length < 2) {
      this.host.say('An array formula starts with an equals sign.', true);
      return false;
    }
    try {
      if (this.settings.style === 'r1c1') text = (await this.host.engine.calc(book, cmd('convert', area.r0, area.c0, 0, text))).text;
      await this.run(cmd('array', this.host.grid.sheetIndex, area.r0, area.c0, area.r1, area.c1, text));
    } catch (err) {
      this.host.say(err instanceof Error ? err.message : 'That array formula was refused.', true);
      return false;
    }
    return true;
  }

  private async syncArrays(): Promise<void> {
    const book = this.host.book();
    if (book < 0) return;
    const n = this.host.sheets().length;
    for (let i = 0; i < n; i++) {
      const areas = parseAreas((await this.host.engine.calc(book, cmd('arrays', i))).text);
      const sig = JSON.stringify(areas);
      const was = this.arraySig.get(i);
      if (sig === was || (was === undefined && !areas.length)) continue;
      for (const [r0, c0, r1, c1] of areas) {
        const formula = await this.host.engine.getCell(book, `${colName(c0)}${r0 + 1}`, i);
        if (formula.startsWith('=')) this.forward(cmd('array', i, r0, c0, r1, c1, formula));
      }
      this.forward(cmd('loadarrays', i, areas.map((a) => a.join('\t')).join('\n')));
      this.arraySig.set(i, sig);
    }
  }

  private async syncExternals(): Promise<void> {
    const book = this.host.book();
    if (book < 0) return;
    const text = (await this.host.engine.calc(book, 'extlines')).text;
    if (text === this.lastExt) return;
    this.lastExt = text;
    this.forward(cmd('extload', text));
  }

  private circularBox(): void {
    const m = (this.circularModal ??= makeModal('Circular reference'));
    const enable = el('button', 'fc-btn', 'Enable iterative calculation');
    enable.type = 'button';
    enable.addEventListener('click', () => {
      m.close();
      void this.apply({ iterate: 1 });
    });
    const where = this.circularNames().slice(0, 6).join(', ');
    m.body.replaceChildren(el('p', '', CIRCULAR_TEXT), el('p', 'fc-fmt-hint', where ? `Cells involved: ${where}` : ''), actions('OK', () => m.close(), () => m.close(), [enable], ''));
    m.open();
  }

  async apply(changes: Record<string, string | number>): Promise<void> {
    const book = this.host.book();
    if (book < 0) return;
    let text = (await this.host.engine.calc(book, 'get')).text;
    for (const [k, v] of Object.entries(changes)) text = withSetting(text, k, v);
    await this.run(cmd('set', text));
  }

  private menuItems(): MenuItem[] {
    const s = this.settings;
    const items: MenuItem[] = MODES.map(([mode, label]) => ({ label, keys: s.mode === mode ? 'On' : '', run: () => this.apply({ mode }) }));
    items.push(
      { sep: true },
      { label: 'Calculate Now', keys: 'F9', run: () => this.calculate('all') },
      { label: 'Calculate Sheet', keys: 'Shift+F9', run: () => this.calculate(`sheet:${this.host.grid.sheetIndex}`) },
      { label: 'Full Calculation', keys: 'Ctrl+Alt+F9', run: () => this.calculate('full') },
      { label: 'Rebuild Dependencies and Calculate', keys: 'Ctrl+Alt+Shift+F9', run: () => this.calculate('rebuild') },
      { sep: true },
      { label: 'Iterative calculation', keys: s.iterate ? 'On' : 'Off', run: () => this.apply({ iterate: s.iterate ? 0 : 1 }) },
      { label: 'R1C1 reference style', keys: s.style === 'r1c1' ? 'On' : 'Off', run: () => this.apply({ style: s.style === 'r1c1' ? 'a1' : 'r1c1' }) },
      { label: 'Calculation Options...', run: () => this.optionsBox() },
      { sep: true },
      { label: 'Edit Links...', run: () => this.links.open() },
    );
    return items;
  }

  private optionsBox(): void {
    if (!this.options) {
      const modal = makeModal('Calculation Options');
      this.options = { modal, read: () => undefined };
    }
    const { modal } = this.options;
    const s = this.settings;
    const radios = MODES.map(([mode, label]) => {
      const i = el('input');
      i.type = 'radio';
      i.name = 'fc-calc-mode';
      i.value = mode;
      i.checked = s.mode === mode;
      const l = el('label', 'fc-sort-check');
      l.append(i, label);
      return [i, l] as const;
    });
    const num = (v: number, min: number, max: number, step: string, label: string) => {
      const i = el('input', 'fc-fmt-input');
      i.type = 'number';
      i.min = String(min);
      i.max = String(max);
      i.step = step;
      i.value = String(v);
      const l = el('label', 'fc-fmt-label');
      l.append(label, i);
      return [i, l] as const;
    };
    const box = (on: boolean, label: string) => {
      const i = el('input');
      i.type = 'checkbox';
      i.checked = on;
      const l = el('label', 'fc-sort-check');
      l.append(i, label);
      return [i, l] as const;
    };
    const [iter, iterL] = box(s.iterate, 'Enable iterative calculation');
    const [count, countL] = num(s.iterations, 1, 32767, '1', 'Maximum iterations');
    const [delta, deltaL] = num(s.delta, 0, 1000000, 'any', 'Maximum change');
    const [r1c1, r1c1L] = box(s.style === 'r1c1', 'R1C1 reference style');
    const threads = el('select', 'fc-fmt-input');
    for (const [v, t] of [[0, 'Use all processors'], [1, '1 thread'], [2, '2 threads'], [4, '4 threads'], [8, '8 threads']] as [number, string][]) {
      const o = el('option', '', t);
      o.value = String(v);
      threads.appendChild(o);
    }
    threads.value = String(s.threads);
    const tl = el('label', 'fc-fmt-label');
    tl.append('Calculation threads', threads);
    const hint = el('p', 'fc-fmt-hint', 'The window calculates on one thread. The thread count applies to saving, exports and the engine process.');
    const ok = () => {
      const mode = radios.find(([i]) => i.checked)?.[0].value ?? 'auto';
      void this.apply({
        mode,
        iterate: iter.checked ? 1 : 0,
        iterations: Math.max(1, Math.min(32767, Math.round(Number(count.value) || 100))),
        delta: Math.max(0, Number(delta.value) || 0.001),
        style: r1c1.checked ? 'r1c1' : 'a1',
        threads: Number(threads.value),
      });
      modal.close();
    };
    modal.body.replaceChildren(el('p', 'fc-fmt-hint', 'Calculation'), ...radios.map(([, l]) => l), iterL, countL, deltaL, r1c1L, tl, hint, actions('OK', ok, () => modal.close()));
    modal.open();
  }

  commands(reg: Register): void {
    reg('calc.menu', 'Calculation options', 'Choose automatic or manual calculation, calculate now, turn iterative calculation and the R1C1 reference style on or off, and edit links to other workbooks.', false, () => {
      const b = this.host.anchor('calc.menu');
      this.host.menu.show(b.left, b.bottom + 4, this.menuItems());
    });
    reg('calc.now', 'Calculate Now', 'Calculate every formula that is waiting. Use it in manual calculation mode.', true, () => this.calculate('all'), 'F9');
    reg('calc.sheet', 'Calculate Sheet', 'Calculate the formulas that are waiting on the active sheet.', true, () => this.calculate(`sheet:${this.host.grid.sheetIndex}`), 'Shift+F9');
    reg('calc.full', 'Full Calculation', 'Calculate every formula in the workbook again and fetch linked values again.', true, () => this.calculate('full'), 'Ctrl+Alt+F9');
    reg('calc.rebuild', 'Rebuild Dependencies and Calculate', 'Rebuild the dependency graph and calculate every formula again.', true, () => this.calculate('rebuild'), 'Ctrl+Alt+Shift+F9');
    reg('calc.options', 'Calculation Options', 'Set the calculation mode, iterative calculation with maximum iterations and maximum change, the R1C1 reference style and the thread count.', false, () => this.optionsBox());
    reg('calc.r1c1', 'R1C1 reference style', 'Switch between A1 and R1C1 references. Column headers become numbers and formulas show relative references such as R[1]C[-1].', false, () => this.apply({ style: this.settings.style === 'r1c1' ? 'a1' : 'r1c1' }));
    reg('calc.iterate', 'Iterative calculation', 'Turn iterative calculation on or off. When it is off, a circular reference shows a warning.', false, () => this.apply({ iterate: this.settings.iterate ? 0 : 1 }));
    reg('data.links', 'Edit Links', 'List the workbooks this workbook links to. Update their values, change a source or break a link.', false, () => this.links.open());
    reg('formula.array', 'Enter as array formula', 'Enter the formula over the selected cells as a legacy array formula shown in braces.', true, () => void this.arrayEntry(this.host.formulaBar.value, this.host.grid.selection()), 'Ctrl+Shift+Enter');
    reg('errors.menu', 'Error checking', 'Check the sheet for errors, trace an error to its source, jump to circular references and set the error checking rules.', false, () => {
      const b = this.host.anchor('errors.menu');
      this.host.menu.show(b.left, b.bottom + 4, this.errors.menuItems());
    });
    reg('errors.check', 'Error Checking', 'Walk through the flagged cells on the sheet and fix or ignore each one.', false, () => this.errors.openDialog());
    reg('errors.trace', 'Trace Error', 'Draw arrows from the active cell back to the cells that pass an error to it.', false, () => this.errors.trace());
    reg('errors.options', 'Error Checking Options', 'Switch the error checking rules on or off and reset ignored errors.', false, () => this.errors.optionsBox());
  }
}
