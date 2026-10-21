export type Request =
  | { id: number; op: 'version' }
  | { id: number; op: 'workbook.new' }
  | { id: number; op: 'cell.set'; book: number; sheet: number; a1: string; raw: string }
  | { id: number; op: 'cell.get'; book: number; sheet: number; a1: string };

export type Response =
  | { id: number; ok: true; value: string | number }
  | { id: number; ok: false; error: string };

export type RequestBody = Request extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;
