const CELLS: [number, number, string][] = [
  [1, 0, '#F07090'], [2, 0, '#FD7F81'],
  [1, 1, '#D077D1'], [2, 1, '#F9719D'],
  [0, 2, '#8C84FF'], [1, 2, '#B77CF7'],
  [0, 3, '#748DFF'],
];

function cells(): string {
  const at = (i: number): number => 15.5 + i * 8.8;
  let out = '';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out += `<rect x="${at(c)}" y="${at(r) + 1.5}" width="7.4" height="7.4" rx="1.4" fill="#1A1A20"/>`;
  for (const [c, r, fill] of CELLS) out += `<rect x="${at(c)}" y="${at(r) + 1.5}" width="7.4" height="7.4" rx="1.4" fill="${fill}"/>`;
  return out;
}

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="{p}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2B2837"/><stop offset="1" stop-color="#121318"/></linearGradient><linearGradient id="{p}sel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FD9A6E"/><stop offset="1" stop-color="#F9733F"/></linearGradient></defs><rect width="64" height="64" rx="14.4" fill="url(#{p}bg)"/><rect x="12" y="14" width="40" height="39" rx="3.2" fill="#24232B" stroke="#fff" stroke-opacity=".08" stroke-width=".6"/>${cells()}<rect x="41.4" y="25.3" width="8.4" height="8.4" rx="1.6" fill="url(#{p}sel)" stroke="#fff" stroke-width="1.1"/><path d="M47 31.2l7.2 3.4-3.1 1 2.2 3.4-1.6 1-2.2-3.4-2.4 2.2z" fill="#fff" stroke="#121318" stroke-width=".6" stroke-linejoin="round"/><rect x=".4" y=".4" width="63.2" height="63.2" rx="14" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width=".8"/></svg>`;

let copies = 0;

export function brandMark(size: number, label = 'formcel'): string {
  const p = `fc-mark${++copies}-`;
  return MARK.replace(/\{p\}/g, p).replace('<svg ', `<svg class="fc-mark" width="${size}" height="${size}" role="img" aria-label="${label}" `);
}
