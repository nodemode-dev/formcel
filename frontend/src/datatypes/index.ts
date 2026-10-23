import { engine } from '../engine';
import { a1 } from '../grid/a1';
import type { Grid } from '../grid/grid';
import { decodeTyped, type TypedMark } from '../grid/typemarks';
import { Menu } from '../ui/menu';
import { actions, el, makeModal, type Modal } from '../ui/modal';
import { icon } from '../ui/icons';
import { fetchRecords, getRefresh, putRefresh, resolveTexts, type RefreshSettings } from './api';
import { Card } from './card';
import { chipLine, fieldFormula, matchesExactly, parsePayload, UNRESOLVED_RECORD, type Candidate, type FetchedRecord, type TypedRecord, type TypeKind } from './model';
import { openProviderDialog } from './providers';
import { Selector } from './selector';

export interface DtHost {
  grid: Grid;
  book(): number;
  id(): string;
  sheets(): string[];
  status(text: string, error?: boolean): void;
}

export type Register = (id: string, title: string, description: string, changes: boolean, run: () => void | Promise<void>, keys?: string) => void;

interface Found {
  sheet: number;
  row: number;
  col: number;
  mark: TypedMark;
}

const MODES: [string, string][] = [
  ['manual', 'Manually'],
  ['open', 'When the workbook opens'],
  ['5min', 'Automatically every five minutes'],
];
const MAX_CONVERT = 500;
const FIVE_MIN = 300000;

export class DataTypes {
  private readonly card = new Card();
  private readonly menu = new Menu();
  private readonly selector = new Selector();
  private readonly button: HTMLButtonElement;
  private settingsModal: Modal | null = null;
  private timer = 0;
  private busy = false;
  private refreshSettings: RefreshSettings = { stocks: 'manual', currencies: 'manual' };

  constructor(private readonly h: DtHost) {
    this.button = el('button', 'fc-dt-insert');
    this.button.type = 'button';
    this.button.hidden = true;
    this.button.innerHTML = `${icon('insertData')}<span>Insert Data</span>`;
    this.button.setAttribute('aria-label', 'Insert Data: add a field of the selected data type to the cells beside it');
    document.getElementById('overlay-root')!.append(this.button);
    this.button.addEventListener('pointerdown', (e) => e.preventDefault());
    this.button.addEventListener('click', () => this.insertMenu(this.button.getBoundingClientRect()));
    const hide = () => {
      this.button.hidden = true;
    };
    h.grid.el.addEventListener('wheel', hide, { passive: true });
    h.grid.el.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
  }

  commands(reg: Register): void {
    reg('datatypes.stocks', 'Stocks', 'Convert the selected text, tickers or company names, to the Stocks data type. Each cell gets the data type icon, a card with its fields, and fields you can add with Insert Data or a formula like =A2.Price.', true, () => this.convert('stock'));
    reg('datatypes.currencies', 'Currencies', 'Convert the selected text, pairs like USD/EUR, to the Currencies data type, with the rate and change as fields.', true, () => this.convert('currency'));
    reg('datatypes.card', 'Data type card', 'Show the card of the data type in the active cell: its fields and values, with Extract to add a field to the sheet.', false, () => this.cardHere());
    reg('datatypes.insert', 'Insert Data', 'Add a field of the data type in the active cell, such as Price or 52 week high, as a formula in the cells beside it.', true, () => this.insertHere());
    reg('datatypes.refresh', 'Refresh data types', 'Fetch the fields of the selected data type cells again, or of every Stocks and Currencies cell when none is selected.', true, () => this.refreshSelection());
    reg('datatypes.refresh-all', 'Refresh all data types', 'Fetch the fields of every Stocks and Currencies cell in the workbook again.', true, () => this.refreshAll(true));
    reg('datatypes.refresh-settings', 'Data type refresh settings', 'Choose whether Stocks and Currencies refresh manually, when the workbook opens, or every five minutes.', false, () => this.openSettings());
    reg('datatypes.providers', 'Market data providers', 'Choose the market data provider and add your own key. FormCel ships no data feed of its own.', false, () => openProviderDialog());
  }

  async opened(): Promise<void> {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.card.hide();
    this.button.hidden = true;
    try {
      this.refreshSettings = await getRefresh(this.h.id());
    } catch {
      this.refreshSettings = { stocks: 'manual', currencies: 'manual' };
    }
    const found = await this.findAll();
    const wants = (kind: TypeKind, mode: string) => found.some((f) => f.mark.kind === kind && f.mark.resolved) && this.refreshSettings[kind === 'stock' ? 'stocks' : 'currencies'] === mode;
    if (wants('stock', 'open') || wants('currency', 'open')) void this.refreshAll(false, (k) => this.refreshSettings[k === 'stock' ? 'stocks' : 'currencies'] === 'open');
    if (wants('stock', '5min') || wants('currency', '5min')) this.timer = window.setInterval(() => void this.refreshAll(false, (k) => this.refreshSettings[k === 'stock' ? 'stocks' : 'currencies'] === '5min'), FIVE_MIN);
  }

  closed(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.card.hide();
    this.button.hidden = true;
  }

  selected(): void {
    const [r, c] = this.h.grid.activeCell();
    const mark = this.h.grid.typedAt(r, c);
    if (!mark || !mark.resolved) {
      this.button.hidden = true;
      return;
    }
    window.requestAnimationFrame(() => {
      const [r2, c2] = this.h.grid.activeCell();
      if (!this.h.grid.typedAt(r2, c2)?.resolved) return;
      const rect = this.h.grid.cellRect();
      const host = this.h.grid.el.getBoundingClientRect();
      if (rect.bottom < host.top || rect.top > host.bottom || rect.right < host.left || rect.left > host.right) {
        this.button.hidden = true;
        return;
      }
      this.button.hidden = false;
      const w = this.button.offsetWidth || 96;
      this.button.style.left = `${Math.max(host.left + 4, Math.min(rect.right - w, host.right - w - 4))}px`;
      const above = rect.top - this.button.offsetHeight - 2;
      if (above >= host.top + 26) this.button.style.top = `${above}px`;
      else {
        this.button.style.top = `${rect.top + (rect.height - this.button.offsetHeight) / 2}px`;
        this.button.style.left = `${Math.min(rect.right + 4, host.right - w - 4)}px`;
      }
    });
  }

  private async findAll(): Promise<Found[]> {
    const book = this.h.book();
    const out: Found[] = [];
    if (book < 0) return out;
    const n = this.h.sheets().length;
    for (let s = 0; s < n; s++) {
      for (const [row, col, text] of await engine().chipsOf(book, s)) {
        const mark = decodeTyped(text);
        if (mark) out.push({ sheet: s, row, col, mark });
      }
    }
    return out;
  }

  private async convert(kind: TypeKind): Promise<void> {
    const g = this.h.grid;
    const book = this.h.book();
    if (book < 0) return;
    const sheet = g.sheetIndex;
    const sel = g.selection();
    const values = await engine().readValues(book, sheet, sel.r0, sel.c0, sel.r1, sel.c1);
    const cells: [number, number, string][] = [];
    for (const [r, c] of values) {
      if (cells.length >= MAX_CONVERT) break;
      const raw = (await engine().getCell(book, a1(r, c), sheet)).trim();
      if (!raw || raw.startsWith('=')) continue;
      cells.push([r, c, raw.startsWith("'") ? raw.slice(1) : raw]);
    }
    if (!cells.length) {
      this.h.status('Select cells that hold text, such as tickers or company names, first', true);
      return;
    }
    this.h.status(`Linking ${cells.length} cell${cells.length === 1 ? '' : 's'}`);
    let resolved;
    try {
      resolved = (await resolveTexts(kind, cells.map((c) => c[2]))).results;
    } catch (err) {
      this.h.status(err instanceof Error ? err.message : 'The engine process could not be reached', true);
      return;
    }
    const failed = resolved.find((r) => r.failed);
    if (failed) {
      this.h.status(failed.note, true);
      return;
    }
    const chosen = new Map<number, Candidate>();
    resolved.forEach((r, i) => {
      const top = r.matches[0];
      if (top && (r.matches.length === 1 || matchesExactly(cells[i][2], top))) chosen.set(i, top);
    });
    const entities = [...new Set([...chosen.values()].map((c) => c.entity))];
    const records = new Map<string, FetchedRecord>();
    let note = '';
    if (entities.length) {
      try {
        for (const r of (await fetchRecords(kind, entities, true)).results) {
          if (r.record) records.set(r.entity, r.record);
          else note = r.note;
        }
      } catch (err) {
        this.h.status(err instanceof Error ? err.message : 'The engine process could not be reached', true);
        return;
      }
    }
    if (entities.length && !records.size) {
      this.h.status(note || 'No data came back', true);
      return;
    }
    const items: [number, number, string, string][] = [];
    let linked = 0;
    cells.forEach(([r, c, t], i) => {
      const rec = chosen.has(i) ? records.get(chosen.get(i)!.entity) : undefined;
      if (rec) {
        items.push([r, c, rec.name, chipLine(kind, rec.name, rec.payload)]);
        linked++;
      } else items.push([r, c, t, chipLine(kind, t, UNRESOLVED_RECORD)]);
    });
    await g.setTypedCells(items);
    const missed = cells.length - linked;
    this.h.status(missed ? `Linked ${linked} of ${cells.length}` : `Linked ${linked} cell${linked === 1 ? '' : 's'}`);
    if (missed) this.h.status('Click the question mark icon in a cell to choose a match for it', true);
    else if (note) this.h.status(note, true);
  }

  private async recordAt(sheet: number, row: number, col: number): Promise<{ mark: TypedMark; rec: TypedRecord } | null> {
    const book = this.h.book();
    const list = await engine().chipsOf(book, sheet);
    const hit = list.find(([r, c]) => r === row && c === col);
    const mark = hit ? decodeTyped(hit[2]) : null;
    if (!mark) return null;
    const rec = mark.resolved ? parsePayload(await engine().recordOf(book, mark.record)) : null;
    return rec ? { mark, rec } : mark.resolved ? null : { mark, rec: { entity: '', provider: '', at: 0, fields: [] } };
  }

  async openCard(row: number, col: number): Promise<void> {
    const g = this.h.grid;
    const sheet = g.sheetIndex;
    const got = await this.recordAt(sheet, row, col);
    if (!got) return;
    if (!got.mark.resolved) {
      this.selector.open(got.mark.kind, got.mark.label, (c) => void this.choose(sheet, row, col, got.mark.kind, c));
      return;
    }
    this.button.hidden = true;
    this.card.show(g.cellRect(), got.mark.kind, got.mark.label, got.rec, {
      extract: (field) => void this.extract(sheet, row, col, field),
      refresh: () => void this.refreshCells([{ sheet, row, col, mark: got.mark }], true).then(() => void this.openCard(row, col)),
      settings: () => {
        this.card.hide();
        void this.openSettings();
      },
      insert: (anchor) => this.insertMenu(anchor),
      close: () => undefined,
    });
  }

  private async cardHere(): Promise<void> {
    const [r, c] = this.h.grid.activeCell();
    if (!this.h.grid.typedAt(r, c)) {
      this.h.status('The active cell is not a Stocks or Currencies data type', true);
      return;
    }
    await this.openCard(r, c);
  }

  private async choose(sheet: number, row: number, col: number, kind: TypeKind, c: Candidate): Promise<void> {
    try {
      const rec = (await fetchRecords(kind, [c.entity], true)).results[0];
      if (!rec.record) {
        this.h.status(rec.note || 'No data came back', true);
        return;
      }
      if (this.h.grid.sheetIndex !== sheet) return;
      await this.h.grid.setTypedCells([[row, col, rec.record.name, chipLine(kind, rec.record.name, rec.record.payload)]]);
      this.h.status(`Linked ${rec.record.name}`);
    } catch (err) {
      this.h.status(err instanceof Error ? err.message : 'The engine process could not be reached', true);
    }
  }

  private async occupied(sheet: number, r0: number, r1: number, c0: number, c1: number): Promise<Set<string>> {
    const out = new Set<string>();
    for (const [r, c] of await engine().readValues(this.h.book(), sheet, r0, c0, r1, c1)) out.add(`${r}:${c}`);
    return out;
  }

  private async freeColumn(sheet: number, rows: number[], from: number): Promise<number> {
    const lo = Math.min(...rows);
    const hi = Math.max(...rows);
    const used = await this.occupied(sheet, lo, hi, from, from + 60);
    for (let c = from; c < from + 60; c++) if (rows.every((r) => !used.has(`${r}:${c}`))) return c;
    return from + 60;
  }

  private async extract(sheet: number, row: number, col: number, field: string): Promise<void> {
    await this.insertFields([{ sheet, row, col }], [field]);
  }

  private async insertFields(targets: { sheet: number; row: number; col: number }[], fields: string[]): Promise<void> {
    const g = this.h.grid;
    const book = this.h.book();
    if (!targets.length || !fields.length) return;
    const sheet = targets[0].sheet;
    const rows = targets.map((t) => t.row);
    const lastCol = Math.max(...targets.map((t) => t.col));
    const edits: [number, number, string][] = [];
    let at = await this.freeColumn(sheet, rows, lastCol + 1);
    const top = Math.min(...rows);
    const header = top > 0 ? await this.occupied(sheet, top - 1, top - 1, lastCol, lastCol + 60) : new Set<string>();
    const headed = top > 0 && header.has(`${top - 1}:${targets[0].col}`);
    for (const f of fields) {
      if (headed && !header.has(`${top - 1}:${at}`)) edits.push([top - 1, at, f]);
      for (const t of targets) edits.push([t.row, at, fieldFormula(a1(t.row, t.col), f)]);
      at++;
    }
    await g.grouped(async () => {
      await g.commitEdits(await engine().apply(book, edits, sheet));
    });
    this.h.status(`Added ${fields.length} field${fields.length === 1 ? '' : 's'}`);
  }

  private async insertMenu(anchor: DOMRect): Promise<void> {
    const g = this.h.grid;
    const sheet = g.sheetIndex;
    const s = g.selection();
    const typed = g.typedCells().filter(([r, c, m]) => m.resolved && r >= s.r0 && r <= s.r1 && c >= s.c0 && c <= s.c1);
    const [ar, ac] = g.activeCell();
    const list = typed.length ? typed : g.typedAt(ar, ac)?.resolved ? [[ar, ac, g.typedAt(ar, ac)!] as [number, number, TypedMark]] : [];
    if (!list.length) {
      this.h.status('Select a cell with the Stocks or Currencies data type first', true);
      return;
    }
    const got = await this.recordAt(sheet, list[0][0], list[0][1]);
    if (!got) return;
    const targets = list.filter(([, , m]) => m.kind === list[0][2].kind).map(([row, col]) => ({ sheet, row, col }));
    this.card.hide();
    this.menu.show(anchor.left, anchor.bottom + 2, got.rec.fields.map((f) => ({ label: f.name, run: () => this.insertFields(targets, [f.name]) })));
  }

  private async insertHere(): Promise<void> {
    this.insertMenu(this.h.grid.cellRect());
  }

  private async refreshSelection(): Promise<void> {
    const g = this.h.grid;
    const s = g.selection();
    const sheet = g.sheetIndex;
    const here = g.typedCells().filter(([r, c, m]) => m.resolved && r >= s.r0 && r <= s.r1 && c >= s.c0 && c <= s.c1);
    if (here.length) await this.refreshCells(here.map(([row, col, mark]) => ({ sheet, row, col, mark })), true);
    else await this.refreshAll(true);
  }

  async refreshAll(report: boolean, only?: (kind: TypeKind) => boolean): Promise<void> {
    const found = (await this.findAll()).filter((f) => f.mark.resolved && (!only || only(f.mark.kind)));
    if (!found.length) {
      if (report) this.h.status('No Stocks or Currencies cells to refresh');
      return;
    }
    await this.refreshCells(found, report);
  }

  private async refreshCells(cells: Found[], report: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const book = this.h.book();
    if (report) this.h.status(`Refreshing ${cells.length} data type cell${cells.length === 1 ? '' : 's'}`);
    try {
      const fresh = new Map<string, FetchedRecord>();
      let note = '';
      for (const kind of ['stock', 'currency'] as TypeKind[]) {
        const of = cells.filter((c) => c.mark.kind === kind);
        if (!of.length) continue;
        const entities = [...new Set(await Promise.all(of.map(async (c) => parsePayload(await engine().recordOf(book, c.mark.record))?.entity ?? '')))].filter(Boolean);
        for (const r of (await fetchRecords(kind, entities, true)).results) {
          if (r.record) fresh.set(`${kind}:${r.entity}`, r.record);
          else note = r.note;
        }
      }
      let done = 0;
      await this.h.grid.grouped(async () => {
        for (const c of cells) {
          const ent = parsePayload(await engine().recordOf(book, c.mark.record))?.entity ?? '';
          const rec = fresh.get(`${c.mark.kind}:${ent}`);
          if (!rec) continue;
          await this.h.grid.applyEffect(await engine().putRecords(book, [[c.mark.record, c.mark.kind, rec.payload]]));
          done++;
        }
      });
      if (report) {
        this.h.status(done === cells.length ? `Refreshed ${done} data type cell${done === 1 ? '' : 's'}` : `Refreshed ${done} of ${cells.length}`);
        if (done < cells.length) this.h.status(note || 'Some data type cells were not refreshed', true);
      }
      document.dispatchEvent(new Event('fc-hosted'));
    } catch (err) {
      if (report) this.h.status(err instanceof Error ? err.message : 'The data types were not refreshed', true);
    } finally {
      this.busy = false;
    }
  }

  private async openSettings(): Promise<void> {
    if (!this.settingsModal) {
      const modal = makeModal('Data type refresh settings');
      this.settingsModal = modal;
    }
    const modal = this.settingsModal;
    try {
      this.refreshSettings = await getRefresh(this.h.id());
    } catch {
      this.refreshSettings = { stocks: 'manual', currencies: 'manual' };
    }
    const groups: HTMLElement[] = [];
    for (const key of ['stocks', 'currencies'] as const) {
      const set = el('fieldset', 'fc-dt-fs');
      set.append(el('legend', '', key === 'stocks' ? 'Stocks' : 'Currencies'));
      for (const [mode, label] of MODES) {
        const lab = el('label', 'fc-dt-radio');
        const r = el('input');
        r.type = 'radio';
        r.name = `fc-dt-refresh-${key}`;
        r.value = mode;
        r.checked = this.refreshSettings[key] === mode;
        r.addEventListener('change', () => {
          void putRefresh(this.h.id(), { [key]: mode }).then((s) => {
            this.refreshSettings = s;
            void this.opened();
          });
        });
        lab.append(r, document.createTextNode(` ${label}`));
        set.append(lab);
      }
      groups.push(set);
    }
    const now = el('button', 'fc-btn', 'Refresh now');
    now.type = 'button';
    now.addEventListener('click', () => {
      modal.close();
      void this.refreshAll(true);
    });
    const prov = el('button', 'fc-btn', 'Market data providers');
    prov.type = 'button';
    prov.addEventListener('click', () => {
      modal.close();
      void openProviderDialog();
    });
    modal.body.replaceChildren(el('p', 'fc-dt-note', 'These settings are kept for this workbook in the engine process data folder. Refresh All on the Data tab also refreshes data types.'), ...groups, actions('Close', () => modal.close(), () => modal.close(), [now, prov], ''));
    modal.open();
  }
}
