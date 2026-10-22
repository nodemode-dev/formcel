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

export const REGION_UNITS = 20;

const COUNTRY_ORDER = ['US', 'CA', 'AU', 'BR', 'IN', 'CN', 'RU', 'ID', 'ZA'];

interface Index {
  names: Map<string, Region[]>;
  iso: Map<string, Region>;
  codes: Map<string, Region[]>;
}

let cache: Index | null = null;
let extra: Region[] = [];
let extraLoad: Promise<void> | null = null;

function every(): Region[] {
  return extra.length ? REGIONS.concat(extra) : REGIONS;
}

export function loadMoreRegions(): Promise<void> {
  if (!extraLoad) {
    extraLoad = import('./regions_more').then((m) => {
      extra = m.MORE_REGIONS;
      cache = null;
    });
  }
  return extraLoad;
}

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
  for (const r of every()) {
    push(names, plain(r[0]), r);
    if (r[4]) for (const a of r[4].split('|')) push(names, plain(a), r);
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

export function geoRegionOf(cats: string[], want: 'auto' | 'country' | 'region' | undefined): string | undefined {
  const plan = planMap(cats, want);
  if (plan.level === 'region' && plan.countries.length) return plan.countries[0];
  const tally = new Map<string, number>();
  for (const c of cats) {
    const hit = countryFor(c);
    if (hit) tally.set(hit[1], (tally.get(hit[1]) ?? 0) + 1);
  }
  const top = [...tally].sort((a, b) => b[1] - a[1])[0];
  return top && /^[A-Z]{2}$/.test(top[0]) ? top[0] : undefined;
}

export function regionsIn(countries: string[]): Region[] {
  return every().filter((r) => countries.includes(r[2]));
}

const CENTERS = new WeakMap<Region, [number, number]>();

export function center(r: Region): [number, number] {
  let c = CENTERS.get(r);
  if (!c) {
    const [x0, y0, x1, y1] = pathBox(r[3]);
    c = [(x0 + x1) / 2, (y0 + y1) / 2];
    CENTERS.set(r, c);
  }
  return c;
}

export function pathBox(path: string): [number, number, number, number] {
  let best: [number, number, number, number] = [0, 0, 0, 0];
  let size = -1;
  for (const ring of path.split('M').slice(1)) {
    const b = bounds([['', '', '', `M${ring}`]]);
    const s = (b[2] - b[0]) * (b[3] - b[1]);
    if (s > size) {
      size = s;
      best = b;
    }
  }
  return best;
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
