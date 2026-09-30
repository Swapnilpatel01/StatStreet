// Parser checks against trimmed copies of real ESPN responses (Sept 2026).
import assert from 'node:assert/strict';
import * as S from '../js/scoring.js';

const nbaSeason = {
  categories: [
    { name: 'general', names: ['gamesPlayed','avgMinutes','avgFouls','flagrantFouls','technicalFouls','ejections','doubleDouble','tripleDouble','minutes','rebounds','fouls','avgRebounds'] },
    { name: 'offensive', names: ['avgPoints','avgFieldGoalsMade','avgFieldGoalsAttempted','fieldGoalPct','avgThreePointFieldGoalsMade','avgThreePointFieldGoalsAttempted','threePointFieldGoalPct','avgFreeThrowsMade','avgFreeThrowsAttempted','freeThrowPct','avgAssists','avgTurnovers','points','fieldGoalsMade','fieldGoalsAttempted','threePointFieldGoalsMade','threePointFieldGoalsAttempted','freeThrowsMade','freeThrowsAttempted','assists','turnovers'] },
    { name: 'defensive', names: ['avgSteals','avgBlocks','steals','blocks'] },
  ],
  athletes: [{
    athlete: { id: '3945274', displayName: 'Luka Doncic', firstName: 'Luka', lastName: 'Doncic', position: { abbreviation: 'G' }, teamId: '13', teamShortName: 'LAL', headshot: { href: 'x.png' } },
    categories: [
      { name: 'general', values: [64.0,35.765625,2.390625,0.0,17.0,0.0,34.0,8.0,2289.0,495.0,153.0,7.734375] },
      { name: 'offensive', values: [33.484375,10.828125,22.765625,47.56,3.96875,10.84375,36.6,7.859375,10.078125,77.98,8.28125,3.984375,2143.0,693.0,1457.0,254.0,694.0,503.0,645.0,530.0,255.0] },
      { name: 'defensive', values: [1.640625,0.53125,105.0,34.0] },
    ],
  }],
};

const rows = S.parseSeasonAthletes('nba', nbaSeason);
assert.equal(rows.length, 1);
assert.equal(rows[0].teamAbbr, 'LAL');
assert.ok(Math.abs(rows[0].line.pts - 33.48) < 0.01);
assert.ok(rows[0].gs > 25 && rows[0].gs < 29, `gs ${rows[0].gs}`);
console.log('ok - NBA season parse, Luka game score', rows[0].gs.toFixed(1));

const mlbStandings = { children: [{ standings: { season: 2026, entries: [{
  team: { id: '30', abbreviation: 'TB', displayName: 'Tampa Bay Rays', logos: [{ href: 'tb.png', rel: ['full', 'default'] }] },
  stats: [
    { name: 'wins', value: 76 }, { name: 'losses', value: 51 }, { name: 'gamesPlayed', value: 127 },
    { name: 'pointDifferential', value: 45 }, { name: 'streak', value: -1 }, { name: 'playoffPercent', value: 100 },
    { name: 'overall', summary: '76-51' },
  ] }] } }] };
const teams = S.parseStandings('mlb', mlbStandings);
assert.deepEqual([teams[0].w, teams[0].l, teams[0].gp, teams[0].diff, teams[0].playoffPct, teams[0].logo], [76, 51, 127, 45, 100, 'tb.png']);
console.log('ok - MLB standings parse');

const sb = S.parseScoreboard('nfl', { events: [{ id: '401872953', date: '2026-09-27T17:00Z', shortName: 'LAC @ BUF', season: { type: 2 },
  status: { period: 4, displayClock: '0:00', type: { state: 'post', completed: true, shortDetail: 'Final' } },
  competitions: [{ format: { regulation: { periods: 4 } }, competitors: [
    { homeAway: 'home', winner: true, score: '24', team: { id: '2', abbreviation: 'BUF' } },
    { homeAway: 'away', winner: false, score: '16', team: { id: '24', abbreviation: 'LAC' } }] }] }] });
assert.equal(sb[0].completed, true);
assert.equal(sb[0].teams[0].score, 24);
assert.equal(sb[0].preseason, false);
console.log('ok - NFL scoreboard parse');

const inj = S.parseInjuries({ injuries: [{ injuries: [{ status: 'Questionable', shortComment: 'Ankle', athlete: { displayName: 'X', links: [{ href: 'https://www.espn.com/nfl/player/_/id/4241478/devonta-smith' }] } }] }] });
assert.equal(inj[0].athleteId, '4241478');
console.log('ok - injuries parse (id from link)');

const news = S.parseNews('nfl', { articles: [{ dataSourceIdentifier: 'abc', headline: 'H', description: 'D', published: '2026-09-28T10:00:00Z',
  links: { web: { href: 'https://espn.com/x' } }, categories: [{ type: 'athlete', athleteId: 3139477 }, { type: 'team', teamId: 12 }] }] });
assert.deepEqual([news[0].athletes, news[0].teams], [['3139477'], ['12']]);
console.log('ok - news parse');
