export type Line = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double';
export interface Border {
  line: Line;
  color: string;
}
export interface CellStyle {
  text: string;
  b: boolean;
  i: boolean;
  u: boolean;
  s: boolean;
  wrap: boolean;
  size?: number;
  font?: string;
  fc?: string;
  bg?: string;
  ha?: 'left' | 'center' | 'right';
  va?: 'top' | 'middle' | 'bottom';
  indent: number;
  rot: number;
  vertical: boolean;
  cs?: string;
  borders: (Border | null)[];
}

const EDGES = ['bt', 'br', 'bb', 'bl'];

export const PLAIN: CellStyle = { text: '', b: false, i: false, u: false, s: false, wrap: false, indent: 0, rot: 0, vertical: false, borders: [null, null, null, null] };

export interface Look {
  name: string;
  colors: string[];
  heading: string;
  body: string;
}

export const SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

export function themeOf(text: string): Look {
  const [name, cols, heading, body] = text.split(';');
  const colors = (cols ?? '').split(',').filter((c) => /^[0-9a-f]{6}$/i.test(c)).map((c) => `#${c}`);
  return {
    name: name || 'FormCel',
    colors: colors.length === 10 ? colors : ['#000000', '#ffffff', '#1f2937', '#e5e7eb', '#f97316', '#3b82f6', '#22c55e', '#a855f7', '#eab308', '#14b8a6'],
    heading: heading || 'Inter',
    body: body || 'Inter',
  };
}

export function tint(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(t >= 0 ? v + (255 - v) * (t / 100) : v * (1 + t / 100));
  const out = (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255);
  return `#${out.toString(16).padStart(6, '0')}`;
}

export function paint(v: string, look: Look): string {
  if (!v.startsWith('t:')) return `#${v}`;
  const [, slot, t] = v.split(':');
  const base = look.colors[Math.max(0, SLOTS.indexOf(slot))];
  return t ? tint(base, Number(t)) : base;
}

export function parseStyle(text: string, look: Look = themeOf('')): CellStyle {
  const st: CellStyle = { ...PLAIN, text, borders: [null, null, null, null] };
  for (const tok of text.split(';')) {
    const at = tok.indexOf(':');
    const k = at < 0 ? tok : tok.slice(0, at);
    const v = at < 0 ? '' : tok.slice(at + 1);
    if (k === 'b' || k === 'i' || k === 'u' || k === 's' || k === 'wrap') st[k] = true;
    else if (k === 'cs') st.cs = v;
    else if (k === 'sz') st.size = Number(v);
    else if (k === 'ff') st.font = v === '+heading' ? look.heading : v === '+body' ? look.body : v;
    else if (k === 'fc') st.fc = paint(v, look);
    else if (k === 'bg') st.bg = paint(v, look);
    else if (k === 'ha') st.ha = v as CellStyle['ha'];
    else if (k === 'va') st.va = v as CellStyle['va'];
    else if (k === 'in') st.indent = Number(v);
    else if (k === 'rot') {
      if (v === 'v') st.vertical = true;
      else st.rot = Number(v);
    }
    else {
      const e = EDGES.indexOf(k);
      if (e >= 0) {
        const cut = v.indexOf(':');
        const line = cut < 0 ? v : v.slice(0, cut);
        st.borders[e] = { line: line as Line, color: paint(cut < 0 ? '000000' : v.slice(cut + 1), look) };
      }
    }
  }
  return st;
}

export function light(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return l > 140;
}
