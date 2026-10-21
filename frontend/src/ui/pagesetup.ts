import { actions, el, field, makeModal, type Modal } from './modal';

export type Scale = 'none' | 'fit-cols' | 'fit-sheet' | 'custom';

export interface PageSetup {
  orient: 'portrait' | 'landscape';
  paper: string;
  margins: 'normal' | 'wide' | 'narrow' | 'custom';
  m: number[];
  area: string;
  titleRows: string;
  titleCols: string;
  scale: Scale;
  pct: number;
  grid: boolean;
  heads: boolean;
  hf: Record<'hl' | 'hc' | 'hr' | 'fl' | 'fc' | 'fr', string>;
  rowBreaks: number[];
  colBreaks: number[];
}

export const PAPERS: Record<string, [number, number]> = { Letter: [612, 792], Legal: [612, 1008], A4: [595.28, 841.89], A3: [841.89, 1190.55], Tabloid: [792, 1224] };
export const MARGIN_PRESETS: Record<string, number[]> = { normal: [0.75, 0.7, 0.75, 0.7, 0.3, 0.3], wide: [1, 1, 1, 1, 0.5, 0.5], narrow: [0.75, 0.25, 0.75, 0.25, 0.3, 0.3] };
export const HF_KEYS = ['hl', 'hc', 'hr', 'fl', 'fc', 'fr'] as const;

export function defaultPage(): PageSetup {
  return { orient: 'portrait', paper: 'Letter', margins: 'normal', m: [...MARGIN_PRESETS.normal], area: '', titleRows: '', titleCols: '', scale: 'none', pct: 100, grid: false, heads: false, hf: { hl: '', hc: '', hr: '', fl: '', fc: '', fr: '' }, rowBreaks: [], colBreaks: [] };
}

export function cleanPage(raw: unknown): PageSetup {
  const d = defaultPage();
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<PageSetup>;
  if (p.orient === 'landscape') d.orient = 'landscape';
  if (p.paper && PAPERS[p.paper]) d.paper = p.paper;
  if (p.margins === 'wide' || p.margins === 'narrow' || p.margins === 'custom') d.margins = p.margins;
  d.m = d.margins === 'custom' && Array.isArray(p.m) && p.m.length === 6 ? p.m.map((x) => Math.max(0, Math.min(5, Number(x) || 0))) : [...MARGIN_PRESETS[d.margins] ?? MARGIN_PRESETS.normal];
  d.area = String(p.area ?? '');
  d.titleRows = String(p.titleRows ?? '');
  d.titleCols = String(p.titleCols ?? '');
  if (p.scale === 'fit-cols' || p.scale === 'fit-sheet' || p.scale === 'custom') d.scale = p.scale;
  d.pct = Math.max(10, Math.min(400, Math.round(Number(p.pct) || 100)));
  d.grid = !!p.grid;
  d.heads = !!p.heads;
  for (const k of HF_KEYS) d.hf[k] = String(p.hf?.[k] ?? '');
  d.rowBreaks = [...new Set((p.rowBreaks ?? []).map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
  d.colBreaks = [...new Set((p.colBreaks ?? []).map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
  return d;
}

export interface Sizes {
  row(i: number): number;
  col(i: number): number;
}

export interface Layout {
  rowBreaks: number[];
  colBreaks: number[];
  manualRows: Set<number>;
  manualCols: Set<number>;
  pages: { r0: number; r1: number; c0: number; c1: number; n: number }[];
  area: [number, number, number, number];
}

const cellOf = (t: string): [number, number] | null => {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(t.trim());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, c - 1];
};

export function areaOf(text: string): [number, number, number, number] | null {
  const [a, b] = text.trim().split('!').pop()!.split(':');
  if (!a) return null;
  const p = cellOf(a);
  const q = cellOf(b ?? a);
  return p && q ? [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])] : null;
}

function split(sizes: number[], room: number, breaks: Set<number>, first: number, last: number): number[] {
  const out = [first];
  let used = 0;
  for (let i = first; i <= last; i++) {
    const s = sizes[i - first];
    if (i > out[out.length - 1] && (breaks.has(i) || used + s > room)) {
      out.push(i);
      used = 0;
    }
    used += s;
  }
  return out;
}

export function layoutOf(p: PageSetup, sz: Sizes, extent: [number, number]): Layout {
  const [pw0, ph0] = PAPERS[p.paper] ?? PAPERS.Letter;
  const [pw, ph] = p.orient === 'landscape' ? [ph0, pw0] : [pw0, ph0];
  const [mt, mr, mb, ml] = p.m.map((x) => x * 72);
  const area = areaOf(p.area) ?? [0, 0, Math.max(0, extent[0] - 1), Math.max(0, extent[1] - 1)];
  const [r0, c0, r1, c1] = area;
  const cw: number[] = [];
  const rh: number[] = [];
  for (let c = c0; c <= c1; c++) cw.push(sz.col(c) * 0.75);
  for (let r = r0; r <= r1; r++) rh.push(sz.row(r) * 0.75);
  const sumW = cw.reduce((a, b) => a + b, 0);
  const sumH = rh.reduce((a, b) => a + b, 0);
  const hw = p.heads ? 24 : 0;
  const hh = p.heads ? 14 : 0;
  const roomW = pw - ml - mr - hw;
  const roomH = ph - mt - mb - hh;
  let scale = sumW ? Math.min(1, Math.max(0.5, roomW / sumW)) : 1;
  if (p.scale === 'custom') scale = p.pct / 100;
  else if (p.scale === 'fit-cols') scale = sumW ? Math.min(1, roomW / sumW) : 1;
  else if (p.scale === 'fit-sheet') scale = Math.min(1, sumW ? roomW / sumW : 1, sumH ? roomH / sumH : 1);
  const cs = cw.map((x) => x * scale);
  const rs = rh.map((x) => x * scale);
  const mrows = new Set(p.rowBreaks);
  const mcols = new Set(p.colBreaks);
  const colStarts = split(cs, roomW, mcols, c0, c1);
  const rowStarts = split(rs, roomH, mrows, r0, r1);
  const pages: Layout['pages'] = [];
  let n = 0;
  for (let ci = 0; ci < colStarts.length; ci++) {
    for (let ri = 0; ri < rowStarts.length; ri++) {
      pages.push({ r0: rowStarts[ri], r1: (rowStarts[ri + 1] ?? r1 + 1) - 1, c0: colStarts[ci], c1: (colStarts[ci + 1] ?? c1 + 1) - 1, n: ++n });
    }
  }
  return { rowBreaks: rowStarts.slice(1), colBreaks: colStarts.slice(1), manualRows: mrows, manualCols: mcols, pages, area };
}

export class PageSetupDialog {
  private readonly modal: Modal;
  private readonly f = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private done: ((p: PageSetup) => void) | null = null;
  private breaks: [number[], number[]] = [[], []];

  constructor() {
    const m = (this.modal = makeModal('Page Setup', { wide: true }));
    const sel = (k: string, opts: [string, string][]) => {
      const s = el('select', 'fc-fmt-input');
      for (const [v, t] of opts) s.add(new Option(t, v));
      this.f.set(k, s);
      return s;
    };
    const inp = (k: string, type = 'text') => {
      const i = el('input', 'fc-fmt-input');
      i.type = type;
      i.spellcheck = false;
      i.autocomplete = 'off';
      this.f.set(k, i);
      return i;
    };
    const check = (k: string, text: string) => {
      const l = el('label', 'fc-sort-check');
      const i = el('input');
      i.type = 'checkbox';
      this.f.set(k, i);
      l.append(i, text);
      return l;
    };
    const group = (legend: string, ...kids: HTMLElement[]) => {
      const g = el('fieldset', 'fc-page-group');
      g.appendChild(el('legend', '', legend));
      g.append(...kids);
      return g;
    };
    const row = (...kids: HTMLElement[]) => {
      const r = el('div', 'fc-page-row');
      r.append(...kids);
      return r;
    };
    const num = (k: string) => Object.assign(inp(k, 'number'), { min: '0', max: '5', step: '0.05' });
    const pct = Object.assign(inp('pct', 'number'), { min: '10', max: '400', step: '1' });
    const body = m.body;
    body.append(
      group('Page', row(
        field('Orientation', sel('orient', [['portrait', 'Portrait'], ['landscape', 'Landscape']])),
        field('Paper size', sel('paper', Object.keys(PAPERS).map((k) => [k, k] as [string, string]))),
      ), row(
        field('Scaling', sel('scale', [['none', 'Automatic (shrink wide sheets)'], ['fit-cols', 'Fit all columns on one page'], ['fit-sheet', 'Fit sheet on one page'], ['custom', 'Adjust to a percent']])),
        field('Percent of normal size', pct),
      )),
      group('Margins in inches', row(field('Preset', sel('margins', [['normal', 'Normal'], ['wide', 'Wide'], ['narrow', 'Narrow'], ['custom', 'Custom']]))), row(
        field('Top', num('m0')), field('Right', num('m1')), field('Bottom', num('m2')), field('Left', num('m3')), field('Header', num('m4')), field('Footer', num('m5')),
      )),
      group('Sheet', row(field('Print area, such as A1:F40', inp('area'))), row(field('Rows to repeat at top, such as 1:2', inp('titleRows')), field('Columns to repeat at left, such as A:B', inp('titleCols'))), row(check('grid', 'Print gridlines'), check('heads', 'Print row and column headings'))),
      group('Header and footer', el('p', 'fc-fmt-hint', 'Codes: &P page number, &N page count, &D date, &A sheet name, &F file name, && an ampersand.'), row(
        field('Header, left', inp('hl')), field('Header, center', inp('hc')), field('Header, right', inp('hr')),
      ), row(
        field('Footer, left', inp('fl')), field('Footer, center', inp('fc')), field('Footer, right', inp('fr')),
      )),
    );
    const reset = el('button', 'fc-btn fc-btn-ghost', 'Reset all page breaks');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.breaks = [[], []];
      reset.textContent = 'Page breaks reset';
    });
    this.reset = reset;
    body.appendChild(actions('OK', () => this.submit(), () => m.close(), [reset]));
    this.f.get('margins')!.addEventListener('change', () => {
      const v = (this.f.get('margins') as HTMLSelectElement).value;
      const preset = MARGIN_PRESETS[v];
      if (preset) preset.forEach((x, i) => ((this.f.get(`m${i}`) as HTMLInputElement).value = String(x)));
    });
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
        e.preventDefault();
        this.submit();
      }
    });
  }

  private reset: HTMLButtonElement;

  show(p: PageSetup, done: (p: PageSetup) => void): void {
    const s = cleanPage(p);
    this.done = done;
    this.breaks = [[...s.rowBreaks], [...s.colBreaks]];
    this.reset.textContent = 'Reset all page breaks';
    const set = (k: string, v: string | number | boolean) => {
      const n = this.f.get(k)!;
      if (n instanceof HTMLInputElement && n.type === 'checkbox') n.checked = Boolean(v);
      else n.value = String(v);
    };
    set('orient', s.orient);
    set('paper', s.paper);
    set('scale', s.scale);
    set('pct', s.pct);
    set('margins', s.margins);
    s.m.forEach((x, i) => set(`m${i}`, x));
    set('area', s.area);
    set('titleRows', s.titleRows);
    set('titleCols', s.titleCols);
    set('grid', s.grid);
    set('heads', s.heads);
    for (const k of HF_KEYS) set(k, s.hf[k]);
    this.modal.open(this.f.get('orient'));
  }

  private submit(): void {
    const v = (k: string) => (this.f.get(k) as HTMLInputElement).value;
    const margins = v('margins') as PageSetup['margins'];
    const m = [0, 1, 2, 3, 4, 5].map((i) => Number(v(`m${i}`)));
    const preset = MARGIN_PRESETS[margins];
    const same = preset && preset.every((x, i) => Math.abs(x - m[i]) < 0.001);
    const out = cleanPage({
      orient: v('orient'),
      paper: v('paper'),
      scale: v('scale'),
      pct: Number(v('pct')),
      margins: same ? margins : 'custom',
      m,
      area: v('area').replace(/\$/g, '').toUpperCase(),
      titleRows: v('titleRows').replace(/\$/g, ''),
      titleCols: v('titleCols').replace(/\$/g, '').toUpperCase(),
      grid: (this.f.get('grid') as HTMLInputElement).checked,
      heads: (this.f.get('heads') as HTMLInputElement).checked,
      hf: Object.fromEntries(HF_KEYS.map((k) => [k, v(k)])),
      rowBreaks: this.breaks[0],
      colBreaks: this.breaks[1],
    });
    this.modal.close();
    this.done?.(out);
  }
}
