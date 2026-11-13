import { describe, expect, it } from "vitest";
import { SESSION_MAX_BYTES, SessionStore } from "../src/sessionStore";
import { parseUiPrefs } from "../src/uiPrefs";

/** Minimal in-memory IndexedDB: open / onupgradeneeded / one object store with get, put, delete in transactions. */
function fakeIdb(opts: { failPut?: boolean } = {}): IDBFactory {
  const data = new Map<string, unknown>();
  let created = false;
  const later = (fn: () => void) => setTimeout(fn, 0);
  const request = <T>(run: () => T, fail = false) => {
    const r: Record<string, unknown> = {};
    later(() => {
      if (fail) {
        r.error = new Error("quota");
        (r.onerror as () => void)?.();
      } else {
        r.result = run();
        (r.onsuccess as () => void)?.();
      }
    });
    return r;
  };
  const db = {
    objectStoreNames: { contains: () => created },
    createObjectStore: () => void (created = true),
    close() {},
    transaction() {
      const tx: Record<string, unknown> = {};
      const done = (fail: boolean) => later(() => later(() => (fail ? (tx.onabort as () => void)?.() : (tx.oncomplete as () => void)?.())));
      tx.objectStore = () => ({
        get: (k: string) => { done(false); return request(() => structuredClone(data.get(k))); },
        put: (v: unknown, k: string) => { done(!!opts.failPut); return request(() => void data.set(k, structuredClone(v)), !!opts.failPut); },
        delete: (k: string) => { done(false); return request(() => void data.delete(k)); },
      });
      return tx;
    },
  };
  return {
    open() {
      const r: Record<string, unknown> = { result: db };
      later(() => {
        (r.onupgradeneeded as () => void)?.();
        (r.onsuccess as () => void)?.();
      });
      return r;
    },
  } as unknown as IDBFactory;
}

const bytes = new Uint8Array([1, 2, 3, 4, 5]);

describe("session store", () => {
  it("returns null / false when IndexedDB does not exist", async () => {
    const s = new SessionStore(() => undefined);
    expect(await s.load()).toBeNull();
    expect(await s.save("a.stl", bytes)).toBe(false);
    expect(await s.clear()).toBe(false);
  });
  it("returns null / false when touching IndexedDB throws", async () => {
    const s = new SessionStore(() => { throw new Error("SecurityError"); });
    expect(await s.load()).toBeNull();
    expect(await s.save("a.stl", bytes)).toBe(false);
  });
  it("gives up on storage that never answers", async () => {
    const hang = { open: () => ({}) } as unknown as IDBFactory;
    const s = new SessionStore(() => hang, 30);
    expect(await s.load()).toBeNull();
    expect(await s.save("a.stl", bytes)).toBe(false);
  });
  it("saves, loads and clears a record", async () => {
    const f = fakeIdb();
    const s = new SessionStore(() => f);
    expect(await s.load()).toBeNull();
    expect(await s.save("part.stl", bytes)).toBe(true);
    const r = await s.load();
    expect(r?.name).toBe("part.stl");
    expect(Array.from(r!.bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(r!.savedAt).toBeGreaterThan(0);
    expect(await s.clear()).toBe(true);
    expect(await s.load()).toBeNull();
  });
  it("a failing write (quota) returns false", async () => {
    expect(await new SessionStore(() => fakeIdb({ failPut: true })).save("a.stl", bytes)).toBe(false);
  });
  it("does not store files above the limit and removes the older record", async () => {
    const f = fakeIdb();
    const s = new SessionStore(() => f);
    await s.save("small.stl", bytes);
    expect(await s.save("huge.stl", { byteLength: SESSION_MAX_BYTES + 1 } as Uint8Array)).toBe(false);
    expect(await s.load()).toBeNull();
  });
});

describe("restore preference", () => {
  it("defaults to on and follows a stored boolean", () => {
    expect(parseUiPrefs(null).restoreSession).toBe(true);
    expect(parseUiPrefs('{"restoreSession":false}').restoreSession).toBe(false);
    expect(parseUiPrefs('{"restoreSession":"no"}').restoreSession).toBe(true);
    expect(parseUiPrefs('{"autoUpdate":false}').restoreSession).toBe(true);
  });
});
