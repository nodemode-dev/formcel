import { actions, el, field, makeModal } from '../ui/modal';
import type { SparkSpec } from './types';

export interface SparkAnswer {
  data: string;
  location: string;
  spec: SparkSpec;
}

const KINDS: [SparkSpec['type'], string][] = [['line', 'Line'], ['column', 'Column'], ['winloss', 'Win/Loss']];
const EMPTY: [string, string][] = [['gap', 'Gaps'], ['zero', 'Zero'], ['span', 'Connect data points with line']];
const POINTS: [keyof SparkSpec, string][] = [['high', 'High point'], ['low', 'Low point'], ['negative', 'Negative points'], ['first', 'First point'], ['last', 'Last point'], ['markers', 'Markers']];

function input(value = '', placeholder = ''): HTMLInputElement {
  const i = el('input', 'fc-fmt-input');
  i.value = value;
  i.placeholder = placeholder;
  i.spellcheck = false;
  i.autocomplete = 'off';
  return i;
}

function select(options: [string, string][], value: string): HTMLSelectElement {
  const s = el('select', 'fc-fmt-input');
  for (const [v, t] of options) {
    const o = el('option', '', t);
    o.value = v;
    s.appendChild(o);
  }
  s.value = value;
  return s;
}

function color(value: string): HTMLInputElement {
  const i = el('input', 'fc-fmt-input');
  i.type = 'color';
  i.value = value;
  return i;
}

function bound(label: string): { row: HTMLElement; mode: HTMLSelectElement; value: HTMLInputElement } {
  const mode = select([['auto', 'Automatic for each sparkline'], ['group', 'Same for all sparklines'], ['custom', 'Custom value']], 'auto');
  const value = input('', 'Value');
  value.hidden = true;
  mode.addEventListener('change', () => {
    value.hidden = mode.value !== 'custom';
  });
  const row = el('div', 'fc-spark-bound');
  row.append(field(label, mode), value);
  return { row, mode, value };
}

export function askSparkline(defaults: { data: string; location: string }): Promise<SparkAnswer | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: SparkAnswer | null) => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(v);
    };
    const modal = makeModal('Create Sparklines', { onClose: () => finish(null) });
    const type = select(KINDS, 'line');
    const data = input(defaults.data, 'A2:E6');
    const loc = input(defaults.location, 'F2:F6');
    const series = color('#376092');
    const neg = color('#d00000');
    const empty = select(EMPTY, 'gap');
    const weight = input('1.5', '1.5');
    weight.inputMode = 'decimal';
    const lo = bound('Minimum value of the vertical axis');
    const hi = bound('Maximum value of the vertical axis');
    const axis = el('input');
    axis.type = 'checkbox';
    const axisLabel = el('label', 'fc-sort-check');
    axisLabel.append(axis, ' Show axis');
    const points = new Map<keyof SparkSpec, HTMLInputElement>();
    const marks = el('div', 'fc-spark-points');
    for (const [k, text] of POINTS) {
      const box = el('input');
      box.type = 'checkbox';
      points.set(k, box);
      const label = el('label', 'fc-sort-check');
      label.append(box, ` ${text}`);
      marks.appendChild(label);
    }
    const hint = el('p', 'fc-fmt-hint');
    hint.setAttribute('role', 'status');
    const ok = () => {
      const d = data.value.trim();
      const l = loc.value.trim();
      if (!d || !l) {
        hint.textContent = 'Type the data range and the cells that will hold the sparklines.';
        return;
      }
      const spec: SparkSpec = { type: type.value as SparkSpec['type'], color: series.value, neg: neg.value, empty: empty.value as SparkSpec['empty'] };
      const w = Number(weight.value);
      if (type.value === 'line' && Number.isFinite(w) && w > 0) spec.weight = w;
      if (axis.checked) spec.axis = true;
      for (const [k, box] of points) if (box.checked) (spec as unknown as Record<string, unknown>)[k] = true;
      for (const [side, b] of [['min', lo], ['max', hi]] as const) {
        if (b.mode.value === 'group') spec[side] = 'group';
        else if (b.mode.value === 'custom' && Number.isFinite(Number(b.value.value)) && b.value.value.trim()) spec[side] = Number(b.value.value);
      }
      finish({ data: d, location: l, spec });
    };
    modal.body.append(
      field('Type', type),
      field('Data range', data),
      field('Location range', loc),
      field('Show empty cells as', empty),
      field('Sparkline colour', series),
      field('Negative point colour', neg),
      field('Line weight', weight),
      marks,
      axisLabel,
      lo.row,
      hi.row,
      hint,
      actions('OK', ok, () => finish(null)),
    );
    modal.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'checkbox') {
        e.preventDefault();
        ok();
      }
    });
    modal.open(data);
  });
}

export function askAlt(title: string, current: string, decorative: boolean): Promise<{ alt: string; decorative: boolean } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: { alt: string; decorative: boolean } | null) => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(v);
    };
    const modal = makeModal('Alt text', { onClose: () => finish(null) });
    const area = el('textarea', 'fc-fmt-input');
    area.rows = 4;
    area.value = current;
    area.setAttribute('aria-label', `Alternative text for ${title}`);
    const mark = el('input');
    mark.type = 'checkbox';
    mark.checked = decorative;
    const markLabel = el('label', 'fc-sort-check');
    markLabel.append(mark, ' Mark as decorative');
    mark.addEventListener('change', () => {
      area.disabled = mark.checked;
    });
    area.disabled = decorative;
    const note = el('p', 'fc-fmt-hint', 'Write one or two sentences that describe the object and its context for someone who cannot see it.');
    modal.body.append(el('p', 'fc-fmt-hint', title), field('Description', area), note, markLabel, actions('Save', () => finish({ alt: area.value.trim(), decorative: mark.checked }), () => finish(null)));
    modal.open(area);
  });
}
