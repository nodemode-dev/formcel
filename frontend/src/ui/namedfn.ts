import type { EngineClient } from '../engine';
import { splitArgs } from './functions';
import { actions, el, field, makeModal, type Modal } from './modal';

export interface NamedFnHost {
  engine: EngineClient;
  book(): number | null;
  id(): string | null;
  refreshNames(): Promise<void>;
  sync(op: 'comment', args: string[]): Promise<void>;
  syncName(name: string, refers: string): Promise<void>;
  workbooks(): Promise<{ id: string; title: string }[]>;
  workbook(id: string): Promise<{ names: [string, string][]; nameNotes: [string, string][] }>;
  say(text: string, bad?: boolean): void;
}

export interface NamedFn {
  name: string;
  params: string[];
  body: string;
  comment: string;
}

const LAMBDA = /^=\s*LAMBDA\s*\(/i;

export function lambdaOf(name: string, refers: string, comment: string): NamedFn | null {
  if (!LAMBDA.test(refers)) return null;
  const parts = splitArgs(refers.slice(1));
  if (!parts.length) return null;
  return { name, params: parts.slice(0, -1), body: parts[parts.length - 1], comment };
}

export function signature(f: NamedFn): string {
  return `${f.name}(${f.params.join(', ')})`;
}

function button(text: string): HTMLButtonElement {
  const b = el('button', 'fc-btn', text);
  b.type = 'button';
  return b;
}

export class NamedFunctions {
  private modal: Modal | null = null;
  private list!: HTMLSelectElement;
  private note!: HTMLElement;
  private fns: NamedFn[] = [];
  private edit: { m: Modal; name: HTMLInputElement; desc: HTMLInputElement; args: HTMLTextAreaElement; body: HTMLTextAreaElement; sig: HTMLElement; hint: HTMLElement; was: string } | null = null;
  private imp: { m: Modal; pick: HTMLSelectElement; list: HTMLElement; over: HTMLInputElement; hint: HTMLElement } | null = null;

  constructor(private readonly host: NamedFnHost) {}

  private get book(): number {
    return this.host.book() ?? -1;
  }

  private async load(): Promise<void> {
    if (this.book < 0) return;
    const rows = await this.host.engine.nameRows(this.book);
    this.fns = rows.filter((r) => !r.scope).map((r) => lambdaOf(r.name, r.refers, r.comment)).filter((f): f is NamedFn => !!f);
    const keep = this.list.value;
    this.list.replaceChildren(...this.fns.map((f) => new Option(signature(f) + (f.comment ? `  ${f.comment}` : ''), f.name)));
    if (this.fns.some((f) => f.name === keep)) this.list.value = keep;
    else if (this.fns.length) this.list.selectedIndex = 0;
  }

  open(): void {
    if (this.book < 0) return;
    const m = (this.modal ??= this.make());
    void this.load();
    m.open(this.list);
  }

  private make(): Modal {
    const m = makeModal('Named functions', { wide: true });
    this.list = el('select', 'fc-fmt-input fc-names-paste');
    this.list.size = 9;
    this.list.setAttribute('aria-label', 'Named functions');
    this.note = el('p', 'fc-fmt-hint');
    this.note.setAttribute('role', 'status');
    const add = button('New function...');
    const edit = button('Edit...');
    const del = button('Delete');
    const imp = button('Import from workbook...');
    const bar = el('div', 'fc-names-bar');
    bar.append(add, edit, del, imp);
    m.body.append(el('p', 'fc-fmt-hint', 'A named function is a LAMBDA saved under a name. Call it like a built-in function; its argument names show as you type.'), bar, this.list, this.note, actions('Close', () => m.close(), () => m.close(), [], ''));
    add.addEventListener('click', () => this.form());
    edit.addEventListener('click', () => this.form(this.fns.find((f) => f.name === this.list.value)));
    this.list.addEventListener('dblclick', () => this.form(this.fns.find((f) => f.name === this.list.value)));
    let armed = false;
    del.addEventListener('click', () => {
      const f = this.fns.find((x) => x.name === this.list.value);
      if (!f) return;
      if (!armed) {
        armed = true;
        del.textContent = 'Click again to delete';
        return;
      }
      armed = false;
      del.textContent = 'Delete';
      void this.save(f.name, '', '').then(() => this.load(), (e: unknown) => this.fail(e));
    });
    imp.addEventListener('click', () => void this.importDialog());
    return m;
  }

  private fail(err: unknown): void {
    this.note.textContent = err instanceof Error ? err.message : String(err);
    this.note.dataset.state = 'error';
  }

  private async save(name: string, refers: string, comment: string): Promise<void> {
    const book = this.book;
    await this.host.engine.defineName(book, name, refers);
    await this.host.syncName(name, refers);
    if (refers) {
      await this.host.engine.nameComment(book, name, comment);
      await this.host.sync('comment', [name, comment]);
    }
    await this.host.refreshNames();
  }

  private form(fn?: NamedFn): void {
    const box = (this.edit ??= this.makeForm());
    box.was = fn?.name ?? '';
    box.name.value = fn?.name ?? '';
    box.name.disabled = !!fn;
    box.desc.value = fn?.comment ?? '';
    box.args.value = fn?.params.join('\n') ?? '';
    box.body.value = fn?.body ?? '';
    box.hint.textContent = '';
    this.preview();
    box.m.open(box.name.disabled ? box.desc : box.name);
  }

  private preview(): void {
    const b = this.edit!;
    const args = b.args.value.split('\n').map((s) => s.trim()).filter(Boolean);
    b.sig.textContent = `${b.name.value.trim() || 'NAME'}(${args.join(', ')})`;
  }

  private makeForm() {
    const m = makeModal('Named function', { wide: true });
    const name = el('input', 'fc-fmt-input');
    name.spellcheck = false;
    name.maxLength = 255;
    const desc = el('input', 'fc-fmt-input');
    desc.maxLength = 255;
    const args = el('textarea', 'fc-fmt-input');
    args.rows = 4;
    args.spellcheck = false;
    args.placeholder = 'One argument per line. Put an optional argument in square brackets, such as [rate].';
    const body = el('textarea', 'fc-fmt-input');
    body.rows = 4;
    body.spellcheck = false;
    body.placeholder = 'Formula using the argument names, such as PI()*radius^2';
    const sig = el('div', 'fc-fn-sig');
    const hint = el('p', 'fc-fmt-hint');
    hint.setAttribute('role', 'status');
    m.body.append(field('Function name', name), field('Description', desc), field('Argument placeholders', args), field('Formula definition', body), sig, hint, actions('Save', () => void go(), () => m.close()));
    const go = async () => {
      const params = args.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const text = body.value.trim().replace(/^=/, '');
      if (!text) {
        hint.textContent = 'Type the formula the function should compute.';
        hint.dataset.state = 'error';
        return;
      }
      try {
        await this.save(name.value.trim(), `=LAMBDA(${[...params, text].join(', ')})`, desc.value.trim());
        m.close();
        await this.load();
        this.list.value = name.value.trim();
      } catch (e) {
        hint.textContent = e instanceof Error ? e.message : String(e);
        hint.dataset.state = 'error';
      }
    };
    for (const i of [name, args]) i.addEventListener('input', () => this.preview());
    return { m, name, desc, args, body, sig, hint, was: '' };
  }

  private async importDialog(): Promise<void> {
    const box = (this.imp ??= this.makeImport());
    const here = this.host.id();
    const all = (await this.host.workbooks()).filter((w) => w.id !== here);
    box.pick.replaceChildren(new Option('Choose a workbook', ''), ...all.map((w) => new Option(w.title, w.id)));
    box.list.replaceChildren();
    box.hint.textContent = all.length ? '' : 'There is no other workbook to import from.';
    box.m.open(box.pick);
  }

  private makeImport() {
    const m = makeModal('Import named functions', { wide: true });
    const pick = el('select', 'fc-fmt-input');
    pick.setAttribute('aria-label', 'Workbook');
    const list = el('div', 'fc-names-picks');
    const over = el('input');
    over.type = 'checkbox';
    const ol = el('label');
    ol.append(over, ' Replace functions that already exist here');
    const hint = el('p', 'fc-fmt-hint');
    hint.setAttribute('role', 'status');
    m.body.append(field('Import from', pick), list, ol, hint, actions('Import', () => void go(), () => m.close()));
    let source: Map<string, { refers: string; comment: string }> = new Map();
    pick.addEventListener('change', () => {
      list.replaceChildren();
      source = new Map();
      if (!pick.value) return;
      hint.textContent = 'Reading the workbook';
      void this.host.workbook(pick.value).then(
        (doc) => {
          const notes = new Map(doc.nameNotes);
          for (const [n, r] of doc.names) {
            if (n.includes('!')) continue;
            const f = lambdaOf(n, r, notes.get(n) ?? '');
            if (!f) continue;
            source.set(n, { refers: r, comment: f.comment });
            const l = el('label', 'fc-names-pick');
            const i = el('input');
            i.type = 'checkbox';
            i.value = n;
            i.checked = true;
            l.append(i, ` ${signature(f)}`);
            list.append(l);
          }
          hint.textContent = source.size ? '' : 'That workbook has no named functions.';
        },
        (e: unknown) => {
          hint.textContent = e instanceof Error ? e.message : String(e);
        },
      );
    });
    const go = async () => {
      const chosen = [...list.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
      if (!chosen.length) {
        hint.textContent = 'Pick at least one function.';
        hint.dataset.state = 'error';
        return;
      }
      const have = new Set(this.fns.map((f) => f.name.toUpperCase()));
      let done = 0;
      let skipped = 0;
      for (const n of chosen) {
        const s = source.get(n);
        if (!s) continue;
        if (have.has(n.toUpperCase()) && !over.checked) {
          skipped++;
          continue;
        }
        try {
          await this.save(n, s.refers, s.comment);
          done++;
        } catch {
          skipped++;
        }
      }
      m.close();
      await this.load();
      this.host.say(`Imported ${done} named ${done === 1 ? 'function' : 'functions'}${skipped ? `; left out ${skipped}` : ''}.`, done === 0);
    };
    return { m, pick, list, over, hint };
  }
}
