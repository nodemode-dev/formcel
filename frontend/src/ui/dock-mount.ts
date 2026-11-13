import { agentActing } from '../automation/actor';
import { registerCommand } from './commands';
import { TerminalDock, type DockKind } from './terminal-dock';

function person(run: () => void | Promise<void>): () => void | Promise<void> {
  return () => {
    if (agentActing()) throw new Error('The terminal dock, Claude Code and Chat open only for the person at the window.');
    return run();
  };
}

export function mountDock(app: HTMLElement, titlebar: HTMLElement): TerminalDock {
  const dock = new TerminalDock();
  app.appendChild(dock.root);
  const cmd = (id: string, title: string, description: string, run: () => void | Promise<void>, extra: { keys?: string; checked?: () => boolean } = {}) =>
    registerCommand({ id, title, description, changes: false, run: person(run), ...extra });
  cmd('terminal-toggle', 'Terminal', 'Show or hide the terminal dock at the foot of the window. Programs in it keep running while it is hidden.', () => dock.toggle(), { keys: 'Mod+J', checked: () => dock.isOpen() });
  cmd('terminal-new', 'New Terminal', 'Open a new shell tab in the terminal dock.', () => dock.newTerminal());
  cmd('claude-code', 'Claude Code', 'Open Claude Code in a terminal tab with FormCel\'s tools attached, or hide the dock while it is showing.', () => dock.toggleKind('claude'), { checked: () => dock.isShowing('claude') });
  cmd('claude-chat', 'Chat with Claude', 'Open the Chat tab to ask Claude about your workbook; the conversation can continue in a Claude Code tab.', () => dock.toggleKind('chat'), { checked: () => dock.isShowing('chat') });
  const lit: [DockKind, HTMLElement | null][] = [['claude', titlebar.querySelector('.fc-tb-claude')], ['chat', titlebar.querySelector('.fc-tb-chat')], ['shell', titlebar.querySelector('.fc-tb-terminal')]];
  for (const [kind, button] of lit) button?.addEventListener('click', () => void dock.toggleKind(kind));
  dock.onTab = () => {
    for (const [kind, button] of lit) {
      const on = String(dock.isShowing(kind));
      if (button && button.getAttribute('aria-pressed') !== on) button.setAttribute('aria-pressed', on);
    }
  };
  dock.start();
  return dock;
}
