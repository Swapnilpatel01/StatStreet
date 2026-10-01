// Cards, Pick'em, daily streak, trophies, leaderboard. Run: node test/social.test.mjs
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as F from '../js/funds.js';
import * as S from '../js/social.js';
import { DAY, HOUR } from '../js/util.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const now = Date.parse('2026-10-05T04:00:00Z');

function build(cash = 100) {
  const st = E.newState(cash);
  st.startedAt = now - 10 * DAY;
  [['1', 'BOS', 55, 15], ['2', 'WAS', 15, 55], ['3', 'MIA', 35, 35]].forEach(([id, abbr, w, l]) => E.upsertTeam(st, 'nba', { id, abbr, name: abbr, w, l, gp: w + l, diff: (w - l) * 8, streak: 1 }));
  const mk = (id, gs, teamId) => ({ id, name: `Player ${id}`, pos: 'G', teamId, teamAbbr: '', img: '', gp: 60, gs, line: {} });
  E.seedPlayer(st, 'nba', mk('10', 32, '1'));
  for (let i = 0; i < 40; i++) E.seedPlayer(st, 'nba', mk(`b${i}`, 3 + (i % 11), i % 2 ? '2' : '3'));
  E.repriceLeague(st, 'nba', now - 3 * DAY); st.lastTick = now - 3 * DAY;
  for (let i = 1; i <= 100; i++) E.tick(st, now - 3 * DAY + i * 40 * 60e3);
  S.resetRarityCache();
  return st;
}
const game = (id, date, homeScore, awayScore) => ({ id, date, preseason: false, players: [],
  teams: [{ id: '1', abbr: 'BOS', score: homeScore, winner: homeScore > awayScore, home: true }, { id: '2', abbr: 'WAS', score: awayScore, winner: awayScore > homeScore, home: false }] });

t('rarity: the best player is Legendary, bench players are Common', () => {
  const st = build();
  assert.equal(S.rarity(st, st.assets['nba:p:10'], now).key, 'legendary');
  const commons = Object.values(st.assets).filter((a) => a.kind === 'player' && S.rarity(st, a, now).key === 'common');
  assert.ok(commons.length >= 15);
});

t('cards join the collection and level up with the most you have held', () => {
  const st = build(10000);
  E.trade(st, 'nba:p:b0', 'buy', 1, now);
  S.runSocial(st, now);
  const lv1 = S.cardLevel(st, 'nba:p:b0');
  const px = st.assets['nba:p:b0'].price;
  assert.equal(lv1, Math.min(10, 1 + Math.floor(Math.log2(Math.max(px, 5) / 5))));
  assert.ok(st.inbox.some((n) => /New .* card/.test(n.text)));
  E.trade(st, 'nba:p:b0', 'buy', 20, now + 1);
  S.runSocial(st, now + 2);
  const lv2 = S.cardLevel(st, 'nba:p:b0');
  assert.ok(lv2 >= lv1 + 4, `level ${lv1} -> ${lv2}`);
  assert.ok(st.inbox.some((n) => /leveled up/.test(n.text)));
  E.trade(st, 'nba:p:b0', 'sell', st.holdings['nba:p:b0'].qty, now + 3);
  S.runSocial(st, now + 4);
  assert.equal(st.collection['nba:p:b0'], undefined, 'selling everything removes the card');
  st.collection['nba:p:b5'] = { first: now, peak: 0, pulls: 2 };
  S.runSocial(st, now + 5);
  assert.equal(S.cardLevel(st, 'nba:p:b5'), 2, 'pack cards stay');
});

t('daily reward: claim once a day, streak grows, missing a day resets', () => {
  const st = build();
  const r1 = S.claimDaily(st, now); assert.deepEqual([r1.reward, r1.streak], [1, 1]);
  assert.throws(() => S.claimDaily(st, now + HOUR), /Already/);
  const r2 = S.claimDaily(st, now + DAY); assert.deepEqual([r2.reward, r2.streak], [1.5, 2]);
  assert.equal(S.dailyStatus(st, now + 3 * DAY).nextStreak, 1, 'missed a day');
  assert.equal(st.cash, 102.5);
});

t("Pick'em: favorite pays less, win pays with streak bonus, miss resets streak", () => {
  const st = build();
  const g = { id: 'g1', league: 'nba', date: now + DAY, name: 'WAS @ BOS', teams: [{ id: '2', abbr: 'WAS', home: false }, { id: '1', abbr: 'BOS', home: true }] };
  const fav = S.makePick(st, g, '1', now);
  const dogReward = S.pickReward(S.winProb(st, 'nba', '2', '1', false));
  assert.ok(fav.p > 0.6 && fav.reward < 1 && dogReward > 1.5, `${fav.p} ${fav.reward} ${dogReward}`);
  assert.throws(() => S.makePick(st, g, '1', now + 2 * DAY), /locked/);
  const cash = st.cash;
  st.pickStats.streak = 2;
  E.applyFinalGame(st, 'nba', game('g1', now + DAY, 110, 90), { now: now + DAY + 3 * HOUR });
  assert.equal(st.picks.g1.result, 'won');
  assert.ok(Math.abs(st.cash - cash - Math.round(fav.reward * 1.2 * 100) / 100) < 0.011, 'paid with 1.2x streak');
  assert.equal(st.pickStats.streak, 3);
  S.makePick(st, { ...g, id: 'g2', date: now + 2 * DAY }, '1', now);
  E.applyFinalGame(st, 'nba', game('g2', now + 2 * DAY, 90, 100), { now: now + 2 * DAY + 3 * HOUR });
  assert.equal(st.picks.g2.result, 'lost'); assert.equal(st.pickStats.streak, 0);
  assert.equal(st.results[0].id, 'g2'); assert.equal(st.results[0].name, 'WAS @ BOS');
});

t('stale picks are voided; trophies unlock once', () => {
  const st = build(10000);
  st.picks.x = { gameId: 'x', date: now - 3 * DAY, reward: 1, name: 'A @ B', abbr: 'A', opp: 'B' };
  E.trade(st, 'nba:p:10', 'buy', 1, now);
  S.runSocial(st, now);
  assert.equal(st.picks.x.result, 'void');
  assert.ok(st.trophies.first_trade && st.trophies.legend);
  const n = st.inbox.filter((i) => i.kind === 'trophy').length;
  S.runSocial(st, now + 1);
  assert.equal(st.inbox.filter((i) => i.kind === 'trophy').length, n, 'no duplicate unlocks');
});

t('leaderboard ranks you against strategy bots', () => {
  const st = build(10000);
  F.ensureFunds(st, now);
  const rows = S.leaderboard(st, now);
  assert.ok(rows.some((r) => r.you) && rows.some((r) => r.name === 'Index Ian'));
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].ret >= rows[i].ret);
});

console.log(`\n${passed} game-layer tests passed`);
