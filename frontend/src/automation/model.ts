import type { Range } from '../grid/a1';
import type { Grid } from '../grid/grid';
import type { RunResult, ScriptRunner } from './scripts';
import type { HostCalls } from './hostCalls';

export interface Script {
  id: string;
  name: string;
  code: string;
  triggers?: { open?: boolean; edit?: boolean; every?: number };
  js?: string;
}

export interface Step {
  op: string;
  [key: string]: unknown;
}

export interface Query {
  id: string;
  name: string;
  source: Record<string, unknown>;
  steps: Step[];
  target: { sheet: string; cell: string };
  every: number;
  daily?: string;
  onOpen?: boolean;
  asTable?: boolean;
  tabled?: boolean;
  tableName?: string;
  params?: { name: string; type?: string; value: string }[];
  last?: { rows: number; cols: number };
  refreshed?: number;
}

export interface Btn {
  id: string;
  label: string;
  script: string;
  x: number;
  y: number;
}

export interface Auto {
  scripts: Script[];
  queries: Query[];
  buttons: Btn[];
  settings: Record<string, unknown>;
}

export const blankAuto = (): Auto => ({ scripts: [], queries: [], buttons: [], settings: {} });

export const uid = () => Math.random().toString(36).slice(2, 10);

export interface Env {
  auto: Auto;
  grid: Grid;
  runner: ScriptRunner;
  calls: HostCalls;
  changed(): void;
  book(): number;
  id(): string;
  sheets(): string[];
  selection(): Range;
  status(text: string, error?: boolean): void;
  addSheet(name: string): Promise<number>;
  runScript(id: string, event?: unknown): Promise<RunResult>;
  customChanged(): void;
}

export const SAMPLE = `function main(workbook: ExcelScript.Workbook) {
  const sheet = workbook.getActiveWorksheet();
  const range = sheet.getRange("A1:B2");
  console.log(range.getValues());
}
`;
