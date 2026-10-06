// Play headlines: a long feed sentence becomes a few words.
import assert from 'node:assert/strict';
import { shortPlay as sp } from '../js/moments.js';
const eq = (league, text, want, p) => assert.equal(sp(league, text, p), want, text);
eq('nfl', '(Shotgun) D.Jones pass short right to S.McGowan to WAS 45 for 7 yards (Q.Martin).', '7-yd catch');
eq('nfl', 'T.Way punts 34 yards to IND 20, Center-T.Ott, fair catch by J.Downs.', '34-yd punt');
eq('nfl', 'D.Stevens 29 yard field goal is GOOD, Center-T.Ott, Holder-T.Way.', '29-yd FG');
eq('nfl', 'M.Glass 52 yard field goal is No Good, Wide Right.', 'Missed 52-yd FG');
eq('nfl', '(Shotgun) M.Mariota sacked at WAS 30 for -6 yards (A.Adebawore).', '6-yd sack');
eq('nfl', 'J.Taylor left tackle to IND 42 for 4 yards (B.Wagner).', '4-yd run');
eq('nfl', '(Shotgun) D.Jones pass incomplete deep left to A.Pierce.', 'Incomplete pass');
eq('nfl', 'J.Daniels pass deep middle to T.McLaurin for 38 yards, TOUCHDOWN.', '38-yd TD catch');
eq('nfl', 'B.Robinson up the middle for 2 yards, TOUCHDOWN.', '2-yd TD run');
eq('nfl', 'D.Jones pass short middle intended for J.Downs INTERCEPTED by M.Sainristil at WAS 12.', 'Interception');
eq('nfl', 'M.Glass extra point is GOOD, Center-T.Ott.', 'Extra point');
eq('nfl', 'Some odd thing', 'Run', { type: { text: 'Rush' } });
eq('nfl', 'whatever happened here', '12-yd catch', { type: { text: 'Pass Reception' }, statYardage: 12 });
eq('nba', 'Nikola Jokic makes 25-foot three point jumper (Jamal Murray assists)', '25-ft three');
eq('nba', 'Shai Gilgeous-Alexander makes driving dunk', 'Driving dunk');
eq('nba', 'Jaylen Brown misses 12-foot pullup jump shot', 'Missed 12-ft pullup jumper');
eq('nba', 'Jayson Tatum makes free throw 1 of 2', 'Free throw');
eq('nba', 'Chet Holmgren defensive rebound', 'Rebound');
eq('nba', 'Luka Doncic bad pass (Jalen Williams steals)', 'Steal');
eq('mlb', 'Judge homered to left (410 feet), Soto scored.', '410-ft home run');
eq('mlb', 'Devers struck out swinging.', 'Strikeout');
eq('mlb', 'Diaz doubled to deep right, Arozarena scored.', 'Double');
eq('mlb', 'Volpe grounded out to shortstop.', 'Groundout');
eq('mlb', 'Soto walked.', 'Walk');
import { bigPlay as bp } from '../js/moments.js';
const big = (league, text, want, p = {}, ctx = {}) => assert.equal(bp(league, text, p, ctx), want, text);
big('nfl', 'J.Daniels pass deep middle to T.McLaurin for 62 yards, TOUCHDOWN.', '62-yd house call');
big('nfl', 'D.Jones pass deep left to A.Pierce to WAS 20 for 45 yards (M.Sainristil).', '45-yd bomb');
big('nfl', 'J.Taylor right end to WAS 30 for 38 yards.', '38-yd breakaway');
big('nfl', 'M.Glass 55 yard field goal is GOOD.', '55-yd bomb of a kick');
big('nfl', 'M.Glass 38 yard field goal is GOOD.', 'Go-ahead 38-yd FG', {}, { a0: 20, h0: 21, a1: 23, h1: 21, period: 4, secs: 4 });
big('nfl', 'M.Glass 38 yard field goal is GOOD.', null, {}, { a0: 0, h0: 0, a1: 3, h1: 0, period: 1, secs: 400 });
big('nfl', 'M.Mariota sacked at WAS 30 for -6 yards (A.Adebawore).', '6-yd sack on 3rd down', { start: { down: 3, distance: 5 } });
big('nfl', 'J.Taylor up the middle for 3 yards.', '4th-down conversion, 3-yd run', { start: { down: 4, distance: 2 } });
big('nfl', 'D.Jones pass intended for J.Downs INTERCEPTED by M.Sainristil.', 'Turnover: interception');
big('nfl', 'J.Taylor left tackle for 4 yards.', null, { start: { down: 1, distance: 10 } });
big('nba', 'Stephen Curry makes 33-foot three point jumper', '33-ft bomb');
big('nba', 'Stephen Curry makes 37-foot three point jumper', 'Logo three from 37 ft');
big('nba', 'Jayson Tatum makes 26-foot three point jumper', 'Go-ahead three', {}, { a0: 100, h0: 101, a1: 103, h1: 101, period: 4, secs: 20 });
big('nba', 'Jayson Tatum makes 18-foot jumper', 'Buzzer-beater for the win', {}, { a0: 100, h0: 101, a1: 102, h1: 101, period: 4, secs: 0 });
big('nba', 'Chet Holmgren makes alley oop dunk (Shai Gilgeous-Alexander assists)', 'Alley-oop slam');
big('nba', 'Jayson Tatum makes 24-foot three point jumper', null, {}, { a0: 10, h0: 12, a1: 13, h1: 12, period: 1, secs: 300 });
big('nba', 'Jayson Tatum misses 35-foot three point jumper', null);
big('mlb', 'Judge homered to center (455 feet).', '455-ft moonshot');
big('mlb', 'Devers hit a grand slam to right.', 'Grand slam');
big('mlb', 'Diaz singled to left, Arozarena scored.', 'Walk-off single', {}, { a0: 3, h0: 3, a1: 3, h1: 4, period: 9, bottom: true });
big('mlb', 'Soto homered to right (390 feet).', 'Go-ahead home run', {}, { a0: 2, h0: 2, a1: 3, h1: 2, period: 8, bottom: false });
big('mlb', 'Volpe grounded out to shortstop.', null);
// a touchdown and the kick after it arrive as one play and come out as two
import { parsePlays } from '../js/moments.js';
{
  const td = 'J.Taylor up the middle for 2 yards, TOUCHDOWN. S.Shrader extra point is GOOD, Center-L.Rhodes, Holder-R.Sanchez.';
  eq('nfl', td, '2-yd TD run');
  const json = { drives: { previous: [{ team: { abbreviation: 'IND' }, plays: [
    { id: '1', text: 'J.Taylor left tackle for 4 yards.', awayScore: 0, homeScore: 6, period: { number: 2 }, clock: { displayValue: '9:10' }, start: { down: 1, distance: 10 } },
    { id: '2', text: td, awayScore: 7, homeScore: 6, scoringPlay: true, scoreValue: 7, type: { text: 'Rushing Touchdown' }, period: { number: 2 }, clock: { displayValue: '8:02' }, start: { down: 2, distance: 2 },
      participants: [{ athlete: { id: '77' }, type: 'rusher' }] },
    { id: '3', text: 'D.Jones pass to J.Downs for 5 yards, TOUCHDOWN. D.Jones pass to M.Pittman is incomplete. TWO-POINT CONVERSION ATTEMPT FAILS.', awayScore: 13, homeScore: 6, scoringPlay: true, period: { number: 3 }, clock: { displayValue: '4:00' } },
  ] }] } };
  const plays = parsePlays('nfl', json).reverse(); // oldest first
  assert.deepEqual(plays.map((x) => x.head), ['4-yd run', '2-yd TD run', 'Extra point', '5-yd TD catch', 'Failed 2-pt try']);
  const [, tdPlay, pat, td2, try2] = plays;
  assert.deepEqual([tdPlay.away, tdPlay.home, tdPlay.value, tdPlay.pid], [6, 6, 6, '77'], 'the touchdown shows 6-6 and belongs to the runner');
  assert.deepEqual([pat.away, pat.home, pat.value, pat.pid], [7, 6, 1, null], 'the kick is its own play, not the runner\'s');
  assert.ok(pat.text.startsWith('S.Shrader extra point') && tdPlay.text.endsWith('TOUCHDOWN'));
  assert.deepEqual([td2.away, td2.value, try2.value, try2.scoring], [13, 6, 0, false]);
}
{
  // every score of a long game stays in the list, and a field goal with no value from the feed still counts 3
  const plays = [{ id: 'a', text: 'B.Robinson up the middle for 4 yards, TOUCHDOWN. Y.Koo extra point is GOOD.', awayScore: 0, homeScore: 7, scoringPlay: true, period: { number: 1 }, clock: { displayValue: '9:00' } }];
  for (let i = 0; i < 150; i++) plays.push({ id: 'f' + i, text: 'T.Allgeier left guard for 3 yards.', awayScore: 0, homeScore: 7, period: { number: 2 }, clock: { displayValue: '5:00' } });
  plays.push({ id: 'z', text: 'Y.Koo 41 yard field goal is GOOD, Center-L.McCullough.', awayScore: 0, homeScore: 10, scoringPlay: true, period: { number: 3 }, clock: { displayValue: '2:00' } });
  const all = parsePlays('nfl', { drives: { previous: [{ team: { abbreviation: 'ATL' }, plays }] } });
  const sc = all.filter((p) => p.scoring && p.value > 0).reverse();
  assert.deepEqual(sc.map((p) => [p.head, p.value, p.home]), [['4-yd TD run', 6, 6], ['Extra point', 1, 7], ['41-yd FG', 3, 10]]);
}
console.log('ok - play headlines');
