const KEY = 'fc.sortLists';

export function loadSortLists(): string[][] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((l): l is string[] => Array.isArray(l) && l.every((x) => typeof x === 'string')) : [];
  } catch {
    return [];
  }
}

export function saveSortList(items: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...loadSortLists(), items]));
  } catch {
    return;
  }
}
