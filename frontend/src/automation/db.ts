import { actions, makeModal, type Modal } from '../ui/modal';
import { api, el, setText } from './dom';

export interface DbRows {
  columns: string[];
  rows: unknown[][];
}

export interface DbHost {
  id(): string;
  setting<T>(key: string): T | undefined;
  setSetting(key: string, value: unknown): void;
  saveNow(): Promise<void>;
}

const isAbs = (p: string): boolean => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function params(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

let modal: Modal | null = null;
let line: HTMLElement | null = null;
let answer: ((ok: boolean) => void) | null = null;

function settle(ok: boolean): void {
  const a = answer;
  answer = null;
  if (!a) return;
  modal?.close();
  a(ok);
}

function askWrite(path: string): Promise<boolean> {
  settle(false);
  if (!modal) {
    modal = makeModal('Allow saving to this database?', { onClose: () => settle(false) });
    line = el('p', 'fc-note');
    modal.body.append(line, actions('Allow', () => settle(true), () => settle(false), [], 'Don\'t Allow'));
  }
  setText(line!, `This workbook asks to change ${path}. Forms, Python handlers and commands in this workbook can then add, change and delete rows in that file. You can turn this off on the Data tab.`);
  const m = modal;
  return new Promise((ok) => {
    answer = ok;
    m.open();
  });
}

export class Db {
  constructor(private readonly h: DbHost) {}

  path(p?: unknown): string {
    return text(p) || text(this.h.setting<string>('dbPath'));
  }

  async allowed(path: string): Promise<boolean> {
    if (!path || !(this.h.setting<string[]>('dbWrite') ?? []).includes(path)) return false;
    const out = await api<{ allowed: boolean }>('GET', `/api/workbooks/${this.h.id()}/db/allowed?path=${encodeURIComponent(path)}`).catch(() => ({ allowed: false }));
    return out.allowed === true;
  }

  async query(p: Record<string, unknown> = {}): Promise<DbRows> {
    const path = this.path(p.path);
    if (!path) throw new Error('Name a database file with path=/path/to/file.db.');
    if (!this.h.setting<string>('dbPath') && isAbs(path)) this.h.setSetting('dbPath', path);
    return api<DbRows>('POST', `/api/workbooks/${this.h.id()}/db/query`, { path, sql: text(p.sql), params: params(p.params) ?? null });
  }

  async exec(p: Record<string, unknown> = {}): Promise<{ rowcount: number; lastrowid: number }> {
    const path = this.path(p.path);
    if (!path) throw new Error('Name a database file with path=/path/to/file.db.');
    return api('POST', `/api/workbooks/${this.h.id()}/db/exec`, { path, sql: text(p.sql), params: params(p.params) ?? null });
  }

  async allow(p: Record<string, unknown> = {}): Promise<{ allowed: boolean; path: string }> {
    const path = this.path(p.path);
    if (!isAbs(path)) throw new Error('Name the database by its full path, such as path=/Users/me/orders.db.');
    if (await this.allowed(path)) return { allowed: true, path };
    if (!(await askWrite(path))) return { allowed: false, path };
    const listed = this.h.setting<string[]>('dbWrite') ?? [];
    if (!listed.includes(path)) this.h.setSetting('dbWrite', [...listed, path]);
    if (!this.h.setting<string>('dbPath')) this.h.setSetting('dbPath', path);
    await this.h.saveNow();
    await api('PUT', `/api/workbooks/${this.h.id()}/db/allowed`, { path, allow: true });
    return { allowed: true, path };
  }

  async forbid(path: string): Promise<void> {
    this.h.setSetting('dbWrite', (this.h.setting<string[]>('dbWrite') ?? []).filter((x) => x !== path));
    await this.h.saveNow();
    await api('PUT', `/api/workbooks/${this.h.id()}/db/allowed`, { path, allow: false }).catch(() => undefined);
  }
}
