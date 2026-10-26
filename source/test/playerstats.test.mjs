// Run with: node test/playerstats.test.mjs
import assert from 'node:assert/strict';
import * as P from '../js/playerstats.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const now = new Date(2026, 9, 26, 21, 0).getTime(); // Oct 26 2026: NBA 2026-27 just started

const nbaLabels = ['GP', 'GS', 'MIN', 'FG', 'FG%', '3PT', '3P%', 'FT', 'FT%', 'OR', 'DR', 'REB', 'AST', 'BLK', 'STL', 'PF', 'TO', 'PTS'];
const nbaNames = ['gamesPlayed', 'gamesStarted', 'avgMinutes', 'avgFieldGoalsMade-avgFieldGoalsAttempted', 'fieldGoalPct', 'avgThreePointFieldGoalsMade-avgThreePointFieldGoalsAttempted', 'threePointFieldGoalPct', 'avgFreeThrowsMade-avgFreeThrowsAttempted', 'freeThrowPct', 'avgOffensiveRebounds', 'avgDefensiveRebounds', 'avgRebounds', 'avgAssists', 'avgBlocks', 'avgSteals', 'avgFouls', 'avgTurnovers', 'avgPoints'];
const row = (year, team, gp, pts, extra = {}) => ({ teamId: team, teamSlug: team, season: { year, displayName: `${year - 1}-${String(year).slice(2)}` },
  stats: [String(gp), String(gp), '34.0', '9.0-19.0', '47.4', '2.5-7.0', '35.7', '5.0-6.0', '83.3', '1.0', '6.0', '7.0', '5.0', '0.5', '1.2', '2.0', extra.to ?? '3.0', String(pts)] });
const nbaJson = {
  categories: [
    { name: 'averages', displayName: 'Regular Season Averages', labels: nbaLabels, names: nbaNames, displayNames: nbaLabels.map((l) => `Full ${l}`),
      statistics: [row(2024, 'mem', 70, '20.0'), row(2025, 'mem', 74, '22.0'), row(2026, 'mem', 30, '23.0'), row(2026, 'sac', 40, '25.0'), row(2026, '', 70, '24.1'), row(2027, 'sac', 3, '30.0', { to: '2.0' })],
      totals: nbaLabels.map(() => '1') },
    { name: 'totals', displayName: 'Regular Season Totals', labels: ['GP', 'PTS'], names: ['gamesPlayed', 'points'], statistics: [{ season: { year: 2026 }, stats: ['70', '1687'] }] },
    { name: 'empty', labels: ['X'], statistics: [] },
  ],
};

t('season numbering follows ESPN', () => {
  assert.equal(P.seasonYear('nba', now), 2027); assert.equal(P.seasonName('nba', 2027), '2026-27');
  assert.equal(P.seasonYear('nfl', now), 2026); assert.equal(P.seasonYear('nfl', new Date(2027, 0, 20).getTime()), 2026);
  assert.equal(P.seasonYear('mlb', now), 2026); assert.equal(P.seasonName('mlb', 2026), '2026');
});

t('parses every category with rows, games played and full names', () => {
  const cats = P.parseCareerStats('nba', nbaJson);
  assert.deepEqual(cats.map((c) => c.key), ['averages', 'totals']);
  const avg = cats[0];
  assert.equal(avg.rows.length, 6); assert.equal(avg.rows[0].year, 2024); assert.equal(avg.rows[0].gp, 70);
  assert.equal(avg.full[0], 'Full GP'); assert.equal(avg.totals.length, nbaLabels.length);
  assert.equal(P.parseCareerStats('nba', null).length, 0);
});

t('a traded season uses the combined row', () => {
  const avg = P.parseCareerStats('nba', nbaJson)[0];
  assert.equal(P.seasonRow(avg, 2026).values[17], '24.1');
  assert.equal(P.seasonRow(avg, 2020), null);
});

t('last, this and next season; the projection leans on full seasons early in a new one', () => {
  const avg = P.parseCareerStats('nba', nbaJson)[0];
  const v = P.statsView('nba', avg, { now, age: 27 });
  assert.equal(v.lastName, '2025-26'); assert.equal(v.nowName, '2026-27'); assert.equal(v.nextName, '2027-28');
  assert.equal(v.last.values[17], '24.1'); assert.equal(v.now.values[17], '30.0');
  const pts = Number(v.next.values[17]);
  assert.ok(pts > 22 && pts < 25.5, `3 hot games barely move it: ${pts}`);
  assert.match(v.next.values[3], /^\d+\.\d-\d+\.\d$/, 'made-attempted keeps its shape');
  assert.equal(v.next.values[1], '', 'games started not projected');
  const gp = Number(v.next.values[0]); assert.ok(gp >= 68 && gp <= 82, `games ${gp}`);
  assert.equal(v.next.values[4], '47.4', 'percentages averaged, not scaled');
  assert.ok(Math.abs(Number(v.next.values[16]) - 3.0) < 0.15, 'turnovers stay near his usual');
});

t('totals tables project a per-game rate times projected games (NFL)', () => {
  const labels = ['GP', 'CMP', 'ATT', 'CMP%', 'YDS', 'AVG', 'TD', 'INT', 'LNG', 'RTG'];
  const r = (year, gp, yds, td) => ({ season: { year }, stats: [String(gp), '300', '450', '66.7', yds, '7.5', td, '10', '75', '98.1'] });
  const cats = P.parseCareerStats('nfl', { categories: [{ name: 'passing', displayName: 'Passing', labels, names: labels, statistics: [r(2024, 17, '4,250', '30'), r(2025, 16, '4000', '28'), r(2026, 7, '1,900', '15')] }] });
  const v = P.statsView('nfl', cats[0], { now });
  const g = Number(v.next.values[0]); assert.ok(g >= 15 && g <= 17, `games ${g}`);
  const yds = Number(v.next.values[4]); assert.ok(yds > 3900 && yds < 4700, `yards ${yds}`);
  assert.equal(v.next.values[3], '66.7'); assert.equal(v.next.values[9], '98.1');
  const td = Number(v.next.values[6]); assert.ok(td >= 27 && td <= 36, `TD ${td}`);
});

t('MLB rates keep their format and age never pushes a rate', () => {
  const labels = ['GP', 'AB', 'H', 'HR', 'RBI', 'AVG', 'OBP', 'ERA'];
  const r = (year, gp, hr, avg) => ({ season: { year }, stats: [String(gp), '550', '160', hr, '90', avg, '.360', '-'] });
  const cats = P.parseCareerStats('mlb', { categories: [{ name: 'batting', labels, statistics: [r(2024, 150, '30', '.290'), r(2025, 155, '35', '.300'), r(2026, 160, '40', '.310')] }] });
  const young = P.statsView('mlb', cats[0], { now, age: 23 }).next; const old = P.statsView('mlb', cats[0], { now, age: 36 }).next;
  assert.match(young.values[5], /^\.\d{3}$/); assert.equal(young.values[5], old.values[5]);
  assert.ok(Number(young.values[3]) > Number(old.values[3]), 'age moves volume');
  assert.equal(young.values[7], '', 'non-numbers left blank');
});

t('categories ordered for the position', () => {
  const mk = (k) => ({ key: k, name: k, labels: ['GP'], rows: [] });
  assert.deepEqual(P.orderCats('nfl', [mk('passing'), mk('receiving'), mk('rushing')], 'RB').map((c) => c.key), ['rushing', 'receiving', 'passing']);
  assert.equal(P.orderCats('mlb', [mk('batting'), mk('pitching')], 'SP')[0].key, 'pitching');
  assert.equal(P.orderCats('nba', [mk('totals'), mk('averages')], 'G')[0].key, 'averages');
});

t('a player with no rows yet projects nothing', () => {
  assert.equal(P.projectNext('nba', { key: 'averages', name: 'A', labels: ['GP', 'PTS'], names: ['gamesPlayed', 'avgPoints'], rows: [] }, { now }), null);
});

console.log(`\n${passed} tests passed`);
