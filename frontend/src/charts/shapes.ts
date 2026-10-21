import type { Dash, ShapeSpec } from './types';

export interface Geo {
  d: string;
  detail?: string;
  evenodd?: boolean;
}

export interface ShapeDef {
  id: string;
  label: string;
  group: string;
  line?: boolean;
  draw: (w: number, h: number) => Geo;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function poly(pts: [number, number][]): string {
  return `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}Z`;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${r2(cx - rx)} ${r2(cy)}A${r2(rx)} ${r2(ry)} 0 1 0 ${r2(cx + rx)} ${r2(cy)}A${r2(rx)} ${r2(ry)} 0 1 0 ${r2(cx - rx)} ${r2(cy)}Z`;
}

function star(n: number, inner: number, w: number, h: number): Geo {
  const pts: [number, number][] = [];
  for (let k = 0; k < n * 2; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / n;
    const f = k % 2 ? inner : 1;
    pts.push([w / 2 + (w / 2) * f * Math.cos(a), h / 2 + (h / 2) * f * Math.sin(a)]);
  }
  return { d: poly(pts) };
}

function regular(n: number, w: number, h: number): Geo {
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / n;
    pts.push([w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)]);
  }
  return { d: poly(pts) };
}

function round(w: number, h: number, tl: number, tr: number, br: number, bl: number): string {
  return `M${tl} 0H${w - tr}${tr ? `A${tr} ${tr} 0 0 1 ${w} ${tr}` : ''}V${h - br}${br ? `A${br} ${br} 0 0 1 ${w - br} ${h}` : ''}H${bl}${bl ? `A${bl} ${bl} 0 0 1 0 ${h - bl}` : ''}V${tl}${tl ? `A${tl} ${tl} 0 0 1 ${tl} 0` : ''}Z`;
}

function wedgeEllipse(w: number, h: number): Geo {
  const cx = w / 2;
  const cy = h / 2;
  const tx = 0.2917 * w;
  const ty = 1.125 * h;
  const a = Math.atan2((ty - cy) / (h / 2), (tx - cx) / (w / 2));
  const p = (t: number) => `${r2(cx + (w / 2) * Math.cos(t))} ${r2(cy + (h / 2) * Math.sin(t))}`;
  return { d: `M${p(a - 0.28)}L${r2(tx)} ${r2(ty)}L${p(a + 0.28)}A${r2(w / 2)} ${r2(h / 2)} 0 1 1 ${p(a - 0.28)}Z` };
}

function cloud(w: number, h: number): string {
  const pts: [number, number][] = [[0.22, 0.85], [0.07, 0.62], [0.12, 0.33], [0.35, 0.15], [0.62, 0.12], [0.85, 0.3], [0.94, 0.58], [0.78, 0.85]];
  let d = `M${r2(pts[0][0] * w)} ${r2(pts[0][1] * h)}`;
  for (let k = 1; k <= pts.length; k++) {
    const [x, y] = pts[k % pts.length];
    const [px, py] = pts[k - 1];
    const dist = Math.hypot((x - px) * w, (y - py) * h);
    d += `A${r2(dist * 0.62)} ${r2(dist * 0.62)} 0 0 1 ${r2(x * w)} ${r2(y * h)}`;
  }
  return `${d}Z`;
}

function sun(w: number, h: number): Geo {
  let d = ellipse(w / 2, h / 2, w * 0.24, h * 0.24);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const b = 0.14;
    const at = (t: number, r: number) => `${r2(w / 2 + w * r * Math.cos(t))} ${r2(h / 2 + h * r * Math.sin(t))}`;
    d += `M${at(a - b, 0.3)}L${at(a, 0.5)}L${at(a + b, 0.3)}Z`;
  }
  return { d };
}

const RECT = (w: number, h: number) => `M0 0H${w}V${h}H0Z`;

function arrowRight(w: number, h: number): string {
  const ss = Math.min(w, h);
  const hl = ss * 0.5;
  return `M0 ${h * 0.25}H${w - hl}V0L${w} ${h / 2}L${w - hl} ${h}V${h * 0.75}H0Z`;
}

export const SHAPES: ShapeDef[] = [
  { id: 'line', label: 'Line', group: 'Lines', line: true, draw: (w, h) => ({ d: `M0 0L${w} ${h}` }) },
  { id: 'straightConnector1', label: 'Straight connector', group: 'Lines', line: true, draw: (w, h) => ({ d: `M0 0L${w} ${h}` }) },
  { id: 'bentConnector3', label: 'Elbow connector', group: 'Lines', line: true, draw: (w, h) => ({ d: `M0 0H${w / 2}V${h}H${w}` }) },
  { id: 'curvedConnector3', label: 'Curved connector', group: 'Lines', line: true, draw: (w, h) => ({ d: `M0 0C${w / 2} 0 ${w / 2} ${h} ${w} ${h}` }) },

  { id: 'rect', label: 'Rectangle', group: 'Rectangles', draw: (w, h) => ({ d: RECT(w, h) }) },
  { id: 'roundRect', label: 'Rounded rectangle', group: 'Rectangles', draw: (w, h) => ({ d: round(w, h, ...([1, 1, 1, 1].map(() => r2(Math.min(w, h) / 6)) as [number, number, number, number])) }) },
  { id: 'snip1Rect', label: 'Snip single corner rectangle', group: 'Rectangles', draw: (w, h) => { const s = Math.min(w, h) / 6; return { d: `M0 0H${w - s}L${w} ${s}V${h}H0Z` }; } },
  { id: 'snip2SameRect', label: 'Snip same side corner rectangle', group: 'Rectangles', draw: (w, h) => { const s = Math.min(w, h) / 6; return { d: `M${s} 0H${w - s}L${w} ${s}V${h}H0V${s}Z` }; } },
  { id: 'round1Rect', label: 'Round single corner rectangle', group: 'Rectangles', draw: (w, h) => ({ d: round(w, h, 0, r2(Math.min(w, h) / 6), 0, 0) }) },
  { id: 'round2SameRect', label: 'Round same side corner rectangle', group: 'Rectangles', draw: (w, h) => { const s = r2(Math.min(w, h) / 6); return { d: round(w, h, s, s, 0, 0) }; } },
  { id: 'plaque', label: 'Plaque', group: 'Rectangles', draw: (w, h) => { const s = Math.min(w, h) / 6; return { d: `M${s} 0H${w - s}A${s} ${s} 0 0 0 ${w} ${s}V${h - s}A${s} ${s} 0 0 0 ${w - s} ${h}H${s}A${s} ${s} 0 0 0 0 ${h - s}V${s}A${s} ${s} 0 0 0 ${s} 0Z` }; } },
  { id: 'bevel', label: 'Bevel', group: 'Rectangles', draw: (w, h) => { const s = Math.min(w, h) / 8; return { d: RECT(w, h), detail: `M${s} ${s}H${w - s}V${h - s}H${s}ZM0 0L${s} ${s}M${w} 0L${w - s} ${s}M${w} ${h}L${w - s} ${h - s}M0 ${h}L${s} ${h - s}` }; } },
  { id: 'frame', label: 'Frame', group: 'Rectangles', draw: (w, h) => { const t = Math.min(w, h) / 8; return { d: `${RECT(w, h)}M${t} ${t}V${h - t}H${w - t}V${t}Z`, evenodd: true }; } },
  { id: 'foldedCorner', label: 'Folded corner', group: 'Rectangles', draw: (w, h) => { const s = Math.min(w, h) / 6; return { d: `M0 0H${w}V${h - s}L${w - s} ${h}H0Z`, detail: `M${w - s} ${h}V${h - s}H${w}` }; } },

  { id: 'ellipse', label: 'Oval', group: 'Basic shapes', draw: (w, h) => ({ d: ellipse(w / 2, h / 2, w / 2, h / 2) }) },
  { id: 'triangle', label: 'Isosceles triangle', group: 'Basic shapes', draw: (w, h) => ({ d: poly([[w / 2, 0], [w, h], [0, h]]) }) },
  { id: 'rtTriangle', label: 'Right triangle', group: 'Basic shapes', draw: (w, h) => ({ d: poly([[0, 0], [0, h], [w, h]]) }) },
  { id: 'parallelogram', label: 'Parallelogram', group: 'Basic shapes', draw: (w, h) => { const o = Math.min(w, h) / 4; return { d: poly([[o, 0], [w, 0], [w - o, h], [0, h]]) }; } },
  { id: 'trapezoid', label: 'Trapezoid', group: 'Basic shapes', draw: (w, h) => { const o = Math.min(w, h) / 4; return { d: poly([[0, h], [o, 0], [w - o, 0], [w, h]]) }; } },
  { id: 'diamond', label: 'Diamond', group: 'Basic shapes', draw: (w, h) => ({ d: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) }) },
  { id: 'pentagon', label: 'Regular pentagon', group: 'Basic shapes', draw: (w, h) => regular(5, w, h) },
  { id: 'hexagon', label: 'Hexagon', group: 'Basic shapes', draw: (w, h) => { const x = Math.min(w, h) / 4; return { d: poly([[0, h / 2], [x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h]]) }; } },
  { id: 'heptagon', label: 'Heptagon', group: 'Basic shapes', draw: (w, h) => regular(7, w, h) },
  { id: 'octagon', label: 'Octagon', group: 'Basic shapes', draw: (w, h) => { const x = Math.min(w, h) * 0.2929; return { d: poly([[x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]]) }; } },
  { id: 'chevron', label: 'Chevron', group: 'Basic shapes', draw: (w, h) => { const x = Math.min(w, h) / 2; return { d: poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]]) }; } },
  { id: 'homePlate', label: 'Pentagon arrow', group: 'Basic shapes', draw: (w, h) => { const x = Math.min(w, h) / 2; return { d: poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h]]) }; } },
  { id: 'plus', label: 'Cross', group: 'Basic shapes', draw: (w, h) => { const t = Math.min(w, h) / 4; return { d: poly([[t, 0], [w - t, 0], [w - t, t], [w, t], [w, h - t], [w - t, h - t], [w - t, h], [t, h], [t, h - t], [0, h - t], [0, t], [t, t]]) }; } },
  { id: 'donut', label: 'Donut', group: 'Basic shapes', draw: (w, h) => { const t = Math.min(w, h) / 4; return { d: `${ellipse(w / 2, h / 2, w / 2, h / 2)}${ellipse(w / 2, h / 2, w / 2 - t, h / 2 - t)}`, evenodd: true }; } },
  { id: 'heart', label: 'Heart', group: 'Basic shapes', draw: (w, h) => ({ d: `M${w / 2} ${h}C${w / 2} ${h} 0 ${h * 0.62} 0 ${h * 0.3}C0 ${h * 0.1} ${w * 0.15} 0 ${w * 0.28} 0C${w * 0.4} 0 ${w / 2} ${h * 0.1} ${w / 2} ${h * 0.25}C${w / 2} ${h * 0.1} ${w * 0.6} 0 ${w * 0.72} 0C${w * 0.85} 0 ${w} ${h * 0.1} ${w} ${h * 0.3}C${w} ${h * 0.62} ${w / 2} ${h} ${w / 2} ${h}Z` }) },
  { id: 'smileyFace', label: 'Smiley face', group: 'Basic shapes', draw: (w, h) => ({ d: ellipse(w / 2, h / 2, w / 2, h / 2), detail: `${ellipse(w * 0.33, h * 0.38, w * 0.04, h * 0.06)}${ellipse(w * 0.67, h * 0.38, w * 0.04, h * 0.06)}M${w * 0.25} ${h * 0.62}Q${w / 2} ${h * 0.88} ${w * 0.75} ${h * 0.62}` }) },
  { id: 'sun', label: 'Sun', group: 'Basic shapes', draw: sun },
  { id: 'moon', label: 'Moon', group: 'Basic shapes', draw: (w, h) => ({ d: `M${w * 0.6} 0A${w * 0.6} ${h / 2} 0 0 0 ${w * 0.6} ${h}A${w * 0.35} ${h * 0.4} 0 0 1 ${w * 0.6} 0Z` }) },
  { id: 'cloud', label: 'Cloud', group: 'Basic shapes', draw: (w, h) => ({ d: cloud(w, h) }) },
  { id: 'lightningBolt', label: 'Lightning bolt', group: 'Basic shapes', draw: (w, h) => ({ d: poly([[w * 0.38, 0], [w * 0.12, h * 0.45], [w * 0.38, h * 0.45], [w * 0.2, h], [w * 0.7, h * 0.5], [w * 0.45, h * 0.5], [w * 0.8, 0]]) }) },
  { id: 'cube', label: 'Cube', group: 'Basic shapes', draw: (w, h) => ({ d: poly([[0, h * 0.25], [w * 0.25, 0], [w, 0], [w, h * 0.75], [w * 0.75, h], [0, h]]), detail: `M0 ${h * 0.25}H${w * 0.75}V${h}M${w * 0.75} ${h * 0.25}L${w} 0` }) },
  { id: 'can', label: 'Can', group: 'Basic shapes', draw: (w, h) => ({ d: `M0 ${h * 0.15}A${w / 2} ${h * 0.15} 0 0 1 ${w} ${h * 0.15}V${h * 0.85}A${w / 2} ${h * 0.15} 0 0 1 0 ${h * 0.85}Z`, detail: `M0 ${h * 0.15}A${w / 2} ${h * 0.15} 0 0 0 ${w} ${h * 0.15}` }) },

  { id: 'rightArrow', label: 'Right arrow', group: 'Block arrows', draw: (w, h) => ({ d: arrowRight(w, h) }) },
  { id: 'leftArrow', label: 'Left arrow', group: 'Block arrows', draw: (w, h) => { const hl = Math.min(w, h) / 2; return { d: `M${w} ${h * 0.25}H${hl}V0L0 ${h / 2}L${hl} ${h}V${h * 0.75}H${w}Z` }; } },
  { id: 'upArrow', label: 'Up arrow', group: 'Block arrows', draw: (w, h) => { const hl = Math.min(w, h) / 2; return { d: `M${w * 0.25} ${h}V${hl}H0L${w / 2} 0L${w} ${hl}H${w * 0.75}V${h}Z` }; } },
  { id: 'downArrow', label: 'Down arrow', group: 'Block arrows', draw: (w, h) => { const hl = Math.min(w, h) / 2; return { d: `M${w * 0.25} 0H${w * 0.75}V${h - hl}H${w}L${w / 2} ${h}L0 ${h - hl}H${w * 0.25}Z` }; } },
  { id: 'leftRightArrow', label: 'Left-right arrow', group: 'Block arrows', draw: (w, h) => { const hl = Math.min(w, h) / 2; return { d: `M0 ${h / 2}L${hl} 0V${h * 0.25}H${w - hl}V0L${w} ${h / 2}L${w - hl} ${h}V${h * 0.75}H${hl}V${h}Z` }; } },
  { id: 'upDownArrow', label: 'Up-down arrow', group: 'Block arrows', draw: (w, h) => { const hl = Math.min(w, h) / 2; return { d: `M${w / 2} 0L${w} ${hl}H${w * 0.75}V${h - hl}H${w}L${w / 2} ${h}L0 ${h - hl}H${w * 0.25}V${hl}H0Z` }; } },
  { id: 'bentArrow', label: 'Bent arrow', group: 'Block arrows', draw: (w, h) => { const s = Math.min(w, h) / 4; const hd = s; const hl = s * 1.2; const H = 2 * hd + s; return { d: `M0 ${h}V${hd}H${w - hl}V0L${w} ${H / 2}L${w - hl} ${H}V${hd + s}H${s}V${h}Z` }; } },
  { id: 'notchedRightArrow', label: 'Notched right arrow', group: 'Block arrows', draw: (w, h) => { const hl = Math.min(w, h) / 2; return { d: `M0 ${h * 0.25}H${w - hl}V0L${w} ${h / 2}L${w - hl} ${h}V${h * 0.75}H0L${h * 0.25} ${h / 2}Z` }; } },
  { id: 'stripedRightArrow', label: 'Striped right arrow', group: 'Block arrows', draw: (w, h) => { const hl = Math.min(w, h) / 2; return { d: `M0 ${h * 0.25}H${w * 0.05}V${h * 0.75}H0ZM${w * 0.1} ${h * 0.25}H${w * 0.17}V${h * 0.75}H${w * 0.1}ZM${w * 0.23} ${h * 0.25}H${w - hl}V0L${w} ${h / 2}L${w - hl} ${h}V${h * 0.75}H${w * 0.23}Z` }; } },
  { id: 'rightArrowCallout', label: 'Right arrow callout', group: 'Block arrows', draw: (w, h) => { const hl = Math.min(w, h) / 3; return { d: `M0 0H${w * 0.5}V${h * 0.3}H${w - hl}V${h * 0.12}L${w} ${h / 2}L${w - hl} ${h * 0.88}V${h * 0.7}H${w * 0.5}V${h}H0Z` }; } },
  { id: 'quadArrow', label: 'Four-way arrow', group: 'Block arrows', draw: (w, h) => { const ss = Math.min(w, h); const t = ss * 0.1; const hl = ss * 0.2; const hw = ss * 0.2; const cx = w / 2; const cy = h / 2; return { d: `M${cx} 0L${cx + hw} ${hl}H${cx + t}V${cy - t}H${w - hl}V${cy - hw}L${w} ${cy}L${w - hl} ${cy + hw}V${cy + t}H${cx + t}V${h - hl}H${cx + hw}L${cx} ${h}L${cx - hw} ${h - hl}H${cx - t}V${cy + t}H${hl}V${cy + hw}L0 ${cy}L${hl} ${cy - hw}V${cy - t}H${cx - t}V${hl}H${cx - hw}Z` }; } },

  { id: 'star4', label: '4-point star', group: 'Stars and banners', draw: (w, h) => star(4, 0.38, w, h) },
  { id: 'star5', label: '5-point star', group: 'Stars and banners', draw: (w, h) => star(5, 0.382, w, h) },
  { id: 'star6', label: '6-point star', group: 'Stars and banners', draw: (w, h) => star(6, 0.577, w, h) },
  { id: 'star7', label: '7-point star', group: 'Stars and banners', draw: (w, h) => star(7, 0.54, w, h) },
  { id: 'star8', label: '8-point star', group: 'Stars and banners', draw: (w, h) => star(8, 0.7, w, h) },
  { id: 'star10', label: '10-point star', group: 'Stars and banners', draw: (w, h) => star(10, 0.75, w, h) },
  { id: 'star12', label: '12-point star', group: 'Stars and banners', draw: (w, h) => star(12, 0.8, w, h) },
  { id: 'star16', label: '16-point star', group: 'Stars and banners', draw: (w, h) => star(16, 0.85, w, h) },
  { id: 'star24', label: '24-point star', group: 'Stars and banners', draw: (w, h) => star(24, 0.88, w, h) },
  { id: 'star32', label: '32-point star', group: 'Stars and banners', draw: (w, h) => star(32, 0.9, w, h) },
  { id: 'irregularSeal1', label: 'Explosion', group: 'Stars and banners', draw: (w, h) => ({ d: poly([[0.1, 0.25], [0.2, 0.4], [0.02, 0.5], [0.2, 0.6], [0.08, 0.8], [0.3, 0.72], [0.35, 0.95], [0.5, 0.78], [0.62, 1], [0.7, 0.72], [0.9, 0.85], [0.82, 0.6], [1, 0.5], [0.82, 0.4], [0.95, 0.2], [0.72, 0.28], [0.65, 0.02], [0.5, 0.2], [0.38, 0.05], [0.3, 0.28]].map(([x, y]) => [x * w, y * h] as [number, number])) }) },
  { id: 'wave', label: 'Wave', group: 'Stars and banners', draw: (w, h) => ({ d: `M0 ${h * 0.1}C${w * 0.17} ${-h * 0.05} ${w * 0.33} ${h * 0.25} ${w / 2} ${h * 0.1}C${w * 0.67} ${-h * 0.05} ${w * 0.83} ${h * 0.25} ${w} ${h * 0.1}V${h * 0.9}C${w * 0.83} ${h * 1.05} ${w * 0.67} ${h * 0.75} ${w / 2} ${h * 0.9}C${w * 0.33} ${h * 1.05} ${w * 0.17} ${h * 0.75} 0 ${h * 0.9}Z` }) },

  { id: 'wedgeRectCallout', label: 'Rectangular callout', group: 'Callouts', draw: (w, h) => ({ d: `M0 0H${w}V${h}H${w * 0.4167}L${w * 0.2917} ${h * 1.125}L${w * 0.1667} ${h}H0Z` }) },
  { id: 'wedgeRoundRectCallout', label: 'Rounded rectangular callout', group: 'Callouts', draw: (w, h) => { const r = r2(Math.min(w, h) / 6); return { d: `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${w * 0.4167}L${w * 0.2917} ${h * 1.125}L${w * 0.1667} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z` }; } },
  { id: 'wedgeEllipseCallout', label: 'Oval callout', group: 'Callouts', draw: wedgeEllipse },
  { id: 'cloudCallout', label: 'Cloud callout', group: 'Callouts', draw: (w, h) => ({ d: `${cloud(w, h)}${ellipse(w * 0.12, h * 1.05, w * 0.05, h * 0.06)}${ellipse(w * 0.04, h * 1.18, w * 0.025, h * 0.035)}` }) },
  { id: 'borderCallout1', label: 'Line callout', group: 'Callouts', draw: (w, h) => ({ d: RECT(w, h), detail: `M0 ${h * 0.1875}L${-w * 0.0833} ${h * 1.125}` }) },

  { id: 'flowChartProcess', label: 'Process', group: 'Flowchart', draw: (w, h) => ({ d: RECT(w, h) }) },
  { id: 'flowChartAlternateProcess', label: 'Alternate process', group: 'Flowchart', draw: (w, h) => { const s = r2(Math.min(w, h) / 6); return { d: round(w, h, s, s, s, s) }; } },
  { id: 'flowChartDecision', label: 'Decision', group: 'Flowchart', draw: (w, h) => ({ d: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) }) },
  { id: 'flowChartInputOutput', label: 'Data', group: 'Flowchart', draw: (w, h) => ({ d: poly([[w * 0.2, 0], [w, 0], [w * 0.8, h], [0, h]]) }) },
  { id: 'flowChartPredefinedProcess', label: 'Predefined process', group: 'Flowchart', draw: (w, h) => ({ d: RECT(w, h), detail: `M${w * 0.125} 0V${h}M${w * 0.875} 0V${h}` }) },
  { id: 'flowChartDocument', label: 'Document', group: 'Flowchart', draw: (w, h) => ({ d: `M0 0H${w}V${h * 0.8}C${w * 0.67} ${h * 0.6} ${w * 0.33} ${h * 1.0} 0 ${h * 0.82}Z` }) },
  { id: 'flowChartMultidocument', label: 'Multidocument', group: 'Flowchart', draw: (w, h) => ({ d: `M0 ${h * 0.12}H${w * 0.85}V${h * 0.85}C${w * 0.57} ${h * 0.72} ${w * 0.28} ${h * 1.0} 0 ${h * 0.88}Z`, detail: `M${w * 0.08} ${h * 0.12}V${h * 0.06}H${w * 0.93}V${h * 0.75}H${w * 0.85}M${w * 0.15} ${h * 0.06}V0H${w}V${h * 0.65}H${w * 0.93}` }) },
  { id: 'flowChartTerminator', label: 'Terminator', group: 'Flowchart', draw: (w, h) => ({ d: `M${h / 2} 0H${w - h / 2}A${h / 2} ${h / 2} 0 0 1 ${w - h / 2} ${h}H${h / 2}A${h / 2} ${h / 2} 0 0 1 ${h / 2} 0Z` }) },
  { id: 'flowChartPreparation', label: 'Preparation', group: 'Flowchart', draw: (w, h) => ({ d: poly([[0, h / 2], [w * 0.2, 0], [w * 0.8, 0], [w, h / 2], [w * 0.8, h], [w * 0.2, h]]) }) },
  { id: 'flowChartManualInput', label: 'Manual input', group: 'Flowchart', draw: (w, h) => ({ d: poly([[0, h * 0.2], [w, 0], [w, h], [0, h]]) }) },
  { id: 'flowChartManualOperation', label: 'Manual operation', group: 'Flowchart', draw: (w, h) => ({ d: poly([[0, 0], [w, 0], [w * 0.8, h], [w * 0.2, h]]) }) },
  { id: 'flowChartConnector', label: 'Connector', group: 'Flowchart', draw: (w, h) => ({ d: ellipse(w / 2, h / 2, w / 2, h / 2) }) },
  { id: 'flowChartOffpageConnector', label: 'Off-page connector', group: 'Flowchart', draw: (w, h) => ({ d: poly([[0, 0], [w, 0], [w, h * 0.8], [w / 2, h], [0, h * 0.8]]) }) },
  { id: 'flowChartDelay', label: 'Delay', group: 'Flowchart', draw: (w, h) => ({ d: `M0 0H${w / 2}A${w / 2} ${h / 2} 0 0 1 ${w / 2} ${h}H0Z` }) },
  { id: 'flowChartDisplay', label: 'Display', group: 'Flowchart', draw: (w, h) => ({ d: `M0 ${h / 2}L${w * 0.15} 0H${w * 0.85}A${w * 0.15} ${h / 2} 0 0 1 ${w * 0.85} ${h}H${w * 0.15}Z` }) },
  { id: 'flowChartMagneticDisk', label: 'Stored data', group: 'Flowchart', draw: (w, h) => ({ d: `M0 ${h * 0.125}A${w / 2} ${h * 0.125} 0 0 1 ${w} ${h * 0.125}V${h * 0.875}A${w / 2} ${h * 0.125} 0 0 1 0 ${h * 0.875}Z`, detail: `M0 ${h * 0.125}A${w / 2} ${h * 0.125} 0 0 0 ${w} ${h * 0.125}` }) },
  { id: 'flowChartSort', label: 'Sort', group: 'Flowchart', draw: (w, h) => ({ d: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), detail: `M0 ${h / 2}H${w}` }) },
  { id: 'flowChartMerge', label: 'Merge', group: 'Flowchart', draw: (w, h) => ({ d: poly([[0, 0], [w, 0], [w / 2, h]]) }) },
  { id: 'flowChartExtract', label: 'Extract', group: 'Flowchart', draw: (w, h) => ({ d: poly([[w / 2, 0], [w, h], [0, h]]) }) },
  { id: 'flowChartSummingJunction', label: 'Summing junction', group: 'Flowchart', draw: (w, h) => ({ d: ellipse(w / 2, h / 2, w / 2, h / 2), detail: `M${w * 0.15} ${h * 0.15}L${w * 0.85} ${h * 0.85}M${w * 0.85} ${h * 0.15}L${w * 0.15} ${h * 0.85}` }) },
  { id: 'flowChartOr', label: 'Or', group: 'Flowchart', draw: (w, h) => ({ d: ellipse(w / 2, h / 2, w / 2, h / 2), detail: `M${w / 2} 0V${h}M0 ${h / 2}H${w}` }) },
  { id: 'flowChartCollate', label: 'Collate', group: 'Flowchart', draw: (w, h) => ({ d: poly([[0, 0], [w, 0], [0, h], [w, h]]) }) },
  { id: 'flowChartInternalStorage', label: 'Internal storage', group: 'Flowchart', draw: (w, h) => ({ d: RECT(w, h), detail: `M${w * 0.125} 0V${h}M0 ${h * 0.125}H${w}` }) },
  { id: 'flowChartPunchedCard', label: 'Card', group: 'Flowchart', draw: (w, h) => ({ d: poly([[w * 0.2, 0], [w, 0], [w, h], [0, h], [0, h * 0.2]]) }) },
];

export const SHAPE_GROUPS = ['Lines', 'Rectangles', 'Basic shapes', 'Block arrows', 'Stars and banners', 'Callouts', 'Flowchart'];

const BY_ID = new Map(SHAPES.map((s) => [s.id, s]));

const LEGACY: Record<string, string> = { arrow: 'rightArrow' };

export function canon(id: string): string {
  return LEGACY[id] ?? id;
}

export function shapeDef(id: string): ShapeDef {
  return BY_ID.get(canon(id)) ?? BY_ID.get('rect')!;
}

export function isLine(id: string): boolean {
  return !!BY_ID.get(canon(id))?.line;
}

export interface Variant {
  key: string;
  label: string;
  group: string;
  spec: Partial<ShapeSpec>;
  w: number;
  h: number;
}

export function gallery(): Variant[] {
  const out: Variant[] = [];
  for (const s of SHAPES) {
    const base: Variant = { key: s.id, label: s.label, group: s.group, spec: { shape: s.id }, w: 140, h: 90 };
    if (s.line) {
      base.h = 60;
      if (s.id === 'straightConnector1') {
        out.push({ ...base, key: 'arrowLine', label: 'Line arrow', spec: { shape: s.id, tail: true } });
        out.push({ ...base, key: 'arrowLine2', label: 'Double arrow', spec: { shape: s.id, head: true, tail: true } });
        continue;
      }
      if (s.id === 'bentConnector3') {
        out.push(base, { ...base, key: 'elbowArrow', label: 'Elbow arrow connector', spec: { shape: s.id, tail: true } });
        continue;
      }
    }
    if (/Arrow$|Arrow Callout|quadArrow|bentArrow/.test(s.id)) {
      base.w = s.id.startsWith('up') || s.id.startsWith('down') || s.id === 'upDownArrow' ? 80 : 160;
      base.h = s.id.startsWith('up') || s.id.startsWith('down') || s.id === 'upDownArrow' ? 140 : 80;
    }
    if (s.id === 'ellipse' || s.id.startsWith('star') || ['heart', 'smileyFace', 'sun', 'moon', 'donut', 'plus', 'pentagon', 'heptagon', 'octagon', 'flowChartConnector', 'flowChartOr', 'flowChartSummingJunction'].includes(s.id)) {
      base.w = 100;
      base.h = 100;
    }
    out.push(base);
  }
  return out;
}

const DASH_ARRAYS: Record<Dash, number[]> = {
  solid: [],
  dot: [1, 2],
  dash: [4, 3],
  lgDash: [8, 3],
  dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

export const DASH_LABELS: [Dash, string][] = [
  ['solid', 'Solid'], ['sysDot', 'Round dot'], ['sysDash', 'Square dot'], ['dash', 'Dash'], ['dashDot', 'Dash dot'], ['lgDash', 'Long dash'], ['lgDashDot', 'Long dash dot'], ['lgDashDotDot', 'Long dash dot dot'],
];

export function dashArray(dash: Dash | undefined, lw: number): string {
  const a = DASH_ARRAYS[dash ?? 'solid'] ?? [];
  return a.length ? a.map((n) => r2(Math.max(1, n * Math.max(1, lw)))).join(' ') : '';
}

export function pt(n: number | undefined, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export function contrast(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#000000';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#ffffff';
}

let markerSeq = 0;

export function shapeSvg(spec: ShapeSpec, w: number, h: number): string {
  const def = shapeDef(spec.shape);
  const geo = def.draw(Math.max(1, w), Math.max(1, h));
  const lw = Math.max(0, pt(spec.lw, 1)) * (96 / 72);
  const stroke = spec.noLine ? 'none' : spec.stroke || '#2f4b6e';
  const dash = dashArray(spec.dash, lw);
  const fill = def.line || spec.noFill ? 'none' : spec.fill || '#4e79a7';
  const op = typeof spec.opacity === 'number' && spec.opacity < 1 ? ` fill-opacity="${spec.opacity}"` : '';
  const sw = stroke === 'none' ? '' : ` stroke="${stroke}" stroke-width="${r2(lw)}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round"`;
  let defs = '';
  let marks = '';
  if (def.line && stroke !== 'none') {
    const id = `fcm${markerSeq++}`;
    const mk = (suffix: string, orient: string) => `<marker id="${id}${suffix}" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="strokeWidth" markerWidth="4" markerHeight="4" orient="${orient}"><path d="M0 0L10 5L0 10Z" fill="${stroke}" stroke="none"/></marker>`;
    if (spec.tail) {
      defs += mk('t', 'auto');
      marks += ` marker-end="url(#${id}t)"`;
    }
    if (spec.head) {
      defs += mk('h', 'auto-start-reverse');
      marks += ` marker-start="url(#${id}h)"`;
    }
  }
  const main = `<path d="${geo.d}" fill="${fill}"${op}${geo.evenodd ? ' fill-rule="evenodd"' : ''}${sw}${marks}/>`;
  const detail = geo.detail ? `<path d="${geo.detail}" fill="none"${sw}/>` : '';
  const flip = `${spec.flipH ? `translate(${w} 0) scale(-1 1)` : ''}${spec.flipV ? ` translate(0 ${h}) scale(1 -1)` : ''}`.trim();
  return `<svg viewBox="0 0 ${r2(w)} ${r2(h)}" width="100%" height="100%" preserveAspectRatio="none" style="overflow:visible">${defs ? `<defs>${defs}</defs>` : ''}<g${flip ? ` transform="${flip}"` : ''}>${main}${detail}</g></svg>`;
}

export function thumb(v: Variant): string {
  const spec: ShapeSpec = { shape: v.spec.shape ?? 'rect', fill: 'currentColor', stroke: 'currentColor', text: '', lw: 0.75, ...v.spec };
  const line = isLine(spec.shape);
  const w = 34;
  const h = 24;
  const k = Math.min((w - 6) / v.w, (h - 6) / v.h);
  const sw = Math.max(8, v.w * k);
  const sh = Math.max(8, v.h * k);
  const svg = shapeSvg({ ...spec, fill: line ? 'none' : 'currentColor', stroke: 'currentColor' }, sw, sh);
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><g transform="translate(${(w - sw) / 2} ${(h - sh) / 2})"><svg width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}" style="overflow:visible">${svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg></g></svg>`;
}
