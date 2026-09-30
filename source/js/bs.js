// Option pricing (Black-Scholes, zero rates) and volatility estimates.
// No imports from the engine, so both the engine and the options module can use it.

import { clamp, DAY } from './util.js';

export const YEAR = 365 * DAY;
export const CONTRACT = 100;          // shares per contract, like real equity options
export const OPT_SPREAD = 0.03;       // 3% half-spread on premium (options trade wider)

export function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
const normPdf = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);

// Price per share of a European option. T in years.
export function bsPrice(type, S, K, T, sigma) {
  if (T <= 0 || sigma <= 0) return Math.max(0, type === 'call' ? S - K : K - S);
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * v * v) / v;
  const d2 = d1 - v;
  return type === 'call' ? S * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - S * normCdf(-d1);
}

export function greeks(type, S, K, T, sigma) {
  if (T <= 0) {
    const itm = type === 'call' ? S > K : S < K;
    return { delta: itm ? (type === 'call' ? 1 : -1) : 0, theta: 0, gamma: 0, vega: 0, pItm: itm ? 1 : 0 };
  }
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * v * v) / v;
  const d2 = d1 - v;
  const delta = type === 'call' ? normCdf(d1) : normCdf(d1) - 1;
  const theta = -(S * normPdf(d1) * sigma) / (2 * Math.sqrt(T)) / 365; // per day, per share
  const gamma = normPdf(d1) / (S * v);
  const vega = S * normPdf(d1) * Math.sqrt(T) / 100;
  const pItm = type === 'call' ? normCdf(d2) : normCdf(-d2);
  return { delta, theta, gamma, vega, pItm };
}

// ---------- volatility with game risk ----------
// A player's or team's price barely drifts between games, then jumps when the box
// score lands. So option variance = small tape noise + slow news/injury drift
// + one "game-sized" jump for every game scheduled before expiry.

const DEFAULT_GAME_MOVE = {
  player: { nba: 0.05, nfl: 0.10, mlb: 0.03 },
  team: { nba: 0.025, nfl: 0.05, mlb: 0.012 },
};
const GAMES_PER_DAY = { nba: 0.45, nfl: 1 / 7, mlb: 0.93 };
const NEWS_VOL = { player: 0.3, team: 0.15 };      // annualized drift from news and injuries
const TAPE_NOISE = { player: 0.008, team: 0.004 };  // stationary wiggle around fair value
const PRESEASON_WEIGHT = 0.35;                      // exhibition games move prices about a third as much

// Typical size of this asset's price move per game, from its own recent games.
export function gameMove(a, now = Date.now()) {
  const def = DEFAULT_GAME_MOVE[a.kind]?.[a.league] ?? 0.04;
  const moves = new Map();
  for (const e of a.events || []) {
    if ((e.kind !== 'game' && e.kind !== 'milestone') || now - e.t > 60 * DAY) continue;
    if (/\(preseason\)/.test(e.text || '')) continue;
    const k = Math.round(e.t / 60e3); // milestone bumps land at the same moment as the game
    moves.set(k, (moves.get(k) || 0) + (e.pct || 0));
  }
  const xs = [...moves.values()].slice(0, 12);
  const n = xs.length;
  const ms = n ? xs.reduce((s, x) => s + x * x, 0) / n : 0;
  return clamp(Math.sqrt((n * ms + 3 * def * def) / (n + 3)), 0.008, 0.35);
}

// Games this asset plays between now and expiry (weighted: preseason counts less).
// Uses the real schedule where we have it, and the league's usual pace beyond that.
export function gamesBefore(state, a, exp, now = Date.now()) {
  if (!a || a.kind === 'fund') return { known: 0, estimated: 0, weight: 0, total: 0 };
  const teamId = a.kind === 'team' ? a.rid : a.teamId;
  const sched = state?.schedule?.[a.league];
  const to = state?.sync?.[a.league]?.scheduleTo || 0;
  let known = 0; let weight = 0; let pre = 0;
  for (const g of sched || []) {
    if (g.date > now && g.date < exp && g.teams.some((t) => t.id === teamId)) { known++; if (g.preseason) pre++; weight += g.preseason ? PRESEASON_WEIGHT : 1; }
  }
  let estimated = 0;
  const horizon = Math.max(now, to);
  if (exp > horizon) {
    // Beyond the fetched schedule, assume the usual pace, but only if the team is in season:
    // it has games on the schedule we fetched, or (with no schedule) it played in the last 12 days.
    const teamHasGames = (sched || []).some((g) => g.date > now && g.teams.some((t) => t.id === teamId));
    const recent = (a.events || []).some((e) => e.kind === 'game' && now - e.t < 12 * DAY);
    const inSeason = to > now ? teamHasGames : recent;
    if (inSeason) estimated = GAMES_PER_DAY[a.league] * (exp - horizon) / DAY;
  }
  // If the known games are exhibitions, assume the estimated ones are too.
  const preFrac = known ? pre / known : 0;
  weight += estimated * (1 - preFrac * (1 - PRESEASON_WEIGHT));
  return { known, estimated, weight, total: known + estimated };
}

// Effective annualized volatility for an option expiring at `exp`.
export function optionVol(state, a, exp, now = Date.now()) {
  const T = Math.max((exp - now) / YEAR, 1 / (365 * 24));
  if (a.kind === 'fund') return { iv: fundVol(a, now), games: gamesBefore(state, a, exp, now), gameVar: 0, T };
  const games = gamesBefore(state, a, exp, now);
  const move = gameMove(a, now);
  let news = NEWS_VOL[a.kind] ?? 0.25;
  if (a.injury) news += 0.15;
  let gameVar = games.weight * move * move;
  if (a.live || a.liveBoost) gameVar += 0.5 * move * move; // rest of the game in progress
  const noise = (TAPE_NOISE[a.kind] ?? 0.006) ** 2;
  const total = noise + news * news * T + gameVar;
  return { iv: clamp(Math.sqrt(total / T), 0.1, 3), games, gameVar, move, T, total };
}

// Funds hold dozens of names whose game moves mostly cancel out, so use a simple blend.
function fundVol(a, now) {
  const h = a.hist || [];
  const pts = [];
  let nextT = now - 10 * DAY;
  for (let i = 0; i < h.length; i += 2) if (h[i] >= nextT) { pts.push([h[i], h[i + 1]]); nextT = h[i] + 6 * 3600e3; }
  let realized = null;
  if (pts.length >= 6) {
    const r = [];
    for (let i = 1; i < pts.length; i++) {
      const dt = (pts[i][0] - pts[i - 1][0]) / YEAR;
      if (dt > 0) r.push(Math.log(pts[i][1] / pts[i - 1][1]) / Math.sqrt(dt));
    }
    if (r.length >= 5) realized = Math.sqrt(r.reduce((s, x) => s + x * x, 0) / r.length);
  }
  return clamp(realized == null ? 0.22 : 0.5 * 0.22 + 0.5 * clamp(realized, 0.1, 1.5), 0.12, 1.2);
}

// Headline "implied volatility" for an asset: the 30-day option level.
export function impliedVol(a, now = Date.now(), state = null) {
  return optionVol(state, a, now + 30 * DAY, now).iv;
}

export function optionMid(state, pos, now = Date.now()) {
  const a = state.assets[pos.under];
  if (!a) return 0;
  return bsPrice(pos.type, a.price, pos.strike, (pos.exp - now) / YEAR, optionVol(state, a, pos.exp, now).iv);
}

export function optionsValue(state, now = Date.now()) {
  let v = 0;
  for (const pos of Object.values(state.options || {})) v += optionMid(state, pos, now) * CONTRACT * pos.qty;
  return v;
}
