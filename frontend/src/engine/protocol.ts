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
  | { id: number; op: 'tool'; book: number; sheet: number; cmd: string }
  | { id: number; op: 'merge.set'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number; mode: MergeMode }
  | { id: number; op: 'sort'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number; keys: [number, boolean][]; header: boolean; caseSensitive: boolean }
  | { id: number; op: 'region'; book: number; sheet: number; row: number; col: number }
  | { id: number; op: 'header'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number }
  | { id: number; op: 'merge.list'; book: number; sheet: number }
  | { id: number; op: 'merge.load'; book: number; sheet: number; areas: Area[] }
  | { id: number; op: 'format.put'; book: number; sheet: number; items: FormatItem[] }
  | { id: number; op: 'theme.get'; book: number }
  | { id: number; op: 'theme.set' | 'theme.load'; book: number; text: string }
  | { id: number; op: 'named.list'; book: number }
  | { id: number; op: 'named.load'; book: number; lines: string[] }
  | { id: number; op: 'style.define'; book: number; sheet: number; row: number; col: number; name: string; parts: string }
  | { id: number; op: 'style.delete'; book: number; name: string }
  | { id: number; op: 'style.apply'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number; name: string }
  | { id: number; op: 'values.read'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number }
  | { id: number; op: 'rules.get'; book: number; sheet: number }
  | { id: number; op: 'rules.set' | 'rules.load'; book: number; sheet: number; lines: string[] }
  | { id: number; op: 'table.list'; book: number }
  | { id: number; op: 'table.load'; book: number; lines: string[] }
  | { id: number; op: 'table.create'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number; header: boolean }
  | { id: number; op: 'table.set'; book: number; name: string; line: string }
  | { id: number; op: 'table.remove'; book: number; name: string }
  | { id: number; op: 'valid.list'; book: number; sheet: number }
  | { id: number; op: 'valid.load'; book: number; sheet: number; lines: string[] }
  | { id: number; op: 'valid.set'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number; line: string }
  | { id: number; op: 'valid.at' | 'valid.items'; book: number; sheet: number; row: number; col: number }
  | { id: number; op: 'valid.check'; book: number; sheet: number; row: number; col: number; raw: string }
  | { id: number; op: 'filter.get' | 'filter.reapply'; book: number; sheet: number }
  | { id: number; op: 'filter.set' | 'filter.load'; book: number; sheet: number; text: string }
  | { id: number; op: 'filter.values'; book: number; sheet: number; col: number }
  | { id: number; op: 'cf.read'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number }
  | { id: number; op: 'link.at'; book: number; sheet: number; row: number; col: number }
  | { id: number; op: 'link.set'; book: number; sheet: number; row: number; col: number; target: string; display?: string }
  | { id: number; op: 'link.remove'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number }
  | { id: number; op: 'link.take'; book: number }
  | { id: number; op: 'link.load'; book: number; sheet: number; cells: Edit[] }
  | { id: number; op: 'undo.mark'; book: number }
  | { id: number; op: 'undo.group'; book: number; mark: number }
  | { id: number; op: 'format.read'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number }
  | { id: number; op: 'name.define'; book: number; name: string; refers: string }
  | { id: number; op: 'name.list'; book: number }
  | { id: number; op: 'undo' | 'redo' | 'history'; book: number }
  | { id: number; op: 'read'; book: number; sheet: number; r0: number; c0: number; r1: number; c1: number }
  | { id: number; op: 'extent'; book: number; sheet: number }
  | { id: number; op: 'edge'; book: number; sheet: number; row: number; col: number; dir: Dir }
  | { id: number; op: 'offset'; items: [src: string, dr: number, dc: number][] };

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Edit = [row: number, col: number, raw: string];
export type Cell = [row: number, col: number, text: string, formula?: string, numeric?: boolean, color?: string, link?: boolean];
export type Changed = [sheet: number, row: number, col: number, text: string, formula?: string, numeric?: boolean, color?: string, link?: boolean];
export type LinkChange = [sheet: number, row: number, col: number, target: string];
export type FormatChange = [sheet: number, row: number, col: number, code: string];
export type StyleOp = [r0: number, c0: number, r1: number, c1: number, patch: string];
export type Area = [r0: number, c0: number, r1: number, c1: number];
export type MergeMode = 'center' | 'across' | 'cells' | 'unmerge';
export type FormatItem = [row: number, col: number, style: string, code: string];
export interface Shift {
  sheet: number;
  rows: boolean;
  at: number;
  delta: number;
}
export interface Effect {
  changes: Changed[];
  shift: Shift | null;
  more?: Shift[];
  message?: string;
  formats: FormatChange[];
  styles: StyleChange[];
  merges: number | null;
  theme: boolean;
  named: boolean;
  rules: number | null;
  filter: number | null;
  valid: number | null;
  tables: boolean;
}
export interface FilterList {
  values: string[];
  blanks: boolean;
  more: boolean;
  fills: string[];
  fonts: string[];
}
export type CfCell = [row: number, col: number, style: string, bar: string, icon: string];
export type StyleChange = [sheet: number, row: number, col: number, raw: string, shown: string];
export type Name = [name: string, refers: string];
export type Value = string | number | boolean | number[] | string[] | Cell[] | Changed[] | Name[] | Edit[] | Area[] | CfCell[] | LinkChange[] | [number, number] | Shift | Effect | FilterList | null;

export type Response =
  | { id: number; ok: true; value: Value }
  | { id: number; ok: false; error: string };

export type RequestBody = Request extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;
