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
  const mk = (id, name, gs, teamId) => ({ id, name, pos: 'G', teamId, teamAbbr: '', img: '', gp: 60, gs, line: { min: 30, pts: gs } });
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
  assert.ok(star > 500 && star < 6000, `star price ${star}`);
  assert.ok(star / role > 15, `stars cost far more than role players: ${star} vs ${role}`);
  assert.ok(role > 5, `role price ${role}`);
  const bos = st.assets['nba:t:1'].price, was = st.assets['nba:t:2'].price, mia = st.assets['nba:t:3'].price;
  assert.ok(bos > mia && mia > was, `${bos} ${mia} ${was}`);
  assert.ok(Math.abs(mia - 1000) < 250, `mia ${mia}`);
  assert.ok(bos / was > 4, `good teams cost far more: ${bos} vs ${was}`);
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

t('injury and bad news push price down, being cleared alone does not', () => {
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
  assert.ok(a.rust < 1, 'discount stays after he is cleared');
  assert.ok(E.breakdown(st, a, now).inj < 0.9, 'no bounce just for being cleared');
});

t('back from injury: an ordinary first game earns back a little of the discount, a big one most of it', () => {
  const run = (pts) => {
    const st = buildNBA(); const a = st.assets['nba:p:12'];
    a.rust = 0.72; // back from injured reserve
    const lvl = a.perf.ema; a.perf.rl = E.ratingOf('nba', { pts: lvl }); const p0 = E.targetPrice(st, a, now);
    E.applyFinalGame(st, 'nba', { id: `r${pts}`, date: now, preseason: false, teams: [{ id: '1', abbr: 'BOS', score: 100, home: true }, { id: '2', abbr: 'WAS', score: 90 }],
      players: [{ id: '12', name: 'Role Player', pos: 'G', teamId: '2', line: { min: 30, pts: Math.max(0, lvl + pts), fgm: 0, fga: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 } }] }, { now: now + 3 * HOUR });
    return { move: E.targetPrice(st, a, now + 3 * HOUR) / p0 - 1, rust: a.rust ?? 1 };
  };
  const usual = run(0); const poor = run(-6); const great = run(15);
  assert.ok(usual.move > 0.04 && usual.move < 0.13, `ordinary game: ${usual.move}`);
  assert.ok(usual.rust < 0.85, 'most of the discount is still there after an ordinary game');
  assert.ok(poor.move < 0.03, `poor game: ${poor.move}`);
  assert.ok(great.move > 0.25 && great.rust > 0.85, `standout game: ${great.move} ${great.rust}`);
});

t('one-time fix: a return bounce from an ordinary game is scaled back, once', () => {
  const st = buildNBA(); const a = st.assets['nba:p:12'];
  const tc = now - 2 * DAY;
  a.events = [{ t: tc, kind: 'injury', text: 'Cleared: back from "Injured Reserve"', pct: 0 }, { t: tc - 20 * DAY, kind: 'injury', text: 'Injured Reserve — Knee', pct: -0.28 }];
  a.perf.last.unshift({ e: 'x', t: tc + DAY, gs: a.perf.ema, text: '20 PTS', line: null });
  a.rust = 0.72 + 0.28 * 0.6; // what the old rule gave for an ordinary game
  const p0 = E.targetPrice(st, a, now);
  st.rustV = 1;
  assert.ok(E.undoReturnBounce(st, now) === 1);
  assert.ok(Math.abs(a.rust - (0.72 + 0.28 * 0.25)) < 0.02, `rust ${a.rust}`);
  const drop = E.targetPrice(st, a, now) / p0 - 1;
  assert.ok(drop < -0.08 && drop > -0.15, `price ${drop}`);
  assert.equal(E.undoReturnBounce(st, now + 1000), 0, 'only once');
  // Someone whose bounce was earned by a big game keeps it.
  const st2 = buildNBA(); const b = st2.assets['nba:p:12'];
  b.events = a.events.map((e) => ({ ...e })); b.perf.last.unshift({ e: 'y', t: tc + DAY, gs: b.perf.ema + 20, text: '40 PTS', line: null }); b.rust = 0.888; st2.rustV = 1;
  assert.equal(E.undoReturnBounce(st2, now), 0);
  assert.equal(b.rust, 0.888);
});

t('learned game noise never drops below its starting value', () => {
  const st = buildNBA();
  st.gnoise = { nba: { ALL: 3 } };
  assert.equal(E.gameNoise(st, 'nba', 'ALL'), 7.5);
  st.gnoise.nba.ALL = 9; assert.equal(E.gameNoise(st, 'nba', 'ALL'), 9);
});

t('one-time fix: the last game under the shrunken noise is re-priced, both ways, once', () => {
  const play = (pts, { rust } = {}) => {
    const st = buildNBA(); const a = st.assets['nba:p:12'];
    st.gnoise = { nba: { ALL: 3.5 } }; // what the learning had shrunk it to
    const grp = 'ALL'; const sd = st.stats.nba[grp].sd;
    const aOld = Math.min(0.35, 0.06 * sd / (0.75 * 3.5));
    const before = a.perf.ema; const gs = before + pts; const t = now - 20 * HOUR;
    const max = Math.log(1.25) / 0.75 * sd;
    a.perf.ema = before + Math.max(-max, Math.min(max, aOld * (gs - before))); // what the old code did
    a.perf.last.unshift({ e: 'g', t, gs, text: `${Math.round(gs)} PTS vs MIN` });
    a.events = [{ t, kind: 'game', text: 'x', pct: 0.2 }];
    if (rust) { a.rust = rust; a.events.push({ t: t - 2 * DAY, kind: 'injury', text: 'Cleared: back from "Questionable"', pct: 0 }); }
    E.repriceLeague(st, 'nba', now);
    const p0 = E.targetPrice(st, a, now);
    E.repairLastGames(st, now);
    const right = before + 0.06 * sd / (0.75 * 7.5) * (gs - before);
    return { a, st, move: E.targetPrice(st, a, now) / p0 - 1, right };
  };
  const td = play(+9); // a fluky big game
  assert.ok(Math.abs(td.a.perf.ema - td.right) < 0.01, `level as the floored noise gives it: ${td.a.perf.ema} vs ${td.right}`);
  assert.ok(td.move < -0.05, `jump comes down: ${td.move}`);
  const poor = play(-9);
  assert.ok(poor.move > 0.05, `drop comes back up: ${poor.move}`);
  assert.equal(E.repairLastGames(td.st, now + 1000), 0, 'only once');
  // IR discount carried through a "Questionable" listing, then a 60% bounce for an ordinary game.
  const ret = play(0, { rust: 0.748 + 0.252 * 0.6 });
  assert.ok(Math.abs(ret.a.rust - (0.748 + 0.252 * 0.25)) < 0.01, `rust ${ret.a.rust}`);
  assert.ok(ret.move < -0.08, `bounce scaled back: ${ret.move}`);
});

t('game moves follow the rating: a quiet touchdown or a tackle pile is not a breakout', () => {
  const st = E.newState(100);
  for (let i = 0; i < 8; i++) E.upsertTeam(st, 'nfl', { id: `T${i}`, abbr: `T${i}`, name: `T${i}`, w: 3, l: 3, gp: 6, diff: 0, streak: 0 });
  const L = (o) => ({ ...S.emptyLine('nfl'), ...o });
  for (let i = 0; i < 60; i++) E.seedPlayer(st, 'nfl', { id: `w${i}`, name: `w${i}`, pos: i % 3 ? 'WR' : 'TE', teamId: `T${i % 8}`, gp: 7, gs: 2 + (i % 12), line: L({ rec: 1 + (i % 6), recYds: 10 + (i % 12) * 7 }) });
  for (let i = 0; i < 90; i++) E.seedPlayer(st, 'nfl', { id: `d${i}`, name: `d${i}`, pos: ['LB', 'S', 'CB'][i % 3], teamId: `T${i % 8}`, gp: 7, gs: 2 + (i % 7), line: L({ tkl: 2 + (i % 7), pd: (i % 3) / 3 }) });
  E.initForm(st, 'nfl', { all: true }); E.repriceLeague(st, 'nfl', now);
  const play = (id, ln) => { const a = st.assets[`nfl:p:${id}`]; const p0 = E.targetPrice(st, a, now);
    E.applyFinalGame(st, 'nfl', { id: `g${id}`, date: now, preseason: false, teams: [{ id: 'T1', abbr: 'A', score: 20, home: true }, { id: 'T2', abbr: 'B', score: 10 }], players: [{ id, name: id, pos: a.pos, teamId: 'T1', line: L(ln) }] }, { now: now + 4 * HOUR });
    return E.targetPrice(st, a, now + 4 * HOUR) / p0 - 1; };
  const td = play('w0', { rec: 2, recYds: 24, recTD: 1 }); // a backup tight end's touchdown
  assert.ok(td > 0.02 && td < 0.14, `quiet touchdown game: ${td}`);
  const tackles = play('d4', { tkl: 12 }); // a linebacker who usually makes ~6
  assert.ok(tackles > 0.02 && tackles < 0.14, `12-tackle game: ${tackles}`);
  const pick6 = play('d7', { tkl: 5, defInt: 1, defTD: 1 });
  assert.ok(pick6 > 0.2, `pick-six is a big game: ${pick6}`);
  const dud = play('w5', { rec: 0 });
  assert.ok(dud < 0, `no catches: ${dud}`);
});

t('NFL box-score players get a position from their stat line', () => {
  assert.equal(S.inferNflPos({ rec: 2, recYds: 24 }), 'WR');
  assert.equal(S.inferNflPos({ car: 3, rushYds: 23, rec: 1 }), 'RB');
  assert.equal(S.inferNflPos({ att: 30, cmp: 20, car: 3 }), 'QB');
  assert.equal(S.inferNflPos({ tkl: 5 }), 'DB'); assert.equal(S.posGroup('nfl', 'DB'), 'DEF');
  assert.equal(S.inferNflPos({ fg: 2, xp: 3 }), 'PK');
  assert.equal(S.inferNflPos({ rec: 1 }, { rec: 3 }, { car: 1 }), 'WR', 'several lines are summed');
});

t('the trading day rolls over at 4am New York time', () => {
  const at = (iso) => new Date(E.dayOpen(Date.parse(iso))).toISOString();
  assert.equal(at('2026-10-26T17:11:00Z'), '2026-10-26T08:00:00.000Z'); // Monday afternoon: since Monday 4am EDT
  assert.equal(at('2026-10-26T07:00:00Z'), '2026-10-25T08:00:00.000Z'); // 3am ET: still Sunday's day (games just ended)
  assert.equal(at('2026-12-15T12:00:00Z'), '2026-12-15T09:00:00.000Z'); // winter: 4am EST
});

t("today is measured from the last real price before the open, not the chart's filled-in hours", () => {
  const st = buildNBA(); const a = st.assets['nba:p:11'];
  const open = E.dayOpen(now); const closedAt = open - 6 * HOUR;
  st.nw = [closedAt - 60e3, 100]; // the app was last open six hours before the open
  a.hist = [closedAt, 10, open - HOUR, 13, open + HOUR, 13]; a.price = 13; // made-up wiggle while closed
  E.updateDayRef(st, open + 2 * HOUR);
  assert.ok(Math.abs(E.change(a, open + 2 * HOUR) - 0.3) < 1e-9, 'from the real $10, not the filled-in $13');
  st.nw.push(open - 5 * 60e3, 100); E.updateDayRef(st, open + 2 * HOUR); // open across the open: its own price
  assert.ok(Math.abs(E.change(a, open + 2 * HOUR)) < 1e-9);
  E.updateDayRef(E.newState(5), open + 2 * HOUR); // no history: plain open
});

t('one-time pricing repair: random market-event jolts are taken back, charts follow, once', () => {
  const st = buildNBA(); const a = st.assets['nba:p:11'];
  const t0 = now - 10 * HOUR; const start = now - 4 * HOUR;
  st.events = { nba: { name: 'Awards buzz', start, end: start + 6 * HOUR } };
  st.nw = [start - 3 * HOUR, 100]; // the app was last open three hours before the event
  a.events = []; a.hist = []; for (let t = t0; t <= now; t += 15 * 60e3) a.hist.push(t, t < start - 2 * HOUR ? a.price : Math.round(a.price * 1.18 * 100) / 100);
  const p0 = a.price; a.h = (a.h || 0) + Math.log(1.18); E.repriceLeague(st, 'nba', now, { record: false });
  st.priceFixV = 0;
  const r = E.repairPricing(st, now);
  assert.ok(r.jolts >= 1);
  assert.ok(Math.abs(a.price / p0 - 1) < 0.02, `back to before: ${p0} -> ${a.price}`);
  assert.ok(Math.abs(a.hist[a.hist.length - 1] / p0 - 1) < 0.02, 'chart no longer shows the jump');
  assert.equal(E.repairPricing(st, now + 1000), null, 'only once');
});

t('one-time pricing repair: a weekend game priced by the old rule is re-priced on its rating', () => {
  const st = buildNBA(); const a = st.assets['nba:p:12'];
  st.gnoise = { nba: { ALL: 3.5 } };
  const sd = st.stats.nba.ALL.sd; const aOld = Math.min(0.35, 0.06 * sd / (0.75 * 3.5)); const max = Math.log(1.25) / 0.75 * sd;
  const before = a.perf.ema; const t = now - 20 * HOUR; const gs = before + 9; // a fluky big night by the old score
  const line = { min: 30, pts: Math.round(before) + 1 }; // ...that rates only a little above his usual
  a.perf.rt = [[t - 3 * DAY, E.ratingOf('nba', { min: 30, pts: before })], [t - 2 * DAY, E.ratingOf('nba', { min: 30, pts: before })]];
  const p0 = E.targetPrice(st, a, now);
  a.perf.ema = before + Math.max(-max, Math.min(max, aOld * (gs - before)));
  const jump = E.targetPrice(st, a, now) / p0 - 1;
  a.perf.n = 5; a.perf.last.unshift({ e: 'g', t, gs, text: 'x vs MIN', line });
  a.events = [{ t: t + 3 * HOUR, kind: 'game', text: 'x vs MIN', pct: jump }, { t: now - HOUR, kind: 'injury', text: 'Return bounce scaled to how he has played', pct: -0.01 }];
  a.hist = [t - HOUR, 10, t + 3 * HOUR, 10 * (1 + jump), now - HOUR, 10 * (1 + jump) * 0.99];
  E.repriceLeague(st, 'nba', now, { record: false });
  st.priceFixV = 0; const pBefore = a.price;
  E.repairPricing(st, now);
  assert.ok(jump > 0.15, `old rule: ${jump}`);
  const g0 = a.events.find((e) => e.kind === 'game');
  assert.ok(a.price < pBefore * 0.9, `re-priced down: ${pBefore} -> ${a.price} (old jump ${jump}, game now ${g0.pct}, rating ${E.ratingOf('nba', line)} usual ${a.perf.rt[0][1]})`);
  const games = a.events.filter((e) => e.kind === 'game');
  assert.equal(games.length, 1); assert.ok(!a.events.some((e) => /^Return bounce/.test(e.text)), 'earlier fix folded into the game'); assert.ok(games[0].pct < 0.08 && games[0].pct > -0.02, `game now ${games[0].pct}`);
  assert.ok(Math.abs(a.hist[a.hist.length - 1] / 10 - (1 + games[0].pct)) < 0.03, 'chart from the game on follows');
  assert.equal(a.hist[1], 10, 'before the game untouched');
});

t('a monster game gets a fading big-game boost even for a star playing to his level', () => {
  const st = buildNBA(); const a = st.assets['nba:p:10'];
  const line = { min: 36, pts: 31, reb: 12, ast: 6, stl: 1, blk: 1, to: 3, fgm: 0, fga: 0, ftm: 0, fta: 0, pf: 0 };
  a.perf.rl = E.ratingOf('nba', line); a.perf.rv = E.ratingValue(a.perf.rl); // his usual is already this good
  const p0 = E.targetPrice(st, a, now);
  E.applyFinalGame(st, 'nba', { id: 'big', date: now, preseason: false, teams: [{ id: '1', abbr: 'BOS', score: 120, home: true }, { id: '2', abbr: 'DEN', score: 110 }],
    players: [{ id: '10', name: 'Star Player', pos: 'G', teamId: '1', line }] }, { now: now + 3 * HOUR });
  const up = E.targetPrice(st, a, now + 3 * HOUR) / p0 - 1;
  assert.ok(up > 0.05 && up < 0.11, `31/12/6 for a star at his usual: only the boost: ${up}`);
  const later = E.targetPrice(st, a, now + 3 * HOUR + 8 * DAY) / p0 - 1;
  assert.ok(later < up / 3, `fades: ${later}`);
  assert.equal(E.bigGameBoost(st, 'nba', 'ALL', 2.0), 0, 'an ordinary night gets nothing');
  assert.ok(Math.abs(E.bigGameBoost(st, 'nba', 'ALL', 9) - E.BIG_GAME_MAX) < 1e-9, 'capped');
});

t('rating value curve follows Real: 4 or less as is, then faster (5→6, 7→12, 8→16, 10→24)', () => {
  for (const [r, v] of [[-1, -1], [3, 3], [4, 4], [5, 6], [7, 12], [8, 16], [10, 24], [11, 28]]) assert.equal(E.ratingValue(r), v);
  assert.ok(E.ratingValue(6) - E.ratingValue(5) > E.ratingValue(3) - E.ratingValue(2), 'a point is worth more near the top');
});

t('prices go down after below-usual games as surely as up after big ones (no drift)', () => {
  const st = buildNBA(); const a = st.assets['nba:p:11'];
  a.perf.avg = { min: 32, pts: 14, reb: 5, ast: 4, stl: 1, blk: 0, to: 2 }; delete a.perf.rl; delete a.perf.rv; a.perf.rt = [];
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const p0 = E.targetPrice(st, a, now); let downs = 0; let ups = 0; let last = p0;
  for (let i = 0; i < 60; i++) {
    const pts = Math.max(0, Math.round(14 + 7 * (rnd() + rnd() + rnd() - 1.5) * 1.4));
    E.applyFinalGame(st, 'nba', { id: `d${i}`, date: now + i * DAY, preseason: false, teams: [{ id: '1', abbr: 'BOS', score: 100, home: true }, { id: '2', abbr: 'WAS', score: 90 }],
      players: [{ id: '11', name: 'Solid Starter', pos: 'G', teamId: '1', line: { min: 32, pts, reb: 5, ast: 4, stl: 1, blk: 0, to: 2, fgm: 0, fga: 0, ftm: 0, fta: 0, pf: 0 } }] }, { now: now + i * DAY + 3 * HOUR });
    const p = E.targetPrice(st, a, now + i * DAY + 3 * HOUR); if (p < last * 0.995) downs++; if (p > last * 1.005) ups++; last = p;
  }
  assert.ok(downs >= 15 && ups >= 15, `both ways: ${downs} down, ${ups} up`);
  const drift = E.targetPrice(st, a, now + 70 * DAY) / p0 - 1;
  assert.ok(Math.abs(drift) < 0.25, `same player, same level: no runaway drift (${drift})`);
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
    const r = a.price / (a.target * Math.exp(a.h || 0));
    assert.ok(r > 0.93 && r < 1.07, `${a.name} ${r}`);
    assert.ok(Math.abs(a.h || 0) < 0.35, `hype ${a.h}`);
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

t('last season sets the starting price, regressed toward .500', () => {
  const st = E.newState(10000);
  for (const [id, abbr] of [['1', 'OKC'], ['2', 'UTA'], ['3', 'MID']]) E.upsertTeam(st, 'nba', { id, abbr, name: abbr, w: 0, l: 0, gp: 0, diff: 0, streak: 0 });
  E.setTeamPrior(st, 'nba', { id: '1', w: 68, l: 14, gp: 82, diff: 1000 });
  E.setTeamPrior(st, 'nba', { id: '2', w: 17, l: 65, gp: 82, diff: -1000 });
  E.setTeamPrior(st, 'nba', { id: '3', w: 41, l: 41, gp: 82, diff: 0 });
  E.repriceLeague(st, 'nba', now);
  const okc = st.assets['nba:t:1'].price, uta = st.assets['nba:t:2'].price;
  assert.ok(okc > 2400 && uta < 500, `${okc} ${uta}`);
  // A champion that starts 0-3 is still priced as a good team
  E.upsertTeam(st, 'nba', { id: '1', abbr: 'OKC', name: 'OKC', w: 0, l: 3, gp: 3, diff: -15, streak: -3 });
  E.repriceLeague(st, 'nba', now);
  assert.equal(st.assets['nba:t:1'].rec.gp, 3);
  assert.ok(st.assets['nba:t:1'].price > 1800, `${st.assets['nba:t:1'].price}`);
  // Win chances follow price
  assert.ok(E.teamWinProb(st, 'nba', '1', '2', true) > 0.7);
});

t('a star priced at his level does not drift up by playing to it', () => {
  const st = buildNBA();
  const a = st.assets['nba:p:10'];
  const p0 = E.fairOnly(st, a);
  for (let i = 0; i < 10; i++) {
    E.applyFinalGame(st, 'nba', { id: `s${i}`, date: now + i * DAY, preseason: false, teams: [{ id: '1', abbr: 'BOS', score: 100, home: true }, { id: '2', abbr: 'WAS', score: 90 }],
      players: [{ id: '10', name: 'Star Player', pos: 'G', teamId: '1', line: { min: 36, pts: a.perf.ema, fgm: 0, fga: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 } }] }, { now: now + i * DAY + 3 * HOUR });
  }
  const r = E.fairOnly(st, a) / p0;
  assert.ok(Math.abs(r - 1) < 0.01, `fair value moved ${r}`);
  assert.equal(st.divs.filter((d) => d.id === a.id).length, 0, 'no dividends for an ordinary game');
});

t('each game log row keeps the move its result caused, with the sign of the surprise', () => {
  const st = buildNBA();
  const a = st.assets['nba:p:12'];
  const line = (pts) => ({ min: 30, pts, fgm: 0, fga: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 });
  const game = (id, i, pts, preseason) => ({ id, date: now + i * DAY, preseason, teams: [{ id: '1', abbr: 'BOS', score: 100, home: true }, { id: '2', abbr: 'WAS', score: 90 }],
    players: [{ id: '12', name: 'Role Player', pos: 'G', teamId: '2', line: line(pts) }] });
  const lvl = a.perf.ema;
  E.applyFinalGame(st, 'nba', game('p1', 0, Math.max(0, lvl - 8), true), { now: now + 3 * HOUR });
  const pre = a.perf.last[0];
  assert.equal(pre.e, 'p1'); assert.ok(pre.pct < 0, `poor preseason game ${pre.pct}`);
  assert.ok(pre.pct > -0.08, `preseason counts for a third: ${pre.pct}`);
  E.applyFinalGame(st, 'nba', game('r1', 1, lvl + 12, false), { now: now + DAY + 3 * HOUR });
  const reg = a.perf.last[0];
  assert.equal(reg.e, 'r1'); assert.ok(reg.pct > 0.03, `big regular-season game ${reg.pct}`);
  assert.equal(a.perf.last[1].pct, pre.pct, 'older rows keep their move');
});

t('model upgrade converts holdings at equal value', () => {
  const st = buildNBA();
  E.trade(st, 'nba:p:10', 'buy', 2, now);
  E.trade(st, 'nba:p:12', 'buy', 30, now);
  const nw0 = E.netWorth(st, now);
  st.modelV = 1;
  // simulate the old model's prices
  for (const a of Object.values(st.assets)) { a.price = Math.round(a.price * (a.kind === 'player' ? 0.4 : 0.8) * 100) / 100; for (let i = 1; i < a.hist.length; i += 2) a.hist[i] *= 0.4; }
  st.alerts.push({ id: 'al', assetId: 'nba:p:10', ticker: 'X', price: st.assets['nba:p:10'].price * 1.1, dir: 'above' });
  const nwOld = E.netWorth(st, now);
  assert.ok(E.upgradeModel(st, now));
  assert.ok(Math.abs(E.netWorth(st, now) - nwOld) < 0.05, `${nwOld} -> ${E.netWorth(st, now)}`);
  assert.ok(Math.abs(st.alerts[0].price / st.assets['nba:p:10'].price - 1.1) < 0.01);
  assert.equal(E.upgradeModel(st, now), false, 'runs once');
  assert.ok(nw0 > 0);
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

t('restarting charts flattens player history but keeps value', () => {
  const st = buildNBA();
  for (let i = 1; i <= 50; i++) E.tick(st, now - 2 * DAY + i * 30 * 60e3);
  E.trade(st, 'nba:p:10', 'buy', 1, now);
  const nw = E.netWorth(st, now);
  E.resetHistory(st, now);
  const a = st.assets['nba:p:10'];
  assert.equal(a.hist.length, 4);
  assert.equal(E.change(a, now, DAY), 0);
  assert.equal(E.netWorth(st, now), nw);
  E.tick(st, now + 20 * 60e3);
  assert.ok(a.hist.length >= 4);
});

t('chart gaps from time away are filled with market wiggle; real points and jumps are kept', () => {
  const st = E.newState(100);
  const t0 = 1e12; const H = 3600e3;
  st.assets.x = { id: 'x', kind: 'player', league: 'nba', hist: [t0, 10, t0 + 60e3, 10.02, t0 + 9 * H, 10.3, t0 + 9 * H + 60e3, 10.31, t0 + 20 * H, 14, t0 + 20 * H + 5 * 60e3, 14.05] };
  const real = st.assets.x.hist.slice();
  assert.equal(E.fillGaps(st, t0 + 21 * H), 2);
  const h = st.assets.x.hist;
  for (let i = 0; i < real.length; i += 2) { const j = h.indexOf(real[i]); assert.ok(j >= 0 && j % 2 === 0 && h[j + 1] === real[i + 1], 'recorded point kept'); }
  for (let i = 2; i < h.length; i += 2) { assert.ok(h[i] > h[i - 2], 'in time order'); assert.ok(h[i] - h[i - 2] <= 40 * 60e3 + 1000, 'no long straight stretch left'); }
  const first = []; const second = [];
  for (let i = 0; i < h.length; i += 2) { if (h[i] > t0 + 60e3 && h[i] < t0 + 9 * H) first.push(h[i + 1]); if (h[i] > t0 + 9 * H + 60e3 && h[i] < t0 + 20 * H) second.push(h[i + 1]); }
  assert.ok(first.length >= 20 && new Set(first).size > 10, 'wiggles, not a ramp');
  let turns = 0; for (let i = 2; i < first.length; i++) if ((first[i] - first[i - 1]) * (first[i - 1] - first[i - 2]) < 0) turns++;
  assert.ok(turns >= 5, `changes direction: ${turns}`);
  assert.ok(first.every((p) => p > 8.8 && p < 11.6));
  const hold = []; const game = [];
  for (let i = 0; i < h.length; i += 2) { if (h[i] > t0 + 9 * H + 60e3 && h[i] < t0 + 17 * H) hold.push(h[i + 1]); if (h[i] > t0 + 17 * H && h[i] < t0 + 20 * H) game.push(h[i + 1]); }
  assert.ok(hold.every((p) => p < 11.9), 'before a big result the price stays at the old level');
  assert.ok(game.length >= 8 && game.some((p) => p > 11) && game.every((p) => p > 8 && p < 17), 'the move happens over the game, choppily');
  let gt = 0; for (let i = 2; i < game.length; i++) if ((game[i] - game[i - 1]) * (game[i - 1] - game[i - 2]) < 0) gt++;
  assert.ok(gt >= 2, `the game move is not one straight line: ${gt}`);
  assert.equal(E.fillGaps(st, t0 + 22 * H), 0, 'filling twice changes nothing');
});

t('gap filling only looks at the part of the chart since the last fill', () => {
  const st = E.newState(100); const t0 = 1e12; const H = 3600e3;
  st.assets.x = { id: 'x', kind: 'player', league: 'nba', hist: [t0, 10, t0 + 60e3, 10, t0 + 9 * H, 10.2] };
  assert.equal(E.fillGaps(st, t0 + 10 * H), 1);
  const before = st.assets.x.hist.slice();
  st.assets.x.hist.push(t0 + 15 * H, 10.5); // the app was closed again
  assert.equal(E.fillGaps(st, t0 + 16 * H), 1, 'only the new gap');
  assert.deepEqual(st.assets.x.hist.slice(0, before.length), before, 'earlier chart untouched');
  st.assets.x.hist = [t0, 10, t0 + 5 * H, 11]; // charts restarted: a fill mark past the chart is ignored
  assert.equal(E.fillGaps(st, t0 + 6 * H), 1);
});

t('ratings over 7 days, 30 days and the season stay on the 0-15 scale', () => {
  const st = E.newState(100); st.stats = { nba: { ALL: { mu: 20, sd: 6 } } };
  const now = 1.8e12; const D = 86400e3;
  const L = (pts) => ({ pts, reb: 5, ast: 5, stl: 1, blk: 0, to: 2 });
  const p = { kind: 'player', league: 'nba', pos: 'G', perf: { ema: 20, gn: 8, last: [[1, 45], [3, 15], [10, 15], [20, 15], [40, 30]].map(([d, pts]) => ({ t: now - d * D, gs: pts, line: L(pts) })) } };
  const one = (pts) => E.gameRating(st, p, { line: L(pts) });
  const r = (x) => Math.round(x * 10) / 10;
  const w = E.formRating(st, p, '7d', now); assert.equal(w.sum, r(one(45) + one(15))); assert.equal(w.n, 2); assert.equal(w.rating, r((one(45) + one(15)) / 2));
  const m = E.formRating(st, p, '30d', now); assert.equal(m.sum, r(one(45) + 3 * one(15))); assert.equal(m.n, 4); assert.equal(m.rating, r(m.sum / 4));
  assert.equal(E.formRating(st, p, 'season', now).rating, r((one(45) + 3 * one(15) + one(30)) / 5));
  // games from before ratings were kept: the season averages fill in the season
  p.perf.avg = L(20); p.perf.season = { gs: 20, gp: 60 };
  const s = E.formRating(st, p, 'season', now); assert.equal(s.n, 60); assert.equal(s.rating, one(20)); assert.ok(s.rating <= 15 && s.rating >= 0);
  // kept ratings outlive the ten-game log
  p.perf.rt = [[now - 2 * D, 9]]; assert.equal(E.formRating(st, p, '7d', now).sum, r(one(45) + one(15) + 9));
  assert.equal(E.formRating(st, { ...p, perf: { last: [] } }, '7d', now), null); assert.equal(E.formRating(st, { kind: 'team' }), null);
  assert.ok(E.gameRating(st, p, { gs: 30 }) != null, 'old saved games without a stat line still get a rating');
});

console.log(`\n${passed} tests passed`);
