import type { Changed } from '../engine';
import { a1 } from '../grid/a1';
import type { Grid } from '../grid/grid';
import { registerCommand } from '../ui/commands';
import { icon } from '../ui/icons';
import { api, el } from './dom';
import { HostCalls } from './hostCalls';
import { blankAuto, type Auto, type Env, type Script } from './model';
import { ScriptRunner, type RunResult } from './scripts';
import { AssistantTab } from './tabAssistant';
import { DataTab } from './tabData';
import { MoreTab } from './tabMore';
import { ScriptsTab } from './tabScripts';
import { strip } from './tsStrip';

export interface AppHooks {
  grid: Grid;
  book(): number;
  id(): string;
  sheets(): string[];
  title(): string;
  status(text: string, error?: boolean): void;
  addSheet(name: string): Promise<number>;
}

function compiled(s: Script): Script {
  if (!/@customfunction/.test(s.code)) {
    const rest = { ...s };
    delete rest.js;
    return rest;
  }
  try {
    return { ...s, js: strip(s.code) };
  } catch {
    return s;
  }
}

const TABS: [string, string][] = [['scripts', 'Scripts'], ['assistant', 'Assistant'], ['data', 'Data'], ['more', 'More']];

export class Automation {
  private readonly auto: Auto = blankAuto();
  private readonly panel: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly runner: ScriptRunner;
  private readonly calls: HostCalls;
  private readonly scripts: ScriptsTab;
  private readonly assistant: AssistantTab;
  private readonly data: DataTab;
  private readonly more: MoreTab;
  private readonly panes: Record<string, HTMLElement>;
  private saveTimer = 0;
  private editTimer = 0;
  private drainTimer = 0;
  private customTimer = 0;
  private fns = new Map<string, [Script, string]>();
  private quiet = false;
  private openId = '';
  private drag: { id: string; dx: number; dy: number; moved: boolean } | null = null;

  constructor(private readonly h: AppHooks) {
    this.runner = new ScriptRunner({
      book: () => h.book(),
      sheets: () => h.sheets(),
      title: () => h.title(),
      grid: h.grid,
      addSheet: (n) => h.addSheet(n),
      log: (l, t) => this.scripts.log(l, t),
    });
    this.calls = new HostCalls({
      book: () => h.book(),
      patch: (c) => h.grid.patch(c),
      custom: (name, args) => {
        const f = this.fns.get(name.toUpperCase());
        if (!f) throw new Error(`${name} is not defined in any script.`);
        return this.runner.call(f[0].code, f[1], args);
      },
      note: (t) => h.status(t.slice(0, 140), true),
    });
    const env: Env = {
      auto: this.auto,
      grid: h.grid,
      runner: this.runner,
      calls: this.calls,
      changed: () => this.persist(),
      book: () => h.book(),
      id: () => h.id(),
      sheets: () => h.sheets(),
      selection: () => h.grid.selection(),
      status: (t, e) => h.status(t, e),
      addSheet: (n) => h.addSheet(n),
      runScript: (id, ev) => this.runScript(id, ev),
      customChanged: () => this.customSoon(),
    };
    this.scripts = new ScriptsTab(env);
    this.assistant = new AssistantTab(env);
    this.data = new DataTab(env);
    this.more = new MoreTab(env, () => this.scripts.reload());
    this.panel = el('section', 'fc-auto');
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Automation');
    this.panel.innerHTML = `<header class="fc-auto-head"><div class="fc-auto-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" class="fc-auto-tab" role="tab" data-tab="${k}">${l}</button>`).join('')}</div><button type="button" class="fc-tool" data-act="close" title="Close" aria-label="Close">${icon('close')}</button></header><div class="fc-auto-body"></div>`;
    const body = this.panel.querySelector<HTMLElement>('.fc-auto-body')!;
    this.panes = { scripts: this.scripts.root, assistant: this.assistant.root, data: this.data.root, more: this.more.root };
    for (const p of Object.values(this.panes)) {
      p.hidden = true;
      body.appendChild(p);
    }
    this.panel.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab],[data-act]');
      if (!t) return;
      if (t.dataset.tab) this.show(t.dataset.tab);
      else if (t.dataset.act === 'close') this.panel.hidden = true;
    });
    this.layer = el('div', 'fc-btnlayer');
    const root = document.getElementById('overlay-root')!;
    root.appendChild(this.panel);
    root.appendChild(this.layer);
    this.layer.addEventListener('pointerdown', (e) => this.btnDown(e));
    this.layer.addEventListener('contextmenu', (e) => this.btnMenu(e));
    document.addEventListener('pointermove', (e) => this.btnMove(e));
    document.addEventListener('pointerup', () => this.btnUp());
    document.addEventListener('fc-buttons', () => this.paintButtons());
    window.addEventListener('resize', () => this.placeButtons());
    this.commands();
  }

  private commands(): void {
    const cmd = (id: string, title: string, description: string, run: () => void | Promise<void>) => registerCommand({ id, title, description, changes: false, run });
    cmd('automate.panel', 'Scripts', 'Open the script editor: write TypeScript against the FormCel workbook API, run it, record actions, add buttons and triggers.', () => this.show('scripts'));
    cmd('assistant.panel', 'Assistant', 'Open the assistant: ask about the selection, get formulas, tables and filled columns as proposals you apply yourself. It needs a model endpoint you set.', () => this.show('assistant'));
    cmd('data.panel', 'Data connections', 'Import web tables, build and refresh queries from CSV, JSON, web tables, sheets and SQLite files.', () => this.show('data'));
    cmd('automate.record', 'Record actions', 'Start recording cell edits, formats and sorts into a script.', () => {
      this.show('scripts');
      (this.panes.scripts.querySelector('[data-a="record"]') as HTMLButtonElement).click();
    });
    cmd('automate.run', 'Run script', 'Run the script shown in the script editor.', () => void this.scripts.runCurrent());
    cmd('data.refresh', 'Refresh all data', 'Fetch web functions and run every saved query again.', async () => {
      await this.calls.drain(true, true);
      for (const q of this.auto.queries) await this.data.refresh(q.id);
    });
  }

  show(tab: string): void {
    for (const [k, p] of Object.entries(this.panes)) p.hidden = k !== tab;
    for (const b of this.panel.querySelectorAll<HTMLElement>('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    this.panel.hidden = false;
    if (tab === 'assistant') void this.assistant.load();
    if (tab === 'more') void this.more.load();
    if (tab === 'data') this.data.reload();
  }

  opened(id: string, raw: Partial<Auto> | undefined): void {
    this.openId = id;
    Object.assign(this.auto, blankAuto(), raw ?? {});
    this.calls.reset();
    this.fns = new Map();
    this.scripts.reload();
    this.data.reload();
    this.data.start();
    this.more.paintButtons();
    this.paintButtons();
    this.layer.hidden = false;
    void this.calls.drain();
    this.customSoon();
    window.setTimeout(() => {
      for (const s of this.auto.scripts) if (s.triggers?.open) void this.runScript(s.id, { type: 'open' });
      this.data.openOnOpen();
    }, 600);
  }

  closed(): void {
    this.openId = '';
    this.panel.hidden = true;
    this.layer.hidden = true;
    this.scripts.stopTimers();
    this.data.stop();
    this.runner.stop();
  }

  edited(changes: Changed[]): void {
    window.clearTimeout(this.drainTimer);
    this.drainTimer = window.setTimeout(() => void this.calls.drain(), 80);
    if (this.quiet || !this.auto.scripts.some((s) => s.triggers?.edit)) return;
    const [s, r, c] = changes[0] ?? [0, 0, 0];
    window.clearTimeout(this.editTimer);
    this.editTimer = window.setTimeout(() => {
      for (const sc of this.auto.scripts) if (sc.triggers?.edit) void this.runScript(sc.id, { type: 'edit', sheet: this.h.sheets()[s] ?? '', address: a1(r, c) });
    }, 700);
  }

  private async runScript(id: string, event?: unknown): Promise<RunResult> {
    const s = this.auto.scripts.find((x) => x.id === id);
    if (!s) return { ok: false, error: 'That script no longer exists.' };
    this.quiet = true;
    try {
      const r = await this.runner.run(s.code, event);
      if (!r.ok) {
        this.scripts.log('error', r.error ?? 'The script failed.');
        this.h.status(`${s.name}: ${r.error ?? 'failed'}`.slice(0, 140), true);
      }
      return r;
    } finally {
      window.setTimeout(() => {
        this.quiet = false;
      }, 900);
      void this.calls.drain();
    }
  }

  private customSoon(): void {
    window.clearTimeout(this.customTimer);
    this.customTimer = window.setTimeout(async () => {
      await this.scripts.customNames();
      const raw = new Map<string, [Script, string]>();
      for (const s of this.auto.scripts) for (const n of await this.runner.scan(s.code)) raw.set(n.toUpperCase(), [s, n]);
      this.fns = raw;
      await this.calls.setCustom([...raw.keys()]);
    }, 300);
  }

  private persist(): void {
    window.clearTimeout(this.saveTimer);
    const id = this.openId;
    this.saveTimer = window.setTimeout(() => {
      if (!id || id !== this.openId) return;
      const { queries, buttons, settings } = this.auto;
      const scripts = this.auto.scripts.map((s) => compiled(s));
      void api('PUT', `/api/workbooks/${id}/automation`, { scripts, queries, buttons, settings }).catch((err: unknown) => this.h.status(err instanceof Error ? err.message : 'Scripts were not saved', true));
    }, 700);
  }

  private paintButtons(): void {
    const want = this.auto.buttons;
    const have = [...this.layer.children] as HTMLElement[];
    for (const b of want) {
      let node = have.find((n) => n.dataset.id === b.id);
      if (!node) {
        node = el('button', 'fc-btn fc-auto-button');
        node.setAttribute('type', 'button');
        node.dataset.id = b.id;
        this.layer.appendChild(node);
      }
      if (node.textContent !== b.label) node.textContent = b.label;
    }
    for (const n of have) if (!want.some((b) => b.id === n.dataset.id)) n.remove();
    this.placeButtons();
  }

  private placeButtons(): void {
    const r = this.h.grid.el.getBoundingClientRect();
    for (const n of this.layer.children as HTMLCollectionOf<HTMLElement>) {
      const b = this.auto.buttons.find((x) => x.id === n.dataset.id);
      if (!b) continue;
      n.style.left = `${Math.round(r.left + b.x)}px`;
      n.style.top = `${Math.round(r.top + b.y)}px`;
    }
  }

  private btnDown(e: PointerEvent): void {
    const n = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
    if (!n || e.button !== 0) return;
    const b = this.auto.buttons.find((x) => x.id === n.dataset.id);
    if (!b) return;
    const g = this.h.grid.el.getBoundingClientRect();
    this.drag = { id: b.id, dx: e.clientX - (g.left + b.x), dy: e.clientY - (g.top + b.y), moved: false };
  }

  private btnMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const b = this.auto.buttons.find((x) => x.id === d.id);
    if (!b) return;
    const g = this.h.grid.el.getBoundingClientRect();
    const x = e.clientX - g.left - d.dx;
    const y = e.clientY - g.top - d.dy;
    if (!d.moved && Math.abs(x - b.x) + Math.abs(y - b.y) < 5) return;
    d.moved = true;
    b.x = Math.max(0, Math.min(g.width - 40, Math.round(x)));
    b.y = Math.max(0, Math.min(g.height - 24, Math.round(y)));
    this.placeButtons();
  }

  private btnUp(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.moved) this.persist();
    else {
      const b = this.auto.buttons.find((x) => x.id === d.id);
      if (b) void this.runScript(b.script, { type: 'button' }).then(() => this.h.grid.focus());
    }
  }

  private btnMenu(e: MouseEvent): void {
    const n = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
    if (!n) return;
    e.preventDefault();
    this.show('more');
  }
}
