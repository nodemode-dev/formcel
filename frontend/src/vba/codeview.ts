import { dedentFor, highlightLine, indentAfter } from './highlight';

const LINE_H = 18;

export interface CodeHooks {
  changed(code: string): void;
  toggleBreak(line: number): void;
  caret(line: number, col: number): void;
}

export class CodeView {
  readonly el: HTMLElement;
  readonly ta: HTMLTextAreaElement;
  private readonly hl: HTMLElement;
  private readonly gutter: HTMLElement;
  private readonly gut: HTMLElement;
  private lines: string[] = [''];
  private breaks = new Set<number>();
  private exec = 0;
  private fault = 0;

  constructor(private readonly hooks: CodeHooks) {
    this.el = document.createElement('div');
    this.el.className = 'fc-vbe-code';
    this.gutter = document.createElement('div');
    this.gutter.className = 'fc-vbe-gutter';
    this.gut = document.createElement('div');
    this.gut.className = 'fc-vbe-gut';
    this.gutter.appendChild(this.gut);
    const stage = document.createElement('div');
    stage.className = 'fc-vbe-stage';
    this.hl = document.createElement('pre');
    this.hl.className = 'fc-vbe-hl';
    this.hl.setAttribute('aria-hidden', 'true');
    this.hl.appendChild(Object.assign(document.createElement('div'), { innerHTML: highlightLine('') }));
    this.ta =document.createElement('textarea');
    this.ta.className = 'fc-vbe-ta';
    this.ta.spellcheck = false;
    this.ta.wrap = 'off';
    this.ta.setAttribute('autocomplete', 'off');
    this.ta.setAttribute('autocapitalize', 'off');
    this.ta.setAttribute('aria-label', 'Code');
    stage.append(this.hl, this.ta);
    this.el.append(this.gutter, stage);
    this.ta.addEventListener('input', () => this.edited());
    this.ta.addEventListener('scroll', () => this.scrolled());
    this.ta.addEventListener('keydown', (e) => this.key(e));
    for (const ev of ['keyup', 'click', 'focus'] as const) this.ta.addEventListener(ev, () => this.reportCaret());
    this.gutter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-n]');
      if (row) this.hooks.toggleBreak(Number(row.dataset.n));
    });
  }

  setText(code: string): void {
    if (this.ta.value !== code) this.ta.value = code;
    this.sync();
  }

  text(): string {
    return this.ta.value;
  }

  private edited(): void {
    this.sync();
    this.hooks.changed(this.ta.value);
    this.reportCaret();
  }

  private sync(): void {
    const next = this.ta.value.split('\n');
    const old = this.lines;
    let p = 0;
    while (p < old.length && p < next.length && old[p] === next[p]) p++;
    let s = 0;
    while (s < old.length - p && s < next.length - p && old[old.length - 1 - s] === next[next.length - 1 - s]) s++;
    const removed = old.length - p - s;
    const added = next.length - p - s;
    const kids = this.hl.children;
    for (let i = 0; i < Math.min(removed, added); i++) kids[p + i].innerHTML = highlightLine(next[p + i]);
    if (removed > added) for (let i = 0; i < removed - added; i++) kids[p + added].remove();
    else if (added > removed) {
      const ref = kids[p + removed] ?? null;
      for (let i = removed; i < added; i++) {
        const d = document.createElement('div');
        d.innerHTML = highlightLine(next[p + i]);
        this.hl.insertBefore(d, ref);
      }
    }
    if (kids.length !== next.length) {
      this.hl.replaceChildren(...next.map((l) => Object.assign(document.createElement('div'), { innerHTML: highlightLine(l) })));
    }
    const delta = next.length - old.length;
    if (delta !== 0 && this.breaks.size) {
      const moved = new Set<number>();
      for (const b of this.breaks) {
        if (b <= p) moved.add(b);
        else if (b > old.length - s) moved.add(b + delta);
        else if (removed === added) moved.add(b);
      }
      this.breaks = moved;
      this.onBreaksMoved?.(moved);
    }
    if (removed !== added) {
      for (const n of this.shown.keys()) {
        this.gut.children[n - 1]?.removeAttribute('class');
        this.hl.children[n - 1]?.removeAttribute('class');
      }
      for (const el of this.hl.querySelectorAll('.bp,.ex,.er')) el.removeAttribute('class');
      this.shown.clear();
    }
    this.lines = next;
    this.paintGutter();
    this.marks();
  }

  onBreaksMoved: ((b: Set<number>) => void) | null = null;

  private paintGutter(): void {
    const n = this.lines.length;
    const g = this.gut;
    while (g.children.length > n) g.lastElementChild!.remove();
    while (g.children.length < n) {
      const d = document.createElement('div');
      const i = g.children.length + 1;
      d.dataset.n = String(i);
      d.innerHTML = `<i></i><span>${i}</span>`;
      g.appendChild(d);
    }
    this.gutter.style.width = `${Math.max(String(n).length, 3) * 8 + 34}px`;
  }

  setBreaks(b: Set<number>): void {
    this.breaks = new Set(b);
    this.marks();
  }

  setExec(line: number, fault = false): void {
    this.exec = fault ? 0 : line;
    this.fault = fault ? line : 0;
    this.marks();
    if (line) this.reveal(line);
  }

  private shown = new Map<number, string>();

  private marks(): void {
    const want = new Map<number, string>();
    for (const b of this.breaks) want.set(b, 'bp');
    if (this.exec) want.set(this.exec, (want.get(this.exec) ? 'bp ' : '') + 'ex');
    if (this.fault) want.set(this.fault, 'er');
    for (const [n, cls] of [...this.shown]) {
      if (want.get(n) !== cls) {
        this.gut.children[n - 1]?.setAttribute('class', '');
        this.hl.children[n - 1]?.setAttribute('class', '');
        this.shown.delete(n);
      }
    }
    for (const [n, cls] of want) {
      if (this.shown.get(n) === cls) continue;
      this.gut.children[n - 1]?.setAttribute('class', cls);
      this.hl.children[n - 1]?.setAttribute('class', cls);
      this.shown.set(n, cls);
    }
  }

  private scrolled(): void {
    const t = `translate(${-this.ta.scrollLeft}px, ${-this.ta.scrollTop}px)`;
    this.hl.style.transform = t;
    this.gut.style.transform = `translateY(${-this.ta.scrollTop}px)`;
  }

  reveal(line: number): void {
    const top = (line - 1) * LINE_H;
    const h = this.ta.clientHeight;
    if (top < this.ta.scrollTop) this.ta.scrollTop = Math.max(0, top - LINE_H * 2);
    else if (top + LINE_H * 2 > this.ta.scrollTop + h) this.ta.scrollTop = top - h / 2;
    this.scrolled();
  }

  goto(line: number, focus = true): void {
    const ls = this.ta.value.split('\n');
    const at = Math.max(1, Math.min(line, ls.length));
    let pos = 0;
    for (let i = 0; i < at - 1; i++) pos += ls[i].length + 1;
    this.ta.setSelectionRange(pos, pos + ls[at - 1].length);
    if (focus) this.ta.focus();
    this.reveal(at);
    this.reportCaret();
  }

  caretLine(): number {
    return this.ta.value.slice(0, this.ta.selectionStart).split('\n').length;
  }

  private reportCaret(): void {
    const upto = this.ta.value.slice(0, this.ta.selectionStart);
    const ls = upto.split('\n');
    this.hooks.caret(ls.length, ls[ls.length - 1].length + 1);
  }

  private key(e: KeyboardEvent): void {
    const ta = this.ta;
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const a = ta.selectionStart;
      const b = ta.selectionEnd;
      const value = ta.value;
      if (a === b && !e.shiftKey) {
        document.execCommand('insertText', false, '    ');
        return;
      }
      const start = value.lastIndexOf('\n', a - 1) + 1;
      const block = value.slice(start, b);
      const out = block.split('\n').map((l) => (e.shiftKey ? l.replace(/^( {1,4}|\t)/, '') : `    ${l}`)).join('\n');
      ta.setSelectionRange(start, b);
      document.execCommand('insertText', false, out);
      ta.setSelectionRange(start, start + out.length);
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      const a = ta.selectionStart;
      const value = ta.value;
      const start = value.lastIndexOf('\n', a - 1) + 1;
      let cur = value.slice(start, a);
      const prevStart = value.lastIndexOf('\n', start - 2) + 1;
      const prev = start > 0 ? value.slice(prevStart, start - 1) : '';
      if (dedentFor(cur) && /^ {4,}/.test(cur) && start > 0 && indentOf(cur) === indentOf(prev) && indentAfter(prev) === indentOf(prev)) {
        ta.setSelectionRange(start, start + 4);
        document.execCommand('insertText', false, '');
        ta.setSelectionRange(a - 4, a - 4);
        cur = cur.slice(4);
      }
      document.execCommand('insertText', false, `\n${indentAfter(cur)}`);
    }
  }
}

function indentOf(s: string): string {
  return /^[ \t]*/.exec(s)![0];
}
