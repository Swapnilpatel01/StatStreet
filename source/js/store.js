// Tiny IndexedDB wrapper. Everything lives on the device; nothing is uploaded.

const DB = 'statstreet';
const STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => { db.close(); resolve(req?.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export const idbGet = (key) => tx('readonly', (s) => s.get(key));
export const idbSet = (key, val) => tx('readwrite', (s) => s.put(val, key));
export const idbDel = (key) => tx('readwrite', (s) => s.delete(key));

export async function loadState() {
  try { return await idbGet('state'); } catch { return null; }
}

export async function saveState(state) {
  const { _injCache, ...rest } = state; // derived data, rebuilt on load
  await idbSet('state', rest);
}

// Ask iOS/Chrome not to evict our data under storage pressure.
export async function persist() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}
