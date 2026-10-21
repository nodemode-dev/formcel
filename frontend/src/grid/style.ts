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
  borders: (Border | null)[];
}

const EDGES = ['bt', 'br', 'bb', 'bl'];

export const PLAIN: CellStyle = { text: '', b: false, i: false, u: false, s: false, wrap: false, indent: 0, borders: [null, null, null, null] };

export function parseStyle(text: string): CellStyle {
  const st: CellStyle = { ...PLAIN, text, borders: [null, null, null, null] };
  for (const tok of text.split(';')) {
    const at = tok.indexOf(':');
    const k = at < 0 ? tok : tok.slice(0, at);
    const v = at < 0 ? '' : tok.slice(at + 1);
    if (k === 'b' || k === 'i' || k === 'u' || k === 's' || k === 'wrap') st[k] = true;
    else if (k === 'sz') st.size = Number(v);
    else if (k === 'ff') st.font = v;
    else if (k === 'fc') st.fc = `#${v}`;
    else if (k === 'bg') st.bg = `#${v}`;
    else if (k === 'ha') st.ha = v as CellStyle['ha'];
    else if (k === 'va') st.va = v as CellStyle['va'];
    else if (k === 'in') st.indent = Number(v);
    else {
      const e = EDGES.indexOf(k);
      if (e >= 0) {
        const [line, color] = v.split(':');
        st.borders[e] = { line: line as Line, color: `#${color ?? '000000'}` };
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
