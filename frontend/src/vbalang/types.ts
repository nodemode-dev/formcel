export type ModuleKind = 'std' | 'class' | 'document' | 'form';

export interface VbaModule {
  name: string;
  kind: ModuleKind;
  code: string;
  sheet?: string;
}

export interface Location {
  module: string;
  proc: string;
  line: number;
}

export interface StackEntry extends Location {
  depth: number;
}

export interface PauseInfo extends Location {
  reason: 'breakpoint' | 'step' | 'stop';
  stack: StackEntry[];
  locals: { name: string; value: string; type: string }[];
}

export type StepAction = 'continue' | 'into' | 'over' | 'out' | 'stop';

export type VbaEvent =
  | { type: 'output'; text: string }
  | { type: 'pause'; info: PauseInfo }
  | { type: 'resumed' }
  | { type: 'error'; number: number; description: string; source: string; location: Location }
  | { type: 'done'; ok: boolean; value?: unknown }
  | { type: 'status'; text: string };

export interface RunResult {
  ok: boolean;
  value?: unknown;
  error?: { number: number; description: string; source: string; location: Location };
}

export interface CompileProblem {
  module: string;
  line: number;
  message: string;
}

export interface VbaHost {
  evalFormula(sheet: string, formula: string): Promise<string>;
  msgBox(prompt: string, buttons: number, title: string): Promise<number>;
  inputBox(prompt: string, title: string, def: string): Promise<string | null>;
  save?(): Promise<void>;
  security?(): string;
  now(): number;
}

export interface VbaEngine {
  load(modules: VbaModule[]): Promise<CompileProblem[]>;
  run(procName: string, args?: unknown[]): Promise<RunResult>;
  setBreakpoints(module: string, lines: number[]): void;
  resume(action: StepAction): void;
  stepInto(procName: string, args?: unknown[]): Promise<RunResult>;
  evaluate(text: string): Promise<string>;
  stop(): void;
  on(fn: (e: VbaEvent) => void): () => void;
  procedures(): { module: string; name: string; kind: string; isPublic: boolean; params: number }[];
}

export type RunTrigger = 'user' | 'event' | 'function';

export type MacroGate = (trigger: RunTrigger) => boolean | Promise<boolean>;

export type MacroPolicy = 'disable' | 'notify' | 'enable';

export function storedPolicy(): MacroPolicy {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('formcel.prefs') : null;
    const v = raw ? String((JSON.parse(raw) as { macroSecurity?: { level?: unknown } }).macroSecurity?.level ?? '').toLowerCase() : '';
    if (v === 'silent' || v === 'signed') return 'disable';
    if (v === 'all') return 'enable';
  } catch {
    return 'notify';
  }
  return 'notify';
}

let gate: MacroGate = (trigger) => {
  const p = storedPolicy();
  if (p === 'disable') return false;
  if (p === 'enable') return true;
  return trigger === 'user';
};

export function setMacroGate(g: MacroGate): void {
  gate = g;
}

export function macroAllowed(trigger: RunTrigger): boolean | Promise<boolean> {
  return gate(trigger);
}
