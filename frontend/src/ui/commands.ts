export interface Command {
  id: string;
  title: string;
  description: string;
  changes: boolean;
  keys?: string;
  run(): void | Promise<void>;
}

const commands = new Map<string, Command>();

export function registerCommand(c: Command): void {
  if (commands.has(c.id)) throw new Error(`duplicate command: ${c.id}`);
  commands.set(c.id, c);
}

export function hasCommand(id: string): boolean {
  return commands.has(id);
}

export function commandInfo(id: string): Omit<Command, 'run'> | null {
  const c = commands.get(id);
  if (!c) return null;
  const { run: _run, ...rest } = c;
  return rest;
}

export function listCommands(): Omit<Command, 'run'>[] {
  return [...commands.values()].map(({ run: _run, ...rest }) => rest);
}

export async function runCommand(id: string): Promise<boolean> {
  const c = commands.get(id);
  if (!c) return false;
  await c.run();
  return true;
}
