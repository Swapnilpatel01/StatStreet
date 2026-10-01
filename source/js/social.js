// Real-style game layer: player cards with rarity, Pick'em, daily streaks,
// trophies and a leaderboard against strategy bots. Pure state logic.

import { DAY, HOUR, clamp } from './util.js';
import { notify, priceAt, netWorth, pickStreakMult, teamWinProb } from './engine.js';

const round2 = (x) => Math.round(x * 100) / 100;

// ---------- cards ----------

export const RARITY = [
  { key: 'legendary', name: 'Legendary', top: 0.03, color: '#ffb800' },
  { key: 'epic', name: 'Epic', top: 0.1, color: '#b36bff' },
  { key: 'rare', name: 'Rare', top: 0.25, color: '#3b9dff' },
  { key: 'uncommon', name: 'Uncommon', top: 0.5, color: '#1fd67a' },
  { key: 'common', name: 'Common', top: 1, color: '#8b939e' },
];

let rankCache = { t: 0, map: new Map() };
// Rarity comes from how an asset ranks by price among its peers (same league and kind).
export function rarity(state, a, now = Date.now()) {
  if (!a || a.kind === 'fund') return null;
  if (now - rankCache.t > 60e3 || !rankCache.map.size) {
    const groups = {};
    for (const x of Object.values(state.assets)) {
      if (x.kind === 'fund' || !x.hist?.length) continue;
      (groups[`${x.league}:${x.kind}`] ||= []).push(x);
    }
    const map = new Map();
    for (const list of Object.values(groups)) {
      list.sort((p, q) => q.price - p.price);
      list.forEach((x, i) => map.set(x.id, (i + 0.5) / list.length));
    }
    rankCache = { t: now, map };
  }
  const pct = rankCache.map.get(a.id) ?? 1;
  return RARITY.find((r) => pct <= r.top) || RARITY[RARITY.length - 1];
}
export const resetRarityCache = () => { rankCache = { t: 0, map: new Map() }; };

// Card level grows with the most you've ever held in that player/team: $5 = level 1, doubling per level.
export function cardLevel(state, id) {
  const c = state.collection?.[id];
  if (!c) return 0;
  return clamp(1 + Math.floor(Math.log2(Math.max(c.peak, 5) / 5)), 1, 10);
}

function updateCollection(state, now) {
  for (const [id, h] of Object.entries(state.holdings)) {
    const a = state.assets[id];
    if (!a || a.kind === 'fund') continue;
    const isNew = !state.collection[id];
    const c = (state.collection[id] ||= { first: now, peak: 0 });
    const before = isNew ? 0 : cardLevel(state, id);
    c.peak = Math.max(c.peak, a.price * h.qty);
    const after = cardLevel(state, id);
    if (after > before && before > 0) notify(state, 'card', `${a.ticker} card leveled up to Lv ${after}`, id, now);
    if (before === 0) notify(state, 'card', `New ${rarity(state, a, now)?.name || ''} card: ${a.name}`, id, now);
  }
}

// ---------- daily streak ----------

export const DAILY_REWARDS = [1, 1.5, 2, 2.5, 3, 4, 5]; // day 1..7+, in play dollars
const dayKey = (t) => new Date(t).toLocaleDateString('en-CA');

export function dailyStatus(state, now = Date.now()) {
  const d = state.daily;
  const today = dayKey(now); const yesterday = dayKey(now - DAY);
  const claimed = d.last === today;
  const nextStreak = claimed ? d.streak : d.last === yesterday ? d.streak + 1 : 1;
  const alive = claimed || d.last === yesterday;
  return { claimed, streak: alive ? d.streak : 0, nextStreak, reward: DAILY_REWARDS[Math.min(nextStreak, 7) - 1] };
}

export function claimDaily(state, now = Date.now()) {
  const s = dailyStatus(state, now);
  if (s.claimed) throw new Error('Already claimed today — come back tomorrow');
  state.daily = { last: dayKey(now), streak: s.nextStreak, best: Math.max(state.daily.best || 0, s.nextStreak) };
  state.cash = round2(state.cash + s.reward);
  return { reward: s.reward, streak: s.nextStreak };
}

// ---------- Pick'em ----------

// Win probability from the two teams' share prices (stronger team = pricier), plus home edge.
// Win probability from the two teams' share prices (the engine's model), plus home edge.
// Preseason games are pulled toward 50% since starters sit.
export function winProb(state, league, teamId, oppId, home, preseason = false) {
  return teamWinProb(state, league, teamId, oppId, !!home, preseason);
}

// Correct picks pay more for underdogs: $1 at even odds, from $0.55 up to $3.
export const pickReward = (p) => round2(clamp(0.5 / p, 0.55, 3));

export function upcomingPickGames(state, now = Date.now(), leagues = null) {
  const out = [];
  for (const [lg, list] of Object.entries(state.schedule || {})) {
    if (leagues && !leagues.includes(lg)) continue;
    for (const g of list || []) {
      if (g.date <= now || g.date > now + 3 * DAY || g.teams.length !== 2) continue;
      if (!state.assets[`${lg}:t:${g.teams[0].id}`] || !state.assets[`${lg}:t:${g.teams[1].id}`]) continue;
      out.push({ ...g, league: lg });
    }
  }
  return out.sort((x, y) => x.date - y.date);
}

export function makePick(state, game, teamId, now = Date.now()) {
  if (game.date <= now) throw new Error('This game has started — picks are locked');
  const me = game.teams.find((t) => t.id === teamId);
  const opp = game.teams.find((t) => t.id !== teamId);
  if (!me || !opp) throw new Error('Pick a team in this game');
  const p = winProb(state, game.league, me.id, opp.id, !!me.home, !!game.preseason);
  const pk = { gameId: game.id, league: game.league, teamId: me.id, abbr: me.abbr, opp: opp.abbr, name: game.name, date: game.date, p, reward: pickReward(p), t: now };
  state.picks[game.id] = pk;
  return pk;
}

export function clearPick(state, gameId, now = Date.now()) {
  const pk = state.picks[gameId];
  if (pk && pk.date <= now) throw new Error('This game has started — picks are locked');
  delete state.picks[gameId];
}

export const pickPayout = (state, pk) => round2(pk.reward * pickStreakMult(state.pickStats.streak));

// Picks for games that never finished (postponed, missing data) are voided after two days.
function voidStale(state, now) {
  for (const pk of Object.values(state.picks)) {
    if (!pk.done && now - pk.date > 2 * DAY) { pk.done = true; pk.result = 'void'; }
  }
  // Forget settled picks older than two weeks.
  for (const [id, pk] of Object.entries(state.picks)) if (pk.done && now - pk.date > 14 * DAY) delete state.picks[id];
}

// ---------- leaderboard vs strategy bots ----------

export const RIVALS = [
  { name: 'Index Ian', fund: 'SS500', style: 'Buys the StatStreet 500 and never sells' },
  { name: 'Momentum Mo', fund: 'MOMO', style: 'Chases the hottest players every week' },
  { name: 'MVP Max', fund: 'MVP10', style: 'Only owns the ten biggest stars' },
  { name: 'Hoops Hana', fund: 'HOOP', style: 'All-in on NBA stars' },
  { name: 'Gridiron Gus', fund: 'GRID', style: 'All-in on NFL stars' },
  { name: 'Team Tess', fund: 'TEAMS', style: 'Owns every team, collects win dividends' },
];

export function leaderboard(state, now = Date.now()) {
  const start = state.startedAt || now;
  const rows = [{ name: 'You', you: true, ret: netWorth(state, now) / state.startCash - 1, style: 'Includes daily rewards and Pick\'em winnings' }];
  for (const r of RIVALS) {
    const f = state.assets[`fund:${r.fund}`];
    if (!f?.hist?.length) continue;
    const p0 = priceAt(f, start);
    if (p0 > 0) rows.push({ name: r.name, style: r.style, ret: f.price / p0 - 1, bot: true });
  }
  return rows.sort((x, y) => y.ret - x.ret);
}

// ---------- trophies ----------

const holdingsOf = (state, kind) => Object.keys(state.holdings).filter((id) => state.assets[id]?.kind === kind);

export const TROPHIES = [
  { id: 'first_trade', icon: '🎉', name: 'First trade', desc: 'Buy your first share', check: (s) => s.txns.length > 0 },
  { id: 'first_div', icon: '💵', name: 'Paid to hold', desc: 'Receive a dividend', check: (s) => s.divs.length > 0 },
  { id: 'fund', icon: '🧺', name: 'Diversifier', desc: 'Own an index fund', check: (s) => holdingsOf(s, 'fund').length > 0 },
  { id: 'five', icon: '🖐️', name: 'Starting five', desc: 'Hold 5 different players or teams at once', check: (s) => holdingsOf(s, 'player').length + holdingsOf(s, 'team').length >= 5 },
  { id: 'collector', icon: '🗂️', name: 'Collector', desc: 'Collect 10 cards', check: (s) => Object.keys(s.collection).length >= 10 },
  { id: 'legend', icon: '👑', name: 'Legendary', desc: 'Own a Legendary card', check: (s, now) => Object.keys(s.holdings).some((id) => rarity(s, s.assets[id], now)?.key === 'legendary') },
  { id: 'option', icon: '🎟️', name: 'Options trader', desc: 'Buy your first option', check: (s) => s.txns.some((t) => t.kind === 'option') },
  { id: 'order', icon: '🧾', name: 'Set and forget', desc: 'Fill a limit, stop or recurring order', check: (s) => s.txns.some((t) => t.via) },
  { id: 'pick3', icon: '🔥', name: 'Hot hand', desc: 'Win 3 picks in a row', check: (s) => s.pickStats.best >= 3 },
  { id: 'pick10', icon: '🎯', name: 'Sharpshooter', desc: 'Win 10 picks', check: (s) => s.pickStats.w >= 10 },
  { id: 'daily7', icon: '📅', name: 'Week streak', desc: 'Claim the daily reward 7 days in a row', check: (s) => s.daily.best >= 7 },
  { id: 'beat', icon: '📈', name: 'Beat the market', desc: 'Top Index Ian after at least a week', check: (s, now) => now - s.startedAt > 7 * DAY && leaderboard(s, now).findIndex((r) => r.you) < leaderboard(s, now).findIndex((r) => r.name === 'Index Ian') },
  { id: 'double', icon: '🚀', name: 'Double up', desc: 'Grow your starting balance 2x', check: (s, now) => netWorth(s, now) >= 2 * s.startCash },
];

function checkTrophies(state, now) {
  for (const t of TROPHIES) {
    if (state.trophies[t.id]) continue;
    let ok = false;
    try { ok = t.check(state, now); } catch { ok = false; }
    if (ok) { state.trophies[t.id] = now; notify(state, 'trophy', `Trophy unlocked: ${t.icon} ${t.name}`, null, now); }
  }
}

// Called on each tick alongside orders/alerts.
export function runSocial(state, now = Date.now()) {
  updateCollection(state, now);
  voidStale(state, now);
  checkTrophies(state, now);
}

// Players in a game, with their line from that game (live or final).
export function gamePlayers(state, league, gameId) {
  const out = [];
  for (const a of Object.values(state.assets)) {
    if (a.kind !== 'player' || a.league !== league) continue;
    if (a.live?.e === gameId) { out.push({ a, text: a.live.text, gs: null, live: true }); continue; }
    const g = a.perf?.last?.find((x) => x.e === gameId);
    if (g) out.push({ a, text: g.text.replace(/ vs [A-Z]+( \(preseason\))?$/, ''), gs: g.gs, live: false });
  }
  return out;
}

export { HOUR };
