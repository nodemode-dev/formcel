import type { ChipKind } from '../grid/smartchips';

export interface PickedChip {
  kind: ChipKind;
  label: string;
  value: string;
  tip: string;
}

interface Option extends PickedChip {
  note: string;
}

const KIND_LABEL: Record<ChipKind, string> = { person: 'Person', file: 'File', date: 'Date', place: 'Place' };
const ROW_H = 26;
const VISIBLE = 8;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dateOption(d: Date, note: string): Option {
  return {
    kind: 'date',
    label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    value: iso(d),
    tip: d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    note,
  };
}

function fileLabel(q: string): string {
  try {
    if (/^https?:\/\//i.test(q)) {
      const u = new URL(q);
      const last = u.pathname.split('/').filter(Boolean).pop();
      return decodeURIComponent(last ?? u.hostname);
    }
  } catch {
    return q;
  }
  return q.split(/[\\/]/).filter(Boolean).pop() ?? q;
}

export function optionsFor(q: string, people: string[], now = new Date()): Option[] {
  const needle = q.trim().toLowerCase();
  const out: Option[] = [];
  for (const name of people) {
    if (!needle || name.toLowerCase().includes(needle)) out.push({ kind: 'person', label: name, value: EMAIL.test(name) ? name : '', tip: EMAIL.test(name) ? name : '', note: 'Person' });
  }
  if (EMAIL.test(q.trim())) out.push({ kind: 'person', label: q.trim(), value: q.trim(), tip: q.trim(), note: 'Email address' });
  const day = 86400000;
  const days: [string, Date][] = [['today', now], ['tomorrow', new Date(now.getTime() + day)], ['yesterday', new Date(now.getTime() - day)]];
  for (const [name, d] of days) if (!needle || name.startsWith(needle)) out.push(dateOption(d, name[0].toUpperCase() + name.slice(1)));
  const typed = Date.parse(q.trim());
  if (needle && /\d/.test(needle) && !Number.isNaN(typed)) out.push(dateOption(new Date(typed), 'Typed date'));
  if (needle) {
    out.push({ kind: 'file', label: fileLabel(q.trim()), value: q.trim(), tip: q.trim(), note: 'File or link' });
    out.push({ kind: 'place', label: q.trim(), value: q.trim(), tip: q.trim(), note: 'Place' });
  }
  return out;
}

export class ChipPicker {
  private readonly list: HTMLElement;
  private readonly rows: HTMLElement[] = [];
  private matches: Option[] = [];
  private sel = 0;
  private at = -1;

  constructor(private readonly field: HTMLTextAreaElement, private readonly people: () => string[], private readonly put: (chip: PickedChip, at: number, replaced: number) => void) {
    this.list = document.createElement('div');
    this.list.className = 'fc-ac fc-chip-pick';
    this.list.setAttribute('role', 'listbox');
    this.list.hidden = true;
    document.getElementById('overlay-root')!.append(this.list);
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.list.addEventListener('click', (e) => {
      const i = this.rows.indexOf((e.target as HTMLElement).closest('.fc-ac-row') as HTMLElement);
      if (i >= 0) this.choose(i);
    });
    field.addEventListener('input', () => this.update());
    field.addEventListener('keydown', (e) => this.key(e), true);
    field.addEventListener('blur', () => this.hide());
    window.addEventListener('resize', () => this.hide());
  }

  hide(): void {
    this.list.hidden = true;
    this.at = -1;
  }

  private update(): void {
    const v = this.field.value;
    const caret = this.field.selectionStart ?? v.length;
    if (v.startsWith('=')) return this.hide();
    const m = /(^|\s)@([^\n]{0,60})$/.exec(v.slice(0, caret));
    if (!m) return this.hide();
    this.at = caret - m[2].length - 1;
    this.matches = optionsFor(m[2], this.people());
    if (!this.matches.length) return this.hide();
    this.render();
  }

  private render(): void {
    for (let i = this.rows.length; i < this.matches.length; i++) {
      const row = document.createElement('div');
      row.className = 'fc-ac-row';
      row.setAttribute('role', 'option');
      row.innerHTML = '<span class="fc-ac-kind"></span><span class="fc-ac-name"></span><span class="fc-ac-sum"></span>';
      this.list.appendChild(row);
      this.rows.push(row);
    }
    this.rows.forEach((row, i) => {
      const m = this.matches[i];
      row.hidden = !m;
      if (!m) return;
      const [kind, name, sum] = row.children as unknown as HTMLElement[];
      kind.textContent = KIND_LABEL[m.kind];
      name.textContent = m.label;
      sum.textContent = m.note;
    });
    this.sel = 0;
    this.mark();
    const r = this.field.getBoundingClientRect();
    const height = Math.min(this.matches.length, VISIBLE) * ROW_H + 2;
    const below = r.bottom + 2;
    const top = below + height > window.innerHeight - 4 ? Math.max(4, r.top - 2 - height) : below;
    const left = Math.max(4, Math.min(r.left, window.innerWidth - 360));
    this.list.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    this.list.hidden = false;
  }

  private mark(): void {
    this.rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === this.sel)));
    const top = this.sel * ROW_H;
    if (top < this.list.scrollTop) this.list.scrollTop = top;
    else if (top + ROW_H > this.list.scrollTop + VISIBLE * ROW_H) this.list.scrollTop = top + ROW_H - VISIBLE * ROW_H;
  }

  private key(e: KeyboardEvent): void {
    if (this.list.hidden) return;
    const stop = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      stop();
      const n = this.matches.length;
      this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      this.mark();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      stop();
      this.choose(this.sel);
    } else if (e.key === 'Escape') {
      stop();
      this.hide();
    }
  }

  private choose(i: number): void {
    const m = this.matches[i];
    if (!m || this.at < 0) return;
    const v = this.field.value;
    const caret = this.field.selectionStart ?? v.length;
    const head = v.slice(0, this.at);
    const next = head + m.label + v.slice(caret);
    this.put({ kind: m.kind, label: m.label, value: m.value, tip: m.tip }, [...head].length, [...v.slice(this.at, caret)].length);
    this.hide();
    this.field.value = next;
    const end = head.length + m.label.length;
    this.field.setSelectionRange(end, end);
    this.field.dispatchEvent(new Event('input'));
    this.field.focus();
  }
}
