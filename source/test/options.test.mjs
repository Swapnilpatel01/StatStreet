// Game-risk option pricing. Run: node test/options.test.mjs
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as T from '../js/trading.js';
import * as B from '../js/bs.js';
import { DAY, HOUR } from '../js/util.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const now = Date.parse('2026-10-05T04:00:00Z'); // a Monday

function build({ games = [], scheduleTo = now + 4 * DAY } = {}) {
  const st = E.newState(10000);
  E.upsertTeam(st, 'nba', { id: '1', abbr: 'BOS', name: 'BOS', w: 40, l: 30, gp: 70, diff: 100, streak: 1 });
  E.upsertTeam(st, 'nba', { id: '2', abbr: 'NYK', name: 'NYK', w: 40, l: 30, gp: 70, diff: 100, streak: 1 });
  const mk = (id, gs) => ({ id, name: `P${id}`, pos: 'G', teamId: '1', teamAbbr: 'BOS', img: '', gp: 60, gs, line: {} });
  E.seedPlayer(st, 'nba', mk('10', 20));
  for (let i = 0; i < 20; i++) E.seedPlayer(st, 'nba', { ...mk(`b${i}`, 5 + i % 9), teamId: '2' });
  E.repriceLeague(st, 'nba', now);
  st.schedule = { nba: games.map((d, i) => ({ id: `s${i}`, date: d, name: 'NYK @ BOS', preseason: false, teams: [{ id: '1', abbr: 'BOS' }, { id: '2', abbr: 'NYK' }] })) };
  st.sync = { nba: { scheduleTo } };
  return st;
}
const exp = T.expirations(now)[0]; // Friday
const K = (st) => T.strikes(st.assets['nba:p:10'].price).find((k) => k >= st.assets['nba:p:10'].price);

t('more games before expiry → pricier option', () => {
  const quiet = build({ games: [] });
  const busy = build({ games: [now + 1 * DAY, now + 2 * DAY, now + 3 * DAY] });
  const q0 = T.quoteOption(quiet, 'nba:p:10', 'call', K(quiet), exp, now);
  const q3 = T.quoteOption(busy, 'nba:p:10', 'call', K(busy), exp, now);
  assert.ok(q3.mid > q0.mid * 1.7, `${q0.mid} vs ${q3.mid}`);
  assert.equal(q3.games.known, 3);
  assert.ok(q3.gameShare > 0.4 && q0.gameShare === 0, `${q3.gameShare}`);
});

t('premium drops once the game has been played ("crush")', () => {
  const st = build({ games: [now + 6 * HOUR] });
  const k = K(st);
  const before = T.quoteOption(st, 'nba:p:10', 'call', k, exp, now).mid;
  const after = T.quoteOption(st, 'nba:p:10', 'call', k, exp, now + 8 * HOUR).mid; // same share price, game over
  assert.ok(after < before * 0.75, `${before} -> ${after}`);
  const q = T.quoteOption(st, 'nba:p:10', 'call', k, exp, now);
  assert.ok(q.theta < -before * 0.2, `decay next 24h ${q.theta}`);
});

t('game size comes from the asset\'s own history', () => {
  const calm = build(); const wild = build();
  const pc = calm.assets['nba:p:10']; const pw = wild.assets['nba:p:10'];
  for (let i = 0; i < 8; i++) {
    pc.events.push({ t: now - (i + 1) * DAY, kind: 'game', text: 'g', pct: i % 2 ? 0.01 : -0.01 });
    pw.events.push({ t: now - (i + 1) * DAY, kind: 'game', text: 'g', pct: i % 2 ? 0.12 : -0.12 });
  }
  assert.ok(B.gameMove(pw, now) > 2.5 * B.gameMove(pc, now));
  // preseason games are ignored when sizing
  const pre = build(); pre.assets['nba:p:10'].events.push({ t: now - DAY, kind: 'game', text: '30 PTS (preseason)', pct: 0.5 });
  assert.ok(Math.abs(B.gameMove(pre.assets['nba:p:10'], now) - 0.05) < 1e-9);
});

t('beyond the known schedule: estimate games in season, none in the off-season', () => {
  const far = T.expirations(now)[3];
  const inSeason = build({ games: [now + DAY] });
  const off = build({ games: [] });
  const g1 = B.gamesBefore(inSeason, inSeason.assets['nba:p:10'], far, now);
  const g0 = B.gamesBefore(off, off.assets['nba:p:10'], far, now);
  assert.ok(g1.estimated > 5 && g1.known === 1, JSON.stringify(g1));
  assert.equal(g0.total, 0);
});

t('options still mark and settle correctly with the new model', () => {
  const st = build({ games: [now + DAY] });
  const k = K(st);
  T.buyOption(st, { under: 'nba:p:10', type: 'put', strike: k, exp }, 1, now);
  assert.ok(B.optionsValue(st, now) > 0);
  T.settleOptions(st, exp + 1);
  assert.deepEqual(st.options, {});
});

console.log(`\n${passed} option pricing tests passed`);
