// Game ratings checked against ratings the Real app showed for the same stat lines.
import assert from 'node:assert/strict';
import { perfRating, emptyLine } from '../js/scoring.js';

const nfl = (o) => perfRating('nfl', { ...emptyLine('nfl'), ...o });
const mlb = (o) => perfRating('mlb', { ...emptyLine('mlb'), ...o });
const misses = [];
const near = (got, want, tol, what) => { if (Math.abs(got - want) > tol) misses.push(`${what}: got ${got}, Real showed ${want} (allowed ±${tol})`); };

// receivers and backs: yards, touchdowns, catches
near(nfl({ recYds: 63, recTD: 1, rec: 6 }), 3.0, 0.5, 'Allen 63 yds 1 td 6 rec');
near(nfl({ recYds: 5, rec: 1 }), 0.2, 0.5, 'Allen 5 yds 1 rec');
near(nfl({ recYds: 32, rec: 6 }), 1.0, 0.5, 'Allen 32 yds 6 rec');
near(nfl({ recYds: 24, rec: 1 }), 0.8, 0.6, 'Allen 24 yds 1 rec');
near(nfl({ rushYds: 120, recYds: 44, rushTD: 3, rec: 7 }), 9.4, 1.0, 'Gibbs 164 yds 3 td 7 rec');
near(nfl({ rushYds: 80, recYds: 33, rushTD: 1, rec: 6 }), 4.0, 1.0, 'Gibbs 113 yds 1 td 6 rec');
near(nfl({ rushYds: 150, recYds: 36, rushTD: 2, rec: 5 }), 7.8, 1.3, 'Gibbs 186 yds 2 td 5 rec');
near(nfl({ recYds: 128, recTD: 2, rec: 10 }), 6.3, 0.8, 'Smith-Njigba 128 yds 2 td 10 rec');
near(nfl({ recYds: 155, recTD: 3, rec: 9 }), 8.0, 1.0, 'Smith-Njigba 155 yds 3 td 9 rec');
near(nfl({ recYds: 122, recTD: 1, rec: 8 }), 5.2, 0.6, 'Smith-Njigba 122 yds 1 td 8 rec');
// quarterbacks (rushing yards weren't shown, so only what was shown is used)
near(nfl({ att: 30, passYds: 204, int: 2 }), 2.1, 0.5, 'J. Allen 204 pyds 0 ptd 2 int');
near(nfl({ att: 30, passYds: 248, passTD: 3, rushTD: 2 }), 6.4, 0.6, 'J. Allen 248 pyds 3 ptd 2 rutd');
near(nfl({ att: 35, passYds: 334, passTD: 2, rushTD: 2 }), 7.7, 0.6, 'J. Allen 334 pyds 2 ptd 2 rutd');
near(nfl({ att: 12, passYds: 111, passTD: 1 }), 1.7, 0.5, 'J. Allen 111 pyds 1 ptd');
// defenders (quarterback hits and fumble recoveries aren't in the feed this app reads)
near(nfl({ sacks: 1.5, tkl: 2 }), 2.5, 0.3, 'Watt 1.5 sack 2 solo');
near(nfl({ sacks: 2, defInt: 1, tkl: 3 }), 7.0, 0.5, 'Watt 2 sack 1 int');
near(nfl({ tkl: 0, qbh: 1 }), 0, 0.1, 'Watt 1 qbh');
near(nfl({ sacks: 1, qbh: 2, fr: 1, tkl: 1, tfl: 1 }), 5.3, 0.6, 'Watt 1 fr 2 qbh 1 sack');
near(nfl({ tkl: 1, tfl: 1, sacks: 1, qbh: 1, fr: 1 }), 4.7, 0.3, 'Oweh 1 solo 1 tfl 1 sack 1 qbh 1 ff 1 fr');
// NBA (points, rebounds and assists as shown)
const nba = (o) => perfRating('nba', { ...emptyLine('nba'), ...o });
near(nba({ pts: 15, reb: 17, ast: 12 }), 3.9, 0.6, 'Jokic 15/17/12');
near(nba({ pts: 25, reb: 15, ast: 8 }), 5.0, 0.5, 'Jokic 25/15/8');
near(nba({ pts: 33, reb: 15, ast: 12 }), 7.4, 1.0, 'Jokic 33/15/12');
near(nba({ pts: 40, reb: 8, ast: 13 }), 7.6, 0.5, 'Jokic 40/8/13');
near(nba({ pts: 23, reb: 21, ast: 19 }), 7.5, 1.1, 'Jokic 23/21/19');
near(nba({ pts: 35, reb: 14, ast: 13 }), 6.7, 0.5, 'Jokic 35/14/13');
assert.equal(nfl({ car: 10, rushYds: 50, fr: 1 }), nfl({ car: 10, rushYds: 50 }), 'recovering your own fumble is not a defensive play');
{
  const line = { car: 21, rushYds: 81, rushTD: 1, rec: 3, recYds: 39, recTD: 1 };
  assert.equal(nfl(line), 6);
  assert.equal(nfl({ ...line, fr: 1, tkl: 1 }), 6, 'a back with a recovery and a tackle is still rated on his running and catching');
}
// kickers
near(nfl({ fg: 4, xp: 1 }), 6.8, 0.5, 'Shrader 4/4 fg 1/1 xp');
near(nfl({ fg: 3, xp: 3 }), 5.0, 0.5, 'Shrader 3/3 fg 3/3 xp');
near(nfl({ fg: 1, xp: 2 }), 1.4, 0.5, 'Shrader 1/1 fg 2/3 xp');
near(nfl({ fg: 1 }), 2.1, 0.6, 'Shrader 1/1 fg');
near(nfl({ fg: 2 }), 2.7, 0.6, 'Shrader 2/2 fg (53 long)');
near(nfl({ fg: 2 }), 3.7, 0.6, 'Shrader 2/2 fg (61 long)');
// shape: more is better, and the top is a ceiling
assert.ok(nfl({ rushYds: 250, rushTD: 5, rec: 8, recYds: 80 }) <= 15);
assert.ok(perfRating('nba', { ...emptyLine('nba'), pts: 50, reb: 12, ast: 10, stl: 2, blk: 1, to: 3 }) > perfRating('nba', { ...emptyLine('nba'), pts: 20, reb: 5, ast: 4, stl: 1, blk: 0, to: 2 }));
assert.equal(misses.length, 0, '\n' + misses.join('\n'));
console.log('ok - ratings line up with the Real examples');
