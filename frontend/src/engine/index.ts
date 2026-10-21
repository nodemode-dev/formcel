import type { Arrow, EvalStep, Area, Cell, CfCell, Changed, Dir, Edit, Effect, FilterList, FormatItem, LinkChange, MergeMode, Name, RequestBody, Response, Shift, StyleOp, Value, WhatIfReply } from './protocol';

export type { Arrow, EvalStep, Area, Cell, CfCell, Changed, Dir, Edit, Effect, FilterList, FormatChange, FormatItem, LinkChange, MergeMode, Name, Shift, StyleChange, StyleOp } from './protocol';

type Pending = { resolve: (v: Value) => void; reject: (e: Error) => void };

export class EngineClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private seq = 0;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Response>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.value);
      else p.reject(new Error(e.data.error));
    };
  }

  private call(body: RequestBody): Promise<Value> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...body, id });
    });
  }

  async version(): Promise<string> {
    return String(await this.call({ op: 'version' }));
  }

  async newWorkbook(): Promise<number> {
    return Number(await this.call({ op: 'workbook.new' }));
  }

  async setCell(book: number, a1: string, raw: string, sheet = 0): Promise<string> {
    return String(await this.call({ op: 'cell.set', book, sheet, a1, raw }));
  }

  async getCell(book: number, a1: string, sheet = 0): Promise<string> {
    return String(await this.call({ op: 'cell.get', book, sheet, a1 }));
  }

  async apply(book: number, edits: Edit[], sheet = 0): Promise<Changed[]> {
    return (await this.call({ op: 'apply', book, sheet, edits })) as Changed[];
  }

  async applyRemote(book: number, edits: Edit[], sheet = 0): Promise<Changed[]> {
    return (await this.call({ op: 'apply', book, sheet, edits, remote: true })) as Changed[];
  }

  async protText(book: number, sheet: number): Promise<string[]> {
    return (await this.call({ op: 'prot', kind: 'text', book, sheet })) as string[];
  }

  async protLoad(book: number, sheet: number, lines: string[]): Promise<void> {
    await this.call({ op: 'prot', kind: 'load', book, sheet, a: lines.join('\n') });
  }

  async protectSheet(book: number, sheet: number, on: boolean, password: string, allow: string[]): Promise<void> {
    await this.call({ op: 'prot', kind: 'sheet', book, sheet, on, a: allow.join(','), b: password });
  }

  async protectBook(book: number, on: boolean, password: string): Promise<void> {
    await this.call({ op: 'prot', kind: 'book', book, sheet: -1, on, b: password });
  }

  async markFinal(book: number, on: boolean): Promise<void> {
    await this.call({ op: 'prot', kind: 'final', book, sheet: -1, on });
  }

  async setCellFlags(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, unlocked: boolean | null, hidden: boolean | null): Promise<void> {
    await this.call({ op: 'prot', kind: 'flags', book, sheet, r0, c0, r1, c1, a: String(unlocked === null ? 2 : Number(unlocked)), b: String(hidden === null ? 2 : Number(hidden)) });
  }

  async cellFlags(book: number, sheet: number, row: number, col: number): Promise<number> {
    return Number(await this.call({ op: 'prot', kind: 'flagsAt', book, sheet, r0: row, c0: col }));
  }

  async setEditRanges(book: number, sheet: number, lines: string[]): Promise<void> {
    await this.call({ op: 'prot', kind: 'ranges', book, sheet, a: lines.join('\n') });
  }

  async setUser(book: number, name: string): Promise<void> {
    await this.call({ op: 'prot', kind: 'user', book, sheet: -1, a: name });
  }

  async guard(book: number, sheet: number, op: string, r0 = 0, c0 = 0, r1 = 0, c1 = 0): Promise<string> {
    return String(await this.call({ op: 'prot', kind: 'guard', book, sheet, a: op, r0, c0, r1, c1 }));
  }

  async hidesFormula(book: number, sheet: number, row: number, col: number): Promise<boolean> {
    return Number(await this.call({ op: 'prot', kind: 'hides', book, sheet, r0: row, c0: col })) === 1;
  }

  async load(book: number, edits: Edit[], sheet = 0): Promise<number> {
    return Number(await this.call({ op: 'load', book, sheet, edits }));
  }

  async addSheet(book: number, name: string): Promise<number> {
    return Number(await this.call({ op: 'sheet.add', book, name }));
  }

  async sheetNames(book: number): Promise<string[]> {
    return (await this.call({ op: 'sheet.names', book })) as string[];
  }

  async undo(book: number): Promise<Effect> {
    return (await this.call({ op: 'undo', book })) as Effect;
  }

  async redo(book: number): Promise<Effect> {
    return (await this.call({ op: 'redo', book })) as Effect;
  }

  async shift(book: number, sheet: number, rows: boolean, at: number, n: number, insert: boolean): Promise<Shift> {
    return (await this.call({ op: 'shift', book, sheet, rows, at, n, insert })) as Shift;
  }

  async deleteSheet(book: number, sheet: number): Promise<void> {
    await this.call({ op: 'sheet.delete', book, sheet });
  }

  async moveSheet(book: number, sheet: number, to: number): Promise<void> {
    await this.call({ op: 'sheet.move', book, sheet, to });
  }

  async renameSheet(book: number, sheet: number, name: string): Promise<void> {
    await this.call({ op: 'sheet.rename', book, sheet, name });
  }

  async setFormat(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, code: string): Promise<Effect> {
    return (await this.call({ op: 'format.set', book, sheet, r0, c0, r1, c1, code })) as Effect;
  }

  async formatAt(book: number, sheet: number, row: number, col: number): Promise<string> {
    return (await this.call({ op: 'format.at', book, sheet, row, col })) as string;
  }

  async loadFormats(book: number, sheet: number, cells: Edit[]): Promise<void> {
    if (cells.length) await this.call({ op: 'format.load', book, sheet, cells });
  }

  async setStyles(book: number, sheet: number, ops: StyleOp[]): Promise<Effect> {
    return (await this.call({ op: 'style.set', book, sheet, ops })) as Effect;
  }

  async readStyles(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): Promise<Edit[]> {
    return (await this.call({ op: 'style.read', book, sheet, r0, c0, r1, c1 })) as Edit[];
  }

  async styleAt(book: number, sheet: number, row: number, col: number): Promise<string> {
    return (await this.call({ op: 'style.at', book, sheet, row, col })) as string;
  }

  async loadStyles(book: number, sheet: number, cells: Edit[]): Promise<void> {
    if (cells.length) await this.call({ op: 'style.load', book, sheet, cells });
  }

  async merge(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, mode: MergeMode): Promise<Effect> {
    return (await this.call({ op: 'merge.set', book, sheet, r0, c0, r1, c1, mode })) as Effect;
  }

  async sort(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, keys: [number, boolean][], header: boolean, caseSensitive = false): Promise<Effect> {
    return (await this.call({ op: 'sort', book, sheet, r0, c0, r1, c1, keys, header, caseSensitive })) as Effect;
  }

  async region(book: number, sheet: number, row: number, col: number): Promise<{ area: Area; header: boolean }> {
    const [r0, c0, r1, c1, h] = (await this.call({ op: 'region', book, sheet, row, col })) as number[];
    return { area: [r0, c0, r1, c1], header: h === 1 };
  }

  async guessHeader(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): Promise<boolean> {
    return (await this.call({ op: 'header', book, sheet, r0, c0, r1, c1 })) as boolean;
  }

  async merges(book: number, sheet: number): Promise<Area[]> {
    return (await this.call({ op: 'merge.list', book, sheet })) as Area[];
  }

  async loadMerges(book: number, sheet: number, areas: Area[]): Promise<void> {
    if (areas.length) await this.call({ op: 'merge.load', book, sheet, areas });
  }

  async putFormats(book: number, sheet: number, items: FormatItem[]): Promise<Effect> {
    return (await this.call({ op: 'format.put', book, sheet, items })) as Effect;
  }

  async theme(book: number): Promise<{ current: string; names: string[] }> {
    const [current, ...names] = (await this.call({ op: 'theme.get', book })) as string[];
    return { current, names };
  }

  async setTheme(book: number, text: string): Promise<Effect> {
    return (await this.call({ op: 'theme.set', book, text })) as Effect;
  }

  async setLocale(tag: string): Promise<void> {
    await this.call({ op: 'locale.set', tag });
  }

  async loadTheme(book: number, text: string): Promise<void> {
    if (text) await this.call({ op: 'theme.load', book, text });
  }

  async namedStyles(book: number): Promise<string[]> {
    return (await this.call({ op: 'named.list', book })) as string[];
  }

  async loadNamed(book: number, lines: string[]): Promise<void> {
    if (lines.length) await this.call({ op: 'named.load', book, lines });
  }

  async defineStyle(book: number, sheet: number, row: number, col: number, name: string, parts: string): Promise<Effect> {
    return (await this.call({ op: 'style.define', book, sheet, row, col, name, parts })) as Effect;
  }

  async deleteStyle(book: number, name: string): Promise<Effect> {
    return (await this.call({ op: 'style.delete', book, name })) as Effect;
  }

  async applyStyle(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, name: string): Promise<Effect> {
    return (await this.call({ op: 'style.apply', book, sheet, r0, c0, r1, c1, name })) as Effect;
  }

  async readValues(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): Promise<Edit[]> {
    return (await this.call({ op: 'values.read', book, sheet, r0, c0, r1, c1 })) as Edit[];
  }

  async linkAt(book: number, sheet: number, row: number, col: number): Promise<string> {
    return (await this.call({ op: 'link.at', book, sheet, row, col })) as string;
  }

  async setLink(book: number, sheet: number, row: number, col: number, target: string, display?: string): Promise<Effect> {
    return (await this.call({ op: 'link.set', book, sheet, row, col, target, display })) as Effect;
  }

  async removeLinks(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): Promise<Effect> {
    return (await this.call({ op: 'link.remove', book, sheet, r0, c0, r1, c1 })) as Effect;
  }

  async takeLinks(book: number): Promise<LinkChange[]> {
    return (await this.call({ op: 'link.take', book })) as LinkChange[];
  }

  async loadLinks(book: number, sheet: number, cells: Edit[]): Promise<void> {
    if (cells.length) await this.call({ op: 'link.load', book, sheet, cells });
  }

  async rules(book: number, sheet: number): Promise<string[]> {
    return (await this.call({ op: 'rules.get', book, sheet })) as string[];
  }

  async setRules(book: number, sheet: number, lines: string[]): Promise<Effect> {
    return (await this.call({ op: 'rules.set', book, sheet, lines })) as Effect;
  }

  async loadRules(book: number, sheet: number, lines: string[]): Promise<void> {
    if (lines.length) await this.call({ op: 'rules.load', book, sheet, lines });
  }

  async tables(book: number): Promise<string[]> {
    return (await this.call({ op: 'table.list', book })) as string[];
  }

  async loadTables(book: number, lines: string[]): Promise<void> {
    if (lines.length) await this.call({ op: 'table.load', book, lines });
  }

  async createTable(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, header: boolean): Promise<Effect> {
    return (await this.call({ op: 'table.create', book, sheet, r0, c0, r1, c1, header })) as Effect;
  }

  async setTable(book: number, name: string, line: string): Promise<Effect> {
    return (await this.call({ op: 'table.set', book, name, line })) as Effect;
  }

  async pivots(book: number): Promise<string[]> {
    return (await this.call({ op: 'pivot.list', book })) as string[];
  }

  async loadPivots(book: number, lines: string[]): Promise<void> {
    if (lines.length) await this.call({ op: 'pivot.load', book, lines });
  }

  async pivotSource(book: number, sheet: number, src: string): Promise<string> {
    return (await this.call({ op: 'pivot.source', book, sheet, src })) as string;
  }

  async pivotFields(book: number, name: string): Promise<string> {
    return (await this.call({ op: 'pivot.fields', book, name })) as string;
  }

  async pivotItems(book: number, name: string, field: string): Promise<string[]> {
    return (await this.call({ op: 'pivot.items', book, name, field })) as string[];
  }

  async pivotSuggest(book: number, sheet: number, src: string): Promise<string[]> {
    return (await this.call({ op: 'pivot.suggest', book, sheet, src })) as string[];
  }

  async createPivot(book: number, line: string): Promise<Effect> {
    return (await this.call({ op: 'pivot.create', book, line })) as Effect;
  }

  async setPivot(book: number, name: string, line: string): Promise<Effect> {
    return (await this.call({ op: 'pivot.set', book, name, line })) as Effect;
  }

  async refreshPivot(book: number, name: string): Promise<Effect> {
    return (await this.call({ op: 'pivot.refresh', book, name })) as Effect;
  }

  async removePivot(book: number, name: string): Promise<Effect> {
    return (await this.call({ op: 'pivot.remove', book, name })) as Effect;
  }

  async whatif(book: number, cmd: string): Promise<WhatIfReply> {
    return (await this.call({ op: 'whatif.run', book, cmd })) as WhatIfReply;
  }

  async loadWhatif(book: number, lines: string[]): Promise<void> {
    if (lines.length) await this.call({ op: 'whatif.load', book, lines });
  }

  async removeTable(book: number, name: string): Promise<Effect> {
    return (await this.call({ op: 'table.remove', book, name })) as Effect;
  }

  async validations(book: number, sheet: number): Promise<string[]> {
    return (await this.call({ op: 'valid.list', book, sheet })) as string[];
  }

  async loadValidations(book: number, sheet: number, lines: string[]): Promise<void> {
    if (lines.length) await this.call({ op: 'valid.load', book, sheet, lines });
  }

  async setValidation(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, line: string): Promise<Effect> {
    return (await this.call({ op: 'valid.set', book, sheet, r0, c0, r1, c1, line })) as Effect;
  }

  async validationAt(book: number, sheet: number, row: number, col: number): Promise<string> {
    return (await this.call({ op: 'valid.at', book, sheet, row, col })) as string;
  }

  async listItems(book: number, sheet: number, row: number, col: number): Promise<string[]> {
    return (await this.call({ op: 'valid.items', book, sheet, row, col })) as string[];
  }

  async checkInput(book: number, sheet: number, row: number, col: number, raw: string): Promise<string> {
    return (await this.call({ op: 'valid.check', book, sheet, row, col, raw })) as string;
  }

  async filter(book: number, sheet: number): Promise<string> {
    return (await this.call({ op: 'filter.get', book, sheet })) as string;
  }

  async setFilter(book: number, sheet: number, text: string): Promise<Effect> {
    return (await this.call({ op: 'filter.set', book, sheet, text })) as Effect;
  }

  async loadFilter(book: number, sheet: number, text: string): Promise<void> {
    if (text) await this.call({ op: 'filter.load', book, sheet, text });
  }

  async reapplyFilter(book: number, sheet: number): Promise<Effect> {
    return (await this.call({ op: 'filter.reapply', book, sheet })) as Effect;
  }

  async filterValues(book: number, sheet: number, col: number): Promise<FilterList> {
    return (await this.call({ op: 'filter.values', book, sheet, col })) as FilterList;
  }

  async readCf(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): Promise<CfCell[]> {
    return (await this.call({ op: 'cf.read', book, sheet, r0, c0, r1, c1 })) as CfCell[];
  }

  async undoMark(book: number): Promise<number> {
    return Number(await this.call({ op: 'undo.mark', book }));
  }

  async undoGroup(book: number, mark: number): Promise<void> {
    await this.call({ op: 'undo.group', book, mark });
  }

  async readFormats(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): Promise<Edit[]> {
    return (await this.call({ op: 'format.read', book, sheet, r0, c0, r1, c1 })) as Edit[];
  }

  async defineName(book: number, name: string, refers: string): Promise<Changed[]> {
    return (await this.call({ op: 'name.define', book, name, refers })) as Changed[];
  }

  async names(book: number): Promise<Name[]> {
    return (await this.call({ op: 'name.list', book })) as Name[];
  }

  async history(book: number): Promise<{ undo: boolean; redo: boolean }> {
    const bits = Number(await this.call({ op: 'history', book }));
    return { undo: (bits & 1) === 1, redo: (bits & 2) === 2 };
  }

  async read(book: number, r0: number, c0: number, r1: number, c1: number, sheet = 0): Promise<Cell[]> {
    return (await this.call({ op: 'read', book, sheet, r0, c0, r1, c1 })) as Cell[];
  }

  async extent(book: number, sheet = 0): Promise<[number, number] | null> {
    return (await this.call({ op: 'extent', book, sheet })) as [number, number] | null;
  }

  async edge(book: number, row: number, col: number, dir: Dir, sheet = 0): Promise<[number, number]> {
    return (await this.call({ op: 'edge', book, sheet, row, col, dir })) as [number, number];
  }

  async trace(book: number, row: number, col: number, dependents: boolean, levels: number, sheet = 0): Promise<Arrow[]> {
    return (await this.call({ op: 'audit.trace', book, sheet, row, col, dependents, levels })) as Arrow[];
  }

  async evalSteps(book: number, row: number, col: number, sheet = 0): Promise<EvalStep[]> {
    return (await this.call({ op: 'audit.eval', book, sheet, row, col })) as EvalStep[];
  }

  async offset(items: [src: string, dr: number, dc: number][]): Promise<string[]> {
    if (!items.length) return [];
    return (await this.call({ op: 'offset', items })) as string[];
  }

  async hostKeys(book: number, all = false): Promise<string[]> {
    return (await this.call({ op: 'host.keys', book, all })) as string[];
  }

  async hostSet(book: number, key: string, data: string | null): Promise<Changed[]> {
    return (await this.call({ op: 'host.set', book, key, data })) as Changed[];
  }

  async hostCustom(book: number, names: string[]): Promise<Changed[]> {
    return (await this.call({ op: 'host.custom', book, names })) as Changed[];
  }

  async hostClear(book: number): Promise<Changed[]> {
    return (await this.call({ op: 'host.clear', book })) as Changed[];
  }
}

let shared: EngineClient | null = null;

export function engine(): EngineClient {
  shared ??= new EngineClient();
  return shared;
}
