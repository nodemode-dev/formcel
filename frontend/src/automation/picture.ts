import { engine } from '../engine';
import { api, el, esc, setText } from './dom';
import type { Env } from './model';

type Kind = 'text' | 'number' | 'date' | 'percent' | 'currency';

interface PicCell {
  v: string;
  kind: string;
  conf: number;
  fixed: boolean;
}

interface Read {
  rows: string[][];
  words: number;
  confidence: number;
  cells: PicCell[][];
  merges: { row: number; c0: number; c1: number }[];
  columns: { kind: Kind }[];
  header: boolean;
  fixed: number;
}

const KINDS: [Kind, string][] = [['text', 'Text'], ['number', 'Number'], ['currency', 'Currency'], ['percent', 'Percent'], ['date', 'Date']];
const LOW = 70;

interface Runtime {
  ocr: { available: boolean; engine: string; note: string };
}

export class PictureImport {
  readonly root = el('div', 'fc-pic');
  private readonly file: HTMLInputElement;
  private readonly note: HTMLElement;
  private readonly out: HTMLElement;
  private readonly insert: HTMLButtonElement;
  private readonly review: HTMLElement;
  private readonly shot: HTMLImageElement;
  private readonly head: HTMLInputElement;
  private model: Read | null = null;
  private url = '';

  constructor(private readonly env: Env) {
    this.root.innerHTML = `
      <h3 class="fc-auto-h">Data from a picture</h3>
      <p class="fc-auto-hint fc-pic-note" aria-live="polite">Checking for a text recognition engine</p>
      <div class="fc-auto-row"><input class="fc-auto-input fc-grow" type="file" accept="image/png,image/jpeg,image/tiff,image/bmp,image/gif,image/webp" aria-label="Picture of a table" disabled><button type="button" class="fc-btn fc-btn-primary" data-a="pic-insert" disabled>Insert at selection</button></div>
      <div class="fc-pic-review" hidden>
        <img class="fc-pic-shot" alt="The picture that was read">
        <div class="fc-auto-row fc-auto-small"><label><input type="checkbox" data-pic="header"> First row is a header</label><span>Change a column type or any cell, remove rows and columns you do not want, then insert. Pale yellow cells were read with low confidence; green cells had letters corrected to digits.</span></div>
        <div class="fc-qprev fc-pic-out"></div>
      </div>`;
    this.file = this.root.querySelector('input')!;
    this.note = this.root.querySelector('.fc-pic-note')!;
    this.out = this.root.querySelector('.fc-pic-out')!;
    this.review = this.root.querySelector('.fc-pic-review')!;
    this.shot = this.root.querySelector('.fc-pic-shot')!;
    this.head = this.root.querySelector('[data-pic="header"]')!;
    this.insert = this.root.querySelector('[data-a="pic-insert"]')!;
    this.file.addEventListener('change', () => void this.read());
    this.insert.addEventListener('click', () => void this.place());
    this.out.addEventListener('click', (e) => this.click(e));
    this.out.addEventListener('change', (e) => this.change(e));
    this.out.addEventListener('input', (e) => this.edit(e));
    this.head.addEventListener('change', () => {
      if (this.model) this.model.header = this.head.checked;
    });
  }

  async load(): Promise<void> {
    try {
      const r = await api<Runtime>('GET', '/api/runtime');
      this.file.disabled = !r.ocr.available;
      setText(this.note, r.ocr.available ? `Reads a photo or screenshot of a table with ${r.ocr.engine} running in the engine process. Check the result before you rely on it.` : r.ocr.note);
    } catch {
      setText(this.note, 'The engine process could not be reached.');
    }
  }

  private async read(): Promise<void> {
    const f = this.file.files?.[0];
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) {
      setText(this.note, 'That picture is larger than 12 MB.');
      return;
    }
    setText(this.note, 'Reading the picture');
    const data = await new Promise<string>((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = () => resolve(String(rd.result));
      rd.onerror = () => reject(rd.error);
      rd.readAsDataURL(f);
    });
    try {
      const r = await api<Read>('POST', '/api/ocr', { data });
      this.model = r.cells.length ? r : null;
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(f);
      this.shot.src = this.url;
      this.review.hidden = !this.model;
      this.head.checked = !!r.header;
      this.paint();
      this.insert.disabled = !this.model;
      const low = r.cells.reduce((n, row) => n + row.filter((c) => c.v && c.conf < LOW).length, 0);
      setText(this.note, this.model ? `${r.words} words read at ${r.confidence}% confidence, as ${r.cells.length} rows and ${r.columns.length} columns${r.merges.length ? `, ${r.merges.length} merged heading${r.merges.length === 1 ? '' : 's'}` : ''}${r.fixed ? `, ${r.fixed} number${r.fixed === 1 ? '' : 's'} corrected` : ''}${low ? `, ${low} uncertain` : ''}. Review the grid, then insert.` : 'No text was found in that picture.');
    } catch (err) {
      this.model = null;
      this.review.hidden = true;
      this.insert.disabled = true;
      setText(this.note, err instanceof Error ? err.message : String(err));
    }
  }

  private paint(): void {
    const m = this.model;
    if (!m) {
      this.out.replaceChildren();
      return;
    }
    const w = m.columns.length;
    const span = (r: number, c: number): number => m.merges.find((x) => x.row === r && x.c0 === c)?.c1 ?? c;
    const hidden = (r: number, c: number): boolean => m.merges.some((x) => x.row === r && c > x.c0 && c <= x.c1);
    const types = `<tr class="fc-pic-types"><th></th>${m.columns.map((col, c) => `<th><select class="fc-auto-input" data-pic="kind" data-c="${c}" aria-label="Type of column ${c + 1}">${KINDS.map(([k, l]) => `<option value="${k}" ${col.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select><button type="button" class="fc-btn fc-btn-ghost" data-pic="delcol" data-c="${c}" aria-label="Remove column ${c + 1}">Remove</button></th>`).join('')}</tr>`;
    const rows = m.cells
      .map((row, r) => {
        const tds = row
          .map((cell, c) => {
            if (hidden(r, c)) return '';
            const cs = span(r, c) - c + 1;
            const cls = cell.fixed ? 'fc-pic-fixed' : cell.v && cell.conf < LOW ? 'fc-pic-low' : '';
            return `<td class="${cls}" ${cs > 1 ? `colspan="${cs}"` : ''} contenteditable="plaintext-only" spellcheck="false" data-pic="cell" data-r="${r}" data-c="${c}">${esc(cell.v)}</td>`;
          })
          .join('');
        return `<tr><th><button type="button" class="fc-btn fc-btn-ghost" data-pic="delrow" data-r="${r}" aria-label="Remove row ${r + 1}">Remove</button></th>${tds}</tr>`;
      })
      .join('');
    this.out.innerHTML = `<table data-w="${w}"><tbody>${types}${rows}</tbody></table>`;
  }

  private click(e: Event): void {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pic]');
    const m = this.model;
    if (!b || !m) return;
    if (b.dataset.pic === 'delrow') {
      const r = Number(b.dataset.r);
      m.cells.splice(r, 1);
      m.merges = m.merges.filter((x) => x.row !== r).map((x) => (x.row > r ? { ...x, row: x.row - 1 } : x));
    } else if (b.dataset.pic === 'delcol') {
      const c = Number(b.dataset.c);
      m.cells.forEach((row) => row.splice(c, 1));
      m.columns.splice(c, 1);
      m.merges = m.merges
        .map((x) => ({ ...x, c0: x.c0 > c ? x.c0 - 1 : x.c0, c1: x.c1 >= c ? x.c1 - 1 : x.c1 }))
        .filter((x) => x.c1 > x.c0);
    } else return;
    this.paint();
    this.insert.disabled = !m.cells.length || !m.columns.length;
  }

  private change(e: Event): void {
    const s = e.target as HTMLSelectElement;
    const m = this.model;
    if (!m || s.dataset.pic !== 'kind') return;
    m.columns[Number(s.dataset.c)].kind = s.value as Kind;
  }

  private edit(e: Event): void {
    const td = e.target as HTMLElement;
    const m = this.model;
    if (!m || td.dataset.pic !== 'cell') return;
    const cell = m.cells[Number(td.dataset.r)]?.[Number(td.dataset.c)];
    if (cell) {
      cell.v = td.textContent ?? '';
      cell.fixed = false;
    }
  }

  private async place(): Promise<void> {
    const book = this.env.book();
    const m = this.model;
    if (book < 0 || !m || !m.cells.length) return;
    const s = this.env.selection();
    const edits: [number, number, string][] = [];
    m.cells.forEach((row, r) =>
      row.forEach((cell, c) => {
        const v = cell.v.trim();
        if (!v) return;
        const kind = m.columns[c]?.kind ?? 'text';
        const heading = m.merges.some((x) => x.row === r) || (m.header && r === 0);
        const looksTyped = /^[\s$€£¥+(-]*[\d.,]+[)%]?\s*$/.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v);
        edits.push([s.r0 + r, s.c0 + c, kind === 'text' || heading ? (looksTyped ? `'${v}` : v) : v]);
      }),
    );
    const e = engine();
    const mark = await e.undoMark(book);
    await this.env.grid.commitEdits(await e.apply(book, edits, this.env.grid.sheetIndex));
    for (const x of m.merges) await this.env.grid.applyPivot(await e.merge(book, this.env.grid.sheetIndex, s.r0 + x.row, s.c0 + x.c0, s.r0 + x.row, s.c0 + x.c1, 'across'));
    await e.undoGroup(book, mark);
    setText(this.note, `Inserted ${m.cells.length} rows at ${s.r0 + 1}:${s.c0 + 1}. Undo reverses it.`);
  }
}
