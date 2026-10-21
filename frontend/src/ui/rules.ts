import { colName, type Range } from '../grid/a1';

export const PRESETS: [string, string][] = [
  ['Light red fill with dark red text', 'fc:9c0006;bg:ffc7ce'],
  ['Yellow fill with dark yellow text', 'fc:9c5700;bg:ffeb9c'],
  ['Green fill with dark green text', 'fc:006100;bg:c6efce'],
  ['Light red fill', 'bg:ffc7ce'],
  ['Red text', 'fc:9c0006'],
  ['Red border', 'bt:thin:ff0000;br:thin:ff0000;bb:thin:ff0000;bl:thin:ff0000'],
  ['Bold', 'b'],
];

export const DATE_PERIODS: [string, string][] = [
  ['yesterday', 'Yesterday'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['last7', 'In the last 7 days'],
  ['lastweek', 'Last week'], ['thisweek', 'This week'], ['nextweek', 'Next week'],
  ['lastmonth', 'Last month'], ['thismonth', 'This month'], ['nextmonth', 'Next month'],
];

const OP_TEXT: Record<string, string> = { gt: 'greater than', lt: 'less than', ge: 'at least', le: 'at most', eq: 'equal to', ne: 'not equal to', between: 'between', notbetween: 'not between' };

function clean(s: string): string {
  return s.replace(/[\t\n\r]/g, ' ');
}

export function ruleLine(a: Range, kind: string, args: string[], style = '', stop = false): string {
  const [p1 = '', p2 = '', p3 = ''] = args.map(clean);
  return [`${a.r0},${a.c0},${a.r1},${a.c1}`, stop ? '1' : '0', kind, p1, p2, p3, style].join('\t');
}

export function rangeText(a: Range): string {
  const cell = (r: number, c: number) => `${colName(c)}${r + 1}`;
  return a.r0 === a.r1 && a.c0 === a.c1 ? cell(a.r0, a.c0) : `${cell(a.r0, a.c0)}:${cell(a.r1, a.c1)}`;
}

export interface ParsedRule {
  area: Range;
  stop: boolean;
  kind: string;
  args: string[];
  style: string;
}

export function parseRule(line: string): ParsedRule {
  const [area, stop, kind, p1 = '', p2 = '', p3 = '', style = ''] = line.split('\t');
  const [r0, c0, r1, c1] = area.split(',').map(Number);
  return { area: { r0, c0, r1, c1 }, stop: stop === '1', kind, args: [p1, p2, p3], style };
}

export function withStop(line: string, stop: boolean): string {
  const p = line.split('\t');
  p[1] = stop ? '1' : '0';
  return p.join('\t');
}

export function describe(line: string): string {
  const { kind, args: [a, b, c], style } = parseRule(line);
  const look = PRESETS.find(([, s]) => s === style)?.[0];
  const tail = look ? `: ${look.toLowerCase()}` : style ? ': custom format' : '';
  switch (kind) {
    case 'cell':
      return `Cell value ${OP_TEXT[a] ?? a} ${b}${a.includes('between') ? ` and ${c}` : ''}${tail}`;
    case 'text':
      return `Text that ${a === 'notcontains' ? 'does not contain' : a === 'begins' ? 'begins with' : a === 'ends' ? 'ends with' : 'contains'} "${b}"${tail}`;
    case 'date':
      return `A date occurring ${DATE_PERIODS.find(([k]) => k === a)?.[1].toLowerCase() ?? a}${tail}`;
    case 'dup':
      return `${a === 'unique' ? 'Unique' : 'Duplicate'} values${tail}`;
    case 'top':
      return `${a === 'bottom' ? 'Bottom' : 'Top'} ${b}${c === '%' ? '%' : ''}${tail}`;
    case 'avg':
      return `${a === 'below' ? 'Below' : 'Above'} average${tail}`;
    case 'blank':
      return `${{ blank: 'Blank cells', noblank: 'Cells that are not blank', error: 'Errors', noerror: 'No errors' }[a] ?? a}${tail}`;
    case 'formula':
      return `Formula ${a}${tail}`;
    case 'scale':
      return `${b.split(',').length}-colour scale`;
    case 'bar':
      return 'Data bar';
    case 'icons':
      return `Icon set: ${a.replace(/^(\d)/, '$1 ')}`;
    default:
      return kind;
  }
}
