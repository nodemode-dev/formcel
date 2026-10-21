const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export interface Modal {
  el: HTMLElement;
  body: HTMLElement;
  open(focus?: HTMLElement | null): void;
  close(): void;
  isOpen(): boolean;
}

let serial = 0;

export function makeModal(title: string, opts: { wide?: boolean; onClose?: () => void } = {}): Modal {
  const id = `fc-modal-title-${++serial}`;
  const el = document.createElement('div');
  el.className = opts.wide ? 'fc-modal fc-modal-wide' : 'fc-modal';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', id);
  const head = document.createElement('div');
  head.className = 'fc-modal-head';
  const h = document.createElement('h2');
  h.id = id;
  h.textContent = title;
  head.appendChild(h);
  const body = document.createElement('div');
  body.className = 'fc-modal-body';
  el.append(head, body);
  document.getElementById('overlay-root')!.appendChild(el);
  let returnTo: HTMLElement | null = null;
  const visible = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
  const modal: Modal = {
    el,
    body,
    isOpen: () => !el.hidden,
    open(focus) {
      returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.hidden = false;
      (focus ?? visible()[0])?.focus();
    },
    close() {
      if (el.hidden) return;
      el.hidden = true;
      opts.onClose?.();
      returnTo?.focus();
      returnTo = null;
    },
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      modal.close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = visible();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !el.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !el.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  });
  return modal;
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  const l = document.createElement('label');
  l.className = 'fc-fmt-label';
  l.append(label, control);
  if (hint) control.setAttribute('title', hint);
  return l;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

export function actions(ok: string, onOk: () => void, onCancel: () => void, extra: HTMLElement[] = [], cancelText = 'Cancel'): HTMLElement {
  const row = el('div', 'fc-csv-actions');
  const go = el('button', 'fc-btn fc-btn-primary', ok);
  go.type = 'button';
  go.addEventListener('click', onOk);
  if (cancelText) {
    const cancel = el('button', 'fc-btn', cancelText);
    cancel.type = 'button';
    cancel.addEventListener('click', onCancel);
    row.append(...extra, cancel, go);
  } else row.append(...extra, go);
  return row;
}
