// StatStreet — UI layer.
import { LEAGUES, posGroup, storyBlocks, parseScoreboard, parseBoxScore, lineText, gameScore } from './scoring.js';
import {
  newState, migrate, tick, trade, previewTrade, netWorth, holdingsValue, change, priceAt, breakdown,
  leagueIndex, rebuildInjuryCache, formRating, gameRating, ratedGames, recomputeStats, START_OPTIONS, dividendYield, fmtQty, SPREAD, upgradeModel, repairNewcomers, rescoreNews, fillGaps, resetHistory, HIST_V, resetPortfolio, minOrder, bankrollScale,
} from './engine.js';
import { ensureFunds, fundHoldings } from './funds.js';
import {
  dollarsToQty, expirations, strikes, optKey, quoteOption, buyOption, sellOption, optLabel, placeOrder,
  cancelOrder, buyingPower, addRecurring, cancelRecurring, addAlert, removeAlert, runAutomation, payoffCurve,
} from './trading.js';
import { impliedVol, greeks, optionMid, optionsValue, CONTRACT, YEAR, gamesBefore as gamesBeforeExp, gameMove } from './bs.js';
import { syncLeague, hasLive } from './sync.js';
import { setProxy, netStats, api, wikiPhoto } from './api.js';
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
  CONTEST_TIERS, PAYOUT, LINEUP, availableContests, enterContest, standings, draftPool, salaryCap, nextSlate, autoLineup, liveStandings, salary, entryFee, ordinal,
  propBoard, placeBet, MAX_LEGS, PROP_ODDS, potentialPayout, propStat,
} from './contests.js';
import {
  B_RARITY, B_PACKS, AUCTION_LENGTHS, fuseFee, fuseCost, packCost, popularity, bindMarket, SELLER_FEE, bType, bRarity, describe, describeShort, traitList, rIdx, slots, boosterState, equipped, boosterOn,
  equip, unequip, fuse, openBoosterPack, marketValue, quickSellPrice, quickSell, listAuction, cancelAuction, myAuctions, listingView,
  marketListings, placeBid, buyNow, buyNowPrice, assetOf,
} from './boosters.js';
import { squarify, heatColor } from './heatmap.js';
import { portfolioCard, assetCard, shareCanvas, achievementsCard } from './sharecard.js';
import { cardArt } from './cardart.js';
import { parsePlays, parseAtBat, parseSituation, parseDrives, parseBases, parseTeamStats } from './moments.js';
import {
  closedTrades, journalStats, lineupToday, calendar, moverAlerts, dailyChallenge, answerChallenge, collections, SET_SIZE, SET_BONUS,
  achievements, searchAll, sinceLastOpen, markOpen, compareRows,
} from './extras.js';
import {
  runExtras, openShort, coverShort, shortEquity, shortExposure, BORROW_DAILY, SHORT_CAP, protection, protect, clearProtection, riskReport, breakouts,
  weeklyRecap, recapDue, chooseRival, rivalStatus, futuresMarkets, futuresOpen, betFuture, cardHistory, recentSales, wantedOffers, fillWanted,
  showcase, toggleShowcase, SHOWCASE_MAX,
} from './extras2.js';
import { RIVALS } from './social.js';
import {
  runExtras3, activeEvents, ipoList, ipoPhase, ipoRoom, buyIpo, IPO_WINDOW, IPO_ALLOC, updateHof, duelCode, duelResult,
  marketStatus, dividendCalendar, parseBio,
} from './extras3.js';
import { weekId } from './util.js';

// ---------- state ----------

let state;
const ui = {
  tab: 'home', league: 'all', kind: 'player', sort: 'movers', q: '', limit: 60,
  range: '1D', homeRange: '1D', newsLeague: 'all', actFilter: 'all',
  detail: null, chain: null, order: null, game: null, scrub: false, lastScroll: 0, seenInbox: 0,
  mview: 'list',
};
const APP_VERSION = 97;
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
const overlayOpen = () => !!(ui.detail || ui.chain || ui.order || ui.game || ui.draft || ui.article || ui.page);
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

// In lists a player's row leaves out the ticker, so his team, position and injury tag fit.
function subLine(a, { ticker = a.kind !== 'player' } = {}) {
  const bits = [lgTag(a.kind === 'fund' ? 'fund' : a.league)];
  if (ticker) bits.push(`<span>${esc(a.ticker)}</span>`);
  if (a.kind === 'player') bits.push(`<span>${esc(a.teamAbbr || '')}${a.pos ? ' · ' + esc(a.pos) : ''}</span>`);
  else if (a.kind === 'team') bits.push(`<span>${recText(a)}</span>`);
  else bits.push(`<span>${Object.keys(a.cons || {}).length} holdings</span>`);
  if (a.ipo) bits.push('<span class="tag ipo">IPO</span>');
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
  const il = x.match(/(\d+)[\s-]*day/); // "60-Day-IL", "15-Day Injured List" → "IL60", "IL15"
  if (il) return `IL${il[1]}`;
  if (/injured list|\bil\b/.test(x)) return 'IL';
  if (x.includes('suspen')) return 'SUSP';
  if (x.includes('probable')) return 'P';
  if (x.includes('physically unable') || /\bpup\b/.test(x)) return 'PUP';
  if (/^out\b/.test(x)) return 'Out';
  return s.length > 6 ? 'OUT' : s;
}

function assetRow(a, { right = 'pill', range = '1D', note = '' } = {}) {
  const ch = change(a, Date.now(), RANGES[range]);
  const from = Date.now() - RANGES[range];
  return `<button class="item" data-open="${a.id}">
    ${avatar(a)}
    <div class="grow" style="min-width:0"><div class="name ellipsis">${esc(a.name)}</div><div class="sub ellipsis">${note || subLine(a)}</div></div>
    ${formDot(a, 'sm')}${right === 'spark' ? sparkline(a.hist, from) : sparkline(a.hist, from, 46, 26)}
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
    <button class="icon-btn" data-page="search" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></button>
    <button class="icon-btn badge-dot" data-act="inbox" aria-label="Notifications" ${unseen ? `data-n="${unseen > 9 ? '9+' : unseen}"` : ''}>
      <svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg></button></div></div>`;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show'); toast.at = Date.now();
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3000);
}

const rangeLabel = (r) => ({ '1D': 'today', '1W': 'past week', '1M': 'past month', '3M': 'past 3 months', ALL: 'all time' }[r]);

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

  const hx = homeParts(now, holdings, movers);
  // Every block of the page by name, so you can hide and reorder them (Account → Portfolio page).
  const SEC = {
    ...hx,
    alloc: `${holdings.length || opts.length ? `<div class="alloc">${parts.map(([, v, c]) => `<i style="width:${(v / tot) * 100}%;background:${c}"></i>`).join('')}</div>
    <div class="legend">${parts.map(([n, v, c]) => { const pc = (v / tot) * 100; return `<span style="--c:${c}">${n} ${pc > 0 && pc < 1 ? '<1' : Math.round(pc)}%</span>`; }).join('')}</div>` : ''}`,
    season: `${state.season ? (() => { const r = seasonReturn(state, now); const tr = tierFor(r); return `<button class="season-strip" data-gtab="season" style="--tc:${tr.color};margin-top:12px"><span class="dot"></span>Season ${state.season.n} · <b>${tr.name}</b> · <span class="${cls(r)}">${pctTxt(r)}</span><span class="grow"></span><span class="muted">${daysLeft(state.season.end)} ›</span></button>`; })() : ''}
    ${(() => { const dly = dailyStatus(state, now); return dly.claimed ? '' : `<button class="card promo" data-gtab="season"><span class="e">🎁</span><div class="grow"><div class="name">Daily reward ready</div>
      <div class="tiny muted">${dly.nextStreak > 1 ? `Day ${dly.nextStreak} of your streak` : 'Start a streak'} · tap to claim ${money(dly.reward)}</div></div><span class="muted">›</span></button>`; })()}`,
    live: `${live.length ? `<h3>Live now</h3><div class="live-strip">${live.map(([id, g]) => `
      <button class="game" data-game="${g.league}|${id}" style="text-align:left">${lgTag(g.league)} <span class="tag live">LIVE</span>
        ${g.teams.map((t) => `<div class="t"><span>${esc(t.abbr)}</span><span>${t.score}</span></div>`).join('')}
        <div class="tiny muted">${esc(g.detail)}</div></button>`).join('')}</div>` : ''}`,
    orders: `${state.orders.length ? `<h2>Open orders</h2><div class="list">${state.orders.map(orderRow).join('')}</div>` : ''}
    ${opts.length ? `<h2>Options</h2><div class="list">${opts.map(optPositionRow).join('')}</div>` : ''}`,
    stocks: `<h2>Stocks</h2>
    ${stocks.length ? `<div class="list">${stocks.map(({ a, h }) => positionRow(a, h)).join('')}</div>`
      : `<div class="card empty">You don't own any players or teams yet. You start with ${money(state.startCash)} of play money.
      <button class="more" data-tab="market">Browse the market →</button></div>`}`,
    shorts: shortsSection(now),
    funds: `${funds.length ? `<h2>Index funds</h2><div class="list">${funds.map(({ a, h }) => positionRow(a, h)).join('')}</div>` : ''}`,
    watch: watchSection(watch),
    upcoming: `${games.length ? `<h2>${myGames.length ? 'Your upcoming games' : 'Upcoming games'}</h2><div class="list">${games.map((g) => `
      <button class="item" data-game="${g.lg}|${g.id}">${lgTag(g.lg)}<div class="grow"><div class="name">${esc(g.name)}</div><div class="sub">${fmtDateTime(g.date)}${g.preseason ? ' · preseason' : ''}</div></div>${state.picks[g.id] ? `<span class="pk">Picked ${esc(state.picks[g.id].abbr)}</span>` : '<span class="muted">›</span>'}</button>`).join('')}</div>` : ''}`,
    discover: `<h2>Discover</h2>
    <div class="collections">${COLLECTIONS.map((c) => `<button class="coll" data-coll="${c.key}"><div class="e">${c.e}</div><div class="t">${c.t}</div><div class="d">${c.d}</div></button>`).join('')}
      <button class="coll" data-coll="funds"><div class="e">🧺</div><div class="t">Index funds</div><div class="d">Whole leagues in one tap</div></button></div>`,
  };
  $('#view').innerHTML = `
    ${topbar('<div class="brand">Stat<b>Street</b></div>')}
    ${marketPill()}
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
    ${homeOrder().filter((k) => !state.settings.home?.hide?.[k]).map((k) => SEC[k] || '').join('\n')}
  `;
  drawNwChart();
}

function positionRow(a, h) {
  const pl = a.price * h.qty - h.cost;
  return `<button class="item" data-open="${a.id}">${avatar(a)}
    <div class="grow"><div class="name ellipsis">${esc(a.name)}</div><div class="sub">${fmtQty(h.qty)} sh · avg ${money(h.cost / h.qty)}</div></div>
    ${formDot(a, 'sm')}${sparkline(a.hist, Date.now() - DAY)}
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
  const animate = !!ui.nwAnim; ui.nwAnim = false;
  lineChart(el, flat, Date.now() - RANGES[ui.homeRange], {
    animate,
    // Hold or drag on the chart: the big number shows your balance at that moment.
    onScrub: (pt) => {
      ui.nwScrub = !!pt;
      const v = $('[data-nw]'); const c = $('[data-nwc]');
      if (!pt) { updateNwHeader(); return; }
      if (!v || !c) return;
      v.textContent = money(pt.p);
      const ch = pt.p - pt.first;
      c.className = `change-line ${cls(ch)}`;
      c.innerHTML = `${ch >= 0 ? '▲' : '▼'} ${money(Math.abs(ch))} (${fmtPct(pt.first ? ch / pt.first : 0)}) <span class="muted">${new Date(pt.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>`;
    },
  });
}
// Numbers count up or down to their new value instead of snapping.
const rollLast = new Map();
function roll(el, v, key) {
  const from = rollLast.get(key); rollLast.set(key, v);
  cancelAnimationFrame(el._raf);
  if (from == null || from === v || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = money(v); return; }
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / 420); el.textContent = money(from + (v - from) * (1 - (1 - k) ** 3)); if (k < 1) el._raf = requestAnimationFrame(step); };
  el.textContent = money(from); el._raf = requestAnimationFrame(step);
}
function updateNwHeader(now = Date.now()) {
  const nwEl = $('[data-nw]');
  if (!nwEl || ui.nwScrub) return;
  const nw = netWorth(state, now); const ref = nwAt(now - RANGES[ui.homeRange]) ?? state.startCash; const ch = nw - ref;
  roll(nwEl, nw, 'nw');
  const c = $('[data-nwc]');
  c.className = `change-line ${cls(ch)}`;
  c.innerHTML = `${ch >= 0 ? '▲' : '▼'} ${money(Math.abs(ch))} (${fmtPct(ref ? ch / ref : 0)}) <span class="muted">${rangeLabel(ui.homeRange)}</span>`;
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
  if (ui.sort === 'rated') list = list.filter((a) => a.kind === 'player');
  const posOn = !q && ui.kind === 'player' && POSITIONS[ui.league] && ui.pos && ui.pos !== 'all';
  if (posOn) list = list.filter((a) => posIs(a, ui.pos));
  if (ui.healthy && ui.sort !== 'injured') list = list.filter((a) => !a.injury || a.injury.factor >= 0.99);
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
    rated: (a) => -(a.kind === 'player' ? (playerRating(a)?.rating ?? -9) : -9),
    mvp: (a) => -(a.kind === 'player' ? formZ(a) : a.rec?.gp ? a.rec.w / (a.rec.w + a.rec.l || 1) * 2 : -9),
    div: (a) => -dividendYield(state, a, now),
    vol: (a) => -impliedVol(a, now, state),
    streak: (a) => -a.rec.streak,
    cheap: (a) => -a.price,
  }[ui.sort] || ((a) => -change(a, now));
  return list.map((a) => [key(a), a]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
}

// Positions you can browse by, per league.
const POSITIONS = {
  nba: [['G', 'Guards'], ['F', 'Forwards'], ['C', 'Centers']],
  nfl: [['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE'], ['K', 'K'], ['DEF', 'Defense']],
  mlb: [['SP', 'Starters'], ['RP', 'Relievers'], ['C', 'Catchers'], ['IF', 'Infield'], ['OF', 'Outfield'], ['DH', 'DH']],
};
function posIs(a, key) {
  const p = String(a.pos || '').toUpperCase();
  if (a.league === 'nba') return key === 'C' ? p === 'C' : p.includes(key);
  if (a.league === 'nfl') return key === 'RB' ? ['RB', 'FB', 'HB'].includes(p) : key === 'K' ? ['K', 'PK'].includes(p) : key === 'DEF' ? posGroup('nfl', p) === 'DEF' : p === key;
  return key === 'IF' ? ['1B', '2B', '3B', 'SS', 'IF'].includes(p) : key === 'OF' ? ['LF', 'CF', 'RF', 'OF'].includes(p) : p === key;
}
// The rating shown in a player's circle: 7 days, else 30, else his games on record.
const playerRating = (a) => formRating(state, a, '7d') || formRating(state, a, '30d') || formRating(state, a, 'season');
const SORTS = [['trending', 'Trending'], ['rated', 'Top rated'], ['movers', 'Top gainers'], ['losers', 'Top losers'], ['price', 'Most valuable'], ['mvp', 'MVP race'], ['div', 'Dividends'],
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
  const news = state.news.filter((n) => n.fx?.[a.id] && now - n.published < 3 * DAY);
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
  // (No model-value readout: showing it would tell you which way the price is about to drift.)
  // Momentum
  const w = change(a, now, 7 * DAY);
  if (w > 0.08) bull.push(`Up ${Math.round(w * 100)}% this week`); else if (w < -0.08) bear.push(`Down ${Math.round(-w * 100)}% this week`);
  // News
  const news = state.news.filter((n) => n.fx?.[a.id] && now - n.published < 7 * DAY); // only stories about him
  const senti = news.length ? mean(news.map((n) => n.fx[a.id])) : 0;
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
    ${marketPill()}
    <input class="search" id="q" type="search" placeholder="Search players, teams, funds, tickers" value="${esc(ui.q)}" autocomplete="off" autocorrect="off">
    <div class="seg" style="margin-top:10px">${['all', ...enabledLeagues()].map((l) => `<button data-league="${l}" class="${ui.league === l ? 'on' : ''}">${l === 'all' ? 'All' : LEAGUES[l].name}</button>`).join('')}</div>
    <div class="seg" style="margin-top:8px">${[['player', 'Players'], ['team', 'Teams'], ['fund', 'Index funds']].map(([k, n]) => `<button data-kind="${k}" class="${ui.kind === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    ${!ui.q.trim() ? marketBanners() : ''}
    ${!ui.q.trim() && ui.kind === 'player' ? trendingStrip() : ''}
    <div class="chips" style="margin-top:10px">${SORTS.map(([k, n]) => `<button class="chip ${ui.sort === k ? 'on' : ''}" data-sort="${k}">${n}</button>`).join('')}</div>
    ${!ui.q.trim() && ui.kind === 'player' && POSITIONS[ui.league] ? `<div class="chips pos-chips" style="margin-top:6px">${[['all', 'All positions'], ...POSITIONS[ui.league]].map(([k, n]) => `<button class="chip ${(ui.pos || 'all') === k ? 'on' : ''}" data-pos="${k}">${n}</button>`).join('')}</div>` : ''}
    <div class="chips price-chips" style="margin-top:6px">${ui.kind === 'player' ? `<button class="chip ${ui.healthy ? 'on' : ''}" data-act="healthy">${ui.healthy ? '✓ ' : ''}Healthy only</button>` : ''}${PRICE_BANDS.map(([k, n]) => `<button class="chip ${(ui.price || 'any') === k ? 'on' : ''}" data-price="${k}">${n}</button>`).join('')}</div>
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
  prefetchArticles();
  const list = state.news.filter((n) => state.settings.leagues[n.league] && (ui.newsLeague === 'all' || n.league === ui.newsLeague));
  $('#view').innerHTML = `
    ${topbar('<h1>News</h1>')}
    <p class="small muted" style="margin:4px 0 10px">Headlines are scored for sentiment. Bullish news lifts the players and teams it mentions; bearish news drags them down. The effect fades over a few days.</p>
    <div class="chips">${['all', ...enabledLeagues()].map((l) => `<button class="chip ${ui.newsLeague === l ? 'on' : ''}" data-nleague="${l}">${l === 'all' ? 'All' : LEAGUES[l].name}</button>`).join('')}</div>
    <div class="list" style="margin-top:8px">${list.slice(0, 80).map((n) => {
      const s = n.score > 0.12 ? ['up', 'Bullish'] : n.score < -0.12 ? ['down', 'Bearish'] : ['flat', 'Neutral'];
      return `<div class="news">
        <a href="${esc(n.url)}" data-article="${esc(n.id)}" class="h" style="text-decoration:none;display:block">${esc(n.headline)}</a>
        ${n.desc ? `<div class="small muted" data-article="${esc(n.id)}" style="margin-top:3px">${esc(n.desc)}</div>` : ''}
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
  const verb = { buy: 'Bought', sell: 'Sold', exercise: 'Settled', expire: 'Expired', short: 'Shorted', cover: 'Closed short' }[t.side] || t.side;
  const what = t.kind === 'option' ? `${t.qty} × ${esc(t.opt)}` : `${fmtQty(t.qty)} ${esc(t.ticker)}`;
  const amt = t.side === 'buy' || t.side === 'short' ? `-${money(t.total)}` : `+${money(t.total)}`;
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

    <h2>Appearance</h2>
    <div class="list"><label class="toggle"><span>Light theme<div class="tiny faint">A bright look for daytime</div></span>
      <span class="switch"><input type="checkbox" id="setlight" ${state.settings.light ? 'checked' : ''}><span></span></span></label>
      <div class="toggle" style="display:block"><span>Text size<div class="tiny faint">Scales type across the whole app</div></span>
        <div class="seg" style="margin-top:8px">${[['0', 'Standard'], ['1', 'Large'], ['2', 'Extra large']].map(([k, n]) => `<button data-textsize="${k}" class="${String(textSize()) === k ? 'on' : ''}">${n}</button>`).join('')}</div></div></div>

      <div class="list" style="margin-top:8px"><label class="toggle"><span>Colour-blind friendly<div class="tiny faint">Blue for up and orange for down, instead of green and red</div></span>
      <span class="switch"><input type="checkbox" id="setcb" ${state.settings.cb ? 'checked' : ''}><span></span></span></label>
      <label class="toggle"><span>Sounds<div class="tiny faint">Short tones on trades, rewards and card packs</div></span>
      <span class="switch"><input type="checkbox" id="setsound" ${state.settings.sound !== false ? 'checked' : ''}><span></span></span></label>
      ${state.settings.sound !== false ? SFX_KINDS.map(([k, n, sub]) => `<label class="toggle sub"><span>${n}<div class="tiny faint">${sub}</div></span>
      <span class="switch"><input type="checkbox" data-sfxkind="${k}" ${state.settings.sfxOff?.[k] ? '' : 'checked'}><span></span></span></label>`).join('') : ''}
      <label class="toggle"><span>Haptics<div class="tiny faint">A light tap on your actions</div></span>
      <span class="switch"><input type="checkbox" id="sethaptic" ${state.settings.haptics !== false ? 'checked' : ''}><span></span></span></label>
      ${state.settings.haptics !== false ? `<label class="toggle sub"><span>On swipes and tab changes<div class="tiny faint">Off keeps the tap for trades and bets only</div></span>
      <span class="switch"><input type="checkbox" id="sethapnav" ${state.settings.hapNav === false ? '' : 'checked'}><span></span></span></label>` : ''}
      <button class="item" data-page="layout"><div class="grow"><div class="name">Customize the Portfolio page</div><div class="sub">Show, hide and reorder its sections</div></div><span class="muted">›</span></button></div>

    <h2>Move alerts</h2>
    <p class="small muted" style="margin:4px 0 8px">A banner while the app is open when something you own or watch moves this much in a day, or when its game starts.</p>
    <div class="chips">${[[0, 'Off'], [3, '3%'], [5, '5%'], [10, '10%']].map(([v, t]) => `<button class="chip ${(state.settings.moveAlert ?? 5) === v ? 'on' : ''}" data-movealert="${v}">${t}</button>`).join('')}</div>

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

// A start time, or a countdown once it is within the hour.
function whenText(date, withDay = false) {
  const m = Math.round((date - Date.now()) / 60e3);
  if (m > 0 && m <= 60) return `<span class="soon">Starts in ${m}m</span>`;
  return withDay ? fmtDateTime(date) : new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function pickGame(g) {
  const away = g.teams.find((t) => !t.home) || g.teams[0];
  const home = g.teams.find((t) => t !== away);
  return `<div class="pick-game">
    <div class="pg-head">${lgTag(g.league)}<span class="tiny muted">${whenText(g.date, true)}${g.preseason ? ' · preseason' : ''}</span>
      <button class="tiny link" data-game="${g.league}|${g.id}">Preview ›</button></div>
    <div class="pg-teams">${pickButton(g, away, home)}<span class="at">@</span>${pickButton(g, home, away)}</div></div>`;
}

// ---------- Games tab: career header + Season / Contests / Props / Pick'em / Locker ----------

const GTABS = [['pickem', 'Scores'], ['season', 'Season'], ['contests', 'Contests'], ['props', 'Props'], ['locker', 'Locker']];
const cm = (cents) => money(Math.round(cents) / 100); // card and reward amounts are kept in cents
const toCents = (v) => Math.round(parseFloat(String(v).replace(/[^0-9.]/g, '')) * 100);
const daysLeft = (t) => { const d = (t - Date.now()) / DAY; return d >= 1 ? `${Math.ceil(d)} days left` : `${Math.max(1, Math.round(d * 24))}h left`; };
const pctTxt = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

function tierBadge(tier, size = 44) {
  return `<div class="tier-badge" style="--tc:${tier.color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${tier.name[0]}</div>`;
}

function careerHeader(compact = false) {
  const p = xpProgress(state);
  const c = career(state);
  const s = state.season;
  const ret = seasonReturn(state);
  const tier = tierFor(ret);
  // Off the Season tab the header is one slim line, so the page itself gets the room.
  if (compact) return `<button class="career-slim" data-gtab="season" style="--tc:${tier.color}"><span class="lv">${p.level}</span><div class="xpbar grow"><i style="width:${Math.round(p.frac * 100)}%"></i></div>${s ? `<span class="dot"></span><b>${tier.name}</b><span class="${cls(ret)}">${pctTxt(ret)}</span>` : ''}</button>`;
  return `<div class="career card">
    <div class="lvl"><b>${p.level}</b><span>LEVEL</span></div>
    <div class="grow">
      <div class="row between"><div class="name ellipsis">${esc(c.title)}</div></div>
      <div class="xpbar"><i style="width:${Math.round(p.frac * 100)}%"></i></div>
      <div class="tiny muted row between"><span>${p.into} / ${p.need} XP</span><span>${UNLOCKS[p.level + 1] ? `Lv ${p.level + 1}: ${esc(UNLOCKS[p.level + 1])}` : ''}</span></div>
    </div></div>
    ${s ? `<button class="season-strip" data-gtab="season" style="--tc:${tier.color}"><span class="dot"></span>Season ${s.n} · <b>${tier.name}</b> · <span class="${cls(ret)}">${pctTxt(ret)}</span><span class="grow"></span><span class="muted">${daysLeft(s.end)}</span></button>` : ''}`;
}

function renderGames() {
  ui.gtab ||= 'pickem';
  const body = { season: gamesSeason, contests: gamesContests, props: gamesProps, pickem: gamesScores, locker: gamesLocker }[ui.gtab]();
  $('#view').innerHTML = `
    ${topbar('<h1>Games</h1>')}
    <div class="gwrap">${careerHeader(ui.gtab !== 'season')}
    <div class="chips gtabs stick">${GTABS.map(([k, n]) => `<button class="chip ${ui.gtab === k ? 'on' : ''}" data-gtab="${k}">${n}${k === 'season' && !dailyStatus(state).claimed ? ' <span class="livedot"></span>' : ''}</button>`).join('')}</div>
    ${body}
    ${['props', 'pickem'].includes(ui.gtab) ? slipCard(true) : ''}</div>`;
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
      <div class="tiny muted">${next ? `${pctTxt(next.min - ret).replace('+', '')} more to reach <b style="color:${next.color}">${next.name}</b> (${cm(next.coins)} at season end)` : 'Top tier! Hold it to the end of the season.'}</div>
      <div class="tiers">${TIERS.map((t) => `<div class="${t.key === tier.key ? 'on' : ''}" style="--tc:${t.color}"><i></i><span>${t.name}</span><small>${Number.isFinite(t.min) ? pctTxt(t.min).replace('.0', '') : '<0%'}</small></div>`).join('')}</div>
      <div class="tiny faint" style="margin-top:8px">When the season ends you get cash and XP for your tier (+$1.00 more if you top the leaderboard), then everyone restarts with a fresh bankroll: ${money(seasonBalance(state))} at your level.</div>
    </div>

    ${dailyCard()}

    <h2>Weekly goals <span class="faint small">resets Monday</span></h2>
    <div class="list">${w.goals.map((g) => { const def = GOALS.find((x) => x.key === g.key); return `<div class="item goal ${g.done ? 'done' : ''}">
      <div class="check">${g.done ? '✓' : ''}</div><div class="grow"><div class="name">${esc(def.text)}</div><div class="sub">+${cm(def.coins)} · +${def.xp} XP</div></div></div>`; }).join('')}</div>

    <h2>Leaderboard</h2>
    <p class="small muted" style="margin:-4px 0 10px">This season's return vs. strategy bots.</p>
    <div class="list">${board.map((r, i) => `<div class="item lb ${r.you ? 'you' : ''}"><div class="rank">${i + 1}</div>
      <div class="grow"><div class="name">${r.you ? `You <span class="tag">${esc(c.title)}</span>` : esc(r.name)}</div><div class="sub ellipsis">${esc(r.style)}</div></div>
      <div class="price ${cls(r.ret)}">${fmtPct(r.ret)}</div></div>`).join('')}</div>

    ${c.seasons.length ? `<h2>Past seasons</h2><div class="list">${c.seasons.slice(0, 8).map((r) => { const t = TIERS.find((x) => x.key === r.tier); return `<div class="item">${tierBadge(t, 34)}
      <div class="grow"><div class="name">Season ${r.n} · ${t.name}</div><div class="sub">${fmtDate(r.start)} – ${fmtDate(r.end)} · ${ordinal(r.rank)} of ${r.of}</div></div>
      <div class="price-col"><div class="price ${cls(r.ret)}">${pctTxt(r.ret)}</div><div class="tiny muted">+${cm(r.coins)}</div></div></div>`; }).join('')}</div>` : ''}

    <h2>Trophies <span class="faint small">${got}/${TROPHIES.length} · +$0.25 each</span></h2>
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
    <p class="small muted" style="margin:12px 0 10px">Draft 5 players from one day's games, under the salary cap, and score their real game scores that day. Results and winnings arrive the next day. You face 5 bots: <b>1st pays 3×</b> your entry, 2nd 1.8×, 3rd gets it back.</p>
    ${live.length ? `<h2 style="margin-top:6px">Your contests</h2>${live.map(contestCard).join('')}` : ''}
    <h2 style="margin-top:${live.length ? 26 : 6}px">Next game day</h2>
    ${Object.keys(byLg).length ? Object.entries(byLg).map(([lg, list]) => `<div class="card contest-lg">
      <div class="row between">${lgTag(lg)}<span class="tiny muted">${slateDay(list[0].slate.day)} · ${list[0].slate.games.length} game${list[0].slate.games.length > 1 ? 's' : ''} · cap ${money(list[0].cap).replace('.00', '')}</span></div>
      <div class="tiny faint" style="margin:6px 0 2px">${list[0].slate.games.slice(0, 6).map((x) => esc(x.name || x.teams.map((t) => t.abbr).join(' @ '))).join(' · ')}${list[0].slate.games.length > 6 ? ` · +${list[0].slate.games.length - 6} more` : ''} · first game ${whenText(list[0].slate.first)}</div>
      ${list.map((x) => `<div class="ctier"><div class="grow"><div class="name">${x.tier.name}</div><div class="tiny muted">Entry ${money(x.fee)} · 1st wins ${money(x.fee * 3)}</div></div>
        ${x.entered ? `<span class="pk">Entered</span>` : x.locked ? `<span class="pk">🔒 Lv ${x.tier.level}</span>` : `<button class="btn buy small" data-draft="${lg}|${x.tier.key}">Draft</button>`}</div>`).join('')}
    </div>`).join('') : emptyState('cal', 'No games coming up', 'A contest opens for each league on every day it has games.')}
    ${past.length ? `<h2>Results <button class="tiny link" data-page="contests" style="float:right;color:var(--accent);font-weight:600">History ›</button></h2><div class="list">${past.map((c) => `<div class="item">${lgTag(c.league)}<div class="grow"><div class="name">${CONTEST_TIERS.find((t) => t.key === c.tier)?.name} · ${ordinal(c.place)} of 6</div>
      <div class="sub">${c.day ? fmtDate(c.day, { weekday: 'short', month: 'short', day: 'numeric' }) : `Week of ${fmtDate(c.entered)}`} · ${c.pts.toFixed(1)} pts</div></div><div class="price ${c.payout > c.fee ? 'up' : c.payout ? '' : 'down'}">${c.payout ? '+' + money(c.payout) : '−' + money(c.fee)}</div></div>`).join('')}</div>` : ''}`;
}

const slateDay = (day) => { const d0 = new Date().setHours(0, 0, 0, 0); return day === d0 ? 'Today' : day === d0 + DAY || new Date(d0 + 26 * HOUR).setHours(0, 0, 0, 0) === day ? 'Tomorrow' : new Date(day).toLocaleDateString([], { weekday: 'long' }); };
function contestCard(c) {
  const lv = liveStandings(state, c);
  const rows = lv.rows;
  const place = rows.findIndex((r) => r.you) + 1;
  const tier = CONTEST_TIERS.find((t) => t.key === c.tier);
  const mine = rows.find((r) => r.you).pts;
  return `<div class="card contest">
    <div class="row between"><div class="row" style="gap:6px">${lgTag(c.league)}<b>${tier.name}</b>${lv.any ? ' <span class="tag live">LIVE</span>' : ''}</div><span class="tiny muted">${c.day ? (Date.now() < c.first ? `${slateDay(c.day)} · starts ${whenText(c.first)}` : Date.now() < c.end ? `${slateDay(c.day)} · in play · pays out tomorrow` : 'Paying out shortly') : daysLeft(c.end)}</span></div>
    <div class="row between" style="margin-top:8px"><div><div class="big-pct">${ordinal(place)}</div><div class="tiny muted">of 6 · ${mine.toFixed(1)} pts${lv.any ? ' so far' : ''}</div></div>
      <div class="tiny muted" style="text-align:right">If it ended now:<br><b class="${PAYOUT[place - 1] ? 'up' : 'down'}">${PAYOUT[place - 1] ? money(c.fee * PAYOUT[place - 1]) : 'no payout'}</b></div></div>
    <div class="stand">${rows.map((r, i) => `<div class="${r.you ? 'you' : ''}"><span>${i + 1}. ${esc(r.name)}</span><b>${r.pts.toFixed(1)}</b></div>`).join('')}</div>
    <div class="clist">${c.lineup.map((id) => { const a = state.assets[id]; if (!a) return ''; const live = a.live?.e && (!c.gameIds || c.gameIds.includes(a.live.e)) && !c.games[a.live.e];
      const pts = (c.ppts[id] || 0) + lv.livePts(id); const done = c.gameIds ? c.gameIds.some((g) => c.games[g] && a.perf?.last?.some((x) => x.e === g)) : pts !== 0;
      const fin = a.perf?.last?.find((x) => c.gameIds?.includes(x.e));
      return `<button class="crow" data-open="${id}">${avatar(a)}<div class="grow" style="min-width:0"><div class="name ellipsis">${esc(a.name)}</div>
        <div class="tiny muted ellipsis">${live ? `<span class="tag live">LIVE</span> ${esc(a.live.text || '')}` : done && fin ? esc(fin.text.replace(/ vs [A-Z]+.*$/, '')) : (() => { const g = nextGame(a); return g && c.gameIds?.includes(g.id) ? `Starts ${whenText(g.date)}` : done ? 'Final' : 'Waiting'; })()}</div></div><b class="${live ? 'up' : ''}">${pts.toFixed(1)}</b></button>`; }).join('')}</div>
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
  const slate = nextSlate(state, d.league);
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
      <div class="grow"><div class="name ellipsis">${esc(a.name)}</div><div class="sub">${esc(a.teamAbbr || '')} · ${esc(a.pos || '')} · avg ${a.perf.ema.toFixed(1)} pts${g ? ` · ${whenText(g.date)}` : ''}</div></div>
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
      <div class="row between small"><span><b>${d.picks.length}/${LINEUP}</b> picked ${d.picks.length < LINEUP ? '<button class="chip on" data-act="autofill" style="margin-left:8px;padding:4px 10px;font-size:12px">⚡ Auto-fill</button>' : ''}</span><span class="${left < 0 ? 'down' : 'muted'}">$${left.toLocaleString()} left of $${cap.toLocaleString()}</span></div>
      <div class="picked">${d.picks.map((id) => { const a = state.assets[id]; return `<button data-dpick="${id}">${esc(a.name.split(' ').slice(-1)[0])} ✕</button>`; }).join('')}</div>`;
  }
  function draftFoot() {
    return `<div class="err" id="derr">${esc(d.err || '')}</div><button class="btn buy" data-act="enterdraft" ${d.picks.length === LINEUP ? '' : 'disabled'}>Enter for ${money(fee)}</button>`;
  }
  el.hidden = false;
  el.innerHTML = `<div class="sheet-inner">
    <div class="row between"><button class="icon-btn" data-act="draftback" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div class="row" style="gap:6px">${lgTag(d.league)}<b>${tier.name} contest</b></div><div style="width:38px"></div></div>
    <p class="small muted" style="margin:10px 0">Pick ${LINEUP} players from ${slate ? `${slateDay(slate.day).replace(/^(Today|Tomorrow)$/, (x) => x.toLowerCase())}'s ${slate.games.length === 1 ? 'game' : `${slate.games.length} games`}` : 'the next game day'}. Points are their real game scores in ${slate?.games.length === 1 ? 'that game' : 'those games'}; winnings arrive the next day.</p>
    <div id="dhead">${draftHead()}</div>
    <input class="search" id="dq" type="search" placeholder="Search players or team (e.g. LAL)" value="${esc(d.q)}" autocomplete="off" style="margin-top:10px">
    <div class="list" id="dlist" style="margin-top:8px">${list.map(rowHTML).join('')}</div>
  </div>`;
  const foot = $('#dfoot'); foot.hidden = false; foot.innerHTML = draftFoot();
}

// --- Props ---
// The bet slip: picks, stake and the place button. Docked at the bottom of a game's Props tab.
// How often he has cleared this line lately (smoothed, so two games don't read as a certainty).
function legChance(l) {
  if (l.live) return null;
  const a = state.assets[l.assetId]; const ps = a && propStat(a);
  const last = (a?.perf?.last || []).filter((g) => g.line);
  if (!ps || !last.length) return 0.5;
  const over = (last.filter((g) => ps.of(g.line) > l.line).length + 1) / (last.length + 2);
  return l.side === 'over' ? over : 1 - over;
}
function slipCard(dock = false) {
  const slip = ui.slip;
  if (!slip?.legs.length) return '';
  const n = slip.legs.length; const stake = Number(slip.stake) || 0;
  if (dock && !ui.slipOpen) return `<button class="sliptab" data-act="slipopen"><span class="n">${n}</span><div class="grow"><b>Bet slip</b><div class="tiny ellipsis">${slip.legs.map((l) => `${esc(state.assets[l.assetId]?.ticker || '')} ${l.side === 'over' ? 'o' : 'u'}${l.line}`).join(' · ')}</div></div><span class="x">${(PROP_ODDS ** n).toFixed(2)}×</span><svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></button>`;
  return `<div class="card slip ${dock ? 'dock' : ''}">
      <div class="row between"><b>Bet slip</b><span class="tiny muted">${n} pick${n > 1 ? 's' : ''} · ${(PROP_ODDS ** n).toFixed(2)}×</span>${dock ? '<button class="x-btn" data-act="slipclose" aria-label="Minimise" style="margin-left:8px"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>' : ''}</div>
      ${slip.legs.map((l, i) => `<div class="slip-leg"><div class="grow ellipsis"><b>${esc(state.assets[l.assetId]?.name || '')}</b> <span class="muted">${l.side === 'over' ? 'Over' : 'Under'} ${l.line} ${esc(l.short)}</span></div>${legChance(l) != null ? `<span class="chance">${Math.round(legChance(l) * 100)}%</span>` : '<span class="chance">live</span>'}<button class="x-btn" data-rmleg="${i}">✕</button></div>`).join('')}
      <div class="row" style="margin-top:10px;gap:8px"><label class="price-field grow" style="margin:0"><span class="small muted">Stake $</span><input id="stake" inputmode="decimal" value="${esc(slip.stake)}" placeholder="0"></label>
        <button class="chip" data-stake="${minOrder(state)}">${money(minOrder(state))}</button><button class="chip" data-stake="10%">10%</button><button class="chip" data-stake="25%">25%</button></div>
      <div class="row between small" style="margin-top:8px"><span class="muted">Pays</span><b class="up" id="slippay">${money(potentialPayout(stake, n))}</b></div>
      ${slip.legs.every((l) => legChance(l) != null) ? `<div class="row between tiny muted" style="margin-top:4px"><span>Chance ${n > 1 ? 'all hit' : 'it hits'}, from recent games</span><b>about ${Math.max(1, Math.round(slip.legs.reduce((m, l) => m * legChance(l), 1) * 100))}%</b></div>` : ''}
      <div class="err" id="slerr">${esc(slip.err || '')}</div>
      <button class="btn buy" data-act="placebet">Place bet</button>
    </div>`;
}
// Redraw whichever screen holds the slip, keeping the scroll position.
function redrawSlip() {
  if (ui.game) { const y = $('#game').scrollTop; renderGame(true); $('#game').scrollTop = y; } else { const y = view().scrollTop; renderGames(); view().scrollTop = y; }
}
const slipEl = (id) => (ui.game && $(`#game #${id}`)) || $(`#${id}`);
// The last five games against a line: green went over, red stayed under.
function l5(a, line) {
  const ps = propStat(a); const last = (a.perf?.last || []).filter((g) => g.line).slice(0, 5).reverse();
  if (!ps || last.length < 2) return '';
  return `<div class="l5" aria-label="Last ${last.length} games">${last.map((g) => { const v = ps.of(g.line); return `<i class="${v > line ? 'o' : 'u'}">${Math.round(v)}</i>`; }).join('')}<span>last ${last.length}</span></div>`;
}
const ES_ICON = {
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  slip: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  cards: '<rect x="4" y="6" width="11" height="15" rx="2"/><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3H18a2 2 0 0 1 2 2v11.5a1.5 1.5 0 0 1-1.5 1.5H15"/>',
};
function emptyState(icon, title, sub = '') {
  return `<div class="card empty es"><svg viewBox="0 0 24 24">${ES_ICON[icon]}</svg><b>${title}</b>${sub ? `<div>${sub}</div>` : ''}</div>`;
}
const skelCards = (n) => `<div class="sgames">${'<div class="sgame skel"><div class="sg-teams"><i></i><i></i></div><div class="sg-side"><i></i></div></div>'.repeat(n)}</div>`;
// One over/under line. Live lines also show what the player has so far.
function propRow(p, sub) {
  const a = state.assets[p.assetId]; const sel = ui.slip?.legs.find((l) => l.assetId === p.assetId);
  return `<div class="prop-row">
        <button class="grow row" data-open="${p.assetId}" style="gap:10px;text-align:left;min-width:0">${avatar(a)}<div class="grow" style="min-width:0"><div class="name row" style="gap:6px"><span class="ellipsis">${esc(a.name)}</span>${formDot(a, 'xs')}</div><div class="sub ellipsis">${p.live ? `<b>Has ${p.cur}</b> · ` : ''}${esc(sub)}</div>${l5(a, p.line)}</div></button>
        <button class="ou ${sel?.side === 'over' ? 'on' : ''}" data-prop="${p.key}|over"><small>Over</small>${p.line}</button>
        <button class="ou ${sel?.side === 'under' ? 'on' : ''}" data-prop="${p.key}|under"><small>Under</small>${p.line}</button></div>`;
}
function gamesProps() {
  const now = Date.now();
  // Only the headline props here: the biggest names. Every game's full list is on its own screen.
  const all = propBoard(state, now, enabledLeagues(), { perGame: 3 });
  const board = [...all.filter((p) => p.live).sort((x, y) => y.price - x.price).slice(0, 6), ...all.filter((p) => !p.live).sort((x, y) => y.price - x.price).slice(0, 12)];
  ui.slip ||= { legs: [], stake: '' };
  const slip = ui.slip;
  slip.legs = slip.legs.filter((l) => (l.live ? !!state.liveGames[l.gameId] : l.date > now));
  const max = MAX_LEGS(state);
  const bets = (state.props || []).slice(0, 25);
  const open = bets.filter((b) => b.status === 'open');
  const done = bets.filter((b) => b.status !== 'open').slice(0, 10);
  const byGame = {};
  for (const p of board) (byGame[p.gameId] ||= { id: p.gameId, name: p.game, date: p.date, league: p.league, live: !!p.live, list: [] }).list.push(p);
  const stake = Number(slip.stake) || 0;
  return `
    <p class="small muted" style="margin:12px 0 10px">Over or under on real stat lines, for games in progress and the next two days. A hit pays ${PROP_ODDS}× your stake. Put up to ${max} picks in one bet and the payout multiplies (2 picks ${(PROP_ODDS ** 2).toFixed(2)}×, 3 picks ${(PROP_ODDS ** 3).toFixed(2)}×), but every pick has to hit.${max < 6 ? ' Level 4 raises it to 6.' : ''}</p>
    ${open.length ? `<h2>Open bets</h2><div class="list">${open.map(betRow).join('')}</div>` : ''}
    ${(state.props || []).some((b) => b.status !== 'open') ? '<button class="more" data-page="bets">Bet history ›</button>' : ''}
    ${(() => {
      const games = Object.values(byGame);
      const card = (g) => `<div class="card props-game">
      <div class="row between">${lgTag(g.league)}${g.live ? ' <span class="tag live">LIVE</span>' : ''}<span class="tiny muted" style="margin-left:auto">${esc(g.name)}${g.live ? '' : ` · ${fmtDateTime(g.date)}`}</span></div>
      ${g.list.map((p) => propRow(p, p.label)).join('')}
      <button class="more" data-game="${g.league}|${g.id}|props">All props for this game ›</button></div>`;
      const live = games.filter((g) => g.live); const next = games.filter((g) => !g.live).sort((x, y) => x.date - y.date);
      return `${live.length ? `<h2>Popular live props</h2><p class="tiny faint" style="margin:-4px 2px 8px">Lines move with the game and close for the final stretch.</p>${live.map(card).join('')}` : ''}
        <h2>Popular props <span class="faint small">next two days</span></h2>${next.length ? next.map(card).join('') : emptyState('slip', 'No props right now', 'Lines open two days before each game.')}`;
    })()}
    ${done.length ? `<h2>Settled</h2><div class="list">${done.map(betRow).join('')}</div>` : ''}`;
}

function betRow(b) {
  const name = (l) => state.assets[l.assetId]?.ticker || '?';
  const st = { open: ['', 'Open'], won: ['up', `Won ${money(b.payout)}`], lost: ['down', 'Lost'], void: ['', 'Void'] }[b.status];
  // Each pick's progress toward its line: live from the game, or the final number.
  const leg = (l) => {
    const a = state.assets[l.assetId]; const ps = a && propStat(a);
    const live = a?.live?.e === l.gameId && a.live.line && ps;
    const cur = l.actual != null ? l.actual : live ? Math.round(ps.of(a.live.line) * 10) / 10 : null;
    const over = l.side === 'over';
    const good = cur == null ? null : l.result ? l.result === 'win' : over ? cur > l.line : null; // an under is only safe at the final whistle
    const bad = cur != null && (l.result === 'loss' || (!over && cur > l.line));
    return `<div class="leg ${l.result === 'win' || good ? 'hit' : bad ? 'miss' : ''}"><div class="row between"><span class="ellipsis"><b>${esc(name(l))}</b> ${over ? 'Over' : 'Under'} ${l.line} ${esc(l.short)}</span>
      <span class="tiny">${live && !l.result ? '<span class="tag live">LIVE</span> ' : ''}${cur != null ? `<b>${cur}</b>` : l.result === 'void' ? 'void' : fmtDate(l.date, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}${l.result === 'win' ? ' ✓' : l.result === 'loss' ? ' ✗' : ''}</span></div>
      ${cur != null ? `<div class="legbar"><i style="width:${Math.min(100, (cur / Math.max(l.line, 0.5)) * 100 / 1.25)}%"></i><u></u></div>` : ''}</div>`;
  };
  return `<div class="item bet"><div class="grow" style="min-width:0"><div class="row between"><div class="name">${b.legs.length > 1 ? `${b.legs.length}-pick parlay` : 'Single'} <span class="tiny muted">${money(b.stake)} stake${b.status === 'open' ? ` · pays ${money(potentialPayout(b.stake, b.legs.length))}` : ''}</span></div><div class="price ${st[0]}" style="font-size:14px">${st[1]}</div></div>
    ${b.legs.map(leg).join('')}</div></div>`;
}

// --- Locker: shop, cards, themes, titles ---
function gamesLocker() {
  const c = career(state);
  const L = xpProgress(state).level;
  const cards = Object.keys(state.collection).map((id) => state.assets[id]).filter((a) => a && a.kind !== 'fund')
    .sort((x, y) => rarRank(rarity(state, x)) - rarRank(rarity(state, y)) || cardLevel(state, y.id) - cardLevel(state, x.id));
  return `
    <div class="row between" style="margin-top:14px"><h2 style="margin:0">Moment packs</h2><span class="coins big">Cash ${money(state.cash)}</span></div>
    <p class="small muted" style="margin:6px 0 10px">Packs hold real plays from recent games. Packs cost cash. Money spent on cards, and reward money from goals, trophies and level-ups, doesn't count toward your season return.</p>
    <div class="packs">${B_PACKS.map((p) => { const locked = L < p.level; return `<button class="pack ${p.key} ${locked ? 'locked' : ''}" data-bpack="${p.key}">
      <div class="pk-name">${p.name}</div><div class="tiny">${p.blurb}</div><div class="pk-cost">${locked ? `🔒 Level ${p.level}` : `${cm(packCost(state, p))}`}</div></button>`; }).join('')}</div>

    ${boostersSection()}

    <h2>Your player cards <span class="faint small">${cards.length}</span></h2>
    <p class="small muted" style="margin:-4px 0 10px">You collect a player's card by owning his shares. Card levels add +5% dividends each.</p>
    ${cards.length ? `<div class="card-grid">${cards.slice(0, ui.allCards ? 999 : 12).map(miniCard).join('')}</div>
      ${cards.length > 12 && !ui.allCards ? `<button class="more" data-act="allcards">See all ${cards.length}</button>` : ''}`
      : emptyState('cards', 'No cards yet', 'Buy a player or open a pack to start your collection.')}

    <h2>Themes</h2>
    <div class="themes">${THEMES.map((t) => { const own = c.owned.themes.includes(t.key); const on = c.theme === t.key; const locked = L < t.level; return `<button class="theme ${on ? 'on' : ''}" data-theme="${t.key}" style="--ta:${t.accent};--tb:${t.bg || '#0b0d10'}">
      <div class="sw"><i></i></div><div class="t">${t.name}</div><div class="tiny muted">${on ? 'In use' : own ? 'Tap to use' : locked ? `🔒 Lv ${t.level}` : `${cm(t.cost)}`}</div></button>`; }).join('')}</div>

    <h2>Titles</h2>
    <p class="small muted" style="margin:-4px 0 10px">Shown on the leaderboard and your share card.</p>
    <div class="list">${TITLES.map((t) => { const own = c.owned.titles.includes(t.key); const on = c.title === t.key; const locked = L < t.level; return `<div class="item">
      <div class="grow"><div class="name">${esc(t.key)}</div><div class="sub">${locked ? `Unlocks at level ${t.level}` : own ? 'Owned' : cm(t.cost)}</div></div>
      ${on ? '<span class="pk won">Equipped</span>' : own ? `<button class="btn ghost small" data-title="${esc(t.key)}">Use</button>` : locked ? '<span class="pk">🔒</span>' : `<button class="btn buy small" data-title="${esc(t.key)}">${cm(t.cost)}</button>`}</div>`; }).join('')}</div>`;
}

// Pack opening: cards face down, tap to flip each, best card last.
function showPack(cards, pack) {
  sfx('pack');
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
      <div><span>Prize</span><b>${cm(rec.coins)}</b></div>
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
  const light = !!state.settings.light; // the light look keeps its own background
  if (t.bg && !light) r.setProperty('--bg', t.bg); else r.removeProperty('--bg');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', light ? '#f4f5f7' : t.bg || '#0b0d10');
}

// ---------- moment cards UI ----------

const KIND_ICON = { 'HOME RUN': '⚾', 'GRAND SLAM': '👑', TRIPLE: '⚾', DOUBLE: '⚾', 'RBI SINGLE': '⚾', DUNK: '🏀', 'ALLEY-OOP': '🏀', '3-POINTER': '🎯', BUCKET: '🏀',
  'TD PASS': '🏈', 'TD RUN': '🏈', TOUCHDOWN: '🏈', 'DEFENSIVE TD': '🛡️', 'FIELD GOAL': '🥅' };
const fmtLeft = (ms) => { const m = Math.round(ms / 60e3); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${Math.max(0, m)}m`; };
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
  // Iconic cards carry a real photo of the player when a freely licensed one exists.
  const wp = c.rarity === 'iconic' ? cardPhoto(m) : null;
  return `<div class="mc r-${c.rarity} ${mini ? 'mini' : ''} ${wp ? 'has-photo' : ''}" style="--rc:${r.color}" ${c.rarity === 'iconic' ? `data-wp="${esc(m.league)}:${esc(m.player.id)}"` : ''}>
    ${wp ? `<div class="mc-photo" style="background-image:url('${esc(wp.src)}')"></div>` : ''}
    <div class="mc-art">${cardArt(m, c.serial)}</div><div class="mc-fx"></div>
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
    ${wp && !mini ? `<div class="mc-credit">Photo: ${esc(wp.artist)} · ${esc(wp.licence)} · Wikimedia Commons</div>` : ''}
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
    ${showcaseSection()}
    ${collectionsSection()}
    <div class="row between"><h2>Your moment cards <span class="faint small">${inv.length}</span></h2><span class="tiny muted">${used}/${slots(state)} active</span></div>
    <p class="small muted" style="margin:-4px 0 10px">Each card is a real play. Put it on that player (you need some of his shares) to boost your earnings from him. Each game he plays uses one charge. You get another slot every 3 levels.</p>
    ${fusable.length ? `<div class="card fuse">${fusable.map((r) => { const nx = B_RARITY[rIdx(r.key) + 1];
      return `<div class="row between"><span class="small">3 ${r.name} cards → your best one becomes <b style="color:${nx.color}">${nx.name}</b></span><button class="btn buy small" data-fuse="${r.key}">Fuse · ${cm(fuseCost(state, r.key))}</button></div>`; }).join('')}</div>` : ''}
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
  if (b.rarity === 'legendary' || b.rarity === 'iconic') startTilt();
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
      <div class="small muted" style="margin-top:4px">${av.bids ? `${av.bids} bid${av.bids > 1 ? 's' : ''} · top ${cm(av.current)}` : `No bids yet · starts at ${cm(au.start)}`}</div>
      ${av.bids ? '' : '<button class="btn ghost" data-act="bcancel" style="width:100%;margin-top:10px">Cancel auction</button>'}</div>` : `
    <div class="btn-row">
      ${b.on ? '<button class="btn ghost" data-act="bunequip">Turn off</button>'
        : held ? `<button class="btn buy" data-bequip="${b.assetId}">Use on ${esc(a?.ticker || b.m.player.name)}</button>`
          : a ? `<button class="btn buy" data-open="${b.assetId}">Buy ${esc(a.ticker)} shares to use it</button>` : '<div class="small muted">This player isn\'t listed right now.</div>'}
    </div>
    <h3>Sell</h3>
    ${cardExtras(b)}
    <button class="btn ghost" data-act="bsell" style="width:100%">Quick sell · ${cm(quickSellPrice(b))}</button>
    ${b.on ? '' : `<div class="card" style="margin-top:10px">
      <div class="row between"><b>Auction it</b> <span class="tiny faint">${SELLER_FEE * 100}% fee on a sale</span><span class="tiny muted">Worth about ${cm(mv)}${popularity(b.m) > 1.05 ? ` · ⭐ ${popularity(b.m).toFixed(1)}x star premium` : ''}</span></div>
      <label class="price-field"><span class="small muted">Starting bid ($)</span><input id="bstart" inputmode="decimal" value="${(Math.max(1, Math.round(mv * 0.6)) / 100).toFixed(2)}"></label>
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
    <div class="row between" style="margin:2px 0 10px"><span class="coins">Cash ${money(state.cash)}</span>
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
    ${wantedSection()}
    <p class="tiny faint" style="margin:8px 0 0">${total} live auctions · bids are max bids; the highest when time runs out wins</p>
    ${list.length ? `<div class="mp-grid">${list.map((l) => { const v = views.get(l.id); return `<div class="mp-item">
      <div class="mp-meta" data-lotmeta="${l.id}"><span>⏱ ${fmtLeft(v.left)}</span><span>${v.bids} bid${v.bids === 1 ? '' : 's'}</span></div>
      <button class="mp-cardbtn" data-lot="${l.id}">${momentCard(l.card, { mini: true })}</button>
      <div class="mp-actions"><div class="mp-price" data-lotprice="${l.id}"><span class="tiny muted">${v.bids ? 'Top bid' : 'Starts at'}</span><b>${cm(v.current)}</b>${v.leading ? '<span class="tiny up">You lead</span>' : ''}</div>
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
    if (pr) pr.innerHTML = `<span class="tiny muted">${v.bids ? 'Top bid' : 'Starts at'}</span><b>${cm(v.current)}</b>${v.leading ? '<span class="tiny up">You lead</span>' : ''}`;
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
    <h2>Your bids</h2>${bids.length ? `<div class="list">${bids.map((l) => { const v = listingView(state, l, now); return row(l, `<div class="price-col"><div class="price">${cm(v.current)}</div><div class="tiny ${v.leading ? 'up' : 'down'}">${v.leading ? 'Leading' : 'Outbid'} · ${fmtLeft(v.left)}</div></div>`); }).join('')}</div>` : '<div class="card empty">No active bids.</div>'}
    <h2>Your listings</h2>${live.length ? `<div class="list">${live.map((l) => { const v = listingView(state, l, now); return row(l, `<div class="price-col"><div class="price">${v.bids ? `${cm(v.current)}` : `from ${cm(l.start)}`}</div><div class="tiny muted">${v.bids} bids · ${fmtLeft(v.left)}</div></div>`); }).join('')}</div>` : '<div class="card empty">List cards from your Locker.</div>'}
    ${won.length ? `<h2>Won</h2><div class="list">${won.map((l) => row(l, `<div class="price up">${cm(l.price ?? buyNowPrice(l))}</div>`)).join('')}</div>` : ''}
    ${done.length ? `<h2>Sold & returned</h2><div class="list">${done.map((l) => row(l, `<div class="price ${l.status === 'sold' ? 'up' : 'muted'}">${l.status === 'sold' ? `+${cm(l.price)}` : l.status === 'cancelled' ? 'Cancelled' : 'Unsold'}</div>`)).join('')}</div>` : ''}`;
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
      <div class="stat"><div class="k">${v.bids ? 'Top bid' : 'Starts at'}</div><div class="v">${cm(v.current)}</div></div>
      <div class="stat"><div class="k">Bids</div><div class="v">${v.bids}</div></div>
      <div class="stat"><div class="k">Ends in</div><div class="v">${fmtLeft(v.left)}</div></div>
    </div>
    ${my ? `<div class="small ${v.leading ? 'up' : 'down'}" style="margin-top:8px">${v.leading ? `You're winning. Your max bid is ${cm(my.amount)}; you'll pay just over the next bidder.` : 'You were outbid.'}</div>` : ''}
    <label class="price-field"><span class="small muted">Your max bid ($)</span><input id="bidamt" inputmode="decimal" value="${(v.minBid / 100).toFixed(2)}"></label>
    <div class="quick" style="margin-top:10px">${[v.minBid, v.minBid + inc, v.minBid + inc * 3].map((x) => `<button data-bidq="${(x / 100).toFixed(2)}">${cm(x)}</button>`).join('')}</div>
    <button class="btn buy" data-act="placebid" style="width:100%">Place bid</button>
    <button class="btn ghost" data-act="buynow" style="width:100%;margin-top:8px">Buy now · ${cm(buyNowPrice(l))}</button>
    <div class="tiny faint" style="margin-top:8px;text-align:center">Listed by ${esc(l.seller)} · ${a ? `${esc(a.name)} trades at ${money(a.price)}` : ''}</div>
    <div class="err" id="terr"></div>
    <button class="link-btn" data-act="tcancel">Close</button>`;
  if (focusBid) setTimeout(() => $('#bidamt')?.select(), 300);
}

// ---------- Game Center ----------

function findGame(league, id) {
  const live = state.liveGames[id];
  if (live) return { status: 'live', league, id, name: live.name, detail: live.detail, teams: live.teams, date: live.date || sbGames.get(id)?.ev.date };
  const r = (state.results || []).find((x) => x.id === id);
  if (r) return { status: 'final', league, id, name: r.name, date: r.date, teams: r.teams[0]?.lines ? r.teams : (sbGames.get(id)?.ev.teams || r.teams), preseason: r.preseason };
  const s = (state.schedule?.[league] || []).find((x) => x.id === id);
  if (s) return { status: 'pre', league, id, name: s.name, date: s.date, teams: s.teams, preseason: s.preseason };
  const ev = sbGames.get(id)?.ev; // opened from the Scores page: any day's game
  if (ev) return { status: ev.state === 'in' ? 'live' : ev.state === 'post' ? 'final' : 'pre', league, id, name: ev.name, date: ev.date, detail: ev.detail, teams: ev.teams, preseason: ev.preseason };
  return null;
}

function openGame(league, id, { push = true, tab = 'summary' } = {}) {
  if (!findGame(league, id)) { toast('Game details are no longer available'); return; }
  ui.game = { league, id }; ui.gview = tab; ui.slipOpen = false; $('#game').classList.remove('pinned');
  if (push) { try { history.pushState({ game: id, lg: league }, ''); } catch { /* */ } }
  const el = $('#game');
  el.style.zIndex = ui.detail ? '34' : ''; // above the player page when opened from it
  renderGame(true);
  el.scrollTop = 0;
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
  loadPlays(league, id);
}

function closeGame({ animate = true } = {}) {
  ui.game = null;
  const el = $('#game');
  const finish = () => { if (ui.game) return; el.hidden = true; el.innerHTML = ''; const y = view().scrollTop; render(); view().scrollTop = y; };
  if (animate && !el.hidden) slideOut(el, 'x', finish); else finish();
}

function renderGame(force = false) {
  // Never redraw under someone typing a stake.
  if (!force && document.activeElement?.id === 'stake' && $('#game').contains(document.activeElement)) return;
  const { league, id } = ui.game;
  const g = findGame(league, id);
  const el = $('#game');
  if (!g) { el.hidden = true; return; }
  const now = Date.now();
  const away = g.teams.find((t) => !t.home) || g.teams[0];
  const home = g.teams.find((t) => t !== away) || g.teams[1];
  const tabs = [['summary', 'Game'], ['props', 'Props'], ...(g.status !== 'pre' ? [['plays', 'Feed']] : []), ['away', away.abbr], ['home', home.abbr]];
  const gview = tabs.some(([k]) => k === ui.gview) ? ui.gview : 'summary';
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
  const wpHist = g.status === 'live' ? state.liveGames[id]?.wp || [] : [];
  const pAway = wpHist.length ? wpHist[wpHist.length - 1] : winProb(state, league, away.id, home.id, false, !!g.preseason);
  const wpLine = wpHist.length > 2 ? `<svg class="wpchart" viewBox="0 0 100 30" preserveAspectRatio="none"><line x1="0" x2="100" y1="15" y2="15"/><polyline points="${wpHist.map((p, i) => `${((i / (wpHist.length - 1)) * 100).toFixed(1)},${(2 + (1 - p) * 26).toFixed(1)}`).join(' ')}"/></svg><div class="tiny faint row between"><span>${esc(away.abbr)} ↑</span><span>how the game has swung</span><span>↓ ${esc(home.abbr)}</span></div>` : '';
  const ls = [away, home].every((t) => t.lines?.length) ? Math.max(away.lines.length, home.lines.length) : 0;
  const lineScore = ls ? `<div class="linescore"><table><tr><th></th>${Array.from({ length: ls }, (_, i) => `<th>${league !== 'mlb' && i >= 4 ? (i === 4 ? 'OT' : `${i - 3}OT`) : i + 1}</th>`).join('')}<th>T</th></tr>
    ${[away, home].map((t) => `<tr><td>${esc(t.abbr)}</td>${Array.from({ length: ls }, (_, i) => `<td>${t.lines[i] ?? ''}</td>`).join('')}<td><b>${t.score ?? ''}</b></td></tr>`).join('')}</table></div>` : '';
  const pk = state.picks[id];
  const up = upcomingPickGames(state, now, [league]).find((x) => x.id === id);
  el.hidden = false;
  el.innerHTML = `<div class="sheet-inner">
    <div class="row between"><button class="icon-btn" data-act="gameback" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div class="row" style="gap:6px">${lgTag(league)} ${status}</div><div style="width:38px"></div></div>
    <div class="gc-head">${col(away)}<div class="gc-at">@</div>${col(home)}</div>
    ${league === 'nfl' ? fieldBar(g, league) : league === 'mlb' ? basesCard(g, league) : ''}
    <div class="wp"><div class="tiny muted row between"><span>${esc(away.abbr)} ${Math.round(pAway * 100)}%</span><span>${wpHist.length ? 'Live win probability' : 'Win probability (from share prices)'}</span><span>${Math.round((1 - pAway) * 100)}% ${esc(home.abbr)}</span></div>
      <div class="wp-bar"><i style="width:${pAway * 100}%"></i></div>${wpLine}</div>
    <div class="gpin"><div class="gpin-score"><b>${esc(away.abbr)}</b>${g.status !== 'pre' ? `<span class="s">${away.score ?? ''}</span><span class="faint">–</span><span class="s">${home.score ?? ''}</span>` : '<span class="faint">@</span>'}<b>${esc(home.abbr)}</b><span class="tiny muted">${g.status === 'live' ? esc(g.detail || 'Live') : g.status === 'final' ? 'Final' : whenText(g.date, true)}</span></div>
    <div class="dtabs gtabs">${tabs.map(([k, t]) => `<button data-gview="${k}" class="${gview === k ? 'on' : ''}">${esc(t)}</button>`).join('')}</div></div>
    ${g.status !== 'pre' ? `<div class="gsec" data-gsec="plays" ${gview === 'plays' ? '' : 'hidden'}>${playsSection(g, league)}</div>` : ''}
    <div class="gsec" data-gsec="props" ${gview === 'props' ? '' : 'hidden'}>${gameProps(g, league)}</div>
    <div class="gsec" data-gsec="away" ${gview === 'away' ? '' : 'hidden'}>${teamTab(g, league, away)}</div>
    <div class="gsec" data-gsec="home" ${gview === 'home' ? '' : 'hidden'}>${teamTab(g, league, home)}</div>
    <div class="gsec" data-gsec="summary" ${gview === 'summary' ? '' : 'hidden'}>
    ${up ? `<h3>Your pick</h3>${pickGame(up)}` : pk ? `<div class="card small" style="margin-top:12px">Your pick: <b>${esc(pk.abbr)}</b> · ${pk.result ? { won: `won <b class="up">+${money(pk.paid || 0)}</b>`, lost: '<span class="down">missed</span>', push: 'push', void: 'voided' }[pk.result] : 'locked — game in progress'}</div>` : ''}
    ${lineScore}${teamCompare(g)}${topPerformers(g, league)}${gameStake(g, league)}
    <h3>${g.status === 'pre' ? 'Players to watch' : 'Player movers'}</h3>
    <div class="list">${players.map(({ a, text, live }) => {
      const h = state.holdings[a.id]; const c = change(a, now);
      return `<button class="item" data-open="${a.id}">${avatar(a)}<div class="grow"><div class="name ellipsis">${esc(a.name)}${h ? ' <span class="tag own">Owned</span>' : ''}</div>
        <div class="sub ellipsis">${esc(a.teamAbbr || '')} · ${g.status === 'pre' ? (a.injury ? `<span class="down">${esc(shortInj(a.injury.status))}</span>` : esc(a.pos || '')) : esc(text || '')}${live ? ' <span class="tag live">LIVE</span>' : ''}</div></div>
        <div class="price-col"><div class="price" data-p="${a.id}">${money(a.price)}</div><div class="small ${cls(c)}" data-c="${a.id}" data-plain="1">${fmtPct(c)}</div></div></button>`;
    }).join('') || `<div class="empty">${g.status === 'final' ? 'Box score not loaded for this game.' : 'No player data yet.'}</div>`}</div>
    </div>
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
  setTimeout(renderLand, 0);
  if (!state.assets[id]) return;
  if (ui.order) closeOrder();
  if (ui.chain) closeChain(true);
  const wasOpen = !!ui.detail;
  if (ui.game) $('#game').style.zIndex = ''; // the player page goes on top of the game
  ui.detail = id; ui.chartAnim = true;
  loadBio(state.assets[id]);
  state.recentSearch = [id, ...(state.recentSearch || []).filter((x) => x !== id)].slice(0, 6);
  ui.scrub = false;
  try { history.pushState({ sheet: id }, ''); } catch { /* sandboxed frame */ }
  lockBody();
  const sheet = $('#sheet');
  renderDetail({ keepScroll: false });
  sheet.scrollTop = 0;
  if (!wasOpen) { sheet.classList.remove('enter'); void sheet.offsetWidth; sheet.classList.add('enter'); }
}

function closeDetail({ animate = true } = {}) {
  setTimeout(renderLand, 0);
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
  prefetchArticles();
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
  const news = state.news.filter((n) => (n.targets || []).includes(a.id)).slice(0, 14);
  const dtab = a.kind === 'fund' && ui.dtab === 'cards' ? 'overview' : (ui.dtab || 'overview');
  const myOpts = Object.values(state.options).filter((o) => o.under === a.id);
  const myOrders = state.orders.filter((o) => o.assetId === a.id);
  const divEarned = state.divs.filter((d) => d.id === a.id).reduce((s, d) => s + d.amt, 0);
  const ng = nextGame(a);
  const r = scoutRating(a);
  sheet.hidden = false;
  sheet.classList.toggle('acc-down', ch < 0);
  sheet.innerHTML = `<div class="sheet-inner" id="dinner" data-dtab="${dtab}">
    <div class="row between">
      <button class="icon-btn" data-act="back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div class="icons-right">
        ${a.kind !== 'fund' ? '<button class="icon-btn" data-act="compare" aria-label="Compare"><svg viewBox="0 0 24 24"><path d="M7 4v16M7 4L4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"/></svg></button>' : ''}
        <button class="icon-btn" data-act="shareasset" aria-label="Share"><svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg></button>
        <button class="icon-btn ${alerting ? 'alerting' : ''}" data-act="alert" aria-label="Price alert"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg></button>
        <button class="icon-btn ${watching ? 'on' : ''}" data-act="watch" aria-label="Watchlist"><svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg></button>
      </div>
    </div>
    <div class="hero">${avatar(a)}<div class="grow"><div class="name ellipsis" style="font-size:19px">${esc(a.name)}</div><div class="sub">${subLine(a, { ticker: true })}</div>${a.kind !== 'fund' ? `<div style="margin-top:4px">${rarChip(a)}</div>` : ''}</div></div>
    <div class="big-value" id="dprice">${money(a.price)}</div>
    <div class="change-line ${cls(ch)}" id="dchg">${ch >= 0 ? '▲' : '▼'} ${money(Math.abs(a.price - ref))} (${fmtPct(ch)}) <span class="muted">${rangeLabel(ui.range)}</span></div>
    <div class="chart-wrap" id="dchart"></div>
    <div class="ranges">${Object.keys(RANGES).map((rg) => `<button data-range="${rg}" class="${rg === ui.range ? 'on' : ''}">${rg}</button>`).join('')}</div>

    <div class="dtabs">${[['overview', 'Overview'], ['research', 'Research'], ['news', `News${news.length ? ` <i>${news.length}</i>` : ''}`], ...(a.kind !== 'fund' ? [['cards', 'Cards']] : [])].map(([k, t]) => `<button data-dtab="${k}" class="${dtab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="dsec" data-sec="overview">
    ${ipoCard(a)}
    ${watchEditor(a)}
    ${h ? `<h3>Your position</h3><div class="grid2">
      <div class="stat"><div class="k">Shares</div><div class="v">${fmtQty(h.qty)}</div></div>
      <div class="stat"><div class="k">Market value</div><div class="v">${money(a.price * h.qty)}</div></div>
      <div class="stat"><div class="k">Average cost</div><div class="v">${money(h.cost / h.qty)}</div></div>
      <div class="stat"><div class="k">Total return</div><div class="v ${cls(a.price * h.qty - h.cost)}">${signMoney(a.price * h.qty - h.cost)}</div></div>
      <div class="stat"><div class="k">Today's return</div><div class="v ${cls(change(a, now))}">${signMoney((a.price - priceAt(a, now - DAY)) * h.qty)}</div></div>
      <div class="stat"><div class="k">Dividends earned</div><div class="v up">${money(divEarned)}</div></div>
    </div>` : ''}
    ${protectCard(a)}
    ${shortCard(a)}
    ${myOpts.length ? `<h3>Your options</h3><div class="list">${myOpts.map(optPositionRow).join('')}</div>` : ''}
    ${myOrders.length ? `<h3>Open orders</h3><div class="list">${myOrders.map(orderRow).join('')}</div>` : ''}

    ${a.live ? `<div class="card" style="margin-top:14px"><span class="tag live">LIVE</span> <b style="margin-left:6px">${esc(a.live.text)}</b></div>` : ''}
    ${a.injury ? `<div class="card" style="margin-top:14px"><span class="tag inj">${esc(a.injury.status)}</span> <span class="small" style="margin-left:6px">${esc(a.injury.detail || '')}</span></div>` : ''}
    </div><div class="dsec" data-sec="cards">
    ${cardSection(a)}
    ${boosterSlotCard(a)}
    </div><div class="dsec" data-sec="overview">
    ${ng ? (() => { const tm = a.kind === 'team' ? a.rid : a.teamId; const me = ng.teams.find((t) => t.id === tm); const opp = ng.teams.find((t) => t.id !== tm);
      const p = me && opp ? winProb(state, a.league, me.id, opp.id, !!me.home, !!ng.preseason) : null;
      const tone = p == null ? null : p >= 0.58 ? ['up', 'Favourable matchup'] : p <= 0.42 ? ['down', 'Tough matchup'] : ['', 'Even matchup'];
      return `<button class="card next-game" data-game="${a.league}|${ng.id}" style="margin-top:14px;width:100%;text-align:left"><div><div class="tiny muted">NEXT GAME</div><b>${me?.home ? 'vs' : '@'} ${esc(opp?.abbr || ng.name)}</b>${tone ? `<div class="tiny ${tone[0]}">${tone[1]} · ${Math.round(p * 100)}% to win</div>` : ''}</div><div class="small muted" style="text-align:right">${whenText(ng.date, true)}<div class="tiny" style="color:var(--accent)">Open game ›</div></div></button>`; })() : ''}
    ${upcomingGames(a)}

    ${a.kind === 'fund' ? fundSection(a) : ''}

    <h3>Key stats</h3>
    <div class="stats-grid">${keyStats(a).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>

    </div><div class="dsec" data-sec="research">
    ${researchSection(a)}
    ${reportLine(a)}
    </div><div class="dsec" data-sec="overview">
    <h3>Why it's moving</h3>
    <div class="list">${(a.events || []).slice(0, 10).map((e) => `<div class="driver">
      <div class="ic">${{ game: '🏟️', milestone: '🏆', news: '📰', injury: '🩹', fund: '🧺', report: '📋' }[e.kind] || '•'}</div>
      <div class="txt">${esc(e.text)}<div class="tiny faint">${timeAgo(e.t)}</div></div>
      <div class="pct ${cls(e.pct)}">${Math.abs(e.pct) < 0.0005 ? '<span class="faint">—</span>' : fmtPct(e.pct, 1)}</div></div>`).join('')
      || '<div class="empty">No price-moving events yet.</div>'}</div>

    </div><div class="dsec" data-sec="research">
    ${a.kind === 'player' ? playerStats(a) : a.kind === 'team' ? teamStats(a) : ''}
    ${aboutSection(a)}

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
    </div>` : ''}

    </div><div class="dsec" data-sec="news">
    ${news.length ? `<h3>News</h3><div class="list">${news.map((n) => `<a class="news" href="${esc(n.url)}" data-article="${esc(n.id)}">
      <div class="h">${esc(n.headline)}</div><div class="meta"><span class="senti ${(n.fx?.[a.id] || 0) > 0.12 ? 'up' : (n.fx?.[a.id] || 0) < -0.12 ? 'down' : 'flat'}">${(n.fx?.[a.id] || 0) > 0.12 ? 'Bullish' : (n.fx?.[a.id] || 0) < -0.12 ? 'Bearish' : 'Mention'}</span><span class="tiny faint">${timeAgo(n.published)}</span></div></a>`).join('')}</div>` : ''}
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
  const animate = !!ui.chartAnim; ui.chartAnim = false;
  // Game days along the bottom of the chart (skipped on the 1-day view).
  // Every game in view gets a dot on the line (on the 1-day view too: today's game).
  // The move shown for a game is what the price did across the whole game (from before the
  // start to just after the final), not only the last step when the result was booked: a game
  // followed live has already moved the price by the time it ends.
  const gh = ((LEAGUES[a.league]?.gameHours || 3) + 0.75) * HOUR;
  const gameMove = (e) => { const p0 = priceAt(a, e.t - gh); const p1 = priceAt(a, Math.min(now, e.t + 10 * 60e3)); const m = p0 > 0 && p1 > 0 ? p1 / p0 - 1 : 0; return Math.abs(m) >= 0.0005 ? m : e.pct || 0; };
  const marks = (a.events || []).filter((e) => e.kind === 'game').map((e) => ({ t: e.t, v: gameMove(e), text: e.text }));
  lineChart(el, a.hist.concat([now, a.price]), now - RANGES[ui.range], {
    animate, marks,
    onScrub: (pt) => {
      ui.scrub = !!pt;
      if (!pt) { updateDetailHeader(); return; }
      $('#dprice').textContent = money(pt.p);
      const c = pt.p / pt.first - 1;
      $('#dchg').className = `change-line ${cls(c)}`;
      $('#dchg').innerHTML = `${fmtPct(c)} <span class="muted">${new Date(pt.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>${pt.mark?.text ? `<div class="gmark ${cls(pt.mark.v)}">● ${esc(pt.mark.text)} <b>${fmtPct(pt.mark.v)}</b></div>` : ''}`;
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
  roll(p, a.price, `d:${a.id}`);
  c.className = `change-line ${cls(ch)}`;
  c.innerHTML = `${ch >= 0 ? '▲' : '▼'} ${money(Math.abs(a.price - ref))} (${fmtPct(ch)}) <span class="muted">${rangeLabel(ui.range)}</span>`;
}

// The games after the next one: opponent, when, and how winnable it looks.
function upcomingGames(a) {
  if (a.kind === 'fund') return '';
  const tm = a.kind === 'team' ? a.rid : a.teamId; const now = Date.now();
  const list = (state.schedule?.[a.league] || []).filter((g) => g.date > now && g.teams.some((t) => t.id === tm)).sort((x, y) => x.date - y.date).slice(1, 5);
  if (!list.length) return '';
  return `<div class="card upc" style="margin-top:8px"><div class="tiny muted" style="margin-bottom:4px">COMING UP</div>${list.map((g) => { const me = g.teams.find((t) => t.id === tm); const opp = g.teams.find((t) => t.id !== tm);
    const p = me && opp ? winProb(state, a.league, me.id, opp.id, !!me.home, !!g.preseason) : null;
    return `<button class="upc-row" data-game="${a.league}|${g.id}"><span class="d">${fmtDate(g.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span><b>${me?.home ? 'vs' : '@'} ${esc(opp?.abbr || '')}</b><span class="grow"></span>${p != null ? `<span class="pill2 ${p >= 0.58 ? 'up' : p <= 0.42 ? 'down' : ''}">${Math.round(p * 100)}%</span>` : ''}</button>`; }).join('')}</div>`;
}
function playerStats(a) {
  const totals = Object.keys(SPAN_LABEL).map((k) => [k, formRating(state, a, k)]);
  const rate = (g) => gameRating(state, a, g) ?? 0;
  const tone = formTone;
  const last = a.perf.last.slice(0, 5);
  const now = Date.now();
  // Rating trend: every rated game on record, oldest to newest.
  const hist = ratedGames(state, a).slice(-20);
  const trend = hist.length >= 3 ? (() => { const W = 100; const H = 34; const top = Math.max(8, ...hist.map((x) => x[1])); const lo = Math.min(0, ...hist.map((x) => x[1]));
    const px = (i) => (i / (hist.length - 1)) * W; const py = (v) => H - 3 - ((v - lo) / (top - lo || 1)) * (H - 6);
    const avg = hist.reduce((t, x) => t + x[1], 0) / hist.length;
    return `<svg class="rtrend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${py(avg).toFixed(1)}" y2="${py(avg).toFixed(1)}"/><polyline points="${hist.map((x, i) => `${px(i).toFixed(1)},${py(x[1]).toFixed(1)}`).join(' ')}"/></svg>`; })() : '';
  // What the price did across one game.
  const gh = ((LEAGUES[a.league]?.gameHours || 3) + 1) * HOUR;
  const move = (g) => { const p0 = priceAt(a, g.t - 10 * 60e3); const p1 = priceAt(a, Math.min(now, g.t + gh)); return p0 > 0 && p1 > 0 ? p1 / p0 - 1 : null; };
  const log = a.perf.last.slice(0, ui.logAll === a.id ? 10 : 5);
  return `<h3>Performance</h3>
    <div class="grid3">${totals.map(([k, f]) => `<div class="stat rstat"><div class="k">${SPAN_LABEL[k]}</div><div class="v">${f ? `<span class="formdot ${tone(f.rating)}">${f.rating.toFixed(1)}</span>` : '—'}</div><div class="tiny faint">${f ? `${f.n} game${f.n > 1 ? 's' : ''}` : 'no games'}</div></div>`).join('')}
      <div class="stat rstat"><div class="k">Rating trend</div><div class="v">${trend || '<span class="small muted">—</span>'}</div><div class="tiny faint">${hist.length >= 3 ? `last ${hist.length} games` : 'needs 3 games'}</div></div></div>
    ${last.length ? `<div class="card" style="margin-top:10px"><div class="row between"><b>Last ${last.length} game${last.length > 1 ? 's' : ''}</b><span class="tiny muted">game ratings · oldest → latest</span></div>
      <div class="form5">${last.slice().reverse().map((g) => `<div><span class="formdot ${tone(rate(g))}">${rate(g).toFixed(1)}</span><span class="tiny muted">${esc(g.opp || '')}</span></div>`).join('')}</div></div>
    <h3>Game log</h3><div class="boxwrap"><table class="box glog"><tr><th>Game</th><th>RTG</th><th>Price</th><th style="text-align:left">Stats</th></tr>
      ${log.map((g) => { const m = move(g); return `<tr><td><b>${fmtDate(g.t)}</b> <span class="tiny faint">${esc(g.opp || '')}</span></td><td class="rtg">${rtgChip(rate(g))}</td><td class="chg ${m == null ? '' : cls(m)}">${m == null ? '—' : fmtPct(m)}</td><td class="gl-txt">${esc(g.text.replace(/ vs [A-Z]+( \(preseason\))?$/, ''))}</td></tr>`; }).join('')}</table></div>
      ${a.perf.last.length > 5 && ui.logAll !== a.id ? `<button class="more" data-act="logall">Show all ${Math.min(10, a.perf.last.length)} games</button>` : ''}`
    : '<div class="card small muted" style="margin-top:10px">Game ratings appear here after his next game.</div>'}`;
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
    let msg; let filled = null;
    if (o.mode === 'option') {
      const qty = Math.floor(amountNum(o));
      if (o.side === 'buy') { const tx = buyOption(state, o, qty); msg = `Bought ${qty} × ${tx.opt} for ${money(tx.total)}`; }
      else { const tx = sellOption(state, optKey(o.under, o.type, o.strike, o.exp), qty); msg = `Sold ${qty} × ${tx.opt} for ${money(tx.total)}`; }
    } else {
      const r = computeOrder();
      if (!r.ok) return reset(r.err);
      const a = state.assets[o.id];
      if (o.type === 'market') {
        const h0 = state.holdings[o.id]; const avg0 = h0 ? h0.cost / h0.qty : 0;
        const tx = trade(state, o.id, o.side, r.qty);
        filled = { ...tx, pl: tx.side === 'sell' && avg0 ? Math.round((tx.total - avg0 * tx.qty) * 100) / 100 : null };
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
    buzz();
    closeOrder();
    const n0 = state.inbox.length;
    runSocial(state); runExtras(state); runExtras3(state); runCareer(state);
    const fresh = state.inbox.slice(0, state.inbox.length - n0);
    const lvl = fresh.find((n) => n.kind === 'level');
    if (fresh.some((n) => n.kind === 'card' && /^New/.test(n.text))) msg += ' · 🃏 New card';
    else if (fresh.some((n) => n.kind === 'card')) msg += ' · 🃏 Card leveled up';
    if (fresh.some((n) => n.kind === 'trophy')) msg += ' · 🏆 Trophy';
    if (lvl) msg += ` · ⭐ ${lvl.text.split('!')[0]}`;
    dirty = true; save();
    ui.seenInbox = state.inbox.length;
    sfx(/^Sold/.test(msg) ? 'sell' : 'trade');
    if (ui.chain) renderChain();
    if (ui.detail) renderDetail();
    else render();
    if (filled) {
      // A filled market order gets its own screen; the message is kept for screen readers.
      $('#toast').textContent = msg; toast.at = Date.now(); // and hold other banners back while the confirmation is up
      const extras = [];
      if (fresh.some((n) => n.kind === 'card' && /^New/.test(n.text))) extras.push('🃏 New card'); else if (fresh.some((n) => n.kind === 'card')) extras.push('🃏 Card leveled up');
      if (fresh.some((n) => n.kind === 'trophy')) extras.push('🏆 Trophy unlocked');
      if (lvl) extras.push(`⭐ ${lvl.text.split('!')[0]}`);
      showConfirm(filled, extras);
    } else toast(msg);
    if (firstTrade && state.txns.length) confetti();
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
  if (ui.article) closeArticle();
  if (ui.page) closePage();
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
  updateNwHeader(now);
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
  if (Date.now() - (toast.at || 0) < 3200) return; // let the message on screen finish first
  const fresh = state.inbox.slice(0, Math.max(0, state.inbox.length - ui.seenInbox)).filter((n) => !n.seen);
  ui.seenInbox = state.inbox.length;
  if (!fresh.length) return;
  toast(fresh.length === 1 ? fresh[0].text : `${fresh[0].text} (+${fresh.length - 1} more)`);
  sfx(fresh.some((n) => ['level', 'trophy', 'season'].includes(n.kind)) ? 'level' : fresh.some((n) => n.kind === 'div') ? 'coin' : 'tap');
  refreshBadge();
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('button, [data-article], [data-open], label, [data-optpos], [data-game], [data-flip]');
  if (!el) return;
  const d = el.dataset;
  // Anything that leaves a full-screen page (opening a player, a game, a tab) closes it first.
  if (ui.page && (d.open || d.game || d.article || d.tab || d.gtab)) closePage();
  if (el.dataset.article) { e.preventDefault(); openArticle(el.dataset.article); return; }
  if (d.page) { if (ui.article) closeArticle(); openPage(d.page); return; }
  if (d.cmp != null && ui.page?.type === 'compare') { ui.page.b = d.cmp || null; ui.page.q = ''; renderPage(); $('#page').scrollTop = 0; if (!d.cmp) setTimeout(() => $('#pageq')?.focus(), 50); return; }
  if (d.cmprange && ui.page) { ui.page.range = d.cmprange; renderPage(); return; }
  if (d.gview) { setGview(d.gview); return; }
  if (d.dtab) { ui.dtab = d.dtab; const inner = $('#dinner'); if (inner) { inner.dataset.dtab = d.dtab; inner.querySelectorAll('.dtabs button').forEach((b) => b.classList.toggle('on', b.dataset.dtab === d.dtab)); } return; }
  if (d.wfolder != null && ui.detail) { (state.watchMeta ||= {})[ui.detail] = { ...(state.watchMeta[ui.detail] || {}), folder: d.wfolder }; dirty = true; save(); renderDetail(); return; }
  if (d.chal) { try { answerChallenge(state, d.chal === 'yes'); dirty = true; save(); buzz(); toast('Locked in. Good luck!'); renderHome(); } catch (err) { toast(err.message); } return; }
  if (d.rival) { try { chooseRival(state, d.rival); dirty = true; save(); buzz(); toast('Rival set. The match runs to Sunday night.'); renderPage(); if (ui.tab === 'home') renderHome(); } catch (err) { toast(err.message); } return; }
  if (d.fut && ui.page) { ui.page.sel = d.fut; const y = $('#page').scrollTop; renderPage(); $('#page').scrollTop = y; return; }
  if (d.laymove) { const [k, dir] = d.laymove.split('|'); const o = homeOrder(); const i = o.indexOf(k); const j = i + Number(dir);
    if (j >= 0 && j < o.length) { [o[i], o[j]] = [o[j], o[i]]; state.settings.home = { ...(state.settings.home || {}), order: o }; dirty = true; save(); const y = $('#page').scrollTop; renderPage(); $('#page').scrollTop = y; if (ui.tab === 'home') renderHome(); } return; }
  if (d.wanted != null) { try { const r = fillWanted(state, Number(d.wanted)); dirty = true; save(); buzz(); sfx('coin'); toast(`Sold ${r.card.m.player.name}'s card for ${cm(r.pays)}`); renderMarketplace(); } catch (err) { toast(err.message); } return; }
  if (d.movealert != null) { state.settings.moveAlert = Number(d.movealert); dirty = true; save(); const y = view().scrollTop; renderAccount(); view().scrollTop = y; return; }
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
  if (d.open) { e.preventDefault(); if (ui.article) closeArticle(); openDetail(d.open); return; }
  if (d.pick) {
    const [lg, gid] = d.pick.split('|');
    const g = upcomingPickGames(state, Date.now(), [lg]).find((x) => x.id === gid);
    if (!g) { toast('This game has started — picks are locked'); softRefresh(); return; }
    try {
      buzz();
      if (state.picks[gid]?.teamId === d.team) { clearPick(state, gid); toast('Pick removed'); }
      else { const pk = makePick(state, g, d.team); toast(`Picked ${pk.abbr} · win pays ${money(pickPayout(state, pk))}`); }
      dirty = true;
    } catch (err) { toast(err.message); }
    redrawSlip();
    return;
  }
  if (d.game) { const [lg, gid, tab] = d.game.split('|'); openGame(lg, gid, { tab }); return; }
  if (d.gtab) { const x = $('#view .gtabs')?.scrollLeft; ui.gtab = d.gtab; ui.tab = 'games'; closeOverlays(); render(); view().scrollTop = 0; const row = $('#view .gtabs'); if (row) { if (x) row.scrollLeft = x; row.querySelector('.chip.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } return; }
  if (d.draft) { const [lg, tier] = d.draft.split('|'); openDraft(lg, tier); return; }
  if (d.dpick && ui.draft) {
    const p = ui.draft.picks; const i = p.indexOf(d.dpick);
    if (i >= 0) p.splice(i, 1); else if (p.length < LINEUP) p.push(d.dpick); else { toast(`Lineups have ${LINEUP} players — remove one first`); return; }
    ui.draft.err = ''; buzz(); renderDraft(true); return;
  }
  if (d.prop) {
    const cut = d.prop.lastIndexOf('|');
    const key = d.prop.slice(0, cut); const side = d.prop.slice(cut + 1);
    const p = propBoard(state, Date.now(), enabledLeagues(), { perGame: 14 }).find((x) => x.key === key);
    if (!p) { toast('That line is closed'); return; }
    const slip = (ui.slip ||= { legs: [], stake: '' });
    const i = slip.legs.findIndex((l) => l.assetId === p.assetId);
    if (i >= 0 && slip.legs[i].side === side) slip.legs.splice(i, 1);
    else if (i >= 0) slip.legs[i] = { ...p, side };
    else if (slip.legs.length >= MAX_LEGS(state)) { toast(`Up to ${MAX_LEGS(state)} picks in one bet${MAX_LEGS(state) < 6 ? ' (6 at level 4)' : ''}`); return; }
    else slip.legs.push({ ...p, side });
    slip.err = ''; buzz();
    redrawSlip();
    return;
  }
  if (d.rmleg) { ui.slip.legs.splice(Number(d.rmleg), 1); redrawSlip(); return; }
  if (d.stake) {
    ui.slip.stake = d.stake.endsWith('%') ? (Math.floor(Math.min(state.cash * Number(d.stake.slice(0, -1)) / 100, netWorth(state) * 0.25) * 100) / 100).toFixed(2) : d.stake;
    const inp = slipEl('stake'); if (inp) inp.value = ui.slip.stake; updateSlipPay(); return;
  }
  if (d.pack) {
    const pack = PACKS.find((x) => x.key === d.pack);
    try { const cards = openPack(state, d.pack); dirty = true; save(); buzz(); showPack(cards, pack); } catch (err) { toast(err.message); }
    return;
  }
  if (d.flip != null && ui.packView) {
    if (el.classList.contains('flipped')) return;
    el.classList.add('flipped'); buzz();
    const c = ui.packView.cards[Number(d.flip)];
    if (['legendary', 'epic', 'iconic'].includes(c.rarity.key)) confetti();
    if (!$('#packview').querySelectorAll('.pv-card:not(.flipped)').length) $('#packview [data-act=packdone]').textContent = 'Done';
    return;
  }
  if (d.theme) {
    const c = career(state);
    try { if (c.owned.themes.includes(d.theme)) equipItem(state, 'theme', d.theme); else buyItem(state, 'theme', d.theme); applyTheme(); dirty = true; save(); buzz(); const y = view().scrollTop; renderGames(); view().scrollTop = y; }
    catch (err) { toast(err.message); }
    return;
  }
  if (d.title) {
    const c = career(state);
    try { if (c.owned.titles.includes(d.title)) equipItem(state, 'title', d.title); else buyItem(state, 'title', d.title); dirty = true; save(); buzz(); toast(`Title: ${d.title}`); const y = view().scrollTop; renderGames(); view().scrollTop = y; }
    catch (err) { toast(err.message); }
    return;
  }
  if (d.booster) { openBoosterSheet(d.booster); return; }
  if (d.bequip && ui.order?.mode === 'booster') {
    try { equip(state, ui.order.id, d.bequip); dirty = true; save(); buzz(); toast(`Boosting ${state.assets[d.bequip].ticker}`); closeOrder(); afterBoostChange(); }
    catch (err) { $('#terr').textContent = err.message; }
    return;
  }
  if (d.bpickone && ui.order?.mode === 'bpick') {
    try { const aid = ui.order.id; equip(state, d.bpickone, aid); dirty = true; save(); buzz(); toast(`Boosting ${state.assets[aid].ticker}`); closeOrder(); afterBoostChange(); }
    catch (err) { $('#terr').textContent = err.message; }
    return;
  }
  if (d.blen && ui.order?.mode === 'booster') { ui.order.len = d.blen; const v = $('#bstart')?.value; renderBoosterSheet(); if (v && $('#bstart')) $('#bstart').value = v; return; }
  if (d.fuse) {
    try { const nb = fuse(state, d.fuse); dirty = true; save(); buzz(); confetti(); toast(`${nb.m.player.name}'s card is now ${bRarity(nb.rarity).name}!`); afterBoostChange(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (d.bpack) {
    const pack = B_PACKS.find((x) => x.key === d.bpack);
    try { const got = openBoosterPack(state, d.bpack); dirty = true; save(); buzz(); showBoosterPack(got, pack); } catch (err) { toast(err.message); }
    return;
  }
  if (d.lot) { openLot(d.lot, !!d.bidbtn); return; }
  if (d.mprar) { ui.mp.rarity = d.mprar; keepRows(renderMarketplace); return; }
  if (d.mpsort) { ui.mp.sort = d.mpsort; keepRows(renderMarketplace); return; }
  if (d.mpl) { ui.mp.league = d.mpl; keepRows(renderMarketplace); return; }
  if (d.bidq) { const i = $('#bidamt'); if (i) i.value = d.bidq; return; }
  if (d.sleague) { ui.scoreLeague = d.sleague; keepRows(renderGames); return; }
  if (d.sday) { ui.scoreDay = +d.sday; const x = $('.daystrip')?.scrollLeft; const y = view().scrollTop; renderGames(); view().scrollTop = y; if ($('.daystrip')) $('.daystrip').scrollLeft = x; return; }
  if (d.mview) { ui.mview = d.mview; renderMarket(); return; }
  if (d.league) { ui.league = d.league; ui.pos = 'all'; ui.limit = 60; keepRows(renderMarket); return; }
  if (d.textsize) { state.settings.textSize = Number(d.textsize); state.settings.bigText = d.textsize !== '0'; dirty = true; save(); applyLook(); renderAccount(); return; }
  if (d.pos) { ui.pos = d.pos; ui.limit = 60; keepRows(renderMarket); return; }
  if (d.kind) { ui.kind = d.kind; ui.limit = 60; if (d.kind === 'fund' && !['movers', 'losers', 'price', 'div'].includes(ui.sort)) ui.sort = 'price'; keepRows(renderMarket); return; }
  if (d.price) { ui.price = d.price; ui.limit = 60; keepRows(renderMarket); return; }
  if (d.sort) { ui.sort = d.sort; ui.limit = 60; if (d.sort === 'streak') ui.kind = 'team'; keepRows(renderMarket); return; }
  if (d.coll) {
    ui.tab = 'market'; ui.q = ''; ui.league = 'all'; ui.limit = 60;
    if (d.coll === 'funds') { ui.kind = 'fund'; ui.sort = 'price'; } else { ui.sort = d.coll; ui.kind = d.coll === 'streak' ? 'team' : d.coll === 'mvp' || d.coll === 'hurt' ? 'player' : ui.kind === 'fund' ? 'player' : ui.kind; }
    if (d.coll === 'cheap') { ui.sort = 'movers'; ui.price = 'u25'; ui.kind = 'player'; } else ui.price = 'any';
    render(); view().scrollTop = 0; return;
  }
  if (d.idx) { ui.tab = 'market'; ui.league = d.idx; ui.sort = 'price'; render(); return; }
  if (d.nleague) { ui.newsLeague = d.nleague; keepRows(renderNews); return; }
  if (d.actf) { ui.actFilter = d.actf; keepRows(renderAccount); return; }
  if (d.startcash) { state.settings.startCash = Number(d.startcash); dirty = true; const y = view().scrollTop; renderAccount(); view().scrollTop = y; return; }
  if (d.range) { ui.range = d.range; ui.chartAnim = true; renderDetail(); renderLand(); return; }
  if (d.hrange) { ui.homeRange = d.hrange; ui.nwAnim = true; renderHome(); return; }
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
      buzz(); dirty = true; renderDetail(); toast(i >= 0 ? 'Removed from watchlist' : 'Added to watchlist'); break;
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
    case 'allcards': { ui.allCards = true; const y = view().scrollTop; renderGames(); view().scrollTop = y; break; }
    case 'claim': {
      try {
        const r = claimDaily(state); buzz(); dirty = true; save();
        toast(`+${money(r.reward)} daily reward · ${r.streak}-day streak`);
        if (r.streak % 7 === 0) confetti();
        runSocial(state); const y = view().scrollTop; render(); view().scrollTop = y;
      } catch (err) { toast(err.message); }
      break;
    }
    case 'artback': closeArticle(); break;
    case 'pageback': closePage(); break;
    case 'playsall': if (ui.game) { ui.playsAll = ui.game.id; const y = $('#game').scrollTop; renderGame(true); $('#game').scrollTop = y; } break;
    case 'confirmdone': closeConfirm(); break;
    case 'confirmprotect': closeConfirm(); ui.dtab = 'overview'; if (ui.detail) { renderDetail(); setTimeout(() => $('#sheet .prot')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80); } break;
    case 'duelshare': shareDuel().catch((err) => toast(err.message)); break;
    case 'ipobuy': if (ui.detail) { try { const a = state.assets[ui.detail]; const r = buyIpo(state, ui.detail, parseFloat(String($('#ipoamt').value).replace(/[^0-9.]/g, ''))); dirty = true; save(); buzz(); sfx('trade'); toast(`Bought ${fmtQty(r.qty)} ${a.ticker} at the IPO price`); renderDetail(); } catch (err) { $('#ipoerr').textContent = err.message; } } break;
    case 'protect': if (ui.detail) { try { protect(state, ui.detail, { stopPct: (parseFloat($('#pstop')?.value) || 0) / 100, takePct: (parseFloat($('#ptake')?.value) || 0) / 100 }); dirty = true; save(); buzz(); toast('Protection set'); renderDetail(); } catch (err) { toast(err.message); } } break;
    case 'unprotect': if (ui.detail) { clearProtection(state, ui.detail); dirty = true; save(); renderDetail(); } break;
    case 'shortmore': if (ui.detail) openPage('short', { a: ui.detail }); break;
    case 'cover': if (ui.detail && armed(el, 'Tap again to close')) { try { const r = coverShort(state, ui.detail); dirty = true; save(); buzz(); sfx('sell'); toast(`Short closed: ${signMoney(r.pl)}`); renderDetail(); } catch (err) { toast(err.message); } } break;
    case 'doshort': if (ui.page?.a) { try { const a = state.assets[ui.page.a]; openShort(state, ui.page.a, parseFloat(String($('#shortamt').value).replace(/[^0-9.]/g, ''))); dirty = true; save(); buzz(); sfx('sell'); closePage(); toast(`Shorted ${a.ticker}`); if (ui.detail) renderDetail(); else render(); } catch (err) { $('#perr').textContent = err.message; } } break;
    case 'betfut': if (ui.page?.sel) { try { const [key, id] = ui.page.sel.split('|'); const f = betFuture(state, key, id, parseFloat(String($('#futstake').value).replace(/[^0-9.]/g, ''))); dirty = true; save(); buzz(); sfx('trade'); ui.page.sel = null; toast(`Bet placed: ${f.name} at ${f.mult}x`); renderPage(); } catch (err) { $('#perr').textContent = err.message; } } break;
    case 'sharerecap': shareRecap().catch((err) => toast(err.message)); break;
    case 'shareshow': shareShowcase().catch((err) => toast(err.message)); break;
    case 'layoutreset': delete state.settings.home; dirty = true; save(); renderPage(); if (ui.tab === 'home') renderHome(); break;
    case 'showtoggle': if (ui.order?.mode === 'booster') { try { const on = toggleShowcase(state, ui.order.id); dirty = true; save(); buzz(); toast(on ? 'Added to your showcase' : 'Removed from your showcase'); renderBoosterSheet(); } catch (err) { $('#terr').textContent = err.message; } } break;
    case 'compare': if (ui.detail) openPage('compare', { a: ui.detail, b: null }); break;
    case 'shareach': shareAchievements().catch((err) => toast(err.message)); break;
    case 'sincex': ui.since = null; renderHome(); break;
    case 'gameback': if (history.state?.game) history.back(); else closeGame(); break;
    case 'bunequip': if (ui.order?.mode === 'booster') { unequip(state, ui.order.id); dirty = true; save(); closeOrder(); afterBoostChange(); } break;
    case 'bsell':
      if (ui.order?.mode === 'booster' && armed(el, `Tap again to sell for ${cm(quickSellPrice(boosterState(state).inv.find((x) => x.id === ui.order.id)))}`)) {
        try { const p = quickSell(state, ui.order.id); dirty = true; save(); buzz(); toast(`Sold for ${cm(p)}`); closeOrder(); afterBoostChange(); } catch (err) { $('#terr').textContent = err.message; }
      }
      break;
    case 'blist':
      try { const au = listAuction(state, ui.order.id, { start: toCents($('#bstart').value), length: ui.order.len }); dirty = true; save(); buzz(); toast(`Listed! Bidding ends in ${AUCTION_LENGTHS.find((x) => x.key === ui.order.len).label}`); closeOrder(); afterBoostChange(); void au; }
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
        const r = placeBid(state, ui.order.id, toCents($('#bidamt').value)); dirty = true; save(); buzz();
        if (r.leading) { toast(`You're the top bidder at ${cm(r.price)}`); closeOrder(); renderMarketplace(); }
        else { $('#terr').textContent = `Outbid right away: another collector went to ${cm(r.price)}. Your money is back.`; renderLot(); }
      } catch (err) { $('#terr').textContent = err.message; }
      break;
    }
    case 'buynow':
      if (armed(el, 'Tap again to buy now')) {
        try { const p = buyNow(state, ui.order.id); dirty = true; save(); buzz(); confetti(); toast(`Bought for ${cm(p)} — it's in your Locker`); closeOrder(); renderMarketplace(); }
        catch (err) { $('#terr').textContent = err.message; }
      }
      break;
    case 'draftback': if (history.state?.draft) history.back(); else closeDraft(); break;
    case 'enterdraft': {
      const dr = ui.draft;
      try {
        const c = enterContest(state, { league: dr.league, tier: dr.tier, lineup: dr.picks });
        dirty = true; save(); buzz(); confetti();
        ui.gtab = 'contests';
        if (history.state?.draft) history.back(); else closeDraft();
        toast(`You're in! ${money(c.fee)} entry · good luck`);
      } catch (err) { dr.err = err.message; renderDraft(true); }
      break;
    }
    case 'logall': ui.logAll = ui.detail; renderDetail(); break;
    case 'healthy': ui.healthy = !ui.healthy; ui.limit = 60; keepRows(renderMarket); break;
    case 'autofill': if (ui.draft) { ui.draft.picks = autoLineup(state, ui.draft.league, ui.draft.picks); ui.draft.err = ''; buzz(); renderDraft(true); toast(ui.draft.picks.length === LINEUP ? 'Lineup filled. Swap anyone you like.' : 'Not enough players fit under the cap'); } break;
    case 'scoremine': { ui.scoreMine = !ui.scoreMine; const y = view().scrollTop; renderGames(); view().scrollTop = y; break; }
    case 'slipopen': ui.slipOpen = true; redrawSlip(); break;
    case 'slipclose': ui.slipOpen = false; redrawSlip(); break;
    case 'placebet': {
      const slip = ui.slip;
      try {
        const b = placeBet(state, slip.legs, slip.stake);
        dirty = true; save(); buzz();
        ui.slip = { legs: [], stake: '' }; ui.slipOpen = false;
        toast(`Bet placed: ${money(b.stake)} to win ${money(potentialPayout(b.stake, b.legs.length))}`);
        redrawSlip();
      } catch (err) { slip.err = err.message; redrawSlip(); }
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
  const el = slipEl('slippay'); if (el && ui.slip) el.textContent = money(potentialPayout(Number(ui.slip.stake) || 0, ui.slip.legs.length));
}

function syncQtyInput() {
  const inp = $('#qtyin'); if (inp) inp.value = ui.order.amount;
  if (ui.order.mode === 'option') { const p = $('#payoff'); if (p) delete p.dataset.k; }
  ui.order.err = '';
  updateOrder();
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'duelin' && ui.page) { ui.page.code = e.target.value.trim(); const pos = e.target.selectionStart; const y = $('#page').scrollTop; renderPage(); $('#page').scrollTop = y; const inp = $('#duelin'); if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch { /* */ } } return; }
  if (e.target.id === 'pageq' && ui.page) {
    ui.page.q = e.target.value;
    if (ui.page.type === 'search') $('#pageres').innerHTML = searchResults(ui.page.q);
    else { const pos = e.target.selectionStart; renderPage(); const inp = $('#pageq'); if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch { /* */ } } }
  }
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
  if (e.target.id === 'wnote' && ui.detail) { (state.watchMeta ||= {})[ui.detail] = { ...(state.watchMeta[ui.detail] || {}), note: e.target.value.trim() }; dirty = true; save(); return; }
  if (e.target.id === 'wfnew' && ui.detail) {
    const f = e.target.value.trim().slice(0, 18);
    if (f) { state.watchFolders = [...new Set([...(state.watchFolders || []), f])]; (state.watchMeta ||= {})[ui.detail] = { ...(state.watchMeta[ui.detail] || {}), folder: f }; dirty = true; save(); renderDetail(); }
    return;
  }
  if (e.target.dataset.layhide) { const h = { ...(state.settings.home?.hide || {}) }; if (e.target.checked) delete h[e.target.dataset.layhide]; else h[e.target.dataset.layhide] = true;
    state.settings.home = { ...(state.settings.home || {}), hide: h }; dirty = true; save(); e.target.closest('.lay')?.classList.toggle('off', !e.target.checked); if (ui.tab === 'home') renderHome(); return; }
  if (e.target.id === 'setcb') { state.settings.cb = e.target.checked; dirty = true; save(); applyLook(); return; }
  if (e.target.id === 'setsound') { state.settings.sound = e.target.checked; dirty = true; save(); if (e.target.checked) sfx('trade'); renderAccount(); return; }
  if (e.target.dataset.sfxkind) { (state.settings.sfxOff ||= {})[e.target.dataset.sfxkind] = !e.target.checked; dirty = true; save(); if (e.target.checked) sfx(e.target.dataset.sfxkind); return; }
  if (e.target.id === 'sethapnav') { state.settings.hapNav = e.target.checked; dirty = true; save(); return; }
  if (e.target.id === 'sethaptic') { state.settings.haptics = e.target.checked; dirty = true; save(); buzz(); renderAccount(); return; }
  if (e.target.id === 'setlight') { state.settings.light = e.target.checked; dirty = true; save(); applyLook(); applyTheme(); return; }
  if (e.target.id === 'setbig') { state.settings.bigText = e.target.checked; dirty = true; save(); applyLook(); return; }
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
const pageSwipe = { el: $('#page'), onDismiss: () => closePage() };
const articleSwipe = { el: $('#article'), onDismiss: () => closeArticle({ animate: false }) };
const chainSwipe = {
  el: $('#chain'),
  onDismiss: () => { if (history.state?.chain) { ui.noAnim = true; history.back(); } else closeChain(false, { animate: false }); },
};
// The top-most full-screen page, for swipe-back.
function topPage() {
  if (ui.order) return null;
  if (ui.page) return pageSwipe;
  if (ui.article) return articleSwipe;
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

// ---------- article reader ----------
// Headlines open here instead of leaving the app. The text is fetched from ESPN when you
// tap and kept only for this session; if ESPN won't serve it, you get the summary and a link.
const articleCache = new Map();
function openArticle(id) {
  const n = state.news.find((x) => x.id === id);
  if (!n) return;
  ui.article = id;
  const el = $('#article');
  el.hidden = false; el.scrollTop = 0;
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
  renderArticle();
  loadArticle(n).then(() => { if (ui.article === id) renderArticle(); });
}
// Fetch a story's text once. Stories are loaded ahead of time (the ones on screen, and the
// one under your finger as you touch it), so most open instantly.
const articleLoading = new Map();
function loadArticle(n) {
  if (articleCache.has(n.id) || STATIC) return Promise.resolve();
  if (articleLoading.has(n.id)) return articleLoading.get(n.id);
  const aid = n.aid || n.url?.match(/\/id\/(\d+)/)?.[1];
  if (!aid) { articleCache.set(n.id, { failed: true }); return Promise.resolve(); }
  const p = api.article(n.league, aid).then((h) => {
    const blocks = storyBlocks(h.story);
    articleCache.set(n.id, blocks.length ? { blocks, by: h.byline || n.by || '', img: h.images?.find((i) => i.url)?.url || '' } : { failed: true });
    if (n.img || articleCache.get(n.id).img) new Image().src = articleCache.get(n.id).img || n.img; // warm the photo too
  }).catch(() => { articleCache.set(n.id, { failed: true }); }).then(() => { articleLoading.delete(n.id); });
  articleLoading.set(n.id, p);
  return p;
}
let prefetchTimer = 0;
function prefetchArticles() {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(async () => {
    const ids = [...new Set([...document.querySelectorAll('#view [data-article], #sheet [data-article]')].map((x) => x.dataset.article))].slice(0, 8);
    for (const id of ids) { // two at a time, so it never competes with price updates
      if (document.hidden || busyScrolling(400)) break;
      const n = state.news.find((x) => x.id === id);
      if (n) await loadArticle(n);
    }
  }, 600);
}
document.addEventListener('touchstart', (e) => {
  const el = e.target.closest?.('[data-article]');
  const n = el && state.news.find((x) => x.id === el.dataset.article);
  if (n) loadArticle(n);
}, { passive: true });
// Swipe right anywhere on the story to go back (it only scrolls up and down itself).
{
  const el = $('#article'); let sx = 0; let sy = 0; let t0 = 0; let on = null; let dist = 0;
  el.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; t0 = performance.now(); on = null; dist = 0; }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (on === false) return;
    const t = e.touches[0]; const dx = t.clientX - sx; const dy = t.clientY - sy;
    if (on === null) { if (dx > 10 && dx > 1.5 * Math.abs(dy)) on = true; else if (Math.abs(dy) > 10 || dx < -10) { on = false; return; } else return; }
    dist = Math.max(0, dx); el.style.transition = 'none'; el.style.transform = `translateX(${dist}px)`;
  }, { passive: true });
  const end = () => {
    if (!on) return; on = null;
    const fast = dist / Math.max(1, performance.now() - t0) > 0.5 && dist > 40;
    el.style.transition = 'transform .2s ease-out';
    if (dist > el.offsetWidth * 0.3 || fast) { el.style.transform = 'translateX(100%)'; setTimeout(() => { el.style.transition = ''; closeArticle(); }, 190); }
    else { el.style.transform = ''; setTimeout(() => { el.style.transition = ''; }, 210); }
  };
  el.addEventListener('touchend', end, { passive: true }); el.addEventListener('touchcancel', end, { passive: true });
}
function closeArticle({ animate = true } = {}) {
  ui.article = null;
  const el = $('#article');
  el.hidden = true; el.innerHTML = ''; el.style.transform = '';
}
function renderArticle() {
  const n = state.news.find((x) => x.id === ui.article);
  const el = $('#article');
  if (!n) { closeArticle(); return; }
  const c = articleCache.get(n.id);
  const img = c?.img || n.img;
  const moves = Object.entries(n.fx || {}).map(([id, sc]) => {
    const a = state.assets[id]; if (!a) return '';
    return `<button class="chip" data-open="${id}" data-artopen="1">${esc(a.ticker)} <b class="${sc > 0 ? 'up' : 'down'}">${sc > 0 ? '▲ Bullish' : '▼ Bearish'}</b></button>`;
  }).join('');
  const body = !c ? (STATIC ? '' : '<div class="art-skel"><i></i><i></i><i></i><i></i><i></i><i></i></div>')
    : c.failed ? '<p class="small muted">The full story could not be loaded here.</p>'
      : c.blocks.map((b) => (b.t === 'h' ? `<h3>${esc(b.x)}</h3>` : `<p class="${b.t === 'q' ? 'q' : b.t === 'li' ? 'li' : ''}">${esc(b.x)}</p>`)).join('');
  el.innerHTML = `<div class="sheet-inner art">
    <div class="row between"><button class="icon-btn" data-act="artback" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div class="row" style="gap:6px">${lgTag(n.league)}<span class="tiny faint">ESPN</span></div><div style="width:38px"></div></div>
    ${img ? `<img class="art-img" src="${esc(img)}" alt="" onerror="this.remove()">` : ''}
    <h1>${esc(n.headline)}</h1>
    <div class="by tiny faint">${esc([c?.by || n.by, timeAgo(n.published)].filter(Boolean).join(' · '))}</div>
    ${moves ? `<div class="art-moves">${moves}</div>` : ''}
    ${n.desc ? `<p class="lede">${esc(n.desc)}</p>` : ''}
    ${body}
    <div class="art-foot">
      ${n.url ? `<a class="btn ghost" href="${esc(n.url)}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">${c && !c.failed ? 'View on ESPN' : 'Read the full story on ESPN'}</a>` : ''}
      <div class="tiny faint" style="text-align:center">Story by ESPN. StatStreet is not affiliated with ESPN.</div>
    </div></div>`;
}

// ====================================================================================
// v34: search, compare, calendar, trade journal, achievements, home extras, alerts
// ====================================================================================

const BACK_SVG = '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>';
const pageHead = (title, right = '') => `<div class="row between"><button class="icon-btn" data-act="pageback" aria-label="Back">${BACK_SVG}</button>
  <b>${title}</b><div style="min-width:38px;text-align:right">${right}</div></div>`;

function openPage(type, params = {}) {
  ui.page = { type, ...params };
  const el = $('#page');
  el.hidden = false; el.scrollTop = 0; el.style.transform = '';
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
  renderPage();
  if (type === 'search' || (type === 'compare' && !params.b)) setTimeout(() => $('#pageq')?.focus(), 320);
}
function closePage() {
  ui.page = null;
  const el = $('#page');
  el.hidden = true; el.innerHTML = ''; el.style.transform = '';
}
function renderPage() {
  const p = ui.page; if (!p) return;
  const el = $('#page');
  const body = { search: pageSearch, compare: pageCompare, calendar: pageCalendar, journal: pageJournal, achievements: pageAchievements, short: pageShort, risk: pageRisk,
    breakouts: pageBreakouts, recap: pageRecap, rival: pageRival, hof: pageHof, bets: pageBets, contests: pageContests, divcal: pageDivcal, futures: pageFutures, glance: pageGlance, layout: pageLayout }[p.type]?.(p) || '';
  el.innerHTML = `<div class="sheet-inner">${body}</div>`;
}
// Swipe right anywhere on a full-screen page to go back (the page itself only scrolls up and down).
function swipeClose(el, close) {
  let sx = 0; let sy = 0; let t0 = 0; let on = null; let dist = 0;
  el.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; t0 = performance.now(); on = e.target.closest?.('input, textarea, .hscroll') ? false : null; dist = 0; }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (on === false) return;
    const t = e.touches[0]; const dx = t.clientX - sx; const dy = t.clientY - sy;
    if (on === null) { if (dx > 10 && dx > 1.5 * Math.abs(dy)) on = true; else if (Math.abs(dy) > 10 || dx < -10) { on = false; return; } else return; }
    dist = Math.max(0, dx); el.style.transition = 'none'; el.style.transform = `translateX(${dist}px)`;
  }, { passive: true });
  const end = () => {
    if (!on) return; on = null;
    const fast = dist / Math.max(1, performance.now() - t0) > 0.5 && dist > 40;
    el.style.transition = 'transform .2s ease-out';
    if (dist > el.offsetWidth * 0.3 || fast) { el.style.transform = 'translateX(100%)'; setTimeout(() => { el.style.transition = ''; close(); }, 190); }
    else { el.style.transform = ''; setTimeout(() => { el.style.transition = ''; }, 210); }
  };
  el.addEventListener('touchend', end, { passive: true }); el.addEventListener('touchcancel', end, { passive: true });
}
swipeClose($('#page'), closePage);

// ---------- search everywhere ----------
function searchResults(q) {
  const r = searchAll(state, q);
  const none = !r.assets.length && !r.news.length && !r.cards.length && !r.lots.length;
  if (String(q).trim().length < 2) {
    const recent = (state.recentSearch || []).map((id) => state.assets[id]).filter(Boolean);
    return `${recent.length ? `<h3>Recently viewed</h3><div class="list">${recent.map((a) => assetRow(a)).join('')}</div>` : ''}
      <div class="empty">Search players, teams, funds, headlines and moment cards.</div>`;
  }
  if (none) return `<div class="empty">Nothing matches “${esc(q)}”.</div>`;
  return `${r.assets.length ? `<h3>Players, teams and funds</h3><div class="list">${r.assets.map((a) => assetRow(a)).join('')}</div>` : ''}
    ${r.cards.length ? `<h3>Your cards</h3><div class="list">${r.cards.map((b) => `<button class="item" data-gtab="locker"><div class="rdot" style="background:${bRarity(b.rarity).color}"></div>
      <div class="grow"><div class="name ellipsis">${esc(b.m.player.name)}</div><div class="sub">${bRarity(b.rarity).name} · ${esc(b.m.kind.toLowerCase())}</div></div><span class="muted">›</span></button>`).join('')}</div>` : ''}
    ${r.lots.length ? `<h3>Cards for sale</h3><div class="list">${r.lots.map((l) => { const v = listingView(state, l); return `<button class="item" data-tab="marketplace"><div class="rdot" style="background:${bRarity(l.card.rarity).color}"></div>
      <div class="grow"><div class="name ellipsis">${esc(l.card.m.player.name)}</div><div class="sub">${bRarity(l.card.rarity).name} · ${esc(l.card.m.kind.toLowerCase())}</div></div><div class="price">${cm(v.current)}</div></button>`; }).join('')}</div>` : ''}
    ${r.news.length ? `<h3>News</h3><div class="list">${r.news.map((n) => `<a class="news" href="${esc(n.url)}" data-article="${esc(n.id)}"><div class="h">${esc(n.headline)}</div>
      <div class="meta">${lgTag(n.league)}<span class="tiny faint">${timeAgo(n.published)}</span></div></a>`).join('')}</div>` : ''}`;
}
function pageSearch(p) {
  return `${pageHead('Search')}
    <input id="pageq" class="searchbox" type="search" placeholder="Players, teams, news, cards" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(p.q || '')}">
    <div id="pageres">${searchResults(p.q || '')}</div>`;
}

// ---------- compare two players or teams ----------
function dualChart(a, b, span) {
  const now = Date.now(); const from = now - span; const W = Math.min(640, (view().clientWidth || 360) - 32); const H = 150;
  const ser = [a, b].map((x) => { const p0 = priceAt(x, from) || x.price; const pts = [[from, 0]];
    for (let i = 0; i < x.hist.length; i += 2) if (x.hist[i] > from) pts.push([x.hist[i], x.hist[i + 1] / p0 - 1]);
    pts.push([now, x.price / p0 - 1]); return pts; });
  const ys = ser.flat().map((q) => q[1]); let lo = Math.min(...ys, 0); let hi = Math.max(...ys, 0); const pad = (hi - lo) * 0.12 || 0.01; lo -= pad; hi += pad;
  const X = (t) => ((t - from) / (now - from)) * (W - 8) + 4; const Y = (v) => H - 6 - ((v - lo) / (hi - lo)) * (H - 12);
  const path = (pts) => pts.map((q, i) => `${i ? 'L' : 'M'}${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join('');
  return `<svg class="chart draw" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)" stroke-dasharray="2 4"/>
    <path class="ln" pathLength="1" d="${path(ser[0])}" fill="none" stroke="var(--cmp-a)" stroke-width="2.2" stroke-linejoin="round"/>
    <path class="ln" pathLength="1" d="${path(ser[1])}" fill="none" stroke="var(--cmp-b)" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
}
function pageCompare(p) {
  const a = state.assets[p.a]; const b = state.assets[p.b];
  if (!a) return pageHead('Compare');
  if (!b) {
    const q = (p.q || '').trim();
    const peers = q.length >= 2 ? searchAll(state, q).assets.filter((x) => x.id !== a.id && x.kind !== 'fund')
      : assetsList().filter((x) => x.id !== a.id && x.kind === a.kind && x.league === a.league && (a.kind === 'team' || posGroup(x.league, x.pos) === posGroup(a.league, a.pos)))
        .sort((x, y) => Math.abs(Math.log(x.price / a.price)) - Math.abs(Math.log(y.price / a.price))).slice(0, 10);
    return `${pageHead('Compare')}
      <p class="small muted" style="margin:10px 0">Pick who to compare with <b>${esc(a.name)}</b>.</p>
      <input id="pageq" class="searchbox" type="search" placeholder="Search a player or team" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(p.q || '')}">
      <div id="pageres"><h3>${q.length >= 2 ? 'Results' : 'Similar price, same position'}</h3><div class="list">${peers.map((x) => `<button class="item" data-cmp="${x.id}">${avatar(x)}
        <div class="grow"><div class="name ellipsis">${esc(x.name)}</div><div class="sub">${subLine(x)}</div></div><div class="price">${money(x.price)}</div></button>`).join('') || '<div class="empty">No matches.</div>'}</div></div>`;
  }
  const rows = compareRows(state, a, b);
  const span = RANGES[p.range || '1M'];
  const up = (x) => upcomingFor(x).slice(0, 3).map((u) => `${u.home ? 'vs' : '@'} ${esc(u.opp?.abbr || '')}${u.rank ? ` (#${u.rank})` : ''}`).join(', ') || 'No games this week';
  const wins = { a: rows.filter((r) => r.win === 'a').length, b: rows.filter((r) => r.win === 'b').length };
  const head = (x, k) => `<button class="cmp-h" data-open="${x.id}" style="--cc:var(--cmp-${k})">${avatar(x)}<div class="name ellipsis">${esc(x.kind === 'team' ? x.ticker : x.name)}</div><div class="tiny muted">${esc(x.ticker)} · ${wins[k]} edge${wins[k] === 1 ? '' : 's'}</div></button>`;
  return `${pageHead('Compare', `<button class="tlink" data-cmp="">Change</button>`)}
    <div class="cmp-top">${head(a, 'a')}<div class="cmp-vs">vs</div>${head(b, 'b')}</div>
    <div class="chart-wrap" style="margin-top:10px">${dualChart(a, b, span)}</div>
    <div class="ranges">${['1W', '1M', '3M', 'ALL'].map((r) => `<button data-cmprange="${r}" class="${r === (p.range || '1M') ? 'on' : ''}">${r}</button>`).join('')}</div>
    <div class="cmp-table">${rows.map((r) => `<div class="cmp-row"><b class="${r.win === 'a' ? 'win' : ''}">${esc(r.a)}</b><span>${esc(r.label)}</span><b class="${r.win === 'b' ? 'win' : ''}">${esc(r.b)}</b></div>`).join('')}
      <div class="cmp-row sched"><b>${up(a)}</b><span>Next games</span><b>${up(b)}</b></div></div>
    <p class="tiny faint" style="text-align:center;margin-top:12px">Green marks the better number on each line. Opponent rank is by team share price.</p>`;
}

// ---------- calendar ----------
function pageCalendar() {
  const now = Date.now();
  const games = calendar(state, now, 7);
  const days = new Map();
  for (const g of games) { const k = new Date(g.date).toDateString(); if (!days.has(k)) days.set(k, []); days.get(k).push(g); }
  const label = { easy: 'Easy matchup', even: 'Even', tough: 'Tough matchup' };
  return `${pageHead('Calendar')}
    <p class="small muted" style="margin:10px 0">The next 7 days of games for what you own. Prices and dividends move on game results, so soft matchups are chances and tough ones are risks.</p>
    ${games.length ? [...days.entries()].map(([k, list]) => `<h3>${new Date(list[0].date).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}${k === new Date(now).toDateString() ? ' · today' : ''}</h3>
      <div class="list">${list.map((g) => `<button class="item" data-game="${g.league}|${g.id}">${lgTag(g.league)}<div class="grow"><div class="name">${esc(g.team)} ${g.home ? 'vs' : '@'} ${esc(g.opp)}${g.oppRank ? ` <span class="tiny faint">#${g.oppRank} of ${g.n}</span>` : ''}</div>
        <div class="sub">${new Date(g.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${g.mine.slice(0, 4).map((a) => esc(a.ticker)).join(', ')}${g.mine.length > 4 ? ` +${g.mine.length - 4}` : ''}</div></div>
        <span class="diff ${g.diff}">${label[g.diff]}</span></button>`).join('')}</div>`).join('')
      : `<div class="card empty" style="margin-top:14px">${Object.keys(state.holdings).length ? 'Nothing you own plays in the next 7 days.' : 'Buy a player or team and their games show up here.'}</div>`}`;
}

// ---------- trade journal ----------
const heldTxt = (ms) => (ms < HOUR ? `${Math.max(1, Math.round(ms / 60e3))}m` : ms < DAY ? `${Math.round(ms / HOUR)}h` : `${Math.round(ms / DAY)}d`);
function pageJournal() {
  const trades = closedTrades(state);
  const s = journalStats(trades);
  return `${pageHead('Trade journal')}
    <p class="small muted" style="margin:10px 0">Every sale this season, against what the shares cost you.</p>
    ${trades.length ? `<div class="grid2">
      <div class="stat"><div class="k">Realized profit</div><div class="v ${cls(s.total)}">${signMoney(s.total)}</div></div>
      <div class="stat"><div class="k">Win rate</div><div class="v">${Math.round(s.winRate * 100)}% <span class="tiny muted">${s.wins}W · ${s.losses}L</span></div></div>
      <div class="stat"><div class="k">Average win</div><div class="v up">${signMoney(s.avgWin)}</div></div>
      <div class="stat"><div class="k">Average loss</div><div class="v down">${signMoney(s.avgLoss)}</div></div></div>
    <h3>Closed trades</h3><div class="list">${trades.slice(0, 80).map((t) => `<button class="item jr" ${state.assets[t.id] ? `data-open="${t.id}"` : ''}>
      <div class="grow"><div class="name ellipsis">${esc(t.name || t.ticker)}</div>
        <div class="sub">${fmtQty(t.qty)} sh · ${money(t.buy)} → ${money(t.sell)} · held ${heldTxt(t.held)} · ${fmtDate(t.t)}</div>
        ${t.why ? `<div class="tiny faint ellipsis">Around the sale: ${esc(t.why)}</div>` : ''}</div>
      <div class="price-col"><div class="price ${cls(t.pl)}">${signMoney(t.pl)}</div><div class="small ${cls(t.pct)}">${fmtPct(t.pct, 1)}</div></div></button>`).join('')}</div>`
      : '<div class="card empty" style="margin-top:14px">No sales yet. When you sell, the trade lands here with your profit or loss and what was moving the price.</div>'}`;
}

// ---------- achievements ----------
function pageAchievements() {
  const d = achievements(state);
  const xp = xpProgress(state);
  return `${pageHead('Achievements', '<button class="tlink" data-act="shareach">Share</button>')}
    <div class="ach-hero"><div class="lvl">${xp.level}</div><div class="grow"><div class="name">${esc(career(state).title)}</div><div class="tiny muted">Level ${xp.level} · net worth ${money(d.netWorth)}</div></div></div>
    <div class="ach-grid">${d.items.map((x) => `<div class="ach ${x.ok ? '' : 'off'}"><div class="e">${x.icon}</div><div class="v">${esc(x.value)}</div><div class="t">${esc(x.title)}</div><div class="tiny muted ellipsis">${esc(x.sub)}</div></div>`).join('')}</div>`;
}
async function shareAchievements() {
  const d = achievements(state);
  const c = achievementsCard({ title: career(state).title, level: xpProgress(state).level, netWorth: d.netWorth, items: d.items.filter((x) => x.ok).slice(0, 6) });
  await shareCanvas(c, 'statstreet-achievements.png', 'My StatStreet achievements');
}

// ---------- portfolio page extras ----------
function challengeCard(now) {
  const ch = dailyChallenge(state, now); const c = ch.cur;
  if (!c) return '';
  const a = state.assets[c.id];
  const open = !c.pick && now < c.date;
  const state2 = c.result === 'won' ? '<span class="pk won">Won</span>' : c.result === 'lost' ? '<span class="pk lost">Missed</span>' : c.result === 'void' ? '<span class="pk">No result</span>'
    : c.pick ? `<span class="pk">You said ${c.pick === 'over' ? 'Yes' : 'No'}</span>` : now >= c.date ? '<span class="pk">Closed</span>' : '';
  return `<div class="card chal"><div class="row between"><div class="tiny muted">DAILY CHALLENGE${ch.streak ? ` · 🔥 ${ch.streak}` : ''}</div>${state2}</div>
    <div class="q">Will <button class="tlink" data-open="${c.id}">${esc(c.name)}</button> beat his usual game tonight?</div>
    <div class="tiny muted">${esc(c.game)} · ${new Date(c.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · usual game score ${c.line}${c.gs != null ? ` · scored ${c.gs}` : ''}${a?.perf?.last?.[0] && c.gs == null ? ` · last game ${a.perf.last[0].gs}` : ''}</div>
    ${open ? `<div class="btn-row" style="margin-top:10px"><button class="btn buy small" data-chal="yes">Yes, he beats it</button><button class="btn ghost small" data-chal="no">No</button></div>
      <div class="tiny faint" style="margin-top:6px">Right answers earn XP and build a streak; every 5th in a row pays $0.50.</div>` : ''}</div>`;
}
// Watchlist grouped into your folders, with your notes.
function watchSection(watch) {
  if (!watch.length) return '';
  const meta = state.watchMeta || {};
  const groups = new Map();
  for (const a of watch) { const f = meta[a.id]?.folder || ''; if (!groups.has(f)) groups.set(f, []); groups.get(f).push(a); }
  const keys = [...groups.keys()].sort((x, y) => (x === '') - (y === '') || x.localeCompare(y));
  return `<h2>Watchlist</h2>${keys.map((k) => `${keys.length > 1 || k ? `<div class="wfolder">${k ? '📁 ' + esc(k) : 'No folder'} <span class="faint">${groups.get(k).length}</span></div>` : ''}
    <div class="list">${groups.get(k).map((a) => assetRow(a, { right: 'spark', note: meta[a.id]?.note ? `<span class="wnote ellipsis">📝 ${esc(meta[a.id].note)}</span>` : '' })).join('')}</div>`).join('')}`;
}
// Folder and note editor on a watched player's page.
function watchEditor(a) {
  if (!state.watch.includes(a.id)) return '';
  const m = state.watchMeta?.[a.id] || {};
  const folders = [...new Set([...(state.watchFolders || []), ...Object.values(state.watchMeta || {}).map((x) => x.folder).filter(Boolean)])];
  return `<div class="card wedit"><div class="tiny muted">WATCHLIST FOLDER</div>
    <div class="chips" style="margin:8px 0">${['', ...folders].map((f) => `<button class="chip ${(m.folder || '') === f ? 'on' : ''}" data-wfolder="${esc(f)}">${f ? esc(f) : 'None'}</button>`).join('')}
      <input class="chip-input" id="wfnew" placeholder="+ New folder" maxlength="18" enterkeyhint="done"></div>
    <div class="tiny muted">YOUR NOTE</div>
    <textarea id="wnote" rows="2" maxlength="240" placeholder="Why you're watching, your target price…">${esc(m.note || '')}</textarea></div>`;
}
// What you have riding on a game.
function gameStake(g, league) {
  const ids = new Set(g.teams.map((t) => t.id));
  const now = Date.now();
  const mine = Object.entries(state.holdings).map(([id, h]) => ({ a: state.assets[id], h }))
    .filter(({ a }) => a && a.kind !== 'fund' && a.league === league && ids.has(a.kind === 'team' ? a.rid : a.teamId));
  if (!mine.length) return '';
  const tot = mine.reduce((s, { a, h }) => s + a.price * h.qty, 0);
  const day = mine.reduce((s, { a, h }) => s + (a.price - priceAt(a, now - DAY)) * h.qty, 0);
  return `<h3>Your stake in this game</h3><div class="card stake"><div class="row between"><div><div class="tiny muted">AT STAKE</div><b style="font-size:20px">${money(tot)}</b></div>
    <div style="text-align:right"><div class="tiny muted">TODAY</div><b class="${cls(day)}" style="font-size:20px">${signMoney(day)}</b></div></div></div>
    <div class="list" style="margin-top:8px">${mine.sort((x, y) => y.a.price * y.h.qty - x.a.price * x.h.qty).map(({ a, h }) => { const d = (a.price - priceAt(a, now - DAY)) * h.qty; return `<button class="item" data-open="${a.id}">${avatar(a)}
      <div class="grow"><div class="name ellipsis">${esc(a.name)}</div><div class="sub ellipsis">${a.live?.text ? `<span class="tag live">LIVE</span> ${esc(a.live.text)}` : `${fmtQty(h.qty)} sh`}</div></div>
      <div class="price-col"><div class="price">${money(a.price * h.qty)}</div><div class="small ${cls(d)}">${signMoney(d)}</div></div></button>`; }).join('')}</div>`;
}
// Card sets in the Locker.
function collectionsSection() {
  const sets = collections(state);
  if (!sets.length) return '';
  return `<h2>Collections <span class="faint small">${sets.filter((s) => s.done).length} complete</span></h2>
    <p class="small muted" style="margin:6px 0 10px">Own ${SET_SIZE} moment cards from one team to complete its set: +${Math.round(SET_BONUS * 100)}% dividends from that team and all its players, on top of any card boosts.</p>
    <div class="list">${sets.slice(0, 12).map((s) => `<div class="item"><span class="lg ${s.league}">${esc(s.team)}</span><div class="grow"><div class="name">${esc(s.team)} set ${s.done ? '<span class="pk won">Complete</span>' : ''}</div>
      <div class="setbar"><i style="width:${Math.min(100, (s.n / SET_SIZE) * 100)}%"></i></div></div><div class="small ${s.done ? 'up' : 'muted'}">${s.done ? `+${Math.round(SET_BONUS * 100)}% divs` : `${s.n}/${SET_SIZE}`}</div></div>`).join('')}</div>`;
}
const textSize = () => (state.settings.textSize != null ? Number(state.settings.textSize) : state.settings.bigText ? 1 : 0);
function applyLook() {
  const s = state.settings;
  const root = document.documentElement;
  if (s.light) root.dataset.mode = 'light'; else delete root.dataset.mode;
  root.classList.toggle('big-text', textSize() === 1);
  root.classList.toggle('xl-text', textSize() === 2);
  root.classList.toggle('cb', !!s.cb);
}

// ====================================================================================
// v35: customizable Portfolio page, shorts, protection, risk, what-if, breakouts, recap,
// rival, futures, glance, card extras, sound and accessibility
// ====================================================================================

const HOME_SECTIONS = [
  ['since', 'Since you last opened'], ['recap', 'Weekly recap'], ['today', 'Top gainer and loser'], ['lineup', 'Playing today'], ['challenge', 'Daily challenge'],
  ['rival', 'Rival of the week'], ['tools', 'Shortcuts'], ['movers', 'Top movers'], ['alloc', 'Allocation bar'], ['season', 'Season and daily reward'], ['live', 'Live games'],
  ['orders', 'Open orders and options', true], ['stocks', 'Stocks', true], ['shorts', 'Short positions', true], ['funds', 'Index funds'], ['watch', 'Watchlist'],
  ['upcoming', 'Upcoming games'], ['discover', 'Discover'],
];
function homeOrder() {
  const all = HOME_SECTIONS.map((x) => x[0]);
  const saved = (state.settings.home?.order || []).filter((k) => all.includes(k));
  // Sections added in later versions slot in at their default place.
  for (const k of all) if (!saved.includes(k)) { const i = all.indexOf(k); const before = all.slice(0, i).reverse().find((x) => saved.includes(x)); saved.splice(before ? saved.indexOf(before) + 1 : 0, 0, k); }
  return saved;
}
const TOOLS = [['glance', '👀', 'Glance'], ['calendar', '📅', 'Calendar'], ['risk', '🛡️', 'Risk check'], ['breakouts', '🚀', 'Breakouts'], ['divcal', '💵', 'Dividends'], ['futures', '🔮', 'Futures'], ['journal', '📒', 'Journal'],
  ['recap', '🗓️', 'My week'], ['rival', '⚔️', 'Rival'], ['achievements', '🏅', 'Achievements'], ['hof', '🏛️', 'Hall of fame'], ['layout', '🧩', 'Customize']];

function homeParts(now, holdings, movers) {
  const since = ui.since;
  const today = holdings.map(({ a, h }) => ({ a, d: (a.price - priceAt(a, now - DAY)) * h.qty, c: change(a, now) })).sort((x, y) => y.d - x.d);
  const win = today[0] && today[0].d > 0.004 ? today[0] : null; const lose = today.length > 1 && today[today.length - 1].d < -0.004 ? today[today.length - 1] : (today.length === 1 && today[0].d < -0.004 ? today[0] : null);
  const lineup = lineupToday(state, now);
  const wl = (x, label) => `<button class="stat wl" data-open="${x.a.id}"><div class="k">${label}</div><div class="v ${cls(x.d)}">${signMoney(x.d)}</div><div class="tiny muted ellipsis">${esc(x.a.name)} · ${fmtPct(x.c, 1)}</div></button>`;
  const rv = rivalStatus(state, now);
  return {
    since: since ? `<div class="card since"><button class="x-btn" data-act="sincex" aria-label="Dismiss">✕</button><div class="tiny muted">SINCE YOU LAST OPENED · ${timeAgo(since.t)}</div>
      <div class="s-line">Your portfolio is <b class="${cls(since.change)}">${since.change >= 0 ? 'up' : 'down'} ${money(Math.abs(since.change))}</b> (${fmtPct(since.pct)})${since.top ? `. Biggest mover: <button class="tlink" data-open="${since.top.a.id}">${esc(since.top.a.ticker)}</button> <span class="${cls(since.top.d)}">${signMoney(since.top.d)}</span>` : ''}${since.nDivs ? `. ${since.nDivs} dividend${since.nDivs > 1 ? 's' : ''} paid <span class="up">${money(since.divs)}</span>` : ''}.</div></div>` : '',
    recap: recapDue(state, now) ? `<button class="card promo" data-page="recap"><span class="e">🗓️</span><div class="grow"><div class="name">Your week in review</div><div class="tiny muted">Best and worst calls, dividends and your rank</div></div><span class="muted">›</span></button>` : '',
    today: win || lose ? `<div class="grid2" style="margin-top:12px">${win ? wl(win, 'Top gainer today') : ''}${lose ? wl(lose, 'Top loser today') : ''}</div>` : '',
    lineup: lineup.length ? `<h3>Playing today</h3><div class="hscroll lineup">${lineup.map((g) => `<button class="lu ${g.live ? 'live' : ''}" data-game="${g.league}|${g.id}">
      <div class="row" style="gap:6px">${lgTag(g.league)}${g.live ? '<span class="tag live">LIVE</span>' : `<span class="tiny muted">${new Date(g.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>`}</div>
      <div class="name">${esc(g.name)}</div>
      <div class="tiny muted ellipsis">${g.live && g.detail ? esc(g.detail) + ' · ' : ''}${g.mine.slice(0, 3).map((x) => `${x.own ? '' : '☆'}${esc(x.a.ticker)}`).join(', ')}${g.mine.length > 3 ? ` +${g.mine.length - 3}` : ''}</div></button>`).join('')}</div>` : '',
    challenge: challengeCard(now),
    rival: rv ? `<button class="card rivalc" data-page="rival"><div class="tiny muted">RIVAL THIS WEEK · ${rv.w}-${rv.l} all time</div>
      <div class="vsline"><span>You <b class="${cls(rv.me)}">${fmtPct(rv.me, 1)}</b></span><span class="faint">vs</span><span>${esc(rv.name)} <b class="${cls(rv.him)}">${fmtPct(rv.him, 1)}</b></span></div>
      <div class="tiny ${rv.ahead ? 'up' : 'down'}">${rv.ahead ? 'You\'re ahead' : 'You\'re behind'} · ${daysLeft(rv.ends)}</div></button>` : '',
    tools: `<div class="hscroll tools">${TOOLS.map(([k, e, t]) => `<button data-page="${k}"><span>${e}</span>${t}</button>`).join('')}</div>`,
    movers: movers.length ? `<h3>Top movers today</h3><div class="hscroll mv">${movers.map(({ a }) => { const c = change(a, now); return `<button class="mvc" data-open="${a.id}">${avatar(a)}<b>${esc(a.ticker)}</b><span class="${cls(c)}" data-c="${a.id}" data-plain="1" data-r="1D">${fmtPct(c)}</span></button>`; }).join('')}</div>` : '',
  };
}
function shortsSection(now) {
  const list = Object.entries(state.shorts || {}).map(([id, s]) => ({ a: state.assets[id], s, id })).filter((x) => x.a);
  if (!list.length) return '';
  return `<h2>Shorts</h2><div class="list">${list.map(({ a, s, id }) => { const pl = shortEquity(state, id) - s.margin; return `<button class="item" data-open="${id}">${avatar(a)}
    <div class="grow"><div class="name ellipsis">${esc(a.name)} <span class="tag short">SHORT</span></div><div class="sub">${fmtQty(s.qty)} sh · from ${money(s.entry)}</div></div>
    <div class="price-col"><div class="price">${money(s.margin + pl)}</div><div class="small ${cls(pl)}">${signMoney(pl)}</div></div></button>`; }).join('')}</div>`;
}

// ---------- on the player page ----------
function protectCard(a) {
  const h = state.holdings[a.id]; if (!h) return '';
  const p = protection(state, a.id);
  if (p.stop || p.take) return `<div class="card prot"><div class="row between"><b>🛟 Protected</b><button class="tlink" data-act="unprotect">Remove</button></div>
    <div class="small muted" style="margin-top:6px">${p.stop ? `Sells everything if it falls to <b class="down">${money(p.stop.price)}</b>` : ''}${p.stop && p.take ? ', or ' : ''}${p.take ? `${p.stop ? '' : 'Sells everything '}if it rises to <b class="up">${money(p.take.price)}</b>` : ''}. Whichever comes first cancels the other.</div></div>`;
  return `<div class="card prot"><b>🛟 Protect this position</b><div class="tiny muted" style="margin:4px 0 8px">Sell automatically at a loss limit or a profit target. Leave one blank to skip it.</div>
    <div class="prot-row"><label>Stop-loss<div class="pf"><span>−</span><input id="pstop" inputmode="decimal" placeholder="10" value="10"><span>%</span></div></label>
      <label>Take-profit<div class="pf"><span>+</span><input id="ptake" inputmode="decimal" placeholder="20" value="20"><span>%</span></div></label>
      <button class="btn buy small" data-act="protect">Set</button></div></div>`;
}
function shortCard(a) {
  if (a.kind === 'fund') return '';
  const s = state.shorts?.[a.id];
  if (s) { const eq = shortEquity(state, a.id); const pl = eq - s.margin; return `<h3>Your short</h3><div class="grid2">
      <div class="stat"><div class="k">Shorted</div><div class="v">${fmtQty(s.qty)} sh</div></div>
      <div class="stat"><div class="k">From</div><div class="v">${money(s.entry)}</div></div>
      <div class="stat"><div class="k">Worth now</div><div class="v">${money(Math.max(0, eq))}</div></div>
      <div class="stat"><div class="k">Profit</div><div class="v ${cls(pl)}">${signMoney(pl)}</div></div></div>
    <div class="tiny muted" style="margin:8px 2px">Fees so far ${money(s.fee || 0)}. It closes itself if the price climbs to about ${money(s.entry + (s.margin * 0.85 - (s.fee || 0)) / s.qty)}.</div>
    <div class="btn-row"><button class="btn ghost" data-act="shortmore">Short more</button><button class="btn buy" data-act="cover">Close short</button></div>`; }
  if (state.holdings[a.id]) return '';
  return `<button class="card shortc" data-act="shortmore"><span class="e">📉</span><div class="grow"><div class="name">Bet against ${esc(a.kind === 'team' ? a.ticker : a.name.split(' ').slice(-1)[0])}</div>
    <div class="tiny muted">Short it: you profit if the price falls and lose if it rises.</div></div><span class="muted">›</span></button>`;
}

// ---------- pages ----------
function pageShort(p) {
  const a = state.assets[p.a]; if (!a) return pageHead('Short');
  const room = Math.max(0, Math.min(state.cash, netWorth(state) * SHORT_CAP - shortExposure(state)));
  return `${pageHead(`Short ${esc(a.ticker)}`)}
    <div class="hero" style="margin-top:12px">${avatar(a)}<div class="grow"><div class="name">${esc(a.name)}</div><div class="sub">${money(a.price)} now</div></div></div>
    <div class="card" style="margin-top:12px"><div class="small">You put up cash and bet the price <b>falls</b>.</div>
      <ul class="plain"><li>Price down 10% → you make about 10% of your stake. Price up 10% → you lose about 10%.</li>
      <li>Borrowing costs <b>${(BORROW_DAILY * 100).toFixed(2)}% a day</b>, and you pay any dividends ${a.kind === 'team' ? 'the team' : 'he'} earns.</li>
      <li>If the price rises about 85%, the short closes itself and most of your stake is gone.</li>
      <li>Shorts can total at most half your net worth.</li></ul></div>
    <label class="price-field"><span class="small muted">Amount to put up ($)</span><input id="shortamt" inputmode="decimal" value="${p.amt ?? (room >= 1 ? Math.min(room, Math.max(1, Math.round(state.cash * 0.1))).toFixed(2) : room.toFixed(2))}"></label>
    <div class="tiny muted" style="margin:6px 2px">Available to short: ${money(room)} · cash ${money(state.cash)}</div>
    <div id="perr" class="small down" style="min-height:20px;margin-top:6px"></div>
    <button class="btn sell" data-act="doshort" style="width:100%">Short ${esc(a.ticker)}</button>`;
}
const bar = (pct, c = 'var(--up)') => `<div class="setbar"><i style="width:${Math.min(100, Math.max(1, pct * 100))}%;background:${c}"></i></div>`;
function pageRisk() {
  const r = riskReport(state);
  const col = r.score >= 70 ? 'var(--up)' : r.score >= 45 ? '#ffb020' : 'var(--down)';
  const grp = (title, rows) => (rows.length ? `<h3>${title}</h3><div class="list">${rows.map((x) => `<div class="item"><div class="grow"><div class="row between"><span class="name">${esc(x.k)}</span><span class="small muted">${money(x.v)} · ${Math.round(x.pct * 100)}%</span></div>${bar(x.pct, x.pct > 0.5 ? 'var(--down)' : 'var(--up)')}</div></div>`).join('')}</div>` : '');
  return `${pageHead('Risk check')}
    <div class="card riskhero" style="--rc:${col}"><div class="ring" style="--p:${r.score}"><b>${r.score}</b></div><div class="grow"><div class="name">${r.label}</div>
      <div class="tiny muted">${r.n} holding${r.n === 1 ? '' : 's'} · ${Math.round(r.cashPct * 100)}% cash${r.shorts ? ` · ${money(r.shorts)} short` : ''}</div></div></div>
    ${r.warn.length ? `<h3>Watch out</h3><div class="list">${r.warn.map((w) => `<div class="driver"><div class="ic">⚠️</div><div class="txt">${esc(w)}</div></div>`).join('')}</div>`
      : r.n ? '<div class="card small" style="margin-top:12px">✅ Nothing stands out. No single player, team or game dominates your money.</div>' : '<div class="card empty" style="margin-top:12px">You\'re all in cash. Buy something and this shows where your risk sits.</div>'}
    ${r.games.filter((g) => g.v > 0).length ? `<h3>Riding on today's games</h3><div class="list">${r.games.filter((g) => g.v > 0).map(({ g, v }) => `<button class="item" data-game="${g.league}|${g.id}">${lgTag(g.league)}<div class="grow"><div class="row between"><span class="name">${esc(g.name)}</span><span class="small muted">${money(v)} · ${Math.round(v / r.nw * 100)}%</span></div>${bar(v / r.nw, v / r.nw > 0.5 ? 'var(--down)' : 'var(--up)')}</div></button>`).join('')}</div>` : ''}
    ${grp('By league', r.byLeague)}${grp('By team', r.byTeam)}${grp('By position', r.byPos)}
    <p class="tiny faint" style="text-align:center;margin-top:12px">Score: 100 is evenly spread, lower means more of your money depends on fewer things.</p>`;
}
function pageBreakouts() {
  const list = breakouts(state);
  return `${pageHead('Breakout watch')}
    <p class="small muted" style="margin:10px 0">Lower-priced players whose last three games are well above their usual level. The price catches up slowly, one game at a time.</p>
    ${list.length ? `<div class="list">${list.map(({ a, recent, base, wk }) => `<button class="item" data-open="${a.id}">${avatar(a)}<div class="grow"><div class="name ellipsis">${esc(a.name)}</div>
      <div class="sub">${esc(a.teamAbbr || '')} · last 3 avg <b class="up">${recent.toFixed(1)}</b> vs usual ${base.toFixed(1)}</div></div>
      <div class="price-col"><div class="price">${money(a.price)}</div><div class="small ${cls(wk)}">${fmtPct(wk, 1)} wk</div></div></button>`).join('')}</div>`
      : '<div class="card empty" style="margin-top:14px">No breakouts right now. This fills in once players have a few regular-season games.</div>'}`;
}
function pageRecap() {
  const w = weeklyRecap(state);
  state.recapSeen = weekId(Date.now()); dirty = true;
  const row = (icon, title, val, sub, c = '') => `<div class="driver"><div class="ic">${icon}</div><div class="txt">${title}<div class="tiny faint ellipsis">${sub}</div></div><div class="pct ${c}">${val}</div></div>`;
  return `${pageHead('Your week', '<button class="tlink" data-act="sharerecap">Share</button>')}
    <div class="tiny muted" style="margin-top:14px">LAST 7 DAYS</div>
    <div class="big-value ${cls(w.change)}" style="font-size:40px">${signMoney(w.change)}</div>
    <div class="change-line ${cls(w.pct)}">${fmtPct(w.pct)} <span class="muted">· net worth ${money(w.nw)}</span></div>
    <div class="list" style="margin-top:14px">
      ${row('🏁', 'Leaderboard', `#${w.rank}`, `of ${w.of} this season`)}
      ${w.bestHold ? row('📈', 'Best holding', signMoney(w.bestHold.d), `${esc(w.bestHold.a.name)} · ${fmtPct(w.bestHold.pct, 1)}`, 'up') : ''}
      ${w.worstHold ? row('📉', 'Worst holding', signMoney(w.worstHold.d), `${esc(w.worstHold.a.name)} · ${fmtPct(w.worstHold.pct, 1)}`, 'down') : ''}
      ${w.bestTrade ? row('💰', 'Best sale', signMoney(w.bestTrade.pl), `${esc(w.bestTrade.name || w.bestTrade.ticker)} · ${fmtPct(w.bestTrade.pct, 1)}`, cls(w.bestTrade.pl)) : ''}
      ${w.worstTrade ? row('🧯', 'Worst sale', signMoney(w.worstTrade.pl), `${esc(w.worstTrade.name || w.worstTrade.ticker)} · ${fmtPct(w.worstTrade.pct, 1)}`, cls(w.worstTrade.pl)) : ''}
      ${row('💵', 'Dividends', money(w.divs), `${w.nDivs} payment${w.nDivs === 1 ? '' : 's'}`, w.divs > 0 ? 'up' : '')}
      ${row('🎯', 'Pick\'em', `${w.picksW}-${w.picksL}`, 'wins and misses')}
      ${row('🔁', 'Sales closed', String(w.nTrades), 'in your trade journal')}
    </div>`;
}
async function shareRecap() {
  const w = weeklyRecap(state);
  const items = [{ icon: '📊', title: 'This week', value: `${w.change >= 0 ? '+' : '−'}$${Math.abs(w.change).toFixed(2)}` }, { icon: '🏁', title: 'Leaderboard', value: `#${w.rank} of ${w.of}` },
    w.bestHold && { icon: '📈', title: `Best: ${w.bestHold.a.ticker}`, value: fmtPct(w.bestHold.pct, 1) }, w.worstHold && { icon: '📉', title: `Worst: ${w.worstHold.a.ticker}`, value: fmtPct(w.worstHold.pct, 1) },
    { icon: '💵', title: 'Dividends', value: `$${w.divs.toFixed(2)}` }, { icon: '🎯', title: 'Pick\'em', value: `${w.picksW}-${w.picksL}` }].filter(Boolean);
  const c = achievementsCard({ title: career(state).title, level: xpProgress(state).level, netWorth: w.nw, items, heading: 'My week' });
  await shareCanvas(c, 'statstreet-week.png', 'My week on StatStreet');
}
function pageRival() {
  const rv = rivalStatus(state);
  return `${pageHead('Rival')}
    <p class="small muted" style="margin:10px 0">Pick one rival to go head to head with each week, Monday to Sunday. Beat their return and you win 60 XP and $0.50.</p>
    ${rv ? `<div class="card rivalc"><div class="tiny muted">THIS WEEK · ${daysLeft(rv.ends)}</div><div class="vsline"><span>You <b class="${cls(rv.me)}">${fmtPct(rv.me, 1)}</b></span><span class="faint">vs</span><span>${esc(rv.name)} <b class="${cls(rv.him)}">${fmtPct(rv.him, 1)}</b></span></div>
      <div class="tiny muted">Record ${rv.w}-${rv.l}</div></div>` : ''}
    <h3>${rv ? 'Switch rival' : 'Choose your rival'}</h3>
    <div class="list">${RIVALS.map((r) => { const f = state.assets[`fund:${r.fund}`]; const wk = f?.hist?.length ? change(f, Date.now(), 7 * DAY) : null; return `<button class="item" data-rival="${r.fund}" ${f?.price ? '' : 'disabled'}>
      <div class="grow"><div class="name">${esc(r.name)} ${rv?.fund === r.fund ? '<span class="pk won">Current</span>' : ''}</div><div class="sub">${esc(r.style)}</div></div>
      <div class="small ${wk == null ? 'muted' : cls(wk)}">${wk == null ? '—' : fmtPct(wk, 1) + ' wk'}</div></button>`; }).join('')}</div>
    ${rv ? '<p class="tiny faint" style="text-align:center;margin-top:10px">Switching restarts this week\'s match from now.</p>' : ''}
    ${duelSection(ui.page || {})}`;
}
function pageFutures(p) {
  const now = Date.now();
  const ms = futuresMarkets(state, now); const open = futuresOpen(state, now);
  const mine = (state.futures || []);
  const live = mine.filter((f) => !f.result && f.season === state.season?.n);
  return `${pageHead('Season futures')}
    <p class="small muted" style="margin:10px 0">Season-long bets, settled when this StatStreet season ends${state.season ? ` (${daysLeft(state.season.end)})` : ''}. One bet per market, up to 10% of your net worth. Betting closes a week before the end.</p>
    ${live.length ? `<h3>Your bets</h3><div class="list">${live.map((f) => `<div class="item"><div class="grow"><div class="name">${esc(f.name)}</div><div class="sub">${lgTag(f.league)} ${esc(f.title)} · ${money(f.stake)} at ${f.mult}x</div></div><div class="price up">${money(f.stake * f.mult)}</div></div>`).join('')}</div>` : ''}
    ${!open ? '<div class="card small" style="margin-top:12px">Betting is closed for this season. New markets open when the next one starts.</div>' : ''}
    ${ms.map((m) => { const has = live.some((f) => f.key === m.key); return `<h3>${lgTag(m.league)} ${esc(m.title)} <span class="faint" style="text-transform:none;letter-spacing:0;font-weight:500">${m.type === 'mvp' ? 'highest-priced player at season end' : 'best record at season end'}</span></h3>
      <div class="list">${m.options.map((o) => `<button class="item fut ${p.sel === m.key + '|' + o.id ? 'on' : ''}" data-fut="${m.key}|${o.id}" ${has || !open ? 'disabled' : ''}>
        <div class="grow"><div class="name ellipsis">${esc(o.name)}</div><div class="sub">${o.p < 0.01 ? 'under 1' : Math.round(o.p * 100)}% chance</div></div><div class="price">${o.mult}x</div></button>`).join('')}</div>
      ${p.sel?.startsWith(m.key + '|') ? `<div class="card" style="margin-top:8px"><label class="price-field" style="margin:0"><span class="small muted">Stake ($)</span><input id="futstake" inputmode="decimal" value="${p.stake ?? Math.max(0.05, Math.min(state.cash, netWorth(state) * 0.05)).toFixed(2)}"></label>
        <div id="perr" class="small down" style="min-height:18px;margin-top:6px"></div><button class="btn buy" data-act="betfut" style="width:100%">Place bet</button></div>` : ''}`; }).join('')}
    ${mine.filter((f) => f.result).length ? `<h3>Settled</h3><div class="list">${mine.filter((f) => f.result).slice(0, 10).map((f) => `<div class="item"><div class="grow"><div class="name">${esc(f.name)}</div><div class="sub">${esc(f.title)} · winner ${esc(f.winner || '')}</div></div>
      <div class="price ${f.result === 'won' ? 'up' : 'down'}">${f.result === 'won' ? '+' + money(f.paid) : '−' + money(f.stake)}</div></div>`).join('')}</div>` : ''}`;
}
function pageGlance() {
  const now = Date.now();
  const nw = netWorth(state, now); const ref = nwAt(now - DAY) ?? state.startCash; const ch = nw - ref;
  const hold = Object.entries(state.holdings).map(([id, h]) => ({ a: state.assets[id], d: 0, h })).filter((x) => x.a).map((x) => ({ ...x, d: (x.a.price - priceAt(x.a, now - DAY)) * x.h.qty })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d))[0];
  const lu = lineupToday(state, now)[0];
  const next = lu || enabledLeagues().flatMap((lg) => (state.schedule?.[lg] || []).map((g) => ({ ...g, league: lg }))).filter((g) => g.date > now).sort((x, y) => x.date - y.date)[0];
  return `${pageHead('Glance')}
    <div class="glance"><div class="tiny muted">NET WORTH</div><div class="g-num">${money(nw)}</div>
      <div class="g-chg ${cls(ch)}">${ch >= 0 ? '▲' : '▼'} ${money(Math.abs(ch))} · ${fmtPct(ref ? ch / ref : 0)} today</div>
      ${hold ? `<button class="g-tile" data-open="${hold.a.id}"><div class="tiny muted">BIGGEST MOVER</div><div class="g-big">${esc(hold.a.ticker)} <span class="${cls(hold.d)}">${signMoney(hold.d)}</span></div><div class="small muted">${esc(hold.a.name)} · ${money(hold.a.price)}</div></button>` : ''}
      ${next ? `<button class="g-tile" data-game="${next.league}|${next.id}"><div class="tiny muted">${next.live ? 'LIVE NOW' : 'NEXT GAME'}</div><div class="g-big">${esc(next.name)}</div><div class="small muted">${next.live ? esc(next.detail || '') : fmtDateTime(next.date)}</div></button>` : ''}
      ${state.season ? `<div class="g-tile"><div class="tiny muted">SEASON ${state.season.n}</div><div class="g-big">${tierFor(seasonReturn(state, now)).name} <span class="${cls(seasonReturn(state, now))}">${pctTxt(seasonReturn(state, now))}</span></div><div class="small muted">${daysLeft(state.season.end)}</div></div>` : ''}</div>`;
}
function pageLayout() {
  const order = homeOrder(); const hide = state.settings.home?.hide || {};
  const meta = Object.fromEntries(HOME_SECTIONS.map(([k, t, fixed]) => [k, { t, fixed }]));
  return `${pageHead('Customize', '<button class="tlink" data-act="layoutreset">Reset</button>')}
    <p class="small muted" style="margin:10px 0">Choose what the Portfolio page shows and in what order. Your balance and chart always stay on top.</p>
    <div class="list">${order.map((k, i) => `<div class="item lay ${hide[k] ? 'off' : ''}"><div class="grow"><div class="name">${meta[k].t}</div>${meta[k].fixed ? '<div class="tiny faint">Always shown when you have any</div>' : ''}</div>
      <button class="x-btn" data-laymove="${k}|-1" aria-label="Move ${meta[k].t} up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="x-btn" data-laymove="${k}|1" aria-label="Move ${meta[k].t} down" ${i === order.length - 1 ? 'disabled' : ''}>↓</button>
      ${meta[k].fixed ? '<span style="width:46px"></span>' : `<label class="switch" aria-label="Show ${meta[k].t}"><input type="checkbox" data-layhide="${k}" ${hide[k] ? '' : 'checked'}><span></span></label>`}</div>`).join('')}</div>`;
}

// ---------- cards: showcase, wanted, history ----------
function showcaseSection() {
  const sc = showcase(state);
  return `<div class="row between" style="margin-top:22px"><h2 style="margin:0">Showcase <span class="faint small">${sc.length}/${SHOWCASE_MAX}</span></h2>${sc.length ? '<button class="tlink" data-act="shareshow">Share</button>' : ''}</div>
    ${sc.length ? `<div class="hscroll show">${sc.map((b) => `<button class="shc" data-booster="${b.id}" style="--rc:${bRarity(b.rarity).color}"><div class="tiny" style="color:var(--rc);font-weight:800">${bRarity(b.rarity).name.toUpperCase()}</div><div class="name ellipsis">${esc(b.m.player.name)}</div><div class="tiny muted ellipsis">${esc(b.m.kind.toLowerCase())} · ${b.m.rating.toFixed(1)}</div></button>`).join('')}</div>`
      : '<p class="small muted" style="margin:6px 0 0">Pick up to five cards to show off: open a card and tap “Add to showcase”.</p>'}`;
}
async function shareShowcase() {
  const sc = showcase(state);
  const c = achievementsCard({ title: career(state).title, level: xpProgress(state).level, netWorth: netWorth(state), heading: 'My showcase',
    items: sc.map((b) => ({ icon: KIND_ICON[b.m.kind] || '🃏', title: `${bRarity(b.rarity).name} · ${b.m.kind.toLowerCase()}`, value: b.m.player.name })) });
  await shareCanvas(c, 'statstreet-showcase.png', 'My StatStreet card showcase');
}
function wantedSection() {
  const offers = wantedOffers(state);
  if (!offers.length) return '';
  return `<h3 style="margin-top:14px">Wanted today</h3><div class="list">${offers.map((o) => `<div class="item"><div class="rdot" style="background:${bRarity(o.rarity).color}"></div>
    <div class="grow"><div class="name">${bRarity(o.rarity).name} ${esc(o.team)} card</div><div class="sub">A collector pays ${Math.round((o.premium - 1) * 100)}% over market${o.card && !o.done ? ` · your ${esc(o.card.m.player.name)}` : ''}</div></div>
    ${o.done ? '<span class="pk won">Sold</span>' : o.card ? `<button class="btn buy small" data-wanted="${o.i}">Sell ${cm(o.pays)}</button>` : '<span class="pk">None to sell</span>'}</div>`).join('')}</div>`;
}
function cardExtras(b) {
  const hist = cardHistory(b); const sales = recentSales(state, b);
  const first = hist[1]; const last = hist[hist.length - 1];
  return `<div class="card" style="margin-top:10px"><div class="row between"><b>Value, 14 days</b><span class="small ${cls(last - first)}">${cm(last)} · ${fmtPct(first ? last / first - 1 : 0, 1)}</span></div>
      <div style="margin-top:8px">${sparkline(hist, 0, Math.min(560, (view().clientWidth || 360) - 72), 46)}</div></div>
    <div class="card" style="margin-top:10px"><b>Recent ${bRarity(b.rarity).name} sales</b>
      ${sales.map((s) => `<div class="brk"><span class="ellipsis">${esc(s.name)} · ${esc(s.kind.toLowerCase())} <span class="faint">${timeAgo(s.t)}</span></span><b>${cm(s.price)}</b></div>`).join('') || '<div class="small muted" style="margin-top:6px">No sales yet.</div>'}</div>
    <button class="btn ghost" data-act="showtoggle" style="width:100%;margin-top:10px">${b.show ? '★ Remove from showcase' : '☆ Add to showcase'}</button>`;
}

// ---------- sound ----------
let actx = null;
const SFX_KINDS = [['trade', 'Trades', 'Buying and selling'], ['coin', 'Rewards', 'Dividends, wins and sales'], ['pack', 'Card packs', 'Opening a pack']];
function sfx(name) {
  if (state?.settings?.sound === false || state?.settings?.sfxOff?.[name === 'sell' ? 'trade' : name]) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const notes = { trade: [[660, 0, 0.07], [880, 0.07, 0.1]], sell: [[620, 0, 0.07], [470, 0.07, 0.1]], coin: [[1320, 0, 0.06], [1760, 0.06, 0.14]], pack: [[523, 0, 0.09], [659, 0.09, 0.09], [784, 0.18, 0.09], [1047, 0.27, 0.22]], level: [[659, 0, 0.1], [988, 0.1, 0.24]], tap: [[520, 0, 0.04]] }[name];
    if (!notes) return;
    const t0 = actx.currentTime;
    for (const [f, at, len] of notes) {
      const o = actx.createOscillator(); const g = actx.createGain();
      o.type = name === 'coin' ? 'triangle' : 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(0.09, t0 + at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      o.connect(g).connect(actx.destination); o.start(t0 + at); o.stop(t0 + at + len + 0.02);
    }
  } catch { /* no audio available */ }
}
const buzz = () => { if (state?.settings?.haptics !== false) haptic(); };

// ====================================================================================
// v37: market events, IPOs, report cards, hall of fame, friend challenge, quick actions,
// pinned price bar
// ====================================================================================

function marketBanners() {
  const now = Date.now();
  const ev = activeEvents(state, now);
  const ipos = ipoList(state, now).slice(0, 8);
  return `${ev.map((e) => `<div class="card evb">${lgTag(e.league)}<div class="grow"><b>⚡ ${esc(e.name)}</b><div class="tiny muted">Prices across the league are swinging more than usual · ${daysLeft(e.end).replace(' left', '')} to go</div></div></div>`).join('')}
    ${ipos.length ? `<h3>Rookie IPOs</h3><div class="hscroll ipos">${ipos.map((a) => { const ph = ipoPhase(a, now); return `<button class="lu ${ph === 'open' ? 'live' : ''}" data-open="${a.id}">
      <div class="row" style="gap:6px">${lgTag(a.league)}${ph === 'open' ? '<span class="tag live">OPEN</span>' : '<span class="tag ipo">IPO</span>'}</div>
      <div class="name ellipsis">${esc(a.name)}</div>
      <div class="tiny muted">${ph === 'open' ? `${money(a.ipo.price)} · closes ${new Date(a.ipo.opens + IPO_WINDOW).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : `Lists ${new Date(a.ipo.opens).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`}</div></button>`; }).join('')}</div>` : ''}`;
}
function ipoCard(a) {
  const now = Date.now(); const ph = ipoPhase(a, now);
  if (!ph || ph === 'done') return '';
  if (ph === 'soon') return `<div class="card ipoc"><span class="tag ipo">IPO</span> <b style="margin-left:6px">Lists ${new Date(a.ipo.opens).toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' })}</b>
    <div class="small muted" style="margin-top:6px">A newcomer to the market. When it opens you get three hours to take an allocation of up to ${Math.round(IPO_ALLOC * 100)}% of your net worth at the IPO price. After that he trades freely, and the first move can go either way.</div></div>`;
  const room = ipoRoom(state, a, now);
  return `<div class="card ipoc"><div class="row between"><span><span class="tag live">IPO OPEN</span> <b style="margin-left:6px">${money(a.ipo.price)} a share</b></span><span class="tiny muted">closes ${new Date(a.ipo.opens + IPO_WINDOW).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
    <div class="small muted" style="margin:6px 0 8px">Your allocation: ${money(room)} left${a.ipo.spent ? ` · ${money(a.ipo.spent)} taken` : ''}. Shares are locked until the window closes; the first move after that can go either way.</div>
    ${room >= 0.05 ? `<div class="prot-row" style="grid-template-columns:1fr auto"><div class="pf"><span>$</span><input id="ipoamt" inputmode="decimal" value="${Math.min(room, Math.max(0.05, room / 2)).toFixed(2)}"></div><button class="btn buy small" data-act="ipobuy">Buy at IPO price</button></div>` : '<div class="small muted">Allocation used.</div>'}
    <div id="ipoerr" class="small down" style="min-height:0"></div></div>`;
}
function reportLine(a) {
  if (a.kind !== 'player' || !a.report) return '';
  const g = a.report.grade;
  return `<div class="card repc"><div class="row between"><div><div class="tiny muted">REPORT CARD</div><b>${g ? `Last grade: <span class="grade g${g}">${g}</span>` : 'No report yet'}</b>${a.report.t ? `<div class="tiny faint">${timeAgo(a.report.t)} · ${a.report.n} games</div>` : ''}</div>
    <div style="text-align:right"><div class="tiny muted">NEXT REPORT</div><b>${a.report.next ? fmtDate(a.report.next) : '—'}</b></div></div>
    <div class="tiny faint" style="margin-top:6px">About every two weeks, graded on his games since the last one plus the analysts' own read. The price reacts when it lands.</div></div>`;
}
// ---------- hall of fame and friend challenge ----------
function pageContests() {
  const done = Object.values(state.contests || {}).filter((c) => c.done).sort((x, y) => (y.settled || y.end) - (x.settled || x.end));
  const fees = done.reduce((t, c) => t + c.fee, 0); const won = done.reduce((t, c) => t + (c.payout || 0), 0);
  const count = (n) => done.filter((c) => c.place === n).length;
  const best = done.slice().sort((x, y) => x.place - y.place || y.payout - x.payout)[0];
  return `${pageHead('Contest history')}
    <div class="grid2" style="margin-top:12px">
      <div class="stat"><div class="k">Entered</div><div class="v">${done.length}</div></div>
      <div class="stat"><div class="k">Profit</div><div class="v ${cls(won - fees)}">${signMoney(won - fees)}</div></div>
      <div class="stat"><div class="k">Podiums</div><div class="v">🥇 ${count(1)} · 🥈 ${count(2)} · 🥉 ${count(3)}</div></div>
      <div class="stat"><div class="k">Best finish</div><div class="v">${best ? `${ordinal(best.place)} <span class="tiny muted">${money(best.payout || 0)}</span>` : '—'}</div></div>
    </div>
    ${done.length ? `<h3>Results</h3><div class="list">${done.map((c) => `<div class="item">${lgTag(c.league)}<div class="grow"><div class="name">${CONTEST_TIERS.find((t) => t.key === c.tier)?.name} · ${ordinal(c.place)} of 6</div>
      <div class="sub">${c.day ? fmtDate(c.day, { weekday: 'short', month: 'short', day: 'numeric' }) : `Week of ${fmtDate(c.entered)}`} · ${c.pts.toFixed(1)} pts</div></div><div class="price ${c.payout > c.fee ? 'up' : c.payout ? '' : 'down'}">${c.payout ? '+' + money(c.payout) : '−' + money(c.fee)}</div></div>`).join('')}</div>`
      : emptyState('slip', 'No finished contests yet', 'Results show up here the day after each contest.')}
    <p class="tiny faint" style="margin:10px 2px">The app keeps about five weeks of contests.</p>`;
}
function pageBets() {
  const done = (state.props || []).filter((b) => b.status !== 'open');
  const real = done.filter((b) => b.status !== 'void');
  const won = real.filter((b) => b.status === 'won');
  const staked = real.reduce((t, b) => t + b.stake, 0); const back = real.reduce((t, b) => t + (b.payout || 0), 0);
  const best = won.slice().sort((x, y) => y.payout - x.payout)[0];
  const days = new Map();
  for (const b of done) { const k = new Date(b.settled || b.t).setHours(0, 0, 0, 0); if (!days.has(k)) days.set(k, []); days.get(k).push(b); }
  return `${pageHead('Bet history')}
    <div class="grid2" style="margin-top:12px">
      <div class="stat"><div class="k">Record</div><div class="v">${won.length}-${real.length - won.length}${real.length ? ` <span class="tiny muted">${Math.round((won.length / real.length) * 100)}%</span>` : ''}</div></div>
      <div class="stat"><div class="k">Profit</div><div class="v ${cls(back - staked)}">${signMoney(back - staked)}</div></div>
      <div class="stat"><div class="k">Staked</div><div class="v">${money(staked)}</div></div>
      <div class="stat"><div class="k">Best hit</div><div class="v up">${best ? money(best.payout) : '—'}</div></div>
    </div>
    ${done.length ? [...days.entries()].sort((x, y) => y[0] - x[0]).map(([k, list]) => { const net = list.reduce((t, b) => t + (b.status === 'void' ? 0 : (b.payout || 0) - b.stake), 0);
      return `<h3>${new Date(k).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} <span class="${cls(net)}" style="float:right;text-transform:none;letter-spacing:0">${signMoney(net)}</span></h3><div class="list">${list.map(betRow).join('')}</div>`; }).join('')
      : emptyState('slip', 'No settled bets yet', 'Bets show up here once their games finish.')}
    <p class="tiny faint" style="margin:10px 2px">The app keeps your last 60 bets.</p>`;
}
function pageHof() {
  const h = updateHof(state);
  const row = (icon, title, val, sub, c = '') => `<div class="driver"><div class="ic">${icon}</div><div class="txt">${title}<div class="tiny faint ellipsis">${sub}</div></div><div class="pct ${c}">${val}</div></div>`;
  return `${pageHead('Hall of fame')}
    <p class="small muted" style="margin:10px 0">Your all-time records. Season resets and fresh starts never clear these.</p>
    <div class="list">
      ${row('🏔️', 'Highest net worth', h.peak ? money(h.peak.v) : '—', h.peak ? fmtDate(h.peak.t, { month: 'short', day: 'numeric', year: 'numeric' }) : '')}
      ${row('💰', 'Biggest winning trade', h.trade ? signMoney(h.trade.pl) : '—', h.trade ? `${esc(h.trade.name)} · ${fmtPct(h.trade.pct, 1)} · ${fmtDate(h.trade.t)}` : 'Sell something for a profit', h.trade ? 'up' : '')}
      ${row('💵', 'Biggest dividend', h.div ? money(h.div.amt) : '—', h.div ? `${esc(h.div.name)} · ${fmtDate(h.div.t)}` : 'Own a player through a big game', h.div ? 'up' : '')}
      ${row('🏅', 'Best season', h.season ? pctTxt(h.season.ret) : '—', h.season ? `Season ${h.season.n} · ${esc(h.season.tier)} · #${h.season.rank} of ${h.season.of}` : 'Finish a season', h.season ? cls(h.season.ret) : '')}
      ${row('📆', 'Seasons played', String(h.seasons || 0), 'completed')}
      ${row('🔥', 'Longest Pick\'em streak', String(h.pick || 0), 'wins in a row')}
      ${row('⚡', 'Longest challenge streak', String(h.challenge || 0), 'daily challenges in a row')}
    </div>
    <h3>Best cards you've held</h3>
    ${h.cards.length ? `<div class="list">${h.cards.map((c) => `<div class="item"><div class="rdot" style="background:${bRarity(c.rarity).color}"></div><div class="grow"><div class="name ellipsis">${esc(c.name)}</div>
      <div class="sub">${bRarity(c.rarity).name} · ${esc(c.kind.toLowerCase())} · rated ${c.rating.toFixed(1)}</div></div><span class="tiny faint">${fmtDate(c.t)}</span></div>`).join('')}</div>` : '<div class="card empty">No moment cards yet.</div>'}`;
}
function duelSection(p) {
  const r = p.code ? duelResult(state, p.code) : null;
  return `<h3>Challenge a friend</h3>
    <div class="card"><div class="small muted">Send a friend your week. They paste it into their StatStreet and see who's ahead. It carries only a name and your 7-day return.</div>
      <label class="price-field" style="margin-top:8px"><span class="small muted">Your name</span><input id="duelname" maxlength="20" value="${esc(state.settings.duelName || '')}" placeholder="${esc(career(state).title)}" style="text-align:right"></label>
      <button class="btn buy" data-act="duelshare" style="width:100%;margin-top:10px">Share my week</button></div>
    <div class="card" style="margin-top:10px"><div class="small muted">Got one from a friend? Paste the link or code.</div>
      <input id="duelin" class="searchbox" style="margin-top:8px" placeholder="Paste here" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(p.code || '')}">
      ${p.code ? (r ? `<div class="vsline" style="margin-top:12px"><span>You <b class="${cls(r.mine)}">${fmtPct(r.mine, 1)}</b></span><span class="faint">vs</span><span>${esc(r.name)} <b class="${cls(r.ret)}">${fmtPct(r.ret, 1)}</b></span></div>
        <div class="small ${r.ahead ? 'up' : 'down'}">${r.ahead ? `You're ahead of ${esc(r.name)} this week.` : `${esc(r.name)} is ahead of you this week.`}${r.stale ? ' <span class="faint">(That code is more than a week old.)</span>' : ''}</div>`
        : '<div class="small down" style="margin-top:8px">That doesn\'t look like a StatStreet challenge code.</div>') : ''}</div>`;
}
async function shareDuel() {
  const name = ($('#duelname')?.value || '').trim();
  state.settings.duelName = name; dirty = true; save();
  const code = duelCode(state, name);
  const w = weeklyRecap(state);
  const url = `${location.origin}${location.pathname}#c=${code}`;
  const text = `I'm ${w.pct >= 0 ? 'up' : 'down'} ${Math.abs(w.pct * 100).toFixed(1)}% this week on StatStreet. Think you can beat that? Paste this into the app (Rival → Challenge a friend): ${url}`;
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text); toast('Copied. Paste it to a friend.'); } catch { toast('Sharing isn\'t available here'); }
}

// ---------- long-press quick actions ----------
function openQuick(id) {
  const a = state.assets[id]; if (!a) return;
  ui.quick = id; buzz();
  const el = $('#qa');
  const watching = state.watch.includes(id); const own = !!state.holdings[id]; const ph = ipoPhase(a);
  el.hidden = false;
  el.innerHTML = `<div class="qa-back" data-qa="close"></div><div class="qa-panel" role="dialog" aria-label="Quick actions for ${esc(a.name)}">
    <div class="row" style="gap:10px;margin-bottom:10px">${avatar(a)}<div class="grow" style="min-width:0"><div class="name ellipsis">${esc(a.name)}</div><div class="sub">${money(a.price)} · <span class="${cls(change(a, Date.now()))}">${fmtPct(change(a, Date.now()))}</span></div></div></div>
    <div class="qa-grid">
      ${ph ? '' : '<button data-qa="buy"><span>🟢</span>Buy</button>'}
      ${own && !ph ? '<button data-qa="sell"><span>🔴</span>Sell</button>' : ''}
      <button data-qa="watch"><span>${watching ? '★' : '☆'}</span>${watching ? 'Unwatch' : 'Watch'}</button>
      ${a.kind !== 'fund' ? '<button data-qa="compare"><span>⇅</span>Compare</button>' : ''}
      <button data-qa="open"><span>📄</span>Open page</button>
    </div></div>`;
}
function closeQuick() { ui.quick = null; const el = $('#qa'); el.hidden = true; el.innerHTML = ''; }
{
  let timer = 0; let sx = 0; let sy = 0;
  const cancel = () => { clearTimeout(timer); timer = 0; };
  document.addEventListener('touchstart', (e) => {
    cancel();
    if (e.touches.length !== 1 || overlayOpen()) return;
    const row = e.target.closest?.('#view [data-open]');
    if (!row || !state.assets[row.dataset.open]) return;
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
    timer = setTimeout(() => { timer = 0; ui.lpHeld = true; ui.lpBuzz = true; openQuick(row.dataset.open); }, 480);
  }, { passive: true });
  document.addEventListener('touchmove', (e) => { if (!timer) return; const t = e.touches[0]; if (Math.abs(t.clientX - sx) > 9 || Math.abs(t.clientY - sy) > 9) cancel(); }, { passive: true });
  // iPhone only plays a web app's haptic from a real tap, so there it fires on the click that
  // follows the press (below); phones that can vibrate directly buzz when the menu opens.
  // The click that follows the finger lifting belongs to the long press, however long it was held.
  document.addEventListener('touchend', () => { cancel(); if (ui.lpHeld) { ui.lpHeld = false; ui.swallowUntil = Date.now() + 450; } }, { passive: true });
  document.addEventListener('touchcancel', () => { cancel(); ui.lpHeld = false; ui.lpBuzz = false; }, { passive: true });
  // The tap that ends a long press must not also open the player page.
  document.addEventListener('click', (e) => {
    if (ui.lpBuzz && !navigator.vibrate) { ui.lpBuzz = false; buzz(); } // the first real tap after the press: the one iPhone will play
    if ((ui.lpHeld || Date.now() < (ui.swallowUntil || 0)) && !e.target.closest('#qa')) { e.stopPropagation(); e.preventDefault(); ui.swallowUntil = 0; return; }
    const b = e.target.closest('[data-qa]'); if (!b) return;
    e.stopPropagation();
    const id = ui.quick; const act = b.dataset.qa;
    closeQuick();
    if (!id || act === 'close') return;
    if (act === 'watch') { const i = state.watch.indexOf(id); if (i >= 0) state.watch.splice(i, 1); else state.watch.unshift(id); dirty = true; save(); buzz(); toast(i >= 0 ? 'Removed from watchlist' : 'Added to watchlist'); const y = view().scrollTop; render(); view().scrollTop = y; return; }
    openDetail(id);
    if (act === 'buy' || act === 'sell') setTimeout(() => openOrder(stockOrderDefaults(act)), 60);
    if (act === 'compare') setTimeout(() => openPage('compare', { a: id, b: null }), 60);
  }, true);
}

// ====================================================================================
// v43: feed, market indicator, about section, dividend calendar, order confirmation
// ====================================================================================

function marketPill() {
  const m = marketStatus(state);
  const label = m.state === 'live' ? 'Market live' : m.state === 'soon' ? 'Opens later' : 'Market quiet';
  // A long message scrolls round and round so all of it can be read. The start point comes from
  // the clock, so redrawing the page doesn't send it back to the beginning.
  const long = m.text.length > 30; const dur = Math.max(8, Math.round(m.text.length * 0.28));
  const txt = long ? `<span class="mq"><span class="mq-in" style="animation-duration:${dur}s;animation-delay:-${((Date.now() / 1000) % dur).toFixed(2)}s"><span>${esc(m.text)}</span><span aria-hidden="true">${esc(m.text)}</span></span></span>` : `<span class="muted">· ${esc(m.text)}</span>`;
  return `<button class="mkt ${m.state}" data-tab="games" aria-label="Market status: ${esc(m.text)}"><span class="dot"></span>${label} ${long ? '<span class="muted">·</span>' : ''}${txt}</button>`;
}
// ---------- about ----------
const bioLoading = new Set();
function loadBio(a) {
  if (STATIC || a.kind !== 'player' || bioLoading.has(a.id) || (a.bio && Date.now() - a.bio.t < 14 * DAY)) return;
  bioLoading.add(a.id);
  api.athlete(a.league, a.rid).then((j) => {
    const b = parseBio(j);
    if (b.facts.length || b.stats.length) { a.bio = { ...b, t: Date.now() }; dirty = true; if (ui.detail === a.id) softRefresh(); }
    else a.bio = { facts: [], stats: [], t: Date.now() - 13 * DAY }; // nothing useful: try again tomorrow
  }).catch(() => { /* optional */ }).then(() => bioLoading.delete(a.id));
}
function aboutSection(a) {
  if (a.kind === 'fund') return '';
  const rows = [];
  if (a.kind === 'player') {
    const team = Object.values(state.assets).find((t) => t.kind === 'team' && t.league === a.league && t.rid === a.teamId);
    rows.push(['Team', team ? team.name : (a.teamAbbr || '—')], ['Position', a.pos || '—']);
    for (const f of a.bio?.facts || []) rows.push(f);
    if (a.perf?.season?.gp) rows.push(['Games this season', String(a.perf.season.gp)]);
    if (a.perf?.prior?.gp) rows.push(['Last season', `${a.perf.prior.gs.toFixed(1)} avg game score in ${a.perf.prior.gp} games`]);
  } else {
    rows.push(['League', LEAGUES[a.league].name], ['Record', a.rec?.gp ? recText(a) : '—']);
    if (a.rec?.gp) rows.push(['Average margin', `${a.rec.diff >= 0 ? '+' : ''}${(a.rec.diff / a.rec.gp).toFixed(1)} a game`], ['Streak', a.rec.streak ? `${a.rec.streak > 0 ? 'Won' : 'Lost'} ${Math.abs(a.rec.streak)}` : '—']);
    if (a.prior) rows.push(['Last season', `${Math.round(a.prior.pct * 100)}% wins`]);
    const { rank, n } = teamRanks(a.league); if (rank.get(a.rid)) rows.push(['Price rank', `#${rank.get(a.rid)} of ${n} teams`]);
    const roster = Object.values(state.assets).filter((p) => p.kind === 'player' && p.league === a.league && p.teamId === a.rid && p.hist.length).sort((x, y) => y.price - x.price).slice(0, 3);
    if (roster.length) rows.push(['Top players', roster.map((p) => p.name.split(' ').slice(-1)[0]).join(', ')]);
  }
  const first = a.hist?.length ? a.hist[0] : null;
  if (first) rows.push(['On StatStreet since', fmtDate(first, { month: 'short', day: 'numeric', year: 'numeric' })]);
  const st = a.bio?.stats || [];
  return `<h3>About</h3>
    ${st.length ? `<div class="grid${st.length >= 3 ? 3 : 2}" style="margin-bottom:10px">${st.slice(0, 3).map(([k, v, r]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${r ? `<div class="tiny faint">${esc(r)}</div>` : ''}</div>`).join('')}</div>` : ''}
    <div class="stats-grid">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
}

// ---------- dividend calendar ----------
function pageDivcal() {
  const now = Date.now();
  const d = dividendCalendar(state, now);
  const days = new Map();
  for (const g of d.rows) { const k = new Date(g.date).toDateString(); if (!days.has(k)) days.set(k, []); days.get(k).push(g); }
  return `${pageHead('Dividend calendar')}
    <div class="grid3" style="margin-top:14px">
      <div class="stat"><div class="k">Likely this week</div><div class="v up">${money(d.expected)}</div></div>
      <div class="stat"><div class="k">Last 30 days</div><div class="v">${money(d.last30)}</div></div>
      <div class="stat"><div class="k">This season</div><div class="v">${money(d.total)}</div></div></div>
    <p class="small muted" style="margin:10px 0">Players pay when they beat their usual game; teams pay when they win. "Typical" is what each holding has paid you per payout lately, and how often it has paid. Nothing here is promised.</p>
    ${d.rows.length ? [...days.entries()].map(([k, list]) => `<h3>${new Date(list[0].date).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}${k === new Date(now).toDateString() ? ' · today' : ''}</h3>
      <div class="list">${list.flatMap((g) => g.holdings.map((h) => `<button class="item" data-open="${h.a.id}">${avatar(h.a)}<div class="grow"><div class="name ellipsis">${esc(h.a.name)}</div>
        <div class="sub">${esc(g.team)} ${g.home ? 'vs' : '@'} ${esc(g.opp)} · ${new Date(g.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div></div>
        <div class="price-col"><div class="price ${h.perPay > 0 ? 'up' : 'muted'}">${h.perPay > 0 ? money(h.perPay) : '—'}</div><div class="tiny muted">${h.games ? `paid ${h.paid} of last ${Math.max(h.games, h.paid)}` : 'no games yet'}${h.boosted ? ' · boosted' : ''}</div></div></button>`)).join('')}</div>`).join('')
      : `<div class="card empty" style="margin-top:14px">${Object.keys(state.holdings).length ? 'Nothing you own plays in the next 7 days.' : 'Own a player or team and their upcoming games and typical payouts show up here.'}</div>`}`;
}

// ---------- order confirmation ----------
function showConfirm(tx, extras) {
  const a = state.assets[tx.id]; const h = state.holdings[tx.id];
  const buy = tx.side === 'buy';
  ui.confirm = true;
  const el = $('#confirm');
  el.hidden = false;
  el.className = `confirm ${buy ? '' : 'sell'}`;
  el.innerHTML = `<div class="cf-in" role="dialog" aria-label="Order filled">
    <div class="cf-check"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l8 8 15-17"/></svg></div>
    <div class="cf-title">${buy ? 'Bought' : 'Sold'} ${esc(tx.ticker)}</div>
    <div class="muted">Order filled</div>
    <div class="card cf-card">
      <div class="brk"><span>Shares</span><b>${fmtQty(tx.qty)}</b></div>
      <div class="brk"><span>Price per share</span><b>${money(tx.price)}</b></div>
      <div class="brk"><span>${buy ? 'Total cost' : 'Total received'}</span><b>${money(tx.total)}</b></div>
      ${tx.pl != null ? `<div class="brk"><span>Profit on this sale</span><b class="${cls(tx.pl)}">${signMoney(tx.pl)}</b></div>` : ''}
      <div class="brk"><span>${h ? 'You now own' : 'Position'}</span><b>${h ? `${fmtQty(h.qty)} sh · ${money(a.price * h.qty)}` : 'Closed'}</b></div>
      <div class="brk"><span>Cash left</span><b>${money(state.cash)}</b></div>
    </div>
    ${extras.length ? `<div class="cf-extras">${extras.map((x) => `<span>${x}</span>`).join('')}</div>` : ''}
    <div class="grow"></div>
    ${buy && h ? '<button class="btn ghost" data-act="confirmprotect" style="width:100%">Add stop-loss or take-profit</button>' : ''}
    <button class="btn buy" data-act="confirmdone" style="width:100%;margin-top:8px">Done</button></div>`;
}
function closeConfirm() { ui.confirm = false; const el = $('#confirm'); el.hidden = true; el.innerHTML = ''; }

// ---------- photos on Iconic cards ----------
// Looked up once per player and remembered. Only photos under a free licence are used,
// with the photographer credited on the card; otherwise the card keeps its drawn art.
const photoLoading = new Set();
function cardPhoto(m) {
  const key = `${m.league}:${m.player.id}`;
  const hit = state.wikiPhotos?.[key];
  if (hit && Date.now() - hit.t < 30 * DAY) return hit.src ? hit : null;
  if (STATIC || photoLoading.has(key)) return null;
  photoLoading.add(key);
  wikiPhoto(m.player.name, m.league).then((ph) => {
    (state.wikiPhotos ||= {})[key] = ph ? { ...ph, t: Date.now() } : { t: Date.now() };
    dirty = true;
    if (!ph) return;
    // Add it to any copies of the card already on screen.
    document.querySelectorAll(`.mc[data-wp="${key}"]`).forEach((el) => {
      if (el.querySelector('.mc-photo')) return;
      const d = document.createElement('div'); d.className = 'mc-photo'; d.style.backgroundImage = `url('${ph.src.replace(/'/g, '%27')}')`;
      el.prepend(d); el.classList.add('has-photo');
      if (!el.classList.contains('mini')) { const c = document.createElement('div'); c.className = 'mc-credit'; c.textContent = `Photo: ${ph.artist} · ${ph.licence} · Wikimedia Commons`; el.append(c); }
    });
  }).catch(() => { /* optional */ }).then(() => photoLoading.delete(key));
  return null;
}

// ---------- live play-by-play on the game screen ----------
const playsCache = new Map(); // game id -> { plays, t, loading, failed }
function loadPlays(league, id, { force = false } = {}) {
  if (STATIC) return;
  const g = findGame(league, id); if (!g || g.status === 'pre') return;
  const c = playsCache.get(id) || {};
  if (c.loading || (!force && c.t && (g.status !== 'live' || Date.now() - c.t < 20e3))) return;
  playsCache.set(id, { ...c, loading: true });
  api.summary(league, id).then((j) => {
    playsCache.set(id, { box: lineups(league, j), plays: parsePlays(league, j), atBat: league === 'mlb' ? parseAtBat(j) : null, sit: league === 'nfl' ? parseSituation(j) : null, drives: league === 'nfl' ? parseDrives(j) : null, bases: league === 'mlb' ? parseBases(j) : null, tstats: parseTeamStats(league, j), t: Date.now(), loading: false });
  }).catch(() => { playsCache.set(id, { ...c, loading: false, failed: !c.plays, t: Date.now() }); })
    .then(() => {
      // Show the new plays as soon as the screen is at rest (never swap content under a finger).
      const show = (tries = 0) => { if (ui.game?.id !== id) return; if ((ui.detail || busyScrolling(500)) && tries < 20) { setTimeout(() => show(tries + 1), 400); return; } const y = $('#game').scrollTop; renderGame(); $('#game').scrollTop = y; };
      show();
    });
}
// While a live game's screen is open, pull new plays every 20 seconds.
setInterval(() => { if (ui.game && !document.hidden) loadPlays(ui.game.league, ui.game.id); }, 20e3);
// The at-bat in progress: each pitch, and where it crossed the plate.
// Football, live: where the ball is on the field, who has it, and the line to gain.
// The away team's goal line is on the left, the home team's on the right.
function fieldBar(g, league) {
  const sit = g.status === 'live' ? playsCache.get(g.id)?.sit : null;
  if (!sit) return '';
  const away = g.teams.find((t) => !t.home) || g.teams[0]; const home = g.teams.find((t) => t !== away) || g.teams[1];
  // Which half the ball is in. Abbreviations differ between feeds (WSH / WAS), so match loosely.
  const sideOf = (abbr) => { for (const n of [9, 2, 1]) { const hit = [away, home].filter((t) => t.abbr && t.abbr.slice(0, n) === abbr.slice(0, n)); if (hit.length === 1) return hit[0]; } return null; };
  const half = sit.side == null ? null : sideOf(sit.side);
  const x = sit.side == null ? 50 : half === home ? 100 - sit.yard : sit.yard;
  const off = sit.poss ? g.teams.find((t) => t.id === sit.poss) : null;
  const dir = off ? (off === away ? 1 : -1) : 0; // the offence drives at the other team's goal line
  const toGo = dir && sit.distance > 0 ? Math.max(0, Math.min(100, x + dir * sit.distance)) : null;
  const pc = (v) => (4 + v * 0.92).toFixed(2); // the bar has a little end zone either side
  const ta = off ? teamAsset(league, off.id) : null;
  return `<div class="field ${sit.red ? 'red' : ''}">
    <div class="fd-top"><span>${off ? `<b>${esc(off.abbr)}</b> ball` : 'Ball'} on the <b>${esc(sit.spot)}</b></span><b>${esc(sit.text)}</b></div>
    <div class="fd-bar">${[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((y) => `<i style="left:${pc(y)}%"></i>`).join('')}
      ${toGo != null ? `<span class="fd-go" style="left:${pc(Math.min(x, toGo))}%;width:${(Math.abs(toGo - x) * 0.92).toFixed(2)}%"></span><span class="fd-line" style="left:${pc(toGo)}%"></span>` : ''}
      <span class="fd-ball" style="left:${pc(x)}%">${ta?.img && !STATIC ? `<img src="${esc(ta.img)}" alt="" onerror="this.outerHTML='${dir > 0 ? '▶' : dir < 0 ? '◀' : '●'}'">` : dir > 0 ? '▶' : dir < 0 ? '◀' : '●'}</span></div>
    <div class="fd-lab"><span style="left:${pc(0)}%">${esc(away.abbr)}</span><span style="left:${pc(20)}%">20</span><span style="left:${pc(50)}%">50</span><span style="left:${pc(80)}%">20</span><span style="left:${pc(100)}%">${esc(home.abbr)}</span></div></div>`;
}
// Baseball, live: runners on base with the count and outs.
function basesCard(g, league) {
  const b = g.status === 'live' ? playsCache.get(g.id)?.bases : null;
  if (!b) return '';
  const base = (on, x, y) => `<rect x="${x - 9}" y="${y - 9}" width="18" height="18" rx="3" transform="rotate(45 ${x} ${y})" class="${on ? 'on' : ''}"/>`;
  const dots = (n, max, c) => Array.from({ length: max }, (_, i) => `<i class="${i < n ? c : ''}"></i>`).join('');
  const bat = b.batter ? state.assets[`${league}:p:${b.batter}`] : null; const pit = b.pitcher ? state.assets[`${league}:p:${b.pitcher}`] : null;
  const on = [b.first && '1st', b.second && '2nd', b.third && '3rd'].filter(Boolean);
  return `<div class="field bases"><svg viewBox="0 0 90 70" class="diamond" role="img" aria-label="${on.length ? `Runners on ${on.join(' and ')}` : 'Bases empty'}">${base(b.second, 45, 16)}${base(b.third, 19, 42)}${base(b.first, 71, 42)}</svg>
    <div class="grow"><div class="fd-top"><span>${on.length ? `Runner${on.length > 1 ? 's' : ''} on <b>${on.join(', ')}</b>` : 'Bases empty'}</span><b>${b.balls}-${b.strikes}</b></div>
      <div class="bso"><span>B<em>${dots(b.balls, 3, 'b')}</em></span><span>S<em>${dots(b.strikes, 2, 's')}</em></span><span>O<em>${dots(b.outs, 2, 'o')}</em></span></div>
      ${bat || pit ? `<div class="tiny muted" style="margin-top:6px">${bat ? `At bat <b style="color:var(--text)">${esc(nameShort(bat.name))}</b>` : ''}${bat && pit ? ' · ' : ''}${pit ? `Pitching <b style="color:var(--text)">${esc(nameShort(pit.name))}</b>` : ''}</div>` : ''}</div></div>`;
}
// Team totals side by side. The longer bar has more; for turnovers and the like, fewer is better.
function teamCompare(g) {
  const rows = g.status !== 'pre' ? playsCache.get(g.id)?.tstats : null;
  if (!rows) return '';
  const away = g.teams.find((t) => !t.home) || g.teams[0]; const home = g.teams.find((t) => t !== away) || g.teams[1];
  const n = (v) => { const m = String(v).match(/-?\d+(\.\d+)?/); const mm = String(v).match(/^(\d+):(\d+)$/); return mm ? Number(mm[1]) * 60 + Number(mm[2]) : m ? Number(m[0]) : 0; };
  return `<h3>Team stats</h3><div class="card tcmp"><div class="tc-head"><b>${esc(away.abbr)}</b><b>${esc(home.abbr)}</b></div>
    ${rows.map(([label, a, h, lowGood]) => { const x = n(a); const y = n(h); const tot = x + y || 1; const aWin = lowGood ? x < y : x > y; const hWin = lowGood ? y < x : y > x;
      return `<div class="tc-row"><b class="${aWin ? 'win' : ''}">${esc(a)}</b><div class="tc-mid"><span>${label}</span><div class="tc-bar"><i class="${aWin ? 'win' : ''}" style="width:${(x / tot) * 100}%"></i><i class="${hWin ? 'win' : ''}" style="width:${(y / tot) * 100}%"></i></div></div><b class="${hWin ? 'win' : ''}">${esc(h)}</b></div>`; }).join('')}</div>`;
}
function atBatCard(ab, league) {
  const bat = ab.batter ? state.assets[`${league}:p:${ab.batter}`] : null; const pit = ab.pitcher ? state.assets[`${league}:p:${ab.pitcher}`] : null;
  const col = { ball: 'var(--up)', strike: 'var(--down)', inplay: '#4cc9ff' };
  const z = ab.zone; const pts = ab.pitches.filter((p) => p.x != null && p.y != null);
  let plot = '';
  if (z && pts.length) {
    // The zone sits in the middle of the plot, with a zone's width of room around it.
    const zw = z.x1 - z.x0; const zh = z.y1 - z.y0; const W = 150; const H = 190;
    const X = (x) => W / 2 + ((x - (z.x0 + z.x1) / 2) / zw) * 62; const Y = (y) => H / 2 + ((y - (z.y0 + z.y1) / 2) / zh) * 78;
    const inb = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    plot = `<svg class="zone" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pitch locations for this at-bat">
      <rect x="${W / 2 - 31}" y="${H / 2 - 39}" width="62" height="78" rx="3" fill="rgba(255,255,255,.05)" stroke="var(--muted)" stroke-width="1.5"/>
      <path d="M${W / 2 - 10.3} ${H / 2 - 39}v78M${W / 2 + 10.3} ${H / 2 - 39}v78M${W / 2 - 31} ${H / 2 - 13}h62M${W / 2 - 31} ${H / 2 + 13}h62" stroke="var(--line)" stroke-width="1"/>
      <path d="M${W / 2 - 22} ${H - 8}h44l-6 -8h-32z" fill="var(--card2)" stroke="var(--line)"/>
      ${pts.map((p) => `<g transform="translate(${inb(X(p.x), 9, W - 9).toFixed(1)} ${inb(Y(p.y), 9, H - 20).toFixed(1)})"><circle r="8" fill="${col[p.kind]}"/><text y="3.5" text-anchor="middle" font-size="10" font-weight="800" fill="#04140b">${p.n}</text></g>`).join('')}</svg>`;
  }
  return `<h3>${ab.done ? 'Last at-bat' : 'At bat now'} <span class="faint" style="text-transform:none;letter-spacing:0;font-weight:500">${esc(ab.sit)}${ab.done ? '' : ` · count ${ab.count}`}</span></h3>
    <div class="card atbat">
      <div class="row" style="gap:10px">${bat ? `<button data-open="${bat.id}" class="row" style="gap:10px;min-width:0;text-align:left">${avatar(bat)}<div style="min-width:0"><div class="name ellipsis">${esc(bat.name)}</div><div class="tiny muted">Batting${pit ? ` · vs ${esc(pit.name)}` : ''}</div></div></button>` : `<div class="tiny muted">${pit ? `Pitching: ${esc(pit.name)}` : 'Current batter'}</div>`}</div>
      ${ab.done && ab.result ? `<div class="ab-res">${esc(ab.result)}</div>` : ''}
      <div class="ab-body ${plot ? '' : 'noplot'}"><div class="ab-list">${ab.pitches.slice().reverse().map((p) => `<div class="ab-p"><span class="ab-n" style="background:${col[p.kind]}">${p.n}</span><div><div class="ab-call">${esc(p.call)}</div>
        <div class="tiny muted">${esc([p.type, p.mph ? `${p.mph.toFixed(1)} mph` : ''].filter(Boolean).join(' · '))}</div></div></div>`).join('')}</div>${plot}</div>
      ${plot ? '<div class="tiny faint" style="margin-top:6px">Box: the strike zone, placed from this game\'s called strikes.</div>' : ''}</div>`;
}
function playsSection(g, league) {
  if (g.status === 'pre') return '';
  const c = playsCache.get(g.id);
  if (!c?.plays) return `<h3>Play by play</h3>${c?.failed ? '<div class="card small muted">Plays aren\'t available for this game.</div>' : '<div class="card skel-lines"><i></i><i></i><i></i><i></i><i></i></div>'}`;
  if (!c.plays.length) return '';
  const [away, home] = [g.teams.find((t) => !t.home) || g.teams[0], g.teams.find((t) => t.home) || g.teams[1]];
  const show = ui.playsAll === g.id ? c.plays : c.plays.slice(0, 25);
  const now = Date.now();
  // Who was involved: the players the feed tags, else names read out of the text ("D.Jones").
  const roster = Object.values(state.assets).filter((a) => a.kind === 'player' && a.league === league && g.teams.some((t) => t.id === a.teamId));
  const byName = (ini, lastName) => roster.find((a) => { const parts = a.name.replace(/\s+(Jr|Sr|II|III|IV)\.?$/i, '').split(/\s+/); return parts[parts.length - 1].toLowerCase() === lastName.toLowerCase() && a.name[0].toLowerCase() === ini.toLowerCase(); });
  const involved = (p) => {
    const out = [];
    const add = (a) => { if (a && !out.includes(a)) out.push(a); };
    add(p.pid ? state.assets[`${league}:p:${p.pid}`] : null);
    for (const id of p.pids || []) add(state.assets[`${league}:p:${id}`]);
    if (out.length < 2) for (const m of p.text.matchAll(/\b([A-Z])\.\s?([A-Z][A-Za-z'\-]+)/g)) add(byName(m[1], m[2]));
    if (out.length < 2 && league !== 'nfl') for (const a of roster) if (p.text.includes(a.name)) add(a);
    // The man the headline is about comes first: the receiver on a catch, the tackler on a sack.
    const lead = /catch/.test(p.head) ? p.text.match(/\bto ([A-Z])\.\s?([A-Z][A-Za-z'\-]+)/) : /sack/i.test(p.head) ? p.text.match(/\(([A-Z])\.\s?([A-Z][A-Za-z'\-]+)/) : null;
    const first = lead ? byName(lead[1], lead[2]) : null;
    if (first) { out.splice(out.indexOf(first) >= 0 ? out.indexOf(first) : out.length, 1); out.unshift(first); }
    return out.slice(0, 2);
  };
  const shortName = (a) => { const parts = a.name.split(/\s+/); return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : a.name; };
  // Basketball scores on most plays, so its summary keeps to the big ones.
  const scoring = c.plays.filter((p) => p.scoring && p.value > 0 && (league !== 'nba' || p.big)).slice().reverse();
  const summary = scoring.length ? `<h3>Scoring summary</h3><div class="card ssum">${scoring.map((p) => { const who = involved(p)[0];
    return `<div class="ss-row"><span class="tiny muted">${esc(p.sit.split(' · ').slice(0, 2).join(' '))}</span><span class="grow ellipsis"><b>${esc(p.big || p.head || p.text)}</b>${who ? ` <span class="muted">${esc(shortName(who))}</span>` : ''}</span><b class="sc">${p.away != null ? `${p.away}–${p.home}` : `+${p.value}`}</b></div>`; }).join('')}</div>` : '';
  const drives = league === 'nfl' && c.drives?.length ? `<h3>Drives</h3><div class="list drives">${c.drives.slice(0, ui.playsAll === g.id ? 99 : 8).map((d) => `<details class="drive ${d.scoring ? 'sc' : ''}"><summary><b>${esc(d.team)}</b><span class="grow ellipsis">${esc(d.desc)}</span><span class="res ${d.scoring ? 'up' : d.live ? '' : 'muted'}">${d.live ? '<span class="tag live">LIVE</span>' : esc(d.result)}</span></summary>
    <div class="dplays">${d.plays.map((t) => `<span>${esc(t)}</span>`).join('')}</div></details>`).join('')}</div>` : '';
  return `${g.status === 'live' && c.atBat ? atBatCard(c.atBat, league) : ''}${summary}${drives}
    <h3>Play by play ${g.status === 'live' ? '<span class="tag live" style="margin-left:6px">LIVE</span>' : ''}</h3>
    <div class="list pbp">${show.map((p) => {
      const who = involved(p); const a = who[0];
      return `<${a ? `button data-open="${a.id}"` : 'div'} class="pb ${p.scoring ? 'sc' : ''} ${p.big ? 'big' : ''} ${who.some((x) => state.holdings[x.id]) ? 'mine' : ''}">
        ${a ? avatar(a) : `<div class="avatar-fallback pb-dot">${p.scoring ? '★' : esc(p.team || '•')}</div>`}
        <div class="grow" style="min-width:0"><div class="pb-sit ellipsis">${p.away != null && p.home != null ? `<b>${esc(away.abbr)} ${p.away}-${p.home} ${esc(home.abbr)}</b> · ` : ''}${esc(p.sit)}${p.t ? ` · ${timeAgo(p.t)}` : ''}</div>
          <div class="pb-text">${p.big ? '<span class="bigtag">BIG PLAY</span>' : ''}${esc(p.big || p.head || p.text)}</div>
          ${a ? `<div class="pb-who"><span>${esc(shortName(a))}</span>${state.holdings[a.id] ? ' <span class="tag own">Owned</span>' : ''}</div>` : ''}
          ${who[1] ? `<div class="pb-who2">${esc(shortName(who[1]))}</div>` : ''}</div>
        ${p.scoring ? `<div class="pb-pts">+${p.value || ''}</div>` : ''}</${a ? 'button' : 'div'}>`; }).join('')}</div>
    ${c.plays.length > 25 && ui.playsAll !== g.id ? `<button class="more" data-act="playsall">Show all ${c.plays.length} plays</button>` : ''}`;
}

// ---------- card tilt ----------
// Legendary and Iconic foil follows the phone as you tilt it. iPhone asks for permission
// once, and only from a tap, so the first time you open one of those cards it asks.
const setTilt = (x, y) => { const s = document.documentElement.style; s.setProperty('--tx', Math.max(-1, Math.min(1, x)).toFixed(3)); s.setProperty('--ty', Math.max(-1, Math.min(1, y)).toFixed(3)); };
let tiltOn = false;
function startTilt() {
  if (tiltOn || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const listen = () => { tiltOn = true; document.documentElement.classList.add('tilt');
    window.addEventListener('deviceorientation', (e) => { if (e.gamma == null) return; setTilt(e.gamma / 28, ((e.beta ?? 45) - 45) / 28); }, { passive: true }); };
  try {
    const D = window.DeviceOrientationEvent;
    if (!D) return;
    if (typeof D.requestPermission === 'function') { if (state.settings.tiltAsked === 'denied') return; D.requestPermission().then((r) => { state.settings.tiltAsked = r; dirty = true; if (r === 'granted') listen(); }).catch(() => { /* not from a tap */ }); }
    else listen();
  } catch { /* no motion sensor */ }
}
// Dragging a finger across a card moves the foil too.
document.addEventListener('pointermove', (e) => { const c = e.target.closest?.('.mc.r-legendary, .mc.r-iconic'); if (!c || tiltOn) return; const b = c.getBoundingClientRect(); document.documentElement.classList.add('tilt'); setTilt(((e.clientX - b.left) / b.width - 0.5) * 2, ((e.clientY - b.top) / b.height - 0.5) * 2); }, { passive: true });

// ====================================================================================
// v55: Scores (every game, any day) and the game centre tabs (props, feed, both teams)
// ====================================================================================

const dayStart = (t) => new Date(t).setHours(0, 0, 0, 0);
const etYmd = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
const sbCache = new Map();   // "league:dayStart" -> { t, events, loading }
const sbGames = new Map();   // game id -> { league, ev } for games opened from the Scores page

// One league's games on one local day, straight from the scoreboard. A local day can span
// two US dates, so both are asked for and the games filtered to the day.
function loadScores(league, day) {
  if (STATIC) return;
  const key = `${league}:${day}`;
  const c = sbCache.get(key) || {};
  const today = day === dayStart(Date.now());
  if (c.loading || (c.t && Date.now() - c.t < (today ? 45e3 : 10 * 60e3))) return;
  sbCache.set(key, { ...c, loading: true });
  const dates = [...new Set([etYmd(day), etYmd(day + DAY - 1)])];
  Promise.all(dates.map((d) => api.scoreboard(league, d).then((j) => parseScoreboard(league, j)).catch(() => null))).then((res) => {
    if (res.every((x) => !x)) { sbCache.set(key, { ...c, loading: false, t: Date.now() - (today ? 30e3 : 9 * 60e3) }); return; }
    const seen = new Set(); const events = [];
    for (const ev of res.flat().filter(Boolean)) { if (seen.has(ev.id) || dayStart(ev.date) !== day) continue; seen.add(ev.id); events.push(ev); sbGames.set(ev.id, { league, ev }); }
    events.sort((x, y) => x.date - y.date);
    sbCache.set(key, { t: Date.now(), events, loading: false });
    const show = (tries = 0) => { if (ui.tab !== 'games' || ui.gtab !== 'pickem' || overlayOpen()) return; if (busyScrolling(500) && tries < 10) { setTimeout(() => show(tries + 1), 400); return; } const y = view().scrollTop; const x = $('.daystrip')?.scrollLeft; renderGames(); view().scrollTop = y; if ($('.daystrip') && x != null) $('.daystrip').scrollLeft = x; };
    show();
  });
}
// What the app already knows about a day (used until the scoreboard answers, and offline).
function knownGames(league, day) {
  const out = [];
  for (const [id, g] of Object.entries(state.liveGames)) if (g.league === league && day === dayStart(Date.now())) out.push({ id, date: Date.now(), state: 'in', detail: g.detail, name: g.name, teams: g.teams });
  for (const r of state.results || []) if (r.league === league && dayStart(r.date) === day && !out.some((x) => x.id === r.id)) out.push({ id: r.id, date: r.date, state: 'post', detail: 'Final', name: r.name, teams: r.teams, preseason: r.preseason });
  for (const s of state.schedule?.[league] || []) if (dayStart(s.date) === day && !out.some((x) => x.id === s.id)) out.push({ id: s.id, date: s.date, state: 'pre', name: s.name, teams: s.teams, preseason: s.preseason });
  return out.sort((x, y) => x.date - y.date);
}
function scoreCard(ev, league, now) {
  const away = ev.teams.find((t) => !t.home) || ev.teams[0]; const home = ev.teams.find((t) => t !== away) || ev.teams[1];
  if (!away || !home) return '';
  const live = ev.state === 'in'; const fin = ev.state === 'post';
  const pk = state.picks[ev.id];
  const row = (t, o) => { const ta = teamAsset(league, t.id); const won = fin && (t.winner || (t.score ?? 0) > (o.score ?? 0));
    return `<div class="sg-team ${fin && !won ? 'lost' : ''}">${ta?.img || !t.logo ? (ta ? avatar(ta) : `<div class="avatar-fallback">${esc(t.abbr || '')}</div>`) : `<img class="avatar team" src="${esc(t.logo)}" loading="lazy" alt="">`}<div class="grow"><b>${esc(t.abbr || '')}</b>${ta?.rec?.gp ? `<span class="tiny muted">${recText(ta)}</span>` : ''}</div>
      ${live || fin ? `<span class="sg-score">${t.score ?? ''}</span>` : ''}</div>`; };
  const pAway = !fin ? winProb(state, league, away.id, home.id, false, !!ev.preseason) : null;
  const fav = pAway != null ? (pAway >= 0.5 ? [away.abbr, pAway] : [home.abbr, 1 - pAway]) : null;
  const mine = [away, home].some((t) => Object.keys(state.holdings).some((id) => { const a = state.assets[id]; return a && a.league === league && a.kind !== 'fund' && (a.kind === 'team' ? a.rid : a.teamId) === t.id; }));
  const tint = away.color && home.color ? ` style="--ca:#${away.color};--ch:#${home.color}"` : '';
  return `<button class="sgame ${live ? 'live' : ''} ${tint ? 'tint' : ''}"${tint} data-game="${league}|${ev.id}">
    <div class="sg-teams">${row(away, home)}${row(home, away)}</div>
    <div class="sg-side">${live ? `<span class="tag live">LIVE</span><div class="small">${esc(ev.detail || '')}</div>` : fin ? '<div class="sg-time">Final</div>' : `<div class="sg-time">${whenText(ev.date)}</div>`}
      ${fav && !fin && teamAsset(league, away.id) ? `<div class="tiny muted">${esc(fav[0])} ${Math.round(fav[1] * 100)}%</div>` : ''}
      ${ev.preseason ? '<div class="tiny faint">Preseason</div>' : ''}
      <div class="sg-tags">${pk ? `<span class="pk ${pk.result === 'won' ? 'won' : pk.result === 'lost' ? 'lost' : ''}">Pick ${esc(pk.abbr)}</span>` : ''}${mine ? '<span class="tag own">Yours</span>' : ''}</div></div></button>`;
}
// A game you have something riding on: shares, a pick or a bet.
function isMineGame(league, ev) {
  if (state.picks[ev.id] || (state.props || []).some((b) => b.status === 'open' && b.legs.some((l) => l.gameId === ev.id))) return true;
  const ids = new Set(ev.teams.map((t) => t.id));
  return Object.keys(state.holdings).some((id) => { const a = state.assets[id]; return a && a.league === league && a.kind !== 'fund' && ids.has(a.kind === 'team' ? a.rid : a.teamId); });
}
// The Scores page: every game on any day, for one league or all of them, with Pick'em built in.
function gamesScores() {
  const now = Date.now();
  const lgs = enabledLeagues();
  if (ui.scoreLeague !== 'all' && !lgs.includes(ui.scoreLeague)) ui.scoreLeague = lgs.length > 1 ? 'all' : lgs[0];
  const sel = ui.scoreLeague === 'all' ? lgs : [ui.scoreLeague];
  const today = dayStart(now);
  ui.scoreDay ??= today;
  const day = ui.scoreDay;
  const days = Array.from({ length: 12 }, (_, i) => new Date(today).setDate(new Date(today).getDate() + i - 3));
  const pickable = new Map(upcomingPickGames(state, now, sel).map((g) => [g.id, g]));
  const ps = state.pickStats;
  const nextPick = pickable.size ? dayStart(Math.min(...[...pickable.values()].map((g) => g.date))) : null;
  const eventsOf = (l, d) => sbCache.get(`${l}:${d}`)?.events || knownGames(l, d);
  const has = (d) => sel.some((l) => eventsOf(l, d).length > 0);
  let loading = false; let total = 0;
  const blocks = sel.map((l) => {
    loadScores(l, day);
    const c = sbCache.get(`${l}:${day}`);
    if (c?.loading && !c.events || (!c && !STATIC)) loading = true;
    const events = eventsOf(l, day).filter((ev) => !ui.scoreMine || isMineGame(l, ev));
    total += events.length;
    if (!events.length) return '';
    return `${sel.length > 1 ? `<h3 class="lgh">${lgTag(l)} <span class="faint">${events.length} game${events.length > 1 ? 's' : ''}</span></h3>` : ''}
      ${events.map((ev) => (pickable.has(ev.id) && ev.state !== 'in' && ev.state !== 'post' ? pickGame(pickable.get(ev.id)) : scoreCard(ev, l, now))).join('')}`;
  }).join('');
  const dayTxt = new Date(day).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const liveDot = (l) => (Object.values(state.liveGames).some((g) => (l === 'all' ? lgs.includes(g.league) : g.league === l)) ? ' <span class="livedot"></span>' : '');
  return `
    <div class="chips tight" style="margin-top:4px">${lgs.length > 1 ? `<button class="chip ${ui.scoreLeague === 'all' ? 'on' : ''}" data-sleague="all">All${liveDot('all')}</button>` : ''}${lgs.map((l) => `<button class="chip ${ui.scoreLeague === l ? 'on' : ''}" data-sleague="${l}">${LEAGUES[l].name}${liveDot(l)}</button>`).join('')}<button class="chip mine ${ui.scoreMine ? 'on' : ''}" data-act="scoremine" aria-label="My games">★ Mine</button></div>
    <div class="hscroll daystrip">${days.map((d) => `<button class="dayb ${d === day ? 'on' : ''} ${d === today ? 'today' : ''}" data-sday="${d}"><span>${d === today ? 'Today' : new Date(d).toLocaleDateString([], { weekday: 'short' })}</span><b>${new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' })}</b>${has(d) ? '<i></i>' : ''}</button>`).join('')}</div>
    ${total ? `<div class="sgames">${blocks}</div>` : loading ? skelCards(3)
      : emptyState('cal', ui.scoreMine ? 'None of your games' : 'No games', ui.scoreMine ? `Nothing you own, picked or bet on plays on ${dayTxt}.` : `Nothing ${sel.length === 1 ? `in the ${LEAGUES[sel[0]].name} ` : ''}on ${dayTxt}. Swipe to another day.`)}
    <div class="card pkline"><div class="grow"><b>Pick'em</b> <span class="muted">${ps.w}-${ps.l}${ps.streak ? ` · 🔥 ${ps.streak} in a row` : ''}</span><div class="tiny muted">Pick winners on today's and tomorrow's games for free. Underdogs pay more, and each win in a row adds 10%.</div></div>${nextPick != null && nextPick !== day ? `<button class="chip on" data-sday="${nextPick}">Pick ${nextPick === today ? 'today' : new Date(nextPick).toLocaleDateString([], { weekday: 'short' })} ›</button>` : `<b class="up">${money(ps.won || 0)}</b>`}</div>`;
}

// ---------- game centre tabs ----------
// Starters and bench from the box score once a game is under way.
function lineups(league, json) {
  const starters = new Set();
  for (const side of json?.boxscore?.players || []) for (const cat of side.statistics || []) for (const row of cat.athletes || []) if (row.starter && row.athlete?.id != null) starters.add(String(row.athlete.id));
  return { players: parseBoxScore(league, json), starters };
}
function gameProps(g, league) {
  const now = Date.now();
  const board = g.status !== 'final' ? propBoard(state, now, [league], { perGame: 14 }).filter((p) => p.gameId === g.id) : [];
  const slip = (ui.slip ||= { legs: [], stake: '' });
  const mine = (state.props || []).filter((b) => b.legs.some((l) => l.gameId === g.id));
  const groups = new Map();
  for (const p of board) { if (!groups.has(p.label)) groups.set(p.label, []); groups.get(p.label).push(p); }
  return `${mine.length ? `<h3>Your bets on this game</h3><div class="list">${mine.map(betRow).join('')}</div>` : ''}
    ${board.length ? `${[...groups.entries()].map(([label, list]) => `<h3>${esc(label)}</h3><div class="card props-game">${list.map((p) => propRow(p, `${state.assets[p.assetId].teamAbbr || ''} · ${state.assets[p.assetId].pos || ''}`)).join('')}</div>`).join('')}
      <p class="tiny faint" style="margin:8px 2px">A hit pays ${PROP_ODDS}x your stake. ${g.status === 'live' ? 'Live lines move with the game.' : "Lines come from each player's season average."}</p>
      ${slipCard(true)}`
      : `<div class="card small muted" style="margin-top:12px">${g.status === 'pre' ? 'Player props for this game open two days before it starts.' : g.status === 'live' ? 'No live lines right now. They close for the final stretch of the game.' : 'This game is over.'}</div>`}`;
}
const formTone = (v) => (v >= 5 ? 'hi' : v >= 2 ? 'mid' : 'lo');
// A player's current form in a circle, against players at his position. Green is hot, orange middling, red cold.
const SPAN_LABEL = { '7d': '7 days', '30d': '30 days' };
function formDot(a, size = '') {
  // His average game rating over the last 7 days; failing that the last 30, then the season.
  const f = playerRating(a);
  if (!f) return '';
  return `<span class="formdot ${size} ${formTone(f.avg)}" aria-label="Average rating ${f.rating.toFixed(1)} over ${f.n} game${f.n > 1 ? 's' : ''}">${f.rating.toFixed(1)}</span>`;
}
// The best three players of the game so far, by game score.
function topPerformers(g, league) {
  if (g.status === 'pre') return '';
  const box = playsCache.get(g.id)?.box?.players;
  const rows = (box ? box.map((p) => ({ a: state.assets[`${league}:p:${p.id}`], gs: gameScore(league, p.line), text: lineText(league, p.line), line: p.line }))
    : gamePlayers(state, league, g.id).map((x) => ({ a: x.a, gs: x.gs ?? x.a.live?.ema ?? 0, text: x.text, line: x.a.live?.e === g.id ? x.a.live.line : x.a.perf?.last?.find((y) => y.e === g.id)?.line }))).filter((x) => x.a && x.text).sort((x, y) => y.gs - x.gs).slice(0, 3);
  if (!rows.length) return '';
  const now = Date.now();
  return `<h3>Top performers</h3><div class="hscroll tops">${rows.map(({ a, text, line }, i) => `<button class="top" data-open="${a.id}"><span class="rk">${i + 1}</span><span class="tr">${line ? rtgChip(gameRating(state, a, { line })) : ''}</span>${avatar(a)}<div class="name ellipsis">${esc(a.name)}</div><div class="tiny muted">${esc(text)}</div><div class="small ${cls(change(a, now))}">${money(a.price)} ${fmtPct(change(a, now))}</div></button>`).join('')}</div>`;
}
// 2: a proper stat grid for one team, starters first.
const BOX_COLS = {
  nba: [['Players', () => true, [['MIN', 'min'], ['PTS', 'pts'], ['REB', 'reb'], ['AST', 'ast'], ['STL', 'stl'], ['BLK', 'blk'], ['FG', (l) => `${l.fgm}-${l.fga}`], ['TO', 'to']]]],
  nfl: [['Passing', (l) => l.att > 0, [['C/ATT', (l) => `${l.cmp}/${l.att}`], ['YDS', 'passYds'], ['TD', 'passTD'], ['INT', 'int']]],
    ['Rushing', (l) => l.car > 0, [['CAR', 'car'], ['YDS', 'rushYds'], ['TD', 'rushTD']]],
    ['Receiving', (l) => l.rec > 0, [['REC', 'rec'], ['YDS', 'recYds'], ['TD', 'recTD']]],
    ['Defense', (l) => l.tkl > 0 || l.sacks > 0 || l.defInt > 0 || l.fr > 0 || l.qbh > 0, [['TKL', 'tkl'], ['SCK', 'sacks'], ['TFL', 'tfl'], ['QBH', 'qbh'], ['INT', 'defInt'], ['PD', 'pd'], ['FR', 'fr']]],
    ['Kicking', (l) => l.fg > 0 || l.xp > 0 || l.fga > 0 || l.xpa > 0, [['FG', (l) => `${l.fg}/${Math.max(l.fga || 0, l.fg)}`], ['XP', (l) => `${l.xp}/${Math.max(l.xpa || 0, l.xp)}`], ['PTS', (l) => 3 * l.fg + l.xp]]]],
  mlb: [['Batting', (l) => l.ab > 0 || l.bb > 0, [['AB', 'ab'], ['H', 'h'], ['R', 'r'], ['RBI', 'rbi'], ['HR', 'hr'], ['BB', 'bb'], ['K', 'k']]],
    ['Pitching', (l) => l.ip > 0, [['IP', 'ip'], ['H', 'ph'], ['ER', 'er'], ['BB', 'pbb'], ['K', 'pk']]]],
};
const rtgChip = (v) => `<span class="rtgc ${formTone(v)}">${v.toFixed(1)}</span>`;
// What a player's price has done over this one game: from just before it started to now
// (or to just after it ended).
function gameChange(a, g) {
  const now = Date.now();
  const start = g.date || now - 3 * HOUR;
  const p0 = priceAt(a, start - 10 * 60e3);
  const p1 = g.status === 'live' ? a.price : priceAt(a, Math.min(now, start + ((LEAGUES[a.league]?.gameHours || 3) + 1) * HOUR));
  return p0 > 0 && p1 > 0 ? p1 / p0 - 1 : 0;
}
// "Jonathan Taylor" → "J. Taylor" (suffixes kept: "M. Harris II").
const nameShort = (n) => { const p = String(n).trim().split(/\s+/); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : n; };
function boxTable(league, rows, g) {
  const val = (l, k) => { const v = typeof k === 'function' ? k(l) : l[k]; return typeof v === 'number' ? Math.round(v * 10) / 10 : (v ?? ''); };
  return (BOX_COLS[league] || []).map(([title, has, cols]) => {
    const xs = rows.filter((x) => has(x.p.line)).sort((x, y) => (!!state.holdings[y.a.id] - !!state.holdings[x.a.id]) || (y.st - x.st) || (gameScore(league, y.p.line) - gameScore(league, x.p.line)));
    if (!xs.length) return '';
    return `<h3>${title}</h3><div class="boxwrap"><table class="box"><tr><th>Player</th><th>RTG</th><th>Game</th>${cols.map(([h]) => `<th>${h}</th>`).join('')}<th>Price</th></tr>
      ${xs.map(({ p, a, st }) => `<tr data-open="${a.id}" class="${st ? 'st' : ''} ${state.holdings[a.id] ? 'mine' : ''}"><td><b>${esc(nameShort(a.name))}</b> <span class="tiny faint">${esc(a.pos || '')}</span>${state.holdings[a.id] ? ' <span class="tag own">✓</span>' : ''}</td><td class="rtg">${rtgChip(gameRating(state, a, { line: p.line }))}</td><td class="chg ${cls(gameChange(a, g))}">${fmtPct(gameChange(a, g))}</td>${cols.map(([, k]) => `<td>${val(p.line, k)}</td>`).join('')}<td class="px">${money(a.price)}</td></tr>`).join('')}</table></div>`;
  }).join('');
}
function teamTab(g, league, t) {
  const now = Date.now();
  const ta = teamAsset(league, t.id);
  const c = playsCache.get(g.id);
  const box = c?.box ? c.box.players.filter((p) => p.teamId === t.id) : [];
  const head = ta ? `<button class="item card" data-open="${ta.id}" style="margin-top:12px">${avatar(ta)}<div class="grow"><div class="name">${esc(ta.name)}</div><div class="sub">${recText(ta)}${ta.rec?.streak ? ` · ${ta.rec.streak > 0 ? 'W' : 'L'}${Math.abs(ta.rec.streak)}` : ''}</div></div>
      <div class="price-col"><div class="price" data-p="${ta.id}">${money(ta.price)}</div><div class="small ${cls(change(ta, now))}" data-c="${ta.id}" data-plain="1">${fmtPct(change(ta, now))}</div></div></button>` : '';
  const row = (a, sub, tag = '') => `<button class="item" data-open="${a.id}">${avatar(a)}<div class="grow"><div class="name ellipsis">${esc(a.name)} <span class="tiny faint">${esc(a.pos || '')}</span>${state.holdings[a.id] ? ' <span class="tag own">Owned</span>' : ''}${tag}</div>
      <div class="sub ellipsis">${sub}</div></div>${formDot(a)}<div class="price-col"><div class="price" data-p="${a.id}">${money(a.price)}</div><div class="small ${cls(change(a, now))}" data-c="${a.id}" data-plain="1">${fmtPct(change(a, now))}</div></div></button>`;
  const inj = (a) => (a.injury && !/^active$/i.test(a.injury.status || '') ? ` <span class="tag inj">${esc(shortInj(a.injury.status))}</span>` : '');
  if (box.length) {
    const rows = box.map((p) => ({ p, a: state.assets[`${league}:p:${p.id}`], st: c.box.starters.has(p.id) })).filter((x) => x.a);
    return `${head}${boxTable(league, rows, g)}${rows.some((x) => x.st) ? '<p class="tiny faint" style="margin:8px 2px">Starters are listed first, in bold. Tap a player to open him.</p>' : ''}
      ${!rows.length ? '<div class="card empty" style="margin-top:12px">No box score yet.</div>' : ''}`;
  }
  // Before the game: the team's players in your market, best first, with their season averages.
  const roster = Object.values(state.assets).filter((a) => a.kind === 'player' && a.league === league && a.teamId === t.id && a.hist.length).sort((x, y) => y.price - x.price).slice(0, 24);
  const r1 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10) / 10 : v]));
  const avgLine = (a) => { try { const s = a.perf?.avg ? lineText(league, r1(a.perf.avg)) : ''; return s && !/^0|NaN/.test(s) ? esc(s) : ''; } catch { return '—'; } };
  return `${head}<h3>${g.status === 'pre' ? 'Likely lineup' : 'Players'} <span class="faint" style="text-transform:none;letter-spacing:0;font-weight:500">season averages</span></h3>
    ${roster.length ? `<div class="list">${roster.map((a) => row(a, avgLine(a), inj(a))).join('')}</div>` : '<div class="card empty">No players from this team in your market yet.</div>'}
    ${g.status === 'pre' ? '<p class="tiny faint" style="margin:8px 2px">Confirmed starters and live stat lines appear here once the game begins.</p>' : ''}`;
}

// Switch the game screen's tab. dir (-1 / 1) slides the new tab in from that side.
function setGview(k, dir = 0) {
  ui.gview = k;
  document.querySelectorAll('#game .gsec').forEach((x) => { x.hidden = x.dataset.gsec !== k; x.classList.remove('from-l', 'from-r'); if (!x.hidden && dir) { void x.offsetWidth; x.classList.add(dir > 0 ? 'from-r' : 'from-l'); } });
  document.querySelectorAll('#game .gtabs button').forEach((b) => b.classList.toggle('on', b.dataset.gview === k));
  if (k !== 'summary' && ui.game) loadPlays(ui.game.league, ui.game.id);
}
// On the Scores page, swipe left or right anywhere to move to the next or previous day.
function shiftScoreDay(step) {
  const btns = [...document.querySelectorAll('.daystrip .dayb')]; const i = btns.findIndex((x) => x.classList.contains('on')) + step;
  if (i < 0 || i >= btns.length) return false;
  ui.scoreDay = +btns[i].dataset.sday; buzz();
  renderGames(); view().scrollTop = Math.min(view().scrollTop, $('.daystrip')?.offsetTop ?? 0);
  $('.dayb.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  const g = $('.sgames') || $('#view .card.empty'); if (g) g.classList.add(step > 0 ? 'from-r' : 'from-l');
  return true;
}
(() => {
  const el = view(); let sx = 0; let sy = 0; let lx = 0; let ly = 0; let ok = false;
  const here = () => ui.tab === 'games' && ui.gtab === 'pickem' && !overlayOpen();
  el.addEventListener('touchstart', (e) => { const t = e.touches[0]; ok = e.touches.length === 1 && here() && !e.target.closest('input, textarea, .hscroll, .chips'); sx = lx = t.clientX; sy = ly = t.clientY; }, { passive: true });
  el.addEventListener('touchmove', (e) => { const t = e.touches[0]; lx = t.clientX; ly = t.clientY; }, { passive: true });
  const end = () => {
    if (!ok || !here()) return; ok = false;
    const dx = lx - sx; const dy = ly - sy;
    if (Math.abs(dx) < 50 || Math.abs(dx) < 1.3 * Math.abs(dy)) return;
    if (shiftScoreDay(dx < 0 ? 1 : -1)) ui.swallowUntil = Date.now() + 350; // the lift after a swipe is not a tap
  };
  el.addEventListener('touchend', end, { passive: true }); el.addEventListener('touchcancel', end, { passive: true });
})();
// The slim score bar shows once the big scoreboard has scrolled off the top.
$('#game').addEventListener('scroll', () => {
  const el = $('#game'); const head = el.querySelector('.gc-head'); const pin = el.querySelector('.gpin');
  if (!head || !pin) return;
  // Pinned only once the bar has actually reached the top of the screen and stuck there.
  el.classList.toggle('pinned', pin.getBoundingClientRect().top <= el.getBoundingClientRect().top + 1);
}, { passive: true });
// Swipe a player or team row: left adds it to (or drops it from) your watchlist, right opens Buy.
(() => {
  const el = view(); let row = null; let sx = 0; let sy = 0; let dx = 0; let on = null;
  let bg = null;
  const reset = () => {
    if (row) { row.style.transition = 'transform .18s'; row.style.transform = ''; const r = row; const b = bg; setTimeout(() => { r.style.transition = ''; r.classList.remove('swiping'); b?.remove(); }, 200); }
    row = null; bg = null; on = null; dx = 0;
  };
  // The panel behind the row: green "Buy" on a swipe right, gold "Watch" on a swipe left.
  const paint = () => {
    if (!bg) { bg = document.createElement('div'); bg.className = 'swipe-bg'; row.parentNode.style.position = 'relative'; bg.style.top = `${row.offsetTop}px`; bg.style.height = `${row.offsetHeight}px`; row.parentNode.insertBefore(bg, row); row.classList.add('swiping'); }
    const right = dx > 0; const armed = Math.abs(dx) >= 72; const watching = state.watch.includes(row.dataset.open);
    bg.className = `swipe-bg ${right ? 'buy' : 'watch'} ${armed ? 'armed' : ''}`;
    bg.innerHTML = right ? '<span>Buy</span>' : `<span>${watching ? '☆ Unwatch' : '★ Watch'}</span>`;
  };
  el.addEventListener('touchstart', (e) => {
    row = null; on = null; dx = 0;
    if (e.touches.length !== 1 || overlayOpen() || (ui.tab === 'games' && ui.gtab === 'pickem')) return;
    const r = e.target.closest('.list > .item[data-open]');
    if (!r || e.target.closest('.hscroll, input') || e.touches[0].clientX < 28) return;
    const a = state.assets[r.dataset.open]; if (!a) return;
    row = r; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!row || on === false) return;
    const t = e.touches[0]; dx = t.clientX - sx; const dy = t.clientY - sy;
    if (on === null) { if (Math.abs(dx) > 12 && Math.abs(dx) > 1.6 * Math.abs(dy)) on = true; else if (Math.abs(dy) > 10) { on = false; return; } else return; }
    row.style.transform = `translateX(${Math.max(-96, Math.min(96, dx))}px)`;
    paint();
  }, { passive: true });
  const end = () => {
    if (!row || on !== true) { reset(); return; }
    const id = row.dataset.open; const d = dx; reset();
    if (Math.abs(d) < 72) return;
    ui.swallowUntil = Date.now() + 350; // the lift after a swipe is not a tap
    if (d < 0) {
      const i = state.watch.indexOf(id);
      if (i >= 0) state.watch.splice(i, 1); else state.watch.unshift(id);
      dirty = true; save(); buzz(); toast(i >= 0 ? 'Removed from watchlist' : `${state.assets[id].ticker} added to watchlist`);
    } else { buzz(); openDetail(id); setTimeout(() => { if (ui.detail === id) openOrder(stockOrderDefaults('buy')); }, 320); }
  };
  el.addEventListener('touchend', end, { passive: true }); el.addEventListener('touchcancel', reset, { passive: true });
})();
// Turn the phone sideways on a player page: the chart fills the screen.
const landMq = window.matchMedia('(orientation: landscape) and (max-height: 520px)');
function renderLand() {
  const el = $('#land'); const a = ui.detail ? state.assets[ui.detail] : null;
  const show = !!a && landMq.matches && !ui.order && !ui.page && !ui.article && !ui.chain;
  el.hidden = !show;
  if (!show) { el.innerHTML = ''; return; }
  const now = Date.now(); const ch = change(a, now, RANGES[ui.range]);
  el.innerHTML = `<div class="land-top"><b class="ellipsis">${esc(a.name)}</b><span class="lp" id="lprice">${money(a.price)}</span><span id="lchg" class="${cls(ch)}">${fmtPct(ch)} <span class="muted">${rangeLabel(ui.range)}</span></span><span class="grow"></span>
    <div class="ranges">${Object.keys(RANGES).map((rg) => `<button data-range="${rg}" class="${rg === ui.range ? 'on' : ''}">${rg}</button>`).join('')}</div></div><div id="lchart"></div>`;
  lineChart($('#lchart'), a.hist.concat([now, a.price]), now - RANGES[ui.range], { height: Math.max(140, window.innerHeight - 74),
    onScrub: (pt) => { if (!pt) { $('#lprice').textContent = money(a.price); $('#lchg').className = cls(ch); $('#lchg').innerHTML = `${fmtPct(ch)} <span class="muted">${rangeLabel(ui.range)}</span>`; return; }
      const c = pt.p / pt.first - 1; $('#lprice').textContent = money(pt.p); $('#lchg').className = cls(c);
      $('#lchg').innerHTML = `${fmtPct(c)} <span class="muted">${new Date(pt.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>`; } });
}
landMq.addEventListener?.('change', renderLand);
window.addEventListener('resize', () => { if (!$('#land').hidden || landMq.matches) renderLand(); });
// Redraw a page without its sideways-scrolling rows (chips, strips) jumping back to the start.
function keepRows(draw) {
  const sel = '#view .chips, #view .hscroll';
  const xs = [...document.querySelectorAll(sel)].map((el) => el.scrollLeft);
  const y = view().scrollTop;
  draw();
  document.querySelectorAll(sel).forEach((el, i) => { if (xs[i]) el.scrollLeft = xs[i]; });
  view().scrollTop = y;
}
// Tap the very top of the screen (the status bar area) to jump back to the top of whatever is showing.
{
  const strip = $('#toptap');
  const goTop = () => {
    const top = ui.page ? $('#page') : ui.article ? $('#article') : ui.draft ? $('#draft') : ui.chain ? $('#chain')
      : ui.game && (!ui.detail || $('#game').style.zIndex === '34') ? $('#game') : ui.detail ? $('#sheet') : view();
    top?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  // iPhone doesn't send a click to a plain element, so the touch itself is used; a click still
  // covers a mouse. One of the two fires per tap.
  let sx = 0; let sy = 0; let last = 0;
  const fire = () => { if (Date.now() - last < 500) return; last = Date.now(); goTop(); };
  strip?.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  strip?.addEventListener('touchend', (e) => { const t = e.changedTouches[0]; if (Math.abs(t.clientX - sx) < 12 && Math.abs(t.clientY - sy) < 12) fire(); }, { passive: true });
  strip?.addEventListener('click', fire);
}
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
  runExtras(state, Date.now()); runExtras3(state, Date.now());
  runCareer(state, Date.now());
  state.lastTick = state.lastTick || Date.now();
  // Even when one league's feed fails, the others' charts still get their points and gaps filled.
  if (!liveOnly) { tick(state, Date.now()); fillGaps(state, Date.now()); if (ui.detail && !ui.scrub) ui.chartAnim = false; }
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
  bindMarket(() => state); // card prices follow how sought-after each player is
  setProxy(state.settings.proxy);
  for (const lg of Object.keys(LEAGUES)) { recomputeStats(state, lg); rebuildInjuryCache(state, lg); }
  if (Object.keys(state.assets).length) {
    upgradeModel(state, Date.now());
    repairNewcomers(state, Date.now());
    rescoreNews(state, Date.now());
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
  tick(state, Date.now(), { record: false }); // chart points resume once the sync has applied what happened meanwhile
  runAutomation(state, Date.now()); runSocial(state, Date.now()); runExtras(state, Date.now()); runExtras3(state, Date.now()); runCareer(state, Date.now());
  applyTheme(); applyLook();
  ui.since = sinceLastOpen(state);
  { const m = location.hash.match(/[#&]c=([A-Za-z0-9_-]+)/); if (m) { ui.pendingDuel = m[1]; try { history.replaceState(null, '', location.pathname); } catch { /* */ } } }
  if (!state.lastOpen) markOpen(state);
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
    runExtras(state, now); runExtras3(state, now);
    runCareer(state, now);
    moverAlerts(state, now);
    maybeRecap();
  if (ui.pendingDuel) { openPage('rival', { code: ui.pendingDuel }); ui.pendingDuel = null; }
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
    if (document.hidden) { markOpen(state); save(); applyUpdate(); return; }
    ui.since = sinceLastOpen(state) || ui.since;
    checkForUpdate();
    tick(state, Date.now(), { record: false }); // chart points resume once the sync has applied what happened meanwhile
    runAutomation(state, Date.now()); runSocial(state, Date.now()); runExtras(state, Date.now()); runExtras3(state, Date.now()); runCareer(state, Date.now());
    announce();
    const last = Math.max(0, ...enabledLeagues().map((l) => state.sync[l]?.scoreboard || 0));
    if (Date.now() - last > 60e3) runSync(); else softRefresh();
  });
  window.addEventListener('online', () => runSync());
}

main();
