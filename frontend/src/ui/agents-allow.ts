import { api, el, setText } from '../automation/dom';
import { note, toggleRow } from './controls';
import { actions, makeModal, type Modal } from './modal';
import type { Panel } from './settings-engine';

interface Allowed { allowed: boolean }

export function agentsPanel(): Panel {
  const msg = note('', true);
  const row = toggleRow('Allow outside agents', (v) => {
    void api<Allowed>('PUT', '/api/agents/allowed', { allowed: v }).then(paint, (err: unknown) => {
      row.set(!v);
      setText(msg, err instanceof Error ? err.message : String(err));
    });
  });
  const paint = (s: Allowed): void => {
    row.set(s.allowed);
    setText(msg, s.allowed
      ? 'On. Agents connected to FormCel over its MCP endpoint, such as Claude Code, can run FormCel\'s commands in this window.'
      : 'Off. The first time an outside agent calls, FormCel asks here in the window; Allow turns this on. Claude Code started from the terminal dock is not an outside agent.');
  };
  const box = el('div', 'fc-panel');
  box.append(row.el, msg);
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

let modal: Modal | null = null;
let text: HTMLElement | null = null;
let answer: ((ok: boolean) => void) | null = null;

function settle(ok: boolean): void {
  const a = answer;
  answer = null;
  if (!a) return;
  modal?.close();
  a(ok);
}

export function askConsent(client: string): Promise<boolean> {
  settle(false);
  if (!modal) {
    modal = makeModal('Allow an outside agent?', { onClose: () => settle(false) });
    text = el('p', 'fc-note');
    modal.body.append(text, actions('Allow', () => settle(true), () => settle(false), [], 'Don\'t Allow'));
  }
  setText(text!, `${client || 'An outside agent'} asks to use FormCel. Allowed agents can run FormCel's commands on the open workbook, and every change shows in this window. You can turn this off in Preferences, Trust Center, Outside agents.`);
  const m = modal;
  return new Promise((ok) => {
    answer = ok;
    m.open();
  });
}
