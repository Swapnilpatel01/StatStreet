// Run with: node test/store.test.mjs
import assert from 'node:assert/strict';
import { packState, unpackState } from '../js/store.js';

const t0 = Date.parse('2026-10-26T10:00:00Z');
const st = () => ({ cash: 126.87, startCash: 5, txns: [{ t: t0, id: 'nba:p:1', qty: 0.5 }], _injCache: { nba: {} },
  assets: { 'nba:p:1': { id: 'nba:p:1', price: 12.34, perf: { last: [{ line: { pts: 30 } }] }, hist: [t0, 12.3, t0 + 60e3, 12.34] }, 'nba:t:2': { id: 'nba:t:2', price: 1000, hist: [] } } });

const packed = packState(st());
assert.equal(typeof packed._json, 'string', 'everything but histories is one string');
assert.ok(packed._hist.ts instanceof Uint32Array && packed._hist.px instanceof Float32Array);
const back = unpackState(structuredClone(packed));
assert.equal(back.cash, 126.87); assert.equal(back._injCache, undefined); assert.equal(back._hist, undefined);
assert.deepEqual(back.assets['nba:p:1'].hist, [t0, 12.3, t0 + 60e3, 12.34]);
assert.deepEqual(back.assets['nba:t:2'].hist, []);
assert.equal(back.assets['nba:p:1'].perf.last[0].line.pts, 30);
console.log('ok - round trip');

// Saves from v118 and before: objects plus packed histories.
const { _json, _hist } = packState(st());
const old = unpackState(structuredClone({ ...JSON.parse(_json), _hist }));
assert.deepEqual(old.assets['nba:p:1'].hist, [t0, 12.3, t0 + 60e3, 12.34]); assert.equal(old.txns[0].qty, 0.5);
console.log('ok - older saves still load');
// Very old saves: plain state.
assert.equal(unpackState({ cash: 1, assets: {} }).cash, 1);
console.log('ok - plain saves load');
console.log('\n3 tests passed');
