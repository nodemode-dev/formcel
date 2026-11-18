import { callCommand } from '../ui/commands';
import { el, setText } from './dom';
import type { Env } from './model';
import { handlerNames, type PyRun } from './pyHandlers';

const SAMPLE = 'n = db.query("select count(*) as n from orders")[0][0]\nput("B2", n)\nprint("rows:", n)\n';

export class PythonTab {
  readonly root = el('div', 'fc-auto-pane');
  private readonly pick: HTMLSelectElement;
  private readonly name: HTMLInputElement;
  private readonly text: HTMLTextAreaElement;
  private readonly hint: HTMLElement;
  private readonly con: HTMLElement;
  private current = '';

  constructor(private readonly env: Env) {
    this.root.innerHTML = `
      <div class="fc-auto-row"><select class="fc-auto-input fc-grow" aria-label="Python handler"></select><button type="button" class="fc-btn" data-a="new">New</button><button type="button" class="fc-btn fc-btn-danger" data-a="delete">Delete</button></div>
      <input class="fc-auto-input" data-f="name" aria-label="Handler name" spellcheck="false" autocomplete="off">
      <div class="fc-code"><textarea class="fc-code-text" aria-label="Handler code" spellcheck="false" wrap="off" autocapitalize="off" autocomplete="off" rows="12"></textarea></div>
      <div class="fc-auto-row"><button type="button" class="fc-btn fc-btn-primary" data-a="run">Run</button></div>
      <p class="fc-auto-hint">A handler runs when a button or a form calls it. It can read ranges with xl("A1:B5"), the workbook database with db.query(sql, name=value) and db.execute(sql, name=value), and write cells with put("B2", value).</p>
      <p class="fc-auto-hint fc-auto-msg" aria-live="polite"></p>
      <pre class="fc-auto-console" aria-label="Output" aria-live="polite"></pre>`;
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.pick = q('select');
    this.name = q('[data-f="name"]');
    this.text = q('.fc-code-text');
    this.hint = q('.fc-auto-msg');
    this.con = q('.fc-auto-console');
    this.root.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'new') this.create();
      else if (a === 'delete') this.remove();
      else if (a === 'run') void this.run();
    });
    this.pick.addEventListener('change', () => this.show(this.pick.value));
    this.text.addEventListener('input', () => this.store());
    this.name.addEventListener('change', () => this.rename());
  }

  private handlers(): Record<string, string> {
    const h = this.env.auto.settings.pyHandlers;
    return h && typeof h === 'object' ? (h as Record<string, string>) : {};
  }

  private save(next: Record<string, string>): void {
    this.env.auto.settings.pyHandlers = next;
    this.env.changed();
  }

  reload(): void {
    const names = handlerNames(this.handlers());
    if (!names.includes(this.current)) this.current = names[0] ?? '';
    this.paintPick();
    this.show(this.current);
  }

  private paintPick(): void {
    const names = handlerNames(this.handlers());
    const have = [...this.pick.options].map((o) => o.value);
    if (have.join('\u0000') !== names.join('\u0000')) this.pick.replaceChildren(...names.map((n) => Object.assign(document.createElement('option'), { value: n, textContent: n })));
    this.pick.value = this.current;
    this.pick.disabled = !names.length;
  }

  private show(name: string): void {
    this.current = name;
    const code = this.handlers()[name];
    if (this.name.value !== name) this.name.value = name;
    if (this.text.value !== (code ?? '')) this.text.value = code ?? '';
    this.name.disabled = this.text.disabled = !name;
    if (this.pick.value !== name) this.pick.value = name;
  }

  private create(): void {
    const all = this.handlers();
    let i = Object.keys(all).length + 1;
    while (all[`handler${i}`] !== undefined) i++;
    const name = `handler${i}`;
    this.save({ ...all, [name]: SAMPLE });
    this.current = name;
    this.paintPick();
    this.show(name);
    this.text.focus();
  }

  private remove(): void {
    if (!this.current) return;
    const rest = { ...this.handlers() };
    delete rest[this.current];
    this.save(rest);
    this.current = '';
    this.reload();
  }

  private store(): void {
    if (!this.current) return;
    this.save({ ...this.handlers(), [this.current]: this.text.value });
  }

  private rename(): void {
    const next = this.name.value.trim();
    const all = this.handlers();
    if (!this.current || !next || next === this.current) return;
    if (!/^[A-Za-z_][\w]*$/.test(next) || all[next] !== undefined) {
      setText(this.hint, 'Use a new name made of letters, digits and _.');
      this.name.value = this.current;
      return;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) out[k === this.current ? next : k] = v;
    this.save(out);
    this.current = next;
    this.paintPick();
    setText(this.hint, '');
  }

  private async run(): Promise<void> {
    if (!this.current) return;
    setText(this.hint, `Running ${this.current}`);
    try {
      const r = (await callCommand('python.run', { name: this.current })) as PyRun;
      setText(this.con, [...r.printed, r.writes.length ? `${r.writes.length} cell${r.writes.length === 1 ? '' : 's'} written` : ''].filter(Boolean).join('\n'));
      setText(this.hint, `${this.current} finished`);
    } catch (err) {
      setText(this.hint, err instanceof Error ? err.message : String(err));
    }
  }
}
