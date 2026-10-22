import { el, setText } from '../automation/dom';

export interface Row<T> {
  el: HTMLElement;
  set(v: T): void;
  disable?(off: boolean): void;
}

const TRACK = '<span class="fc-toggle-track"><span class="fc-toggle-knob"></span></span>';

function q<T extends Element>(root: Element, sel: string): T {
  return root.querySelector<T>(sel)!;
}

export function selectRow(label: string, options: ReadonlyArray<readonly [string, string]>, onChange: (v: string) => void): Row<string> {
  const root = el('label', 'fc-field');
  root.innerHTML = '<span></span><select class="fc-input"></select>';
  setText(q(root, 'span'), label);
  const sel = q<HTMLSelectElement>(root, 'select');
  for (const [v, t] of options) sel.add(new Option(t, v));
  sel.addEventListener('change', () => onChange(sel.value));
  return {
    el: root,
    set(v) {
      if (sel.value !== v) sel.value = v;
    },
    disable(off) {
      sel.disabled = off;
    },
  };
}

export function checkRow(label: string, onChange: (v: boolean) => void): Row<boolean> {
  const root = el('label', 'fc-field fc-check');
  root.innerHTML = '<span></span><input type="checkbox">';
  setText(q(root, 'span'), label);
  const box = q<HTMLInputElement>(root, 'input');
  box.addEventListener('change', () => onChange(box.checked));
  return {
    el: root,
    set(v) {
      if (box.checked !== v) box.checked = v;
    },
    disable(off) {
      box.disabled = off;
    },
  };
}

export function toggleRow(label: string, onChange: (v: boolean) => void): Row<boolean> {
  const root = el('label', 'fc-field fc-toggle-row');
  root.innerHTML = `<span></span><span class="fc-toggle"><input type="checkbox">${TRACK}</span>`;
  setText(q(root, 'span'), label);
  const box = q<HTMLInputElement>(root, 'input');
  box.addEventListener('change', () => onChange(box.checked));
  return {
    el: root,
    set(v) {
      if (box.checked !== v) box.checked = v;
    },
    disable(off) {
      box.disabled = off;
      root.classList.toggle('is-off', off);
    },
  };
}

export function colorRow(label: string, onChange: (hex: string) => void, reset?: string): Row<string> {
  const root = el('label', 'fc-field fc-colorrow');
  root.innerHTML = '<span></span><span class="fc-colorctl"><input class="fc-input fc-color" type="color"></span>';
  setText(q(root, 'span'), label);
  const inp = q<HTMLInputElement>(root, 'input');
  inp.addEventListener('input', () => onChange(inp.value));
  if (reset !== undefined) {
    const b = el('button', 'fc-btn fc-btn-ghost', 'Default');
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      onChange('');
    });
    q(root, '.fc-colorctl').appendChild(b);
  }
  return {
    el: root,
    set(v) {
      const want = v || reset || '#000000';
      if (inp.value !== want) inp.value = want;
    },
  };
}

export function numberRow(label: string, min: number, max: number, step: number, onChange: (v: number) => void): Row<number> & { input: HTMLInputElement } {
  const root = el('label', 'fc-field');
  root.innerHTML = `<span></span><input class="fc-input" type="number" min="${min}" max="${max}" step="${step}">`;
  setText(q(root, 'span'), label);
  const input = q<HTMLInputElement>(root, 'input');
  input.addEventListener('change', () => {
    const v = input.valueAsNumber;
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
  });
  return {
    el: root,
    input,
    set(v) {
      const t = String(Number(v.toFixed(4)));
      if (input.value !== t && document.activeElement !== input) input.value = t;
    },
    disable(off) {
      input.disabled = off;
    },
  };
}

export function textRow(label: string, onChange: (v: string) => void, opts: { type?: string; placeholder?: string } = {}): Row<string> & { input: HTMLInputElement } {
  const root = el('label', 'fc-field');
  root.innerHTML = '<span></span><input class="fc-input" spellcheck="false" autocomplete="off">';
  setText(q(root, 'span'), label);
  const input = q<HTMLInputElement>(root, 'input');
  if (opts.type) input.type = opts.type;
  if (opts.type === 'password') input.autocomplete = 'new-password';
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.addEventListener('change', () => onChange(input.value));
  return {
    el: root,
    input,
    set(v) {
      if (input.value !== v && document.activeElement !== input) input.value = v;
    },
    disable(off) {
      input.disabled = off;
    },
  };
}

export function buttonRow(label: string, button: string, run: () => void, kind: '' | 'danger' | 'primary' = ''): { el: HTMLElement; button: HTMLButtonElement } {
  const root = el('div', 'fc-field fc-buttonrow');
  root.innerHTML = `<span></span><button type="button" class="fc-btn${kind ? ` fc-btn-${kind}` : ''}"></button>`;
  setText(q(root, 'span'), label);
  const b = q<HTMLButtonElement>(root, 'button');
  setText(b, button);
  b.addEventListener('click', run);
  return { el: root, button: b };
}

export function note(text: string, live = false): HTMLElement {
  const p = el('p', 'fc-note');
  p.textContent = text;
  if (live) p.setAttribute('role', 'status');
  return p;
}
