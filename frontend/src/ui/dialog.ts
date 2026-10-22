import { icon } from './icons';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const SPOTS_KEY = 'formcel.dialogSpots';

let openCount = 0;
export const anyDialogOpen = (): boolean => openCount > 0;

const spots: Record<string, { x: number; y: number }> = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(SPOTS_KEY) ?? '{}') as Record<string, { x?: unknown; y?: unknown }>;
    const out: Record<string, { x: number; y: number }> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v?.x === 'number' && typeof v.y === 'number') out[k] = { x: v.x, y: v.y };
    return out;
  } catch {
    return {};
  }
})();

export class Dialog {
  readonly scrim: HTMLElement;
  readonly frame: HTMLElement;
  readonly head: HTMLElement;
  readonly body: HTMLElement;
  readonly foot: HTMLElement;
  onClose: (() => void) | null = null;
  private lastFocus: HTMLElement | null = null;
  private offset = { x: 0, y: 0 };

  constructor(private readonly name: string) {
    const scrim = document.createElement('div');
    scrim.className = 'fc-modal fc-scrim';
    scrim.hidden = true;
    scrim.innerHTML = `<div class="fc-dialog" role="dialog" aria-modal="true" aria-label="${name}" tabindex="-1"><div class="fc-dialog-head"><span class="fc-dialog-title"></span><button class="fc-icon-btn" type="button" data-close title="Close" aria-label="Close">${icon('close')}</button></div><div class="fc-dialog-body"></div><div class="fc-dialog-foot"></div></div>`;
    this.scrim = scrim;
    this.frame = scrim.querySelector<HTMLElement>('.fc-dialog')!;
    this.head = scrim.querySelector<HTMLElement>('.fc-dialog-head')!;
    this.body = scrim.querySelector<HTMLElement>('.fc-dialog-body')!;
    this.foot = scrim.querySelector<HTMLElement>('.fc-dialog-foot')!;
    scrim.querySelector<HTMLElement>('.fc-dialog-title')!.textContent = name;
    scrim.querySelector('[data-close]')!.addEventListener('click', () => this.close());
    scrim.addEventListener('pointerdown', (e) => {
      if (e.target === scrim) this.close();
    });
    scrim.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        return;
      }
      if (e.key === 'Tab') this.trap(e);
    });
    this.bindMove();
    document.getElementById('overlay-root')!.appendChild(scrim);
  }

  get isOpen(): boolean {
    return !this.scrim.hidden;
  }

  private trap(e: KeyboardEvent): void {
    const items = [...this.frame.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !this.frame.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !this.frame.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  }

  private place(x: number, y: number): void {
    const r = this.frame.getBoundingClientRect();
    if (!r.width) return;
    const left = r.left - this.offset.x;
    const top = r.top - this.offset.y;
    const nx = Math.min(Math.max(x, 48 - r.width - left), window.innerWidth - 48 - left);
    const ny = Math.min(Math.max(y, -top), window.innerHeight - 44 - top);
    this.offset = { x: nx, y: ny };
    spots[this.name] = { x: nx, y: ny };
    this.frame.style.translate = nx || ny ? `${nx}px ${ny}px` : '';
  }

  private bindMove(): void {
    this.head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      const at = { ...(spots[this.name] ?? { x: 0, y: 0 }) };
      const sx = e.clientX;
      const sy = e.clientY;
      this.head.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => this.place(at.x + ev.clientX - sx, at.y + ev.clientY - sy);
      const up = () => {
        this.head.removeEventListener('pointermove', move);
        this.head.removeEventListener('pointerup', up);
        this.head.removeEventListener('pointercancel', up);
        try {
          localStorage.setItem(SPOTS_KEY, JSON.stringify(spots));
        } catch {
          return;
        }
      };
      this.head.addEventListener('pointermove', move);
      this.head.addEventListener('pointerup', up);
      this.head.addEventListener('pointercancel', up);
    });
  }

  open(focus?: HTMLElement | null): void {
    if (this.isOpen) return;
    this.lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.scrim.hidden = false;
    const spot = spots[this.name];
    if (spot) this.place(spot.x, spot.y);
    openCount++;
    (focus ?? this.scrim.querySelector<HTMLElement>('.fc-btn-primary:not(:disabled)'))?.focus();
    if (!this.scrim.contains(document.activeElement)) this.frame.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.scrim.hidden = true;
    openCount--;
    this.onClose?.();
    if (this.scrim.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.lastFocus?.focus?.();
  }

  button(label: string, kind: '' | 'primary' | 'ghost' | 'danger', run: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `fc-btn${kind ? ` fc-btn-${kind}` : ''}`;
    b.textContent = label;
    b.addEventListener('click', run);
    this.foot.appendChild(b);
    return b;
  }
}
