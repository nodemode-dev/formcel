import type { VbaStore } from './model';
import { runtime, type PauseState, type Resume, type RunOutcome } from './runtime';

export type DebugEvent = 'state' | 'pause' | 'print' | 'done' | 'breaks';

export class Session {
  state: 'idle' | 'running' | 'paused' = 'idle';
  paused: PauseState | null = null;
  readonly breakpoints = new Map<string, Set<number>>();
  last: RunOutcome | null = null;
  gate: () => string | null = () => null;
  private resume: ((r: Resume) => void) | null = null;
  private readonly listeners = new Set<(e: DebugEvent, data?: unknown) => void>();

  constructor(private readonly store: VbaStore) {}

  on(fn: (e: DebugEvent, data?: unknown) => void): void {
    this.listeners.add(fn);
  }

  private emit(e: DebugEvent, data?: unknown): void {
    for (const l of this.listeners) l(e, data);
  }

  print(text: string): void {
    this.emit('print', text);
  }

  toggleBreak(module: string, line: number): void {
    const set = this.breakpoints.get(module) ?? new Set<number>();
    if (!set.delete(line)) set.add(line);
    if (set.size) this.breakpoints.set(module, set);
    else this.breakpoints.delete(module);
    this.emit('breaks', module);
  }

  setBreaks(module: string, lines: Set<number>): void {
    if (lines.size) this.breakpoints.set(module, lines);
    else this.breakpoints.delete(module);
  }

  async run(module: string, proc: string, stepInto = false): Promise<RunOutcome> {
    if (this.state !== 'idle') return { ok: false, error: 'A macro is already running.' };
    const blocked = this.gate();
    if (blocked) {
      const r = { ok: false, error: blocked };
      this.last = r;
      this.emit('done', r);
      return r;
    }
    this.state = 'running';
    this.paused = null;
    this.emit('state');
    let out: RunOutcome;
    try {
      out = await runtime().run(
        this.store.mods.map((m) => ({ name: m.name, kind: m.kind, code: m.code })),
        module ? `${module}.${proc}` : proc,
        [],
        {
          breakpoints: this.breakpoints,
          stepInto,
          onPrint: (t) => this.emit('print', t),
          onPause: (s) =>
            new Promise<Resume>((res) => {
              this.state = 'paused';
              this.paused = s;
              this.resume = res;
              this.emit('state');
              this.emit('pause', s);
            }),
        },
      );
    } catch (e) {
      out = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    this.state = 'idle';
    this.paused = null;
    this.resume = null;
    this.last = out;
    this.emit('state');
    this.emit('done', out);
    return out;
  }

  step(how: Resume): void {
    const r = this.resume;
    if (!r) return;
    this.resume = null;
    this.state = 'running';
    this.paused = null;
    this.emit('state');
    r(how);
  }

  reset(): void {
    if (this.state === 'paused') this.step('stop');
    else if (this.state === 'running') runtime().stop();
  }

  async evaluate(expr: string): Promise<string> {
    return runtime().evaluate(expr, this.paused?.frame);
  }
}
