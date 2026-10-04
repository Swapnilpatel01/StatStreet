// Journal, lineup, calendar, alerts, daily challenge, collections, achievements, search, compare.
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as X from '../js/extras.js';
import * as B from '../js/boosters.js';
import { DAY, HOUR } from '../js/util.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const now = new Date(2026, 9, 6, 12, 0).getTime();
const line = (pts) => ({ min: 30, pts, fgm: 0, fga: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 });
function build() {
  const st = E.newState(1000);
  st.settings.leagues = { nba: true, nfl: true, mlb: true };
  for (const [id, abbr, w] of [['1', 'BOS', 30], ['2', 'WAS', 8], ['3', 'DEN', 36], ['4', 'UTA', 10]]) E.upsertTeam(st, 'nba', { id, abbr, name: `${abbr} Team`, w, l: 40 - w, gp: 40, diff: (w - 20) * 5, streak: 1 });
  for (let i = 0; i < 24; i++) E.seedPlayer(st, 'nba', { id: 'p' + i, name: i === 0 ? 'Jayson Tatum' : `Player ${i}`, pos: 'F', teamId: String(1 + (i % 4)), teamAbbr: ['BOS', 'WAS', 'DEN', 'UTA'][i % 4], gp: 20, gs: 8 + i, line: {} });
  E.initForm(st, 'nba', { all: true }); E.repriceLeague(st, 'nba', now - 2 * DAY); st.lastTick = now - 2 * DAY;
  st.schedule.nba = [
    { id: 'g1', date: now + 3 * HOUR, name: 'WAS @ BOS', teams: [{ id: '1', abbr: 'BOS', home: true }, { id: '2', abbr: 'WAS', home: false }] },
    { id: 'g2', date: now + 2 * DAY, name: 'BOS @ DEN', teams: [{ id: '3', abbr: 'DEN', home: true }, { id: '1', abbr: 'BOS', home: false }] },
  ];
  return st;
}
t('trade journal matches sales to average cost', () => {
  const st = build();
  E.trade(st, 'nba:p:p0', 'buy', 2, now - DAY);
  st.assets['nba:p:p0'].perf.ema += 3; E.repriceLeague(st, 'nba', now - HOUR);
  E.trade(st, 'nba:p:p0', 'sell', 1, now - HOUR);
  const tr = X.closedTrades(st);
  assert.equal(tr.length, 1);
  assert.ok(tr[0].pl > 0 && tr[0].sell > tr[0].buy && tr[0].held > 20 * HOUR, JSON.stringify(tr[0]));
  const s = X.journalStats(tr);
  assert.equal(s.wins, 1); assert.equal(s.winRate, 1);
});
t('lineup and calendar: your games today, opponents rated by strength', () => {
  const st = build();
  E.trade(st, 'nba:p:p0', 'buy', 1, now); st.watch.push('nba:p:p1');
  const lu = X.lineupToday(st, now);
  assert.equal(lu.length, 1); assert.equal(lu[0].id, 'g1'); assert.equal(lu[0].mine.length, 2);
  const cal = X.calendar(st, now);
  assert.deepEqual(cal.map((g) => [g.opp, g.diff, g.home]), [['WAS', 'easy', true], ['DEN', 'tough', false]]);
});
t('mover alerts fire once per step, and when a game goes live', () => {
  const st = build();
  E.trade(st, 'nba:p:p0', 'buy', 1, now - 2 * DAY + 1000);
  const a = st.assets['nba:p:p0']; a.hist.push(now - 60e3, a.price * 1.07); a.price *= 1.07;
  assert.equal(X.moverAlerts(st, now).length, 1);
  assert.equal(X.moverAlerts(st, now).length, 0, 'no repeat');
  a.price *= 1.05; a.hist.push(now, a.price);
  assert.equal(X.moverAlerts(st, now + 1000).length, 1, 'next step');
  st.settings.moveAlert = 0; a.price *= 1.2;
  st.liveGames.g1 = { league: 'nba', name: 'WAS @ BOS', detail: 'Q1', teams: [{ id: '1', abbr: 'BOS' }, { id: '2', abbr: 'WAS' }] };
  assert.equal(X.moverAlerts(st, now + 2000).length, 0, 'off');
  st.settings.moveAlert = 50;
  const al = X.moverAlerts(st, now + 3000);
  assert.ok(al.some((x) => /is live/.test(x.text)));
  assert.ok(!X.moverAlerts(st, now + 4000).some((x) => /is live/.test(x.text)));
});
t('daily challenge only asks about someone who will play', () => {
  const st = build();
  // Everyone on tonight's two teams last played three weeks ago, except one.
  for (const a of Object.values(st.assets)) if (a.kind === 'player') a.perf.last = [{ t: now - 21 * DAY, gs: 10, line: line(10) }];
  assert.equal(X.dailyChallenge(st, now).cur, null, 'nobody has played lately: no question');
  st.assets['nba:p:p5'].perf.last = [{ t: now - 2 * DAY, gs: 10, line: line(10) }]; // WAS, plays tonight
  st.challenge.cur = null;
  assert.equal(X.dailyChallenge(st, now).cur.id, 'nba:p:p5');
  // Baseball: a pitcher only when he is the announced starter.
  E.upsertTeam(st, 'mlb', { id: '10', abbr: 'NYY', name: 'Yankees', w: 80, l: 60, gp: 140, diff: 50, streak: 1 });
  E.upsertTeam(st, 'mlb', { id: '11', abbr: 'BOS', name: 'Red Sox', w: 70, l: 70, gp: 140, diff: 0, streak: 1 });
  for (const [id, pos, team] of [['s1', 'SP', '10'], ['s2', 'SP', '10'], ['s3', 'SP', '11']]) E.seedPlayer(st, 'mlb', { id, name: `Pitcher ${id}`, pos, teamId: team, teamAbbr: 'X', gp: 20, gs: 12, line: {} });
  E.initForm(st, 'mlb', { all: true }); E.repriceLeague(st, 'mlb', now);
  for (const a of Object.values(st.assets)) { if (a.league === 'nba' && a.kind === 'player') a.perf.last = [{ t: now - 21 * DAY }]; if (a.league === 'mlb' && a.kind === 'player') { a.perf.n = 5; a.perf.ema ??= 10; } }
  st.schedule.mlb = [{ id: 'm1', date: now + 3 * HOUR, name: 'BOS @ NYY', teams: [{ id: '10', abbr: 'NYY', home: true }, { id: '11', abbr: 'BOS' }], probables: ['s2'] }];
  st.challenge.cur = null;
  assert.equal(X.dailyChallenge(st, now).cur?.id, 'mlb:p:s2', 'the announced starter, not the other pitchers');
  st.schedule.mlb[0].probables = []; st.challenge.cur = null;
  assert.equal(X.dailyChallenge(st, now).cur, null, 'no starter announced: no pitcher question');
});

t('daily challenge: one a day, settles on the final, streak and XP', () => {
  const st = build();
  const ch = X.dailyChallenge(st, now);
  assert.ok(ch.cur && ch.cur.gid === 'g1');
  assert.equal(X.dailyChallenge(st, now + HOUR).cur.id, ch.cur.id, 'same one all day');
  X.answerChallenge(st, true, now);
  assert.throws(() => X.answerChallenge(st, false, now), /already/);
  const rid = ch.cur.id.split(':')[2];
  E.applyFinalGame(st, 'nba', { id: 'g1', date: now + 3 * HOUR, teams: [{ id: '1', abbr: 'BOS', score: 110, winner: true, home: true }, { id: '2', abbr: 'WAS', score: 90 }],
    players: [{ id: rid, name: 'X', pos: 'F', teamId: st.assets[ch.cur.id].teamId, line: line(60) }] }, { now: now + 6 * HOUR });
  assert.equal(st.challenge.cur.result, 'won'); assert.equal(st.challenge.streak, 1);
  assert.ok(st.inbox.some((x) => /Daily challenge won/.test(x.text)));
});
t('collections: three cards from a team add 5% dividends', () => {
  const st = build();
  const mk = (i) => B.makeCard(st, { id: 'm' + i, league: 'nba', kind: 'DUNK', desc: '', sit: '', traits: [], rating: 3, rarity: 'common', t: now, player: { id: 'p' + (i * 4), name: 'P', team: 'BOS' } }, { now });
  mk(0); mk(1);
  assert.equal(X.setBonus(st, 'nba:p:p0'), 0);
  mk(2);
  assert.equal(X.setBonus(st, 'nba:p:p0'), 0.05); assert.equal(X.setBonus(st, 'nba:t:1'), 0.05); assert.equal(X.setBonus(st, 'nba:p:p1'), 0);
  assert.ok(Math.abs(E.boostHooks.divMult(st, 'nba:p:p4') - 1.05) < 1e-9);
  assert.ok(X.collections(st)[0].done);
});
t('search, compare, achievements, since last open', () => {
  const st = build();
  st.news.push({ id: 'n1', league: 'nba', headline: 'Tatum drops 50 in win', desc: '', published: now, targets: [] });
  const r = X.searchAll(st, 'tatum');
  assert.equal(r.assets[0].name, 'Jayson Tatum'); assert.equal(r.news.length, 1);
  assert.equal(X.searchAll(st, 'bos').assets.some((a) => a.kind === 'team'), true);
  const rows = X.compareRows(st, st.assets['nba:p:p0'], st.assets['nba:p:p20'], now);
  assert.ok(rows.find((x) => x.label === 'Season level').win === 'b');
  assert.ok(X.achievements(st, now).items.length >= 8);
  E.trade(st, 'nba:p:p0', 'buy', 2, now - 2 * DAY + 1000);
  X.markOpen(st, now - 5 * HOUR);
  const a = st.assets['nba:p:p0']; a.price *= 1.1; a.hist.push(now, a.price);
  const s = X.sinceLastOpen(st, now);
  assert.ok(s.change > 0 && s.top.a.id === 'nba:p:p0');
  assert.equal(X.sinceLastOpen(st, now - 5 * HOUR + 60e3), null, 'not after a quick switch');
});
console.log(`\n${n} extras tests passed`);
