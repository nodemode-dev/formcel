import { icons } from './icons';

const table = icons as Record<string, string>;

export const hasIcon = (name: string): boolean => name in table;

export function rbIcon(name: string, size: number): string {
  const s = table[name] ?? table.dots;
  return s.replace('<svg ', `<svg class="rb-svg" width="${size}" height="${size}" `);
}
