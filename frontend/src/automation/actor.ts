let running = 0;

export async function asAgent<T>(fn: () => Promise<T>): Promise<T> {
  running++;
  try { return await fn(); } finally { window.setTimeout(() => { running = Math.max(0, running - 1); }, 0); }
}

export function agentActing(): boolean {
  return running > 0;
}
