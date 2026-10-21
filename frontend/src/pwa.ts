interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPrompt | null = null;

export function installable(): boolean {
  return deferred !== null;
}

export function installed(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true || '__TAURI_INTERNALS__' in window;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const p = deferred;
  deferred = null;
  await p.prompt();
  return (await p.userChoice).outcome;
}

export function registerPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    document.dispatchEvent(new CustomEvent('fc-installable'));
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    document.dispatchEvent(new CustomEvent('fc-installable'));
  });
  if (!('serviceWorker' in navigator) || '__TAURI_INTERNALS__' in window) return;
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!secure || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  });
}
