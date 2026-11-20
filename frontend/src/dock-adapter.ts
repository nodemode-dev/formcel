import type { DockAdapter, DockChannel, DockChatEvent } from './dock/adapter';
import { jsonLegacy } from './dock/state';
import { ApiError, dockApi as api, socketTo } from './ui/dock-api';
import { outsideAgents } from './ui/outside-agents';
import { isMac } from './ui/rb-dom';
import { keyHeaders } from './ui/window-key';

function socketChannel(socket: WebSocket): DockChannel {
  let data = (_chunk: string | Uint8Array): void => undefined;
  let exit = (): void => undefined;
  let closed = (): void => undefined;
  socket.binaryType = 'arraybuffer';
  socket.addEventListener('message', (msg) => {
    if (typeof msg.data === 'string') { data(msg.data); return; }
    try { if ((JSON.parse(new TextDecoder().decode(msg.data as ArrayBuffer)) as { type?: string }).type === 'exit') exit(); } catch { return; }
  });
  socket.addEventListener('close', () => closed());
  const send = (text: string): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(text);
    else if (socket.readyState === WebSocket.CONNECTING) socket.addEventListener('open', () => socket.send(text), { once: true });
  };
  return {
    send: (chunk) => send(JSON.stringify({ type: 'input', data: chunk })),
    resize: (cols, rows) => send(JSON.stringify({ type: 'resize', cols, rows })),
    onData: (handler) => { data = handler; },
    onExit: (handler) => { exit = handler; },
    onClose: (handler) => { closed = handler; },
    close: () => socket.close(),
  };
}

export function formcelDock(): DockAdapter {
  return {
    words: {
      app: 'FormCel', noun: 'workbook', start: './formcel', example: 'add a total under this column',
      lead: "Ask Claude about your workbook in the line below. It works through FormCel's own tools, and every change shows here and in the window.",
    },
    placement: {
      mode: 'own',
      storage: { key: 'formcel.dock', legacy: jsonLegacy(['formcel.terminal'], true) },
      sizes: { minHeight: 120, maxHeightShare: 0.7, defaultHeight: 280, minWidth: 320, maxWidthShare: 0.6, defaultWidth: 440 },
    },
    isDockChord: (e) => (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyJ' && !e.repeat && !document.querySelector('.fc-modal:not([hidden])'),
    chordLabel: () => `${isMac ? 'Cmd' : 'Ctrl'}+J`,
    passKey: (e) => (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === ',',
    tabs: () => ({ builtin: ['chat', 'shell', 'claude', 'codex', 'cursor'] }),
    classes: { iconButton: 'fc-tool', button: 'fc-btn', primaryButton: 'fc-btn-primary', input: 'fc-input', select: 'fc-input', note: 'fc-note' },
    t: (_key, english) => english,
    onTheme: () => undefined,
    keyHeaders,
    errors: {
      message: (err) => (err instanceof ApiError ? err.message : null),
      kind: (err) => {
        if (err instanceof TypeError) return 'unreachable';
        if (!(err instanceof ApiError)) return null;
        if (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504) return 'unreachable';
        if (err.status === 403) return 'refused';
        if ((err.status === 404 || err.status === 405) && /^(Not Found|Method Not Allowed)$/i.test(err.message)) return 'oldEngine';
        return /not installed|was not found\. Looked in|but does not start/i.test(err.message) ? 'notInstalled' : null;
      },
    },
    terminal: {
      list: () => api.terminals(),
      open: (kind, o) => {
        if (kind === 'shell') return api.openTerminal(o.cols, o.rows);
        if (kind === 'claude') return api.openClaude({ prompt: o.prompt, resume: o.resume, cols: o.cols, rows: o.rows });
        return api.openAgent(kind, o.cols, o.rows);
      },
      restart: (id) => api.restartTerminal(id),
      close: (id) => api.closeTerminal(id),
      channel: (id) => socketChannel(socketTo(`/terminal/${id}/stream`)),
    },
    agentStatus: () => api.agentStatus(),
    chat: {
      status: () => api.claudeStatus(),
      start: (mode, fresh) => api.claudeStart(mode ?? 'ask', fresh),
      send: (text) => api.claudeSend(text),
      stop: () => api.claudeStop(),
      answer: (id, allow) => api.claudeAllow(id, allow),
      modes: ['ask', 'auto-edits', 'plan'],
      subscribe: (handlers) => {
        const socket = socketTo('/agent/claude/stream');
        socket.addEventListener('open', () => handlers.open());
        socket.addEventListener('message', (msg) => { try { handlers.event(JSON.parse(String(msg.data)) as DockChatEvent); } catch { return; } });
        socket.addEventListener('close', () => handlers.close());
        return () => socket.close();
      },
    },
    consent: { subscribe: (add, withdraw) => outsideAgents.subscribe(add, withdraw), answer: (id, choice) => outsideAgents.answer(id, choice) },
    storedChoice: { get: () => outsideAgents.get(), set: (value) => outsideAgents.set(value) },
    openSettings: () => { document.dispatchEvent(new CustomEvent('fc:settings', { detail: { section: 'Trust Center' } })); },
  };
}
