// Remembers the last loaded model (its original file bytes) in IndexedDB so a reload of the page can bring it back.
// Every call is defensive: IndexedDB may be missing, blocked (file:// in some browsers, private windows), full or
// hanging. A failure or a timeout is never an exception: loads return null, saves and clears return false.

export type SessionRecord = { name: string; bytes: Uint8Array; savedAt: number };

/** Files above this size are not remembered (IndexedDB quotas under file:// are small and unknown). */
export const SESSION_MAX_BYTES = 50 * 1024 * 1024;
/** Every storage call gives up after this long. */
export const SESSION_TIMEOUT_MS = 4000;

const DB_NAME = "laserslicer.session";
const STORE = "session";
const KEY = "last";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("storage timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("storage request failed"));
  });
}

export class SessionStore {
  /** `getFactory` is a parameter so tests can pass a fake or nothing. */
  constructor(
    private getFactory: () => IDBFactory | undefined = () => (typeof indexedDB === "undefined" ? undefined : indexedDB),
    private timeoutMs = SESSION_TIMEOUT_MS,
  ) {}

  private open(): Promise<IDBDatabase> {
    const f = this.getFactory();
    if (!f) return Promise.reject(new Error("no IndexedDB"));
    return new Promise((resolve, reject) => {
      const r = f.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error("cannot open storage"));
      r.onblocked = () => reject(new Error("storage blocked"));
    });
  }

  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    try {
      const tx = db.transaction(STORE, mode);
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("storage transaction failed"));
        tx.onabort = () => reject(tx.error ?? new Error("storage transaction aborted"));
      });
      done.catch(() => {}); // when the request itself fails first, the abort that follows must not be an unhandled rejection
      const result = await req(fn(tx.objectStore(STORE)));
      await done;
      return result;
    } finally {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  }

  /** Stores the record. False when too large (the previous record is removed so a restore never brings back an older model), unavailable or failed. */
  async save(name: string, bytes: Uint8Array): Promise<boolean> {
    if (bytes.byteLength > SESSION_MAX_BYTES) {
      await this.clear();
      return false;
    }
    try {
      const rec: SessionRecord = { name, bytes, savedAt: Date.now() };
      await withTimeout(this.run("readwrite", (s) => s.put(rec, KEY)), this.timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  /** The stored record, or null when there is none, it is malformed, or storage is unavailable. */
  async load(): Promise<SessionRecord | null> {
    try {
      const r = (await withTimeout(this.run("readonly", (s) => s.get(KEY)), this.timeoutMs)) as Partial<SessionRecord> | undefined;
      if (!r || typeof r.name !== "string" || !(r.bytes instanceof Uint8Array) || r.bytes.byteLength === 0) return null;
      return { name: r.name, bytes: r.bytes, savedAt: typeof r.savedAt === "number" ? r.savedAt : 0 };
    } catch {
      return null;
    }
  }

  async clear(): Promise<boolean> {
    try {
      await withTimeout(this.run("readwrite", (s) => s.delete(KEY)), this.timeoutMs);
      return true;
    } catch {
      return false;
    }
  }
}
