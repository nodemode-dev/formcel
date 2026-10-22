export type TypeKind = 'stock' | 'currency';
export type FieldTag = 't' | 'n' | 'p' | 'i' | 'd' | 'm' | 'b';

export interface TypedField {
  name: string;
  tag: FieldTag;
  value: string;
}

export interface TypedRecord {
  entity: string;
  provider: string;
  at: number;
  fields: TypedField[];
}

export interface Candidate {
  entity: string;
  name: string;
  exchange: string;
  type: string;
  symbol: string;
}

export interface FetchedRecord {
  kind: TypeKind;
  entity: string;
  name: string;
  provider: string;
  at: number;
  fields: { name: string; kind: FieldTag; value: string | number }[];
  payload: string;
}

export const PROVIDER_LABEL: Record<string, string> = { stooq: 'Stooq', alphavantage: 'Alpha Vantage', finnhub: 'Finnhub', ecb: 'European Central Bank' };
export const UNRESOLVED_PAYLOAD = 'v1\t\t\t0';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
const unesc = (s: string) => s.replace(/\\(.)/g, (_, ch: string) => (ch === 't' ? '\t' : ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch));

export function chipLine(kind: TypeKind, label: string, payload: string): string {
  return [kind, '0', label, payload, ''].map(esc).join('\t');
}

export function parsePayload(payload: string): TypedRecord | null {
  const lines = payload.split('\n');
  const head = lines[0].split('\t').map(unesc);
  if (head.length < 4 || head[0] !== 'v1') return null;
  const fields: TypedField[] = [];
  for (const l of lines.slice(1)) {
    if (!l) continue;
    const p = l.split('\t').map(unesc);
    if (p.length < 3) continue;
    fields.push({ name: p[0], tag: (p[1][0] as FieldTag) || 't', value: p[2] });
  }
  return { entity: head[1], provider: head[2], at: Number(head[3]) || 0, fields };
}

export function serialToDate(n: number): Date {
  return new Date(Math.round((n - 25569) * 86400000));
}

export function showValue(f: TypedField): string {
  if (f.tag === 't') return f.value;
  const n = Number(f.value);
  if (!Number.isFinite(n)) return f.value;
  switch (f.tag) {
    case 'p':
      return `${(n * 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    case 'i':
      return Math.round(n).toLocaleString();
    case 'd':
      return serialToDate(n).toLocaleDateString(undefined, { timeZone: 'UTC' });
    case 'm':
      return serialToDate(n).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
    case 'b':
      return n ? 'TRUE' : 'FALSE';
    default:
      return n.toLocaleString(undefined, { minimumFractionDigits: Math.abs(n) >= 1 ? 2 : 0, maximumFractionDigits: Math.abs(n) >= 1 ? 4 : 6 });
  }
}

export function fieldFormula(ref: string, name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? `=${ref}.${name}` : `=${ref}.[${name}]`;
}

export function matchesExactly(text: string, c: Candidate): boolean {
  const t = text.trim().toLowerCase();
  return c.symbol.toLowerCase() === t || c.name.toLowerCase() === t || c.entity.toLowerCase() === t;
}
