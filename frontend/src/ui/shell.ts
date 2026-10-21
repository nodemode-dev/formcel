import { icon } from './icons';
import { VERSION } from '../version';

export interface ShellParts {
  status: HTMLElement;
  statusText: Text;
  toolbar: HTMLElement;
  nameBox: HTMLInputElement;
  formulaBar: HTMLInputElement;
  grid: HTMLElement;
}

const tool = (cmd: string, name: Parameters<typeof icon>[0], title: string) =>
  `<button type="button" class="fc-tool" data-cmd="${cmd}" title="${title}" aria-label="${title}">${icon(name)}</button>`;

export function mountShell(root: HTMLElement): ShellParts {
  root.innerHTML = `
    <header class="fc-bar">
      <div class="fc-brand">${icon('sheet')}<span>FormCel</span><span class="fc-version">v${VERSION}</span></div>
      <div class="fc-bar-spacer"></div>
      <span class="fc-status" data-state="pending" role="status" aria-live="polite"><span class="fc-status-dot"></span><span class="fc-status-text"></span></span>
    </header>
    <main class="fc-main fc-sheet">
      <div class="fc-toolbar" role="toolbar" aria-label="Sheet">
        ${tool('edit.undo', 'undo', 'Undo (Ctrl+Z)')}${tool('edit.redo', 'redo', 'Redo (Ctrl+Y)')}
        <span class="fc-tool-sep" aria-hidden="true"></span>
        ${tool('view.freeze-top-row', 'freezeRow', 'Freeze top row')}${tool('view.freeze-first-column', 'freezeCol', 'Freeze first column')}${tool('view.freeze-panes', 'freezePanes', 'Freeze panes above and left of the active cell')}${tool('view.unfreeze', 'unfreeze', 'Unfreeze panes')}
      </div>
      <div class="fc-formula">
        <input class="fc-namebox" aria-label="Name Box" spellcheck="false" autocomplete="off">
        <span class="fc-fx" aria-hidden="true">fx</span>
        <input class="fc-fbar" aria-label="Formula bar" spellcheck="false" autocomplete="off">
      </div>
      <div class="fc-grid" role="grid" aria-label="Sheet1"></div>
      <div class="fc-sheetbar"><span class="fc-tab" aria-current="page">Sheet1</span></div>
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
  };
}

export function setStatus(parts: ShellParts, state: 'ok' | 'down', text: string, detail: string): void {
  parts.status.dataset.state = state;
  parts.statusText.nodeValue = text;
  parts.status.title = detail;
}
