import type { VbaMod } from './model';

export interface Proc {
  module: string;
  name: string;
  type: 'Sub' | 'Function' | 'Property';
  scope: 'Public' | 'Private' | 'Friend';
  params: string;
  line: number;
  end: number;
}

const DECL = /^\s*(?:(Public|Private|Friend)\s+)?(?:Static\s+)?(Sub|Function|Property\s+(?:Get|Let|Set))\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/i;
const END = /^\s*End\s+(Sub|Function|Property)\b/i;

export function procedures(m: { name: string; code: string }): Proc[] {
  const out: Proc[] = [];
  const lines = m.code.split('\n');
  let open: Proc | null = null;
  lines.forEach((text, i) => {
    const code = text.replace(/'.*$/, '');
    if (!open) {
      const d = DECL.exec(code);
      if (d && !/^\s*(Declare|Exit)\b/i.test(code)) {
        const kind = d[2].split(/\s+/)[0];
        open = { module: m.name, name: d[3], type: (kind[0].toUpperCase() + kind.slice(1).toLowerCase()) as Proc['type'], scope: ((d[1] ?? 'Public')[0].toUpperCase() + (d[1] ?? 'Public').slice(1).toLowerCase()) as Proc['scope'], params: (d[4] ?? '').trim(), line: i + 1, end: i + 1 };
      }
    } else if (END.test(code)) {
      open.end = i + 1;
      out.push(open);
      open = null;
    }
  });
  if (open) out.push({ ...(open as Proc), end: lines.length });
  return out;
}

export function allProcedures(mods: VbaMod[]): Proc[] {
  return mods.flatMap((m) => procedures(m));
}

export function macros(mods: VbaMod[]): Proc[] {
  return mods
    .filter((m) => m.kind === 'std' || m.kind === 'document')
    .flatMap((m) => procedures(m))
    .filter((p) => p.type === 'Sub' && p.scope !== 'Private' && p.params === '' && !(mods.find((m) => m.name === p.module)?.private));
}

export function procAt(m: { name: string; code: string }, line: number): Proc | null {
  return procedures(m).find((p) => line >= p.line && line <= p.end) ?? null;
}

export function qualified(p: Proc): string {
  return `${p.module}.${p.name}`;
}
