import { engine, type Changed } from '../engine';

type Scalar = string | number | boolean | null;

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

export function encodeValue(v: unknown): string {
  const one = (x: unknown): string => {
    if (x === null || x === undefined || x === '') return 'z:';
    if (typeof x === 'number') return Number.isFinite(x) ? `n:${x}` : 'e:#NUM!';
    if (typeof x === 'boolean') return `b:${x ? 1 : 0}`;
    return `t:${esc(String(x))}`;
  };
  if (Array.isArray(v)) {
    const rows = (v as unknown[]).map((r) => (Array.isArray(r) ? r : [r]));
    if (!rows.length) return 'e:#N/A';
    return rows.map((r) => r.map(one).join('\t')).join('\n');
  }
  return one(v);
}

function token(t: string): Scalar {
  const k = t.slice(0, 2);
  const body = t.slice(2);
  if (k === 'n:') return Number(body);
  if (k === 'b:') return body === '1';
  if (k === 'z:') return '';
  if (k === 'e:') return null;
  return body;
}

export function parseKey(key: string): { name: string; args: (Scalar | Scalar[][])[] } {
  const [name, ...rest] = key.split('\x1f');
  const args = rest.map((a) => {
    if (!a.startsWith('a:')) return token(a);
    const [head, ...items] = a.split('\x1e');
    const [, r, c] = head.split(':').map(Number);
    const vals = items.map(token);
    const out: Scalar[][] = [];
    for (let i = 0; i < r; i++) out.push(vals.slice(i * c, (i + 1) * c));
    return out;
  });
  return { name, args };
}

export interface CallHooks {
  book(): number;
  patch(changes: Changed[]): void;
  custom(name: string, args: unknown[]): Promise<unknown>;
  note(text: string): void;
}

export class HostCalls {
  private names = new Set<string>();
  private running = false;
  private again = false;

  constructor(private readonly h: CallHooks) {}

  async setCustom(names: string[]): Promise<void> {
    const book = this.h.book();
    if (book < 0) return;
    const up = names.map((n) => n.toUpperCase());
    if (up.length === this.names.size && up.every((n) => this.names.has(n))) return;
    this.names = new Set(up);
    this.h.patch(await engine().hostCustom(book, up));
    await this.drain();
  }

  reset(): void {
    this.names = new Set();
  }

  async drain(fresh = false, all = false): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      for (let round = 0; round < 6; round++) {
        this.again = false;
        const book = this.h.book();
        if (book < 0) return;
        const pending = await engine().hostKeys(book, false);
        const keys = all && round === 0 ? [...new Set([...pending, ...(await engine().hostKeys(book, true))])] : pending;
        if (!keys.length) {
          if (!this.again) return;
          continue;
        }
        const web = keys.filter((k) => !this.names.has(k.split('\x1f')[0].toUpperCase()));
        const mine = keys.filter((k) => this.names.has(k.split('\x1f')[0].toUpperCase()));
        const answers = new Map<string, string>();
        if (web.length) {
          try {
            const r = await fetch('/api/host/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: web, fresh }) });
            const j = (await r.json()) as { results: Record<string, { data: string; note: string }> };
            for (const [k, v] of Object.entries(j.results)) {
              answers.set(k, v.data);
              if (v.note) this.h.note(v.note);
            }
          } catch (err) {
            for (const k of web) answers.set(k, 'e:#N/A');
            this.h.note(`The engine process could not be reached: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        for (const k of mine) {
          const { name, args } = parseKey(k);
          try {
            answers.set(k, encodeValue(await this.h.custom(name, args)));
          } catch (err) {
            answers.set(k, 'e:#VALUE!');
            this.h.note(`${name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        for (const [k, data] of answers) this.h.patch(await engine().hostSet(this.h.book(), k, data));
        if (answers.size) document.dispatchEvent(new Event('fc-hosted'));
      }
    } finally {
      this.running = false;
    }
  }
}
