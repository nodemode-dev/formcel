import type { VbaRuntimeApi } from './service';

let current: VbaRuntimeApi | null = null;

export function setVbaRuntime(r: VbaRuntimeApi | null): void {
  current = r;
}

export function vbaRuntime(): VbaRuntimeApi | null {
  return current;
}
