import { vbaRuntime } from '../vbalang/bridge';

export type VbaKind = 'std' | 'class' | 'document' | 'form';

export interface VbaModule {
  name: string;
  kind: VbaKind;
  code: string;
}

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

export type Resume = 'into' | 'over' | 'out' | 'continue' | 'stop';

export interface PauseState {
  reason: 'breakpoint' | 'step' | 'error' | 'stop-statement';
  frame: Frame;
  stack: Frame[];
  locals: Variable[];
  message?: string;
}

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

export interface VbaRuntime {
  readonly ready: boolean;
  run(modules: VbaModule[], procName: string, args: unknown[], opts: RunOptions): Promise<RunOutcome>;
  evaluate(expr: string, scope?: Frame): Promise<string>;
  stop(): void;
}

const MISSING = 'The VBA language runtime is not part of this build yet, so macros can be edited and saved but not run.';

const stub: VbaRuntime = {
  ready: false,
  run: async () => ({ ok: false, error: MISSING }),
  evaluate: async () => {
    throw new Error(MISSING);
  },
  stop: () => undefined,
};

export function runtime(): VbaRuntime {
  return vbaRuntime() ?? stub;
}
