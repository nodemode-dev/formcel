import type { RequestBody, Response } from './protocol';

type Pending = { resolve: (v: string | number) => void; reject: (e: Error) => void };

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

  private call(body: RequestBody): Promise<string | number> {
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
}

let shared: EngineClient | null = null;

export function engine(): EngineClient {
  shared ??= new EngineClient();
  return shared;
}
