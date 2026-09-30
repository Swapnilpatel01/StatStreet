// Small shared helpers. No DOM access here so the engine can be tested in Node.

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

export function num(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

// "7-15" or "7/15" -> [7, 15]
export function pair(v) {
  const parts = String(v ?? '').split(/[-\/]/);
  return [num(parts[0]), num(parts[1])];
}

// Baseball innings "6.1" means 6 and 1/3.
export function innings(v) {
  const x = num(v);
  const whole = Math.trunc(x);
  const frac = Math.round((x - whole) * 10);
  if (frac === 1) return whole + 1 / 3;
  if (frac === 2) return whole + 2 / 3;
  return x;
}

export function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function mean(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}

export function std(a, mu = mean(a)) {
  if (a.length < 2) return 0;
  return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1));
}

export function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const decay = (value, ageMs, halfLifeMs) => value * Math.pow(0.5, Math.max(0, ageMs) / halfLifeMs);

// Date string YYYYMMDD in US Eastern time, which is how ESPN groups games by day.
export function etDate(ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(ts));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}${get('month')}${get('day')}`;
}

export function etDays(fromTs, toTs) {
  const out = [];
  const seen = new Set();
  for (let t = fromTs; t <= toTs + 12 * HOUR; t += 12 * HOUR) {
    const d = etDate(Math.min(t, toTs));
    if (!seen.has(d)) { seen.add(d); out.push(d); }
  }
  return out;
}

// Run async jobs with limited concurrency.
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = { error: e }; }
    }
  });
  await Promise.all(workers);
  return results;
}

export function tickerFrom(name) {
  const parts = String(name).replace(/\b(Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim().split(/\s+/);
  const last = parts[parts.length - 1] || name;
  return last.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 7) || 'PLYR';
}

export const fmtMoney = (v, digits = 2) =>
  (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtPct = (v, digits = 2) => (v >= 0 ? '+' : '') + (v * 100).toFixed(digits) + '%';

export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
