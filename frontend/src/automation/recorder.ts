import { colName } from '../grid/a1';
import type { Recorded } from '../grid/grid';

const q = (s: string) => JSON.stringify(s);
const addr = (r0: number, c0: number, r1: number, c1: number) => (r0 === r1 && c0 === c1 ? `${colName(c0)}${r0 + 1}` : `${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}`);

function styleLine(target: string, patch: string): string | null {
  const t = patch.trim();
  const on = !t.startsWith('!');
  const k = t.replace(/^!/, '');
  const f = `${target}.getFormat()`;
  if (k === 'b') return `${f}.getFont().setBold(${on});`;
  if (k === 'i') return `${f}.getFont().setItalic(${on});`;
  if (k === 'u') return `${f}.getFont().setUnderline(${on});`;
  if (k === 'wrap') return `${f}.setWrapText(${on});`;
  if (k.startsWith('bg:') && on && /^[0-9a-f]{6}$/i.test(k.slice(3))) return `${f}.getFill().setColor("#${k.slice(3)}");`;
  if (k.startsWith('fc:') && on && /^[0-9a-f]{6}$/i.test(k.slice(3))) return `${f}.getFont().setColor("#${k.slice(3)}");`;
  if (k.startsWith('sz:') && on) return `${f}.getFont().setSize(${Number(k.slice(3))});`;
  if (k.startsWith('ff:') && on) return `${f}.getFont().setName(${q(k.slice(3))});`;
  if (k.startsWith('ha:') && on) return `${f}.setHorizontalAlignment(${q(k.slice(3))});`;
  return null;
}

function anchorOf(a: Recorded | undefined): { sheet: number; r: number; c: number } | null {
  if (!a) return null;
  if (a.k === 'edit') return { sheet: a.sheet, r: a.r, c: a.c };
  if (a.k === 'style') return a.ops[0] ? { sheet: a.sheet, r: a.ops[0][0], c: a.ops[0][1] } : null;
  return { sheet: a.sheet, r: a.r0, c: a.c0 };
}

export function generate(actions: Recorded[], sheetNames: (i: number) => string, name: string, relative = false): string {
  const used: string[] = [];
  const anchor = relative ? anchorOf(actions[0]) : null;
  const v = (i: number) => {
    if (anchor && i === anchor.sheet) return 'here';
    const n = sheetNames(i);
    if (!used.includes(n)) used.push(n);
    return `s${used.indexOf(n) + 1}`;
  };
  const at = (sheet: number, r0: number, c0: number, r1: number, c1: number) =>
    anchor && sheet === anchor.sheet ? `here.getRangeByIndexes(row + ${r0 - anchor.r}, col + ${c0 - anchor.c}, ${r1 - r0 + 1}, ${c1 - c0 + 1})` : `${v(sheet)}.getRange(${q(addr(r0, c0, r1, c1))})`;
  const body: string[] = [];
  for (const a of actions) {
    if (a.k === 'edit') {
      const t = at(a.sheet, a.r, a.c, a.r, a.c);
      if (a.raw === '') body.push(`${t}.clear();`);
      else if (a.raw.startsWith('=')) body.push(`${t}.setFormula(${q(a.raw)});`);
      else {
        const n = a.raw.trim() !== '' && Number.isFinite(Number(a.raw.replace(/,/g, ''))) && /^[+-]?[\d,]*\.?\d+(e[+-]?\d+)?$/i.test(a.raw.trim());
        body.push(`${t}.setValue(${n ? Number(a.raw.replace(/,/g, '')) : q(a.raw)});`);
      }
    } else if (a.k === 'style') {
      for (const [r0, c0, r1, c1, patch] of a.ops) {
        const t = at(a.sheet, r0, c0, r1, c1);
        for (const p of patch.split(';')) {
          if (!p.trim()) continue;
          const line = styleLine(t, p);
          body.push(line ?? `// style ${p} is not recorded`);
        }
      }
    } else if (a.k === 'format') {
      body.push(`${at(a.sheet, a.r0, a.c0, a.r1, a.c1)}.setNumberFormat(${q(a.code)});`);
    } else if (a.k === 'sort') {
      const [col, desc] = a.keys[0] ?? [a.c0, false];
      body.push(`${at(a.sheet, a.r0, a.c0, a.r1, a.c1)}.sort(${col - a.c0}, ${desc}, ${a.header});`);
    }
  }
  const head = used.map((n, i) => `  const s${i + 1} = workbook.getWorksheet(${q(n)})!;`);
  if (anchor) head.unshift('  const here = workbook.getActiveWorksheet();', '  const start = workbook.getSelectedRange();', '  const row = start.getRowIndex();', '  const col = start.getColumnIndex();');
  return `// ${name}\nfunction main(workbook: ExcelScript.Workbook) {\n${[...head, ...body.map((l) => `  ${l}`)].join('\n')}\n}\n`;
}
