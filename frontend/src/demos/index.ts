import { registerCommand } from '../ui/commands';

export type DemoId = 'sales' | 'whatif' | 'lab';

export interface DemoDef {
  id: DemoId;
  title: string;
  blurb: string;
  cover: () => string;
}

const W = 320;
const H = 180;

function frame(body: string): string {
  let grid = '';
  for (let x = 20; x < W; x += 40) grid += `M${x} 0V${H}`;
  for (let y = 18; y < H; y += 18) grid += `M0 ${y}H${W}`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect class="d-bg" width="${W}" height="${H}"/><path class="d-grid" d="${grid}"/>${body}</svg>`;
}

function salesCover(): string {
  const season = [0.55, 0.6, 0.85, 1.05, 1.25, 1.35, 1.4, 1.3, 1.05, 0.85, 0.7, 0.95];
  const share = [0.24, 0.19, 0.31, 0.26];
  const tone = ['d-a', 'd-b', 'd-c', 'd-d'];
  let bars = '';
  let line = '';
  season.forEach((s, m) => {
    const x = 28 + m * 22;
    let y = 164;
    share.forEach((p, k) => {
      const h = Math.round(s * p * 92);
      y -= h;
      bars += `<rect class="${tone[k]}" x="${x}" y="${y}" width="14" height="${h}" rx="1.5"/>`;
    });
    line += `${m ? 'L' : 'M'}${x + 7} ${Math.round(150 - s * 78)}`;
  });
  const tiles = [0, 1, 2, 3].map((k) => `<rect class="d-tile" x="${20 + k * 72}" y="12" width="64" height="30" rx="4"/><rect class="d-ink" x="${27 + k * 72}" y="19" width="${22 + (k % 2) * 10}" height="4" rx="2"/><rect class="d-hi" x="${27 + k * 72}" y="28" width="${34 - (k % 3) * 6}" height="7" rx="2"/>`).join('');
  return frame(`${tiles}${bars}<path class="d-line" d="${line}"/>`);
}

function whatifCover(): string {
  const n = 25;
  let area = 'M40 150';
  let bars = '';
  for (let y = 0; y <= n; y++) {
    const left = 1 - (Math.pow(1.05, y) - 1) / (Math.pow(1.05, n) - 1);
    const x = 40 + y * 10.4;
    area += `L${x.toFixed(1)} ${(150 - left * 56).toFixed(1)}`;
    if (y < n) {
      const h = Math.max(2, left * 34);
      bars += `<rect class="d-b" x="${(x + 2).toFixed(1)}" y="${(150 - h).toFixed(1)}" width="6" height="${h.toFixed(1)}" rx="1"/>`;
    }
  }
  area += 'L300 150Z';
  const cells = [0, 1, 2, 3].map((k) => `<rect class="d-tile" x="20" y="${18 + k * 18}" width="70" height="14" rx="2"/><rect class="d-in" x="94" y="${18 + k * 18}" width="44" height="14" rx="2"/>`).join('');
  return frame(`<path class="d-area" d="${area}"/>${bars}${cells}<rect class="d-hi" x="152" y="22" width="64" height="20" rx="4"/><rect class="d-ink" x="160" y="29" width="48" height="6" rx="3"/>`);
}

function labCover(): string {
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  let dots = '';
  for (let i = 0; i < 70; i++) {
    const t = rnd();
    const x = 120 + t * 180;
    const y = 150 - t * 110 + (rnd() + rnd() + rnd() - 1.5) * 18;
    dots += `<circle class="d-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6"/>`;
  }
  const odd = [[170, 70], [252, 128], [205, 140]].map(([x, y]) => `<circle class="d-odd" cx="${x}" cy="${y}" r="3.6"/>`).join('');
  const hist = [6, 12, 22, 34, 44, 38, 26, 14, 7].map((h, k) => `<rect class="d-c" x="${20 + k * 10}" y="${160 - h * 1.6}" width="8" height="${h * 1.6}" rx="1"/>`).join('');
  return frame(`${hist}<path class="d-line" d="M116 154L304 36"/>${dots}${odd}<rect class="d-tile" x="20" y="14" width="86" height="40" rx="4"/><rect class="d-ink" x="28" y="22" width="52" height="5" rx="2.5"/><rect class="d-hi" x="28" y="33" width="40" height="8" rx="2"/>`);
}

export const DEMOS: DemoDef[] = [
  { id: 'sales', title: 'A year of bike sales', blurb: '1,200 orders, a dashboard, a PivotTable, sparklines and charts.', cover: salesCover },
  { id: 'whatif', title: 'Loan and savings what-if', blurb: 'Named inputs, LAMBDA, a data table, scenarios and a schedule.', cover: whatifCover },
  { id: 'lab', title: 'Lab measurements', blurb: 'A messy export cleaned, then statistics, a trendline and outliers.', cover: labCover },
];

export const demoTemplate = (id: DemoId): string => `demo-${id}`;

export function registerDemoCommands(open: (id: DemoId) => void): void {
  for (const d of DEMOS) {
    registerCommand({ id: `demo-${d.id}`, title: `${d.title} (demo)`, description: `Open the ${d.title} demo as a new workbook. Nothing of yours is changed.`, changes: false, run: () => open(d.id) });
  }
}
