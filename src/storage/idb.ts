import type { Resort } from '../domain/types';

/**
 * IndexedDB 持久化。
 * 高度图 Float32Array 以结构化克隆直接存储（1024² 约 4MB/雪场）。
 */

const DB_NAME = 'ski-resort-planner';
const DB_VERSION = 1;
const STORE = 'resorts';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function putResort(resort: Resort): Promise<void> {
  await tx('readwrite', (store) => store.put(resort));
}

export async function getResort(id: string): Promise<Resort | undefined> {
  return tx('readonly', (store) => store.get(id) as IDBRequest<Resort | undefined>);
}

export async function deleteResort(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

export async function listResorts(): Promise<Resort[]> {
  return tx('readonly', (store) => store.getAll() as IDBRequest<Resort[]>);
}
