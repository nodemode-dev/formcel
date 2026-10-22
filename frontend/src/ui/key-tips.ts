import { el, isMac, setClass, setHidden } from './rb-dom';

export interface TipHost {
  ready(): boolean;
  file(): HTMLElement | null;
  qat(): HTMLElement[];
  tabs(): Array<{ id: string; node: HTMLElement }>;
  open(id: string): void;
  controls(): HTMLElement[];
  close(): void;
}

interface Tip { code: string; node: HTMLElement; go: () => void }

const TAB_KEYS: Record<string, string> = Object.fromEntries(Object.entries({
  home: 'h', insert: 'n', draw: 'jd', pagelayout: 'p', formulas: 'm', data: 'a', review: 'r', view: 'w', automate: 'zs', developer: 'l', help: 'y',
  tabledesign: 'jt', pivotanalyze: 'jv', pivotdesign: 'jp', chartdesign: 'jc', chartformat: 'jo', shapeformat: 'jh', pictureformat: 'ji', sparkline: 'jk',
}).map(([k, v]) => [k, v.toUpperCase()]));
const ALPHA = 'abcdefghijklmnopqrstuvwxyz'.toUpperCase().split('');
const DIGITS = '123456789'.split('');
const NFD = 'nfd'.toUpperCase();

const labelOf = (n: HTMLElement): string => n.getAttribute('aria-label') || n.getAttribute('title') || n.textContent || '';

function prefsOf(label: string): string[] {
  const plain = label.normalize(NFD).toUpperCase();
  const words = plain.split(/[^A-Z0-9]+/).filter(Boolean);
  const all = [...words.map((w) => w[0]), ...plain.replace(/[^A-Z]/g, '').split(''), ...DIGITS, ...ALPHA];
  return Array.from(new Set(all));
}

export function assignCodes(labels: string[], reserved: Set<string> = new Set()): string[] {
  const prefs = labels.map(prefsOf);
  const prefixes: string[] = [];
  for (;;) {
    const used = new Set([...reserved, ...prefixes]);
    const out: string[] = [];
    const left: number[] = [];
    prefs.forEach((p, i) => {
      const c = p.find((ch) => !used.has(ch));
      if (c) { used.add(c); out[i] = c; } else left.push(i);
    });
    if (left.length <= prefixes.length * 35) {
      const taken = new Map<string, Set<string>>(prefixes.map((p) => [p, new Set<string>()]));
      for (const i of left) {
        const pre = prefs[i].find((ch) => prefixes.includes(ch) && (taken.get(ch) as Set<string>).size < 35) ?? prefixes.find((p) => (taken.get(p) as Set<string>).size < 35) as string;
        const box = taken.get(pre) as Set<string>;
        const second = prefs[i].find((ch) => !box.has(ch)) as string;
        box.add(second);
        out[i] = pre + second;
      }
      return out;
    }
    const free = [...prefs[left[0]], ...ALPHA].find((ch) => /[A-Z]/.test(ch) && !prefixes.includes(ch) && !reserved.has(ch));
    if (!free) return out.map((c) => c ?? '');
    prefixes.push(free);
  }
}

export class KeyTips {
  private readonly layer = el('<div class="rb-keytips" aria-hidden="true" hidden></div>');
  private readonly pool: HTMLElement[] = [];
  private tips: Tip[] = [];
  private typed = '';
  private level: 'top' | 'tab' | '' = '';
  private armed = false;

  constructor(private readonly host: TipHost, private readonly allowed: () => boolean) {
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.layer);
    window.addEventListener('keydown', (e) => this.onDown(e), true);
    window.addEventListener('keyup', (e) => this.onUp(e), true);
    window.addEventListener('pointerdown', () => { this.armed = false; if (this.level) this.hide(); }, true);
    window.addEventListener('blur', () => { this.armed = false; if (this.level) this.hide(); });
    window.addEventListener('resize', () => { if (this.level) this.hide(); });
  }

  get showing(): boolean { return !!this.level; }

  toggle(): void { if (this.level) this.hide(); else this.top(); }

  private usable(): boolean { return this.allowed() && this.host.ready() && !document.querySelector('.fc-modal:not([hidden])'); }

  private onDown(e: KeyboardEvent): void {
    if (e.key === 'Alt') { if (!e.repeat) this.armed = !isMac && !e.ctrlKey && !e.metaKey && !e.shiftKey; return; }
    this.armed = false;
    if (this.level) { this.key(e); return; }
    if (e.key === 'F10' && !isMac && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && this.usable()) { e.preventDefault(); this.top(); }
  }

  private onUp(e: KeyboardEvent): void {
    if (e.key !== 'Alt' || !this.armed) return;
    this.armed = false;
    if (this.level) { e.preventDefault(); this.hide(); return; }
    if (!this.usable()) return;
    e.preventDefault();
    this.top();
  }

  private key(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey) { this.hide(); return; }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      if (this.typed) { this.typed = ''; this.paint(); } else if (this.level === 'tab') { this.host.close(); this.top(); } else this.hide();
      return;
    }
    if (e.key === 'Backspace') { this.typed = this.typed.slice(0, -1); this.paint(); return; }
    const ch = e.key.length === 1 ? e.key.normalize(NFD).toUpperCase()[0] : '';
    if (!/[A-Z0-9]/.test(ch)) return;
    const next = this.typed + ch;
    const hit = this.tips.find((t) => t.code === next);
    if (hit) { this.typed = ''; hit.go(); return; }
    if (this.tips.some((t) => t.code.startsWith(next))) { this.typed = next; this.paint(); }
  }

  private top(): void {
    if (!this.usable()) return;
    const tips: Tip[] = [];
    const file = this.host.file();
    if (file) tips.push({ code: 'F', node: file, go: () => { this.hide(); file.click(); } });
    this.host.qat().slice(0, 9).forEach((n, i) => tips.push({ code: String(i + 1), node: n, go: () => { this.hide(); n.click(); } }));
    const tabs = this.host.tabs();
    const fixed = new Set<string>(['F', ...tabs.map((t) => TAB_KEYS[t.id]).filter(Boolean).map((k) => k[0])]);
    const loose = tabs.filter((t) => !TAB_KEYS[t.id]);
    const looseCodes = assignCodes(loose.map((t) => labelOf(t.node)), fixed);
    for (const t of tabs) {
      const code = TAB_KEYS[t.id] ?? looseCodes[loose.indexOf(t)];
      tips.push({ code, node: t.node, go: () => this.enter(t.id) });
    }
    this.show('top', tips);
  }

  private enter(id: string): void {
    this.host.open(id);
    requestAnimationFrame(() => this.inner());
  }

  private inner(): void {
    const nodes = this.host.controls();
    const codes = assignCodes(nodes.map(labelOf));
    const tips = nodes.map((n, i): Tip => ({
      code: codes[i], node: n, go: () => {
        if (n instanceof HTMLInputElement) { this.hide(); n.focus(); n.select?.(); return; }
        const group = !!n.dataset.group;
        this.hide();
        n.click();
        if (group) requestAnimationFrame(() => this.inner());
      },
    }));
    this.show('tab', tips);
  }

  private show(level: 'top' | 'tab', tips: Tip[]): void {
    this.level = level;
    this.typed = '';
    this.tips = tips.filter((t) => t.code);
    while (this.pool.length < this.tips.length) { const b = el('<span class="rb-keytip"></span>'); this.pool.push(b); this.layer.appendChild(b); }
    const vw = window.innerWidth;
    this.pool.forEach((b, i) => {
      const t = this.tips[i];
      if (!t) { setHidden(b, true); return; }
      const r = t.node.getBoundingClientRect();
      if (b.textContent !== t.code) b.textContent = t.code;
      const small = level === 'tab' && !t.node.classList.contains('is-large') && r.width > 2 * r.height;
      b.style.left = `${Math.round(Math.max(2, Math.min(vw - 24, small ? r.left + 10 : r.left + r.width / 2)))}px`;
      const below = level === 'top' ? r.bottom - 4 : small ? r.top + r.height / 2 - 2 : r.bottom - 8;
      b.style.top = `${Math.round(below + 18 > window.innerHeight ? r.top - 14 : below)}px`;
      setHidden(b, !r.width && !r.height);
    });
    this.paint();
    setHidden(this.layer, false);
  }

  private paint(): void {
    this.tips.forEach((t, i) => setClass(this.pool[i], 'is-dim', !!this.typed && !t.code.startsWith(this.typed)));
  }

  hide(): void {
    if (!this.level) return;
    this.level = '';
    this.typed = '';
    this.tips = [];
    setHidden(this.layer, true);
  }
}
