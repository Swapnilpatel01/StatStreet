// StatStreet — UI layer.
import { LEAGUES, posGroup } from './scoring.js';
import {
  newState, migrate, tick, trade, previewTrade, netWorth, holdingsValue, change, priceAt, breakdown,
  leagueIndex, rebuildInjuryCache, recomputeStats, START_OPTIONS, dividendYield, fmtQty, SPREAD, upgradeModel, repairNewcomers, resetHistory, HIST_V, resetPortfolio, minOrder, bankrollScale,
} from './engine.js';
import { ensureFunds, fundHoldings } from './funds.js';
import {
  dollarsToQty, expirations, strikes, optKey, quoteOption, buyOption, sellOption, optLabel, placeOrder,
  cancelOrder, buyingPower, addRecurring, cancelRecurring, addAlert, removeAlert, runAutomation, payoffCurve,
} from './trading.js';
import { impliedVol, greeks, optionMid, optionsValue, CONTRACT, YEAR, gamesBefore as gamesBeforeExp, gameMove } from './bs.js';
import { syncLeague, hasLive } from './sync.js';
import { setProxy, netStats, api } from './api.js';
import { loadState, saveState, persist, idbDel } from './store.js';
import { lineChart, sparkline, payoffChart } from './chart.js';
import { haptic, slideOut, dismissable, pullToRefresh, edgeSwipe } from './gestures.js';
import { fmtMoney, fmtPct, timeAgo, DAY, HOUR, clamp, mean, addDays } from './util.js';
import {
  rarity, cardLevel, RARITY, dailyStatus, claimDaily, DAILY_REWARDS, dailyAmount, scaledPickReward, winProb, pickReward, upcomingPickGames, makePick, clearPick,
  pickPayout, leaderboard, TROPHIES, runSocial, gamePlayers,
} from './social.js';
import { pickStreakMult } from './engine.js';
import { career, xpProgress, UNLOCKS } from './xp.js';
import {
  runCareer, TIERS, tierFor, nextTier, seasonReturn, seasonBalance, GOALS, PACKS, THEMES, TITLES, openPack, buyItem, equipItem, themeOf,
} from './career.js';
import {
  CONTEST_TIERS, PAYOUT, LINEUP, availableContests, enterContest, standings, draftPool, salaryCap, salary, entryFee, ordinal,
  propBoard, placeBet, MAX_LEGS, PROP_ODDS, potentialPayout,
} from './contests.js';
import {
  B_RARITY, B_PACKS, AUCTION_LENGTHS, bType, bRarity, describe, describeShort, traitList, rIdx, slots, boosterState, equipped, boosterOn,
  equip, unequip, fuse, openBoosterPack, marketValue, quickSellPrice, quickSell, listAuction, cancelAuction, myAuctions, listingView,
  marketListings, placeBid, buyNow, buyNowPrice, assetOf,
} from './boosters.js';
import { squarify, heatColor } from './heatmap.js';
import { portfolioCard, assetCard, shareCanvas } from './sharecard.js';

// ---------- state ----------

let state;
const ui = {
  tab: 'home', league: 'all', kind: 'player', sort: 'movers', q: '', limit: 60,
  range: '1D', homeRange: '1D', newsLeague: 'all', actFilter: 'all',
  detail: null, chain: null, order: null, game: null, scrub: false, lastScroll: 0, seenInbox: 0,
  mview: 'list', gamesLeague: 'all',
};
const APP_VERSION = 24;
const STATIC = typeof window !== 'undefined' && !!window.STATIC_SNAPSHOT; // hosted snapshot version
const RANGES = { '1D': DAY, '1W': 7 * DAY, '1M': 30 * DAY, '3M': 90 * DAY, ALL: 3650 * DAY };
const SHARES_OUT = { player: 1e6, team: 5e6 };
let syncing = false; let syncError = ''; let dirty = false;

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = (v) => (v >= 0 ? 'up' : 'down');
const money = (v) => fmtMoney(v);
const signMoney = (v) => (v >= 0 ? '+' : '−') + fmtMoney(Math.abs(v));
const enabledLeagues = () => Object.keys(LEAGUES).filter((l) => state.settings.leagues[l]);
const leagueOn = (a) => (a.kind === 'fund' ? true : !!state.settings.leagues[a.league]);
const assetsList = () => Object.values(state.assets).filter((a) => leagueOn(a) && a.hist.length);
const fmtDate = (t, o = { month: 'short', day: 'numeric' }) => new Date(t).toLocaleDateString([], o);
const fmtExp = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const fmtDateTime = (t) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const overlayOpen = () => !!(ui.detail || ui.chain || ui.order || ui.game || ui.draft);
const view = () => $('#view');

// ---------- small render helpers ----------

function initials(name) {
  return esc(String(name).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase());
}

function avatar(a) {
  const ini = a.kind === 'player' ? initials(a.name) : esc(a.ticker);
  if (a.kind === 'fund') return `<div class="avatar-fallback" style="font-size:10.5px;background:var(--card2);color:var(--up)">${esc(a.ticker)}</div>`;
  if (STATIC || !a.img) return `<div class="avatar-fallback">${ini}</div>`;
  const fallback = `<div class=&quot;avatar-fallback&quot;>${ini}</div>`;
  return `<img class="avatar ${a.kind === 'team' ? 'team' : ''}" src="${esc(a.img)}" loading="lazy" alt="" onerror="this.outerHTML='${fallback}'">`;
}

const lgTag = (lg) => (LEAGUES[lg] ? `<span class="lg ${lg}">${LEAGUES[lg].name}</span>` : '<span class="lg" style="background:var(--text)">FUND</span>');

function subLine(a) {
  const bits = [lgTag(a.kind === 'fund' ? 'fund' : a.league), `<span>${esc(a.ticker)}</span>`];
  if (a.kind === 'player') bits.push(`<span>${esc(a.teamAbbr || '')}${a.pos ? ' · ' + esc(a.pos) : ''}</span>`);
  else if (a.kind === 'team') bits.push(`<span>${recText(a)}</span>`);
  else bits.push(`<span>${Object.keys(a.cons || {}).length} holdings</span>`);
  if (a.live || a.liveBoost) bits.push('<span class="tag live">LIVE</span>');
  else if (a.injury) bits.push(`<span class="tag inj">${esc(shortInj(a.injury.status))}</span>`);
  return bits.join('');
}

const recText = (a) => (a.rec.gp ? `${Math.round(a.rec.w)}-${Math.round(a.rec.l)}${a.rec.t >= 1 ? '-' + Math.round(a.rec.t) : ''}${a.rec.prior ? ' (last yr)' : ''}` : 'Team');

function shortInj(s) {
  const x = String(s).toLowerCase();
  if (x.includes('day-to-day')) return 'DTD';
  if (x.includes('question')) return 'Q';
  if (x.includes('doubt')) return 'D';
  if (x.includes('reserve')) return 'IR';
  if (/-day/.test(x)) return s.replace(/-?Injured List/i, 'IL');
  return s.length > 10 ? 'OUT' : s;
}

function assetRow(a, { right = 'pill', range = '1D', note = '' } = {}) {
  const ch = change(a, Date.now(), RANGES[range]);
  const from = Date.now() - RANGES[range];
  return `<button class="item" data-open="${a.id}">
    ${avatar(a)}
    <div class="grow"><div class="name ellipsis">${esc(a.name)}</div><div class="sub">${note || subLine(a)}</div></div>
    ${right === 'spark' ? sparkline(a.hist, from) : ''}
    <div class="price-col">
      <div class="price" data-p="${a.id}">${money(a.price)}</div>
      ${right === 'pill' ? `<span class="pill ${cls(ch)}" data-c="${a.id}" data-r="${range}">${fmtPct(ch)}</span>`
        : `<div class="small ${cls(ch)}" data-c="${a.id}" data-r="${range}" data-plain="1">${fmtPct(ch)}</div>`}
    </div>
  </button>`;
}

function syncBadge() {
  if (STATIC) return `<button class="sync" data-act="refresh"><span class="dot" style="background:var(--up)"></span>Data ${fmtDate(window.STATIC_SNAPSHOT.fetched)}</button>`;
  const last = Math.max(0, ...enabledLeagues().map((l) => state.sync[l]?.scoreboard || 0));
  const txt = syncing ? 'Updating…' : syncError ? 'Offline' : last ? `Updated ${timeAgo(last)}` : '';
  return `<button class="sync ${syncing ? 'busy' : syncError ? 'err' : ''}" data-act="refresh"><span class="dot"></span>${txt}</button>`;
}

function topbar(title) {
  const unseen = state.inbox.filter((n) => !n.seen).length;
  return `<div class="topbar">${title}<div class="row" style="gap:10px">${syncBadge()}
    <button class="icon-btn badge-dot" data-act="inbox" aria-label="Notifications" ${unseen ? `data-n="${unseen > 9 ? '9+' : unseen}"` : ''}>
      <svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg></button></div></div>`;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3000);
}

const rangeLabel = (r) => ({ '1D': 'today', '1W': 'past week', '1M': 'past month', '3M': 'past 3 months', ALL: 'all time' }[r]);
const moodWord = (m = 0) => (m > 0.25 ? 'hot' : m > 0.08 ? 'warm' : m < -0.25 ? 'cold' : m < -0.08 ? 'cool' : 'calm');

// ---------- derived data ----------

function nwAt(t) {
  const h = state.nw;
  if (!h.length) return null;
  if (t <= h[0]) return h[1];
  for (let i = h.length - 2; i >= 0; i -= 2) if (h[i] <= t) return h[i + 1];
  return h[1];
}

function formZ(a) {
  const st = state.stats[a.league]?.[posGroup(a.league, a.pos)];
  return st && a.perf?.ema != null && st.sd ? (a.perf.ema - st.mu) / st.sd : 0;
}

// Next scheduled game for a team, or a player's team.
function nextGame(a) {
  if (a.kind === 'fund') return null;
  const teamId = a.kind === 'team' ? a.rid : a.teamId;
  const list = state.schedule?.[a.league] || [];
  const now = Date.now();
  return list.filter((g) => g.date > now - 3 * HOUR && g.teams.some((t) => t.id === teamId))
    .sort((x, y) => x.date - y.date)[0] || null;
}

// Games before an option expiry: exact where the schedule is known, estimated beyond it.
function gamesBefore(a, exp) {
  if (a.kind === 'fund') return null;
  return gamesBeforeExp(state, a, exp);
}
function gamesLabel(g) {
  if (!g) return '';
  const n = g.estimated >= 0.5 ? Math.round(g.total) : g.known;
  return `${g.estimated >= 0.5 ? '~' : ''}${n} game${n === 1 ? '' : 's'}`;
}

// Model "scout rating": blend of form, momentum, news and injuries.
function scoutRating(a) {
  const now = Date.now();
  const b = breakdown(state, a, now);
  let s = 3 * change(a, now, 7 * DAY) + 2 * b.senti;
  if (a.kind === 'player') s += 0.5 * formZ(a) - (a.injury ? 1.2 * (1 - a.injury.factor) * 5 : 0);
  if (a.kind === 'team') s += (a.rec.gp ? (a.rec.w / Math.max(1, a.rec.w + a.rec.l) - 0.5) * 3 : 0) + 0.05 * clamp(a.rec.streak, -5, 5);
  if (a.kind === 'fund') s += 2 * change(a, now, 30 * DAY);
  const buy = Math.round(clamp(50 + 22 * s, 6, 92));
  const sell = Math.round(clamp(22 - 14 * s, 3, 60));
  return { buy, sell: Math.min(sell, 100 - buy), hold: Math.max(0, 100 - buy - Math.min(sell, 100 - buy)) };
}

const COLLECTIONS = [
  { key: 'mvp', e: '🏆', t: 'MVP Race', d: 'Best form in every league' },
  { key: 'div', e: '💵', t: 'Dividend payers', d: 'Highest estimated yield' },
  { key: 'streak', e: '🔥', t: 'Hot streaks', d: 'Teams on 3+ win runs' },
  { key: 'vol', e: '🎢', t: 'Most volatile', d: 'Big swings, pricey options' },
  { key: 'cheap', e: '🏷️', t: 'Under $25', d: 'Low share prices' },
  { key: 'hurt', e: '🩹', t: 'Injury watch', d: 'Discounted by injuries' },
];

// ---------- views ----------

function renderHome() {
  const now = Date.now();
  const nw = netWorth(state, now);
  const ref = nwAt(now - RANGES[ui.homeRange]) ?? state.startCash;
  const ch = nw - ref;
  const bench = state.assets['fund:SS500'];
  const benchCh = bench ? change(bench, now, RANGES[ui.homeRange]) : null;
  const holdings = Object.entries(state.holdings).map(([id, h]) => ({ a: state.assets[id], h })).filter((x) => x.a)
    .sort((x, y) => y.a.price * y.h.qty - x.a.price * x.h.qty);
  const stocks = holdings.filter((x) => x.a.kind !== 'fund');
  const funds = holdings.filter((x) => x.a.kind === 'fund');
  const opts = Object.values(state.options).sort((x, y) => x.exp - y.exp);
  const watch = state.watch.map((id) => state.assets[id]).filter(Boolean);
  const live = Object.entries(state.liveGames).filter(([, g]) => state.settings.leagues[g.league]);
  const movers = assetsList().filter((a) => a.kind !== 'fund').map((a) => ({ a, c: change(a, now) }))
    .sort((x, y) => Math.abs(y.c) - Math.abs(x.c)).slice(0, 5);

  // Allocation
  const val = (list) => list.reduce((s, x) => s + x.a.price * x.h.qty, 0);
  const parts = [
    ['Players', val(stocks.filter((x) => x.a.kind === 'player')), 'var(--up)'],
    ['Teams', val(stocks.filter((x) => x.a.kind === 'team')), 'var(--mlb)'],
    ['Funds', val(funds), '#b8a6ff'],
    ['Options', optionsValue(state, now), '#ffd60a'],
    ['Cash', state.cash, 'var(--faint)'],
  ].filter((p) => p[1] > 0.005);
  const tot = parts.reduce((s, p) => s + p[1], 0) || 1;

  // Upcoming games for things you own or watch (else the soonest games)
  const mine = new Set([...holdings.map((x) => x.a), ...watch, ...opts.map((o) => state.assets[o.under])].filter(Boolean)
    .filter((a) => a.kind !== 'fund').map((a) => `${a.league}:${a.kind === 'team' ? a.rid : a.teamId}`));
  const upcoming = enabledLeagues().flatMap((lg) => (state.schedule?.[lg] || []).map((g) => ({ ...g, lg })))
    .filter((g) => g.date > now).sort((x, y) => x.date - y.date);
  const myGames = upcoming.filter((g) => g.teams.some((t) => mine.has(`${g.lg}:${t.id}`)));
  const games = (myGames.length ? myGames : upcoming).slice(0, 6);

  $('#view').innerHTML = `
    ${topbar('<div class="brand">Stat<b>Street</b></div>')}
    <div class="row between"><div class="muted small">Net worth</div><button class="share-btn" data-act="sharepf" aria-label="Share"><svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>Share</button></div>
    <div class="big-value" data-nw>${money(nw)}</div>
    <div class="change-line ${cls(ch)}" data-nwc>${ch >= 0 ? '▲' : '▼'} ${money(Math.abs(ch))} (${fmtPct(ref ? ch / ref : 0)}) <span class="muted">${rangeLabel(ui.homeRange)}</span></div>
    ${benchCh != null ? `<div class="vs">StatStreet 500 <b class="${cls(benchCh)}">${fmtPct(benchCh)}</b> ${rangeLabel(ui.homeRange)}</div>` : ''}
    <div class="chart-wrap" id="nwchart"></div>
    <div class="ranges">${Object.keys(RANGES).map((r) => `<button data-hrange="${r}" class="${r === ui.homeRange ? 'on' : ''}">${r}</button>`).join('')}</div>

    <div class="grid2" style="margin-top:12px">
      <div class="stat"><div class="k">Buying power</div><div class="v">${money(buyingPower(state))}</div></div>
      <div class="stat"><div class="k">Dividends earned</div><div class="v up">${money(state.divTotal || 0)}</div></div>
    </div>
    ${holdings.length || opts.length ? `<div class="alloc">${parts.map(([, v, c]) => `<i style="width:${(v / tot) * 100}%;background:${c}"></i>`).join('')}</div>
    <div class="legend">${parts.map(([n, v, c]) => { const pc = (v / tot) * 100; return `<span style="--c:${c}">${n} ${pc > 0 && pc < 1 ? '<1' : Math.round(pc)}%</span>`; }).join('')}</div>` : ''}

    ${state.season ? (() => { const r = seasonReturn(state, now); const tr = tierFor(r); return `<button class="season-strip" data-gtab="season" style="--tc:${tr.color};margin-top:12px"><span class="dot"></span>Season ${state.season.n} · <b>${tr.name}</b> · <span class="${cls(r)}">${pctTxt(r)}</span><span class="grow"></span><span class="muted">${daysLeft(state.season.end)} ›</span></button>`; })() : ''}
    ${(() => { const dly = dailyStatus(state, now); return dly.claimed ? '' : `<button class="card promo" data-tab="games"><span class="e">🎁</span><div class="grow"><div class="name">Daily reward ready</div>
      <div class="tiny muted">${dly.nextStreak > 1 ? `Day ${dly.nextStreak} of your streak` : 'Start a streak'} · tap to claim ${money(dly.reward)}</div></div><span class="muted">›</span></button>`; })()}

    ${live.length ? `<h3>Live now</h3><div class="live-strip">${live.map(([id, g]) => `
      <button class="game" data-game="${g.league}|${id}" style="text-align:left">${lgTag(g.league)} <span class="tag live">LIVE</span>
        ${g.teams.map((t) => `<div class="t"><span>${esc(t.abbr)}</span><span>${t.score}</span></div>`).join('')}
        <div class="tiny muted">${esc(g.detail)}</div></button>`).join('')}</div>` : ''}

    ${state.orders.length ? `<h2>Open orders</h2><div class="list">${state.orders.map(orderRow).join('')}</div>` : ''}

    ${opts.length ? `<h2>Options</h2><div class="list">${opts.map(optPositionRow).join('')}</div>` : ''}

    <h2>Stocks</h2>
    ${stocks.length ? `<div class="list">${stocks.map(({ a, h }) => positionRow(a, h)).join('')}</div>`
      : `<div class="card empty">You don't own any players or teams yet. You start with ${money(state.startCash)} of play money.
      <button class="more" data-tab="market">Browse the market →</button></div>`}

    ${funds.length ? `<h2>Index funds</h2><div class="list">${funds.map(({ a, h }) => positionRow(a, h)).join('')}</div>` : ''}

    ${watch.length ? `<h2>Watchlist</h2><div class="list">${watch.map((a) => assetRow(a, { right: 'spark' })).join('')}</div>` : ''}

    ${games.length ? `<h2>${myGames.length ? 'Your upcoming games' : 'Upcoming games'}</h2><div class="list">${games.map((g) => `
      <button class="item" data-game="${g.lg}|${g.id}">${lgTag(g.lg)}<div class="grow"><div class="name">${esc(g.name)}</div><div class="sub">${fmtDateTime(g.date)}${g.preseason ? ' · preseason' : ''}</div></div>${state.picks[g.id] ? `<span class="pk">Picked ${esc(state.picks[g.id].abbr)}</span>` : '<span class="muted">›</span>'}</button>`).join('')}</div>` : ''}

    <h2>Discover</h2>
    <div class="collections">${COLLECTIONS.map((c) => `<button class="coll" data-coll="${c.key}"><div class="e">${c.e}</div><div class="t">${c.t}</div><div class="d">${c.d}</div></button>`).join('')}
      <button class="coll" data-coll="funds"><div class="e">🧺</div><div class="t">Index funds</div><div class="d">Whole leagues in one tap</div></button></div>

    <h2>Biggest movers · 24h</h2>
    <div class="list">${movers.map(({ a }) => assetRow(a)).join('') || '<div class="empty">Waiting for market data…</div>'}</div>
  `;
  drawNwChart();
}

function positionRow(a, h) {
  const pl = a.price * h.qty - h.cost;
  return `<button class="item" data-open="${a.id}">${avatar(a)}
    <div class="grow"><div class="name ellipsis">${esc(a.name)}</div><div class="sub">${fmtQty(h.qty)} sh · avg ${money(h.cost / h.qty)}</div></div>
    ${sparkline(a.hist, Date.now() - DAY)}
    <div class="price-col"><div class="price">${money(a.price * h.qty)}</div><div class="small ${cls(pl)}">${signMoney(pl)}</div></div>
  </button>`;
}

function optPositionRow(pos) {
  const a = state.assets[pos.under];
  const mark = optionMid(state, pos) * CONTRACT * pos.qty;
  const pl = mark - pos.cost;
  const days = Math.max(0, (pos.exp - Date.now()) / DAY);
  return `<button class="item pos-opt" data-optpos="${esc(pos.key)}">
    <div class="grow"><div class="name">${esc(optLabel(a, pos))}</div><div class="sub">${pos.qty} contract${pos.qty > 1 ? 's' : ''} · expires in ${days < 1 ? Math.round(days * 24) + 'h' : Math.round(days) + 'd'}</div></div>
    <div class="price-col"><div class="price">${money(mark)}</div><div class="small ${cls(pl)}">${signMoney(pl)}</div></div></button>`;
}

function orderRow(o) {
  const verb = o.side === 'buy' ? 'Buy' : 'Sell';
  const cond = o.type === 'limit' ? (o.side === 'buy' ? 'at or below' : 'at or above') : (o.side === 'buy' ? 'if it rises to' : 'if it falls to');
  return `<div class="item"><div class="grow" data-open="${o.assetId}"><div class="name">${verb} ${fmtQty(o.qty)} ${esc(o.ticker)}</div>
    <div class="sub">${o.type === 'limit' ? 'Limit' : 'Stop'} · ${cond} ${money(o.price)}</div></div>
    <button class="x-btn" data-cancelorder="${o.id}" aria-label="Cancel order">✕</button></div>`;
}

function drawNwChart() {
  const el = $('#nwchart'); if (!el) return;
  const flat = state.nw.concat([Date.now(), netWorth(state)]);
  lineChart(el, flat, Date.now() - RANGES[ui.homeRange]);
}

function marketItems() {
  const now = Date.now();
  const q = ui.q.trim().toLowerCase();
  let list = assetsList();
  if (q) {
    list = list.filter((a) => a.name.toLowerCase().includes(q) || a.ticker.toLowerCase().includes(q) || (a.teamAbbr || '').toLowerCase() === q);
  } else {
    list = list.filter((a) => a.kind === ui.kind);
  }
  if (ui.league !== 'all') list = list.filter((a) => (a.kind === 'fund' ? !a.fundLeague || a.fundLeague === ui.league : a.league === ui.league));
  const filters = {
    live: (a) => a.live || a.liveBoost,
    hurt: (a) => a.injury,
    injured: (a) => a.injury,
    news: (a) => (a.shocks || []).some((s) => now - s.t < 3 * DAY),
    streak: (a) => a.kind === 'team' && a.rec.streak >= 3,
    cheap: (a) => a.price < 20,
    div: (a) => dividendYield(state, a, now) > 0,
  };
  if (filters[ui.sort]) list = list.filter(filters[ui.sort]);
  const band = PRICE_BANDS.find((x) => x[0] === (ui.price || 'any'));
  if (band && band[0] !== 'any') list = list.filter((a) => a.price >= band[2] && a.price < band[3]);
  const key = {
    movers: (a) => -change(a, now),
    trending: (a) => -trendInfo(a, now).score,
    losers: (a) => change(a, now),
    price: (a) => -a.price,
    live: (a) => -change(a, now),
    news: (a) => -(a.shocks || []).filter((s) => now - s.t < 3 * DAY).length,
    injured: (a) => a.injury?.factor || 1,
    hurt: (a) => -breakdown(state, a, now).fair,
    mvp: (a) => -(a.kind === 'player' ? formZ(a) : a.rec?.gp ? a.rec.w / (a.rec.w + a.rec.l || 1) * 2 : -9),
    div: (a) => -dividendYield(state, a, now),
    vol: (a) => -impliedVol(a, now, state),
    streak: (a) => -a.rec.streak,
    cheap: (a) => -a.price,
  }[ui.sort] || ((a) => -change(a, now));
  return list.map((a) => [key(a), a]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
}

const SORTS = [['trending', 'Trending'], ['movers', 'Top gainers'], ['losers', 'Top losers'], ['price', 'Most valuable'], ['mvp', 'MVP race'], ['div', 'Dividends'],
  ['vol', 'Most volatile'], ['streak', 'Hot streaks'], ['live', 'Live'], ['news', 'In the news'], ['injured', 'Injured']];

function marketNote(a) {
  const now = Date.now();
  if (ui.sort === 'trending' && a.kind !== 'fund') { const t = trendInfo(a); if (t.why) return `${lgTag(a.league)} <span class="ellipsis">${esc(t.why)}</span>`; }
  if (ui.sort === 'div') return `${subLine(a)} <span class="up">${(dividendYield(state, a, now) * 100).toFixed(1)}% yield</span>`;
  if (ui.sort === 'vol') return `${subLine(a)} <span>IV ${Math.round(impliedVol(a, now, state) * 100)}%</span>`;
  if (a.kind === 'fund') return `${subLine(a)}`;
  return '';
}

// ---------- trending & research ----------

const PRICE_BANDS = [['any', 'Any price', 0, Infinity], ['u25', 'Under $25', 0, 25], ['25-100', '$25–100', 25, 100], ['100-500', '$100–500', 100, 500], ['500-1k', '$500–1K', 500, 1000], ['1k', '$1K+', 1000, Infinity]];

// How much buzz a player has right now, and the main reason why.
function trendInfo(a, now = Date.now()) {
  const reasons = [];
  const ch = change(a, now);
  reasons.push([Math.abs(ch) * 120, `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch * 100).toFixed(1)}% today`]);
  const news = state.news.filter((n) => (n.targets || []).includes(a.id) && now - n.published < 3 * DAY);
  if (news.length) reasons.push([news.length * 2.2, `📰 ${news.length} headline${news.length > 1 ? 's' : ''}`]);
  if (a.live) reasons.push([6, `🔴 Live: ${a.live.text}`]);
  const g = a.perf?.last?.[0];
  if (g && now - g.t < 2 * DAY) {
    const st = state.stats[a.league]?.[posGroup(a.league, a.pos)];
    const z = st?.sd ? (g.gs - st.mu) / st.sd : 0;
    if (z > 1) reasons.push([z * 2.4, `🔥 ${g.text.replace(/ vs [A-Z]+.*$/, '')}`]);
  }
  const ev = (a.events || []).find((e) => e.kind === 'milestone' && now - e.t < 2 * DAY);
  if (ev) reasons.push([5, `🏆 ${ev.text}`]);
  if (a.injury && now - (a.injury.since || 0) < 2 * DAY) reasons.push([4, `🩹 ${a.injury.status}`]);
  reasons.sort((x, y) => y[0] - x[0]);
  return { score: reasons.reduce((s, r) => s + r[0], 0) * (0.6 + 0.4 * Math.min(2, a.fame || 1)), why: reasons[0]?.[1] || '' };
}

function trendingStrip() {
  const now = Date.now();
  const list = assetsList().filter((a) => a.kind === 'player' && (ui.league === 'all' || a.league === ui.league))
    .map((a) => ({ a, t: trendInfo(a, now) })).sort((x, y) => y.t.score - x.t.score).slice(0, 10);
  if (!list.length) return '';
  return `<h3 style="margin-top:14px">🔥 Trending now</h3>
    <div class="trend-strip">${list.map(({ a, t }, i) => { const c = change(a, now); return `<button class="trend" data-open="${a.id}">
      <div class="row between"><span class="tiny faint">#${i + 1}</span>${lgTag(a.league)}</div>
      <div class="row" style="gap:8px;margin-top:6px">${avatar(a)}<div class="grow" style="min-width:0"><div class="name ellipsis">${esc(a.name)}</div>
        <div class="small"><span data-p="${a.id}">${money(a.price)}</span> <span class="${cls(c)}">${fmtPct(c)}</span></div></div></div>
      <div class="tiny muted ellipsis" style="margin-top:6px">${esc(t.why)}</div></button>`; }).join('')}</div>`;
}

// ---- research report on each player / team page ----
const pctTxt2 = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;

function teamRanks(league) {
  const teams = Object.values(state.assets).filter((t) => t.kind === 'team' && t.league === league && t.price > 0).sort((x, y) => y.price - x.price);
  return { rank: new Map(teams.map((t, i) => [t.rid, i + 1])), n: teams.length };
}

function upcomingFor(a, days = 7) {
  const now = Date.now();
  const teamId = a.kind === 'team' ? a.rid : a.teamId;
  const { rank, n } = teamRanks(a.league);
  return (state.schedule?.[a.league] || []).filter((g) => g.date > now && g.date < now + days * DAY && g.teams.some((t) => t.id === teamId))
    .sort((x, y) => x.date - y.date).map((g) => {
      const opp = g.teams.find((t) => t.id !== teamId);
      const home = g.teams.find((t) => t.id === teamId)?.home;
      return { g, opp, home, rank: rank.get(opp?.id) || null, n };
    });
}

function research(a) {
  const now = Date.now();
  const b = breakdown(state, a, now);
  const bull = []; const bear = [];
  const tiles = [];
  // Value: price vs the model's value (difference = market hype and noise)
  const gap = a.price / b.target - 1;
  tiles.push(['Value', Math.abs(gap) < 0.02 ? 'Fair' : gap < 0 ? 'Below model' : 'Above model', `${pctTxt2(gap)} vs model value ${money(b.target)}`, gap < -0.02 ? 'up' : gap > 0.02 ? 'down' : '']);
  if (gap < -0.03) bull.push(`Trading ${Math.round(-gap * 100)}% below its model value`); else if (gap > 0.03) bear.push(`Trading ${Math.round(gap * 100)}% above its model value (hype)`);
  // Momentum
  const w = change(a, now, 7 * DAY);
  if (w > 0.08) bull.push(`Up ${Math.round(w * 100)}% this week`); else if (w < -0.08) bear.push(`Down ${Math.round(-w * 100)}% this week`);
  // News
  const news = state.news.filter((n) => (n.targets || []).includes(a.id) && now - n.published < 7 * DAY);
  const senti = news.length ? mean(news.map((n) => n.score)) : 0;
  if (news.length && senti > 0.15) bull.push(`Positive news flow (${news.length} headline${news.length > 1 ? 's' : ''} this week)`);
  if (news.length && senti < -0.15) bear.push(`Negative headlines this week (${news.length})`);
  // Schedule
  const up = upcomingFor(a);
  const tough = up.filter((x) => x.rank && x.rank <= Math.ceil(x.n / 4)).length;
  const soft = up.filter((x) => x.rank && x.rank > x.n * 0.6).length;
  tiles.push(['Schedule', up.length ? `${up.length} game${up.length > 1 ? 's' : ''} in 7 days` : 'No games soon',
    up[0] ? `Next: ${up[0].home ? 'vs' : '@'} ${esc(up[0].opp?.abbr || '')}${up[0].rank ? ` (#${up[0].rank} of ${up[0].n})` : ''} ${fmtDate(up[0].g.date, { weekday: 'short' })}` : 'Prices move mostly on news until then', '']);
  if (up.length >= 3) bull.push(`${up.length} games in the next week: more chances to move (and pay dividends)`);
  if (!up.length) bear.push('No games in the next week: little to drive the price');
  if (soft >= 2 && soft > tough) bull.push(`Soft schedule: ${soft} games against bottom-half teams`);
  if (tough >= 2 && tough >= soft) bear.push(`Tough schedule: ${tough} games against top-quarter teams`);
  // Risk
  const iv = impliedVol(a, now, state);
  tiles.push(['Risk', a.injury ? 'Injury' : iv > 0.9 ? 'High' : iv > 0.55 ? 'Medium' : 'Low', a.injury ? esc(a.injury.status) : `Implied volatility ${Math.round(iv * 100)}%`, a.injury || iv > 0.9 ? 'down' : '']);
  if (a.injury) bear.push(`Injury: ${a.injury.status}${a.injury.detail ? ` (${a.injury.detail})` : ''}`);
  const y = dividendYield(state, a, now);
  if (y > 0.04) bull.push(`Pays well: about ${(y * 100).toFixed(1)}% a year in dividends`);
  let peers = [];
  if (a.kind === 'player') {
    const reg = (a.perf.last || []).filter((g) => !/preseason/.test(g.text)).slice(0, 5);
    const pre = !reg.length;
    const last = pre ? (a.perf.last || []).slice(0, 5) : reg; // fall back to preseason games
    const base = a.perf.season?.gs ?? a.perf.prior?.gs ?? a.perf.ema;
    const recent = last.length ? mean(last.map((g) => g.gs)) : null;
    const trend = recent != null && Math.abs(base) > 0.5 ? recent / base - 1 : null;
    tiles.unshift(['Form', trend == null ? 'No recent games' : trend > 0.1 ? 'Heating up' : trend < -0.1 ? 'Cooling off' : 'Steady',
      recent != null ? `Last ${last.length}${pre ? ' (preseason)' : ''}: ${recent.toFixed(1)} vs season ${base?.toFixed(1) ?? '—'}` : `Season avg ${base != null ? base.toFixed(1) : '—'}`, trend > 0.1 ? 'up' : trend < -0.1 ? 'down' : '']);
    if (!pre && trend > 0.15) bull.push(`Hot form: last ${last.length} games ${Math.round(trend * 100)}% above his season average`);
    if (!pre && trend < -0.15) bear.push(`Slumping: last ${last.length} games ${Math.round(-trend * 100)}% below his season average`);
    if ((a.fame || 1) > 1.8) bear.push(`Star premium: about ${(a.fame).toFixed(1)}× priced in for his reputation`);
    if (formZ(a) > 1.5 && (a.fame || 1) < 1.3) bull.push('Top-tier production without a star premium yet');
    // Similar form, cheaper
    const g = posGroup(a.league, a.pos);
    const sd = state.stats[a.league]?.[g]?.sd || 1;
    peers = assetsList().filter((x) => x.kind === 'player' && x.id !== a.id && x.league === a.league && posGroup(x.league, x.pos) === g && x.perf?.ema != null
      && Math.abs(x.perf.ema - a.perf.ema) < sd * 0.35 && x.price < a.price * 0.85)
      .sort((x, y) => Math.abs(x.perf.ema - a.perf.ema) - Math.abs(y.perf.ema - a.perf.ema)).slice(0, 3)
      .map((x) => [x, `Similar form · ${Math.round((1 - x.price / a.price) * 100)}% cheaper`]);
  } else {
    const f = (a.form || []).slice(0, 10);
    const wins = f.filter(Boolean).length;
    const pct = a.rec.gp ? (a.rec.w + 0.5 * (a.rec.t || 0)) / a.rec.gp : null;
    tiles.unshift(['Form', f.length ? `${wins}-${f.length - wins} last ${f.length}` : 'No games yet',
      pct != null ? `${(pct * 1000).toFixed(0).padStart(3, '0').replace(/^/, '.')} this season${a.prior ? ` · .${Math.round(a.prior.pct * 1000).toString().padStart(3, '0')} last season` : ''}` : (a.prior ? `.${Math.round(a.prior.pct * 1000).toString().padStart(3, '0')} last season` : '—'),
      f.length && wins / f.length >= 0.7 ? 'up' : f.length && wins / f.length <= 0.3 ? 'down' : '']);
    if (f.length >= 5 && wins / f.length >= 0.7) bull.push(`Winning: ${wins} of the last ${f.length}`);
    if (f.length >= 5 && wins / f.length <= 0.3) bear.push(`Losing: ${f.length - wins} of the last ${f.length}`);
    const out = Object.values(state.assets).filter((x) => x.kind === 'player' && x.league === a.league && x.teamId === a.rid && x.injury && x.injury.factor < 0.9)
      .sort((x, y) => y.price - x.price).slice(0, 3);
    if (out.length) bear.push(`Missing ${out.map((x) => x.name).join(', ')} (injured)`);
    if (a.rec.gp >= 5 && a.prior && pct - a.prior.pct > 0.12) bull.push('Well ahead of last season\'s pace');
    if (a.rec.gp >= 5 && a.prior && pct - a.prior.pct < -0.12) bear.push('Well behind last season\'s pace');
    const { rank } = teamRanks(a.league);
    peers = Object.values(state.assets).filter((x) => x.kind === 'team' && x.league === a.league && x.id !== a.id && x.rec.gp && a.rec.gp
      && Math.abs(x.rec.w / x.rec.gp - a.rec.w / a.rec.gp) < 0.06 && x.price < a.price * 0.9)
      .slice(0, 3).map((x) => [x, `Similar record · ${Math.round((1 - x.price / a.price) * 100)}% cheaper · #${rank.get(x.rid)}`]);
  }
  const score = bull.length - bear.length + (scoutRating(a).buy - 50) / 25;
  const outlook = score >= 1.5 ? ['up', 'Positive'] : score <= -1.5 ? ['down', 'Cautious'] : ['', 'Neutral'];
  return { tiles, bull, bear, outlook, peers, up };
}

function researchSection(a) {
  if (a.kind === 'fund') return '';
  const r = research(a);
  const sr = scoutRating(a);
  return `<h3>Research</h3>
    <div class="card research">
      <div class="row between"><div><div class="tiny muted">OUTLOOK</div><div class="rs-verdict ${r.outlook[0]}">${r.outlook[1]}</div></div>
        <div style="text-align:right"><div class="tiny muted">SCOUTS</div><div class="small"><b class="up">${sr.buy}% Buy</b> · <span class="muted">${sr.hold}% Hold</span> · <span class="down">${sr.sell}% Sell</span></div></div></div>
      <div class="rating"><i style="width:${sr.buy}%;background:var(--up)"></i><i style="width:${sr.hold}%;background:var(--faint)"></i><i style="width:${sr.sell}%;background:var(--down)"></i></div>
      <div class="rs-tiles">${r.tiles.map(([k, v, d, c]) => `<div><span>${k}</span><b class="${c}">${v}</b><small>${d}</small></div>`).join('')}</div>
      <div class="rs-cases">
        <div><div class="rs-label up">▲ Bull case</div>${r.bull.length ? `<ul>${r.bull.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="tiny muted">Nothing stands out right now.</p>'}</div>
        <div><div class="rs-label down">▼ Bear case</div>${r.bear.length ? `<ul>${r.bear.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="tiny muted">No red flags right now.</p>'}</div>
      </div>
      ${r.up.length > 1 ? `<div class="rs-sched">${r.up.slice(0, 5).map((x) => `<span class="${x.rank && x.rank <= Math.ceil(x.n / 4) ? 'down' : x.rank && x.rank > x.n * 0.6 ? 'up' : ''}">${fmtDate(x.g.date, { weekday: 'short' })} ${x.home ? 'vs' : '@'} ${esc(x.opp?.abbr || '')}</span>`).join('')}</div>` : ''}
      <p class="tiny faint" style="margin:10px 0 0">Model research from stats, schedule, news and prices. It's a game, not financial advice.</p>
    </div>
    ${r.peers.length ? `<h3>${a.kind === 'player' ? 'Cheaper alternatives' : 'Similar teams, lower price'}</h3><div class="list">${r.peers.map(([x, note]) => assetRow(x, { note })).join('')}</div>` : ''}`;
}

function renderMarket(keepFocus = false) {
  const items = marketItems();
  const html = `
    ${topbar('<h1>Stocks</h1>')}
    <input class="search" id="q" type="search" placeholder="Search players, teams, funds, tickers" value="${esc(ui.q)}" autocomplete="off" autocorrect="off">
    <div class="seg" style="margin-top:10px">${['all', ...enabledLeagues()].map((l) => `<button data-league="${l}" class="${ui.league === l ? 'on' : ''}">${l === 'all' ? 'All' : LEAGUES[l].name}</button>`).join('')}</div>
    <div class="seg" style="margin-top:8px">${[['player', 'Players'], ['team', 'Teams'], ['fund', 'Index funds']].map(([k, n]) => `<button data-kind="${k}" class="${ui.kind === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    ${!ui.q.trim() && ui.kind === 'player' ? trendingStrip() : ''}
    <div class="chips" style="margin-top:10px">${SORTS.map(([k, n]) => `<button class="chip ${ui.sort === k ? 'on' : ''}" data-sort="${k}">${n}</button>`).join('')}</div>
    <div class="chips price-chips" style="margin-top:6px">${PRICE_BANDS.map(([k, n]) => `<button class="chip ${(ui.price || 'any') === k ? 'on' : ''}" data-price="${k}">${n}</button>`).join('')}</div>
    <div class="row between" style="margin-top:8px"><span class="tiny muted">${ui.mview === 'heat' ? 'Tile size = share price · color = today\'s move' : ''}</span>
      <div class="seg mini">${[['list', 'List'], ['heat', 'Heatmap']].map(([k, n]) => `<button data-mview="${k}" class="${ui.mview === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    <div id="mlist" style="margin-top:8px">${ui.mview === 'heat' && items.length ? heatmapHTML(items) : `<div class="list">
      ${items.slice(0, ui.limit).map((a) => assetRow(a, { note: marketNote(a) })).join('') || `<div class="empty">${emptyMarketText()}</div>`}
      ${items.length > ui.limit ? `<button class="more" data-act="more">Show more (${items.length - ui.limit} left)</button>` : ''}
    </div>`}</div>
    <p class="tiny faint" style="text-align:center;margin-top:12px">${items.length} listed · prices move with real games, injuries and news</p>`;
  if (keepFocus && $('#mlist')) {
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    $('#mlist').replaceWith(tmp.querySelector('#mlist'));
    document.querySelectorAll('#view .chips').forEach((el, i) => { const n = tmp.querySelectorAll('.chips')[i]; if (n) el.replaceWith(n); });
    return;
  }
  $('#view').innerHTML = html;
}

function emptyMarketText() {
  if (!assetsList().length) return syncing ? 'Opening the market…' : 'No market data yet. Tap “Updated” at the top to retry.';
  return {
    live: 'No games in progress right now.', injured: 'No injured players here.', hurt: 'No injured players here.',
    news: 'Nothing newsworthy in the last few days.', streak: 'No teams on a 3+ game win streak.',
    div: 'No dividends paid yet. Players pay after above-average games, teams after wins.',
  }[ui.sort] || 'No matches.';
}

function renderNews() {
  const list = state.news.filter((n) => state.settings.leagues[n.league] && (ui.newsLeague === 'all' || n.league === ui.newsLeague));
  $('#view').innerHTML = `
    ${topbar('<h1>News</h1>')}
    <p class="small muted" style="margin:4px 0 10px">Headlines are scored for sentiment. Bullish news lifts the players and teams it mentions; bearish news drags them down. The effect fades over a few days.</p>
    <div class="chips">${['all', ...enabledLeagues()].map((l) => `<button class="chip ${ui.newsLeague === l ? 'on' : ''}" data-nleague="${l}">${l === 'all' ? 'All' : LEAGUES[l].name}</button>`).join('')}</div>
    <div class="list" style="margin-top:8px">${list.slice(0, 80).map((n) => {
      const s = n.score > 0.12 ? ['up', 'Bullish'] : n.score < -0.12 ? ['down', 'Bearish'] : ['flat', 'Neutral'];
      return `<div class="news">
        <a href="${esc(n.url)}" target="_blank" rel="noopener" class="h" style="text-decoration:none;display:block">${esc(n.headline)}</a>
        ${n.desc ? `<div class="small muted" style="margin-top:3px">${esc(n.desc)}</div>` : ''}
        <div class="meta">${lgTag(n.league)}<span class="senti ${s[0]}">${s[1]}${s[0] !== 'flat' ? ` ${n.score > 0 ? '+' : ''}${n.score.toFixed(2)}` : ''}</span>
          <span class="tiny faint">${timeAgo(n.published)}</span>
          ${(n.targets || []).slice(0, 4).map((id) => (state.assets[id] ? `<button class="tk" data-open="${id}">${esc(state.assets[id].ticker)}</button>` : '')).join('')}
        </div></div>`;
    }).join('') || '<div class="empty">No news yet.</div>'}</div>`;
}

function activityItems() {
  const tx = state.txns.map((t) => ({ t: t.t, kind: t.kind === 'option' ? 'option' : 'trade', x: t }));
  const dv = state.divs.map((d) => ({ t: d.t, kind: 'div', x: d }));
  let all = [...tx, ...dv].sort((a, b) => b.t - a.t);
  if (ui.actFilter === 'trade') all = all.filter((i) => i.kind === 'trade');
  if (ui.actFilter === 'option') all = all.filter((i) => i.kind === 'option');
  if (ui.actFilter === 'div') all = all.filter((i) => i.kind === 'div');
  return all.slice(0, 60);
}

function activityRow(i) {
  const when = new Date(i.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (i.kind === 'div') {
    const d = i.x;
    return `<button class="item" data-open="${d.id}"><div class="grow"><div class="name">Dividend · ${esc(d.ticker)}${d.via ? ` <span class="faint small">via ${esc(d.via)}</span>` : ''}</div>
      <div class="sub ellipsis">${when} · ${esc(d.reason)}${d.drip ? ' · reinvested' : ''}</div></div><div class="price up">+${money(d.amt)}</div></button>`;
  }
  const t = i.x;
  const verb = { buy: 'Bought', sell: 'Sold', exercise: 'Settled', expire: 'Expired' }[t.side] || t.side;
  const what = t.kind === 'option' ? `${t.qty} × ${esc(t.opt)}` : `${fmtQty(t.qty)} ${esc(t.ticker)}`;
  const amt = t.side === 'buy' ? `-${money(t.total)}` : `+${money(t.total)}`;
  return `<button class="item" data-open="${t.id}"><div class="grow"><div class="name">${verb} ${what}</div>
    <div class="sub">${when} · ${money(t.price)}${t.kind === 'option' ? '/sh' : '/sh'}${t.via ? ` · ${t.via}` : ''}</div></div>
    <div class="price ${t.side === 'buy' || t.side === 'expire' ? '' : 'up'}">${amt}</div></button>`;
}

function renderAccount() {
  const nw = netWorth(state);
  const pl = nw - state.startCash;
  const inbox = state.inbox.slice(0, 15);
  $('#view').innerHTML = `
    ${topbar('<h1>Account</h1>')}
    <div class="grid3">
      <div class="stat"><div class="k">All-time return</div><div class="v ${cls(pl)}">${fmtPct(pl / state.startCash)}</div></div>
      <div class="stat"><div class="k">Dividends</div><div class="v up">${money(state.divTotal || 0)}</div></div>
      <div class="stat"><div class="k">Trades</div><div class="v">${state.txns.length}</div></div>
    </div>

    <h2 id="notifications">Notifications</h2>
    <div class="list">${inbox.map((n) => `<button class="inbox-item ${n.seen ? '' : 'new'}" ${n.id ? `data-open="${esc(n.id)}"` : ''} style="width:100%;text-align:left">
      <span class="ic">${{ div: '💵', order: '🧾', option: '🎟️', alert: '🔔', card: '🃏', trophy: '🏆', pick: '🎯', info: '📈', level: '⭐', goal: '✅', contest: '🏟️', prop: '🎲', season: '🏁', booster: '⚡', market: '🏷️' }[n.kind] || '•'}</span>
      <div class="grow">${esc(n.text)}<div class="tiny faint">${timeAgo(n.t)}</div></div></button>`).join('')
      || '<div class="empty">Fills, dividends, option expiries and price alerts show up here.</div>'}</div>

    <h2>Dividends</h2>
    <div class="list"><label class="toggle"><span>Reinvest dividends automatically<div class="tiny faint">Buys more of whatever paid you, no fees</div></span>
      <span class="switch"><input type="checkbox" id="drip" ${state.settings.drip ? 'checked' : ''}><span></span></span></label></div>

    ${state.recurring.length ? `<h2>Recurring investments</h2><div class="list">${state.recurring.map((r) => `<div class="item">
      <div class="grow" data-open="${r.assetId}"><div class="name">${money(r.amount)} of ${esc(r.ticker)} ${r.freq}</div><div class="sub">Next: ${fmtDateTime(r.next)}</div></div>
      <button class="x-btn" data-cancelrec="${r.id}" aria-label="Stop recurring buy">✕</button></div>`).join('')}</div>` : ''}

    ${state.alerts.length ? `<h2>Price alerts</h2><div class="list">${state.alerts.map((al) => `<div class="item">
      <div class="grow" data-open="${al.assetId}"><div class="name">${esc(al.ticker)} ${al.dir} ${money(al.price)}</div><div class="sub">Now ${money(state.assets[al.assetId]?.price || 0)}</div></div>
      <button class="x-btn" data-rmalert="${al.id}" aria-label="Remove alert">✕</button></div>`).join('')}</div>` : ''}

    <h2>History</h2>
    <div class="chips">${[['all', 'All'], ['trade', 'Stocks'], ['option', 'Options'], ['div', 'Dividends']].map(([k, n]) => `<button class="chip ${ui.actFilter === k ? 'on' : ''}" data-actf="${k}">${n}</button>`).join('')}</div>
    <div class="list" style="margin-top:8px">${activityItems().map(activityRow).join('') || '<div class="empty">Nothing here yet.</div>'}</div>

    <h2>Leagues</h2>
    <div class="list">${Object.values(LEAGUES).map((L) => `<label class="toggle"><span>${lgTag(L.key)} &nbsp;${L.name} <span class="tiny faint">${state.sync[L.key]?.seeded ? 'loaded' : 'not loaded'}</span></span>
      <span class="switch"><input type="checkbox" data-lgtoggle="${L.key}" ${state.settings.leagues[L.key] ? 'checked' : ''}><span></span></span></label>`).join('')}</div>

    ${STATIC ? `<h2>About this version</h2>
    <div class="card small muted">This version runs on a snapshot of real ESPN data taken ${fmtDateTime(window.STATIC_SNAPSHOT.fetched)}. Prices keep trading on the tape and your portfolio is saved on this device.</div>` : `<h2>Data connection</h2>
    <div class="card">
      <div class="small muted">Scores, stats, injuries and news come from ESPN's public feeds, straight from your phone. If your browser blocks them, deploy the free proxy (proxy-worker.js in the repo) and paste its URL here.</div>
      <label class="field"><input type="url" id="proxy" placeholder="https://your-proxy.workers.dev" value="${esc(state.settings.proxy)}" autocapitalize="off" autocorrect="off"></label>
      <div class="btn-row"><button class="btn ghost" data-act="saveproxy">Save</button><button class="btn ghost" data-act="test">Test connection</button></div>
      <div class="tiny muted" id="testout" style="margin-top:8px">${netStats.lastError ? 'Last error: ' + esc(netStats.lastError) : ''}</div>
    </div>`}

    <h2>How it works</h2>
    <div class="list">
      <details><summary>Prices</summary><div class="prose">
        <p><b>Players</b> are valued on how good they are compared with others at their position: this season's stats blended with last season's, then updated after every game. Each standard deviation of performance roughly doubles the price, so superstars cost many times more than role players.</p>
        <p>A game only moves a price by how much it <b>beat or missed that player's usual level</b>. A star playing like a star stays put; a role player's breakout game jumps. <b>Teams</b> start from last season's record (regressed toward .500) and shift as this season's wins, losses and point differential come in.</p>
        <p><b>Market hype</b> is a slow random drift on top of everything, like a real market's mood, so nothing is a sure thing.</p>
        <p><b>Star premium:</b> the top 10% of players in each league (ranked at the start of the season) carry up to a 4× premium, so household names are the expensive ones in every sport. <b>Teams</b> are the blue chips: a .500 team is about $1,000 a share.</p>
        <p><b>Injuries</b> cut a player's price (Day-to-day −4%, Questionable −5%, Out −20%, IR −28%) and weigh on their team. <b>News</b> is scored for sentiment and nudges price for a few days. <b>Your trades</b> move the price too, and you pay a 0.35% spread.</p>
      </div></details>
      <details><summary>Dividends</summary><div class="prose">
        <p><b>Teams</b> pay after every win, more for upsets: a coin-flip win pays NBA 0.25%, NFL 1.5%, MLB 0.12% of the share price; a heavy favorite's win pays less and an underdog's more. <b>Players</b> pay after games that beat their own usual level, so stars and role players yield about the same. Milestone games (40 points, 3 homers, 5 TD passes…) pay a 0.4% special dividend.</p>
        <p>You must own the shares <b>before the game starts</b>. Index funds pass through the dividends of everything they hold.</p>
      </div></details>
      <details><summary>Options</summary><div class="prose">
        <p>Each contract covers <b>100 shares</b>. A <b>call</b> pays off if the price finishes above the strike; a <b>put</b> if it finishes below. Contracts expire Fridays at 4pm New York time and settle in cash automatically.</p>
        <p>Prices mostly jump when a game's box score comes in, so premiums are built from <b>game risk</b>: every game before expiry counts as a possible move sized from that player's or team's own recent games, plus a little for news and injuries. Premiums rise into game day and drop once the game is played. You can buy to open and sell to close any time before expiry. The most you can lose is what you paid.</p>
      </div></details>
      <details><summary>Moment cards & Marketplace</summary><div class="prose">
        <p><b>Moment cards</b> are real plays from recent games: home runs, dunks, touchdowns and monster box-score nights. Each has a <b>play rating</b> (late, close and go-ahead plays rate higher), which sets its rarity from Common to Iconic.</p>
        <p>A card only works on the player who made the play. Turn it on while you own his shares and it boosts your earnings from him: <b>Dividend</b> cards raise his dividends, <b>Game Day</b> cards pay a bonus when his games lift the price, and <b>Shields</b> give back part of the loss when they drop it. Each of his games uses one charge.</p>
        <p>In the <b>Marketplace</b>, other collectors auction cards. Bids are max bids: if yours is the highest when time runs out, you win and pay just above the next bidder. You can also buy now, or list your own cards.</p>
      </div></details>
      <details><summary>Orders</summary><div class="prose">
        <p><b>Market</b> orders fill now, in shares or dollars (fractional shares). <b>Limit</b> orders fill only at your price or better. <b>Stop</b> orders become market orders once the price crosses your stop, so they work as a stop-loss. <b>Recurring</b> buys invest a fixed amount daily or weekly. Orders are checked every few seconds while the app is open, and when you reopen it.</p>
      </div></details>
    </div>

    ${STATIC ? '' : `<h2>Backup</h2>
    <div class="btn-row"><button class="btn ghost" data-act="export">Export</button><label class="btn ghost">Import<input type="file" id="importfile" accept="application/json" hidden></label></div>`}

    <h2>Reset</h2>
    <div class="small muted" style="margin-bottom:8px">Starting balance for a fresh portfolio</div>
    <div class="seg" style="margin-bottom:10px">${START_OPTIONS.map((v) => `<button data-startcash="${v}" class="${state.settings.startCash === v ? 'on' : ''}">${money(v).replace('.00', '')}</button>`).join('')}</div>
    <div class="btn-row"><button class="btn ghost" data-act="resetcharts">Restart price charts</button></div>
    <div class="btn-row"><button class="btn danger" data-act="resetpf">Reset to ${money(state.settings.startCash).replace('.00', '')}</button><button class="btn danger" data-act="resetall">Reset everything</button></div>
    <p class="tiny faint" style="margin-top:18px;text-align:center">StatStreet version ${APP_VERSION} · Play money only. Not affiliated with ESPN, the NBA, NFL or MLB.</p>
    <p class="tiny faint" style="text-align:center" id="diag">${screenDiag()}</p>`;
  if (ui.scrollTo) { const el = document.getElementById(ui.scrollTo); ui.scrollTo = null; if (el) el.scrollIntoView(); }
  for (const n of state.inbox) n.seen = true;
  dirty = true;
}

// ---------- Games tab (Real-style): daily reward, Pick'em, live games, leaderboard, cards, trophies ----------

const teamAsset = (lg, id) => state.assets[`${lg}:t:${id}`];
const rarRank = (r) => RARITY.findIndex((x) => x.key === r?.key);

function rarChip(a) {
  const r = rarity(state, a);
  if (!r) return '';
  const lv = cardLevel(state, a.id);
  return `<span class="rar ${r.key}" style="--rc:${r.color}">${r.name}${lv ? ` · Lv ${lv}` : ''}</span>`;
}

function miniCard(a) {
  const r = rarity(state, a);
  const lv = cardLevel(state, a.id);
  return `<button class="pcard ${r.key}" style="--rc:${r.color}" data-open="${a.id}"><div class="in">
    ${avatar(a)}<div class="pc-name ellipsis">${esc(a.kind === 'team' ? a.ticker : a.name.split(' ').slice(-1)[0])}</div>
    <div class="pc-rar">${r.name}</div>${lv ? `<div class="pc-lv">Lv ${lv}</div>` : ''}</div></button>`;
}

function dailyCard() {
  const d = dailyStatus(state);
  const done = d.claimed ? d.streak : d.nextStreak - 1; // days already banked in the current run
  const pivot = d.claimed ? done : done + 1;
  const week = Math.floor(Math.max(0, pivot - 1) / 7) * 7;
  const dots = DAILY_REWARDS.map((_, i) => {
    const day = week + i + 1;
    const amt = dailyAmount(state, day);
    const cl = day <= done ? 'got' : !d.claimed && day === done + 1 ? 'next' : '';
    return `<div class="dd ${cl}"><div class="c">${day <= done ? '✓' : amt < 1 ? `${Math.round(amt * 100)}¢` : '$' + amt}</div><div class="tiny faint">Day ${day}</div></div>`;
  }).join('');
  const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
  const hrs = Math.max(0, (midnight - Date.now()) / HOUR);
  return `<div class="card daily">
    <div class="row between"><div><div class="name">Daily reward</div><div class="tiny muted">${d.streak ? `🔥 ${d.streak}-day streak` : 'Open the app every day to build a streak'}</div></div>
    ${d.claimed ? `<div class="tiny muted" style="text-align:right">Next in ${hrs < 1 ? Math.round(hrs * 60) + 'm' : Math.floor(hrs) + 'h'}</div>`
      : `<button class="btn buy small" data-act="claim">Claim ${money(d.reward)}</button>`}</div>
    <div class="dots">${dots}</div></div>`;
}

function pickButton(g, t, other) {
  const p = winProb(state, g.league, t.id, other.id, !!t.home, !!g.preseason);
  const pk = state.picks[g.id];
  const on = pk && pk.teamId === t.id;
  const ta = teamAsset(g.league, t.id);
  const reward = scaledPickReward(state, p);
  return `<button class="pick-btn ${on ? 'on' : ''} ${pk && !on ? 'off' : ''}" data-pick="${g.league}|${g.id}" data-team="${t.id}">
    ${ta ? avatar(ta) : ''}<div class="grow"><div class="name">${esc(t.abbr)}</div><div class="tiny muted">${Math.round(p * 100)}% win</div></div>
    <div class="pay">${on ? '✓ ' : ''}+$${(on ? pickPayout(state, pk) : Math.round(reward * pickStreakMult(state.pickStats.streak) * 100) / 100).toFixed(2)}</div></button>`;
}

function pickGame(g) {
  const away = g.teams.find((t) => !t.home) || g.teams[0];
  const home = g.teams.find((t) => t !== away);
  return `<div class="pick-game">
    <div class="pg-head">${lgTag(g.league)}<span class="tiny muted">${fmtDateTime(g.date)}${g.preseason ? ' · preseason' : ''}</span>
      <button class="tiny link" data-game="${g.league}|${g.id}">Preview ›</button></div>
    <div class="pg-teams">${pickButton(g, away, home)}<span class="at">@</span>${pickButton(g, home, away)}</div></div>`;
}

function resultRow(r) {
  const pk = state.picks[r.id];
  const badge = pk?.result === 'won' ? `<span class="pk won">+${money(pk.paid || 0)}</span>` : pk?.result === 'lost' ? '<span class="pk lost">Miss</span>'
    : pk?.result === 'push' ? '<span class="pk">Push</span>' : '';
  return `<button class="item" data-game="${r.league}|${r.id}">${lgTag(r.league)}
    <div class="grow score-line">${r.teams.map((t) => `<span class="${t.winner ? '' : 'muted'}"><b>${esc(t.abbr)}</b> ${t.score}</span>`).join('<span class="faint">·</span>')}</div>
    ${badge}<span class="tiny faint">${fmtDate(r.date)}</span></button>`;
}

// ---------- Games tab: career header + Season / Contests / Props / Pick'em / Locker ----------

const GTABS = [['season', 'Season'], ['contests', 'Contests'], ['props', 'Props'], ['pickem', "Pick'em"], ['locker', 'Locker']];
const coinFmt = (n) => Math.round(n).toLocaleString();
const daysLeft = (t) => { const d = (t - Date.now()) / DAY; return d >= 1 ? `${Math.ceil(d)} days left` : `${Math.max(1, Math.round(d * 24))}h left`; };
const pctTxt = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

function tierBadge(tier, size = 44) {
  return `<div class="tier-badge" style="--tc:${tier.color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${tier.name[0]}</div>`;
}

function careerHeader() {
  const p = xpProgress(state);
  const c = career(state);
  const s = state.season;
  const ret = seasonReturn(state);
  const tier = tierFor(ret);
  return `<div class="career card">
    <div class="lvl"><b>${p.level}</b><span>LEVEL</span></div>
    <div class="grow">
      <div class="row between"><div class="name ellipsis">${esc(c.title)}</div><button class="coins" data-gtab="locker">🪙 ${coinFmt(c.coins)}</button></div>
      <div class="xpbar"><i style="width:${Math.round(p.frac * 100)}%"></i></div>
      <div class="tiny muted row between"><span>${p.into} / ${p.need} XP</span><span>${UNLOCKS[p.level + 1] ? `Lv ${p.level + 1}: ${esc(UNLOCKS[p.level + 1])}` : ''}</span></div>
    </div></div>
    ${s ? `<button class="season-strip" data-gtab="season" style="--tc:${tier.color}"><span class="dot"></span>Season ${s.n} · <b>${tier.name}</b> · <span class="${cls(ret)}">${pctTxt(ret)}</span><span class="grow"></span><span class="muted">${daysLeft(s.end)}</span></button>` : ''}`;
}

function renderGames() {
  ui.gtab ||= 'season';
  const body = { season: gamesSeason, contests: gamesContests, props: gamesProps, pickem: gamesPickem, locker: gamesLocker }[ui.gtab]();
  $('#view').innerHTML = `
    ${topbar('<h1>Games</h1>')}
    ${careerHeader()}
    <div class="chips gtabs" style="margin-top:12px">${GTABS.map(([k, n]) => `<button class="chip ${ui.gtab === k ? 'on' : ''}" data-gtab="${k}">${n}</button>`).join('')}</div>
    ${body}`;
}

// --- Season ---
function gamesSeason() {
  const now = Date.now();
  const s = state.season;
  const ret = seasonReturn(state, now);
  const tier = tierFor(ret); const next = nextTier(ret);
  const lo = Number.isFinite(tier.min) ? tier.min : Math.min(ret, -0.1);
  const frac = next ? clamp((ret - lo) / (next.min - lo), 0, 1) : 1;
  const w = state.week;
  const board = leaderboard(state, now);
  const c = career(state);
  const got = Object.keys(state.trophies).length;
  return `
    <div class="card season-card" style="--tc:${tier.color};margin-top:12px">
      <div class="row">${tierBadge(tier, 54)}<div class="grow"><div class="tiny muted">SEASON ${s.n} · ${daysLeft(s.end).toUpperCase()}</div>
        <div class="name" style="font-size:20px">${tier.name}</div>
        <div class="small"><span class="${cls(ret)}">${pctTxt(ret)}</span> <span class="muted">since ${fmtDate(s.start)}</span></div></div></div>
      <div class="tierbar"><i style="width:${frac * 100}%"></i></div>
      <div class="tiny muted">${next ? `${pctTxt(next.min - ret).replace('+', '')} more to reach <b style="color:${next.color}">${next.name}</b> (${next.coins} coins at season end)` : 'Top tier! Hold it to the end of the season.'}</div>
      <div class="tiers">${TIERS.map((t) => `<div class="${t.key === tier.key ? 'on' : ''}" style="--tc:${t.color}"><i></i><span>${t.name}</span><small>${Number.isFinite(t.min) ? pctTxt(t.min).replace('.0', '') : '<0%'}</small></div>`).join('')}</div>
      <div class="tiny faint" style="margin-top:8px">When the season ends you get coins and XP for your tier (+100 more if you top the leaderboard), then everyone restarts with a fresh bankroll: ${money(seasonBalance(state))} at your level.</div>
    </div>

    ${dailyCard()}

    <h2>Weekly goals <span class="faint small">resets Monday</span></h2>
    <div class="list">${w.goals.map((g) => { const def = GOALS.find((x) => x.key === g.key); return `<div class="item goal ${g.done ? 'done' : ''}">
      <div class="check">${g.done ? '✓' : ''}</div><div class="grow"><div class="name">${esc(def.text)}</div><div class="sub">+${def.coins} coins · +${def.xp} XP</div></div></div>`; }).join('')}</div>

    <h2>Leaderboard</h2>
    <p class="small muted" style="margin:-4px 0 10px">This season's return vs. strategy bots.</p>
    <div class="list">${board.map((r, i) => `<div class="item lb ${r.you ? 'you' : ''}"><div class="rank">${i + 1}</div>
      <div class="grow"><div class="name">${r.you ? `You <span class="tag">${esc(c.title)}</span>` : esc(r.name)}</div><div class="sub ellipsis">${esc(r.style)}</div></div>
      <div class="price ${cls(r.ret)}">${fmtPct(r.ret)}</div></div>`).join('')}</div>

    ${c.seasons.length ? `<h2>Past seasons</h2><div class="list">${c.seasons.slice(0, 8).map((r) => { const t = TIERS.find((x) => x.key === r.tier); return `<div class="item">${tierBadge(t, 34)}
      <div class="grow"><div class="name">Season ${r.n} · ${t.name}</div><div class="sub">${fmtDate(r.start)} – ${fmtDate(r.end)} · ${ordinal(r.rank)} of ${r.of}</div></div>
      <div class="price-col"><div class="price ${cls(r.ret)}">${pctTxt(r.ret)}</div><div class="tiny muted">+${r.coins} 🪙</div></div></div>`; }).join('')}</div>` : ''}

    <h2>Trophies <span class="faint small">${got}/${TROPHIES.length} · +25 coins each</span></h2>
    <div class="trophies">${TROPHIES.map((t) => `<div class="trophy ${state.trophies[t.id] ? 'got' : ''}"><div class="ic">${t.icon}</div>
      <div class="t">${esc(t.name)}</div><div class="d">${esc(t.desc)}</div></div>`).join('')}</div>`;
}

// --- Contests ---
function gamesContests() {
  const now = Date.now();
  const lgs = enabledLeagues();
  const avail = availableContests(state, now, lgs);
  const mine = Object.values(state.contests || {}).sort((x, y) => y.entered - x.entered);
  const live = mine.filter((c) => !c.done);
  const past = mine.filter((c) => c.done).slice(0, 8);
  const byLg = {};
  for (const x of avail) (byLg[x.league] ||= []).push(x);
  return `
    <p class="small muted" style="margin:12px 0 10px">Draft 5 players under the salary cap and score their real game scores until Sunday night. You face 5 bots: <b>1st pays 3×</b> your entry, 2nd 1.8×, 3rd gets it back.</p>
    ${live.length ? `<h2 style="margin-top:6px">Your contests</h2>${live.map(contestCard).join('')}` : ''}
    <h2 style="margin-top:${live.length ? 26 : 6}px">This week</h2>
    ${Object.keys(byLg).length ? Object.entries(byLg).map(([lg, list]) => `<div class="card contest-lg">
      <div class="row between">${lgTag(lg)}<span class="tiny muted">Cap ${money(list[0].cap).replace('.00', '')} · ends Sun night</span></div>
      ${list.map((x) => `<div class="ctier"><div class="grow"><div class="name">${x.tier.name}</div><div class="tiny muted">Entry ${money(x.fee)} · 1st wins ${money(x.fee * 3)}</div></div>
        ${x.entered ? `<span class="pk">Entered</span>` : x.locked ? `<span class="pk">🔒 Lv ${x.tier.level}</span>` : `<button class="btn buy small" data-draft="${lg}|${x.tier.key}">Draft</button>`}</div>`).join('')}
    </div>`).join('') : '<div class="card empty">Contests open Monday and close a few hours before the week ends.</div>'}
    ${past.length ? `<h2>Results</h2><div class="list">${past.map((c) => `<div class="item">${lgTag(c.league)}<div class="grow"><div class="name">${CONTEST_TIERS.find((t) => t.key === c.tier)?.name} · ${ordinal(c.place)} of 6</div>
      <div class="sub">Week of ${fmtDate(c.entered)} · ${c.pts.toFixed(1)} pts</div></div><div class="price ${c.payout > c.fee ? 'up' : c.payout ? '' : 'down'}">${c.payout ? '+' + money(c.payout) : '−' + money(c.fee)}</div></div>`).join('')}</div>` : ''}`;
}

function contestCard(c) {
  const rows = standings(c);
  const place = rows.findIndex((r) => r.you) + 1;
  const tier = CONTEST_TIERS.find((t) => t.key === c.tier);
  return `<div class="card contest">
    <div class="row between"><div class="row" style="gap:6px">${lgTag(c.league)}<b>${tier.name}</b></div><span class="tiny muted">${daysLeft(c.end)}</span></div>
    <div class="row between" style="margin-top:8px"><div><div class="big-pct">${ordinal(place)}</div><div class="tiny muted">of 6 · ${c.pts.toFixed(1)} pts</div></div>
      <div class="tiny muted" style="text-align:right">If it ended now:<br><b class="${PAYOUT[place - 1] ? 'up' : 'down'}">${PAYOUT[place - 1] ? money(c.fee * PAYOUT[place - 1]) : 'no payout'}</b></div></div>
    <div class="stand">${rows.map((r, i) => `<div class="${r.you ? 'you' : ''}"><span>${i + 1}. ${esc(r.name)}</span><b>${r.pts.toFixed(1)}</b></div>`).join('')}</div>
    <div class="lineup">${c.lineup.map((id) => { const a = state.assets[id]; return a ? `<button data-open="${id}">${avatar(a)}<span class="ellipsis">${esc(a.name.split(' ').slice(-1)[0])}</span><b>${(c.ppts[id] || 0).toFixed(1)}</b></button>` : ''; }).join('')}</div>
  </div>`;
}

// Draft sheet
function openDraft(league, tier) {
  ui.draft = { league, tier, picks: [], q: '' };
  const el = $('#draft');
  try { history.pushState({ draft: 1 }, ''); } catch { /* */ }
  renderDraft();
  el.scrollTop = 0;
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
}
function closeDraft({ animate = true } = {}) {
  ui.draft = null;
  const el = $('#draft');
  const finish = () => { if (ui.draft) return; el.hidden = true; el.innerHTML = ''; $('#dfoot').hidden = true; const y = view().scrollTop; render(); view().scrollTop = y; };
  if (animate && !el.hidden) slideOut(el, 'x', finish, [$('#dfoot')]); else finish();
}
function renderDraft(keepList = false) {
  const d = ui.draft; const el = $('#draft');
  const tier = CONTEST_TIERS.find((t) => t.key === d.tier);
  const cap = salaryCap(state, d.league);
  const fee = entryFee(state, tier);
  const pool = draftPool(state, d.league);
  const used = d.picks.reduce((s, id) => s + salary(state.assets[id]), 0);
  const left = cap - used;
  const q = d.q.trim().toLowerCase();
  const list = pool.filter((a) => !q || a.name.toLowerCase().includes(q) || (a.teamAbbr || '').toLowerCase() === q);
  const slotsLeft = LINEUP - d.picks.length;
  const cheapest = [...pool].filter((a) => !d.picks.includes(a.id)).map(salary).sort((x, y) => x - y);
  const reserve = (n) => cheapest.slice(0, n).reduce((s, x) => s + x, 0);
  const ng = (a) => nextGame(a);
  const rowHTML = (a) => {
    const on = d.picks.includes(a.id);
    const fits = on || (slotsLeft > 0 && salary(a) + reserve(slotsLeft - 1) <= left);
    const g = ng(a);
    return `<button class="item draft-row ${on ? 'on' : ''} ${fits ? '' : 'nofit'}" data-dpick="${a.id}">${avatar(a)}
      <div class="grow"><div class="name ellipsis">${esc(a.name)}</div><div class="sub">${esc(a.teamAbbr || '')} · ${esc(a.pos || '')} · avg ${a.perf.ema.toFixed(1)} pts${g ? ` · next ${fmtDate(g.date, { weekday: 'short' })}` : ''}</div></div>
      <div class="sal">$${salary(a)}</div><div class="pickbox">${on ? '✓' : '+'}</div></button>`;
  };
  if (keepList && $('#dlist')) {
    $('#dlist').innerHTML = list.map(rowHTML).join('') || '<div class="empty">No players match.</div>';
    $('#dhead').innerHTML = draftHead();
    $('#dfoot').innerHTML = draftFoot();
    return;
  }
  function draftHead() {
    return `<div class="capbar"><i style="width:${clamp(used / cap, 0, 1) * 100}%" class="${left < 0 ? 'over' : ''}"></i></div>
      <div class="row between small"><span><b>${d.picks.length}/${LINEUP}</b> picked</span><span class="${left < 0 ? 'down' : 'muted'}">$${left.toLocaleString()} left of $${cap.toLocaleString()}</span></div>
      <div class="picked">${d.picks.map((id) => { const a = state.assets[id]; return `<button data-dpick="${id}">${esc(a.name.split(' ').slice(-1)[0])} ✕</button>`; }).join('')}</div>`;
  }
  function draftFoot() {
    return `<div class="err" id="derr">${esc(d.err || '')}</div><button class="btn buy" data-act="enterdraft" ${d.picks.length === LINEUP ? '' : 'disabled'}>Enter for ${money(fee)}</button>`;
  }
  el.hidden = false;
  el.innerHTML = `<div class="sheet-inner">
    <div class="row between"><button class="icon-btn" data-act="draftback" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div class="row" style="gap:6px">${lgTag(d.league)}<b>${tier.name} contest</b></div><div style="width:38px"></div></div>
    <p class="small muted" style="margin:10px 0">Pick ${LINEUP} players. Points are their real game scores from now until Sunday night, so players with more games this week score more.</p>
    <div id="dhead">${draftHead()}</div>
    <input class="search" id="dq" type="search" placeholder="Search players or team (e.g. LAL)" value="${esc(d.q)}" autocomplete="off" style="margin-top:10px">
    <div class="list" id="dlist" style="margin-top:8px">${list.map(rowHTML).join('')}</div>
  </div>`;
  const foot = $('#dfoot'); foot.hidden = false; foot.innerHTML = draftFoot();
}

// --- Props ---
function gamesProps() {
  const now = Date.now();
  const board = propBoard(state, now, enabledLeagues());
  ui.slip ||= { legs: [], stake: '' };
  const slip = ui.slip;
  slip.legs = slip.legs.filter((l) => l.date > now);
  const max = MAX_LEGS(state);
  const bets = (state.props || []).slice(0, 25);
  const open = bets.filter((b) => b.status === 'open');
  const done = bets.filter((b) => b.status !== 'open').slice(0, 10);
  const byGame = {};
  for (const p of board) (byGame[p.gameId] ||= { name: p.game, date: p.date, league: p.league, list: [] }).list.push(p);
  const stake = Number(slip.stake) || 0;
  return `
    <p class="small muted" style="margin:12px 0 10px">Over or under on tonight's real stat lines. A hit pays ${PROP_ODDS}× your stake${max > 1 ? `; parlays of up to ${max} picks multiply (2 picks ${(PROP_ODDS ** 2).toFixed(2)}×, 3 picks ${(PROP_ODDS ** 3).toFixed(2)}×)` : '; parlays unlock at level 4'}.</p>
    ${slip.legs.length ? `<div class="card slip">
      <div class="row between"><b>Bet slip</b><span class="tiny muted">${slip.legs.length} pick${slip.legs.length > 1 ? 's' : ''} · ${(PROP_ODDS ** slip.legs.length).toFixed(2)}×</span></div>
      ${slip.legs.map((l, i) => `<div class="slip-leg"><div class="grow"><b>${esc(state.assets[l.assetId]?.name || '')}</b> <span class="muted">${l.side === 'over' ? 'Over' : 'Under'} ${l.line} ${esc(l.short)}</span></div><button class="x-btn" data-rmleg="${i}">✕</button></div>`).join('')}
      <div class="row" style="margin-top:10px;gap:8px"><label class="price-field grow" style="margin:0"><span class="small muted">Stake $</span><input id="stake" inputmode="decimal" value="${esc(slip.stake)}" placeholder="0"></label>
        <button class="chip" data-stake="${minOrder(state)}">${money(minOrder(state))}</button><button class="chip" data-stake="10%">10%</button><button class="chip" data-stake="25%">25%</button></div>
      <div class="row between small" style="margin-top:8px"><span class="muted">Pays</span><b class="up" id="slippay">${money(potentialPayout(stake, slip.legs.length))}</b></div>
      <div class="err" id="slerr">${esc(slip.err || '')}</div>
      <button class="btn buy" data-act="placebet">Place bet</button>
    </div>` : ''}
    ${open.length ? `<h2>Open bets</h2><div class="list">${open.map(betRow).join('')}</div>` : ''}
    <h2>Tonight's props</h2>
    ${Object.values(byGame).length ? Object.values(byGame).sort((x, y) => x.date - y.date).map((g) => `<div class="card props-game">
      <div class="row between">${lgTag(g.league)}<span class="tiny muted">${esc(g.name)} · ${fmtDateTime(g.date)}</span></div>
      ${g.list.map((p) => { const a = state.assets[p.assetId]; const sel = slip.legs.find((l) => l.assetId === p.assetId); return `<div class="prop-row">
        <button class="grow row" data-open="${p.assetId}" style="gap:10px;text-align:left;min-width:0">${avatar(a)}<div class="grow" style="min-width:0"><div class="name ellipsis">${esc(a.name)}</div><div class="sub">${esc(p.label)}</div></div></button>
        <button class="ou ${sel?.side === 'over' ? 'on' : ''}" data-prop="${p.key}|over"><small>Over</small>${p.line}</button>
        <button class="ou ${sel?.side === 'under' ? 'on' : ''}" data-prop="${p.key}|under"><small>Under</small>${p.line}</button></div>`; }).join('')}
    </div>`).join('') : '<div class="card empty">No props right now — they open about a day before games.</div>'}
    ${done.length ? `<h2>Settled</h2><div class="list">${done.map(betRow).join('')}</div>` : ''}`;
}

function betRow(b) {
  const name = (l) => state.assets[l.assetId]?.ticker || '?';
  const st = { open: ['', 'Open'], won: ['up', `Won ${money(b.payout)}`], lost: ['down', 'Lost'], void: ['', 'Void'] }[b.status];
  return `<div class="item"><div class="grow"><div class="name">${b.legs.length > 1 ? `${b.legs.length}-pick parlay` : `${esc(name(b.legs[0]))} ${b.legs[0].side} ${b.legs[0].line}`}</div>
    <div class="sub ellipsis">${b.legs.map((l) => `${esc(name(l))} ${l.side === 'over' ? 'o' : 'u'}${l.line} ${esc(l.short)}${l.actual != null ? ` (${l.actual})` : ''}${l.result === 'win' ? ' ✓' : l.result === 'loss' ? ' ✗' : ''}`).join(' · ')}</div></div>
    <div class="price-col"><div class="price ${st[0]}">${st[1]}</div><div class="tiny muted">${money(b.stake)} stake</div></div></div>`;
}

// --- Pick'em (moved from the old Games tab) ---
function gamesPickem() {
  const now = Date.now();
  const lgs = enabledLeagues();
  const lgOk = (lg) => lgs.includes(lg) && (ui.gamesLeague === 'all' || ui.gamesLeague === lg);
  const live = Object.entries(state.liveGames).filter(([, g]) => lgOk(g.league));
  const upcoming = upcomingPickGames(state, now, lgs.filter(lgOk));
  const limit = ui.pickLimit || 8;
  const results = (state.results || []).filter((r) => lgOk(r.league)).slice(0, 8);
  const ps = state.pickStats;
  const openPicks = Object.values(state.picks).filter((p) => !p.done).length;
  return `
    <div class="grid3" style="margin-top:12px">
      <div class="stat"><div class="k">Record</div><div class="v">${ps.w}-${ps.l}</div></div>
      <div class="stat"><div class="k">Win streak</div><div class="v">${ps.streak ? `🔥 ${ps.streak}` : '0'}</div></div>
      <div class="stat"><div class="k">Winnings</div><div class="v up">${money(ps.won || 0)}</div></div>
    </div>
    <div class="chips" style="margin-top:12px">${['all', ...lgs].map((l) => `<button class="chip ${ui.gamesLeague === l ? 'on' : ''}" data-gleague="${l}">${l === 'all' ? 'All leagues' : LEAGUES[l].name}</button>`).join('')}</div>
    ${live.length ? `<h2>Live now</h2><div class="live-strip">${live.map(([id, g]) => `
      <button class="game" data-game="${g.league}|${id}" style="text-align:left">${lgTag(g.league)} <span class="tag live">LIVE</span>
        ${g.teams.map((t) => `<div class="t"><span>${esc(t.abbr)}</span><span>${t.score}</span></div>`).join('')}
        <div class="tiny muted">${esc(g.detail)}</div></button>`).join('')}</div>` : ''}
    <h2>Pick winners${upcoming.length ? ` <span class="faint small">${upcoming[0].date >= addDays(new Date(now).setHours(0, 0, 0, 0), 2) ? `next games ${fmtDate(upcoming[0].date, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'today & tomorrow'}</span>` : ''}</h2>
    <p class="small muted" style="margin:-4px 0 10px">Free to play. Underdogs pay more, and every win in a row adds 10% (up to 2x).${openPicks ? ` You have ${openPicks} open pick${openPicks > 1 ? 's' : ''}.` : ''}${ps.streak ? ` Next win pays <b class="up">${pickStreakMult(ps.streak).toFixed(1)}x</b>.` : ''}</p>
    ${upcoming.length ? upcoming.slice(0, limit).map(pickGame).join('') + (upcoming.length > limit ? `<button class="more" data-act="morepicks">More games (${upcoming.length - limit})</button>` : '')
      : '<div class="card empty">No games on the schedule yet. Check back soon.</div>'}
    ${results.length ? `<h2>Recent results</h2><div class="list">${results.map(resultRow).join('')}</div>` : ''}`;
}

// --- Locker: shop, cards, themes, titles ---
function gamesLocker() {
  const c = career(state);
  const L = xpProgress(state).level;
  const cards = Object.keys(state.collection).map((id) => state.assets[id]).filter((a) => a && a.kind !== 'fund')
    .sort((x, y) => rarRank(rarity(state, x)) - rarRank(rarity(state, y)) || cardLevel(state, y.id) - cardLevel(state, x.id));
  return `
    <div class="row between" style="margin-top:14px"><h2 style="margin:0">Moment packs</h2><span class="coins big">🪙 ${coinFmt(c.coins)}</span></div>
    <p class="small muted" style="margin:6px 0 10px">Packs hold real plays from recent games. Earn coins from season tiers, weekly goals, trophies, contests and level-ups, or by selling cards in the Marketplace.</p>
    <div class="packs">${B_PACKS.map((p) => { const locked = L < p.level; return `<button class="pack ${p.key} ${locked ? 'locked' : ''}" data-bpack="${p.key}">
      <div class="pk-name">${p.name}</div><div class="tiny">${p.blurb}</div><div class="pk-cost">${locked ? `🔒 Level ${p.level}` : `🪙 ${p.cost}`}</div></button>`; }).join('')}</div>

    ${boostersSection()}

    <h2>Your player cards <span class="faint small">${cards.length}</span></h2>
    <p class="small muted" style="margin:-4px 0 10px">You collect a player's card by owning his shares. Card levels add +5% dividends each.</p>
    ${cards.length ? `<div class="card-grid">${cards.slice(0, ui.allCards ? 999 : 12).map(miniCard).join('')}</div>
      ${cards.length > 12 && !ui.allCards ? `<button class="more" data-act="allcards">See all ${cards.length}</button>` : ''}`
      : '<div class="card empty">No cards yet. Buy a player or open a pack.</div>'}

    <h2>Themes</h2>
    <div class="themes">${THEMES.map((t) => { const own = c.owned.themes.includes(t.key); const on = c.theme === t.key; const locked = L < t.level; return `<button class="theme ${on ? 'on' : ''}" data-theme="${t.key}" style="--ta:${t.accent};--tb:${t.bg || '#0b0d10'}">
      <div class="sw"><i></i></div><div class="t">${t.name}</div><div class="tiny muted">${on ? 'In use' : own ? 'Tap to use' : locked ? `🔒 Lv ${t.level}` : `🪙 ${t.cost}`}</div></button>`; }).join('')}</div>

    <h2>Titles</h2>
    <p class="small muted" style="margin:-4px 0 10px">Shown on the leaderboard and your share card.</p>
    <div class="list">${TITLES.map((t) => { const own = c.owned.titles.includes(t.key); const on = c.title === t.key; const locked = L < t.level; return `<div class="item">
      <div class="grow"><div class="name">${esc(t.key)}</div><div class="sub">${locked ? `Unlocks at level ${t.level}` : own ? 'Owned' : `${t.cost} coins`}</div></div>
      ${on ? '<span class="pk won">Equipped</span>' : own ? `<button class="btn ghost small" data-title="${esc(t.key)}">Use</button>` : locked ? '<span class="pk">🔒</span>' : `<button class="btn buy small" data-title="${esc(t.key)}">🪙 ${t.cost}</button>`}</div>`; }).join('')}</div>`;
}

// Pack opening: cards face down, tap to flip each, best card last.
function showPack(cards, pack) {
  const el = $('#packview');
  ui.packView = { cards, flipped: 0 };
  el.hidden = false;
  el.innerHTML = `<div class="pv-inner"><div class="tiny muted">${esc(pack.name)}</div><h1 style="margin:4px 0 18px">Tap to reveal</h1>
    <div class="pv-cards">${cards.map((c, i) => { const a = state.assets[c.id]; return `<button class="pv-card" data-flip="${i}" style="--rc:${c.rarity.color}">
      <div class="pv-back">S</div>
      <div class="pv-front ${c.rarity.key}">${avatar(a)}<div class="pc-name ellipsis">${esc(a.kind === 'team' ? a.ticker : a.name)}</div>
        <div class="pc-rar">${c.rarity.name}</div><div class="tiny">${c.isNew ? 'NEW' : `Lv ${c.level}`}</div></div></button>`; }).join('')}</div>
    <button class="btn ghost" data-act="packdone" style="margin-top:22px;max-width:320px;width:100%">Reveal all</button></div>`;
}

function showRecap(rec) {
  const t = TIERS.find((x) => x.key === rec.tier);
  const el = $('#recap');
  el.hidden = false;
  el.innerHTML = `<div class="recap-card" style="--tc:${t.color}">
    <div class="tiny muted">SEASON ${rec.n} COMPLETE</div>
    ${tierBadge(t, 96)}
    <h1>${t.name}</h1>
    <div class="big-value ${cls(rec.ret)}" style="margin:0">${pctTxt(rec.ret)}</div>
    <div class="muted small">${ordinal(rec.rank)} of ${rec.of} on the leaderboard</div>
    <div class="recap-rows">
      <div><span>Coins earned</span><b>🪙 ${rec.coins}</b></div>
      <div><span>Final value</span><b>${money(rec.nw)}</b></div>
      ${rec.best ? `<div><span>Best holding</span><b>${esc(rec.best.name)} ${pctTxt(rec.best.ret)}</b></div>` : ''}
      <div><span>New bankroll</span><b>${money(state.season.bal)}</b></div>
    </div>
    <button class="btn buy" data-act="recapdone">Start Season ${rec.n + 1}</button>
  </div>`;
}

function applyTheme() {
  const t = themeOf(state);
  const r = document.documentElement.style;
  r.setProperty('--accent', t.accent);
  if (t.bg) r.setProperty('--bg', t.bg); else r.removeProperty('--bg');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.bg || '#0b0d10');
}

// ---------- moment cards UI ----------

const KIND_ICON = { 'HOME RUN': '⚾', 'GRAND SLAM': '👑', TRIPLE: '⚾', DOUBLE: '⚾', 'RBI SINGLE': '⚾', DUNK: '🏀', 'ALLEY-OOP': '🏀', '3-POINTER': '🎯', BUCKET: '🏀',
  'TD PASS': '🏈', 'TD RUN': '🏈', TOUCHDOWN: '🏈', 'DEFENSIVE TD': '🛡️', 'FIELD GOAL': '🥅' };
const fmtLeft = (ms) => { const m = Math.round(ms / 60e3); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${Math.max(0, m)}m`; };
const agoShort = (t) => { const s = (Date.now() - t) / 1000; if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`; if (s < 86400) return `${Math.round(s / 3600)}h`; if (s < 2592000) return `${Math.round(s / 86400)}d`; return `${Math.round(s / 2592000)}mo`; };
const cardName = (c) => `${c.m.player.name} ${c.m.kind.toLowerCase()}`;

function headshot(league, id, name, cls = '') {
  const a = state.assets[`${league}:p:${id}`];
  const ini = initials(name || '?');
  const src = a?.img || `https://a.espncdn.com/i/headshots/${league}/players/full/${id}.png`;
  if (STATIC) return `<span class="hs noimg ${cls}" data-ini="${ini}"></span>`;
  // Initials show only if the photo can't load (never behind a transparent headshot).
  return `<span class="hs ${cls}" data-ini="${ini}"><img src="${esc(src)}" alt="" decoding="async" onerror="this.parentNode.classList.add('noimg');this.remove()"></span>`;
}

// Older moments were stored in capitals; show them in sentence case.
const playText = (d = '') => (d === d.toUpperCase() ? d.toLowerCase().replace(/^([a-z])/, (x) => x.toUpperCase()) : d.charAt(0).toUpperCase() + d.slice(1));

// The card: StatStreet's "play slip". Rarity stripe, rating gauge, the player, the play
// as a quote, trait tags, a scoreboard line, and the boost it gives.
function momentCard(c, { mini = false } = {}) {
  const m = c.m; const r = bRarity(c.rarity);
  const traits = traitList(m);
  const sc = m.score || {};
  const t = bType(c.type);
  const pos = state.assets[`${m.league}:p:${m.player.id}`]?.pos;
  const sub = m.opp ? `vs ${m.opp.name}` : [m.player.team, pos].filter(Boolean).join(' · ');
  const d = new Date(m.date);
  return `<div class="mc r-${c.rarity} ${mini ? 'mini' : ''}" style="--rc:${r.color}">
    <div class="mc-head"><div style="min-width:0">
      <div class="mc-kicker">${lgTag(m.league)}${r.name}</div>
      <div class="mc-kind">${KIND_ICON[m.kind] ? `${KIND_ICON[m.kind]} ` : ''}${esc(m.kind)}</div></div>
      <div class="mc-gauge" style="--p:${Math.round(m.rating * 10)}"><b>${m.rating.toFixed(1)}</b><small>RATING</small></div></div>
    <div class="mc-who">${headshot(m.league, m.player.id, m.player.name)}<div class="grow"><b>${esc(m.player.name)}</b><span>${esc(sub)}</span></div></div>
    <div class="mc-play">${esc(playText(m.desc))}</div>
    <div class="mc-tags">${traits.map((x) => `<span>${x.icon} ${esc(x.label)}</span>`).join('')}</div>
    <div class="mc-board"><span class="sc">${esc(sc.away || '')} <b>${sc.a ?? ''}</b> · ${esc(sc.home || '')} <b>${sc.h ?? ''}</b></span><span class="sit">${esc(m.sit || '')}</span></div>
    <div class="mc-foot"><span class="boost">${t.icon} ${esc(describeShort(c))}${c.charges != null ? ` · ${c.charges}/${c.max}` : ''}</span>
      <span class="no">${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · No.${String(c.serial).padStart(3, '0')}</span></div>
  </div>`;
}

// ---- Locker: moment packs + your cards ----
function boostersSection() {
  const inv = boosterState(state).inv;
  const used = equipped(state).length;
  const counts = {};
  for (const b of inv) if (!b.on && !b.listed) counts[b.rarity] = (counts[b.rarity] || 0) + 1;
  const fusable = B_RARITY.slice(0, -1).filter((r) => (counts[r.key] || 0) >= 3);
  const sorted = [...inv].sort((x, y) => (y.on ? 1 : 0) - (x.on ? 1 : 0) || rIdx(y.rarity) - rIdx(x.rarity) || y.m.rating - x.m.rating);
  return `
    <div class="row between"><h2>Your moment cards <span class="faint small">${inv.length}</span></h2><span class="tiny muted">${used}/${slots(state)} active</span></div>
    <p class="small muted" style="margin:-4px 0 10px">Each card is a real play. Put it on that player (you need some of his shares) to boost your earnings from him. Each game he plays uses one charge. You get another slot every 3 levels.</p>
    ${fusable.length ? `<div class="card fuse">${fusable.map((r) => { const nx = B_RARITY[rIdx(r.key) + 1];
      return `<div class="row between"><span class="small">3 ${r.name} cards → your best one becomes <b style="color:${nx.color}">${nx.name}</b></span><button class="btn buy small" data-fuse="${r.key}">Fuse</button></div>`; }).join('')}</div>` : ''}
    ${inv.length ? `<div class="mc-grid">${sorted.map((b) => `<button class="mc-cell" data-booster="${b.id}">
      <div class="mc-status">${b.on ? `<span class="pk won">Active · ${esc(state.assets[b.on]?.ticker || '')}</span>` : b.listed ? '<span class="pk">On auction</span>' : '<span class="pk">Ready</span>'}</div>
      ${momentCard(b, { mini: true })}</button>`).join('')}</div>`
      : '<div class="card empty">No moment cards yet. Open a pack, or bid in the Marketplace.</div>'}`;
}

function openBoosterSheet(id) {
  ui.order = { mode: 'booster', id, len: '6h' };
  renderBoosterSheet();
  const panel = $('#panel');
  panel.classList.remove('enter'); void panel.offsetWidth; panel.classList.add('enter');
}

function renderBoosterSheet() {
  const o = ui.order;
  const b = boosterState(state).inv.find((x) => x.id === o.id);
  if (!b) { closeOrder(); return; }
  const wrap = $('#trade'); const panel = $('#panel');
  wrap.hidden = false;
  panel.style.setProperty('--acc', bRarity(b.rarity).color);
  const a = state.assets[b.assetId];
  const held = !!state.holdings[b.assetId];
  const au = b.listed ? myAuctions(state).find((x) => x.id === b.listed) : null;
  const av = au ? listingView(state, au) : null;
  const mv = marketValue(b);
  panel.innerHTML = `<div class="grabber"></div>
    <div class="mc-solo">${momentCard(b)}</div>
    <div class="small muted" style="text-align:center;margin:8px 0 2px">${esc(describe(b))}</div>
    ${au ? `<div class="card" style="margin-top:12px"><div class="row between"><b>On auction</b><span class="tiny muted">${fmtLeft(av.left)} left</span></div>
      <div class="small muted" style="margin-top:4px">${av.bids ? `${av.bids} bid${av.bids > 1 ? 's' : ''} · top 🪙 ${av.current}` : `No bids yet · starts at 🪙 ${au.start}`}</div>
      ${av.bids ? '' : '<button class="btn ghost" data-act="bcancel" style="width:100%;margin-top:10px">Cancel auction</button>'}</div>` : `
    <div class="btn-row">
      ${b.on ? '<button class="btn ghost" data-act="bunequip">Turn off</button>'
        : held ? `<button class="btn buy" data-bequip="${b.assetId}">Use on ${esc(a?.ticker || b.m.player.name)}</button>`
          : a ? `<button class="btn buy" data-open="${b.assetId}">Buy ${esc(a.ticker)} shares to use it</button>` : '<div class="small muted">This player isn\'t listed right now.</div>'}
    </div>
    <h3>Sell</h3>
    <button class="btn ghost" data-act="bsell" style="width:100%">Quick sell · 🪙 ${quickSellPrice(b)}</button>
    ${b.on ? '' : `<div class="card" style="margin-top:10px">
      <div class="row between"><b>Auction it</b><span class="tiny muted">Worth about 🪙 ${mv}</span></div>
      <label class="price-field"><span class="small muted">Starting bid 🪙</span><input id="bstart" inputmode="numeric" value="${Math.max(1, Math.round(mv * 0.6))}"></label>
      <div class="seg" style="margin-top:10px">${AUCTION_LENGTHS.map((L) => `<button data-blen="${L.key}" class="${o.len === L.key ? 'on' : ''}">${L.label}</button>`).join('')}</div>
      <div class="tiny faint" style="margin-top:6px">Longer auctions draw more bidders. If no bid reaches your starting price, the card comes back.</div>
      <button class="btn buy" data-act="blist" style="width:100%;margin-top:10px">List in the Marketplace</button></div>`}`}
    <div class="err" id="terr"></div>
    <button class="link-btn" data-act="tcancel">Close</button>`;
}

function boosterSlotCard(a) {
  if (a.kind !== 'player') return '';
  const mine = boosterState(state).inv.filter((x) => x.assetId === a.id);
  const b = boosterOn(state, a.id);
  if (b) return `<button class="card bslot on" data-booster="${b.id}" style="--rc:${bRarity(b.rarity).color}"><div class="bbadge" style="--rc:${bRarity(b.rarity).color}">${bType(b.type).icon}</div><div class="grow" style="text-align:left">
    <div class="name">${esc(bRarity(b.rarity).name)} ${esc(b.m.kind.toLowerCase())} card active</div><div class="tiny muted">${esc(describe(b))} · ${b.charges} game${b.charges === 1 ? '' : 's'} left</div></div></button>`;
  const ready = mine.filter((x) => !x.listed);
  return `<button class="card bslot" data-act="${ready.length && state.holdings[a.id] ? 'bpickfor' : 'findcards'}"><div class="bbadge empty">+</div><div class="grow" style="text-align:left"><div class="name">${ready.length ? `Use one of your ${ready.length} ${esc(a.ticker)} card${ready.length > 1 ? 's' : ''}` : `Find ${esc(a.name.split(' ').slice(-1)[0])} moment cards`}</div>
    <div class="tiny muted">${ready.length ? (state.holdings[a.id] ? `${equipped(state).length}/${slots(state)} card slots used` : 'Buy some shares first, then turn a card on') : 'Real plays from his games. They boost your earnings from him.'}</div></div><span class="muted">›</span></button>`;
}

function openBoosterPicker() {
  const a = state.assets[ui.detail];
  ui.order = { mode: 'bpick', id: a.id };
  const mine = boosterState(state).inv.filter((x) => x.assetId === a.id && !x.listed).sort((x, y) => rIdx(y.rarity) - rIdx(x.rarity));
  const wrap = $('#trade'); const panel = $('#panel');
  wrap.hidden = false;
  panel.innerHTML = `<div class="grabber"></div><div class="name" style="font-size:18px">Boost ${esc(a.name)}</div>
    <div class="sub" style="margin-bottom:10px">${equipped(state).length}/${slots(state)} card slots used</div>
    <div class="mc-grid">${mine.map((b) => `<button class="mc-cell" data-bpickone="${b.id}">${momentCard(b, { mini: true })}</button>`).join('')}</div>
    <div class="err" id="terr"></div><button class="link-btn" data-act="tcancel">Close</button>`;
  panel.classList.remove('enter'); void panel.offsetWidth; panel.classList.add('enter');
}

function showBoosterPack(list, pack) {
  const el = $('#packview');
  ui.packView = { cards: list.map((b) => ({ rarity: bRarity(b.rarity) })), flipped: 0 };
  el.hidden = false;
  el.innerHTML = `<div class="pv-inner"><div class="tiny muted">${esc(pack.name)}</div><h1 style="margin:4px 0 18px">Tap to reveal</h1>
    <div class="pv-cards moments">${list.map((b, i) => `<button class="pv-card mcard" data-flip="${i}" style="--rc:${bRarity(b.rarity).color}">
      <div class="pv-back">⚡</div><div class="pv-front">${momentCard(b, { mini: true })}</div></button>`).join('')}</div>
    <button class="btn ghost" data-act="packdone" style="margin-top:22px;max-width:320px;width:100%">Reveal all</button></div>`;
}

// ---------- Marketplace tab ----------
const MP_SORTS = [['ending', 'Ending soon'], ['new', 'Newest'], ['low', 'Price: low'], ['high', 'Price: high'], ['rating', 'Rating']];

function renderMarketplace() {
  const now = Date.now();
  const c = career(state);
  ui.mp ||= { league: 'all', rarity: 'all', sort: 'ending', q: '', view: 'browse' };
  const f = ui.mp;
  const lgs = enabledLeagues();
  const head = `${topbar(`<h1>Marketplace</h1>`)}
    <div class="row between" style="margin:2px 0 10px"><span class="coins">🪙 ${coinFmt(c.coins)}</span>
      <button class="chip ${f.view === 'mine' ? 'on' : ''}" data-act="mymarket">${f.view === 'mine' ? '← Browse' : 'My bids & listings'}</button></div>`;
  if (f.view === 'mine') { $('#view').innerHTML = head + myMarket(now); return; }
  let list = marketListings(state, now);
  const total = list.length;
  ui.mpLive = total;
  if (f.league !== 'all') list = list.filter((l) => l.card.m.league === f.league);
  if (f.rarity !== 'all') list = list.filter((l) => l.card.rarity === f.rarity);
  const q = f.q.trim().toLowerCase();
  if (q) list = list.filter((l) => l.card.m.player.name.toLowerCase().includes(q) || (l.card.m.player.team || '').toLowerCase() === q);
  const views = new Map(list.map((l) => [l.id, listingView(state, l, now)]));
  const key = { ending: (l) => l.end, new: (l) => -l.from, low: (l) => views.get(l.id).current, high: (l) => -views.get(l.id).current, rating: (l) => -l.card.m.rating }[f.sort];
  list.sort((x, y) => key(x) - key(y));
  $('#view').innerHTML = `${head}
    <div class="seg">${['all', ...lgs].map((l) => `<button data-mpl="${l}" class="${f.league === l ? 'on' : ''}">${l === 'all' ? 'All' : LEAGUES[l].name}</button>`).join('')}</div>
    <div class="chips" style="margin-top:10px">${[['all', 'All rarities'], ...B_RARITY.map((r) => [r.key, r.name])].map(([k, n]) => `<button class="chip ${f.rarity === k ? 'on' : ''}" data-mprar="${k}">${n}</button>`).join('')}</div>
    <div class="chips" style="margin-top:6px">${MP_SORTS.map(([k, n]) => `<button class="chip ${f.sort === k ? 'on' : ''}" data-mpsort="${k}">${n}</button>`).join('')}</div>
    <input class="search" id="mpq" type="search" placeholder="Search player or team (e.g. PHI)" value="${esc(f.q)}" autocomplete="off" style="margin-top:8px">
    <p class="tiny faint" style="margin:8px 0 0">${total} live auctions · bids are max bids; the highest when time runs out wins</p>
    ${list.length ? `<div class="mp-grid">${list.map((l) => { const v = views.get(l.id); return `<div class="mp-item">
      <div class="mp-meta" data-lotmeta="${l.id}"><span>⏱ ${fmtLeft(v.left)}</span><span>${v.bids} bid${v.bids === 1 ? '' : 's'}</span></div>
      <button class="mp-cardbtn" data-lot="${l.id}">${momentCard(l.card, { mini: true })}</button>
      <div class="mp-actions"><div class="mp-price" data-lotprice="${l.id}"><span class="tiny muted">${v.bids ? 'Top bid' : 'Starts at'}</span><b>🪙 ${v.current}</b>${v.leading ? '<span class="tiny up">You lead</span>' : ''}</div>
        <button class="btn buy small" data-lot="${l.id}" data-bidbtn="1">Bid</button></div>
    </div>`; }).join('')}</div>`
      : `<div class="card empty" style="margin-top:14px">${total ? 'No auctions match these filters.' : 'No auctions yet. Listings appear as real games are played and moments come in.'}</div>`}`;
}

// Tick the clocks and prices in place; only rebuild when an auction ends or a new one opens.
function updateMarketplaceNumbers(now) {
  if (ui.mp?.view === 'mine') return;
  const live = marketListings(state, now);
  const shown = [...document.querySelectorAll('[data-lotmeta]')].map((el) => el.dataset.lotmeta);
  const liveIds = new Set(live.map((l) => l.id));
  if (shown.some((id) => !liveIds.has(id)) || (live.length !== (ui.mpLive || 0) && !ui.touching)) { ui.mpLive = live.length; if (!busyScrolling()) softRefresh(); return; }
  for (const l of live) {
    const meta = document.querySelector(`[data-lotmeta="${l.id}"]`);
    if (!meta) continue;
    const v = listingView(state, l, now);
    meta.innerHTML = `<span>⏱ ${fmtLeft(v.left)}</span><span>${v.bids} bid${v.bids === 1 ? '' : 's'}</span>`;
    const pr = document.querySelector(`[data-lotprice="${l.id}"]`);
    if (pr) pr.innerHTML = `<span class="tiny muted">${v.bids ? 'Top bid' : 'Starts at'}</span><b>🪙 ${v.current}</b>${v.leading ? '<span class="tiny up">You lead</span>' : ''}`;
  }
}

function myMarket(now) {
  const lots = (state.mp?.list || []);
  const bids = Object.keys(state.mp?.bids || {}).map((id) => lots.find((l) => l.id === id)).filter(Boolean);
  const mine = myAuctions(state).sort((x, y) => y.from - x.from);
  const live = mine.filter((l) => l.status === 'live');
  const done = mine.filter((l) => l.status !== 'live').slice(0, 10);
  const won = lots.filter((l) => l.won && !l.mine).sort((x, y) => y.end - x.end).slice(0, 10);
  const row = (l, right) => `<div class="item"><div class="mc-thumb" style="--rc:${bRarity(l.card.rarity).color}">${KIND_ICON[l.card.m.kind] || '⭐'}</div>
    <div class="grow"><div class="name ellipsis">${esc(cardName(l.card))}</div><div class="sub">${bRarity(l.card.rarity).name} · ⩔ ${l.card.m.rating.toFixed(1)} · #${l.card.serial}</div></div>${right}</div>`;
  return `
    <h2>Your bids</h2>${bids.length ? `<div class="list">${bids.map((l) => { const v = listingView(state, l, now); return row(l, `<div class="price-col"><div class="price">🪙 ${v.current}</div><div class="tiny ${v.leading ? 'up' : 'down'}">${v.leading ? 'Leading' : 'Outbid'} · ${fmtLeft(v.left)}</div></div>`); }).join('')}</div>` : '<div class="card empty">No active bids.</div>'}
    <h2>Your listings</h2>${live.length ? `<div class="list">${live.map((l) => { const v = listingView(state, l, now); return row(l, `<div class="price-col"><div class="price">${v.bids ? `🪙 ${v.current}` : `from 🪙 ${l.start}`}</div><div class="tiny muted">${v.bids} bids · ${fmtLeft(v.left)}</div></div>`); }).join('')}</div>` : '<div class="card empty">List cards from your Locker.</div>'}
    ${won.length ? `<h2>Won</h2><div class="list">${won.map((l) => row(l, `<div class="price up">🪙 ${l.price ?? buyNowPrice(l)}</div>`)).join('')}</div>` : ''}
    ${done.length ? `<h2>Sold & returned</h2><div class="list">${done.map((l) => row(l, `<div class="price ${l.status === 'sold' ? 'up' : 'muted'}">${l.status === 'sold' ? `+🪙 ${l.price}` : l.status === 'cancelled' ? 'Cancelled' : 'Unsold'}</div>`)).join('')}</div>` : ''}`;
}

function openLot(id, focusBid = false) {
  ui.order = { mode: 'lot', id };
  renderLot(focusBid);
  const panel = $('#panel');
  panel.classList.remove('enter'); void panel.offsetWidth; panel.classList.add('enter');
}

function renderLot(focusBid = false) {
  const l = (state.mp?.list || []).find((x) => x.id === ui.order.id);
  if (!l) { closeOrder(); return; }
  const v = listingView(state, l);
  const wrap = $('#trade'); const panel = $('#panel');
  wrap.hidden = false;
  panel.style.setProperty('--acc', 'var(--accent)');
  const my = state.mp.bids[l.id];
  const a = state.assets[assetOf(l.card.m)];
  const inc = Math.max(1, Math.ceil(v.current * 0.1));
  panel.innerHTML = `<div class="grabber"></div>
    <div class="mc-solo">${momentCard(l.card)}</div>
    <div class="small muted" style="text-align:center;margin:8px 0 0">${esc(describe(l.card))}</div>
    <div class="grid3" style="margin-top:12px">
      <div class="stat"><div class="k">${v.bids ? 'Top bid' : 'Starts at'}</div><div class="v">🪙 ${v.current}</div></div>
      <div class="stat"><div class="k">Bids</div><div class="v">${v.bids}</div></div>
      <div class="stat"><div class="k">Ends in</div><div class="v">${fmtLeft(v.left)}</div></div>
    </div>
    ${my ? `<div class="small ${v.leading ? 'up' : 'down'}" style="margin-top:8px">${v.leading ? `You're winning. Your max bid is 🪙 ${my.amount}; you'll pay just over the next bidder.` : 'You were outbid.'}</div>` : ''}
    <label class="price-field"><span class="small muted">Your max bid 🪙</span><input id="bidamt" inputmode="numeric" value="${v.minBid}"></label>
    <div class="quick" style="margin-top:10px">${[v.minBid, v.minBid + inc, v.minBid + inc * 3].map((x) => `<button data-bidq="${x}">🪙 ${x}</button>`).join('')}</div>
    <button class="btn buy" data-act="placebid" style="width:100%">Place bid</button>
    <button class="btn ghost" data-act="buynow" style="width:100%;margin-top:8px">Buy now · 🪙 ${buyNowPrice(l)}</button>
    <div class="tiny faint" style="margin-top:8px;text-align:center">Listed by ${esc(l.seller)} · ${a ? `${esc(a.name)} trades at ${money(a.price)}` : ''}</div>
    <div class="err" id="terr"></div>
    <button class="link-btn" data-act="tcancel">Close</button>`;
  if (focusBid) setTimeout(() => $('#bidamt')?.select(), 300);
}

// ---------- Game Center ----------

function findGame(league, id) {
  const live = state.liveGames[id];
  if (live) return { status: 'live', league, id, name: live.name, detail: live.detail, teams: live.teams };
  const r = (state.results || []).find((x) => x.id === id);
  if (r) return { status: 'final', league, id, name: r.name, date: r.date, teams: r.teams, preseason: r.preseason };
  const s = (state.schedule?.[league] || []).find((x) => x.id === id);
  if (s) return { status: 'pre', league, id, name: s.name, date: s.date, teams: s.teams, preseason: s.preseason };
  return null;
}

function openGame(league, id, { push = true } = {}) {
  if (!findGame(league, id)) { toast('Game details are no longer available'); return; }
  ui.game = { league, id };
  if (push) { try { history.pushState({ game: id, lg: league }, ''); } catch { /* */ } }
  const el = $('#game');
  el.style.zIndex = ui.detail ? '34' : ''; // above the player page when opened from it
  renderGame();
  el.scrollTop = 0;
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
}

function closeGame({ animate = true } = {}) {
  ui.game = null;
  const el = $('#game');
  const finish = () => { if (ui.game) return; el.hidden = true; el.innerHTML = ''; const y = view().scrollTop; render(); view().scrollTop = y; };
  if (animate && !el.hidden) slideOut(el, 'x', finish); else finish();
}

function renderGame() {
  const { league, id } = ui.game;
  const g = findGame(league, id);
  const el = $('#game');
  if (!g) { el.hidden = true; return; }
  const now = Date.now();
  const away = g.teams.find((t) => !t.home) || g.teams[0];
  const home = g.teams.find((t) => t !== away) || g.teams[1];
  const teamIds = new Set(g.teams.map((t) => t.id));
  let players;
  if (g.status === 'pre') {
    players = Object.values(state.assets).filter((a) => a.kind === 'player' && a.league === league && teamIds.has(a.teamId))
      .sort((x, y) => y.price - x.price).slice(0, 12).map((a) => ({ a, text: '', live: false }));
  } else {
    players = gamePlayers(state, league, id).sort((x, y) => change(y.a, now) - change(x.a, now));
  }
  const status = g.status === 'live' ? `<span class="tag live">LIVE</span> <span class="small">${esc(g.detail || '')}</span>`
    : g.status === 'final' ? `<span class="tag">FINAL</span> <span class="small muted">${fmtDateTime(g.date)}</span>`
      : `<span class="small muted">${fmtDateTime(g.date)}${g.preseason ? ' · preseason' : ''}</span>`;
  const col = (t) => {
    const ta = teamAsset(league, t.id);
    const tc = ta ? change(ta, now) : 0;
    return `<button class="gc-team" ${ta ? `data-open="${ta.id}"` : ''}>${ta ? avatar(ta) : ''}
      <div class="name">${esc(t.abbr)}</div>${ta ? `<div class="tiny muted">${recText(ta)}</div>` : ''}
      ${g.status !== 'pre' ? `<div class="gc-score ${t.winner && g.status === 'final' ? 'win' : ''}">${t.score ?? ''}</div>` : ''}
      ${ta ? `<div class="tiny ${cls(tc)}">${money(ta.price)} ${fmtPct(tc)}</div>` : ''}</button>`;
  };
  const pAway = winProb(state, league, away.id, home.id, false, !!g.preseason);
  const pk = state.picks[id];
  const up = upcomingPickGames(state, now, [league]).find((x) => x.id === id);
  el.hidden = false;
  el.innerHTML = `<div class="sheet-inner">
    <div class="row between"><button class="icon-btn" data-act="gameback" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div class="row" style="gap:6px">${lgTag(league)} ${status}</div><div style="width:38px"></div></div>
    <div class="gc-head">${col(away)}<div class="gc-at">@</div>${col(home)}</div>
    <div class="wp"><div class="tiny muted row between"><span>${esc(away.abbr)} ${Math.round(pAway * 100)}%</span><span>Win probability (from share prices)</span><span>${Math.round((1 - pAway) * 100)}% ${esc(home.abbr)}</span></div>
      <div class="wp-bar"><i style="width:${pAway * 100}%"></i></div></div>
    ${up ? `<h3>Your pick</h3>${pickGame(up)}` : pk ? `<div class="card small" style="margin-top:12px">Your pick: <b>${esc(pk.abbr)}</b> · ${pk.result ? { won: `won <b class="up">+${money(pk.paid || 0)}</b>`, lost: '<span class="down">missed</span>', push: 'push', void: 'voided' }[pk.result] : 'locked — game in progress'}</div>` : ''}
    <h3>${g.status === 'pre' ? 'Players to watch' : 'Player movers'}</h3>
    <div class="list">${players.map(({ a, text, live }) => {
      const h = state.holdings[a.id]; const c = change(a, now);
      return `<button class="item" data-open="${a.id}">${avatar(a)}<div class="grow"><div class="name ellipsis">${esc(a.name)}${h ? ' <span class="tag own">Owned</span>' : ''}</div>
        <div class="sub ellipsis">${esc(a.teamAbbr || '')} · ${g.status === 'pre' ? (a.injury ? `<span class="down">${esc(shortInj(a.injury.status))}</span>` : esc(a.pos || '')) : esc(text || '')}${live ? ' <span class="tag live">LIVE</span>' : ''}</div></div>
        <div class="price-col"><div class="price" data-p="${a.id}">${money(a.price)}</div><div class="small ${cls(c)}" data-c="${a.id}" data-plain="1">${fmtPct(c)}</div></div></button>`;
    }).join('') || `<div class="empty">${g.status === 'final' ? 'Box score not loaded for this game.' : 'No player data yet.'}</div>`}</div>
  </div>`;
}

// ---------- market heatmap ----------

function heatmapHTML(items) {
  const W = Math.max(280, Math.min(640, (view().clientWidth || 360) - 32));
  const H = Math.round(W * 1.25);
  const now = Date.now();
  const tiles = squarify(items.slice(0, 48).map((a) => ({ value: a.price * (a.kind === 'team' ? 5 : 1), a })), W, H);
  return `<div class="heat" style="height:${H}px">${tiles.map((t) => {
    const c = change(t.a, now);
    const big = Math.min(t.w, t.h);
    const fs = big > 90 ? 16 : big > 56 ? 13 : big > 36 ? 11 : 0;
    return `<button class="tile" data-open="${t.a.id}" style="left:${(t.x / W) * 100}%;top:${(t.y / H) * 100}%;width:${(t.w / W) * 100}%;height:${(t.h / H) * 100}%;background:${heatColor(c)}">
      ${fs ? `<b style="font-size:${fs}px">${esc(t.a.ticker)}</b><span style="font-size:${Math.max(10, fs - 3)}px">${fmtPct(c)}</span>` : ''}</button>`;
  }).join('')}</div>`;
}

// ---------- share cards ----------

async function sharePortfolio() {
  const now = Date.now();
  const nw = netWorth(state, now);
  const bench = state.assets['fund:SS500'];
  const holdings = Object.entries(state.holdings).map(([id, h]) => ({ a: state.assets[id], h })).filter((x) => x.a)
    .sort((x, y) => y.a.price * y.h.qty - x.a.price * x.h.qty).slice(0, 3)
    .map(({ a, h }) => ({ ticker: a.ticker, name: a.name, pct: a.price * h.qty / h.cost - 1 }));
  const c = portfolioCard({
    netWorth: nw, ret: nw / state.startCash - 1, bench: bench?.hist?.length ? bench.price / priceAt(bench, state.startedAt) - 1 : null,
    holdings, picks: `${state.pickStats.w}-${state.pickStats.l}`, streak: state.pickStats.streak,
    cards: Object.keys(state.collection).length, trophies: Object.keys(state.trophies).length,
  });
  const r = await shareCanvas(c, 'statstreet-portfolio', `My StatStreet portfolio is ${fmtPct(nw / state.startCash - 1)} all time`);
  if (r === 'downloaded') toast('Image saved');
}

async function shareAsset(a) {
  const r = rarity(state, a);
  const want = ['Form percentile', 'Record', 'Market cap', 'Dividend yield', 'Holdings'];
  const ks = keyStats(a).filter(([k]) => want.includes(k)).map(([k, v]) => [k.replace('Form percentile', 'Form'), v]).slice(0, 3);
  const c = assetCard({
    name: a.name, ticker: a.ticker, sub: a.kind === 'player' ? `${a.teamAbbr || ''} · ${a.pos || ''} · ${LEAGUES[a.league]?.name || ''}` : `${recText(a)} · ${LEAGUES[a.league]?.name || 'Index fund'}`,
    price: a.price, change: change(a, Date.now(), 7 * DAY), rarity: r, level: cardLevel(state, a.id), stats: ks,
  });
  const res = await shareCanvas(c, `statstreet-${a.ticker}`, `${a.name} on StatStreet`);
  if (res === 'downloaded') toast('Image saved');
}

// ---------- overlays: scroll lock ----------

// Screens scroll inside their own containers, so nothing needs locking; kept as hooks.
function lockBody() {}
function unlockBody() {}

// ---------- asset detail ----------

function openDetail(id) {
  if (!state.assets[id]) return;
  if (ui.order) closeOrder();
  if (ui.chain) closeChain(true);
  const wasOpen = !!ui.detail;
  if (ui.game) $('#game').style.zIndex = ''; // the player page goes on top of the game
  ui.detail = id;
  ui.scrub = false;
  try { history.pushState({ sheet: id }, ''); } catch { /* sandboxed frame */ }
  lockBody();
  const sheet = $('#sheet');
  renderDetail({ keepScroll: false });
  sheet.scrollTop = 0;
  if (!wasOpen) { sheet.classList.remove('enter'); void sheet.offsetWidth; sheet.classList.add('enter'); }
}

function closeDetail({ animate = true } = {}) {
  ui.detail = null;
  const sheet = $('#sheet'); const bar = $('#tradebar');
  const finish = () => {
    if (ui.detail) return; // reopened meanwhile
    sheet.hidden = true; sheet.innerHTML = ''; bar.hidden = true;
    const y = view().scrollTop; render(); view().scrollTop = y;
  };
  if (animate && !sheet.hidden) slideOut(sheet, 'x', finish, [bar]); else finish();
}

function renderDetail({ keepScroll = true } = {}) {
  const a = state.assets[ui.detail];
  if (!a) return;
  const sheet = $('#sheet');
  const top = sheet.scrollTop;
  const now = Date.now();
  const from = now - RANGES[ui.range];
  const ch = change(a, now, RANGES[ui.range]);
  const ref = priceAt(a, from);
  const h = state.holdings[a.id];
  const b = breakdown(state, a, now);
  const watching = state.watch.includes(a.id);
  const alerting = state.alerts.some((x) => x.assetId === a.id);
  const news = state.news.filter((n) => (n.targets || []).includes(a.id)).slice(0, 6);
  const myOpts = Object.values(state.options).filter((o) => o.under === a.id);
  const myOrders = state.orders.filter((o) => o.assetId === a.id);
  const divEarned = state.divs.filter((d) => d.id === a.id).reduce((s, d) => s + d.amt, 0);
  const ng = nextGame(a);
  const r = scoutRating(a);
  sheet.hidden = false;
  sheet.classList.toggle('acc-down', ch < 0);
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="row between">
      <button class="icon-btn" data-act="back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div class="icons-right">
        <button class="icon-btn" data-act="shareasset" aria-label="Share"><svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg></button>
        <button class="icon-btn ${alerting ? 'alerting' : ''}" data-act="alert" aria-label="Price alert"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg></button>
        <button class="icon-btn ${watching ? 'on' : ''}" data-act="watch" aria-label="Watchlist"><svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg></button>
      </div>
    </div>
    <div class="hero">${avatar(a)}<div class="grow"><div class="name ellipsis" style="font-size:19px">${esc(a.name)}</div><div class="sub">${subLine(a)}</div>${a.kind !== 'fund' ? `<div style="margin-top:4px">${rarChip(a)}</div>` : ''}</div></div>
    <div class="big-value" id="dprice">${money(a.price)}</div>
    <div class="change-line ${cls(ch)}" id="dchg">${ch >= 0 ? '▲' : '▼'} ${money(Math.abs(a.price - ref))} (${fmtPct(ch)}) <span class="muted">${rangeLabel(ui.range)}</span></div>
    <div class="chart-wrap" id="dchart"></div>
    <div class="ranges">${Object.keys(RANGES).map((rg) => `<button data-range="${rg}" class="${rg === ui.range ? 'on' : ''}">${rg}</button>`).join('')}</div>

    ${h ? `<h3>Your position</h3><div class="grid2">
      <div class="stat"><div class="k">Shares</div><div class="v">${fmtQty(h.qty)}</div></div>
      <div class="stat"><div class="k">Market value</div><div class="v">${money(a.price * h.qty)}</div></div>
      <div class="stat"><div class="k">Average cost</div><div class="v">${money(h.cost / h.qty)}</div></div>
      <div class="stat"><div class="k">Total return</div><div class="v ${cls(a.price * h.qty - h.cost)}">${signMoney(a.price * h.qty - h.cost)}</div></div>
      <div class="stat"><div class="k">Today's return</div><div class="v ${cls(change(a, now))}">${signMoney((a.price - priceAt(a, now - DAY)) * h.qty)}</div></div>
      <div class="stat"><div class="k">Dividends earned</div><div class="v up">${money(divEarned)}</div></div>
    </div>` : ''}
    ${myOpts.length ? `<h3>Your options</h3><div class="list">${myOpts.map(optPositionRow).join('')}</div>` : ''}
    ${myOrders.length ? `<h3>Open orders</h3><div class="list">${myOrders.map(orderRow).join('')}</div>` : ''}

    ${a.live ? `<div class="card" style="margin-top:14px"><span class="tag live">LIVE</span> <b style="margin-left:6px">${esc(a.live.text)}</b></div>` : ''}
    ${a.injury ? `<div class="card" style="margin-top:14px"><span class="tag inj">${esc(a.injury.status)}</span> <span class="small" style="margin-left:6px">${esc(a.injury.detail || '')}</span></div>` : ''}
    ${cardSection(a)}
    ${boosterSlotCard(a)}
    ${ng ? `<div class="card next-game" data-game="${a.league}|${ng.id}" style="margin-top:14px"><div><div class="tiny muted">NEXT GAME</div><b>${esc(ng.name)}</b></div><div class="small muted" style="text-align:right">${fmtDateTime(ng.date)}</div></div>` : ''}

    ${a.kind === 'fund' ? fundSection(a) : ''}

    <h3>Key stats</h3>
    <div class="stats-grid">${keyStats(a).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>

    ${researchSection(a)}

    <h3>Why it's moving</h3>
    <div class="list">${(a.events || []).slice(0, 10).map((e) => `<div class="driver">
      <div class="ic">${{ game: '🏟️', milestone: '🏆', news: '📰', injury: '🩹', fund: '🧺' }[e.kind] || '•'}</div>
      <div class="txt">${esc(e.text)}<div class="tiny faint">${timeAgo(e.t)}</div></div>
      <div class="pct ${cls(e.pct)}">${Math.abs(e.pct) < 0.0005 ? '<span class="faint">—</span>' : fmtPct(e.pct, 1)}</div></div>`).join('')
      || '<div class="empty">No price-moving events yet.</div>'}</div>

    ${a.kind === 'player' ? playerStats(a) : a.kind === 'team' ? teamStats(a) : ''}

    ${(a.divHist || []).length ? `<h3>Dividend history</h3><div class="list">${a.divHist.slice(0, 6).map((d) => `<div class="driver"><div class="ic">💵</div>
      <div class="txt">${esc(d.reason)}<div class="tiny faint">${timeAgo(d.t)}</div></div><div class="pct up">${money(d.ps)}/sh</div></div>`).join('')}</div>` : ''}

    ${a.kind !== 'fund' ? `<h3>Price breakdown</h3>
    <div class="card">
      <div class="brk"><span>${a.kind === 'player' ? 'Performance value' : 'Team strength value'}</span><b>${money(b.fair)}</b></div>
      <div class="brk"><span>Injuries</span><b class="${b.inj < 1 ? 'down' : 'muted'}">${b.inj < 1 ? fmtPct(b.inj - 1, 1) : 'none'}</b></div>
      <div class="brk"><span>News sentiment</span><b class="${Math.abs(b.senti) < 0.001 ? 'muted' : cls(b.senti)}">${fmtPct(b.senti, 1)}</b></div>
      <div class="brk"><span>${LEAGUES[a.league].name} market mood</span><b class="${Math.abs(b.mood) < 0.001 ? 'muted' : cls(b.mood)}">${fmtPct(b.mood, 1)}</b></div>
      ${b.live ? `<div class="brk"><span>Live game</span><b class="${cls(b.live)}">${fmtPct(b.live, 1)}</b></div>` : ''}
      ${Math.abs(b.hype) > 0.0005 ? `<div class="brk"><span>Market hype</span><b class="${cls(b.hype)}">${fmtPct(b.hype, 1)}</b></div>` : ''}
      ${Math.abs(b.imp) > 0.0005 ? `<div class="brk"><span>Your order flow</span><b class="${cls(b.imp)}">${fmtPct(b.imp, 1)}</b></div>` : ''}
      <div class="brk"><span>Fair price</span><b>${money(b.target)}</b></div>
    </div>` : ''}

    ${news.length ? `<h3>News</h3><div class="list">${news.map((n) => `<a class="news" href="${esc(n.url)}" target="_blank" rel="noopener">
      <div class="h">${esc(n.headline)}</div><div class="meta"><span class="senti ${n.score > 0.12 ? 'up' : n.score < -0.12 ? 'down' : 'flat'}">${n.score > 0.12 ? 'Bullish' : n.score < -0.12 ? 'Bearish' : 'Neutral'}</span><span class="tiny faint">${timeAgo(n.published)}</span></div></a>`).join('')}</div>` : ''}
  </div>`;
  const bar = $('#tradebar');
  bar.hidden = !!ui.chain;
  bar.className = `trade-bar ${ch < 0 ? 'acc-down' : ''}`;
  bar.style.setProperty('--acc', `var(--${ch < 0 ? 'down' : 'up'})`);
  bar.innerHTML = `<button class="btn opt" data-act="chain" aria-label="Options"><svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16"/><path d="M7 15l4-5 3 3 5-6"/><circle cx="19" cy="7" r="1.5"/></svg></button>
    <button class="btn sell" data-act="sell" ${h ? '' : 'disabled'}>Sell</button>
    <button class="btn buy" data-act="buy">Buy</button>`;
  drawDetailChart();
  if (keepScroll) sheet.scrollTop = top;
}

function drawDetailChart() {
  const a = state.assets[ui.detail];
  const el = $('#dchart');
  if (!a || !el) return;
  const now = Date.now();
  lineChart(el, a.hist.concat([now, a.price]), now - RANGES[ui.range], {
    onScrub: (pt) => {
      ui.scrub = !!pt;
      if (!pt) { updateDetailHeader(); return; }
      $('#dprice').textContent = money(pt.p);
      const c = pt.p / pt.first - 1;
      $('#dchg').className = `change-line ${cls(c)}`;
      $('#dchg').innerHTML = `${fmtPct(c)} <span class="muted">${new Date(pt.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>`;
    },
  });
}

// Collectible card progress on the detail page.
function cardSection(a) {
  if (a.kind === 'fund') return '';
  const c = state.collection[a.id];
  const r = rarity(state, a);
  if (!c) return `<div class="card cardsec" style="--rc:${r.color};margin-top:14px"><div class="pcard-sm ${r.key}"></div><div class="grow"><div class="name">${r.name} card</div>
    <div class="tiny muted">Buy any amount to add ${esc(a.kind === 'team' ? a.ticker : a.name)} to your collection.</div></div></div>`;
  const lv = cardLevel(state, a.id);
  const lo = 5 * 2 ** (lv - 1); const hi = 5 * 2 ** lv;
  const frac = lv >= 10 ? 1 : clamp((c.peak - lo) / (hi - lo), 0, 1);
  return `<div class="card cardsec" style="--rc:${r.color};margin-top:14px"><div class="pcard-sm ${r.key}"><b>${lv}</b></div><div class="grow">
    <div class="row between"><div class="name">${r.name} card · Lv ${lv}</div><div class="tiny muted">since ${fmtDate(c.first)}</div></div>
    <div class="lvbar"><i style="width:${frac * 100}%"></i></div>
    <div class="tiny muted">${lv > 1 ? `+${(lv - 1) * 5}% dividends from this card · ` : ''}${lv >= 10 ? 'Max level' : `Hold ${money(hi)} at once or pull a duplicate in a pack to reach Lv ${lv + 1}`}</div></div></div>`;
}

function keyStats(a) {
  const now = Date.now();
  const range = (span) => {
    const pts = [];
    for (let i = 0; i < a.hist.length; i += 2) if (a.hist[i] >= now - span) pts.push(a.hist[i + 1]);
    pts.push(a.price);
    return `${money(Math.min(...pts))} – ${money(Math.max(...pts))}`;
  };
  const y = dividendYield(state, a, now);
  const out = [];
  if (a.kind === 'fund') {
    out.push(['Holdings', Object.keys(a.cons).length], ['Expense ratio', '0.00%'], ['Rebalanced', timeAgo(a.rebalanced)]);
  } else {
    const cap = a.price * SHARES_OUT[a.kind];
    out.push(['Market cap', cap >= 1e9 ? `$${(cap / 1e9).toFixed(2)}B` : `$${(cap / 1e6).toFixed(1)}M`]);
  }
  out.push(['Day range', range(DAY)], ['All-time range', range(3650 * DAY)], ['Dividend yield', y > 0 ? `${(y * 100).toFixed(2)}%` : '—'],
    ['Implied volatility', `${Math.round(impliedVol(a, now, state) * 100)}%`], ['1W change', fmtPct(change(a, now, 7 * DAY))]);
  if (a.kind === 'player') out.push(['Form percentile', a.perf.ema != null ? `${Math.round(normCdf(formZ(a)) * 100)}th` : '—']);
  if (a.kind === 'team') out.push(['Record', recText(a)]);
  return out;
}

function fundSection(f) {
  const rows = fundHoldings(state, f).slice(0, 12);
  return `<h3>About</h3><div class="about">${esc(f.blurb || '')}</div>
    <h3>Top holdings</h3><div class="list">${rows.map(({ a, weight }) => assetRow(a, { note: `${subLine(a)} <span>${(weight * 100).toFixed(1)}%</span>` })).join('')}</div>`;
}

function updateDetailHeader() {
  const a = state.assets[ui.detail];
  if (!a || ui.scrub) return;
  const ch = change(a, Date.now(), RANGES[ui.range]);
  const ref = priceAt(a, Date.now() - RANGES[ui.range]);
  const p = $('#dprice'); const c = $('#dchg');
  if (!p) return;
  p.textContent = money(a.price);
  c.className = `change-line ${cls(ch)}`;
  c.innerHTML = `${ch >= 0 ? '▲' : '▼'} ${money(Math.abs(a.price - ref))} (${fmtPct(ch)}) <span class="muted">${rangeLabel(ui.range)}</span>`;
}

function playerStats(a) {
  const pctile = Math.round(100 * normCdf(formZ(a)));
  const last = a.perf.last.slice(0, 8).reverse();
  const max = Math.max(1, ...last.map((g) => Math.abs(g.gs)));
  return `<h3>Performance</h3>
    <div class="grid3">
      <div class="stat"><div class="k">Form score</div><div class="v">${a.perf.ema != null ? a.perf.ema.toFixed(1) : '—'}</div></div>
      <div class="stat"><div class="k">vs ${esc(groupName(a))}</div><div class="v">${a.perf.ema != null ? pctile + 'th' : '—'}</div></div>
      <div class="stat"><div class="k">Season avg</div><div class="v">${a.perf.season ? a.perf.season.gs.toFixed(1) : '—'}</div></div>
    </div>
    ${last.length ? `<div class="card" style="margin-top:10px"><div class="small muted">Last ${last.length} games (game score)</div>
      <div class="bars">${last.map((g) => `<div class="${g.gs < 0 ? 'neg' : ''}" style="height:${clamp(Math.abs(g.gs) / max, 0.05, 1) * 100}%" title="${esc(g.text)}"></div>`).join('')}</div>
      <div class="list" style="margin:10px -14px -14px;border-radius:0 0 14px 14px">${a.perf.last.slice(0, 4).map((g) => `<div class="driver"><div class="txt small">${esc(g.text)}<div class="tiny faint">${fmtDate(g.t)}</div></div><div class="pct">${g.gs.toFixed(1)}</div></div>`).join('')}</div>
    </div>` : '<div class="card small muted" style="margin-top:10px">Priced from season averages. Game-by-game form appears after their next game.</div>'}`;
}

function teamStats(a) {
  const r = a.rec;
  const roster = Object.values(state.assets).filter((x) => x.kind === 'player' && x.league === a.league && x.teamId === a.rid && x.hist.length)
    .sort((x, y) => y.price - x.price).slice(0, 6);
  return `<h3>Team${r.prior ? ' · last season (carried forward)' : ''}</h3>
    <div class="grid3">
      <div class="stat"><div class="k">Record</div><div class="v">${Math.round(r.w)}-${Math.round(r.l)}${r.t >= 1 ? '-' + Math.round(r.t) : ''}</div></div>
      <div class="stat"><div class="k">Diff / game</div><div class="v ${cls(r.diff)}">${r.gp ? (r.diff >= 0 ? '+' : '') + (r.diff / r.gp).toFixed(1) : '—'}</div></div>
      <div class="stat"><div class="k">${r.playoffPct != null ? 'Playoff odds' : 'Streak'}</div><div class="v">${r.playoffPct != null ? Math.round(r.playoffPct) + '%' : (r.streak > 0 ? 'W' + r.streak : r.streak < 0 ? 'L' + -r.streak : '—')}</div></div>
    </div>
    ${(a.form || []).length ? `<div class="card small" style="margin-top:10px">Recent: ${(a.form || []).slice(0, 10).map((w) => `<b class="${w ? 'up' : 'down'}">${w ? 'W' : 'L'}</b>`).join(' ')}</div>` : ''}
    ${roster.length ? `<h3>Top players</h3><div class="list">${roster.map((p) => assetRow(p)).join('')}</div>` : ''}`;
}

const groupName = (a) => ({ ALL: 'league', P: 'pitchers', H: 'hitters', QB: 'QBs', RB: 'RBs', WR: 'pass catchers', K: 'kickers', OL: 'linemen', DEF: 'defenders' }[posGroup(a.league, a.pos)]);
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }

// ---------- option chain ----------

function openChain() {
  const a = state.assets[ui.detail];
  if (!a) return;
  const exps = expirations(Date.now());
  ui.chain = { under: a.id, exp: exps[0], type: 'call' };
  try { history.pushState({ chain: a.id }, ''); } catch { /* */ }
  $('#tradebar').hidden = true;
  const el = $('#chain');
  renderChain();
  el.scrollTop = 0;
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
}

function closeChain(silent = false, { animate = !silent } = {}) {
  ui.chain = null;
  const el = $('#chain');
  const finish = () => {
    if (ui.chain) return;
    el.hidden = true; el.innerHTML = '';
    if (ui.detail && !silent) renderDetail();
  };
  if (animate && !el.hidden) slideOut(el, 'x', finish); else finish();
}

function renderChain() {
  const c = ui.chain;
  const a = state.assets[c.under];
  if (!a) return;
  const el = $('#chain');
  const top = el.scrollTop;
  const now = Date.now();
  const exps = expirations(now);
  if (!exps.includes(c.exp)) c.exp = exps[0];
  const ks = strikes(a.price);
  const S = a.price;
  const rows = ks.map((k) => ({ k, q: quoteOption(state, a.id, c.type, k, c.exp, now) }));
  // Calls: strikes descending with the price line between; puts ascending (Robinhood style)
  const order = c.type === 'call' ? [...rows].reverse() : rows;
  const lineAt = order.findIndex((r) => (c.type === 'call' ? r.k < S : r.k > S));
  const g = gamesBefore(a, c.exp);
  el.hidden = false;
  el.classList.toggle('acc-down', change(a, now) < 0);
  el.innerHTML = `<div class="sheet-inner">
    <div class="row between"><button class="icon-btn" data-act="chainback" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div class="small muted">${esc(a.ticker)} ${money(S)} · IV ${Math.round(impliedVol(a, now, state) * 100)}%</div></div>
    <h1 style="margin-top:12px">${esc(a.ticker)} options</h1>
    <div class="small muted" style="margin-top:4px">${esc(a.name)} · 1 contract = ${CONTRACT} shares · cash-settled at expiry</div>
    <div class="chips exp-chips" style="margin-top:12px">${exps.map((e) => {
      const n = gamesBefore(a, e);
      return `<button class="chip ${e === c.exp ? 'on' : ''}" data-exp="${e}">${fmtExp(e)}${n ? `<small>${gamesLabel(n)}</small>` : `<small>${Math.round((e - now) / DAY)}d</small>`}</button>`;
    }).join('')}</div>
    <div class="seg" style="margin-top:10px">${[['call', 'Calls · bet it rises'], ['put', 'Puts · bet it falls']].map(([k, n]) => `<button data-otype="${k}" class="${c.type === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    ${g ? `<p class="tiny muted" style="margin:8px 2px 0">${g.total > 0.05 ? `${gamesLabel(g)} before this expiry. Each game is priced in as a possible move of about ±${(gameMove(a, now) * 100).toFixed(1)}% (based on ${esc(a.ticker)}'s recent games), so premiums rise into game day and drop once it's played.` : 'No games before this expiry, so these options are cheap: only news and injuries can move the price.'}</p>` : ''}
    <div class="list" style="margin-top:10px">
      <div class="opt-row" style="padding:8px 14px"><span class="tiny muted">STRIKE · BREAKEVEN</span><span></span><span class="tiny muted" style="min-width:78px;text-align:center">PRICE</span></div>
      ${order.map((r, i) => {
        const itm = c.type === 'call' ? r.k < S : r.k > S;
        const held = state.options[optKey(a.id, c.type, r.k, c.exp)];
        return `${i === lineAt ? `<div class="price-line">SHARE PRICE ${money(S)}</div>` : ''}
        <button class="opt-row ${itm ? 'itm' : ''}" data-strike="${r.k}">
          <div><div class="k">$${r.k}${held ? `<span class="held">${held.qty} OWNED</span>` : ''}</div>
            <div class="tiny muted">Breakeven ${money(r.q.breakeven)} (${fmtPct(r.q.toBreakeven, 1)})</div></div>
          <div class="tiny muted" style="text-align:right">Δ ${r.q.delta.toFixed(2)}</div>
          <div class="ask">${money(r.q.ask)}</div>
        </button>`;
      }).join('')}
      ${lineAt === -1 ? `<div class="price-line">SHARE PRICE ${money(S)}</div>` : ''}
    </div>
    <p class="tiny faint" style="margin-top:10px">Price is per share; a contract costs 100×. Tap a strike to see cost, breakeven and the payoff chart.</p>
  </div>`;
  el.scrollTop = top;
}

// ---------- order sheet (stocks and options) ----------

function openOrder(o) {
  ui.order = o;
  const wrap = $('#trade'); const panel = $('#panel');
  wrap.hidden = false;
  buildOrder();
  panel.classList.remove('enter'); void panel.offsetWidth; panel.classList.add('enter');
}

function closeOrder({ animate = true } = {}) {
  ui.order = null;
  const wrap = $('#trade'); const panel = $('#panel');
  const finish = () => { if (ui.order) return; wrap.hidden = true; panel.innerHTML = ''; };
  if (animate && !wrap.hidden) slideOut(panel, 'y', finish); else finish();
}

function stockOrderDefaults(side) {
  const a = state.assets[ui.detail];
  const h = state.holdings[a.id];
  return { mode: 'stock', id: a.id, side, type: 'market', unit: side === 'buy' ? 'usd' : 'sh',
    amount: side === 'buy' ? (Math.max(minOrder(state), Math.floor(buyingPower(state) * 25) / 100)).toFixed(2) : String(h ? fmtQty(h.qty) : ''),
    price: '', freq: 'weekly', err: '' };
}

// Full (re)build of the panel. Called only when the layout changes
// (open, switching buy/sell, order type or unit) — never on price ticks.
function buildOrder() {
  const o = ui.order; const panel = $('#panel');
  if (!o) return;
  if (o.mode === 'option') return buildOptionOrder();
  const a = state.assets[o.id];
  const h = state.holdings[a.id];
  panel.style.setProperty('--acc', `var(--${o.side === 'sell' ? 'down' : 'up'})`);
  const types = o.side === 'buy' ? [['market', 'Market'], ['limit', 'Limit'], ['stop', 'Stop'], ['recurring', 'Recurring']] : [['market', 'Market'], ['limit', 'Limit'], ['stop', 'Stop-loss']];
  const usd = o.unit === 'usd';
  const quick = o.side === 'buy'
    ? (usd ? [0.1, 0.25, 0.5].map((f) => [`${f * 100}%`, (Math.floor(buyingPower(state) * f * 100) / 100).toFixed(2)]).concat([['Max', 'max']])
      : [['1', 1], ['5', 5], ['10', 10], ['Max', 'max']])
    : [['25%', 0.25], ['50%', 0.5], ['All', 1]];
  panel.innerHTML = `<div class="grabber"></div>
    <div class="seg">${['buy', 'sell'].map((s) => `<button data-oside="${s}" class="${o.side === s ? 'on' : ''}" ${s === 'sell' && !h ? 'disabled' : ''}>${s === 'buy' ? 'Buy' : 'Sell'}</button>`).join('')}</div>
    <div class="row" style="margin-top:14px">${avatar(a)}<div class="grow"><div class="name">${esc(a.name)}</div>
      <div class="sub"><span>${esc(a.ticker)}</span><span data-p="${a.id}">${money(a.price)}</span><span>· you own ${h ? fmtQty(h.qty) : 0}</span></div></div></div>
    <div class="type-chips">${types.map(([k, n]) => `<button data-otype2="${k}" class="${o.type === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    ${o.type === 'market' ? `<div class="unit-toggle"><div class="seg">${[['usd', 'Dollars'], ['sh', 'Shares']].map(([k, n]) => `<button data-unit="${k}" class="${o.unit === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>` : ''}
    ${o.type === 'limit' || o.type === 'stop' ? `<label class="price-field"><span class="small muted">${o.type === 'limit' ? 'Limit price' : 'Stop price'}</span>
      <input id="oprice" inputmode="decimal" value="${esc(o.price)}" placeholder="0.00"></label>` : ''}
    ${o.type === 'recurring' ? `<div class="unit-toggle"><div class="seg">${[['daily', 'Daily'], ['weekly', 'Weekly']].map(([k, n]) => `<button data-freq="${k}" class="${o.freq === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>` : ''}
    <div class="qty"><button data-q="-1" aria-label="Less">−</button><input id="qtyin" inputmode="decimal" value="${esc(o.amount)}"><button data-q="1" aria-label="More">+</button></div>
    <div class="unit-lbl" id="unitlbl">${unitLabel(o)}</div>
    <div class="quick">${quick.map(([n, v]) => `<button data-qset="${v}">${n}</button>`).join('')}</div>
    <div class="order-desc" id="odesc"></div>
    <div class="summary" id="osum"></div>
    <div class="err" id="terr"></div>
    ${sliderHTML(o.type === 'recurring' ? 'Slide to schedule' : o.type === 'market' ? `Slide to ${o.side}` : 'Slide to place order')}
    <button class="link-btn" data-act="tcancel">Cancel</button>`;
  bindSlider();
  updateOrder();
}

const unitLabel = (o) => (o.type === 'market' && o.unit === 'usd') || o.type === 'recurring' ? 'dollars' : 'shares';

function amountNum(o) {
  const v = parseFloat(String(o.amount).replace(/[^0-9.]/g, ''));
  return isFinite(v) ? v : 0;
}

// Work out what the current order would do. Returns rows for the summary.
function computeOrder() {
  const o = ui.order;
  const a = state.assets[o.id];
  const h = state.holdings[a.id];
  const bp = buyingPower(state);
  const amt = amountNum(o);
  const res = { rows: [], desc: '', err: '', ok: false };
  if (o.type === 'market') {
    let qty = o.unit === 'usd' ? (o.side === 'buy' ? dollarsToQty(state, a.id, amt) : amt / (a.price * (1 - SPREAD))) : amt;
    if (o.side === 'sell' && h) qty = Math.min(qty, h.qty);
    if (o.side === 'sell' && h && o.unit === 'usd' && amt >= a.price * h.qty * (1 - SPREAD) - 0.01) qty = h.qty;
    const pv = qty > 0 ? previewTrade(state, a.id, o.side, qty) : { fill: a.price, total: 0, post: a.price };
    res.qty = qty;
    res.rows = [
      ['Est. shares', qty > 0 ? fmtQty(qty) : '—'],
      ['Est. price', money(pv.fill)],
      [o.side === 'buy' ? 'Est. cost' : 'Est. proceeds', money(pv.total)],
      ['Buying power after', money(o.side === 'buy' ? bp - pv.total : bp + pv.total)],
      ['Price impact', `<span class="${cls(pv.post - a.price)}">${fmtPct(pv.post / a.price - 1)}</span>`],
    ];
    if (!(amt > 0)) res.err = 'Enter an amount';
    else if (o.side === 'buy' && pv.total > bp + 0.005) res.err = `Not enough buying power (${money(bp)})`;
    else if (o.side === 'sell' && !h) res.err = 'You don’t own any shares';
    else if (pv.total < minOrder(state) && !(o.side === 'sell' && h && qty === h.qty)) res.err = `Minimum order is ${money(minOrder(state))}`;
    else res.ok = true;
  } else if (o.type === 'recurring') {
    res.desc = `Buys ${money(amt)} of ${a.ticker} now, then every ${o.freq === 'daily' ? 'day' : 'week'} while you have buying power.`;
    res.rows = [['Amount', money(amt)], ['Frequency', o.freq === 'daily' ? 'Every day' : 'Every week'], ['First buy', 'Today']];
    if (!(amt >= minOrder(state))) res.err = `Minimum is ${money(minOrder(state))}`; else if (amt > bp) res.err = `Not enough buying power (${money(bp)})`; else res.ok = true;
  } else {
    const px = parseFloat(o.price);
    const verb = o.side === 'buy' ? 'Buy' : 'Sell';
    const cond = o.type === 'limit' ? (o.side === 'buy' ? 'at or below' : 'at or above') : (o.side === 'buy' ? 'once the price rises to' : 'once the price falls to');
    res.desc = `${verb} ${amt > 0 ? fmtQty(amt) : '—'} ${a.ticker} ${cond} ${px > 0 ? money(px) : '—'}. Good until canceled (90 days).`;
    res.rows = [['Est. total', px > 0 && amt > 0 ? money(px * amt) : '—'], ['Current price', money(a.price)]];
    const avail = (h?.qty || 0) - state.orders.filter((x) => x.assetId === a.id && x.side === 'sell').reduce((s, x) => s + x.qty, 0);
    if (!(px > 0)) res.err = `Enter a ${o.type} price`;
    else if (!(amt > 0)) res.err = 'Enter a number of shares';
    else if (o.side === 'buy' && px * amt > bp) res.err = `Not enough buying power (${money(bp)})`;
    else if (o.side === 'sell' && amt > avail + 1e-9) res.err = `You have ${fmtQty(Math.max(0, avail))} shares available`;
    else if (o.type === 'stop' && o.side === 'sell' && px >= a.price) res.err = 'A stop-loss must be below the current price';
    else if (o.type === 'limit' && o.side === 'buy' && px >= a.price * 1.01) res.err = 'That limit is above the current price — use a market order';
    else res.ok = true;
  }
  return res;
}

// In-place update of numbers; the panel itself is never rebuilt here.
function updateOrder() {
  const o = ui.order;
  if (!o) return;
  if (o.mode === 'option') return updateOptionOrder();
  const r = computeOrder();
  const sum = $('#osum'); if (!sum) return;
  sum.innerHTML = r.rows.map(([k, v]) => `<div class="brk"><span class="muted">${k}</span><b>${v}</b></div>`).join('');
  $('#odesc').textContent = r.desc;
  $('#terr').textContent = o.err || (r.err && amountNum(o) ? r.err : '');
  $('#slider')?.classList.toggle('disabled', !r.ok);
}

function buildOptionOrder() {
  const o = ui.order; const panel = $('#panel');
  const a = state.assets[o.under];
  const held = state.options[optKey(o.under, o.type, o.strike, o.exp)];
  panel.style.setProperty('--acc', `var(--${o.side === 'sell' ? 'down' : 'up'})`);
  panel.innerHTML = `<div class="grabber"></div>
    <div class="seg">${['buy', 'sell'].map((s) => `<button data-oside="${s}" class="${o.side === s ? 'on' : ''}" ${s === 'sell' && !held ? 'disabled' : ''}>${s === 'buy' ? 'Buy to open' : 'Sell to close'}</button>`).join('')}</div>
    <div style="margin-top:14px"><div class="name" style="font-size:18px">${esc(optLabel(a, o))}</div>
      <div class="small muted" style="margin-top:3px">${esc(a.name)} · <span data-p="${a.id}">${money(a.price)}</span> · expires ${fmtExp(o.exp)}, 4pm New York (${fmtDateTime(o.exp)} your time)${held ? ` · you hold ${held.qty}` : ''}</div></div>
    <div class="qty"><button data-q="-1" aria-label="Fewer">−</button><input id="qtyin" inputmode="numeric" value="${esc(o.amount)}"><button data-q="1" aria-label="More">+</button></div>
    <div class="unit-lbl">contracts (100 shares each)</div>
    <div class="payoff" id="payoff"></div>
    <div class="summary" id="osum"></div>
    <div class="err" id="terr"></div>
    ${sliderHTML(o.side === 'buy' ? 'Slide to buy' : 'Slide to sell')}
    <button class="link-btn" data-act="tcancel">Cancel</button>`;
  bindSlider();
  updateOptionOrder();
}

function updateOptionOrder() {
  const o = ui.order;
  const a = state.assets[o.under];
  const now = Date.now();
  const q = quoteOption(state, o.under, o.type, o.strike, o.exp, now);
  const qty = Math.max(0, Math.floor(amountNum(o)));
  const held = state.options[optKey(o.under, o.type, o.strike, o.exp)];
  const px = o.side === 'buy' ? q.ask : q.bid;
  const total = px * CONTRACT * qty;
  const pop = greeks(o.type, a.price, q.breakeven, q.T, q.iv).pItm;
  let err = '';
  if (!qty) err = 'Enter a number of contracts';
  else if (o.side === 'buy' && total > buyingPower(state)) err = `Not enough buying power (${money(buyingPower(state))})`;
  else if (o.side === 'sell' && (!held || qty > held.qty)) err = `You hold ${held?.qty || 0} contract${held?.qty === 1 ? '' : 's'}`;
  const rows = o.side === 'buy' ? [
    ['Premium', `${money(q.ask)} × 100`], ['Total cost', money(total)], ['Max loss', money(total)],
    ['Breakeven at expiry', `${money(q.breakeven)} (${fmtPct(q.toBreakeven, 1)})`], ['Chance of profit (model)', `${Math.round(pop * 100)}%`],
    ...(a.kind !== 'fund' ? [['Game risk', q.games.total > 0.05 ? `${gamesLabel(q.games)} · ${Math.round(q.gameShare * 100)}% of premium` : 'No games before expiry']] : []),
    ['Delta · decay next 24h', `${q.delta.toFixed(2)} · ${signMoney(q.theta * CONTRACT * Math.max(qty, 1))}`], ['Implied volatility', `${Math.round(q.iv * 100)}%`],
  ] : [
    ['Bid', `${money(q.bid)} × 100`], ['Est. proceeds', money(total)],
    ['Your cost', held ? money((held.cost / held.qty) * qty) : '—'],
    ['Est. P/L', held ? `<span class="${cls(total - (held.cost / held.qty) * qty)}">${signMoney(total - (held.cost / held.qty) * qty)}</span>` : '—'],
  ];
  $('#osum').innerHTML = rows.map(([k, v]) => `<div class="brk"><span class="muted">${k}</span><b>${v}</b></div>`).join('');
  $('#terr').textContent = o.err || (qty ? err : '');
  $('#slider')?.classList.toggle('disabled', !!err);
  const pay = $('#payoff');
  if (pay && !pay.dataset.k) {
    const prem = o.side === 'buy' ? q.ask : (held ? held.cost / held.qty / CONTRACT : q.bid);
    const spanLo = Math.min(a.price, o.strike) * 0.6; const spanHi = Math.max(a.price, o.strike) * 1.4;
    payoffChart(pay, payoffCurve(o.type, o.strike, prem, Math.max(qty, 1), spanLo, spanHi), { current: a.price, breakeven: o.type === 'call' ? o.strike + prem : o.strike - prem });
    pay.dataset.k = `${qty}`;
  }
}

function sliderHTML(label) {
  return `<div class="slider" id="slider"><div class="fill"></div><div class="txt">${label}</div><div class="knob" tabindex="0" role="button" aria-label="${label}">›</div></div>`;
}

// Robinhood-style slide to confirm. Works with touch, mouse and keyboard (Enter).
function bindSlider() {
  const s = $('#slider'); if (!s) return;
  const knob = s.querySelector('.knob'); const fill = s.querySelector('.fill');
  let start = 0; let dx = 0; let dragging = false;
  const max = () => s.clientWidth - knob.offsetWidth - 8;
  const set = (x) => { knob.style.left = `${4 + x}px`; fill.style.width = `${58 + x}px`; };
  knob.addEventListener('pointerdown', (e) => { dragging = true; start = e.clientX; dx = 0; knob.setPointerCapture(e.pointerId); s.classList.remove('done'); });
  knob.addEventListener('pointermove', (e) => { if (!dragging) return; dx = clamp(e.clientX - start, 0, max()); set(dx); });
  const up = () => {
    if (!dragging) return; dragging = false;
    if (dx >= max() * 0.85) { set(max()); submitOrder(); } else { s.classList.add('done'); set(0); }
  };
  knob.addEventListener('pointerup', up);
  knob.addEventListener('pointercancel', up);
  knob.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitOrder(); });
}

function submitOrder() {
  const o = ui.order;
  const reset = (msg) => { o.err = msg; updateOrder(); const k = $('#slider .knob'); if (k) { $('#slider').classList.add('done'); k.style.left = '4px'; $('#slider .fill').style.width = '58px'; } setTimeout(() => { if (ui.order) { ui.order.err = ''; updateOrder(); } }, 3500); };
  const firstTrade = !state.txns.length;
  try {
    let msg;
    if (o.mode === 'option') {
      const qty = Math.floor(amountNum(o));
      if (o.side === 'buy') { const tx = buyOption(state, o, qty); msg = `Bought ${qty} × ${tx.opt} for ${money(tx.total)}`; }
      else { const tx = sellOption(state, optKey(o.under, o.type, o.strike, o.exp), qty); msg = `Sold ${qty} × ${tx.opt} for ${money(tx.total)}`; }
    } else {
      const r = computeOrder();
      if (!r.ok) return reset(r.err);
      const a = state.assets[o.id];
      if (o.type === 'market') {
        const tx = trade(state, o.id, o.side, r.qty);
        msg = `${tx.side === 'buy' ? 'Bought' : 'Sold'} ${fmtQty(tx.qty)} ${tx.ticker} at ${money(tx.price)}`;
      } else if (o.type === 'recurring') {
        addRecurring(state, { assetId: o.id, amount: amountNum(o), freq: o.freq });
        runAutomation(state);
        msg = `Recurring buy set: ${money(amountNum(o))} of ${a.ticker} ${o.freq}`;
      } else {
        placeOrder(state, { assetId: o.id, side: o.side, type: o.type, qty: amountNum(o), price: parseFloat(o.price) });
        msg = `${o.type === 'limit' ? 'Limit' : 'Stop'} order placed for ${a.ticker}`;
        runAutomation(state);
      }
    }
    haptic();
    closeOrder();
    const n0 = state.inbox.length;
    runSocial(state); runCareer(state);
    const fresh = state.inbox.slice(0, state.inbox.length - n0);
    const lvl = fresh.find((n) => n.kind === 'level');
    if (fresh.some((n) => n.kind === 'card' && /^New/.test(n.text))) msg += ' · 🃏 New card';
    else if (fresh.some((n) => n.kind === 'card')) msg += ' · 🃏 Card leveled up';
    if (fresh.some((n) => n.kind === 'trophy')) msg += ' · 🏆 Trophy';
    if (lvl) msg += ` · ⭐ ${lvl.text.split('!')[0]}`;
    dirty = true; save();
    ui.seenInbox = state.inbox.length;
    toast(msg);
    if (firstTrade && state.txns.length) confetti();
    if (ui.chain) renderChain();
    if (ui.detail) renderDetail();
    else render();
  } catch (e) {
    reset(e.message);
  }
}

// ---------- confetti (first trade) ----------

function confetti() {
  const c = $('#confetti');
  if (!c || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  c.hidden = false; c.width = innerWidth; c.height = innerHeight;
  const ctx = c.getContext('2d');
  const colors = ['#1fd67a', '#ffd60a', '#3b82f6', '#f97316', '#ff5a5f', '#b8a6ff'];
  const parts = Array.from({ length: 140 }, () => ({ x: innerWidth / 2, y: innerHeight * 0.55, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 16 - 6, r: Math.random() * 6 + 3, c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * 6 }));
  const t0 = performance.now();
  const frame = (t) => {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) { p.vy += 0.45; p.x += p.vx; p.y += p.vy; p.a += 0.2; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore(); }
    if (t - t0 < 1800) requestAnimationFrame(frame); else { c.hidden = true; }
  };
  requestAnimationFrame(frame);
}

// ---------- price alert (inline card in the order panel) ----------

function openAlert() {
  const a = state.assets[ui.detail];
  ui.order = { mode: 'alert', id: a.id };
  const wrap = $('#trade'); const panel = $('#panel');
  wrap.hidden = false;
  const mine = state.alerts.filter((x) => x.assetId === a.id);
  panel.style.setProperty('--acc', 'var(--up)');
  panel.innerHTML = `<div class="grabber"></div>
    <div class="name" style="font-size:18px">Price alert for ${esc(a.ticker)}</div>
    <div class="sub">Now <span data-p="${a.id}">${money(a.price)}</span>. You'll get a notification when it crosses your price.</div>
    <label class="price-field"><span class="small muted">Alert me at</span><input id="alertpx" inputmode="decimal" value="${(a.price * 1.05).toFixed(2)}"></label>
    <div class="quick" style="margin-top:12px">${[-10, -5, 5, 10].map((p) => `<button data-alertpct="${p}">${p > 0 ? '+' : ''}${p}%</button>`).join('')}</div>
    <div class="err" id="terr"></div>
    <div class="btn-row"><button class="btn ghost" data-act="tcancel">Cancel</button><button class="btn buy" data-act="setalert">Set alert</button></div>
    ${mine.length ? `<h3>Active alerts</h3><div class="list">${mine.map((al) => `<div class="item"><div class="grow">${al.dir} ${money(al.price)}</div><button class="x-btn" data-rmalert="${al.id}">✕</button></div>`).join('')}</div>` : ''}`;
  panel.classList.remove('enter'); void panel.offsetWidth; panel.classList.add('enter');
}

// ---------- routing & events ----------

function closeOverlays() {
  if (ui.order) closeOrder(); if (ui.chain) closeChain(true);
  if (ui.detail) { ui.detail = null; $('#sheet').hidden = true; $('#tradebar').hidden = true; unlockBody(); }
  if (ui.game) { ui.game = null; $('#game').hidden = true; $('#game').innerHTML = ''; }
  if (ui.draft) { ui.draft = null; $('#draft').hidden = true; $('#draft').innerHTML = ''; $('#dfoot').hidden = true; }
}

function render() {
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  if (ui.tab === 'home') renderHome();
  else if (ui.tab === 'market') renderMarket();
  else if (ui.tab === 'news') renderNews();
  else if (ui.tab === 'games') renderGames();
  else if (ui.tab === 'marketplace') renderMarketplace();
  else renderAccount();
}

// Re-render whatever is on top, without jumping scroll or interrupting a gesture.
function softRefresh() {
  if (ui.order) { refreshBadge(); return; }
  // Never swap out content under a finger: the rest of the gesture would be lost.
  if (ui.touching || Date.now() - ui.lastScroll < 900) { clearTimeout(softRefresh.t); softRefresh.t = setTimeout(softRefresh, 900); return; }
  if (ui.chain) renderChain();
  else if (ui.detail) renderDetail();
  else if (ui.game) renderGame();
  else if (ui.draft) refreshBadge();
  else if (ui.tab === 'games' && ['stake', 'dq'].includes(document.activeElement?.id)) refreshBadge();
  else if (ui.tab === 'marketplace' && document.activeElement?.id === 'mpq') refreshBadge();
  else if (!(ui.tab === 'market' && document.activeElement?.id === 'q')) {
    const y = view().scrollTop; render(); view().scrollTop = y;
  } else refreshBadge();
}

// Cheap refresh of numbers on screen between full renders.
function updateNumbers() {
  const now = Date.now();
  document.querySelectorAll('[data-p]').forEach((el) => {
    const a = state.assets[el.dataset.p]; if (!a) return;
    const txt = money(a.price);
    if (el.textContent !== txt) {
      const upTick = a.price >= parseFloat(el.textContent.replace(/[^0-9.\-]/g, ''));
      el.textContent = txt;
      el.style.transition = 'none'; el.style.color = `var(--${upTick ? 'up' : 'down'})`;
      requestAnimationFrame(() => { el.style.transition = 'color 1.2s'; el.style.color = ''; });
    }
  });
  document.querySelectorAll('[data-c]').forEach((el) => {
    const a = state.assets[el.dataset.c]; if (!a) return;
    const ch = change(a, now, RANGES[el.dataset.r || '1D']);
    el.textContent = fmtPct(ch);
    el.className = el.dataset.plain ? `small ${cls(ch)}` : `pill ${cls(ch)}`;
  });
  const nwEl = $('[data-nw]');
  if (nwEl) {
    const nw = netWorth(state, now); const ref = nwAt(now - RANGES[ui.homeRange]) ?? state.startCash; const ch = nw - ref;
    nwEl.textContent = money(nw);
    const c = $('[data-nwc]');
    c.className = `change-line ${cls(ch)}`;
    c.innerHTML = `${ch >= 0 ? '▲' : '▼'} ${money(Math.abs(ch))} (${fmtPct(ref ? ch / ref : 0)}) <span class="muted">${rangeLabel(ui.homeRange)}</span>`;
  }
  if (ui.detail && !ui.chain) {
    updateDetailHeader();
    if (!ui.scrub && !busyScrolling() && ui.range === '1D') drawDetailChart(); // live line
  }
  if (ui.order && ['stock', 'option'].includes(ui.order.mode) && document.activeElement?.id !== 'qtyin' && document.activeElement?.id !== 'oprice') updateOrder();
}

function maybeRecap() {
  const rec = career(state).recap;
  if (rec && $('#recap').hidden && !ui.order) showRecap(rec);
}

// Toast new notifications (fills, dividends, expiries, alerts).
function announce() {
  const fresh = state.inbox.slice(0, Math.max(0, state.inbox.length - ui.seenInbox)).filter((n) => !n.seen);
  ui.seenInbox = state.inbox.length;
  if (!fresh.length) return;
  toast(fresh.length === 1 ? fresh[0].text : `${fresh[0].text} (+${fresh.length - 1} more)`);
  refreshBadge();
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('button, [data-open], label, [data-optpos], [data-game], [data-flip]');
  if (!el) return;
  const d = el.dataset;
  if (el.disabled) return;
  if (d.tab) {
    if (d.tab === ui.tab && !overlayOpen()) { view().scrollTo({ top: 0, behavior: 'smooth' }); return; }
    ui.tab = d.tab; ui.limit = 60;
    closeOverlays();
    render(); view().scrollTop = 0; return;
  }
  if (d.cancelorder) { e.stopPropagation(); cancelOrder(state, d.cancelorder); dirty = true; toast('Order canceled'); softRefresh(); return; }
  if (d.cancelrec) { cancelRecurring(state, d.cancelrec); dirty = true; toast('Recurring buy stopped'); renderAccount(); return; }
  if (d.rmalert) { removeAlert(state, d.rmalert); dirty = true; toast('Alert removed'); if (ui.order?.mode === 'alert') openAlert(); else if (ui.tab === 'account' && !overlayOpen()) renderAccount(); return; }
  if (d.optpos) {
    const pos = state.options[d.optpos];
    if (!pos) return;
    if (!ui.detail || ui.detail !== pos.under) { ui.detail = pos.under; lockBody(); renderDetail({ keepScroll: false }); try { history.pushState({ sheet: pos.under }, ''); } catch { /* */ } }
    openOrder({ mode: 'option', side: 'sell', under: pos.under, type: pos.type, strike: pos.strike, exp: pos.exp, amount: String(pos.qty), err: '' });
    return;
  }
  if (d.open) { e.preventDefault(); openDetail(d.open); return; }
  if (d.pick) {
    const [lg, gid] = d.pick.split('|');
    const g = upcomingPickGames(state, Date.now(), [lg]).find((x) => x.id === gid);
    if (!g) { toast('This game has started — picks are locked'); softRefresh(); return; }
    try {
      haptic();
      if (state.picks[gid]?.teamId === d.team) { clearPick(state, gid); toast('Pick removed'); }
      else { const pk = makePick(state, g, d.team); toast(`Picked ${pk.abbr} · win pays ${money(pickPayout(state, pk))}`); }
      dirty = true;
    } catch (err) { toast(err.message); }
    if (ui.game) renderGame(); else { const y = view().scrollTop; renderGames(); view().scrollTop = y; }
    return;
  }
  if (d.game) { const [lg, gid] = d.game.split('|'); openGame(lg, gid); return; }
  if (d.gtab) { ui.gtab = d.gtab; ui.tab = 'games'; closeOverlays(); render(); view().scrollTop = 0; return; }
  if (d.draft) { const [lg, tier] = d.draft.split('|'); openDraft(lg, tier); return; }
  if (d.dpick && ui.draft) {
    const p = ui.draft.picks; const i = p.indexOf(d.dpick);
    if (i >= 0) p.splice(i, 1); else if (p.length < LINEUP) p.push(d.dpick); else { toast(`Lineups have ${LINEUP} players — remove one first`); return; }
    ui.draft.err = ''; haptic(); renderDraft(true); return;
  }
  if (d.prop) {
    const cut = d.prop.lastIndexOf('|');
    const key = d.prop.slice(0, cut); const side = d.prop.slice(cut + 1);
    const p = propBoard(state, Date.now(), enabledLeagues()).find((x) => x.key === key);
    if (!p) { toast('That line is closed'); return; }
    const slip = (ui.slip ||= { legs: [], stake: '' });
    const i = slip.legs.findIndex((l) => l.assetId === p.assetId);
    if (i >= 0 && slip.legs[i].side === side) slip.legs.splice(i, 1);
    else if (i >= 0) slip.legs[i] = { ...p, side };
    else if (slip.legs.length >= MAX_LEGS(state)) { if (MAX_LEGS(state) === 1) slip.legs = [{ ...p, side }]; else { toast('Up to 3 picks per parlay'); return; } }
    else slip.legs.push({ ...p, side });
    slip.err = ''; haptic(); const y = view().scrollTop; renderGames(); view().scrollTop = y; return;
  }
  if (d.rmleg) { ui.slip.legs.splice(Number(d.rmleg), 1); const y = view().scrollTop; renderGames(); view().scrollTop = y; return; }
  if (d.stake) {
    ui.slip.stake = d.stake.endsWith('%') ? (Math.floor(Math.min(state.cash * Number(d.stake.slice(0, -1)) / 100, netWorth(state) * 0.25) * 100) / 100).toFixed(2) : d.stake;
    const inp = $('#stake'); if (inp) inp.value = ui.slip.stake; updateSlipPay(); return;
  }
  if (d.pack) {
    const pack = PACKS.find((x) => x.key === d.pack);
    try { const cards = openPack(state, d.pack); dirty = true; save(); haptic(); showPack(cards, pack); } catch (err) { toast(err.message); }
    return;
  }
  if (d.flip != null && ui.packView) {
    if (el.classList.contains('flipped')) return;
    el.classList.add('flipped'); haptic();
    const c = ui.packView.cards[Number(d.flip)];
    if (['legendary', 'epic', 'iconic'].includes(c.rarity.key)) confetti();
    if (!$('#packview').querySelectorAll('.pv-card:not(.flipped)').length) $('#packview [data-act=packdone]').textContent = 'Done';
    return;
  }
  if (d.theme) {
    const c = career(state);
    try { if (c.owned.themes.includes(d.theme)) equipItem(state, 'theme', d.theme); else buyItem(state, 'theme', d.theme); applyTheme(); dirty = true; save(); haptic(); const y = view().scrollTop; renderGames(); view().scrollTop = y; }
    catch (err) { toast(err.message); }
    return;
  }
  if (d.title) {
    const c = career(state);
    try { if (c.owned.titles.includes(d.title)) equipItem(state, 'title', d.title); else buyItem(state, 'title', d.title); dirty = true; save(); haptic(); toast(`Title: ${d.title}`); const y = view().scrollTop; renderGames(); view().scrollTop = y; }
    catch (err) { toast(err.message); }
    return;
  }
  if (d.booster) { openBoosterSheet(d.booster); return; }
  if (d.bequip && ui.order?.mode === 'booster') {
    try { equip(state, ui.order.id, d.bequip); dirty = true; save(); haptic(); toast(`Boosting ${state.assets[d.bequip].ticker}`); closeOrder(); afterBoostChange(); }
    catch (err) { $('#terr').textContent = err.message; }
    return;
  }
  if (d.bpickone && ui.order?.mode === 'bpick') {
    try { const aid = ui.order.id; equip(state, d.bpickone, aid); dirty = true; save(); haptic(); toast(`Boosting ${state.assets[aid].ticker}`); closeOrder(); afterBoostChange(); }
    catch (err) { $('#terr').textContent = err.message; }
    return;
  }
  if (d.blen && ui.order?.mode === 'booster') { ui.order.len = d.blen; const v = $('#bstart')?.value; renderBoosterSheet(); if (v && $('#bstart')) $('#bstart').value = v; return; }
  if (d.fuse) {
    try { const nb = fuse(state, d.fuse); dirty = true; save(); haptic(); confetti(); toast(`${nb.m.player.name}'s card is now ${bRarity(nb.rarity).name}!`); afterBoostChange(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (d.bpack) {
    const pack = B_PACKS.find((x) => x.key === d.bpack);
    try { const got = openBoosterPack(state, d.bpack); dirty = true; save(); haptic(); showBoosterPack(got, pack); } catch (err) { toast(err.message); }
    return;
  }
  if (d.lot) { openLot(d.lot, !!d.bidbtn); return; }
  if (d.mprar) { ui.mp.rarity = d.mprar; renderMarketplace(); return; }
  if (d.mpsort) { ui.mp.sort = d.mpsort; renderMarketplace(); return; }
  if (d.mpl) { ui.mp.league = d.mpl; renderMarketplace(); return; }
  if (d.bidq) { const i = $('#bidamt'); if (i) i.value = d.bidq; return; }
  if (d.gleague) { ui.gamesLeague = d.gleague; ui.pickLimit = 8; const y = view().scrollTop; renderGames(); view().scrollTop = y; return; }
  if (d.mview) { ui.mview = d.mview; renderMarket(); return; }
  if (d.league) { ui.league = d.league; ui.limit = 60; renderMarket(); return; }
  if (d.kind) { ui.kind = d.kind; ui.limit = 60; if (d.kind === 'fund' && !['movers', 'losers', 'price', 'div'].includes(ui.sort)) ui.sort = 'price'; renderMarket(); return; }
  if (d.price) { ui.price = d.price; ui.limit = 60; renderMarket(); return; }
  if (d.sort) { ui.sort = d.sort; ui.limit = 60; if (d.sort === 'streak') ui.kind = 'team'; renderMarket(); return; }
  if (d.coll) {
    ui.tab = 'market'; ui.q = ''; ui.league = 'all'; ui.limit = 60;
    if (d.coll === 'funds') { ui.kind = 'fund'; ui.sort = 'price'; } else { ui.sort = d.coll; ui.kind = d.coll === 'streak' ? 'team' : d.coll === 'mvp' || d.coll === 'hurt' ? 'player' : ui.kind === 'fund' ? 'player' : ui.kind; }
    if (d.coll === 'cheap') { ui.sort = 'movers'; ui.price = 'u25'; ui.kind = 'player'; } else ui.price = 'any';
    render(); view().scrollTop = 0; return;
  }
  if (d.idx) { ui.tab = 'market'; ui.league = d.idx; ui.sort = 'price'; render(); return; }
  if (d.nleague) { ui.newsLeague = d.nleague; renderNews(); return; }
  if (d.actf) { ui.actFilter = d.actf; renderAccount(); return; }
  if (d.startcash) { state.settings.startCash = Number(d.startcash); dirty = true; const y = view().scrollTop; renderAccount(); view().scrollTop = y; return; }
  if (d.range) { ui.range = d.range; renderDetail(); return; }
  if (d.hrange) { ui.homeRange = d.hrange; renderHome(); return; }
  if (d.exp) { ui.chain.exp = Number(d.exp); renderChain(); return; }
  if (d.otype) { ui.chain.type = d.otype; renderChain(); return; }
  if (d.strike) {
    const c = ui.chain;
    openOrder({ mode: 'option', side: 'buy', under: c.under, type: c.type, strike: Number(d.strike), exp: c.exp, amount: '1', err: '' });
    return;
  }
  // order panel controls
  if (d.oside && ui.order) {
    if (ui.order.mode === 'option') {
      const held = state.options[optKey(ui.order.under, ui.order.type, ui.order.strike, ui.order.exp)];
      Object.assign(ui.order, { side: d.oside, amount: d.oside === 'sell' ? String(held?.qty || 1) : '1' });
    } else {
      Object.assign(ui.order, stockOrderDefaults(d.oside));
    }
    buildOrder(); return;
  }
  if (d.otype2 && ui.order) {
    const o = ui.order; const a = state.assets[o.id];
    o.type = d.otype2; o.err = '';
    if (o.type === 'market') o.unit = o.side === 'buy' ? 'usd' : 'sh';
    if (o.type === 'recurring') o.amount = Math.max(minOrder(state), Math.round(bankrollScale(state) * 2500) / 100).toFixed(2);
    if (o.type === 'limit' || o.type === 'stop') {
      o.unit = 'sh';
      const h = state.holdings[a.id];
      if (o.side === 'sell') o.amount = h ? fmtQty(h.qty) : '';
      else o.amount = String(Math.max(1, Math.floor(buyingPower(state) * 0.1 / a.price)) || 1);
      const f = o.type === 'limit' ? (o.side === 'buy' ? 0.97 : 1.05) : (o.side === 'buy' ? 1.05 : 0.93);
      o.price = (a.price * f).toFixed(2);
    }
    buildOrder(); return;
  }
  if (d.unit && ui.order) {
    const o = ui.order; const a = state.assets[o.id];
    if (o.unit !== d.unit) {
      const amt = amountNum(o);
      o.amount = d.unit === 'usd' ? (amt * a.price).toFixed(2) : fmtQty(Math.round((amt / a.price) * 1e4) / 1e4);
      o.unit = d.unit;
    }
    buildOrder(); return;
  }
  if (d.freq && ui.order) { ui.order.freq = d.freq; buildOrder(); return; }
  if (d.q && ui.order) {
    const o = ui.order;
    const step = o.mode === 'option' ? 1 : unitLabel(o) === 'dollars' ? Math.max(0.05, Math.round(bankrollScale(state) * 1000) / 100) : 1;
    o.amount = String(Math.max(o.mode === 'option' ? 1 : 0, Math.round((amountNum(o) + Number(d.q) * step) * 1e4) / 1e4));
    syncQtyInput(); return;
  }
  if (d.qset && ui.order) {
    const o = ui.order; const a = state.assets[o.id];
    const h = state.holdings[a?.id];
    if (o.side === 'sell') {
      const q = (h?.qty || 0) * Number(d.qset);
      o.amount = o.unit === 'usd' ? (q * a.price * (1 - SPREAD)).toFixed(2) : fmtQty(Number(d.qset) === 1 ? h.qty : Math.floor(q * 1e4) / 1e4);
    } else if (d.qset === 'max') {
      const bp = buyingPower(state);
      o.amount = unitLabel(o) === 'dollars' ? (Math.floor(bp * 100) / 100).toFixed(2) : String(Math.floor(dollarsToQty(state, a.id, bp)));
    } else o.amount = d.qset;
    syncQtyInput(); return;
  }
  if (d.alertpct) { const a = state.assets[ui.detail]; $('#alertpx').value = (a.price * (1 + Number(d.alertpct) / 100)).toFixed(2); return; }
  switch (d.act) {
    case 'back': if (history.state?.sheet) history.back(); else closeDetail(); break;
    case 'chainback': if (history.state?.chain) history.back(); else closeChain(); break;
    case 'chain': openChain(); break;
    case 'watch': {
      const i = state.watch.indexOf(ui.detail);
      if (i >= 0) state.watch.splice(i, 1); else state.watch.unshift(ui.detail);
      haptic(); dirty = true; renderDetail(); toast(i >= 0 ? 'Removed from watchlist' : 'Added to watchlist'); break;
    }
    case 'alert': openAlert(); break;
    case 'setalert': {
      try { const al = addAlert(state, { assetId: ui.detail, price: parseFloat($('#alertpx').value) }); dirty = true; closeOrder(); toast(`Alert set: ${al.ticker} ${al.dir} ${money(al.price)}`); renderDetail(); }
      catch (err) { $('#terr').textContent = err.message; }
      break;
    }
    case 'buy': openOrder(stockOrderDefaults('buy')); break;
    case 'sell': openOrder(stockOrderDefaults('sell')); break;
    case 'tcancel': closeOrder(); break;
    case 'more': ui.limit += 60; renderMarket(); break;
    case 'morepicks': { ui.pickLimit = (ui.pickLimit || 8) + 12; const y = view().scrollTop; renderGames(); view().scrollTop = y; break; }
    case 'allcards': { ui.allCards = true; const y = view().scrollTop; renderGames(); view().scrollTop = y; break; }
    case 'claim': {
      try {
        const r = claimDaily(state); haptic(); dirty = true; save();
        toast(`+${money(r.reward)} daily reward · ${r.streak}-day streak`);
        if (r.streak % 7 === 0) confetti();
        runSocial(state); const y = view().scrollTop; render(); view().scrollTop = y;
      } catch (err) { toast(err.message); }
      break;
    }
    case 'gameback': if (history.state?.game) history.back(); else closeGame(); break;
    case 'bunequip': if (ui.order?.mode === 'booster') { unequip(state, ui.order.id); dirty = true; save(); closeOrder(); afterBoostChange(); } break;
    case 'bsell':
      if (ui.order?.mode === 'booster' && armed(el, `Tap again to sell for 🪙 ${quickSellPrice(boosterState(state).inv.find((x) => x.id === ui.order.id))}`)) {
        try { const p = quickSell(state, ui.order.id); dirty = true; save(); haptic(); toast(`Sold for ${p} coins`); closeOrder(); afterBoostChange(); } catch (err) { $('#terr').textContent = err.message; }
      }
      break;
    case 'blist':
      try { const au = listAuction(state, ui.order.id, { start: $('#bstart').value, length: ui.order.len }); dirty = true; save(); haptic(); toast(`Listed! Bidding ends in ${AUCTION_LENGTHS.find((x) => x.key === ui.order.len).label}`); closeOrder(); afterBoostChange(); void au; }
      catch (err) { $('#terr').textContent = err.message; }
      break;
    case 'bcancel': {
      const b = boosterState(state).inv.find((x) => x.id === ui.order?.id);
      try { cancelAuction(state, b?.listed); dirty = true; save(); toast('Auction cancelled'); renderBoosterSheet(); afterBoostChange(); } catch (err) { $('#terr').textContent = err.message; }
      break;
    }
    case 'bpickfor': openBoosterPicker(); break;
    case 'findcards': { const a = state.assets[ui.detail]; ui.mp ||= { league: 'all', rarity: 'all', sort: 'ending', q: '', view: 'browse' }; ui.mp.q = a.name; ui.mp.view = 'browse'; ui.tab = 'marketplace'; closeOverlays(); render(); break; }
    case 'mymarket': ui.mp.view = ui.mp.view === 'mine' ? 'browse' : 'mine'; renderMarketplace(); view().scrollTop = 0; break;
    case 'placebid': {
      try {
        const r = placeBid(state, ui.order.id, $('#bidamt').value); dirty = true; save(); haptic();
        if (r.leading) { toast(`You're the top bidder at 🪙 ${r.price}`); closeOrder(); renderMarketplace(); }
        else { $('#terr').textContent = `Outbid right away: another collector went to 🪙 ${r.price}. Your coins are back.`; renderLot(); }
      } catch (err) { $('#terr').textContent = err.message; }
      break;
    }
    case 'buynow':
      if (armed(el, 'Tap again to buy now')) {
        try { const p = buyNow(state, ui.order.id); dirty = true; save(); haptic(); confetti(); toast(`Bought for ${p} coins — it's in your Locker`); closeOrder(); renderMarketplace(); }
        catch (err) { $('#terr').textContent = err.message; }
      }
      break;
    case 'draftback': if (history.state?.draft) history.back(); else closeDraft(); break;
    case 'enterdraft': {
      const dr = ui.draft;
      try {
        const c = enterContest(state, { league: dr.league, tier: dr.tier, lineup: dr.picks });
        dirty = true; save(); haptic(); confetti();
        ui.gtab = 'contests';
        if (history.state?.draft) history.back(); else closeDraft();
        toast(`You're in! ${money(c.fee)} entry · good luck`);
      } catch (err) { dr.err = err.message; renderDraft(true); }
      break;
    }
    case 'placebet': {
      const slip = ui.slip;
      try {
        const b = placeBet(state, slip.legs, slip.stake);
        dirty = true; save(); haptic();
        ui.slip = { legs: [], stake: '' };
        toast(`Bet placed: ${money(b.stake)} to win ${money(potentialPayout(b.stake, b.legs.length))}`);
        const y = view().scrollTop; renderGames(); view().scrollTop = y;
      } catch (err) { slip.err = err.message; const e2 = $('#slerr'); if (e2) e2.textContent = err.message; }
      break;
    }
    case 'packdone':
      if (ui.packView && $('#packview').querySelectorAll('.pv-card:not(.flipped)').length) { $('#packview').querySelectorAll('.pv-card').forEach((x) => x.classList.add('flipped')); el.textContent = 'Done'; break; }
      ui.packView = null; $('#packview').hidden = true; $('#packview').innerHTML = ''; { const y = view().scrollTop; render(); view().scrollTop = y; } break;
    case 'recapdone': career(state).recap = null; dirty = true; save(); $('#recap').hidden = true; ui.tab = 'games'; ui.gtab = 'season'; closeOverlays(); render(); view().scrollTop = 0; break;
    case 'sharepf': sharePortfolio().catch((err) => toast(err.message)); break;
    case 'shareasset': if (ui.detail) shareAsset(state.assets[ui.detail]).catch((err) => toast(err.message)); break;
    case 'inbox': ui.tab = 'account'; ui.scrollTo = 'notifications'; closeOverlays(); render(); break;
    case 'refresh':
      if (STATIC) { toast('Prices use a data snapshot in this version'); break; }
      runSync({ manual: true }); break;
    case 'saveproxy': {
      state.settings.proxy = $('#proxy').value.trim(); setProxy(state.settings.proxy); dirty = true; save();
      toast('Saved'); break;
    }
    case 'test': await testConnection(); break;
    case 'export': exportData(); break;
    case 'resetpf':
      if (armed(el, 'Tap again to reset portfolio')) {
        const start = state.settings.startCash;
        resetPortfolio(state, start); runCareer(state, Date.now());
        ui.seenInbox = 0; dirty = true; save(); render(); toast(`Portfolio reset to ${money(start)}`);
      }
      break;
    case 'resetcharts':
      if (armed(el, 'Tap again to restart all charts')) { resetHistory(state, Date.now()); dirty = true; save(); render(); toast('Price charts restarted from today'); }
      break;
    case 'resetall':
      if (armed(el, 'Tap again to erase everything')) { await idbDel('state'); location.reload(); }
      break;
    case 'retry': runSync({ manual: true }); break;
    case 'bootsettings': $('#boot').hidden = true; ui.tab = 'account'; render(); break;
    default: break;
  }
});

// Re-render whatever shows boosters, keeping the scroll position.
function afterBoostChange() {
  if (ui.detail) renderDetail();
  else { const y = view().scrollTop; render(); view().scrollTop = y; }
}

function updateSlipPay() {
  const el = $('#slippay'); if (el && ui.slip) el.textContent = money(potentialPayout(Number(ui.slip.stake) || 0, ui.slip.legs.length));
}

function syncQtyInput() {
  const inp = $('#qtyin'); if (inp) inp.value = ui.order.amount;
  if (ui.order.mode === 'option') { const p = $('#payoff'); if (p) delete p.dataset.k; }
  ui.order.err = '';
  updateOrder();
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { ui.q = e.target.value; ui.limit = 60; renderMarket(true); }
  if (e.target.id === 'dq' && ui.draft) { ui.draft.q = e.target.value; renderDraft(true); }
  if (e.target.id === 'mpq' && ui.mp) {
    ui.mp.q = e.target.value; const pos = e.target.selectionStart; renderMarketplace();
    const inp = $('#mpq'); if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch { /* */ } }
  }
  if (e.target.id === 'stake' && ui.slip) { ui.slip.stake = e.target.value.replace(/[^0-9.]/g, ''); updateSlipPay(); }
  if (e.target.id === 'qtyin' && ui.order) {
    ui.order.amount = e.target.value.replace(ui.order.mode === 'option' ? /[^0-9]/g : /[^0-9.]/g, '');
    if (e.target.value !== ui.order.amount) e.target.value = ui.order.amount;
    ui.order.err = '';
    if (ui.order.mode === 'option') { const p = $('#payoff'); if (p) delete p.dataset.k; }
    updateOrder();
  }
  if (e.target.id === 'oprice' && ui.order) { ui.order.price = e.target.value.replace(/[^0-9.]/g, ''); ui.order.err = ''; updateOrder(); }
});

document.addEventListener('change', async (e) => {
  if (e.target.dataset.lgtoggle) {
    state.settings.leagues[e.target.dataset.lgtoggle] = e.target.checked;
    if (!enabledLeagues().length) { state.settings.leagues[e.target.dataset.lgtoggle] = true; e.target.checked = true; toast('Keep at least one league'); return; }
    dirty = true; save();
    if (e.target.checked && !state.sync[e.target.dataset.lgtoggle]?.seeded) runSync({ manual: true });
  }
  if (e.target.id === 'mprar') { ui.mp.rarity = e.target.value; renderMarketplace(); }
  if (e.target.id === 'mpsort') { ui.mp.sort = e.target.value; renderMarketplace(); }
  if (e.target.id === 'drip') { state.settings.drip = e.target.checked; dirty = true; save(); toast(e.target.checked ? 'Dividends will be reinvested' : 'Dividends will be paid as cash'); }
  if (e.target.id === 'importfile' && e.target.files[0]) {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!data.assets || !data.settings) throw new Error('Not a StatStreet backup');
      state = data; afterLoad(); dirty = true; await save(); render(); toast('Backup restored');
    } catch (err) { toast(err.message); }
  }
});

window.addEventListener('popstate', (e) => {
  const animate = !ui.noAnim; ui.noAnim = false;
  if (ui.draft && !e.state?.draft) { closeDraft({ animate }); return; }
  if (ui.order) { closeOrder({ animate }); }
  if (ui.chain && !e.state?.chain) { closeChain(false, { animate }); return; }
  const id = e.state?.sheet;
  if (id && state.assets[id]) {
    if (ui.game) closeGame({ animate: false });
    if (ui.detail !== id) { ui.detail = id; renderDetail({ keepScroll: false }); $('#sheet').scrollTop = 0; }
    return;
  }
  if (ui.detail) closeDetail({ animate });
  const gid = e.state?.game;
  if (gid && (!ui.game || ui.game.id !== gid)) openGame(e.state.lg, gid, { push: false });
  else if (!gid && ui.game) closeGame({ animate });
});

$('#trade').addEventListener('click', (e) => { if (e.target.id === 'trade') closeOrder(); });
for (const id of ['sheet', 'chain', 'game', 'draft']) $(`#${id}`).addEventListener('scroll', () => { ui.lastScroll = Date.now(); }, { passive: true });
$('#view').addEventListener('scroll', () => { ui.lastScroll = Date.now(); }, { passive: true });
// Track whether a finger is down, so background refreshes wait until the gesture ends.
document.addEventListener('touchstart', () => { ui.touching = true; ui.interacted = true; }, { passive: true, capture: true });
for (const t of ['touchend', 'touchcancel']) document.addEventListener(t, (e) => { if (!e.touches.length) { ui.touching = false; ui.lastScroll = Date.now(); } }, { passive: true, capture: true });

// Native gestures: swipe the order sheet down to close it, swipe from the left edge to go back.
dismissable($('#panel'), {
  axis: 'y', backdrop: $('#trade'),
  canStart: (e) => !e.target.closest('.slider') && $('#panel').scrollTop <= 0,
  onDismiss: () => closeOrder({ animate: false }),
});
const sheetSwipe = {
  el: $('#sheet'), extra: () => [$('#tradebar')],
  onDismiss: () => { if (history.state?.sheet) { ui.noAnim = true; history.back(); } else closeDetail({ animate: false }); },
};
const gameSwipe = {
  el: $('#game'),
  onDismiss: () => { if (history.state?.game) { ui.noAnim = true; history.back(); } else closeGame({ animate: false }); },
};
const draftSwipe = {
  el: $('#draft'), extra: () => [$('#dfoot')],
  onDismiss: () => { if (history.state?.draft) { ui.noAnim = true; history.back(); } else closeDraft({ animate: false }); },
};
const chainSwipe = {
  el: $('#chain'),
  onDismiss: () => { if (history.state?.chain) { ui.noAnim = true; history.back(); } else closeChain(false, { animate: false }); },
};
// The top-most full-screen page, for swipe-back.
function topPage() {
  if (ui.order) return null;
  if (ui.draft) return draftSwipe;
  if (ui.chain) return chainSwipe;
  if (ui.game && (!ui.detail || $('#game').style.zIndex === '34')) return gameSwipe;
  if (ui.detail) return sheetSwipe;
  if (ui.game) return gameSwipe;
  return null;
}
edgeSwipe($('#edge'), { target: topPage });
setInterval(() => { const el = $('#edge'); const want = !topPage(); if (el.hidden !== want) el.hidden = want; }, 200);
pullToRefresh($('#view'), $('#ptr'), {
  enabled: () => !overlayOpen() && ui.tab !== 'account',
  onRefresh: async () => { if (STATIC) { toast('Prices use a data snapshot in this version'); return; } await runSync({ manual: true }); },
});

// Two-tap confirmation (dialogs aren't available everywhere).
function armed(el, prompt) {
  if (el.dataset.armed) return true;
  const label = el.textContent;
  el.dataset.armed = '1'; el.textContent = prompt;
  setTimeout(() => { delete el.dataset.armed; el.textContent = label; }, 4000);
  return false;
}

// ---------- data sync ----------

function bootLog(msg) {
  const log = $('#boot .log');
  if (log) { const d = document.createElement('div'); d.textContent = msg; log.appendChild(d); while (log.children.length > 6) log.firstChild.remove(); }
}

function showBoot() {
  const b = $('#boot');
  b.hidden = false;
  b.innerHTML = `<img class="logo" src="icons/icon-192.png" alt="">
    <h1>Opening the market</h1>
    <p class="muted">Pulling standings, season stats, recent box scores, injuries and news for every player and team. This takes about a minute the first time.</p>
    <div class="bar"><i></i></div><div class="log"></div>`;
}

function bootFailed(msg) {
  const b = $('#boot');
  b.innerHTML = `<img class="logo" src="icons/icon-192.png" alt="">
    <h1>Couldn't reach the sports data</h1>
    <p class="muted">${esc(msg)}</p>
    <p class="muted small">Check your connection. If you're online and this keeps happening, your browser may be blocking ESPN's feeds — set up the free proxy described in the README and paste its URL in Account → Data connection.</p>
    <div class="btn-row" style="margin-top:16px"><button class="btn ghost" data-act="bootsettings">Settings</button><button class="btn buy" data-act="retry">Try again</button></div>`;
}

async function runSync({ manual = false, liveOnly = false } = {}) {
  if (syncing) return;
  if (!navigator.onLine) { syncError = 'offline'; if (manual) toast('You are offline'); return; }
  syncing = true; syncError = '';
  refreshBadge();
  const leagues = enabledLeagues().filter((l) => !liveOnly || hasLive(state, l));
  const needsBoot = !STATIC && !liveOnly && leagues.some((l) => !state.sync[l]?.seeded) && !assetsList().length;
  if (needsBoot) showBoot();
  let newFinals = 0; let failures = 0;
  // All leagues at once; each one's prices show up as soon as it finishes.
  await Promise.all(leagues.map(async (lg) => {
    try {
      const r = await syncLeague(state, lg, { progress: bootLog, now: Date.now(), liveOnly });
      newFinals += r.finals || 0;
      if (r.first) bootLog(`${LEAGUES[lg].name}: market open ✓`);
      else if (!needsBoot) softRefresh();
    } catch (err) {
      failures++; syncError = err.message || String(err);
      bootLog(`${LEAGUES[lg].name}: failed (${syncError})`);
    }
  }));
  syncing = false;
  if (!liveOnly) ensureFunds(state, Date.now());
  runSocial(state, Date.now());
  runCareer(state, Date.now());
  state.lastTick = state.lastTick || Date.now();
  dirty = true; await save();
  if (needsBoot) {
    if (!assetsList().length) { bootFailed(netStats.lastError || syncError || 'No data returned.'); return; }
    $('#boot').hidden = true;
    persist();
  }
  if (manual && !failures) toast(newFinals ? `${newFinals} new game result${newFinals > 1 ? 's' : ''} priced in` : 'Market is up to date');
  if (manual && failures) toast(`Some data couldn't load: ${syncError}`);
  announce();
  softRefresh();
}

function refreshBadge() {
  document.querySelectorAll('.sync').forEach((el) => { el.outerHTML = syncBadge(); });
  const bell = document.querySelector('[data-act="inbox"]');
  if (bell) {
    const unseen = state.inbox.filter((n) => !n.seen).length;
    if (unseen) bell.dataset.n = unseen > 9 ? '9+' : unseen; else delete bell.dataset.n;
  }
}

async function testConnection() {
  const out = $('#testout');
  out.textContent = 'Testing…';
  setProxy($('#proxy').value.trim());
  const lines = [];
  for (const lg of Object.keys(LEAGUES)) {
    const t0 = performance.now();
    try { await api.scoreboard(lg); lines.push(`${LEAGUES[lg].name} ✓ ${Math.round(performance.now() - t0)}ms`); }
    catch (e) { lines.push(`${LEAGUES[lg].name} ✗ ${e.message}`); }
  }
  out.textContent = lines.join(' · ') + (netStats.proxied ? ' (via proxy)' : '');
}

function exportData() {
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
  const file = new File([blob], `statstreet-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) { navigator.share({ files: [file], title: 'StatStreet backup' }).catch(() => {}); return; }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// True while a finger is down or the page is still coasting from a flick.
function busyScrolling(ms = 1200) { return ui.touching || Date.now() - ui.lastScroll < ms; }

async function save() {
  if (!dirty) return;
  dirty = false;
  try { await saveState(state); } catch (err) { console.warn('save failed', err); dirty = true; }
}

function afterLoad() {
  migrate(state);
  setProxy(state.settings.proxy);
  for (const lg of Object.keys(LEAGUES)) { recomputeStats(state, lg); rebuildInjuryCache(state, lg); }
  if (Object.keys(state.assets).length) {
    upgradeModel(state, Date.now());
    repairNewcomers(state, Date.now());
    if ((state.histV || 1) < HIST_V) resetHistory(state, Date.now()); // charts from the old pricing model
    ensureFunds(state, Date.now());
  }
  else state.modelV ??= 2;
  ui.seenInbox = state.inbox.length;
}

// ---------- boot ----------

// One-line layout readout (helps diagnose iOS viewport quirks from a screenshot).
function screenDiag() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const ins = `${parseFloat(cs.paddingTop)}/${parseFloat(cs.paddingBottom)}`;
  probe.remove();
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const tb = $('#tabbar').getBoundingClientRect();
  return `screen ${screen.width}×${screen.height} · window ${innerWidth}×${innerHeight} · page ${Math.round(document.body.getBoundingClientRect().height)} · bar ${Math.round(tb.bottom)} · insets ${ins} · ${standalone ? 'installed' : 'browser'}`;
}

// Belt-and-braces for the iOS 26 installed-app viewport bug: if the reported height is
// short of the physical screen by about a status bar, size the page to the screen.
function fitScreen() {
  const root = document.documentElement;
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!standalone) { root.style.height = ''; return; }
  const portrait = matchMedia('(orientation: portrait)').matches;
  const full = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const gap = full - innerHeight;
  root.style.height = gap > 0 && gap <= 80 ? `${full}px` : '';
}

// ---------- app updates ----------
// iOS keeps a Home Screen app suspended in memory, so "opening" it often just resumes the
// old page. On launch and on every resume we ask the server whether a newer build exists;
// if so we cache it and switch over straight away, unless you're in the middle of something.
const BUILD = document.querySelector('meta[name=build]')?.content || 'dev';
const openedAt = Date.now();
let updateReady = false; let lastCheck = 0;

async function checkForUpdate() {
  if (STATIC || BUILD === 'dev' || !navigator.onLine || Date.now() - lastCheck < 20e3) return;
  lastCheck = Date.now();
  try {
    const res = await fetch(`index.html?fresh=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const text = await res.text();
    const m = text.match(/<meta name="build" content="([^"]+)"/);
    if (!m || m[1] === BUILD) return;
    // Put the new page where the service worker will serve it from.
    if (self.caches) {
      for (const k of await caches.keys()) {
        if (/^statstreet-v\d+$/.test(k)) await (await caches.open(k)).put('index.html', new Response(text, { headers: { 'Content-Type': 'text/html' } }));
      }
    }
    updateReady = m[1];
    applyUpdate();
  } catch { /* offline or blocked: try again later */ }
}

function applyUpdate({ force = false } = {}) {
  if (!updateReady) return;
  let tried = '';
  try { tried = sessionStorage.getItem('ss-upd') || ''; } catch { /* private mode */ }
  const go = () => {
    try { sessionStorage.setItem('ss-upd', updateReady); } catch { /* */ }
    // If a reload already failed to pick up this build, load it straight from the network.
    save().finally(() => { if (tried === updateReady) location.replace(`index.html?fresh=${Date.now()}`); else location.reload(); });
  };
  const fresh = Date.now() - openedAt < 8000 && !ui.interacted;
  if (force || ((fresh || document.hidden) && !overlayOpen() && tried !== updateReady)) { go(); return; }
  $('#updbar').hidden = false;
}

async function main() {
  fitScreen();
  addEventListener('resize', fitScreen);
  addEventListener('orientationchange', () => setTimeout(fitScreen, 300));
  state = (await loadState()) || newState();
  afterLoad();
  $('#updbar').addEventListener('click', () => applyUpdate({ force: true }));
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'update-ready') { lastCheck = 0; checkForUpdate(); } });
  setTimeout(checkForUpdate, 600);
  if (!STATIC && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // When a new version installs, reload once so you're never stuck on an old build.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && !overlayOpen()) { reloaded = true; location.reload(); } });
  }
  tick(state, Date.now());
  runAutomation(state, Date.now()); runSocial(state, Date.now()); runCareer(state, Date.now());
  applyTheme();
  render();
  announce();
  maybeRecap();
  runSync();

  // The tape: prices wiggle around fair value every few seconds; orders, alerts and expiries are checked each tick.
  setInterval(() => {
    if (document.hidden || busyScrolling()) return; // never do heavy work mid-scroll
    const now = Date.now();
    tick(state, now);
    runAutomation(state, now);
    runSocial(state, now);
    runCareer(state, now);
    maybeRecap();
    // Keep auction clocks and bids moving on the Marketplace.
    if (ui.tab === 'marketplace' && !overlayOpen()) updateMarketplaceNumbers(now);
    if (ui.order?.mode === 'lot' && document.activeElement?.id !== 'bidamt' && now - (ui.lotDrawn || 0) > 15e3) { ui.lotDrawn = now; renderLot(); }
    dirty = true;
    updateNumbers();
    announce();
  }, 4000);
  // Live games every minute, everything else every 10 minutes.
  setInterval(() => { if (!document.hidden && Object.keys(state.liveGames).length) runSync({ liveOnly: true }); }, 60e3);
  setInterval(() => { if (!document.hidden) runSync(); }, 10 * 60e3);
  setInterval(() => { if (!busyScrolling(2500)) save(); }, 30e3);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { save(); applyUpdate(); return; }
    checkForUpdate();
    tick(state, Date.now());
    runAutomation(state, Date.now()); runSocial(state, Date.now()); runCareer(state, Date.now());
    announce();
    const last = Math.max(0, ...enabledLeagues().map((l) => state.sync[l]?.scoreboard || 0));
    if (Date.now() - last > 60e3) runSync(); else softRefresh();
  });
  window.addEventListener('online', () => runSync());
}

main();
