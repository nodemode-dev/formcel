let keeps = (_event: Event): boolean => false;

export function setDockKeeps(fn: (event: Event) => boolean): void {
  keeps = fn;
}

export function dockKeeps(event: Event): boolean {
  return keeps(event);
}
