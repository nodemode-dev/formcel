interface Internals {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  metadata?: { currentWindow?: { label?: string } };
}

const internals = (): Internals | null => (window as unknown as { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__ ?? null;

export const isDesktop = (): boolean => internals() !== null;
export const isMac = (): boolean => /Mac/.test(navigator.platform);
export const wantsOverlayTitleBar = (): boolean => isDesktop() && isMac();
export const wantsCustomTitleBar = (): boolean => isDesktop() && !isMac();

export const CUSTOM_TITLE_KEY = 'formcel.customTitleBar';

export function customTitleBarOn(): boolean {
  try {
    return localStorage.getItem(CUSTOM_TITLE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setCustomTitleBar(on: boolean): void {
  try {
    localStorage.setItem(CUSTOM_TITLE_KEY, on ? '1' : '0');
  } catch {
    return;
  }
}

export function shell<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T | undefined> {
  const i = internals();
  if (!i) return Promise.resolve(undefined);
  return (i.invoke(cmd, args) as Promise<T>).catch(() => undefined);
}

export function windowCall<T = unknown>(action: string, args: Record<string, unknown> = {}): Promise<T | undefined> {
  const label = internals()?.metadata?.currentWindow?.label ?? 'main';
  return shell<T>(`plugin:window|${action}`, { label, ...args });
}

export function revealApp(): void {
  if (document.body.classList.contains('app-ready')) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.body.classList.add('app-ready');
    if (isDesktop()) requestAnimationFrame(() => void shell('app_ready'));
  }));
}

export function fontsOrTimeout(ms: number): Promise<void> {
  const fonts = document.fonts?.ready ?? Promise.resolve();
  return Promise.race([fonts.then(() => undefined), new Promise<void>((done) => setTimeout(done, ms))]);
}
