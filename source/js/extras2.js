// More extras: short selling, position protection, risk check, breakouts, weekly recap,
// rivalries, season futures, card history, wanted cards and the showcase.

import { netWorth, notify, change, priceAt, SPREAD, fmtQty, shortsValue, whatIfPlayer, whatIfTeam, gameNoise } from './engine.js';
import { posGroup } from './scoring.js';
import { addXP, addCoins, centsFmt } from './xp.js';
import { marketValue, boosterState, bRarity } from './boosters.js';
import { leaderboard, RIVALS } from './social.js';
import { closedTrades, lineupToday } from './extras.js';
import { DAY, HOUR, weekId, weekStart, seeded } from './util.js';

const round2 = (x) => Math.round(x * 100) / 100;
const money = (x) => '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- short selling ----------
// You put up cash equal to the position. You gain when the price falls and lose when it
// rises; a daily borrowing fee and any dividends the player pays are charged to you.
export const BORROW_DAILY = 0.0025;   // 0.25% of the position per day
export const SHORT_CAP = 0.5;         // shorts can't exceed half your net worth
const LIQ = 0.15;                     // closed automatically when only 15% of your stake is left

export const shortEquity = (state, id) => { const s = state.shorts?.[id]; return s ? s.margin + (s.entry - (state.assets[id]?.price ?? s.entry)) * s.qty - (s.fee || 0) : 0; };
export const shortExposure = (state) => Object.entries(state.shorts || {}).reduce((v, [id, s]) => v + (state.assets[id]?.price || s.entry) * s.qty, 0);

export function openShort(state, id, dollars, now = Date.now()) {
  const a = state.assets[id];
  if (!a || a.kind === 'fund') throw new Error('Only players and teams can be shorted');
  dollars = round2(Number(dollars));
  if (!(dollars >= 0.05)) throw new Error('Enter an amount');
  if (dollars > state.cash + 1e-9) throw new Error(`Not enough cash — you have ${money(state.cash)}`);
  if (state.holdings[id]) throw new Error('Sell your shares first: you can\'t own and short the same player');
  const cap = netWorth(state, now) * SHORT_CAP;
  if (shortExposure(state) + dollars > cap + 1e-9) throw new Error(`Shorts are limited to half your net worth (${money(Math.max(0, cap - shortExposure(state)))} left)`);
  const fill = a.price * (1 - SPREAD);
  const qty = Math.round((dollars / fill) * 1e6) / 1e6;
  state.shorts ||= {};
  const s = state.shorts[id];
  if (s) { s.entry = (s.entry * s.qty + fill * qty) / (s.qty + qty); s.qty = Math.round((s.qty + qty) * 1e6) / 1e6; s.margin = round2(s.margin + dollars); }
  else state.shorts[id] = { qty, entry: fill, margin: dollars, fee: 0, t: now, last: now };
  state.cash = round2(state.cash - dollars);
  state.txns.unshift({ t: now, id, ticker: a.ticker, name: a.name, side: 'short', qty, price: round2(fill), total: dollars, kind: 'short' });
  return state.shorts[id];
}

export function coverShort(state, id, now = Date.now(), { forced = false } = {}) {
  const s = state.shorts?.[id]; const a = state.assets[id];
  if (!s) throw new Error('No short position');
  const fill = (a?.price ?? s.entry) * (1 + SPREAD);
  const pl = round2((s.entry - fill) * s.qty - (s.fee || 0));
  const back = Math.max(0, round2(s.margin + pl));
  state.cash = round2(state.cash + back);
  delete state.shorts[id];
  state.txns.unshift({ t: now, id, ticker: a?.ticker, name: a?.name, side: 'cover', qty: s.qty, price: round2(fill), total: back, kind: 'short', pl: round2(back - s.margin) });
  if (forced) notify(state, 'order', `Short on ${a?.ticker} closed automatically: the price rose too far. You got back ${money(back)} of ${money(s.margin)}.`, id, now);
  return { pl: round2(back - s.margin), back };
}

function runShorts(state, now) {
  for (const [id, s] of Object.entries(state.shorts || {})) {
    const a = state.assets[id];
    if (!a) continue;
    const dt = Math.max(0, now - (s.last || now)); s.last = now;
    s.fee = Math.round(((s.fee || 0) + a.price * s.qty * BORROW_DAILY * dt / DAY) * 10000) / 10000;
    if (shortEquity(state, id) <= s.margin * LIQ) coverShort(state, id, now, { forced: true });
  }
}

// ---------- stop-loss and take-profit ----------
export function protection(state, id) {
  const os = (state.orders || []).filter((o) => o.assetId === id && o.oco);
  return { stop: os.find((o) => o.type === 'stop') || null, take: os.find((o) => o.type === 'limit') || null };
}
export function clearProtection(state, id) { state.orders = (state.orders || []).filter((o) => !(o.assetId === id && o.oco)); }
// stopPct / takePct are fractions of the current price (0.1 = sell if it falls 10%). Either may be 0 to skip.
export function protect(state, id, { stopPct = 0, takePct = 0 }, now = Date.now()) {
  const a = state.assets[id]; const h = state.holdings[id];
  if (!a || !h) throw new Error('You need to own it first');
  if (!(stopPct > 0) && !(takePct > 0)) throw new Error('Enter a stop-loss or a take-profit');
  if (stopPct >= 0.95) throw new Error('Stop-loss must be under 95%');
  clearProtection(state, id);
  const oco = uid();
  const mk = (type, price) => state.orders.unshift({ id: uid(), assetId: id, ticker: a.ticker, side: 'sell', type, qty: h.qty, price: round2(price), t: now, oco });
  if (stopPct > 0) mk('stop', a.price * (1 - stopPct));
  if (takePct > 0) mk('limit', a.price * (1 + takePct));
  return protection(state, id);
}
// Keep protection sized to the position (after more buys or partial sells).
function syncProtection(state) {
  for (const o of state.orders || []) {
    if (!o.oco) continue;
    const h = state.holdings[o.assetId];
    if (!h) o.dead = true; else o.qty = h.qty;
  }
  if ((state.orders || []).some((o) => o.dead)) state.orders = state.orders.filter((o) => !o.dead);
}

// ---------- portfolio risk check ----------
export function riskReport(state, now = Date.now()) {
  const nw = netWorth(state, now) || 1;
  const pos = Object.entries(state.holdings || {}).map(([id, h]) => ({ a: state.assets[id], v: (state.assets[id]?.price || 0) * h.qty })).filter((x) => x.a);
  const invested = pos.reduce((s, x) => s + x.v, 0);
  const group = (fn) => { const m = new Map(); for (const x of pos) { const k = fn(x.a); if (k) m.set(k, (m.get(k) || 0) + x.v); } return [...m.entries()].map(([k, v]) => ({ k, v, pct: v / nw })).sort((x, y) => y.v - x.v); };
  const byLeague = group((a) => (a.kind === 'fund' ? 'Index funds' : a.league.toUpperCase()));
  const byTeam = group((a) => (a.kind === 'fund' ? null : `${a.teamAbbr || a.ticker}`));
  const byPos = group((a) => (a.kind === 'player' ? (a.league === 'nba' ? (a.pos || 'Player') : posGroup(a.league, a.pos)) : a.kind === 'team' ? 'Teams' : 'Funds'));
  const top = pos.slice().sort((x, y) => y.v - x.v)[0] || null;
  const games = lineupToday(state, now).map((g) => ({ g, v: g.mine.filter((x) => x.own).reduce((s, x) => s + (state.assets[x.a.id].price * (state.holdings[x.a.id]?.qty || 0)), 0) })).sort((x, y) => y.v - x.v);
  const shorts = shortExposure(state);
  const warn = [];
  if (top && top.v / nw > 0.4) warn.push(`${top.a.name} is ${Math.round(top.v / nw * 100)}% of your net worth. One bad game hits hard.`);
  if (byTeam[0] && byTeam[0].pct > 0.5 && pos.length > 1) warn.push(`${Math.round(byTeam[0].pct * 100)}% rides on ${byTeam[0].k}. An injury or a losing streak there moves everything.`);
  if (games[0] && games[0].v / nw > 0.5) warn.push(`${Math.round(games[0].v / nw * 100)}% of your money is in one game today (${games[0].g.name}).`);
  if (byLeague.length === 1 && pos.length >= 3 && byLeague[0].k !== 'Index funds') warn.push(`Everything is in ${byLeague[0].k}. Another league or an index fund spreads the risk.`);
  const hurt = pos.filter((x) => x.a.injury && x.v / nw > 0.1);
  if (hurt.length) warn.push(`${hurt.map((x) => x.a.ticker).join(', ')} ${hurt.length > 1 ? 'are' : 'is'} injured and still a big holding.`);
  if (shorts / nw > 0.3) warn.push(`Shorts are ${Math.round(shorts / nw * 100)}% of your net worth. A rally costs you on all of them at once.`);
  if (pos.length && state.cash / nw < 0.03) warn.push('Almost no cash left, so you can\'t buy a dip without selling something.');
  // Score: 100 = well spread. Concentration (sum of squared weights) drives it.
  const hhi = pos.reduce((s, x) => s + (x.v / nw) ** 2, 0);
  const score = pos.length ? Math.round(Math.max(5, Math.min(100, 100 - 85 * hhi - 12 * warn.length))) : 100;
  return { nw, invested, cash: state.cash, cashPct: state.cash / nw, n: pos.length, top, byLeague, byTeam: byTeam.slice(0, 5), byPos: byPos.slice(0, 6), games: games.slice(0, 3), shorts, warn, score,
    label: !pos.length ? 'All cash' : score >= 70 ? 'Well spread' : score >= 45 ? 'Moderate' : 'Concentrated' };
}

// ---------- what-if scenarios ----------
export function scenarios(state, a) {
  if (a.kind === 'player') {
    const ema = a.perf?.ema; if (ema == null) return [];
    const n = a.perf.gn ?? gameNoise(state, a.league, posGroup(a.league, a.pos));
    return [['Rough night', ema - 1.5 * n], ['Below par', ema - 0.7 * n], ['His usual game', ema], ['Good game', ema + 0.7 * n], ['Big night', ema + 1.5 * n], ['Career night', ema + 3 * n]]
      .map(([label, gs]) => { const p = whatIfPlayer(state, a, gs); return p == null ? null : { label, detail: `game score ${Math.max(0, gs).toFixed(1)}`, price: p, pct: p / a.price - 1 }; }).filter(Boolean);
  }
  if (a.kind === 'team') {
    const m = a.league === 'nba' ? [15, 5] : a.league === 'nfl' ? [17, 4] : [5, 1];
    return [['Blowout loss', false, -m[0]], ['Close loss', false, -m[1]], ['Close win', true, m[1]], ['Blowout win', true, m[0]]]
      .map(([label, won, mg]) => { const p = whatIfTeam(state, a, won, mg); return { label, detail: `${won ? 'wins' : 'loses'} by ${Math.abs(mg)}`, price: p, pct: p / a.price - 1 }; });
  }
  return [];
}

// ---------- breakout watch ----------
export function breakouts(state, now = Date.now(), n = 15) {
  const out = [];
  const byLg = {};
  for (const a of Object.values(state.assets)) if (a.kind === 'player' && a.price > 0 && a.hist?.length) (byLg[a.league] ||= []).push(a.price);
  const med = Object.fromEntries(Object.entries(byLg).map(([k, v]) => { v.sort((x, y) => x - y); return [k, v[Math.floor(v.length / 2)]]; }));
  for (const a of Object.values(state.assets)) {
    if (a.kind !== 'player' || a.injury || !a.hist?.length) continue;
    if (state.settings?.leagues && state.settings.leagues[a.league] === false) continue;
    const games = (a.perf?.last || []).filter((g) => !/preseason/.test(g.text || ''));
    if (games.length < 3 || a.price > med[a.league]) continue;
    const st = state.stats[a.league]?.[posGroup(a.league, a.pos)];
    const base = a.perf.lvl ?? a.perf.ema;
    if (!st || base == null) continue;
    const recent = games.slice(0, 3).reduce((s, g) => s + g.gs, 0) / 3;
    const lift = (recent - base) / st.sd;
    if (lift > 0.35) out.push({ a, lift, recent, base, wk: change(a, now, 7 * DAY) });
  }
  return out.sort((x, y) => y.lift - x.lift).slice(0, n);
}

// ---------- weekly recap ----------
function nwAt(state, t) {
  const h = state.nw || [];
  if (!h.length) return null;
  for (let i = h.length - 2; i >= 0; i -= 2) if (h[i] <= t) return h[i + 1];
  return h[1];
}
export function weeklyRecap(state, now = Date.now()) {
  const from = Math.max(now - 7 * DAY, state.season?.start || 0, state.startedAt || 0);
  const nw = netWorth(state, now); const nw0 = nwAt(state, from) ?? state.startCash;
  const trades = closedTrades(state).filter((t) => t.t >= from);
  const holds = Object.entries(state.holdings || {}).map(([id, h]) => { const a = state.assets[id]; if (!a) return null; const p0 = priceAt(a, from); return { a, d: (a.price - p0) * h.qty, pct: p0 ? a.price / p0 - 1 : 0 }; }).filter(Boolean).sort((x, y) => y.d - x.d);
  const divs = (state.divs || []).filter((d) => d.t >= from);
  const picks = Object.values(state.picks || {}).filter((p) => p.result && (p.settled || 0) >= from);
  const board = leaderboard(state, now);
  return { from, change: round2(nw - nw0), pct: nw0 ? nw / nw0 - 1 : 0, nw,
    bestTrade: trades.slice().sort((x, y) => y.pl - x.pl)[0] || null, worstTrade: trades.length > 1 ? trades.slice().sort((x, y) => x.pl - y.pl)[0] : null, nTrades: trades.length,
    bestHold: holds[0] && holds[0].d > 0 ? holds[0] : null, worstHold: holds.length && holds[holds.length - 1].d < 0 ? holds[holds.length - 1] : null,
    divs: round2(divs.reduce((s, d) => s + d.amt, 0)), nDivs: divs.length,
    picksW: picks.filter((p) => p.result === 'won').length, picksL: picks.filter((p) => p.result === 'lost').length,
    rank: board.findIndex((r) => r.you) + 1, of: board.length };
}
// Offered once at the start of each week.
export const recapDue = (state, now = Date.now()) => state.recapSeen !== weekId(now) && now - weekStart(now) < 2 * DAY && (state.txns?.length || Object.keys(state.holdings || {}).length) > 0;

// ---------- rivalries ----------
export function chooseRival(state, fund, now = Date.now()) {
  const r = RIVALS.find((x) => x.fund === fund); const f = state.assets[`fund:${fund}`];
  if (!r || !f?.price) throw new Error('That rival isn\'t available yet');
  state.rival = { fund, name: r.name, week: weekId(now), start: now, nw0: round2(netWorth(state, now)), flow0: state.flow || 0, p0: f.price, w: state.rival?.w || 0, l: state.rival?.l || 0 };
  return state.rival;
}
export function rivalStatus(state, now = Date.now()) {
  const r = state.rival; if (!r) return null;
  const f = state.assets[`fund:${r.fund}`];
  const me = (netWorth(state, now) - ((state.flow || 0) - r.flow0)) / (r.nw0 || 1) - 1;
  const him = f?.price ? f.price / r.p0 - 1 : 0;
  return { ...r, me, him, ahead: me >= him, ends: weekStart(now) + 7 * DAY };
}
function runRival(state, now) {
  const r = state.rival; if (!r) return;
  if ((state.season?.start || 0) > r.start) { chooseRival(state, r.fund, now); return; } // a new season restarts the match
  if (r.week === weekId(now)) return;
  const s = rivalStatus(state, now);
  const won = s.me > s.him;
  if (won) { addXP(state, 60, now); addCoins(state, 50); }
  notify(state, 'rival', `Week over: you ${won ? 'beat' : 'lost to'} ${r.name}, ${(s.me * 100).toFixed(1)}% to ${(s.him * 100).toFixed(1)}%.${won ? ' +60 XP · +$0.50' : ''}`, null, now);
  const rec = { w: r.w + (won ? 1 : 0), l: r.l + (won ? 0 : 1) };
  chooseRival(state, r.fund, now); Object.assign(state.rival, rec);
}

// ---------- season futures ----------
// Two markets per league, settled when the StatStreet season ends:
//   mvp    = the highest-priced player in the league at season end
//   leader = the team with the best record at season end
const FUT_EDGE = 0.85; const FUT_LOCK = 7 * DAY;
const winPct = (t) => (t.rec?.gp ? (t.rec.w + 0.5 * (t.rec.t || 0)) / t.rec.gp : 0);
export function futuresMarkets(state, now = Date.now()) {
  const out = [];
  for (const lg of Object.keys(state.settings?.leagues || {})) {
    if (!state.settings.leagues[lg]) continue;
    const list = Object.values(state.assets).filter((a) => a.league === lg && a.price > 0 && a.hist?.length);
    const mk = (type, title, items, power) => {
      const top = items.slice(0, 8);
      if (top.length < 3) return;
      const w = top.map((a) => Math.pow(a.price, power)); const tot = w.reduce((s, x) => s + x, 0) * 1.12; // the field keeps a share
      out.push({ key: `${lg}:${type}`, league: lg, type, title, options: top.map((a, i) => ({ id: a.id, name: a.name, ticker: a.ticker, p: w[i] / tot, mult: Math.min(40, Math.max(1.15, round2(FUT_EDGE / (w[i] / tot)))) })) });
    };
    mk('mvp', 'Most valuable player', list.filter((a) => a.kind === 'player').sort((x, y) => y.price - x.price), 2);
    mk('leader', 'Best record', list.filter((a) => a.kind === 'team').sort((x, y) => y.price - x.price), 3);
  }
  return out;
}
export const futuresOpen = (state, now = Date.now()) => !!state.season && state.season.end - now > FUT_LOCK;
export function betFuture(state, key, assetId, stake, now = Date.now()) {
  if (!state.season) throw new Error('No season running');
  if (!futuresOpen(state, now)) throw new Error('Futures close a week before the season ends');
  stake = round2(Number(stake));
  if (!(stake >= 0.05)) throw new Error('Enter a stake');
  if (stake > state.cash + 1e-9) throw new Error(`Not enough cash — you have ${money(state.cash)}`);
  if (stake > Math.max(0.5, netWorth(state, now) * 0.1)) throw new Error('A futures bet can be at most 10% of your net worth');
  state.futures ||= [];
  if (state.futures.some((f) => f.key === key && f.season === state.season.n && !f.result)) throw new Error('You already have a bet in this market this season');
  const m = futuresMarkets(state, now).find((x) => x.key === key); const o = m?.options.find((x) => x.id === assetId);
  if (!o) throw new Error('That pick isn\'t offered');
  state.cash = round2(state.cash - stake);
  const f = { id: uid(), key, league: m.league, type: m.type, title: m.title, pick: assetId, name: o.name, stake, mult: o.mult, season: state.season.n, t: now, result: null };
  state.futures.unshift(f);
  return f;
}
function settleFutures(state, now) {
  const s = state.season;
  if (!s || now < s.end) return;
  for (const f of state.futures || []) {
    if (f.result || f.season !== s.n) continue;
    const list = Object.values(state.assets).filter((a) => a.league === f.league && a.price > 0);
    const winner = f.type === 'mvp' ? list.filter((a) => a.kind === 'player').sort((x, y) => y.price - x.price)[0]
      : list.filter((a) => a.kind === 'team').sort((x, y) => winPct(y) - winPct(x) || y.price - x.price)[0];
    f.winner = winner?.name || ''; f.result = winner?.id === f.pick ? 'won' : 'lost';
    if (f.result === 'won') { f.paid = round2(f.stake * f.mult); state.futPending = round2((state.futPending || 0) + f.paid); addXP(state, 80, now); }
    notify(state, 'future', `${f.title} (${f.league.toUpperCase()}): ${f.winner} took it. Your pick ${f.name} ${f.result === 'won' ? `won ${money(f.paid)}` : 'missed'}.`, f.pick, now);
  }
  if (state.futures?.length > 40) state.futures.length = 40;
}
// Winnings land after the season reset, on top of the new bankroll.
function payFutures(state, now) {
  if (!(state.futPending > 0) || !state.season || now >= state.season.end) return;
  addCoins(state, Math.round(state.futPending * 100));
  state.futPending = 0;
}

// ---------- cards: value history, recent sales, wanted, showcase ----------
export function cardHistory(card, now = Date.now(), days = 14) {
  const out = [];
  for (let d = days; d >= 0; d--) { const t = now - d * DAY; out.push(t, marketValue(card, t)); }
  return out;
}
export function recentSales(state, card, now = Date.now(), n = 5) {
  const real = (state.mp?.list || []).filter((l) => !l.mine && l.end <= now && now - l.end < 5 * DAY && l.card.rarity === card.rarity && l.npcMax >= l.start)
    .sort((x, y) => y.end - x.end).slice(0, n).map((l) => ({ t: l.end, name: l.card.m.player.name, kind: l.card.m.kind, price: l.npcMax }));
  if (real.length >= 3) return real;
  // Not enough finished auctions on this phone yet: show what similar cards go for.
  const pool = (state.moments || []).filter((m) => m.id !== card.m?.id);
  const rnd = seeded(`sales:${card.rarity}:${new Date(now).toLocaleDateString('en-CA')}`);
  const base = marketValue({ ...card, charges: card.max }, now);
  const out = [...real];
  for (let i = out.length; i < n && pool.length; i++) {
    const m = pool[Math.floor(rnd() * pool.length)];
    out.push({ t: now - (2 + i * 9 + rnd() * 6) * HOUR, name: m.player.name, kind: m.kind, price: Math.max(1, Math.round(base * (0.88 + 0.24 * rnd()))) });
  }
  return out;
}

// Two collectors a day want a specific kind of card and pay a little over market for one.
const WANT_RARITY = ['common', 'uncommon', 'rare'];
export function wantedOffers(state, now = Date.now()) {
  const day = new Date(now).toLocaleDateString('en-CA');
  const teams = [...new Set((state.moments || []).map((m) => `${m.league}:${m.player?.team || ''}`).filter((k) => !k.endsWith(':')))].sort();
  if (teams.length < 2) return [];
  const rnd = seeded(`wanted:${day}`);
  state.mp ||= { hour: 0, list: [], bids: {}, v: 2 };
  if (state.mp.wanted?.day !== day) state.mp.wanted = { day, done: {} };
  const inv = boosterState(state).inv;
  const out = [];
  for (let i = 0; i < 2; i++) {
    const [league, team] = teams[Math.floor(rnd() * teams.length)].split(':');
    const rarity = WANT_RARITY[Math.floor(rnd() * WANT_RARITY.length)];
    const premium = 1.1 + 0.05 * Math.floor(rnd() * 3);
    const mine = inv.filter((b) => b.m?.league === league && (b.m.player?.team || '') === team && b.rarity === rarity && !b.on && !b.listed && !b.show)
      .sort((x, y) => marketValue(x, now) - marketValue(y, now));
    out.push({ i, league, team, rarity, premium, done: !!state.mp.wanted.done[i], have: mine.length, card: mine[0] || null, pays: mine[0] ? Math.round(marketValue(mine[0], now) * premium) : 0 });
  }
  return out;
}
export function fillWanted(state, i, now = Date.now()) {
  const o = wantedOffers(state, now).find((x) => x.i === i);
  if (!o) throw new Error('Offer not found');
  if (o.done) throw new Error('That collector already has their card today');
  if (!o.card) throw new Error(`You don't have a spare ${bRarity(o.rarity).name} ${o.team} card`);
  const bs = boosterState(state);
  bs.inv = bs.inv.filter((b) => b.id !== o.card.id);
  addCoins(state, o.pays); addXP(state, 15, now);
  state.mp.wanted.done[i] = true;
  return { pays: o.pays, card: o.card };
}

export const SHOWCASE_MAX = 5;
export const showcase = (state) => boosterState(state).inv.filter((b) => b.show).sort((x, y) => (x.show || 0) - (y.show || 0));
export function toggleShowcase(state, cardId, now = Date.now()) {
  const b = boosterState(state).inv.find((x) => x.id === cardId);
  if (!b) throw new Error('Card not found');
  if (b.show) { delete b.show; return false; }
  if (showcase(state).length >= SHOWCASE_MAX) throw new Error(`Your showcase holds ${SHOWCASE_MAX} cards. Remove one first.`);
  b.show = now;
  return true;
}

// ---------- run every tick, before the season logic ----------
export function runExtras(state, now = Date.now()) {
  payFutures(state, now);
  settleFutures(state, now);
  runShorts(state, now);
  syncProtection(state);
  runRival(state, now);
}
export { shortsValue, centsFmt, fmtQty };
