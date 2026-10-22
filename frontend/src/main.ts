import { engine } from './engine';
import { activateAll } from './extensions/registry';
import { App } from './app';
import { mountShell, setStatus } from './ui/shell';
import { registerPwa } from './pwa';
import { registerCommand } from './ui/commands';
import { CaptionButtons, TitleTools } from './ui/titlebar';
import { fontsOrTimeout, revealApp, wantsCustomTitleBar } from './ui/desktop';

registerPwa();

interface Health {
  ok: boolean;
  engine: { loaded: boolean; version: string | null; probe?: string };
}

async function checkEngines(): Promise<[string, Health]> {
  const [wasm, health] = await Promise.all([
    engine().version(),
    fetch('/api/health').then((r) => (r.ok ? (r.json() as Promise<Health>) : Promise.reject(new Error(`HTTP ${r.status}`)))),
  ]);
  return [wasm, health];
}

const parts = mountShell(document.getElementById('app')!);
const titlebar = parts.status.closest<HTMLElement>('.fc-titlebar')!;
const caption = new CaptionButtons(titlebar);
new TitleTools(titlebar);
registerCommand({
  id: 'view.custom-title-bar',
  title: 'Custom title bar',
  description: 'Draw the minimize, maximize and close buttons in the title row instead of the system title bar (Windows and Linux).',
  changes: false,
  run: () => { if (wantsCustomTitleBar()) caption.toggle(); },
});
activateAll(engine());
const app = new App(parts);
void Promise.race([app.ready, new Promise((done) => setTimeout(done, 2500))])
  .then(() => fontsOrTimeout(2500))
  .then(revealApp);

checkEngines().then(
  ([wasm, health]) => {
    const py = health.engine.version;
    if (health.ok && py === wasm) {
      setStatus(parts, 'ok', `Engine ${wasm}`, `Window engine ${wasm} (WebAssembly) and engine process ${py} (Python module) are the same build.`);
    } else {
      setStatus(parts, 'down', 'Engine mismatch', `Window engine ${wasm}, engine process ${py ?? 'not loaded'}. Run ./formcel_oc_install again.`);
    }
  },
  (err: unknown) => {
    setStatus(parts, 'down', 'Engine offline', `Could not reach the engine: ${err instanceof Error ? err.message : String(err)}. Start it with ./formcel.`);
  },
);
