// Booster cards: equip one on a stock you own to earn more from it.
//  - Dividend booster: multiplies the dividends that holding pays you.
//  - Game Day booster: pays a cash bonus on top when a game pushes the price up.
//  - Shield booster: refunds part of the loss when a game pushes the price down.
// Boosters come from packs in six rarities (Common → Iconic); rarer = stronger and longer
// lasting. Each game the boosted player or team plays uses one charge. Three of the same
// type and rarity fuse into one of the next rarity. Sell them in the Market, instantly
// or at auction, or buy other people's listings.

import { DAY, HOUR, clamp, seeded } from './util.js';
import { notify, boostHooks } from './engine.js';
import { career, addXP, addCoins, spendCoins, hasLevel, level } from './xp.js';

const round2 = (x) => Math.round(x * 100) / 100;

export const B_RARITY = [
  { key: 'common', name: 'Common', color: '#8b939e', charges: 3, sell: 8 },
  { key: 'uncommon', name: 'Uncommon', color: '#1fd67a', charges: 4, sell: 20 },
  { key: 'rare', name: 'Rare', color: '#3b9dff', charges: 5, sell: 55 },
  { key: 'epic', name: 'Epic', color: '#b36bff', charges: 7, sell: 150 },
  { key: 'legendary', name: 'Legendary', color: '#ffb800', charges: 10, sell: 450 },
  { key: 'iconic', name: 'Iconic', color: '#ff4fa3', charges: 15, sell: 1500 },
];
export const rIdx = (key) => B_RARITY.findIndex((r) => r.key === key);

export const B_TYPES = [
  { key: 'div', name: 'Dividend Booster', icon: '💵', power: [0.10, 0.20, 0.35, 0.60, 1.00, 1.50], value: 0.9,
    text: (p) => `+${Math.round(p * 100)}% dividends from this holding`, short: (p) => `+${Math.round(p * 100)}% dividends` },
  { key: 'game', name: 'Game Day Booster', icon: '🚀', power: [0.05, 0.10, 0.15, 0.25, 0.40, 0.60], value: 1.2,
    text: (p) => `When a game lifts the price, get a bonus of ${Math.round(p * 100)}% of your gain`, short: (p) => `+${Math.round(p * 100)}% bonus on game-day gains` },
  { key: 'shield', name: 'Shield', icon: '🛡️', power: [0.10, 0.20, 0.30, 0.45, 0.60, 0.80], value: 1.0,
    text: (p) => `When a game drops the price, get back ${Math.round(p * 100)}% of your loss`, short: (p) => `${Math.round(p * 100)}% of game-day losses back` },
];
export const bType = (key) => B_TYPES.find((t) => t.key === key);
export const bRarity = (key) => B_RARITY.find((r) => r.key === key);
export const power = (b) => bType(b.type).power[rIdx(b.rarity)];
export const describe = (b) => bType(b.type).text(power(b));
export const describeShort = (b) => bType(b.type).short(power(b));

// How many boosters can be equipped at once: 2, plus one more every 3 levels.
export const slots = (state) => 2 + Math.floor(level(state) / 3);

export function boosterState(state) {
  state.boosters ||= { inv: [], seq: 0 };
  return state.boosters;
}
export const equipped = (state) => boosterState(state).inv.filter((b) => b.on);
export const boosterOn = (state, assetId) => boosterState(state).inv.find((b) => b.on === assetId) || null;

export function makeBooster(state, type, rarity, now = Date.now()) {
  const bs = boosterState(state);
  const r = bRarity(rarity);
  const b = { id: `bo${(++bs.seq).toString(36)}${now.toString(36).slice(-4)}`, type, rarity, charges: r.charges, max: r.charges, on: null, t: now };
  bs.inv.unshift(b);
  return b;
}

export function equip(state, boosterId, assetId) {
  const bs = boosterState(state);
  const b = bs.inv.find((x) => x.id === boosterId);
  if (!b) throw new Error('Booster not found');
  if (b.listed) throw new Error('This booster is up for auction');
  if (!state.holdings[assetId]) throw new Error('Buy some shares first, then boost them');
  if (state.assets[assetId]?.kind === 'fund') throw new Error('Boosters work on players and teams, not funds');
  const current = boosterOn(state, assetId);
  if (current && current.id !== b.id) current.on = null; // swap
  if (!b.on && !current && equipped(state).length >= slots(state)) throw new Error(`All ${slots(state)} booster slots are in use — remove one first (more slots every 3 levels)`);
  b.on = assetId;
  return b;
}

export function unequip(state, boosterId) {
  const b = boosterState(state).inv.find((x) => x.id === boosterId);
  if (b) b.on = null;
}

// Three of the same type and rarity → one of the next rarity, fully charged.
export function fuse(state, type, rarity, now = Date.now()) {
  const i = rIdx(rarity);
  if (i >= B_RARITY.length - 1) throw new Error('Iconic is the top rarity');
  const bs = boosterState(state);
  const pool = bs.inv.filter((b) => b.type === type && b.rarity === rarity && !b.on && !b.listed);
  if (pool.length < 3) throw new Error('You need 3 unequipped boosters of the same type and rarity');
  const use = new Set(pool.slice(-3).map((b) => b.id)); // oldest first
  bs.inv = bs.inv.filter((b) => !use.has(b.id));
  const nb = makeBooster(state, type, B_RARITY[i + 1].key, now);
  addXP(state, 15 * (i + 1), now);
  return nb;
}

// ---------- effects (called by the engine) ----------

function consume(state, b, a, now) {
  b.charges -= 1;
  if (b.charges <= 0) {
    boosterState(state).inv = boosterState(state).inv.filter((x) => x.id !== b.id);
    notify(state, 'booster', `${bRarity(b.rarity).name} ${bType(b.type).name} on ${a.ticker} is used up`, a.id, now);
  }
}

boostHooks.divMult = (state, assetId) => {
  const b = boosterOn(state, assetId);
  return b && b.type === 'div' ? 1 + power(b) : 1;
};

// After a final game moves a held asset's price: bonus or refund, then use a charge.
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

// Boosters on stocks you no longer own come back to your inventory.
export function tidyBoosters(state) {
  for (const b of boosterState(state).inv) if (b.on && !state.holdings[b.on]) b.on = null;
}

// ---------- packs ----------

export const B_PACKS = [
  { key: 'bstarter', name: 'Booster Pack', cost: 150, level: 1, n: 3, min: null, blurb: '3 boosters' },
  { key: 'bpremium', name: 'Premium Boosters', cost: 400, level: 4, n: 3, min: 'rare', blurb: '3 boosters · 1 Rare or better' },
  { key: 'belite', name: 'Elite Boosters', cost: 900, level: 7, n: 4, min: 'epic', blurb: '4 boosters · 1 Epic or better' },
  { key: 'biconic', name: 'Iconic Chase', cost: 2000, level: 10, n: 4, min: 'legendary', blurb: '4 boosters · 1 Legendary+ · best Iconic odds' },
];
// Chance per booster, rarest first.
const ODDS = [['iconic', 0.002], ['legendary', 0.015], ['epic', 0.06], ['rare', 0.18], ['uncommon', 0.45], ['common', 1]];
const ICONIC_CHASE = [['iconic', 0.02], ['legendary', 0.06], ['epic', 0.15], ['rare', 0.35], ['uncommon', 0.65], ['common', 1]];

export function openBoosterPack(state, key, now = Date.now(), rnd = Math.random) {
  const p = B_PACKS.find((x) => x.key === key);
  if (!p) throw new Error('Unknown pack');
  if (!hasLevel(state, p.level)) throw new Error(`${p.name} unlock at level ${p.level}`);
  spendCoins(state, p.cost);
  const odds = key === 'biconic' ? ICONIC_CHASE : ODDS;
  const out = [];
  for (let i = 0; i < p.n; i++) {
    const roll = rnd();
    let r = odds.find(([, q]) => roll < q)[0];
    if (i === p.n - 1 && p.min && rIdx(r) < rIdx(p.min)) r = p.min;
    const t = B_TYPES[Math.floor(rnd() * B_TYPES.length)].key;
    out.push(makeBooster(state, t, r, now));
  }
  const c = career(state); c.lastPack = now; c.packs = (c.packs || 0) + 1;
  addXP(state, 10, now);
  return out.sort((x, y) => rIdx(x.rarity) - rIdx(y.rarity));
}

// ---------- market ----------

// Market value in coins: rarity base × type demand × today's mood × charges left.
export function demand(now = Date.now(), type = '') {
  const rnd = seeded(`demand:${new Date(now).toLocaleDateString('en-CA')}:${type}`);
  return 0.8 + 0.45 * rnd();
}
export function marketValue(b, now = Date.now()) {
  const r = bRarity(b.rarity);
  return Math.max(1, Math.round(r.sell * 1.6 * bType(b.type).value * demand(now, b.type) * (0.35 + 0.65 * b.charges / b.max)));
}
export const quickSellPrice = (b) => Math.max(1, Math.round(bRarity(b.rarity).sell * (0.3 + 0.7 * b.charges / b.max)));

export function quickSell(state, boosterId) {
  const bs = boosterState(state);
  const b = bs.inv.find((x) => x.id === boosterId);
  if (!b) throw new Error('Booster not found');
  if (b.listed) throw new Error('This booster is up for auction');
  const price = quickSellPrice(b);
  bs.inv = bs.inv.filter((x) => x.id !== b.id);
  addCoins(state, price);
  return price;
}

// Today's listings from other collectors: 8 boosters, refreshed daily.
export function listings(state, now = Date.now()) {
  const day = new Date(now).toLocaleDateString('en-CA');
  const rnd = seeded(`listings:${day}`);
  const sellers = ['CourtsideKing', 'GridironGreg', 'DiamondDani', 'BuzzerBeater', 'WaiverWire', 'BoxScoreBea', 'DeepThree', 'FourthAndLong'];
  const bought = state.market?.bought?.[day] || [];
  const out = [];
  for (let i = 0; i < 8; i++) {
    const roll = rnd();
    const r = [['iconic', 0.01], ['legendary', 0.05], ['epic', 0.16], ['rare', 0.4], ['uncommon', 0.7], ['common', 1]].find(([, q]) => roll < q)[0];
    const type = B_TYPES[Math.floor(rnd() * B_TYPES.length)].key;
    const max = bRarity(r).charges;
    const charges = Math.max(1, Math.round(max * (0.5 + 0.5 * rnd())));
    const b = { type, rarity: r, charges, max };
    const price = Math.max(2, Math.round(marketValue(b, now) * (0.85 + 0.45 * rnd())));
    const id = `${day}:${i}`;
    out.push({ id, ...b, price, seller: sellers[Math.floor(rnd() * sellers.length)], sold: bought.includes(id) });
  }
  return out;
}

export function buyListing(state, id, now = Date.now()) {
  const l = listings(state, now).find((x) => x.id === id);
  if (!l) throw new Error('That listing has expired');
  if (l.sold) throw new Error('Already sold');
  spendCoins(state, l.price);
  const b = makeBooster(state, l.type, l.rarity, now);
  b.charges = l.charges;
  state.market ||= {};
  state.market.bought ||= {};
  const day = id.split(':')[0];
  (state.market.bought[day] ||= []).push(id);
  for (const d of Object.keys(state.market.bought)) if (d !== day) delete state.market.bought[d];
  return b;
}

// ---------- auctions ----------

export const AUCTION_LENGTHS = [
  { key: '1h', label: '1 hour', ms: HOUR, boost: 0.9 },
  { key: '6h', label: '6 hours', ms: 6 * HOUR, boost: 1.0 },
  { key: '24h', label: '24 hours', ms: DAY, boost: 1.12 },
];

// Bidders are simulated: how high the bidding goes is decided when you list (luck, plus
// a little more for longer auctions), and bids climb toward it until the auction ends.
export function listAuction(state, boosterId, { start, length = '6h' }, now = Date.now()) {
  const bs = boosterState(state);
  const b = bs.inv.find((x) => x.id === boosterId);
  if (!b) throw new Error('Booster not found');
  if (b.on) throw new Error('Remove it from your stock first');
  if (b.listed) throw new Error('Already listed');
  const L = AUCTION_LENGTHS.find((x) => x.key === length) || AUCTION_LENGTHS[1];
  start = Math.max(1, Math.round(Number(start) || 1));
  const rnd = seeded(`auction:${b.id}:${now}`);
  const n = 2 + Math.floor(rnd() * 6);
  const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const top = Math.round(marketValue(b, now) * L.boost * Math.exp(0.22 * z));
  state.auctions ||= [];
  const au = { id: `au${now.toString(36)}`, booster: { ...b }, start, top, bidders: n, from: now, end: now + L.ms, status: 'live' };
  b.listed = au.id;
  state.auctions.unshift(au);
  return au;
}

export function auctionView(au, now = Date.now()) {
  const f = clamp((now - au.from) / (au.end - au.from), 0, 1);
  const willSell = au.top >= au.start;
  const bids = willSell ? Math.max(1, Math.round(au.bidders * Math.sqrt(f))) : 0;
  const cur = willSell && f > 0.03 ? Math.max(au.start, Math.round(au.start + (au.top - au.start) * Math.pow(f, 0.7))) : null;
  return { f, bids: f > 0.03 ? bids : 0, current: cur, left: Math.max(0, au.end - now) };
}

export function cancelAuction(state, id, now = Date.now()) {
  const au = (state.auctions || []).find((x) => x.id === id && x.status === 'live');
  if (!au) throw new Error('Auction not found');
  if (auctionView(au, now).bids > 0) throw new Error('There are bids already — it can\'t be cancelled');
  au.status = 'cancelled';
  const b = boosterState(state).inv.find((x) => x.listed === au.id);
  if (b) delete b.listed;
}

export function runMarket(state, now = Date.now()) {
  tidyBoosters(state);
  for (const au of state.auctions || []) {
    if (au.status !== 'live' || now < au.end) continue;
    const bs = boosterState(state);
    const b = bs.inv.find((x) => x.listed === au.id);
    const name = `${bRarity(au.booster.rarity).name} ${bType(au.booster.type).name}`;
    if (au.top >= au.start && b) {
      bs.inv = bs.inv.filter((x) => x.id !== b.id);
      au.status = 'sold'; au.price = au.top;
      addCoins(state, au.top);
      addXP(state, 10, now);
      notify(state, 'market', `Sold at auction: ${name} for ${au.top} coins`, null, now);
    } else {
      au.status = 'unsold';
      if (b) delete b.listed;
      notify(state, 'market', `No bids reached ${au.start} coins for your ${name} — it's back in your locker`, null, now);
    }
  }
  if (state.auctions?.length > 30) state.auctions = state.auctions.filter((a, i) => i < 30 || a.status === 'live');
}
