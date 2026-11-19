import type { DockAdapter, DockAgentStatus } from './dock/adapter';
import { ApiError, dockApi as api, socketTo } from './ui/dock-api';
import { isMac } from './ui/rb-dom';
import { keyHeaders } from './ui/window-key';

export function formcelDock(host: HTMLElement): DockAdapter {
  return {
    app: { name: 'FormCel', noun: 'workbook', start: './formcel', examples: 'fill a column, add a formula, sort a table, make a chart' },
    storage: { key: 'formcel.dock', legacy: ['formcel.terminal'] },
    sizes: { minHeight: 120, maxHeightShare: 0.7, defaultHeight: 280, minWidth: 320, maxWidthShare: 0.6, defaultWidth: 440 },
    shortcut: { code: 'KeyJ', label: `${isMac ? 'Cmd' : 'Ctrl'}+J` },
    tabs: ['chat', 'shell', 'claude', 'codex', 'cursor'],
    classes: { iconButton: 'fc-tool', button: 'fc-btn', primaryButton: 'fc-btn-primary', input: 'fc-input', select: 'fc-input', note: 'fc-note' },
    mount: (dock) => { host.appendChild(dock); },
    t: (_key, english) => english,
    onTheme: () => undefined,
    keyHeaders,
    errors: {
      message: (err) => (err instanceof ApiError ? err.message : null),
      missingRoute: (err) => err instanceof ApiError && (err.status === 404 || err.status === 405) && /^(Not Found|Method Not Allowed)$/i.test(err.message),
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
      socket: (id) => socketTo(`/terminal/${id}/stream`),
    },
    agentStatus: async () => {
      const [claude, others] = await Promise.all([api.claudeCodeStatus(), api.agentPrograms()]);
      const status: DockAgentStatus = { ...others, ...(claude ? { claude } : {}) };
      return claude || others.codex || others.cursor ? status : null;
    },
    chat: {
      status: () => api.claudeStatus(),
      start: (mode, fresh) => api.claudeStart(mode, fresh),
      send: (text) => api.claudeSend(text),
      stop: () => api.claudeStop(),
      answer: (id, allow) => api.claudeAllow(id, allow),
      socket: () => socketTo('/agent/claude/stream'),
    },
  };
}
