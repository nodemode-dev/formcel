import { ApiError, dockApi as api, socketTo, type AgentEvent, type AgentMode, type ClaudeStatus } from './dock-api';
import { el, setClass, setDisabled, setHidden, setText } from './rb-dom';
import { icon } from './icons';

const LABELS: Record<AgentMode, string> = { ask: 'Ask', 'auto-edits': 'Auto-accept edits', plan: 'Plan' };

function q<T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T {
  return root.querySelector<T>(sel)!;
}

function toolName(name: string): string {
  return name.replace(/^mcp__/, '').replace(/__/g, ' ');
}

export class ChatPane {
  readonly root = el(`<div class="ft-chat" hidden>
<div class="ft-chat-bar"><span class="ft-chat-status fc-note"></span><span class="ft-dock-spacer"></span>
<select class="fc-input ft-chat-mode" aria-label="Permission mode"></select>
<button type="button" class="fc-btn ft-chat-stop" disabled>Stop</button>
<button type="button" class="fc-btn ft-chat-handoff" title="Continue this conversation in a Claude Code terminal tab">Continue in Claude Code</button>
<button type="button" class="fc-btn ft-chat-new">New Chat</button></div>
<div class="ft-chat-log" role="log" aria-live="polite"><div class="ft-chat-empty"><p class="fc-note ft-chat-empty-text"></p><div class="ft-chat-install" hidden><code class="ft-chat-install-cmd"></code><button type="button" class="fc-btn ft-chat-copy">Copy</button></div></div></div>
</div>`);
  onFail: (err: unknown) => void = () => undefined;
  onHandoff: (session: string) => void = () => undefined;
  onBash: () => void = () => undefined;
  private readonly log = q(this.root, '.ft-chat-log');
  private readonly empty = q(this.root, '.ft-chat-empty');
  private readonly emptyText = q(this.root, '.ft-chat-empty-text');
  private readonly install = q(this.root, '.ft-chat-install');
  private readonly statusEl = q(this.root, '.ft-chat-status');
  private readonly mode = q<HTMLSelectElement>(this.root, '.ft-chat-mode');
  private readonly stopBtn = q<HTMLButtonElement>(this.root, '.ft-chat-stop');
  private readonly blocks = new Map<string, { node: HTMLElement; text: Text }>();
  private readonly tools = new Map<string, HTMLElement>();
  private readonly asks = new Map<string, HTMLElement>();
  private socket: WebSocket | null = null;
  private info: ClaudeStatus | null = null;
  private state = 'idle';
  private running = false;
  private offline = false;
  private wanted = false;
  private session: string | null = null;

  constructor() {
    for (const [value, label] of Object.entries(LABELS)) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      this.mode.append(o);
    }
    q(this.root, '.ft-chat-new').addEventListener('click', () => void this.begin(true));
    q(this.root, '.ft-chat-handoff').addEventListener('click', () => void this.handoff());
    q(this.root, '.ft-chat-copy').addEventListener('click', () => { void navigator.clipboard?.writeText(this.info?.install ?? '').catch(() => undefined); });
    this.stopBtn.addEventListener('click', () => { void api.claudeStop().catch(() => undefined); });
    this.mode.addEventListener('change', () => { if (this.running) void this.begin(false); });
  }

  isBusy(): boolean { return this.state === 'busy'; }

  async load(): Promise<void> {
    this.wanted = true;
    this.connect();
    await this.refresh();
  }

  release(): void {
    this.wanted = false;
    this.socket?.close();
    this.socket = null;
  }

  async send(text: string): Promise<void> {
    if (!text || this.state === 'busy') return;
    if (!this.running && !(await this.begin(false))) return;
    try { await api.claudeSend(text); } catch (err) {
      this.note('note', err instanceof ApiError ? err.message : 'The message could not be sent.');
    }
    this.paint();
  }

  private async refresh(): Promise<void> {
    this.info = await api.claudeStatus();
    this.offline = this.info === null;
    if (this.info) {
      this.running = this.info.running;
      this.state = this.info.state;
      this.session = this.info.session ?? this.session;
      if (this.mode.value !== this.info.mode && this.info.running) this.mode.value = this.info.mode;
    }
    this.paint();
    this.root.classList.add('is-loaded');
  }

  private paint(): void {
    const i = this.info;
    let status: string;
    let lead: string;
    if (this.offline || !i) {
      status = 'The FormCel engine is not reachable. Start it with ./formcel.';
      lead = status;
    } else if (!i.installed) {
      status = 'Claude Code is not installed';
      lead = 'Claude Code is not installed. Install it with the command below, then sign in once by running claude in a terminal.';
    } else {
      const parts = [`Claude Code ${i.version ?? ''}`.trim()];
      if (i.signedIn === true) parts.push('signed in');
      else if (i.signedIn === false) parts.push('not signed in: run claude in a terminal and sign in with /login');
      parts.push(this.running ? (this.state === 'busy' ? 'working' : 'ready') : 'not started');
      status = parts.join(' · ');
      lead = 'Ask Claude about your workbook in the line below. It works through FormCel\'s own tools, and every change shows here and in the window.';
    }
    setText(this.statusEl, status);
    this.statusEl.title = status;
    setText(this.emptyText, lead);
    const missing = !!i && !i.installed;
    setHidden(this.install, !missing);
    if (missing) setText(q(this.install, '.ft-chat-install-cmd'), i.install);
    const usable = !!i && i.installed && !this.offline;
    setDisabled(this.stopBtn, !this.running);
    if (this.mode.disabled === usable) this.mode.disabled = !usable;
    setClass(this.root, 'is-busy', this.state === 'busy');
  }

  private connect(): void {
    if (this.socket) return;
    const socket = socketTo('/agent/claude/stream');
    this.socket = socket;
    socket.addEventListener('open', () => { this.wipe(); });
    socket.addEventListener('message', (msg) => { try { this.onEvent(JSON.parse(String(msg.data)) as AgentEvent); } catch { return; } });
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null;
      if (this.wanted) window.setTimeout(() => { if (this.wanted && !this.socket) { this.connect(); void this.refresh(); } }, 2000);
    });
  }

  private wipe(): void {
    this.log.replaceChildren(this.empty);
    setHidden(this.empty, false);
    this.blocks.clear();
    this.tools.clear();
    this.asks.clear();
  }

  private async begin(fresh: boolean): Promise<boolean> {
    try {
      await api.claudeStart(this.mode.value as AgentMode, fresh);
      if (fresh) this.wipe();
      return true;
    } catch (err) {
      this.note('note', err instanceof ApiError ? err.message : 'Claude Code could not be started.');
      return false;
    }
  }

  private async handoff(): Promise<void> {
    const s = await api.claudeStatus();
    const session = s?.session ?? this.session;
    if (!session) { this.onFail(new Error('Start a conversation here first; then it can continue in Claude Code')); return; }
    if ((s?.state ?? this.state) === 'busy') { this.onFail(new Error('Wait for Claude to finish, or press Stop, before moving the conversation')); return; }
    this.onHandoff(session);
  }

  private add(cls: string): HTMLElement {
    const node = el(`<div class="${cls}"></div>`);
    setHidden(this.empty, true);
    const stick = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
    this.log.append(node);
    if (stick) this.log.scrollTop = this.log.scrollHeight;
    return node;
  }

  private note(kind: 'user' | 'note' | 'error', text: string): void {
    setText(this.add(`ft-chat-msg is-${kind}`), text);
  }

  private grow(node: HTMLElement): void {
    if (this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 80 + node.clientHeight) this.log.scrollTop = this.log.scrollHeight;
  }

  private onEvent(ev: AgentEvent): void {
    switch (ev.type) {
      case 'state':
        this.running = ev.running;
        this.state = ev.state;
        this.session = ev.session ?? this.session;
        if (ev.running && this.mode.value !== ev.mode) this.mode.value = ev.mode;
        this.paint();
        break;
      case 'user': this.note('user', ev.text); break;
      case 'block':
        if (!this.blocks.has(ev.id)) {
          const node = this.add(`ft-chat-msg is-${ev.kind === 'thinking' ? 'thinking' : 'assistant'}`);
          const text = document.createTextNode('');
          node.append(text);
          this.blocks.set(ev.id, { node, text });
        }
        break;
      case 'delta': {
        const block = this.blocks.get(ev.id);
        if (block) { block.text.appendData(ev.text); this.grow(block.node); }
        break;
      }
      case 'tool': this.tool(ev.id, ev.name, ev.summary); break;
      case 'tool_result': {
        const card = this.tools.get(ev.id);
        if (!card) break;
        const chip = q(card, '.ft-chat-tool');
        const out = q(card, '.ft-chat-tool-out');
        setText(out, ev.text);
        setHidden(out, ev.text === '' || !ev.error);
        setClass(chip, 'is-running', false);
        setClass(chip, 'is-done', !ev.error);
        setClass(chip, 'is-error', ev.error);
        break;
      }
      case 'permission': this.question(ev.id, ev.tool, ev.summary); break;
      case 'permission_done': {
        const card = this.asks.get(ev.id);
        if (!card) break;
        card.classList.add('is-done');
        setText(q(card, '.ft-chat-ask-state'), ev.allowed ? 'Allowed' : 'Declined');
        break;
      }
      case 'result': if (!ev.ok) this.note('error', ev.text || 'Claude Code stopped with an error.'); break;
      case 'notice': this.note('note', ev.text); break;
    }
  }

  private tool(id: string, name: string, summary: string): void {
    if (this.tools.has(id)) return;
    const card = this.add('ft-chat-tool-card');
    const chip = el(`<div class="ft-chat-tool is-running" role="button" tabindex="0"><span class="ft-chat-tool-mark">${icon('terminal')}</span><span class="ft-chat-tool-name"></span><span class="ft-chat-tool-input"></span></div>`);
    const out = el('<pre class="ft-chat-tool-out" hidden></pre>');
    setText(q(chip, '.ft-chat-tool-name'), toolName(name));
    setText(q(chip, '.ft-chat-tool-input'), summary);
    chip.title = summary;
    const toggle = (): void => { if (out.textContent) setHidden(out, !out.hidden); };
    chip.addEventListener('click', toggle);
    chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    card.append(chip, out);
    this.tools.set(id, card);
    if (name === 'Bash') this.onBash();
  }

  private question(id: string, tool: string, summary: string): void {
    if (this.asks.has(id)) return;
    const card = this.add('ft-chat-ask');
    card.append(el('<div class="ft-chat-ask-text"></div>'), el('<code class="ft-chat-ask-sum"></code>'),
      el('<div class="ft-chat-ask-row"><button type="button" class="fc-btn fc-btn-primary ft-chat-allow">Allow</button><button type="button" class="fc-btn ft-chat-deny">Deny</button><span class="ft-chat-ask-state"></span></div>'));
    setText(q(card, '.ft-chat-ask-text'), `Claude Code asks to use ${toolName(tool)}`);
    setText(q(card, '.ft-chat-ask-sum'), summary);
    q(card, '.ft-chat-allow').addEventListener('click', () => { void api.claudeAllow(id, true).catch(() => undefined); });
    q(card, '.ft-chat-deny').addEventListener('click', () => { void api.claudeAllow(id, false).catch(() => undefined); });
    this.asks.set(id, card);
  }
}
