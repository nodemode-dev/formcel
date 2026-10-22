import { Ctx } from '../automation/officeApi';
import type { ScriptRunner } from '../automation/scripts';
import { engine } from '../engine';
import { inputBox, msgBox } from './dialogs';
import { VbaRuntime, type EventSpec } from './runtime';
import { macroAllowed, type CompileProblem, type PauseInfo, type RunTrigger, type StepAction, type VbaHost, type VbaModule } from './types';

export interface Frame {
  module: string;
  proc: string;
  line: number;
}

export interface Variable {
  name: string;
  type: string;
  value: string;
}

export interface PauseState {
  reason: 'breakpoint' | 'step' | 'error' | 'stop-statement';
  frame: Frame;
  stack: Frame[];
  locals: Variable[];
  message?: string;
}

export type Resume = 'into' | 'over' | 'out' | 'continue' | 'stop';

export interface RunOptions {
  breakpoints: Map<string, Set<number>>;
  stepInto?: boolean;
  onPause(state: PauseState): Promise<Resume>;
  onPrint(text: string): void;
}

export interface RunOutcome {
  ok: boolean;
  error?: string;
  module?: string;
  line?: number;
  result?: unknown;
}

export interface VbaRuntimeApi {
  readonly ready: boolean;
  run(modules: VbaModule[], procName: string, args: unknown[], opts: RunOptions): Promise<RunOutcome>;
  evaluate(expr: string, scope?: Frame): Promise<string>;
  stop(): void;
}

export interface VbaHooks {
  runner: ScriptRunner;
  book(): number;
  workbook(): string;
  sheets(): string[];
  status(text: string, error?: boolean): void;
}

interface ProjectDoc {
  present: boolean;
  sheets: { name: string; codeName: string }[];
  modules: { name: string; kind: VbaModule['kind']; code: string }[];
}

const RESUME: Record<Resume, StepAction> = { into: 'into', over: 'over', out: 'out', continue: 'continue', stop: 'stop' };

export class VbaService implements VbaRuntimeApi {
  readonly ready = true;
  private rt: VbaRuntime | null = null;
  private key = '';
  private mods: VbaModule[] = [];
  private running = false;
  private quietUntil = 0;
  private problems: CompileProblem[] = [];
  private udf: VbaRuntime | null = null;
  private udfKey = '';

  constructor(private readonly h: VbaHooks) {}

  get busy(): boolean {
    return this.running || Date.now() < this.quietUntil;
  }

  private host(): VbaHost {
    return {
      evalFormula: async (sheet, formula) => {
        const i = Math.max(0, this.h.sheets().indexOf(sheet));
        return engine().evalText(this.h.book(), i, 0, 0, formula, true);
      },
      msgBox,
      inputBox,
      now: () => Date.now(),
    };
  }

  private runtime(): VbaRuntime {
    return (this.rt ??= new VbaRuntime(this.host()));
  }

  async open(): Promise<void> {
    this.mods = [];
    this.key = '';
    this.udfKey = '';
    this.rt = null;
    this.udf = null;
    await this.reload();
  }

  async reload(): Promise<void> {
    const id = this.h.workbook();
    if (!id) return;
    let doc: ProjectDoc;
    try {
      const r = await fetch(`/api/workbooks/${id}/vba`);
      if (!r.ok) return;
      doc = (await r.json()) as ProjectDoc;
    } catch {
      return;
    }
    this.mods = doc.present ? doc.modules.map((m) => ({ ...m, sheet: doc.sheets.find((s) => s.codeName === m.name)?.name })) : [];
  }

  hasProject(): boolean {
    return this.mods.length > 0;
  }

  modules(): VbaModule[] {
    return this.mods;
  }

  compileProblems(): CompileProblem[] {
    return this.problems;
  }

  private async prepare(mods: VbaModule[]): Promise<VbaRuntime> {
    const rt = this.runtime();
    const key = JSON.stringify(mods);
    if (key !== this.key) {
      this.problems = await rt.load(mods);
      this.key = key;
    }
    return rt;
  }

  private async prepareUdf(): Promise<VbaRuntime> {
    const rt = (this.udf ??= new VbaRuntime(this.host()));
    const key = JSON.stringify(this.mods);
    if (key !== this.udfKey) {
      await rt.load(this.mods);
      this.udfKey = key;
    }
    return rt;
  }

  private async session<T>(rt: VbaRuntime, fn: () => Promise<T>): Promise<T> {
    const book = this.h.book();
    const mark = await engine().undoMark(book);
    const ctx = new Ctx();
    ctx.load(await this.h.runner.snapshot());
    ctx.flusher = async () => {
      const ops = ctx.ops.splice(0);
      await this.h.runner.apply(ops);
      ctx.load(await this.h.runner.snapshot());
    };
    rt.attach(ctx);
    this.running = true;
    try {
      const out = await fn();
      const rest = ctx.ops.splice(0);
      if (rest.length) await this.h.runner.apply(rest);
      return out;
    } finally {
      this.running = false;
      this.quietUntil = Date.now() + 1200;
      await engine().undoGroup(book, mark);
    }
  }

  async run(modules: VbaModule[], procName: string, args: unknown[], opts: RunOptions): Promise<RunOutcome> {
    if (!(await macroAllowed('user'))) return { ok: false, error: 'Macros are disabled by the Trust Center setting.' };
    if (this.running) return { ok: false, error: 'Another macro is still running.' };
    const rt = await this.prepare(modules);
    if (this.problems.length) {
      const p = this.problems[0];
      return { ok: false, error: `Compile error in ${p.module}, line ${p.line}: ${p.message}`, module: p.module, line: p.line };
    }
    rt.limitMs = 300000;
    for (const m of modules) rt.setBreakpoints(m.name, []);
    for (const [name, lines] of opts.breakpoints) rt.setBreakpoints(name, [...lines]);
    const off = rt.on((e) => {
      if (e.type === 'output') opts.onPrint(e.text);
      else if (e.type === 'pause') {
        void opts.onPause(toState(e.info)).then((r) => rt.resume(RESUME[r]));
      }
    });
    try {
      const r = await this.session(rt, () => (opts.stepInto ? rt.stepInto(procName, args) : rt.run(procName, args)));
      if (r.ok) return { ok: true, result: r.value };
      const e = r.error;
      return { ok: false, error: e ? `Run-time error '${e.number}': ${e.description}` : 'The macro failed.', module: e?.location.module, line: e?.location.line };
    } finally {
      off();
    }
  }

  evaluate(expr: string, _scope?: Frame): Promise<string> {
    return this.runtime().evaluate(expr);
  }

  stop(): void {
    this.rt?.stop();
  }

  private async allowed(trigger: RunTrigger): Promise<boolean> {
    return this.mods.length > 0 && (await macroAllowed(trigger));
  }

  async fire(spec: EventSpec): Promise<{ ran: boolean; cancel: boolean }> {
    if (this.running || !(await this.allowed('event'))) return { ran: false, cancel: false };
    const rt = await this.prepare(this.mods);
    if (this.problems.length) return { ran: false, cancel: false };
    return this.session(rt, () => rt.fire(spec));
  }

  async functions(): Promise<string[]> {
    if (!this.mods.length) return [];
    if (!(await macroAllowed('function'))) return [];
    return (await this.prepareUdf()).udfNames();
  }

  async call(name: string, args: unknown[]): Promise<unknown> {
    if (!(await macroAllowed('function'))) throw Object.assign(new Error('Macros are disabled.'), { excelCode: '#NAME?' });
    const rt = await this.prepareUdf();
    try {
      return await rt.callFunction(name, args);
    } catch (e) {
      throw Object.assign(new Error(e instanceof Error ? e.message : String(e)), { excelCode: rt.errorCode(e) });
    }
  }
}

function toState(i: PauseInfo): PauseState {
  const frame = { module: i.module, proc: i.proc, line: i.line };
  return { reason: i.reason === 'stop' ? 'stop-statement' : i.reason, frame, stack: i.stack.map((s) => ({ module: s.module, proc: s.proc, line: s.line })), locals: i.locals };
}
