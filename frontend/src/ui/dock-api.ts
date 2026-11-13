export interface TerminalInfo { id: string; title: string; cwd?: string; alive: boolean; kind: 'shell' | 'claude' | 'agent' }
export interface ClaudeCodeStatus { installed: boolean; version: string | null; install: string; signedIn: boolean | null }
export interface ClaudeOpen { prompt?: string; resume?: string; cols?: number; rows?: number; fresh?: boolean }
export type AgentMode = 'ask' | 'auto-edits' | 'plan';
export interface ClaudeStatus { installed: boolean; path: string | null; version: string | null; signedIn: boolean | null; install: string; running: boolean; state: string; mode: AgentMode; session: string | null; modes: AgentMode[] }
export type AgentEvent =
  | { type: 'state'; running: boolean; state: string; mode: AgentMode; session: string | null }
  | { type: 'user'; text: string }
  | { type: 'block'; id: string; kind: 'text' | 'thinking' }
  | { type: 'delta'; id: string; text: string }
  | { type: 'tool'; id: string; name: string; summary: string }
  | { type: 'tool_result'; id: string; text: string; error: boolean }
  | { type: 'permission'; id: string; tool: string; summary: string }
  | { type: 'permission_done'; id: string; allowed: boolean }
  | { type: 'result'; ok: boolean; text: string; costUsd: number | null }
  | { type: 'notice'; text: string };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const NOT_RUNNING = 'The FormCel engine is not running. Start it with ./formcel.';

async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try { res = await fetch(`/api${path}`, init); } catch {
    throw new ApiError(NOT_RUNNING, 0);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch { detail = ''; }
    throw new ApiError(detail || res.statusText || `Request failed (${res.status})`, res.status);
  }
  return res;
}

function json(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export function socketTo(path: string): WebSocket {
  return new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api${path}`);
}

export const dockApi = {
  async terminals(): Promise<TerminalInfo[]> {
    return ((await (await request('/terminal')).json()) as { terminals: TerminalInfo[] }).terminals;
  },
  async openTerminal(cols: number, rows: number): Promise<TerminalInfo> {
    return (await (await request('/terminal', json({ cols, rows }))).json()) as TerminalInfo;
  },
  async restartTerminal(id: string): Promise<void> { await request(`/terminal/${id}/restart`, { method: 'POST' }); },
  async closeTerminal(id: string): Promise<void> { await request(`/terminal/${id}`, { method: 'DELETE' }); },
  async openClaude(opts: ClaudeOpen): Promise<TerminalInfo> {
    const info = (await (await request('/terminal/claude', json(opts))).json()) as Partial<TerminalInfo> | null;
    if (!info || typeof info.id !== 'string' || info.id === '') throw new ApiError('Claude Code did not start.', 502);
    return info as TerminalInfo;
  },
  async claudeCodeStatus(): Promise<ClaudeCodeStatus | null> {
    let now: Partial<ClaudeCodeStatus> | null = null;
    try { now = (await (await request('/claude-code/status')).json()) as Partial<ClaudeCodeStatus>; } catch { now = null; }
    if (now?.installed === true) return { installed: true, version: now.version ?? null, install: '', signedIn: now.signedIn ?? null };
    const old = await dockApi.claudeStatus();
    if (!now && !old) return null;
    return { installed: now ? false : old?.installed === true, version: now?.version ?? old?.version ?? null, install: now?.install || old?.install || '', signedIn: now?.signedIn ?? old?.signedIn ?? null };
  },
  async claudeStatus(fresh = false): Promise<ClaudeStatus | null> {
    try { return (await (await request(`/agent/claude/status${fresh ? '?fresh=true' : ''}`)).json()) as ClaudeStatus; } catch { return null; }
  },
  async claudeStart(mode: AgentMode, fresh = false): Promise<void> { await request('/agent/claude/start', json({ mode, fresh })); },
  async claudeSend(text: string): Promise<void> { await request('/agent/claude/send', json({ text })); },
  async claudeStop(): Promise<void> { await request('/agent/claude/stop', { method: 'POST' }); },
  async claudeAllow(id: string, allow: boolean): Promise<void> { await request('/agent/claude/permission', json({ id, allow })); },
};
