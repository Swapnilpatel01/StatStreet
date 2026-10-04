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
near(nfl({ rushYds: 120, recYds: 44, rushTD: 3, rec: 7 }), 9.4, 0.6, 'Gibbs 164 yds 3 td 7 rec');
near(nfl({ rushYds: 80, recYds: 33, rushTD: 1, rec: 6 }), 4.0, 0.6, 'Gibbs 113 yds 1 td 6 rec');
near(nfl({ rushYds: 150, recYds: 36, rushTD: 2, rec: 5 }), 7.8, 1.0, 'Gibbs 186 yds 2 td 5 rec');
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
