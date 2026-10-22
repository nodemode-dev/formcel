import { api, el, esc, setText } from './dom';
import type { Env } from './model';

interface Trigger {
  id: string;
  fn: string;
  type: 'time' | 'open' | 'edit' | 'change';
  every: number;
  daily: string;
  weekday: string;
  enabled: boolean;
  failures: number;
  last: { at: number; ok: boolean; ms: number; error: string } | null;
}

interface Run {
  at: number;
  fn: string;
  kind: string;
  ok: boolean;
  ms: number;
  error: string;
  line: number;
  log: string;
}

interface MenuItem {
  caption?: string;
  fn?: string;
  separator?: boolean;
  items?: MenuItem[];
}

interface Overview {
  available: boolean;
  runtime: string;
  functions: string[];
  triggers: Trigger[];
  runs: Run[];
  menus: { name: string; items: MenuItem[] }[];
  properties: Record<string, string[]>;
}

const TYPES: [string, string][] = [['time', 'Time-driven'], ['open', 'On open'], ['edit', 'On edit'], ['change', 'On change']];

function when(at: number): string {
  return new Date(at * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function schedule(t: Trigger): string {
  if (t.type !== 'time') return TYPES.find((x) => x[0] === t.type)?.[1] ?? t.type;
  if (t.every) return t.every % 1440 === 0 ? `Every ${t.every / 1440} day${t.every === 1440 ? '' : 's'}` : t.every % 60 === 0 ? `Every ${t.every / 60} hour${t.every === 60 ? '' : 's'}` : `Every ${t.every} minute${t.every === 1 ? '' : 's'}`;
  return `${t.weekday ? `${t.weekday} ` : 'Daily '}at ${t.daily}`;
}

export class ServerTab {
  readonly root = el('div', 'fc-auto-pane');
  private readonly state: HTMLElement;
  private readonly funcs: HTMLElement;
  private readonly menus: HTMLElement;
  private readonly trigs: HTMLElement;
  private readonly runs: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly fn: HTMLSelectElement;
  private readonly kind: HTMLSelectElement;
  private readonly every: HTMLInputElement;
  private readonly daily: HTMLInputElement;
  private timer = 0;

  constructor(private readonly env: Env) {
    this.root.innerHTML = `
      <p class="fc-auto-hint fc-srv-state">Reading the engine process.</p>
      <h3 class="fc-auto-h">Functions in Apps Script files</h3>
      <p class="fc-auto-hint">A script that uses SpreadsheetApp, PropertiesService, UrlFetchApp or ScriptApp is an Apps Script file. It runs in the engine process, so triggers fire with the window closed. Functions named onOpen, onEdit and onChange are simple triggers.</p>
      <div class="fc-auto-list" data-l="funcs"></div>
      <h3 class="fc-auto-h">Custom menus</h3>
      <div class="fc-auto-list" data-l="menus"></div>
      <h3 class="fc-auto-h">Triggers</h3>
      <div class="fc-auto-row"><select class="fc-auto-input" data-f="fn" aria-label="Function"></select><select class="fc-auto-input" data-f="kind" aria-label="Event">${TYPES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><label class="fc-auto-small" data-w="every">every <input class="fc-auto-num" type="number" min="1" max="40320" value="5" data-f="every" aria-label="Minutes"> min</label><label class="fc-auto-small" data-w="daily">or daily at <input class="fc-auto-num fc-srv-time" type="time" data-f="daily" aria-label="Time of day"></label><button type="button" class="fc-btn fc-btn-primary" data-a="add">Add trigger</button></div>
      <p class="fc-auto-hint fc-srv-msg" aria-live="polite"></p>
      <div class="fc-auto-list" data-l="trigs"></div>
      <h3 class="fc-auto-h">Recent runs</h3>
      <div class="fc-auto-list" data-l="runs"></div>`;
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.state = q('.fc-srv-state');
    this.funcs = q('[data-l="funcs"]');
    this.menus = q('[data-l="menus"]');
    this.trigs = q('[data-l="trigs"]');
    this.runs = q('[data-l="runs"]');
    this.msg = q('.fc-srv-msg');
    this.fn = q('[data-f="fn"]');
    this.kind = q('[data-f="kind"]');
    this.every = q('[data-f="every"]');
    this.daily = q('[data-f="daily"]');
    this.kind.addEventListener('change', () => this.shape());
    this.daily.addEventListener('input', () => {
      this.every.disabled = !!this.daily.value;
    });
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'add') void this.add();
      else if (a === 'run') void this.runFn(b.dataset.fn ?? '');
      else if (a === 'trun') void this.act('POST', `/server-triggers/${b.dataset.id}/run`);
      else if (a === 'tdel') void this.act('DELETE', `/server-triggers/${b.dataset.id}`);
      else if (a === 'ton') void this.act('PATCH', `/server-triggers/${b.dataset.id}`, { enabled: b.dataset.on === '1' });
    });
    this.shape();
  }

  private shape(): void {
    const time = this.kind.value === 'time';
    for (const w of this.root.querySelectorAll<HTMLElement>('[data-w]')) w.style.visibility = time ? '' : 'hidden';
  }

  private url(path: string): string {
    return `/api/workbooks/${this.env.id()}${path}`;
  }

  private async act(method: string, path: string, body?: unknown): Promise<void> {
    try {
      await api(method, this.url(path), body);
      setText(this.msg, '');
    } catch (err) {
      setText(this.msg, err instanceof Error ? err.message : String(err));
    }
    await this.load();
  }

  private async add(): Promise<void> {
    const time = this.kind.value === 'time';
    const body = { fn: this.fn.value, type: this.kind.value, every: time && !this.daily.value ? Number(this.every.value) || 0 : 0, daily: time ? this.daily.value : '' };
    await this.act('POST', '/server-triggers', body);
  }

  private async runFn(fn: string): Promise<void> {
    setText(this.msg, `Running ${fn} in the engine process.`);
    try {
      const r = await api<{ ok: boolean; error: string; logs: string[]; toasts: { message: string }[]; alerts: string[]; ms: number; result: unknown }>('POST', this.url('/server-scripts/run'), { fn });
      for (const l of r.logs) this.env.status(l.slice(0, 140));
      const said = [...r.toasts.map((t) => t.message), ...r.alerts];
      setText(this.msg, r.ok ? `${fn} finished in ${r.ms} ms.${said.length ? ` ${said.join(' ')}` : ''}${r.logs.length ? ` Log: ${r.logs.join(' | ')}` : ''}` : `${fn} failed: ${r.error}`);
      if (r.ok) this.env.status(said[0] ?? `${fn} finished`);
      else this.env.status(`${fn}: ${r.error}`.slice(0, 140), true);
    } catch (err) {
      setText(this.msg, err instanceof Error ? err.message : String(err));
    }
    await this.load();
  }

  async load(): Promise<void> {
    if (!this.timer) this.timer = window.setInterval(() => !this.root.hidden && void this.load(), 5000);
    let d: Overview;
    try {
      d = await api<Overview>('GET', this.url('/server-scripts'));
    } catch {
      setText(this.state, 'The engine process could not be reached.');
      return;
    }
    setText(this.state, d.available ? `Apps Script files run in ${d.runtime} inside the engine process.` : 'No JavaScript runtime was found, so Apps Script files cannot run in the engine process. Install Node.js and restart.');
    this.reconcile(this.funcs, d.functions.map((f) => ({ key: f, html: `<span class="fc-grow"><code>${esc(f)}()</code></span><button type="button" class="fc-btn" data-a="run" data-fn="${esc(f)}">Run</button>`, text: f })));
    const have = [...this.fn.options].map((o) => o.value).join('\n');
    if (have !== d.functions.join('\n')) {
      const keep = this.fn.value;
      this.fn.replaceChildren(...d.functions.map((f) => Object.assign(el('option'), { value: f, textContent: f })));
      if (d.functions.includes(keep)) this.fn.value = keep;
    }
    const items: { key: string; html: string; text: string }[] = [];
    const walk = (menu: string, list: MenuItem[], depth: number) => {
      list.forEach((m, i) => {
        if (m.separator) return;
        if (m.items) walk(menu, m.items, depth + 1);
        else items.push({ key: `${menu}/${depth}/${i}/${m.caption}`, html: `<span class="fc-grow">${esc(menu)} &gt; ${esc(m.caption ?? '')}<small>${esc(m.fn ?? '')}</small></span><button type="button" class="fc-btn" data-a="run" data-fn="${esc(m.fn ?? '')}">Run</button>`, text: `${menu} > ${m.caption}` });
      });
    };
    for (const m of d.menus) walk(m.name, m.items, 0);
    this.reconcile(this.menus, items, 'A menu appears here after onOpen runs and calls createMenu(...).addToUi().');
    this.reconcile(this.trigs, d.triggers.map((t) => {
      const last = t.last ? `${t.last.ok ? 'Last run' : 'Failed'} ${when(t.last.at)} (${t.last.ms} ms)${t.last.ok ? '' : `: ${t.last.error}`}` : 'Not run yet';
      const state = !t.enabled ? `Disabled after ${t.failures} failures or by you` : t.failures ? `${t.failures} failure${t.failures === 1 ? '' : 's'} in a row` : 'Active';
      return {
        key: t.id,
        text: `${t.fn} ${schedule(t)} ${last} ${state}`,
        html: `<span class="fc-grow"><code>${esc(t.fn)}()</code> ${esc(schedule(t))}<small>${esc(last)}. ${esc(state)}.</small></span><button type="button" class="fc-btn" data-a="trun" data-id="${t.id}">Run now</button><button type="button" class="fc-btn" data-a="ton" data-id="${t.id}" data-on="${t.enabled ? '0' : '1'}">${t.enabled ? 'Disable' : 'Enable'}</button><button type="button" class="fc-btn fc-btn-danger" data-a="tdel" data-id="${t.id}">Delete</button>`,
      };
    }), 'No triggers. Add one above or create one in a script with ScriptApp.newTrigger.');
    this.reconcile(this.runs, [...d.runs].reverse().slice(0, 15).map((r) => ({ key: `${r.at}${r.fn}`, text: `${r.fn} ${r.ok}`, html: `<span class="fc-grow"><code>${esc(r.fn)}()</code> ${esc(r.kind)} ${r.ok ? 'ok' : 'failed'}<small>${esc(when(r.at))}, ${r.ms} ms${r.ok ? '' : `: ${esc(r.error)}${r.line ? ` (line ${r.line})` : ''}`}${r.log ? ` | ${esc(r.log.replace(/\n/g, ' | '))}` : ''}</small></span>` })), 'Nothing has run yet.');
  }

  private reconcile(host: HTMLElement, rows: { key: string; html: string; text: string }[], empty = ''): void {
    const have = new Map([...host.querySelectorAll<HTMLElement>(':scope > [data-k]')].map((n) => [n.dataset.k ?? '', n]));
    const hint = host.querySelector<HTMLElement>(':scope > .fc-auto-hint');
    if (!rows.length && empty && !hint) host.appendChild(el('p', 'fc-auto-hint', esc(empty)));
    if (rows.length && hint) hint.remove();
    let prev: Element | null = null;
    for (const r of rows) {
      let n = have.get(r.key);
      if (!n) {
        n = el('div', 'fc-auto-item', r.html);
        n.dataset.k = r.key;
        n.dataset.t = r.text;
      } else if (n.dataset.t !== r.text) {
        n.innerHTML = r.html;
        n.dataset.t = r.text;
      }
      have.delete(r.key);
      const at: ChildNode | null = prev ? prev.nextSibling : host.firstChild;
      if (n !== at) host.insertBefore(n, at);
      prev = n;
    }
    for (const n of have.values()) n.remove();
  }

  opened(): void {
    void this.api_open();
  }

  private async api_open(): Promise<void> {
    try {
      const r = await api<{ ran: { fn: string; ok: boolean; error: string }[] }>('POST', this.url('/server-scripts/open'));
      const bad = r.ran.find((x) => !x.ok);
      if (bad) this.env.status(`${bad.fn}: ${bad.error}`.slice(0, 140), true);
    } catch {
      return;
    }
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }
}
