import { strip } from './tsStrip';

export interface Diagnostic {
  line: number;
  level: 'error' | 'warning';
  message: string;
  col?: number;
  start?: number;
  length?: number;
  syntax?: boolean;
}

export function isAppsScript(code: string): boolean {
  return /\b(?:SpreadsheetApp|PropertiesService|UrlFetchApp|ScriptApp)\b/.test(code) && !/\bExcelScript\b/.test(code);
}

export function check(code: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const custom = /@customfunction/.test(code) || isAppsScript(code);
  if (!custom && !/\bfunction\s+main\s*\(/.test(code)) out.push({ line: 1, level: 'error', message: 'Write function main(workbook: ExcelScript.Workbook) { ... } so there is something to run.' });
  const main = /\bfunction\s+main\s*\(([^)]*)\)/.exec(code);
  if (main && main[1].trim() && !/^\s*[A-Za-z_$][\w$]*\s*(:\s*ExcelScript\.Workbook)?\s*(,.*)?$/.test(main[1])) out.push({ line: lineOf(code, main.index), level: 'error', message: 'The first parameter of main is the workbook: workbook: ExcelScript.Workbook.' });
  try {
    new Function(strip(code));
  } catch (err) {
    out.push({ line: 1, level: 'error', message: `Syntax: ${err instanceof Error ? err.message : String(err)}`, syntax: true });
  }
  return out;
}

export function typed(code: string): boolean {
  return !isAppsScript(code) && !/^\s*\/\/\s*@ts-nocheck/m.test(code);
}

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split('\n').length;
}
