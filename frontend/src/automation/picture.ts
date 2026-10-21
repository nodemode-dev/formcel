import { engine } from '../engine';
import { api, el, esc, setText } from './dom';
import type { Env } from './model';

interface Read {
  rows: string[][];
  words: number;
  confidence: number;
}

interface Runtime {
  ocr: { available: boolean; engine: string; note: string };
}

export class PictureImport {
  readonly root = el('div', 'fc-pic');
  private readonly file: HTMLInputElement;
  private readonly note: HTMLElement;
  private readonly out: HTMLElement;
  private readonly insert: HTMLButtonElement;
  private rows: string[][] = [];

  constructor(private readonly env: Env) {
    this.root.innerHTML = `
      <h3 class="fc-auto-h">Data from a picture</h3>
      <p class="fc-auto-hint fc-pic-note" aria-live="polite">Checking for a text recognition engine</p>
      <div class="fc-auto-row"><input class="fc-auto-input fc-grow" type="file" accept="image/png,image/jpeg,image/tiff,image/bmp,image/gif,image/webp" aria-label="Picture of a table" disabled><button type="button" class="fc-btn fc-btn-primary" data-a="pic-insert" disabled>Insert at selection</button></div>
      <div class="fc-qprev fc-pic-out"></div>`;
    this.file = this.root.querySelector('input')!;
    this.note = this.root.querySelector('.fc-pic-note')!;
    this.out = this.root.querySelector('.fc-pic-out')!;
    this.insert = this.root.querySelector('[data-a="pic-insert"]')!;
    this.file.addEventListener('change', () => void this.read());
    this.insert.addEventListener('click', () => void this.place());
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
      this.rows = r.rows;
      this.out.innerHTML = r.rows.length ? `<table><tbody>${r.rows.slice(0, 30).map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
      this.insert.disabled = !r.rows.length;
      setText(this.note, r.rows.length ? `${r.words} words read at ${r.confidence}% confidence, as ${r.rows.length} rows. Check the numbers, then insert.` : 'No text was found in that picture.');
    } catch (err) {
      this.rows = [];
      this.insert.disabled = true;
      setText(this.note, err instanceof Error ? err.message : String(err));
    }
  }

  private async place(): Promise<void> {
    const book = this.env.book();
    if (book < 0 || !this.rows.length) return;
    const s = this.env.selection();
    const edits: [number, number, string][] = [];
    this.rows.forEach((row, r) => row.forEach((v, c) => v && edits.push([s.r0 + r, s.c0 + c, v])));
    const e = engine();
    const mark = await e.undoMark(book);
    await this.env.grid.commitEdits(await e.apply(book, edits, this.env.grid.sheetIndex));
    await e.undoGroup(book, mark);
    setText(this.note, `Inserted ${this.rows.length} rows. Undo reverses it.`);
  }
}
