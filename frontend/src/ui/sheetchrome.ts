import type { Grid } from '../grid/grid';
import type { ShellParts } from './shell';

export interface ChromeHooks {
  grid: Grid;
  extent(): Promise<[number, number] | null>;
}

const MIN_THUMB = 28;

function press(target: HTMLElement | null, key: string): void {
  if (!target) return;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function dragger(el: HTMLElement, move: (dx: number, dy: number) => void, begin?: () => void): void {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-drag');
    begin?.();
    const sx = e.clientX;
    const sy = e.clientY;
    const onMove = (m: PointerEvent) => move(m.clientX - sx, m.clientY - sy);
    const onUp = () => {
      el.classList.remove('is-drag');
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });
}

export function mountSheetChrome(p: ShellParts, hooks: ChromeHooks): void {
  const { grid } = hooks;
  const box = p.formulaBox;
  const cancel = box.querySelector<HTMLButtonElement>('.fc-fcancel')!;
  const enter = box.querySelector<HTMLButtonElement>('.fc-fenter')!;
  const editing = () => !grid.editor.hidden || document.activeElement === p.formulaBar;
  const syncEdit = () => {
    const on = editing();
    if (cancel.disabled === !on) return;
    cancel.disabled = !on;
    enter.disabled = !on;
    box.dataset.editing = String(on);
  };
  new MutationObserver(syncEdit).observe(grid.editor, { attributes: true, attributeFilter: ['hidden'] });
  p.formulaBar.addEventListener('focus', syncEdit);
  p.formulaBar.addEventListener('blur', () => window.setTimeout(syncEdit, 0));
  for (const b of [cancel, enter]) b.addEventListener('mousedown', (e) => e.preventDefault());
  const target = () => (!grid.editor.hidden ? grid.editor : document.activeElement === p.formulaBar ? p.formulaBar : null);
  cancel.addEventListener('click', () => press(target(), 'Escape'));
  enter.addEventListener('click', () => press(target(), 'Enter'));

  const bar = p.tabs.parentElement!;
  const navs = [...bar.querySelectorAll<HTMLButtonElement>('[data-tabnav]')];
  const syncNav = () => {
    const max = p.tabs.scrollWidth - p.tabs.clientWidth;
    navs[0].disabled = p.tabs.scrollLeft <= 0;
    navs[1].disabled = p.tabs.scrollLeft >= max - 1;
  };
  for (const b of navs) b.addEventListener('click', () => p.tabs.scrollBy({ left: Number(b.dataset.tabnav) * 120, behavior: 'smooth' }));
  p.tabs.addEventListener('scroll', syncNav, { passive: true });
  new ResizeObserver(syncNav).observe(p.tabs);
  new MutationObserver(syncNav).observe(p.tabs, { childList: true, subtree: true, characterData: true });
  syncNav();

  const split = bar.querySelector<HTMLElement>('.fc-tabsplit')!;
  let startW = 0;
  dragger(split, (dx) => {
    const w = Math.min(Math.max(80, startW + dx), Math.max(80, bar.clientWidth - 240));
    bar.style.setProperty('--tabs-w', `${w}px`);
  }, () => { startW = p.tabs.getBoundingClientRect().width; });

  const track = bar.querySelector<HTMLElement>('.fc-hscroll')!;
  const hthumb = track.querySelector<HTMLElement>('.fc-hthumb')!;
  const vtrack = document.createElement('div');
  vtrack.className = 'fc-vscroll';
  vtrack.setAttribute('aria-hidden', 'true');
  const vthumb = document.createElement('div');
  vthumb.className = 'fc-vthumb';
  vtrack.appendChild(vthumb);
  p.grid.appendChild(vtrack);

  let ext: [number, number] | null = null;
  let asked = 0;
  const refreshExtent = () => {
    const now = performance.now();
    if (now - asked < 600) return;
    asked = now;
    void hooks.extent().then((e) => {
      const changed = (e?.[0] ?? -1) !== (ext?.[0] ?? -1) || (e?.[1] ?? -1) !== (ext?.[1] ?? -1);
      ext = e;
      if (changed) layout();
    });
  };

  const ranges = () => {
    const i = grid.scrollInfo();
    const usedW = ext ? grid.cols.offsetOf(ext[1] + 1) : 0;
    const usedH = ext ? grid.rows.offsetOf(ext[0] + 1) : 0;
    return { i, rx: Math.max(usedW, i.x + i.vw) + i.vw * 0.5, ry: Math.max(usedH, i.y + i.vh) + i.vh * 0.5 };
  };

  const layout = () => {
    const { i, rx, ry } = ranges();
    const tw = track.clientWidth;
    if (tw > 0 && i.vw > 0) {
      const w = Math.max(MIN_THUMB, (i.vw / rx) * tw);
      const left = (i.x / (rx - i.vw)) * (tw - w) || 0;
      hthumb.style.width = `${w}px`;
      hthumb.style.transform = `translateX(${Math.min(Math.max(0, left), tw - w)}px)`;
    }
    const th = vtrack.clientHeight;
    if (th > 0 && i.vh > 0) {
      const h = Math.max(MIN_THUMB, (i.vh / ry) * th);
      const top = (i.y / (ry - i.vh)) * (th - h) || 0;
      vthumb.style.height = `${h}px`;
      vthumb.style.transform = `translateY(${Math.min(Math.max(0, top), th - h)}px)`;
    }
  };

  grid.scrollHook = () => {
    refreshExtent();
    layout();
  };
  new ResizeObserver(layout).observe(track);
  new ResizeObserver(layout).observe(vtrack);

  let startX = 0;
  let startY = 0;
  dragger(hthumb, (dx) => {
    const { i, rx } = ranges();
    const w = hthumb.offsetWidth;
    grid.scrollTo(startX + (dx / Math.max(1, track.clientWidth - w)) * (rx - i.vw), null);
  }, () => { startX = grid.scrollInfo().x; });
  dragger(vthumb, (_dx, dy) => {
    const { i, ry } = ranges();
    const h = vthumb.offsetHeight;
    grid.scrollTo(null, startY + (dy / Math.max(1, vtrack.clientHeight - h)) * (ry - i.vh));
  }, () => { startY = grid.scrollInfo().y; });

  track.addEventListener('pointerdown', (e) => {
    if (e.target !== track) return;
    const i = grid.scrollInfo();
    const r = hthumb.getBoundingClientRect();
    grid.scrollTo(i.x + (e.clientX < r.left ? -i.vw : i.vw) * 0.9, null);
  });
  vtrack.addEventListener('pointerdown', (e) => {
    if (e.target !== vtrack) return;
    const i = grid.scrollInfo();
    const r = vthumb.getBoundingClientRect();
    grid.scrollTo(null, i.y + (e.clientY < r.top ? -i.vh : i.vh) * 0.9);
  });
}
