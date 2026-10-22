import { actions, el, field, makeModal } from '../ui/modal';
import { attachFontInput } from '../ui/fontpicker';
import { DASH_LABELS, SHAPES, SHAPE_GROUPS, gallery, isLine, thumb, canon, type Variant } from './shapes';
import type { Dash, ShapeSpec } from './types';

let popover: HTMLElement | null = null;
let closer: ((e: Event) => void) | null = null;

function ensure(pick: (v: Variant) => void): HTMLElement {
  if (popover) return popover;
  const root = el('div', 'fc-shape-gallery');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Shapes');
  const all = gallery();
  for (const g of SHAPE_GROUPS) {
    const head = el('div', 'fc-shape-group', g);
    const row = el('div', 'fc-shape-row');
    for (const v of all.filter((x) => x.group === g)) {
      const b = el('button', 'fc-shape-item');
      b.type = 'button';
      b.title = v.label;
      b.setAttribute('aria-label', v.label);
      b.dataset.key = v.key;
      b.innerHTML = thumb(v);
      row.appendChild(b);
    }
    root.append(head, row);
  }
  root.addEventListener('click', (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('.fc-shape-item')?.dataset.key;
    const v = all.find((x) => x.key === key);
    if (v) pick(v);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideGallery();
  });
  document.getElementById('overlay-root')!.appendChild(root);
  popover = root;
  return root;
}

export function hideGallery(): void {
  if (popover) popover.hidden = true;
  if (closer) {
    document.removeEventListener('pointerdown', closer, true);
    document.removeEventListener('keydown', closer, true);
  }
  closer = null;
}

export function showGallery(at: { x: number; y: number }, pick: (v: Variant) => void): void {
  const root = ensure((v) => {
    hideGallery();
    pick(v);
  });
  if (!root.hidden) {
    hideGallery();
    return;
  }
  root.hidden = false;
  const r = root.getBoundingClientRect();
  root.style.left = `${Math.max(4, Math.min(at.x, window.innerWidth - r.width - 4))}px`;
  root.style.top = `${Math.max(4, Math.min(at.y, window.innerHeight - r.height - 4))}px`;
  closer = (e) => {
    if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.contains(e.target as Node)) hideGallery();
  };
  document.addEventListener('pointerdown', closer, true);
  document.addEventListener('keydown', closer, true);
  root.querySelector<HTMLElement>('.fc-shape-item')?.focus();
}

function colorInput(value: string): HTMLInputElement {
  const i = el('input', 'fc-fmt-input');
  i.type = 'color';
  i.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#4e79a7';
  return i;
}

function numberInput(value: number, min: number, max: number, step: number): HTMLInputElement {
  const i = el('input', 'fc-fmt-input');
  i.type = 'number';
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.value = String(value);
  return i;
}

function check(label: string, on: boolean): { box: HTMLInputElement; row: HTMLLabelElement } {
  const box = el('input');
  box.type = 'checkbox';
  box.checked = on;
  const row = el('label', 'fc-sort-check');
  row.append(box, ` ${label}`);
  return { box, row };
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

export function formatShape(start: ShapeSpec, apply: (s: ShapeSpec) => void): Promise<ShapeSpec | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: ShapeSpec | null) => {
      if (settled) return;
      settled = true;
      modal.close();
      modal.el.remove();
      if (!v) apply(start);
      resolve(v);
    };
    const modal = makeModal('Format shape', { onClose: () => finish(null) });
    const kind = select(SHAPES.map((s) => [s.id, s.label] as [string, string]), canon(start.shape));
    const noFill = check('No fill', !!start.noFill);
    const fill = colorInput(start.fill);
    const opacity = numberInput(Math.round((start.opacity ?? 1) * 100), 0, 100, 5);
    const noLine = check('No line', !!start.noLine);
    const stroke = colorInput(start.stroke);
    const width = numberInput(start.lw ?? 1, 0, 100, 0.25);
    const dash = select(DASH_LABELS, start.dash ?? 'solid');
    const head = check('Arrow at the start', !!start.head);
    const tail = check('Arrow at the end', !!start.tail);
    const rot = numberInput(start.rot ?? 0, 0, 359, 1);
    const flipH = check('Flip horizontally', !!start.flipH);
    const flipV = check('Flip vertically', !!start.flipV);
    const font = el('input', 'fc-fmt-input');
    font.value = start.font ?? '';
    font.placeholder = 'Default';
    font.spellcheck = false;
    attachFontInput(font, 'Default', { theme: () => ({ heading: 'Aptos Narrow', body: 'Aptos Narrow' }), used: () => [] });
    const size = numberInput(start.size ?? 11, 1, 400, 1);
    const color = colorInput(start.color || '#000000');
    const autoColor = check('Automatic text colour', !start.color);
    const bold = check('Bold', !!start.bold);
    const italic = check('Italic', !!start.italic);
    const underline = check('Underline', !!start.underline);
    const strike = check('Strikethrough', !!start.strike);
    const align = select([['l', 'Left'], ['ctr', 'Center'], ['r', 'Right'], ['j', 'Justified']], start.align ?? 'ctr');
    const valign = select([['t', 'Top'], ['ctr', 'Middle'], ['b', 'Bottom']], start.valign ?? 'ctr');
    const text = el('textarea', 'fc-fmt-input');
    text.rows = 3;
    text.value = start.text;

    const read = (): ShapeSpec => {
      const next: ShapeSpec = { ...start, shape: kind.value, fill: fill.value, stroke: stroke.value, text: text.value };
      const set = <K extends keyof ShapeSpec>(k: K, v: ShapeSpec[K] | undefined | false) => {
        if (v === undefined || v === false || v === '') delete next[k];
        else next[k] = v as ShapeSpec[K];
      };
      set('noFill', noFill.box.checked);
      set('noLine', noLine.box.checked);
      const o = Number(opacity.value);
      set('opacity', Number.isFinite(o) && o < 100 ? Math.max(0, o) / 100 : undefined);
      const lw = Number(width.value);
      set('lw', Number.isFinite(lw) && lw !== 1 ? Math.max(0, Math.min(100, lw)) : undefined);
      set('dash', dash.value === 'solid' ? undefined : (dash.value as Dash));
      set('head', head.box.checked);
      set('tail', tail.box.checked);
      const rv = Number(rot.value);
      set('rot', Number.isFinite(rv) && rv % 360 !== 0 ? ((rv % 360) + 360) % 360 : undefined);
      set('flipH', flipH.box.checked);
      set('flipV', flipV.box.checked);
      set('font', font.value.trim());
      const sz = Number(size.value);
      set('size', Number.isFinite(sz) && sz !== 11 && sz > 0 ? sz : undefined);
      set('color', autoColor.box.checked ? undefined : color.value);
      set('bold', bold.box.checked);
      set('italic', italic.box.checked);
      set('underline', underline.box.checked);
      set('strike', strike.box.checked);
      set('align', align.value === 'ctr' ? undefined : (align.value as ShapeSpec['align']));
      set('valign', valign.value === 'ctr' ? undefined : (valign.value as ShapeSpec['valign']));
      return next;
    };
    const sync = () => {
      fill.disabled = noFill.box.checked || isLine(kind.value);
      opacity.disabled = fill.disabled;
      noFill.box.disabled = isLine(kind.value);
      stroke.disabled = noLine.box.checked;
      width.disabled = noLine.box.checked;
      dash.disabled = noLine.box.checked;
      head.row.hidden = !isLine(kind.value);
      tail.row.hidden = !isLine(kind.value);
      color.disabled = autoColor.box.checked;
      apply(read());
    };
    modal.body.addEventListener('input', sync);
    modal.body.addEventListener('change', sync);
    const fills = el('div', 'fc-shape-form');
    fills.append(field('Shape', kind), noFill.row, field('Fill colour', fill), field('Fill opacity (percent)', opacity));
    const lines = el('div', 'fc-shape-form');
    lines.append(noLine.row, field('Line colour', stroke), field('Line width (points)', width), field('Dash type', dash), head.row, tail.row);
    const xf = el('div', 'fc-shape-form');
    xf.append(field('Rotation (degrees)', rot), flipH.row, flipV.row);
    const tx = el('div', 'fc-shape-form');
    tx.append(field('Text', text), field('Font', font), field('Font size (points)', size), autoColor.row, field('Text colour', color), bold.row, italic.row, underline.row, strike.row, field('Horizontal alignment', align), field('Vertical alignment', valign));
    modal.body.append(fills, lines, xf, tx, actions('OK', () => finish(read()), () => finish(null)));
    sync();
    modal.open(kind);
  });
}
