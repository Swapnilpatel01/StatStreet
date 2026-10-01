// Team-price calibration: seasons of games between teams of known strength.
import * as E from '../js/engine.js';
import { DAY, HOUR } from '../js/util.js';
let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const N = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const LG = { nba: { n: 30, g: 82, sd: 0.62, pts: 12, x: 0.8 }, nfl: { n: 32, g: 17, sd: 0.55, pts: 10, x: 1.6 }, mlb: { n: 30, g: 162, sd: 0.25, pts: 3, x: 1.0 } };
for (const [lg, L] of Object.entries(LG)) {
  const rets = [[], [], []]; const moves = []; const tops = []; const bots = []; const pickAcc = [];
  for (let s = 1; s <= 24; s++) {
    seed = s * 104729;
    const st = E.newState(1e6);
    const teams = Array.from({ length: L.n }, (_, i) => ({ id: `T${i}`, r: N() * L.sd }));
    const pw = (a, b) => 1 / (1 + Math.exp(-(a.r - b.r) * 1.6));
    // last season record from slightly different strength
    for (const t of teams) {
      const rl = t.r + N() * L.sd * L.x; let w = 0; let diff = 0;
      for (let k = 0; k < L.g; k++) { const p = 1 / (1 + Math.exp(-rl * 1.6)); const win = rnd() < p; w += win; diff += (win ? 1 : -1) * L.pts * (0.5 + rnd()); }
      E.upsertTeam(st, lg, { id: t.id, abbr: t.id, name: t.id, w: 0, l: 0, gp: 0, diff: 0, streak: 0 });
      E.setTeamPrior(st, lg, { id: t.id, w, l: L.g - w, gp: L.g, diff });
    }
    const t0 = Date.parse('2026-10-20T00:00:00Z');
    E.recomputeStats(st, lg); E.repriceLeague(st, lg, t0); st.lastTick = t0;
    const start = Object.fromEntries(teams.map((t) => [t.id, st.assets[`${lg}:t:${t.id}`].price]));
    const px = teams.map((t) => start[t.id]).sort((a, b) => a - b); tops.push(px[px.length - 1]); bots.push(px[0]);
    let t = t0;
    for (let k = 0; k < L.g; k++) {
      t += DAY; E.tick(st, t);
      const order = [...teams].sort(() => rnd() - 0.5);
      for (let i = 0; i + 1 < order.length; i += 2) {
        const [a, b] = [order[i], order[i + 1]];
        const pa = pw(a, b); const aw = rnd() < pa;
        pickAcc.push(Math.abs((E.teamWinProb(st, lg, a.id, b.id, false) > 0.5) === aw ? 1 : 0));
        const m = Math.round(L.pts * (0.5 + rnd())); const before = st.assets[`${lg}:t:${a.id}`].price;
        E.applyFinalGame(st, lg, { id: `${k}-${i}`, date: t - HOUR, preseason: false, players: [],
          teams: [{ id: a.id, abbr: a.id, score: aw ? 100 + m : 100, winner: aw, home: true }, { id: b.id, abbr: b.id, score: aw ? 100 : 100 + m, winner: !aw, home: false }] }, { now: t });
        moves.push(Math.abs(Math.log(st.assets[`${lg}:t:${a.id}`].price / before)));
      }
      E.repriceLeague(st, lg, t, { record: false });
    }
    const rank = [...teams].sort((x, y) => start[y.id] - start[x.id]);
    const third = L.n / 3;
    [0, 1, 2].forEach((d) => rets[d].push(avg(rank.slice(d * third, (d + 1) * third).map((x) => Math.log(st.assets[`${lg}:t:${x.id}`].price / start[x.id])))));
  }
  const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(p * a.length)];
  console.log(`${lg.toUpperCase()} top team ~$${avg(tops).toFixed(0)}  bottom ~$${avg(bots).toFixed(0)}  per-game |move| median ${(q(moves, .5) * 100).toFixed(1)}% 90th ${(q(moves, .9) * 100).toFixed(1)}%  favorite wins ${(avg(pickAcc) * 100).toFixed(0)}%`);
  console.log('   season log-return top/mid/bottom third:', rets.map((r) => (avg(r) * 100).toFixed(1) + '%').join('  '));
}
