import catalog from '../../../docs/functions.json';

export interface Suggestion {
  name: string;
  kind: 'function' | 'name' | 'table' | 'column' | 'item' | 'value';
  summary: string;
  args?: string[];
  help?: string;
  category?: string;
  insert?: string;
  table?: string;
}

export interface TableHint {
  name: string;
  cols: string[];
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
  call: { name: string; arg: number; open: number } | null;
}

const KIND_LABEL: Record<Suggestion['kind'], string> = { function: 'fx', name: 'name', table: 'tbl', column: 'col', item: 'item', value: 'val' };

const ITEMS = ['#All', '#Data', '#Headers', '#Totals', '#This Row'];

const ENUMS: Record<string, Record<number, [string, string][]>> = {
  MATCH: { 2: [['1', 'Largest value less than or equal to the lookup value (sorted ascending)'], ['0', 'First value equal to the lookup value'], ['-1', 'Smallest value greater than or equal to the lookup value (sorted descending)']] },
  XMATCH: { 2: [['0', 'Exact match'], ['-1', 'Exact match or next smaller item'], ['1', 'Exact match or next larger item'], ['2', 'Wildcard match'], ['3', 'Regular expression match']], 3: [['1', 'Search first to last'], ['-1', 'Search last to first'], ['2', 'Binary search, ascending'], ['-2', 'Binary search, descending']] },
  XLOOKUP: { 4: [['0', 'Exact match'], ['-1', 'Exact match or next smaller item'], ['1', 'Exact match or next larger item'], ['2', 'Wildcard match'], ['3', 'Regular expression match']], 5: [['1', 'Search first to last'], ['-1', 'Search last to first'], ['2', 'Binary search, ascending'], ['-2', 'Binary search, descending']] },
  VLOOKUP: { 3: [['TRUE', 'Approximate match (sorted ascending)'], ['FALSE', 'Exact match']] },
  HLOOKUP: { 3: [['TRUE', 'Approximate match (sorted ascending)'], ['FALSE', 'Exact match']] },
  SORT: { 2: [['1', 'Ascending'], ['-1', 'Descending']], 3: [['FALSE', 'Sort by rows'], ['TRUE', 'Sort by columns']] },
  RANK: { 2: [['0', 'Descending'], ['1', 'Ascending']] },
  'RANK.EQ': { 2: [['0', 'Descending'], ['1', 'Ascending']] },
  'RANK.AVG': { 2: [['0', 'Descending'], ['1', 'Ascending']] },
  WEEKDAY: { 1: [['1', 'Sunday is 1, Saturday is 7'], ['2', 'Monday is 1, Sunday is 7'], ['3', 'Monday is 0, Sunday is 6']] },
  SUBTOTAL: { 0: [['1', 'AVERAGE'], ['2', 'COUNT'], ['3', 'COUNTA'], ['4', 'MAX'], ['5', 'MIN'], ['6', 'PRODUCT'], ['7', 'STDEV'], ['8', 'STDEVP'], ['9', 'SUM'], ['10', 'VAR'], ['11', 'VARP'], ['101', 'AVERAGE, ignoring hidden rows'], ['102', 'COUNT, ignoring hidden rows'], ['103', 'COUNTA, ignoring hidden rows'], ['104', 'MAX, ignoring hidden rows'], ['105', 'MIN, ignoring hidden rows'], ['106', 'PRODUCT, ignoring hidden rows'], ['107', 'STDEV, ignoring hidden rows'], ['108', 'STDEVP, ignoring hidden rows'], ['109', 'SUM, ignoring hidden rows'], ['110', 'VAR, ignoring hidden rows'], ['111', 'VARP, ignoring hidden rows']] },
  CELL: { 0: ['address', 'col', 'color', 'contents', 'filename', 'format', 'parentheses', 'prefix', 'protect', 'row', 'type', 'width'].map((t): [string, string] => [`"${t}"`, `Information about the cell: ${t}`]) },
  INFO: { 0: ['directory', 'numfile', 'origin', 'osversion', 'recalc', 'release', 'system'].map((t): [string, string] => [`"${t}"`, `Information about the environment: ${t}`]) },
  TEXTJOIN: { 1: [['TRUE', 'Skip empty cells'], ['FALSE', 'Include empty cells']] },
  DAYS360: { 2: [['FALSE', 'US method'], ['TRUE', 'European method']] },
  REGEXEXTRACT: { 2: [['0', 'First match'], ['1', 'All matches'], ['2', 'Capturing groups of the first match']], 3: [['0', 'Case sensitive'], ['1', 'Case insensitive']] },
  REGEXREPLACE: { 4: [['0', 'Case sensitive'], ['1', 'Case insensitive']] },
  REGEXTEST: { 2: [['0', 'Case sensitive'], ['1', 'Case insensitive']] },
  UNIQUE: { 1: [['FALSE', 'Compare rows'], ['TRUE', 'Compare columns']], 2: [['FALSE', 'All distinct items'], ['TRUE', 'Items that occur once']] },
  AGGREGATE: { 1: [['0', 'Ignore nothing'], ['1', 'Ignore hidden rows'], ['2', 'Ignore error values'], ['3', 'Ignore hidden rows and error values'], ['4', 'Ignore nothing'], ['5', 'Ignore hidden rows'], ['6', 'Ignore error values'], ['7', 'Ignore hidden rows and error values']] },
};

export function argSpan(text: string, open: number, index: number): [number, number] {
  let depth = 0;
  let inStr = false;
  let k = 0;
  let start = open + 1;
  for (let i = open + 1; i <= text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '"' && text[i + 1] === '"') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '(' || ch === '{') depth++;
    else if ((ch === ')' || ch === '}') && depth > 0) depth--;
    else if (ch === undefined || ((ch === ')' || ch === ',') && depth === 0)) {
      if (k === index) return [start, i];
      if (ch === ')' || ch === undefined) break;
      k++;
      start = i + 1;
    }
  }
  return [text.length, text.length];
}

export function structured(s: string): { table: string; partial: string } | null {
  let depth = 0;
  let inner = -1;
  let outer = -1;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ']') depth++;
    else if (s[i] === '[') {
      if (depth === 0) {
        if (inner < 0) inner = i;
        else {
          outer = i;
          break;
        }
      } else depth--;
    }
  }
  if (inner < 0) return null;
  const head = s.slice(0, outer < 0 ? inner : outer);
  const m = /([A-Za-z_\\][A-Za-z0-9_.]*)$/.exec(head);
  const partial = s.slice(inner + 1);
  if (/[\[\]]/.test(partial)) return null;
  return { table: m ? m[1] : '', partial };
}

const ROW_H = 26;
const VISIBLE = 8;

export const FUNCTIONS: Suggestion[] = catalog.functions.map((f) => ({
  name: f.name,
  kind: 'function',
  summary: f.summary,
  args: f.args,
  help: f.excel?.source ?? f.sheets?.source ?? undefined,
  category: f.category ?? f.sheets?.category ?? 'Other',
}));

export function scan(text: string, caret: number): Scan {
  if (!text.startsWith('=')) return { word: null, call: null };
  const s = text.slice(0, caret);
  const stack: { name: string; arg: number; open: number }[] = [];
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
      stack.push({ name: m ? m[1].toUpperCase() : '', arg: 0, open: i });
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
  private callAt: { fn: Suggestion; open: number } | null = null;

  constructor(private readonly field: HTMLInputElement | HTMLTextAreaElement, private readonly items: () => Suggestion[], private readonly tables: () => TableHint[] = () => []) {
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
    this.tip.addEventListener('mousedown', (e) => e.preventDefault());
    this.tip.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const at = this.callAt;
      if (!at) return;
      if (t.dataset.fn && at.fn.help) window.open(at.fn.help, '_blank', 'noopener');
      else if (t.dataset.arg !== undefined) {
        const [s, end] = argSpan(this.field.value, at.open, Number(t.dataset.arg));
        this.field.focus();
        this.field.setSelectionRange(s, end);
      }
    });
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
    const w = sc.word;
    const fn = sc.call && this.enabled ? all.find((it) => it.kind === 'function' && it.name.toUpperCase() === sc.call!.name) : undefined;
    const text = this.field.value;
    const st = this.enabled && text.startsWith('=') ? structured(text.slice(0, caret)) : null;
    let found: Suggestion[] = [];
    let word = w;
    if (st) {
      found = this.structuredMatches(st);
      const skip = st.partial.startsWith('@') ? 1 : 0;
      word = { start: caret - st.partial.length + skip, text: st.partial.slice(skip) };
    } else if (this.enabled && w) found = all.filter((it) => it.name.toUpperCase().startsWith(w.text.toUpperCase()));
    if (!found.length && this.enabled && sc.call) {
      const options = ENUMS[sc.call.name]?.[sc.call.arg];
      if (options) {
        const [s] = argSpan(text, sc.call.open, sc.call.arg);
        const seg = text.slice(s, caret);
        const typed = seg.trim().toUpperCase();
        found = options.filter(([v]) => v.toUpperCase().startsWith(typed)).map(([v, d]): Suggestion => ({ name: v, kind: 'value', summary: d }));
        word = { start: s + (seg.length - seg.trimStart().length), text: seg.trim() };
      }
    }
    this.matches = found;
    if (!st) this.matches.sort((a, b) => (a.kind === 'value' ? 0 : a.name.localeCompare(b.name)));
    this.word = this.matches.length ? word : null;
    if (fn && sc.call) this.callAt = { fn, open: sc.call.open };
    if (this.matches.length) {
      this.renderList();
      if (fn && sc.call && this.matches[0].kind === 'value') this.renderTip(fn, sc.call.arg, true);
      else this.tip.hidden = true;
      return;
    }
    this.list.hidden = true;
    if (fn && sc.call) this.renderTip(fn, sc.call.arg, false);
    else this.tip.hidden = true;
  }

  private structuredMatches(st: { table: string; partial: string }): Suggestion[] {
    const p = st.partial.replace(/^[@#]/, '').toLowerCase();
    const known = this.tables().find((t) => t.name.toLowerCase() === st.table.toLowerCase());
    if (!known) return [];
    const items = ITEMS.filter((i) => i.slice(1).toLowerCase().startsWith(p) || st.partial === '').map((i): Suggestion => ({ name: i, kind: 'item', summary: `${known.name} items` }));
    const cols = known.cols.filter((c) => c.toLowerCase().startsWith(p)).map((c): Suggestion => ({ name: c, kind: 'column', summary: `Column of ${known.name}` }));
    return st.partial.startsWith('#') ? items : [...cols, ...items];
  }

  private place(el: HTMLElement, height: number, above = false): void {
    const r = this.field.getBoundingClientRect();
    const below = r.bottom + 2;
    const top = above ? Math.max(4, r.top - 2 - height) : below + height > window.innerHeight - 4 ? Math.max(4, r.top - 2 - height) : below;
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
      const k = KIND_LABEL[m.kind];
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

  private renderTip(fn: Suggestion, arg: number, above: boolean): void {
    const args = fn.args ?? [];
    const last = args.length - 1;
    const at = arg <= last ? arg : args[last] === '...' ? last - 1 : last;
    const parts: [string, number][] = [[fn.name, -2], ['(', -1]];
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
      s.classList.toggle('fc-ac-link', parts[i][1] !== -1 && (parts[i][1] >= 0 || !!fn.help));
      if (parts[i][1] === -2) s.dataset.fn = '1';
      else delete s.dataset.fn;
      if (parts[i][1] >= 0) s.dataset.arg = String(parts[i][1]);
      else delete s.dataset.arg;
    });
    if (this.sum.textContent !== fn.summary) this.sum.textContent = fn.summary;
    this.place(this.tip, 52, above);
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
