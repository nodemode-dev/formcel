import { api } from './dom';

export interface PyRun {
  value: unknown;
  printed: string[];
  writes: [string, unknown][];
  record?: Record<string, unknown>;
}

export function handlerNames(handlers: unknown): string[] {
  return handlers && typeof handlers === 'object' ? Object.keys(handlers as Record<string, string>).sort((a, b) => a.localeCompare(b)) : [];
}

export function runHandler(workbook: string, name: string, event: Record<string, unknown> = {}): Promise<PyRun> {
  return api<PyRun>('POST', `/api/workbooks/${workbook}/py/run`, { name, event });
}
