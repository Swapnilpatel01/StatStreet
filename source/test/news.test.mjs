// Headlines: who a story is about, and whether it is good or bad for them.
import assert from 'node:assert/strict';
import * as S from '../js/scoring.js';
import * as E from '../js/engine.js';
const P = (id, name) => ({ id, kind: 'player', name });
const T = (id, name, abbr) => ({ id, kind: 'team', name, abbr });
const sc = (t) => S.sentimentScore(t).score;

assert.ok(sc('Texans get WR Nico Collins (hamstring) back vs. Cowboys') > 0.3, 'return from injury is good news');
assert.ok(sc('Kelce returns to practice after knee injury') > 0.3);
assert.ok(sc('Collins ruled out with hamstring injury') < -0.5);
assert.ok(Math.abs(sc('Twins announce schedule')) < 0.1, '"wins" inside "Twins" is not a hit');
assert.ok(sc('Mahomes avoids serious injury, expected to play Sunday') > 0);

let fx = S.newsEffects({ headline: 'Texans get WR Nico Collins (hamstring) back vs. Cowboys', desc: 'He missed two games with the injury.' },
  [P('c', 'Nico Collins'), P('s', 'C.J. Stroud'), P('d', 'Dak Prescott'), T('hou', 'Houston Texans', 'HOU'), T('dal', 'Dallas Cowboys', 'DAL')]);
assert.ok(fx.c > 0.3, 'Collins up');
assert.equal(fx.s, undefined, 'teammate not named: no effect');
assert.equal(fx.d, undefined);
assert.ok(fx.hou > 0);

fx = S.newsEffects({ headline: 'Fantasy football Week 4 inactives: Daniels, DeVonta to sit, McConkey questionable', desc: 'Plus injured stars to avoid.' },
  [P('jd', 'Jayden Daniels'), P('ds', 'DeVonta Smith'), P('lm', 'Ladd McConkey'), P('x', 'Saquon Barkley'), T('phi', 'Philadelphia Eagles', 'PHI')]);
assert.ok(fx.jd < -0.2 && fx.ds < -0.2, 'named as sitting');
assert.ok(fx.lm < 0 && fx.lm > fx.ds, 'questionable is milder');
assert.equal(fx.x, undefined, 'tagged but not named: untouched');
assert.equal(fx.phi, undefined, 'round-ups do not move teams');

fx = S.newsEffects({ headline: 'Star guard to undergo surgery, out indefinitely', desc: '' }, [P('a', 'Some Body')]);
assert.ok(fx.a < -0.5, 'only player tagged: the story is his');

// Old saves: wrong effects are undone and redone.
const now = Date.now();
const st = E.newState(100);
E.upsertTeam(st, 'nfl', { id: '1', abbr: 'HOU', name: 'Houston Texans', w: 2, l: 1, gp: 3, diff: 5, streak: 1 });
for (const [id, name] of [['c', 'Nico Collins'], ['s', 'CJ Stroud']]) E.seedPlayer(st, 'nfl', { id, name, pos: id === 'c' ? 'WR' : 'QB', teamId: '1', teamAbbr: 'HOU', gp: 3, gs: 12, line: {} });
for (let i = 0; i < 12; i++) E.seedPlayer(st, 'nfl', { id: 'w' + i, name: 'W ' + i, pos: 'WR', teamId: '1', teamAbbr: 'HOU', gp: 3, gs: 6 + i, line: {} });
E.repriceLeague(st, 'nfl', now); st.lastTick = now;
const p0 = st.assets['nfl:p:c'].price; const q0 = st.assets['nfl:p:s'].price;
const art = { id: 'n', league: 'nfl', headline: 'Texans get WR Nico Collins (hamstring) back vs. Cowboys', desc: '', athletes: ['c', 's'], teams: ['1'], published: now - 3600e3 };
// what the old version did: one negative score for everyone tagged
st.news.unshift({ ...art, score: -0.9, hits: ['hamstring'], targets: ['nfl:p:c', 'nfl:p:s', 'nfl:t:1'] });
for (const id of ['nfl:p:c', 'nfl:p:s']) { const a = st.assets[id]; a.shocks.push({ t: art.published, v: 0.07 * -0.9 }); a.events.unshift({ t: art.published, kind: 'news', text: art.headline, pct: -0.063 }); }
st.newsV = 1; E.rescoreNews(st, now);
const c = st.assets['nfl:p:c']; const s = st.assets['nfl:p:s'];
assert.ok(c.price > p0 * 1.01, `Collins now up: ${p0} -> ${c.price}`);
assert.ok(Math.abs(s.price / q0 - 1) < 0.005 && !s.events.some((e) => e.kind === 'news'), 'Stroud untouched');
assert.ok(c.events.find((e) => e.kind === 'news').pct > 0);
// Injury reports: a player on his way back is discounted less than one with no timetable.
const good = 'Head coach Jeff Hafley said Friday that Grant (leg) could begin practicing next week, C. Isaiah Smalls II of the Miami Herald reports.';
assert.equal(S.injuryOutlook(good), 1);
assert.equal(S.injuryOutlook('Underwent surgery and is out indefinitely.'), -1);
assert.equal(S.injuryOutlook('Was placed on injured reserve Tuesday.'), 0);
assert.ok(S.injuryFactor('Injured Reserve', good) > 0.85 && S.injuryFactor('Injured Reserve', '') === 0.72 && S.injuryFactor('Injured Reserve', 'No timetable for his return.') < 0.7);
{
  const a = st.assets['nfl:p:s']; const now2 = now + 1000;
  E.applyInjuries(st, 'nfl', [{ athleteId: 's', status: 'Injured Reserve', detail: 'Placed on IR.' }], { now: now2 });
  const low = a.price;
  E.applyInjuries(st, 'nfl', [{ athleteId: 's', status: 'Injured Reserve', detail: good }], { now: now2 + 1000 });
  assert.ok(a.price <= low * 1.001, `a better report alone does not lift the price: ${low} -> ${a.price}`);
  E.applyInjuries(st, 'nfl', [{ athleteId: 's', status: 'Active' }], { now: now2 + 2000 });
  assert.ok(a.injury === null && a.rust < 0.8 && a.price <= low * 1.001, 'becoming active does not lift it either');
}
{
  // The feed tags only the team; the player named in the story still moves.
  const a = st.assets['nfl:p:c']; const before = a.price; const t3 = now + 5000;
  E.applyNews(st, 'nfl', [{ id: 'untagged1', headline: 'Texans receiver suspended six games', desc: 'Houston wide receiver Nico Collins has been suspended for six games following a positive test.', published: t3, athletes: [], teams: ['1'] }], { now: t3 });
  const item = st.news.find((n) => n.id === 'untagged1');
  assert.ok(item.targets.includes('nfl:p:c') && item.fx['nfl:p:c'] < 0, JSON.stringify(item.fx));
  assert.ok(!item.targets.includes('nfl:p:s'), 'a player who is not named is left alone');
  assert.ok(a.price < before, `named player drops: ${before} -> ${a.price}`);
}
console.log('ok - news tests');

// Players who already bounced before the rule changed give the bounce back, once.
{
  const a = st.assets['nfl:p:s']; delete a.rust; a.injury = null;
  a.events = [{ t: now - 86400e3, kind: 'injury', text: 'Cleared: back from "Injured Reserve"', pct: 0.3 }, { t: now - 5 * 86400e3, kind: 'injury', text: 'Injured Reserve — Knee', pct: -0.28 }];
  const p0 = a.price; delete st.rustV;
  assert.ok(E.undoReturnBounce(st, now + 5000) >= 1);
  assert.ok(a.rust < 0.8 && E.breakdown(st, a, now + 5000).inj < 0.8 && a.events[0].pct < -0.15, `bounce taken back: ${p0} -> ${a.price}`);
  assert.equal(E.undoReturnBounce(st, now + 6000), 0, 'only once');
}
