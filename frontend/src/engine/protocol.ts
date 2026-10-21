export type Request =
  | { id: number; op: 'version' }
  | { id: number; op: 'workbook.new' }
  | { id: number; op: 'cell.set'; book: number; sheet: number; a1: string; raw: string }
  | { id: number; op: 'cell.get'; book: number; sheet: number; a1: string }
  | { id: number; op: 'apply'; book: number; sheet: number; edits: Edit[] }
  | { id: number; op: 'load'; book: number; sheet: number; edits: Edit[] }
  | { id: number; op: 'sheet.add'; book: number; name: string }
  | { id: number; op: 'sheet.names'; book: number }
  | { id: number; op: 'shift'; book: number; sheet: number; rows: boolean; at: number; n: number; insert: boolean }
  | { id: number; op: 'sheet.delete'; book: number; sheet: number }
  | { id: number; op: 'sheet.move'; book: number; sheet: number; to: number }
  | { id: number; op: 'sheet.rename'; book: number; sheet: number; name: string }
  | { id: number; op: 'format.set'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number; code: string }
  | { id: number; op: 'format.at'; book: number; sheet: number; row: number; col: number }
  | { id: number; op: 'format.load'; book: number; sheet: number; cells: Edit[] }
  | { id: number; op: 'style.set'; book: number; sheet: number; ops: StyleOp[] }
  | { id: number; op: 'style.read'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number }
  | { id: number; op: 'style.at'; book: number; sheet: number; row: number; col: number }
  | { id: number; op: 'style.load'; book: number; sheet: number; cells: Edit[] }
  | { id: number; op: 'name.define'; book: number; name: string; refers: string }
  | { id: number; op: 'name.list'; book: number }
  | { id: number; op: 'undo' | 'redo' | 'history'; book: number }
  | { id: number; op: 'read'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number }
  | { id: number; op: 'extent'; book: number; sheet: number }
  | { id: number; op: 'edge'; book: number; sheet: number; row: number; col: number; dir: Dir }
  | { id: number; op: 'offset'; items: [src: string, dr: number, dc: number][] };

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Edit = [row: number, col: number, raw: string];
export type Cell = [row: number, col: number, text: string, formula?: string, numeric?: boolean, color?: string];
export type Changed = [sheet: number, row: number, col: number, text: string, formula?: string, numeric?: boolean, color?: string];
export type FormatChange = [sheet: number, row: number, col: number, code: string];
export type StyleOp = [r0: number, c0: number, r1: number, c1: number, patch: string];
export interface Shift {
  sheet: number;
  rows: boolean;
  at: number;
  delta: number;
}
export interface Effect {
  changes: Changed[];
  shift: Shift | null;
  formats: FormatChange[];
  styles: FormatChange[];
}
export type Name = [name: string, refers: string];
export type Value = string | number | string[] | Cell[] | Changed[] | Name[] | Edit[] | [number, number] | Shift | Effect | null;

export type Response =
  | { id: number; ok: true; value: Value }
  | { id: number; ok: false; error: string };

export type RequestBody = Request extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;
