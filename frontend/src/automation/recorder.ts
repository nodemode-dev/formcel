import { colName, parseRef } from '../grid/a1';
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
  if (a.k === 'shift') return { sheet: a.sheet, r: a.rows ? a.at : 0, c: a.rows ? 0 : a.at };
  if (a.k === 'fill') return { sheet: a.sheet, r: a.src[0], c: a.src[1] };
  if (a.k === 'sheetop' || a.k === 'filter' || a.k === 'chart') return null;
  return { sheet: a.sheet, r: a.r0, c: a.c0 };
}

const CHART_NAMES: Record<string, string> = {
  column: 'ColumnClustered', 'column-stacked': 'ColumnStacked', 'column-100': 'ColumnStacked100', bar: 'BarClustered', 'bar-stacked': 'BarStacked', 'bar-100': 'BarStacked100', line: 'Line', area: 'Area', 'area-stacked': 'AreaStacked', 'area-100': 'AreaStacked100', pie: 'Pie', doughnut: 'Doughnut', scatter: 'XYScatter', bubble: 'Bubble', radar: 'Radar',
};

function filterLines(text: string): { area: [number, number, number, number] | null; cols: { col: number; fields: string[] }[] } {
  let area: [number, number, number, number] | null = null;
  const cols: { col: number; fields: string[] }[] = [];
  for (const l of text.split('\n')) {
    const p = l.split('\t');
    if (p[0] === 'area') {
      const n = (p[1] ?? '').split(',').map(Number);
      if (n.length === 4 && n.every(Number.isFinite)) area = [n[0], n[1], n[2], n[3]];
    } else if (p[0] === 'col' && p.length > 2) cols.push({ col: Number(p[1]), fields: p.slice(2).map((f) => f.replace(/\\(.)/g, (_, ch: string) => (ch === 't' ? '\t' : ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch))) });
  }
  return { area, cols };
}

export function generate(actions: Recorded[], sheetNames: (i: number) => string, name: string, relative = false, start?: string[], origin?: { sheet: number; r: number; c: number }): string {
  const cur: { id: number; name: string; orig: string }[] = (start ?? []).map((n, i) => ({ id: i, name: n, orig: n }));
  const initial = cur.length;
  let fresh = initial;
  const idAt = (i: number) => (cur[i] ??= { id: fresh++, name: sheetNames(i), orig: sheetNames(i) }).id;
  const used: { id: number; name: string }[] = [];
  const made = new Map<number, string>();
  const first = actions.find((a) => anchorOf(a));
  const anchor = relative ? origin ?? anchorOf(first) : null;
  const anchorId = anchor ? idAt(anchor.sheet) : -1;
  const here = anchor !== null && anchorId < initial;
  const v = (i: number) => {
    const id = idAt(i);
    if (here && id === anchorId) return 'here';
    const m = made.get(id);
    if (m) return m;
    if (!used.some((u) => u.id === id)) used.push({ id, name: cur[i].orig });
    return `s${used.findIndex((u) => u.id === id) + 1}`;
  };
  const rel = (sheet: number) => anchor !== null && idAt(sheet) === anchorId;
  const at = (sheet: number, r0: number, c0: number, r1: number, c1: number) =>
    anchor && rel(sheet) ? `${v(sheet)}.getRangeByIndexes(row + ${r0 - anchor.r}, col + ${c0 - anchor.c}, ${r1 - r0 + 1}, ${c1 - c0 + 1})` : `${v(sheet)}.getRange(${q(addr(r0, c0, r1, c1))})`;
  const wholeLines = (sheet: number, rows: boolean, at0: number, n: number) => {
    if (anchor && rel(sheet)) return rows ? `${v(sheet)}.getRangeByIndexes(row + ${at0 - anchor.r}, 0, ${n}, 16384)` : `${v(sheet)}.getRangeByIndexes(0, col + ${at0 - anchor.c}, 1048576, ${n})`;
    return rows ? `${v(sheet)}.getRange(${q(`${at0 + 1}:${at0 + n}`)})` : `${v(sheet)}.getRange(${q(`${colName(at0)}:${colName(at0 + n - 1)}`)})`;
  };
  const body: string[] = [];
  let lastClear = '';
  for (const a of actions) {
    if (a.k === 'shift') {
      const how = a.insert ? (a.rows ? 'insert("Down")' : 'insert("Right")') : a.rows ? 'delete("Up")' : 'delete("Left")';
      body.push(`${wholeLines(a.sheet, a.rows, a.at, a.n)}.${how};`);
      continue;
    }
    if (a.k === 'cells') {
      const how = a.dir === 'down' ? 'Down' : a.dir === 'right' ? 'Right' : a.dir === 'up' ? 'Up' : 'Left';
      body.push(`${at(a.sheet, a.r0, a.c0, a.r1, a.c1)}.${a.insert ? 'insert' : 'delete'}(${q(how)});`);
      continue;
    }
    if (a.k === 'merge') {
      const t = at(a.sheet, a.r0, a.c0, a.r1, a.c1);
      if (a.mode === 'unmerge') body.push(`${t}.unmerge();`);
      else {
        body.push(`${t}.merge(${a.mode === 'across'});`);
        if (a.mode === 'center') body.push(`${t}.getFormat().setHorizontalAlignment("center");`);
      }
      continue;
    }
    if (a.k === 'sheetop') {
      if (a.op === 'add') {
        const nv = `n${made.size + 1}`;
        cur.splice(a.sheet, 0, { id: fresh++, name: a.name, orig: a.name });
        made.set(cur[a.sheet].id, nv);
        body.push(`const ${nv} = workbook.addWorksheet(${q(a.name)});`, `${nv}.activate();`);
      } else if (a.op === 'rename') {
        body.push(`${v(a.sheet)}.setName(${q(a.to ?? a.name)});`);
        cur[a.sheet].name = a.to ?? a.name;
      } else {
        body.push(`${v(a.sheet)}.delete();`);
        cur.splice(a.sheet, 1);
      }
      continue;
    }
    if (a.k === 'fill') {
      body.push(`${at(a.sheet, ...a.src)}.autoFill(${at(a.sheet, ...a.dest)}, "FillDefault");`);
      continue;
    }
    if (a.k === 'clear') {
      lastClear = `${a.sheet}:${a.r0}:${a.c0}:${a.r1}:${a.c1}`;
      body.push(`${at(a.sheet, a.r0, a.c0, a.r1, a.c1)}.clear("Contents");`);
      continue;
    }
    if (a.k === 'filter') {
      const f = `${v(a.sheet)}.getAutoFilter()`;
      const { area, cols } = filterLines(a.text);
      if (!area) {
        body.push(`${f}.remove();`);
        continue;
      }
      const ra = at(a.sheet, ...area);
      body.push(`${f}.apply(${ra});`, `${f}.clearCriteria();`);
      for (const c of cols) {
        const ci = anchor && rel(a.sheet) ? `col + ${c.col - anchor.c}` : String(c.col);
        const crit = c.fields[0] === 'values' ? `{ filterOn: "Values", blanks: ${c.fields[1] === '1'}, values: ${JSON.stringify(c.fields.slice(2))} }` : `{ filterOn: "FormCel", fields: ${JSON.stringify(c.fields)} }`;
        body.push(`${f}.apply(${ra}, ${ci}, ${crit});`);
      }
      continue;
    }
    if (a.k === 'chart') {
      const t = CHART_NAMES[a.type] ?? a.type;
      const box = parseRef(a.range);
      const source = box && anchor && rel(a.sheet) ? at(a.sheet, box.r0, box.c0, box.r1, box.c1) : q(a.range);
      body.push(`${v(a.sheet)}.addChart(${q(t)}, ${source}${a.byRows ? ', "Rows"' : ''})${a.title ? `.setTitle(${q(a.title)})` : ''};`);
      continue;
    }
    if (a.k === 'edit') {
      const t = at(a.sheet, a.r, a.c, a.r, a.c);
      if (a.raw === '') body.push(`${t}.clear("Contents");`);
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
          if (p.trim() === 'clear') {
            body.push(`${t}.clear("Formats");`);
            lastClear = `fmt:${a.sheet}:${r0}:${c0}:${r1}:${c1}`;
            continue;
          }
          const line = styleLine(t, p);
          body.push(line ?? `// style ${p} is not recorded`);
        }
      }
    } else if (a.k === 'format') {
      if (a.code === '' && lastClear === `fmt:${a.sheet}:${a.r0}:${a.c0}:${a.r1}:${a.c1}`) continue;
      body.push(`${at(a.sheet, a.r0, a.c0, a.r1, a.c1)}.setNumberFormat(${q(a.code)});`);
    } else if (a.k === 'sort') {
      const [col, desc] = a.keys[0] ?? [a.c0, false];
      body.push(`${at(a.sheet, a.r0, a.c0, a.r1, a.c1)}.sort(${col - a.c0}, ${desc}, ${a.header});`);
    }
  }
  const head = used.map((u, i) => `  const s${i + 1} = workbook.getWorksheet(${q(u.name)})!;`);
  if (anchor) head.unshift('  const here = workbook.getActiveWorksheet();', '  const start = workbook.getSelectedRange();', '  const row = start.getRowIndex();', '  const col = start.getColumnIndex();');
  return `// ${name}\nfunction main(workbook: ExcelScript.Workbook) {\n${[...head, ...body.map((l) => `  ${l}`)].join('\n')}\n}\n`;
}
