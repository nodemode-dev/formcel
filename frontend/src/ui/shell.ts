import { icon } from './icons';
import { VERSION } from '../version';

export interface ShellParts {
  status: HTMLElement;
  statusText: Text;
}

export function mountShell(root: HTMLElement): ShellParts {
  root.innerHTML = `
    <header class="fc-bar">
      <div class="fc-brand">${icon('sheet')}<span>FormCel</span><span class="fc-version">v${VERSION}</span></div>
      <div class="fc-bar-spacer"></div>
      <span class="fc-status" data-state="pending" role="status" aria-live="polite"><span class="fc-status-dot"></span><span class="fc-status-text"></span></span>
    </header>
    <main class="fc-main">
      <section class="fc-empty">
        ${icon('grid')}
        <h1>No workbooks yet</h1>
        <p>The FormCel window and engine are running. Workbooks, the grid and the home screen arrive in the next release.</p>
      </section>
    </main>`;
  const status = root.querySelector<HTMLElement>('.fc-status')!;
  const statusText = document.createTextNode('Engine starting');
  status.querySelector('.fc-status-text')!.appendChild(statusText);
  return { status, statusText };
}

export function setStatus(parts: ShellParts, state: 'ok' | 'down', text: string, detail: string): void {
  parts.status.dataset.state = state;
  parts.statusText.nodeValue = text;
  parts.status.title = detail;
}
