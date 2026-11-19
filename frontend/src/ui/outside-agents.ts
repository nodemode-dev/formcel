import { api } from '../automation/dom';
import type { ConsentChoice, ConsentRequest, StoredChoice, StoredChoiceState } from '../dock/adapter';

interface Asked { request?: unknown; agent?: unknown; what?: unknown; answers?: unknown; alwaysCovers?: unknown; expiresAt?: unknown }
interface Stored { allowed?: boolean; choice?: StoredChoice; sealBroken?: boolean }
type Reply = (message: Record<string, unknown>) => void;

const UNNAMED = 'an outside agent';
const CHOICES: ConsentChoice[] = ['deny', 'once', 'always'];
const adders: Array<(request: ConsentRequest) => void> = [];
const withdrawers: Array<(id: string) => void> = [];
const early: ConsentRequest[] = [];
const open = new Set<string>();
let reply: Reply = () => undefined;

export const outsideAgents = {
  channel(send: Reply): void { reply = send; },
  arrive(id: string, asked: Asked): void {
    if (open.has(id)) return;
    const offered = Array.isArray(asked.answers) ? CHOICES.filter((c) => (asked.answers as unknown[]).includes(c)) : [];
    const agent = typeof asked.agent === 'string' && asked.agent !== UNNAMED ? asked.agent : '';
    const request: ConsentRequest = {
      id, agent, what: typeof asked.what === 'string' && asked.what ? asked.what : 'run a command',
      offers: offered.length ? offered : ['deny', 'always'], always: asked.alwaysCovers === 'agent' ? 'agent' : 'all', escape: 'deny',
      ...(typeof asked.expiresAt === 'number' ? { expires: Math.round(asked.expiresAt * 1000) } : {}),
    };
    open.add(id);
    if (adders.length) for (const add of adders) add(request); else early.push(request);
  },
  gone(id: string): void {
    const at = early.findIndex((r) => r.id === id);
    if (at >= 0) early.splice(at, 1);
    if (open.delete(id)) for (const withdraw of withdrawers) withdraw(id);
  },
  subscribe(add: (request: ConsentRequest) => void, withdraw: (id: string) => void): void {
    adders.push(add);
    withdrawers.push(withdraw);
    for (const request of early.splice(0)) add(request);
  },
  answer(id: string, choice: ConsentChoice): Promise<void> {
    open.delete(id);
    reply({ t: 'result', id, ok: true, result: choice === 'deny' ? { allowed: false } : choice === 'once' ? { allowed: true, once: true } : { allowed: true } });
    return Promise.resolve();
  },
  async get(): Promise<StoredChoiceState> {
    const s = await api<Stored>('GET', '/api/agents/allowed');
    return { value: s.choice ?? (s.allowed ? 'allowed' : 'ask'), changedOutside: s.sealBroken === true };
  },
  async set(value: StoredChoice): Promise<void> {
    await api<Stored>('PUT', '/api/agents/allowed', { choice: value });
  },
};
