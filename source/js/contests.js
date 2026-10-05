// Daily salary-cap contests and over/under player props, both settled from real box scores.
// Contests: draft 5 players of one league under a salary cap, pay an entry fee from your
// bankroll, and score their real game scores in that day's games against 5 bots. Paid out the next day.
// Props: bet over/under on a real stat line (points, yards, strikeouts…), alone or as a parlay.

import { DAY, HOUR, seeded } from './util.js';
import { gameHooks, notify, change, netWorth, minOrder } from './engine.js';
import { LEAGUES, gameScore, posGroup } from './scoring.js';
import { addXP, addCoins, hasLevel } from './xp.js';

const round2 = (x) => Math.round(x * 100) / 100;

// ---------- contests ----------

export const CONTEST_TIERS = [
  { key: 'rookie', name: 'Rookie', fee: 0.05, level: 1 },
  { key: 'pro', name: 'Pro', fee: 0.15, level: 2 },
  { key: 'high', name: 'High Roller', fee: 0.4, level: 6 },
];
export const PAYOUT = [3, 1.8, 1, 0, 0, 0]; // multiples of the entry fee by finishing place
export const LINEUP = 5;
export const BOTS = [
  { name: 'Index Ian', style: 'chalk', blurb: 'Best form, whatever the cost' },
  { name: 'Momentum Mo', style: 'hot', blurb: 'Hottest prices this week' },
  { name: 'MVP Max', style: 'stars', blurb: 'Stars and scrubs' },
  { name: 'Value Val', style: 'value', blurb: 'Most points per dollar' },
  { name: 'Lucky Lou', style: 'random', blurb: 'Picks out of a hat' },
];

const seasonBal = (state) => state.season?.bal || state.startCash || 100;
export const entryFee = (state, tier) => Math.max(0.05, round2(seasonBal(state) * tier.fee));
export const salary = (a) => Math.max(1, Math.round(a.price));

// A contest covers one day's games in one league (a "slate"): the next local day that still
// has a game to start. A day with one game is a slate of that one game.
const dayStartOf = (t) => new Date(t).setHours(0, 0, 0, 0);
const dayKeyOf = (t) => new Date(t).toLocaleDateString('en-CA');
export function nextSlate(state, league, now = Date.now()) {
  const games = (state.schedule?.[league] || []).filter((g) => g.date > now + 60e3).sort((x, y) => x.date - y.date);
  if (!games.length) return null;
  const day = dayStartOf(games[0].date);
  const list = games.filter((g) => dayStartOf(g.date) === day);
  return { day, key: dayKeyOf(day), games: list, first: list[0].date, last: list[list.length - 1].date, teams: new Set(list.flatMap((g) => g.teams.map((t) => t.id))) };
}

// Draftable players: on a team in the slate's games that haven't started, healthy-ish, with a
// performance history, most valuable first.
export function draftPool(state, league, now = Date.now()) {
  const slate = nextSlate(state, league, now);
  if (!slate) return [];
  return Object.values(state.assets)
    .filter((a) => a.kind === 'player' && a.league === league && slate.teams.has(a.teamId) && a.price > 0 && a.perf?.ema != null && !(a.injury && a.injury.factor < 0.9))
    .sort((x, y) => y.price - x.price)
    .slice(0, 160);
}

// The cap fits about one star, a couple of good starters and some value picks.
export function salaryCap(state, league, now = Date.now()) {
  const p = draftPool(state, league, now);
  if (p.length < LINEUP + 1) return 0;
  // ranks scale with the size of the pool: a one-game slate has far fewer players than a full day
  const cap = [0.02, 0.1, 0.27, 0.55, 0.9].map((f) => salary(p[Math.min(Math.round(f * (p.length - 1)), p.length - 1)])).reduce((s, x) => s + x, 0) * 1.05;
  const cheapest = p.map(salary).sort((x, y) => x - y).slice(0, LINEUP).reduce((s, x) => s + x, 0);
  return Math.round(Math.max(cap, cheapest * 1.15)); // always room for a real choice
}

export const contestId = (slateKey, league, tier) => `${slateKey}:${league}:${tier}`;

export function availableContests(state, now = Date.now(), leagues = Object.keys(LEAGUES)) {
  const out = [];
  for (const lg of leagues) {
    const slate = nextSlate(state, lg, now);
    const cap = slate ? salaryCap(state, lg, now) : 0;
    if (!cap) continue;
    for (const tier of CONTEST_TIERS) {
      const id = contestId(slate.key, lg, tier.key);
      out.push({ league: lg, tier, fee: entryFee(state, tier), cap, id, slate, entered: state.contests?.[id], locked: !hasLevel(state, tier.level) });
    }
  }
  return out;
}

// Greedy draft that always leaves room under the cap for the remaining slots.
function draft(pool, cap, score, exclude = new Set()) {
  const cands = pool.filter((a) => !exclude.has(a.id));
  const bySal = [...cands].sort((x, y) => salary(x) - salary(y));
  const picks = []; let left = cap;
  for (const c of [...cands].sort((x, y) => score(y) - score(x))) {
    if (picks.length >= LINEUP) break;
    const need = LINEUP - picks.length - 1;
    const cheapest = bySal.filter((x) => x !== c && !picks.includes(x)).slice(0, need).reduce((s, x) => s + salary(x), 0);
    if (salary(c) + cheapest <= left) { picks.push(c); left -= salary(c); }
  }
  return picks.map((a) => a.id);
}

function botLineups(state, league, cap, now, seed) {
  const pool = draftPool(state, league, now);
  const rnd = seeded(seed);
  const rand = new Map(pool.map((a) => [a.id, rnd()]));
  const scorer = {
    chalk: (a) => a.perf.ema,
    hot: (a) => change(a, now, 7 * DAY),
    stars: (a) => a.price,
    value: (a) => a.perf.ema / salary(a),
    random: (a) => rand.get(a.id),
  };
  return BOTS.map((b) => ({ name: b.name, style: b.style, lineup: draft(pool, cap, scorer[b.style]), pts: 0 }));
}

// Fill the open slots of a lineup with the best-form players that still fit under the cap.
export function autoLineup(state, league, picks = [], now = Date.now()) {
  const pool = draftPool(state, league, now);
  const cap = salaryCap(state, league, now);
  const kept = picks.filter((id) => pool.some((a) => a.id === id)).slice(0, LINEUP);
  const used = kept.reduce((s, id) => s + salary(state.assets[id]), 0);
  const rest = pool.filter((a) => !kept.includes(a.id));
  const bySal = [...rest].sort((x, y) => salary(x) - salary(y));
  const out = [...kept]; let left = cap - used;
  // value first (form per dollar), then spend what is left on the best player that fits
  const score = (a) => a.perf.ema * (0.55 + 0.45 * Math.min(1, a.perf.ema / Math.max(1, salary(a)) / 0.6));
  for (const c of [...rest].sort((x, y) => score(y) - score(x))) {
    if (out.length >= LINEUP) break;
    const need = LINEUP - out.length - 1;
    const cheapest = bySal.filter((x) => x !== c && !out.includes(x.id)).slice(0, need).reduce((s, x) => s + salary(x), 0);
    if (salary(c) + cheapest <= left) { out.push(c.id); left -= salary(c); }
  }
  // upgrade pass: swap in a better player wherever the leftover cap allows
  for (let i = kept.length; i < out.length; i++) {
    const cur = state.assets[out[i]];
    const better = rest.filter((a) => !out.includes(a.id) && a.perf.ema > cur.perf.ema && salary(a) - salary(cur) <= left).sort((x, y) => y.perf.ema - x.perf.ema)[0];
    if (better) { left -= salary(better) - salary(cur); out[i] = better.id; }
  }
  return out;
}
// Standings with games still in progress counted at their score so far.
export function liveStandings(state, c) {
  const livePts = (id) => { const a = state.assets[id]; return a?.live?.line && (!c.gameIds || c.gameIds.includes(a.live.e)) && !c.games[a.live.e] ? Math.round(gameScore(c.league, { ...a.live.line }) * 10) / 10 : 0; };
  const sum = (ids) => ids.reduce((s, id) => s + livePts(id), 0);
  const rows = [{ name: 'You', you: true, pts: round2(c.pts + sum(c.lineup)) }, ...c.bots.map((b) => ({ name: b.name, style: b.style, pts: round2(b.pts + sum(b.lineup)) }))];
  return { rows: rows.sort((x, y) => y.pts - x.pts || (y.you ? 1 : 0) - (x.you ? 1 : 0)), livePts, any: [...c.lineup, ...c.bots.flatMap((b) => b.lineup)].some((id) => livePts(id) !== 0 || state.assets[id]?.live?.e && (!c.gameIds || c.gameIds.includes(state.assets[id].live.e))) };
}
export function enterContest(state, { league, tier: tierKey, lineup }, now = Date.now()) {
  const tier = CONTEST_TIERS.find((t) => t.key === tierKey);
  if (!tier) throw new Error('Unknown contest');
  if (!hasLevel(state, tier.level)) throw new Error(`${tier.name} contests unlock at level ${tier.level}`);
  const slate = nextSlate(state, league, now);
  if (!slate) throw new Error('No games coming up — contests open on game days');
  const id = contestId(slate.key, league, tierKey);
  state.contests ||= {};
  if (state.contests[id]) throw new Error('You already entered this contest');
  const ids = [...new Set(lineup)];
  if (ids.length !== LINEUP) throw new Error(`Pick ${LINEUP} different players`);
  const pool = new Map(draftPool(state, league, now).map((a) => [a.id, a]));
  if (!ids.every((x) => pool.has(x))) throw new Error('One of those players can\'t be drafted right now');
  const cap = salaryCap(state, league, now);
  const total = ids.reduce((s, x) => s + salary(pool.get(x)), 0);
  if (total > cap) throw new Error(`Over the cap by $${total - cap}`);
  const fee = entryFee(state, tier);
  if (state.cash < fee) throw new Error(`Entry is $${fee.toFixed(2)} — you have $${state.cash.toFixed(2)} cash`);
  state.cash = round2(state.cash - fee);
  // It covers that day's games that hadn't started when you entered, and pays out the next day.
  state.contests[id] = {
    id, league, tier: tierKey, fee, cap, entered: now, start: now, day: slate.day, end: slate.day + DAY, first: slate.first, last: slate.last,
    gameIds: slate.games.map((g) => g.id),
    lineup: ids, pts: 0, ppts: Object.fromEntries(ids.map((x) => [x, 0])), bots: botLineups(state, league, cap, now, id), games: {}, done: false,
  };
  addXP(state, 20, now);
  return state.contests[id];
}

export function standings(c) {
  const rows = [{ name: 'You', you: true, pts: c.pts }, ...c.bots.map((b) => ({ name: b.name, pts: b.pts, style: b.style }))];
  // Ties go to you.
  return rows.sort((x, y) => y.pts - x.pts || (y.you ? 1 : 0) - (x.you ? 1 : 0));
}

function scoreContests(state, league, game) {
  for (const c of Object.values(state.contests || {})) {
    if (c.done || c.league !== league || c.games[game.id]) continue;
    if (c.gameIds ? !c.gameIds.includes(game.id) : (game.date < c.start || game.date >= c.end)) continue;
    c.games[game.id] = 1;
    for (const p of game.players || []) {
      const id = `${league}:p:${p.id}`;
      const gs = Math.round(gameScore(league, p.line) * 10) / 10;
      if (c.lineup.includes(id)) { c.pts = round2(c.pts + gs); c.ppts[id] = round2((c.ppts[id] || 0) + gs); }
      for (const b of c.bots) if (b.lineup.includes(id)) b.pts = round2(b.pts + gs);
    }
  }
}

function settleContests(state, now) {
  for (const c of Object.values(state.contests || {})) {
    if (c.done || now < c.end) continue; // never before the next day
    // Late games can finish after midnight: wait for every game, up to six hours into the next day.
    if (c.gameIds && c.gameIds.some((g) => !c.games[g]) && now < c.end + 6 * HOUR) continue;
    const rows = standings(c);
    const place = rows.findIndex((r) => r.you) + 1;
    const payout = round2(c.fee * PAYOUT[place - 1]);
    c.done = true; c.place = place; c.payout = payout; c.settled = now;
    state.cash = round2(state.cash + payout);
    addXP(state, 10 + [40, 25, 15, 5, 0, 0][place - 1], now);
    if (place === 1) addCoins(state, 50);
    const tier = CONTEST_TIERS.find((t) => t.key === c.tier)?.name || '';
    notify(state, 'contest', `${LEAGUES[c.league].name} ${tier} contest: you finished ${ordinal(place)} of 6${payout ? ` · won $${payout.toFixed(2)}` : ''}${place === 1 ? ' · +$0.50 bonus' : ''}`, null, now);
  }
  // Keep about five weeks of history.
  for (const [id, c] of Object.entries(state.contests || {})) if (c.done && now - c.end > 35 * DAY) delete state.contests[id];
}

export const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th'}`;

// ---------- props ----------

export const PROP_ODDS = 1.9; // per leg; a correct pick nearly doubles your stake
export const MAX_LEGS = (state) => (hasLevel(state, 4) ? 6 : 4); // picks in one bet

export function propStat(a) {
  if (a.kind !== 'player') return null;
  if (a.league === 'nba') return { label: 'Points', short: 'PTS', of: (l) => l.pts, min: 8 };
  if (a.league === 'nfl') {
    const g = posGroup('nfl', a.pos);
    if (g === 'QB') return { label: 'Passing yards', short: 'PASS YDS', of: (l) => l.passYds, min: 120 };
    if (g === 'RB') return { label: 'Rushing yards', short: 'RUSH YDS', of: (l) => l.rushYds, min: 30 };
    if (g === 'WR') return { label: 'Receiving yards', short: 'REC YDS', of: (l) => l.recYds, min: 30 };
    return null;
  }
  if (posGroup('mlb', a.pos) === 'P') return String(a.pos).toUpperCase() === 'SP' ? { label: 'Strikeouts', short: 'K', of: (l) => l.pk, min: 3 } : null;
  return { label: 'Hits + Runs + RBIs', short: 'H+R+RBI', of: (l) => l.h + l.r + l.rbi, min: 1 };
}

export function propLine(a) {
  const st = propStat(a);
  const avg = a.perf?.avg;
  if (!st || !avg) return null;
  const m = st.of(avg);
  if (!(m >= st.min)) return null;
  return Math.floor(m) + 0.5; // half-point lines: no ties
}

// Has he actually been playing? No game in a while (or none logged) means he may well sit.
export function playsLately(a, now = Date.now()) {
  const t = a.perf?.last?.[0]?.t;
  if (!t) return true; // nothing logged yet (start of a season): no evidence either way
  return now - t < (a.league === 'nfl' ? 16 : a.league === 'mlb' ? 5 : 8) * DAY;
}
// A line for a game in progress: what he has so far plus his average over what's left.
export function liveLine(a, g) {
  const st = propStat(a);
  const base = propLine(a);
  if (!st || base == null || !a.live?.line || a.live.e == null) return null;
  if (st.short === 'K') return null; // a starter who has left the game would be a free "under"
  const frac = g.frac ?? 1;
  if (frac >= LIVE_CLOSE) return null;
  const cur = st.of(a.live.line);
  return { line: Math.floor(cur + st.of(a.perf.avg) * (1 - frac)) + 0.5, cur };
}
const LIVE_CLOSE = 0.8;      // live lines close for the final stretch
export const PROP_WINDOW = 48 * HOUR;

// Props for games in progress and games in the next two days: the most valuable players in each.
export function propBoard(state, now = Date.now(), leagues = Object.keys(LEAGUES), { perGame = 6 } = {}) {
  const byTeam = new Map();
  for (const a of Object.values(state.assets)) {
    if (a.kind !== 'player' || !leagues.includes(a.league) || (a.injury && a.injury.factor < 0.9)) continue;
    const k = `${a.league}:${a.teamId}`;
    if (!byTeam.has(k)) byTeam.set(k, []);
    byTeam.get(k).push(a);
  }
  const out = [];
  const add = (lg, g, rows) => out.push(...rows.sort((x, y) => y.price - x.price).slice(0, perGame));
  for (const [id, g] of Object.entries(state.liveGames || {})) {
    if (!leagues.includes(g.league) || now - g.t > 5 * 60e3) continue; // stale scores: no live lines
    const rows = [];
    for (const t of g.teams) for (const a of byTeam.get(`${g.league}:${t.id}`) || []) {
      if (a.live?.e !== id) continue;
      const ll = liveLine(a, g);
      if (!ll) continue;
      const st = propStat(a);
      rows.push({ key: `${id}:${a.id}`, gameId: id, game: g.name, league: g.league, date: g.t, live: true, cur: ll.cur, assetId: a.id, label: st.label, short: st.short, line: ll.line, price: a.price });
    }
    add(g.league, g, rows);
  }
  for (const lg of leagues) {
    for (const g of state.schedule?.[lg] || []) {
      if (g.date <= now || g.date > now + PROP_WINDOW || state.liveGames?.[g.id]) continue;
      const rows = [];
      for (const t of g.teams) for (const a of byTeam.get(`${lg}:${t.id}`) || []) {
        const line = propLine(a);
        if (line == null) continue;
        const st = propStat(a);
        if (st.short === 'K' && g.probables && !g.probables.includes(String(a.rid))) continue; // not tonight's starter
        if (!playsLately(a, now)) continue;
        rows.push({ key: `${g.id}:${a.id}`, gameId: g.id, game: g.name, league: lg, date: g.date, assetId: a.id, label: st.label, short: st.short, line, price: a.price });
      }
      add(lg, g, rows);
    }
  }
  return out;
}

export function placeBet(state, legs, stake, now = Date.now()) {
  stake = round2(Number(stake));
  if (!legs.length) throw new Error('Add a pick to your slip');
  if (legs.length > MAX_LEGS(state)) throw new Error(`Up to ${MAX_LEGS(state)} picks in one bet`);
  if (new Set(legs.map((l) => l.assetId)).size !== legs.length) throw new Error('One pick per player');
  if (legs.some((l) => !l.live && l.date <= now)) throw new Error('A game on your slip has started — remove it');
  // Live lines move with the game: a bet is only taken at the line showing right now.
  if (legs.some((l) => l.live)) {
    const board = propBoard(state, now, [...new Set(legs.map((l) => l.league))], { perGame: 99 });
    let moved = false;
    for (const l of legs) {
      if (!l.live) continue;
      const cur = board.find((p) => p.key === l.key && p.live);
      if (!cur) throw new Error('A live line on your slip has closed — remove it');
      if (cur.line !== l.line) { l.line = cur.line; l.cur = cur.cur; moved = true; }
    }
    if (moved) throw new Error('A live line moved — check your slip and place again');
  }
  const min = minOrder(state);
  if (!(stake >= min)) throw new Error(`Minimum stake is $${min.toFixed(2)}`);
  if (stake > state.cash) throw new Error(`You have $${state.cash.toFixed(2)} cash`);
  const max = Math.max(min, round2(netWorth(state, now) * 0.25));
  if (stake > max) throw new Error(`Max stake is $${max.toFixed(2)} (a quarter of your net worth)`);
  state.cash = round2(state.cash - stake);
  state.props ||= [];
  const bet = {
    id: `b${now.toString(36)}${Math.floor(Math.random() * 1e4)}`, t: now, stake, status: 'open',
    legs: legs.map((l) => ({ gameId: l.gameId, assetId: l.assetId, side: l.side, line: l.line, ...(l.live ? { live: true } : {}), label: l.label, short: l.short, date: l.date, result: null, actual: null })),
  };
  state.props.unshift(bet);
  addXP(state, 5, now);
  return bet;
}

export const betMultiple = (bet) => bet.legs.reduce((m, l) => m * (l.result === 'void' ? 1 : PROP_ODDS), 1);
export const potentialPayout = (stake, n) => round2(stake * PROP_ODDS ** n);

function resolveBet(state, bet, now) {
  if (bet.status !== 'open' || bet.legs.some((l) => !l.result)) return;
  const lost = bet.legs.some((l) => l.result === 'loss');
  const allVoid = bet.legs.every((l) => l.result === 'void');
  bet.settled = now;
  const name = (l) => state.assets[l.assetId]?.ticker || 'Player';
  if (lost) { bet.status = 'lost'; bet.payout = 0; notify(state, 'prop', `Prop lost: ${bet.legs.map((l) => `${name(l)} ${l.side} ${l.line}`).join(' + ')}`, null, now); return; }
  if (allVoid) { bet.status = 'void'; bet.payout = bet.stake; state.cash = round2(state.cash + bet.stake); notify(state, 'prop', 'Prop voided (player didn\'t play) — stake returned', null, now); return; }
  bet.status = 'won';
  bet.payout = round2(bet.stake * betMultiple(bet));
  state.cash = round2(state.cash + bet.payout);
  addXP(state, 10 + 5 * bet.legs.length, now);
  notify(state, 'prop', `Prop hit! ${bet.legs.map((l) => `${name(l)} ${l.actual} ${l.short}`).join(' + ')} · won $${bet.payout.toFixed(2)}`, null, now);
}

function settleProps(state, league, game, at) {
  for (const bet of state.props || []) {
    if (bet.status !== 'open') continue;
    for (const leg of bet.legs) {
      if (leg.result || leg.gameId !== game.id) continue;
      const a = state.assets[leg.assetId];
      const row = (game.players || []).find((p) => a && String(p.id) === String(a.rid));
      if (!row || !a) { leg.result = 'void'; continue; }
      const st = propStat(a);
      leg.actual = st ? Math.round(st.of(row.line) * 10) / 10 : null;
      if (leg.actual == null) { leg.result = 'void'; continue; }
      leg.result = (leg.side === 'over' ? leg.actual > leg.line : leg.actual < leg.line) ? 'win' : 'loss';
    }
    resolveBet(state, bet, at);
  }
}

// Called every few seconds: settle finished weeks, void props whose game never reported.
export function runContests(state, now = Date.now()) {
  settleContests(state, now);
  for (const bet of state.props || []) {
    if (bet.status !== 'open') continue;
    for (const leg of bet.legs) if (!leg.result && now - leg.date > 2 * DAY) leg.result = 'void';
    resolveBet(state, bet, now);
  }
  if (state.props?.length > 60) state.props = state.props.filter((b, i) => i < 60 || b.status === 'open');
}

gameHooks.push((state, league, game, at) => {
  scoreContests(state, league, game);
  settleProps(state, league, game, at);
});

