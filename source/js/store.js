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

// Price histories are millions of numbers. Saving them as one packed Float64Array
// (instead of thousands of plain arrays) makes saves and app launch many times faster,
// and avoids a long pause on the main thread that would stutter scrolling.
const EPOCH = 1577836800; // 2020-01-01, seconds

export function packState(state) {
  const { _injCache, ...rest } = state; // derived data, rebuilt on load
  const ids = Object.keys(state.assets);
  let total = 0;
  for (const id of ids) total += (state.assets[id].hist?.length || 0) >> 1;
  const ts = new Uint32Array(total); // seconds since 2020
  const px = new Float32Array(total);
  const lens = new Uint32Array(ids.length);
  const assets = {};
  let k = 0;
  ids.forEach((id, i) => {
    const a = state.assets[id];
    const h = a.hist || [];
    for (let j = 0; j + 1 < h.length; j += 2) { ts[k] = Math.max(0, Math.round(h[j] / 1000) - EPOCH); px[k] = h[j + 1]; k++; }
    lens[i] = h.length >> 1;
    const { hist, ...lite } = a;
    assets[id] = lite;
  });
  return { ...rest, assets, _hist: { v: 2, ids, lens, ts, px } };
}

export function unpackState(s) {
  if (!s?._hist) return s;
  const { ids, lens, ts, px } = s._hist;
  let k = 0;
  ids.forEach((id, i) => {
    const n = lens[i];
    const h = new Array(n * 2);
    for (let j = 0; j < n; j++, k++) { h[2 * j] = (ts[k] + EPOCH) * 1000; h[2 * j + 1] = Math.round(px[k] * 100) / 100; }
    const a = s.assets[id];
    if (a) a.hist = h;
  });
  for (const a of Object.values(s.assets)) a.hist ||= [];
  delete s._hist;
  return s;
}

export async function loadState() {
  try { return unpackState(await idbGet('state')); } catch { return null; }
}

export async function saveState(state) {
  await idbSet('state', packState(state));
}

// Ask iOS/Chrome not to evict our data under storage pressure.
export async function persist() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}
