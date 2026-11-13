const NEEDS = 'This needs the FormCel engine. The demo page runs the window and its calculation engine on their own, so edits recalculate here; saving, the library, import and export, print preview, the engine side of scripts, agents and the terminal belong to the engine process (./formcel).';

interface Recorded { meta: Record<string, unknown>; doc: Record<string, unknown>; objects: unknown }

const books = (window as unknown as { FC_DEMO_BOOKS?: Record<string, Recorded> }).FC_DEMO_BOOKS ?? {};
const opened = new Map<string, { demo: string; id: string; time: string }>();

const answer = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const needs = (): Response => answer({ detail: NEEDS }, 503);

const meta = (o: { demo: string; id: string; time: string }): Record<string, unknown> => ({ ...books[o.demo].meta, id: o.id, created: o.time, modified: o.time });

function create(body: BodyInit | null | undefined): Response {
  let template = '';
  try { template = String((JSON.parse(String(body ?? '{}')) as { template?: string }).template ?? ''); } catch { return needs(); }
  const demo = /^demo-(\w+)$/.exec(template)?.[1] ?? '';
  if (!books[demo]) return needs();
  const o = { demo, id: `demo${demo}${opened.size + 1}`, time: new Date().toISOString().slice(0, 19) + '+00:00' };
  opened.set(o.id, o);
  return answer(meta(o), 201);
}

function route(method: string, path: string, body: BodyInit | null | undefined): Response {
  if (method === 'GET' && path === '/workbooks') return answer([...opened.values()].map(meta));
  if (method === 'GET' && path === '/trash') return answer([]);
  if (method === 'GET' && path === '/templates') return answer({ categories: [], templates: [] });
  if (method === 'POST' && path === '/workbooks') return create(body);
  const m = /^\/workbooks\/(\w+)(\/objects)?$/.exec(path);
  const o = m ? opened.get(m[1]) : undefined;
  if (method === 'GET' && o) return answer(m?.[2] ? books[o.demo].objects : { ...books[o.demo].doc, id: o.id, created: o.time, modified: o.time });
  return needs();
}

class QuietSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  binaryType: BinaryType = 'blob';
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: Event) => void) | null = null;
  constructor(readonly url: string) {
    super();
    window.setTimeout(() => { this.readyState = 3; const e = new Event('close'); this.onclose?.(e); this.dispatchEvent(e); }, 0);
  }
  send(): void { return; }
  close(): void { this.readyState = 3; }
}

class QuietSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = 0;
  withCredentials = false;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(readonly url: string) {
    super();
    window.setTimeout(() => { this.readyState = 2; const e = new Event('error'); this.onerror?.(e); this.dispatchEvent(e); }, 0);
  }
  close(): void { this.readyState = 2; }
}

const own = (url: string): string | null => {
  const at = url.indexOf('/api/');
  if (at < 0 || !(url.startsWith('/api/') || url.startsWith('api/') || url.startsWith('file:') || url.startsWith('ws'))) return null;
  return url.slice(at + 4).split('?')[0];
};

const NativeSocket = window.WebSocket;
window.WebSocket = new Proxy(NativeSocket, {
  construct(target, args: ConstructorParameters<typeof WebSocket>) {
    const url = String(args[0]);
    return url.includes('/api/') ? new QuietSocket(url) as unknown as WebSocket : new target(...args);
  },
});

const NativeSource = window.EventSource;
window.EventSource = new Proxy(NativeSource, {
  construct(target, args: ConstructorParameters<typeof EventSource>) {
    const url = String(args[0]);
    return own(url) !== null ? new QuietSource(url) as unknown as EventSource : new target(...args);
  },
});

const native = window.fetch.bind(window);

window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = own(raw);
  if (path === null) return native(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  return Promise.resolve(route(method, path, init?.body));
};
