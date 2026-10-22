import { colName, parseRef } from '../grid/a1';
import type { Recorded } from '../grid/grid';

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const addr = (r0: number, c0: number, r1: number, c1: number) => (r0 === r1 && c0 === c1 ? `${colName(c0)}${r0 + 1}` : `${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}`);

const CHART_TYPES: Record<string, string> = {
  column: 'xlColumnClustered', 'column-stacked': 'xlColumnStacked', 'column-100': 'xlColumnStacked100', bar: 'xlBarClustered', 'bar-stacked': 'xlBarStacked', 'bar-100': 'xlBarStacked100', line: 'xlLine', area: 'xlArea', 'area-stacked': 'xlAreaStacked', 'area-100': 'xlAreaStacked100', pie: 'xlPie', doughnut: 'xlDoughnut', scatter: 'xlXYScatter', bubble: 'xlBubble', radar: 'xlRadar',
};

const ALIGN: Record<string, string> = { left: 'xlLeft', center: 'xlCenter', right: 'xlRight', justify: 'xlJustify' };

function rgb(hex: string): string {
  const n = parseInt(hex, 16);
  return `RGB(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function styleLine(target: string, patch: string): string | null {
  const t = patch.trim();
  const on = !t.startsWith('!');
  const k = t.replace(/^!/, '');
  const b = on ? 'True' : 'False';
  if (k === 'b') return `${target}.Font.Bold = ${b}`;
  if (k === 'i') return `${target}.Font.Italic = ${b}`;
  if (k === 'u') return `${target}.Font.Underline = ${on ? 'xlUnderlineStyleSingle' : 'xlUnderlineStyleNone'}`;
  if (k === 'wrap') return `${target}.WrapText = ${b}`;
  if (k.startsWith('bg:') && on && /^[0-9a-f]{6}$/i.test(k.slice(3))) return `${target}.Interior.Color = ${rgb(k.slice(3))}`;
  if (k.startsWith('fc:') && on && /^[0-9a-f]{6}$/i.test(k.slice(3))) return `${target}.Font.Color = ${rgb(k.slice(3))}`;
  if (k.startsWith('sz:') && on) return `${target}.Font.Size = ${Number(k.slice(3))}`;
  if (k.startsWith('ff:') && on) return `${target}.Font.Name = ${q(k.slice(3))}`;
  if (k.startsWith('ha:') && on && ALIGN[k.slice(3)]) return `${target}.HorizontalAlignment = ${ALIGN[k.slice(3)]}`;
  return null;
}

function filterFields(text: string): { area: [number, number, number, number] | null; cols: { col: number; fields: string[] }[] } {
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

export interface VbaRecording {
  code: string;
  attrs: string[];
  skipped: number;
}

export function generateVba(actions: Recorded[], sheetNames: (i: number) => string, name: string, startSheet: number, description = '', shortcut = ''): VbaRecording {
  const body: string[] = [];
  let skipped = 0;
  let lastClear = '';
  const names = new Map<number, string>();
  const nameOf = (i: number) => names.get(i) ?? sheetNames(i);
  const ws = (i: number) => (i === startSheet && !names.has(-1) ? '' : `Sheets(${q(nameOf(i))}).`);
  const rng = (i: number, r0: number, c0: number, r1: number, c1: number) => `${ws(i)}Range(${q(addr(r0, c0, r1, c1))})`;
  for (const a of actions) {
    switch (a.k) {
      case 'edit': {
        const t = rng(a.sheet, a.r, a.c, a.r, a.c);
        if (a.raw === '') body.push(`${t}.ClearContents`);
        else if (a.raw.startsWith('=')) body.push(`${t}.Formula = ${q(a.raw)}`);
        else {
          const num = a.raw.trim() !== '' && /^[+-]?\d*\.?\d+(e[+-]?\d+)?$/i.test(a.raw.trim());
          body.push(`${t}.Value = ${num ? a.raw.trim() : q(a.raw)}`);
        }
        break;
      }
      case 'style':
        for (const [r0, c0, r1, c1, patch] of a.ops) {
          const t = rng(a.sheet, r0, c0, r1, c1);
          for (const p of patch.split(';')) {
            if (!p.trim()) continue;
            if (p.trim() === 'clear') {
              body.push(`${t}.ClearFormats`);
              lastClear = `fmt:${a.sheet}:${r0}:${c0}:${r1}:${c1}`;
              continue;
            }
            const line = styleLine(t, p);
            if (line) body.push(line);
            else {
              skipped++;
              body.push(`' ${p.trim()} is not recorded`);
            }
          }
        }
        break;
      case 'format':
        if (a.code === '' && lastClear === `fmt:${a.sheet}:${a.r0}:${a.c0}:${a.r1}:${a.c1}`) break;
        body.push(`${rng(a.sheet, a.r0, a.c0, a.r1, a.c1)}.NumberFormat = ${q(a.code || 'General')}`);
        break;
      case 'sort': {
        const [col, desc] = a.keys[0] ?? [a.c0, false];
        const keys = a.keys.slice(0, 3).map(([c, d], i) => `Key${i + 1}:=${ws(a.sheet)}Range(${q(`${colName(c)}${a.r0 + 1}`)}), Order${i + 1}:=${d ? 'xlDescending' : 'xlAscending'}`);
        if (!keys.length) keys.push(`Key1:=${ws(a.sheet)}Range(${q(`${colName(col)}${a.r0 + 1}`)}), Order1:=${desc ? 'xlDescending' : 'xlAscending'}`);
        body.push(`${rng(a.sheet, a.r0, a.c0, a.r1, a.c1)}.Sort ${keys.join(', ')}, Header:=${a.header ? 'xlYes' : 'xlNo'}${a.across ? ', Orientation:=xlLeftToRight' : ''}`);
        break;
      }
      case 'shift': {
        const target = a.rows ? `${ws(a.sheet)}Rows(${q(`${a.at + 1}:${a.at + a.n}`)})` : `${ws(a.sheet)}Columns(${q(`${colName(a.at)}:${colName(a.at + a.n - 1)}`)})`;
        body.push(a.insert ? `${target}.Insert Shift:=${a.rows ? 'xlDown' : 'xlToRight'}` : `${target}.Delete Shift:=${a.rows ? 'xlUp' : 'xlToLeft'}`);
        break;
      }
      case 'cells': {
        const dir = a.dir === 'down' ? 'xlDown' : a.dir === 'right' ? 'xlToRight' : a.dir === 'up' ? 'xlUp' : 'xlToLeft';
        body.push(`${rng(a.sheet, a.r0, a.c0, a.r1, a.c1)}.${a.insert ? 'Insert' : 'Delete'} Shift:=${dir}`);
        break;
      }
      case 'merge': {
        const t = rng(a.sheet, a.r0, a.c0, a.r1, a.c1);
        if (a.mode === 'unmerge') body.push(`${t}.UnMerge`);
        else {
          body.push(a.mode === 'across' ? `${t}.Merge Across:=True` : `${t}.Merge`);
          if (a.mode === 'center') body.push(`${t}.HorizontalAlignment = xlCenter`);
        }
        break;
      }
      case 'fill':
        body.push(`${rng(a.sheet, ...a.src)}.AutoFill Destination:=${rng(a.sheet, ...a.dest)}, Type:=xlFillDefault`);
        break;
      case 'clear':
        body.push(`${rng(a.sheet, a.r0, a.c0, a.r1, a.c1)}.ClearContents`);
        break;
      case 'filter': {
        const { area, cols } = filterFields(a.text);
        if (!area) {
          body.push(`${ws(a.sheet)}AutoFilterMode = False`);
          break;
        }
        const r = rng(a.sheet, ...area);
        body.push(`${r}.AutoFilter`);
        for (const c of cols) {
          if (c.fields[0] === 'values') {
            const vals = c.fields.slice(2);
            body.push(vals.length === 1 ? `${r}.AutoFilter Field:=${c.col - area[1] + 1}, Criteria1:=${q(vals[0])}` : `${r}.AutoFilter Field:=${c.col - area[1] + 1}, Criteria1:=Array(${vals.map(q).join(', ')}), Operator:=xlFilterValues`);
          } else {
            skipped++;
            body.push(`' the filter on column ${colName(c.col)} is not recorded`);
          }
        }
        break;
      }
      case 'chart': {
        const t = CHART_TYPES[a.type] ?? 'xlColumnClustered';
        const box = parseRef(a.range);
        const src = box ? rng(a.sheet, box.r0, box.c0, box.r1, box.c1) : `${ws(a.sheet)}Range(${q(a.range)})`;
        body.push(`${ws(a.sheet)}Shapes.AddChart2(201, ${t}).Select`, `ActiveChart.SetSourceData Source:=${src}, PlotBy:=${a.byRows ? 'xlRows' : 'xlColumns'}`);
        if (a.title) body.push('ActiveChart.HasTitle = True', `ActiveChart.ChartTitle.Text = ${q(a.title)}`);
        break;
      }
      case 'sheetop':
        if (a.op === 'add') {
          body.push('Sheets.Add After:=Sheets(Sheets.Count)', `ActiveSheet.Name = ${q(a.name)}`);
          names.set(a.sheet, a.name);
          names.set(-1, '');
        } else if (a.op === 'rename') {
          body.push(`Sheets(${q(a.name)}).Name = ${q(a.to ?? a.name)}`);
          names.set(a.sheet, a.to ?? a.name);
        } else body.push('Application.DisplayAlerts = False', `Sheets(${q(a.name)}).Delete`, 'Application.DisplayAlerts = True');
        break;
    }
  }
  const head = [`Sub ${name}()`, `'`, `' ${name} Macro`];
  if (description) head.push(`' ${description}`);
  head.push(`'`, '');
  const attrs: string[] = [];
  if (description) attrs.push(`Attribute ${name}.VB_Description = ${q(description)}`);
  if (shortcut) attrs.push(`Attribute ${name}.VB_ProcData.VB_Invoke_Func = ${q(`${shortcut}\\n14`)}`);
  const code = [...head, ...body.map((l) => `    ${l}`), 'End Sub', ''].join('\n');
  return { code, attrs, skipped };
}
