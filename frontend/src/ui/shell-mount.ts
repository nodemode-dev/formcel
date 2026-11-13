import { engine } from '../engine';
import type { Grid } from '../grid/grid';
import { VERSION } from '../version';
import { brandMark } from './brand';
import { excelMenus } from './menudefs';
import { MenuBar } from './menubar';
import { withJob } from './jobs';
import { actions, el, makeModal, type Modal } from './modal';
import { NativeMenus, wantsNativeMenus } from './native-menu';
import { registerShellCommands } from './shellcmds';
import type { ShellParts } from './shell';
import { StatusBar, type ViewMode } from './statusbar';

export interface ChromeHost {
  grid: Grid;
  hasBook(): boolean;
  book(): number;
  sheet(): number;
  importFile(file: File): Promise<unknown>;
  save(): void;
  viewMode(): ViewMode;
  setViewMode(m: ViewMode): void;
  a11y(): Promise<{ bad: number; tips: number } | null>;
  toast(text: string): void;
}

export const OPEN_ACCEPT = '.xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt,.html,.htm,.pdf';

function openPicker(h: ChromeHost): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = OPEN_ACCEPT;
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void withJob(`Opening ${f.name}`, () => h.importFile(f));
  });
  input.click();
}

function aboutDialog(): () => void {
  let modal: Modal | null = null;
  let versions: HTMLElement;
  return () => {
    if (!modal) {
      modal = makeModal('About FormCel');
      const m = modal;
      const lines = el('div', 'fc-about');
      lines.innerHTML = brandMark(72);
      lines.firstElementChild!.classList.add('fc-about-logo');
      lines.append(el('p', 'fc-about-name', `FormCel ${VERSION}`), el('p', '', 'A local-first spreadsheet from NodeMode, in the form family. Your workbooks stay on this computer.'));
      versions = el('p', 'fc-about-versions', '');
      lines.appendChild(versions);
      lines.appendChild(el('p', 'fc-about-licence', 'Apache-2.0 licence.'));
      m.body.append(lines, actions('Close', () => m.close(), () => m.close(), [], ''));
    }
    void Promise.all([engine().version(), fetch('/api/health').then((r) => r.json() as Promise<{ engine?: { version?: string } }>).catch(() => null)]).then(([wasm, health]) => {
      versions.textContent = `Window engine ${wasm}. Engine process ${health?.engine?.version ?? 'not reachable'}.`;
    });
    modal.open();
  };
}

function dropZone(h: ChromeHost): void {
  const veil = el('div', 'fc-drop', 'Drop a file to open it as a workbook');
  veil.hidden = true;
  document.getElementById('overlay-root')!.appendChild(veil);
  let depth = 0;
  const carries = (e: DragEvent): boolean => [...(e.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!carries(e)) return;
    e.preventDefault();
    if (depth++ === 0) veil.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (carries(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    if (!carries(e)) return;
    if (depth > 0 && --depth === 0) veil.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!carries(e)) return;
    e.preventDefault();
    depth = 0;
    veil.hidden = true;
    const f = e.dataTransfer?.files?.[0];
    if (f) void withJob(`Opening ${f.name}`, () => h.importFile(f));
  });
}

export function mountChrome(p: ShellParts, h: ChromeHost): StatusBar {
  const about = aboutDialog();
  registerShellCommands({
    grid: h.grid,
    hasBook: () => h.hasBook(),
    openFile: () => openPicker(h),
    save: () => h.save(),
    viewMode: () => h.viewMode(),
    setViewMode: (m) => h.setViewMode(m),
    about,
    toast: (t) => h.toast(t),
  });
  new MenuBar(p.menubar, excelMenus());
  if (wantsNativeMenus()) {
    const native = new NativeMenus(excelMenus);
    void native.build().catch(() => undefined);
    document.addEventListener('fc-viewmode', () => native.refresh());
  }
  dropZone(h);
  return new StatusBar(p.statusbar, {
    grid: h.grid,
    book: () => h.book(),
    sheet: () => h.sheet(),
    viewMode: () => h.viewMode(),
    setViewMode: (m) => h.setViewMode(m),
    a11y: () => h.a11y(),
  });
}
