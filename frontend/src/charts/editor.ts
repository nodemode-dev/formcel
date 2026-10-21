import type { EngineClient } from '../engine';
import { build, parseRangeText, readMatrix, recommend } from './data';
import { renderChart } from './svg';
import { CHART_TYPES, blankChart, type ChartSpec, type ChartType, type Legend } from './types';

export interface EditorContext {
  eng: EngineClient;
  book(): number;
  sheet(): number;
  sheetNames(): string[];
}

const LEGENDS: [Legend, string][] = [['right', 'Right'], ['bottom', 'Bottom'], ['top', 'Top'], ['left', 'Left'], ['none', 'None']];

export class ChartEditor {
  private readonly form: HTMLFormElement;
  private done: ((s: ChartSpec | null) => void) | null = null;
  private timer = 0;
  private lastPreview = '';
  private seq = 0;

  constructor(private readonly ctx: EditorContext, private readonly focus: () => void) {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom fc-pw fc-chart-form';
    form.hidden = true;
    form.setAttribute('role', 'dialog');
    form.setAttribute('aria-label', 'Chart editor');
    const groups = [...new Set(CHART_TYPES.map((t) => t.group))];
    const types = groups.map((g) => `<optgroup label="${g}">${CHART_TYPES.filter((t) => t.group === g).map((t) => `<option value="${t.id}">${t.label}</option>`).join('')}</optgroup>`).join('');
    const legends = LEGENDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    form.innerHTML = `<span class="fc-fmt-title">Chart editor</span>
<div class="fc-chart-grid">
<div class="fc-chart-fields">
<label class="fc-fmt-label">Chart type<select class="fc-fmt-input" data-k="type">${types}</select></label>
<div class="fc-chart-rec" data-k="rec"></div>
<label class="fc-fmt-label">Data range<input class="fc-fmt-input" data-k="range" spellcheck="false" autocomplete="off" placeholder="A1:C10"></label>
<label class="fc-fmt-label">Series are in<select class="fc-fmt-input" data-k="byRows"><option value="cols">Columns</option><option value="rows">Rows</option></select></label>
<label class="fc-fmt-label">Chart title<input class="fc-fmt-input" data-k="title" autocomplete="off"></label>
<label class="fc-fmt-label">Horizontal axis title<input class="fc-fmt-input" data-k="xTitle" autocomplete="off"></label>
<label class="fc-fmt-label">Vertical axis title<input class="fc-fmt-input" data-k="yTitle" autocomplete="off"></label>
<label class="fc-fmt-label">Legend<select class="fc-fmt-input" data-k="legend">${legends}</select></label>
<label class="fc-fmt-label">Secondary axis series (combo, for example 2,3)<input class="fc-fmt-input" data-k="secondary" autocomplete="off"></label>
<label class="fc-fmt-label">Axis minimum (blank for automatic)<input class="fc-fmt-input" data-k="min" inputmode="decimal" autocomplete="off"></label>
<label class="fc-fmt-label">Axis maximum, or gauge top (blank for automatic)<input class="fc-fmt-input" data-k="max" inputmode="decimal" autocomplete="off"></label>
<label class="fc-sort-check"><input type="checkbox" data-k="labels"> Data labels</label>
</div>
<div class="fc-chart-preview" data-k="preview" aria-label="Preview"></div>
</div>
<span class="fc-fmt-hint" aria-live="polite"></span>
<div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="cancel">Cancel</button><button type="submit" class="fc-btn fc-btn-primary">OK</button></div>`;
    document.getElementById('overlay-root')!.appendChild(form);
    this.form = form;
    form.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-a="cancel"]')) this.close(null);
      const rec = t.closest<HTMLElement>('[data-rec]');
      if (rec) {
        this.q<HTMLSelectElement>('type').value = rec.dataset.rec!;
        this.preview();
      }
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close(null);
    });
    form.addEventListener('input', () => this.queue());
    form.addEventListener('change', () => this.queue());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const s = this.read();
      const ref = parseRangeText(s.range);
      if (!ref || (ref.sheet && !this.ctx.sheetNames().includes(ref.sheet))) {
        form.dataset.state = 'error';
        this.q('hint').textContent = 'Type a range such as A1:D10, or Sheet2!A1:D10.';
        return;
      }
      this.close(s);
    });
  }

  private q<T extends HTMLElement>(k: string): T {
    return (k === 'hint' ? this.form.querySelector('.fc-fmt-hint') : this.form.querySelector(`[data-k="${k}"]`)) as T;
  }

  private read(): ChartSpec {
    const v = (k: string) => this.q<HTMLInputElement>(k).value;
    const num = (k: string) => (v(k).trim() === '' || !Number.isFinite(Number(v(k))) ? undefined : Number(v(k)));
    const s = blankChart(v('type') as ChartType, v('range').trim());
    s.byRows = v('byRows') === 'rows';
    s.title = v('title');
    s.xTitle = v('xTitle');
    s.yTitle = v('yTitle');
    s.legend = v('legend') as Legend;
    s.labels = this.q<HTMLInputElement>('labels').checked;
    s.secondary = v('secondary').split(/[,\s]+/).map((x) => Number(x) - 1).filter((x) => Number.isInteger(x) && x >= 0);
    s.min = num('min');
    s.max = num('max');
    return s;
  }

  open(spec: ChartSpec, title: string): Promise<ChartSpec | null> {
    const set = (k: string, val: string) => (this.q<HTMLInputElement>(k).value = val);
    set('type', spec.type);
    set('range', spec.range);
    set('byRows', spec.byRows ? 'rows' : 'cols');
    set('title', spec.title);
    set('xTitle', spec.xTitle);
    set('yTitle', spec.yTitle);
    set('legend', spec.legend);
    set('secondary', spec.secondary.map((i) => i + 1).join(','));
    set('min', spec.min === undefined ? '' : String(spec.min));
    set('max', spec.max === undefined ? '' : String(spec.max));
    this.q<HTMLInputElement>('labels').checked = spec.labels;
    this.q('hint').textContent = '';
    this.form.dataset.state = '';
    this.form.querySelector<HTMLElement>('.fc-fmt-title')!.textContent = title;
    this.lastPreview = '';
    this.form.hidden = false;
    this.preview();
    this.q<HTMLInputElement>('range').focus();
    this.q<HTMLInputElement>('range').select();
    return new Promise((resolve) => (this.done = resolve));
  }

  private close(s: ChartSpec | null): void {
    this.form.hidden = true;
    const d = this.done;
    this.done = null;
    d?.(s);
    this.focus();
  }

  private queue(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.preview(), 120);
  }

  private async preview(): Promise<void> {
    const seq = ++this.seq;
    const s = this.read();
    const ref = parseRangeText(s.range);
    const box = this.q<HTMLElement>('preview');
    const rec = this.q<HTMLElement>('rec');
    let html = '<div class="fc-chart-empty">Type a data range to see the chart.</div>';
    let recHtml = '';
    if (ref) {
      const sheet = ref.sheet ? this.ctx.sheetNames().indexOf(ref.sheet) : this.ctx.sheet();
      if (sheet >= 0) {
        const m = await readMatrix(this.ctx.eng, this.ctx.book(), sheet, ref.range);
        if (seq !== this.seq) return;
        html = renderChart(s, build(m, s.byRows, s.type), 360, 260);
        const label = (id: string) => CHART_TYPES.find((t) => t.id === id)?.label ?? id;
        recHtml = `<span>Recommended</span>${recommend(s.byRows ? m[0].map((_, j) => m.map((r) => r[j])) : m).map((id) => `<button type="button" class="fc-btn" data-rec="${id}">${label(id)}</button>`).join('')}`;
      }
    }
    if (html !== this.lastPreview) {
      this.lastPreview = html;
      box.innerHTML = html;
    }
    if (rec.innerHTML !== recHtml) rec.innerHTML = recHtml;
  }
}
