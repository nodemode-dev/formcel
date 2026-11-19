import { api, el, setText } from '../automation/dom';
import { note, toggleRow } from './controls';
import type { Panel } from './settings-engine';

interface Allowed { allowed: boolean; sealBroken?: boolean; choice?: 'ask' | 'allowed' | 'blocked' }

export function agentsPanel(): Panel {
  const msg = note('', true);
  const failed = (row: { set(on: boolean): void }, was: boolean) => (err: unknown): void => {
    row.set(was);
    setText(msg, err instanceof Error ? err.message : String(err));
  };
  const row = toggleRow('Allow outside agents', (v) => {
    void api<Allowed>('PUT', '/api/agents/allowed', { allowed: v }).then(paint, failed(row, !v));
  });
  const block = toggleRow('Block all agents', (v) => {
    void api<Allowed>('PUT', '/api/agents/allowed', { choice: v ? 'blocked' : 'ask' }).then(paint, failed(block, !v));
  });
  const paint = (s: Allowed): void => {
    row.set(s.allowed);
    block.set(s.choice === 'blocked');
    setText(msg, s.choice === 'blocked'
      ? 'Blocked. No agent can run FormCel\'s commands: outside agents, Chat and Claude Code, Codex and Cursor tabs in the dock are all refused. The dock and its plain terminals still open.'
      : s.sealBroken
      ? 'The saved agent permission was changed outside FormCel, so it is back to Ask.'
      : s.allowed
      ? 'On. Agents connected to FormCel over its MCP endpoint, such as Claude Code, can run FormCel\'s commands in this window.'
      : 'Off. The first time an outside agent calls, FormCel asks here in the window; Allow turns this on. Claude Code started from the terminal dock is not an outside agent.');
  };
  const box = el('div', 'fc-panel');
  box.append(row.el, block.el, msg);
  return {
    el: box,
    async refresh() {
      try {
        paint(await api<Allowed>('GET', '/api/agents/allowed'));
      } catch {
        setText(msg, 'The FormCel engine is not reachable. Start it with ./formcel.');
      }
    },
  };
}
