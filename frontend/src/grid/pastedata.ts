const SEPARATORS = [',', ';', '|'];

export function hasHtmlTable(html: string): boolean {
  return /<table[\s>]/i.test(html);
}

export function htmlRows(html: string): string[][] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return [];
  const rows: string[][] = [];
  const spans = new Map<number, [number, string]>();
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    if (tr.closest('table') !== table) continue;
    const row: string[] = [];
    const fill = () => {
      for (let hit = spans.get(row.length); hit; hit = spans.get(row.length)) {
        if (hit[0] > 1) spans.set(row.length, [hit[0] - 1, hit[1]]);
        else spans.delete(row.length);
        row.push(hit[1]);
      }
    };
    for (const cell of Array.from(tr.children)) {
      if (cell.tagName !== 'TD' && cell.tagName !== 'TH') continue;
      fill();
      const text = (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
      const down = Math.min(1000, Number((cell as HTMLTableCellElement).rowSpan) || 1);
      const across = Math.min(200, Number((cell as HTMLTableCellElement).colSpan) || 1);
      if (down > 1) spans.set(row.length, [down - 1, text]);
      row.push(text);
      for (let i = 1; i < across; i++) {
        fill();
        row.push('');
      }
    }
    fill();
    rows.push(row);
  }
  return rows;
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur === '') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function separatedRows(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length < 2 || lines.length > 200000) return null;
  for (const sep of SEPARATORS) {
    const rows = lines.map((l) => splitLine(l, sep));
    const width = rows[0].length;
    if (width > 1 && rows.every((r) => r.length === width)) return rows;
  }
  return null;
}

export function rowsToTsv(rows: string[][]): string {
  const cell = (t: string) => (/[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
  return rows.map((r) => r.map(cell).join('\t')).join('\n');
}

export function pastedTable(text: string, html: string, blank: boolean): string | null {
  if (hasHtmlTable(html) && !text.includes('\t')) {
    const rows = htmlRows(html);
    if (rows.length) return rowsToTsv(rows);
  }
  if (blank && !text.includes('\t')) {
    const rows = separatedRows(text);
    if (rows) return rowsToTsv(rows);
  }
  return null;
}
