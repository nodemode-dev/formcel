import type { Suggestion } from '../ui/autocomplete';

export interface ParamMeta {
  name: string;
  description: string;
  type: 'any' | 'boolean' | 'number' | 'string';
  dimensionality: 'scalar' | 'matrix';
  optional: boolean;
  repeating: boolean;
}

export interface FnMeta {
  name: string;
  description: string;
  helpUrl: string;
  parameters: ParamMeta[];
  options: { stream: boolean; volatile: boolean; cancelable: boolean; requiresAddress: boolean };
  result: { dimensionality: 'scalar' | 'matrix' };
}

const BLOCK = /\/\*\*((?:(?!\*\/)[\s\S])*?@customfunction(?:(?!\*\/)[\s\S])*?)\*\/\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?/g;

function signature(list: string): { name: string; type: ParamMeta['type']; optional: boolean; repeating: boolean; matrix: boolean }[] {
  const out: ReturnType<typeof signature> = [];
  let depth = 0;
  let cur = '';
  const parts: string[] = [];
  for (const ch of list) {
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) {
    const m = /^\s*(\.\.\.)?\s*([A-Za-z_$][\w$]*)\s*(\?)?\s*(?::\s*([^=]+?))?\s*(=.*)?$/.exec(p.trim());
    if (!m) continue;
    const t = (m[4] ?? '').trim();
    const matrix = /\[\]\[\]|any\[\]|Array</.test(t);
    const type: ParamMeta['type'] = /number/.test(t) ? 'number' : /boolean/.test(t) ? 'boolean' : /string/.test(t) ? 'string' : 'any';
    out.push({ name: m[2], type, optional: !!m[3] || !!m[5], repeating: !!m[1], matrix });
  }
  return out;
}

export function metaOf(code: string): FnMeta[] {
  const out: FnMeta[] = [];
  for (const m of code.matchAll(BLOCK)) {
    const doc = m[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, ''));
    const tags = new Map<string, string[]>();
    const text: string[] = [];
    let tag = '';
    for (const line of doc) {
      const t = /^@(\w+)\s*(.*)$/.exec(line.trim());
      if (t) {
        tag = t[1].toLowerCase();
        tags.set(tag, [...(tags.get(tag) ?? []), t[2]]);
      } else if (tag) {
        const list = tags.get(tag)!;
        if (line.trim()) list[list.length - 1] += ` ${line.trim()}`;
      } else if (line.trim()) text.push(line.trim());
    }
    const docs = new Map<string, string>();
    for (const p of tags.get('param') ?? []) {
      const d = /^(?:\{[^}]*\}\s*)?\[?([A-Za-z_$][\w$]*)\]?(?:=[^\s\]]*)?\]?\s*(?:-\s*)?(.*)$/.exec(p.trim());
      if (d) docs.set(d[1], d[2]);
    }
    const sig = signature(m[3]);
    const ret = (m[4] ?? '').trim();
    out.push({
      name: m[2],
      description: text.join(' ') || (tags.get('description') ?? [''])[0],
      helpUrl: (tags.get('helpurl') ?? [''])[0].trim(),
      parameters: sig.filter((s) => !(tags.has('streaming') && s === sig[sig.length - 1] && /invocation/i.test(s.name))).map((s) => ({ name: s.name, description: docs.get(s.name) ?? '', type: s.type, dimensionality: s.matrix ? 'matrix' : 'scalar', optional: s.optional, repeating: s.repeating })),
      options: { stream: tags.has('streaming'), volatile: tags.has('volatile'), cancelable: tags.has('cancelable'), requiresAddress: tags.has('requiresaddress') },
      result: { dimensionality: /\[\]\[\]/.test(ret) ? 'matrix' : 'scalar' },
    });
  }
  return out;
}

export function suggestion(f: FnMeta): Suggestion {
  const args = f.parameters.map((p) => (p.optional && !p.repeating ? `[${p.name}]` : p.name));
  if (f.parameters.some((p) => p.repeating)) args.push('...');
  const kinds = [f.options.stream ? 'streaming' : '', f.options.volatile ? 'volatile' : ''].filter(Boolean).join(', ');
  return {
    name: f.name.toUpperCase(),
    kind: 'function',
    summary: `${f.description || 'Custom function'}${kinds ? ` (${kinds})` : ''}`,
    args,
    argHelp: f.parameters.map((p) => `${p.name}${p.optional ? ' (optional)' : ''}: ${[p.type !== 'any' ? p.type : '', p.dimensionality === 'matrix' ? 'range' : '', p.description].filter(Boolean).join(', ')}`),
    help: f.helpUrl || undefined,
    category: 'User Defined',
    custom: true,
  };
}
