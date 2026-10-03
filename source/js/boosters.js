// Moment cards: real plays (see moments.js) that boost shares of the player who made them.
//  - Dividend boost: multiplies the dividends that player pays you.
//  - Game Day boost: a cash bonus when one of his games pushes the price up.
//  - Shield: part of the loss back when one of his games pushes the price down.
// Rarity comes from the play's rating (Common → Iconic); rarer = stronger and longer
// lasting. Each game the player plays uses one charge. Three cards of the same rarity
// fuse: your best one moves up a rarity. Cards come from moment packs and the Marketplace,
// where collectors auction them (simulated bidders) and you can list your own.

import { DAY, HOUR, clamp, seeded } from './util.js';
import { notify, boostHooks, gameHooks } from './engine.js';
import { career, addXP, addCoins, spendCoins, hasLevel, level, centsFmt } from './xp.js';
import { TRAITS } from './moments.js';

const round2 = (x) => Math.round(x * 100) / 100;

export const B_RARITY = [
  { key: 'common', name: 'Common', color: '#8b939e', charges: 3, sell: 8 },
  { key: 'uncommon', name: 'Uncommon', color: '#2fbf71', charges: 4, sell: 20 },
  { key: 'rare', name: 'Rare', color: '#e07a2e', charges: 5, sell: 55 },
  { key: 'epic', name: 'Epic', color: '#a45cff', charges: 7, sell: 150 },
  { key: 'legendary', name: 'Legendary', color: '#f5b700', charges: 10, sell: 450 },
  { key: 'iconic', name: 'Iconic', color: '#ff4fa3', charges: 15, sell: 1500 },
];
export const rIdx = (key) => B_RARITY.findIndex((r) => r.key === key);

export const B_TYPES = [
  { key: 'div', name: 'Dividend boost', icon: '💵', power: [0.10, 0.20, 0.35, 0.60, 1.00, 1.50],
    text: (p) => `+${Math.round(p * 100)}% dividends from this player`, short: (p) => `+${Math.round(p * 100)}% dividends` },
  { key: 'game', name: 'Game Day boost', icon: '🚀', power: [0.05, 0.10, 0.15, 0.25, 0.40, 0.60],
    text: (p) => `When one of his games lifts the price, get a bonus of ${Math.round(p * 100)}% of your gain`, short: (p) => `+${Math.round(p * 100)}% on game-day gains` },
  { key: 'shield', name: 'Shield', icon: '🛡️', power: [0.10, 0.20, 0.30, 0.45, 0.60, 0.80],
    text: (p) => `When one of his games drops the price, get back ${Math.round(p * 100)}% of your loss`, short: (p) => `${Math.round(p * 100)}% of game-day losses back` },
];
export const bType = (key) => B_TYPES.find((t) => t.key === key);
export const bRarity = (key) => B_RARITY.find((r) => r.key === key);
export const power = (b) => bType(b.type).power[rIdx(b.rarity)];
export const describe = (b) => bType(b.type).text(power(b));
export const describeShort = (b) => bType(b.type).short(power(b));
export const traitList = (m) => (m.traits || []).map((k) => TRAITS[k]).filter(Boolean);

// The boost a moment gives depends on the play: clutch plays protect (Shield), big hits and
// scores pay off on game day, big box-score nights pay dividends.
export function effectFor(m) {
  if ((m.traits || []).some((t) => ['clutch', 'walkoff', 'buzzer', 'pick6'].includes(t))) return 'shield';
  if (/GAME|NIGHT|POINT|HOMER|TOUCHDOWNS|STRIKEOUTS|HIT GAME|TRIPLE-DOUBLE|EXPLOSION|YARDS|SACKS|INTERCEPTIONS|NO-HITTER|DOMINANT/.test(m.kind)) return 'div';
  if (['DOUBLE', 'TRIPLE', 'RBI SINGLE', 'BUCKET', 'FIELD GOAL'].includes(m.kind)) return 'div';
  return 'game';
}

// How many cards can be active at once: 2, plus one more every 3 levels.
export const slots = (state) => 2 + Math.floor(level(state) / 3);

export function boosterState(state) {
  state.boosters ||= { inv: [], seq: 0 };
  return state.boosters;
}
export const equipped = (state) => boosterState(state).inv.filter((b) => b.on);
export const boosterOn = (state, assetId) => boosterState(state).inv.find((b) => b.on === assetId) || null;
export const assetOf = (m) => `${m.league}:p:${m.player.id}`;

export function makeCard(state, m, { now = Date.now(), rarity = m.rarity, serial = null, charges = null } = {}) {
  const bs = boosterState(state);
  const r = bRarity(rarity);
  const b = {
    id: `c${(++bs.seq).toString(36)}${now.toString(36).slice(-4)}`, m, assetId: assetOf(m), type: effectFor(m), rarity,
    charges: charges ?? r.charges, max: r.charges, serial: serial ?? 1 + Math.floor(Math.random() * 999), on: null, t: now,
  };
  bs.inv.unshift(b);
  return b;
}

export function equip(state, cardId, assetId) {
  const bs = boosterState(state);
  const b = bs.inv.find((x) => x.id === cardId);
  if (!b) throw new Error('Card not found');
  if (b.listed) throw new Error('This card is up for auction');
  if (b.assetId !== assetId) throw new Error(`This card only boosts ${b.m.player.name}`);
  if (!state.holdings[assetId]) throw new Error(`Buy some ${b.m.player.name} shares first, then boost them`);
  const current = boosterOn(state, assetId);
  if (current && current.id !== b.id) current.on = null; // swap
  if (!b.on && !current && equipped(state).length >= slots(state)) throw new Error(`All ${slots(state)} card slots are in use — remove one first (more slots every 3 levels)`);
  b.on = assetId;
  return b;
}

export function unequip(state, cardId) {
  const b = boosterState(state).inv.find((x) => x.id === cardId);
  if (b) b.on = null;
}

// Three cards of the same rarity: keep your best-rated one and move it up a rarity, fully charged.
export function fuse(state, rarity, now = Date.now()) {
  const i = rIdx(rarity);
  if (i >= B_RARITY.length - 1) throw new Error('Iconic is the top rarity');
  const bs = boosterState(state);
  const pool = bs.inv.filter((b) => b.rarity === rarity && !b.on && !b.listed).sort((x, y) => y.m.rating - x.m.rating);
  if (pool.length < 3) throw new Error('You need 3 unused cards of the same rarity');
  const [keep, ...burn] = pool.slice(0, 3);
  const gone = new Set(burn.map((b) => b.id));
  bs.inv = bs.inv.filter((b) => !gone.has(b.id));
  const nr = B_RARITY[i + 1];
  Object.assign(keep, { rarity: nr.key, charges: nr.charges, max: nr.charges });
  addXP(state, 15 * (i + 1), now);
  return keep;
}

// ---------- effects (called by the engine) ----------

function consume(state, b, a, now) {
  b.charges -= 1;
  if (b.charges <= 0) {
    boosterState(state).inv = boosterState(state).inv.filter((x) => x.id !== b.id);
    notify(state, 'booster', `Your ${bRarity(b.rarity).name} ${b.m.kind.toLowerCase()} card for ${a.ticker} is used up`, a.id, now);
  }
}

boostHooks.divMult = (state, assetId) => {
  const b = boosterOn(state, assetId);
  return b && b.type === 'div' ? 1 + power(b) : 1;
};

boostHooks.afterGame = (state, a, pct, priceBefore, at) => {
  const b = boosterOn(state, a.id);
  const h = state.holdings[a.id];
  if (!b || !h) return;
  const change = h.qty * priceBefore * pct;
  let cash = 0;
  if (b.type === 'game' && change > 0) cash = round2(change * power(b));
  if (b.type === 'shield' && change < 0) cash = round2(-change * power(b));
  if (cash >= 0.01) {
    state.cash = round2(state.cash + cash);
    notify(state, 'booster', `${bType(b.type).icon} ${b.type === 'game' ? 'Game Day bonus' : 'Shield refund'} on ${a.ticker}: +$${cash.toFixed(2)}`, a.id, at);
  }
  consume(state, b, a, at);
};

export function tidyBoosters(state) {
  for (const b of boosterState(state).inv) if (b.on && !state.holdings[b.on]) b.on = null;
}

// ---------- the moment pool (real plays from recent games) ----------

export function addMoments(state, list) {
  if (!list?.length) return;
  state.moments ||= [];
  const seen = new Set(state.moments.map((m) => m.id));
  for (const m of list) if (!seen.has(m.id)) { state.moments.push(m); seen.add(m.id); }
  const cutoff = Date.now() - 21 * DAY;
  state.moments = state.moments.filter((m) => m.date > cutoff).sort((x, y) => y.date - x.date).slice(0, 600);
}
gameHooks.push((state, league, game) => addMoments(state, game.moments));

const leaguesOn = (state) => Object.keys(state.settings?.leagues || {}).filter((l) => state.settings.leagues[l]);
function poolByRarity(state) {
  const on = leaguesOn(state);
  const by = {};
  for (const m of state.moments || []) if (on.includes(m.league)) (by[m.rarity] ||= []).push(m);
  return by;
}
function drawMoment(by, rarity, rnd) {
  let k = rIdx(rarity);
  for (let step = 0; step < B_RARITY.length; step++) {
    for (const kk of [k - step, k + step]) {
      const list = by[B_RARITY[kk]?.key];
      if (list?.length) return list[Math.floor(rnd() * list.length)];
    }
  }
  return null;
}

// ---------- packs ----------

export const B_PACKS = [
  { key: 'mstarter', name: 'Moment Pack', cost: 150, level: 1, n: 3, min: null, blurb: '3 moment cards' },
  { key: 'mpremium', name: 'Premium Moments', cost: 400, level: 4, n: 3, min: 'rare', blurb: '3 cards · 1 Rare or better' },
  { key: 'melite', name: 'Elite Moments', cost: 900, level: 7, n: 4, min: 'epic', blurb: '4 cards · 1 Epic or better' },
  { key: 'miconic', name: 'Iconic Chase', cost: 2000, level: 10, n: 4, min: 'legendary', blurb: '4 cards · 1 Legendary+ · best Iconic odds' },
];
const ODDS = [['iconic', 0.004], ['legendary', 0.02], ['epic', 0.07], ['rare', 0.2], ['uncommon', 0.48], ['common', 1]];
const CHASE = [['iconic', 0.03], ['legendary', 0.08], ['epic', 0.18], ['rare', 0.4], ['uncommon', 0.7], ['common', 1]];

export function openBoosterPack(state, key, now = Date.now(), rnd = Math.random) {
  const p = B_PACKS.find((x) => x.key === key);
  if (!p) throw new Error('Unknown pack');
  if (!hasLevel(state, p.level)) throw new Error(`${p.name} unlock at level ${p.level}`);
  const by = poolByRarity(state);
  if (!Object.keys(by).length) throw new Error('No moments yet — packs fill up as real games are played');
  spendCoins(state, p.cost);
  const odds = key === 'miconic' ? CHASE : ODDS;
  const out = [];
  for (let i = 0; i < p.n; i++) {
    const roll = rnd();
    let r = odds.find(([, q]) => roll < q)[0];
    if (i === p.n - 1 && p.min && rIdx(r) < rIdx(p.min)) r = p.min;
    const m = drawMoment(by, r, rnd);
    // A card can be pulled at a higher rarity than its play (a "parallel"), never lower.
    out.push(makeCard(state, m, { now, rarity: rIdx(r) > rIdx(m.rarity) ? r : m.rarity }));
  }
  const c = career(state); c.lastPack = now; c.packs = (c.packs || 0) + 1;
  addXP(state, 10, now);
  return out.sort((x, y) => rIdx(x.rarity) - rIdx(y.rarity));
}

// ---------- value ----------

export function demand(now = Date.now(), key = '') {
  const rnd = seeded(`demand:${new Date(now).toLocaleDateString('en-CA')}:${key}`);
  return 0.85 + 0.35 * rnd();
}
// Coins: rarity base × play rating × the day's demand for that league × charges left.
export function marketValue(b, now = Date.now()) {
  const r = bRarity(b.rarity);
  return Math.max(1, Math.round(r.sell * 1.6 * (0.75 + b.m.rating / 16) * demand(now, b.m.league) * (0.35 + 0.65 * b.charges / b.max)));
}
export const quickSellPrice = (b) => Math.max(1, Math.round(bRarity(b.rarity).sell * (0.3 + 0.7 * b.charges / b.max)));

export function quickSell(state, cardId) {
  const bs = boosterState(state);
  const b = bs.inv.find((x) => x.id === cardId);
  if (!b) throw new Error('Card not found');
  if (b.listed) throw new Error('This card is up for auction');
  const price = quickSellPrice(b);
  bs.inv = bs.inv.filter((x) => x.id !== b.id);
  addCoins(state, price);
  return price;
}

// ---------- marketplace: auctions from other collectors ----------

const SELLERS = ['CourtsideKing', 'GridironGreg', 'DiamondDani', 'BuzzerBeater', 'WaiverWire', 'BoxScoreBea', 'DeepThree', 'FourthAndLong', 'SixthMan', 'BullpenBob', 'RedZoneRay', 'PostUpPaz'];
const MP_ODDS = [['iconic', 0.01], ['legendary', 0.05], ['epic', 0.14], ['rare', 0.36], ['uncommon', 0.68], ['common', 1]];
const increment = (p) => Math.max(1, Math.ceil(p * 0.08));

function mp(state) {
  state.mp ||= { hour: 0, list: [], bids: {} };
  return state.mp;
}

// New listings appear every hour (2 per hour, 1–24h long). Kept in state so they don't
// change as new moments arrive.
function stockListings(state, now) {
  const m = mp(state);
  const by = poolByRarity(state);
  if (!Object.keys(by).length) return;
  const hourNow = Math.floor(now / HOUR);
  const from = Math.max(m.hour + 1, hourNow - 23);
  for (let h = from; h <= hourNow; h++) {
    const rnd = seeded(`mp:${h}`);
    for (let i = 0; i < 2; i++) {
      const roll = rnd();
      const r = MP_ODDS.find(([, q]) => roll < q)[0];
      const mo = drawMoment(by, r, rnd);
      if (!mo) continue;
      const rarity = rIdx(r) > rIdx(mo.rarity) ? r : mo.rarity;
      const max = bRarity(rarity).charges;
      const card = { m: mo, rarity, charges: Math.max(1, Math.round(max * (0.6 + 0.4 * rnd()))), max, type: effectFor(mo), serial: 1 + Math.floor(rnd() * 999) };
      const value = marketValue(card, h * HOUR);
      const start = Math.max(1, Math.round(value * (0.35 + 0.3 * rnd())));
      const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
      const npcMax = Math.max(start, Math.round(value * Math.exp(0.25 * z)));
      const t0 = h * HOUR + Math.floor(rnd() * HOUR);
      const len = [1, 2, 4, 6, 9, 12, 18, 24][Math.floor(rnd() * 8)] * HOUR;
      m.list.push({ id: `mp${h}-${i}`, card, start, npcMax, from: t0, end: t0 + len, seller: SELLERS[Math.floor(rnd() * SELLERS.length)], bidders: 1 + Math.floor(rnd() * 7) });
    }
  }
  m.hour = hourNow;
  m.list = m.list.filter((l) => l.end > now - 2 * HOUR || l.mine);
}

// What the auction looks like right now: other bidders' price climbs toward their limit.
export function listingView(state, l, now = Date.now()) {
  const f = clamp((now - l.from) / (l.end - l.from), 0, 1);
  const npcNow = f < 0.02 ? 0 : Math.round(l.start + (l.npcMax - l.start) * Math.pow(f, 0.8));
  const my = mp(state).bids[l.id];
  const leading = my && my.amount > l.npcMax;
  const current = leading ? Math.max(l.start, Math.min(my.amount, npcNow + increment(npcNow))) : Math.max(l.start, npcNow);
  const bids = (f < 0.02 ? 0 : Math.max(1, Math.round(l.bidders * Math.sqrt(f)))) + (my ? 1 : 0);
  return { current, bids, leading, mine: !!my, minBid: (bids ? current + increment(current) : l.start), left: Math.max(0, l.end - now), ended: now >= l.end };
}

export function marketListings(state, now = Date.now()) {
  stockListings(state, now);
  return mp(state).list.filter((l) => l.from <= now && l.end > now && !l.mine);
}

// Proxy bidding: you set your limit; other bidders bid up to theirs. If yours is higher you
// lead and pay just above theirs at the end; if not, you're outbid right away and refunded.
export function placeBid(state, id, amount, now = Date.now()) {
  const l = mp(state).list.find((x) => x.id === id);
  if (!l || now >= l.end) throw new Error('This auction has ended');
  const v = listingView(state, l, now);
  amount = Math.round(Number(amount));
  if (!(amount >= v.minBid)) throw new Error(`Bid at least ${centsFmt(v.minBid)}`);
  const prev = mp(state).bids[id];
  if (prev && amount <= prev.amount) throw new Error(`You already bid ${centsFmt(prev.amount)} — raise it to bid again`);
  const extra = amount - (prev?.amount || 0);
  if (extra > 0) spendCoins(state, extra);
  if (amount <= l.npcMax) {
    // Someone else's limit is higher: they outbid you straight away.
    addCoins(state, amount); // everything you put up comes back
    delete mp(state).bids[id];
    l.outbid = Math.min(l.npcMax, amount + increment(amount));
    return { leading: false, price: l.outbid };
  }
  mp(state).bids[id] = { amount, t: now };
  return { leading: true, price: listingView(state, l, now).current };
}

export function buyNowPrice(l) { return Math.max(l.start + 1, Math.round(Math.max(l.npcMax, marketValue(l.card)) * 1.35)); }

export function buyNow(state, id, now = Date.now()) {
  const m = mp(state);
  const l = m.list.find((x) => x.id === id);
  if (!l || now >= l.end) throw new Error('This auction has ended');
  const price = buyNowPrice(l);
  const prev = m.bids[id];
  if (prev) { addCoins(state, prev.amount); delete m.bids[id]; }
  spendCoins(state, price);
  l.end = now; l.won = true;
  makeCard(state, l.card.m, { now, rarity: l.card.rarity, serial: l.card.serial, charges: l.card.charges });
  return price;
}

// ---------- your own auctions ----------

export const AUCTION_LENGTHS = [
  { key: '1h', label: '1 hour', ms: HOUR, boost: 0.9 },
  { key: '6h', label: '6 hours', ms: 6 * HOUR, boost: 1.0 },
  { key: '24h', label: '24 hours', ms: DAY, boost: 1.12 },
];

export function listAuction(state, cardId, { start, length = '6h' }, now = Date.now()) {
  const bs = boosterState(state);
  const b = bs.inv.find((x) => x.id === cardId);
  if (!b) throw new Error('Card not found');
  if (b.on) throw new Error('Take it off the player first');
  if (b.listed) throw new Error('Already listed');
  const L = AUCTION_LENGTHS.find((x) => x.key === length) || AUCTION_LENGTHS[1];
  start = Math.max(1, Math.round(Number(start) || 1));
  const rnd = seeded(`auction:${b.id}:${now}`);
  const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const top = Math.round(marketValue(b, now) * L.boost * Math.exp(0.22 * z));
  const au = { id: `my${now.toString(36)}`, mine: true, cardId: b.id, card: { m: b.m, rarity: b.rarity, charges: b.charges, max: b.max, type: b.type, serial: b.serial },
    start, npcMax: top, from: now, end: now + L.ms, bidders: 2 + Math.floor(rnd() * 6), status: 'live' };
  b.listed = au.id;
  mp(state).list.push(au);
  return au;
}

export function myAuctions(state) { return mp(state).list.filter((l) => l.mine); }

export function cancelAuction(state, id, now = Date.now()) {
  const l = mp(state).list.find((x) => x.id === id && x.mine && x.status === 'live');
  if (!l) throw new Error('Auction not found');
  if (l.npcMax >= l.start && listingView(state, l, now).bids > 0) throw new Error('There are bids already — it can\'t be cancelled');
  l.status = 'cancelled'; l.end = now;
  const b = boosterState(state).inv.find((x) => x.listed === l.id);
  if (b) delete b.listed;
}

export function runMarket(state, now = Date.now()) {
  tidyBoosters(state);
  stockListings(state, now);
  const m = mp(state);
  for (const l of m.list) {
    if (now < l.end || l.settled) continue;
    l.settled = true;
    if (l.mine) {
      if (l.status !== 'live') continue;
      const bs = boosterState(state);
      const b = bs.inv.find((x) => x.listed === l.id);
      const name = `${l.card.m.player.name} ${l.card.m.kind.toLowerCase()}`;
      if (l.npcMax >= l.start && b) {
        bs.inv = bs.inv.filter((x) => x.id !== b.id);
        l.status = 'sold'; l.price = l.npcMax;
        addCoins(state, l.npcMax); addXP(state, 10, now);
        notify(state, 'market', `Sold at auction: ${name} card for ${centsFmt(l.npcMax)}`, null, now);
      } else {
        l.status = 'unsold';
        if (b) delete b.listed;
        notify(state, 'market', `No bids reached ${centsFmt(l.start)} for your ${name} card — it's back in your Locker`, null, now);
      }
      continue;
    }
    const my = m.bids[l.id];
    if (!my) continue;
    // You won: pay just over the next-highest limit (never more than your own bid).
    const price = Math.min(my.amount, Math.max(l.start, l.npcMax + increment(l.npcMax)));
    addCoins(state, my.amount - price);
    delete m.bids[l.id];
    l.won = true; l.price = price;
    makeCard(state, l.card.m, { now, rarity: l.card.rarity, serial: l.card.serial, charges: l.card.charges });
    addXP(state, 10, now);
    notify(state, 'market', `You won the ${l.card.m.player.name} ${l.card.m.kind.toLowerCase()} card for ${centsFmt(price)}!`, null, now);
  }
}

// Older saves had generic boosters: refund them as coins.
export function migrateBoosters(state, now = Date.now()) {
  const bs = boosterState(state);
  const old = bs.inv.filter((b) => !b.m);
  if (!old.length && !state.auctions?.length) return 0;
  let coins = 0;
  for (const b of old) coins += Math.max(1, Math.round(bRarity(b.rarity)?.sell * (0.3 + 0.7 * b.charges / b.max)) || 1);
  bs.inv = bs.inv.filter((b) => b.m);
  delete state.auctions;
  if (coins) {
    addCoins(state, coins);
    notify(state, 'market', `Boosters are now player moment cards. Your old boosters were traded in for ${centsFmt(coins)}.`, null, now);
  }
  return coins;
}
