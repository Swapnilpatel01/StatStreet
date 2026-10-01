// Seasons, weekly goals and the shop: the reasons to keep playing.
// - Seasons last about 4 weeks. Your return decides your tier (Bronze → Legend), which pays
//   coins and XP. Then everyone starts fresh, with a bigger bankroll the higher your level.
// - Three weekly goals pay coins and XP the moment you hit them.
// - Coins buy card packs (duplicates level cards up, which boosts their dividends),
//   app themes and titles.

import { DAY, weekStart, weekId, addDays, seeded } from './util.js';
import { netWorth, priceAt, notify, cardLevel } from './engine.js';
import { career, addXP, addCoins, spendCoins, level, hasLevel } from './xp.js';
import { leaderboard, rarity, RARITY, TROPHIES } from './social.js';
import { runContests } from './contests.js';
import { runMarket, migrateBoosters } from './boosters.js';

const round2 = (x) => Math.round(x * 100) / 100;

// ---------- seasons ----------

export const TIERS = [
  { key: 'bronze', name: 'Bronze', min: -Infinity, coins: 40, xp: 50, color: '#c98b5b' },
  { key: 'silver', name: 'Silver', min: 0, coins: 100, xp: 100, color: '#c0c7d1' },
  { key: 'gold', name: 'Gold', min: 0.10, coins: 200, xp: 200, color: '#ffc83d' },
  { key: 'platinum', name: 'Platinum', min: 0.25, coins: 350, xp: 300, color: '#5fe3d0' },
  { key: 'diamond', name: 'Diamond', min: 0.5, coins: 600, xp: 500, color: '#6fb6ff' },
  { key: 'legend', name: 'Legend', min: 1.0, coins: 1000, xp: 800, color: '#ff6bd6' },
];
export const tierFor = (ret) => [...TIERS].reverse().find((t) => ret >= t.min) || TIERS[0];
export const nextTier = (ret) => TIERS.find((t) => t.min > ret) || null;

// Seasons end on a Monday at midnight, 3–4 weeks after they start.
function seasonEnd(now) {
  let end = addDays(weekStart(now), 28);
  if (end - now < 21 * DAY) end = addDays(end, 7);
  return end;
}

// Next season's bankroll: your chosen starting balance, +5% per career level above 1.
export const seasonBalance = (state) => round2((state.settings?.startCash || 100) * (1 + 0.05 * (level(state) - 1)));

export function ensureSeason(state, now = Date.now()) {
  if (!state.season) {
    // The first season starts from wherever your portfolio is today.
    state.season = { n: 1, start: now, end: seasonEnd(now), nw0: round2(netWorth(state, now)), bal: state.startCash };
    state.startedAt = now;
  }
  return state.season;
}

export const seasonReturn = (state, now = Date.now()) => netWorth(state, now) / (state.season?.nw0 || state.startCash) - 1;

export function endSeason(state, now = Date.now()) {
  const s = state.season;
  runContests(state, Math.max(now, s.end)); // finish the week's contests first
  const ret = seasonReturn(state, now);
  const tier = tierFor(ret);
  const board = leaderboard(state, s.end);
  const rank = board.findIndex((r) => r.you) + 1;
  const beatAll = rank === 1;
  const c = career(state);
  const coins = tier.coins + (beatAll ? 100 : 0);
  addCoins(state, coins);
  addXP(state, tier.xp + (beatAll ? 100 : 0), now);
  const best = Object.entries(state.holdings).map(([id, h]) => ({ a: state.assets[id], h }))
    .filter((x) => x.a && x.h.cost > 0).sort((x, y) => (y.a.price * y.h.qty / y.h.cost) - (x.a.price * x.h.qty / x.h.cost))[0];
  const rec = {
    n: s.n, start: s.start, end: s.end, ret: Math.round(ret * 10000) / 10000, tier: tier.key, rank, of: board.length,
    coins, nw: round2(netWorth(state, now)), best: best ? { name: best.a.name, ret: best.a.price * best.h.qty / best.h.cost - 1 } : null,
  };
  c.seasons.unshift(rec);
  c.recap = rec;
  notify(state, 'season', `Season ${s.n} over: ${tier.name} (${(ret >= 0 ? '+' : '') + (ret * 100).toFixed(1)}%) · +${coins} coins`, null, now);
  // Fresh start for the new season.
  const bal = seasonBalance(state);
  Object.assign(state, { cash: bal, startCash: bal, holdings: {}, options: {}, orders: [], recurring: [], nw: [], startedAt: now });
  state.season = { n: s.n + 1, start: now, end: seasonEnd(now), nw0: bal, bal };
  state.week = null; // new week goals measured from the new bankroll
  return rec;
}

// ---------- weekly goals ----------

const wkRet = (s, w, now) => netWorth(s, now) / (w.nw0 || 1) - 1;
export const GOALS = [
  { key: 'ret3', text: 'Grow your portfolio 3% this week', coins: 60, xp: 60, check: (s, w, now) => wkRet(s, w, now) >= 0.03 },
  { key: 'beat', text: 'Beat Index Ian this week', coins: 50, xp: 50, check: (s, w, now) => {
    const f = s.assets['fund:SS500'];
    if (!f || now - w.start < DAY) return false;
    return wkRet(s, w, now) > f.price / priceAt(f, w.start) - 1 + 0.005;
  } },
  { key: 'picks3', text: 'Win 3 Pick\'em picks', coins: 40, xp: 50, check: (s, w) => Object.values(s.picks || {}).filter((p) => p.result === 'won' && (p.settled || 0) >= w.start).length >= 3 },
  { key: 'divs3', text: 'Collect 3 dividends', coins: 30, xp: 30, check: (s, w) => (s.divs || []).filter((d) => d.t >= w.start).length >= 3 },
  { key: 'contest', text: 'Enter a contest', coins: 30, xp: 30, check: (s, w) => Object.values(s.contests || {}).some((c) => c.entered >= w.start) },
  { key: 'prop', text: 'Hit a prop bet', coins: 40, xp: 40, check: (s, w) => (s.props || []).some((b) => b.status === 'won' && (b.settled || 0) >= w.start) },
  { key: 'leagues2', text: 'Own players or teams from 2 leagues', coins: 25, xp: 25, check: (s) => new Set(Object.keys(s.holdings).map((id) => s.assets[id]).filter((a) => a && a.kind !== 'fund').map((a) => a.league)).size >= 2 },
  { key: 'trades5', text: 'Make 5 trades', coins: 25, xp: 25, check: (s, w) => (s.txns || []).filter((t) => t.t >= w.start).length >= 5 },
  { key: 'pack', text: 'Open a card pack', coins: 20, xp: 30, check: (s, w) => (career(s).lastPack || 0) >= w.start },
];

export function ensureWeek(state, now = Date.now()) {
  const id = weekId(now);
  if (state.week?.id === id) return state.week;
  const rnd = seeded(`goals:${id}`);
  const pool = [...GOALS];
  const keys = [];
  // One money goal, two others.
  keys.push(rnd() < 0.5 ? 'ret3' : 'beat');
  const rest = pool.filter((g) => !['ret3', 'beat'].includes(g.key));
  while (keys.length < 3) {
    const g = rest.splice(Math.floor(rnd() * rest.length), 1)[0];
    keys.push(g.key);
  }
  state.week = { id, start: Math.max(weekStart(now), state.season?.start || 0), nw0: round2(netWorth(state, now)), goals: keys.map((k) => ({ key: k, done: false })) };
  return state.week;
}

function checkGoals(state, now) {
  const w = state.week;
  for (const g of w.goals) {
    if (g.done) continue;
    const def = GOALS.find((x) => x.key === g.key);
    let ok = false;
    try { ok = def.check(state, w, now); } catch { ok = false; }
    if (ok) {
      g.done = now;
      addCoins(state, def.coins); addXP(state, def.xp, now);
      notify(state, 'goal', `Weekly goal done: ${def.text} · +${def.coins} coins`, null, now);
    }
  }
}

// ---------- XP from what you did since the last check ----------

const dayKey = (t) => new Date(t).toLocaleDateString('en-CA');
function scanActivity(state, now) {
  const c = career(state);
  const since = c.cursor;
  for (const t of state.txns || []) {
    if (t.t <= since || t.t > now) continue;
    const d = dayKey(t.t);
    if (c.tradeXP.day !== d) c.tradeXP = { day: d, n: 0 };
    if (c.tradeXP.n < 12) { c.tradeXP.n++; addXP(state, 5, now); } // up to 12 trades a day earn XP
  }
  for (const p of Object.values(state.picks || {})) {
    if (!p.settled || p.settled <= since) continue;
    if (p.result === 'won') addXP(state, 15, now); else if (p.result === 'lost') addXP(state, 5, now);
  }
  for (const [id, t] of Object.entries(state.trophies || {})) {
    if (t <= since) continue;
    addXP(state, 50, now); addCoins(state, 25); // trophy notices already say "+25 coins" in the Season tab
  }
  c.cursor = now;
}

// Called on every tick.
export function runCareer(state, now = Date.now()) {
  career(state);
  ensureSeason(state, now);
  runContests(state, now);
  if (!state.cardsV) { migrateBoosters(state, now); state.cardsV = 2; }
  runMarket(state, now);
  if (now >= state.season.end) endSeason(state, now);
  ensureWeek(state, now);
  scanActivity(state, now);
  checkGoals(state, now);
}

// ---------- shop ----------

export const PACKS = [
  { key: 'starter', name: 'Starter Pack', cost: 100, level: 1, cards: 3, guarantee: null, blurb: '3 cards' },
  { key: 'rare', name: 'Rare Pack', cost: 250, level: 3, cards: 4, guarantee: 'rare', blurb: '4 cards · 1 Rare or better' },
  { key: 'elite', name: 'Elite Pack', cost: 500, level: 5, cards: 5, guarantee: 'epic', blurb: '5 cards · 1 Epic or better' },
  { key: 'legend', name: 'Legend Pack', cost: 1200, level: 8, cards: 5, guarantee: 'legendary', blurb: '5 cards · 1 Legendary' },
];
// Chance of each rarity per card, best first.
const ODDS = [['legendary', 0.006], ['epic', 0.03], ['rare', 0.1], ['uncommon', 0.29], ['common', 1]];
const RANK = Object.fromEntries(RARITY.map((r, i) => [r.key, i])); // legendary 0 … common 4

export function openPack(state, key, now = Date.now(), rnd = Math.random) {
  const pack = PACKS.find((p) => p.key === key);
  if (!pack) throw new Error('Unknown pack');
  if (!hasLevel(state, pack.level)) throw new Error(`${pack.name} unlocks at level ${pack.level}`);
  const leagues = Object.keys(state.settings?.leagues || {}).filter((l) => state.settings.leagues[l]);
  const buckets = {};
  for (const a of Object.values(state.assets)) {
    if (a.kind === 'fund' || !a.hist?.length || !leagues.includes(a.league)) continue;
    const r = rarity(state, a, now);
    if (r) (buckets[r.key] ||= []).push(a);
  }
  if (!Object.keys(buckets).length) throw new Error('The market is still loading');
  spendCoins(state, pack.cost);
  const c = career(state);
  c.packs++; c.lastPack = now;
  const out = [];
  for (let i = 0; i < pack.cards; i++) {
    const roll = rnd();
    let r = ODDS.find(([, p]) => roll < p)[0];
    if (i === pack.cards - 1 && pack.guarantee && RANK[r] > RANK[pack.guarantee]) r = pack.guarantee;
    // Fall back to the nearest rarity that has cards.
    let k = RANK[r];
    while (!buckets[RARITY[k]?.key]?.length && k < RARITY.length - 1) k++;
    while (!buckets[RARITY[k]?.key]?.length && k > 0) k--;
    const list = buckets[RARITY[k].key];
    const a = list[Math.floor(rnd() * list.length)];
    const isNew = !state.collection[a.id];
    const col = (state.collection[a.id] ||= { first: now, peak: 0 });
    col.pulls = (col.pulls || 0) + 1;
    out.push({ id: a.id, rarity: RARITY[k], isNew, level: cardLevel(state, a.id) });
  }
  addXP(state, 10, now);
  return out.sort((x, y) => RANK[y.rarity.key] - RANK[x.rarity.key]); // best card revealed last
}

export const THEMES = [
  { key: 'classic', name: 'Classic', cost: 0, level: 1, accent: '#1fd67a', bg: null },
  { key: 'ice', name: 'Ice', cost: 150, level: 3, accent: '#4cc9ff', bg: '#090d12' },
  { key: 'court', name: 'Court', cost: 200, level: 5, accent: '#ff8a3d', bg: '#100b08' },
  { key: 'midnight', name: 'Midnight', cost: 300, level: 7, accent: '#9d8cff', bg: '#0a0b1a' },
  { key: 'gold', name: 'Gold Rush', cost: 500, level: 9, accent: '#ffc83d', bg: '#0f0c05' },
];
export const TITLES = [
  { key: 'Rookie', cost: 0, level: 1 },
  { key: 'Sixth Man', cost: 100, level: 2 },
  { key: 'Sharpshooter', cost: 200, level: 3 },
  { key: 'Franchise Player', cost: 400, level: 5 },
  { key: 'All-Star', cost: 600, level: 6 },
  { key: 'Hall of Famer', cost: 1000, level: 8 },
  { key: 'Mogul', cost: 1500, level: 10 },
  { key: 'GOAT', cost: 3000, level: 15 },
];

export function buyItem(state, kind, key) {
  const list = kind === 'theme' ? THEMES : TITLES;
  const item = list.find((x) => x.key === key);
  if (!item) throw new Error('Unknown item');
  const c = career(state);
  const owned = kind === 'theme' ? c.owned.themes : c.owned.titles;
  if (owned.includes(key)) throw new Error('Already yours');
  if (!hasLevel(state, item.level)) throw new Error(`Unlocks at level ${item.level}`);
  spendCoins(state, item.cost);
  owned.push(key);
  if (kind === 'theme') c.theme = key; else c.title = key;
}

export function equipItem(state, kind, key) {
  const c = career(state);
  const owned = kind === 'theme' ? c.owned.themes : c.owned.titles;
  if (!owned.includes(key)) throw new Error('Buy it first');
  if (kind === 'theme') c.theme = key; else c.title = key;
}

export const themeOf = (state) => THEMES.find((t) => t.key === career(state).theme) || THEMES[0];
