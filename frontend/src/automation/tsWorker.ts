import * as ts from 'typescript5';
import api from './excelScript.api.txt?raw';

const raw = import.meta.glob('../../node_modules/typescript5/lib/lib.{es5,es20*,decorators*}.d.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const files = new Map<string, string>();
for (const [path, text] of Object.entries(raw)) files.set(`/lib/${path.slice(path.lastIndexOf('/') + 1)}`, text);
files.set('/api.d.ts', api);
files.set('/script.ts', '');

let version = 0;

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts'],
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  types: [],
  noImplicitReturns: false,
};

const host: ts.LanguageServiceHost = {
  getCompilationSettings: () => options,
  getScriptFileNames: () => ['/script.ts', '/api.d.ts'],
  getScriptVersion: (f) => (f === '/script.ts' ? String(version) : '1'),
  getScriptSnapshot: (f) => {
    const t = files.get(f);
    return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t);
  },
  getCurrentDirectory: () => '/',
  getDefaultLibFileName: () => '/lib/lib.es2022.d.ts',
  fileExists: (f) => files.has(f),
  readFile: (f) => files.get(f),
  directoryExists: () => true,
};

const service = ts.createLanguageService(host, ts.createDocumentRegistry());

function load(code: string): void {
  if (files.get('/script.ts') === code) return;
  files.set('/script.ts', code);
  version++;
}

export interface WorkerDiag {
  start: number;
  length: number;
  line: number;
  col: number;
  level: 'error' | 'warning';
  message: string;
  code: number;
}

export type TsIn =
  | { t: 'check'; id: number; code: string }
  | { t: 'complete'; id: number; code: string; pos: number }
  | { t: 'detail'; id: number; code: string; pos: number; name: string };

export type TsOut =
  | { t: 'checked'; id: number; diags: WorkerDiag[] }
  | { t: 'completed'; id: number; start: number; items: { name: string; kind: string }[] }
  | { t: 'detailed'; id: number; text: string; doc: string };

const send = (self as unknown as Worker).postMessage.bind(self);

self.onmessage = (e: MessageEvent<TsIn>) => {
  const m = e.data;
  load(m.code);
  try {
    if (m.t === 'check') {
      const sf = service.getProgram()?.getSourceFile('/script.ts');
      const all = [...service.getSyntacticDiagnostics('/script.ts'), ...service.getSemanticDiagnostics('/script.ts')];
      const diags = all
        .filter((d) => d.start !== undefined && !(d.category === ts.DiagnosticCategory.Suggestion))
        .map((d): WorkerDiag => {
          const start = d.start ?? 0;
          const pos = sf ? sf.getLineAndCharacterOfPosition(start) : { line: 0, character: 0 };
          return { start, length: d.length ?? 0, line: pos.line + 1, col: pos.character + 1, level: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning', message: ts.flattenDiagnosticMessageText(d.messageText, '\n'), code: d.code };
        });
      send({ t: 'checked', id: m.id, diags } satisfies TsOut);
    } else if (m.t === 'complete') {
      const info = service.getCompletionsAtPosition('/script.ts', m.pos, { includeCompletionsForModuleExports: false, includeCompletionsWithInsertText: false });
      const items = (info?.entries ?? [])
        .filter((x) => x.kind !== ts.ScriptElementKind.warning)
        .sort((a, b) => (a.sortText < b.sortText ? -1 : a.sortText > b.sortText ? 1 : a.name.localeCompare(b.name)))
        .slice(0, 400)
        .map((x) => ({ name: x.name, kind: x.kind }));
      const start = info?.optionalReplacementSpan?.start ?? wordStart(m.code, m.pos);
      send({ t: 'completed', id: m.id, start, items } satisfies TsOut);
    } else {
      const d = service.getCompletionEntryDetails('/script.ts', m.pos, m.name, {}, undefined, undefined, undefined);
      send({ t: 'detailed', id: m.id, text: ts.displayPartsToString(d?.displayParts), doc: ts.displayPartsToString(d?.documentation) } satisfies TsOut);
    }
  } catch (err) {
    if (m.t === 'check') send({ t: 'checked', id: m.id, diags: [{ start: 0, length: 0, line: 1, col: 1, level: 'warning', message: `Type checker stopped: ${err instanceof Error ? err.message : String(err)}`, code: 0 }] } satisfies TsOut);
    else if (m.t === 'complete') send({ t: 'completed', id: m.id, start: m.pos, items: [] } satisfies TsOut);
    else send({ t: 'detailed', id: m.id, text: '', doc: '' } satisfies TsOut);
  }
};

function wordStart(code: string, pos: number): number {
  let i = pos;
  while (i > 0 && /[\w$]/.test(code[i - 1])) i--;
  return i;
}
