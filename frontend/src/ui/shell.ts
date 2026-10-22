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
  menubar: HTMLElement;
  statusbar: HTMLElement;
}

export function mountShell(root: HTMLElement): ShellParts {
  root.innerHTML = `
    <header class="fc-titlebar">
      <div class="fc-tb-left">
        <div class="fc-brand" title="FormCel v${VERSION}"><img class="fc-brand-logo" src="/icons/logo-64.png" width="20" height="20" alt="" draggable="false"><span>FormCel</span></div>
        <button type="button" class="fc-tool fc-home-btn" title="Home" aria-label="Home" hidden>${icon('home')}</button>
        <nav class="fc-menubar" aria-label="Main menu"></nav>
      </div>
      <div class="fc-tb-doc">
        <input class="fc-title" aria-label="Workbook name" spellcheck="false" autocomplete="off" hidden>
        <span class="fc-group-badge" aria-live="polite" hidden>[Group]</span>
        <span class="fc-save" role="status" aria-live="polite" hidden></span>
      </div>
      <div class="fc-title-tools">
        <div class="fc-tb-search">
          <label class="fc-tb-search-box">${icon('search')}<input class="fc-tb-search-input" type="text" placeholder="Search" title="Search commands (Alt+Q)" aria-label="Search commands" spellcheck="false" autocomplete="off"></label>
          <div class="fc-search-pop" role="listbox" aria-label="Commands" hidden></div>
        </div>
        <button type="button" class="fc-tool fc-tb-share" title="Share" aria-label="Share">${icon('share')}</button>
        <button type="button" class="fc-tb-account" aria-label="Account"></button>
        <button type="button" class="fc-tool fc-tb-settings" title="Settings (Ctrl+,)" aria-label="Settings">${icon('settings')}</button>
        <span class="fc-status" data-state="pending" role="status" aria-live="polite"><span class="fc-status-dot"></span><span class="fc-status-text"></span></span>
      </div>
      <div class="fc-caption" hidden>
        <button type="button" class="fc-caption-btn" data-cap="min" title="Minimize" aria-label="Minimize">${icon('capMin')}</button>
        <button type="button" class="fc-caption-btn" data-cap="max" title="Maximize" aria-label="Maximize">${icon('capMax')}</button>
        <button type="button" class="fc-caption-btn fc-caption-close" data-cap="close" title="Close" aria-label="Close">${icon('close')}</button>
      </div>
    </header>
    <main class="fc-main fc-home" aria-label="Home"></main>
    <main class="fc-main fc-sheet" hidden>
      <div class="fc-ribbon" role="region" aria-label="Ribbon"></div>
      <div class="fc-formula">
        <div class="fc-namewrap"><input class="fc-namebox" aria-label="Name Box" spellcheck="false" autocomplete="off"><span class="fc-name-caret" aria-hidden="true">${icon('chevronDown')}</span></div>
        <div class="fc-fxgroup"><button type="button" class="fc-fbtn fc-fcancel" title="Cancel (Esc)" aria-label="Cancel" tabindex="-1" disabled>${icon('close')}</button><button type="button" class="fc-fbtn fc-fenter" title="Enter" aria-label="Enter" tabindex="-1" disabled>${icon('bsCheck')}</button><button type="button" class="fc-fx" data-cmd="formula.insert-function" title="Insert Function (Shift+F3)" aria-label="Insert Function">fx</button></div>
        <textarea class="fc-fbar" rows="1" wrap="off" aria-label="Formula bar" spellcheck="false" autocomplete="off"></textarea>
        <button type="button" class="fc-tool fc-fbar-toggle" title="Expand formula bar (Ctrl+Shift+U)" aria-label="Expand formula bar" aria-expanded="false">${icon('chevronDown')}</button>
        <div class="fc-fbar-grip" role="separator" aria-orientation="horizontal" aria-label="Resize formula bar" hidden></div>
      </div>
      <div class="fc-grid" role="grid" aria-label="Sheet1"></div>
      <div class="fc-bottom">
        <div class="fc-sheetbar"><div class="fc-tabnav"><button type="button" class="fc-tool" data-tabnav="-1" title="Scroll sheets left" aria-label="Scroll sheets left">${icon('bsLeft')}</button><button type="button" class="fc-tool" data-tabnav="1" title="Scroll sheets right" aria-label="Scroll sheets right">${icon('bsRight')}</button></div><div class="fc-tabs" role="tablist" aria-label="Sheets"></div><button type="button" class="fc-tool fc-add-sheet" title="Add a sheet" aria-label="Add a sheet">${icon('plus')}</button><div class="fc-tabsplit" role="separator" aria-orientation="vertical" aria-label="Resize sheet tabs" title="Drag to resize the sheet tabs and the scroll bar"></div><div class="fc-hscroll" aria-hidden="true"><div class="fc-hthumb"></div></div></div>
        <footer class="fc-statusbar" aria-label="Status bar">
          <span class="fc-st-mode" role="status">Ready</span>
          <button type="button" class="fc-st-a11y" title="Open the accessibility checker.">${icon('accessGood')}<span class="fc-st-a11y-text">Accessibility: Check</span></button>
          <span class="fc-st-lock fc-st-caps" hidden>Caps Lock</span><span class="fc-st-lock fc-st-num" hidden>Num Lock</span><span class="fc-st-lock fc-st-scroll" hidden>Scroll Lock</span>
          <span class="fc-st-page" hidden></span>
          <span class="fc-st-grow"></span>
          <button type="button" class="fc-st-busy" title="Background jobs" hidden><span>Working</span><span class="fc-st-bar"><i></i></span><span class="fc-st-steps"></span></button>
          <span class="fc-st-stats" aria-live="polite"><span class="fc-st-stat" data-stat="average" hidden>Average: <b></b></span><span class="fc-st-stat" data-stat="count" hidden>Count: <b></b></span><span class="fc-st-stat" data-stat="numcount" hidden>Numerical Count: <b></b></span><span class="fc-st-stat" data-stat="min" hidden>Min: <b></b></span><span class="fc-st-stat" data-stat="max" hidden>Max: <b></b></span><span class="fc-st-stat" data-stat="sum" hidden>Sum: <b></b></span></span>
          <span class="fc-st-engine"></span>
          <div class="fc-st-views" role="group" aria-label="Workbook views"><button type="button" class="fc-st-view" data-view="normal" title="Normal" aria-label="Normal view" aria-pressed="true">${icon('viewNormal')}</button><button type="button" class="fc-st-view" data-view="layout" title="Page Layout" aria-label="Page Layout view" aria-pressed="false">${icon('viewLayout')}</button><button type="button" class="fc-st-view" data-view="break" title="Page Break Preview" aria-label="Page Break Preview" aria-pressed="false">${icon('viewBreak')}</button></div>
          <div class="fc-zoom" role="group" aria-label="Zoom"><button type="button" class="fc-tool" data-zoom="-1" title="Zoom out (Ctrl and scroll)" aria-label="Zoom out">${icon('minus')}</button><input type="range" class="fc-zoom-slider" min="50" max="200" step="5" value="100" aria-label="Zoom level"><button type="button" class="fc-tool" data-zoom="1" title="Zoom in (Ctrl and scroll)" aria-label="Zoom in">${icon('plus')}</button><span class="fc-zoom-val">100%</span></div>
        </footer>
      </div>
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
    menubar: root.querySelector<HTMLElement>('.fc-menubar')!,
    statusbar: root.querySelector<HTMLElement>('.fc-statusbar')!,
  };
}

export function setStatus(parts: ShellParts, state: 'ok' | 'down', text: string, detail: string): void {
  parts.status.dataset.state = state;
  parts.statusText.nodeValue = text;
  parts.status.title = detail;
  const engine = parts.statusbar.querySelector<HTMLElement>('.fc-st-engine');
  if (engine) {
    engine.textContent = text;
    engine.title = detail;
  }
}
