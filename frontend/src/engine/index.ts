import type { Area, Cell, Changed, Dir, Edit, Effect, FormatItem, MergeMode, Name, RequestBody, Response, Shift, StyleOp, Value } from './protocol';

export type { Area, Cell, Changed, Dir, Edit, Effect, FormatChange, FormatItem, MergeMode, Name, Shift, StyleChange, StyleOp } from './protocol';

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

  async offset(items: [src: string, dr: number, dc: number][]): Promise<string[]> {
    if (!items.length) return [];
    return (await this.call({ op: 'offset', items })) as string[];
  }
}

let shared: EngineClient | null = null;

export function engine(): EngineClient {
  shared ??= new EngineClient();
  return shared;
}
