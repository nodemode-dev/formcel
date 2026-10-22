import { Ctx } from '../automation/officeApi';
import type { Snapshot } from '../automation/officeTypes';
import { VbaRuntime, type EventSpec } from './runtime';
import type { VbaHost, VbaModule } from './types';

declare const process: {
  stdin: { setEncoding(e: string): void; on(ev: string, fn: (chunk: string) => void): void };
  stdout: { write(s: string, cb?: () => void): void };
  exit(code: number): never;
};

interface Request {
  mode: 'run' | 'event' | 'udf';
  modules: VbaModule[];
  proc?: string;
  args?: unknown[];
  event?: EventSpec;
  book: Snapshot;
  limitMs?: number;
}

const waiting: ((line: string) => void)[] = [];
const lines: string[] = [];
let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  for (;;) {
    const i = buffer.indexOf('\n');
    if (i < 0) break;
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    const next = waiting.shift();
    if (next) next(line);
    else lines.push(line);
  }
});
process.stdin.on('end', () => process.exit(0));

function readLine(): Promise<string> {
  const line = lines.shift();
  if (line !== undefined) return Promise.resolve(line);
  return new Promise((resolve) => waiting.push(resolve));
}

async function rpc(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
  const r = JSON.parse(await readLine()) as Record<string, unknown>;
  if (typeof r.error === 'string') throw new Error(r.error);
  return r;
}

function defaultButton(style: number): number {
  const set = [[1], [1, 2], [3, 4, 5], [6, 7, 2], [6, 7], [4, 2]][style & 7] ?? [1];
  return set[Math.min(set.length - 1, (style >> 8) & 3)];
}

function done(msg: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ done: true, ...msg })}\n`, () => process.exit(0));
}

async function main(): Promise<void> {
  const req = JSON.parse(await readLine()) as Request;
  const output: string[] = [];
  const host: VbaHost = {
    evalFormula: async (sheet, formula) => String((await rpc({ rpc: 'eval', sheet, formula })).text ?? ''),
    msgBox: async (prompt, buttons) => {
      output.push(`[MsgBox] ${prompt}`);
      return defaultButton(buttons);
    },
    inputBox: async (prompt, _title, def) => {
      output.push(`[InputBox] ${prompt}`);
      return def;
    },
    now: () => Date.now(),
  };
  const rt = new VbaRuntime(host);
  const ctx = new Ctx();
  ctx.load(req.book);
  ctx.flusher = async () => {
    const ops = ctx.ops.splice(0);
    const r = await rpc({ rpc: 'apply', ops });
    ctx.load(r.book as Snapshot);
  };
  rt.attach(ctx);
  rt.limitMs = req.limitMs ?? 30000;
  rt.on((e) => {
    if (e.type === 'output') output.push(e.text);
  });
  const problems = await rt.load(req.modules);
  if (problems.length) {
    const p = problems[0];
    done({ ok: false, error: `Compile error in ${p.module}, line ${p.line}: ${p.message}`, output });
    return;
  }
  if (req.mode === 'udf') {
    try {
      const value = await rt.callFunction(req.proc ?? '', req.args ?? []);
      done({ ok: true, value, output });
    } catch (e) {
      done({ ok: false, error: e instanceof Error ? e.message : String(e), code: rt.errorCode(e), output });
    }
    return;
  }
  if (req.mode === 'event') {
    const r = await rt.fire(req.event ?? { name: 'Open' });
    const rest = ctx.ops.splice(0);
    if (rest.length) await rpc({ rpc: 'apply', ops: rest });
    done({ ok: true, ran: r.ran, cancel: r.cancel, output });
    return;
  }
  const r = await rt.run(req.proc ?? '', req.args ?? []);
  const rest = ctx.ops.splice(0);
  if (rest.length) await rpc({ rpc: 'apply', ops: rest });
  done({ ok: r.ok, error: r.error ? `Run-time error '${r.error.number}': ${r.error.description}` : undefined, location: r.error?.location, value: r.value === undefined ? null : r.value, output });
}

main().catch((e: unknown) => done({ ok: false, error: e instanceof Error ? e.message : String(e), output: [] }));
