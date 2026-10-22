import type { TsIn, TsOut, WorkerDiag } from './tsWorker';

export type TsDiag = WorkerDiag;

type Req = TsIn extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never;

class TypeService {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, (m: TsOut) => void>();

  private ask(req: Req): Promise<TsOut> {
    const w = (this.worker ??= this.spawn());
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      w.postMessage({ ...req, id } as TsIn);
    });
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./tsWorker.ts', import.meta.url), { type: 'module' });
    w.addEventListener('message', (ev: MessageEvent<TsOut>) => {
      const done = this.waiting.get(ev.data.id);
      if (!done) return;
      this.waiting.delete(ev.data.id);
      done(ev.data);
    });
    w.addEventListener('error', () => {
      for (const done of this.waiting.values()) done({ t: 'checked', id: 0, diags: [] });
      this.waiting.clear();
      this.worker = null;
    });
    return w;
  }

  async check(code: string): Promise<TsDiag[]> {
    const m = await this.ask({ t: 'check', code });
    return m.t === 'checked' ? m.diags : [];
  }

  async complete(code: string, pos: number): Promise<{ start: number; items: { name: string; kind: string }[] }> {
    const m = await this.ask({ t: 'complete', code, pos });
    return m.t === 'completed' ? { start: m.start, items: m.items } : { start: pos, items: [] };
  }

  async detail(code: string, pos: number, name: string): Promise<{ text: string; doc: string }> {
    const m = await this.ask({ t: 'detail', code, pos, name });
    return m.t === 'detailed' ? { text: m.text, doc: m.doc } : { text: '', doc: '' };
  }
}

export const types = new TypeService();

interface Item {
  name: string;
  kind: string;
}

export class Completion {
  private readonly box = document.createElement('div');
  private readonly list = document.createElement('ul');
  private readonly info = document.createElement('p');
  private items: Item[] = [];
  private shown: Item[] = [];
  private from = 0;
  private active = 0;
  private seq = 0;
  private dseq = 0;
  private timer = 0;
  private open = false;

  constructor(private readonly text: HTMLTextAreaElement, private readonly enabled: () => boolean) {
    this.box.className = 'fc-comp';
    this.box.hidden = true;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Completions');
    this.list.id = `fc-comp-${Math.random().toString(36).slice(2, 8)}`;
    this.info.className = 'fc-comp-info';
    this.box.append(this.list, this.info);
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.box);
    text.setAttribute('aria-controls', this.list.id);
    text.setAttribute('aria-autocomplete', 'list');
    text.addEventListener('input', (e) => this.typed(e as InputEvent));
    text.addEventListener('keydown', (e) => this.key(e), true);
    text.addEventListener('blur', () => window.setTimeout(() => {
      if (document.activeElement !== this.text) this.close();
    }, 120));
    text.addEventListener('scroll', () => this.close());
    this.list.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const li = (e.target as HTMLElement).closest<HTMLElement>('li');
      if (li) this.accept(Number(li.dataset.i));
    });
  }

  private typed(e: InputEvent): void {
    window.clearTimeout(this.timer);
    if (!this.enabled() || (e.inputType ?? '').startsWith('delete')) {
      this.close();
      return;
    }
    const pos = this.text.selectionStart;
    const before = this.text.value.slice(Math.max(0, pos - 2), pos);
    if (!/[\w$.]$/.test(before)) {
      this.close();
      return;
    }
    const dot = before.endsWith('.');
    const word = /[\w$]+$/.exec(this.text.value.slice(0, pos))?.[0] ?? '';
    if (!dot && word.length < 2) {
      this.close();
      return;
    }
    if (this.open && !dot) {
      this.refilter();
      return;
    }
    this.timer = window.setTimeout(() => void this.request(), 90);
  }

  async request(): Promise<void> {
    const code = this.text.value;
    const pos = this.text.selectionStart;
    const mine = ++this.seq;
    const r = await types.complete(code, pos);
    if (mine !== this.seq || code !== this.text.value) return;
    this.items = r.items;
    this.from = r.start;
    this.refilter();
  }

  private refilter(): void {
    const pos = this.text.selectionStart;
    const word = this.text.value.slice(this.from, pos);
    const lower = word.toLowerCase();
    const starts = this.items.filter((i) => i.name.toLowerCase().startsWith(lower));
    const has = this.items.filter((i) => !i.name.toLowerCase().startsWith(lower) && lower && i.name.toLowerCase().includes(lower));
    this.shown = [...starts, ...has].slice(0, 60);
    if (!this.shown.length || (this.shown.length === 1 && this.shown[0].name === word)) {
      this.close();
      return;
    }
    this.active = 0;
    this.paint();
    this.place();
  }

  private paint(): void {
    const keep = [...this.list.children] as HTMLElement[];
    this.shown.forEach((it, i) => {
      let li = keep[i];
      if (!li) {
        li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.appendChild(document.createElement('span'));
        li.appendChild(document.createElement('small'));
        this.list.appendChild(li);
      }
      li.dataset.i = String(i);
      (li.firstChild as HTMLElement).textContent = it.name;
      (li.lastChild as HTMLElement).textContent = it.kind;
      li.setAttribute('aria-selected', String(i === this.active));
      li.id = `${this.list.id}-${i}`;
    });
    while (this.list.children.length > this.shown.length) this.list.lastElementChild!.remove();
    this.text.setAttribute('aria-activedescendant', `${this.list.id}-${this.active}`);
    this.open = true;
    this.box.hidden = false;
    (this.list.children[this.active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
    void this.describe();
  }

  private async describe(): Promise<void> {
    const it = this.shown[this.active];
    if (!it) return;
    const mine = ++this.dseq;
    const d = await types.detail(this.text.value, this.text.selectionStart, it.name);
    if (mine !== this.dseq) return;
    this.info.textContent = d.doc ? `${d.text}\n${d.doc}` : d.text;
  }

  private place(): void {
    const t = this.text;
    const s = getComputedStyle(t);
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.font = `${s.fontSize} ${s.fontFamily}`;
    const cw = probe.measureText('M').width;
    const lh = parseFloat(s.lineHeight) || 18;
    const before = t.value.slice(0, t.selectionStart);
    const line = before.split('\n').length - 1;
    const col = before.length - before.lastIndexOf('\n') - 1;
    const r = t.getBoundingClientRect();
    const x = r.left + parseFloat(s.paddingLeft) + col * cw - t.scrollLeft;
    const y = r.top + parseFloat(s.paddingTop) + (line + 1) * lh - t.scrollTop;
    this.box.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 300))}px`;
    const below = y + 220 < window.innerHeight;
    this.box.style.top = below ? `${y}px` : `${Math.max(4, y - lh - 220)}px`;
  }

  private key(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
      if (!this.enabled()) return;
      e.preventDefault();
      void this.request();
      return;
    }
    if (!this.open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : this.shown.length - 1)) % this.shown.length;
      this.paint();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.accept(this.active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
    }
  }

  private accept(i: number): void {
    const it = this.shown[i];
    if (!it) return;
    const pos = this.text.selectionStart;
    this.close();
    this.text.focus();
    this.text.setSelectionRange(this.from, pos);
    document.execCommand('insertText', false, it.name);
  }

  close(): void {
    window.clearTimeout(this.timer);
    if (!this.open) return;
    this.seq++;
    this.open = false;
    this.box.hidden = true;
    this.text.removeAttribute('aria-activedescendant');
  }
}
