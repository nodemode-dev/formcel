import type { EngineClient } from '../engine';
import { cmd, parseLinks, type ExtLink } from '../engine/calc';
import { actions, el, makeModal, type Modal } from './modal';

export interface LinksHost {
  engine: EngineClient;
  book(): number;
  run(command: string): Promise<void>;
  drain(fresh: boolean): Promise<void>;
}

const STATE: Record<ExtLink['state'], string> = { ok: 'OK: values are kept', broken: 'Source not found: showing kept values', pending: 'Not updated yet' };

export class EditLinks {
  private modal: Modal | null = null;
  private body: HTMLElement | null = null;
  private note: HTMLElement | null = null;
  private pick: ExtLink | null = null;
  private source: HTMLInputElement | null = null;
  private buttons: HTMLButtonElement[] = [];
  private breaker: HTMLButtonElement | null = null;

  constructor(private readonly host: LinksHost) {}

  async open(): Promise<void> {
    if (!this.modal) this.build();
    this.pick = null;
    await this.list();
    this.modal!.open();
  }

  private build(): void {
    const m = (this.modal = makeModal('Edit Links', { wide: true }));
    const table = el('div', 'fc-links');
    table.setAttribute('role', 'listbox');
    table.setAttribute('aria-label', 'Linked workbooks');
    this.body = table;
    this.note = el('p', 'fc-fmt-hint');
    this.note.setAttribute('aria-live', 'polite');
    const src = (this.source = el('input', 'fc-fmt-input'));
    src.placeholder = 'New source, for example Budget.fcel or C:\\Reports\\Budget.xlsx';
    src.setAttribute('aria-label', 'New source for the selected link');
    const mk = (label: string, run: () => Promise<void>) => {
      const b = el('button', 'fc-btn', label);
      b.type = 'button';
      b.disabled = true;
      b.addEventListener('click', () => void run().catch((e: unknown) => this.say(e instanceof Error ? e.message : 'That did not work.')));
      this.buttons.push(b);
      return b;
    };
    const update = mk('Update Values', () => this.update());
    const change = mk('Change Source', () => this.change());
    const brk = (this.breaker = mk('Break Link', () => this.breakLink()));
    const bar = actions('Close', () => m.close(), () => m.close(), [update, change, brk], '');
    m.body.replaceChildren(table, src, this.note, bar);
  }

  private say(text: string): void {
    if (this.note) this.note.textContent = text;
  }

  private async list(): Promise<void> {
    const book = this.host.book();
    const links = parseLinks((await this.host.engine.calc(book, 'extlist')).text);
    const rows: HTMLElement[] = links.map((l) => {
      const row = el('button', 'fc-links-row');
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(this.pick?.name === l.name && this.pick.path === l.path));
      row.append(el('span', 'fc-links-name', `${l.path}${l.name}`), el('span', 'fc-links-state', STATE[l.state]), el('span', 'fc-links-used', `${l.used} formula${l.used === 1 ? '' : 's'}, ${l.cached} kept value${l.cached === 1 ? '' : 's'}`));
      row.addEventListener('click', () => {
        this.pick = l;
        for (const r of this.body!.children) r.setAttribute('aria-selected', String(r === row));
        for (const b of this.buttons) b.disabled = false;
        this.disarm();
        this.source!.value = `${l.path}${l.name}`;
      });
      return row;
    });
    if (!rows.length) rows.push(el('p', 'fc-fmt-hint', 'This workbook does not link to other workbooks.'));
    this.body!.replaceChildren(...rows);
    for (const b of this.buttons) b.disabled = !this.pick;
    this.disarm();
  }

  private disarm(): void {
    if (this.breaker && this.breaker.textContent !== 'Break Link') {
      this.breaker.textContent = 'Break Link';
      delete this.breaker.dataset.armed;
    }
  }

  private async update(): Promise<void> {
    const l = this.pick;
    if (!l) return;
    await this.host.engine.calc(this.host.book(), cmd('extrefresh', l.path, l.name));
    await this.host.drain(true);
    await this.list();
    this.say(`Updated values from ${l.name}.`);
  }

  private async change(): Promise<void> {
    const l = this.pick;
    const text = this.source!.value.trim();
    if (!l || !text) return;
    const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
    const path = cut >= 0 ? text.slice(0, cut + 1) : '';
    const name = text.slice(cut + 1);
    if (!name) throw new Error('Type the file name of the new source.');
    await this.host.run(cmd('extchange', l.path, l.name, path, name));
    await this.host.drain(true);
    this.pick = null;
    await this.list();
    this.say(`Changed the source to ${name}.`);
  }

  private async breakLink(): Promise<void> {
    const l = this.pick;
    const b = this.breaker;
    if (!l || !b) return;
    if (!b.dataset.armed) {
      b.dataset.armed = '1';
      b.textContent = 'Break Link: click again to confirm';
      return;
    }
    await this.host.run(cmd('extbreak', l.path, l.name));
    this.pick = null;
    await this.list();
    this.say(`Broke the link to ${l.name}. Its formulas now hold the values they last showed.`);
  }
}
