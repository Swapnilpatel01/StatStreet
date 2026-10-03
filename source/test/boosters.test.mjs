// Moment cards: parsing real plays, packs, player-only boosts, fusing, marketplace bids and auctions.
// Run: node test/boosters.test.mjs
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as X from '../js/xp.js';
import * as B from '../js/boosters.js';
import * as M from '../js/moments.js';
import * as C from '../js/career.js';
import { DAY, HOUR } from '../js/util.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const now = new Date(2026, 9, 6, 10, 0).getTime();

const ev = (league, id) => ({ id, date: now - DAY, completed: true, name: 'ATL @ PHI',
  teams: [{ id: '22', abbr: 'PHI', home: true, score: 4 }, { id: '15', abbr: 'ATL', home: false, score: 3 }] });
const mlbPlayers = [
  { id: '30951', name: 'Bryce Harper', teamId: '22', teamAbbr: 'PHI', line: { ab: 4, h: 2, r: 2, rbi: 3, hr: 1, bb: 0, k: 1, ip: 0, ph: 0, er: 0, pbb: 0, pk: 0 } },
  { id: '4000', name: 'Dylan Lee', teamId: '15', teamAbbr: 'ATL', line: { ab: 0, h: 0, r: 0, rbi: 0, hr: 0, bb: 0, k: 0, ip: 1, ph: 2, er: 2, pbb: 0, pk: 1 } },
];
const mlbSummary = { plays: [
  { text: 'Kyle Schwarber struck out swinging.', type: { text: 'Strike Out' }, homeScore: 0, awayScore: 0, period: { type: 'Bottom', number: 1 }, outs: 1 },
  { text: 'Bryce Harper doubled to left (310 feet).', type: { text: 'Double' }, scoringPlay: true, scoreValue: 1, homeScore: 1, awayScore: 2, period: { type: 'Bottom', number: 3 }, outs: 2,
    participants: [{ athlete: { id: '30951' }, type: 'batter' }, { athlete: { id: '4000' }, type: 'pitcher' }] },
  { text: 'Bryce Harper homered to right center (418 feet), Trea Turner scored.', type: { text: 'Home Run' }, scoringPlay: true, scoreValue: 2, homeScore: 4, awayScore: 3, period: { type: 'Bottom', number: 8 }, outs: 0,
    participants: [{ athlete: { id: '30951' }, type: 'batter' }, { athlete: { id: '4000' }, type: 'pitcher' }] },
] };

function build() {
  const st = E.newState(1e6);
  [['22', 'PHI', 50, 40], ['15', 'ATL', 45, 45]].forEach(([id, abbr, w, l]) => E.upsertTeam(st, 'mlb', { id, abbr, name: abbr, w, l, gp: w + l, diff: 0, streak: 1 }));
  for (const p of mlbPlayers) E.seedPlayer(st, 'mlb', { ...p, pos: '1B', gp: 100, gs: 2.5 });
  for (let i = 0; i < 20; i++) E.seedPlayer(st, 'mlb', { id: `x${i}`, name: `X ${i}`, pos: 'SS', teamId: '15', teamAbbr: 'ATL', gp: 100, gs: 1 + (i % 5) * 0.3, line: {} });
  E.repriceLeague(st, 'mlb', now - DAY); st.lastTick = now - DAY;
  return st;
}
const game = (id, date, line) => ({ id, date, preseason: false, moments: [],
  teams: [{ id: '22', abbr: 'PHI', score: 5, winner: true, home: true }, { id: '15', abbr: 'ATL', score: 2 }],
  players: [{ id: '30951', name: 'Bryce Harper', pos: '1B', teamId: '22', line }] });
const big = { ab: 4, h: 3, r: 2, rbi: 4, hr: 2, bb: 1, k: 0, ip: 0, ph: 0, er: 0, pbb: 0, pk: 0 };
const bad = { ab: 4, h: 0, r: 0, rbi: 0, hr: 0, bb: 0, k: 4, ip: 0, ph: 0, er: 0, pbb: 0, pk: 0 };

t('real plays become rated moments with traits, players and game situation', () => {
  const ms = M.parseMoments('mlb', mlbSummary, ev('mlb', 'g1'), mlbPlayers);
  const hr = ms.find((m) => m.kind === 'HOME RUN');
  assert.ok(hr, ms.map((m) => m.kind).join(','));
  assert.equal(hr.player.name, 'Bryce Harper');
  assert.equal(hr.opp.name, 'Dylan Lee');
  assert.ok(hr.traits.includes('goahead') && hr.traits.includes('clutch'), hr.traits.join(','));
  assert.match(hr.desc, /418'/);
  assert.equal(hr.sit, 'Bot 8 · 0 outs');
  assert.ok(hr.rating > ms.find((m) => m.kind === 'DOUBLE').rating);
  assert.ok(['epic', 'legendary', 'iconic'].includes(hr.rarity), `${hr.rating} ${hr.rarity}`);
  assert.ok(!ms.some((m) => /struck out/i.test(m.desc)));
  // NFL scoring plays without participants are matched by name
  const nfl = M.parseMoments('nfl', { scoringPlays: [{ text: 'Travis Kelce 45 Yd pass from Patrick Mahomes (Harrison Butker Kick)', type: { text: 'Passing Touchdown' }, homeScore: 21, awayScore: 17, period: { number: 4 }, clock: { displayValue: '1:12' } }] },
    ev('nfl', 'n1'), [{ id: '1', name: 'Travis Kelce', teamId: '22', teamAbbr: 'KC', line: {} }, { id: '2', name: 'Patrick Mahomes', teamId: '22', teamAbbr: 'KC', line: {} }]);
  assert.equal(nfl[0].kind, 'TD PASS');
  assert.ok(nfl[0].traits.includes('long'));
  // No play-by-play at all: big box-score nights still make cards
  const box = M.parseMoments('mlb', {}, ev('mlb', 'g2'), [{ ...mlbPlayers[0], line: big }]);
  assert.equal(box.length, 1);
  assert.match(box[0].kind, /HOMER|BIG NIGHT|MONSTER/);
});

function withPool(st) {
  E.applyFinalGame(st, 'mlb', { ...game('pool', now - 2 * DAY, big), moments: M.parseMoments('mlb', mlbSummary, ev('mlb', 'g1'), mlbPlayers) }, { now: now - 2 * DAY + 3 * HOUR });
  assert.ok(st.moments.length >= 2);
  return st;
}

t('packs pull real moments; a card only boosts its own player', () => {
  const st = withPool(build());
  { const c0 = st.cash; st.cash = 0; assert.throws(() => B.openBoosterPack(st, 'mstarter', now), /cash/); st.cash = c0; }
  X.addCoins(st, 5000);
  const got = B.openBoosterPack(st, 'mstarter', now);
  assert.equal(got.length, 3);
  const c = got[0];
  assert.equal(c.assetId, `mlb:p:${c.m.player.id}`);
  E.trade(st, 'mlb:p:x1', 'buy', 1, now - HOUR);
  assert.throws(() => B.equip(st, c.id, 'mlb:p:x1'), /only boosts/);
  assert.throws(() => B.equip(st, c.id, c.assetId), /Buy some/);
  E.trade(st, c.assetId, 'buy', 1, now - HOUR);
  B.equip(st, c.id, c.assetId);
  assert.equal(B.boosterOn(st, c.assetId).id, c.id);
});

t('game day card pays on a good game; shield refunds a bad one; charges run down', () => {
  const st = withPool(build());
  const hr = st.moments.find((m) => m.kind === 'HOME RUN');
  E.trade(st, 'mlb:p:30951', 'buy', 10, now - 2 * HOUR);
  const c = B.makeCard(st, { ...hr, traits: [] }, { now });
  assert.equal(c.type, 'game');
  B.equip(st, c.id, 'mlb:p:30951');
  let cash = st.cash;
  E.applyFinalGame(st, 'mlb', game('a1', now, big), { now: now + 3 * HOUR });
  assert.ok(st.cash > cash, 'bonus paid');
  assert.equal(c.charges, c.max - 1);
  const s = B.makeCard(st, hr, { now }); // clutch home run → Shield
  assert.equal(s.type, 'shield');
  B.equip(st, s.id, 'mlb:p:30951'); // swaps
  assert.equal(c.on, null);
  cash = st.cash;
  E.applyFinalGame(st, 'mlb', game('a2', now + DAY, bad), { now: now + DAY + 3 * HOUR });
  assert.ok(st.cash > cash, 'shield refund');
});

t('fuse: three of a rarity → your best one moves up', () => {
  const st = withPool(build());
  const m = st.moments[0];
  const cards = [1, 2, 3].map((i) => B.makeCard(st, { ...m, rating: 1 + i }, { now, rarity: 'common' }));
  const up = B.fuse(st, 'common', now);
  assert.equal(up.rarity, 'uncommon');
  assert.equal(up.id, cards[2].id);
  assert.equal(B.boosterState(st).inv.length, 1);
});

t('marketplace: listings appear hourly, proxy bids, outbid refunds, winning delivers the card', () => {
  const st = withPool(build());
  X.addCoins(st, 100000);
  const L = B.marketListings(st, now);
  assert.ok(L.length >= 2 && new Set(L.map((x) => x.card.m.id)).size === L.length, `${L.length} live listings, one per play`);
  const l = L[0];
  const v = B.listingView(st, l, now);
  assert.throws(() => B.placeBid(st, l.id, v.minBid - 1, now), /at least/);
  const coins = X.wallet(st);
  const low = B.placeBid(st, l.id, Math.max(v.minBid, 1), now);
  if (!low.leading) assert.equal(X.wallet(st), coins, 'outbid → refunded');
  const r = B.placeBid(st, l.id, l.npcMax + 1000, now);
  assert.ok(r.leading);
  assert.equal(X.wallet(st), coins - (l.npcMax + 1000));
  const n0 = B.boosterState(st).inv.length;
  B.runMarket(st, l.end + 1);
  assert.equal(B.boosterState(st).inv.length, n0 + 1);
  assert.ok(l.price <= l.npcMax + 1000 && X.wallet(st) === coins - l.price, 'paid second price, rest refunded');
  // buy now
  const l2 = B.marketListings(st, now).find((x) => x.id !== l.id);
  const p = B.buyNow(st, l2.id, now);
  assert.ok(p > 0);
});

t('your auctions sell to the bidders or come back', () => {
  const st = withPool(build());
  const c = B.makeCard(st, st.moments[0], { now, rarity: 'legendary' });
  const au = B.listAuction(st, c.id, { start: 1, length: '1h' }, now);
  assert.throws(() => B.equip(st, c.id, c.assetId), /auction/);
  const coins = X.wallet(st);
  B.runMarket(st, now + 2 * HOUR);
  assert.equal(au.status, 'sold');
  assert.equal(X.wallet(st), coins + au.price);
  const c2 = B.makeCard(st, st.moments[0], { now, rarity: 'common' });
  const au2 = B.listAuction(st, c2.id, { start: 99999, length: '1h' }, now);
  B.runMarket(st, now + 2 * HOUR);
  assert.equal(au2.status, 'unsold');
  assert.ok(!B.boosterState(st).inv.find((x) => x.id === c2.id).listed);
});

t('old generic boosters are traded in for coins', () => {
  const st = build();
  st.boosters = { inv: [{ id: 'old', type: 'div', rarity: 'rare', charges: 5, max: 5 }], seq: 1 };
  const coins = X.wallet(st);
  C.runCareer(st, now);
  assert.equal(B.boosterState(st).inv.length, 0);
  assert.equal(X.wallet(st), coins + 55);
});

console.log(`\n${passed} moment-card tests passed`);

// The card economy must not be a money machine: packs and flips return less than they cost.
const sim = (await import('../tools/simcards.mjs')).out;
for (const [k, v] of Object.entries(sim)) assert.ok(v < 0.95, `${k} returns ${(v * 100).toFixed(0)}% of its cost`);
console.log('ok - packs and flipping lose money on average');

// Star premium: a popular player's card is worth more at any rarity, and fusing it costs more.
{
  const st = build();
  const m = (pid) => ({ id: 'pm' + pid, league: 'mlb', kind: 'DOUBLE', desc: '', sit: '', traits: [], rating: 3, rarity: 'common', t: now, player: { id: pid, name: 'P', team: 'ATL' } });
  const star = Object.values(st.assets).filter((a) => a.kind === 'player').sort((x, y) => y.price - x.price)[0];
  const scrub = Object.values(st.assets).filter((a) => a.kind === 'player').sort((x, y) => x.price - y.price)[0];
  const c1 = B.makeCard(st, m(star.rid), { now }); const c2 = B.makeCard(st, m(scrub.rid), { now });
  assert.equal(B.marketValue(c1, now), B.marketValue(c2, now), 'no premium until the market is bound');
  B.bindMarket(() => st);
  assert.equal(B.popularity(c2.m, now), 1);
  assert.equal(B.popularity(c1.m, now), 3.5);
  assert.ok(B.marketValue(c1, now) > 3.3 * B.marketValue(c2, now));
  for (const r of ['uncommon', 'epic', 'iconic']) assert.ok(B.marketValue({ ...c1, rarity: r }, now) > 3.3 * B.marketValue({ ...c2, rarity: r }, now), r);
  // fusing a star's card: fee scales, so it can't be upgraded for less than it gains
  B.makeCard(st, m(scrub.rid), { now }); 
  assert.equal(B.fuseCost(st, 'common'), Math.round(B.fuseFee('common') * B.popularity(B.boosterState(st).inv.slice().sort((x, y) => y.m.rating - x.m.rating)[0].m)));
  assert.ok(B.packCost(st, B.B_PACKS[0]) >= B.B_PACKS[0].cost);
  B.bindMarket(null);
  console.log('ok - star premium on popular players');
}
