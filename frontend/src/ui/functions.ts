import type { EngineClient } from '../engine';
import type { Grid } from '../grid/grid';
import { FUNCTIONS, scan, type Suggestion } from './autocomplete';
import { actions, el, makeModal, type Modal } from './modal';

export interface FunctionsHost {
  grid: Grid;
  engine: EngineClient;
  book(): number | null;
  say(text: string, bad?: boolean): void;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

const RECENT = 'fc-recent-functions';
const MOST_RECENT = 'Most recently used';
const ALL = 'All';

function recent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
  } catch {
    return [];
  }
}

function remember(name: string): void {
  try {
    localStorage.setItem(RECENT, JSON.stringify([name, ...recent().filter((n) => n !== name)].slice(0, 10)));
  } catch {
    return;
  }
}

function optional(arg: string): boolean {
  return arg.startsWith('[');
}

function clean(arg: string): string {
  return arg.replace(/^\[\s*/, '').replace(/\s*\]$/, '');
}

export function splitArgs(text: string): string[] {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0) return [];
  const body = text.slice(open + 1, close > open ? close : undefined);
  if (!body.trim()) return [];
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      cur += ch;
      if (ch === '"' && body[i + 1] === '"') cur += body[++i];
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    if (ch === '(' || ch === '{') depth++;
    if (ch === ')' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export class Functions {
  private picker: { m: Modal; q: HTMLInputElement; cat: HTMLSelectElement; list: HTMLElement; sig: HTMLElement; help: HTMLElement; link: HTMLAnchorElement } | null = null;
  private dialog: { m: Modal; title: HTMLElement; rows: HTMLElement; result: HTMLElement; help: HTMLElement; more: HTMLButtonElement; link: HTMLAnchorElement } | null = null;
  private current: Suggestion | null = null;
  private inputs: HTMLInputElement[] = [];
  private values: HTMLElement[] = [];
  private shown: Suggestion[] = [];
  private rows: HTMLElement[] = [];
  private pickedAt = 0;
  private seq = 0;
  private target: Field | null = null;

  constructor(private readonly host: FunctionsHost) {}

  private span: [number, number] | null = null;

  private grab(): void {
    const active = document.activeElement;
    this.target = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
    this.span = null;
  }

  insertFunction(): void {
    this.grab();
    const box = (this.picker ??= this.makePicker());
    box.q.value = '';
    box.cat.value = recent().length ? MOST_RECENT : ALL;
    this.filter();
    box.m.open(box.q);
  }

  argumentsAtCaret(): void {
    this.grab();
    const t = this.target;
    const call = t ? scan(t.value, t.selectionStart ?? t.value.length).call : null;
    const f = call ? FUNCTIONS.find((x) => x.name === call.name) : undefined;
    if (!t || !call || !f) {
      this.insertFunction();
      return;
    }
    let depth = 0;
    let end = t.value.length;
    for (let i = call.open; i < t.value.length; i++) {
      if (t.value[i] === '(') depth++;
      else if (t.value[i] === ')' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    this.span = [call.open - call.name.length, end];
    this.argumentsFor(f, t.value.slice(call.open, end));
  }

  private makePicker() {
    const m = makeModal('Insert Function');
    m.el.classList.add('fc-fn');
    const q = el('input', 'fc-fmt-input');
    q.type = 'search';
    q.placeholder = 'Search for a function by name or by what it does';
    q.setAttribute('aria-label', 'Search for a function');
    q.spellcheck = false;
    const cat = el('select', 'fc-fmt-input');
    cat.setAttribute('aria-label', 'Category');
    const cats = [...new Set(FUNCTIONS.map((f) => f.category ?? 'Other'))].sort();
    for (const c of [MOST_RECENT, ALL, ...cats]) cat.append(new Option(c, c));
    const top = el('div', 'fc-fn-search');
    top.append(q, cat);
    const list = el('div', 'fc-fn-list');
    list.setAttribute('role', 'listbox');
    const sig = el('div', 'fc-fn-sig');
    const help = el('div', 'fc-fn-help');
    const link = el('a', 'fc-fn-link', 'Help on this function');
    link.target = '_blank';
    link.rel = 'noopener';
    m.body.append(top, list, sig, help, link, actions('OK', () => this.accept(), () => m.close()));
    q.addEventListener('input', () => this.filter());
    cat.addEventListener('change', () => this.filter());
    list.addEventListener('click', (e) => {
      const i = Number((e.target as HTMLElement).closest<HTMLElement>('[data-i]')?.dataset.i ?? -1);
      if (i >= 0) this.select(i);
    });
    list.addEventListener('dblclick', () => this.accept());
    q.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (step) {
        e.preventDefault();
        this.select(Math.max(0, Math.min(this.shown.length - 1, this.pickedAt + step)));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.accept();
      }
    });
    return { m, q, cat, list, sig, help, link };
  }

  private filter(): void {
    const box = this.picker!;
    const term = box.q.value.trim().toLowerCase();
    const c = box.cat.value;
    let pool = FUNCTIONS;
    if (c === MOST_RECENT) pool = recent().map((n) => FUNCTIONS.find((f) => f.name === n)).filter((f): f is Suggestion => !!f);
    else if (c !== ALL) pool = FUNCTIONS.filter((f) => (f.category ?? 'Other') === c);
    this.shown = term ? pool.filter((f) => f.name.toLowerCase().includes(term) || f.summary.toLowerCase().includes(term)) : pool;
    if (term) this.shown = [...this.shown].sort((a, b) => Number(!a.name.toLowerCase().startsWith(term)) - Number(!b.name.toLowerCase().startsWith(term)) || a.name.localeCompare(b.name));
    for (let i = this.rows.length; i < this.shown.length; i++) {
      const r = el('div', 'fc-fn-row');
      r.setAttribute('role', 'option');
      r.dataset.i = String(i);
      box.list.append(r);
      this.rows.push(r);
    }
    this.rows.forEach((r, i) => {
      const f = this.shown[i];
      r.hidden = !f;
      if (f && r.textContent !== f.name) r.textContent = f.name;
    });
    this.select(0);
  }

  private select(i: number): void {
    const box = this.picker!;
    this.pickedAt = i;
    this.rows.forEach((r, k) => r.setAttribute('aria-selected', String(k === i)));
    const f = this.shown[i];
    this.rows[i]?.scrollIntoView({ block: 'nearest' });
    box.sig.textContent = f ? `${f.name}(${(f.args ?? []).join(', ')})` : '';
    box.help.textContent = f ? f.summary : 'No function matches that search.';
    box.link.hidden = !f?.help;
    if (f?.help) box.link.href = f.help;
  }

  private accept(): void {
    const f = this.shown[this.pickedAt];
    if (!f) return;
    this.picker!.m.close();
    this.argumentsFor(f, '');
  }

  private argumentsFor(f: Suggestion, existing: string): void {
    remember(f.name);
    this.current = f;
    const box = (this.dialog ??= this.makeArgs());
    box.help.textContent = f.summary;
    box.link.hidden = !f.help;
    if (f.help) box.link.href = f.help;
    this.inputs = [];
    this.values = [];
    box.rows.replaceChildren();
    const given = splitArgs(existing);
    const labels = (f.args ?? []).filter((a) => a !== '...');
    const count = Math.max(labels.length, given.length, 1);
    for (let i = 0; i < count; i++) this.addRow(labels[i] ?? labels[labels.length - 1] ?? `value${i + 1}`, given[i] ?? '');
    box.more.hidden = !(f.args ?? []).includes('...');
    box.m.open(this.inputs[0]);
    void this.refresh();
  }

  private addRow(label: string, value: string): void {
    const box = this.dialog!;
    const row = el('div', 'fc-fn-arg');
    const name = el('span', 'fc-fn-arg-name', clean(label));
    name.dataset.on = String(!optional(label));
    const input = el('input', 'fc-fmt-input');
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.value = value;
    input.setAttribute('aria-label', clean(label));
    const val = el('span', 'fc-fn-val');
    row.append(name, input, val);
    box.rows.append(row);
    this.inputs.push(input);
    this.values.push(val);
    input.addEventListener('input', () => void this.refresh());
    const at = this.inputs.length - 1;
    input.addEventListener('focus', () => {
      box.help.textContent = this.current?.argHelp?.[at] ?? `${clean(label)}${optional(label) ? ' (optional)' : ''}`;
    });
  }

  private makeArgs() {
    const m = makeModal('Function Arguments', { wide: true });
    m.el.classList.add('fc-fn');
    const title = el('div', 'fc-fn-sig');
    const rows = el('div', 'fc-fn-args');
    const help = el('div', 'fc-fn-help');
    const result = el('div', 'fc-fn-result');
    result.setAttribute('aria-live', 'polite');
    const link = el('a', 'fc-fn-link', 'Help on this function');
    link.target = '_blank';
    link.rel = 'noopener';
    const more = el('button', 'fc-btn', 'Add argument');
    more.type = 'button';
    more.addEventListener('click', () => {
      const labels = (this.current?.args ?? []).filter((a) => a !== '...');
      this.addRow(labels[labels.length - 1] ?? 'value', '');
      this.inputs[this.inputs.length - 1].focus();
    });
    m.body.append(title, rows, more, help, result, link, actions('OK', () => this.commit(), () => m.close()));
    m.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
        e.preventDefault();
        this.commit();
      }
    });
    return { m, title, rows, result, help, more, link };
  }

  private formula(): string {
    const f = this.current;
    if (!f) return '';
    const vals = this.inputs.map((i) => i.value.trim());
    while (vals.length && vals[vals.length - 1] === '') vals.pop();
    return `=${f.name}(${vals.join(',')})`;
  }

  private async refresh(): Promise<void> {
    const book = this.host.book();
    const box = this.dialog;
    if (book === null || !box) return;
    const my = ++this.seq;
    const [row, col] = this.host.grid.activeCell();
    const sheet = this.host.grid.sheetIndex;
    const evaluated = await Promise.all(this.inputs.map((i) => (i.value.trim() ? this.host.engine.evalText(book, sheet, row, col, i.value.trim(), true).catch((e: unknown) => (e instanceof Error ? e.message : String(e))) : Promise.resolve(''))));
    const whole = await this.host.engine.evalText(book, sheet, row, col, this.formula()).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    if (my !== this.seq) return;
    evaluated.forEach((v, i) => {
      const t = this.inputs[i].value.trim() ? `= ${v}` : '';
      if (this.values[i].textContent !== t) {
        this.values[i].textContent = t;
        this.values[i].title = t;
      }
    });
    const head = this.formula();
    if (box.title.textContent !== head) box.title.textContent = head;
    box.result.textContent = `Formula result = ${whole}`;
  }

  private commit(): void {
    const text = this.formula();
    this.dialog!.m.close();
    const f = this.target;
    const grid = this.host.grid;
    if (f && document.contains(f) && (f === grid.editor || f.classList.contains('fc-fbar'))) {
      f.focus();
      const v = f.value;
      const [a, b] = this.span ?? (v.startsWith('=') ? [f.selectionStart ?? v.length, f.selectionEnd ?? v.length] : [0, v.length]);
      const piece = v.startsWith('=') ? text.slice(1) : text;
      f.value = v.startsWith('=') ? v.slice(0, a) + piece + v.slice(b) : piece;
      const pos = (v.startsWith('=') ? a : 0) + piece.length;
      f.setSelectionRange(pos, pos);
      f.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    void grid.setActive(text).then(() => grid.focus());
  }
}
