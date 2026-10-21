import type { EngineClient } from '../engine';

export interface Extension {
  id: string;
  setup(engine: EngineClient): void;
  dispose?(): void;
}

const registry = new Map<string, Extension>();

export function register(ext: Extension): void {
  if (registry.has(ext.id)) throw new Error(`duplicate extension: ${ext.id}`);
  registry.set(ext.id, ext);
}

export function activateAll(engine: EngineClient): void {
  for (const ext of registry.values()) ext.setup(engine);
}

export function disposeAll(): void {
  for (const ext of registry.values()) ext.dispose?.();
}
