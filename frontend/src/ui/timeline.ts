import type { EngineClient } from '../engine';
import type { Range } from '../grid/a1';
import type { Grid } from '../grid/grid';
import { parseRangeText, readMatrix, rangeLabel } from '../charts/data';
import { PALETTE } from '../charts/types';
import { el, field, makeModal, type Modal } from './modal';

export interface TimelineHooks {
  grid: Grid;
  eng: EngineClient;
  book(): number;
}

type Zoom = 'day' | 'week' | 'month' | 'quarter' | 'year';

const PER_DAY: Record<Zoom, number> = { day: 38, week: 12, month: 4.2, quarter: 1.5, year: 0.42 };
const ZOOMS: [Zoom, string][] = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']];
const CARD_H = 46;
const LANE_GAP = 6;
const GROUP_H = 28;
const AXIS_H = 44;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})/;
const US = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

export function dayOf(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const iso = ISO.exec(t);
  if (iso) return Math.round(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) / 86400000);
  const us = US.exec(t);
  if (us) return Math.round(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])) / 86400000);
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (n >= 20000 && n <= 80000) return Math.floor(n) - 25569;
  }
  return null;
}

function dateText(day: number): string {
  const d = new Date(day * 86400000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

interface Item {
  row: number;
  title: string;
  start: number;
  end: number;
  group: string;
  lane: number;
  el: HTMLButtonElement;
}

export class Timeline {
  private readonly modal: Modal;
  private readonly title = el('select', 'fc-fmt-input');
  private readonly start = el('select', 'fc-fmt-input');
  private readonly end = el('select', 'fc-fmt-input');
  private readonly group = el('select', 'fc-fmt-input');
  private readonly zoom = el('select', 'fc-fmt-input');
  private readonly note = el('p', 'fc-fmt-hint');
  private readonly scroller = el('div', 'fc-tl-scroll');
  private readonly axis = el('div', 'fc-tl-axis');
  private readonly body = el('div', 'fc-tl-body');
  private readonly today = el('div', 'fc-tl-today');
  private readonly source = el('input', 'fc-fmt-input');
  private matrix: string[][] = [];
  private header: string[] = [];
  private area: Range | null = null;
  private items: Item[] = [];
  private labels = new Map<string, HTMLElement>();
  private min = 0;
  private max = 0;
  private sheet = 0;

  constructor(private readonly hooks: TimelineHooks) {
    this.modal = makeModal('Timeline view', { wide: true });
    this.modal.el.classList.add('fc-tl-modal');
    this.scroller.tabIndex = 0;
    this.scroller.setAttribute('role', 'region');
    this.scroller.setAttribute('aria-label', 'Timeline of rows');
    this.body.setAttribute('role', 'list');
    this.scroller.append(this.axis, this.body);
    this.body.appendChild(this.today);
    for (const [v, t] of ZOOMS) this.zoom.add(new Option(t, v));
    this.zoom.value = 'month';
    this.source.spellcheck = false;
    const bar = el('div', 'fc-tl-bar');
    const today = el('button', 'fc-btn', 'Today');
    today.type = 'button';
    today.addEventListener('click', () => this.scrollToToday());
    const load = el('button', 'fc-btn', 'Use range');
    load.type = 'button';
    load.addEventListener('click', () => void this.loadRange(this.source.value));
    const close = el('button', 'fc-btn fc-btn-primary', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => this.modal.close());
    bar.append(field('Range', this.source), load, field('Title', this.title), field('Start date', this.start), field('End date', this.end), field('Group by', this.group), field('Zoom', this.zoom), today, close);
    this.note.setAttribute('role', 'status');
    this.modal.body.append(bar, this.note, this.scroller);
    for (const s of [this.title, this.start, this.end, this.group]) s.addEventListener('change', () => this.build());
    this.zoom.addEventListener('change', () => this.place());
    this.source.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.loadRange(this.source.value);
      }
    });
    this.body.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.fc-tl-card');
      if (!card || !this.area) return;
      this.hooks.grid.select(Number(card.dataset.row), this.area.c0);
      this.modal.close();
      this.hooks.grid.focus();
    });
  }

  async open(): Promise<void> {
    const g = this.hooks.grid;
    this.sheet = g.sheetIndex;
    let s = g.selection();
    if (s.r0 === s.r1 && s.c0 === s.c1) {
      const [r, c] = g.activeCell();
      const { area } = await this.hooks.eng.region(this.hooks.book(), this.sheet, r, c);
      s = { r0: area[0], c0: area[1], r1: area[2], c1: area[3] };
    }
    this.modal.open(this.source);
    await this.load(s);
  }

  private async loadRange(text: string): Promise<void> {
    const ref = parseRangeText(text);
    if (!ref || ref.sheet) {
      this.note.textContent = 'Type a range on this sheet, such as A1:E20.';
      return;
    }
    await this.load(ref.range);
  }

  private async load(r: Range): Promise<void> {
    this.area = r;
    this.source.value = rangeLabel(r);
    this.matrix = await readMatrix(this.hooks.eng, this.hooks.book(), this.sheet, { ...r, r1: Math.min(r.r1, r.r0 + 1999) });
    this.header = (this.matrix[0] ?? []).map((h, i) => h.trim() || `Column ${i + 1}`);
    const cols = this.header.length;
    const rate = (c: number) => {
      const vals = this.matrix.slice(1).map((row) => row[c] ?? '').filter((v) => v.trim());
      return vals.length ? vals.filter((v) => dayOf(v) !== null).length / vals.length : 0;
    };
    const dates = this.header.map((_, c) => c).filter((c) => rate(c) >= 0.7);
    const named = (re: RegExp, pool: number[]) => pool.find((c) => re.test(this.header[c]));
    const start = named(/start|begin|from|^date/i, dates) ?? dates[0];
    const end = named(/end|finish|due|until|^to$/i, dates.filter((c) => c !== start)) ?? dates.find((c) => c !== start);
    const text = this.header.map((_, c) => c).filter((c) => !dates.includes(c));
    const title = named(/title|name|task|event|subject/i, text) ?? text[0] ?? 0;
    for (const [sel, none] of [[this.title, false], [this.start, false], [this.end, true], [this.group, true]] as const) {
      sel.replaceChildren();
      if (none) sel.add(new Option('None', '-1'));
      for (let c = 0; c < cols; c++) sel.add(new Option(this.header[c], String(c)));
    }
    this.title.value = String(title);
    this.start.value = start === undefined ? '0' : String(start);
    this.end.value = end === undefined ? '-1' : String(end);
    const groupCol = text.find((c) => c !== title && /group|team|owner|status|type|category|project/i.test(this.header[c]));
    this.group.value = groupCol === undefined ? '-1' : String(groupCol);
    if (start === undefined) this.note.textContent = 'No column with dates was found. Pick the start date column.';
    this.build();
  }

  private build(): void {
    const t = Number(this.title.value);
    const s = Number(this.start.value);
    const e = Number(this.end.value);
    const g = Number(this.group.value);
    for (const it of this.items) it.el.remove();
    this.items = [];
    const rows = this.matrix.slice(1);
    let skipped = 0;
    rows.forEach((row, i) => {
      const a = dayOf(row[s] ?? '');
      if (a === null) {
        if ((row.join('').trim())) skipped++;
        return;
      }
      const b = e >= 0 ? dayOf(row[e] ?? '') : null;
      const card = el('button', 'fc-tl-card');
      card.type = 'button';
      card.setAttribute('role', 'listitem');
      card.dataset.row = String((this.area?.r0 ?? 0) + 1 + i);
      this.items.push({ row: (this.area?.r0 ?? 0) + 1 + i, title: (row[t] ?? '').trim() || '(untitled)', start: a, end: Math.max(a, b ?? a), group: g >= 0 ? (row[g] ?? '').trim() || '(none)' : '', lane: 0, el: card });
    });
    this.items.sort((x, y) => x.start - y.start || x.end - y.end);
    for (const it of this.items) {
      it.el.replaceChildren(el('span', 'fc-tl-title', it.title), el('span', 'fc-tl-dates', it.end > it.start ? `${dateText(it.start)} to ${dateText(it.end)}` : dateText(it.start)));
      it.el.setAttribute('aria-label', `${it.title}, ${it.end > it.start ? `${dateText(it.start)} to ${dateText(it.end)}` : dateText(it.start)}${it.group ? `, ${it.group}` : ''}`);
      this.body.appendChild(it.el);
    }
    this.min = this.items.length ? Math.min(...this.items.map((i) => i.start)) : 0;
    this.max = this.items.length ? Math.max(...this.items.map((i) => i.end)) : 0;
    this.note.textContent = this.items.length ? `${this.items.length} ${this.items.length === 1 ? 'row' : 'rows'} on the timeline${skipped ? `, ${skipped} without a start date left out` : ''}. Choose a card to go to its row.` : 'No rows with a start date in this range.';
    this.place();
  }

  private place(): void {
    const zoom = this.zoom.value as Zoom;
    const per = PER_DAY[zoom];
    const pad = Math.max(7, Math.round(60 / per));
    const lo = this.min - pad;
    const hi = this.max + pad;
    const width = Math.max(600, Math.ceil((hi - lo + 1) * per));
    const groups = [...new Set(this.items.map((i) => i.group))];
    const ends = new Map<string, number[]>();
    let y = 0;
    const seen = new Set<string>();
    for (const name of groups) {
      let head = this.labels.get(name);
      if (name) {
        if (!head) {
          head = el('div', 'fc-tl-group');
          head.textContent = name;
          head.setAttribute('role', 'presentation');
          this.labels.set(name, head);
          this.body.appendChild(head);
        }
        head.style.transform = `translateY(${y}px)`;
        head.hidden = false;
        seen.add(name);
        y += GROUP_H;
      }
      const lanes: number[] = [];
      ends.set(name, lanes);
      const color = PALETTE[groups.indexOf(name) % PALETTE.length];
      const base = y;
      for (const it of this.items) {
        if (it.group !== name) continue;
        const left = (it.start - lo) * per;
        const w = Math.max(48, (it.end - it.start + 1) * per);
        let lane = lanes.findIndex((end) => end + 4 <= left);
        if (lane < 0) {
          lane = lanes.length;
          lanes.push(0);
        }
        lanes[lane] = left + w;
        it.lane = lane;
        const s = it.el.style;
        s.transform = `translate(${Math.round(left)}px, ${base + lane * (CARD_H + LANE_GAP)}px)`;
        s.width = `${Math.round(w)}px`;
        s.height = `${CARD_H}px`;
        s.setProperty('--tl-color', color);
      }
      y = base + Math.max(1, lanes.length) * (CARD_H + LANE_GAP) + LANE_GAP;
    }
    for (const [name, head] of this.labels) if (!seen.has(name)) head.hidden = true;
    this.body.style.width = `${width}px`;
    this.body.style.height = `${Math.max(y, 120)}px`;
    this.axis.style.width = `${width}px`;
    this.axis.style.height = `${AXIS_H}px`;
    this.ticks(lo, hi, per, zoom);
    const now = Math.floor(Date.now() / 86400000);
    this.today.hidden = now < lo || now > hi;
    this.today.style.transform = `translateX(${Math.round((now - lo) * per)}px)`;
    this.today.setAttribute('aria-hidden', 'true');
    this.origin = lo;
    this.scale = per;
  }

  private origin = 0;
  private scale = 1;

  private ticks(lo: number, hi: number, per: number, zoom: Zoom): void {
    const out: HTMLElement[] = [];
    const add = (day: number, major: string, minor: string) => {
      const t = el('div', 'fc-tl-tick');
      t.style.transform = `translateX(${Math.round((day - lo) * per)}px)`;
      t.append(el('span', 'fc-tl-major', major), el('span', 'fc-tl-minor', minor));
      out.push(t);
    };
    const first = new Date(lo * 86400000);
    if (zoom === 'day' || zoom === 'week') {
      const stepDays = zoom === 'day' ? 1 : 7;
      let d = lo;
      if (zoom === 'week') d += (8 - new Date(lo * 86400000).getUTCDay()) % 7;
      for (; d <= hi; d += stepDays) {
        const t = new Date(d * 86400000);
        add(d, t.getUTCDate() === 1 || d === lo ? `${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}` : '', String(t.getUTCDate()));
      }
    } else {
      let y = first.getUTCFullYear();
      let m = first.getUTCMonth();
      const stepM = zoom === 'month' ? 1 : zoom === 'quarter' ? 3 : 12;
      if (zoom === 'quarter') m -= m % 3;
      if (zoom === 'year') m = 0;
      for (;;) {
        const d = Math.round(Date.UTC(y, m, 1) / 86400000);
        if (d > hi) break;
        add(d, zoom === 'month' ? (m === 0 ? String(y) : '') : zoom === 'quarter' ? `Q${m / 3 + 1}` : String(y), zoom === 'month' ? MONTHS[m] : zoom === 'quarter' ? String(y) : '');
        m += stepM;
        while (m > 11) {
          m -= 12;
          y++;
        }
      }
    }
    this.axis.replaceChildren(...out);
  }

  private scrollToToday(): void {
    const now = Math.floor(Date.now() / 86400000);
    this.scroller.scrollLeft = Math.max(0, (now - this.origin) * this.scale - this.scroller.clientWidth / 2);
  }
}
