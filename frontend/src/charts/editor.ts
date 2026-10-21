import type { EngineClient } from '../engine';
import { build, readMatrix, recommendRanked, resolveRange } from './data';
import { renderChart, renderChartAsync } from './svg';
import { CHART_TYPES, ERR_KINDS, PALETTE, TREND_KINDS, blankChart, type ChartData, type ChartSpec, type ChartType, type ErrKind, type Legend, type TrendKind } from './types';

export interface EditorContext {
  eng: EngineClient;
  book(): number;
  sheet(): number;
  sheetNames(): string[];
  pivotData?(name: string): Promise<ChartData | null>;
}

const LEGENDS: [Legend, string][] = [['right', 'Right'], ['bottom', 'Bottom'], ['top', 'Top'], ['left', 'Left'], ['none', 'None']];

export class ChartEditor {
  private readonly form: HTMLFormElement;
  private done: ((s: ChartSpec | null) => void) | null = null;
  private timer = 0;
  private lastPreview = '';
  private lastRecs = '';
  private lastSeries = '';
  private seq = 0;
  private base: ChartSpec = blankChart('column', '');
  private preset: (string | undefined)[] = [];
  private wantSeries: string[] = ['-1', '-1'];

  constructor(private readonly ctx: EditorContext, private readonly focus: () => void) {
    const form = document.createElement('form');
    form.className = 'fc-fmt-custom fc-pw fc-chart-form';
    form.hidden = true;
    form.setAttribute('role', 'dialog');
    form.setAttribute('aria-label', 'Chart editor');
    const groups = [...new Set(CHART_TYPES.map((t) => t.group))];
    const types = groups.map((g) => `<optgroup label="${g}">${CHART_TYPES.filter((t) => t.group === g).map((t) => `<option value="${t.id}">${t.label}</option>`).join('')}</optgroup>`).join('');
    const legends = LEGENDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    const trendKinds = `<option value="">None</option>${TREND_KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}`;
    const errKinds = `<option value="">None</option>${ERR_KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}`;
    form.innerHTML = `<span class="fc-fmt-title">Chart editor</span>
<div class="fc-chart-grid">
<div class="fc-chart-fields">
<label class="fc-fmt-label">Chart type<select class="fc-fmt-input" data-k="type">${types}</select></label>
<details class="fc-chart-sec" data-k="recbox" open><summary>Recommended charts</summary><div class="fc-chart-recs" data-k="rec" role="group" aria-label="Recommended charts"></div></details>
<label class="fc-fmt-label">Data range or name<input class="fc-fmt-input" data-k="range" spellcheck="false" autocomplete="off" placeholder="A1:C10 or SalesData"></label>
<label class="fc-fmt-label">Series are in<select class="fc-fmt-input" data-k="byRows"><option value="cols">Columns</option><option value="rows">Rows</option></select></label>
<label class="fc-fmt-label">Chart title<input class="fc-fmt-input" data-k="title" autocomplete="off"></label>
<label class="fc-fmt-label">Horizontal axis title<input class="fc-fmt-input" data-k="xTitle" autocomplete="off"></label>
<label class="fc-fmt-label">Vertical axis title<input class="fc-fmt-input" data-k="yTitle" autocomplete="off"></label>
<label class="fc-fmt-label">Legend<select class="fc-fmt-input" data-k="legend">${legends}</select></label>
<label class="fc-fmt-label">Secondary axis series (combo, for example 2,3)<input class="fc-fmt-input" data-k="secondary" autocomplete="off"></label>
<label class="fc-fmt-label">Axis minimum (blank for automatic)<input class="fc-fmt-input" data-k="min" inputmode="decimal" autocomplete="off"></label>
<label class="fc-fmt-label">Axis maximum, or gauge top (blank for automatic)<input class="fc-fmt-input" data-k="max" inputmode="decimal" autocomplete="off"></label>
<label class="fc-fmt-label">Gauge bands, two thresholds (for example 30,70)<input class="fc-fmt-input" data-k="bands" autocomplete="off" placeholder="30,70"></label>
<label class="fc-sort-check"><input type="checkbox" data-k="labels"> Data labels</label>
<label class="fc-fmt-label">Data label number format (for example 0.0% or $#,##0)<input class="fc-fmt-input" data-k="labelFmt" spellcheck="false" autocomplete="off"></label>
<label class="fc-fmt-label" data-k="binsRow">Histogram bins (blank for automatic)<input class="fc-fmt-input" data-k="bins" inputmode="numeric" autocomplete="off"></label>
<label class="fc-fmt-label" data-k="totalsRow">Waterfall totals, row numbers (blank for automatic)<input class="fc-fmt-input" data-k="totals" autocomplete="off" placeholder="5,9"></label>
<label class="fc-fmt-label" data-k="tlRow">Timeline mode<select class="fc-fmt-input" data-k="tlMode"><option value="auto">Automatic</option><option value="gantt">Task bars (task, start, end)</option><option value="annotated">Annotated date axis (date, values, titles, notes)</option></select></label>
<label class="fc-fmt-label" data-k="levelRow">Map level<select class="fc-fmt-input" data-k="level"><option value="auto">Automatic from the data</option><option value="country">Countries</option><option value="region">States and provinces</option></select></label>
<details class="fc-chart-sec"><summary>Axes and gridlines</summary>
<div class="fc-chart-row">
<label class="fc-fmt-label">Value axis number format<input class="fc-fmt-input" data-k="yFmt" spellcheck="false" autocomplete="off" placeholder="General"></label>
<label class="fc-fmt-label">Horizontal axis number format<input class="fc-fmt-input" data-k="xFmt" spellcheck="false" autocomplete="off" placeholder="General"></label>
</div>
<label class="fc-sort-check"><input type="checkbox" data-k="logY"> Logarithmic value axis</label>
<label class="fc-sort-check"><input type="checkbox" data-k="grid"> Horizontal gridlines</label>
<label class="fc-sort-check"><input type="checkbox" data-k="xGrid"> Vertical gridlines</label>
</details>
<details class="fc-chart-sec"><summary>Colours and areas</summary>
<div class="fc-chart-colors" data-k="colors" role="group" aria-label="Series colours"></div>
<div class="fc-chart-row">
<label class="fc-fmt-label">Chart area fill<input class="fc-fmt-input" data-k="fill" spellcheck="false" autocomplete="off" placeholder="Automatic, or #f5f5f5"></label>
<label class="fc-fmt-label">Plot area fill<input class="fc-fmt-input" data-k="plotFill" spellcheck="false" autocomplete="off" placeholder="Automatic, or #ffffff"></label>
</div>
</details>
<details class="fc-chart-sec"><summary>Trendline and error bars</summary>
<div class="fc-chart-row">
<label class="fc-fmt-label">Trendline<select class="fc-fmt-input" data-k="trendKind">${trendKinds}</select></label>
<label class="fc-fmt-label">On<select class="fc-fmt-input" data-k="trendSeries"></select></label>
</div>
<div class="fc-chart-row">
<label class="fc-fmt-label">Polynomial order or average period<input class="fc-fmt-input" data-k="trendN" inputmode="numeric" autocomplete="off" placeholder="2"></label>
<span class="fc-chart-row"><label class="fc-sort-check"><input type="checkbox" data-k="trendEq"> Equation</label><label class="fc-sort-check"><input type="checkbox" data-k="trendR2"> R squared</label></span>
</div>
<div class="fc-chart-row">
<label class="fc-fmt-label">Error bars<select class="fc-fmt-input" data-k="errKind">${errKinds}</select></label>
<label class="fc-fmt-label">On<select class="fc-fmt-input" data-k="errSeries"></select></label>
</div>
<div class="fc-chart-row">
<label class="fc-fmt-label">Amount (value, percent or multiples)<input class="fc-fmt-input" data-k="errValue" inputmode="decimal" autocomplete="off" placeholder="1"></label>
<label class="fc-fmt-label">Direction<select class="fc-fmt-input" data-k="errDir"><option value="both">Both</option><option value="plus">Plus</option><option value="minus">Minus</option></select></label>
</div>
</details>
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
    form.addEventListener('input', (e) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement && t.type === 'color') t.dataset.custom = '1';
      this.queue();
    });
    form.addEventListener('change', () => this.queue());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const s = this.read();
      if (s.pivot) {
        this.close(s);
        return;
      }
      void resolveRange(this.ctx.eng, this.ctx.book(), s.range).then((ref) => {
        if (!ref || (ref.sheet && !this.ctx.sheetNames().includes(ref.sheet))) {
          form.dataset.state = 'error';
          this.q('hint').textContent = 'Type a range such as A1:D10, Sheet2!A1:D10, or the name of a named range.';
          return;
        }
        this.close(s);
      });
    });
  }

  private q<T extends HTMLElement>(k: string): T {
    return (k === 'hint' ? this.form.querySelector('.fc-fmt-hint') : this.form.querySelector(`[data-k="${k}"]`)) as T;
  }

  private read(): ChartSpec {
    const v = (k: string) => this.q<HTMLInputElement>(k).value;
    const num = (k: string) => (v(k).trim() === '' || !Number.isFinite(Number(v(k))) ? undefined : Number(v(k)));
    const s: ChartSpec = { ...this.base, type: v('type') as ChartType, range: this.base.pivot ? '' : v('range').trim() };
    s.byRows = v('byRows') === 'rows';
    s.title = v('title');
    s.xTitle = v('xTitle');
    s.yTitle = v('yTitle');
    s.legend = v('legend') as Legend;
    s.labels = this.q<HTMLInputElement>('labels').checked;
    s.secondary = v('secondary').split(/[,\s]+/).map((x) => Number(x) - 1).filter((x) => Number.isInteger(x) && x >= 0);
    s.min = num('min');
    s.max = num('max');
    const bn = v('bands').split(/[,\s]+/).map(Number).filter((x) => Number.isFinite(x));
    s.bands = bn.length === 2 && bn[0] < bn[1] ? [bn[0], bn[1]] : undefined;
    const text = (k: string) => v(k).trim() || undefined;
    const check = (k: string) => this.q<HTMLInputElement>(k).checked;
    s.yFmt = text('yFmt');
    s.xFmt = text('xFmt');
    s.labelFmt = text('labelFmt');
    s.fill = text('fill');
    s.plotFill = text('plotFill');
    s.logY = check('logY') || undefined;
    s.grid = check('grid') ? undefined : false;
    s.xGrid = check('xGrid') || undefined;
    const bins = num('bins');
    s.bins = bins && bins > 0 ? Math.round(bins) : undefined;
    const totals = v('totals').split(/[,\s]+/).map((x) => Number(x) - 1).filter((x) => Number.isInteger(x) && x >= 0);
    s.totals = totals.length ? totals : undefined;
    s.tlMode = v('tlMode') === 'auto' ? undefined : (v('tlMode') as ChartSpec['tlMode']);
    s.level = v('level') === 'auto' ? undefined : (v('level') as ChartSpec['level']);
    const colors = Array.from(this.form.querySelectorAll<HTMLInputElement>('[data-k="colors"] input')).map((el, i) => (el.dataset.custom === '1' ? el.value : this.preset[i] ?? ''));
    while (colors.length && !colors[colors.length - 1]) colors.pop();
    s.colors = colors.length ? colors : undefined;
    const series = (k: string) => Number(v(k));
    const tk = v('trendKind') as TrendKind | '';
    const n = num('trendN');
    s.trends = tk ? [{ series: series('trendSeries'), kind: tk, order: tk === 'poly' ? Math.max(2, Math.min(6, Math.round(n ?? 2))) : undefined, period: tk === 'mavg' ? Math.max(2, Math.round(n ?? 2)) : undefined, eq: check('trendEq') || undefined, r2: check('trendR2') || undefined }] : undefined;
    const ek = v('errKind') as ErrKind | '';
    s.errBars = ek ? [{ series: series('errSeries'), kind: ek, value: num('errValue') ?? 1, dir: v('errDir') as 'both' | 'plus' | 'minus' }] : undefined;
    const bag = s as unknown as Record<string, unknown>;
    for (const key of Object.keys(bag)) if (bag[key] === undefined) delete bag[key];
    return s;
  }

  open(spec: ChartSpec, title: string): Promise<ChartSpec | null> {
    const set = (k: string, val: string) => (this.q<HTMLInputElement>(k).value = val);
    this.base = { ...spec };
    this.preset = spec.colors ? [...spec.colors] : [];
    this.lastRecs = '';
    this.lastSeries = '';
    set('type', spec.type);
    set('range', spec.pivot ? `PivotTable ${spec.pivot}` : spec.range);
    this.q<HTMLInputElement>('range').disabled = !!spec.pivot;
    set('yFmt', spec.yFmt ?? '');
    set('xFmt', spec.xFmt ?? '');
    set('labelFmt', spec.labelFmt ?? '');
    set('fill', spec.fill ?? '');
    set('plotFill', spec.plotFill ?? '');
    set('bins', spec.bins === undefined ? '' : String(spec.bins));
    set('totals', (spec.totals ?? []).map((i) => i + 1).join(','));
    set('tlMode', spec.tlMode ?? 'auto');
    set('level', spec.level ?? 'auto');
    this.q<HTMLInputElement>('logY').checked = !!spec.logY;
    this.q<HTMLInputElement>('grid').checked = spec.grid !== false;
    this.q<HTMLInputElement>('xGrid').checked = !!spec.xGrid;
    const tr = spec.trends?.[0];
    set('trendKind', tr?.kind ?? '');
    set('trendN', tr ? String(tr.kind === 'mavg' ? tr.period ?? '' : tr.kind === 'poly' ? tr.order ?? '' : '') : '');
    this.q<HTMLInputElement>('trendEq').checked = !!tr?.eq;
    this.q<HTMLInputElement>('trendR2').checked = !!tr?.r2;
    const eb = spec.errBars?.[0];
    set('errKind', eb?.kind ?? '');
    set('errValue', eb ? String(eb.value) : '');
    set('errDir', eb?.dir ?? 'both');
    this.wantSeries = [tr ? String(tr.series) : '-1', eb ? String(eb.series) : '-1'];
    set('byRows', spec.byRows ? 'rows' : 'cols');
    set('title', spec.title);
    set('xTitle', spec.xTitle);
    set('yTitle', spec.yTitle);
    set('legend', spec.legend);
    set('secondary', spec.secondary.map((i) => i + 1).join(','));
    set('min', spec.min === undefined ? '' : String(spec.min));
    set('max', spec.max === undefined ? '' : String(spec.max));
    set('bands', spec.bands ? spec.bands.join(',') : '');
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
    const box = this.q<HTMLElement>('preview');
    let html = '<div class="fc-chart-empty">Type a data range to see the chart.</div>';
    let data: ChartData | null = null;
    let ranked: { type: ChartType; why: string; svg: string }[] = [];
    if (s.pivot) {
      data = (await this.ctx.pivotData?.(s.pivot)) ?? null;
      if (seq !== this.seq) return;
      html = data ? await renderChartAsync(this.ctx.eng, s, data, 360, 260) : '<div class="fc-chart-empty">The PivotTable has no values to chart yet.</div>';
    } else {
      const ref = await resolveRange(this.ctx.eng, this.ctx.book(), s.range);
      if (seq !== this.seq) return;
      if (ref) {
        const sheet = ref.sheet ? this.ctx.sheetNames().indexOf(ref.sheet) : this.ctx.sheet();
        if (sheet >= 0) {
          const m = await readMatrix(this.ctx.eng, this.ctx.book(), sheet, ref.range);
          if (seq !== this.seq) return;
          data = build(m, s.byRows, s.type);
          html = await renderChartAsync(this.ctx.eng, s, data, 360, 260);
          const oriented = s.byRows ? m[0].map((_, j) => m.map((r) => r[j])) : m;
          ranked = recommendRanked(oriented).map((r) => ({ ...r, svg: renderChart({ ...blankChart(r.type, ''), legend: 'none' }, build(m, s.byRows, r.type), 112, 84) }));
        }
      }
    }
    if (seq !== this.seq) return;
    if (html !== this.lastPreview) {
      this.lastPreview = html;
      box.innerHTML = html;
    }
    this.recs(ranked, s.type);
    this.syncSeries(data, s.type);
    this.q<HTMLElement>('binsRow').hidden = s.type !== 'histogram';
    this.q<HTMLElement>('totalsRow').hidden = s.type !== 'waterfall';
    this.q<HTMLElement>('tlRow').hidden = s.type !== 'timeline';
    this.q<HTMLElement>('levelRow').hidden = s.type !== 'map';
  }

  private recs(ranked: { type: ChartType; why: string; svg: string }[], current: ChartType): void {
    const rec = this.q<HTMLElement>('rec');
    const key = ranked.map((r) => `${r.type}|${r.svg.length}`).join(',');
    if (key !== this.lastRecs) {
      this.lastRecs = key;
      const label = (id: string) => CHART_TYPES.find((t) => t.id === id)?.label ?? id;
      rec.innerHTML = ranked.length
        ? ranked.map((r) => `<button type="button" data-rec="${r.type}" title="${r.why}" aria-pressed="false">${r.svg}<span>${label(r.type)}</span></button>`).join('')
        : '';
    }
    rec.querySelectorAll<HTMLElement>('[data-rec]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rec === current)));
  }

  private syncSeries(d: ChartData | null, type: ChartType): void {
    const names = d ? d.series.map((x) => x.name) : [];
    const pointy = ['pie', 'doughnut', 'funnel', 'treemap', 'sunburst'].includes(type);
    const items = pointy && d ? d.cats : names;
    const key = `${names.join('\u0001')}\u0002${pointy ? items.join('\u0001') : ''}`;
    if (key === this.lastSeries) return;
    const first = this.lastSeries === '';
    this.lastSeries = key;
    const picks = ['trendSeries', 'errSeries'];
    picks.forEach((k, n) => {
      const el = this.q<HTMLSelectElement>(k);
      const prev = first ? this.wantSeries[n] : el.value;
      el.replaceChildren(new Option('All series', '-1'), ...names.map((nm, i) => new Option(nm, String(i))));
      el.value = Array.from(el.options).some((o) => o.value === prev) ? prev : '-1';
    });
    const box = this.q<HTMLElement>('colors');
    const have = Array.from(box.querySelectorAll<HTMLInputElement>('input'));
    have.forEach((el, i) => {
      if (el.dataset.custom === '1') this.preset[i] = el.value;
    });
    box.replaceChildren(
      ...items.slice(0, 24).map((nm, i) => {
        const el = document.createElement('input');
        el.type = 'color';
        el.value = /^#[0-9a-f]{6}$/i.test(this.preset[i] ?? '') ? (this.preset[i] as string) : PALETTE[i % PALETTE.length];
        el.title = nm;
        el.setAttribute('aria-label', `Colour of ${nm}`);
        return el;
      }),
    );
  }
}
