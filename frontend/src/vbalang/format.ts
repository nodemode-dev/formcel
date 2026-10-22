import { DAYS, MONTHS, VDate, dateText, fail, isNumeric, parseDate, parseNumber, parts, toNum, toStr } from './values';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function groupDigits(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function roundHalfUp(n: number, dec: number): string {
  const neg = n < 0;
  let s = Math.abs(n).toFixed(Math.min(dec, 20));
  const p = Math.pow(10, dec);
  const x = Math.abs(n) * p;
  if (Math.abs(x - Math.floor(x) - 0.5) < 1e-9 * Math.max(1, x)) s = ((Math.floor(x) + 1) / p).toFixed(dec);
  return neg && Number(s) !== 0 ? `-${s}` : s;
}

interface Sec {
  text: string;
}

function splitSections(fmt: string): Sec[] {
  const out: Sec[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c === '"') q = !q;
    if (c === '\\' && !q) {
      cur += c + (fmt[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === ';' && !q) {
      out.push({ text: cur });
      cur = '';
    } else cur += c;
  }
  out.push({ text: cur });
  return out;
}

interface NumTok {
  t: 'lit' | 'int' | 'frac' | 'dec' | 'exp';
  v: string;
  sign?: boolean;
  width?: number;
}

function numTokens(fmt: string): { toks: NumTok[]; pct: number; scale: number; comma: boolean } {
  const toks: NumTok[] = [];
  let pct = 0;
  let scale = 0;
  let comma = false;
  let seenDec = false;
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c === '"') {
      const j = fmt.indexOf('"', i + 1);
      const end = j < 0 ? fmt.length : j;
      toks.push({ t: 'lit', v: fmt.slice(i + 1, end) });
      i = end + 1;
    } else if (c === '\\') {
      toks.push({ t: 'lit', v: fmt[i + 1] ?? '' });
      i += 2;
    } else if (c === '0' || c === '#') {
      toks.push({ t: seenDec ? 'frac' : 'int', v: c });
      i++;
    } else if (c === '.' && !seenDec) {
      seenDec = true;
      toks.push({ t: 'dec', v: '.' });
      i++;
    } else if (c === ',') {
      const prev = toks[toks.length - 1];
      const after = fmt.slice(i + 1).replace(/^,+/, '');
      if (prev && prev.t === 'int') {
        if (/^[0#]/.test(after)) comma = true;
        else scale++;
      }
      i++;
    } else if (c === '%') {
      pct++;
      toks.push({ t: 'lit', v: '%' });
      i++;
    } else if ((c === 'E' || c === 'e') && (fmt[i + 1] === '+' || fmt[i + 1] === '-')) {
      let j = i + 2;
      while (fmt[j] === '0') j++;
      toks.push({ t: 'exp', v: c, sign: fmt[i + 1] === '+', width: j - i - 2 });
      i = j;
    } else if (c === '_') {
      toks.push({ t: 'lit', v: ' ' });
      i += 2;
    } else if (c === '*') {
      i += 2;
    } else {
      toks.push({ t: 'lit', v: c });
      i++;
    }
  }
  return { toks, pct, scale, comma };
}

function numberWith(n: number, fmt: string, neg: boolean): string {
  const { toks, pct, scale, comma } = numTokens(fmt);
  const ints = toks.filter((t) => t.t === 'int');
  const fracs = toks.filter((t) => t.t === 'frac');
  const exp = toks.find((t) => t.t === 'exp');
  let v = Math.abs(n) * Math.pow(100, pct) / Math.pow(1000, scale);
  let e = 0;
  if (exp && v !== 0) {
    const lead = Math.max(1, ints.length);
    e = Math.floor(Math.log10(v)) - (lead - 1);
    v /= Math.pow(10, e);
    if (Number(roundHalfUp(v, fracs.length)) >= Math.pow(10, lead)) {
      v /= 10;
      e++;
    }
  }
  const [ip0, fp0 = ''] = roundHalfUp(v, fracs.length).split('.');
  const minInt = ints.filter((t) => t.v === '0').length;
  let ip = ip0 === '0' && minInt === 0 ? '' : ip0;
  if (ip.length < minInt) ip = ip.padStart(minInt, '0');
  let fp = fp0;
  while (fp.length > 0 && fracs[fp.length - 1]?.v === '#' && fp.endsWith('0')) fp = fp.slice(0, -1);
  if (comma) ip = groupDigits(ip);
  const firstInt = toks.findIndex((t) => t.t === 'int');
  const lastInt = toks.length - 1 - [...toks].reverse().findIndex((t) => t.t === 'int');
  const split = firstInt >= 0 && toks.slice(firstInt, lastInt + 1).some((t) => t.t !== 'int');
  let out = '';
  let slot = 0;
  let fi = 0;
  const plain = ip.replace(/,/g, '');
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'int') {
      if (!split) {
        if (k === firstInt) out += ip;
      } else {
        const fromRight = ints.length - 1 - slot;
        slot++;
        out += slot === 1 ? plain.slice(0, Math.max(1, plain.length - fromRight)) : plain[plain.length - 1 - fromRight] ?? '';
      }
    } else if (t.t === 'frac') {
      out += fp[fi] ?? (t.v === '0' ? '0' : '');
      fi++;
    } else if (t.t === 'exp') {
      out += `E${e < 0 ? '-' : t.sign ? '+' : ''}${String(Math.abs(e)).padStart(t.width ?? 0, '0')}`;
    } else out += t.v;
  }
  return neg ? `-${out}` : out;
}

const NAMED_NUM: Record<string, string> = {
  'general number': 'General',
  currency: '$#,##0.00;($#,##0.00)',
  fixed: '0.00',
  standard: '#,##0.00',
  percent: '0.00%',
  scientific: '0.00E+00',
};

function dateWith(serial: number, fmt: string): string {
  const p = parts(serial);
  const tokens: string[] = [];
  const re = /"[^"]*"|\\.|ddddd+|dddd|ddd|dd|d|ww|w|mmmm|mmm|mm|m|yyyy|yy|y|hh|h|nn|n|ss|s|ttttt|q|AM\/PM|am\/pm|A\/P|a\/p|AMPM|[\s\S]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt))) tokens.push(m[0]);
  const hasAp = tokens.some((t) => /^(AM\/PM|am\/pm|A\/P|a\/p|AMPM)$/i.test(t));
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  const doy = Math.floor(serial) - Math.floor(new Date(Date.UTC(p.y, 0, 1)).getTime() / 86400000 + 25569) + 1;
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const l = t.toLowerCase();
    if (t.startsWith('"')) out += t.slice(1, -1);
    else if (t.startsWith('\\')) out += t.slice(1);
    else if (l === 'yyyy') out += pad(p.y, 4);
    else if (l === 'yy') out += pad(p.y % 100);
    else if (l === 'y') out += doy;
    else if (l === 'q') out += Math.ceil(p.m / 3);
    else if (l === 'mmmm') out += MONTHS[p.m - 1];
    else if (l === 'mmm') out += MONTHS[p.m - 1].slice(0, 3);
    else if (l === 'mm' || l === 'm') {
      let isMin = false;
      for (let j = i - 1; j >= 0; j--) {
        const u = tokens[j].toLowerCase();
        if (u === 'h' || u === 'hh') {
          isMin = true;
          break;
        }
        if (/^(d|dd|ddd|dddd|yy|yyyy|mmm|mmmm)$/.test(u)) break;
      }
      if (!isMin)
        for (let j = i + 1; j < tokens.length; j++) {
          const u = tokens[j].toLowerCase();
          if (u === 's' || u === 'ss') {
            isMin = true;
            break;
          }
          if (/^(d|dd|ddd|dddd|yy|yyyy|mmm|mmmm|h|hh)$/.test(u)) break;
        }
      const v = isMin ? p.n : p.m;
      out += l === 'mm' ? pad(v) : v;
    } else if (l === 'dddddd') out += `${DAYS[p.dow - 1]}, ${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
    else if (l === 'ddddd') out += `${p.m}/${p.d}/${p.y}`;
    else if (l === 'dddd') out += DAYS[p.dow - 1];
    else if (l === 'ddd') out += DAYS[p.dow - 1].slice(0, 3);
    else if (l === 'dd') out += pad(p.d);
    else if (l === 'd') out += p.d;
    else if (l === 'ww') out += Math.floor((doy + 6 - (p.dow - 1)) / 7);
    else if (l === 'w') out += p.dow;
    else if (l === 'hh') out += pad(hasAp ? h12 : p.h);
    else if (l === 'h') out += hasAp ? h12 : p.h;
    else if (l === 'nn') out += pad(p.n);
    else if (l === 'n') out += p.n;
    else if (l === 'ss') out += pad(p.s);
    else if (l === 's') out += p.s;
    else if (l === 'ttttt') out += `${p.h % 12 === 0 ? 12 : p.h % 12}:${pad(p.n)}:${pad(p.s)} ${p.h < 12 ? 'AM' : 'PM'}`;
    else if (l === 'am/pm' || l === 'ampm') out += t === 'am/pm' ? (p.h < 12 ? 'am' : 'pm') : p.h < 12 ? 'AM' : 'PM';
    else if (l === 'a/p') out += t === 'a/p' ? (p.h < 12 ? 'a' : 'p') : p.h < 12 ? 'A' : 'P';
    else out += t;
  }
  return out;
}

const DATE_CHARS = /(^|[^\\"])(yy|mm|dd|hh|nn|ss|ddd|mmm|am\/pm|a\/p)/i;

function isDateFmt(f: string): boolean {
  const bare = f.replace(/"[^"]*"/g, '').replace(/\\./g, '');
  if (/[0#]/.test(bare)) return false;
  return DATE_CHARS.test(` ${bare}`) || (/^[dmyhnsqw\s/:\-.,]+$/i.test(bare) && /[dmyhnsq]/i.test(bare));
}

export function formatValue(v: unknown, fmt?: string): string {
  if (fmt === undefined || fmt === '') return v === undefined || v === null ? '' : toStr(v);
  const low = fmt.toLowerCase();
  if (low === 'yes/no') return toNum(v) !== 0 ? 'Yes' : 'No';
  if (low === 'true/false') return toNum(v) !== 0 ? 'True' : 'False';
  if (low === 'on/off') return toNum(v) !== 0 ? 'On' : 'Off';
  const named: Record<string, string> = { 'long date': 'dddddd', 'medium date': 'dd-mmm-yy', 'short date': 'm/d/yyyy', 'long time': 'h:mm:ss AM/PM', 'medium time': 'hh:mm AM/PM', 'short time': 'hh:mm', 'general date': '' };
  if (low in named) {
    const d = v instanceof VDate ? v.serial : typeof v === 'string' ? parseDate(v) ?? toNum(v) : toNum(v);
    if (low === 'general date') return dateText(d);
    return dateWith(d, named[low]);
  }
  if (low === 'general number') return toStr(typeof v === 'string' ? toNum(v) : v);
  const nf = NAMED_NUM[low];
  if (v instanceof VDate && !nf) return dateWith(v.serial, fmt);
  if (typeof v === 'string' && !nf && !isNumeric(v)) {
    const d = parseDate(v);
    if (d !== null && isDateFmt(fmt)) return dateWith(d, fmt);
    return textFormat(v, fmt);
  }
  const f = nf ?? fmt;
  if (v === undefined) return '';
  if (typeof v === 'boolean' && !nf && isDateFmt(f)) return dateWith(toNum(v), f);
  const n = typeof v === 'string' ? (parseNumber(v) ?? fail(13)) : toNum(v);
  if (isDateFmt(f)) return dateWith(n, f);
  const secs = splitSections(f);
  let sec = secs[0].text;
  let neg = n < 0;
  if (n < 0 && secs.length > 1) {
    sec = secs[1].text;
    neg = false;
  } else if (n === 0 && secs.length > 2) sec = secs[2].text;
  if (sec === 'General') return toStr(n);
  return numberWith(Math.abs(n), sec, neg);
}

function textFormat(s: string, fmt: string): string {
  const secs = splitSections(fmt);
  const f = secs[0].text;
  if (!/[@&<>!]/.test(f)) return s;
  let src = s;
  if (f.includes('<')) src = src.toLowerCase();
  if (f.includes('>')) src = src.toUpperCase();
  const slots = [...f].filter((c) => c === '@' || c === '&').length;
  if (!f.includes('!') && !f.includes('&') && src.length < slots) src = src.padStart(slots, ' ');
  let out = '';
  let i = 0;
  for (const c of f) {
    if (c === '@' || c === '&') {
      out += src[i] ?? (c === '@' ? ' ' : '');
      i++;
    } else if (c !== '<' && c !== '>' && c !== '!') out += c;
  }
  return out + src.slice(i);
}

export function formatNumberFn(n: number, dec = -1, lead = -2, paren = -2, group = -2): string {
  const d = dec < 0 ? 2 : dec;
  let s = roundHalfUp(Math.abs(n), d);
  if (group !== 0) s = s.replace(/^(\d+)/, (m) => groupDigits(m));
  if (lead === 0 && s.startsWith('0.')) s = s.slice(1);
  if (n < 0 && Number(s.replace(/,/g, '')) !== 0) return paren === -1 ? `(${s})` : `-${s}`;
  return s;
}
