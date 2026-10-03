// Seasons, weekly goals, XP/levels, shop, contests and props. Run: node test/career.test.mjs
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as F from '../js/funds.js';
import * as X from '../js/xp.js';
import * as C from '../js/career.js';
import * as K from '../js/contests.js';
import * as S from '../js/social.js';
import { DAY, HOUR, weekStart, weekEnd } from '../js/util.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const now = new Date(2026, 9, 6, 10, 0).getTime(); // Tuesday 6 Oct 2026, 10am local

function build(cash = 1000) {
  const st = E.newState(cash);
  st.settings.startCash = cash;
  st.startedAt = now - 5 * DAY;
  [['1', 'BOS', 55, 15], ['2', 'WAS', 15, 55], ['3', 'MIA', 35, 35]].forEach(([id, abbr, w, l]) => E.upsertTeam(st, 'nba', { id, abbr, name: abbr, w, l, gp: w + l, diff: (w - l) * 8, streak: 1 }));
  const mk = (id, gs, teamId, line = { pts: gs }) => ({ id, name: `Player ${id}`, pos: 'G', teamId, teamAbbr: '', img: '', gp: 60, gs, line });
  E.seedPlayer(st, 'nba', mk('10', 32, '1', { pts: 30.4 }));
  for (let i = 0; i < 40; i++) E.seedPlayer(st, 'nba', mk(`b${i}`, 3 + (i % 11), i % 2 ? '2' : '3', { pts: 4 + (i % 11) * 1.5 }));
  E.repriceLeague(st, 'nba', now - 3 * DAY); st.lastTick = now - 3 * DAY;
  for (let i = 1; i <= 60; i++) E.tick(st, now - 3 * DAY + i * HOUR);
  F.ensureFunds(st, now);
  S.resetRarityCache();
  return st;
}
const box = (id, date, players, scores = [100, 90]) => ({ id, date, preseason: false, players,
  teams: [{ id: '1', abbr: 'BOS', score: scores[0], winner: scores[0] > scores[1], home: true }, { id: '2', abbr: 'WAS', score: scores[1], winner: scores[1] > scores[0], home: false }] });
const row = (id, pts) => ({ id, name: `Player ${id}`, pos: 'G', teamId: '1', line: { min: 30, pts, fgm: 0, fga: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 } });

t('XP levels up, pays coins and announces unlocks', () => {
  const st = build();
  assert.equal(X.level(st), 1);
  const w0 = X.wallet(st);
  X.addXP(st, X.LEVEL_XP(3), now);
  assert.equal(X.level(st), 3);
  assert.equal(X.wallet(st), w0 + 100);
  assert.equal(st.flow, 1, 'reward money is tallied so it stays out of returns');
  assert.ok(st.inbox.some((n) => /Level 3! .*Rare packs/.test(n.text)));
  assert.ok(X.LEVEL_XP(10) > 3000 && X.LEVEL_XP(10) < 4000);
});

t('trades and trophies earn XP once', () => {
  const st = build();
  C.runCareer(st, now);
  E.trade(st, 'nba:p:b1', 'buy', 1, now + 1000);
  C.runCareer(st, now + 2000);
  S.runSocial(st, now + 3000); // unlocks the First trade trophy
  C.runCareer(st, now + 4000);
  const xp = X.career(st).xp;
  assert.ok(xp >= 55, `xp ${xp}`);
  C.runCareer(st, now + 5000);
  assert.equal(X.career(st).xp, xp, 'no double counting');
});

t('weekly goals: three per week, paid once when met', () => {
  const st = build();
  C.runCareer(st, now);
  assert.equal(st.week.goals.length, 3);
  assert.ok(['ret3', 'beat'].includes(st.week.goals[0].key));
  const coins = Math.round((st.flow || 0) * 100);
  // Force a trades goal and meet it.
  st.week.goals[1] = { key: 'trades5', done: false };
  for (let i = 0; i < 5; i++) E.trade(st, 'nba:p:b2', 'buy', 1, now + 10 + i);
  C.runCareer(st, now + 100);
  assert.ok(st.week.goals[1].done);
  assert.ok(Math.round((st.flow || 0) * 100) >= coins + 25);
  const after = Math.round((st.flow || 0) * 100);
  C.runCareer(st, now + 200);
  assert.equal(Math.round((st.flow || 0) * 100), after);
  // A new week brings new goals
  C.runCareer(st, weekEnd(now) + HOUR);
  assert.notEqual(st.week.id, new Date(weekStart(now)).toLocaleDateString('en-CA'));
});

t('season ends: tier, rewards, recap and a fresh bankroll', () => {
  const st = build(1000);
  C.runCareer(st, now);
  const s1 = st.season;
  assert.equal(s1.n, 1);
  assert.ok(s1.end - now >= 21 * DAY && new Date(s1.end).getDay() === 1 && new Date(s1.end).getHours() === 0);
  E.trade(st, 'nba:p:b4', 'buy', 2, now);
  st.cash += 300; // pretend the season went well: +30%
  X.addXP(st, X.LEVEL_XP(3), now);
  C.runCareer(st, s1.end + HOUR);
  const rec = X.career(st).seasons[0];
  assert.equal(rec.n, 1);
  assert.equal(rec.tier, 'platinum');
  assert.ok(X.career(st).recap);
  assert.equal(st.season.n, 2);
  assert.deepEqual(st.holdings, {});
  assert.ok(st.cash > C.seasonBalance(st) && st.cash < C.seasonBalance(st) + 30, 'new bankroll plus the prize'); assert.ok(st.cash > 1000, 'higher level → bigger bankroll');
  assert.equal(C.tierFor(-0.05).key, 'bronze');
  assert.equal(C.tierFor(1.2).key, 'legend');
});

t('card packs: coins, guaranteed rarity, duplicates level cards and boost dividends', () => {
  const st = build();
  { const c0 = st.cash; st.cash = 0; assert.throws(() => C.openPack(st, 'starter', now), /cash/); st.cash = c0; }
  X.addCoins(st, 2000);
  assert.throws(() => C.openPack(st, 'elite', now), /level 5/);
  X.addXP(st, X.LEVEL_XP(5), now);
  const cards = C.openPack(st, 'elite', now);
  assert.equal(cards.length, 5);
  assert.ok(['epic', 'legendary'].includes(cards[cards.length - 1].rarity.key), cards.map((c) => c.rarity.key).join(','));
  // duplicates
  const id = 'nba:p:b3';
  st.collection[id] = { first: now, peak: 0, pulls: 4 };
  assert.equal(E.cardLevel(st, id), 4);
  assert.ok(Math.abs(E.cardDivBonus(st, id) - 0.15) < 1e-9);
});

t('themes and titles: level-gated, bought with coins, equipped', () => {
  const st = build();
  X.addCoins(st, 1000);
  assert.throws(() => C.buyItem(st, 'theme', 'ice'), /level 3/);
  X.addXP(st, X.LEVEL_XP(3), now);
  C.buyItem(st, 'theme', 'ice');
  assert.equal(C.themeOf(st).key, 'ice');
  C.equipItem(st, 'theme', 'classic');
  assert.equal(C.themeOf(st).key, 'classic');
  C.buyItem(st, 'title', 'Sixth Man');
  assert.equal(X.career(st).title, 'Sixth Man');
});

t('contests: cap enforced, bots draft legal lineups, real box scores score it, payout at week end', () => {
  const st = build(1000);
  const cap = K.salaryCap(st, 'nba');
  assert.ok(cap > 0);
  const pool = K.draftPool(st, 'nba');
  const bad = pool.slice(0, 5).map((a) => a.id);
  if (pool.slice(0, 5).reduce((s, a) => s + K.salary(a), 0) > cap) assert.throws(() => K.enterContest(st, { league: 'nba', tier: 'rookie', lineup: bad }, now), /cap/);
  const lineup = pool.slice(-5).map((a) => a.id); // five cheapest always fit
  const rid = st.assets[lineup[0]].rid;
  const cash = st.cash;
  const c = K.enterContest(st, { league: 'nba', tier: 'rookie', lineup }, now);
  assert.equal(st.cash, cash - c.fee);
  assert.throws(() => K.enterContest(st, { league: 'nba', tier: 'rookie', lineup }, now), /already/);
  assert.throws(() => K.enterContest(st, { league: 'nba', tier: 'pro', lineup }, now), /level 2/);
  for (const b of c.bots) {
    assert.equal(b.lineup.length, 5);
    const total = b.lineup.reduce((s, id) => s + K.salary(st.assets[id]), 0);
    assert.ok(total <= c.cap, `${b.name} over cap`);
  }
  E.applyFinalGame(st, 'nba', box('cg1', now + DAY, [row(rid, 60)]), { now: now + DAY + 3 * HOUR });
  assert.ok(c.pts >= 60);
  E.applyFinalGame(st, 'nba', box('cg1', now + DAY, [row(rid, 60)]), { now: now + DAY + 4 * HOUR }); // replay ignored
  assert.equal(c.ppts[lineup[0]], 60);
  K.runContests(st, c.end + 1);
  assert.ok(c.done && c.place >= 1);
  if (c.place === 1) assert.ok(c.payout === c.fee * 3);
});

t('props: lines from averages, over/under settles from the box score, parlays need level 4', () => {
  const st = build(1000);
  const star = st.assets['nba:p:10'];
  assert.equal(K.propLine(star), 30.5);
  st.schedule = { nba: [{ id: 'pg1', date: now + 5 * HOUR, name: 'WAS @ BOS', teams: [{ id: '1', abbr: 'BOS', home: true }, { id: '2', abbr: 'WAS' }] }] };
  const board = K.propBoard(st, now, ['nba']);
  const leg = board.find((p) => p.assetId === 'nba:p:10');
  assert.ok(leg && leg.line === 30.5);
  const other = board.find((p) => p.assetId !== 'nba:p:10');
  assert.throws(() => K.placeBet(st, [{ ...leg, side: 'over' }, { ...other, side: 'under' }], 10, now), /level 4/);
  const cash = st.cash;
  const bet = K.placeBet(st, [{ ...leg, side: 'over' }], 10, now);
  assert.equal(st.cash, cash - 10);
  assert.throws(() => K.placeBet(st, [{ ...leg, side: 'over' }], 10, now + 6 * HOUR), /started/);
  E.applyFinalGame(st, 'nba', box('pg1', now + 5 * HOUR, [row('10', 35)]), { now: now + 8 * HOUR });
  assert.equal(bet.status, 'won');
  assert.equal(st.cash, cash - 10 + 19);
  // under that misses
  st.schedule.nba[0] = { ...st.schedule.nba[0], id: 'pg2', date: now + 30 * HOUR };
  const b2 = K.placeBet(st, [{ ...leg, gameId: 'pg2', date: now + 30 * HOUR, side: 'under' }], 5, now + 9 * HOUR);
  E.applyFinalGame(st, 'nba', box('pg2', now + 30 * HOUR, [row('10', 35)]), { now: now + 33 * HOUR });
  assert.equal(b2.status, 'lost');
  // player who doesn't play: voided, stake back
  const c0 = st.cash;
  const b3 = K.placeBet(st, [{ ...leg, gameId: 'pg3', date: now + 40 * HOUR, side: 'over' }], 5, now + 34 * HOUR);
  E.applyFinalGame(st, 'nba', box('pg3', now + 40 * HOUR, []), { now: now + 43 * HOUR });
  assert.equal(b3.status, 'void');
  assert.equal(st.cash, c0);
  // parlay at level 4
  X.addXP(st, X.LEVEL_XP(4), now);
  assert.equal(K.MAX_LEGS(st), 3);
  assert.equal(K.potentialPayout(10, 2), 36.1);
});

t('daily reward pays XP, and coins every 7th day', () => {
  const st = build();
  let r;
  for (let d = 0; d < 7; d++) r = S.claimDaily(st, now + d * DAY);
  assert.equal(r.streak, 7);
  assert.equal(r.coins, 50);
  assert.ok(X.career(st).xp >= 140);
});

t('a $5 bankroll scales rewards, fees and minimums', () => {
  const st = build(5);
  C.runCareer(st, now);
  assert.equal(E.minOrder(st), 0.05);
  assert.equal(S.dailyStatus(st, now).reward, 0.05);
  assert.equal(S.dailyAmount(st, 7), 0.25);
  assert.equal(K.entryFee(st, K.CONTEST_TIERS[0]), 0.25);
  const g = { id: 'sg', league: 'nba', date: now + DAY, name: 'WAS @ BOS', teams: [{ id: '2', abbr: 'WAS', home: false }, { id: '1', abbr: 'BOS', home: true }] };
  const pk = S.makePick(st, g, '2', now);
  assert.ok(pk.reward <= 0.15 && pk.reward >= 0.01, `pick reward ${pk.reward}`);
  E.trade(st, 'nba:p:b0', 'buy', 0.1 / st.assets['nba:p:b0'].price, now);
  assert.throws(() => E.trade(st, 'nba:p:b0', 'buy', 0.03 / st.assets['nba:p:b0'].price, now), /0\.05/);
});

t('cards cost cash; card money and rewards stay out of the season return; old coins convert', () => {
  const st = build();
  C.runCareer(st, now);
  const r0 = C.seasonReturn(st, now);
  X.addCoins(st, 300);            // a reward
  assert.ok(Math.abs(C.seasonReturn(st, now) - r0) < 1e-9);
  const cash = st.cash;
  X.spendCoins(st, 150);          // a pack
  assert.equal(Math.round((cash - st.cash) * 100), 150);
  assert.ok(Math.abs(C.seasonReturn(st, now) - r0) < 1e-9);
  X.career(st).coins = 420;
  const c1 = st.cash;
  C.runCareer(st, now + 1000);
  assert.equal(X.career(st).coins, 0);
  assert.equal(Math.round((st.cash - c1) * 100), 420);
  assert.ok(st.inbox.some((n) => /420 coins became \$4\.20/.test(n.text)));
});

console.log(`\n${passed} career tests passed`);
