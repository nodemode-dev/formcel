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
  bold: svg('<path d="M7.5 5h5.5a3.5 3.5 0 010 7H7.5zM7.5 12h6.5a3.5 3.5 0 010 7H7.5z" stroke-width="2.2"/>'),
  italic: svg('<path d="M10 5h8M6 19h8M14 5l-4 14"/>'),
  underline: svg('<path d="M7 4v7a5 5 0 0010 0V4M5 20h14"/>'),
  strike: svg('<path d="M5 12h14M16 7.5C15.4 5.8 13.9 5 12 5c-2.4 0-4 1.3-4 3.1M8.5 16.5c.7 1.7 2.4 2.5 3.8 2.5 2.4 0 4.2-1.4 4.2-3.3"/>'),
  textColor: svg('<path d="M7.5 15L12 4l4.5 11M9 11.5h6"/><rect x="4" y="18" width="16" height="3" rx="1" stroke="none" style="fill:var(--swatch,currentColor)"/>'),
  fillColor: svg('<path d="M5.5 10.5l5.5-5.5 6.5 6.5-5.5 5.5z"/><path d="M18.5 12.5c.9 1.3 1.3 2.1 1.3 2.6a1.3 1.3 0 01-2.6 0c0-.5.4-1.3 1.3-2.6z"/><rect x="4" y="18" width="16" height="3" rx="1" stroke="none" style="fill:var(--swatch,currentColor)"/>'),
  borders: svg('<rect x="4.5" y="4.5" width="15" height="15" rx="1"/><path d="M12 4.5v15M4.5 12h15" stroke-dasharray="1.5 2"/>'),
  alignLeft: svg('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'),
  alignCenter: svg('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
  alignRight: svg('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'),
  alignTop: svg('<path d="M4 4.5h16M12 8.5V20M8.5 12L12 8.5 15.5 12"/>'),
  alignMiddle: svg('<path d="M4 12h16M12 3v5.5M9.5 6L12 8.5 14.5 6M12 21v-5.5M9.5 18l2.5-2.5 2.5 2.5"/>'),
  alignBottom: svg('<path d="M4 19.5h16M12 15.5V4M8.5 12l3.5 3.5 3.5-3.5"/>'),
  wrap: svg('<path d="M4 6h16M4 12h12.5a3 3 0 010 6H12M14 15.5L11.5 18l2.5 2.5M4 18h4"/>'),
  indentMore: svg('<path d="M4 5h16M11 10h9M11 14h9M4 19h16M4 9.5L7 12l-3 2.5"/>'),
  indentLess: svg('<path d="M4 5h16M11 10h9M11 14h9M4 19h16M7 9.5L4 12l3 2.5"/>'),
  merge: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="M8 12h8M10.5 9.5L8 12l2.5 2.5M13.5 9.5L16 12l-2.5 2.5"/>'),
  rotate: svg('<path d="M6 18L15.5 8.5M11 8h5v5"/><path d="M4 20h16"/>'),
  painter: svg('<rect x="5" y="3.5" width="12" height="5" rx="1.2"/><path d="M17 6h2.5v4.5H11V14"/><rect x="9.5" y="14" width="3" height="6.5" rx="1"/>'),
  cf: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9 4.5v15"/><path d="M11.5 12h6M11.5 15.5h3.5" stroke-width="2.6"/>'),
  cellStyles: svg('<rect x="3.5" y="4.5" width="7.5" height="6" rx="1"/><rect x="13" y="4.5" width="7.5" height="6" rx="1"/><rect x="3.5" y="13.5" width="7.5" height="6" rx="1"/><path d="M13 16.5h7.5" stroke-width="3"/>'),
  theme: svg('<path d="M12 3.5a8.5 8.5 0 100 17c1.2 0 1.8-.8 1.8-1.7 0-1.4-1.3-1.6-1.3-2.8 0-.9.7-1.5 1.6-1.5h2.2a3.7 3.7 0 003.7-3.7C20 6.8 16.4 3.5 12 3.5z"/><circle cx="7.8" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="7.8" r="1.1" fill="currentColor" stroke="none"/>'),
  clearFormat: svg('<path d="M8 20h11M5.5 14.5l8-8 5 5-8 8H8.5zM9.5 10.5l5 5"/>'),
  numFormat: svg('<path d="M10 4l-2 16M16 4l-2 16M4.5 9h15M4 15h15"/>'),
  decMore: svg('<circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/><rect x="8" y="11" width="4.5" height="8" rx="2.25"/><rect x="15" y="11" width="4.5" height="8" rx="2.25"/><path d="M12 5.5H4M6.5 3L4 5.5 6.5 8"/>'),
  decLess: svg('<circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/><rect x="8" y="11" width="4.5" height="8" rx="2.25"/><path d="M12 5.5h8M17.5 3L20 5.5 17.5 8"/>'),
  download: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>'),
  upload: svg('<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>'),
} as const;

export type IconName = keyof typeof icons;

export function icon(name: IconName): string {
  return `<span class="fc-icon">${icons[name]}</span>`;
}
