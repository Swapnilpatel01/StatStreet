// The market engine: turns sports data into prices, runs the tape, executes trades.
// Pure state functions (no DOM, no network) so the whole thing can be tested in Node.

import { clamp, gauss, mean, std, median, decay, HOUR, DAY, tickerFrom } from './util.js';
import {
  LEAGUES, posGroup, posMultiplier, gameScore, lineText, milestone, injuryFactor, sentimentScore, newsEffects,
} from './scoring.js';
import { optionsValue, optionMid, CONTRACT } from './bs.js';

export const START_CASH = 5;
export const START_OPTIONS = [5, 100, 1000, 10000];
// Rewards, fees and minimums are sized to your bankroll: 1.0 at a $100 season, 0.05 at $5.
export const bankrollScale = (state) => (state.season?.bal || state.startCash || 100) / 100;
export const minOrder = (state) => clamp(Math.round(bankrollScale(state) * 100) / 100, 0.05, 1);
export const SPREAD = 0.0035;           // half-spread charged on each trade
// ---------- pricing model (v2) ----------
// Prices are a market's best guess of how good someone is, not a scoreboard:
// - Value comes from a blend of this season, last season and the position average, so
//   proven stars are priced as stars from day one instead of climbing predictably.
// - A game only moves the price by how much it beat or missed that player's own normal
//   level (the surprise), so a star playing like a star doesn't drift up for free.
// - Stars are much more expensive: price grows exponentially with performance.
// - "Market hype" is a slow random walk on top, so prices are never a sure thing.
export const MODEL_V = 2;   // how player form and last-season priors are estimated
export const PRICE_V = 3;   // price levels: v3 made teams pricier and added the star premium
const P0 = 30;                           // price of a perfectly average player
const TEAM_P0 = 1000;                    // price of a .500 team (teams are the blue chips)
const Z_SLOPE_LG = { nba: 0.75, nfl: 0.75, mlb: 0.9 }; // price multiple per standard deviation of performance (e^0.75 ≈ 2.1x)
const zSlope = (lg) => Z_SLOPE_LG[lg] ?? 0.75;
// Star premium: the best players in each league (by their season-start level) cost up to
// ~4x more on top of their stats, so household names are the expensive ones everywhere.
export const starPremium = (pct) => 1 + 3 * Math.pow(clamp((pct - 0.9) / 0.1, 0, 1), 2.5);
const Z_MIN = -3; const Z_MAX = 4.2;
// Typical price move from a one-standard-deviation surprise in a single game.
const TARGET_MOVE = { nba: 0.06, nfl: 0.09, mlb: 0.03 };
// How far one player's game score usually lands from his own average (starting guesses; learned as games come in).
const GAME_NOISE = { nba: { ALL: 7.5 }, nfl: { QB: 7, RB: 6, WR: 5.5, K: 3.5, DEF: 3, OL: 1.5 }, mlb: { H: 2.8, P: 6 } };
// Weight (in games) of last season and of the position average when estimating a player's level.
const PRIOR_K = { nba: 10, nfl: 4, mlb: 40 };
const MEAN_K = { nba: 5, nfl: 3, mlb: 30 };
// Teams: games of "last season, regressed" before this season's record takes over, and price steepness.
const TEAM_K = { nba: 30, nfl: 10, mlb: 60 };
const TEAM_SLOPE = { nba: 3.6, nfl: 2.6, mlb: 4.5 };
const PRIOR_REGRESS = { nba: 0.55, nfl: 0.32, mlb: 0.45 }; // how much of last season carries over (year-to-year correlation)
const WINP_C = { nba: 0.8, nfl: 0.9, mlb: 0.36 };   // converts a team price gap into a win probability
const HYPE = { player: { sd: 0.07, tau: 20 * DAY }, team: { sd: 0.05, tau: 25 * DAY } };
const NEWS_HALF_LIFE = 72 * HOUR;
const IMPACT_HALF_LIFE = 4 * HOUR;
const NOISE_TAU = 3 * HOUR;
const HIST_CAP = 420;

// Dividends, as a fraction of share price.
// Teams pay per win; players pay for above-average games (per standard deviation above their position's average).
export const TEAM_DIV = { nba: 0.0025, nfl: 0.015, mlb: 0.0012 };
export const PLAYER_DIV = { nba: 0.0015, nfl: 0.006, mlb: 0.0008 };
export const MILESTONE_DIV = 0.004;

const FIX_V_NEW = 2;
export function newState(startCash = START_CASH) {
  return {
    v: 1, modelV: PRICE_V, histV: 2, fixV: FIX_V_NEW, newsV: 2, created: Date.now(), startCash,
    cash: startCash, holdings: {}, txns: [], watch: [],
    assets: {}, stats: {}, mood: { nba: 0, nfl: 0, mlb: 0 },
    games: {}, liveGames: {}, newsSeen: {}, news: [], sync: {},
    nw: [], lastTick: 0,
    options: {}, orders: [], alerts: [], recurring: [], divs: [], divTotal: 0, inbox: [], schedule: {},
    picks: {}, pickStats: { w: 0, l: 0, streak: 0, best: 0, won: 0 }, daily: { last: '', streak: 0, best: 0 },
    collection: {}, trophies: {}, results: [], startedAt: Date.now(), contests: {}, props: [],
    settings: { proxy: '', leagues: { nba: true, nfl: true, mlb: true }, drip: false, startCash, startCashV: 2 },
  };
}

// Start a fresh portfolio with `start` dollars. Career progress (levels, cards from
// packs, trophies) is kept; the current season restarts from the new balance.
export function resetPortfolio(state, start, now = Date.now()) {
  Object.assign(state, {
    cash: start, startCash: start, holdings: {}, txns: [], nw: [], options: {}, orders: [], recurring: [], divs: [], divTotal: 0, inbox: [],
    picks: {}, pickStats: { w: 0, l: 0, streak: 0, best: 0, won: 0 }, startedAt: now, contests: {}, props: [], shorts: {}, futures: [],
  });
  if (state.season) Object.assign(state.season, { start: now, nw0: start, bal: start, flow0: state.flow || 0 });
  state.week = null;
  // Cards you only had because you owned the player go with the shares.
  for (const [id, c] of Object.entries(state.collection || {})) { if (c.pulls) c.peak = 0; else delete state.collection[id]; }
}

// Fill in anything an older saved state is missing.
export function migrate(state) {
  const d = newState();
  for (const k of ['options', 'orders', 'alerts', 'recurring', 'divs', 'inbox', 'schedule', 'watch', 'txns', 'nw',
    'picks', 'pickStats', 'daily', 'collection', 'trophies', 'results', 'contests', 'props']) state[k] ??= d[k];
  state.startedAt ??= state.nw?.[0] || state.created || Date.now();
  state.divTotal ??= 0;
  state.startCash ??= 10000; // portfolios created before the $100 default started with $10,000
  const firstMigration = !state.settings?.startCashV;
  state.settings = { ...d.settings, ...(state.settings || {}) };
  if (firstMigration) {
    // Switch to the new $100 default, but only if the portfolio was never used.
    const untouched = !state.txns?.length && !Object.keys(state.holdings || {}).length && !Object.keys(state.options || {}).length
      && !state.orders?.length && !state.recurring?.length && Math.abs((state.cash ?? 0) - state.startCash) < 0.005;
    state.settings.startCash = START_CASH;
    if (untouched) { state.cash = START_CASH; state.startCash = START_CASH; state.nw = []; }
  }
  state.settings.leagues = { ...d.settings.leagues, ...(state.settings.leagues || {}) };
  if ((state.settings.startCashV || 1) < 2) {
    // You asked to start over with $5.
    state.settings.startCashV = 2;
    state.settings.startCash = START_CASH;
    resetPortfolio(state, START_CASH);
    notify(state, 'info', 'Fresh start: your portfolio was reset to $5. Levels, cards and trophies are kept.');
  }
  for (const h of Object.values(state.holdings || {})) h.since ??= 0;
  return state;
}

// Other modules (contests, props) listen for final box scores here.
export const gameHooks = [];
// Booster cards plug in here (see boosters.js).
export const boostHooks = { divMult: null, afterGame: null };
function boostAfterGame(state, a, pct, priceBefore, at, gameDate) {
  const h = state.holdings[a.id];
  if (!h || (h.since || 0) >= gameDate || !boostHooks.afterGame) return;
  boostHooks.afterGame(state, a, pct, priceBefore, at);
}

// A card's level: from the most you've ever held at once ($5 = Lv 1, doubling per level),
// or from pulling duplicates in packs, whichever is higher.
export function cardLevel(state, id) {
  const c = state.collection?.[id];
  if (!c) return 0;
  const held = c.peak > 0 ? 1 + Math.floor(Math.log2(Math.max(c.peak, 5) / 5)) : 0;
  const pulled = c.pulls ? c.pulls : 0;
  return clamp(Math.max(held, pulled, 1), 1, 10);
}
// Each card level above 1 adds 5% to the dividends that player or team pays you.
export const cardDivBonus = (state, id) => Math.max(0, cardLevel(state, id) - 1) * 0.05;

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

// Team strength: this season's record, padded with last season's (regressed toward .500),
// plus point differential. Good teams are priced high from the first day of a season.
export function teamScore(state, a) {
  const lg = a.league;
  const r = a.rec.prior ? { w: 0, l: 0, t: 0, gp: 0, diff: 0 } : a.rec;
  const k = TEAM_K[lg];
  const pr = a.prior;
  const p0 = pr ? 0.5 + PRIOR_REGRESS[lg] * (pr.pct - 0.5) : 0.5;
  const adjPct = (r.w + 0.5 * (r.t || 0) + k * p0) / (r.gp + k);
  const st = state.stats[lg]?.team || { mu: 0, sd: 1 };
  const sd = st.sd || 1;
  const dzNow = r.gp ? clamp((r.diff / r.gp - st.mu) / sd, -3, 3) : 0;
  const dz0 = pr ? clamp(PRIOR_REGRESS[lg] * pr.dpg / (state.stats[lg]?.priorSd || sd), -3, 3) : 0;
  const dz = (r.gp * dzNow + k * dz0) / (r.gp + k);
  let score = TEAM_SLOPE[lg] * (adjPct - 0.5) + 0.35 * dz;
  if (r.playoffPct != null && r.gp > 0) score += 0.25 * (r.playoffPct / 100 - 0.5) * (r.gp / (r.gp + k));
  return score;
}

function teamFair(state, a) {
  return TEAM_P0 * Math.exp(teamScore(state, a));
}

// Chance team A beats team B, from their share prices (price gaps reflect strength gaps).
export function teamWinProb(state, league, idA, idB, homeA = false, preseason = false) {
  const a = state.assets[tid(league, idA)]; const b = state.assets[tid(league, idB)];
  if (!a || !b || !(a.price > 0) || !(b.price > 0)) return 0.5;
  let p = 1 / (1 + Math.exp(-WINP_C[league] * Math.log(a.price / b.price)));
  if (preseason) p = 0.5 + (p - 0.5) * 0.4;
  return clamp(p + (homeA ? 0.03 : -0.03), 0.05, 0.95);
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
      shocks: [], events: [], hist: [], price: 0, n: 0, imp: null, isNew: true,
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
  if (rec.line) a.perf.avg = rec.line; // per-game averages, used for prop lines
  if (a.perf.ema == null) {
    a.perf.ema = rec.gs;
    a.perf.n = Math.min(rec.gp, 12);
    a.perf.base = rec.gs;
    a.perf.init = 0; // initForm() blends in last season and the position average
  }
  return a;
}

// Last season's averages, used as a prior. Players who haven't played yet this season
// (injured stars, for example) are listed from last season alone.
export function seedPrior(state, league, rec) {
  const id = pid(league, rec.id);
  const a = state.assets[id] || ensurePlayer(state, league, rec);
  a.perf.prior = { gs: rec.gs, gp: rec.gp };
  if (a.perf.init !== MODEL_V) a.perf.init = 0;
  return a;
}

export function setTeamPrior(state, league, t) {
  const a = state.assets[tid(league, t.id)];
  if (!a || !t.gp) return;
  a.prior = { pct: (t.w + 0.5 * (t.t || 0)) / t.gp, dpg: t.diff / t.gp };
}

export function playerZ(state, a) {
  const st = state.stats[a.league]?.[posGroup(a.league, a.pos)];
  const ema = a.live?.ema ?? a.perf.ema;
  // A player with no games on record yet is priced as a backup, not as an average starter.
  if (st && ema == null) return -1;
  return st && st.sd > 0 ? clamp((ema - st.mu) / st.sd, Z_MIN, Z_MAX) : 0;
}

function playerFair(state, a) {
  return P0 * posMultiplier(a.league, a.pos) * Math.exp(zSlope(a.league) * playerZ(state, a)) * (a.fame || 1);
}

// Per-game spread of game scores around a player's own level, by position group.
export function gameNoise(state, league, group) {
  return state.gnoise?.[league]?.[group] ?? GAME_NOISE[league]?.[group] ?? 4;
}
function learnNoise(state, league, group, diff) {
  const g = gameNoise(state, league, group);
  const d = clamp(Math.abs(diff), 0, 4 * g);
  state.gnoise ||= {}; state.gnoise[league] ||= {};
  state.gnoise[league][group] = Math.sqrt(0.985 * g * g + 0.015 * d * d);
}
// How much one game updates a player's level. Noisy stats (a hitter's single game) count
// for less than steady ones, so every league's game moves prices by a similar amount.
export function groupAlpha(state, league, group) {
  const sd = state.stats[league]?.[group]?.sd || 1;
  return clamp(TARGET_MOVE[league] * sd / (zSlope(league) * gameNoise(state, league, group)), 0.01, 0.35);
}

// A player we know nothing about (first seen in a box score) is a backup until he shows
// otherwise: he starts a standard deviation below the listed players at his position.
function newcomerLevel(state, league, group, gs) {
  const st = state.stats[league]?.[group];
  if (!st) return gs;
  const base = st.mu - st.sd;
  return gs == null ? base : capStep(state, league, group, base, base + 0.25 * (gs - base));
}
// No single game moves a price by more than about a quarter.
const MAX_GAME_LN = Math.log(1.25);
function capStep(state, league, group, from, to, scale = 1) {
  const sd = state.stats[league]?.[group]?.sd;
  if (!sd) return to;
  const max = (MAX_GAME_LN * scale / zSlope(league)) * sd;
  return from + clamp(to - from, -max, max);
}

// Estimate each player's level from this season, last season and the position average.
export function initForm(state, league, { all = false, fromSeason = false } = {}) {
  const players = Object.values(state.assets).filter((a) => a.league === league && a.kind === 'player');
  const raw = (a) => (a.perf.season?.gp ? (a.perf.base ?? a.perf.season.gs) : a.perf.prior?.gs ?? a.perf.ema);
  const groups = {};
  for (const a of players) { const r = raw(a); if (r != null) (groups[posGroup(league, a.pos)] ||= []).push(r); }
  const mu = Object.fromEntries(Object.entries(groups).map(([g, arr]) => [g, mean(arr)]));
  for (const a of players) {
    if (!all && a.perf.init === MODEL_V) continue;
    const s = a.perf.season; const pr = a.perf.prior;
    // Saves from before v2 keep what recent games taught them as "this season".
    if (s?.gp && (fromSeason || a.perf.base == null)) a.perf.base = !fromSeason && a.perf.init == null && a.perf.ema != null ? a.perf.ema : s.gs;
    let num = 0; let den = 0;
    if (s?.gp) { num += a.perf.base * s.gp; den += s.gp; }
    if (pr?.gp) { const k = PRIOR_K[league] * Math.min(1, pr.gp / (SEASON_GAMES[league] * 0.4)); num += pr.gs * k; den += k; }
    if (den > 0) {
      // Talent is right-skewed (a few superstars, lots of similar role players), so a
      // below-average estimate is more likely to be bad luck than an above-average one.
      const m = mu[posGroup(league, a.pos)] ?? 0;
      const k0 = MEAN_K[league] * (num / den < m ? 2.5 : 1); num += m * k0; den += k0;
      a.perf.ema = num / den;
      a.perf.n = Math.max(a.perf.n || 0, s?.gp ? Math.min(s.gp, 20) : 5);
    }
    a.perf.lvl = a.perf.ema;
    a.perf.init = MODEL_V;
  }
}

// Recompute per-league, per-position baselines used to normalize performance.
export function recomputeStats(state, league) {
  const groups = {}; const seeded = {};
  const teamDiffs = [];
  for (const a of Object.values(state.assets)) {
    if (a.league !== league) continue;
    // Baselines come from each player's season-start level (not the game-to-game estimate),
    // so they stay put all season: otherwise growing noise in the estimates would squeeze
    // everyone toward the middle and make stars drift down and cheap players drift up.
    const lvl = a.perf?.lvl ?? (a.perf?.n >= 1 ? a.perf.ema : null);
    if (a.kind === 'player' && lvl != null) {
      const g = posGroup(league, a.pos);
      (groups[g] ||= []).push(lvl);
      if (a.perf.lvl != null) (seeded[g] ||= []).push(lvl);
    } else if (a.kind === 'team' && a.rec.gp > 0) {
      teamDiffs.push(a.rec.diff / a.rec.gp);
    }
  }
  const out = {};
  for (const [g, all] of Object.entries(groups)) {
    // Players first seen in a box score (no season-start level) don't move the baseline.
    const arr = seeded[g]?.length >= 8 ? seeded[g] : all;
    const mu = mean(arr);
    out[g] = { mu, sd: Math.max(std(arr, mu), Math.abs(mu) * 0.25, 0.5), n: arr.length };
  }
  const tmu = mean(teamDiffs);
  out.team = { mu: tmu, sd: Math.max(std(teamDiffs, tmu), 0.1) };
  const priors = Object.values(state.assets).filter((a) => a.league === league && a.kind === 'team' && a.prior).map((a) => a.prior.dpg);
  if (priors.length > 3) out.priorSd = Math.max(std(priors, mean(priors)), 0.1);
  state.stats[league] = out;
  // Star premium from each player's season-start standing within his position group,
  // ranked across the whole league. It only changes when the season is re-seeded.
  const ranked = [];
  for (const a of Object.values(state.assets)) {
    if (a.league !== league || a.kind !== 'player') continue;
    const lvl = a.perf?.lvl ?? (a.perf?.n >= 1 ? a.perf.ema : null);
    const g = out[posGroup(league, a.pos)];
    if (lvl == null || !g || (a.perf.lvl == null && seeded[posGroup(league, a.pos)]?.length >= 8)) { a.fame = 1; continue; }
    ranked.push([a, (lvl - g.mu) / g.sd]);
  }
  ranked.sort((x, y) => x[1] - y[1]);
  ranked.forEach(([a], i) => { a.fame = Math.round(starPremium((i + 0.5) / ranked.length) * 1000) / 1000; });
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
  return { fair, inj, senti, mood, imp, live, hype: Math.exp(a.h || 0) - 1, target: Math.max(0.5, target) };
}

export const targetPrice = (state, a, now) => breakdown(state, a, now).target;

function setPrice(state, a, now, { record = true, at = now } = {}) {
  const t = targetPrice(state, a, now);
  a.target = t;
  a.price = Math.round(t * Math.exp((a.n || 0) + (a.h || 0)) * 100) / 100;
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
  // Pre-game win chances (before this result moves the prices).
  const pre = Object.fromEntries(game.teams.map((side) => {
    const opp = side === t1 ? t2 : t1;
    return [side.id, opp ? teamWinProb(state, league, side.id, opp.id, !!side.home) : 0.5];
  }));

  for (const side of game.preseason ? [] : game.teams) {
    const a = state.assets[tid(league, side.id)];
    if (!a) continue;
    const opp = side === t1 ? t2 : t1;
    const won = side.score > opp.score || side.winner;
    const tie = side.score === opp.score && !side.winner && !opp.winner;
    const text = `${won ? 'W' : tie ? 'T' : 'L'} ${side.score}-${opp.score} ${side.home ? 'vs' : '@'} ${opp.abbr}`;
    // Wins pay a dividend, bigger for upsets, so good and bad teams yield about the same on average.
    if (won) payDividend(state, a, a.price * TEAM_DIV[league] * 2 * (1 - pre[side.id]), `${pre[side.id] < 0.45 ? 'Upset win' : 'Win'} ${side.score}-${opp.score} ${side.home ? 'vs' : '@'} ${opp.abbr}`, at, game.date);
    const teamBefore = a.price;
    const teamPct = withEvent(state, a, now, at, 'game', text, () => {
      a.rec.gp += 1; a.rec.diff += side.score - opp.score;
      if (won) a.rec.w += 1; else if (tie) a.rec.t += 1; else a.rec.l += 1;
      // During a replay the standings already carry the current streak.
      if (!backfill) a.rec.streak = won ? Math.max(1, a.rec.streak + 1) : Math.min(-1, a.rec.streak - 1);
      a.form = [won, ...(a.form || [])].slice(0, 10);
      a.liveBoost = 0;
    }, { force: true });
    if (!backfill) boostAfterGame(state, a, teamPct, teamBefore, at, game.date);
  }

  for (const p of game.players) {
    const a = ensurePlayer(state, league, p);
    const gs = gameScore(league, p.line);
    const opp = game.teams.find((t) => t.id !== p.teamId)?.abbr || '';
    const text = `${lineText(league, p.line)}${opp ? ` vs ${opp}` : ''}${game.preseason ? ' (preseason)' : ''}`;
    const grp = posGroup(league, a.pos);
    const before = a.perf.ema;
    // Surprise is measured against this player's own usual spread, so steady and streaky
    // players earn dividends equally often.
    const own = a.perf.gn ?? gameNoise(state, league, grp);
    const surprise = before == null ? 0 : (gs - before) / own;
    if (before != null && !game.preseason) {
      learnNoise(state, league, grp, gs - before);
      const d = clamp(Math.abs(gs - before), 0, 4 * own) * 1.2533; // mean |x| → sd
      a.perf.gn = Math.sqrt(0.92 * own * own + 0.08 * d * d);
    }
    const playerBefore = a.price;
    const playerPct = withEvent(state, a, now, at, 'game', text, () => {
      const alpha = groupAlpha(state, league, grp) * (game.preseason ? 1 / 3 : 1); // exhibition games count for less
      // A newcomer's first game is mostly luck: start him close to the position average.
      a.perf.ema = before == null ? newcomerLevel(state, league, grp, gs)
        : capStep(state, league, grp, before, before + alpha * (gs - before), game.preseason ? 1 / 3 : 1);
      a.perf.init = MODEL_V;
      a.perf.n = Math.min(a.perf.n + 1, 20);
      a.perf.last.unshift({ e: game.id, t: game.date, gs: Math.round(gs * 10) / 10, text, opp, line: p.line });
      if (a.perf.last.length > 10) a.perf.last.length = 10;
      a.live = null;
    }, { force: gs !== 0 });
    if (!game.preseason && !backfill) boostAfterGame(state, a, playerPct, playerBefore, at, game.date);
    // Dividends reward beating your own usual level, so stars and role players yield about the same.
    if (!game.preseason && surprise > 0.3) {
      payDividend(state, a, a.price * PLAYER_DIV[league] * clamp(surprise, 0, 3), `Beat his average: ${lineText(league, p.line)}`, at, game.date);
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
  recordResult(state, league, game);
  settlePick(state, game, at);
  for (const h of gameHooks) { try { h(state, league, game, at); } catch (e) { console.warn('game hook', e); } }
}

// Keep recent final scores for the Games tab.
function recordResult(state, league, game) {
  if (!state.results || game.teams.length < 2) return;
  if (state.results.some((r) => r.id === game.id)) return;
  const home = game.teams.find((t) => t.home) || game.teams[0];
  const away = game.teams.find((t) => t !== home);
  state.results.unshift({
    id: game.id, league, date: game.date, preseason: !!game.preseason, name: `${away.abbr} @ ${home.abbr}`,
    teams: [away, home].map((t) => ({ id: t.id, abbr: t.abbr, score: t.score, winner: !!t.winner || t.score > (t === home ? away : home).score })),
  });
  state.results.sort((x, y) => y.date - x.date);
  if (state.results.length > 80) state.results.length = 80;
}

// Pick'em: pay out a correct pick (streak bonus up to 2x), record a miss.
export const pickStreakMult = (streak) => Math.min(2, 1 + 0.1 * streak);
function settlePick(state, game, at) {
  const pk = state.picks?.[game.id];
  if (!pk || pk.done) return;
  const winner = game.teams.find((t) => t.winner) || [...game.teams].sort((x, y) => y.score - x.score)[0];
  const tie = game.teams.length === 2 && game.teams[0].score === game.teams[1].score && !game.teams.some((t) => t.winner);
  pk.done = true; pk.settled = at;
  const st = state.pickStats;
  if (tie) { pk.result = 'push'; notify(state, 'pick', `${pk.name} ended in a tie — pick returned`, null, at); return; }
  pk.result = winner.id === pk.teamId ? 'won' : 'lost';
  if (pk.result === 'won') {
    const pay = Math.round(pk.reward * pickStreakMult(st.streak) * 100) / 100;
    pk.paid = pay;
    st.w++; st.streak++; st.best = Math.max(st.best, st.streak); st.won = Math.round((st.won + pay) * 100) / 100;
    state.cash = Math.round((state.cash + pay) * 100) / 100;
    notify(state, 'pick', `Pick'em win: ${pk.abbr} beat ${pk.opp} · +$${pay.toFixed(2)}${st.streak > 1 ? ` (${st.streak} in a row)` : ''}`, null, at);
  } else {
    st.l++; st.streak = 0;
    notify(state, 'pick', `Pick'em miss: ${pk.abbr} lost to ${pk.opp}`, null, at);
  }
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
  // If you are short this player, his dividend is yours to pay.
  const sh = state.shorts?.[a.id];
  if (sh) sh.fee = Math.round(((sh.fee || 0) + perShare * sh.qty) * 10000) / 10000;
  const own = state.holdings[a.id];
  if (own && (own.since || 0) < gameDate) {
    const mult = (1 + (state.collection?.[a.id] ? cardDivBonus(state, a.id) : 0)) * (boostHooks.divMult ? boostHooks.divMult(state, a.id) : 1);
    credit(a.id, own.qty * mult, null);
  }
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
  const done = clamp(((game.period || 1) - 0.5) / (game.regPeriods || 4), 0.05, 1); // how much of the game is played (for live prop lines)
  state.liveGames[game.id] = { league, name: game.name, detail: game.detail, teams: game.teams, t: now, frac: done };
  for (const p of game.players || []) {
    const a = ensurePlayer(state, league, p);
    const gs = gameScore(league, p.line);
    const projected = gs / Math.max(frac, 0.35);
    const grp = posGroup(league, a.pos);
    // An unknown player's live price starts from the same backup level his final will use.
    const base = a.perf.ema ?? newcomerLevel(state, league, grp, null);
    const alpha = groupAlpha(state, league, grp) * (game.preseason ? 1 / 3 : 1);
    a.live = { e: game.id, ema: capStep(state, league, grp, base, base + alpha * frac * (projected - base), frac), text: lineText(league, p.line), line: p.line, t: now };
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

const NEWS_W = { player: 0.07, team: 0.035 };
const effectsFor = (state, art, targets) => newsEffects(art, targets.map((id) => state.assets[id]).filter(Boolean)
  .map((a) => ({ id: a.id, kind: a.kind, name: a.name, abbr: a.kind === 'team' ? a.ticker : '' })));

export function applyNews(state, league, articles, { now = Date.now() } = {}) {
  let added = 0;
  for (const art of articles) {
    if (state.newsSeen[art.id]) continue;
    state.newsSeen[art.id] = art.published;
    const { score, hits } = sentimentScore(art.headline);
    const targets = [
      ...art.athletes.map((i) => pid(league, i)),
      ...art.teams.map((i) => tid(league, i)),
    ].filter((id) => state.assets[id]);
    const age = now - art.published;
    // Each player and team gets only what the story says about them.
    const fx = effectsFor(state, art, targets);
    for (const k of Object.keys(fx)) { fx[k] = Math.round(fx[k] * 100) / 100; if (Math.abs(fx[k]) < 0.12) delete fx[k]; }
    const item = { ...art, score: Math.round(score * 100) / 100, hits, targets, fx };
    state.news.unshift(item);
    added++;
    if (age > 5 * DAY) continue;
    for (const [id, sc] of Object.entries(fx)) {
      const a = state.assets[id];
      withEvent(state, a, now, Math.min(art.published, now), 'news', art.headline, () => {
        a.shocks.push({ t: art.published, v: NEWS_W[a.kind] * sc, news: 1 });
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
          a.injury = { status: inj.status, detail: inj.detail, factor: injuryFactor(inj.status, inj.detail), since: now };
        }, { force: true });
      } else {
        // Same status, new report: the outlook may have changed ("could begin practicing").
        const f = injuryFactor(inj.status, inj.detail);
        if (Math.abs(f - a.injury.factor) > 0.004) {
          withEvent(state, a, now, now, 'injury', `${f > a.injury.factor ? 'Outlook improving' : 'Outlook worse'}${inj.detail ? ` — ${inj.detail}` : ''}`, () => {
            a.injury.factor = f; a.injury.detail = inj.detail;
          }, { force: true });
        } else a.injury.detail = inj.detail;
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
// record:false moves prices without adding a chart point (used on reopening the app, before
// the results that came in while it was closed have been applied).
export function tick(state, now = Date.now(), { record = true } = {}) {
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
    // During a market event the whole league trades more wildly.
    const ev = a.kind !== 'fund' && state.events?.[a.league]?.end > now;
    const sigma = a.kind === 'fund' ? 0 : (a.kind === 'team' ? 0.004 : 0.008) * (live ? 2.5 : 1) * (ev ? 3 : 1);
    a.n = sigma ? (a.n || 0) * e + sigma * Math.sqrt(1 - e * e) * gauss() : 0;
    const hy = HYPE[a.kind];
    if (hy) { const eh = Math.exp(-dt / hy.tau); a.h = (a.h || 0) * eh + hy.sd * Math.sqrt(1 - eh * eh) * gauss(); }
    const t = targetPrice(state, a, now);
    a.target = t;
    const p = Math.round(t * Math.exp(a.n + (a.h || 0)) * 100) / 100;
    const h = a.hist;
    const lastT = h[h.length - 2] || 0; const lastP = h[h.length - 1] || p;
    a.price = p;
    if (record && (now - lastT > 15 * 60e3 || Math.abs(p / lastP - 1) > 0.0075)) pushHist(a, now, p);
  }
  const nw = netWorth(state);
  const last = state.nw[state.nw.length - 2] || 0;
  if (now - last > 15 * 60e3) {
    state.nw.push(now, Math.round(nw * 100) / 100);
    if (state.nw.length > 1600) state.nw = state.nw.filter((_, i) => i % 4 < 2 || i > 800);
  }
}

// ---------- chart history while the app was closed ----------
// Prices are only recorded while the app is open, so a night away left a straight line
// between two points. This fills each long gap with the kind of wiggle the market has when
// it is open. Every recorded point stays exactly where it was; a jump from a game result
// stays a jump at the time it happened.
const GAP_MIN = 40 * 60e3; const GAP_STEP = 12 * 60e3; const GAP_TAU = 90 * 60e3; const GAME_WIN = 3 * HOUR;
export function fillGaps(state, now = Date.now(), rnd = gauss) {
  let filled = 0;
  for (const a of Object.values(state.assets)) {
    const h = a.hist;
    if (!h || h.length < 4) continue;
    let out = null;
    const sigma = a.kind === 'fund' ? 0.005 : a.kind === 'team' ? 0.01 : 0.02;
    for (let i = 2; i < h.length; i += 2) {
      const t0 = h[i - 2]; const p0 = h[i - 1]; const t1 = h[i]; const p1 = h[i + 1];
      if (out) out.push(t0, p0);
      const gap = t1 - t0;
      if (gap <= GAP_MIN || !(p0 > 0) || !(p1 > 0)) continue;
      out ||= h.slice(0, i);
      const n = Math.max(3, Math.min(60, Math.round(gap / GAP_STEP)));
      const dtn = gap / (n + 1);
      // A big step is a game result landing: the price holds its old level, then trades its way
      // to the new one over the hours the game was on (choppy, like live trading), not in one
      // straight line and not in one vertical step.
      const jump = Math.abs(p1 / p0 - 1) > 0.025;
      const win = Math.min(gap * 0.6, GAME_WIN);
      const e = Math.exp(-dtn / GAP_TAU); const s = sigma * Math.sqrt(1 - e * e);
      const xs = []; let x = 0;
      for (let k = 0; k < n; k++) { x = x * e + s * rnd(); xs.push(x + sigma * 0.2 * rnd()); } // a slow drift plus tick-to-tick jitter
      const wob = jump ? Array.from({ length: 7 }, () => clamp(rnd(), -1.5, 1.5)) : [];
      for (let k = 0; k < n; k++) {
        const f = (k + 1) / (n + 1);
        const pin = xs[n - 1] * f; // tie the noise back to zero at the far end
        const tk = dtn * (k + 1);
        const g = jump ? Math.max(0, (tk - (gap - win)) / win) : f; // share of the move made so far
        // In the game window the path lurches: most of a move comes in a few bursts.
        const lurch = jump && g > 0 ? 0.35 * Math.sin(Math.PI * g) * (wob[k % wob.length]) : 0;
        const base = p0 * Math.pow(p1 / p0, clamp(g + lurch, -0.15, 1.15));
        const amp = jump && g > 0 ? 2 : 1;
        out.push(Math.round(t0 + tk), Math.max(0.01, Math.round(base * Math.exp(amp * (xs[k] - pin)) * 100) / 100));
      }
      filled++;
    }
    if (!out) continue;
    out.push(h[h.length - 2], h[h.length - 1]);
    // Same thinning as live recording: keep long-range history, drop detail from the oldest part.
    while (out.length > HIST_CAP * 2) { const half = Math.floor(out.length / 4) * 2; const old = []; for (let i = 0; i < half; i += 4) old.push(out[i], out[i + 1]); out = old.concat(out.slice(half)); }
    a.hist = out;
  }
  return filled;
}

// ---------- model changes ----------

// Run a repricing that changes the *rules* (not the market), without making or losing
// anyone money: holdings are converted at equal value (like a stock split), charts are
// rescaled so they don't show a fake jump, orders and alerts move with the price, and
// open options are closed at their current value.
export function withRebase(state, now, fn) {
  const old = new Map(Object.values(state.assets).map((a) => [a.id, a.price]));
  const optCash = [];
  for (const [k, pos] of Object.entries(state.options || {})) optCash.push([k, pos, optionMid(state, pos, now) * CONTRACT * pos.qty]);
  fn();
  for (const f of Object.values(state.assets)) if (f.kind === 'fund') setPrice(state, f, now, { record: false });
  let changed = 0;
  for (const a of Object.values(state.assets)) {
    const p0 = old.get(a.id);
    if (!(p0 > 0) || !(a.price > 0)) continue;
    const r = a.price / p0;
    if (Math.abs(r - 1) < 1e-4) continue;
    changed++;
    for (let i = 1; i < a.hist.length; i += 2) a.hist[i] = round2(a.hist[i] * r);
    for (const d of a.divHist || []) d.ps = Math.round(d.ps * r * 10000) / 10000;
    const h = state.holdings[a.id];
    if (h) h.qty = Math.round((h.qty / r) * 1e6) / 1e6;
    for (const o of state.orders || []) if (o.assetId === a.id) { o.price = round2(o.price * r); o.qty = Math.round((o.qty / r) * 1e4) / 1e4; }
    for (const al of state.alerts || []) if (al.assetId === a.id) al.price = round2(al.price * r);
  }
  for (const [k, pos, value] of optCash) {
    const a = state.assets[pos.under];
    if (!a || Math.abs(a.price / (old.get(a.id) || a.price) - 1) < 1e-4) continue;
    state.cash = round2(state.cash + value);
    delete state.options[k];
    notify(state, 'option', `${a.ticker} options closed at ${'$' + value.toFixed(2)} for the price update`, a.id, now);
  }
  return changed;
}

// Start every player's and team's chart fresh from today's price (index funds and your
// portfolio chart keep their history, since those values carried over unchanged).
export const HIST_V = 2;
export function resetHistory(state, now = Date.now()) {
  for (const a of Object.values(state.assets)) {
    if (a.kind === 'fund') continue;
    a.hist = [now - 60e3, a.price, now, a.price];
    a.events = (a.events || []).map((e) => ({ ...e, pct: 0 })).filter((e) => e.kind === 'injury' || now - e.t < 3 * DAY);
  }
  state.histV = HIST_V;
}

// One-time move of an older save to the current pricing model.
export function upgradeModel(state, now = Date.now()) {
  const v = state.modelV || 1;
  if (v >= PRICE_V) return false;
  const had = Object.keys(state.holdings).length || Object.keys(state.options || {}).length;
  withRebase(state, now, () => {
    for (const lg of Object.keys(LEAGUES)) {
      if (v < 2) {
        for (const a of Object.values(state.assets)) if (a.league === lg && a.kind === 'team' && a.rec.prior) a.rec = { w: 0, l: 0, t: 0, gp: 0, diff: 0, streak: 0, playoffPct: null };
        initForm(state, lg, { all: true });
      }
      recomputeStats(state, lg); rebuildInjuryCache(state, lg);
      for (const a of Object.values(state.assets)) if (a.league === lg) setPrice(state, a, now, { record: false });
    }
  });
  state.modelV = PRICE_V;
  if (had) notify(state, 'info', 'New pricing: teams and star players now cost much more. Your shares were converted at equal value, so your balance is unchanged.', null, now);
  return true;
}

// One-time repair: players first seen in a box score used to be priced at the position
// average after one game (and far below it while that game was live). Put them at the
// backup level, at equal value for holders, and start their charts fresh.
export const FIX_V = 2;
export function repairNewcomers(state, now = Date.now()) {
  if ((state.fixV || 0) >= FIX_V) return 0;
  state.fixV = FIX_V;
  const fixed = [];
  const old = new Map(Object.values(state.assets).map((a) => [a.id, a.price]));
  withRebase(state, now, () => {
    for (const lg of Object.keys(LEAGUES)) {
      recomputeStats(state, lg);
      for (const a of Object.values(state.assets)) {
        if (a.league !== lg || a.kind !== 'player' || a.perf.lvl != null || a.perf.season?.gp || a.perf.prior?.gp) continue;
        const games = [...(a.perf.last || [])].reverse();
        if (!games.length || games.length >= 10) continue;
        const grp = posGroup(lg, a.pos);
        let ema = null;
        for (const g of games) {
          const pre = /preseason/.test(g.text || '');
          ema = ema == null ? newcomerLevel(state, lg, grp, g.gs)
            : capStep(state, lg, grp, ema, ema + groupAlpha(state, lg, grp) * (pre ? 1 / 3 : 1) * (g.gs - ema), pre ? 1 / 3 : 1);
        }
        if (ema != null) a.perf.ema = ema;
      }
      rebuildInjuryCache(state, lg);
      for (const a of Object.values(state.assets)) if (a.league === lg) setPrice(state, a, now, { record: false });
    }
  });
  for (const a of Object.values(state.assets)) if (a.kind === 'player' && old.get(a.id) > 0 && Math.abs(a.price / old.get(a.id) - 1) > 0.02) fixed.push(a);
  for (const a of fixed) {
    a.hist = [now - 60e3, a.price, now, a.price];
    a.events = (a.events || []).map((e) => ({ ...e, pct: 0 }));
  }
  return fixed.length;
}

// One-time: re-read stored headlines with the current rules (who a story is about, and
// "back from injury" counted as good news) and redo their effect on prices.
export const NEWS_V = 2;
export function rescoreNews(state, now = Date.now()) {
  if ((state.newsV || 1) >= NEWS_V) return;
  state.newsV = NEWS_V;
  const touched = new Set();
  for (const item of state.news || []) {
    const targets = item.targets || [];
    const old = item.score || 0;
    for (const id of targets) {
      const a = state.assets[id]; if (!a) continue;
      const v0 = NEWS_W[a.kind] * old;
      const i = (a.shocks || []).findIndex((x) => x.t === item.published && Math.abs(x.v - v0) < 1e-6);
      if (i >= 0) { a.shocks.splice(i, 1); touched.add(a); }
      a.events = (a.events || []).filter((e) => !(e.kind === 'news' && e.text === item.headline));
    }
    item.score = Math.round(sentimentScore(item.headline).score * 100) / 100;
    const fx = effectsFor(state, item, targets);
    for (const k of Object.keys(fx)) { fx[k] = Math.round(fx[k] * 100) / 100; if (Math.abs(fx[k]) < 0.12) delete fx[k]; }
    item.fx = fx;
    if (now - item.published > 12 * DAY) continue;
    for (const [id, sc] of Object.entries(fx)) {
      const a = state.assets[id];
      const v = NEWS_W[a.kind] * sc;
      a.shocks.push({ t: item.published, v, news: 1 });
      addEvent(a, item.published, 'news', item.headline, v);
      touched.add(a);
    }
  }
  for (const a of touched) setPrice(state, a, now, { record: false });
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

// Rules other modules add to trading (for example, no trading before a player's IPO).
export const tradeGuards = [];
export function trade(state, id, side, qty, now = Date.now()) {
  const a = state.assets[id];
  if (!a) throw new Error('Unknown asset');
  for (const g of tradeGuards) g(state, a, side, qty, now);
  qty = Math.round(qty * 1e6) / 1e6;
  const pos = state.holdings[id] || { qty: 0, cost: 0, since: now };
  if (side === 'sell' && qty > pos.qty && qty - pos.qty < 1e-5) qty = pos.qty; // "sell all" rounding
  if (!(qty > 0)) throw new Error('Enter an amount to trade');
  const minAmt = minOrder(state);
  if (qty * a.price < minAmt && !(side === 'sell' && qty === pos.qty)) throw new Error(`Minimum order is $${minAmt.toFixed(2)}`);
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

// Short positions: the cash you put up, plus or minus the move since you opened, minus fees owed.
export function shortsValue(state) {
  let v = 0;
  for (const [id, s] of Object.entries(state.shorts || {})) v += s.margin + (s.entry - (state.assets[id]?.price ?? s.entry)) * s.qty - (s.fee || 0);
  return v;
}

export const netWorth = (state, now = Date.now()) => state.cash + holdingsValue(state) + optionsValue(state, now) + shortsValue(state);


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
