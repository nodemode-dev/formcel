export type ChartType =
  | 'column' | 'column-stacked' | 'column-100' | 'bar' | 'bar-stacked' | 'bar-100' | 'line' | 'area' | 'area-stacked' | 'area-100' | 'pie' | 'doughnut'
  | 'scatter' | 'bubble' | 'combo' | 'histogram' | 'box' | 'waterfall' | 'candlestick'
  | 'treemap' | 'sunburst' | 'funnel' | 'gauge' | 'scorecard' | 'radar' | 'timeline' | 'org' | 'map';

export const CHART_TYPES: { id: ChartType; label: string; group: string }[] = [
  { id: 'column', label: 'Column', group: 'Column and bar' },
  { id: 'column-stacked', label: 'Stacked column', group: 'Column and bar' },
  { id: 'column-100', label: '100% stacked column', group: 'Column and bar' },
  { id: 'bar', label: 'Bar', group: 'Column and bar' },
  { id: 'bar-stacked', label: 'Stacked bar', group: 'Column and bar' },
  { id: 'bar-100', label: '100% stacked bar', group: 'Column and bar' },
  { id: 'line', label: 'Line', group: 'Line and area' },
  { id: 'area', label: 'Area', group: 'Line and area' },
  { id: 'area-stacked', label: 'Stacked area', group: 'Line and area' },
  { id: 'area-100', label: '100% stacked area', group: 'Line and area' },
  { id: 'pie', label: 'Pie', group: 'Pie' },
  { id: 'doughnut', label: 'Doughnut', group: 'Pie' },
  { id: 'scatter', label: 'Scatter', group: 'Scatter' },
  { id: 'bubble', label: 'Bubble', group: 'Scatter' },
  { id: 'combo', label: 'Combo with secondary axis', group: 'Combo' },
  { id: 'histogram', label: 'Histogram', group: 'Statistical' },
  { id: 'box', label: 'Box and whisker', group: 'Statistical' },
  { id: 'waterfall', label: 'Waterfall', group: 'Other' },
  { id: 'candlestick', label: 'Candlestick (open, high, low, close)', group: 'Other' },
  { id: 'treemap', label: 'Treemap', group: 'Hierarchy' },
  { id: 'sunburst', label: 'Sunburst', group: 'Hierarchy' },
  { id: 'funnel', label: 'Funnel', group: 'Other' },
  { id: 'gauge', label: 'Gauge', group: 'Other' },
  { id: 'scorecard', label: 'Scorecard', group: 'Other' },
  { id: 'radar', label: 'Radar', group: 'Other' },
  { id: 'timeline', label: 'Timeline', group: 'Other' },
  { id: 'org', label: 'Org chart', group: 'Hierarchy' },
  { id: 'map', label: 'Filled map (countries)', group: 'Other' },
];

export type TrendKind = 'linear' | 'exp' | 'log' | 'poly' | 'power' | 'mavg';

export const TREND_KINDS: [TrendKind, string][] = [
  ['linear', 'Linear'], ['exp', 'Exponential'], ['log', 'Logarithmic'], ['poly', 'Polynomial'], ['power', 'Power'], ['mavg', 'Moving average'],
];

export interface Trend {
  series: number;
  kind: TrendKind;
  order?: number;
  period?: number;
  eq?: boolean;
  r2?: boolean;
}

export type ErrKind = 'fixed' | 'percent' | 'stdev' | 'sterr';

export const ERR_KINDS: [ErrKind, string][] = [
  ['fixed', 'Fixed value'], ['percent', 'Percentage'], ['stdev', 'Standard deviation'], ['sterr', 'Standard error'],
];

export interface ErrBars {
  series: number;
  kind: ErrKind;
  value: number;
  dir: 'both' | 'plus' | 'minus';
}

export type Legend = 'right' | 'bottom' | 'top' | 'left' | 'none';

export interface ChartSpec {
  type: ChartType;
  range: string;
  byRows: boolean;
  title: string;
  xTitle: string;
  yTitle: string;
  legend: Legend;
  labels: boolean;
  secondary: number[];
  max?: number;
  min?: number;
  colors?: string[];
  xFmt?: string;
  yFmt?: string;
  labelFmt?: string;
  logY?: boolean;
  grid?: boolean;
  xGrid?: boolean;
  fill?: string;
  plotFill?: string;
  trends?: Trend[];
  errBars?: ErrBars[];
  pivot?: string;
  bins?: number;
  totals?: number[];
  bands?: [number, number];
}

export type ObjectKind = 'chart' | 'picture' | 'shape' | 'text' | 'spark' | 'range';

export function isFloat(o: { kind: ObjectKind; inCell?: boolean }): boolean {
  return o.kind !== 'spark' && o.kind !== 'range' && !o.inCell;
}

export interface Anchor {
  r0: number;
  c0: number;
  dy0: number;
  dx0: number;
  r1: number;
  c1: number;
  dy1: number;
  dx1: number;
}

export interface FloatObject {
  id: string;
  kind: ObjectKind;
  x: number;
  y: number;
  w: number;
  h: number;
  anchor?: Anchor;
  alt?: string;
  name?: string;
  chart?: ChartSpec;
  picture?: { src: string; name: string };
  inCell?: boolean;
  decorative?: boolean;
  spark?: SparkSpec;
  shape?: { shape: 'rect' | 'ellipse' | 'arrow' | 'button'; fill: string; stroke: string; text: string; color?: string; size?: number };
  text?: { text: string; size: number; color: string };
  script?: string;
  scriptName?: string;
}

export interface SparkSpec {
  type: 'line' | 'column' | 'winloss';
  color: string;
  neg: string;
  dataId?: string;
  data?: string;
  markers?: boolean;
  high?: boolean;
  low?: boolean;
  first?: boolean;
  last?: boolean;
  negative?: boolean;
  axis?: boolean;
  weight?: number;
  min?: number | 'group';
  max?: number | 'group';
  empty?: 'gap' | 'zero' | 'span';
  markerColor?: string;
  firstColor?: string;
  lastColor?: string;
  highColor?: string;
  lowColor?: string;
  axisColor?: string;
}

export interface Series {
  name: string;
  vals: (number | null)[];
  txt: string[];
}

export interface ChartData {
  cats: string[];
  catNums: (number | null)[];
  series: Series[];
  paths?: string[][];
}

export const PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];

export function blankChart(type: ChartType, range: string): ChartSpec {
  return { type, range, byRows: false, title: '', xTitle: '', yTitle: '', legend: 'right', labels: false, secondary: [] };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
