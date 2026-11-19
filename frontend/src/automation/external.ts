import { actions, makeModal, type Modal } from '../ui/modal';
import { api, el, setText } from './dom';

let modal: Modal | null = null;
let line: HTMLElement | null = null;
let answer: ((ok: boolean) => void) | null = null;
const asked = new Map<string, Promise<boolean>>();

function settle(ok: boolean): void {
  const a = answer;
  answer = null;
  if (!a) return;
  modal?.close();
  a(ok);
}

function ask(): Promise<boolean> {
  if (!modal) {
    modal = makeModal('Allow this workbook to read files and web pages?', { onClose: () => settle(false) });
    line = el('p', 'fc-note');
    modal.body.append(line, actions('Allow', () => settle(true), () => settle(false), [], 'Don\'t Allow'));
  }
  setText(line!, 'Formulas in this workbook read files on this computer by path or fetch web pages. Allow it only for a workbook you trust. FormCel remembers your answer for this workbook on this computer.');
  const m = modal;
  return new Promise((ok) => {
    answer = ok;
    m.open();
  });
}

export function askExternal(id: string): Promise<boolean> {
  const before = asked.get(id);
  if (before) return before;
  const out = ask().then(async (on) => {
    await api('PUT', `/api/workbooks/${id}/trust`, { external: on }).catch(() => undefined);
    return on;
  });
  asked.set(id, out);
  return out;
}
