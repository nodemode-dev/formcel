import { countryFor, plain } from './map';
import { REGIONS, type Region } from './regions';

const ALIASES: Record<string, string> = {
  'washington dc': 'US-DC', 'washington d.c.': 'US-DC', 'washington, d.c.': 'US-DC', 'd.c.': 'US-DC', 'district of columbia': 'US-DC',
  newfoundland: 'CA-NL', labrador: 'CA-NL', 'yukon territory': 'CA-YT', 'pei': 'CA-PE',
  'inner mongolia': 'CN-NM', 'nei mongol': 'CN-NM', tibet: 'CN-XZ', 'xizang autonomous region': 'CN-XZ',
  'new south wales': 'AU-NSW', 'andaman and nicobar islands': 'IN-AN', orissa: 'IN-OR', uttaranchal: 'IN-UT',
  'saint petersburg': 'RU-SPE', 'st. petersburg': 'RU-SPE', moscow: 'RU-MOS', 'moscow oblast': 'RU-MOW', yakutia: 'RU-SA', sakha: 'RU-SA',
  'bangka belitung': 'ID-BB', 'special region of yogyakarta': 'ID-YO', 'dki jakarta': 'ID-JK', 'jakarta': 'ID-JK', 'east java': 'ID-JI', 'west java': 'ID-JB', 'central java': 'ID-JT',
  'sao paulo': 'BR-SP', 'kwazulu natal': 'ZA-NL', 'kwazulu-natal': 'ZA-NL', 'north-west': 'ZA-NW',
};

const COUNTRY_ORDER = ['US', 'CA', 'AU', 'BR', 'IN', 'CN', 'RU', 'ID', 'ZA'];

interface Index {
  names: Map<string, Region[]>;
  iso: Map<string, Region>;
  codes: Map<string, Region[]>;
}

let cache: Index | null = null;

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

function index(): Index {
  if (cache) return cache;
  const names = new Map<string, Region[]>();
  const iso = new Map<string, Region>();
  const codes = new Map<string, Region[]>();
  for (const r of REGIONS) {
    push(names, plain(r[0]), r);
    iso.set(`${r[2]}-${r[1]}`.toLowerCase(), r);
    if (/^[A-Za-z]{2,3}$/.test(r[1])) push(codes, r[1].toLowerCase(), r);
  }
  cache = { names, iso, codes };
  return cache;
}

interface Candidates {
  strong: Region[];
  weak: Region[];
}

function candidates(text: string): Candidates {
  const ix = index();
  const key = plain(text);
  if (!key) return { strong: [], weak: [] };
  const alias = ALIASES[key];
  const direct = alias ? ix.iso.get(alias.toLowerCase()) : undefined;
  if (direct) return { strong: [direct], weak: [] };
  const byIso = ix.iso.get(key);
  if (byIso) return { strong: [byIso], weak: [] };
  const byName = ix.names.get(key) ?? ix.names.get(key.replace(/^the /, '')) ?? [];
  return { strong: byName, weak: byName.length ? [] : ix.codes.get(key) ?? [] };
}

export type MapLevel = 'country' | 'region';

export interface MapPlan {
  level: MapLevel;
  rows: Map<Region, number[]>;
  countries: string[];
}

export function planMap(cats: string[], want: 'auto' | 'country' | 'region' | undefined): MapPlan {
  const cands = cats.map(candidates);
  const score = new Map<string, number>();
  cands.forEach((c) => {
    for (const r of c.strong) score.set(r[2], (score.get(r[2]) ?? 0) + 1);
  });
  cands.forEach((c) => {
    for (const r of c.weak) score.set(r[2], (score.get(r[2]) ?? 0) + 0.25);
  });
  const rank = (cc: string) => (score.get(cc) ?? 0) * 100 - COUNTRY_ORDER.indexOf(cc);
  const pick = (list: Region[]): Region | null => (list.length ? [...list].sort((a, b) => rank(b[2]) - rank(a[2]))[0] : null);
  const rows = new Map<Region, number[]>();
  let hits = 0;
  cands.forEach((c, i) => {
    const r = pick(c.strong) ?? pick(c.weak);
    if (!r) return;
    hits++;
    push(rows, r, i);
  });
  const countryHits = cats.filter((c) => countryFor(c)).length;
  const level: MapLevel = want === 'region' ? 'region' : want === 'country' ? 'country' : hits > countryHits ? 'region' : 'country';
  const countries = [...new Set([...rows.keys()].map((r) => r[2]))];
  return { level, rows, countries };
}

export function regionsIn(countries: string[]): Region[] {
  return REGIONS.filter((r) => countries.includes(r[2]));
}

export function bounds(regions: Region[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of regions) {
    for (const ring of r[3].split('M').slice(1)) {
      const [start, rest = ''] = ring.split('l');
      const [sx, sy] = start.trim().split(/\s+/).map(Number);
      let x = sx;
      let y = sy;
      const nums = rest.replace('z', '').trim().split(/\s+/).map(Number);
      const take = (px: number, py: number) => {
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      };
      take(x, y);
      for (let i = 0; i + 1 < nums.length; i += 2) {
        x += nums[i];
        y += nums[i + 1];
        take(x, y);
      }
    }
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 1, 1];
}
