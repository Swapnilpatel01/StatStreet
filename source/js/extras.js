// Extras: trade journal, game-day lineup, calendar, mover alerts, daily challenge,
// card collections, achievements and search. Pure functions over the saved state, so
// they can be tested without a browser.

import { change, priceAt, netWorth, notify, gameHooks, boostHooks } from './engine.js';
import { gameScore, lineText } from './scoring.js';
import { addXP, addCoins, career } from './xp.js';
import { DAY, HOUR } from './util.js';
import './boosters.js'; // loaded first: collections stack on top of the card boosts

const round2 = (x) => Math.round(x * 100) / 100;
const dayKey = (t) => new Date(t).toLocaleDateString('en-CA');
const teamKey = (a) => (a.kind === 'team' ? a.rid : a.teamId);

// ---------- trade journal ----------
// Every sale, matched against the average cost of the shares sold.
export function closedTrades(state) {
  const pos = {}; const out = [];
  const txns = (state.txns || []).filter((t) => t.kind === 'stock' && (t.side === 'buy' || t.side === 'sell')).slice().reverse();
  for (const t of txns) {
    const p = pos[t.id] ||= { qty: 0, cost: 0, first: t.t };
    if (t.side === 'buy') {
      if (p.qty < 1e-9) p.first = t.t;
      p.qty += t.qty; p.cost += t.total;
    } else {
      const avg = p.qty > 1e-9 ? p.cost / p.qty : t.price;
      const basis = avg * t.qty;
      const a = state.assets[t.id];
      // The price driver closest to (and before) the sale explains most exits.
      const why = (a?.events || []).filter((e) => e.t <= t.t + 5 * 60e3 && t.t - e.t < 3 * DAY).sort((x, y) => y.t - x.t)[0];
      out.push({ t: t.t, id: t.id, ticker: t.ticker, name: t.name, qty: t.qty, buy: round2(avg), sell: t.price,
        pl: round2(t.total - basis), pct: basis > 0 ? t.total / basis - 1 : 0, held: t.t - p.first, why: why ? why.text : '' });
      p.qty = Math.max(0, p.qty - t.qty); p.cost = Math.max(0, p.cost - basis);
    }
  }
  return out.reverse();
}
export function journalStats(trades) {
  const wins = trades.filter((t) => t.pl > 0.004); const losses = trades.filter((t) => t.pl < -0.004);
  const sum = (xs) => xs.reduce((s, t) => s + t.pl, 0);
  return { n: trades.length, wins: wins.length, losses: losses.length, total: round2(sum(trades)),
    winRate: trades.length ? wins.length / trades.length : 0, best: trades.slice().sort((x, y) => y.pl - x.pl)[0] || null,
    worst: trades.slice().sort((x, y) => x.pl - y.pl)[0] || null, avgWin: wins.length ? sum(wins) / wins.length : 0, avgLoss: losses.length ? sum(losses) / losses.length : 0 };
}

// ---------- game-day lineup and calendar ----------

function mineByTeam(state, { watch = true } = {}) {
  const by = new Map();
  const add = (id, own) => {
    const a = state.assets[id];
    if (!a || a.kind === 'fund') return;
    const k = `${a.league}:${teamKey(a)}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ a, own });
  };
  for (const id of Object.keys(state.holdings || {})) add(id, true);
  if (watch) for (const id of state.watch || []) if (!state.holdings[id]) add(id, false);
  return by;
}

// Your players and teams with a game today: live first, then by start time.
export function lineupToday(state, now = Date.now()) {
  const by = mineByTeam(state);
  const out = []; const seen = new Set();
  for (const [gid, g] of Object.entries(state.liveGames || {})) {
    const mine = g.teams.flatMap((t) => by.get(`${g.league}:${t.id}`) || []);
    if (mine.length) { out.push({ id: gid, league: g.league, name: g.name, live: true, detail: g.detail, date: now, mine }); seen.add(gid); }
  }
  const today = dayKey(now);
  for (const [lg, list] of Object.entries(state.schedule || {})) {
    for (const g of list) {
      if (seen.has(g.id) || dayKey(g.date) !== today || g.date < now - 4 * HOUR) continue;
      const mine = g.teams.flatMap((t) => by.get(`${lg}:${t.id}`) || []);
      if (mine.length) out.push({ id: g.id, league: lg, name: g.name, live: false, date: g.date, mine });
    }
  }
  return out.sort((x, y) => (y.live - x.live) || x.date - y.date);
}

function teamRank(state, league) {
  const teams = Object.values(state.assets).filter((t) => t.kind === 'team' && t.league === league && t.price > 0).sort((x, y) => y.price - x.price);
  return { rank: new Map(teams.map((t, i) => [t.rid, i + 1])), n: teams.length };
}
// Upcoming games for what you own, with how tough each opponent is.
export function calendar(state, now = Date.now(), days = 7) {
  const by = mineByTeam(state, { watch: false });
  const out = [];
  for (const [lg, list] of Object.entries(state.schedule || {})) {
    const { rank, n } = teamRank(state, lg);
    for (const g of list) {
      if (g.date < now || g.date > now + days * DAY) continue;
      for (const t of g.teams) {
        const mine = by.get(`${lg}:${t.id}`);
        if (!mine) continue;
        const opp = g.teams.find((x) => x.id !== t.id);
        const r = rank.get(opp?.id) || null;
        const diff = !r ? 'even' : r <= Math.ceil(n / 4) ? 'tough' : r > n * 0.6 ? 'easy' : 'even';
        out.push({ id: g.id, league: lg, date: g.date, home: !!t.home, team: t.abbr, opp: opp?.abbr || '', oppRank: r, n, diff, mine: mine.map((x) => x.a) });
      }
    }
  }
  return out.sort((x, y) => x.date - y.date);
}

// ---------- mover alerts ----------
// One banner per player per day per step: "+5%", then "+10%", and so on.
export function moverAlerts(state, now = Date.now()) {
  const pct = state.settings?.moveAlert ?? 5;
  if (!pct) return [];
  const step = pct / 100;
  state.moveSeen ||= {};
  const today = dayKey(now);
  const out = [];
  const ids = new Set([...Object.keys(state.holdings || {}), ...(state.watch || [])]);
  for (const id of ids) {
    const a = state.assets[id];
    if (!a || !a.hist?.length) continue;
    const c = change(a, now, DAY);
    const lvl = Math.trunc(c / step);
    const seen = state.moveSeen[id]?.day === today ? state.moveSeen[id].lvl : 0;
    if (lvl !== 0 && Math.abs(lvl) > Math.abs(seen) && Math.sign(lvl) === Math.sign(c)) {
      state.moveSeen[id] = { day: today, lvl };
      const own = !!state.holdings[id];
      const text = `${a.ticker} ${c > 0 ? 'is up' : 'is down'} ${Math.abs(c * 100).toFixed(1)}% today${own ? '' : ' (watchlist)'}`;
      notify(state, 'mover', text, id, now);
      out.push({ id, text, up: c > 0 });
    }
  }
  // Game starting: once per game.
  state.startSeen ||= {};
  for (const g of lineupToday(state, now)) {
    if (!g.live || state.startSeen[g.id]) continue;
    state.startSeen[g.id] = now;
    const names = g.mine.filter((x) => x.own).map((x) => x.a.ticker).slice(0, 3);
    if (!names.length) continue;
    const text = `${g.name} is live: ${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} playing`;
    notify(state, 'mover', text, g.mine[0].a.id, now);
    out.push({ id: g.mine[0].a.id, text, up: true, game: g });
  }
  for (const [k, t] of Object.entries(state.startSeen)) if (now - t > 3 * DAY) delete state.startSeen[k];
  return out;
}

// ---------- daily challenge ----------
// One call a day: will this player beat his usual game tonight?
export function dailyChallenge(state, now = Date.now()) {
  state.challenge ||= { streak: 0, best: 0, won: 0, lost: 0, cur: null };
  const ch = state.challenge;
  const today = dayKey(now);
  // An unanswered question made by an older version may be about someone who isn't playing: ask again.
  if (ch.cur && !ch.cur.result && ch.cur.v !== 3) ch.cur = null; // answered or not: it gets asked again, about someone who will play
  if (ch.cur && (ch.cur.day === today || (ch.cur.pick && !ch.cur.result && now - ch.cur.date < 2 * DAY))) return ch;
  if (ch.cur?.pick && !ch.cur.result) { ch.cur.result = 'void'; } // game never came in
  // Candidates: players with a game today that hasn't started, preferring ones you own, then stars.
  const cands = [];
  for (const [lg, list] of Object.entries(state.schedule || {})) {
    if (state.settings?.leagues && !state.settings.leagues[lg]) continue;
    for (const g of list) {
      if (dayKey(g.date) !== today || g.date < now + 5 * 60e3 || g.preseason) continue;
      const ids = new Set(g.teams.map((t) => t.id));
      for (const a of Object.values(state.assets)) {
        if (a.kind !== 'player' || a.league !== lg || !ids.has(a.teamId) || (a.injury && a.injury.factor < 0.99) || a.perf?.ema == null || (a.perf.n || 0) < 3) continue;
        // Only someone who will actually play: pitchers must be tonight's announced starter,
        // and everyone must have played in his team's recent games.
        if (lg === 'mlb' && /^(SP|RP|P|CL)$/i.test(a.pos || '') && !(g.probables || []).includes(String(a.rid))) continue;
        const lastT = a.perf.last?.[0]?.t;
        if (lastT && now - lastT > (lg === 'nfl' ? 16 : lg === 'mlb' ? 4 : 8) * DAY) continue;
        cands.push({ a, g, score: (state.holdings[a.id] ? 1000 : 0) + (a.fame || 1) * 100 + a.price / 10 });
      }
    }
  }
  if (!cands.length) { ch.cur = null; return ch; }
  cands.sort((x, y) => y.score - x.score);
  // Rotate through the top few so it isn't the same star every day.
  const top = cands.slice(0, 6);
  const pick = top[Math.abs(hash(today)) % top.length];
  ch.cur = { day: today, id: pick.a.id, name: pick.a.name, ticker: pick.a.ticker, gid: pick.g.id, game: pick.g.name, date: pick.g.date,
    line: Math.round(pick.a.perf.ema * 10) / 10, pick: null, result: null, v: 3 };
  return ch;
}
function hash(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

export function answerChallenge(state, yes, now = Date.now()) {
  const cur = state.challenge?.cur;
  if (!cur) throw new Error('No challenge today');
  if (cur.pick) throw new Error('You already answered today');
  if (now >= cur.date) throw new Error('The game has started');
  cur.pick = yes ? 'over' : 'under';
  return cur;
}
export const challengeReward = (streak) => ({ xp: 20 + 5 * Math.min(streak, 10), cents: streak > 0 && streak % 5 === 0 ? 50 : 0 });

function settleChallenge(state, league, game, at) {
  const ch = state.challenge; const cur = ch?.cur;
  if (!cur || cur.result || !cur.pick || cur.gid !== game.id) return;
  const row = (game.players || []).find((p) => `${league}:p:${p.id}` === cur.id);
  if (!row) { cur.result = 'void'; notify(state, 'challenge', `Daily challenge: ${cur.name} didn't play. No change to your streak.`, cur.id, at); return; }
  const gs = Math.round(gameScore(league, row.line) * 10) / 10;
  cur.gs = gs; cur.text = lineText(league, row.line);
  const over = gs > cur.line;
  const won = (cur.pick === 'over') === over;
  cur.result = won ? 'won' : 'lost';
  if (won) {
    ch.streak += 1; ch.won += 1; ch.best = Math.max(ch.best, ch.streak);
    const r = challengeReward(ch.streak);
    addXP(state, r.xp, at); if (r.cents) addCoins(state, r.cents);
    notify(state, 'challenge', `Daily challenge won: ${cur.name} scored ${gs} vs his usual ${cur.line}. Streak ${ch.streak} · +${r.xp} XP${r.cents ? ' · +$0.50' : ''}`, cur.id, at);
  } else {
    ch.streak = 0; ch.lost += 1;
    notify(state, 'challenge', `Daily challenge missed: ${cur.name} scored ${gs} vs his usual ${cur.line}.`, cur.id, at);
  }
}
gameHooks.push(settleChallenge);

// ---------- card collections ----------
// Three moment cards from one team make a set: +5% dividends from that team's players and the team.
export const SET_SIZE = 3;
export const SET_BONUS = 0.05;
const cardTeam = (m) => m?.player?.team || m?.player?.teamAbbr || '';
export function collections(state) {
  const inv = state.boosters?.inv || [];
  const by = new Map();
  for (const b of inv) {
    const m = b.m; if (!m?.player) continue;
    const team = cardTeam(m);
    if (!team) continue;
    const k = `${m.league}:${team}`;
    if (!by.has(k)) by.set(k, { key: k, league: m.league, team, cards: [], players: new Set() });
    const s = by.get(k); s.cards.push(b); s.players.add(m.player.id);
  }
  return [...by.values()].map((s) => ({ ...s, n: s.cards.length, done: s.cards.length >= SET_SIZE, players: s.players.size }))
    .sort((x, y) => (y.done - x.done) || y.n - x.n);
}
export function setBonus(state, assetId) {
  const a = state.assets[assetId];
  if (!a || a.kind === 'fund') return 0;
  const abbr = a.teamAbbr; // teams carry their own abbreviation here too
  if (!abbr) return 0;
  let n = 0;
  for (const b of state.boosters?.inv || []) if (b.m?.league === a.league && cardTeam(b.m) === abbr) n++;
  return n >= SET_SIZE ? SET_BONUS : 0;
}
// Stack on top of whatever the card system already applies.
{
  const prev = boostHooks.divMult;
  boostHooks.divMult = (state, assetId) => (prev ? prev(state, assetId) : 1) * (1 + setBonus(state, assetId));
}

// ---------- achievements ----------
export function achievements(state, now = Date.now()) {
  const trades = closedTrades(state);
  const js = journalStats(trades);
  const c = career(state);
  const divs = state.divs || [];
  const bigDiv = divs.slice().sort((x, y) => y.amt - x.amt)[0];
  const bestSeason = (c.seasons || []).slice().sort((x, y) => y.ret - x.ret)[0];
  const holds = Object.entries(state.holdings || {}).map(([id, h]) => ({ a: state.assets[id], h })).filter((x) => x.a && x.h.cost > 0)
    .map((x) => ({ ...x, pct: x.a.price * x.h.qty / x.h.cost - 1, pl: x.a.price * x.h.qty - x.h.cost })).sort((x, y) => y.pct - x.pct);
  const inv = state.boosters?.inv || [];
  const order = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'iconic'];
  const topCard = inv.slice().sort((x, y) => order.indexOf(y.rarity) - order.indexOf(x.rarity) || y.m.rating - x.m.rating)[0];
  const items = [];
  const add = (icon, title, value, sub, ok = true) => items.push({ icon, title, value, sub, ok });
  add('💰', 'Best trade', js.best && js.best.pl > 0 ? `+$${js.best.pl.toFixed(2)}` : '—', js.best && js.best.pl > 0 ? `${js.best.ticker} · ${(js.best.pct * 100).toFixed(1)}%` : 'Sell something for a profit', !!(js.best && js.best.pl > 0));
  add('📈', 'Best holding', holds[0] && holds[0].pct > 0 ? `+${(holds[0].pct * 100).toFixed(1)}%` : '—', holds[0] && holds[0].pct > 0 ? holds[0].a.name : 'Nothing in the green yet', !!(holds[0] && holds[0].pct > 0));
  add('🎯', 'Trade win rate', js.n ? `${Math.round(js.winRate * 100)}%` : '—', js.n ? `${js.wins} wins · ${js.losses} losses` : 'No closed trades yet', js.n > 0);
  add('💵', 'Biggest dividend', bigDiv ? `$${bigDiv.amt.toFixed(2)}` : '—', bigDiv ? `${state.assets[bigDiv.id]?.name || ''}` : 'Own a player through a big game', !!bigDiv);
  add('🧾', 'Dividends earned', `$${(state.divTotal || 0).toFixed(2)}`, `${divs.length} payment${divs.length === 1 ? '' : 's'}`, (state.divTotal || 0) > 0);
  add('🔥', 'Best pick streak', String(state.pickStats?.best || 0), `${state.pickStats?.w || 0}-${state.pickStats?.l || 0} in Pick'em`, (state.pickStats?.best || 0) > 0);
  add('⚡', 'Challenge streak', String(state.challenge?.best || 0), `${state.challenge?.won || 0} won · ${state.challenge?.lost || 0} missed`, (state.challenge?.best || 0) > 0);
  add('🏅', 'Best season', bestSeason ? `${bestSeason.ret >= 0 ? '+' : ''}${(bestSeason.ret * 100).toFixed(1)}%` : '—', bestSeason ? `Season ${bestSeason.n} · ${bestSeason.tier}` : 'Finish a season', !!bestSeason);
  add('🃏', 'Top card', topCard ? topCard.rarity[0].toUpperCase() + topCard.rarity.slice(1) : '—', topCard ? `${topCard.m.player.name} · ${topCard.m.kind.toLowerCase()}` : 'No moment cards yet', !!topCard);
  add('🏆', 'Trophies', String(Object.keys(state.trophies || {}).length), 'Unlocked so far', Object.keys(state.trophies || {}).length > 0);
  return { items, netWorth: netWorth(state, now), level: null };
}

// ---------- search ----------
export function searchAll(state, q, now = Date.now()) {
  const s = String(q || '').trim().toLowerCase();
  if (s.length < 2) return { assets: [], news: [], cards: [], lots: [] };
  const words = s.split(/\s+/);
  const hit = (text) => { const t = String(text || '').toLowerCase(); return words.every((w) => t.includes(w)); };
  const on = (lg) => !state.settings?.leagues || state.settings.leagues[lg] !== false;
  const assets = Object.values(state.assets).filter((a) => a.hist?.length && (a.kind === 'fund' || on(a.league)) && hit(`${a.name} ${a.ticker} ${a.teamAbbr || ''} ${a.abbr || ''}`))
    .sort((x, y) => (y.ticker.toLowerCase() === s) - (x.ticker.toLowerCase() === s) || (y.name.toLowerCase().startsWith(s) - x.name.toLowerCase().startsWith(s)) || y.price * (y.kind === 'team' ? 0.2 : 1) - x.price * (x.kind === 'team' ? 0.2 : 1)).slice(0, 12);
  const news = (state.news || []).filter((n) => on(n.league) && hit(`${n.headline} ${n.desc || ''}`)).slice(0, 8);
  const card = (b) => hit(`${b.m?.player?.name} ${b.m?.kind} ${b.rarity} ${cardTeam(b.m)}`);
  const cards = (state.boosters?.inv || []).filter(card).slice(0, 8);
  const lots = (state.mp?.list || []).filter((l) => !l.mine && l.end > now && card(l.card)).slice(0, 8);
  return { assets, news, cards, lots };
}

// ---------- since you last opened ----------
export function sinceLastOpen(state, now = Date.now()) {
  const last = state.lastOpen;
  if (!last || now - last.t < 30 * 60e3) return null;
  const nw = netWorth(state, now);
  const movers = Object.entries(state.holdings || {}).map(([id, h]) => {
    const a = state.assets[id]; if (!a) return null;
    const p0 = priceAt(a, last.t);
    return { a, d: (a.price - p0) * h.qty, pct: p0 ? a.price / p0 - 1 : 0 };
  }).filter(Boolean).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const divs = (state.divs || []).filter((d) => d.t > last.t);
  return { t: last.t, change: round2(nw - last.nw), pct: last.nw ? nw / last.nw - 1 : 0, top: movers[0] && Math.abs(movers[0].d) >= 0.01 ? movers[0] : null,
    divs: round2(divs.reduce((s, d) => s + d.amt, 0)), nDivs: divs.length };
}
export function markOpen(state, now = Date.now()) { state.lastOpen = { t: now, nw: round2(netWorth(state, now)) }; }

// ---------- compare ----------
export function compareRows(state, a, b, now = Date.now()) {
  const pc = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
  const form = (x) => { const g = (x.perf?.last || []).slice(0, 5); return g.length ? g.reduce((s, q) => s + q.gs, 0) / g.length : null; };
  const vol = (x) => { const h = x.hist; const r = []; for (let i = Math.max(3, h.length - 79); i < h.length; i += 2) if (h[i - 2] > 0) r.push(Math.log(h[i] / h[i - 2])); if (r.length < 4) return null; const m = r.reduce((s, v) => s + v, 0) / r.length; return Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / r.length); };
  const rows = [];
  const add = (label, va, vb, better = 0, ta = null, tb = null) => rows.push({ label, a: ta ?? va, b: tb ?? vb, win: better === 0 || va == null || vb == null || va === vb ? '' : (better > 0 ? va > vb : va < vb) ? 'a' : 'b' });
  add('Price', a.price, b.price, 0, `$${a.price.toFixed(2)}`, `$${b.price.toFixed(2)}`);
  for (const [l, span] of [['Today', DAY], ['This week', 7 * DAY], ['This month', 30 * DAY]]) { const x = change(a, now, span); const y = change(b, now, span); add(l, x, y, 1, pc(x), pc(y)); }
  const fa = form(a); const fb = form(b);
  if (fa != null || fb != null) add('Last 5 games (avg score)', fa, fb, 1, fa == null ? '—' : fa.toFixed(1), fb == null ? '—' : fb.toFixed(1));
  if (a.perf?.ema != null || b.perf?.ema != null) add('Season level', a.perf?.ema ?? null, b.perf?.ema ?? null, 1, a.perf?.ema == null ? '—' : a.perf.ema.toFixed(1), b.perf?.ema == null ? '—' : b.perf.ema.toFixed(1));
  const va = vol(a); const vb = vol(b);
  if (va != null && vb != null) add('Price swings', va, vb, -1, va < 0.01 ? 'Calm' : va < 0.03 ? 'Medium' : 'Wild', vb < 0.01 ? 'Calm' : vb < 0.03 ? 'Medium' : 'Wild');
  add('Injury', a.injury ? 1 : 0, b.injury ? 1 : 0, -1, a.injury ? a.injury.status : 'Healthy', b.injury ? b.injury.status : 'Healthy');
  return rows;
}
