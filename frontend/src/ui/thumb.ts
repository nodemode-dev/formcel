const NUMERIC = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

export function drawThumb(c: HTMLCanvasElement, grid: string[][]): void {
  const sig = JSON.stringify(grid);
  if (c.dataset.sig === sig) return;
  c.dataset.sig = sig;
  const dpr = window.devicePixelRatio || 1;
  const w = 240;
  const h = 120;
  c.width = w * dpr;
  c.height = h * dpr;
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  g.fillStyle = v('--cell-bg') || '#1c1b1d';
  g.fillRect(0, 0, w, h);
  const rows = 8;
  const cols = 6;
  const rh = h / rows;
  const cw = w / cols;
  g.strokeStyle = v('--border-color') || '#2a2a2a';
  g.lineWidth = 1;
  g.beginPath();
  for (let r = 1; r < rows; r++) { g.moveTo(0, Math.round(r * rh) + 0.5); g.lineTo(w, Math.round(r * rh) + 0.5); }
  for (let k = 1; k < cols; k++) { g.moveTo(Math.round(k * cw) + 0.5, 0); g.lineTo(Math.round(k * cw) + 0.5, h); }
  g.stroke();
  g.font = '9px Inter, system-ui, sans-serif';
  g.textBaseline = 'middle';
  grid.slice(0, rows).forEach((row, r) => row.slice(0, cols).forEach((t, k) => {
    if (!t) return;
    g.save();
    g.beginPath();
    g.rect(k * cw + 1, r * rh, cw - 2, rh);
    g.clip();
    g.fillStyle = r === 0 ? v('--text-primary') : v('--text-secondary');
    const num = NUMERIC.test(t);
    g.textAlign = num ? 'right' : 'left';
    g.fillText(t, num ? (k + 1) * cw - 3 : k * cw + 3, r * rh + rh / 2);
    g.restore();
  }));
}
