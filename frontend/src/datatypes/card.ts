import { icon } from '../ui/icons';
import { PROVIDER_LABEL, showValue, type TypedField, type TypedRecord, type TypeKind } from './model';

export interface CardActions {
  extract(field: string): void;
  refresh(): void;
  settings(): void;
  insert(anchor: DOMRect): void;
  close(): void;
}

function find(rec: TypedRecord, name: string): TypedField | undefined {
  return rec.fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
}

function text(tag: keyof HTMLElementTagNameMap, cls: string, value = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (value) n.textContent = value;
  return n;
}

export class Card {
  private readonly root: HTMLElement;
  private act: CardActions | null = null;

  constructor() {
    this.root = text('div', 'fc-dtcard');
    this.root.setAttribute('role', 'dialog');
    this.root.hidden = true;
    document.getElementById('overlay-root')!.append(this.root);
    document.addEventListener('pointerdown', (e) => {
      if (!this.root.hidden && !this.root.contains(e.target as Node) && !(e.target as HTMLElement).closest('.fc-menu')) this.hide();
    }, true);
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      }
    });
    window.addEventListener('resize', () => this.hide());
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    const a = this.act;
    this.act = null;
    a?.close();
  }

  show(anchor: DOMRect, kind: TypeKind, label: string, rec: TypedRecord, actions: CardActions): void {
    this.act = actions;
    this.root.setAttribute('aria-label', `${label} data type card`);
    this.root.replaceChildren();
    const head = text('header', 'fc-dtcard-head');
    const ic = text('span', 'fc-dtcard-ic');
    ic.innerHTML = icon(kind === 'stock' ? 'stocks' : 'currencies');
    const titles = text('div', 'fc-dtcard-titles');
    const name = find(rec, 'Name')?.value ?? label;
    const sub = [find(rec, 'Ticker symbol')?.value, find(rec, 'Exchange')?.value].filter(Boolean).join(' · ');
    titles.append(text('h3', 'fc-dtcard-name', name), text('div', 'fc-dtcard-sub', sub));
    const more = text('button', 'fc-dtcard-btn');
    (more as HTMLButtonElement).type = 'button';
    more.title = 'Refresh settings';
    more.setAttribute('aria-label', 'Refresh settings');
    more.innerHTML = icon('refresh');
    more.addEventListener('click', () => actions.settings());
    const close = text('button', 'fc-dtcard-btn');
    (close as HTMLButtonElement).type = 'button';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = icon('close');
    close.addEventListener('click', () => this.hide());
    head.append(ic, titles, more, close);
    this.root.append(head);

    const price = find(rec, 'Price');
    if (price) {
      const row = text('div', 'fc-dtcard-price');
      row.append(text('strong', '', showValue(price)));
      const cur = find(rec, 'Currency')?.value ?? find(rec, 'Quote currency')?.value;
      if (cur) row.append(text('small', '', cur));
      const ch = find(rec, 'Change');
      const pc = find(rec, 'Change (%)');
      if (ch || pc) {
        const n = Number(ch?.value ?? pc?.value);
        const move = text('span', `fc-dtcard-move ${n > 0 ? 'is-up' : n < 0 ? 'is-down' : ''}`, [ch ? `${n > 0 ? '+' : ''}${showValue(ch)}` : '', pc ? `(${Number(pc.value) > 0 ? '+' : ''}${showValue(pc)})` : ''].filter(Boolean).join(' '));
        row.append(move);
      }
      this.root.append(row);
    }

    const list = text('ul', 'fc-dtcard-fields');
    list.setAttribute('aria-label', 'Fields');
    for (const f of rec.fields) {
      if (f.name === 'Name') continue;
      const li = text('li', 'fc-dtcard-field');
      const long = f.tag === 't' && f.value.length > 60;
      if (long) li.classList.add('is-long');
      const v = text('span', 'fc-dtcard-val', showValue(f));
      if (long) v.title = f.value;
      const ex = text('button', 'fc-dtcard-extract', 'Extract');
      (ex as HTMLButtonElement).type = 'button';
      ex.title = `Add ${f.name} to the cell beside this one`;
      ex.addEventListener('click', () => actions.extract(f.name));
      li.append(text('span', 'fc-dtcard-fname', f.name), v, ex);
      list.append(li);
    }
    this.root.append(list);

    const foot = text('footer', 'fc-dtcard-foot');
    const when = rec.at ? new Date(rec.at * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'not fetched';
    foot.append(text('span', 'fc-dtcard-src', `Powered by ${PROVIDER_LABEL[rec.provider] ?? rec.provider}`), text('span', 'fc-dtcard-when', `Updated ${when}`));
    const ins = text('button', 'fc-btn fc-dtcard-do', 'Insert Data');
    (ins as HTMLButtonElement).type = 'button';
    ins.addEventListener('click', () => actions.insert(ins.getBoundingClientRect()));
    const re = text('button', 'fc-btn fc-dtcard-do', 'Refresh');
    (re as HTMLButtonElement).type = 'button';
    re.addEventListener('click', () => actions.refresh());
    foot.append(ins, re);
    this.root.append(foot);

    this.root.style.left = '0px';
    this.root.style.top = '0px';
    this.root.style.visibility = 'hidden';
    this.root.hidden = false;
    const r = this.root.getBoundingClientRect();
    const below = anchor.bottom + 6 + r.height <= window.innerHeight - 8;
    const top = below ? anchor.bottom + 6 : Math.max(8, anchor.top - r.height - 6);
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - r.width - 8));
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
    this.root.style.visibility = '';
    this.root.querySelector<HTMLElement>('.fc-dtcard-do')?.focus({ preventScroll: true });
  }
}
