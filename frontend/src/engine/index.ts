import type { Cell, Changed, Dir, Edit, RequestBody, Response, Value } from './protocol';

export type { Cell, Changed, Dir, Edit } from './protocol';

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

  async undo(book: number): Promise<Changed[]> {
    return (await this.call({ op: 'undo', book })) as Changed[];
  }

  async redo(book: number): Promise<Changed[]> {
    return (await this.call({ op: 'redo', book })) as Changed[];
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
}

let shared: EngineClient | null = null;

export function engine(): EngineClient {
  shared ??= new EngineClient();
  return shared;
}
