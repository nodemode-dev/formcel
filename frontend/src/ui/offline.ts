export type Cells = [number, number, string][];

interface Entry {
  id?: number;
  wid: string;
  sheet: number;
  cells: Cells;
  at: number;
}

const DB = 'formcel.offline';
const STORE = 'queue';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('No local storage for the queue.'));
      return;
    }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }).createIndex('wid', 'wid');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('The queue could not be opened.'));
  });
}

function done<T>(tx: IDBTransaction, value: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(value());
    tx.onerror = () => reject(tx.error ?? new Error('The queue could not be written.'));
    tx.onabort = () => reject(tx.error ?? new Error('The queue could not be written.'));
  });
}

export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  return err instanceof Error && /answered (5\d\d|0)\b/.test(err.message);
}

export async function keep(wid: string, sheet: number, cells: Cells): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).add({ wid, sheet, cells, at: Date.now() } satisfies Entry);
  await done(tx, () => undefined);
  db.close();
}

export async function waiting(wid: string): Promise<number> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('wid').count(wid);
    const n = await done(tx, () => req.result);
    db.close();
    return n;
  } catch {
    return 0;
  }
}

export async function replay(wid: string, send: (sheet: number, cells: Cells) => Promise<void>): Promise<number> {
  const db = await open();
  const read = db.transaction(STORE, 'readonly');
  const req = read.objectStore(STORE).index('wid').getAll(wid);
  const items = (await done(read, () => req.result)) as Entry[];
  items.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  let sent = 0;
  try {
    for (const item of items) {
      await send(item.sheet, item.cells);
      const del = db.transaction(STORE, 'readwrite');
      del.objectStore(STORE).delete(item.id as number);
      await done(del, () => undefined);
      sent++;
    }
  } finally {
    db.close();
  }
  return sent;
}
