export type DockSide = 'bottom' | 'right';
export interface DockState { open: boolean; side: DockSide; h: number; w: number; tab: string }
export interface DockStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

export function readState(store: DockStore, key: string, legacy: string[], defaults: { h: number; w: number }): DockState {
  const read = (k: string): Partial<DockState> | null => {
    try { const v = store.getItem(k); return v ? JSON.parse(v) as Partial<DockState> : null; } catch { return null; }
  };
  const s = read(key) ?? legacy.map(read).find((x) => x !== null) ?? {};
  return {
    open: s.open === true, side: s.side === 'right' ? 'right' : 'bottom',
    h: typeof s.h === 'number' ? s.h : defaults.h, w: typeof s.w === 'number' ? s.w : defaults.w, tab: typeof s.tab === 'string' ? s.tab : '',
  };
}

export function moveLegacy(store: DockStore, key: string, legacy: string[], defaults: { h: number; w: number }): boolean {
  try {
    if (store.getItem(key) !== null || !legacy.some((k) => store.getItem(k) !== null)) return false;
    store.setItem(key, JSON.stringify(readState(store, key, legacy, defaults)));
    for (const k of legacy) store.removeItem(k);
    return true;
  } catch { return false; }
}
