// Market events, IPOs, monthly reports, hall of fame, friend challenge codes.
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as X from '../js/extras3.js';
import * as C from '../js/career.js';
import { DAY, HOUR } from '../js/util.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const now = new Date(2026, 9, 7, 9, 0).getTime();
function build(cash = 1000) {
  const st = E.newState(cash);
  st.settings.leagues = { nba: true, nfl: false, mlb: false };
  for (const [id, abbr, w] of [['1', 'BOS', 30], ['2', 'WAS', 8]]) E.upsertTeam(st, 'nba', { id, abbr, name: `${abbr} Team`, w, l: 40 - w, gp: 40, diff: (w - 20) * 5, streak: 1 });
  for (let i = 0; i < 20; i++) E.seedPlayer(st, 'nba', { id: 'p' + i, name: `Player ${i}`, pos: 'F', teamId: String(1 + (i % 2)), teamAbbr: ['BOS', 'WAS'][i % 2], gp: 20, gs: 8 + i, line: {} });
  E.initForm(st, 'nba', { all: true }); E.repriceLeague(st, 'nba', now - DAY); st.lastTick = now - DAY;
  st.sync.nba = { seeded: true };
  X.runExtras3(st, now - DAY, () => 1); // first run: existing players are never IPOs
  return st;
}
const line = (pts) => ({ min: 30, pts, fgm: 0, fga: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 });

t('market events start at random, shake the league and end', () => {
  const st = build();
  X.runExtras3(st, now, () => 1);
  assert.equal(X.activeEvents(st, now).length, 0);
  const h0 = st.assets['nba:p:p3'].h || 0;
  X.runExtras3(st, now + HOUR, () => 0);
  const ev = X.activeEvents(st, now + HOUR);
  assert.equal(ev.length, 1); assert.equal(ev[0].league, 'nba');
  assert.notEqual(st.assets['nba:p:p3'].h || 0, h0, 'each player gets his own jolt');
  assert.ok(st.inbox.some((x) => /market event/.test(x.text)));
  X.runExtras3(st, now + 2 * HOUR, () => 0);
  assert.equal(Object.keys(st.events).length, 1, 'no second event while one is running');
  assert.equal(X.activeEvents(st, now + HOUR + X.EVENT_LEN + 1).length, 0);
});
t('rookie IPO: lists at noon, limited allocation, locked, then trades freely', () => {
  const st = build();
  assert.ok(!Object.values(st.assets).some((a) => a.ipo), 'players already in the market are not IPOs');
  E.applyFinalGame(st, 'nba', { id: 'g9', date: now - 3 * HOUR, teams: [{ id: '1', abbr: 'BOS', score: 100, winner: true, home: true }, { id: '2', abbr: 'WAS', score: 90 }],
    players: [{ id: 'rook', name: 'Rookie One', pos: 'G', teamId: '1', teamAbbr: 'BOS', line: line(18) }] }, { now });
  X.runExtras3(st, now, () => 1);
  const a = st.assets['nba:p:rook'];
  assert.equal(X.ipoPhase(a, now), 'soon');
  assert.equal(new Date(a.ipo.opens).getHours(), 12);
  assert.throws(() => E.trade(st, a.id, 'buy', 1, now), /lists at/);
  const open = a.ipo.opens + 60e3;
  X.runExtras3(st, open, () => 1);
  assert.equal(X.ipoPhase(a, open), 'open');
  assert.ok(st.inbox.some((x) => /IPO open: Rookie One/.test(x.text)));
  assert.throws(() => E.trade(st, a.id, 'buy', 1, open), /allocation/);
  assert.throws(() => X.buyIpo(st, a.id, 500, open), /allocation has/);
  const r = X.buyIpo(st, a.id, 60, open);
  assert.ok(Math.abs(r.qty * a.ipo.price - 60) < 0.01 && st.cash === 940);
  assert.ok(Math.abs(X.ipoRoom(st, a, open) - 40) < 0.5, '10% of net worth in total');
  assert.throws(() => E.trade(st, a.id, 'sell', 1, open), /locked/);
  const after = a.ipo.opens + X.IPO_WINDOW + 1000;
  X.runExtras3(st, after, () => 1);
  assert.ok(!a.ipo && a.ipoDone && Math.abs(a.ipoDone.kick) <= 0.35);
  E.trade(st, a.id, 'sell', r.qty, after);
  assert.ok(!st.holdings[a.id]);
});
t('monthly report: needs three games, grade and price move agree, noise can flip it', () => {
  const st = build();
  const a = st.assets['nba:p:p5'];
  assert.equal(X.runReport(st, a, now, 0), null);
  a.perf.last = [1, 2, 3, 4].map((i) => ({ e: 'g' + i, t: now - i * DAY, gs: a.perf.ema + 6, text: 'x' }));
  const r = X.runReport(st, a, now, 0);
  assert.ok(['A', 'B'].includes(r.grade), r.grade);
  assert.ok(a.shocks.at(-1).v > 0 && a.events[0].kind === 'report' && a.events[0].pct > 0);
  assert.equal(X.runReport(st, a, now + DAY, 0), null, 'only games since the last report count');
  const b = st.assets['nba:p:p6'];
  b.perf.last = [1, 2, 3].map((i) => ({ e: 'h' + i, t: now - i * DAY, gs: b.perf.ema + 3, text: 'x' }));
  const r2 = X.runReport(st, b, now, -3);
  assert.ok(['D', 'F', 'C'].includes(r2.grade) && b.shocks.at(-1).v <= 0, 'a good month can still grade badly');
  // scheduling: staggered across four weeks
  X.runExtras3(st, now + 2 * HOUR, () => 1);
  const days = new Set(Object.values(st.assets).filter((x) => x.report?.next).map((x) => Math.round((x.report.next - now) / DAY)));
  assert.ok(days.size >= 8);
});
t('hall of fame survives a fresh start', () => {
  const st = build();
  C.runCareer(st, now);
  E.trade(st, 'nba:p:p4', 'buy', 5, now);
  const a = st.assets['nba:p:p4']; a.perf.ema += 4; E.repriceLeague(st, 'nba', now + 1000);
  E.trade(st, 'nba:p:p4', 'sell', 5, now + 2000);
  st.pickStats.best = 4;
  X.updateHof(st, now + 3000);
  assert.ok(st.hof.trade.pl > 0 && st.hof.peak.v > 1000 && st.hof.pick === 4);
  const keep = JSON.stringify([st.hof.trade, st.hof.peak]);
  E.resetPortfolio(st, 5, now + 4000);
  X.updateHof(st, now + 5000);
  assert.equal(JSON.stringify([st.hof.trade, st.hof.peak]), keep);
  assert.equal(st.hof.pick, 4);
});
t('friend challenge code round-trips and compares', () => {
  const st = build();
  const code = X.duelCode(st, 'Sam', now);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const d = X.parseDuel(`https://example.com/StatStreet/#c=${code}`);
  assert.equal(d.name, 'Sam'); assert.equal(d.ret, 0);
  assert.equal(X.parseDuel('garbage!!'), null);
  const r = X.duelResult(st, code, now);
  assert.ok(r.ahead && !r.stale);
});
t('market indicator, dividend calendar, feed and bio', () => {
  const st = build();
  assert.equal(X.marketStatus(st, now).state, 'closed');
  st.schedule.nba = [{ id: 'g1', date: now + 5 * HOUR, name: 'WAS @ BOS', teams: [{ id: '1', abbr: 'BOS', home: true }, { id: '2', abbr: 'WAS' }] }];
  let m = X.marketStatus(st, now); assert.equal(m.state, 'soon'); assert.match(m.text, /1 game today · first at/);
  st.schedule.nba[0].date = now + 30 * HOUR;
  m = X.marketStatus(st, now); assert.equal(m.state, 'closed'); assert.match(m.text, /next tomorrow/);
  st.liveGames.g0 = { league: 'nba', name: 'x', teams: [] };
  assert.equal(X.marketStatus(st, now).state, 'live');
  // dividends
  E.trade(st, 'nba:p:p4', 'buy', 10, now - 5 * DAY);
  const a = st.assets['nba:p:p4'];
  a.perf.last = [1, 2, 3, 4].map((i) => ({ e: 'd' + i, t: now - i * DAY, gs: 20, text: 'x' }));
  a.divHist = [{ t: now - DAY, ps: 0.1, reason: 'r' }, { t: now - 2 * DAY, ps: 0.3, reason: 'r' }];
  const dc = X.dividendCalendar(st, now);
  assert.equal(dc.rows.length, 1);
  const h = dc.rows[0].holdings[0];
  assert.equal(h.perPay, 2); assert.equal(h.rate, 0.5); assert.equal(dc.expected, 1);
  // feed
  st.inbox = [];
  E.notify(st, 'div', 'P4 paid you $1.00', a.id, now - HOUR); E.notify(st, 'div', 'P4 paid you $2.00', a.id, now - 2 * HOUR);
  st.inbox.sort((x, y) => y.t - x.t);
  st.inbox.unshift({ t: now, kind: 'report', text: 'P4 report card: A', id: a.id, seen: false });
  st.inbox.push({ t: now - 3 * DAY, kind: 'level', text: 'old', id: null });
  st.divs = [{ t: now - HOUR, id: a.id, amt: 1 }, { t: now - 2 * HOUR, id: a.id, amt: 2 }];
  const f = X.feedCards(st, now);
  assert.equal(f.length, 2); assert.equal(f[0].kind, 'report'); assert.match(f[1].text, /2 payments.*\$3\.00/);
  // bio
  const b = X.parseBio({ athlete: { age: 27, displayHeight: "6' 6\"", displayWeight: '230 lbs', college: { name: 'Duke' }, experience: { years: 0 }, displayDraft: '2024: Rd 1, Pk 3',
    statsSummary: { displayName: '2026 season', statistics: [{ shortDisplayName: 'PTS', displayValue: '27.1', rankDisplayValue: '5th' }] } } });
  assert.deepEqual(b.facts.map((x) => x[0]), ['Age', 'Height', 'Weight', 'Experience', 'College', 'Draft']);
  assert.equal(b.facts[3][1], 'Rookie'); assert.equal(b.stats[0][1], '27.1');
  assert.equal(X.parseBio({}).facts.length, 0);
});
console.log(`\n${n} extras3 tests passed`);
