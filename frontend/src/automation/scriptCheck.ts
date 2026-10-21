import { strip } from './tsStrip';

export interface Diagnostic {
  line: number;
  level: 'error' | 'warning';
  message: string;
}

const API = new Set([
  'getAddress', 'getLocalAddress', 'getRowCount', 'getColumnCount', 'getRowIndex', 'getColumnIndex', 'getValues', 'getTexts', 'getFormulas', 'getValue', 'getFormula',
  'setValues', 'setFormulas', 'setValue', 'setFormula', 'clear', 'setNumberFormat', 'sort', 'getFormat', 'getFill', 'getFont', 'setColor', 'clear', 'setBold', 'setItalic', 'setUnderline', 'setSize', 'setName',
  'setHorizontalAlignment', 'setWrapText', 'getName', 'getRange', 'getCell', 'getRangeByIndexes', 'getUsedRange', 'getActiveWorksheet', 'getActiveSheet', 'getWorksheet', 'getSheet',
  'getWorksheets', 'getSheets', 'addWorksheet', 'addSheet', 'getSelectedRange', 'getActiveCell',
]);

const LITERALS: [RegExp, string][] = [
  [/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*number\s*=\s*(["'`])/, 'number'],
  [/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*string\s*=\s*(?:-?\d)/, 'string'],
  [/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*boolean\s*=\s*(?:["'`]|-?\d)/, 'boolean'],
];

export function isAppsScript(code: string): boolean {
  return /\b(?:SpreadsheetApp|PropertiesService|UrlFetchApp|ScriptApp)\b/.test(code) && !/\bExcelScript\b/.test(code);
}

export function check(code: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lines = code.split('\n');
  const custom = /@customfunction/.test(code) || isAppsScript(code);
  if (!custom && !/\bfunction\s+main\s*\(/.test(code)) out.push({ line: 1, level: 'error', message: 'Write function main(workbook: ExcelScript.Workbook) { ... } so there is something to run.' });
  const main = /\bfunction\s+main\s*\(([^)]*)\)/.exec(code);
  if (main && main[1].trim() && !/^\s*[A-Za-z_$][\w$]*\s*(:\s*ExcelScript\.Workbook)?\s*(,.*)?$/.test(main[1])) out.push({ line: lineOf(code, main.index), level: 'error', message: 'The first parameter of main is the workbook: workbook: ExcelScript.Workbook.' });
  try {
    new Function(strip(code));
  } catch (err) {
    out.push({ line: 1, level: 'error', message: `Syntax: ${err instanceof Error ? err.message : String(err)}` });
  }
  lines.forEach((text, i) => {
    const t = text.replace(/\/\/.*$/, '');
    for (const m of t.matchAll(/\.((?:get|set|add)[A-Z][A-Za-z]*)\s*\(/g)) {
      if (!API.has(m[1])) out.push({ line: i + 1, level: 'warning', message: `${m[1]} is not part of the FormCel workbook API.` });
    }
    for (const [rx, kind] of LITERALS) {
      const m = rx.exec(t);
      if (m) out.push({ line: i + 1, level: 'error', message: `${m[1]} is declared ${kind} but is given a different kind of value.` });
    }
    const set = /\.(setValue|setFormula|setNumberFormat)\(\s*\)/.exec(t);
    if (set) out.push({ line: i + 1, level: 'error', message: `${set[1]} needs an argument.` });
    const sorted = /\.sort\(\s*(["'`])/.exec(t);
    if (sorted) out.push({ line: i + 1, level: 'error', message: 'sort takes the column number first, as a number.' });
  });
  return out;
}

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split('\n').length;
}
