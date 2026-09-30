import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as F from '../js/funds.js';
import * as T from '../js/trading.js';
import * as B from '../js/bs.js';
import { DAY, HOUR } from '../js/util.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const now = Date.parse('2026-10-01T04:00:00Z');

function build() {
  const st = E.newState(10000);
  [['1', 'BOS', 50, 20], ['2', 'WAS', 15, 55], ['3', 'MIA', 35, 35]].forEach(([id, abbr, w, l]) =>
    E.upsertTeam(st, 'nba', { id, abbr, name: abbr, short: abbr, w, l, t: 0, gp: w + l, diff: (w - l) * 8, streak: 1, playoffPct: null }));
  const mk = (id, name, gs, teamId) => ({ id, name, pos: 'G', teamId, teamAbbr: '', img: '', gp: 60, gs, line: {} });
  E.seedPlayer(st, 'nba', mk('10', 'Star Player', 30, '1'));
  E.seedPlayer(st, 'nba', mk('11', 'Solid Starter', 14, '1'));
  for (let i = 0; i < 30; i++) E.seedPlayer(st, 'nba', mk(`b${i}`, `Bench ${i}`, 4 + (i % 7), i % 2 ? '2' : '3'));
  E.repriceLeague(st, 'nba', now - 3 * DAY);
  st.lastTick = now - 3 * DAY;
  for (let i = 1; i <= 200; i++) E.tick(st, now - 3 * DAY + i * 20 * 60e3);
  return st;
}
const game = (id, date, players = []) => ({ id, date, preseason: false,
  teams: [{ id: '1', abbr: 'BOS', score: 120, winner: true, home: true }, { id: '2', abbr: 'WAS', score: 99, winner: false, home: false }], players });
const bigLine = { min: 38, pts: 44, fgm: 16, fga: 26, ftm: 8, fta: 9, reb: 8, ast: 7, stl: 2, blk: 1, to: 2, pf: 2 };

t('migrate fills new fields on old saves', () => {
  const old = { cash: 5, holdings: { x: { qty: 1, cost: 1 } }, settings: { proxy: 'p', leagues: { nba: false } } };
  E.migrate(old);
  assert.deepEqual(old.options, {}); assert.equal(old.settings.drip, false); assert.equal(old.settings.leagues.nfl, true);
  assert.equal(old.settings.leagues.nba, false); assert.equal(old.holdings.x.since, 0);
});

t('fractional buys by dollars stay within budget', () => {
  const st = build();
  const q = T.dollarsToQty(st, 'nba:p:10', 250, now);
  assert.ok(q > 0 && q % 1 !== 0);
  const tx = E.trade(st, 'nba:p:10', 'buy', q, now);
  assert.ok(tx.total <= 250 && tx.total > 249, tx.total);
  E.trade(st, 'nba:p:10', 'sell', st.holdings['nba:p:10'].qty, now + 1);
  assert.equal(st.holdings['nba:p:10'], undefined);
  assert.throws(() => E.trade(st, 'nba:p:10', 'buy', 0.001, now), /Minimum/);
});

t('team dividend on a win, only if held before the game', () => {
  const st = build();
  E.trade(st, 'nba:t:1', 'buy', 10, now - 2 * DAY);
  E.trade(st, 'nba:t:2', 'buy', 10, now - 2 * DAY);
  const cash = st.cash;
  E.applyFinalGame(st, 'nba', game('g1', now - HOUR * 3), { now });
  assert.ok(st.cash > cash, 'winner holder paid');
  assert.equal(st.divs.length, 1); assert.equal(st.divs[0].id, 'nba:t:1');
  // bought after tip-off: no dividend
  const st2 = build();
  E.trade(st2, 'nba:t:1', 'buy', 10, now - HOUR);
  E.applyFinalGame(st2, 'nba', game('g1', now - HOUR * 3), { now });
  assert.equal(st2.divs.length, 0);
});

t('player dividend for a big game plus milestone special, with DRIP', () => {
  const st = build();
  st.settings.drip = true;
  E.trade(st, 'nba:p:11', 'buy', 20, now - DAY);
  const qty = st.holdings['nba:p:11'].qty; const cash = st.cash;
  E.applyFinalGame(st, 'nba', game('g2', now - 3 * HOUR, [{ id: '11', name: 'Solid Starter', pos: 'G', teamId: '1', teamAbbr: 'BOS', line: bigLine }]), { now });
  assert.equal(st.cash, cash, 'DRIP keeps cash');
  assert.ok(st.holdings['nba:p:11'].qty > qty, 'shares added');
  assert.ok(st.divs.some((d) => /Special/.test(d.reason)) && st.divs.length >= 2);
  assert.ok(E.dividendYield(st, st.assets['nba:p:11'], now) > 0);
});

t('index funds: create, price tracks basket, rebalance keeps price, pass-through dividends', () => {
  const st = build();
  F.ensureFunds(st, now);
  const f = st.assets['fund:SS500'];
  assert.ok(f && Object.keys(f.cons).length >= 30);
  assert.ok(Math.abs(f.price - E.fundNav(st, f)) < 0.05);
  assert.ok(f.hist.length > 20, 'backfilled chart');
  assert.ok(st.assets['fund:HOOP'] && !st.assets['fund:GRID'], 'no NFL fund without NFL data');
  E.tick(st, now + 60e3);
  assert.ok(Math.abs(f.price / E.fundNav(st, f) - 1) < 0.001);
  const nav = E.fundNav(st, f);
  f.rebalanced = now - 8 * DAY; F.ensureFunds(st, now + 2 * 60e3);
  assert.ok(Math.abs(E.fundNav(st, f) - nav) < 0.01, 'rebalance is price-neutral');
  E.trade(st, 'fund:TEAMS', 'buy', 5, now - DAY);
  const cash = st.cash;
  E.applyFinalGame(st, 'nba', game('g3', now - HOUR), { now });
  assert.ok(st.cash > cash && st.divs[0].via === 'BOS');
});

t('option pricing sanity', () => {
  const c = B.bsPrice('call', 100, 100, 30 / 365, 0.5), p = B.bsPrice('put', 100, 100, 30 / 365, 0.5);
  assert.ok(Math.abs(c - p) < 1e-9, 'put-call parity at the money');
  assert.ok(c > 5 && c < 6.5, c);
  assert.ok(B.bsPrice('call', 100, 120, 7 / 365, 0.5) < B.bsPrice('call', 100, 120, 28 / 365, 0.5));
  const exps = T.expirations(now);
  assert.equal(exps.length, 4); exps.forEach((e) => assert.equal(new Date(e).getUTCDay(), 5));
  assert.ok(T.strikes(47.3).includes(47.5));
});

t('buy a call, sell to close, and settlement at expiry', () => {
  const st = build();
  const under = 'nba:p:10'; const S = st.assets[under].price;
  const K = T.strikes(S).find((k) => k >= S); const [exp] = T.expirations(now);
  const cash0 = st.cash;
  T.buyOption(st, { under, type: 'call', strike: K, exp }, 2, now);
  assert.ok(st.cash < cash0);
  assert.ok(E.netWorth(st, now) < cash0 && E.netWorth(st, now) > cash0 * 0.97, 'net worth marks option at mid');
  const key = T.optKey(under, 'call', K, exp);
  T.sellOption(st, key, 1, now);
  assert.equal(st.options[key].qty, 1);
  // push the stock way up and expire
  st.assets[under].hist.push(exp - 60e3, K * 1.5);
  const before = st.cash;
  T.settleOptions(st, exp + 60e3);
  assert.equal(st.options[key], undefined);
  assert.ok(Math.abs(st.cash - before - (K * 0.5 * 100)) < 1, 'paid intrinsic');
  assert.ok(st.inbox[0].kind === 'option');
});

t('limit and stop orders, reserved buying power', () => {
  const st = build();
  const id = 'nba:p:11'; const p = st.assets[id].price;
  T.placeOrder(st, { assetId: id, side: 'buy', type: 'limit', qty: 10, price: p * 0.9 }, now);
  assert.ok(T.buyingPower(st) < st.cash);
  T.runAutomation(st, now); assert.equal(st.orders.length, 1, 'not filled above limit');
  st.assets[id].price = p * 0.85; T.runAutomation(st, now + 1);
  assert.equal(st.orders.length, 0); assert.equal(st.holdings[id].qty, 10);
  T.placeOrder(st, { assetId: id, side: 'sell', type: 'stop', qty: 10, price: p * 0.8 }, now);
  assert.throws(() => T.placeOrder(st, { assetId: id, side: 'sell', type: 'limit', qty: 1, price: p * 2 }, now), /available/);
  st.assets[id].price = p * 0.79; T.runAutomation(st, now + 2);
  assert.equal(st.holdings[id], undefined, 'stop-loss sold');
});

t('recurring buys and price alerts', () => {
  const st = build();
  T.addRecurring(st, { assetId: 'fund:x' in st.assets ? 'fund:x' : 'nba:t:1', amount: 50, freq: 'weekly' }, now);
  T.runAutomation(st, now);
  assert.ok(st.holdings['nba:t:1'] && st.recurring[0].next > now);
  T.runAutomation(st, now + DAY); assert.equal(st.txns.filter((x) => x.via === 'recurring').length, 1);
  T.addAlert(st, { assetId: 'nba:p:10', price: st.assets['nba:p:10'].price * 1.05 }, now);
  T.runAutomation(st, now); assert.equal(st.alerts.length, 1);
  st.assets['nba:p:10'].price *= 1.06; T.runAutomation(st, now);
  assert.equal(st.alerts.length, 0); assert.equal(st.inbox[0].kind, 'alert');
});

console.log(`\n${passed} feature tests passed`);
