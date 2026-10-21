const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  sheet: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9 4.5v15"/>'),
  grid: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9.17h17M3.5 14.83h17M9.17 3.5v17M14.83 3.5v17"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  home: svg('<path d="M4 11l8-6.5 8 6.5"/><path d="M6.5 9.5V19.5h11V9.5"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  template: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
  trash: svg('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>'),
  restore: svg('<path d="M4 12a8 8 0 103-6.2"/><path d="M4 4.5V9h4.5"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  cloudOff: svg('<path d="M7 18.5h9.5a4 4 0 00.6-8 5.5 5.5 0 00-10.4-1.6A4.5 4.5 0 007 18.5z"/><path d="M3.5 3.5l17 17"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),
  freezeRow: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17" stroke-width="3"/>'),
  freezeCol: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9 4.5v15" stroke-width="3"/>'),
  freezePanes: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 10h17M10 4.5v15" stroke-width="3"/>'),
  unfreeze: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 10h17M10 4.5v15" stroke-dasharray="2 2.5"/>'),
  split: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 12h17M12 4.5v15"/><path d="M12 9.5v5M9.5 12h5" stroke-width="3"/>'),
  numFormat: svg('<path d="M10 4l-2 16M16 4l-2 16M4.5 9h15M4 15h15"/>'),
  decMore: svg('<circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/><rect x="8" y="11" width="4.5" height="8" rx="2.25"/><rect x="15" y="11" width="4.5" height="8" rx="2.25"/><path d="M12 5.5H4M6.5 3L4 5.5 6.5 8"/>'),
  decLess: svg('<circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/><rect x="8" y="11" width="4.5" height="8" rx="2.25"/><path d="M12 5.5h8M17.5 3L20 5.5 17.5 8"/>'),
} as const;

export type IconName = keyof typeof icons;

export function icon(name: IconName): string {
  return `<span class="fc-icon">${icons[name]}</span>`;
}
