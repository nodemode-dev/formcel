import type { Arrow, EngineClient } from '../engine';
import { FIXES, RULES, cmd, parseArrows, parseFlags, type CalcSettings, type ErrorFlag } from '../engine/calc';
import { MAX_COLS, colName, type Range } from '../grid/a1';
import type { Grid } from '../grid/grid';
import { icon } from './icons';
import type { Menu, MenuItem } from './menu';
import { actions, el, makeModal, type Modal } from './modal';

export interface ErrHost {
  grid: Grid;
  engine: EngineClient;
  menu: Menu;
  mount: HTMLElement;
  book(): number;
  settings(): CalcSettings;
  run(command: string): Promise<void>;
  say(text: string, bad?: boolean): void;
  evaluate(): void;
  arrows(row: number, col: number, list: Arrow[]): void;
  focusBar(): void;
  circular(): string[];
  goto(where: string): void;
}

type Box = [number, number, number, number];
type View = { z: number; ox: number; oy: number };

const RULE_HELP: Record<number, string> = {
  1: 'The formula in this cell returns an error value. Trace the error to find the cell it starts from, or step through the formula to see where it goes wrong.',
  2: 'This cell is in a table column that has a calculated column formula, and the formula here is different. Restore it, or leave it as an exception.',
  4: 'A date typed with two digits for the year can be read as the 1900s or the 2000s. Convert it to four digits to remove the doubt.',
  8: 'The cell holds a number stored as text. Text numbers are left out of sums and sorted as text. Convert it to a number.',
  16: 'The formula follows a different pattern from the formulas next to it. If it is on purpose, choose Ignore Error. Otherwise copy the formula from a neighbour.',
  32: 'The formula refers to a range that has more numbers next to it that the formula leaves out. Update the formula to include them, or ignore the error.',
  64: 'This cell holds a formula but is unlocked, so anyone can change it once the sheet is protected. Lock the cell to keep the formula safe.',
  128: 'The formula refers to cells that are empty, which can give a result you did not expect.',
  256: 'The value in this table cell does not meet the data validation rule of its column.',
};

const KEY = (r: number, c: number) => r * MAX_COLS + c;

export class ErrCheck {
  private flags = new Map<number, ErrorFlag>();
  private tag: HTMLButtonElement;
  private spillWhy: { message: string; blocker: string } | null = null;
  private timer = 0;
  private seen = '';
  private busy = false;
  private again = false;
  private green = '#22a559';
  private dialog: { modal: Modal; cell: HTMLElement; msg: HTMLElement; items: ErrorFlag[]; at: number; buttons: HTMLElement } | null = null;
  private options: Modal | null = null;

  constructor(private readonly host: ErrHost) {
    this.tag = el('button', 'fc-smarttag');
    this.tag.type = 'button';
    this.tag.hidden = true;
    this.tag.innerHTML = icon('errCheck');
    this.tag.setAttribute('aria-haspopup', 'menu');
    this.tag.addEventListener('click', () => this.tagMenu());
    this.tag.addEventListener('pointerdown', (e) => e.stopPropagation());
    host.mount.appendChild(this.tag);
  }

  invalidate(): void {
    this.seen = '';
    this.soon();
  }

  soon(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.scan(), 160);
  }

  clear(): void {
    this.flags = new Map();
    this.seen = '';
    this.hideTag();
    this.host.grid.paint();
  }

  private async scan(): Promise<void> {
    const book = this.host.book();
    if (book < 0) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    const g = this.host.grid;
    const ranges: Range[] = this.host.settings().rules === 0 ? [] : g.loadedRanges();
    const sheet = g.sheetIndex;
    const sig = this.signature();
    if (sig === this.seen) return;
    this.busy = true;
    try {
      const next = new Map<number, ErrorFlag>();
      for (const r of ranges) {
        if ((r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1) > 400000) continue;
        const reply = await this.host.engine.calc(book, cmd('check', sheet, r.r0, r.c0, r.r1, r.c1));
        for (const f of parseFlags(reply.text)) next.set(KEY(f.row, f.col), f);
      }
      if (this.book() !== book || g.sheetIndex !== sheet) return;
      this.seen = sig;
      const same = next.size === this.flags.size && [...next].every(([k, f]) => this.flags.get(k)?.mask === f.mask);
      this.flags = next;
      if (!same) g.paint();
      void this.refreshActive();
    } finally {
      this.busy = false;
      if (this.again) {
        this.again = false;
        this.soon();
      }
    }
  }

  private book(): number {
    return this.host.book();
  }

  private signature(): string {
    const s = this.host.settings();
    const g = this.host.grid;
    const ranges: Range[] = s.rules === 0 ? [] : g.loadedRanges();
    return `${this.host.book()}:${g.sheetIndex}:${s.rules}:${ranges.map((r) => `${r.r0},${r.c0},${r.r1},${r.c1}`).join(';')}`;
  }

  async refreshActive(): Promise<void> {
    const g = this.host.grid;
    const [r, c] = g.activeCell();
    const book = this.host.book();
    this.spillWhy = null;
    if (book >= 0 && /^#SPILL!/.test(g.shownAt(r, c))) {
      const reply = await this.host.engine.calc(book, cmd('spillwhy', g.sheetIndex, r, c));
      const [message, blocker] = reply.text.split('\t');
      if (message) this.spillWhy = { message, blocker: blocker ?? '' };
    }
    g.paint();
  }

  draw(ctx: CanvasRenderingContext2D, box: (r0: number, c0: number, r1: number, c1: number) => Box, view: View): void {
    const s = this.host.settings();
    if (!this.busy && this.host.book() >= 0 && this.signature() !== this.seen) this.soon();
    if (s.rules !== 0 && this.flags.size) {
      ctx.fillStyle = this.green;
      for (const f of this.flags.values()) {
        const [x, y, w, h] = box(f.row, f.col, f.row, f.col);
        if (w <= 0 || h <= 0 || x > 1e5 || y > 1e5) continue;
        ctx.beginPath();
        ctx.moveTo(x + 1, y + 1);
        ctx.lineTo(x + 8, y + 1);
        ctx.lineTo(x + 1, y + 8);
        ctx.closePath();
        ctx.fill();
      }
    }
    this.placeTag(box, view);
  }

  private placeTag(box: (r0: number, c0: number, r1: number, c1: number) => Box, view: View): void {
    const g = this.host.grid;
    const [r, c] = g.activeCell();
    const f = this.flags.get(KEY(r, c)) ?? null;
    if (!f && !this.spillWhy) return this.hideTag();
    const [x, y, , h] = box(r, c, r, c);
    const host = this.host.mount;
    const left = view.ox + x * view.z - 22;
    const top = view.oy + y * view.z + Math.max(0, (h * view.z - 20) / 2);
    if (left < 0 || top < 0 || left > host.clientWidth - 24 || top > host.clientHeight - 24) return this.hideTag();
    if (this.tag.hidden) this.tag.hidden = false;
    this.tag.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    this.tag.title = this.spillWhy ? this.spillWhy.message : f?.message ?? '';
    this.tag.setAttribute('aria-label', this.tag.title);
  }

  private hideTag(): void {
    if (!this.tag.hidden) this.tag.hidden = true;
  }

  private tagMenu(): void {
    const g = this.host.grid;
    const [r, c] = g.activeCell();
    const items: MenuItem[] = [];
    if (this.spillWhy) {
      const why = this.spillWhy;
      items.push({ label: why.message, run: () => undefined, disabled: true });
      if (why.blocker) items.push({ label: 'Select Obstructing Cells', run: () => this.host.goto(why.blocker) });
      items.push({ sep: true }, { label: 'Edit in Formula Bar', run: () => this.host.focusBar() });
    }
    const f = this.flags.get(KEY(r, c));
    if (f) items.push(...this.items(f));
    const b = this.tag.getBoundingClientRect();
    this.host.menu.show(b.left, b.bottom + 2, items);
  }

  private items(f: ErrorFlag): MenuItem[] {
    const sheet = this.host.grid.sheetIndex;
    const out: MenuItem[] = [{ label: f.message, run: () => undefined, disabled: true }];
    for (const bit of RULES.map(([b]) => b)) {
      if (!(f.mask & bit)) continue;
      for (const [action, label] of FIXES[bit] ?? []) out.push({ label, run: () => this.host.run(cmd('fix', sheet, f.row, f.col, bit, action)) });
    }
    out.push({ sep: true }, { label: 'Help on this error', run: () => this.help(f) });
    if (f.mask & 1) out.push({ label: 'Show Calculation Steps...', run: () => this.host.evaluate() }, { label: 'Trace Error', run: () => this.trace(f.row, f.col) });
    out.push({ label: 'Ignore Error', run: () => this.ignore(f) }, { label: 'Edit in Formula Bar', run: () => this.host.focusBar() }, { sep: true }, { label: 'Error Checking Options...', run: () => this.optionsBox() });
    return out;
  }

  private async ignore(f: ErrorFlag): Promise<void> {
    const rule = f.rule;
    await this.host.run(cmd('ignore', this.host.grid.sheetIndex, f.row, f.col, rule));
    this.invalidate();
  }

  async trace(row?: number, col?: number): Promise<void> {
    const book = this.host.book();
    if (book < 0) return;
    const g = this.host.grid;
    const [ar, ac] = g.activeCell();
    const r = row ?? ar;
    const c = col ?? ac;
    const reply = await this.host.engine.calc(book, cmd('traceerr', g.sheetIndex, r, c));
    const arrows = parseArrows(reply.text);
    if (!arrows.length) {
      this.host.say('Trace Error needs the active cell to show an error that comes from another cell.', true);
      return;
    }
    this.host.arrows(r, c, arrows);
  }

  private help(f: ErrorFlag): void {
    const m = this.box('Help on this error');
    m.body.replaceChildren(el('p', '', f.message), el('p', 'fc-fmt-hint', RULE_HELP[f.rule] ?? ''), actions('Close', () => m.close(), () => m.close(), [], ''));
    m.open();
  }

  private boxes = new Map<string, Modal>();

  private box(title: string): Modal {
    let m = this.boxes.get(title);
    if (!m) this.boxes.set(title, (m = makeModal(title)));
    return m;
  }

  async openDialog(): Promise<void> {
    const book = this.host.book();
    if (book < 0) return;
    const g = this.host.grid;
    const ext = await this.host.engine.extent(book, g.sheetIndex);
    const sheet = g.sheetIndex;
    const reply = ext ? await this.host.engine.calc(book, cmd('check', sheet, 0, 0, ext[0], ext[1])) : { text: '' };
    const items = parseFlags(reply.text);
    if (!items.length) {
      this.host.say('No errors were found on this sheet.');
      return;
    }
    items.sort((a, b) => a.row - b.row || a.col - b.col);
    const m = this.box('Error Checking');
    const cell = el('p', 'fc-errchk-cell');
    const msg = el('p', 'fc-fmt-hint');
    const buttons = el('div', 'fc-errchk-buttons');
    const nav = actions('Next', () => this.step(1), () => this.step(-1), [], 'Previous');
    const close = el('button', 'fc-btn', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => m.close());
    const opt = el('button', 'fc-btn', 'Options...');
    opt.type = 'button';
    opt.addEventListener('click', () => this.optionsBox());
    nav.prepend(opt, close);
    m.body.replaceChildren(cell, msg, buttons, nav);
    this.dialog = { modal: m, cell, msg, items, at: 0, buttons };
    this.show(0);
    m.open();
  }

  private step(d: number): void {
    const dlg = this.dialog;
    if (!dlg) return;
    this.show((dlg.at + d + dlg.items.length) % dlg.items.length);
  }

  private show(at: number): void {
    const dlg = this.dialog;
    if (!dlg) return;
    dlg.at = at;
    const f = dlg.items[at];
    const g = this.host.grid;
    dlg.cell.textContent = `Error in cell ${colName(f.col)}${f.row + 1} (${at + 1} of ${dlg.items.length})`;
    dlg.msg.textContent = f.message;
    const btn = (label: string, run: () => void | Promise<void>) => {
      const b = el('button', 'fc-btn', label);
      b.type = 'button';
      b.addEventListener('click', () => void run());
      return b;
    };
    const list: HTMLElement[] = [];
    for (const [bit] of RULES) {
      if (!(f.mask & bit)) continue;
      for (const [action, label] of FIXES[bit] ?? []) list.push(btn(label, async () => {
        await this.host.run(cmd('fix', g.sheetIndex, f.row, f.col, bit, action));
        this.dropAndNext(at);
      }));
    }
    list.push(btn('Help on this error', () => this.help(f)));
    if (f.mask & 1) list.push(btn('Show Calculation Steps...', () => {
      g.goTo(`${colName(f.col)}${f.row + 1}`);
      this.host.evaluate();
    }), btn('Trace Error', () => this.trace(f.row, f.col)));
    list.push(btn('Ignore Error', async () => {
      await this.ignore(f);
      this.dropAndNext(at);
    }), btn('Edit in Formula Bar', () => {
      g.goTo(`${colName(f.col)}${f.row + 1}`);
      dlg.modal.close();
      this.host.focusBar();
    }));
    dlg.buttons.replaceChildren(...list);
    g.goTo(`${colName(f.col)}${f.row + 1}`);
  }

  private dropAndNext(at: number): void {
    const dlg = this.dialog;
    if (!dlg) return;
    dlg.items.splice(at, 1);
    if (!dlg.items.length) {
      dlg.modal.close();
      this.host.say('The error check is complete for the entire sheet.');
      return;
    }
    this.show(at % dlg.items.length);
  }

  optionsBox(): void {
    const s = this.host.settings();
    const m = (this.options ??= makeModal('Error Checking Options'));
    const bg = el('input');
    bg.type = 'checkbox';
    bg.checked = s.rules !== 0;
    const boxes = RULES.map(([bit, label]) => {
      const i = el('input');
      i.type = 'checkbox';
      i.checked = (s.rules & bit) !== 0;
      i.dataset.bit = String(bit);
      const l = el('label', 'fc-sort-check');
      l.append(i, label);
      return [i, l] as const;
    });
    const bgLabel = el('label', 'fc-sort-check');
    bgLabel.append(bg, 'Enable background error checking');
    const reset = el('button', 'fc-btn', 'Reset Ignored Errors');
    reset.type = 'button';
    reset.addEventListener('click', () => void this.host.run(cmd('resetignore')).then(() => this.invalidate()));
    const ok = async () => {
      const mask = boxes.reduce((a, [i]) => a | (i.checked ? Number(i.dataset.bit) : 0), 0);
      await this.host.run(cmd('set', await this.withRules(bg.checked ? mask || 1 : 0)));
      this.invalidate();
      m.close();
    };
    m.body.replaceChildren(bgLabel, el('p', 'fc-fmt-hint', 'Rules'), ...boxes.map(([, l]) => l), actions('OK', () => void ok(), () => m.close(), [reset]));
    m.open();
  }

  private async withRules(mask: number): Promise<string> {
    const reply = await this.host.engine.calc(this.host.book(), 'get');
    const lines = reply.text.split('\n').filter(Boolean).map((l) => (l.startsWith('rules=') ? `rules=${mask}` : l));
    return `${lines.join('\n')}\n`;
  }

  menuItems(): MenuItem[] {
    const circ = this.host.circular();
    const items: MenuItem[] = [
      { label: 'Error Checking...', run: () => this.openDialog() },
      { label: 'Trace Error', run: () => this.trace() },
      { label: 'Reset Ignored Errors', run: () => this.host.run(cmd('resetignore')).then(() => this.invalidate()) },
      { label: 'Error Checking Options...', run: () => this.optionsBox() },
    ];
    if (circ.length) {
      items.push({ sep: true });
      for (const where of circ.slice(0, 12)) items.push({ label: `Circular reference ${where}`, run: () => this.host.goto(where) });
    }
    return items;
  }
}
