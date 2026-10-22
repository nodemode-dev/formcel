import { build } from '../charts/data';
import { renderChart } from '../charts/svg';
import type { ChartSpec } from '../charts/types';
import { makeModal, type Modal } from './modal';
import { drawThumb } from './thumb';

export interface Visual {
  sheet: number;
  kind: 'chart' | 'spark';
  type: string;
}

export interface GalleryTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  sheets: string[];
  rows: number;
  preview: string[][];
  visuals?: Visual[];
}

interface ThumbChart {
  sheet: number;
  w: number;
  h: number;
  spec: ChartSpec;
  matrix: string[][];
}

interface ThumbData {
  id: string;
  charts: ThumbChart[];
  sparks: number;
}

const LABELS: Record<string, string> = {
  column: 'Column', 'column-stacked': 'Stacked column', 'column-100': '100% column', bar: 'Bar', 'bar-stacked': 'Stacked bar', 'bar-100': '100% bar',
  line: 'Line', area: 'Area', 'area-stacked': 'Stacked area', 'area-100': '100% area', pie: 'Pie', doughnut: 'Doughnut', scatter: 'Scatter', bubble: 'Bubble',
  combo: 'Combo', histogram: 'Histogram', box: 'Box and whisker', waterfall: 'Waterfall', candlestick: 'Candlestick', treemap: 'Treemap', sunburst: 'Sunburst',
  funnel: 'Funnel', gauge: 'Gauge', scorecard: 'Scorecard', radar: 'Radar', timeline: 'Timeline', org: 'Org chart', map: 'Map',
};

export function visualNames(v: Visual[] | undefined): string[] {
  const out: string[] = [];
  for (const x of v ?? []) {
    const n = x.kind === 'spark' ? 'Sparklines' : LABELS[x.type] ?? 'Chart';
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

const cache = new Map<string, Promise<ThumbData | null>>();
const queue: (() => void)[] = [];
let running = 0;

function pump(): void {
  while (running < 2 && queue.length) {
    running++;
    queue.shift()!();
  }
}

function fetchThumb(id: string): Promise<ThumbData | null> {
  let p = cache.get(id);
  if (!p) {
    p = new Promise<ThumbData | null>((done) => {
      queue.push(() => {
        fetch(`/api/templates/${encodeURIComponent(id)}/thumb`)
          .then((r) => (r.ok ? (r.json() as Promise<ThumbData>) : null))
          .catch(() => null)
          .then((d) => {
            running--;
            done(d);
            pump();
          });
      });
      pump();
    });
    cache.set(id, p);
  }
  return p;
}

function chartSvg(c: ThumbChart, w: number, h: number, small: boolean): string {
  const spec: ChartSpec = small ? { ...c.spec, title: '', legend: 'none', labels: false } : c.spec;
  return renderChart(spec, build(c.matrix, spec.byRows, spec.type), w, h);
}

const watchers = new Map<Element, () => void>();
const seen =
  typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(
        (es) => {
          for (const e of es) {
            if (!e.isIntersecting) continue;
            seen!.unobserve(e.target);
            watchers.get(e.target)?.();
            watchers.delete(e.target);
          }
        },
        { rootMargin: '160px' },
      );

export function thumbBox(): HTMLElement {
  const box = document.createElement('span');
  box.className = 'fc-tt';
  box.innerHTML = '<canvas class="fc-tt-grid" aria-hidden="true"></canvas><span class="fc-tt-chart" aria-hidden="true"></span><span class="fc-tt-chips"></span>';
  return box;
}

function setChips(box: HTMLElement, names: string[]): void {
  const host = box.querySelector<HTMLElement>('.fc-tt-chips')!;
  const shown = names.length > 3 ? [...names.slice(0, 2), `+${names.length - 2}`] : names;
  const sig = shown.join('|');
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  host.replaceChildren(
    ...shown.map((n) => {
      const s = document.createElement('span');
      s.className = 'fc-tt-chip';
      s.textContent = n;
      return s;
    }),
  );
}

export function paintThumb(box: HTMLElement, t: GalleryTemplate): void {
  const names = visualNames(t.visuals);
  const chart = (t.visuals ?? []).some((v) => v.kind === 'chart');
  if (box.dataset.id === t.id) return;
  box.dataset.id = t.id;
  setChips(box, names);
  const grid = box.querySelector<HTMLCanvasElement>('.fc-tt-grid')!;
  const host = box.querySelector<HTMLElement>('.fc-tt-chart')!;
  host.replaceChildren();
  host.dataset.state = '';
  box.dataset.visual = chart ? '1' : '';
  if (!chart) {
    drawThumb(grid, t.preview);
    return;
  }
  const id = t.id;
  const load = (): void => {
    void fetchThumb(id).then((d) => {
      if (box.dataset.id !== id) return;
      const dense = new Set(['timeline', 'org', 'scatter', 'bubble']);
      const first = d?.charts.find((c) => !dense.has(c.spec.type)) ?? d?.charts[0];
      if (!first) {
        box.dataset.visual = '';
        drawThumb(grid, t.preview);
        return;
      }
      host.innerHTML = chartSvg(first, 320, 130, true);
      host.dataset.state = 'ready';
    });
  };
  if (seen) {
    watchers.set(box, load);
    seen.observe(box);
  } else load();
}

let modal: Modal | null = null;

function tag(name: string, cls: string, text?: string): HTMLElement {
  const n = document.createElement(name);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function previewTable(rows: string[][]): HTMLElement {
  const t = document.createElement('table');
  t.className = 'fc-tpv-table';
  for (const r of rows) {
    const tr = t.insertRow();
    for (const v of r) tr.insertCell().textContent = v;
  }
  return t;
}

export function openPreview(t: GalleryTemplate, create: (id: string) => void): void {
  modal ??= makeModal('', { wide: true });
  const m = modal;
  m.el.classList.add('fc-tpv');
  m.el.querySelector('h2')!.textContent = t.name;
  const names = visualNames(t.visuals);
  const charts = (t.visuals ?? []).filter((v) => v.kind === 'chart').length;
  const stage = tag('div', 'fc-tpv-stage');
  stage.dataset.count = String(Math.min(charts, 4));
  const slots: HTMLElement[] = [];
  for (let i = 0; i < Math.min(charts, 4); i++) {
    const s = tag('div', 'fc-tpv-chart');
    stage.append(s);
    slots.push(s);
  }
  if (!charts) stage.append(previewTable(t.preview));
  const side = tag('div', 'fc-tpv-side');
  side.append(tag('p', 'fc-tpv-desc', t.description));
  const facts = tag('dl', 'fc-tpv-facts');
  const fact = (k: string, v: HTMLElement | string): void => {
    facts.append(tag('dt', '', k));
    const d = tag('dd', '');
    if (typeof v === 'string') d.textContent = v;
    else d.append(v);
    facts.append(d);
  };
  fact('Category', t.category);
  const sheets = tag('span', 'fc-tpv-pills');
  for (const s of t.sheets) sheets.append(tag('span', 'fc-tt-chip', s));
  fact(t.sheets.length === 1 ? 'Sheet' : 'Sheets', sheets);
  if (names.length) {
    const vis = tag('span', 'fc-tpv-pills');
    for (const n of names) vis.append(tag('span', 'fc-tt-chip', n));
    fact('Visuals', vis);
  }
  if (t.tags.length) fact('Tags', t.tags.join(', '));
  side.append(facts);
  const body = tag('div', 'fc-tpv-body');
  body.append(stage, side);
  const foot = tag('div', 'fc-tpv-foot');
  const cancel = tag('button', 'fc-btn', 'Cancel') as HTMLButtonElement;
  cancel.type = 'button';
  cancel.addEventListener('click', () => m.close());
  const go = tag('button', 'fc-btn fc-btn-primary', 'Create') as HTMLButtonElement;
  go.type = 'button';
  go.addEventListener('click', () => {
    m.close();
    create(t.id);
  });
  foot.append(cancel, go);
  m.body.replaceChildren(body, foot);
  m.open(go);
  if (!charts) return;
  void fetchThumb(t.id).then((d) => {
    if (!d || !m.isOpen()) return;
    d.charts.slice(0, slots.length).forEach((c, i) => {
      const w = 420;
      slots[i].innerHTML = chartSvg(c, w, Math.round((w * c.h) / Math.max(1, c.w)), false);
      slots[i].dataset.state = 'ready';
    });
  });
}

export function onPreviewGesture(card: HTMLElement, preview: () => void, create: () => void): void {
  let timer = 0;
  card.addEventListener('click', (e) => {
    e.preventDefault();
    window.clearTimeout(timer);
    timer = window.setTimeout(preview, 230);
  });
  card.addEventListener('dblclick', (e) => {
    e.preventDefault();
    window.clearTimeout(timer);
    create();
  });
}
