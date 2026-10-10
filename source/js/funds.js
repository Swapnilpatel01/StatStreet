// Index funds: baskets of players/teams that trade like a single stock.
// A fund holds a fixed number of shares of each constituent ("cons"); its
// price is the basket's value (NAV). Every week it rebalances to the current
// rules without changing its price.

import { DAY, HOUR } from './util.js';
import { change, fundNav, dividendYield } from './engine.js';
import { posGroup } from './scoring.js';

const pickTop = (list, n, key = (a) => a.price) => [...list].sort((x, y) => key(y) - key(x)).slice(0, n);

export const FUNDS = [
  {
    ticker: 'SS500', name: 'StatStreet 500', blurb: 'The 500 most valuable players and teams across all three leagues, weighted by price.',
    weight: 'price', pick: (all) => pickTop(all, 500),
  },
  {
    ticker: 'MVP10', name: 'MVP 10', blurb: 'The ten most valuable players in sports, equal weight.',
    weight: 'equal', pick: (all) => pickTop(all.filter((a) => a.kind === 'player'), 10),
  },
  {
    ticker: 'HOOP', name: 'NBA Stars', blurb: 'Top 30 NBA players, equal weight.', league: 'nba',
    weight: 'equal', pick: (all) => pickTop(all.filter((a) => a.league === 'nba' && a.kind === 'player'), 30),
  },
  {
    ticker: 'GRID', name: 'NFL Stars', blurb: 'Top 30 NFL players, equal weight.', league: 'nfl',
    weight: 'equal', pick: (all) => pickTop(all.filter((a) => a.league === 'nfl' && a.kind === 'player'), 30),
  },
  {
    ticker: 'DMND', name: 'MLB Stars', blurb: 'Top 30 MLB players, equal weight.', league: 'mlb',
    weight: 'equal', pick: (all) => pickTop(all.filter((a) => a.league === 'mlb' && a.kind === 'player'), 30),
  },
  {
    ticker: 'QBX', name: 'Quarterback Index', blurb: 'Top 16 NFL quarterbacks, equal weight.', league: 'nfl',
    weight: 'equal', pick: (all) => pickTop(all.filter((a) => a.league === 'nfl' && a.kind === 'player' && posGroup('nfl', a.pos) === 'QB'), 16),
  },
  {
    ticker: 'TEAMS', name: 'All Teams', blurb: 'Every NBA, NFL and MLB team, equal weight. Pays out on every win in all three leagues.',
    weight: 'equal', pick: (all) => all.filter((a) => a.kind === 'team'),
  },
  {
    ticker: 'MOMO', name: 'Hot Hand Momentum', blurb: 'The 20 players and teams with the best week, rebalanced every week.',
    weight: 'equal', pick: (all, now) => pickTop(all.filter((a) => a.hist.length > 4), 20, (a) => change(a, now, 7 * DAY)),
  },
];

function weights(def, picks, nav) {
  const cons = {};
  if (!picks.length) return cons;
  if (def.weight === 'price') {
    const sum = picks.reduce((s, a) => s + a.price, 0);
    for (const a of picks) cons[a.id] = nav / sum; // same share count of each = price-weighted
  } else {
    for (const a of picks) cons[a.id] = nav / picks.length / a.price;
  }
  return cons;
}

const eligible = (state, def) => Object.values(state.assets).filter((a) => a.kind !== 'fund' && a.price > 0 && a.hist.length
  && (!def.league || a.league === def.league));

// Create any missing funds and rebalance ones that are due. Safe to call often.
export function ensureFunds(state, now = Date.now()) {
  const made = [];
  for (const def of FUNDS) {
    const id = `fund:${def.ticker}`;
    const all = eligible(state, def);
    const minCount = { MVP10: 10, QBX: 6, TEAMS: 3, SS500: 20 }[def.ticker] ?? 10;
    let f = state.assets[id];
    if (!f) {
      const picks = def.pick(all, now);
      if (picks.length < minCount) continue;
      f = state.assets[id] = {
        id, kind: 'fund', league: 'fund', fundLeague: def.league || null, ticker: def.ticker, name: def.name, blurb: def.blurb,
        cons: weights(def, picks, 100), rebalanced: now, hist: [], events: [], shocks: [], price: 100, n: 0, imp: null,
      };
      backfillHistory(state, f, now);
      f.events.push({ t: now, kind: 'fund', text: `Fund launched with ${picks.length} holdings`, pct: 0 });
      made.push(f);
    } else if (now - (f.rebalanced || 0) > 7 * DAY) {
      const nav = fundNav(state, f);
      const picks = def.pick(all, now);
      if (picks.length >= minCount && nav > 0) {
        f.cons = weights(def, picks, nav);
        f.rebalanced = now;
        f.events.unshift({ t: now, kind: 'fund', text: `Weekly rebalance · ${picks.length} holdings`, pct: 0 });
        if (f.events.length > 25) f.events.length = 25;
      }
    }
    f.blurb = def.blurb; f.name = def.name;
  }
  return made;
}

// Give a new fund a real chart by valuing today's basket at past prices.
function backfillHistory(state, f, now) {
  const cons = Object.entries(f.cons).map(([id, sh]) => [state.assets[id], sh]).filter(([a]) => a);
  let first = now;
  for (const [a] of cons) if (a.hist.length) first = Math.min(first, a.hist[0]);
  first = Math.max(first, now - 30 * DAY);
  const step = now - first > 5 * DAY ? 2 * HOUR : 30 * 60e3;
  const times = [];
  for (let t = first; t < now; t += step) times.push(t);
  const vals = new Float64Array(times.length);
  for (const [a, sh] of cons) {
    // Walk each price history once with a pointer (fast even for 500 holdings).
    const h = a.hist; let j = 0;
    for (let k = 0; k < times.length; k++) {
      while (j + 2 < h.length && h[j + 2] <= times[k]) j += 2;
      vals[k] += (h.length ? h[j + 1] : a.price) * sh;
    }
  }
  const hist = [];
  times.forEach((t, k) => hist.push(t, Math.round(vals[k] * 100) / 100));
  const nav = fundNav(state, f);
  hist.push(now, Math.round(nav * 100) / 100);
  f.hist = hist;
  f.price = Math.round(nav * 100) / 100;
}

export function fundHoldings(state, f) {
  const nav = fundNav(state, f) || 1;
  return Object.entries(f.cons).map(([id, sh]) => {
    const a = state.assets[id];
    return a ? { a, sh, weight: (a.price * sh) / nav } : null;
  }).filter(Boolean).sort((x, y) => y.weight - x.weight);
}

