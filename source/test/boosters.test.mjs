// Booster cards, packs, fusing, marketplace and auctions. Run: node test/boosters.test.mjs
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as X from '../js/xp.js';
import * as B from '../js/boosters.js';
import * as C from '../js/career.js';
import { DAY, HOUR } from '../js/util.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const now = new Date(2026, 9, 6, 10, 0).getTime();

function build() {
  const st = E.newState(1e6);
  [['1', 'BOS', 55, 15], ['2', 'WAS', 15, 55]].forEach(([id, abbr, w, l]) => E.upsertTeam(st, 'nba', { id, abbr, name: abbr, w, l, gp: w + l, diff: (w - l) * 8, streak: 1 }));
  const mk = (id, gs, teamId) => ({ id, name: `P${id}`, pos: 'G', teamId, teamAbbr: '', img: '', gp: 60, gs, line: { pts: gs } });
  E.seedPlayer(st, 'nba', mk('10', 25, '1'));
  for (let i = 0; i < 20; i++) E.seedPlayer(st, 'nba', mk(`b${i}`, 4 + (i % 9), '2'));
  E.repriceLeague(st, 'nba', now - DAY); st.lastTick = now - DAY;
  return st;
}
const game = (id, date, pts, scores = [110, 90]) => ({ id, date, preseason: false,
  teams: [{ id: '1', abbr: 'BOS', score: scores[0], winner: scores[0] > scores[1], home: true }, { id: '2', abbr: 'WAS', score: scores[1], winner: scores[1] > scores[0] }],
  players: [{ id: '10', name: 'P10', pos: 'G', teamId: '1', line: { min: 36, pts, fgm: 0, fga: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 } }] });

t('packs: cost coins, level-gated, guaranteed rarity', () => {
  const st = build();
  assert.throws(() => B.openBoosterPack(st, 'bstarter', now), /coins/);
  X.addCoins(st, 5000);
  assert.throws(() => B.openBoosterPack(st, 'bpremium', now), /level 4/);
  const got = B.openBoosterPack(st, 'bstarter', now);
  assert.equal(got.length, 3);
  X.addXP(st, X.LEVEL_XP(10), now);
  const chase = B.openBoosterPack(st, 'biconic', now);
  assert.ok(B.rIdx(chase[chase.length - 1].rarity) >= B.rIdx('legendary'));
});

t('game day booster pays a bonus on up games and uses charges', () => {
  const st = build();
  E.trade(st, 'nba:p:10', 'buy', 10, now - 2 * HOUR);
  const b = B.makeBooster(st, 'game', 'legendary', now);
  B.equip(st, b.id, 'nba:p:10');
  const cash = st.cash;
  E.applyFinalGame(st, 'nba', game('g1', now, 60), { now: now + 3 * HOUR });
  assert.ok(st.cash > cash, 'bonus paid');
  assert.equal(b.charges, b.max - 1);
  assert.ok(st.inbox.some((n) => /Game Day bonus/.test(n.text)));
});

t('shield refunds part of a loss; dividend booster multiplies dividends', () => {
  const st = build();
  E.trade(st, 'nba:p:10', 'buy', 10, now - 2 * HOUR);
  const sh = B.makeBooster(st, 'shield', 'iconic', now);
  B.equip(st, sh.id, 'nba:p:10');
  const before = st.assets['nba:p:10'].price * 10;
  const cash = st.cash;
  E.applyFinalGame(st, 'nba', game('g2', now, 2), { now: now + 3 * HOUR });
  const loss = before - st.assets['nba:p:10'].price * 10;
  assert.ok(loss > 0);
  const refund = st.cash - cash;
  assert.ok(refund > loss * 0.6 && refund < loss * 0.85, `${refund} vs loss ${loss}`); // 80% of the game's move
  // dividend booster on a team
  E.trade(st, 'nba:t:1', 'buy', 5, now - 2 * HOUR);
  const d = B.makeBooster(st, 'div', 'legendary', now);
  B.equip(st, d.id, 'nba:t:1');
  E.applyFinalGame(st, 'nba', game('g3', now + DAY, 25), { now: now + DAY + 3 * HOUR });
  const div = st.divs.find((x) => x.id === 'nba:t:1');
  assert.ok(div);
  const plain = Math.round(5 * div.ps * 100) / 100;
  assert.ok(Math.abs(div.amt - plain * 2) < 0.02, `${div.amt} vs ${plain}x2`);
});

t('slots, unequip on sale, used-up boosters disappear, fuse 3 → 1', () => {
  const st = build();
  E.trade(st, 'nba:p:10', 'buy', 1, now - 2 * HOUR);
  E.trade(st, 'nba:t:1', 'buy', 1, now - 2 * HOUR);
  E.trade(st, 'nba:t:2', 'buy', 1, now - 2 * HOUR);
  const [a, b, c] = ['div', 'div', 'div'].map(() => B.makeBooster(st, 'div', 'common', now));
  B.equip(st, a.id, 'nba:p:10'); B.equip(st, b.id, 'nba:t:1');
  assert.throws(() => B.equip(st, c.id, 'nba:t:2'), /slots/);
  E.trade(st, 'nba:t:1', 'sell', st.holdings['nba:t:1'].qty, now);
  B.tidyBoosters(st);
  assert.equal(b.on, null);
  assert.throws(() => B.fuse(st, 'div', 'common', now), /3 unequipped/);
  B.unequip(st, a.id);
  const up = B.fuse(st, 'div', 'common', now);
  assert.equal(up.rarity, 'uncommon');
  assert.equal(B.boosterState(st).inv.filter((x) => x.rarity === 'common').length, 0);
  // charges run out
  const g = B.makeBooster(st, 'game', 'common', now);
  B.equip(st, g.id, 'nba:p:10');
  for (let i = 0; i < 3; i++) E.applyFinalGame(st, 'nba', game(`r${i}`, now + i * DAY, 25), { now: now + i * DAY + 3 * HOUR });
  assert.ok(!B.boosterState(st).inv.some((x) => x.id === g.id));
});

t('market: quick sell, daily listings, buying', () => {
  const st = build();
  const b = B.makeBooster(st, 'shield', 'epic', now);
  const coins = X.career(st).coins;
  const p = B.quickSell(st, b.id);
  assert.equal(X.career(st).coins, coins + p);
  const L = B.listings(st, now);
  assert.equal(L.length, 8);
  assert.deepEqual(L.map((x) => x.price), B.listings(st, now + HOUR).map((x) => x.price), 'stable within a day');
  X.addCoins(st, 100000);
  const nb = B.buyListing(st, L[0].id, now);
  assert.equal(nb.rarity, L[0].rarity);
  assert.throws(() => B.buyListing(st, L[0].id, now), /sold/);
  assert.ok(B.marketValue({ type: 'game', rarity: 'iconic', charges: 15, max: 15 }, now) > B.marketValue({ type: 'game', rarity: 'common', charges: 3, max: 3 }, now) * 50);
});

t('auctions: bids climb, settle for coins or come back unsold', () => {
  const st = build();
  const b = B.makeBooster(st, 'game', 'legendary', now);
  const au = B.listAuction(st, b.id, { start: 1, length: '1h' }, now);
  assert.throws(() => B.equip(st, b.id, 'nba:p:10'), /auction|shares/);
  const mid = B.auctionView(au, now + 30 * 60e3);
  assert.ok(mid.current >= 1 && mid.bids >= 1);
  const coins = X.career(st).coins;
  C.runCareer(st, now + 2 * HOUR);
  assert.equal(au.status, 'sold');
  assert.equal(X.career(st).coins, coins + au.top + 0 * 1, 'paid the winning bid');
  // a reserve nobody meets
  const b2 = B.makeBooster(st, 'div', 'common', now);
  const au2 = B.listAuction(st, b2.id, { start: 99999, length: '1h' }, now);
  B.runMarket(st, now + 2 * HOUR);
  assert.equal(au2.status, 'unsold');
  assert.ok(B.boosterState(st).inv.some((x) => x.id === b2.id && !x.listed));
});

console.log(`\n${passed} booster tests passed`);
