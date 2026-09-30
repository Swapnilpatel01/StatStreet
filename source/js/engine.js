// The market engine: turns sports data into prices, runs the tape, executes trades.
// Pure state functions (no DOM, no network) so the whole thing can be tested in Node.

import { clamp, gauss, mean, std, median, decay, HOUR, DAY, tickerFrom } from './util.js';
import {
  LEAGUES, posGroup, posMultiplier, gameScore, lineText, milestone, injuryFactor, sentimentScore,
} from './scoring.js';
import { optionsValue } from './bs.js';

export const START_CASH = 10000;
export const SPREAD = 0.0035;           // half-spread charged on each trade
const P0 = 30;                           // price of a perfectly average player
const TEAM_P0 = 60;                      // price of a .500 team
const Z_SLOPE = 0.42;                    // how much one standard deviation of performance moves price
const NEWS_HALF_LIFE = 72 * HOUR;
const IMPACT_HALF_LIFE = 4 * HOUR;
const NOISE_TAU = 3 * HOUR;
const HIST_CAP = 420;

// Dividends, as a fraction of share price.
// Teams pay per win; players pay for above-average games (per standard deviation above their position's average).
export const TEAM_DIV = { nba: 0.0025, nfl: 0.015, mlb: 0.0012 };
export const PLAYER_DIV = { nba: 0.0015, nfl: 0.012, mlb: 0.0008 };
export const MILESTONE_DIV = 0.01;

export function newState() {
  return {
    v: 1, created: Date.now(),
    cash: START_CASH, holdings: {}, txns: [], watch: [],
    assets: {}, stats: {}, mood: { nba: 0, nfl: 0, mlb: 0 },
    games: {}, liveGames: {}, newsSeen: {}, news: [], sync: {},
    nw: [], lastTick: 0,
    options: {}, orders: [], alerts: [], recurring: [], divs: [], divTotal: 0, inbox: [], schedule: {},
    settings: { proxy: '', leagues: { nba: true, nfl: true, mlb: true }, drip: false },
  };
}

// Fill in anything an older saved state is missing.
export function migrate(state) {
  const d = newState();
  for (const k of ['options', 'orders', 'alerts', 'recurring', 'divs', 'inbox', 'schedule', 'watch', 'txns', 'nw']) state[k] ??= d[k];
  state.divTotal ??= 0;
  state.settings = { ...d.settings, ...(state.settings || {}) };
  state.settings.leagues = { ...d.settings.leagues, ...(state.settings.leagues || {}) };
  for (const h of Object.values(state.holdings || {})) h.since ??= 0;
  return state;
}

export function notify(state, kind, text, id = null, t = Date.now()) {
  state.inbox.unshift({ t, kind, text, id, seen: false });
  if (state.inbox.length > 150) state.inbox.length = 150;
}

// ---------- asset helpers ----------

const pid = (league, id) => `${league}:p:${id}`;
const tid = (league, id) => `${league}:t:${id}`;

function uniqueTicker(state, base) {
  const taken = new Set(Object.values(state.assets).map((a) => a.ticker));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 99; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  return base + Math.floor(Math.random() * 1000);
}

function pushHist(a, t, p) {
  const h = a.hist;
  const n = h.length;
  if (n >= 2 && t < h[n - 2]) {
    // Out-of-order point (backfill). Insert in place.
    let i = n - 2;
    while (i >= 0 && h[i] > t) i -= 2;
    h.splice(i + 2, 0, t, p);
  } else if (n >= 2 && t - h[n - 2] < 4 * 60e3) {
    h[n - 1] = p; // collapse bursts into one point
  } else {
    h.push(t, p);
  }
  if (h.length > HIST_CAP * 2) {
    // Thin out the oldest half so long-range charts stay available.
    const half = Math.floor(h.length / 4) * 2;
    const old = [];
    for (let i = 0; i < half; i += 4) old.push(h[i], h[i + 1]);
    a.hist = old.concat(h.slice(half));
  }
}

function addEvent(a, t, kind, text, pct) {
  a.events = a.events || [];
  a.events.unshift({ t, kind, text, pct: Math.round(pct * 10000) / 10000 });
  a.events.sort((x, y) => y.t - x.t);
  if (a.events.length > 25) a.events.length = 25;
}

export function priceAt(a, t) {
  const h = a.hist;
  if (!h.length) return a.price;
  if (t <= h[0]) return h[1];
  for (let i = h.length - 2; i >= 0; i -= 2) if (h[i] <= t) return h[i + 1];
  return h[1];
}

export const change = (a, now, span = DAY) => {
  const ref = priceAt(a, now - span);
  return ref ? a.price / ref - 1 : 0;
};

// ---------- teams ----------

export function upsertTeam(state, league, t, { authoritative = true } = {}) {
  const id = tid(league, t.id);
  let a = state.assets[id];
  if (!a) {
    a = state.assets[id] = {
      id, league, kind: 'team', rid: t.id, name: t.name, short: t.short, ticker: t.abbr, teamId: t.id, teamAbbr: t.abbr,
      img: t.logo, rec: { w: 0, l: 0, t: 0, gp: 0, diff: 0, streak: 0, playoffPct: null },
      shocks: [], events: [], hist: [], price: 0, n: 0, imp: null, form: [],
    };
  }
  a.name = t.name || a.name; a.img = t.logo || a.img; a.ticker = t.abbr || a.ticker; a.teamAbbr = a.ticker;
  // Only overwrite the record if the standings are at least as fresh as what games told us.
  if (t.prior) {
    // Off-season: carry last season forward at 25% weight so teams start near .500.
    if (!a.rec.gp || a.rec.prior) {
      const s = 0.25;
      a.rec = { w: t.w * s, l: t.l * s, t: (t.t || 0) * s, gp: t.gp * s, diff: t.diff * s, streak: 0, playoffPct: null, prior: true };
    }
  } else if (authoritative && (t.gp >= a.rec.gp || (a.rec.prior && t.gp > 0))) {
    a.rec = { w: t.w, l: t.l, t: t.t || 0, gp: t.gp, diff: t.diff, streak: t.streak, playoffPct: t.playoffPct };
  } else if (t.playoffPct != null) {
    a.rec.playoffPct = t.playoffPct;
  }
  return a;
}

function teamFair(state, a) {
  const L = LEAGUES[a.league];
  const r = a.rec;
  const k = L.regress;
  const adjPct = (r.w + 0.5 * r.t + 0.5 * k) / (r.gp + k);
  const st = state.stats[a.league]?.team || { mu: 0, sd: 1 };
  const dpg = r.gp ? r.diff / r.gp : 0;
  const dz = st.sd ? (dpg - st.mu) / st.sd : 0;
  let score = 2.2 * (adjPct - 0.5) + 0.3 * clamp(dz, -3, 3) * (r.gp / (r.gp + k)) + 0.025 * clamp(r.streak, -6, 6);
  if (r.playoffPct != null && r.gp > 0) score += 0.35 * (r.playoffPct / 100 - 0.5);
  const recent = (a.form || []).slice(0, 5);
  if (recent.length) score += 0.03 * recent.reduce((s, x) => s + (x ? 1 : -1), 0);
  return TEAM_P0 * Math.exp(score);
}

// ---------- players ----------

function ensurePlayer(state, league, p) {
  const id = pid(league, p.id);
  let a = state.assets[id];
  if (!a) {
    a = state.assets[id] = {
      id, league, kind: 'player', rid: p.id, name: p.name, ticker: uniqueTicker(state, tickerFrom(p.name)),
      pos: p.pos, teamId: p.teamId, teamAbbr: p.teamAbbr, img: p.img,
      perf: { ema: null, n: 0, season: null, last: [] }, injury: null,
      shocks: [], events: [], hist: [], price: 0, n: 0, imp: null,
    };
  }
  if (p.pos) a.pos = p.pos;
  if (p.teamId) a.teamId = p.teamId;
  if (p.teamAbbr) a.teamAbbr = p.teamAbbr;
  if (p.img && !a.img) a.img = p.img;
  if (!a.img) a.img = `https://a.espncdn.com/i/headshots/${league}/players/full/${p.id}.png`;
  return a;
}

export function seedPlayer(state, league, rec) {
  const a = ensurePlayer(state, league, rec);
  a.perf.season = { gs: rec.gs, gp: rec.gp };
  if (a.perf.ema == null) {
    a.perf.ema = rec.gs;
    a.perf.n = Math.min(rec.gp, 12);
  }
  return a;
}

function playerFair(state, a) {
  const st = state.stats[a.league]?.[posGroup(a.league, a.pos)];
  const ema = a.live?.ema ?? a.perf.ema;
  let z = 0;
  if (st && ema != null && st.sd > 0) z = (ema - st.mu) / st.sd;
  const conf = a.perf.n / (a.perf.n + 2);
  return P0 * posMultiplier(a.league, a.pos) * Math.exp(Z_SLOPE * clamp(z * conf, -3, 4));
}

// Recompute per-league, per-position baselines used to normalize performance.
export function recomputeStats(state, league) {
  const groups = {};
  const teamDiffs = [];
  for (const a of Object.values(state.assets)) {
    if (a.league !== league) continue;
    if (a.kind === 'player' && a.perf.ema != null && a.perf.n >= 1) {
      (groups[posGroup(league, a.pos)] ||= []).push(a.perf.ema);
    } else if (a.kind === 'team' && a.rec.gp > 0) {
      teamDiffs.push(a.rec.diff / a.rec.gp);
    }
  }
  const out = {};
  for (const [g, arr] of Object.entries(groups)) {
    const mu = mean(arr);
    out[g] = { mu, sd: Math.max(std(arr, mu), Math.abs(mu) * 0.25, 0.5), n: arr.length };
  }
  const tmu = mean(teamDiffs);
  out.team = { mu: tmu, sd: Math.max(std(teamDiffs, tmu), 0.1) };
  state.stats[league] = out;
}

// ---------- price composition ----------

function sentiment(a, now) {
  a.shocks = (a.shocks || []).filter((s) => now - s.t < 12 * DAY);
  return clamp(a.shocks.reduce((sum, s) => sum + decay(s.v, now - s.t, NEWS_HALF_LIFE), 0), -0.3, 0.3);
}

function impact(a, now) {
  return a.imp ? clamp(decay(a.imp.v, now - a.imp.t, IMPACT_HALF_LIFE), -0.12, 0.12) : 0;
}

function teamInjuryDrag(state, a) {
  if (a.kind !== 'team') return 1;
  const cache = state._injCache?.[a.league];
  return cache ? (cache[a.rid] ?? 1) : 1;
}

export function rebuildInjuryCache(state, league) {
  const players = Object.values(state.assets).filter((x) => x.league === league && x.kind === 'player');
  const med = median(players.map((p) => fairOnly(state, p))) || P0;
  const drag = {};
  for (const p of players) {
    if (!p.injury) continue;
    const w = clamp(fairOnly(state, p) / med, 0.3, 3) * 0.035;
    drag[p.teamId] = (drag[p.teamId] || 0) + (1 - p.injury.factor) * w * 4;
  }
  state._injCache ||= {};
  state._injCache[league] = Object.fromEntries(Object.entries(drag).map(([k, v]) => [k, 1 - clamp(v, 0, 0.15)]));
}

export function fairOnly(state, a) {
  return a.kind === 'team' ? teamFair(state, a) : playerFair(state, a);
}

export function fundNav(state, a) {
  let v = 0;
  for (const [id, sh] of Object.entries(a.cons || {})) v += (state.assets[id]?.price || 0) * sh;
  return v;
}

export function breakdown(state, a, now = Date.now()) {
  if (a.kind === 'fund') {
    const fair = fundNav(state, a); const imp = impact(a, now);
    return { fair, inj: 1, senti: 0, mood: 0, imp, live: 0, target: Math.max(0.5, fair * (1 + imp)) };
  }
  const fair = fairOnly(state, a);
  const inj = a.kind === 'player' ? (a.injury?.factor ?? 1) : teamInjuryDrag(state, a);
  const senti = sentiment(a, now);
  const mood = 0.02 * (state.mood[a.league] || 0);
  const imp = impact(a, now);
  const live = a.liveBoost || 0;
  const target = fair * inj * (1 + senti) * (1 + mood) * (1 + imp) * (1 + live);
  return { fair, inj, senti, mood, imp, live, target: Math.max(0.5, target) };
}

export const targetPrice = (state, a, now) => breakdown(state, a, now).target;

function setPrice(state, a, now, { record = true, at = now } = {}) {
  const t = targetPrice(state, a, now);
  a.target = t;
  a.price = Math.round(t * Math.exp(a.n || 0) * 100) / 100;
  if (record) pushHist(a, at, a.price);
  return a.price;
}

// Apply a change and log it as a price driver if it moved the price.
function withEvent(state, a, now, at, kind, text, mutate, { minPct = 0.002, force = false, histAt = at } = {}) {
  const before = targetPrice(state, a, now);
  mutate();
  const after = targetPrice(state, a, now);
  const pct = before ? after / before - 1 : 0;
  if (force || Math.abs(pct) >= minPct) addEvent(a, at, kind, text, pct);
  setPrice(state, a, now, { at: histAt });
  return pct;
}

// ---------- games ----------

// game = { id, date, teams:[{id,abbr,score,winner,home}], players:[box rows] }
export function applyFinalGame(state, league, game, { now = Date.now(), backfill = false, at: atOpt } = {}) {
  if (state.games[game.id]?.final) return;
  const L = LEAGUES[league];
  const at = Math.min(now, atOpt ?? (backfill ? game.date + L.gameHours * HOUR : now));
  const [t1, t2] = game.teams;

  for (const side of game.preseason ? [] : game.teams) {
    const a = state.assets[tid(league, side.id)];
    if (!a) continue;
    const opp = side === t1 ? t2 : t1;
    const won = side.score > opp.score || side.winner;
    const tie = side.score === opp.score && !side.winner && !opp.winner;
    const text = `${won ? 'W' : tie ? 'T' : 'L'} ${side.score}-${opp.score} ${side.home ? 'vs' : '@'} ${opp.abbr}`;
    if (won) payDividend(state, a, a.price * TEAM_DIV[league], `Win ${side.score}-${opp.score} ${side.home ? 'vs' : '@'} ${opp.abbr}`, at, game.date);
    withEvent(state, a, now, at, 'game', text, () => {
      a.rec.gp += 1; a.rec.diff += side.score - opp.score;
      if (won) a.rec.w += 1; else if (tie) a.rec.t += 1; else a.rec.l += 1;
      // During a replay the standings already carry the current streak.
      if (!backfill) a.rec.streak = won ? Math.max(1, a.rec.streak + 1) : Math.min(-1, a.rec.streak - 1);
      a.form = [won, ...(a.form || [])].slice(0, 10);
      a.liveBoost = 0;
    }, { force: true });
  }

  for (const p of game.players) {
    const a = ensurePlayer(state, league, p);
    const gs = gameScore(league, p.line);
    const opp = game.teams.find((t) => t.id !== p.teamId)?.abbr || '';
    const text = `${lineText(league, p.line)}${opp ? ` vs ${opp}` : ''}${game.preseason ? ' (preseason)' : ''}`;
    withEvent(state, a, now, at, 'game', text, () => {
      const alpha = game.preseason ? L.alpha / 3 : L.alpha; // exhibition games count for less
      a.perf.ema = a.perf.ema == null ? gs : a.perf.ema * (1 - alpha) + gs * alpha;
      a.perf.n = Math.min(a.perf.n + 1, 20);
      a.perf.last.unshift({ e: game.id, t: game.date, gs: Math.round(gs * 10) / 10, text, opp });
      if (a.perf.last.length > 10) a.perf.last.length = 10;
      a.live = null;
    }, { force: gs !== 0 });
    if (!game.preseason) {
      const st = state.stats[league]?.[posGroup(league, a.pos)];
      const z = st && st.sd > 0 ? (gs - st.mu) / st.sd : 0;
      if (z > 0.25) payDividend(state, a, a.price * PLAYER_DIV[league] * clamp(z, 0, 3), `Performance: ${lineText(league, p.line)}`, at, game.date);
    }
    const m = game.preseason ? null : milestone(league, p.line);
    if (m) payDividend(state, a, a.price * MILESTONE_DIV, `Special dividend: ${m}`, at, game.date);
    if (m) {
      withEvent(state, a, now, at, 'milestone', m, () => {
        a.shocks.push({ t: at, v: 0.05 });
      }, { force: true });
    }
  }
  state.games[game.id] = { final: true, t: game.date, league };
  delete state.liveGames[game.id];
}

// Pay a per-share dividend to everyone who owned the asset (or a fund holding it)
// before the game started. DRIP reinvests at the current price, no spread.
export function payDividend(state, a, perShare, reason, at, gameDate) {
  if (!(perShare > 0)) return;
  perShare = Math.round(perShare * 10000) / 10000;
  a.divHist ||= [];
  a.divHist.unshift({ t: at, ps: perShare, reason });
  if (a.divHist.length > 40) a.divHist.length = 40;
  const credit = (holdId, qtyEquiv, via) => {
    const pos = state.holdings[holdId];
    const amt = Math.round(qtyEquiv * perShare * 100) / 100;
    if (!(amt > 0)) return;
    const target = state.assets[holdId];
    let drip = false;
    if (state.settings?.drip && target?.price > 0) {
      pos.qty = Math.round((pos.qty + amt / target.price) * 1e6) / 1e6;
      pos.cost = Math.round((pos.cost + amt) * 100) / 100;
      drip = true;
    } else {
      state.cash = Math.round((state.cash + amt) * 100) / 100;
    }
    state.divTotal = Math.round(((state.divTotal || 0) + amt) * 100) / 100;
    state.divs.unshift({ t: at, id: holdId, ticker: target?.ticker || a.ticker, from: a.ticker, ps: perShare, amt, reason, drip, via });
    if (state.divs.length > 400) state.divs.length = 400;
    notify(state, 'div', `${target?.ticker || a.ticker} paid you ${'$' + amt.toFixed(2)}${via ? ` (via ${a.ticker})` : ''}${drip ? ' · reinvested' : ''}`, holdId, at);
  };
  const own = state.holdings[a.id];
  if (own && (own.since || 0) < gameDate) credit(a.id, own.qty, null);
  for (const f of Object.values(state.assets)) {
    if (f.kind !== 'fund' || !f.cons?.[a.id]) continue;
    const fp = state.holdings[f.id];
    if (fp && (fp.since || 0) < gameDate) credit(f.id, fp.qty * f.cons[a.id], a.ticker);
  }
}

// Estimated forward yield: average dividend per game over recent games, times a season.
const SEASON_GAMES = { nba: 82, nfl: 17, mlb: 162 };
export function dividendYield(state, a, now = Date.now()) {
  if (a.kind === 'fund') {
    let perYear = 0;
    for (const [id, sh] of Object.entries(a.cons || {})) {
      const c = state.assets[id]; if (c) perYear += dividendYield(state, c, now) * c.price * sh;
    }
    return a.price ? perYear / a.price : 0;
  }
  const hist = (a.divHist || []).filter((d) => now - d.t < 45 * DAY && !/^Special/.test(d.reason));
  const games = a.kind === 'team' ? (a.form || []).length : (a.perf?.last || []).length;
  if (!games || !a.price) return 0;
  const perGame = hist.reduce((s, d) => s + d.ps, 0) / Math.max(games, hist.length);
  return (perGame * SEASON_GAMES[a.league]) / a.price;
}

// Undo the effect of games we are about to replay, so a fresh install gets
// realistic price history for the last few days instead of a flat line.
export function rewindTeamRecords(state, league, games) {
  for (const g of games) {
    if (g.preseason) continue;
    const [t1, t2] = g.teams;
    for (const side of g.teams) {
      const a = state.assets[tid(league, side.id)];
      if (!a) continue;
      const opp = side === t1 ? t2 : t1;
      const won = side.score > opp.score || side.winner;
      const tie = side.score === opp.score && !side.winner && !opp.winner;
      a.rec.gp = Math.max(0, a.rec.gp - 1); a.rec.diff -= side.score - opp.score;
      if (won) a.rec.w = Math.max(0, a.rec.w - 1); else if (tie) a.rec.t = Math.max(0, a.rec.t - 1); else a.rec.l = Math.max(0, a.rec.l - 1);
    }
    state.games[g.id] = { ...(state.games[g.id] || {}), rewound: true };
  }
}

// In-progress game: players move on their pace, teams move on the scoreboard.
export function applyLiveGame(state, league, game, { now = Date.now() } = {}) {
  const L = LEAGUES[league];
  const frac = clamp(game.period / (game.regPeriods || 4), 0.05, 1);
  state.liveGames[game.id] = { league, name: game.name, detail: game.detail, teams: game.teams, t: now };
  for (const p of game.players || []) {
    const a = ensurePlayer(state, league, p);
    const gs = gameScore(league, p.line);
    const projected = gs / Math.max(frac, 0.35);
    const base = a.perf.ema ?? projected;
    a.live = { e: game.id, ema: base + L.alpha * frac * (projected - base), text: lineText(league, p.line), t: now };
    setPrice(state, a, now);
  }
  const [t1, t2] = game.teams;
  for (const side of game.teams) {
    const a = state.assets[tid(league, side.id)];
    if (!a) continue;
    const opp = side === t1 ? t2 : t1;
    const scale = league === 'nfl' ? 10 : league === 'nba' ? 12 : 3;
    a.liveBoost = 0.04 * Math.tanh((side.score - opp.score) / scale) * frac;
    setPrice(state, a, now);
  }
}

export function clearStaleLive(state, now = Date.now()) {
  for (const [id, g] of Object.entries(state.liveGames)) {
    if (now - g.t > 6 * HOUR) delete state.liveGames[id];
  }
  const liveIds = new Set(Object.keys(state.liveGames));
  for (const a of Object.values(state.assets)) {
    if (a.live && !liveIds.has(a.live.e)) a.live = null;
    if (a.kind === 'team' && a.liveBoost && !Object.values(state.liveGames).some((g) => g.teams.some((t) => tid(g.league, t.id) === a.id))) a.liveBoost = 0;
  }
}

// ---------- news & injuries ----------

export function applyNews(state, league, articles, { now = Date.now() } = {}) {
  let added = 0;
  for (const art of articles) {
    if (state.newsSeen[art.id]) continue;
    state.newsSeen[art.id] = art.published;
    const { score, hits } = sentimentScore(`${art.headline}. ${art.desc}`);
    const targets = [
      ...art.athletes.map((i) => pid(league, i)),
      ...art.teams.map((i) => tid(league, i)),
    ].filter((id) => state.assets[id]);
    const age = now - art.published;
    const item = { ...art, score: Math.round(score * 100) / 100, hits, targets };
    state.news.unshift(item);
    added++;
    if (Math.abs(score) < 0.12 || age > 5 * DAY) continue;
    for (const id of targets) {
      const a = state.assets[id];
      const w = a.kind === 'player' ? 0.07 : 0.035;
      withEvent(state, a, now, Math.min(art.published, now), 'news', art.headline, () => {
        a.shocks.push({ t: art.published, v: w * score });
      }, { force: true, histAt: now }); // chart moves when we learn the news
    }
  }
  state.news.sort((x, y) => y.published - x.published);
  if (state.news.length > 200) state.news.length = 200;
  // Forget very old "seen" ids so storage doesn't grow forever.
  for (const [id, t] of Object.entries(state.newsSeen)) if (now - t > 30 * DAY) delete state.newsSeen[id];
  updateMood(state, league, now);
  return added;
}

export function applyInjuries(state, league, list, { now = Date.now() } = {}) {
  const byId = new Map(list.map((i) => [pid(league, i.athleteId), i]));
  for (const a of Object.values(state.assets)) {
    if (a.league !== league || a.kind !== 'player') continue;
    const inj = byId.get(a.id);
    const prev = a.injury?.status;
    if (inj) {
      if (prev !== inj.status) {
        withEvent(state, a, now, now, 'injury', `${inj.status}${inj.detail ? ` — ${inj.detail}` : ''}`, () => {
          a.injury = { status: inj.status, detail: inj.detail, factor: injuryFactor(inj.status), since: now };
        }, { force: true });
      } else {
        a.injury.detail = inj.detail;
      }
    } else if (prev && list.length) {
      withEvent(state, a, now, now, 'injury', `Cleared: back from "${prev}"`, () => { a.injury = null; }, { force: true });
    }
  }
  rebuildInjuryCache(state, league);
}

function updateMood(state, league, now) {
  const recent = state.news.filter((n) => n.league === league && now - n.published < 2 * DAY);
  const newsAvg = recent.length ? mean(recent.map((n) => n.score)) : 0;
  const assets = Object.values(state.assets).filter((a) => a.league === league && a.hist.length > 2);
  const moves = assets.map((a) => change(a, now));
  const tape = moves.length ? Math.tanh(mean(moves) * 20) : 0;
  state.mood[league] = clamp(0.7 * newsAvg * 2 + 0.3 * tape, -1, 1);
}

// ---------- the tape ----------

export function repriceLeague(state, league, now = Date.now(), { record = true, at = now } = {}) {
  recomputeStats(state, league);
  rebuildInjuryCache(state, league);
  for (const a of Object.values(state.assets)) if (a.league === league) setPrice(state, a, now, { record, at });
}

// Called every few seconds while the app is open. Prices wander around their
// target (like bid/ask noise on a real exchange) but never drift from it.
export function tick(state, now = Date.now()) {
  const dt = state.lastTick ? Math.min(now - state.lastTick, 12 * HOUR) : 0;
  state.lastTick = now;
  if (!dt) return;
  const e = Math.exp(-dt / NOISE_TAU);
  const liveTeams = new Set();
  for (const g of Object.values(state.liveGames)) for (const t of g.teams) liveTeams.add(tid(g.league, t.id));
  const all = Object.values(state.assets);
  // Funds last, so their NAV uses this tick's component prices.
  for (const a of [...all.filter((x) => x.kind !== 'fund'), ...all.filter((x) => x.kind === 'fund')]) {
    const live = !!a.live || liveTeams.has(a.id);
    const sigma = a.kind === 'fund' ? 0 : (a.kind === 'team' ? 0.004 : 0.008) * (live ? 2.5 : 1);
    a.n = sigma ? (a.n || 0) * e + sigma * Math.sqrt(1 - e * e) * gauss() : 0;
    const t = targetPrice(state, a, now);
    a.target = t;
    const p = Math.round(t * Math.exp(a.n) * 100) / 100;
    const h = a.hist;
    const lastT = h[h.length - 2] || 0; const lastP = h[h.length - 1] || p;
    a.price = p;
    if (now - lastT > 15 * 60e3 || Math.abs(p / lastP - 1) > 0.0075) pushHist(a, now, p);
  }
  const nw = netWorth(state);
  const last = state.nw[state.nw.length - 2] || 0;
  if (now - last > 15 * 60e3) {
    state.nw.push(now, Math.round(nw * 100) / 100);
    if (state.nw.length > 1600) state.nw = state.nw.filter((_, i) => i % 4 < 2 || i > 800);
  }
}

// ---------- trading ----------

export function quote(state, id, now = Date.now()) {
  const a = state.assets[id];
  return { bid: round2(a.price * (1 - SPREAD)), ask: round2(a.price * (1 + SPREAD)), last: a.price };
}

const round2 = (x) => Math.round(x * 100) / 100;
const IMPACT_PER_DOLLAR = 0.003 / 1000; // $1,000 of flow moves the price 0.3%

// What a market order would fill at. Your own flow walks the price (linear
// impact) and you fill at the average of the before/after price plus the spread,
// so splitting orders or pump-and-dumping can't manufacture profit.
export function previewTrade(state, id, side, qty, now = Date.now()) {
  const a = state.assets[id];
  const dir = side === 'buy' ? 1 : -1;
  const cur = impact(a, now);
  const next = clamp(cur + dir * IMPACT_PER_DOLLAR * a.price * qty, -0.12, 0.12);
  const pre = a.price;
  const post = pre * (1 + next) / (1 + cur);
  const mid = (pre + post) / 2;
  const fill = round2(mid * (1 + dir * SPREAD));
  return { fill, total: round2(fill * qty), post: round2(post), next };
}

export function trade(state, id, side, qty, now = Date.now()) {
  const a = state.assets[id];
  if (!a) throw new Error('Unknown asset');
  qty = Math.round(qty * 1e6) / 1e6;
  const pos = state.holdings[id] || { qty: 0, cost: 0, since: now };
  if (side === 'sell' && qty > pos.qty && qty - pos.qty < 1e-5) qty = pos.qty; // "sell all" rounding
  if (!(qty > 0)) throw new Error('Enter an amount to trade');
  if (qty * a.price < 1 && !(side === 'sell' && qty === pos.qty)) throw new Error('Minimum order is $1');
  const pv = previewTrade(state, id, side, qty, now);
  const total = pv.total;
  if (side === 'buy') {
    if (total > state.cash + 1e-9) throw new Error(`Not enough cash — you have $${state.cash.toFixed(2)}`);
    state.cash = round2(state.cash - total);
    pos.qty += qty; pos.cost = round2(pos.cost + total);
  } else {
    if (qty > pos.qty + 1e-9) throw new Error(`You only own ${fmtQty(pos.qty)} share${pos.qty === 1 ? '' : 's'}`);
    const avg = pos.qty ? pos.cost / pos.qty : 0;
    state.cash = round2(state.cash + total);
    pos.cost = round2(pos.cost - avg * qty); pos.qty = Math.round((pos.qty - qty) * 1e6) / 1e6;
  }
  if (pos.qty > 1e-6) state.holdings[id] = pos; else delete state.holdings[id];
  a.imp = { v: pv.next, t: now };
  setPrice(state, a, now);
  const tx = { t: now, id, ticker: a.ticker, name: a.name, side, qty, price: pv.fill, total, kind: 'stock' };
  state.txns.unshift(tx);
  if (state.txns.length > 500) state.txns.length = 500;
  return tx;
}

export function holdingsValue(state) {
  let v = 0;
  for (const [id, h] of Object.entries(state.holdings)) v += (state.assets[id]?.price || 0) * h.qty;
  return v;
}

export const netWorth = (state, now = Date.now()) => state.cash + holdingsValue(state) + optionsValue(state, now);

export const fmtQty = (q) => (Math.abs(q - Math.round(q)) < 1e-6 ? String(Math.round(q)) : q.toFixed(q < 1 ? 4 : 3).replace(/0+$/, ''));

// League index: equal-weight average of the 50 most valuable assets, rebased to 1000.
export function leagueIndex(state, league, now = Date.now()) {
  const list = Object.values(state.assets).filter((a) => a.league === league && a.kind !== 'fund' && a.hist.length);
  if (!list.length) return null;
  const top = list.sort((x, y) => y.price - x.price).slice(0, 50);
  const cur = mean(top.map((a) => a.price));
  const prev = mean(top.map((a) => priceAt(a, now - DAY)));
  return { value: cur * 10, change: prev ? cur / prev - 1 : 0 };
}
