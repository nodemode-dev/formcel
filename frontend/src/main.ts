import { engine } from './engine';
import { activateAll } from './extensions/registry';
import { Grid } from './grid/grid';
import { registerCommand, runCommand } from './ui/commands';
import { mountShell, setStatus, type ShellParts } from './ui/shell';

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

async function openSheet(p: ShellParts): Promise<Grid> {
  const book = await engine().newWorkbook();
  const undoBtn = p.toolbar.querySelector<HTMLButtonElement>('[data-cmd="edit.undo"]')!;
  const redoBtn = p.toolbar.querySelector<HTMLButtonElement>('[data-cmd="edit.redo"]')!;
  undoBtn.disabled = true;
  redoBtn.disabled = true;
  let current = '';
  let currentRef = 'A1';
  const grid = new Grid(p.grid, engine(), book, {
    onActive(text, ref) {
      current = text;
      currentRef = ref;
      if (document.activeElement !== p.nameBox) p.nameBox.value = ref;
      if (document.activeElement !== p.formulaBar) p.formulaBar.value = text;
    },
    onHistory(undo, redo) {
      undoBtn.disabled = !undo;
      redoBtn.disabled = !redo;
    },
  });
  const cmd = (id: string, title: string, description: string, changes: boolean, run: () => void | Promise<void>, keys?: string) =>
    registerCommand({ id, title, description, changes, run, keys });
  cmd('edit.undo', 'Undo', 'Undo the last change to the workbook.', true, () => grid.undo(), 'Mod+Z');
  cmd('edit.redo', 'Redo', 'Redo the last undone change.', true, () => grid.redo(), 'Mod+Y');
  cmd('edit.clear', 'Clear contents', 'Clear the contents of the selected cells.', true, () => grid.clearSelection(), 'Delete');
  cmd('view.freeze-top-row', 'Freeze top row', 'Keep row 1 visible while scrolling.', false, () => grid.freeze(1, 0));
  cmd('view.freeze-first-column', 'Freeze first column', 'Keep column A visible while scrolling.', false, () => grid.freeze(0, 1));
  cmd('view.freeze-panes', 'Freeze panes', 'Keep the rows above and the columns left of the active cell visible.', false, () => grid.freezeAtActive());
  cmd('view.unfreeze', 'Unfreeze panes', 'Scroll every row and column again.', false, () => grid.freeze(0, 0));
  p.toolbar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cmd]');
    if (b && !b.disabled) void runCommand(b.dataset.cmd!).then(() => grid.focus());
  });
  p.nameBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const ok = grid.goTo(p.nameBox.value);
      p.nameBox.setAttribute('aria-invalid', String(!ok));
      p.nameBox.title = ok ? '' : 'Type a cell like B12 or a range like B2:D9.';
    } else if (e.key === 'Escape') {
      e.preventDefault();
      grid.focus();
    }
  });
  p.nameBox.addEventListener('blur', () => {
    p.nameBox.removeAttribute('aria-invalid');
    p.nameBox.value = currentRef;
  });
  p.formulaBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void grid.setActive(p.formulaBar.value).then(() => grid.focus());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      p.formulaBar.value = current;
      grid.focus();
    }
  });
  grid.focus();
  return grid;
}

const parts = mountShell(document.getElementById('app')!);
activateAll(engine());
void openSheet(parts);

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
