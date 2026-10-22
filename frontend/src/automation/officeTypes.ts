export type Cell = [number, number, string, string | undefined, boolean, string?];

export interface SheetSnap {
  name: string;
  cells: Cell[];
  styles: [number, number, string][];
  formats: [number, number, string][];
  merges: [number, number, number, number][];
  visible: 'Visible' | 'Hidden' | 'VeryHidden';
  tab: string;
  grid: boolean;
  freeze: [number, number];
  cols: [number, number][];
  rows: [number, number][];
}

export interface TableSnap {
  name: string;
  sheet: string;
  area: [number, number, number, number];
  flags: string;
  style: string;
  cols: string[];
}

export interface ChartSnap {
  id: string;
  sheet: string;
  name: string;
  type: string;
  title: string;
  range: string;
  legend: string;
  anchor: [number, number, number, number];
}

export interface PivotSnap {
  name: string;
  sheet: string;
  row: number;
  col: number;
  src: string;
  srcSheet: string;
  rows: string[];
  cols: string[];
  values: { field: string; func: string; name: string }[];
  filters: string[];
  fields: string[];
}

export interface Snapshot {
  sheets: SheetSnap[];
  active: string;
  selection: { sheet: string; r0: number; c0: number; r1: number; c1: number } | null;
  tables: TableSnap[];
  charts: ChartSnap[];
  pivots: PivotSnap[];
  names: [string, string][];
  title: string;
}

export interface ChartPatch {
  type?: string;
  title?: string;
  xTitle?: string;
  yTitle?: string;
  legend?: string;
  range?: string;
  byRows?: boolean;
  labels?: boolean;
  name?: string;
  anchor?: [number, number, number, number];
}

export interface PivotPatch {
  rows?: string[];
  cols?: string[];
  values?: { field: string; func: string; name: string }[];
  filters?: string[];
}

export type Op =
  | { k: 'edit'; sheet: string; r: number; c: number; raw: string }
  | { k: 'sheet'; name: string }
  | { k: 'sheetOp'; sheet: string; op: 'delete' | 'rename' | 'move' | 'tab' | 'visible' | 'grid' | 'freeze' | 'show'; name?: string; to?: number; value?: string; on?: boolean; rows?: number; cols?: number }
  | { k: 'format'; sheet: string; r0: number; c0: number; r1: number; c1: number; code: string }
  | { k: 'style'; sheet: string; r0: number; c0: number; r1: number; c1: number; patch: string }
  | { k: 'sort'; sheet: string; r0: number; c0: number; r1: number; c1: number; keys: [number, boolean][]; header: boolean }
  | { k: 'merge'; sheet: string; r0: number; c0: number; r1: number; c1: number; mode: 'all' | 'across' | 'unmerge' }
  | { k: 'shift'; sheet: string; rows: boolean; at: number; n: number; insert: boolean }
  | { k: 'size'; sheet: string; cols: boolean; i0: number; i1: number; px: number }
  | { k: 'autofit'; sheet: string; cols: boolean; i0: number; i1: number }
  | { k: 'hide'; sheet: string; rows: boolean; i0: number; i1: number; on: boolean }
  | { k: 'link'; sheet: string; r: number; c: number; target: string; display: string }
  | { k: 'unlink'; sheet: string; r0: number; c0: number; r1: number; c1: number }
  | { k: 'name'; name: string; refers: string }
  | { k: 'validation'; sheet: string; r0: number; c0: number; r1: number; c1: number; line: string }
  | { k: 'table'; action: 'create' | 'set' | 'delete'; name: string; sheet: string; area?: [number, number, number, number]; header?: boolean; rename?: string; style?: string; flags?: string; cols?: string[] }
  | { k: 'chart'; action: 'add' | 'set' | 'delete'; id: string; sheet: string; patch: ChartPatch }
  | { k: 'pivot'; action: 'add' | 'set' | 'delete' | 'refresh'; name: string; sheet: string; row?: number; col?: number; src?: string; patch?: PivotPatch };

export type In =
  | { t: 'run'; id: number; code: string; snap: Snapshot; event?: unknown }
  | { t: 'snapshot'; id: number; snap: Snapshot }
  | { t: 'scan'; id: number; code: string }
  | { t: 'call'; id: number; code: string; name: string; args: unknown[]; stream?: boolean }
  | { t: 'cancel' };

export type Out =
  | { t: 'log'; id: number; level: string; text: string }
  | { t: 'flush'; id: number; ops: Op[] }
  | { t: 'done'; id: number; ok: boolean; error?: string; ops: Op[]; result?: unknown }
  | { t: 'scanned'; id: number; names: string[] }
  | { t: 'called'; id: number; ok: boolean; value?: unknown; error?: string; code?: string }
  | { t: 'streamed'; id: number; value: unknown };
