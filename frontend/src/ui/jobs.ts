export interface Job {
  id: number;
  name: string;
  done: number;
  total: number;
}

export interface JobHandle {
  step(done: number, total?: number): void;
  end(): void;
}

const jobs = new Map<number, Job>();
const listeners = new Set<() => void>();
let next = 1;

const emit = (): void => {
  for (const fn of listeners) fn();
};

export function startJob(name: string, total = 0): JobHandle {
  const id = next++;
  jobs.set(id, { id, name, done: 0, total });
  emit();
  return {
    step(done, t) {
      const j = jobs.get(id);
      if (!j) return;
      j.done = done;
      if (t !== undefined) j.total = t;
      emit();
    },
    end() {
      if (jobs.delete(id)) emit();
    },
  };
}

export async function withJob<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const h = startJob(name);
  try {
    return await fn();
  } finally {
    h.end();
  }
}

export function listJobs(): Job[] {
  return [...jobs.values()];
}

export function onJobs(fn: () => void): void {
  listeners.add(fn);
}
