import { api } from '../automation/dom';
import type { VbaKind } from './runtime';

export interface VbaMod {
  name: string;
  kind: VbaKind;
  code: string;
  header: string[];
  private?: boolean;
  procAttrs: Record<string, string[]>;
}

export interface SheetCode {
  name: string;
  codeName: string;
}

interface Wire {
  present: boolean;
  locked: boolean;
  name: string;
  workbook: string;
  sheets: SheetCode[];
  modules: VbaMod[];
  error: string;
}

export type Change = 'load' | 'modules' | 'code' | 'saved' | 'error';

const PROC = /^\s*(?:(?:Public|Private|Friend|Static)\s+)*(?:Sub|Function|Property\s+(?:Get|Let|Set))\s+([A-Za-z_]\w*)/i;

export function joinSource(code: string, attrs: Record<string, string[]>): string[] {
  const out: string[] = [];
  let pending: string[] | null = null;
  for (const line of code.split('\n')) {
    out.push(line);
    if (pending) {
      if (line.trimEnd().endsWith(' _')) continue;
      out.push(...pending);
      pending = null;
      continue;
    }
    const m = PROC.exec(line);
    if (m && attrs[m[1]]) {
      if (line.trimEnd().endsWith(' _')) pending = attrs[m[1]];
      else out.push(...attrs[m[1]]);
    }
  }
  return out;
}

export function splitSource(text: string): { header: string[]; code: string; procAttrs: Record<string, string[]> } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let n = 0;
  while (n < lines.length && /^\s*Attribute\s/i.test(lines[n])) n++;
  const procAttrs: Record<string, string[]> = {};
  const body: string[] = [];
  for (const l of lines.slice(n)) {
    const m = /^\s*Attribute\s+([A-Za-z_]\w*)\./i.exec(l);
    if (m) (procAttrs[m[1]] ??= []).push(l.trim());
    else body.push(l);
  }
  return { header: lines.slice(0, n), code: body.join('\n'), procAttrs };
}

export function defaultHeader(name: string, kind: VbaKind): string[] {
  const head = [`Attribute VB_Name = "${name}"`];
  if (kind === 'std') return head;
  head.push('Attribute VB_GlobalNameSpace = False', 'Attribute VB_Creatable = False', 'Attribute VB_PredeclaredId = False', 'Attribute VB_Exposed = False');
  return head;
}

export function fullSource(m: VbaMod): string {
  const head = m.header.length ? m.header.map((h) => (/^\s*Attribute\s+VB_Name/i.test(h) ? `Attribute VB_Name = "${m.name}"` : h)) : defaultHeader(m.name, m.kind);
  return `${[...head, ...joinSource(m.code, m.procAttrs)].join('\r\n')}\r\n`;
}

export class VbaStore {
  id = '';
  present = false;
  locked = false;
  projectName = 'VBAProject';
  workbook = 'ThisWorkbook';
  sheets: SheetCode[] = [];
  mods: VbaMod[] = [];
  error = '';
  dirty = false;
  private timer = 0;
  private saving: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(c: Change, name?: string) => void>();

  on(fn: (c: Change, name?: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(c: Change, name?: string): void {
    for (const l of this.listeners) l(c, name);
  }

  async load(id: string): Promise<void> {
    window.clearTimeout(this.timer);
    this.id = id;
    this.dirty = false;
    if (!id) {
      this.mods = [];
      this.present = false;
      this.emit('load');
      return;
    }
    try {
      this.adopt(await api<Wire>('GET', `/api/workbooks/${id}/vba`), true);
    } catch (e) {
      this.mods = [];
      this.present = false;
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.emit('load');
  }

  private adopt(w: Wire, all: boolean): void {
    this.present = w.present;
    this.locked = w.locked;
    this.projectName = w.name;
    this.workbook = w.workbook;
    this.sheets = w.sheets;
    this.error = w.error;
    const have = new Set(this.mods.map((m) => m.name.toLowerCase()));
    if (all) this.mods = w.modules.map((m) => ({ ...m, procAttrs: m.procAttrs ?? {}, header: m.header ?? [] }));
    else for (const m of w.modules) if (!have.has(m.name.toLowerCase())) this.mods.push({ ...m, procAttrs: m.procAttrs ?? {}, header: m.header ?? [] });
  }

  get(name: string): VbaMod | undefined {
    return this.mods.find((m) => m.name.toLowerCase() === name.toLowerCase());
  }

  codeNameOf(sheet: number): string {
    return this.sheets[sheet]?.codeName || `Sheet${sheet + 1}`;
  }

  document(codeName: string): VbaMod {
    return this.get(codeName) ?? this.add('document', codeName, '');
  }

  uniqueName(base: string): string {
    let i = 1;
    while (this.get(`${base}${i}`)) i++;
    return `${base}${i}`;
  }

  add(kind: VbaKind, name?: string, code = ''): VbaMod {
    const base = kind === 'std' ? 'Module' : kind === 'class' ? 'Class' : kind === 'form' ? 'UserForm' : 'Sheet';
    const m: VbaMod = { name: name ?? this.uniqueName(base), kind, code, header: defaultHeader(name ?? '', kind), procAttrs: {} };
    if (!name) m.header = defaultHeader(m.name, kind);
    this.mods.push(m);
    this.touch('modules', m.name);
    return m;
  }

  remove(name: string): void {
    const i = this.mods.findIndex((m) => m.name === name);
    if (i < 0) return;
    this.mods.splice(i, 1);
    this.touch('modules', name);
  }

  rename(from: string, to: string): string | null {
    const m = this.get(from);
    if (!m) return 'That module does not exist.';
    if (!/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(to)) return 'A module name starts with a letter and holds letters, digits and underscores, up to 31 characters.';
    if (to.toLowerCase() !== from.toLowerCase() && this.get(to)) return `${to} is already used.`;
    m.name = to;
    m.header = m.header.map((h) => (/^\s*Attribute\s+VB_Name/i.test(h) ? `Attribute VB_Name = "${to}"` : h));
    this.touch('modules', to);
    return null;
  }

  setCode(name: string, code: string): void {
    const m = this.get(name);
    if (!m || m.code === code) return;
    m.code = code;
    this.touch('code', name);
  }

  setAttrs(name: string, attrs: Record<string, string[]>): void {
    const m = this.get(name);
    if (!m) return;
    m.procAttrs = attrs;
    this.touch('code', name);
  }

  signature(): string {
    let h = 5381;
    for (const m of this.mods) for (const ch of `${m.name}\u0000${m.code}\u0000`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
    return `${this.mods.length}:${h.toString(36)}`;
  }

  private touch(c: Change, name: string): void {
    this.dirty = true;
    this.emit(c, name);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 700);
  }

  flush(): Promise<void> {
    window.clearTimeout(this.timer);
    if (!this.dirty || !this.id) return this.saving;
    const id = this.id;
    this.dirty = false;
    const body = { modules: this.mods.map((m) => ({ name: m.name, kind: m.kind, code: m.code, header: m.header, private: !!m.private, procAttrs: m.procAttrs })) };
    this.saving = this.saving.then(async () => {
      try {
        const w = await api<Wire & { changed: boolean }>('PUT', `/api/workbooks/${id}/vba`, body);
        if (id !== this.id) return;
        this.adopt(w, false);
        this.error = '';
        this.emit('saved');
      } catch (e) {
        this.dirty = true;
        this.error = e instanceof Error ? e.message : String(e);
        this.emit('error');
      }
    });
    return this.saving;
  }
}
