import { engine } from '../engine';
import { a1 } from '../grid/a1';
import type { Grid } from '../grid/grid';
import { icon } from '../ui/icons';
import { api, el, setText } from './dom';

export interface PyHooks {
  grid: Grid;
  book(): number;
  sheets(): string[];
  status(text: string, error?: boolean): void;
  drain(): Promise<void>;
}

interface Settings {
  enabled: boolean;
  pandas: boolean;
  version: string;
  network: string;
  limits: string;
}

export function splitPy(formula: string): { code: string; rest: string } | null {
  const m = /^=\s*PY\s*\(\s*"/i.exec(formula);
  if (!m) return null;
  let i = m[0].length;
  let code = '';
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      if (formula[i + 1] === '"') {
        code += '"';
        i += 2;
        continue;
      }
      break;
    }
    code += ch;
    i++;
  }
  const tail = formula.slice(i + 1);
  const rest = tail.replace(/\)\s*$/, '');
  return { code, rest };
}

export class PyCellEditor {
  readonly root = el('section', 'fc-pycell');
  private readonly where: HTMLElement;
  private readonly text: HTMLTextAreaElement;
  private readonly msg: HTMLElement;
  private readonly info: HTMLElement;
  private readonly commit: HTMLButtonElement;
  private target: { sheet: number; r: number; c: number; rest: string } | null = null;
  private on = false;

  constructor(private readonly h: PyHooks) {
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Python cell');
    this.root.innerHTML = `
      <header class="fc-pycell-head"><strong>Python cell</strong><span class="fc-pycell-where"></span><span class="fc-grow"></span><button type="button" class="fc-tool" data-a="close" aria-label="Close">${icon('close')}</button></header>
      <textarea class="fc-pycell-text" spellcheck="false" wrap="off" autocapitalize="off" autocomplete="off" aria-label="Python code" placeholder="df = xl(&quot;A1:C10&quot;, headers=True)&#10;df.describe()"></textarea>
      <p class="fc-auto-hint fc-pycell-info"></p>
      <p class="fc-auto-hint fc-pycell-msg" aria-live="polite"></p>
      <div class="fc-auto-row"><button type="button" class="fc-btn fc-btn-primary" data-a="commit">Run in cell</button><button type="button" class="fc-btn" data-a="close">Cancel</button><button type="button" class="fc-btn fc-btn-ghost" data-a="toggle"></button></div>`;
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.where = q('.fc-pycell-where');
    this.text = q('.fc-pycell-text');
    this.msg = q('.fc-pycell-msg');
    this.info = q('.fc-pycell-info');
    this.commit = q('[data-a="commit"]');
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'close') this.close();
      else if (b.dataset.a === 'commit') void this.save();
      else if (b.dataset.a === 'toggle') void this.toggle();
    });
    this.text.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void this.save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        document.execCommand('insertText', false, '    ');
      }
    });
  }

  async open(): Promise<void> {
    const g = this.h.grid;
    const book = this.h.book();
    if (book < 0) return;
    const s = g.selection();
    const sheet = g.sheetIndex;
    const cells = await engine().read(book, s.r0, s.c0, s.r0, s.c0, sheet);
    const formula = cells[0]?.[3] ?? '';
    const parsed = splitPy(formula);
    this.target = { sheet, r: s.r0, c: s.c0, rest: parsed?.rest ?? '' };
    setText(this.where, `${this.h.sheets()[sheet] ?? ''}!${a1(s.r0, s.c0)}`);
    this.text.value = parsed?.code ?? '';
    this.root.hidden = false;
    this.text.focus();
    await this.refresh();
  }

  close(): void {
    this.root.hidden = true;
    this.target = null;
    this.h.grid.focus();
  }

  private async refresh(): Promise<void> {
    try {
      const s = await api<Settings>('GET', '/api/settings/python');
      this.on = s.enabled;
      setText(this.info, `Python ${s.version}${s.pandas ? ' with pandas as pd and numpy as np' : ' (pandas is not installed)'}. xl("A1:C10", headers=True) reads a range as a DataFrame, xl("Table1[#All]", headers=True) a table. A DataFrame spills with its headers. Runs in a separate process: ${s.limits}; ${s.network}. Cells run by sheet, then row, then column.`);
      const t = this.root.querySelector<HTMLElement>('[data-a="toggle"]')!;
      setText(t, s.enabled ? 'Turn Python cells off' : 'Turn Python cells on');
      if (!s.enabled) setText(this.msg, 'Python cells are off. Turn them on to run this code.');
      else setText(this.msg, '');
    } catch {
      setText(this.msg, 'The engine process could not be reached.');
    }
  }

  private async toggle(): Promise<void> {
    await api('PUT', '/api/settings/python', { enabled: !this.on });
    await this.refresh();
    await this.h.drain();
  }

  private async save(): Promise<void> {
    const t = this.target;
    if (!t) return;
    const code = this.text.value.replace(/\s+$/, '');
    if (!code) {
      setText(this.msg, 'Write some Python first.');
      return;
    }
    if (!this.on) {
      setText(this.msg, 'Python cells are off. Turn them on to run this code.');
      return;
    }
    this.commit.disabled = true;
    const raw = `=PY("${code.replace(/"/g, '""')}"${t.rest})`;
    const book = this.h.book();
    await this.h.grid.commitEdits(await engine().apply(book, [[t.r, t.c, raw]], t.sheet));
    await this.h.drain();
    this.commit.disabled = false;
    this.h.status(`Python cell ${a1(t.r, t.c)} set`);
    this.close();
  }
}
