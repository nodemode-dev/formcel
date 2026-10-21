const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  sheet: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9 4.5v15"/>'),
  grid: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9.17h17M3.5 14.83h17M9.17 3.5v17M14.83 3.5v17"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),
  freezeRow: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17" stroke-width="3"/>'),
  freezeCol: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9 4.5v15" stroke-width="3"/>'),
  freezePanes: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 10h17M10 4.5v15" stroke-width="3"/>'),
  unfreeze: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 10h17M10 4.5v15" stroke-dasharray="2 2.5"/>'),
} as const;

export type IconName = keyof typeof icons;

export function icon(name: IconName): string {
  return `<span class="fc-icon">${icons[name]}</span>`;
}
