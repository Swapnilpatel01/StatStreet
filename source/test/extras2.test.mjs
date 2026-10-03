// Shorts, protection, risk, what-if, breakouts, recap, rival, futures, wanted cards, showcase.
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as X from '../js/extras2.js';
import * as B from '../js/boosters.js';
import * as C from '../js/career.js';
import { runAutomation } from '../js/trading.js';
import { ensureFunds } from '../js/funds.js';
import { DAY, HOUR } from '../js/util.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const now = new Date(2026, 9, 7, 12, 0).getTime(); // a Wednesday
function build(cash = 1000) {
  const st = E.newState(cash);
  st.settings.leagues = { nba: true, nfl: false, mlb: false };
  for (const [id, abbr, w] of [['1', 'BOS', 30], ['2', 'WAS', 8], ['3', 'DEN', 36], ['4', 'UTA', 10]]) E.upsertTeam(st, 'nba', { id, abbr, name: `${abbr} Team`, w, l: 40 - w, gp: 40, diff: (w - 20) * 5, streak: 1 });
  for (let i = 0; i < 24; i++) E.seedPlayer(st, 'nba', { id: 'p' + i, name: `Player ${i}`, pos: 'F', teamId: String(1 + (i % 4)), teamAbbr: ['BOS', 'WAS', 'DEN', 'UTA'][i % 4], gp: 20, gs: 8 + i, line: {} });
  E.initForm(st, 'nba', { all: true }); E.repriceLeague(st, 'nba', now - 10 * DAY); st.lastTick = now - 10 * DAY;
  ensureFunds(st, now - 10 * DAY);
  return st;
}
const setPrice = (st, id, mult) => { const a = st.assets[id]; a.perf.ema += Math.log(mult) / 0.75 * st.stats.nba.ALL.sd; E.repriceLeague(st, 'nba', now); };

t('short selling: gains when the price falls, fees accrue, closes itself on a big rise', () => {
  const st = build();
  const id = 'nba:p:p10'; const p0 = st.assets[id].price;
  assert.throws(() => X.openShort(st, id, 600, now), /half your net worth/);
  X.openShort(st, id, 200, now);
  assert.equal(st.cash, 800);
  assert.ok(Math.abs(E.netWorth(st, now) - 1000) < 1.5, 'opening costs only the spread');
  setPrice(st, id, 0.8);
  assert.ok(E.netWorth(st, now) > 1030, `net worth ${E.netWorth(st, now)}`);
  X.runExtras(st, now + DAY);
  assert.ok(st.shorts[id].fee > 0.3, 'a day of borrowing');
  const r = X.coverShort(st, id, now + DAY);
  assert.ok(r.pl > 30 && st.cash > 1030 && !st.shorts[id]);
  // squeeze
  X.openShort(st, id, 200, now + DAY);
  setPrice(st, id, 2.2);
  X.runExtras(st, now + DAY + 1000);
  assert.ok(!st.shorts[id] && st.inbox.some((x) => /closed automatically/.test(x.text)));
  assert.ok(st.cash > 830 && st.cash < 1100);
  E.trade(st, 'nba:p:p3', 'buy', 1, now);
  assert.throws(() => X.openShort(st, 'nba:p:p3', 10, now), /Sell your shares/);
});
t('stop-loss and take-profit come as a pair: one fills, the other goes', () => {
  const st = build();
  const id = 'nba:p:p5';
  E.trade(st, id, 'buy', 4, now);
  const p = X.protect(st, id, { stopPct: 0.1, takePct: 0.2 }, now);
  assert.ok(p.stop.price < st.assets[id].price && p.take.price > st.assets[id].price);
  E.trade(st, id, 'buy', 1, now + 1); X.runExtras(st, now + 2);
  assert.equal(st.orders[0].qty, 5, 'follows the position size');
  setPrice(st, id, 1.3);
  runAutomation(st, now + 1000);
  assert.ok(!st.holdings[id], 'take-profit sold');
  assert.equal(st.orders.length, 0, 'stop-loss removed with it');
});
t('risk check flags concentration; what-if scenarios bracket the price', () => {
  const st = build();
  E.trade(st, 'nba:p:p20', 'buy', 10, now);
  const r = X.riskReport(st, now);
  assert.ok(r.top.a.id === 'nba:p:p20' && r.warn.some((w) => /of your net worth/.test(w)) && r.score < 70, JSON.stringify(r.warn));
  assert.equal(X.riskReport(build(), now).label, 'All cash');
  const sc = X.scenarios(st, st.assets['nba:p:p20']);
  assert.ok(sc[0].pct < 0 && sc[sc.length - 1].pct > 0 && Math.abs(sc[2].pct) < 0.001 && sc[sc.length - 1].pct <= 0.26);
  const ts = X.scenarios(st, st.assets['nba:t:2']);
  assert.ok(ts[0].price < ts[3].price);
});
t('breakouts: cheap players whose last three games beat their level', () => {
  const st = build();
  const a = st.assets['nba:p:p2'];
  a.perf.last = [1, 2, 3].map((i) => ({ e: 'g' + i, t: now - i * DAY, gs: a.perf.ema + 12, text: '30 pts' }));
  const b = X.breakouts(st, now);
  assert.equal(b[0].a.id, a.id);
  assert.ok(!b.some((x) => x.a.id === 'nba:p:p23'), 'expensive players are not breakouts');
});
t('weekly recap and rival', () => {
  const st = build();
  C.runCareer(st, now - 9 * DAY);
  E.trade(st, 'nba:p:p4', 'buy', 5, now - 3 * DAY);
  st.nw = [now - 8 * DAY, 1000, now - 4 * DAY, 1000];
  setPrice(st, 'nba:p:p4', 1.2);
  const w = X.weeklyRecap(st, now);
  assert.ok(w.change > 0 && w.bestHold.a.id === 'nba:p:p4' && w.rank >= 1);
  X.chooseRival(st, 'SS500', now);
  const s = X.rivalStatus(st, now);
  assert.ok(Math.abs(s.me) < 1e-6 && s.name === 'Index Ian');
  setPrice(st, 'nba:p:p4', 1.3);
  const xp = st.career.xp;
  X.runExtras(st, now + 7 * DAY);
  assert.ok(st.inbox.some((x) => /Week over: you (beat|lost to) Index Ian/.test(x.text)));
  assert.ok(st.rival.w + st.rival.l === 1 && st.career.xp >= xp);
});
t('season futures: one bet per market, settled at season end, paid after the reset', () => {
  const st = build();
  C.runCareer(st, now);
  const ms = X.futuresMarkets(st, now);
  const mvp = ms.find((m) => m.key === 'nba:mvp');
  assert.ok(mvp.options[0].mult < mvp.options[7].mult, 'favourite pays less');
  assert.ok(mvp.options.reduce((s, o) => s + o.p, 0) < 0.95, 'the house keeps an edge');
  assert.throws(() => X.betFuture(st, 'nba:mvp', mvp.options[0].id, 500, now), /10%/);
  const f = X.betFuture(st, 'nba:mvp', mvp.options[0].id, 50, now);
  assert.throws(() => X.betFuture(st, 'nba:mvp', mvp.options[1].id, 10, now), /already/);
  assert.throws(() => X.betFuture(st, 'nba:leader', ms.find((m) => m.key === 'nba:leader').options[0].id, 10, st.season.end - DAY), /close a week/);
  const end = st.season.end + 1000;
  X.runExtras(st, end); C.runCareer(st, end);
  assert.equal(f.result, 'won');
  const cash = st.cash;
  X.runExtras(st, end + 5000);
  assert.ok(Math.abs(st.cash - cash - f.paid) < 0.011, 'paid on top of the new bankroll');
});
t('wanted cards pay a small premium once a day; showcase holds five', () => {
  const st = build();
  st.moments = [];
  for (let i = 0; i < 12; i++) st.moments.push({ id: 'm' + i, league: 'nba', kind: 'DUNK', desc: '', sit: '', traits: [], rating: 3, rarity: 'common', t: now, player: { id: 'p' + i, name: 'P' + i, team: ['BOS', 'DEN'][i % 2] } });
  const offers = X.wantedOffers(st, now);
  assert.equal(offers.length, 2);
  const o = offers[0];
  assert.throws(() => X.fillWanted(st, o.i, now), /spare/);
  const card = B.makeCard(st, { ...st.moments[0], player: { id: 'p0', name: 'P0', team: o.team } }, { now, rarity: o.rarity });
  const mv = B.marketValue(card, now); const cash = st.cash;
  const r = X.fillWanted(st, o.i, now);
  assert.ok(r.pays > mv && r.pays <= Math.round(mv * 1.21) && Math.abs(st.cash - cash - r.pays / 100) < 0.011);
  assert.throws(() => X.fillWanted(st, o.i, now), /already/);
  const cards = [0, 1, 2, 3, 4, 5].map((i) => B.makeCard(st, st.moments[i], { now }));
  for (let i = 0; i < 5; i++) X.toggleShowcase(st, cards[i].id, now + i);
  assert.throws(() => X.toggleShowcase(st, cards[5].id, now), /holds 5/);
  assert.equal(X.showcase(st).length, 5);
  assert.equal(X.cardHistory(cards[0], now).length, 30);
  assert.ok(X.recentSales(st, cards[0], now).length >= 3);
});
console.log(`\n${n} extras2 tests passed`);
