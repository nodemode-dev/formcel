export function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

export function setDisabled(node: HTMLButtonElement | HTMLInputElement, disabled: boolean): void {
  if (node.disabled !== disabled) node.disabled = disabled;
}

export function setTitle(node: HTMLElement, title: string): void {
  if (node.title !== title) node.title = title;
}

export function setClass(node: Element | null, cls: string, on: boolean): void {
  if (node && node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
}

export function setStyleVar(node: HTMLElement, name: string, value: string): void {
  if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
}

export function setText(node: Element | null, text: string): void {
  if (node && node.textContent !== text) node.textContent = text;
}

export function patchList<T>(container: HTMLElement, items: T[], opts: { key: (item: T) => string; create: (item: T) => HTMLElement }): void {
  const byKey = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children)) {
    const k = (child as HTMLElement).dataset.key;
    if (k !== undefined) byKey.set(k, child as HTMLElement);
  }
  let cursor: Element | null = container.firstElementChild;
  const seen = new Set<string>();
  for (const item of items) {
    const k = opts.key(item);
    seen.add(k);
    let node = byKey.get(k);
    if (!node) {
      node = opts.create(item);
      node.dataset.key = k;
    }
    if (node !== cursor) container.insertBefore(node, cursor);
    else cursor = cursor.nextElementSibling;
  }
  for (const [k, node] of byKey) if (!seen.has(k)) node.remove();
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
