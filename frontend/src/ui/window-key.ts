const HEADER = 'X-Formcel-Window-Key';
const STORE = 'formcel-window-key';

let key = '';

function remembered(): string {
  try { return sessionStorage.getItem(STORE) ?? ''; } catch { return ''; }
}

function remember(value: string): void {
  try { sessionStorage.setItem(STORE, value); } catch { return; }
}

async function stillWorks(): Promise<boolean> {
  try {
    const res = await fetch('/api/window/check', { method: 'POST', headers: { [HEADER]: key } });
    return res.ok;
  } catch { return false; }
}

export async function loadWindowKey(): Promise<void> {
  const holder = window as unknown as { __FORMCEL_WINDOW_KEY?: unknown };
  const given = holder.__FORMCEL_WINDOW_KEY;
  delete holder.__FORMCEL_WINDOW_KEY;
  if (typeof given === 'string' && given) { key = given; return; }
  key = remembered();
  if (key && await stillWorks()) return;
  key = '';
  try {
    const res = await fetch('/api/window/key', { method: 'POST' });
    const body = res.ok ? await res.json() as { key?: unknown } : {};
    if (typeof body.key === 'string' && body.key) { key = body.key; remember(key); return; }
  } catch { key = ''; }
  key = remembered();
}

export const windowKey = (): string => key;

export const keyHeaders = (): Record<string, string> => (key ? { [HEADER]: key } : {});

export function presentKey(ws: WebSocket): WebSocket {
  ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'key', key })), { once: true });
  return ws;
}
