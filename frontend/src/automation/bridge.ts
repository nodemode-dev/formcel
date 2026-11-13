import { commandInfo, listCommands, runCommand } from '../ui/commands';
import { asAgent } from './actor';
import { api } from './dom';

export const WINDOW_ONLY = ['terminal-toggle', 'terminal-new', 'claude-code', 'claude-chat'];

function safe(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

async function run(command: string): Promise<unknown> {
  if (WINDOW_ONLY.includes(command)) throw new Error(`${command} is only available in the FormCel window, so a person runs it. Do not retry.`);
  const info = commandInfo(command);
  if (!info) throw new Error(`No command has the id ${command}. Search with GET /api/commands?text=word.`);
  if (info.enabled && !info.enabled()) throw new Error(`${command} cannot run now: ${info.description}`);
  return asAgent(async () => { await runCommand(command); });
}

export function connectBridge(): void {
  let delay = 500;
  const open = (): void => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/live`);
    ws.onopen = () => { delay = 500; void api('PUT', '/api/commands', listCommands()).catch(() => undefined); };
    ws.onmessage = async (ev) => {
      let msg: { t?: string; id?: string; command?: string; params?: Record<string, unknown> };
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.t !== 'run' || !msg.id || !msg.command) return;
      try {
        const result = await run(msg.command);
        ws.send(JSON.stringify({ t: 'result', id: msg.id, ok: true, result: safe(result) }));
      } catch (e) {
        ws.send(JSON.stringify({ t: 'result', id: msg.id, ok: false, error: (e as Error).message }));
      }
    };
    ws.onclose = () => { window.setTimeout(open, delay); delay = Math.min(delay * 2, 10000); };
  };
  open();
}
