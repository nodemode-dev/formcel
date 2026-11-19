export type DockKind = 'shell' | 'claude' | 'codex' | 'cursor' | 'chat';
export type DockProgram = 'claude' | 'codex' | 'cursor';
export type PtyKind = 'shell' | 'claude' | 'codex' | 'cursor' | 'agent';
export type ChatMode = 'ask' | 'auto-edits' | 'plan';

export interface DockTerminal { id: string; title: string; alive: boolean; kind: PtyKind }
export interface DockOpen { cols: number; rows: number; prompt?: string; resume?: string }
export interface DockProgramStatus { installed: boolean; version: string | null; install: string; signedIn: boolean | null }
export type DockAgentStatus = Partial<Record<DockProgram, DockProgramStatus>>;
export interface DockChatStatus { installed: boolean; version: string | null; signedIn: boolean | null; install: string; running: boolean; state: string; mode: ChatMode; session: string | null }
export type DockChatEvent =
  | { type: 'state'; running: boolean; state: string; mode: ChatMode; session: string | null }
  | { type: 'user'; text: string }
  | { type: 'block'; id: string; kind: 'text' | 'thinking' }
  | { type: 'delta'; id: string; text: string }
  | { type: 'tool'; id: string; name: string; summary: string }
  | { type: 'tool_result'; id: string; text: string; error: boolean }
  | { type: 'permission'; id: string; tool: string; summary: string }
  | { type: 'permission_done'; id: string; allowed: boolean }
  | { type: 'result'; ok: boolean; text: string }
  | { type: 'notice'; text: string };

export interface DockAdapter {
  app: { name: string; noun: string; start: string; examples: string };
  storage: { key: string; legacy: string[] };
  sizes: { minHeight: number; maxHeightShare: number; defaultHeight: number; minWidth: number; maxWidthShare: number; defaultWidth: number };
  shortcut: { code: string; label: string };
  tabs: DockKind[];
  classes: { iconButton: string; button: string; primaryButton: string; input: string; select: string; note: string };
  mount(dock: HTMLElement): void;
  t(key: string, english: string): string;
  onTheme(handler: () => void): void;
  keyHeaders(): Record<string, string>;
  errors: { message(err: unknown): string | null; missingRoute(err: unknown): boolean };
  terminal: {
    list(): Promise<DockTerminal[]>;
    open(kind: Exclude<PtyKind, 'agent'>, options: DockOpen): Promise<DockTerminal>;
    restart(id: string): Promise<void>;
    close(id: string): Promise<void>;
    socket(id: string): WebSocket;
  };
  agentStatus(): Promise<DockAgentStatus | null>;
  chat: {
    status(): Promise<DockChatStatus | null>;
    start(mode: ChatMode, fresh: boolean): Promise<void>;
    send(text: string): Promise<void>;
    stop(): Promise<void>;
    answer(id: string, allow: boolean): Promise<void>;
    socket(): WebSocket;
  };
}
