import { engine } from '../engine';
import { parseRef } from '../grid/a1';
import { api, el, esc, setText } from './dom';
import type { Env } from './model';

interface Proposal {
  sheet: string;
  start: string;
  rows: (string | number)[][];
  note: string;
}

interface Settings {
  configured: boolean;
  kind: string;
  url: string;
  model: string;
  key_set: boolean;
}

const QUICK: [string, string][] = [
  ['Summarize', 'Summarize the selected data in a few sentences. Mention totals, ranges and anything unusual.'],
  ['Suggest a formula', 'Propose a formula for the active cell that fits the data around it, and propose it with propose_cells.'],
  ['Fill from examples', 'The first rows of the selected column show examples. Continue the pattern for the rest of the column and propose the cells with propose_cells.'],
  ['Generate a table', 'Generate a small example table that fits this request, and propose it with propose_cells at the active cell: '],
];

export class AssistantTab {
  readonly root = el('div', 'fc-auto-pane');
  private readonly log: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly send: HTMLButtonElement;
  private readonly state: HTMLElement;
  private readonly form: HTMLFormElement;
  private proposals = new Map<string, Proposal>();
  private seq = 0;

  constructor(private readonly env: Env) {
    this.root.innerHTML = `
      <p class="fc-auto-hint fc-ai-state" aria-live="polite"></p>
      <div class="fc-ai-log" role="log" aria-live="polite"></div>
      <div class="fc-auto-row fc-ai-quick">${QUICK.map(([l], i) => `<button type="button" class="fc-btn" data-q="${i}">${esc(l)}</button>`).join('')}</div>
      <textarea class="fc-auto-input fc-ai-input" rows="3" placeholder="Ask about the selection, or describe a formula, table or column to fill" aria-label="Message the assistant"></textarea>
      <div class="fc-auto-row"><button type="button" class="fc-btn fc-btn-primary" data-a="send">Send</button><button type="button" class="fc-btn fc-btn-ghost" data-a="settings">Endpoint settings</button></div>
      <form class="fc-ai-settings" hidden>
        <label>API style<select class="fc-auto-input" name="kind"><option value="openai">OpenAI compatible (chat completions)</option><option value="anthropic">Anthropic Messages</option></select></label>
        <label>Endpoint address<input class="fc-auto-input" name="url" placeholder="https://host/v1" spellcheck="false" autocomplete="off"></label>
        <label>Model<input class="fc-auto-input" name="model" spellcheck="false" autocomplete="off"></label>
        <label>Key<input class="fc-auto-input" name="key" type="password" autocomplete="off" placeholder="Stays in the engine process's data folder, never in the workbook"></label>
        <div class="fc-auto-row"><button type="submit" class="fc-btn fc-btn-primary">Save</button><button type="button" class="fc-btn" data-a="clear">Remove endpoint</button></div>
        <p class="fc-auto-hint fc-ai-msg" aria-live="polite"></p>
      </form>`;
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.log = q('.fc-ai-log');
    this.input = q('.fc-ai-input');
    this.send = q('[data-a="send"]');
    this.state = q('.fc-ai-state');
    this.form = q('.fc-ai-settings');
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a],[data-q],[data-apply]');
      if (!b) return;
      if (b.dataset.q) {
        const [, prompt] = QUICK[Number(b.dataset.q)];
        if (prompt.endsWith(': ')) {
          this.input.value = prompt;
          this.input.focus();
        } else void this.ask(prompt);
      } else if (b.dataset.a === 'send') void this.ask(this.input.value);
      else if (b.dataset.a === 'settings') this.form.hidden = !this.form.hidden;
      else if (b.dataset.a === 'clear') void this.saveSettings(true);
      else if (b.dataset.apply) void this.apply(b.dataset.apply, b as HTMLButtonElement);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this.ask(this.input.value);
      }
    });
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.saveSettings(false);
    });
  }

  async load(): Promise<void> {
    try {
      const s = await api<Settings>('GET', '/api/settings/ai');
      const f = this.form.elements as unknown as Record<string, HTMLInputElement>;
      f.kind.value = s.kind;
      f.url.value = s.url;
      f.model.value = s.model;
      f.key.value = '';
      f.key.placeholder = s.key_set ? 'A key is stored. Leave empty to keep it.' : "Stays in the engine process's data folder, never in the workbook";
      setText(this.state, s.configured ? `Connected to ${s.url}. The assistant reads what you select and proposes cells; you decide what to apply.` : 'No model is set. FormCel bundles none: add an OpenAI compatible or Anthropic endpoint under Endpoint settings. =AI() returns #N/A until then.');
    } catch {
      setText(this.state, 'The engine process could not be reached.');
    }
  }

  private async saveSettings(clear: boolean): Promise<void> {
    const f = this.form.elements as unknown as Record<string, HTMLInputElement>;
    const msg = this.form.querySelector('.fc-ai-msg')!;
    try {
      await api('PUT', '/api/settings/ai', { kind: f.kind.value, url: clear ? '' : f.url.value, model: f.model.value, key: clear ? '' : f.key.value || null });
      setText(msg, clear ? 'The endpoint was removed.' : 'Saved.');
      await this.load();
      if (!clear) await this.env.calls.drain(true, true);
    } catch (err) {
      setText(msg, err instanceof Error ? err.message : String(err));
    }
  }

  private say(role: 'user' | 'bot' | 'err', text: string): HTMLElement {
    const m = el('div', `fc-ai-msg-${role}`);
    m.textContent = text;
    this.log.appendChild(m);
    this.log.scrollTop = this.log.scrollHeight;
    return m;
  }

  private async selected(): Promise<string> {
    const s = this.env.selection();
    const area = (s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1);
    if (area > 2000) return '';
    const cells = await engine().read(this.env.book(), s.r0, s.c0, s.r1, s.c1, this.env.grid.sheetIndex);
    const grid = new Map(cells.map((c) => [`${c[0]}:${c[1]}`, c[3] ?? c[2]]));
    const rows: string[] = [];
    for (let r = s.r0; r <= s.r1; r++) {
      const row: string[] = [];
      for (let c = s.c0; c <= s.c1; c++) row.push(grid.get(`${r}:${c}`) ?? '');
      rows.push(row.join('\t'));
    }
    return rows.join('\n');
  }

  private async ask(prompt: string): Promise<void> {
    const text = prompt.trim();
    if (!text || this.send.disabled) return;
    this.input.value = '';
    this.say('user', text);
    this.send.disabled = true;
    const wait = this.say('bot', 'Thinking');
    try {
      const sel = this.env.selection();
      const sheets = this.env.sheets();
      const r = await api<{ text: string; proposals: Proposal[] }>('POST', '/api/ai/assist', {
        workbook: this.env.id(),
        prompt: text,
        sheet: sheets[this.env.grid.sheetIndex] ?? '',
        selection: `${sheets[this.env.grid.sheetIndex] ?? ''}!${rangeOf(sel)}`,
        selected: await this.selected(),
      });
      wait.textContent = r.text || (r.proposals.length ? 'Here is a proposal.' : 'The model returned no text.');
      for (const p of r.proposals) this.proposal(p);
    } catch (err) {
      wait.className = 'fc-ai-msg-err';
      wait.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      this.send.disabled = false;
    }
  }

  private proposal(p: Proposal): void {
    const id = `p${++this.seq}`;
    this.proposals.set(id, p);
    const box = el('div', 'fc-ai-proposal');
    const rows = p.rows.slice(0, 6).map((r) => `<tr>${r.slice(0, 6).map((v) => `<td>${esc(String(v))}</td>`).join('')}</tr>`).join('');
    box.innerHTML = `<div class="fc-ai-ptitle">${esc(p.sheet)}!${esc(p.start)}${p.note ? ` · ${esc(p.note)}` : ''}</div><table>${rows}</table><button type="button" class="fc-btn fc-btn-primary" data-apply="${id}">Apply</button>`;
    this.log.appendChild(box);
    this.log.scrollTop = this.log.scrollHeight;
  }

  private async apply(id: string, btn: HTMLButtonElement): Promise<void> {
    const p = this.proposals.get(id);
    const book = this.env.book();
    if (!p || book < 0) return;
    const at = parseRef(p.start);
    const sheets = this.env.sheets();
    const i = sheets.indexOf(p.sheet) >= 0 ? sheets.indexOf(p.sheet) : this.env.grid.sheetIndex;
    if (!at) {
      btn.textContent = 'Bad cell address';
      return;
    }
    const edits: [number, number, string][] = [];
    p.rows.forEach((row, r) => row.forEach((v, c) => edits.push([at.r0 + r, at.c0 + c, typeof v === 'number' ? String(v) : String(v)])));
    const e = engine();
    const mark = await e.undoMark(book);
    await this.env.grid.commitEdits(await e.apply(book, edits, i));
    await e.undoGroup(book, mark);
    btn.disabled = true;
    btn.textContent = 'Applied. Undo reverses it.';
    await this.env.calls.drain();
  }
}

function rangeOf(r: { r0: number; c0: number; r1: number; c1: number }): string {
  const col = (c: number) => {
    let n = c + 1;
    let s = '';
    while (n > 0) {
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  const a = `${col(r.c0)}${r.r0 + 1}`;
  return r.r0 === r.r1 && r.c0 === r.c1 ? a : `${a}:${col(r.c1)}${r.r1 + 1}`;
}
