import catalog from '../../../docs/functions.json';

export interface Suggestion {
  name: string;
  kind: 'function' | 'name' | 'table' | 'column';
  summary: string;
  args?: string[];
  table?: string;
}

export interface Structured {
  start: number;
  partial: string;
  table: string | null;
}

export function structuredContext(text: string, caret: number): Structured | null {
  if (!text.startsWith('=')) return null;
  const s = text.slice(0, caret);
  const lb = s.lastIndexOf('[');
  if (lb < 0 || lb < s.lastIndexOf(']')) return null;
  const open = s.slice(0, lb);
  if ((open.match(/"/g)?.length ?? 0) % 2 === 1) return null;
  let depth = 0;
  let table: string | null = null;
  for (let j = lb; j >= 0; j--) {
    const c = s[j];
    if (c === ']') depth++;
    else if (c === '[') {
      if (depth === 0) {
        const m = /([A-Za-z_][A-Za-z0-9_.]*)$/.exec(s.slice(0, j));
        if (m) {
          table = m[1];
          break;
        }
      } else depth--;
    }
  }
  return { start: lb + 1, partial: s.slice(lb + 1), table };
}

const escapeColumn = (name: string) => name.replace(/(['[\]#])/g, "'$1");

interface Scan {
  word: { start: number; text: string } | null;
  call: { name: string; arg: number } | null;
}

const ROW_H = 26;
const VISIBLE = 8;

export const FUNCTIONS: Suggestion[] = catalog.functions.map((f) => ({ name: f.name, kind: 'function', summary: f.summary, args: f.args }));

export function scan(text: string, caret: number): Scan {
  if (!text.startsWith('=')) return { word: null, call: null };
  const s = text.slice(0, caret);
  const stack: { name: string; arg: number }[] = [];
  let inStr = false;
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '"' && s[i + 1] === '"') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return { word: null, call: null };
      i = j;
    } else if (ch === '(' || ch === '{') {
      const m = ch === '(' ? /([A-Za-z_\\][A-Za-z0-9_.]*)\s*$/.exec(s.slice(0, i)) : null;
      stack.push({ name: m ? m[1].toUpperCase() : '', arg: 0 });
    } else if (ch === ')' || ch === '}') stack.pop();
    else if (ch === ',' && stack.length) stack[stack.length - 1].arg++;
  }
  const open = [...stack].reverse().find((c) => c.name) ?? null;
  if (inStr) return { word: null, call: open };
  const m = /(^|[^A-Za-z0-9_.$!:\\'])([A-Za-z_\\][A-Za-z0-9_.]*)$/.exec(s);
  return { word: m ? { start: caret - m[2].length, text: m[2] } : null, call: open };
}

export class Autocomplete {
  private readonly list: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly sig: HTMLElement;
  private readonly sum: HTMLElement;
  private readonly rows: HTMLElement[] = [];
  private readonly args: HTMLElement[] = [];
  private matches: Suggestion[] = [];
  private sel = 0;
  private word: Scan['word'] = null;
  private enabled = true;

  constructor(private readonly field: HTMLInputElement | HTMLTextAreaElement, private readonly items: () => Suggestion[]) {
    const root = document.getElementById('overlay-root')!;
    this.list = document.createElement('div');
    this.list.className = 'fc-ac';
    this.list.setAttribute('role', 'listbox');
    this.list.hidden = true;
    this.tip = document.createElement('div');
    this.tip.className = 'fc-ac-tip';
    this.tip.setAttribute('role', 'tooltip');
    this.tip.hidden = true;
    this.sig = document.createElement('div');
    this.sig.className = 'fc-ac-sig';
    this.sum = document.createElement('div');
    this.sum.className = 'fc-ac-tipsum';
    this.tip.append(this.sig, this.sum);
    root.append(this.list, this.tip);
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.list.addEventListener('dblclick', (e) => {
      const i = this.rows.indexOf((e.target as HTMLElement).closest('.fc-ac-row') as HTMLElement);
      if (i >= 0) this.insert(i);
    });
    this.list.addEventListener('click', (e) => {
      const i = this.rows.indexOf((e.target as HTMLElement).closest('.fc-ac-row') as HTMLElement);
      if (i >= 0) this.choose(i);
    });
    const el: HTMLElement = field;
    el.addEventListener('input', () => this.update());
    el.addEventListener('click', () => this.update());
    el.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || (this.list.hidden && (e.key === 'Home' || e.key === 'End'))) this.update();
    });
    el.addEventListener('keydown', (e) => this.key(e), true);
    el.addEventListener('blur', () => this.hide());
    window.addEventListener('resize', () => this.hide());
  }

  hide(): void {
    this.list.hidden = true;
    this.tip.hidden = true;
    this.word = null;
  }

  private update(): void {
    const caret = this.field.selectionStart ?? this.field.value.length;
    const sc = scan(this.field.value, caret);
    const all = this.items();
    const st = this.enabled ? structuredContext(this.field.value, caret) : null;
    if (st) {
      const want = st.partial.replace(/^\[|^@/, '').toUpperCase();
      this.matches = all.filter((it) => it.kind === 'column' && (!st.table || it.table?.toUpperCase() === st.table.toUpperCase()) && it.name.toUpperCase().startsWith(want));
      this.matches.sort((a, b) => a.name.localeCompare(b.name));
      this.word = this.matches.length ? { start: st.start + (st.partial.length - want.length), text: want } : null;
      if (this.matches.length) {
        this.renderList();
        this.tip.hidden = true;
      } else this.list.hidden = true;
      return;
    }
    const w = sc.word;
    this.matches = this.enabled && w ? all.filter((it) => it.kind !== 'column' && it.name.toUpperCase().startsWith(w.text.toUpperCase())) : [];
    this.matches.sort((a, b) => a.name.localeCompare(b.name));
    this.word = this.matches.length ? w : null;
    if (this.matches.length) {
      this.renderList();
      this.tip.hidden = true;
      return;
    }
    this.list.hidden = true;
    const fn = sc.call && this.enabled ? all.find((it) => it.kind === 'function' && it.name === sc.call!.name) : undefined;
    if (fn && sc.call) this.renderTip(fn, sc.call.arg);
    else this.tip.hidden = true;
  }

  private place(el: HTMLElement, height: number): void {
    const r = this.field.getBoundingClientRect();
    const below = r.bottom + 2;
    const top = below + height > window.innerHeight - 4 ? Math.max(4, r.top - 2 - height) : below;
    const left = Math.max(4, Math.min(r.left, window.innerWidth - 360));
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  private renderList(): void {
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
      if (!m) {
        row.hidden = true;
        return;
      }
      row.hidden = false;
      const [kind, name, sum] = row.children as unknown as HTMLElement[];
      const k = m.kind === 'function' ? 'fx' : m.kind === 'column' ? 'col' : m.kind === 'table' ? 'table' : 'name';
      if (kind.textContent !== k) kind.textContent = k;
      if (name.textContent !== m.name) name.textContent = m.name;
      if (sum.textContent !== m.summary) sum.textContent = m.summary;
    });
    this.sel = 0;
    this.mark();
    this.place(this.list, Math.min(this.matches.length, VISIBLE) * ROW_H + 2);
    this.list.hidden = false;
  }

  private mark(): void {
    this.rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === this.sel)));
    const top = this.sel * ROW_H;
    if (top < this.list.scrollTop) this.list.scrollTop = top;
    else if (top + ROW_H > this.list.scrollTop + VISIBLE * ROW_H) this.list.scrollTop = top + ROW_H - VISIBLE * ROW_H;
  }

  private renderTip(fn: Suggestion, arg: number): void {
    const args = fn.args ?? [];
    const last = args.length - 1;
    const at = arg <= last ? arg : args[last] === '...' ? last - 1 : last;
    const parts: [string, number][] = [[`${fn.name}(`, -1]];
    args.forEach((a, i) => {
      parts.push([a, i]);
      if (i < last) parts.push([', ', -1]);
    });
    parts.push([')', -1]);
    for (let i = this.args.length; i < parts.length; i++) {
      const s = document.createElement('span');
      this.sig.appendChild(s);
      this.args.push(s);
    }
    this.args.forEach((s, i) => {
      s.hidden = i >= parts.length;
      if (i >= parts.length) return;
      if (s.textContent !== parts[i][0]) s.textContent = parts[i][0];
      s.classList.toggle('is-current', parts[i][1] === at);
    });
    if (this.sum.textContent !== fn.summary) this.sum.textContent = fn.summary;
    this.place(this.tip, 52);
    this.tip.hidden = false;
  }

  private choose(i: number): void {
    this.sel = i;
    this.mark();
  }

  private insert(i: number): void {
    const m = this.matches[i];
    const w = this.word;
    if (!m || !w) return;
    const v = this.field.value;
    const caret = this.field.selectionStart ?? v.length;
    const add = m.kind === 'column' ? escapeColumn(m.name) + (v[caret] === ']' ? '' : ']') : m.name + (m.kind === 'function' && v[caret] !== '(' ? '(' : m.kind === 'table' && v[caret] !== '[' ? '[' : '');
    this.field.value = v.slice(0, w.start) + add + v.slice(caret);
    const pos = w.start + add.length;
    this.field.setSelectionRange(pos, pos);
    this.field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  take(e: KeyboardEvent): boolean {
    if (e.key === 'ArrowDown' && e.altKey) {
      this.enabled = !this.enabled;
      if (this.enabled) this.update();
      else this.hide();
      return true;
    }
    if (this.list.hidden) return false;
    const n = this.matches.length;
    const page = VISIBLE - 1;
    const moves: Record<string, number> = { ArrowDown: this.sel + 1, ArrowUp: this.sel - 1, Home: 0, End: n - 1, PageDown: this.sel + page, PageUp: this.sel - page };
    if (e.key in moves) this.choose(Math.max(0, Math.min(n - 1, moves[e.key])));
    else if (e.key === 'Tab' && !e.shiftKey) this.insert(this.sel);
    else if (e.key === 'Escape') this.hide();
    else return false;
    return true;
  }

  private key(e: KeyboardEvent): void {
    if (!this.take(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}
