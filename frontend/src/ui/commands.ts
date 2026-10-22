export interface Command {
  id: string;
  title: string;
  description: string;
  changes: boolean;
  keys?: string;
  enabled?(): boolean;
  checked?(): boolean;
  run(): void | Promise<void>;
}

const commands = new Map<string, Command>();

export function registerCommand(c: Command): void {
  if (commands.has(c.id)) throw new Error(`duplicate command: ${c.id}`);
  commands.set(c.id, c);
}

export function listCommands(): Omit<Command, 'run' | 'enabled' | 'checked'>[] {
  return [...commands.values()].map(({ run: _run, enabled: _enabled, checked: _checked, ...rest }) => rest);
}

export function getCommand(id: string): Command | undefined {
  return commands.get(id);
}

export function setCommandState(id: string, state: { enabled?: () => boolean; checked?: () => boolean }): void {
  const c = commands.get(id);
  if (!c) return;
  if (state.enabled) c.enabled = state.enabled;
  if (state.checked) c.checked = state.checked;
}

export async function runCommand(id: string): Promise<boolean> {
  const c = commands.get(id);
  if (!c) return false;
  await c.run();
  return true;
}
