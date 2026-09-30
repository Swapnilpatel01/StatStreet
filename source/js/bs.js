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

// Annualized volatility: a base level by asset type, blended with what the
// price has actually done over the last ~10 days, plus bumps for injuries/live games.
export function impliedVol(a, now = Date.now()) {
  const base = a.kind === 'team' ? 0.35 : a.kind === 'fund' ? 0.22 : 0.6;
  const h = a.hist || [];
  const pts = [];
  let nextT = now - 10 * DAY;
  for (let i = 0; i < h.length; i += 2) {
    if (h[i] >= nextT) { pts.push([h[i], h[i + 1]]); nextT = h[i] + 6 * 3600e3; }
  }
  let realized = null;
  if (pts.length >= 6) {
    const r = [];
    for (let i = 1; i < pts.length; i++) {
      const dt = (pts[i][0] - pts[i - 1][0]) / YEAR;
      if (dt > 0) r.push(Math.log(pts[i][1] / pts[i - 1][1]) / Math.sqrt(dt));
    }
    if (r.length >= 5) realized = Math.sqrt(r.reduce((s, x) => s + x * x, 0) / r.length);
  }
  let iv = realized == null ? base : 0.5 * base + 0.5 * clamp(realized, 0.1, 2);
  if (a.injury) iv += 0.15;
  if (a.live || a.liveBoost) iv += 0.2;
  return clamp(iv, 0.15, 1.5);
}

export function optionMid(state, pos, now = Date.now()) {
  const a = state.assets[pos.under];
  if (!a) return 0;
  return bsPrice(pos.type, a.price, pos.strike, (pos.exp - now) / YEAR, impliedVol(a, now));
}

export function optionsValue(state, now = Date.now()) {
  let v = 0;
  for (const pos of Object.values(state.options || {})) v += optionMid(state, pos, now) * CONTRACT * pos.qty;
  return v;
}
