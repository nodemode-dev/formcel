import { icon } from './icons';
import { VERSION } from '../version';

export interface ShellParts {
  status: HTMLElement;
  statusText: Text;
  toolbar: HTMLElement;
  nameBox: HTMLInputElement;
  formulaBar: HTMLTextAreaElement;
  formulaBox: HTMLElement;
  formulaToggle: HTMLButtonElement;
  formulaGrip: HTMLElement;
  grid: HTMLElement;
  homeBtn: HTMLButtonElement;
  title: HTMLInputElement;
  groupBadge: HTMLElement;
  save: HTMLElement;
  saveText: Text;
  home: HTMLElement;
  sheet: HTMLElement;
  tabs: HTMLElement;
  addSheet: HTMLButtonElement;
  zoom: HTMLElement;
  zoomVal: HTMLElement;
}

export function mountShell(root: HTMLElement): ShellParts {
  root.innerHTML = `
    <header class="fc-bar">
      <div class="fc-brand">${icon('sheet')}<span>FormCel</span><span class="fc-version">v${VERSION}</span></div>
      <button type="button" class="fc-tool fc-home-btn" title="Home" aria-label="Home" hidden>${icon('home')}</button>
      <input class="fc-title" aria-label="Workbook name" spellcheck="false" autocomplete="off" hidden>
      <span class="fc-group-badge" aria-live="polite" hidden>[Group]</span>
      <span class="fc-save" role="status" aria-live="polite" hidden></span>
      <div class="fc-bar-spacer"></div>
      <span class="fc-status" data-state="pending" role="status" aria-live="polite"><span class="fc-status-dot"></span><span class="fc-status-text"></span></span>
    </header>
    <main class="fc-main fc-home" aria-label="Home"></main>
    <main class="fc-main fc-sheet" hidden>
      <div class="fc-ribbon" role="region" aria-label="Ribbon"></div>
      <div class="fc-formula">
        <input class="fc-namebox" aria-label="Name Box" spellcheck="false" autocomplete="off">
        <button type="button" class="fc-fx" data-cmd="formula.insert-function" title="Insert Function (Shift+F3)" aria-label="Insert Function">fx</button>
        <textarea class="fc-fbar" rows="1" wrap="off" aria-label="Formula bar" spellcheck="false" autocomplete="off"></textarea>
        <button type="button" class="fc-tool fc-fbar-toggle" title="Expand formula bar (Ctrl+Shift+U)" aria-label="Expand formula bar" aria-expanded="false">${icon('chevronDown')}</button>
        <div class="fc-fbar-grip" role="separator" aria-orientation="horizontal" aria-label="Resize formula bar" hidden></div>
      </div>
      <div class="fc-grid" role="grid" aria-label="Sheet1"></div>
      <div class="fc-sheetbar"><div class="fc-tabs" role="tablist" aria-label="Sheets"></div><button type="button" class="fc-tool fc-add-sheet" title="Add a sheet" aria-label="Add a sheet">${icon('plus')}</button><div class="fc-zoom" role="group" aria-label="Zoom"><button type="button" class="fc-tool" data-zoom="-1" title="Zoom out (Ctrl and scroll)" aria-label="Zoom out">${icon('minus')}</button><input type="range" class="fc-zoom-slider" min="50" max="200" step="5" value="100" aria-label="Zoom level"><span class="fc-zoom-val">100%</span><button type="button" class="fc-tool" data-zoom="1" title="Zoom in (Ctrl and scroll)" aria-label="Zoom in">${icon('plus')}</button></div></div>
    </main>`;
  const status = root.querySelector<HTMLElement>('.fc-status')!;
  const statusText = document.createTextNode('Engine starting');
  status.querySelector('.fc-status-text')!.appendChild(statusText);
  return {
    status,
    statusText,
    toolbar: root.querySelector<HTMLElement>('.fc-ribbon')!,
    nameBox: root.querySelector<HTMLInputElement>('.fc-namebox')!,
    formulaBar: root.querySelector<HTMLTextAreaElement>('.fc-fbar')!,
    formulaBox: root.querySelector<HTMLElement>('.fc-formula')!,
    formulaToggle: root.querySelector<HTMLButtonElement>('.fc-fbar-toggle')!,
    formulaGrip: root.querySelector<HTMLElement>('.fc-fbar-grip')!,
    grid: root.querySelector<HTMLElement>('.fc-grid')!,
    homeBtn: root.querySelector<HTMLButtonElement>('.fc-home-btn')!,
    title: root.querySelector<HTMLInputElement>('.fc-title')!,
    groupBadge: root.querySelector<HTMLElement>('.fc-group-badge')!,
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
