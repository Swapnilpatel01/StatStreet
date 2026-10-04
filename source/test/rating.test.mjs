// Game ratings checked against ratings the Real app showed for the same stat lines.
import assert from 'node:assert/strict';
import { perfRating, emptyLine } from '../js/scoring.js';

const nfl = (o) => perfRating('nfl', { ...emptyLine('nfl'), ...o });
const mlb = (o) => perfRating('mlb', { ...emptyLine('mlb'), ...o });
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got}, Real showed ${want}`);

// receivers and backs: yards, touchdowns, catches
near(nfl({ recYds: 63, recTD: 1, rec: 6 }), 3.0, 0.5, 'Allen 63 yds 1 td 6 rec');
near(nfl({ recYds: 5, rec: 1 }), 0.2, 0.5, 'Allen 5 yds 1 rec');
near(nfl({ recYds: 32, rec: 6 }), 1.0, 0.5, 'Allen 32 yds 6 rec');
near(nfl({ recYds: 24, rec: 1 }), 0.8, 0.6, 'Allen 24 yds 1 rec');
near(nfl({ rushYds: 120, recYds: 44, rushTD: 3, rec: 7 }), 9.4, 1.0, 'Gibbs 164 yds 3 td 7 rec');
near(nfl({ rushYds: 80, recYds: 33, rushTD: 1, rec: 6 }), 4.0, 0.6, 'Gibbs 113 yds 1 td 6 rec');
near(nfl({ rushYds: 150, recYds: 36, rushTD: 2, rec: 5 }), 7.8, 1.3, 'Gibbs 186 yds 2 td 5 rec');
near(nfl({ recYds: 128, recTD: 2, rec: 10 }), 6.3, 0.8, 'Smith-Njigba 128 yds 2 td 10 rec');
near(nfl({ recYds: 155, recTD: 3, rec: 9 }), 8.0, 1.0, 'Smith-Njigba 155 yds 3 td 9 rec');
near(nfl({ recYds: 122, recTD: 1, rec: 8 }), 5.2, 0.6, 'Smith-Njigba 122 yds 1 td 8 rec');
// quarterbacks (rushing yards weren't shown; filled in to match the fantasy points Real showed)
near(nfl({ att: 30, passYds: 204, int: 2, rushYds: 53, rushTD: 1 }), 2.1, 1.2, 'J. Allen 204 pyds 0 ptd 2 int');
near(nfl({ att: 30, passYds: 248, passTD: 3, rushYds: 69, rushTD: 2 }), 6.4, 1.3, 'J. Allen 248 pyds 3 ptd 2 rutd');
near(nfl({ att: 35, passYds: 334, passTD: 2, rushYds: 24, rushTD: 2 }), 7.7, 1.3, 'J. Allen 334 pyds 2 ptd 2 rutd');
near(nfl({ att: 12, passYds: 111, passTD: 1 }), 1.7, 0.5, 'J. Allen 111 pyds 1 ptd');
// defenders (quarterback hits and fumble recoveries aren't in the feed this app reads)
near(nfl({ sacks: 1.5, tkl: 2 }), 2.5, 0.3, 'Watt 1.5 sack 2 solo');
near(nfl({ sacks: 2, defInt: 1, tkl: 3 }), 7.0, 0.5, 'Watt 2 sack 1 int');
near(nfl({ tkl: 0 }), 0, 0.1, 'Watt no stats');
// NBA (steals and blocks weren't shown; filled in to match the fantasy points Real showed)
const nba = (o) => perfRating('nba', { ...emptyLine('nba'), ...o });
near(nba({ pts: 15, reb: 17, ast: 12, to: 5 }), 3.9, 0.5, 'Jokic 15/17/12');
near(nba({ pts: 25, reb: 15, ast: 8, stl: 1, to: 2 }), 5.0, 0.6, 'Jokic 25/15/8');
near(nba({ pts: 33, reb: 15, ast: 12, to: 4 }), 7.4, 1.9, 'Jokic 33/15/12');
near(nba({ pts: 40, reb: 8, ast: 13, stl: 2, blk: 1 }), 7.6, 0.8, 'Jokic 40/8/13');
near(nba({ pts: 23, reb: 21, ast: 19, stl: 1, to: 1 }), 7.5, 0.8, 'Jokic 23/21/19');
near(nba({ pts: 35, reb: 14, ast: 13, stl: 3, blk: 2 }), 6.7, 1.2, 'Jokic 35/14/13');
// pitchers (hits and walks allowed weren't shown; typical numbers assumed)
near(mlb({ ip: 8.0, er: 0, pk: 10, ph: 3, pbb: 0 }), 8.6, 1.0, 'Rasmussen 8 ip 0 er 10 k');
near(mlb({ ip: 6.2, er: 1, pk: 11, ph: 4, pbb: 1 }), 6.6, 1.2, 'Rasmussen 6.2 ip 1 er 11 k');
near(mlb({ ip: 5.0, er: 0, pk: 3, ph: 3, pbb: 2 }), 4.1, 1.0, 'Rasmussen 5 ip 0 er 3 k');
near(mlb({ ip: 7.0, er: 1, pk: 7, ph: 4, pbb: 1 }), 6.0, 1.0, 'Rasmussen 7 ip 1 er 7 k');
near(mlb({ ip: 6.0, er: 2, pk: 6, ph: 5, pbb: 2 }), 4.4, 1.0, 'Rasmussen 6 ip 2 er 6 k');
// hitters
near(mlb({ ab: 4, h: 0 }), -0.5, 0.3, 'Harris 0/4');
near(mlb({ ab: 3, h: 1, rbi: 3, hr: 1, r: 1 }), 4.0, 1.0, 'Harris 1/3 3 rbi 1 hr');
near(mlb({ ab: 5, h: 1 }), -0.4, 0.6, 'Harris 1/5');
near(mlb({ ab: 3, h: 3, r: 2 }), 2.7, 0.5, 'Harris 3/3 2 r');
near(mlb({ ab: 5, h: 4, rbi: 1, r: 3 }), 4.4, 0.6, 'Harris 4/5 1 rbi 3 r');
near(mlb({ ab: 4, h: 2, rbi: 1, hr: 1, r: 1 }), 2.6, 0.8, 'Harris 2/4 1 rbi 1 hr');
near(mlb({ ab: 3, h: 2, rbi: 3, hr: 1, r: 1 }), 4.9, 1.0, 'Harris 2/3 3 rbi 1 hr');
// shape: more is better, and the top is a ceiling
assert.ok(nfl({ rushYds: 250, rushTD: 5, rec: 8, recYds: 80 }) <= 15);
assert.ok(perfRating('nba', { ...emptyLine('nba'), pts: 50, reb: 12, ast: 10, stl: 2, blk: 1, to: 3 }) > perfRating('nba', { ...emptyLine('nba'), pts: 20, reb: 5, ast: 4, stl: 1, blk: 0, to: 2 }));
console.log('ok - ratings line up with the Real examples');
