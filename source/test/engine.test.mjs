// Run with: node test/engine.test.mjs
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as S from '../js/scoring.js';
import { DAY, HOUR } from '../js/util.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok -', name); };

const now = Date.parse('2026-09-29T04:00:00Z');

// ---------- scoring ----------
t('sentiment reads sports headlines', () => {
  assert.ok(S.sentimentScore('Star QB suffers torn ACL, out for the season').score < -0.8);
  assert.ok(S.sentimentScore('Jokic records triple-double, sets franchise record').score > 0.7);
  assert.ok(S.sentimentScore('Mahomes avoids serious injury, expected to play Sunday').score > 0);
  assert.ok(Math.abs(S.sentimentScore('Team announces new jersey schedule').score) < 0.1);
});

t('injury severity ordering', () => {
  const f = S.injuryFactor;
  assert.ok(f('Out') < f('Doubtful') && f('Doubtful') < f('Questionable') && f('Questionable') < f('Day-To-Day'));
  assert.equal(f('Day-To-Day'), 0.96);
  assert.ok(f('60-Day-IL') < f('10-Day-IL'));
  assert.ok(f('Injured Reserve') < f('Out'));
});

t('position groups', () => {
  assert.equal(S.posGroup('nfl', 'QB'), 'QB');
  assert.equal(S.posGroup('nfl', 'TE'), 'WR');
  assert.equal(S.posGroup('nfl', 'CB'), 'DEF');
  assert.equal(S.posGroup('mlb', 'SP'), 'P');
  assert.equal(S.posGroup('mlb', 'SS'), 'H');
});

t('NBA box score parsing', () => {
  const json = { boxscore: { players: [{ team: { id: '13', abbreviation: 'LAL' }, statistics: [{
    labels: ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'],
    athletes: [
      { athlete: { id: '1', displayName: 'Luka Doncic', position: { abbreviation: 'G' } }, stats: ['36', '41', '14-25', '5-11', '8-9', '9', '11', '4', '2', '1', '1', '8', '3', '+12'] },
      { athlete: { id: '2', displayName: 'Bench Guy', position: { abbreviation: 'F' } }, stats: [], didNotPlay: true },
    ] }] }] } };
  const rows = S.parseBoxScore('nba', json);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].line.pts, 41);
  assert.equal(rows[0].line.fga, 25);
  assert.ok(S.gameScore('nba', rows[0].line) > 30);
  assert.equal(S.milestone('nba', rows[0].line), '41-point game');
});

t('NFL box score merges categories', () => {
  const json = { boxscore: { players: [{ team: { id: '12', abbreviation: 'KC' }, statistics: [
    { name: 'passing', labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'], athletes: [{ athlete: { id: '9', displayName: 'Patrick Mahomes', position: { abbreviation: 'QB' } }, stats: ['20/24', '246', '10.3', '2', '1', '1-7', '80', '120'] }] },
    { name: 'rushing', labels: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], athletes: [{ athlete: { id: '9', displayName: 'Patrick Mahomes', position: { abbreviation: 'QB' } }, stats: ['5', '31', '6.2', '1', '12'] }] },
    { name: 'defensive', labels: ['TOT', 'SOLO', 'SACKS', 'TFL', 'PD', 'QB HTS', 'TD'], athletes: [{ athlete: { id: '50', displayName: 'Chris Jones', position: { abbreviation: 'DT' } }, stats: ['4', '3', '2', '2', '0', '3', '0'] }] },
  ] }] } };
  const rows = S.parseBoxScore('nfl', json);
  const qb = rows.find((r) => r.id === '9');
  assert.equal(qb.line.passYds, 246);
  assert.equal(qb.line.rushTD, 1);
  assert.equal(qb.line.cmp, 20);
  const fp = S.gameScore('nfl', qb.line);
  assert.ok(Math.abs(fp - (246 / 25 + 8 - 2 + 3.1 + 6)) < 1e-9);
  assert.equal(rows.find((r) => r.id === '50').line.sacks, 2);
});

t('MLB box score handles hitters and pitchers', () => {
  const json = { boxscore: { players: [{ team: { id: '10', abbreviation: 'NYY' }, statistics: [
    { labels: ['H-AB', 'AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K', '#P', 'AVG', 'OBP', 'SLG'], athletes: [{ athlete: { id: '33', displayName: 'Aaron Judge', position: { abbreviation: 'RF' } }, stats: ['3-4', '4', '2', '3', '4', '2', '0', '1', '18', '.301', '.410', '.650'] }] },
    { labels: ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'PC-ST', 'ERA', 'PC'], athletes: [{ athlete: { id: '45', displayName: 'Gerrit Cole', position: { abbreviation: 'SP' } }, stats: ['7.1', '3', '1', '1', '1', '11', '0', '101-70', '2.90', '101'] }] },
  ] }] } };
  const rows = S.parseBoxScore('mlb', json);
  const p = rows.find((r) => r.id === '45');
  assert.ok(Math.abs(p.line.ip - 22 / 3) < 1e-9);
  assert.ok(S.gameScore('mlb', p.line) > 10);
  assert.ok(S.gameScore('mlb', rows.find((r) => r.id === '33').line) > 10);
});

// ---------- engine ----------

function buildNBA() {
  const st = E.newState(10000);
  const teams = [
    { id: '1', abbr: 'BOS', name: 'Boston', short: 'Celtics', w: 50, l: 20, t: 0, gp: 70, diff: 560, streak: 3, playoffPct: 99 },
    { id: '2', abbr: 'WAS', name: 'Washington', short: 'Wizards', w: 15, l: 55, t: 0, gp: 70, diff: -700, streak: -4, playoffPct: 0 },
    { id: '3', abbr: 'MIA', name: 'Miami', short: 'Heat', w: 35, l: 35, t: 0, gp: 70, diff: 0, streak: 1, playoffPct: 50 },
  ];
  teams.forEach((x) => E.upsertTeam(st, 'nba', x));
  const mk = (id, name, gs, teamId) => ({ id, name, pos: 'G', teamId, teamAbbr: '', img: '', gp: 60, gs, line: {} });
  E.seedPlayer(st, 'nba', mk('10', 'Star Player', 30, '1'));
  E.seedPlayer(st, 'nba', mk('11', 'Solid Starter', 14, '1'));
  E.seedPlayer(st, 'nba', mk('12', 'Role Player', 8, '2'));
  for (let i = 0; i < 30; i++) E.seedPlayer(st, 'nba', mk(`b${i}`, `Bench ${i}`, 4 + (i % 7), i % 2 ? '2' : '3'));
  E.repriceLeague(st, 'nba', now - 2 * DAY);
  st.lastTick = now - 2 * DAY;
  return st;
}

t('prices order by performance and team quality', () => {
  const st = buildNBA();
  const star = st.assets['nba:p:10'].price, starter = st.assets['nba:p:11'].price, role = st.assets['nba:p:12'].price;
  assert.ok(star > starter && starter > role, `${star} ${starter} ${role}`);
  assert.ok(star > 80 && star < 400, `star price ${star}`);
  assert.ok(role > 5, `role price ${role}`);
  const bos = st.assets['nba:t:1'].price, was = st.assets['nba:t:2'].price, mia = st.assets['nba:t:3'].price;
  assert.ok(bos > mia && mia > was, `${bos} ${mia} ${was}`);
  assert.ok(Math.abs(mia - 60) < 12, `mia ${mia}`);
});

t('a monster game moves the price up and logs a driver', () => {
  const st = buildNBA();
  const a = st.assets['nba:p:11'];
  const before = a.price;
  E.applyFinalGame(st, 'nba', {
    id: 'g1', date: now - 5 * HOUR, preseason: false,
    teams: [{ id: '1', abbr: 'BOS', score: 120, winner: true, home: true }, { id: '2', abbr: 'WAS', score: 99, winner: false, home: false }],
    players: [{ id: '11', name: 'Solid Starter', pos: 'G', teamId: '1', teamAbbr: 'BOS', img: '', line: { min: 38, pts: 44, fgm: 16, fga: 26, ftm: 8, fta: 9, reb: 8, ast: 7, stl: 2, blk: 1, to: 2, pf: 2 } }],
  }, { now });
  assert.ok(a.price > before * 1.05, `${before} -> ${a.price}`);
  assert.ok(a.events.some((e) => e.kind === 'milestone'));
  assert.equal(st.assets['nba:t:1'].rec.w, 51);
  // Replaying the same game is a no-op
  const p = a.price;
  E.applyFinalGame(st, 'nba', { id: 'g1', date: now, teams: [], players: [] }, { now });
  assert.equal(a.price, p);
});

t('injury and bad news push price down, recovery restores it', () => {
  const st = buildNBA();
  const a = st.assets['nba:p:10'];
  const base = a.price;
  E.applyInjuries(st, 'nba', [{ athleteId: '10', status: 'Out', detail: 'Knee' }], { now });
  const hurt = a.price;
  assert.ok(hurt < base * 0.85, `${base} -> ${hurt}`);
  const teamBefore = E.breakdown(st, st.assets['nba:t:1'], now).inj;
  assert.ok(teamBefore < 1, 'team feels the star injury');
  E.applyNews(st, 'nba', [{ id: 'n1', league: 'nba', headline: 'Star Player to undergo surgery, out indefinitely', desc: '', athletes: ['10'], teams: [], published: now }], { now });
  assert.ok(a.price < hurt);
  E.applyInjuries(st, 'nba', [{ athleteId: '99', status: 'Out' }], { now });
  assert.equal(a.injury, null);
  assert.ok(a.price > hurt);
});

t('news shocks decay over time', () => {
  const st = buildNBA();
  const a = st.assets['nba:p:12'];
  E.applyNews(st, 'nba', [{ id: 'n2', league: 'nba', headline: 'Role Player signs extension, named Player of the Week', desc: '', athletes: ['12'], teams: [], published: now }], { now });
  const fresh = E.breakdown(st, a, now).senti;
  const later = E.breakdown(st, a, now + 6 * DAY).senti;
  assert.ok(fresh > 0.03 && later < fresh / 3, `${fresh} ${later}`);
});

t('trading: spread, cash, P/L, and order-flow impact', () => {
  const st = buildNBA();
  const id = 'nba:p:11';
  const p0 = st.assets[id].price;
  const tx = E.trade(st, id, 'buy', 20, now);
  assert.ok(tx.price > p0);
  assert.ok(Math.abs(st.cash - (10000 - tx.total)) < 0.01);
  assert.ok(st.assets[id].price > p0, 'buying lifts the price');
  assert.throws(() => E.trade(st, id, 'sell', 21, now));
  assert.throws(() => E.trade(st, id, 'buy', 100000, now));
  const sell = E.trade(st, id, 'sell', 20, now);
  assert.ok(sell.total < tx.total, 'round trip costs the spread');
  assert.equal(st.holdings[id], undefined);
  assert.ok(E.netWorth(st) < 10000 && E.netWorth(st) > 9900);
});

t('pump-and-dump does not make money', () => {
  const st = buildNBA();
  const id = 'nba:p:12';
  for (let i = 0; i < 10; i++) E.trade(st, id, 'buy', Math.floor(900 / st.assets[id].price), now + i * 1000);
  const qty = st.holdings[id].qty;
  E.trade(st, id, 'sell', qty, now + 20000);
  assert.ok(E.netWorth(st) < 10000, `net worth ${E.netWorth(st)}`);
  // and the reverse: one big buy, many small sells
  const st2 = buildNBA();
  E.trade(st2, id, 'buy', Math.floor(9000 / st2.assets[id].price), now);
  while (st2.holdings[id]) E.trade(st2, id, 'sell', Math.min(st2.holdings[id].qty, 5), now + 1);
  assert.ok(E.netWorth(st2) < 10000, `net worth ${E.netWorth(st2)}`);
});

t('tick keeps prices near target and records history', () => {
  const st = buildNBA();
  for (let i = 1; i <= 200; i++) E.tick(st, now - 2 * DAY + i * 15 * 60e3);
  for (const a of Object.values(st.assets)) {
    const r = a.price / a.target;
    assert.ok(r > 0.9 && r < 1.1, `${a.name} ${r}`);
    assert.ok(a.hist.length >= 4);
    for (let i = 2; i < a.hist.length; i += 2) assert.ok(a.hist[i] >= a.hist[i - 2], 'history sorted');
  }
  assert.ok(st.nw.length > 10);
});

t('history stays capped and sorted', () => {
  const st = buildNBA();
  const a = st.assets['nba:p:10'];
  for (let i = 0; i < 3000; i++) E.tick(st, now + i * 16 * 60e3);
  assert.ok(a.hist.length <= 850, `len ${a.hist.length}`);
  for (let i = 2; i < a.hist.length; i += 2) assert.ok(a.hist[i] > a.hist[i - 2]);
});

t('off-season prior regresses to .500', () => {
  const st = E.newState(10000);
  E.upsertTeam(st, 'nba', { id: '1', abbr: 'OKC', name: 'OKC', w: 68, l: 14, gp: 82, diff: 1000, streak: 5, prior: true });
  E.upsertTeam(st, 'nba', { id: '2', abbr: 'UTA', name: 'UTA', w: 17, l: 65, gp: 82, diff: -1000, streak: -5, prior: true });
  E.repriceLeague(st, 'nba', now);
  const okc = st.assets['nba:t:1'].price, uta = st.assets['nba:t:2'].price;
  assert.ok(okc > uta && okc < 150 && uta > 25, `${okc} ${uta}`);
  // Real season standings replace the prior as soon as games are played
  E.upsertTeam(st, 'nba', { id: '1', abbr: 'OKC', name: 'OKC', w: 0, l: 1, gp: 1, diff: -5, streak: -1 });
  assert.equal(st.assets['nba:t:1'].rec.gp, 1);
});

t('rewind + replay restores team records', () => {
  const st = buildNBA();
  const g = { id: 'g9', date: now - DAY, preseason: false, teams: [{ id: '1', abbr: 'BOS', score: 100, home: true }, { id: '3', abbr: 'MIA', score: 90, home: false }], players: [] };
  E.rewindTeamRecords(st, 'nba', [g]);
  assert.equal(st.assets['nba:t:1'].rec.w, 49);
  E.applyFinalGame(st, 'nba', g, { now, backfill: true });
  assert.equal(st.assets['nba:t:1'].rec.w, 50);
  assert.equal(st.assets['nba:t:3'].rec.l, 35);
});

t('live game moves prices during play', () => {
  const st = buildNBA();
  const a = st.assets['nba:p:12']; const before = a.price;
  E.applyLiveGame(st, 'nba', { id: 'L1', name: 'WAS @ BOS', detail: 'Q3', period: 3, regPeriods: 4,
    teams: [{ id: '1', abbr: 'BOS', score: 70 }, { id: '2', abbr: 'WAS', score: 88 }],
    players: [{ id: '12', name: 'Role Player', pos: 'G', teamId: '2', line: { min: 28, pts: 31, fgm: 11, fga: 16, ftm: 6, fta: 6, reb: 5, ast: 4, stl: 1, blk: 0, to: 1, pf: 2 } }] }, { now });
  assert.ok(a.price > before, `${before} -> ${a.price}`);
  assert.ok(st.assets['nba:t:2'].liveBoost > 0);
  E.clearStaleLive(st, now + 7 * HOUR);
  assert.equal(a.live, null);
});

console.log(`\n${passed} tests passed`);
