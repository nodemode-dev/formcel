import type { Grid } from '../grid/grid';
import { MAX_COLS, MAX_ROWS } from '../grid/a1';
import { getCommand, registerCommand, runCommand } from './commands';
import { MENUS_IN_WINDOW_KEY, isMac, menusInWindow } from './menubar';
import { statusBarVisible, setStatusBarVisible, type ViewMode } from './statusbar';
import { textFieldFocused } from './native-menu';

export const HOME_LAUNCH_KEY = 'formcel.autoShowHome';

export function autoShowHome(): boolean {
  try {
    return localStorage.getItem(HOME_LAUNCH_KEY) !== '0';
  } catch {
    return true;
  }
}

export interface ShellHooks {
  grid: Grid;
  hasBook(): boolean;
  openFile(): void;
  save(): void;
  viewMode(): ViewMode;
  setViewMode(m: ViewMode): void;
  about(): void;
  toast(text: string): void;
}

async function readClipboard(): Promise<{ text: string; html: string }> {
  let text = '';
  let html = '';
  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
      if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
    }
  } catch {
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return { text: '', html: '' };
    }
  }
  return { text, html };
}

export function registerShellCommands(h: ShellHooks): void {
  const cmd = (id: string, title: string, description: string, run: () => void | Promise<void>, extra: { keys?: string; enabled?: () => boolean; checked?: () => boolean } = {}) =>
    registerCommand({ id, title, description, changes: false, run, ...extra });
  const book = () => h.hasBook();

  cmd('file.open', 'Open', 'Choose a spreadsheet, CSV or PDF file and open it as a workbook.', () => h.openFile(), { keys: 'Mod+O' });
  cmd('file.save', 'Save', 'FormCel saves as you type; this saves anything still waiting and confirms it.', () => h.save(), { keys: 'Mod+S', enabled: book });
  cmd('edit.cut', 'Cut', 'Cut the selected cells to the clipboard.', () => {
    if (textFieldFocused()) return void document.execCommand('cut');
    h.grid.focus();
    document.execCommand('cut');
  }, { keys: 'Mod+X', enabled: book });
  cmd('edit.copy', 'Copy', 'Copy the selected cells to the clipboard.', () => {
    if (textFieldFocused()) return void document.execCommand('copy');
    h.grid.focus();
    document.execCommand('copy');
  }, { keys: 'Mod+C', enabled: book });
  cmd('edit.paste', 'Paste', 'Paste the clipboard into the selection.', async () => {
    const field = textFieldFocused();
    if (!field) h.grid.focus();
    const clip = await readClipboard();
    if (!clip.text && !clip.html) return;
    if (field) return void document.execCommand('insertText', false, clip.text);
    const dt = new DataTransfer();
    dt.setData('text/plain', clip.text);
    if (clip.html) dt.setData('text/html', clip.html);
    h.grid.el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { keys: 'Mod+V', enabled: book });
  cmd('edit.select-all', 'Select all', 'Select every cell on the sheet.', () => {
    if (textFieldFocused()) return void document.execCommand('selectAll');
    h.grid.focus();
    h.grid.select(0, 0, MAX_ROWS - 1, MAX_COLS - 1, false);
  }, { keys: 'Mod+A', enabled: book });
  cmd('view.normal', 'Normal view', 'Show the sheet in Normal view.', () => h.setViewMode('normal'), { enabled: book, checked: () => h.viewMode() === 'normal' });
  cmd('view.page-layout', 'Page Layout view', 'Show where each printed page starts while you work on the sheet.', () => h.setViewMode('layout'), { enabled: book, checked: () => h.viewMode() === 'layout' });
  cmd('view.status-bar', 'Status bar', 'Show or hide the status bar at the bottom of the window.', () => setStatusBarVisible(!statusBarVisible()), { checked: statusBarVisible });
  cmd('view.home-at-launch', 'Show Home at launch', 'Open the Home screen when FormCel starts. When it is off, FormCel opens the workbook you used last.', () => {
    try {
      localStorage.setItem(HOME_LAUNCH_KEY, autoShowHome() ? '0' : '1');
    } catch {
      return;
    }
  }, { checked: autoShowHome });
  cmd('view.menus-in-window', 'Menus in window', 'Keep the menus in the window instead of the menu bar at the top of the screen. Takes effect at the next start.', () => {
    const on = !menusInWindow();
    try {
      localStorage.setItem(MENUS_IN_WINDOW_KEY, on ? '1' : '0');
    } catch {
      return;
    }
    h.toast(on ? 'The menus stay in the window from the next start.' : 'The menus go to the menu bar from the next start.');
  }, { checked: menusInWindow, enabled: () => '__TAURI_INTERNALS__' in window && isMac() });
  cmd('help.about', 'About FormCel', 'Show the version of FormCel and of its calculation engine.', () => h.about());

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || document.querySelector('.fc-modal:not([hidden])')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    let id = '';
    if (mod && !e.shiftKey && !e.altKey && key === 'n') id = 'file.new';
    else if (mod && !e.shiftKey && !e.altKey && key === 'o') id = 'file.open';
    else if (mod && !e.shiftKey && !e.altKey && key === 's') id = 'file.save';
    else if (mod && !e.shiftKey && !e.altKey && e.code === 'Digit1') id = 'format.number-dialog';
    else if (e.shiftKey && !mod && !e.altKey && e.key === 'F11') id = 'sheet.add';
    else if (mod && !e.shiftKey && !e.altKey && key === 'p') id = 'file.download-pdf';
    if (!id || !getCommand(id)) return;
    if (id !== 'file.new' && id !== 'file.open' && id !== 'file.save' && !h.hasBook()) return;
    e.preventDefault();
    void runCommand(id);
  });
}
