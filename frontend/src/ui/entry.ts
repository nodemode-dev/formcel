import { prefs, type Prefs } from './prefs';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NUMBER = /^[+-]?\d+$/;

function replacements(text: string, list: [string, string][]): string {
  let out = text;
  for (const [from, to] of list) {
    if (!from) continue;
    const word = /^[\w']+$/.test(from);
    if (word) out = out.replace(new RegExp(`(^|[^\\w'])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\w'])`, 'gi'), (_m, lead: string) => lead + to);
    else out = out.split(from).join(to);
  }
  return out;
}

function sentences(text: string): string {
  return text.replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

function initials(text: string): string {
  return text.replace(/\b([A-Z]{2})([a-z]{2,})\b/g, (_m, two: string, rest: string) => two[0] + two[1].toLowerCase() + rest);
}

function days(text: string): string {
  return text.replace(/\b([a-z]+)\b/gi, (w: string) => (DAYS.includes(w.toLowerCase()) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w));
}

function quotes(text: string): string {
  return text
    .replace(/(^|[\s([{—-])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(^|[\s([{—-])'/g, '$1‘')
    .replace(/(\w)'(\w)/g, '$1’$2');
}

export function autocorrect(text: string, p: Prefs): string {
  if (!text || text.startsWith('=') || text.startsWith("'") || /^[\d\s.,:%$/+-]+$/.test(text) || !/[a-z"'(]/i.test(text)) return text;
  let out = text;
  if (p.acReplace) out = replacements(out, p.acList);
  if (p.acInitials) out = initials(out);
  if (p.acSentence) out = sentences(out);
  if (p.acDays) out = days(out);
  if (p.acQuotes) out = quotes(out);
  return out;
}

export function fixedDecimal(text: string, places: number): string {
  const t = text.trim();
  if (!NUMBER.test(t)) return text;
  const neg = t.startsWith('-');
  const digits = t.replace(/^[+-]/, '').replace(/^0+(?=\d)/, '').padStart(places + 1, '0');
  const cut = digits.length - places;
  return `${neg ? '-' : ''}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

export function entryFilter(raw: string): string {
  const p = prefs();
  let out = raw;
  if (p.autoDecimal) out = fixedDecimal(out, p.decimals);
  if (out === raw) out = autocorrect(raw, p);
  return out;
}
