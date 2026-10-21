import { icon } from './icons';
import { VERSION } from '../version';

export interface ShellParts {
  status: HTMLElement;
  statusText: Text;
  toolbar: HTMLElement;
  nameBox: HTMLInputElement;
  formulaBar: HTMLInputElement;
  grid: HTMLElement;
  homeBtn: HTMLButtonElement;
  title: HTMLInputElement;
  save: HTMLElement;
  saveText: Text;
  home: HTMLElement;
  sheet: HTMLElement;
  tabs: HTMLElement;
  addSheet: HTMLButtonElement;
  zoom: HTMLElement;
  zoomVal: HTMLElement;
}

const tool = (cmd: string, name: Parameters<typeof icon>[0], title: string) =>
  `<button type="button" class="fc-tool" data-cmd="${cmd}" title="${title}" aria-label="${title}">${icon(name)}</button>`;

export function mountShell(root: HTMLElement): ShellParts {
  root.innerHTML = `
    <header class="fc-bar">
      <div class="fc-brand">${icon('sheet')}<span>FormCel</span><span class="fc-version">v${VERSION}</span></div>
      <button type="button" class="fc-tool fc-home-btn" title="Home" aria-label="Home" hidden>${icon('home')}</button>
      <input class="fc-title" aria-label="Workbook name" spellcheck="false" autocomplete="off" hidden>
      <span class="fc-save" role="status" aria-live="polite" hidden></span>
      <div class="fc-bar-spacer"></div>
      <span class="fc-status" data-state="pending" role="status" aria-live="polite"><span class="fc-status-dot"></span><span class="fc-status-text"></span></span>
    </header>
    <main class="fc-main fc-home" aria-label="Home"></main>
    <main class="fc-main fc-sheet" hidden>
      <div class="fc-toolbar" role="toolbar" aria-label="Sheet">
        ${tool('edit.undo', 'undo', 'Undo (Ctrl+Z)')}${tool('edit.redo', 'redo', 'Redo (Ctrl+Y)')}
        <span class="fc-tool-sep" aria-hidden="true"></span>
        ${tool('format.menu', 'numFormat', 'Number format')}${tool('format.decimals-more', 'decMore', 'Increase decimal places')}${tool('format.decimals-less', 'decLess', 'Decrease decimal places')}
        <span class="fc-tool-sep" aria-hidden="true"></span>
        ${tool('view.freeze-top-row', 'freezeRow', 'Freeze top row')}${tool('view.freeze-first-column', 'freezeCol', 'Freeze first column')}${tool('view.freeze-panes', 'freezePanes', 'Freeze panes above and left of the active cell')}${tool('view.unfreeze', 'unfreeze', 'Unfreeze panes')}${tool('view.split', 'split', 'Split into panes at the active cell')}
      </div>
      <div class="fc-formula">
        <input class="fc-namebox" aria-label="Name Box" spellcheck="false" autocomplete="off">
        <span class="fc-fx" aria-hidden="true">fx</span>
        <input class="fc-fbar" aria-label="Formula bar" spellcheck="false" autocomplete="off">
      </div>
      <div class="fc-grid" role="grid" aria-label="Sheet1"></div>
      <div class="fc-sheetbar"><div class="fc-tabs" role="tablist" aria-label="Sheets"></div><button type="button" class="fc-tool fc-add-sheet" title="Add a sheet" aria-label="Add a sheet">${icon('plus')}</button><div class="fc-zoom" role="group" aria-label="Zoom"><button type="button" class="fc-tool" data-zoom="-1" title="Zoom out (Ctrl and scroll)" aria-label="Zoom out">${icon('minus')}</button><span class="fc-zoom-val">100%</span><button type="button" class="fc-tool" data-zoom="1" title="Zoom in (Ctrl and scroll)" aria-label="Zoom in">${icon('plus')}</button></div></div>
    </main>`;
  const status = root.querySelector<HTMLElement>('.fc-status')!;
  const statusText = document.createTextNode('Engine starting');
  status.querySelector('.fc-status-text')!.appendChild(statusText);
  return {
    status,
    statusText,
    toolbar: root.querySelector<HTMLElement>('.fc-toolbar')!,
    nameBox: root.querySelector<HTMLInputElement>('.fc-namebox')!,
    formulaBar: root.querySelector<HTMLInputElement>('.fc-fbar')!,
    grid: root.querySelector<HTMLElement>('.fc-grid')!,
    homeBtn: root.querySelector<HTMLButtonElement>('.fc-home-btn')!,
    title: root.querySelector<HTMLInputElement>('.fc-title')!,
    save: root.querySelector<HTMLElement>('.fc-save')!,
    saveText: root.querySelector<HTMLElement>('.fc-save')!.appendChild(document.createTextNode('Saved')),
    home: root.querySelector<HTMLElement>('.fc-home')!,
    sheet: root.querySelector<HTMLElement>('.fc-sheet')!,
    tabs: root.querySelector<HTMLElement>('.fc-tabs')!,
    addSheet: root.querySelector<HTMLButtonElement>('.fc-add-sheet')!,
    zoom: root.querySelector<HTMLElement>('.fc-zoom')!,
    zoomVal: root.querySelector<HTMLElement>('.fc-zoom-val')!,
  };
}

export function setStatus(parts: ShellParts, state: 'ok' | 'down', text: string, detail: string): void {
  parts.status.dataset.state = state;
  parts.statusText.nodeValue = text;
  parts.status.title = detail;
}
