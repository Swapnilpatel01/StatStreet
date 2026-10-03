// Card economy check: packs and flipping must lose money on average.
// Run: node tools/simcards.mjs
import * as E from '../js/engine.js';
import * as B from '../js/boosters.js';
const now = Date.now();
const st = E.newState(1e12);
st.career = { xp: 1e7 };
const R = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'iconic'];
st.moments = [];
for (let i = 0; i < 600; i++) {
  const r = Math.min(5, Math.floor(-Math.log(Math.random()) / 0.9));
  st.moments.push({ id: 'm' + i, league: 'nba', kind: 'DUNK', desc: 'x', sit: '', traits: [], rating: Math.min(10, 1.5 + r * 1.6 + Math.random() * 1.5), rarity: R[r], t: now,
    player: { id: 'p' + (i % 40), name: 'P ' + (i % 40), teamAbbr: 'AAA' } });
}
// 40 players with a wide spread of prices; stars make more (and better) plays.
for (let i = 0; i < 40; i++) st.assets['nba:p:p' + i] = { id: 'nba:p:p' + i, kind: 'player', league: 'nba', price: 5 + Math.pow(i, 2.2), hist: [0, 1] };
for (const m of st.moments) { const star = Math.random() < 0.55 ? 25 + Math.floor(Math.random() * 15) : Math.floor(Math.random() * 40); m.player = { id: 'p' + star, name: 'P ' + star, team: 'AAA' }; }
B.bindMarket(() => st);
const resale = (c) => B.marketValue(c, now) * 1.0 * (1 - B.SELLER_FEE); // best case: 24h auction, average bidders
export const out = {};
for (const p of B.B_PACKS) {
  let got = 0; const N = 4000;
  for (let i = 0; i < N; i++) { for (const c of B.openBoosterPack(st, p.key, now)) got += resale(c); B.boosterState(st).inv = []; }
  const cost = B.packCost(st, p); out[p.key] = got / N / cost;
  console.log(p.name.padEnd(18), 'cost $' + (cost / 100).toFixed(0).padStart(6), ' resale $' + (got / N / 100).toFixed(0).padStart(6), ' return ' + (out[p.key] * 100).toFixed(0) + '%');
}
// Flipping: win every marketplace auction at the lowest winning price, relist for 24h.
let paid = 0; let back = 0; let n = 0; let cheapPaid = 0; let cheapBack = 0; let cheapN = 0; let cheapWin = 0;
const gz = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, Math.random()))) * Math.cos(2 * Math.PI * Math.random());
for (let d = 0; d < 40; d++) {
  const t = now + d * 86400e3; st.mp = { hour: 0, list: [], bids: {}, v: 2 };
  for (const l of B.marketListings(st, t)) { const cost = Math.max(l.start, l.npcMax + Math.max(1, Math.ceil(l.npcMax * 0.08))); const v = B.marketValue(l.card, t);
    const sold = v * Math.min(1.6, Math.exp(0.18 * gz())) * (1 - B.SELLER_FEE); // one real 24h auction
    paid += cost; back += sold; n++;
    if (cost < 0.95 * v) { cheapPaid += cost; cheapBack += sold; cheapN++; if (sold > cost) cheapWin++; } }
}
out.flip = back / paid;
out.bargains = cheapBack / cheapPaid;
console.log(`bargain hunting (${cheapN} of ${n} auctions won under 95% of worth): return ${(out.bargains * 100).toFixed(0)}%, ${(cheapWin / cheapN * 100).toFixed(0)}% of those flips made money`);
console.log(`flip ${n} auctions: paid $${(paid / 100).toFixed(0)}, resale $${(back / 100).toFixed(0)}, return ${(out.flip * 100).toFixed(0)}%`);
