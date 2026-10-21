export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextOpts {
  size?: number;
  anchor?: string;
  bold?: boolean;
  rot?: number;
  fill?: string;
  base?: string;
  op?: number;
}

export interface Kit {
  text(x: number, y: number, s: string, o?: TextOpts): string;
  line(x1: number, y1: number, x2: number, y2: number, o?: string, w?: number): string;
  nice(lo: number, hi: number, count?: number): { min: number; max: number; ticks: number[] };
  serial(n: number): string;
  fmt(n: number): string;
  color(i: number): string;
  esc(s: string): string;
  r1(n: number): string;
}
