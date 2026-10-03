// Market events, rookie IPOs, monthly player reports, the hall of fame and friend challenges.

import { netWorth, notify, tradeGuards } from './engine.js';
import { posGroup } from './scoring.js';
import { career } from './xp.js';
import { closedTrades } from './extras.js';
import { weeklyRecap } from './extras2.js';
import { DAY, HOUR, gauss, weekId } from './util.js';

const round2 = (x) => Math.round(x * 100) / 100;
const money = (x) => '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const leagueOn = (state, lg) => !state.settings?.leagues || state.settings.leagues[lg] !== false;

// ---------- market events ----------
// Every so often a whole league gets jumpy for a few hours. They start at random: there is
// no calendar of them, and each player's move is his own roll of the dice.
export const EVENT_EVERY = 10 * DAY; export const EVENT_LEN = 6 * HOUR;
const EVENT_NAMES = ['Trade rumour frenzy', 'Awards buzz', 'Deadline-day nerves', 'Analyst upgrades and downgrades', 'Contract talk', 'Big-money speculation'];
export function startEvent(state, league, now = Date.now(), rnd = Math.random) {
  state.events ||= {};
  const name = EVENT_NAMES[Math.floor(rnd() * EVENT_NAMES.length)];
  state.events[league] = { name, start: now, end: now + EVENT_LEN };
  for (const a of Object.values(state.assets)) if (a.league === league && a.kind !== 'fund') a.h = (a.h || 0) + (a.kind === 'team' ? 0.03 : 0.05) * gauss();
  notify(state, 'event', `${league.toUpperCase()} market event: ${name}. Prices are swinging more than usual for the next 6 hours.`, null, now);
  return state.events[league];
}
export const activeEvents = (state, now = Date.now()) => Object.entries(state.events || {}).filter(([lg, e]) => e.end > now && leagueOn(state, lg)).map(([league, e]) => ({ league, ...e }));
function runEvents(state, now, dt, rnd) {
  for (const lg of Object.keys(state.sync || {})) {
    if (!state.sync[lg]?.seeded || !leagueOn(state, lg)) continue;
    if (state.events?.[lg]?.end > now) continue;
    if (rnd() < dt / EVENT_EVERY) startEvent(state, lg, now, rnd);
  }
}

// ---------- rookie IPOs ----------
// A player the market has never seen lists at noon. For three hours you can take a limited
// allocation at the IPO price; then he trades freely and the first-day move is anyone's guess.
export const IPO_WINDOW = 3 * HOUR; const IPO_PER_DAY = 3; export const IPO_ALLOC = 0.1;
function nextNoon(now) { const d = new Date(now); d.setHours(12, 0, 0, 0); if (d.getTime() - now < 2 * HOUR) d.setDate(d.getDate() + 1); return d.getTime(); }
export const ipoPhase = (a, now = Date.now()) => (!a?.ipo ? null : now < a.ipo.opens ? 'soon' : now < a.ipo.opens + IPO_WINDOW ? 'open' : 'done');
export const ipoList = (state, now = Date.now()) => Object.values(state.assets).filter((a) => a.ipo && leagueOn(state, a.league)).sort((x, y) => x.ipo.opens - y.ipo.opens);
export function ipoRoom(state, a, now = Date.now()) {
  if (ipoPhase(a, now) !== 'open') return 0;
  const cap = Math.max(1, netWorth(state, now) * IPO_ALLOC);
  return Math.max(0, Math.min(state.cash, round2(cap - (a.ipo.spent || 0))));
}
export function buyIpo(state, id, dollars, now = Date.now()) {
  const a = state.assets[id];
  if (ipoPhase(a, now) !== 'open') throw new Error('This IPO isn\'t open');
  dollars = round2(Number(dollars));
  if (!(dollars >= 0.05)) throw new Error('Enter an amount');
  const room = ipoRoom(state, a, now);
  if (dollars > room + 1e-9) throw new Error(`Your allocation has ${money(room)} left`);
  const qty = Math.round((dollars / a.ipo.price) * 1e6) / 1e6;
  const pos = state.holdings[id] || { qty: 0, cost: 0, since: now };
  pos.qty = Math.round((pos.qty + qty) * 1e6) / 1e6; pos.cost = round2(pos.cost + dollars);
  state.holdings[id] = pos;
  state.cash = round2(state.cash - dollars);
  a.ipo.spent = round2((a.ipo.spent || 0) + dollars);
  state.txns.unshift({ t: now, id, ticker: a.ticker, name: a.name, side: 'buy', qty, price: a.ipo.price, total: dollars, kind: 'stock', via: 'IPO' });
  return { qty, price: a.ipo.price };
}
tradeGuards.push((state, a, side, qty, now) => {
  const ph = ipoPhase(a, now);
  if (ph === 'soon') throw new Error(`${a.ticker} lists at ${new Date(a.ipo.opens).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`);
  if (ph === 'open') throw new Error(side === 'buy' ? 'During the IPO you buy from your allocation on his page' : 'Shares are locked until the IPO window closes');
});
function runIpos(state, now) {
  const perDay = {};
  for (const a of Object.values(state.assets)) if (a.ipo) { const k = `${a.league}:${new Date(a.ipo.opens).toDateString()}`; perDay[k] = (perDay[k] || 0) + 1; }
  for (const a of Object.values(state.assets)) {
    if (a.isNew) {
      delete a.isNew;
      // Only genuine newcomers once the league is up and running, and only a few a day.
      if (a.kind === 'player' && state.ipoArm?.[a.league] && a.price > 0 && !state.holdings[a.id]) {
        const opens = nextNoon(now); const k = `${a.league}:${new Date(opens).toDateString()}`;
        if ((perDay[k] || 0) < IPO_PER_DAY) { perDay[k] = (perDay[k] || 0) + 1; a.ipo = { opens, price: round2(a.price), spent: 0 }; }
      }
    }
    if (!a.ipo) continue;
    const ph = ipoPhase(a, now);
    if (ph === 'open' && !a.ipo.open) {
      a.ipo.open = true; a.ipo.price = round2(a.price);
      notify(state, 'ipo', `IPO open: ${a.name} (${a.ticker}) at ${money(a.ipo.price)}. Your allocation is available for 3 hours.`, a.id, now);
    }
    if (ph === 'done') {
      const kick = clamp(0.14 * gauss(), -0.35, 0.35); // the first-day move: unknown until it happens
      a.h = (a.h || 0) + kick;
      a.ipoDone = { t: now, price: a.ipo.price, kick: Math.round(kick * 1000) / 1000 };
      if (a.ipo.spent > 0 || (state.watch || []).includes(a.id)) notify(state, 'ipo', `${a.ticker} is trading freely after its IPO at ${money(a.ipo.price)}: first move ${kick >= 0 ? 'up' : 'down'} about ${Math.abs(Math.round((Math.exp(kick) - 1) * 100))}%.`, a.id, now);
      delete a.ipo;
    }
  }
  // A league is armed once it has finished loading: everyone listed up to that point is an
  // ordinary stock, and only players who show up afterwards get an IPO.
  state.ipoArm ||= {};
  for (const [lg, v] of Object.entries(state.sync || {})) if (v?.seeded) state.ipoArm[lg] = true;
}

// ---------- monthly player reports ----------
// About every four weeks each player gets a report card on his games since the last one.
// The grade mixes how he did against his usual level with the analysts' own read, so a
// good month usually grades well but not always.
export const REPORT_EVERY = 28 * DAY;
const GRADES = [[1.5, 'A'], [0.5, 'B'], [-0.5, 'C'], [-1.5, 'D'], [-Infinity, 'F']];
export function runReport(state, a, now = Date.now(), noise = gauss()) {
  const last = a.report?.t || 0;
  const games = (a.perf?.last || []).filter((g) => g.t > last && !/preseason/.test(g.text || ''));
  if (games.length < 3) { a.report = { ...(a.report || {}), next: now + 7 * DAY }; return null; }
  const st = state.stats[a.league]?.[posGroup(a.league, a.pos)];
  const base = a.perf.lvl ?? a.perf.ema;
  const gn = a.perf.gn ?? st?.sd ?? 4;
  const mean = games.reduce((s, g) => s + g.gs, 0) / games.length;
  const z = clamp((mean - base) / (gn / Math.sqrt(games.length)), -3, 3);
  const score = 0.7 * z + 0.9 * noise;
  const grade = GRADES.find(([min]) => score > min)[1];
  const v = clamp(0.025 * score, -0.08, 0.08);
  (a.shocks ||= []).push({ t: now, v });
  const text = `Monthly report: ${grade} · ${games.length} games averaging ${mean.toFixed(1)} against his usual ${base.toFixed(1)}`;
  (a.events ||= []).unshift({ t: now, kind: 'report', text, pct: Math.round(v * 10000) / 10000 });
  if (a.events.length > 25) a.events.length = 25;
  a.report = { t: now, grade, next: now + REPORT_EVERY, n: games.length };
  if (state.holdings[a.id] || (state.watch || []).includes(a.id) || state.shorts?.[a.id]) notify(state, 'report', `${a.ticker} report card: ${grade}. ${v >= 0 ? 'Up' : 'Down'} about ${Math.abs(v * 100).toFixed(1)}%.`, a.id, now);
  return a.report;
}
function runReports(state, now) {
  if (now - (state.reportsRun || 0) < HOUR) return;
  state.reportsRun = now;
  for (const a of Object.values(state.assets)) {
    if (a.kind !== 'player' || a.perf?.ema == null || a.ipo) continue;
    if (!a.report?.next) { a.report = { ...(a.report || {}), next: now + (1 + hash(a.id) % 28) * DAY }; continue; } // staggered: a few every day
    if (now >= a.report.next) runReport(state, a, now);
  }
}

// ---------- hall of fame ----------
// Your records, kept for good: season resets and fresh starts don't clear them.
const R_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'iconic'];
export function updateHof(state, now = Date.now()) {
  const h = state.hof ||= { since: now, peak: null, trade: null, div: null, season: null, pick: 0, challenge: 0, cards: [], divTotal: 0, seasons: 0, sales: 0 };
  const nw = netWorth(state, now);
  if (!h.peak || nw > h.peak.v) h.peak = { v: round2(nw), t: now };
  // trades (only re-scan when something new was sold)
  const nTx = (state.txns || []).length + (state.txns?.[0]?.t || 0);
  if (h._tx !== nTx) {
    h._tx = nTx;
    const best = closedTrades(state).sort((x, y) => y.pl - x.pl)[0];
    if (best && best.pl > 0 && (!h.trade || best.pl > h.trade.pl)) h.trade = { pl: best.pl, pct: best.pct, name: best.name || best.ticker, t: best.t };
  }
  const d = (state.divs || []).reduce((m, x) => (!m || x.amt > m.amt ? x : m), null);
  if (d && (!h.div || d.amt > h.div.amt)) h.div = { amt: d.amt, name: state.assets[d.id]?.name || d.ticker, t: d.t };
  const c = career(state);
  const bs = (c.seasons || []).reduce((m, s) => (!m || s.ret > m.ret ? s : m), null);
  if (bs && (!h.season || bs.ret > h.season.ret)) h.season = { ret: bs.ret, n: bs.n, tier: bs.tier, rank: bs.rank, of: bs.of };
  h.seasons = Math.max(h.seasons || 0, (c.seasons || []).length);
  h.pick = Math.max(h.pick || 0, state.pickStats?.best || 0);
  h.challenge = Math.max(h.challenge || 0, state.challenge?.best || 0);
  // the five best cards you've ever held
  for (const b of state.boosters?.inv || []) {
    if (h.cards.some((x) => x.id === b.id)) continue;
    h.cards.push({ id: b.id, rarity: b.rarity, name: b.m?.player?.name || '', kind: b.m?.kind || '', rating: b.m?.rating || 0, t: b.t || now });
  }
  h.cards.sort((x, y) => R_ORDER.indexOf(y.rarity) - R_ORDER.indexOf(x.rarity) || y.rating - x.rating);
  if (h.cards.length > 5) h.cards.length = 5;
  return h;
}

// ---------- challenge a friend ----------
// A code with your week in it. It only carries what you choose to share: a name, your
// week's return and your level. Nothing checks it, so it's for friends, not prizes.
const b64 = { enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))) };
export function duelCode(state, name, now = Date.now()) {
  const w = weeklyRecap(state, now);
  const c = career(state);
  return b64.enc(JSON.stringify({ v: 1, n: String(name || c.title || 'A friend').slice(0, 20), r: Math.round(w.pct * 10000) / 10000, w: weekId(now), t: now }));
}
export function parseDuel(code) {
  try {
    const raw = String(code || '').trim().replace(/^.*[#?&]c=/, '').replace(/[^A-Za-z0-9_-]/g, '');
    const d = JSON.parse(b64.dec(raw));
    if (d.v !== 1 || typeof d.r !== 'number' || !isFinite(d.r)) return null;
    return { name: String(d.n || 'A friend').slice(0, 20), ret: clamp(d.r, -1, 100), week: String(d.w || ''), t: Number(d.t) || 0 };
  } catch { return null; }
}
export function duelResult(state, code, now = Date.now()) {
  const d = parseDuel(code); if (!d) return null;
  const mine = weeklyRecap(state, now).pct;
  return { ...d, mine, ahead: mine >= d.ret, stale: now - d.t > 8 * DAY };
}

// ---------- every tick ----------
export function runExtras3(state, now = Date.now(), rnd = Math.random) {
  const dt = clamp(now - (state.ex3Last || now), 0, 12 * HOUR); state.ex3Last = now;
  runEvents(state, now, dt, rnd);
  runIpos(state, now);
  runReports(state, now);
  updateHof(state, now);
}
