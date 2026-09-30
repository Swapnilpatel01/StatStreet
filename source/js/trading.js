// Options, standing orders (limit/stop), recurring buys and price alerts.
// Everything here is pure state logic; runAutomation() is called on each tick.

import { DAY, HOUR, clamp } from './util.js';
import { trade, previewTrade, priceAt, notify, SPREAD, fmtQty } from './engine.js';
import { bsPrice, greeks, optionVol, YEAR, CONTRACT, OPT_SPREAD } from './bs.js';

const round2 = (x) => Math.round(x * 100) / 100;
const money = (x) => '$' + x.toFixed(2);
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- dollar-based (fractional) orders ----------

// Largest share quantity whose all-in cost fits in `dollars`.
export function dollarsToQty(state, id, dollars, now = Date.now()) {
  const a = state.assets[id];
  if (!a || !(dollars > 0)) return 0;
  let q = dollars / (a.price * (1 + SPREAD));
  for (let i = 0; i < 4; i++) {
    const pv = previewTrade(state, id, 'buy', q, now);
    if (!pv.total) break;
    q *= dollars / pv.total;
  }
  q = Math.floor(q * 1e6) / 1e6;
  while (q > 0 && previewTrade(state, id, 'buy', q, now).total > dollars) q = Math.floor(q * 0.9999 * 1e6) / 1e6;
  return q;
}

// ---------- options ----------

export function expirations(now = Date.now(), n = 4) {
  const out = [];
  const d = new Date(now);
  d.setUTCHours(20, 0, 0, 0); // Friday 4pm New York (EDT)
  while (out.length < n) {
    if (d.getUTCDay() === 5 && d.getTime() - now > 12 * HOUR) out.push(d.getTime());
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function strikeStep(price) {
  if (price < 10) return 0.5;
  if (price < 25) return 1;
  if (price < 60) return 2.5;
  if (price < 150) return 5;
  return 10;
}

export function strikes(price, n = 6) {
  const step = strikeStep(price);
  const mid = Math.round(price / step) * step;
  const out = [];
  for (let i = -n; i <= n; i++) {
    const k = Math.round((mid + i * step) * 100) / 100;
    if (k > 0) out.push(k);
  }
  return out;
}

export const optKey = (under, type, strike, exp) => `${under}|${type}|${strike}|${exp}`;

export function quoteOption(state, under, type, strike, exp, now = Date.now()) {
  const a = state.assets[under];
  const T = Math.max(0, (exp - now) / YEAR);
  const vol = optionVol(state, a, exp, now);
  const iv = vol.iv;
  const mid = bsPrice(type, a.price, strike, T, iv);
  // How much of the premium is game risk: price it again as if no games were left.
  const quietIv = vol.gameVar > 0 ? Math.sqrt(Math.max(vol.total - vol.gameVar, 1e-9) / vol.T) : iv;
  const quiet = vol.gameVar > 0 ? bsPrice(type, a.price, strike, T, quietIv) : mid;
  const gameShare = mid > 0.005 ? clamp(1 - quiet / mid, 0, 1) : 0;
  // Time decay measured over the next day, so a game tomorrow shows up as a big drop.
  const tomorrow = Math.max(now, Math.min(exp, now + 86400e3));
  const midTomorrow = bsPrice(type, a.price, strike, Math.max(0, (exp - tomorrow) / YEAR), optionVol(state, a, exp, tomorrow).iv);
  const half = Math.max(0.01, mid * OPT_SPREAD);
  const ask = round2(Math.max(0.01, mid + half));
  const bid = round2(Math.max(0, mid - half));
  const g = greeks(type, a.price, strike, T, iv);
  const breakeven = type === 'call' ? strike + ask : strike - ask;
  return { mid, bid, ask, iv, T, ...g, theta: midTomorrow - mid, breakeven, toBreakeven: breakeven / a.price - 1, under: a.price,
    games: vol.games, gameMove: vol.move, gameShare };
}

export function buyOption(state, { under, type, strike, exp }, qty, now = Date.now()) {
  qty = Math.floor(qty);
  if (!(qty > 0)) throw new Error('Enter at least 1 contract');
  if (exp - now < HOUR) throw new Error('This contract is about to expire');
  const a = state.assets[under];
  const q = quoteOption(state, under, type, strike, exp, now);
  const total = round2(q.ask * CONTRACT * qty);
  if (total > state.cash + 1e-9) throw new Error(`Not enough cash — this costs ${money(total)}`);
  state.cash = round2(state.cash - total);
  const key = optKey(under, type, strike, exp);
  const pos = state.options[key] || { key, under, type, strike, exp, qty: 0, cost: 0, since: now };
  pos.qty += qty; pos.cost = round2(pos.cost + total);
  state.options[key] = pos;
  const tx = { t: now, id: under, ticker: a.ticker, name: a.name, side: 'buy', qty, price: q.ask, total, kind: 'option', opt: optLabel(a, pos) };
  state.txns.unshift(tx);
  return tx;
}

export function sellOption(state, key, qty, now = Date.now()) {
  const pos = state.options[key];
  if (!pos) throw new Error('You don’t hold this contract');
  qty = Math.floor(qty);
  if (!(qty > 0) || qty > pos.qty) throw new Error(`You hold ${pos.qty} contract${pos.qty === 1 ? '' : 's'}`);
  const a = state.assets[pos.under];
  const q = quoteOption(state, pos.under, pos.type, pos.strike, pos.exp, now);
  const total = round2(q.bid * CONTRACT * qty);
  const avg = pos.cost / pos.qty;
  state.cash = round2(state.cash + total);
  pos.cost = round2(pos.cost - avg * qty); pos.qty -= qty;
  if (pos.qty <= 0) delete state.options[key];
  const tx = { t: now, id: pos.under, ticker: a.ticker, name: a.name, side: 'sell', qty, price: q.bid, total, kind: 'option', opt: optLabel(a, pos) };
  state.txns.unshift(tx);
  return tx;
}

export function optLabel(a, pos) {
  const d = new Date(pos.exp).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'America/New_York' });
  return `${a?.ticker || ''} $${pos.strike} ${pos.type === 'call' ? 'Call' : 'Put'} ${d}`;
}

// Cash-settle expired contracts at intrinsic value.
export function settleOptions(state, now = Date.now()) {
  for (const [key, pos] of Object.entries(state.options)) {
    if (pos.exp > now) continue;
    const a = state.assets[pos.under];
    const S = a ? priceAt(a, pos.exp) : 0;
    const intrinsic = Math.max(0, pos.type === 'call' ? S - pos.strike : pos.strike - S);
    const total = round2(intrinsic * CONTRACT * pos.qty);
    state.cash = round2(state.cash + total);
    delete state.options[key];
    const label = optLabel(a, pos);
    state.txns.unshift({ t: pos.exp, id: pos.under, ticker: a?.ticker, name: a?.name, side: total > 0 ? 'exercise' : 'expire', qty: pos.qty, price: round2(intrinsic), total, kind: 'option', opt: label });
    notify(state, 'option', total > 0
      ? `${label} finished in the money: ${money(total)} paid out (${total >= pos.cost ? '+' : '−'}${money(Math.abs(total - pos.cost))})`
      : `${label} expired worthless (−${money(pos.cost)})`, pos.under, now);
  }
}

// ---------- standing orders ----------

export function placeOrder(state, { assetId, side, type, qty, price }, now = Date.now()) {
  if (!['limit', 'stop'].includes(type)) throw new Error('Unknown order type');
  if (!(price > 0)) throw new Error(`Enter a ${type} price`);
  if (!(qty > 0)) throw new Error('Enter an amount');
  const a = state.assets[assetId];
  if (side === 'sell') {
    const held = state.holdings[assetId]?.qty || 0;
    const pending = state.orders.filter((o) => o.assetId === assetId && o.side === 'sell').reduce((s, o) => s + o.qty, 0);
    if (qty > held - pending + 1e-9) throw new Error(`You have ${fmtQty(Math.max(0, held - pending))} shares available to sell`);
  } else if (qty * price > buyingPower(state) + 1e-9) {
    throw new Error(`Not enough buying power — you have ${money(buyingPower(state))}`);
  }
  const o = { id: uid(), assetId, ticker: a.ticker, side, type, qty: Math.round(qty * 1e6) / 1e6, price: round2(price), t: now };
  state.orders.unshift(o);
  return o;
}

export const cancelOrder = (state, id) => { state.orders = state.orders.filter((o) => o.id !== id); };

// Cash minus money set aside for open limit/stop buys.
export function buyingPower(state) {
  const reserved = state.orders.filter((o) => o.side === 'buy').reduce((s, o) => s + o.qty * o.price * (1 + SPREAD), 0);
  return Math.max(0, round2(state.cash - reserved));
}

function processOrders(state, now) {
  for (const o of [...state.orders]) {
    const a = state.assets[o.assetId];
    if (!a) { cancelOrder(state, o.id); continue; }
    if (now - o.t > 90 * DAY) { cancelOrder(state, o.id); notify(state, 'order', `${o.ticker} ${o.type} order expired after 90 days`, o.assetId, now); continue; }
    let go = false;
    if (o.type === 'limit') {
      const pv = previewTrade(state, o.assetId, o.side, o.qty, now);
      go = o.side === 'buy' ? pv.fill <= o.price : pv.fill >= o.price;
    } else {
      go = o.side === 'buy' ? a.price >= o.price : a.price <= o.price;
    }
    if (!go) continue;
    cancelOrder(state, o.id); // release reserved cash before executing
    try {
      const qty = o.side === 'sell' ? Math.min(o.qty, state.holdings[o.assetId]?.qty || 0) : o.qty;
      const tx = trade(state, o.assetId, o.side, qty, now);
      tx.via = o.type;
      notify(state, 'order', `${o.type === 'stop' ? 'Stop' : 'Limit'} ${o.side} filled: ${fmtQty(tx.qty)} ${o.ticker} at ${money(tx.price)}`, o.assetId, now);
    } catch (e) {
      notify(state, 'order', `${o.ticker} ${o.type} ${o.side} couldn’t fill: ${e.message}`, o.assetId, now);
    }
  }
}

// ---------- recurring buys ----------

export const FREQ = { daily: DAY, weekly: 7 * DAY };

export function addRecurring(state, { assetId, amount, freq }, now = Date.now()) {
  if (!(amount >= 1)) throw new Error('Minimum recurring amount is $1');
  const a = state.assets[assetId];
  const r = { id: uid(), assetId, ticker: a.ticker, amount: round2(amount), freq, next: now, t: now };
  state.recurring.push(r);
  return r;
}

export const cancelRecurring = (state, id) => { state.recurring = state.recurring.filter((r) => r.id !== id); };

function processRecurring(state, now) {
  for (const r of state.recurring) {
    if (now < r.next) continue;
    while (r.next <= now) r.next += FREQ[r.freq];
    try {
      if (r.amount > buyingPower(state)) throw new Error('not enough buying power');
      const qty = dollarsToQty(state, r.assetId, r.amount, now);
      const tx = trade(state, r.assetId, 'buy', qty, now);
      tx.via = 'recurring';
      notify(state, 'order', `Recurring buy: ${money(tx.total)} of ${r.ticker} (${fmtQty(tx.qty)} sh)`, r.assetId, now);
    } catch (e) {
      notify(state, 'order', `Recurring ${r.ticker} buy skipped: ${e.message}`, r.assetId, now);
    }
  }
}

// ---------- price alerts ----------

export function addAlert(state, { assetId, price }, now = Date.now()) {
  const a = state.assets[assetId];
  if (!(price > 0)) throw new Error('Enter a price');
  const dir = price >= a.price ? 'above' : 'below';
  const al = { id: uid(), assetId, ticker: a.ticker, price: round2(price), dir, t: now };
  state.alerts.push(al);
  return al;
}

export const removeAlert = (state, id) => { state.alerts = state.alerts.filter((x) => x.id !== id); };

function processAlerts(state, now) {
  for (const al of [...state.alerts]) {
    const a = state.assets[al.assetId];
    if (!a) continue;
    if ((al.dir === 'above' && a.price >= al.price) || (al.dir === 'below' && a.price <= al.price)) {
      removeAlert(state, al.id);
      notify(state, 'alert', `${al.ticker} is ${al.dir === 'above' ? 'up to' : 'down to'} ${money(a.price)} (alert at ${money(al.price)})`, al.assetId, now);
    }
  }
}

export function runAutomation(state, now = Date.now()) {
  settleOptions(state, now);
  processOrders(state, now);
  processRecurring(state, now);
  processAlerts(state, now);
}

// P/L at expiry across a range of underlying prices, for the payoff chart.
export function payoffCurve(type, strike, premium, qty, lo, hi, n = 60) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const S = lo + ((hi - lo) * i) / n;
    const v = Math.max(0, type === 'call' ? S - strike : strike - S);
    pts.push([S, (v - premium) * CONTRACT * qty]);
  }
  return pts;
}

export { clamp };
