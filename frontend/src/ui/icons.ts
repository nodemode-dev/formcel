const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  sheet: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9 4.5v15"/>'),
  grid: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9.17h17M3.5 14.83h17M9.17 3.5v17M14.83 3.5v17"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
} as const;

export type IconName = keyof typeof icons;

export function icon(name: IconName): string {
  return `<span class="fc-icon">${icons[name]}</span>`;
}
