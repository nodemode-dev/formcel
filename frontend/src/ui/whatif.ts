import { engine } from '../engine';
import { colName, parseRef, rangeText } from '../grid/a1';
import type { Grid } from '../grid/grid';

export interface WhatIfHost {
  readonly grid: Grid;
  book(): number;
  sheetNames(): string[];
  makeSheet(base: string): Promise<number>;
  persist(lines: string[]): void;
  pivotsChanged(): Promise<void>;
  showSheet(i: number): void;
  newBook(title: string, cells: [number, number, string][]): Promise<void>;
}

const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
const unesc = (s: string): string => s.replace(/\\([\\tnr])/g, (_, c: string) => (c === 't' ? '\t' : c === 'n' ? '\n' : c === 'r' ? '\r' : '\\'));
const cmdText = (parts: (string | number)[]): string => parts.map((p) => esc(String(p))).join('\t');
const rows = (t: string): string[][] => t.split('\n').filter(Boolean).map((l) => l.split('\t').map(unesc));

const input = (k: string, label: string, hint = '') => `<label class="fc-fmt-label">${label}<input class="fc-fmt-input" data-k="${k}" spellcheck="false" autocomplete="off"${hint ? ` placeholder="${hint}"` : ''}></label>`;
const area = (k: string, label: string, hint = '') => `<label class="fc-fmt-label">${label}<textarea class="fc-fmt-input fc-wi-text" data-k="${k}" spellcheck="false" rows="4"${hint ? ` placeholder="${hint}"` : ''}></textarea></label>`;
const pick = (k: string, label: string, opts: [string, string][]) => `<label class="fc-fmt-label">${label}<select class="fc-fmt-input" data-k="${k}">${opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>`;
const check = (k: string, label: string, on = false) => `<label class="fc-sort-check"><input type="checkbox" data-k="${k}"${on ? ' checked' : ''}>${label}</label>`;
const OUT = pick('dest', 'Output options', [['ply', 'New worksheet ply'], ['book', 'New workbook'], ['range', 'Output range']]) + input('plyname', 'New worksheet ply name, optional') + input('outcell', 'Output range, a cell such as Sheet2!B3', 'A1');
const settle = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

class Box {
  readonly el: HTMLFormElement;
  private readonly note: HTMLElement;
  private readonly submit: HTMLButtonElement;

  constructor(title: string, body: string, extra: [string, string][], ok: string, run: (b: Box, who: string) => Promise<void>, private readonly onClose: () => void) {
    this.el = document.createElement('form');
    this.el.className = 'fc-fmt-custom fc-pw fc-wi';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', title);
    this.el.innerHTML = `<span class="fc-fmt-title">${title}</span>${body}<span class="fc-fmt-hint" aria-live="polite"></span><div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="close">Close</button>${extra.map(([a, t]) => `<button type="button" class="fc-btn" data-a="${a}">${t}</button>`).join('')}<button type="submit" class="fc-btn fc-btn-primary">${ok}</button></div>`;
    document.getElementById('overlay-root')!.appendChild(this.el);
    this.note = this.el.querySelector<HTMLElement>('.fc-fmt-hint')!;
    this.submit = this.el.querySelector<HTMLButtonElement>('[type="submit"]')!;
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'close') this.close();
      else void this.guard(() => run(this, b.dataset.a!));
    });
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.guard(() => run(this, 'ok'));
    });
  }

  private async guard(f: () => Promise<void>): Promise<void> {
    this.submit.disabled = true;
    try {
      await f();
    } catch (err) {
      this.say(err instanceof Error ? err.message : 'That did not work.', true);
    } finally {
      this.submit.disabled = false;
    }
  }

  field<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(k: string): T {
    return this.el.querySelector<T>(`[data-k="${k}"]`)!;
  }

  get(k: string): string {
    return this.field(k).value.trim();
  }

  set(k: string, v: string): void {
    const f = this.field(k);
    if (f.value !== v) f.value = v;
  }

  on(k: string): boolean {
    return this.field<HTMLInputElement>(k).checked;
  }

  say(text: string, bad = false): void {
    this.el.dataset.state = bad ? 'error' : '';
    if (this.note.textContent !== text) this.note.textContent = text;
  }

  show(first?: string): void {
    this.el.hidden = false;
    const f = first ? this.field<HTMLInputElement>(first) : null;
    f?.focus();
    if (f && typeof f.select === 'function') f.select();
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.onClose();
  }
}

interface ToolField {
  k: string;
  label: string;
  t?: 'pick' | 'check';
  opts?: [string, string][];
  def?: string;
}

interface ToolSpec {
  label: string;
  tool: string;
  fields: ToolField[];
  slots: string[];
  note: string;
}

const BY: ToolField = { k: 'by', label: 'Grouped by', t: 'pick', opts: [['c', 'Columns'], ['r', 'Rows']] };
const LABELS: ToolField = { k: 'labels', label: 'Labels in the first row or column', t: 'check' };
const ALPHA: ToolField = { k: 'alpha', label: 'Alpha', def: '0.05' };
const RANGE: ToolField = { k: 'range', label: 'Input range' };
const RANGE2: ToolField = { k: 'range2', label: 'Variable 2 range' };
const HYP: ToolField = { k: 'hyp', label: 'Hypothesized mean difference', def: '0' };
const TTEST: ToolField[] = [{ ...RANGE, label: 'Variable 1 range' }, RANGE2, HYP, LABELS, ALPHA];

const TOOLS: Record<string, ToolSpec> = {
  anova1: { label: 'Anova: Single Factor', tool: 'anova1', fields: [RANGE, BY, LABELS, ALPHA], slots: ['by', 'labels', 'alpha'], note: 'Compares the means of two or more groups of numbers.' },
  anova2: { label: 'Anova: Two-Factor Without Replication', tool: 'anova2', fields: [RANGE, LABELS, ALPHA], slots: ['labels', 'alpha'], note: 'One number in each cell; rows and columns are the two factors.' },
  anova2r: { label: 'Anova: Two-Factor With Replication', tool: 'anova2r', fields: [{ ...RANGE, label: 'Input range, with labels in the first row and column' }, { k: 'per', label: 'Rows per sample', def: '2' }, ALPHA], slots: ['per', 'alpha'], note: 'Each sample takes the same number of rows under its row label.' },
  correl: { label: 'Correlation', tool: 'correl', fields: [RANGE, BY, LABELS], slots: ['by', 'labels'], note: 'A matrix of correlation coefficients between the columns or rows.' },
  covar: { label: 'Covariance', tool: 'covar', fields: [RANGE, BY, LABELS], slots: ['by', 'labels'], note: 'A matrix of population covariances between the columns or rows.' },
  expsmooth: { label: 'Exponential Smoothing', tool: 'expsmooth', fields: [RANGE, { k: 'damp', label: 'Damping factor', def: '0.3' }, LABELS, { k: 'stderr', label: 'Standard errors', t: 'check' }, { k: 'chart', label: 'Chart output', t: 'check' }], slots: ['damp', 'labels', 'stderr', 'chart'], note: 'Each forecast is the damped mix of the last value and the last forecast.' },
  fourier: { label: 'Fourier Analysis', tool: 'fourier', fields: [RANGE, LABELS, { k: 'inverse', label: 'Inverse transform', t: 'check' }], slots: ['inverse', 'labels'], note: 'Needs a column of 2, 4, 8 ... 4096 numbers, or complex numbers such as 1+2i for the inverse. Results are written as complex numbers in text form, as COMPLEX writes them.' },
  ftest: { label: 'F-Test Two-Sample for Variances', tool: 'ftest', fields: [{ ...RANGE, label: 'Variable 1 range' }, RANGE2, LABELS, ALPHA], slots: ['range2', 'labels', 'alpha'], note: 'Tests whether two groups have equal variances.' },
  hist: { label: 'Histogram', tool: 'hist', fields: [RANGE, { k: 'bins', label: 'Bin range, blank for automatic bins' }, LABELS, { k: 'pareto', label: 'Pareto (sorted histogram)', t: 'check' }, { k: 'cumul', label: 'Cumulative percentage', t: 'check' }, { k: 'chart', label: 'Chart output', t: 'check' }], slots: ['bins', 'labels', 'pareto', 'cumul', 'chart'], note: 'Counts how many numbers fall in each bin.' },
  movavg: { label: 'Moving Average', tool: 'movavg', fields: [RANGE, { k: 'interval', label: 'Interval', def: '3' }, LABELS, { k: 'stderr', label: 'Standard errors', t: 'check' }, { k: 'chart', label: 'Chart output', t: 'check' }], slots: ['interval', 'labels', 'stderr', 'chart'], note: 'Averages each value with the ones before it.' },
  rand: {
    label: 'Random Number Generation',
    tool: 'rand',
    fields: [
      { k: 'dist', label: 'Distribution', t: 'pick', opts: [['uniform', 'Uniform'], ['normal', 'Normal'], ['bernoulli', 'Bernoulli'], ['binomial', 'Binomial'], ['poisson', 'Poisson'], ['patterned', 'Patterned'], ['discrete', 'Discrete']] },
      { k: 'nvars', label: 'Number of variables', def: '1' },
      { k: 'count', label: 'Numbers per variable', def: '100' },
      { k: 'seed', label: 'Random seed, blank for none' },
      { k: 'p1', label: 'Between (Uniform), Mean (Normal), P (Bernoulli, Binomial), Lambda (Poisson), From (Patterned), Value and probability range (Discrete)' },
      { k: 'p2', label: 'And (Uniform), Standard deviation (Normal), Trials (Binomial), To (Patterned)' },
      { k: 'step', label: 'Step (Patterned)', def: '1' },
      { k: 'each', label: 'Repeat each value (Patterned)', def: '1' },
      { k: 'seq', label: 'Repeat the sequence (Patterned)', def: '1' },
    ],
    slots: ['nvars', 'count', 'seed', 'p1', 'p2', 'step', 'each', 'seq'],
    note: 'Fills a new sheet with random numbers from the distribution you pick.',
  },
  rank: { label: 'Rank and Percentile', tool: 'rank', fields: [RANGE, BY, LABELS], slots: ['by', 'labels'], note: 'Lists each value with its rank and percent rank.' },
  sample: { label: 'Sampling', tool: 'sample', fields: [RANGE, { k: 'mode', label: 'Sampling method', t: 'pick', opts: [['periodic', 'Periodic'], ['random', 'Random']] }, { k: 'size', label: 'Period, or number of samples', def: '5' }, LABELS], slots: ['mode', 'size', 'labels'], note: 'Takes every nth value, or a random draw with replacement.' },
  ttestPaired: { label: 't-Test: Paired Two Sample for Means', tool: 'ttest', fields: TTEST, slots: ['range2', '@paired', 'hyp', 'labels', 'alpha'], note: 'Tests the mean difference between paired observations.' },
  ttestEqual: { label: 't-Test: Two-Sample Assuming Equal Variances', tool: 'ttest', fields: TTEST, slots: ['range2', '@equal', 'hyp', 'labels', 'alpha'], note: 'Pooled-variance test of two means.' },
  ttestUnequal: { label: 't-Test: Two-Sample Assuming Unequal Variances', tool: 'ttest', fields: TTEST, slots: ['range2', '@unequal', 'hyp', 'labels', 'alpha'], note: 'Welch test of two means.' },
  ztest: { label: 'z-Test: Two Sample for Means', tool: 'ztest', fields: [{ ...RANGE, label: 'Variable 1 range' }, RANGE2, HYP, { k: 'var1', label: 'Variable 1 variance (known)' }, { k: 'var2', label: 'Variable 2 variance (known)' }, LABELS, ALPHA], slots: ['range2', 'hyp', 'var1', 'var2', 'labels', 'alpha'], note: 'Tests two means when both variances are known.' },
};

const AGGR: [string, string][] = [['0', 'Average'], ['2', 'Count'], ['3', 'CountA'], ['4', 'Max'], ['5', 'Median'], ['6', 'Min'], ['7', 'Sum']];

export class WhatIf {
  private boxes = new Map<string, Box>();
  private saved = '';
  private tables = false;
  private busy = false;
  private timer = 0;
  private panel: { el: HTMLElement; list: HTMLElement; note: HTMLElement } | null = null;
  private last = '';
  private fresh = 0;
  private fields: string[] | null = null;
  private fieldKey = '';
  private readonly gs = { steps: 0, found: '' };
  private readonly sv: { opts: Record<string, string | boolean>; trial: number; hasRun: boolean; origin: string } = { opts: {}, trial: 0, hasRun: false, origin: '' };

  constructor(private readonly host: WhatIfHost) {}

  private get g(): Grid {
    return this.host.grid;
  }

  private sheet(): string {
    return String(this.g.sheetIndex);
  }

  private run(parts: (string | number)[]): Promise<string> {
    return this.g.whatif(cmdText(parts));
  }

  private box(id: string, make: () => Box): Box {
    let b = this.boxes.get(id);
    if (!b) this.boxes.set(id, (b = make()));
    for (const o of this.boxes.values()) if (o !== b) o.close();
    return b;
  }

  load(lines: string[]): void {
    this.saved = lines.join('\n');
    this.tables = lines.some((l) => l.startsWith('dt\t'));
  }

  async sync(force = false): Promise<void> {
    if (!force && !this.tables && !this.saved) return;
    const t = (await engine().whatif(this.host.book(), 'state')).text;
    if (t !== this.saved) {
      this.saved = t;
      this.tables = t.split('\n').some((l) => l.startsWith('dt\t'));
      this.host.persist(t.split('\n').filter(Boolean));
    }
  }

  async tableText(row: number, col: number): Promise<string> {
    if (!this.tables) return '';
    return (await this.run(['dt.at', this.sheet(), `${colName(col)}${row + 1}`])).trim();
  }

  changed(): void {
    if (!this.tables || this.busy) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.refresh(), 200);
  }

  async refresh(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.run(['dt.run']);
    } finally {
      this.busy = false;
    }
  }

  private async state(): Promise<void> {
    await this.sync(true);
  }

  private result(t: string): string[] {
    return t.split('\t');
  }

  private async toNewSheet(base: string, make: (dst: string) => (string | number)[]): Promise<string> {
    const probe = await this.run(make('-'));
    if (probe.startsWith('error')) return probe;
    const i = await this.host.makeSheet(base);
    this.fresh = i;
    return this.run(make(String(i)));
  }

  private async place(bx: Box, base: string, make: (dst: string, at: string) => (string | number)[], first = 2): Promise<boolean> {
    const dest = bx.get('dest');
    if (dest === 'book') {
      const r = this.result(await this.run(make('=', 'A1')));
      if (r[0] !== 'dump') {
        bx.say(r[1] ?? 'That did not work.', true);
        return false;
      }
      const cells: [number, number, string][] = [];
      for (let i = 3; i + 2 < r.length; i += 3) cells.push([Number(r[i]), Number(r[i + 1]), unesc(r[i + 2])]);
      await this.host.newBook(base, cells);
      bx.say('The results are in a new workbook, opened in another tab. Charts stay in this workbook only.');
      return true;
    }
    let r: string[];
    if (dest === 'range') {
      const m = /^(?:(.+)!)?\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(bx.get('outcell') || 'A1');
      if (!m) {
        bx.say('Give the output range as a cell such as B3 or Sheet2!B3.', true);
        return false;
      }
      const at = m[1] ? this.host.sheetNames().indexOf(m[1].replace(/^'|'$/g, '').replace(/''/g, "'")) : this.g.sheetIndex;
      if (at < 0) {
        bx.say(`There is no sheet named ${m[1]}.`, true);
        return false;
      }
      r = this.result(await this.run(make(String(at), `${m[2].toUpperCase()}${m[3]}`)));
      if (r[0] === 'error') {
        bx.say(r[1], true);
        return false;
      }
      if (at !== this.g.sheetIndex) {
        this.host.showSheet(at);
        await settle();
      }
    } else {
      r = this.result(await this.toNewSheet(bx.get('plyname') || base, (dst) => make(dst, 'A1')));
      if (r[0] === 'error') {
        bx.say(r[1], true);
        return false;
      }
      this.host.showSheet(this.fresh);
      await settle();
    }
    this.charts(r, first);
    return true;
  }

  private charts(r: string[], first: number): void {
    for (const f of r.slice(first)) {
      const p = f.split('|');
      if (p.length < 7 || p[0] === 'pivot') continue;
      document.dispatchEvent(new CustomEvent('fc-ai-chart', { detail: { type: p[0], range: p[1], title: p[2], xTitle: p[3], yTitle: p[4], secondary: p[5] ? p[5].split(',').map(Number) : [], byRows: false, at: p[6] } }));
    }
  }

  goalSeek(): void {
    const gs = this.gs;
    const seek = (bx: Box, cap: string, mode: string): Promise<string> => this.run(['goal', this.sheet(), bx.get('set'), bx.get('to'), bx.get('by'), cap, bx.get('tol'), mode]);
    const report = (bx: Box, r: string[], done: boolean): void => {
      const cell = bx.get('set').toUpperCase();
      const by = bx.get('by').toUpperCase();
      gs.found = r[0];
      if (r[0] === 'ok') return bx.say(`Goal Seeking with cell ${cell} found a solution. Target value: ${bx.get('to')}. Current value: ${r[2]}. Cell ${by} would hold ${r[1]} after ${r[3]} tries. Apply puts it in the sheet.`);
      if (r[0] === 'stop') return bx.say(`${done ? 'Stopped at the limit' : 'Paused'} after ${r[3]} tries. Target value: ${bx.get('to')}. Current value: ${r[2]} with ${by} at ${r[1]}. Step, Continue or Apply.`);
      bx.say(`Goal Seeking with cell ${cell} may not have found a solution. Target value: ${bx.get('to')}. The closest it came was ${r[2]} with ${by} at ${r[1]}. Apply keeps that value; Close leaves the sheet alone.`, true);
    };
    const b = this.box('goal', () => new Box(
      'Goal Seek',
      input('set', 'Set cell') + input('to', 'To value') + input('by', 'By changing cell') + `<div class="fc-wi-row">${input('cap', 'Maximum tries, blank for no limit')}${input('tol', 'Maximum change, blank for default')}</div>`,
      [['step', 'Step'], ['cont', 'Continue'], ['apply', 'Apply']],
      'Seek',
      async (bx, who) => {
        if (who === 'step') {
          gs.steps += 1;
          const r = this.result(await seek(bx, String(gs.steps), 'preview'));
          if (r[0] === 'error') return bx.say(r[1], true);
          return report(bx, r, false);
        }
        if (who === 'apply') {
          if (!gs.found) return bx.say('Seek first, or press Step.', true);
          const r = this.result(await seek(bx, bx.get('cap'), gs.found === 'ok' ? 'commit' : 'force'));
          if (r[0] === 'error') return bx.say(r[1], true);
          await this.state();
          gs.found = '';
          gs.steps = 0;
          return bx.say(`Applied. Cell ${bx.get('by').toUpperCase()} now holds ${r[1]} and cell ${bx.get('set').toUpperCase()} shows ${r[2]}. Undo restores the earlier value.`);
        }
        if (who === 'ok') gs.steps = 0;
        const r = this.result(await seek(bx, bx.get('cap'), 'preview'));
        if (r[0] === 'error') return bx.say(r[1], true);
        report(bx, r, true);
      },
      () => this.g.focus(),
    ));
    const sel = this.g.selection();
    b.set('set', rangeText({ ...sel, r1: sel.r0, c1: sel.c0 }));
    gs.steps = 0;
    gs.found = '';
    b.say('Finds the input that makes a formula give the result you want. Seek shows what it found before anything changes; Step shows one more try each press; Apply puts the result in the sheet.');
    b.show('to');
  }

  dataTable(): void {
    const b = this.box('dt', () => new Box('Data Table', input('range', 'Table range, with its input values and formulas') + input('row', 'Row input cell') + input('col', 'Column input cell'), [['run', 'Recalculate all'], ['remove', 'Remove']], 'OK', async (bx, who) => {
      if (who === 'run') {
        await this.refresh();
        return bx.say('Every data table is recalculated.');
      }
      if (who === 'remove') {
        const list = rows(await this.run(['dt.list']));
        const want = bx.get('range').toUpperCase().replace(/\$/g, '');
        const at = list.findIndex((l) => l[0] === this.sheet() && l[1] === want);
        if (at < 0) return bx.say('There is no data table over that range.', true);
        const r = this.result(await this.run(['dt.remove', at]));
        await this.state();
        return bx.say(r[0] === 'ok' ? 'The data table definition is removed. Its values stay as plain numbers.' : r[1], r[0] !== 'ok');
      }
      const r = this.result(await this.run(['dt.set', this.sheet(), bx.get('range'), bx.get('row'), bx.get('col')]));
      if (r[0] === 'error') return bx.say(r[1], true);
      await this.state();
      bx.say(`Filled ${r[1]} cells. FormCel recalculates this table when the sheet changes.`);
    }, () => this.g.focus()));
    b.set('range', rangeText(this.g.selection()));
    b.say('Column-oriented: input values down the first column, formulas across the top row, use the column input cell. Row-oriented: swap them and use the row input cell. Give both for a two-variable table with its formula in the top-left cell.');
    b.show('row');
  }

  private async scenarioList(bx: Box): Promise<string[][]> {
    const list = rows(await this.run(['sc.list'])).filter((l) => l[2] === this.sheet());
    const sel = bx.field<HTMLSelectElement>('pick');
    const have = [...sel.options].map((o) => o.value).join('\n');
    const want = list.map((l) => l[0]).join('\n');
    if (have !== want) {
      const keep = sel.value;
      sel.replaceChildren(...list.map((l) => {
        const o = document.createElement('option');
        o.value = l[0];
        o.textContent = l[0];
        return o;
      }));
      if (list.some((l) => l[0] === keep)) sel.value = keep;
    }
    return list;
  }

  scenarios(): void {
    const b = this.box('sc', () => new Box('Scenario Manager', pick('pick', 'Scenarios', []), [['add', 'Add or edit'], ['merge', 'Merge'], ['show', 'Show'], ['del', 'Delete']], 'Summary', async (x, who) => {
      const list = await this.scenarioList(x);
      const cur = list.find((l) => l[0] === x.get('pick'));
      if (who === 'add') return this.scenarioForm(cur);
      if (who === 'merge') return this.mergeForm();
      if (who === 'ok') return this.summaryForm();
      if (!cur) return x.say('Add a scenario first.', true);
      const r = this.result(await this.run([who === 'show' ? 'sc.show' : 'sc.delete', cur[0]]));
      if (r[0] === 'error') return x.say(r[1], true);
      await this.state();
      await this.scenarioList(x);
      x.say(who === 'show' ? `Showing ${cur[0]}. Undo restores the earlier values.` : `Deleted ${cur[0]}.`);
    }, () => this.g.focus()));
    void this.scenarioList(b).then((l) => {
      b.say(l.length ? `${l.length} scenario${l.length === 1 ? '' : 's'} on this sheet. Show applies the values of the chosen one.` : 'No scenarios on this sheet yet. Choose Add or edit to make one from changing cells.');
    });
    b.show();
  }

  private scenarioForm(cur?: string[]): void {
    const b = this.box('scform', () => new Box('Scenario', input('name', 'Scenario name') + input('cells', 'Changing cells, up to 32') + area('vals', 'Values, one cell per line as B1=100') + input('note', 'Comment'), [], 'OK', async (bx) => {
      const lines = bx.get('vals').split('\n').map((l) => l.trim()).filter(Boolean);
      const parts: string[] = [];
      for (const l of lines) {
        const m = /^([A-Za-z]{1,3}\d+)\s*=\s*(.*)$/.exec(l);
        if (!m) return bx.say(`Line "${l}" should look like B1=100.`, true);
        parts.push(m[1], m[2]);
      }
      const r = this.result(await this.run(['sc.set', bx.get('name'), bx.get('note'), this.sheet(), ...parts]));
      if (r[0] === 'error') return bx.say(r[1], true);
      await this.state();
      bx.say('Scenario saved. Open Scenario Manager to show it.');
    }, () => this.g.focus()));
    const cells = b.field<HTMLInputElement>('cells');
    if (!cells.dataset.bound) {
      cells.dataset.bound = '1';
      cells.addEventListener('change', async () => {
        const t = rows(await engine().whatif(this.host.book(), cmdText(['inputs', this.sheet(), cells.value])).then((r) => r.text));
        const have = new Map(b.get('vals').split('\n').map((l) => l.split('=') as [string, string]));
        b.set('vals', t.map(([a, raw]) => `${a}=${have.get(a) ?? raw}`).join('\n'));
      });
    }
    if (cur) {
      b.set('name', cur[0]);
      b.set('note', cur[1]);
      const pairs: string[] = [];
      const names: string[] = [];
      for (let i = 3; i + 1 < cur.length; i += 2) {
        names.push(cur[i]);
        pairs.push(`${cur[i]}=${cur[i + 1]}`);
      }
      b.set('cells', names.join(','));
      b.set('vals', pairs.join('\n'));
    } else {
      b.set('name', '');
      b.set('note', '');
      b.set('cells', rangeText(this.g.selection()));
      cells.dispatchEvent(new Event('change'));
    }
    b.say('Edit the values for this scenario. Cells keep what they hold now until you show the scenario.');
    b.show('name');
  }

  private summaryForm(): void {
    const b = this.box('scsum', () => new Box('Scenario Summary', pick('kind', 'Report type', [['summary', 'Scenario summary'], ['pivot', 'Scenario PivotTable report']]) + input('cells', 'Result cells, separated by commas'), [], 'OK', async (bx) => {
      const pivot = bx.get('kind') === 'pivot';
      const r = this.result(await this.toNewSheet(pivot ? 'Scenario PivotTable' : 'Scenario Summary', (dst) => [pivot ? 'sc.pivot' : 'sc.summary', dst, this.sheet(), bx.get('cells')]));
      if (r[0] === 'error') return bx.say(r[1], true);
      if (pivot) await this.host.pivotsChanged();
      bx.close();
    }, () => this.g.focus()));
    b.say('The summary is written to a new sheet with one column for each scenario. The PivotTable report lists the scenarios as rows and the result cells as values.');
    b.show('cells');
  }

  private mergeForm(): void {
    const names = this.host.sheetNames();
    const b = this.box('scmerge', () => new Box('Merge Scenarios', pick('from', 'Merge scenarios from sheet', names.map((n, i) => [String(i), n] as [string, string])), [], 'Merge', async (bx) => {
      const from = bx.get('from');
      if (from === this.sheet()) return bx.say('Choose a different sheet to merge from.', true);
      const r = this.result(await this.run(['sc.merge', from, this.sheet()]));
      if (r[0] === 'error') return bx.say(r[1], true);
      await this.state();
      bx.say(`Merged ${r[1]} scenario${r[1] === '1' ? '' : 's'} into this sheet. Names that clash got a number after them.`);
    }, () => this.g.focus()));
    const sel = b.field<HTMLSelectElement>('from');
    if ([...sel.options].map((o) => o.textContent).join('\n') !== names.join('\n')) {
      sel.replaceChildren(...names.map((n, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = n;
        return o;
      }));
    }
    b.say('Copies the scenarios of another sheet onto this one.');
    b.show('from');
  }

  solver(): void {
    const b = this.box('solver', () => new Box(
      'Solver',
      input('obj', 'Set objective') +
        `<div class="fc-wi-row">${pick('mode', 'To', [['max', 'Max'], ['min', 'Min'], ['value', 'Value of']])}${input('target', 'Value')}</div>` +
        input('vars', 'By changing variable cells') +
        area('cons', 'Subject to the constraints, one per line: B5<=20000, C2:C9 int, D2:D9 bin, A1:A6 dif (all different)', 'B5<=20000') +
        check('nonneg', 'Make unconstrained variables non-negative', true) +
        pick('method', 'Select a solving method', [['auto', 'Simplex LP when the model is linear, otherwise GRG Nonlinear'], ['nl', 'GRG Nonlinear (derivative-free search)'], ['evo', 'Evolutionary']]) +
        input('scen', 'Scenario name, for Save Scenario'),
      [['options', 'Options'], ['continue', 'Continue'], ['keep', 'Keep solver solution'], ['restore', 'Restore original values'], ['scenario', 'Save scenario'], ['report', 'Answer report'], ['sensitivity', 'Sensitivity report'], ['limits', 'Limits report']],
      'Solve',
      async (bx, who) => {
        if (who === 'options') return this.solverOptions();
        if (who === 'restore') {
          if (!this.sv.hasRun) return bx.say('Solve first; there is nothing to restore.', true);
          await this.g.undo();
          this.solverState(bx, false, false);
          return bx.say('The original values are back.');
        }
        if (who === 'keep') {
          if (!this.sv.hasRun) return bx.say('Solve first; there is nothing to keep.', true);
          this.solverState(bx, false, false);
          return bx.say('The solver solution is kept in the sheet. Undo still takes it back.');
        }
        if (who === 'scenario') {
          if (!this.sv.hasRun) return bx.say('Solve first; the scenario holds the solution.', true);
          const name = bx.get('scen');
          if (!name) return bx.say('Type a scenario name first.', true);
          const r = this.result(await this.run(['solve.scen', this.sheet(), name]));
          if (r[0] === 'error') return bx.say(r[1], true);
          await this.state();
          return bx.say(`Scenario ${name} holds the solution. Open Scenario Manager to show it.`);
        }
        if (who === 'continue') {
          if (!this.sv.trial) return bx.say('Solve with Show Iteration Results on to step through trial solutions.', true);
          await this.g.undo();
          return this.solveNow(bx, this.sv.trial + 1);
        }
        if (who === 'report' || who === 'sensitivity' || who === 'limits') {
          const name = who === 'report' ? 'Answer Report' : who === 'sensitivity' ? 'Sensitivity Report' : 'Limits Report';
          const r = this.result(await this.toNewSheet(name, (dst) => (who === 'report' ? ['solve.report', dst] : ['solve.report', dst, who])));
          return bx.say(r[0] === 'ok' ? `The ${name.toLowerCase()} is on a new sheet.` : r[1], r[0] !== 'ok');
        }
        await this.solveNow(bx, this.sv.opts.sho === true ? 1 : 0);
      },
      () => this.g.focus(),
    ));
    b.el.classList.add('fc-wi-wide');
    this.solverState(b, false, this.sv.hasRun);
    void this.run(['model.get', this.sheet()]).then((t) => {
      if (b.get('obj') || !t) return;
      try {
        const [obj, mode, target, vars, cons, nonneg, method, opts] = JSON.parse(t) as [string, string, string, string, string, boolean, string, Record<string, string | boolean>?];
        b.set('obj', obj);
        b.set('mode', mode);
        b.set('target', target);
        b.set('vars', vars);
        b.set('cons', cons);
        b.field<HTMLInputElement>('nonneg').checked = nonneg;
        b.set('method', method);
        this.sv.opts = opts ?? {};
      } catch {
        return;
      }
    });
    const sel = this.g.selection();
    if (!b.get('obj')) b.set('obj', rangeText({ ...sel, r1: sel.r0, c1: sel.c0 }));
    b.say('Finds the best value for the objective cell by changing the variable cells within your limits. Choose a solving method, add constraints, and open Options for precision, time, iterations, scaling, multistart and the evolutionary settings.');
    b.show('obj');
  }

  private solverState(bx: Box, stepping: boolean, ran: boolean): void {
    this.sv.hasRun = ran;
    if (!stepping) this.sv.trial = 0;
    const cont = bx.el.querySelector<HTMLElement>('[data-a="continue"]');
    if (cont) cont.hidden = !stepping;
  }

  private async solveNow(bx: Box, trial: number): Promise<void> {
    const cons: string[] = [];
    for (const line of bx.get('cons').split('\n').map((l) => l.trim()).filter(Boolean)) {
      const m = /^(.+?)\s*(<=|>=|=|\s+int|\s+bin|\s+dif)\s*(.*)$/i.exec(line);
      if (!m) return bx.say(`Constraint "${line}" needs <=, >=, =, int, bin or dif.`, true);
      cons.push(`${m[1].trim()}|${m[2].trim().toLowerCase()}|${m[3].trim()}`);
    }
    const o = this.sv.opts;
    const pairs = [`eng=${bx.get('method')}`];
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'boolean') pairs.push(`${k}=${v ? 1 : 0}`);
      else if (String(v).trim()) pairs.push(`${k}=${String(v).trim()}`);
    }
    if (trial) pairs.push(`trial=${trial}`);
    const model = JSON.stringify([bx.get('obj'), bx.get('mode'), bx.get('target'), bx.get('vars'), bx.get('cons'), bx.on('nonneg'), bx.get('method'), o]);
    await this.run(['model.set', this.sheet(), model]);
    await this.state();
    const r = this.result(await this.run(['solve', this.sheet(), bx.get('obj'), bx.get('mode'), bx.get('target'), bx.get('vars'), bx.on('nonneg') ? '1' : '0', bx.get('method'), `@opts|${pairs.join('|')}`, ...cons]));
    if (r[0] === 'error') return bx.say(r[1], true);
    if (r[0] === 'fail') {
      this.solverState(bx, false, false);
      return bx.say(`${r[1]} The cells were left as they were.`, true);
    }
    const iters = Number(r[4] ?? '0');
    const stepping = trial > 0 && iters >= trial && trial < (bx.get('method') === 'evo' ? 2000 : Number(o.itr) || 100);
    this.solverState(bx, stepping, true);
    if (stepping) {
      this.sv.trial = trial;
      return bx.say(`Trial solution after iteration ${trial}: objective ${r[2]}, ${r[3]}. Continue runs the next iteration. Keep solver solution, Restore original values or Save scenario ends the run.`);
    }
    bx.say(`${r[1]} Objective value: ${r[2]}. Method: ${r[3]}.${iters ? ` Iterations: ${iters}.` : ''} Choose Keep solver solution or Restore original values; Save scenario stores the solution.${r[5] ? ` Progress: ${r[5]}` : ''}`);
  }

  private solverOptions(): void {
    const b = this.box('solveropts', () => new Box(
      'Solver Options',
      '<span class="fc-wi-sec">All methods</span>' +
        `<div class="fc-wi-row3">${input('pre', 'Constraint precision', '0.000001')}${input('tim', 'Max time (seconds)', '100')}${input('itr', 'Iterations', '100')}</div>` +
        `<div class="fc-wi-row">${input('tol', 'Integer optimality (%)', '1')}${input('sub', 'Max subproblems', '4000')}</div>` +
        check('scl', 'Use automatic scaling', true) + check('sho', 'Show iteration results', false) +
        '<span class="fc-wi-sec">GRG Nonlinear and Evolutionary</span>' +
        `<div class="fc-wi-row3">${input('cvg', 'Convergence', '0.0001')}${input('pop', 'Population size', '100')}${input('seed', 'Random seed', '0')}</div>` +
        check('ms', 'Use multistart (GRG Nonlinear)', false) + check('rb', 'Require bounds on variables', true) +
        '<span class="fc-wi-sec">Evolutionary</span>' +
        `<div class="fc-wi-row">${input('mut', 'Mutation rate', '0.075')}${input('nimp', 'Max time without improvement (seconds)', '30')}</div>`,
      [['reset', 'Reset all']],
      'OK',
      async (bx, who) => {
        const numeric = ['pre', 'tim', 'itr', 'tol', 'sub', 'cvg', 'pop', 'mut', 'seed', 'nimp'];
        if (who === 'reset') {
          for (const k of numeric) bx.set(k, '');
          for (const k of ['scl', 'rb']) bx.field<HTMLInputElement>(k).checked = true;
          for (const k of ['sho', 'ms']) bx.field<HTMLInputElement>(k).checked = false;
          return bx.say('Every option is back to its default.');
        }
        const next: Record<string, string | boolean> = {};
        for (const k of numeric) if (bx.get(k)) next[k] = bx.get(k);
        for (const k of ['scl', 'sho', 'ms', 'rb']) next[k] = bx.on(k);
        this.sv.opts = next;
        bx.close();
        this.solver();
      },
      () => this.solver(),
    ));
    b.el.classList.add('fc-wi-wide');
    const o = this.sv.opts;
    for (const k of ['pre', 'tim', 'itr', 'tol', 'sub', 'cvg', 'pop', 'mut', 'seed', 'nimp']) b.set(k, String(o[k] ?? ''));
    for (const k of ['scl', 'sho', 'ms', 'rb']) b.field<HTMLInputElement>(k).checked = typeof o[k] === 'boolean' ? (o[k] as boolean) : k === 'scl' || k === 'rb';
    b.say('Blank boxes use the default shown in grey. Convergence, population size and random seed apply to multistart and to the Evolutionary engine.');
    b.show('pre');
  }

  forecast(): void {
    const b = this.box('fc', () => new Box(
      'Forecast Sheet',
      input('tl', 'Timeline range') + input('vals', 'Values range') + input('end', 'Forecast end', '2026-12-31') + input('start', 'Forecast start, optional') +
        `<div class="fc-wi-row">${input('conf', 'Confidence interval %')}${input('seas', 'Seasonality (1 detect, 0 none)')}</div>` +
        `<div class="fc-wi-row">${pick('comp', 'Fill missing points', [['1', 'Interpolate'], ['0', 'Zeros']])}${pick('aggr', 'Aggregate duplicates', AGGR)}</div>` +
        check('stats', 'Include forecast statistics', false) + pick('chart', 'Chart', [['line', 'Line chart'], ['column', 'Column chart'], ['none', 'No chart']]),
      [],
      'Create',
      async (bx) => {
        const r = this.result(await this.toNewSheet('Forecast', (dst) => ['fsheet', this.sheet(), bx.get('tl'), bx.get('vals'), dst, bx.get('end'), bx.get('conf') || '0', bx.get('seas') || '1', bx.get('comp'), bx.get('aggr'), bx.get('start'), bx.on('stats') ? '1' : '0', bx.get('chart')]));
        if (r[0] === 'error') return bx.say(r[1], true);
        this.host.showSheet(this.fresh);
        await settle();
        this.charts(r, 4);
        bx.close();
      },
      () => this.g.focus(),
    ));
    const s = this.g.selection();
    if (s.c1 > s.c0) {
      b.set('tl', rangeText({ r0: s.r0, c0: s.c0, r1: s.r1, c1: s.c0 }));
      b.set('vals', rangeText({ r0: s.r0, c0: s.c0 + 1, r1: s.r1, c1: s.c0 + 1 }));
    }
    if (!b.get('conf')) b.set('conf', '95');
    if (!b.get('seas')) b.set('seas', '1');
    b.say('Writes a table of the history and the forecast, with confidence bounds, to a new sheet. The forecast cells are FORECAST.ETS formulas.');
    b.show('end');
  }

  describe(): void {
    const b = this.box('desc', () => new Box(
      'Descriptive Statistics',
      input('range', 'Input range') + pick('by', 'Grouped by', [['c', 'Columns'], ['r', 'Rows']]) + check('labels', 'Labels in the first row or column', false) + check('summary', 'Summary statistics', true) +
        `<div class="fc-wi-row">${input('kl', 'Kth largest')}${input('ks', 'Kth smallest')}</div>` + input('conf', 'Confidence level for the mean %') + OUT,
      [],
      'OK',
      async (bx) => {
        if (await this.place(bx, 'Descriptive Statistics', (dst, at) => ['desc', this.sheet(), bx.get('range'), dst, at, bx.get('by'), bx.on('labels') ? '1' : '0', bx.on('summary') ? '1' : '0', bx.get('kl') || '0', bx.get('ks') || '0', bx.get('conf') || '0'])) bx.close();
      },
      () => this.g.focus(),
    ));
    b.set('range', rangeText(this.g.selection()));
    b.say('Writes the statistics, as values, to a new sheet.');
    b.show('range');
  }

  regression(): void {
    const b = this.box('reg', () => new Box(
      'Regression',
      input('y', 'Input Y range') + input('x', 'Input X range, one or more columns') + check('labels', 'Labels in the first row', true) + check('zero', 'Constant is zero', false) + input('conf', 'Confidence level %') + check('resid', 'Residuals', false) + check('stdres', 'Standardized residuals', false) + check('resplot', 'Residual plots', false) + check('fitplot', 'Line fit plots', false) + check('probplot', 'Normal probability plots', false) + OUT,
      [],
      'OK',
      async (bx) => {
        const flag = (k: string): string => (bx.on(k) ? '1' : '0');
        if (await this.place(bx, 'Regression', (dst, at) => ['regress', this.sheet(), bx.get('y'), bx.get('x'), dst, at, flag('labels'), bx.on('zero') ? '0' : '1', bx.get('conf') || '95', flag('resid'), flag('stdres'), flag('resplot'), flag('fitplot'), flag('probplot')])) bx.close();
      },
      () => this.g.focus(),
    ));
    const s = this.g.selection();
    if (!b.get('y') && s.c1 > s.c0) {
      b.set('y', rangeText({ r0: s.r0, c0: s.c1, r1: s.r1, c1: s.c1 }));
      b.set('x', rangeText({ r0: s.r0, c0: s.c0, r1: s.r1, c1: s.c1 - 1 }));
    }
    if (!b.get('conf')) b.set('conf', '95');
    b.say('Fits a least-squares line. Writes the regression statistics, ANOVA table and coefficients to a new sheet.');
    b.show('y');
  }

  dataAnalysis(): void {
    const b = this.box('tppick', () => new Box('Data Analysis', pick('tool', 'Analysis tool', Object.entries(TOOLS).map(([id, t]) => [id, t.label] as [string, string])), [], 'OK', async (bx) => {
      const id = bx.get('tool');
      bx.close();
      this.toolForm(id);
    }, () => this.g.focus()));
    b.say('Statistical tools that write their tables to a new sheet.');
    b.show('tool');
  }

  private toolForm(id: string): void {
    const spec = TOOLS[id];
    if (!spec) return;
    const body = spec.fields.map((f) => (f.t === 'pick' ? pick(f.k, f.label, f.opts ?? []) : f.t === 'check' ? check(f.k, f.label, false) : input(f.k, f.label))).join('') + OUT;
    const b = this.box(`tp:${id}`, () => new Box(spec.label, body, [], 'OK', async (bx) => {
      const val = (k: string): string => {
        if (k.startsWith('@')) return k.slice(1);
        const f = spec.fields.find((x) => x.k === k);
        return f?.t === 'check' ? (bx.on(k) ? '1' : '0') : bx.get(k);
      };
      const first = spec.tool === 'rand' ? 'dist' : 'range';
      if (await this.place(bx, spec.label, (dst, at) => ['tp', spec.tool, this.sheet(), val(first), dst, at, ...spec.slots.map(val)])) bx.close();
    }, () => this.g.focus()));
    for (const f of spec.fields) if (f.def && !b.get(f.k)) b.set(f.k, f.def);
    if (spec.fields.some((f) => f.k === 'range') && !b.get('range')) b.set('range', rangeText(this.g.selection()));
    b.say(spec.note);
    b.show(spec.fields[0].k);
  }

  analyze(): void {
    if (!this.panel) {
      const el = document.createElement('aside');
      el.className = 'fc-explore';
      el.hidden = true;
      el.setAttribute('aria-label', 'Analyze Data');
      el.innerHTML = '<div class="fc-explore-head"><span class="fc-fmt-title">Analyze Data</span><span class="fc-explore-actions"><button type="button" class="fc-btn" data-a="refresh">Refresh</button><button type="button" class="fc-btn" data-a="close">Close</button></span></div><form class="fc-explore-ask"><input class="fc-fmt-input" data-k="ask" spellcheck="false" autocomplete="off" aria-label="Ask a question about your data" placeholder="Ask, for example: total sales by region"><button type="submit" class="fc-btn fc-btn-primary">Ask</button></form><details class="fc-explore-fields"><summary>Fields</summary><div class="fc-explore-fieldlist" role="group" aria-label="Fields to analyze"></div></details><p class="fc-explore-note" aria-live="polite"></p><ul class="fc-explore-list"></ul>';
      el.querySelector<HTMLElement>('.fc-explore-fieldlist')!.addEventListener('change', () => {
        const on = [...el.querySelectorAll<HTMLInputElement>('.fc-explore-fieldlist input')];
        this.fields = on.every((i) => i.checked) ? null : on.filter((i) => i.checked).map((i) => i.value);
        this.last = '';
        const q = el.querySelector<HTMLInputElement>('[data-k="ask"]')!.value;
        void (q.trim() ? this.ask(q) : this.explore());
      });
      el.querySelector<HTMLFormElement>('.fc-explore-ask')!.addEventListener('submit', (e) => {
        e.preventDefault();
        void this.ask(el.querySelector<HTMLInputElement>('[data-k="ask"]')!.value);
      });
      document.getElementById('overlay-root')!.appendChild(el);
      this.panel = { el, list: el.querySelector<HTMLElement>('.fc-explore-list')!, note: el.querySelector<HTMLElement>('.fc-explore-note')! };
      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
        if (a === 'close') {
          el.hidden = true;
          this.g.focus();
        } else if (a === 'refresh') void this.explore();
        else if (a === 'chart' || a === 'pivot' || a === 'pchart') {
          const li = t.closest<HTMLElement>('[data-visual]');
          if (li) void this.insertVisual(li.dataset.visual!, a);
        } else {
          const li = t.closest<HTMLElement>('[data-range]');
          const r = li ? parseRef(li.dataset.range!) : null;
          if (r) this.g.select(r.r0, r.c0, r.r1, r.c1);
        }
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          el.hidden = true;
          this.g.focus();
        }
      });
    }
    this.panel.el.hidden = false;
    void this.explore();
  }

  private async explore(): Promise<void> {
    const p = this.panel;
    if (!p) return;
    const r = rangeText(this.g.selection());
    void this.fieldList(r);
    const t = (await engine().whatif(this.host.book(), cmdText(['explore', this.sheet(), r, this.fields ? this.fields.join('\u001f') : '']))).text;
    if (t === this.last) return;
    this.last = t;
    this.paint(t, 'Click an insight to select the cells it describes.', 'No insights for this selection.');
  }

  private async fieldList(range: string): Promise<void> {
    const p = this.panel;
    if (!p) return;
    const t = (await engine().whatif(this.host.book(), cmdText(['ask.fields', this.sheet(), range]))).text;
    if (t.startsWith('error\t')) return;
    const list = rows(t);
    const key = `${this.sheet()}\n${list.map((l) => l[0]).join('\n')}`;
    if (key === this.fieldKey) return;
    this.fieldKey = key;
    this.fields = null;
    const box = p.el.querySelector<HTMLElement>('.fc-explore-fieldlist')!;
    box.replaceChildren(...list.map(([name, kind]) => {
      const l = document.createElement('label');
      l.className = 'fc-sort-check';
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.checked = true;
      i.value = name;
      l.append(i, document.createTextNode(`${name} (${kind})`));
      return l;
    }));
  }

  private async insertVisual(visual: string, how: string): Promise<void> {
    const p = this.panel;
    if (!p) return;
    const v = visual.split('|');
    if (v[0] === 'chart' && how === 'chart') {
      document.dispatchEvent(new CustomEvent('fc-ai-chart', { detail: { type: v[1], range: v[2], title: v[3], xTitle: '', yTitle: '', secondary: [], byRows: false } }));
      p.note.textContent = 'The chart is on the sheet. Drag it where you want it.';
      return;
    }
    if (v[0] !== 'pivot') return;
    const r = this.result(await this.toNewSheet('Analyze Data', (dst) => ['ask.pivot', dst, this.sheet(), v[1], v[2], v[3], v[4]]));
    if (r[0] === 'error') {
      p.note.textContent = r[1];
      return;
    }
    await this.host.pivotsChanged();
    this.host.showSheet(this.fresh);
    await settle();
    if (how === 'pchart') {
      document.dispatchEvent(new CustomEvent('fc-ai-chart', { detail: { type: 'column', range: '', title: `${v[3] || 'Count'} by ${v[2]}`, xTitle: '', yTitle: '', secondary: [], byRows: false, pivot: r[1], at: 'E2' } }));
    }
    p.note.textContent = how === 'pchart' ? `The PivotTable and its PivotChart are on the new sheet (${r[1]}).` : `The PivotTable is on the new sheet (${r[1]}).`;
  }

  private async ask(question: string): Promise<void> {
    const p = this.panel;
    if (!p) return;
    if (!question.trim()) return this.explore();
    const t = (await engine().whatif(this.host.book(), cmdText(['ask', this.sheet(), rangeText(this.g.selection()), question, this.fields ? this.fields.join('\u001f') : '']))).text;
    this.last = '';
    this.paint(t, 'Click an answer to select the cells it comes from.', 'FormCel found nothing to answer that with.');
  }

  private paint(t: string, hint: string, none: string): void {
    const p = this.panel;
    if (!p) return;
    if (t.startsWith('error\t')) {
      p.note.textContent = unesc(t.slice(6));
      p.list.replaceChildren();
      return;
    }
    const list = rows(t);
    p.note.textContent = list.length ? hint : none;
    const have = [...p.list.children] as HTMLElement[];
    list.forEach(([kind, title, detail, range, visual], i) => {
      let li = have[i];
      if (!li) {
        li = document.createElement('li');
        li.className = 'fc-explore-item';
        li.innerHTML = '<button type="button" class="fc-explore-card" data-a="select"><span class="fc-explore-title"></span><span class="fc-explore-detail"></span></button><span class="fc-explore-do" hidden><button type="button" class="fc-btn" data-a="chart" hidden>Insert chart</button><button type="button" class="fc-btn" data-a="pivot" hidden>Insert PivotTable</button><button type="button" class="fc-btn" data-a="pchart" hidden>Insert PivotChart</button></span>';
        p.list.appendChild(li);
      }
      li.dataset.kind = kind;
      li.dataset.range = range;
      const kindOf = (visual ?? '').split('|')[0];
      if ((li.dataset.visual ?? '') !== (visual ?? '')) li.dataset.visual = visual ?? '';
      const row = li.querySelector<HTMLElement>('.fc-explore-do')!;
      row.hidden = !kindOf;
      li.querySelector<HTMLElement>('[data-a="chart"]')!.hidden = kindOf !== 'chart';
      li.querySelector<HTMLElement>('[data-a="pivot"]')!.hidden = kindOf !== 'pivot';
      li.querySelector<HTMLElement>('[data-a="pchart"]')!.hidden = kindOf !== 'pivot';
      const [a, b] = [li.querySelector('.fc-explore-title')!, li.querySelector('.fc-explore-detail')!];
      if (a.textContent !== title) a.textContent = title;
      if (b.textContent !== detail) b.textContent = detail;
    });
    for (const li of have.slice(list.length)) li.remove();
  }
}
