import { MAX_COLS, colName } from '../grid/a1';
import { actions, el, makeModal, type Modal } from './modal';

export interface SpellHost {
  area(): Promise<{ cells: [number, number, string][]; label: string }>;
  show(row: number, col: number): void;
  edit(row: number, col: number, raw: string): Promise<void>;
  say(text: string, bad?: boolean): void;
}

interface Issue {
  r: number;
  c: number;
  start: number;
  end: number;
  word: string;
}

const KEY = (r: number, c: number) => r * MAX_COLS + c;

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail ?? 'The spelling service did not answer.');
  return (await r.json()) as T;
}

export class SpellCheck {
  private modal: Modal | null = null;
  private queue: Issue[] = [];
  private text = new Map<number, string>();
  private nodes!: { where: HTMLElement; context: HTMLElement; replace: HTMLInputElement; list: HTMLSelectElement; left: HTMLElement; buttons: HTMLButtonElement[] };
  private serial = 0;

  constructor(private readonly host: SpellHost) {}

  async start(): Promise<void> {
    const { cells, label } = await this.host.area();
    const usable = cells.filter(([, , t]) => t && !t.startsWith('=') && /\p{L}/u.test(t));
    this.text = new Map(usable.map(([r, c, t]) => [KEY(r, c), t]));
    this.host.say(`Checking spelling in ${label}`);
    let found: Issue[];
    try {
      found = (await call<{ issues: Issue[] }>('POST', '/api/spell/check', { cells: usable })).issues;
    } catch (err) {
      this.host.say(err instanceof Error ? err.message : 'Spelling could not be checked.', true);
      return;
    }
    if (!found.length) {
      this.host.say(`Spelling check finished: no misspelled words in ${label}`);
      return;
    }
    this.queue = found;
    this.build();
    this.modal!.open(this.nodes.replace);
    await this.next();
  }

  private build(): void {
    if (this.modal) return;
    const m = (this.modal = makeModal('Spelling'));
    const where = el('div', 'fc-spell-where');
    const context = el('div', 'fc-spell-context');
    context.setAttribute('aria-live', 'polite');
    const replace = el('input', 'fc-fmt-input fc-spell-replace');
    replace.type = 'text';
    replace.spellcheck = false;
    replace.autocomplete = 'off';
    replace.setAttribute('aria-label', 'Change to');
    const list = el('select', 'fc-fmt-input fc-spell-list');
    list.size = 6;
    list.setAttribute('aria-label', 'Suggestions');
    const left = el('div', 'fc-fmt-hint');
    list.addEventListener('change', () => {
      if (list.value) replace.value = list.value;
    });
    list.addEventListener('dblclick', () => void this.change(false));
    const button = (label: string, run: () => void) => {
      const b = el('button', 'fc-btn', label);
      b.type = 'button';
      b.addEventListener('click', run);
      return b;
    };
    const buttons = [
      button('Ignore once', () => void this.ignore(false)),
      button('Ignore all', () => void this.ignore(true)),
      button('Change', () => void this.change(false)),
      button('Change all', () => void this.change(true)),
      button('Add to dictionary', () => void this.addWord()),
    ];
    const grid = el('div', 'fc-spell-actions');
    grid.append(...buttons);
    m.body.append(where, context, el('span', 'fc-fmt-title', 'Change to'), replace, el('span', 'fc-fmt-title', 'Suggestions'), list, grid, left, actions('Close', () => m.close(), () => m.close(), [], ''));
    this.nodes = { where, context, replace, list, left, buttons };
  }

  private async next(): Promise<void> {
    const n = this.nodes;
    const at = ++this.serial;
    const issue = this.queue[0];
    if (!issue) {
      this.modal!.close();
      this.host.say('Spelling check finished');
      return;
    }
    n.where.textContent = `Not in dictionary, cell ${colName(issue.c)}${issue.r + 1}`;
    const raw = this.text.get(KEY(issue.r, issue.c)) ?? '';
    n.context.replaceChildren(document.createTextNode(raw.slice(Math.max(0, issue.start - 40), issue.start)), Object.assign(el('mark', '', raw.slice(issue.start, issue.end))), document.createTextNode(raw.slice(issue.end, issue.end + 40)));
    n.left.textContent = `${this.queue.length} misspelled word${this.queue.length === 1 ? '' : 's'} left`;
    n.replace.value = '';
    n.list.replaceChildren();
    this.host.show(issue.r, issue.c);
    try {
      const got = (await call<{ suggestions: string[] }>('POST', '/api/spell/suggest', { word: issue.word })).suggestions;
      if (at !== this.serial) return;
      n.list.replaceChildren(...got.map((s) => new Option(s, s)));
      if (got.length) {
        n.list.selectedIndex = 0;
        n.replace.value = got[0];
      }
    } catch {
      n.left.textContent += ' (no suggestions available)';
    }
    n.replace.select();
  }

  private async ignore(all: boolean): Promise<void> {
    const issue = this.queue[0];
    if (!issue) return;
    if (all) {
      this.queue = this.queue.filter((q) => q.word.toLowerCase() !== issue.word.toLowerCase());
    } else this.queue.shift();
    await this.next();
  }

  private async addWord(): Promise<void> {
    const issue = this.queue[0];
    if (!issue) return;
    try {
      await call('POST', '/api/spell/dictionary', { word: issue.word });
    } catch (err) {
      this.nodes.left.textContent = err instanceof Error ? err.message : 'The word was not added.';
      return;
    }
    this.queue = this.queue.filter((q) => q.word.toLowerCase() !== issue.word.toLowerCase());
    await this.next();
  }

  private async change(all: boolean): Promise<void> {
    const issue = this.queue[0];
    const to = this.nodes.replace.value;
    if (!issue || !to) return;
    const targets = all ? this.queue.filter((q) => q.word === issue.word) : [issue];
    const done = new Set(targets);
    const byCell = new Map<number, Issue[]>();
    for (const t of targets) {
      const k = KEY(t.r, t.c);
      byCell.set(k, [...(byCell.get(k) ?? []), t]);
    }
    for (const [k, list] of byCell) {
      let raw = this.text.get(k) ?? '';
      for (const t of [...list].sort((a, b) => b.start - a.start)) raw = raw.slice(0, t.start) + to + raw.slice(t.end);
      this.text.set(k, raw);
      await this.host.edit(Math.floor(k / MAX_COLS), k % MAX_COLS, raw);
    }
    const delta = to.length - issue.word.length;
    for (const q of this.queue) {
      if (done.has(q)) continue;
      const k = KEY(q.r, q.c);
      const shift = (byCell.get(k) ?? []).filter((t) => t.start < q.start).length * delta;
      q.start += shift;
      q.end += shift;
    }
    this.queue = this.queue.filter((q) => !done.has(q));
    await this.next();
  }
}
