import { generate } from './recorder';
import { check, typed, type Diagnostic } from './scriptCheck';
import { Completion, types } from './tsAssist';
import type { Recorded } from '../grid/grid';
import { el, esc, setText } from './dom';
import { SAMPLE, uid, type Env, type Script } from './model';

export class ScriptsTab {
  readonly root = el('div', 'fc-auto-pane');
  private readonly pick: HTMLSelectElement;
  private readonly name: HTMLInputElement;
  private readonly text: HTMLTextAreaElement;
  private readonly lines: HTMLElement;
  private readonly con: HTMLElement;
  private readonly run: HTMLButtonElement;
  private readonly stop: HTMLButtonElement;
  private readonly rec: HTMLButtonElement;
  private readonly tOpen: HTMLInputElement;
  private readonly tEdit: HTMLInputElement;
  private readonly tEvery: HTMLInputElement;
  private readonly fns: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly diag: HTMLElement;
  private diagKey = '\u0000';
  private diagTimer = 0;
  private diagSeq = 0;
  private recording: Recorded[] | null = null;
  private startNames: string[] = [];
  private origin: { sheet: number; r: number; c: number } | undefined;
  private lineCount = 0;
  private timers = new Map<string, number>();

  constructor(private readonly env: Env) {
    this.root.innerHTML = `
      <div class="fc-auto-row"><select class="fc-auto-input fc-grow" aria-label="Script"></select><button type="button" class="fc-btn" data-a="new">New</button><button type="button" class="fc-btn fc-btn-danger" data-a="delete">Delete</button></div>
      <input class="fc-auto-input" data-f="name" aria-label="Script name" spellcheck="false" autocomplete="off">
      <div class="fc-code"><pre class="fc-code-lines" aria-hidden="true"></pre><textarea class="fc-code-text" aria-label="Script code" spellcheck="false" wrap="off" autocapitalize="off" autocomplete="off"></textarea></div>
      <ul class="fc-auto-diag" aria-label="Checks" aria-live="polite"></ul>
      <div class="fc-auto-row"><button type="button" class="fc-btn fc-btn-primary" data-a="run">Run</button><button type="button" class="fc-btn" data-a="stop" disabled>Stop</button><button type="button" class="fc-btn" data-a="record" aria-pressed="false">Record actions</button><button type="button" class="fc-btn fc-btn-ghost" data-a="button">Add button</button><label class="fc-auto-small"><input type="checkbox" data-t="relative"> Record relative to the selected cell</label></div>
      <div class="fc-auto-row fc-auto-small"><label><input type="checkbox" data-t="open"> Run when the workbook opens</label><label><input type="checkbox" data-t="edit"> Run after an edit</label><label>Every <input class="fc-auto-num" type="number" min="0" max="1440" data-t="every"> min while open</label></div>
      <p class="fc-auto-hint fc-auto-fns"></p>
      <p class="fc-auto-hint fc-auto-msg" aria-live="polite"></p>
      <pre class="fc-auto-console" aria-label="Console" aria-live="polite"></pre>`;
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.pick = q('select');
    this.name = q('[data-f="name"]');
    this.text = q('.fc-code-text');
    this.lines = q('.fc-code-lines');
    this.con = q('.fc-auto-console');
    this.run = q('[data-a="run"]');
    this.stop = q('[data-a="stop"]');
    this.rec = q('[data-a="record"]');
    this.tOpen = q('[data-t="open"]');
    this.tEdit = q('[data-t="edit"]');
    this.tEvery = q('[data-t="every"]');
    this.fns = q('.fc-auto-fns');
    this.hint = q('.fc-auto-msg');
    this.diag = q('.fc-auto-diag');
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'new') this.create(SAMPLE, `Script ${this.env.auto.scripts.length + 1}`);
      else if (a === 'delete') this.remove();
      else if (a === 'run') void this.runCurrent();
      else if (a === 'stop') this.env.runner.stop();
      else if (a === 'record') this.toggleRecord();
      else if (a === 'button') this.addButton();
    });
    this.diag.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-start]');
      if (li) this.jump(li);
    });
    this.diag.addEventListener('keydown', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-start]');
      if (li && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.jump(li);
      }
    });
    new Completion(this.text, () => typed(this.current()?.code ?? ''));
    this.pick.addEventListener('change', () => this.show());
    this.name.addEventListener('input', () => {
      const s = this.current();
      if (!s) return;
      s.name = this.name.value;
      const o = this.pick.selectedOptions[0];
      if (o) setText(o, s.name || 'Untitled');
      this.env.changed();
    });
    this.text.addEventListener('input', () => {
      const s = this.current();
      if (!s) return;
      s.code = this.text.value;
      this.gutter();
      this.env.changed();
      this.scanSoon();
      window.clearTimeout(this.diagTimer);
      this.diagTimer = window.setTimeout(() => this.diagnose(), 400);
    });
    this.text.addEventListener('scroll', () => {
      this.lines.scrollTop = this.text.scrollTop;
    });
    this.text.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void this.runCurrent();
      }
    });
    const trig = () => {
      const s = this.current();
      if (!s) return;
      s.triggers = { open: this.tOpen.checked, edit: this.tEdit.checked, every: Number(this.tEvery.value) || 0 };
      this.env.changed();
      this.schedule();
    };
    for (const i of [this.tOpen, this.tEdit, this.tEvery]) i.addEventListener('change', trig);
  }

  current(): Script | undefined {
    return this.env.auto.scripts.find((s) => s.id === this.pick.value);
  }

  reload(): void {
    const list = this.env.auto.scripts;
    const keep = this.pick.value;
    this.pick.replaceChildren(...list.map((s) => Object.assign(el('option'), { value: s.id, textContent: s.name || 'Untitled' })));
    if (list.some((s) => s.id === keep)) this.pick.value = keep;
    this.show();
    this.schedule();
    this.scanSoon();
  }

  private show(): void {
    const s = this.current();
    const none = !s;
    this.name.disabled = this.text.disabled = this.run.disabled = none;
    this.name.value = s?.name ?? '';
    this.text.value = s?.code ?? '';
    this.tOpen.checked = !!s?.triggers?.open;
    this.tEdit.checked = !!s?.triggers?.edit;
    this.tEvery.value = s?.triggers?.every ? String(s.triggers.every) : '';
    this.gutter();
    this.lines.scrollTop = 0;
    this.text.scrollTop = 0;
    this.diagnose();
  }

  private diagnose(): void {
    const s = this.current();
    const code = s?.code ?? '';
    const local = s ? check(code) : [];
    this.showDiag(local);
    if (!s || !typed(code)) return;
    const mine = ++this.diagSeq;
    void types.check(code).then((found) => {
      if (mine !== this.diagSeq || this.current()?.code !== code) return;
      this.showDiag([...local.filter((d) => !d.syntax || !found.length), ...found.map((d): Diagnostic => ({ line: d.line, col: d.col, level: d.level, message: d.message, start: d.start, length: d.length }))]);
    });
  }

  private showDiag(found: Diagnostic[]): void {
    const key = found.map((d) => `${d.level}${d.line}:${d.col ?? 0}${d.message}`).join('\n');
    if (key === this.diagKey) return;
    this.diagKey = key;
    this.diag.replaceChildren(
      ...found.slice(0, 40).map((d) => {
        const li = Object.assign(el('li', `fc-diag-${d.level}`), { textContent: `Line ${d.line}${d.col ? `, column ${d.col}` : ''}: ${d.message}` });
        if (d.start !== undefined) {
          li.tabIndex = 0;
          li.setAttribute('role', 'button');
          li.dataset.start = String(d.start);
          li.dataset.length = String(d.length ?? 0);
        }
        return li;
      }),
    );
    this.diag.hidden = !found.length;
  }

  private jump(li: HTMLElement): void {
    const start = Number(li.dataset.start);
    const t = this.text;
    t.focus();
    t.setSelectionRange(start, start + Math.max(1, Number(li.dataset.length)));
    const line = t.value.slice(0, start).split('\n').length - 1;
    t.scrollTop = Math.max(0, line * 18 - t.clientHeight / 2);
  }

  private gutter(): void {
    const n = this.text.value.split('\n').length;
    if (n === this.lineCount) return;
    this.lineCount = n;
    this.lines.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
  }

  create(code: string, name: string): Script {
    const s: Script = { id: uid(), name, code };
    this.env.auto.scripts.push(s);
    this.env.changed();
    this.reload();
    this.pick.value = s.id;
    this.show();
    return s;
  }

  private remove(): void {
    const s = this.current();
    if (!s) return;
    const i = this.env.auto.scripts.indexOf(s);
    this.env.auto.scripts.splice(i, 1);
    this.env.auto.buttons = this.env.auto.buttons.filter((b) => b.script !== s.id);
    this.env.changed();
    this.reload();
    this.env.customChanged();
  }

  log(level: string, text: string): void {
    const lines = this.con.textContent ? this.con.textContent.split('\n') : [];
    lines.push(level === 'log' || level === 'info' ? text : `${level}: ${text}`);
    this.con.textContent = lines.slice(-400).join('\n');
    this.con.scrollTop = this.con.scrollHeight;
  }

  async runCurrent(): Promise<void> {
    const s = this.current();
    if (!s) return;
    this.con.textContent = '';
    this.run.disabled = true;
    this.stop.disabled = false;
    setText(this.hint, 'Running');
    const r = await this.env.runScript(s.id);
    this.run.disabled = false;
    this.stop.disabled = true;
    if (r.ok) setText(this.hint, r.result === undefined ? 'Finished. Undo reverses everything the script wrote in one step.' : `Finished with ${typeof r.result === 'string' ? r.result : JSON.stringify(r.result)}. Undo reverses the whole run in one step.`);
    else {
      setText(this.hint, '');
      this.log('error', r.error ?? 'The script failed.');
    }
  }

  private toggleRecord(): void {
    const g = this.env.grid;
    if (!this.recording) {
      this.recording = [];
      this.startNames = this.env.sheets().slice();
      const [r, c] = g.activeCell();
      this.origin = { sheet: g.sheetIndex, r, c };
      g.recorder = (a) => this.recording?.push(a);
      this.rec.setAttribute('aria-pressed', 'true');
      setText(this.rec, 'Stop recording');
      setText(this.hint, 'Recording. Edit cells, insert or delete rows, columns and cells, merge, fill, clear, filter, sort, add a chart or change sheets; each action is written into a new script.');
      return;
    }
    g.recorder = null;
    const acts = this.recording;
    this.recording = null;
    this.rec.setAttribute('aria-pressed', 'false');
    setText(this.rec, 'Record actions');
    if (!acts.length) {
      setText(this.hint, 'Nothing was recorded.');
      return;
    }
    const names = this.env.sheets();
    const n = this.env.auto.scripts.filter((s) => s.name.startsWith('Recorded')).length + 1;
    const relative = this.root.querySelector<HTMLInputElement>('[data-t="relative"]')?.checked ?? false;
    this.create(generate(acts, (i) => names[i] ?? names[0], `Recorded actions ${n}`, relative, this.startNames, this.origin),`Recorded actions ${n}`);
    setText(this.hint, `Recorded ${acts.length} action${acts.length === 1 ? '' : 's'}. Run it to replay them.`);
  }

  private addButton(): void {
    const s = this.current();
    if (!s) return;
    document.dispatchEvent(new CustomEvent('fc-insert-button', { detail: { label: s.name || 'Run', script: s.id } }));
    setText(this.hint, `A button for ${s.name} is on the sheet. Ctrl+click it to select it, then drag it, resize it, choose Format button for its text and colours, or delete it.`);
  }

  private scanTimer = 0;

  private scanSoon(): void {
    window.clearTimeout(this.scanTimer);
    this.scanTimer = window.setTimeout(() => this.env.customChanged(), 500);
  }

  async customNames(): Promise<[string, Script][]> {
    const out: [string, Script][] = [];
    for (const s of this.env.auto.scripts) for (const n of await this.env.runner.scan(s.code)) out.push([n.toUpperCase(), s]);
    this.fns.innerHTML = out.length ? `Custom functions in formulas: ${out.map(([n]) => `<code>=${esc(n)}()</code>`).join(' ')}` : 'A function with <code>/** @customfunction */</code> above it becomes callable in formulas, such as =MYFUNC(A1).';
    return out;
  }

  schedule(): void {
    for (const t of this.timers.values()) window.clearInterval(t);
    this.timers.clear();
    for (const s of this.env.auto.scripts) {
      const every = s.triggers?.every ?? 0;
      if (every > 0) this.timers.set(s.id, window.setInterval(() => void this.env.runScript(s.id, { type: 'timer' }), every * 60000));
    }
  }

  stopTimers(): void {
    for (const t of this.timers.values()) window.clearInterval(t);
    this.timers.clear();
  }
}
