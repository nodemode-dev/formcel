import { WORLD, type Country } from './world';

const ALIASES: Record<string, string> = {
  usa: 'USA', us: 'USA', 'u.s.': 'USA', 'u.s.a.': 'USA', america: 'USA', 'united states of america': 'USA',
  uk: 'GBR', 'u.k.': 'GBR', 'great britain': 'GBR', britain: 'GBR', england: 'GBR', scotland: 'GBR', wales: 'GBR',
  russia: 'RUS', 'south korea': 'KOR', korea: 'KOR', 'north korea': 'PRK', 'republic of korea': 'KOR',
  czechia: 'CZE', 'ivory coast': 'CIV', "cote d'ivoire": 'CIV', burma: 'MMR', 'viet nam': 'VNM', laos: 'LAO',
  uae: 'ARE', emirates: 'ARE', swaziland: 'SWZ', eswatini: 'SWZ', drc: 'COD', 'dr congo': 'COD', 'congo (kinshasa)': 'COD',
  'democratic republic of congo': 'COD', 'congo-kinshasa': 'COD', 'congo (brazzaville)': 'COG', 'congo-brazzaville': 'COG',
  macedonia: 'MKD', holland: 'NLD', 'the netherlands': 'NLD', turkiye: 'TUR', 'türkiye': 'TUR', brunei: 'BRN',
  'east timor': 'TLS', 'timor leste': 'TLS', gambia: 'GMB', 'the bahamas': 'BHS', 'cape verde': 'CPV', palestine: 'PSE',
  'west bank': 'PSE', 'falkland islands': 'FLK', 'central african republic': 'CAF', 'bosnia': 'BIH', 'trinidad': 'TTO',
  persia: 'IRN', 'iran, islamic republic of': 'IRN', 'syrian arab republic': 'SYR', 'peoples republic of china': 'CHN',
  'hong kong': 'CHN', 'republic of ireland': 'IRL', 'russian federation': 'RUS', 'slovak republic': 'SVK',
};

export function plain(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const INDEX = new Map<string, Country>();

function index(): Map<string, Country> {
  if (INDEX.size) return INDEX;
  for (const c of WORLD) {
    for (const key of [c[0], c[3], c[1], c[2]]) if (key) INDEX.set(plain(key), c);
  }
  for (const [alias, a3] of Object.entries(ALIASES)) {
    const c = WORLD.find((x) => x[2] === a3);
    if (c) INDEX.set(plain(alias), c);
  }
  return INDEX;
}

export function countryFor(name: string): Country | null {
  const key = plain(name);
  if (!key) return null;
  const idx = index();
  return idx.get(key) ?? idx.get(key.replace(/^the /, '')) ?? null;
}

export function ramp(t: number, base: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(base.trim());
  const rgb = m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [78, 121, 167];
  const k = Math.max(0, Math.min(1, t));
  const mix = (c: number) => Math.round(236 + (c - 236) * (0.18 + 0.82 * k));
  return `rgb(${mix(rgb[0])},${mix(rgb[1])},${mix(rgb[2])})`;
}

export function matched(names: string[]): number {
  return names.filter((n) => countryFor(n)).length;
}
