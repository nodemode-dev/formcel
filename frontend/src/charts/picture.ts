export const IMAGE_CODE = 0xe001;

interface Entry {
  img: HTMLImageElement;
  state: 'loading' | 'ok' | 'bad';
}

const cache = new Map<string, Entry>();
const LIMIT = 200;

function entry(src: string, repaint: () => void): Entry {
  const hit = cache.get(src);
  if (hit) return hit;
  if (cache.size >= LIMIT) cache.delete(cache.keys().next().value as string);
  const img = new Image();
  const e: Entry = { img, state: 'loading' };
  img.onload = () => {
    e.state = 'ok';
    repaint();
  };
  img.onerror = () => {
    e.state = 'bad';
    repaint();
  };
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.src = src;
  cache.set(src, e);
  return e;
}

export interface ImageSpec {
  sizing: number;
  height: number | null;
  width: number | null;
  alt: string;
  source: string;
}

export function parseImage(text: string): ImageSpec | null {
  const f = text.split('\t');
  if (f[0].slice(1) !== 'IMG' || f.length < 6) return null;
  return { sizing: Number(f[1]) || 0, height: f[2] === '' ? null : Number(f[2]), width: f[3] === '' ? null : Number(f[3]), alt: f[4], source: f.slice(5).join('\t') };
}

export function drawPicture(ctx: CanvasRenderingContext2D, spec: ImageSpec, left: number, top: number, width: number, height: number, repaint: () => void, fg: string): void {
  const e = entry(spec.source, repaint);
  ctx.save();
  ctx.beginPath();
  ctx.rect(left + 1, top + 1, width - 2, height - 2);
  ctx.clip();
  if (e.state === 'ok') {
    const iw = e.img.naturalWidth || 1;
    const ih = e.img.naturalHeight || 1;
    let w = width - 2;
    let h = height - 2;
    if (spec.sizing === 0) {
      const k = Math.min(w / iw, h / ih);
      w = iw * k;
      h = ih * k;
    } else if (spec.sizing === 2) {
      w = iw;
      h = ih;
    } else if (spec.sizing === 3) {
      if (spec.width && spec.height) {
        w = spec.width;
        h = spec.height;
      } else if (spec.width) {
        w = spec.width;
        h = (ih / iw) * w;
      } else if (spec.height) {
        h = spec.height;
        w = (iw / ih) * h;
      }
    }
    const x = spec.sizing === 1 ? left + 1 : left + 1 + Math.max(0, (width - 2 - w) / 2);
    const y = spec.sizing === 1 ? top + 1 : top + 1 + Math.max(0, (height - 2 - h) / 2);
    ctx.drawImage(e.img, x, y, w, h);
  } else if (e.state === 'bad' && spec.alt) {
    ctx.fillStyle = fg;
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.alt, left + 5, top + height / 2, width - 10);
  }
  ctx.restore();
}

export function drawImageCell(ctx: CanvasRenderingContext2D, text: string, left: number, right: number, top: number, height: number, repaint: () => void, fg: string): boolean {
  const spec = parseImage(text);
  if (!spec) return false;
  drawPicture(ctx, spec, left, top, right - left, height, repaint, fg);
  return true;
}
