import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { ChatPane } from './chat-pane';
import { ApiError, dockApi as api, socketTo, type TerminalInfo } from './dock-api';
import { el, isMac, setDisabled, setHidden, setText } from './rb-dom';
import { icon } from './icons';

export type DockKind = 'shell' | 'claude' | 'chat';

const KEY = 'formcel.terminal';
const MIN_H = 120;

interface Tab {
  id: string;
  term: Terminal;
  fit: FitAddon;
  host: HTMLElement;
  tab: HTMLElement;
  socket: WebSocket | null;
  kind: 'shell' | 'claude' | 'agent';
  seen: boolean;
  closed: boolean;
}

function q<T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T {
  return root.querySelector<T>(sel)!;
}

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function termFontSize(): number {
  const n = parseFloat(token('--text-md', '13'));
  return n > 0 ? n : 13;
}

function saved(): { open: boolean; h: number } {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { open?: boolean; h?: number };
    return { open: s.open === true, h: typeof s.h === 'number' ? s.h : 280 };
  } catch { return { open: false, h: 280 }; }
}

function keep(open: boolean, h: number): void {
  try { localStorage.setItem(KEY, JSON.stringify({ open, h })); } catch { return; }
}

export class TerminalDock {
  readonly root = el(`<section class="ft-dock" aria-label="Terminal">
    <div class="ft-dock-grip" role="separator" aria-orientation="horizontal" aria-label="Resize the terminal"></div>
    <div class="ft-dock-head">
      <div class="ft-dock-tabs" role="tablist" aria-label="Terminals"></div>
      <span class="ft-dock-spacer"></span>
      <button type="button" class="fc-tool ft-dock-new" title="New Terminal" aria-label="New Terminal">${icon('plus')}</button>
      <button type="button" class="fc-tool ft-dock-chat" title="Chat with Claude about your workbook" aria-label="Chat with Claude">${icon('agentChat')}</button>
      <button type="button" class="fc-tool ft-dock-claude" title="Claude Code" aria-label="Claude Code">${icon('agent')}</button>
      <button type="button" class="fc-tool ft-dock-restart" title="Restart this tab" aria-label="Restart this tab">${icon('refresh')}</button>
      <button type="button" class="fc-tool ft-dock-hide" title="Hide Terminal (${isMac ? 'Cmd' : 'Ctrl'}+J); programs keep running" aria-label="Hide Terminal">${icon('close')}</button>
    </div>
    <div class="ft-dock-stage"><p class="ft-dock-empty fc-note" hidden>No terminal is open. Start a shell with the plus button, Claude Code with the agent button, or Chat with the speech bubble.</p>
      <div class="ft-dock-note" role="status" hidden><span class="ft-dock-note-text"></span><code class="ft-dock-note-cmd" hidden></code><button type="button" class="fc-btn ft-dock-note-copy" hidden>Copy</button><button type="button" class="fc-tool ft-dock-note-x" title="Dismiss" aria-label="Dismiss">${icon('close')}</button></div></div>
    <form class="ft-dock-ask" autocomplete="off">
      <span class="ft-dock-ask-mark">${icon('agent')}</span>
      <input class="fc-input ft-dock-ask-input" type="text" spellcheck="false" placeholder="Ask Claude Code to work on your workbook" aria-label="Ask Claude Code">
      <button type="submit" class="fc-tool ft-dock-ask-send" title="Send to Claude Code" aria-label="Send to Claude Code">${icon('send')}</button>
    </form>
  </section>`);
  private readonly tabsEl = q(this.root, '.ft-dock-tabs');
  private readonly stage = q(this.root, '.ft-dock-stage');
  private readonly empty = q(this.root, '.ft-dock-empty');
  private readonly note = q(this.root, '.ft-dock-note');
  private readonly noteText = q(this.root, '.ft-dock-note-text');
  private readonly noteCmd = q(this.root, '.ft-dock-note-cmd');
  private readonly noteCopy = q<HTMLButtonElement>(this.root, '.ft-dock-note-copy');
  private readonly ask = q<HTMLInputElement>(this.root, '.ft-dock-ask-input');
  private readonly restartBtn = q<HTMLButtonElement>(this.root, '.ft-dock-restart');
  private readonly tabs = new Map<string, Tab>();
  private chat: ChatPane | null = null;
  private chatTab: HTMLElement | null = null;
  private active: string | null = null;
  private started = false;
  private pending: Promise<void> | null = null;
  private look = '';
  onTab: () => void = () => undefined;

  constructor() {
    const html = document.documentElement;
    q(this.root, '.ft-dock-new').addEventListener('click', () => void this.open());
    q(this.root, '.ft-dock-claude').addEventListener('click', () => void this.claude());
    q(this.root, '.ft-dock-chat').addEventListener('click', () => void this.showChat());
    q(this.root, '.ft-dock-hide').addEventListener('click', () => this.toggle(false));
    this.restartBtn.addEventListener('click', () => void this.restart());
    q(this.root, '.ft-dock-ask').addEventListener('submit', (e) => { e.preventDefault(); void this.send(); });
    q(this.root, '.ft-dock-note-x').addEventListener('click', () => this.dismiss());
    this.noteCopy.addEventListener('click', () => { void navigator.clipboard?.writeText(this.noteCmd.textContent ?? '').catch(() => undefined); });
    this.ask.addEventListener('keydown', (e) => { e.stopPropagation(); });
    new ResizeObserver(() => this.fitActive()).observe(this.stage);
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyJ' && !e.repeat && !document.querySelector('.fc-modal:not([hidden])')) { e.preventDefault(); e.stopPropagation(); this.toggle(); }
    }, true);
    this.look = JSON.stringify(this.theme());
    new MutationObserver(() => this.retheme()).observe(html, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    this.grip(q(this.root, '.ft-dock-grip'), html);
  }

  start(): void {
    if (this.isOpen()) void this.ensure();
  }

  isOpen(): boolean { return document.documentElement.getAttribute('data-ft-dock') === 'open'; }

  toggle(on = !this.isOpen(), seed: DockKind | 'none' = 'shell'): void {
    const html = document.documentElement;
    html.setAttribute('data-ft-dock', on ? 'open' : 'closed');
    keep(on, this.height());
    window.dispatchEvent(new Event('resize'));
    if (on) void this.ensure(seed);
    this.onTab();
  }

  async newTerminal(): Promise<void> {
    if (!this.isOpen()) this.toggle(true);
    else await this.open();
  }

  activeKind(): DockKind | null {
    if (this.active === 'chat') return 'chat';
    const kind = this.active ? this.tabs.get(this.active)?.kind : undefined;
    return kind === 'shell' || kind === 'claude' ? kind : null;
  }

  isShowing(kind: DockKind): boolean { return this.isOpen() && this.activeKind() === kind; }

  async show(kind: DockKind): Promise<void> {
    if (!this.isOpen()) this.toggle(true, 'none');
    await this.ensure('none');
    if (kind === 'chat') { await this.showChat(); return; }
    const own = [...this.tabs.values()].find((x) => x.kind === kind);
    if (own) this.select(own.id);
    else if (kind === 'claude') await this.claude();
    else await this.open();
  }

  async toggleKind(kind: DockKind): Promise<void> {
    if (this.isShowing(kind)) this.toggle(false);
    else await this.show(kind);
  }

  async sync(): Promise<void> {
    if (!this.started) return;
    for (const info of await this.list()) if (info.kind === 'agent') this.adopt(info);
  }

  private height(): number {
    const h = Number(document.documentElement.getAttribute('data-ft-dock-h'));
    return Number.isFinite(h) && h >= MIN_H ? h : saved().h;
  }

  private grip(grip: HTMLElement, html: HTMLElement): void {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const bottom = this.root.getBoundingClientRect().bottom;
      const move = (ev: PointerEvent): void => {
        const h = Math.round(Math.min(window.innerHeight * 0.7, Math.max(MIN_H, bottom - ev.clientY)));
        html.setAttribute('data-ft-dock-h', String(h));
        html.style.setProperty('--ft-dock-size', `${h}px`);
      };
      const up = (): void => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        keep(this.isOpen(), this.height());
        window.dispatchEvent(new Event('resize'));
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
  }

  private async list(): Promise<TerminalInfo[]> {
    try { return await api.terminals(); } catch { return []; }
  }

  private ensure(seed: DockKind | 'none' = 'shell'): Promise<void> {
    this.pending ??= this.boot(seed).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async boot(seed: DockKind | 'none'): Promise<void> {
    if (!this.started) {
      this.started = true;
      const listed = await this.list();
      for (const info of listed) this.adopt(info);
    }
    const shown = !!this.chatTab || [...this.tabs.values()].some((x) => x.kind !== 'agent');
    if (!shown && seed === 'shell') await this.open();
    setHidden(this.empty, !!this.chatTab || this.tabs.size > 0);
    this.fitActive();
    this.focus();
    this.onTab();
  }

  focus(): void {
    if (this.active === 'chat') this.ask.focus({ preventScroll: true });
    else if (this.active) this.tabs.get(this.active)?.term.focus();
  }

  async showChat(): Promise<void> {
    if (!this.chat) {
      const chat = new ChatPane();
      chat.onFail = (err) => this.warn(err);
      chat.onHandoff = (session) => void this.claude(undefined, session);
      chat.onBash = () => void this.sync();
      this.chat = chat;
      this.stage.appendChild(chat.root);
    }
    if (!this.chatTab) {
      const tab = el(`<button type="button" class="ft-dock-tab is-chat" role="tab" aria-selected="false">${icon('agentChat')}<span class="ft-dock-tab-title">Chat</span><span class="ft-dock-tab-x" role="button" aria-label="Close the Chat tab">${icon('close')}</span></button>`);
      tab.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.ft-dock-tab-x')) this.closeChat();
        else this.select('chat');
      });
      this.tabsEl.prepend(tab);
      this.chatTab = tab;
    }
    setHidden(this.empty, true);
    this.select('chat');
    await this.chat.load();
  }

  private closeChat(): void {
    this.chatTab?.remove();
    this.chatTab = null;
    this.chat?.release();
    if (this.chat) setHidden(this.chat.root, true);
    if (this.active === 'chat') {
      this.active = null;
      const next = [...this.tabs.keys()].pop();
      if (next) this.select(next);
      else { setHidden(this.empty, false); this.syncAsk(); setDisabled(this.restartBtn, true); this.onTab(); }
    }
  }

  private syncAsk(): void {
    const chat = this.active === 'chat';
    const text = chat ? 'Ask Claude about your workbook (Enter to send)' : 'Ask Claude Code to work on your workbook';
    if (this.ask.placeholder !== text) this.ask.placeholder = text;
  }

  private async send(): Promise<void> {
    const text = this.ask.value.trim();
    if (!text) return;
    if (this.active === 'chat' && this.chat) {
      if (this.chat.isBusy()) return;
      this.ask.value = '';
      await this.chat.send(text);
      return;
    }
    this.ask.value = '';
    const ok = await this.claude(text);
    if (!ok && !this.ask.value) this.ask.value = text;
  }

  private say(text: string, cmd = ''): void {
    setText(this.noteText, text);
    setText(this.noteCmd, cmd);
    setHidden(this.noteCmd, cmd === '');
    setHidden(this.noteCopy, cmd === '');
    setHidden(this.note, false);
  }

  private dismiss(): void { setHidden(this.note, true); }

  private warn(err: unknown): void {
    this.say(err instanceof Error ? err.message : 'The request failed.');
  }

  private async fail(err: unknown, what: 'shell' | 'claude'): Promise<void> {
    if (what === 'shell') { this.warn(err); return; }
    const status = await api.claudeCodeStatus();
    if (status && !status.installed) {
      this.say('Claude Code is not installed. Install it with the command below, then sign in once by running claude in a terminal.', status.install);
      return;
    }
    if (err instanceof ApiError && (err.status === 404 || err.status === 405) && /^(Not Found|Method Not Allowed)$/i.test(err.message)) this.say('This copy of the FormCel engine cannot run Claude Code in a tab yet. Restart the engine, then try again.');
    else this.say(`Claude Code could not be started. ${err instanceof Error ? err.message : ''}`.trim());
  }

  private theme() {
    return {
      background: token('--bg-primary', '#111111'),
      foreground: token('--text-primary', '#f7f7f7'),
      cursor: token('--accent-color', '#f97316'),
      cursorAccent: token('--bg-primary', '#111111'),
      selectionBackground: token('--accent-color-dim', '#f9731633'),
    };
  }

  private retheme(): void {
    const theme = this.theme();
    const look = JSON.stringify(theme);
    if (look === this.look) return;
    this.look = look;
    const size = termFontSize();
    for (const x of this.tabs.values()) { x.term.options.theme = theme; if (x.term.options.fontSize !== size) x.term.options.fontSize = size; }
    this.fitActive();
  }

  private adopt(info: TerminalInfo): void {
    if (this.tabs.has(info.id)) return;
    this.mount(info, this.active === null || info.kind !== 'agent');
  }

  private async open(): Promise<void> {
    try {
      const info = await api.openTerminal(100, 24);
      this.mount(info, true);
      this.dismiss();
    } catch (err) { await this.fail(err, 'shell'); }
  }

  async claude(prompt?: string, resume?: string): Promise<boolean> {
    const size = this.size();
    try {
      const info = await api.openClaude({ prompt: prompt || undefined, resume: resume || undefined, cols: size.cols, rows: size.rows });
      if (!this.isOpen()) this.toggle(true, 'none');
      if (this.tabs.has(info.id)) this.select(info.id);
      else this.mount(info, true);
      this.dismiss();
      return true;
    } catch (err) {
      await this.fail(err, 'claude');
      return false;
    }
  }

  private size(): { cols: number; rows: number } {
    const tab = this.active ? this.tabs.get(this.active) : null;
    return tab ? { cols: tab.term.cols, rows: tab.term.rows } : { cols: 100, rows: 20 };
  }

  private mount(info: TerminalInfo, show: boolean): void {
    if (this.tabs.has(info.id)) { if (show) this.select(info.id); return; }
    const kind = info.kind === 'claude' || info.kind === 'agent' ? info.kind : 'shell';
    const agent = kind === 'agent';
    const term = new Terminal({
      fontFamily: token('--font-mono', 'monospace'), fontSize: termFontSize(), lineHeight: 1.25, cursorBlink: !agent, disableStdin: agent,
      scrollback: 5000, theme: this.theme(), overviewRuler: { width: 0 },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const host = el('<div class="ft-term" hidden></div>');
    const tab = el(`<button type="button" class="ft-dock-tab${kind === 'claude' ? ' is-claude' : ''}${agent ? ' is-agent' : ''}" role="tab" aria-selected="false">${icon(kind === 'claude' ? 'agent' : 'terminal')}<span class="ft-dock-tab-title"></span><span class="ft-dock-tab-x" role="button" aria-label="Close this tab">${icon('close')}</span></button>`);
    setText(q(tab, '.ft-dock-tab-title'), info.title);
    if (agent) tab.title = "Claude's commands, read only";
    tab.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.ft-dock-tab-x')) void this.close(info.id);
      else this.select(info.id);
    });
    this.stage.appendChild(host);
    this.tabsEl.appendChild(tab);
    const entry: Tab = { id: info.id, term, fit, host, tab, socket: null, kind, seen: false, closed: false };
    this.tabs.set(info.id, entry);
    setHidden(this.empty, true);
    term.open(host);
    if (agent) term.write('\x1b[?25l');
    if (show) this.select(info.id, !agent);
    this.connect(entry);
  }

  private connect(entry: Tab): void {
    const socket = socketTo(`/terminal/${entry.id}/stream`);
    socket.binaryType = 'arraybuffer';
    entry.socket = socket;
    socket.addEventListener('open', () => this.sendSize(entry));
    socket.addEventListener('message', (msg) => {
      entry.seen = true;
      if (typeof msg.data === 'string') { entry.term.write(msg.data); return; }
      try {
        const ctl = JSON.parse(new TextDecoder().decode(msg.data as ArrayBuffer)) as { type?: string };
        if (ctl.type === 'exit') entry.term.write(`\r\n\x1b[2m[${entry.kind === 'claude' ? 'Claude Code' : 'shell'} exited · Restart runs it again]\x1b[0m\r\n`);
      } catch { return; }
    });
    socket.addEventListener('close', () => {
      if (!entry.seen && !entry.closed) entry.term.write('\r\n\x1b[2m[The engine did not answer on this terminal. Restart the engine, then close this tab and open it again.]\x1b[0m\r\n');
    });
    entry.term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }));
    });
  }

  private sendSize(x: Tab): void {
    if (x.socket?.readyState === WebSocket.OPEN) x.socket.send(JSON.stringify({ type: 'resize', cols: x.term.cols, rows: x.term.rows }));
  }

  private fitActive(): void {
    const x = this.active ? this.tabs.get(this.active) : null;
    if (!x || x.host.hidden || this.stage.clientHeight < 20) return;
    const before = `${x.term.cols}x${x.term.rows}`;
    x.fit.fit();
    if (`${x.term.cols}x${x.term.rows}` !== before) this.sendSize(x);
  }

  private select(id: string, focus = true): void {
    this.active = id;
    for (const [tid, x] of this.tabs) {
      const on = tid === id;
      setHidden(x.host, !on);
      x.tab.classList.toggle('is-on', on);
      x.tab.setAttribute('aria-selected', String(on));
    }
    if (this.chat) setHidden(this.chat.root, id !== 'chat');
    if (this.chatTab) {
      this.chatTab.classList.toggle('is-on', id === 'chat');
      this.chatTab.setAttribute('aria-selected', String(id === 'chat'));
    }
    this.syncAsk();
    setDisabled(this.restartBtn, id === 'chat' || this.tabs.get(id)?.kind === 'agent');
    this.fitActive();
    if (focus) this.focus();
    this.onTab();
  }

  private async restart(): Promise<void> {
    const x = this.active ? this.tabs.get(this.active) : null;
    if (!x || x.kind === 'agent') return;
    try { await api.restartTerminal(x.id); } catch (err) { this.warn(err); return; }
    this.sendSize(x);
    x.term.focus();
  }

  private async close(id: string): Promise<void> {
    const x = this.tabs.get(id);
    if (!x) return;
    x.closed = true;
    x.socket?.close();
    x.term.dispose();
    x.host.remove();
    x.tab.remove();
    this.tabs.delete(id);
    await api.closeTerminal(id).catch(() => undefined);
    if (this.active === id) {
      this.active = null;
      const next = [...this.tabs.keys()].pop() ?? (this.chatTab ? 'chat' : undefined);
      if (next) this.select(next);
      else { setDisabled(this.restartBtn, true); this.syncAsk(); this.onTab(); }
    }
    setHidden(this.empty, this.tabs.size > 0 || !!this.chatTab);
  }
}
