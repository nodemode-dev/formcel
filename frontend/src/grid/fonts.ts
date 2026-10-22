type Loader = () => Promise<unknown>;

const FAMILIES: Record<string, Loader> = {
  'Inter': () => Promise.all([import('@fontsource/inter/400.css'), import('@fontsource/inter/700.css'), import('@fontsource/inter/400-italic.css')]),
  'JetBrains Mono': () => Promise.all([import('@fontsource/jetbrains-mono/400.css'), import('@fontsource/jetbrains-mono/700.css')]),
  'Poppins': () => Promise.all([import('@fontsource/poppins/400.css'), import('@fontsource/poppins/700.css'), import('@fontsource/poppins/400-italic.css')]),
  'Montserrat': () => Promise.all([import('@fontsource/montserrat/400.css'), import('@fontsource/montserrat/700.css'), import('@fontsource/montserrat/400-italic.css')]),
  'Playfair Display': () => Promise.all([import('@fontsource/playfair-display/400.css'), import('@fontsource/playfair-display/700.css'), import('@fontsource/playfair-display/400-italic.css')]),
  'DM Sans': () => Promise.all([import('@fontsource/dm-sans/400.css'), import('@fontsource/dm-sans/700.css'), import('@fontsource/dm-sans/400-italic.css')]),
  'DM Serif Display': () => Promise.all([import('@fontsource/dm-serif-display/400.css'), import('@fontsource/dm-serif-display/400-italic.css')]),
  'Space Grotesk': () => Promise.all([import('@fontsource/space-grotesk/400.css'), import('@fontsource/space-grotesk/700.css')]),
  'Sora': () => Promise.all([import('@fontsource/sora/400.css'), import('@fontsource/sora/700.css')]),
  'Manrope': () => Promise.all([import('@fontsource/manrope/400.css'), import('@fontsource/manrope/700.css')]),
  'Outfit': () => Promise.all([import('@fontsource/outfit/400.css'), import('@fontsource/outfit/700.css')]),
  'Lora': () => Promise.all([import('@fontsource/lora/400.css'), import('@fontsource/lora/700.css'), import('@fontsource/lora/400-italic.css')]),
  'Merriweather': () => Promise.all([import('@fontsource/merriweather/400.css'), import('@fontsource/merriweather/700.css'), import('@fontsource/merriweather/400-italic.css')]),
  'Raleway': () => Promise.all([import('@fontsource/raleway/400.css'), import('@fontsource/raleway/700.css'), import('@fontsource/raleway/400-italic.css')]),
  'Bebas Neue': () => import('@fontsource/bebas-neue/400.css'),
  'Fraunces': () => Promise.all([import('@fontsource/fraunces/400.css'), import('@fontsource/fraunces/700.css'), import('@fontsource/fraunces/400-italic.css')]),
  'Work Sans': () => Promise.all([import('@fontsource/work-sans/400.css'), import('@fontsource/work-sans/700.css'), import('@fontsource/work-sans/400-italic.css')]),
  'IBM Plex Sans': () => Promise.all([import('@fontsource/ibm-plex-sans/400.css'), import('@fontsource/ibm-plex-sans/700.css'), import('@fontsource/ibm-plex-sans/400-italic.css')]),
  'Archivo': () => Promise.all([import('@fontsource/archivo/400.css'), import('@fontsource/archivo/700.css'), import('@fontsource/archivo/400-italic.css')]),
  'Nunito': () => Promise.all([import('@fontsource/nunito/400.css'), import('@fontsource/nunito/700.css'), import('@fontsource/nunito/400-italic.css')]),
  'Plus Jakarta Sans': () => Promise.all([import('@fontsource/plus-jakarta-sans/400.css'), import('@fontsource/plus-jakarta-sans/700.css'), import('@fontsource/plus-jakarta-sans/400-italic.css')]),
  'Syne': () => Promise.all([import('@fontsource/syne/400.css'), import('@fontsource/syne/700.css')]),
  'Oswald': () => Promise.all([import('@fontsource/oswald/400.css'), import('@fontsource/oswald/700.css')]),
  'Cormorant Garamond': () => Promise.all([import('@fontsource/cormorant-garamond/400.css'), import('@fontsource/cormorant-garamond/700.css'), import('@fontsource/cormorant-garamond/400-italic.css')]),
  'Source Sans 3': () => Promise.all([import('@fontsource/source-sans-3/400.css'), import('@fontsource/source-sans-3/700.css'), import('@fontsource/source-sans-3/400-italic.css')]),
  'Caveat': () => Promise.all([import('@fontsource/caveat/400.css'), import('@fontsource/caveat/700.css')]),
  'Libre Baskerville': () => Promise.all([import('@fontsource/libre-baskerville/400.css'), import('@fontsource/libre-baskerville/700.css'), import('@fontsource/libre-baskerville/400-italic.css')]),
  'Figtree': () => Promise.all([import('@fontsource/figtree/400.css'), import('@fontsource/figtree/700.css'), import('@fontsource/figtree/400-italic.css')]),
};

export const BUNDLED_FONTS = Object.keys(FAMILIES).sort();
const loaded = new Map<string, Promise<void>>();
const ready = new Set<string>();
const listeners = new Set<(families: string[]) => void>();
let batch: string[] = [];
let batchTimer = 0;

export function isBundled(family: string): boolean {
  return family in FAMILIES;
}

export function isFontReady(family: string): boolean {
  return !(family in FAMILIES) || ready.has(family);
}

export function onFontsLoaded(fn: (families: string[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(family: string): void {
  batch.push(family);
  if (batchTimer) return;
  batchTimer = window.setTimeout(() => {
    batchTimer = 0;
    const got = batch;
    batch = [];
    for (const fn of listeners) fn(got);
  }, 30);
}

export function ensureFont(family: string): Promise<void> {
  const have = loaded.get(family);
  if (have) return have;
  const loader = FAMILIES[family];
  const p = (loader ? loader() : Promise.resolve())
    .then(() => Promise.all([document.fonts.load(`400 16px "${family}"`), document.fonts.load(`700 16px "${family}"`)]))
    .then(() => {
      if (isBundled(family)) {
        ready.add(family);
        announce(family);
      }
    })
    .catch(() => undefined);
  loaded.set(family, p);
  return p;
}

export function ensureFonts(families: Iterable<string>, timeoutMs = 2500): Promise<void> {
  const all = Promise.all(Array.from(new Set(families)).filter(Boolean).map(ensureFont)).then(() => undefined);
  return Promise.race([all, new Promise<void>((ok) => window.setTimeout(ok, timeoutMs))]);
}

export function firstFamily(stack: string): string {
  const m = /^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/.exec(stack);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
}

export function systemFontsAvailable(): boolean {
  return true;
}

let systemFonts: Promise<string[]> | null = null;
let systemList: string[] = [];

export function systemFontsNow(): string[] {
  return systemList;
}

export function loadSystemFonts(): Promise<string[]> {
  if (systemFonts) return systemFonts;
  const raw = async (): Promise<string[]> => {
    if ('__TAURI_INTERNALS__' in window) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const names = await invoke<string[]>('system_fonts');
        if (names.length) return names;
      } catch { /* fall through to the engine process */ }
    }
    if ('queryLocalFonts' in window) {
      try {
        const faces = await (window as unknown as { queryLocalFonts(): Promise<Array<{ family: string }>> }).queryLocalFonts();
        if (faces.length) return faces.map((f) => f.family);
      } catch { /* permission refused */ }
    }
    const r = await fetch('/api/fonts');
    if (!r.ok) return [];
    const j = (await r.json()) as { families?: string[] };
    return j.families ?? [];
  };
  systemFonts = raw().catch(() => [] as string[]).then((names) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of names) {
      const k = n.trim().toLowerCase();
      if (!k || seen.has(k) || BUNDLED_FONTS.some((b) => b.toLowerCase() === k)) continue;
      seen.add(k);
      out.push(n.trim());
    }
    systemList = out.sort((a, b) => a.localeCompare(b));
    return systemList;
  });
  return systemFonts;
}

const RECENT_KEY = 'formcel.fonts.recent';

export function recentFonts(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function noteRecentFont(family: string): void {
  if (!family) return;
  try {
    const next = [family, ...recentFonts().filter((f) => f !== family)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage unavailable */ }
}

export interface FontGroups {
  theme: { label: string; name: string }[];
  recent: string[];
  bundled: string[];
  system: string[];
  workbook: string[];
}

export function fontGroups(theme: { heading: string; body: string }, used: Iterable<string>): FontGroups {
  const sys = systemList;
  const known = new Set<string>([...BUNDLED_FONTS, ...sys].map((s) => s.toLowerCase()));
  const workbook = Array.from(new Set(used)).filter((f) => f && !f.startsWith('+') && !known.has(f.toLowerCase()) && !isGenericFont(f)).sort((a, b) => a.localeCompare(b));
  return {
    theme: [{ label: 'Headings', name: theme.heading }, { label: 'Body', name: theme.body }],
    recent: recentFonts(),
    bundled: BUNDLED_FONTS,
    system: sys,
    workbook,
  };
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

export function isGenericFont(f: string): boolean {
  return GENERIC.has(f.toLowerCase());
}

let measureCtx: CanvasRenderingContext2D | null = null;

export function isInstalled(family: string): boolean {
  if (isBundled(family) || systemList.some((s) => s.toLowerCase() === family.toLowerCase())) return true;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return true;
  const probe = (fb: string): number => {
    measureCtx!.font = `40px "${family}", ${fb}`;
    return measureCtx!.measureText('mmmmmmmmmmlli WQ').width;
  };
  measureCtx.font = '40px monospace';
  const m = measureCtx.measureText('mmmmmmmmmmlli WQ').width;
  measureCtx.font = '40px serif';
  const s = measureCtx.measureText('mmmmmmmmmmlli WQ').width;
  return probe('monospace') !== m || probe('serif') !== s;
}

export const SIZE_PRESETS = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];

export function stepSize(cur: number, dir: 1 | -1): number {
  const r = Math.round(cur * 10) / 10;
  if (dir > 0) return SIZE_PRESETS.find((x) => x > r) ?? Math.min(409, r + 12);
  return [...SIZE_PRESETS].reverse().find((x) => x < r) ?? Math.max(1, r - 1);
}
