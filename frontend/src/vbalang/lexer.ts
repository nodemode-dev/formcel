import { VbaError, parseDate } from './values';

export type TokKind = 'id' | 'num' | 'str' | 'date' | 'op' | 'eol' | 'colon';

export interface Tok {
  k: TokKind;
  v: string;
  n?: number;
  line: number;
  sp: boolean;
  suffix?: string;
}

const OPS2 = ['<=', '>=', '<>', '=<', '=>', '><'];

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const text = src.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const pre = preprocess(lines);
  for (let li = 0; li < pre.length; li++) {
    let line = pre[li];
    const startLine = li + 1;
    while (/[ \t]_[ \t]*$/.test(line) && li + 1 < pre.length) {
      line = line.replace(/[ \t]_[ \t]*$/, ' ') + pre[++li];
    }
    lexLine(line, startLine, out);
    out.push({ k: 'eol', v: '\n', line: li + 1, sp: false });
  }
  return out;
}

function lexLine(s: string, ln: number, out: Tok[]): void {
  let i = 0;
  const n = s.length;
  let sp = false;
  const push = (t: Omit<Tok, 'line' | 'sp'>) => {
    out.push({ ...t, line: ln, sp });
    sp = false;
  };
  while (i < n) {
    const c = s[i];
    if (c === ' ' || c === '\t') {
      sp = true;
      i++;
      continue;
    }
    if (c === "'") break;
    if (c === '"') {
      let j = i + 1;
      let v = '';
      for (;;) {
        if (j >= n) throw new VbaError(0, `Unterminated string on line ${ln}`);
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += s[j++];
      }
      push({ k: 'str', v });
      i = j + 1;
      continue;
    }
    if (c === '#') {
      const m = /^#\s*([^#]*?)\s*#/.exec(s.slice(i));
      if (m && /^[\d]/.test(m[1]) && /[\d]/.test(m[1])) {
        const d = parseDate(m[1]);
        if (d !== null) {
          push({ k: 'date', v: m[1], n: d });
          i += m[0].length;
          continue;
        }
      }
      push({ k: 'op', v: '#' });
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?/.exec(s.slice(i)) as RegExpExecArray;
      let len = m[0].length;
      let suffix = '';
      const nx = s[i + len];
      if (nx && '%&!#@^'.includes(nx) && !(nx === '&' && /[\w"(]/.test(s[i + len + 1] ?? '') && !/\s/.test(s[i + len + 1] ?? '')) && nx !== '^' && !(nx === '!' )) {
        suffix = nx;
        len++;
      }
      push({ k: 'num', v: m[0], n: Number(m[0].replace(/[dD]/, 'e')), suffix });
      i += len;
      continue;
    }
    if (c === '&' && /^&[hHoO][0-9a-fA-F]+/.test(s.slice(i, i + 20))) {
      const m = /^&([hHoO])([0-9a-fA-F]+)(&?)/.exec(s.slice(i)) as RegExpExecArray;
      const hex = m[1].toLowerCase() === 'h';
      let v = parseInt(m[2], hex ? 16 : 8);
      if (!m[3] && hex && m[2].length <= 4 && v > 0x7fff) v -= 0x10000;
      if (m[3] && hex && m[2].length <= 8 && v > 0x7fffffff) v -= 0x100000000;
      push({ k: 'num', v: m[0], n: v, suffix: m[3] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c) || c.charCodeAt(0) > 127) {
      let j = i + 1;
      while (j < n && (/[A-Za-z0-9_]/.test(s[j]) || s.charCodeAt(j) > 127)) j++;
      let word = s.slice(i, j);
      let suffix = '';
      if ('$%#@'.includes(s[j] ?? '*') && s[j] !== undefined) {
        if (!(s[j] === '#' && /\d/.test(s[j + 1] ?? ''))) {
          suffix = s[j];
          j++;
        }
      }
      if (/^rem$/i.test(word) && (out.length === 0 || out[out.length - 1].k === 'eol' || out[out.length - 1].k === 'colon') && (j >= n || s[j] === ' ' || s[j] === '\t')) break;
      if (word.length === 0) word = c;
      push({ k: 'id', v: word, suffix });
      i = j;
      continue;
    }
    if (c === '[') {
      const j = s.indexOf(']', i + 1);
      if (j > 0) {
        push({ k: 'id', v: s.slice(i + 1, j), suffix: '[' });
        i = j + 1;
        continue;
      }
    }
    if (c === ':' && s[i + 1] === '=') {
      push({ k: 'op', v: ':=' });
      i += 2;
      continue;
    }
    if (c === ':') {
      push({ k: 'colon', v: ':' });
      i++;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (OPS2.includes(two)) {
      push({ k: 'op', v: two === '=<' ? '<=' : two === '=>' ? '>=' : two === '><' ? '<>' : two });
      i += 2;
      continue;
    }
    push({ k: 'op', v: c });
    i++;
  }
}

function preprocess(lines: string[]): string[] {
  const out: string[] = [];
  const defs = new Map<string, number | boolean>([
    ['vba7', true],
    ['vba6', false],
    ['win64', true],
    ['win32', true],
    ['win16', false],
    ['mac', false],
  ]);
  const stack: { active: boolean; taken: boolean; parent: boolean }[] = [];
  const live = () => stack.every((s) => s.active);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t.startsWith('#')) {
      const m = /^#\s*(if|elseif|else|end\s*if|const)\b\s*(.*)$/i.exec(t);
      if (m) {
        const kw = m[1].toLowerCase().replace(/\s+/g, '');
        const body = m[2].replace(/'.*$/, '').trim();
        if (kw === 'if') {
          const parent = live();
          const v = parent && cond(body.replace(/\bthen\b\s*$/i, ''), defs);
          stack.push({ active: v, taken: v, parent });
        } else if (kw === 'elseif') {
          const top = stack[stack.length - 1];
          if (top) {
            const v = top.parent && !top.taken && cond(body.replace(/\bthen\b\s*$/i, ''), defs);
            top.active = v;
            top.taken = top.taken || v;
          }
        } else if (kw === 'else') {
          const top = stack[stack.length - 1];
          if (top) {
            top.active = top.parent && !top.taken;
            top.taken = true;
          }
        } else if (kw === 'endif') stack.pop();
        else if (kw === 'const' && live()) {
          const a = /^(\w+)\s*=\s*(.*)$/.exec(body);
          if (a) defs.set(a[1].toLowerCase(), evalConst(a[2], defs));
        }
        out.push('');
        continue;
      }
    }
    out.push(live() ? raw : '');
  }
  return out;
}

function evalConst(s: string, defs: Map<string, number | boolean>): number | boolean {
  const t = s.trim();
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  return cond(t, defs);
}

function cond(s: string, defs: Map<string, number | boolean>): boolean {
  const toks = s.match(/<>|<=|>=|=|<|>|\(|\)|[A-Za-z_]\w*|\d+/g) ?? [];
  let p = 0;
  const val = (): number => {
    const t = toks[p++];
    if (t === undefined) return 0;
    if (t === '(') {
      const v = orE();
      p++;
      return v;
    }
    if (/^not$/i.test(t)) return val() ? 0 : -1;
    if (/^\d+$/.test(t)) return Number(t);
    if (/^true$/i.test(t)) return -1;
    if (/^false$/i.test(t)) return 0;
    const d = defs.get(t.toLowerCase());
    return d === true ? -1 : d === false || d === undefined ? 0 : d;
  };
  const cmp = (): number => {
    let l = val();
    while (['=', '<>', '<', '>', '<=', '>='].includes(toks[p])) {
      const o = toks[p++];
      const r = val();
      l = (o === '=' ? l === r : o === '<>' ? l !== r : o === '<' ? l < r : o === '>' ? l > r : o === '<=' ? l <= r : l >= r) ? -1 : 0;
    }
    return l;
  };
  const andE = (): number => {
    let l = cmp();
    while (/^and$/i.test(toks[p] ?? '')) {
      p++;
      const r = cmp();
      l = l && r ? -1 : 0;
    }
    return l;
  };
  const orE = (): number => {
    let l = andE();
    while (/^or$/i.test(toks[p] ?? '')) {
      p++;
      const r = andE();
      l = l || r ? -1 : 0;
    }
    return l;
  };
  return orE() !== 0;
}
