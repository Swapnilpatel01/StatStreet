// Season simulation used to calibrate the pricing model: realistic talent spreads, game-to-game
// noise and year-to-year change. Reports price levels, per-game moves, and whether any tier
// (stars, role players) earns a predictable return. Run: node tools/sim.mjs
import * as E from '../js/engine.js';
import { DAY, HOUR } from '../js/util.js';

let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const N = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;

const LG = {
  nba: { n: 450, teams: 30, games: 82, every: 2 * DAY, talent: () => 3 + 5.5 * Math.exp(0.55 * N()), gsd: (t) => 0.3 * t + 4.5, drift: 2, gpPrior: 65, pos: () => 'G',
    line: (gs) => ({ min: 30, pts: Math.max(0, gs), fgm: 0, fga: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: Math.max(0, -gs), pf: 0 }) },
  mlb: { n: 400, teams: 30, games: 162, every: DAY, talent: () => 1.2 + 0.55 * Math.exp(0.5 * N()), gsd: () => 2.8, drift: 0.3, gpPrior: 140, pos: () => '1B',
    line: (gs) => ({ ab: 4, h: 4 + Math.max(0, gs) + 0, r: 0, rbi: 0, hr: 0, bb: 0, k: Math.max(0, -gs) / 0.3, ip: 0, ph: 0, er: 0, pbb: 0, pk: 0 }) },
  nfl: { n: 70, teams: 32, games: 17, every: 7 * DAY, talent: () => 5 + 9 * Math.exp(0.35 * N()) * (rnd() < 0.55 ? 1 : 0.45), gsd: () => 7, drift: 2.5, gpPrior: 15, pos: () => 'QB',
    line: (gs) => ({ passYds: Math.max(0, gs) * 25, passTD: 0, int: Math.max(0, -gs) / 2, cmp: 20, att: 30, rushYds: 0, rushTD: 0, car: 0, rec: 0, recYds: 0, recTD: 0, fumLost: 0, tkl: 0, sacks: 0, defInt: 0, pd: 0, defTD: 0, fg: 0, xp: 0 }) },
};
// MLB line: h=4+gs with ab=4 gives bat = h - .25*(ab-h) ... adjust so gameScore == gs
import { gameScore } from '../js/scoring.js';
LG.mlb.line = (gs) => gs >= 0 ? { ab: 0, h: 0, r: gs, rbi: 0, hr: 0, bb: 0, k: 0, ip: 0, ph: 0, er: 0, pbb: 0, pk: 0 } : { ab: 0, h: 0, r: 0, rbi: 0, hr: 0, bb: 0, k: -gs / 0.3, ip: 0, ph: 0, er: 0, pbb: 0, pk: 0 };

const SEEDS = Number(process.env.SEEDS || 6);
const only = process.env.LG;
for (const [lg, L] of Object.entries(LG)) {
  if (only && only !== lg) continue;
  const agg = { dec: [], px: [], ms: [], mm: [], y: [] };
  for (let sd = 1; sd <= SEEDS; sd++) {
  seed = sd * 7919;
  const st = E.newState(1e6);
  const t0 = Date.parse('2026-10-20T00:00:00Z');
  for (let i = 0; i < L.teams; i++) E.upsertTeam(st, lg, { id: `T${i}`, abbr: `T${i}`, name: `T${i}`, w: 0, l: 0, gp: 0, diff: 0, streak: 0 });
  const players = [];
  for (let i = 0; i < L.n; i++) {
    const last = L.talent(); const now = Math.max(0.3, last + L.drift * N() * 0.5);
    const prev2 = last + L.drift * N() * 0.5;
    const p = { id: String(i), name: `P${i}`, pos: L.pos(), teamId: `T${i % L.teams}`, teamAbbr: '', img: '', true: now };
    // "current" stats = last season (pre-season case); prior = the season before
    E.seedPlayer(st, lg, { ...p, gp: L.gpPrior, gs: last + N() * L.gsd(last) / Math.sqrt(L.gpPrior) });
    E.seedPrior(st, lg, { ...p, gp: L.gpPrior, gs: prev2 + N() * L.gsd(prev2) / Math.sqrt(L.gpPrior) });
    players.push(p);
  }
  E.initForm(st, lg, { all: true });
  E.repriceLeague(st, lg, t0);
  st.lastTick = t0;
  const start = Object.fromEntries(players.map((p) => [p.id, st.assets[`${lg}:p:${p.id}`].price]));
  const moves = { star: [], mid: [] };
  const rank = [...players].sort((a, b) => start[b.id] - start[a.id]);
  const stars = new Set(rank.slice(0, 10).map((p) => p.id));
  let t = t0;
  for (let g = 0; g < L.games; g++) {
    t += L.every;
    for (let h = 0; h < L.every; h += 6 * HOUR) E.tick(st, t - L.every + h);
    const before = Object.fromEntries(players.map((p) => [p.id, st.assets[`${lg}:p:${p.id}`].price]));
    const box = players.map((p) => ({ id: p.id, name: p.name, pos: p.pos, teamId: p.teamId, line: L.line(p.true + N() * L.gsd(p.true)) }));
    if (g === 0) { const x = box[0]; if (Math.abs(gameScore(lg, x.line) - (x.line.pts ?? gameScore(lg, x.line))) > 1e-6) console.log('line mismatch'); }
    E.applyFinalGame(st, lg, { id: `${lg}g${g}`, date: t - 3 * HOUR, preseason: false, teams: [{ id: 'T0', abbr: 'T0', score: 1, winner: true, home: true }, { id: 'T1', abbr: 'T1', score: 0, home: false }], players: box }, { now: t });
    E.repriceLeague(st, lg, t, { record: false });
    for (const p of players) {
      const a = st.assets[`${lg}:p:${p.id}`]; const m = Math.log(a.price / before[p.id]);
      (stars.has(p.id) ? moves.star : moves.mid).push(Math.abs(m));
    }
  }
  agg.px.push(...players.map((p) => st.assets[`${lg}:p:${p.id}`].price));
  agg.ms.push(...moves.star); agg.mm.push(...moves.mid);
  const ret = (ids) => avg(ids.map((p) => Math.log(st.assets[`${lg}:p:${p.id}`].price / start[p.id])));
  const deciles = [0, 1, 2, 4, 6, 9].map((d) => rank.slice(Math.floor(d * L.n / 10), Math.floor((d + 1) * L.n / 10)));
  const yieldOf = (ids) => avg(ids.map((p) => (st.assets[`${lg}:p:${p.id}`].divHist || []).reduce((s, d) => s + d.ps, 0) / start[p.id]));
  agg.dec.push(deciles.map(ret)); agg.y.push(deciles.map(yieldOf));
  }
  const px = agg.px;
  const col = (m, i) => m.map((r) => r[i]);
  const ms = (arr) => { const m = avg(arr); const se = Math.sqrt(avg(arr.map((x) => (x - m) ** 2)) / arr.length); return `${(m * 100).toFixed(1)}±${(se * 100).toFixed(1)}%`; };
  console.log(`\n${lg.toUpperCase()}  prices: 99.5% ${q(px, .995).toFixed(0)} | 99% ${q(px, .99).toFixed(0)} | 90% ${q(px, .9).toFixed(0)} | median ${q(px, .5).toFixed(0)} | 10% ${q(px, .1).toFixed(1)} | min ${Math.min(...px).toFixed(1)}`);
  console.log(`  per-game |move| median: top-10 ${(q(agg.ms, .5) * 100).toFixed(1)}%  others ${(q(agg.mm, .5) * 100).toFixed(1)}%   90th: top-10 ${(q(agg.ms, .9) * 100).toFixed(1)}%`);
  console.log('  season log-return by start-price decile 1,2,3,5,7,10:', [0, 1, 2, 3, 4, 5].map((i) => ms(col(agg.dec, i))).join('  '));
  console.log('  dividend yield by decile:', [0, 1, 2, 3, 4, 5].map((i) => (avg(col(agg.y, i)) * 100).toFixed(1) + '%').join('  '));
}
