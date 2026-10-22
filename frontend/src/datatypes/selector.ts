import { el, makeModal, type Modal } from '../ui/modal';
import { resolveTexts } from './api';
import type { Candidate, TypeKind } from './model';

export class Selector {
  private readonly modal: Modal;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private kind: TypeKind = 'stock';
  private pick: ((c: Candidate) => void) | null = null;
  private seq = 0;

  constructor() {
    this.modal = makeModal('Data selector');
    const row = el('div', 'fc-dt-row');
    this.input = el('input', 'fc-dt-search');
    this.input.type = 'search';
    this.input.setAttribute('aria-label', 'Search for a company, fund or currency pair');
    const go = el('button', 'fc-btn', 'Search');
    go.type = 'button';
    row.append(this.input, go);
    this.note = el('div', 'fc-dt-note');
    this.note.setAttribute('role', 'status');
    this.list = el('ul', 'fc-dt-matches');
    const close = el('button', 'fc-btn', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => this.modal.close());
    const foot = el('div', 'fc-csv-actions');
    foot.append(close);
    this.modal.body.append(row, this.note, this.list, foot);
    go.addEventListener('click', () => void this.search());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.search();
      }
    });
  }

  open(kind: TypeKind, text: string, pick: (c: Candidate) => void): void {
    this.kind = kind;
    this.pick = pick;
    this.input.value = text;
    this.list.replaceChildren();
    this.note.textContent = 'FormCel could not match this text. Search again or choose a result.';
    this.modal.open(this.input);
    void this.search();
  }

  private async search(): Promise<void> {
    const q = this.input.value.trim();
    if (!q) return;
    const at = ++this.seq;
    this.note.textContent = 'Searching';
    try {
      const r = (await resolveTexts(this.kind, [q], true)).results[0];
      if (at !== this.seq) return;
      this.list.replaceChildren(
        ...r.matches.map((c) => {
          const li = el('li', 'fc-dt-match');
          const text = el('span', 'fc-dt-mtext');
          text.append(el('strong', '', c.name), el('small', '', [c.symbol, c.exchange, c.type].filter(Boolean).join(' · ')));
          const b = el('button', 'fc-btn fc-btn-primary', 'Select');
          b.type = 'button';
          b.addEventListener('click', () => {
            this.modal.close();
            this.pick?.(c);
          });
          li.append(text, b);
          return li;
        }),
      );
      this.note.textContent = r.matches.length ? `${r.matches.length} result${r.matches.length === 1 ? '' : 's'}` : r.note || 'No results.';
    } catch (err) {
      if (at === this.seq) this.note.textContent = err instanceof Error ? err.message : 'The search failed.';
    }
  }
}
