// StatStreet — UI layer.
import { LEAGUES, posGroup } from './scoring.js';
import {
  newState, tick, trade, previewTrade, netWorth, holdingsValue, change, priceAt, breakdown,
  leagueIndex, rebuildInjuryCache, recomputeStats, START_CASH,
} from './engine.js';
import { syncLeague, hasLive } from './sync.js';
import { setProxy, netStats, api } from './api.js';
import { loadState, saveState, persist, idbDel } from './store.js';
import { lineChart, sparkline } from './chart.js';
import { fmtMoney, fmtPct, timeAgo, DAY, HOUR, clamp } from './util.js';

// ---------- state ----------

let state;
const ui = {
  tab: 'home', league: 'all', kind: 'player', sort: 'movers', q: '', limit: 60,
  range: '1D', homeRange: '1D', newsLeague: 'all', detail: null, trade: null, scrub: false,
};
const STATIC = typeof window !== 'undefined' && !!window.STATIC_SNAPSHOT; // hosted phone version
const RANGES = { '1D': DAY, '1W': 7 * DAY, '1M': 30 * DAY, '3M': 90 * DAY, ALL: 3650 * DAY };
let syncing = false; let syncError = ''; let dirty = false;

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = (v) => (v >= 0 ? 'up' : 'down');
const enabledLeagues = () => Object.keys(LEAGUES).filter((l) => state.settings.leagues[l]);
const assetsList = () => Object.values(state.assets).filter((a) => state.settings.leagues[a.league] && a.hist.length);

// ---------- small render helpers ----------

function initials(name) {
  return esc(String(name).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase());
}

function avatar(a) {
  if (STATIC) return `<div class="avatar-fallback">${a.kind === 'team' ? esc(a.ticker) : initials(a.name)}</div>`;
  const ini = a.kind === 'team' ? esc(a.ticker) : initials(a.name);
  const fallback = `<div class=&quot;avatar-fallback&quot;>${ini}</div>`;
  if (!a.img) return `<div class="avatar-fallback">${ini}</div>`;
  return `<img class="avatar ${a.kind === 'team' ? 'team' : ''}" src="${esc(a.img)}" loading="lazy" alt="" onerror="this.outerHTML='${fallback}'">`;
}

const lgTag = (lg) => `<span class="lg ${lg}">${LEAGUES[lg].name}</span>`;

function subLine(a) {
  const bits = [lgTag(a.league), `<span>${esc(a.ticker)}</span>`];
  if (a.kind === 'player') bits.push(`<span>${esc(a.teamAbbr || '')}${a.pos ? ' · ' + esc(a.pos) : ''}</span>`);
  else bits.push(`<span>${a.rec.gp ? `${Math.round(a.rec.w)}-${Math.round(a.rec.l)}${a.rec.t >= 1 ? '-' + Math.round(a.rec.t) : ''}` : 'Team'}${a.rec.prior ? ' (last yr)' : ''}</span>`);
  if (a.live || a.liveBoost) bits.push('<span class="tag live">LIVE</span>');
  else if (a.injury) bits.push(`<span class="tag inj">${esc(shortInj(a.injury.status))}</span>`);
  return bits.join('');
}

function shortInj(s) {
  const x = String(s).toLowerCase();
  if (x.includes('day-to-day')) return 'DTD';
  if (x.includes('question')) return 'Q';
  if (x.includes('doubt')) return 'D';
  if (x.includes('reserve')) return 'IR';
  if (/-day/.test(x)) return s.replace(/-?Injured List/i, 'IL');
  return s.length > 10 ? 'OUT' : s;
}

function assetRow(a, { right = 'pill', range = '1D' } = {}) {
  const ch = change(a, Date.now(), RANGES[range]);
  const from = Date.now() - RANGES[range];
  return `<button class="item" data-open="${a.id}">
    ${avatar(a)}
    <div class="grow"><div class="name ellipsis">${esc(a.name)}</div><div class="sub">${subLine(a)}</div></div>
    ${right === 'spark' ? sparkline(a.hist, from) : ''}
    <div class="price-col">
      <div class="price" data-p="${a.id}">${fmtMoney(a.price)}</div>
      ${right === 'pill' ? `<span class="pill ${cls(ch)}" data-c="${a.id}" data-r="${range}">${fmtPct(ch)}</span>`
        : `<div class="small ${cls(ch)}" data-c="${a.id}" data-r="${range}" data-plain="1">${fmtPct(ch)}</div>`}
    </div>
  </button>`;
}

function syncBadge() {
  const last = Math.max(0, ...enabledLeagues().map((l) => state.sync[l]?.scoreboard || 0));
  if (STATIC) return `<button class="sync" data-act="refresh"><span class="dot" style="background:var(--accent)"></span>Data ${new Date(window.STATIC_SNAPSHOT.fetched).toLocaleDateString([], { month: 'short', day: 'numeric' })}</button>`;
  const txt = syncing ? 'Updating…' : syncError ? 'Offline' : last ? `Updated ${timeAgo(last)}` : '';
  return `<button class="sync ${syncing ? 'busy' : syncError ? 'err' : ''}" data-act="refresh"><span class="dot"></span>${txt}</button>`;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- views ----------

function renderHome() {
  const now = Date.now();
  const nw = netWorth(state);
  const span = RANGES[ui.homeRange];
  const ref = nwAt(now - span) ?? START_CASH;
  const ch = nw - ref;
  const holdings = Object.entries(state.holdings).map(([id, h]) => ({ a: state.assets[id], h })).filter((x) => x.a)
    .sort((x, y) => y.a.price * y.h.qty - x.a.price * x.h.qty);
  const watch = state.watch.map((id) => state.assets[id]).filter(Boolean);
  const live = Object.entries(state.liveGames).filter(([, g]) => state.settings.leagues[g.league]);
  const movers = assetsList().map((a) => ({ a, c: change(a, now) })).sort((x, y) => Math.abs(y.c) - Math.abs(x.c)).slice(0, 5);

  $('#view').innerHTML = `
    <div class="topbar"><div class="brand">Stat<b>Street</b></div>${syncBadge()}</div>
    <div class="muted small">Net worth</div>
    <div class="big-value" data-nw>${fmtMoney(nw)}</div>
    <div class="change-line ${cls(ch)}" data-nwc>${ch >= 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(ch))} (${fmtPct(ref ? ch / ref : 0)}) <span class="muted">${rangeLabel(ui.homeRange)}</span></div>
    <div class="chart-wrap" id="nwchart"></div>
    <div class="ranges">${Object.keys(RANGES).map((r) => `<button data-hrange="${r}" class="${r === ui.homeRange ? 'on' : ''}">${r}</button>`).join('')}</div>

    <div class="grid2" style="margin-top:12px">
      <div class="stat"><div class="k">Buying power</div><div class="v">${fmtMoney(state.cash)}</div></div>
      <div class="stat"><div class="k">Invested</div><div class="v">${fmtMoney(holdingsValue(state))}</div></div>
    </div>

    <h3>Market indices · 24h</h3>
    <div class="grid3">${enabledLeagues().map((lg) => {
      const ix = leagueIndex(state, lg, now);
      return `<button class="index-card" data-idx="${lg}">${lgTag(lg)}
        <div class="v">${ix ? ix.value.toFixed(1) : '—'}</div>
        <div class="tiny ${cls(ix?.change || 0)}">${ix ? fmtPct(ix.change) : ''} · mood ${moodWord(state.mood[lg])}</div></button>`;
    }).join('')}</div>

    ${live.length ? `<h3>Live now</h3><div class="live-strip">${live.map(([, g]) => `
      <div class="game">${lgTag(g.league)} <span class="tag live">LIVE</span>
        ${g.teams.map((t) => `<div class="t"><span>${esc(t.abbr)}</span><span>${t.score}</span></div>`).join('')}
        <div class="tiny muted">${esc(g.detail)}</div></div>`).join('')}</div>` : ''}

    <h2>Your positions</h2>
    ${holdings.length ? `<div class="list">${holdings.map(({ a, h }) => {
      const pl = a.price * h.qty - h.cost;
      return `<button class="item" data-open="${a.id}">${avatar(a)}
        <div class="grow"><div class="name ellipsis">${esc(a.name)}</div><div class="sub">${h.qty} sh · avg ${fmtMoney(h.cost / h.qty)}</div></div>
        ${sparkline(a.hist, now - DAY)}
        <div class="price-col"><div class="price">${fmtMoney(a.price * h.qty)}</div><div class="small ${cls(pl)}">${pl >= 0 ? '+' : '-'}${fmtMoney(Math.abs(pl))}</div></div>
      </button>`;
    }).join('')}</div>` : `<div class="card empty">You don't own anything yet. You start with ${fmtMoney(START_CASH)} of play money —
      <button class="more" data-tab="market">Browse the market →</button></div>`}

    ${watch.length ? `<h2>Watchlist</h2><div class="list">${watch.map((a) => assetRow(a, { right: 'spark' })).join('')}</div>` : ''}

    <h2>Biggest movers · 24h</h2>
    <div class="list">${movers.map(({ a }) => assetRow(a)).join('') || '<div class="empty">Waiting for market data…</div>'}</div>
  `;
  drawNwChart();
}

function nwAt(t) {
  const h = state.nw;
  if (!h.length) return null;
  if (t <= h[0]) return h[1];
  for (let i = h.length - 2; i >= 0; i -= 2) if (h[i] <= t) return h[i + 1];
  return h[1];
}

function drawNwChart() {
  const el = $('#nwchart'); if (!el) return;
  const flat = state.nw.concat([Date.now(), netWorth(state)]);
  lineChart(el, flat, Date.now() - RANGES[ui.homeRange]);
}

const rangeLabel = (r) => ({ '1D': 'today', '1W': 'past week', '1M': 'past month', '3M': 'past 3 months', ALL: 'all time' }[r]);
const moodWord = (m = 0) => (m > 0.25 ? 'hot' : m > 0.08 ? 'warm' : m < -0.25 ? 'cold' : m < -0.08 ? 'cool' : 'calm');

function marketItems() {
  const now = Date.now();
  const q = ui.q.trim().toLowerCase();
  let list = assetsList();
  if (ui.league !== 'all') list = list.filter((a) => a.league === ui.league);
  if (q) {
    list = list.filter((a) => a.name.toLowerCase().includes(q) || a.ticker.toLowerCase().includes(q)
      || (a.teamAbbr || '').toLowerCase() === q);
  } else {
    list = list.filter((a) => a.kind === ui.kind);
  }
  const key = {
    movers: (a) => -change(a, now),
    losers: (a) => change(a, now),
    price: (a) => -a.price,
    live: (a) => (a.live || a.liveBoost ? 0 : 1) - change(a, now) * 0.001,
    news: (a) => -(a.shocks || []).filter((s) => now - s.t < 3 * DAY).length,
    injured: (a) => (a.injury ? 0 : 1) + (a.injury?.factor || 1),
    held: (a) => (state.holdings[a.id] ? 0 : 1) - a.price / 1e6,
  }[ui.sort];
  if (ui.sort === 'live') list = list.filter((a) => a.live || a.liveBoost);
  if (ui.sort === 'injured') list = list.filter((a) => a.injury);
  if (ui.sort === 'news') list = list.filter((a) => (a.shocks || []).some((s) => now - s.t < 3 * DAY));
  return list.map((a) => [key(a), a]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
}

function renderMarket(keepFocus = false) {
  const items = marketItems();
  const sorts = [['movers', 'Top gainers'], ['losers', 'Top losers'], ['price', 'Most valuable'], ['live', 'Live'], ['news', 'In the news'], ['injured', 'Injured']];
  const html = `
    <div class="topbar"><h1>Market</h1>${syncBadge()}</div>
    <input class="search" id="q" type="search" placeholder="Search players, teams, tickers" value="${esc(ui.q)}" autocomplete="off" autocorrect="off">
    <div class="seg" style="margin-top:10px">${['all', ...enabledLeagues()].map((l) => `<button data-league="${l}" class="${ui.league === l ? 'on' : ''}">${l === 'all' ? 'All' : LEAGUES[l].name}</button>`).join('')}</div>
    <div class="seg" style="margin-top:8px">${[['player', 'Players'], ['team', 'Teams']].map(([k, n]) => `<button data-kind="${k}" class="${ui.kind === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="chips" style="margin-top:10px">${sorts.map(([k, n]) => `<button class="chip ${ui.sort === k ? 'on' : ''}" data-sort="${k}">${n}</button>`).join('')}</div>
    <div class="list" style="margin-top:8px" id="mlist">
      ${items.slice(0, ui.limit).map((a) => assetRow(a)).join('') || `<div class="empty">${emptyMarketText()}</div>`}
      ${items.length > ui.limit ? `<button class="more" data-act="more">Show more (${items.length - ui.limit} left)</button>` : ''}
    </div>
    <p class="tiny faint" style="text-align:center;margin-top:12px">${items.length} listed · prices move with real games, injuries and news</p>`;
  if (keepFocus) {
    const list = $('#mlist');
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    list.replaceWith(tmp.querySelector('#mlist'));
    $('.chips').replaceWith(tmp.querySelector('.chips'));
    return;
  }
  $('#view').innerHTML = html;
}

function emptyMarketText() {
  if (!assetsList().length) return syncing ? 'Opening the market…' : 'No market data yet. Tap “Updated” at the top to retry.';
  if (ui.sort === 'live') return 'No games in progress right now.';
  if (ui.sort === 'injured') return 'No injured players here.';
  if (ui.sort === 'news') return 'Nothing newsworthy in the last few days.';
  return 'No matches.';
}

function renderNews() {
  const list = state.news.filter((n) => state.settings.leagues[n.league] && (ui.newsLeague === 'all' || n.league === ui.newsLeague));
  $('#view').innerHTML = `
    <div class="topbar"><h1>News</h1>${syncBadge()}</div>
    <p class="small muted" style="margin:4px 0 10px">Headlines are scored for sentiment. Bullish news lifts the players and teams it mentions; bearish news drags them down. The effect fades over a few days.</p>
    <div class="chips">${['all', ...enabledLeagues()].map((l) => `<button class="chip ${ui.newsLeague === l ? 'on' : ''}" data-nleague="${l}">${l === 'all' ? 'All' : LEAGUES[l].name}</button>`).join('')}</div>
    <div class="list" style="margin-top:8px">${list.slice(0, 80).map((n) => {
      const s = n.score > 0.12 ? ['up', 'Bullish'] : n.score < -0.12 ? ['down', 'Bearish'] : ['flat', 'Neutral'];
      return `<div class="news">
        <a href="${esc(n.url)}" target="_blank" rel="noopener" class="h" style="text-decoration:none;display:block">${esc(n.headline)}</a>
        ${n.desc ? `<div class="small muted" style="margin-top:3px">${esc(n.desc)}</div>` : ''}
        <div class="meta">${lgTag(n.league)}<span class="senti ${s[0]}">${s[1]}${s[0] !== 'flat' ? ` ${n.score > 0 ? '+' : ''}${n.score.toFixed(2)}` : ''}</span>
          <span class="tiny faint">${timeAgo(n.published)}</span>
          ${(n.targets || []).slice(0, 4).map((id) => state.assets[id] ? `<button class="tk" data-open="${id}">${esc(state.assets[id].ticker)}</button>` : '').join('')}
        </div></div>`;
    }).join('') || '<div class="empty">No news yet.</div>'}</div>`;
}

function renderAccount() {
  const nw = netWorth(state);
  const pl = nw - START_CASH;
  $('#view').innerHTML = `
    <div class="topbar"><h1>Account</h1>${syncBadge()}</div>
    <div class="grid2">
      <div class="stat"><div class="k">All-time return</div><div class="v ${cls(pl)}">${fmtPct(pl / START_CASH)}</div></div>
      <div class="stat"><div class="k">Trades</div><div class="v">${state.txns.length}</div></div>
    </div>

    <h2>Activity</h2>
    <div class="list">${state.txns.slice(0, 40).map((t) => `<button class="item" data-open="${t.id}">
      <div class="grow"><div class="name">${t.side === 'buy' ? 'Bought' : 'Sold'} ${t.qty} ${esc(t.ticker)}</div>
      <div class="sub">${new Date(t.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${fmtMoney(t.price)}/sh</div></div>
      <div class="price ${t.side === 'buy' ? '' : 'up'}">${t.side === 'buy' ? '-' : '+'}${fmtMoney(t.total)}</div></button>`).join('')
      || '<div class="empty">No trades yet.</div>'}</div>

    <h2>Leagues</h2>
    <div class="list">${Object.values(LEAGUES).map((L) => `<label class="toggle"><span>${lgTag(L.key)} &nbsp;${L.name} <span class="tiny faint">${state.sync[L.key]?.seeded ? 'loaded' : 'not loaded'}</span></span>
      <span class="switch"><input type="checkbox" data-lgtoggle="${L.key}" ${state.settings.leagues[L.key] ? 'checked' : ''}><span></span></span></label>`).join('')}</div>

    ${STATIC ? `<h2>About this version</h2>
    <div class="card small muted">This phone version runs on a snapshot of real ESPN data taken ${new Date(window.STATIC_SNAPSHOT.fetched).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}: season stats, standings, injuries and headlines. Prices keep trading on the tape and your portfolio is saved on this phone. The full version (in the download) pulls live scores every minute once it's hosted.</div>` : `<h2>Data connection</h2>
    <div class="card">
      <div class="small muted">Scores, stats, injuries and news come from ESPN's public feeds, straight from your phone. If your browser blocks them, deploy the free proxy in <b>worker/proxy.js</b> (see README) and paste its URL here.</div>
      <label class="field"><input type="url" id="proxy" placeholder="https://your-proxy.workers.dev" value="${esc(state.settings.proxy)}" autocapitalize="off" autocorrect="off"></label>
      <div class="btn-row"><button class="btn ghost" data-act="saveproxy">Save</button><button class="btn ghost" data-act="test">Test connection</button></div>
      <div class="tiny muted" id="testout" style="margin-top:8px">${netStats.lastError ? 'Last error: ' + esc(netStats.lastError) : ''}</div>
    </div>`}

    <h2>How prices work</h2>
    <div class="list"><details><summary>The pricing model</summary><div class="prose">
      <p><b>Players</b> are valued on a rolling performance score from real box scores (Game Score in the NBA, fantasy-style points in the NFL, batting and pitching lines in MLB), compared with others at the same position. Season averages set the starting price; every game updates it.</p>
      <p><b>Teams</b> are valued on win percentage (pulled toward .500 early in the season), point differential, streaks, recent form and playoff odds.</p>
      <p><b>Injuries</b> cut a player's price (Day-to-day −4%, Questionable −5%, Out −20%, IR −28%) and weigh on their team. <b>News</b> is scored for sentiment and nudges price for a few days. Standout games (40-point nights, 3-HR games, 5-TD games) get a milestone bump.</p>
      <p><b>Market mood</b> per league follows the news tone and the tape. <b>Your trades</b> move the price too, and you pay a 0.35% spread, so churning costs money.</p>
      <p>During <b>live games</b>, players move on their pace and teams move with the score.</p>
    </div></details></div>

    ${STATIC ? '' : `<h2>Backup</h2>
    <div class="btn-row"><button class="btn ghost" data-act="export">Export</button><label class="btn ghost">Import<input type="file" id="importfile" accept="application/json" hidden></label></div>`}

    <h2>Reset</h2>
    <div class="btn-row"><button class="btn danger" data-act="resetpf">Reset portfolio</button><button class="btn danger" data-act="resetall">Reset everything</button></div>
    <p class="tiny faint" style="margin-top:18px;text-align:center">Play money only. Not affiliated with ESPN, the NBA, NFL or MLB.</p>`;
}

// ---------- asset detail ----------

function openDetail(id) {
  if (!state.assets[id]) return;
  ui.detail = id;
  try { history.pushState({ sheet: id }, ''); } catch { /* sandboxed frame */ }
  renderDetail();
  $('#sheet').scrollTop = 0;
}

function closeDetail() {
  ui.detail = null;
  $('#sheet').hidden = true;
  $('#sheet').innerHTML = '';
  render();
}

function renderDetail() {
  const a = state.assets[ui.detail];
  if (!a) return;
  const now = Date.now();
  const from = now - RANGES[ui.range];
  const ch = change(a, now, RANGES[ui.range]);
  const ref = priceAt(a, from);
  const h = state.holdings[a.id];
  const b = breakdown(state, a, now);
  const watching = state.watch.includes(a.id);
  const news = state.news.filter((n) => (n.targets || []).includes(a.id)).slice(0, 6);
  const sheet = $('#sheet');
  sheet.hidden = false;
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="row between">
      <button class="icon-btn" data-act="back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <button class="icon-btn ${watching ? 'on' : ''}" data-act="watch" aria-label="Watchlist"><svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg></button>
    </div>
    <div class="hero">${avatar(a)}<div class="grow"><div class="name ellipsis" style="font-size:19px">${esc(a.name)}</div><div class="sub">${subLine(a)}</div></div></div>
    <div class="big-value" id="dprice">${fmtMoney(a.price)}</div>
    <div class="change-line ${cls(ch)}" id="dchg">${ch >= 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(a.price - ref))} (${fmtPct(ch)}) <span class="muted">${rangeLabel(ui.range)}</span></div>
    <div class="chart-wrap" id="dchart"></div>
    <div class="ranges">${Object.keys(RANGES).map((r) => `<button data-range="${r}" class="${r === ui.range ? 'on' : ''}">${r}</button>`).join('')}</div>

    ${h ? `<h3>Your position</h3><div class="grid2">
      <div class="stat"><div class="k">Shares</div><div class="v">${h.qty}</div></div>
      <div class="stat"><div class="k">Market value</div><div class="v">${fmtMoney(a.price * h.qty)}</div></div>
      <div class="stat"><div class="k">Avg cost</div><div class="v">${fmtMoney(h.cost / h.qty)}</div></div>
      <div class="stat"><div class="k">Total return</div><div class="v ${cls(a.price * h.qty - h.cost)}">${fmtPct((a.price * h.qty - h.cost) / h.cost)}</div></div>
    </div>` : ''}

    ${a.live ? `<div class="card" style="margin-top:14px"><span class="tag live">LIVE</span> <b style="margin-left:6px">${esc(a.live.text)}</b></div>` : ''}
    ${a.injury ? `<div class="card" style="margin-top:14px;border:1px solid var(--down-bg)"><span class="tag inj">${esc(a.injury.status)}</span> <span class="small" style="margin-left:6px">${esc(a.injury.detail || '')}</span></div>` : ''}

    <h3>Why it's moving</h3>
    <div class="list">${(a.events || []).slice(0, 10).map((e) => `<div class="driver">
      <div class="ic">${{ game: '🏟️', milestone: '🏆', news: '📰', injury: '🩹' }[e.kind] || '•'}</div>
      <div class="txt">${esc(e.text)}<div class="tiny faint">${timeAgo(e.t)}</div></div>
      <div class="pct ${cls(e.pct)}">${Math.abs(e.pct) < 0.0005 ? '<span class="faint">—</span>' : fmtPct(e.pct, 1)}</div></div>`).join('')
      || '<div class="empty">No price-moving events yet.</div>'}</div>

    ${a.kind === 'player' ? playerStats(a) : teamStats(a)}

    <h3>Price breakdown</h3>
    <div class="card">
      <div class="brk"><span>${a.kind === 'player' ? 'Performance value' : 'Team strength value'}</span><b>${fmtMoney(b.fair)}</b></div>
      <div class="brk"><span>Injuries</span><b class="${b.inj < 1 ? 'down' : 'muted'}">${b.inj < 1 ? fmtPct(b.inj - 1, 1) : 'none'}</b></div>
      <div class="brk"><span>News sentiment</span><b class="${Math.abs(b.senti) < 0.001 ? 'muted' : cls(b.senti)}">${fmtPct(b.senti, 1)}</b></div>
      <div class="brk"><span>${LEAGUES[a.league].name} market mood</span><b class="${Math.abs(b.mood) < 0.001 ? 'muted' : cls(b.mood)}">${fmtPct(b.mood, 1)}</b></div>
      ${b.live ? `<div class="brk"><span>Live game</span><b class="${cls(b.live)}">${fmtPct(b.live, 1)}</b></div>` : ''}
      ${Math.abs(b.imp) > 0.0005 ? `<div class="brk"><span>Your order flow</span><b class="${cls(b.imp)}">${fmtPct(b.imp, 1)}</b></div>` : ''}
      <div class="brk"><span>Fair price</span><b>${fmtMoney(b.target)}</b></div>
    </div>

    ${news.length ? `<h3>News</h3><div class="list">${news.map((n) => `<a class="news" href="${esc(n.url)}" target="_blank" rel="noopener">
      <div class="h">${esc(n.headline)}</div><div class="meta"><span class="senti ${n.score > 0.12 ? 'up' : n.score < -0.12 ? 'down' : 'flat'}">${n.score > 0.12 ? 'Bullish' : n.score < -0.12 ? 'Bearish' : 'Neutral'}</span><span class="tiny faint">${timeAgo(n.published)}</span></div></a>`).join('')}</div>` : ''}
  </div>
  <div class="trade-bar">
    <button class="btn sell" data-act="sell" ${h ? '' : 'disabled'}>Sell</button>
    <button class="btn buy" data-act="buy">Buy</button>
  </div>`;
  lineChart($('#dchart'), a.hist.concat([now, a.price]), from, {
    onScrub: (pt) => {
      ui.scrub = !!pt;
      if (!pt) { updateDetailHeader(); return; }
      $('#dprice').textContent = fmtMoney(pt.p);
      const c = pt.p / pt.first - 1;
      $('#dchg').className = `change-line ${cls(c)}`;
      $('#dchg').innerHTML = `${fmtPct(c)} <span class="muted">${new Date(pt.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>`;
    },
  });
}

function updateDetailHeader() {
  const a = state.assets[ui.detail];
  if (!a || ui.scrub) return;
  const ch = change(a, Date.now(), RANGES[ui.range]);
  const ref = priceAt(a, Date.now() - RANGES[ui.range]);
  const p = $('#dprice'); const c = $('#dchg');
  if (!p) return;
  p.textContent = fmtMoney(a.price);
  c.className = `change-line ${cls(ch)}`;
  c.innerHTML = `${ch >= 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(a.price - ref))} (${fmtPct(ch)}) <span class="muted">${rangeLabel(ui.range)}</span>`;
}

function playerStats(a) {
  const st = state.stats[a.league]?.[posGroupOf(a)];
  const z = st && a.perf.ema != null ? (a.perf.ema - st.mu) / st.sd : 0;
  const pctile = Math.round(100 * normCdf(z));
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
      <div class="list" style="margin:10px -14px -14px;border-radius:0 0 14px 14px">${a.perf.last.slice(0, 4).map((g) => `<div class="driver"><div class="txt small">${esc(g.text)}<div class="tiny faint">${new Date(g.t).toLocaleDateString([], { month: 'short', day: 'numeric' })}</div></div><div class="pct">${g.gs.toFixed(1)}</div></div>`).join('')}</div>
    </div>` : `<div class="card small muted" style="margin-top:10px">Priced from season averages. Game-by-game form appears after their next game.</div>`}`;
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

const posGroupOf = (a) => posGroup(a.league, a.pos);
const groupName = (a) => ({ ALL: 'league', P: 'pitchers', H: 'hitters', QB: 'QBs', RB: 'RBs', WR: 'pass catchers', K: 'kickers', OL: 'linemen', DEF: 'defenders' }[posGroupOf(a)]);
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }

// ---------- trade sheet ----------

function openTrade(side) {
  const a = state.assets[ui.detail];
  if (!a) return;
  const h = state.holdings[a.id];
  const qty = side === 'sell' ? (h?.qty || 0) : Math.max(1, Math.min(10, Math.floor(state.cash / (a.price * 1.01))));
  ui.trade = { side, qty: String(qty || 1) };
  renderTrade();
}

function renderTrade(err = '') {
  const a = state.assets[ui.detail];
  const t = ui.trade;
  const el = $('#trade');
  if (!a || !t) { el.hidden = true; return; }
  const qty = Math.max(0, Math.floor(Number(t.qty) || 0));
  const pv = qty ? previewTrade(state, a.id, t.side, qty) : { fill: a.price, total: 0, post: a.price };
  const h = state.holdings[a.id];
  const maxBuy = maxAffordable(a);
  const cashAfter = t.side === 'buy' ? state.cash - pv.total : state.cash + pv.total;
  el.hidden = false;
  el.innerHTML = `<div class="trade-panel">
    <div class="grabber"></div>
    <div class="seg">${['buy', 'sell'].map((s) => `<button data-tside="${s}" class="${t.side === s ? 'on' : ''}">${s === 'buy' ? 'Buy' : 'Sell'}</button>`).join('')}</div>
    <div class="row" style="margin-top:14px">${avatar(a)}<div class="grow"><div class="name">${esc(a.name)}</div><div class="sub">${esc(a.ticker)} · ${fmtMoney(a.price)} · ${h ? `you own ${h.qty}` : 'you own 0'}</div></div></div>
    <div class="qty"><button data-q="-1">−</button><input id="qtyin" inputmode="numeric" pattern="[0-9]*" value="${esc(t.qty)}"><button data-q="1">+</button></div>
    <div class="quick">${t.side === 'buy'
      ? [1, 5, 10, 25].map((n) => `<button data-qset="${n}">${n}</button>`).join('') + `<button data-qset="${maxBuy}">Max (${maxBuy})</button>`
      : [['¼', 0.25], ['½', 0.5], ['All', 1]].map(([n, f]) => `<button data-qset="${Math.max(1, Math.floor((h?.qty || 0) * f))}">${n}</button>`).join('')}</div>
    <div class="summary">
      <div class="brk"><span class="muted">Est. fill price</span><b>${fmtMoney(pv.fill)}</b></div>
      <div class="brk"><span class="muted">Est. ${t.side === 'buy' ? 'cost' : 'proceeds'}</span><b>${fmtMoney(pv.total)}</b></div>
      <div class="brk"><span class="muted">Cash after</span><b class="${cashAfter < 0 ? 'down' : ''}">${fmtMoney(cashAfter)}</b></div>
      <div class="brk"><span class="muted">Price impact</span><b class="${cls(pv.post - a.price)}">${fmtPct(pv.post / a.price - 1)}</b></div>
    </div>
    <div class="err" id="terr">${esc(err)}</div>
    <div class="btn-row"><button class="btn ghost" data-act="tcancel">Cancel</button><button class="btn ${t.side === 'buy' ? 'buy' : 'buy'}" data-act="tconfirm">${t.side === 'buy' ? 'Buy' : 'Sell'} ${qty || ''}</button></div>
  </div>`;
}

function maxAffordable(a) {
  let lo = 0; let hi = Math.floor(state.cash / (a.price * 0.9)) + 1;
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (previewTrade(state, a.id, 'buy', m).total <= state.cash) lo = m; else hi = m - 1; }
  return lo;
}

function confirmTrade() {
  const a = state.assets[ui.detail];
  const t = ui.trade;
  try {
    const tx = trade(state, a.id, t.side, Math.floor(Number(t.qty) || 0));
    ui.trade = null; $('#trade').hidden = true;
    dirty = true; save();
    toast(`${tx.side === 'buy' ? 'Bought' : 'Sold'} ${tx.qty} ${tx.ticker} at ${fmtMoney(tx.price)}`);
    if (navigator.vibrate) navigator.vibrate(12);
    renderDetail();
  } catch (e) {
    renderTrade(e.message);
  }
}

// ---------- routing & events ----------

function render() {
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  if (ui.tab === 'home') renderHome();
  else if (ui.tab === 'market') renderMarket();
  else if (ui.tab === 'news') renderNews();
  else renderAccount();
  if (ui.detail) renderDetail();
}

// Cheap refresh of numbers on screen between full renders.
function updateNumbers() {
  const now = Date.now();
  document.querySelectorAll('[data-p]').forEach((el) => {
    const a = state.assets[el.dataset.p]; if (!a) return;
    const txt = fmtMoney(a.price);
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
    const nw = netWorth(state); const ref = nwAt(now - RANGES[ui.homeRange]) ?? START_CASH; const ch = nw - ref;
    nwEl.textContent = fmtMoney(nw);
    const c = $('[data-nwc]');
    c.className = `change-line ${cls(ch)}`;
    c.innerHTML = `${ch >= 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(ch))} (${fmtPct(ref ? ch / ref : 0)}) <span class="muted">${rangeLabel(ui.homeRange)}</span>`;
  }
  if (ui.detail) updateDetailHeader();
  if (ui.trade && document.activeElement?.id !== 'qtyin') renderTrade($('#terr')?.textContent || '');
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('button, [data-open], label');
  if (!el) return;
  const d = el.dataset;
  if (d.tab) { ui.tab = d.tab; ui.limit = 60; if (ui.detail) closeDetail(); render(); window.scrollTo(0, 0); return; }
  if (d.open) { e.preventDefault(); openDetail(d.open); return; }
  if (d.league) { ui.league = d.league; ui.limit = 60; renderMarket(); return; }
  if (d.kind) { ui.kind = d.kind; ui.limit = 60; renderMarket(); return; }
  if (d.sort) { ui.sort = d.sort; ui.limit = 60; renderMarket(); return; }
  if (d.idx) { ui.tab = 'market'; ui.league = d.idx; ui.sort = 'price'; render(); return; }
  if (d.nleague) { ui.newsLeague = d.nleague; renderNews(); return; }
  if (d.range) { ui.range = d.range; renderDetail(); return; }
  if (d.hrange) { ui.homeRange = d.hrange; renderHome(); return; }
  if (d.tside) { ui.trade.side = d.tside; const h = state.holdings[ui.detail]; ui.trade.qty = d.tside === 'sell' ? String(h?.qty || 1) : ui.trade.qty; renderTrade(); return; }
  if (d.q) { ui.trade.qty = String(Math.max(1, (Math.floor(Number(ui.trade.qty) || 0)) + Number(d.q))); renderTrade(); return; }
  if (d.qset) { ui.trade.qty = String(Math.max(1, Number(d.qset))); renderTrade(); return; }
  switch (d.act) {
    case 'back': if (history.state?.sheet) history.back(); else closeDetail(); break;
    case 'watch': {
      const i = state.watch.indexOf(ui.detail);
      if (i >= 0) state.watch.splice(i, 1); else state.watch.unshift(ui.detail);
      dirty = true; renderDetail(); toast(i >= 0 ? 'Removed from watchlist' : 'Added to watchlist'); break;
    }
    case 'buy': openTrade('buy'); break;
    case 'sell': openTrade('sell'); break;
    case 'tcancel': ui.trade = null; $('#trade').hidden = true; break;
    case 'tconfirm': confirmTrade(); break;
    case 'more': ui.limit += 60; renderMarket(); break;
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
        Object.assign(state, { cash: START_CASH, holdings: {}, txns: [], nw: [] }); dirty = true; save(); render(); toast('Portfolio reset');
      }
      break;
    case 'resetall':
      if (armed(el, 'Tap again to erase everything')) { await idbDel('state'); location.reload(); }
      break;
    case 'retry': runSync({ manual: true }); break;
    case 'bootsettings': $('#boot').hidden = true; ui.tab = 'account'; render(); break;
    default: break;
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { ui.q = e.target.value; ui.limit = 60; renderMarket(true); }
  if (e.target.id === 'qtyin') {
    ui.trade.qty = e.target.value.replace(/[^0-9]/g, '');
    const pos = e.target.selectionStart;
    renderTrade(); const inp = $('#qtyin'); inp.focus(); try { inp.setSelectionRange(pos, pos); } catch { /* */ }
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.dataset.lgtoggle) {
    state.settings.leagues[e.target.dataset.lgtoggle] = e.target.checked;
    if (!enabledLeagues().length) { state.settings.leagues[e.target.dataset.lgtoggle] = true; e.target.checked = true; toast('Keep at least one league'); return; }
    dirty = true; save();
    if (e.target.checked && !state.sync[e.target.dataset.lgtoggle]?.seeded) runSync({ manual: true });
  }
  if (e.target.id === 'importfile' && e.target.files[0]) {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!data.assets || !data.settings) throw new Error('Not a StatStreet backup');
      state = data; afterLoad(); dirty = true; await save(); render(); toast('Backup restored');
    } catch (err) { toast(err.message); }
  }
});

window.addEventListener('popstate', (e) => {
  if (ui.trade) { ui.trade = null; $('#trade').hidden = true; }
  const id = e.state?.sheet;
  if (id && state.assets[id]) { ui.detail = id; renderDetail(); $('#sheet').scrollTop = 0; }
  else if (ui.detail) closeDetail();
});

$('#trade').addEventListener('click', (e) => { if (e.target.id === 'trade') { ui.trade = null; e.target.hidden = true; } });

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
  for (const lg of leagues) {
    try {
      const r = await syncLeague(state, lg, { progress: bootLog, now: Date.now(), liveOnly });
      newFinals += r.finals || 0;
      if (r.first) bootLog(`${LEAGUES[lg].name}: market open ✓`);
    } catch (err) {
      failures++; syncError = err.message || String(err);
      bootLog(`${LEAGUES[lg].name}: failed (${syncError})`);
    }
  }
  syncing = false;
  state.lastTick = state.lastTick || Date.now();
  dirty = true; await save();
  if (needsBoot) {
    if (!assetsList().length) { bootFailed(netStats.lastError || syncError || 'No data returned.'); return; }
    $('#boot').hidden = true;
    persist();
  }
  if (manual && !failures) toast(newFinals ? `${newFinals} new game result${newFinals > 1 ? 's' : ''} priced in` : 'Market is up to date');
  if (manual && failures) toast(`Some data couldn't load: ${syncError}`);
  if (!ui.trade && !(ui.tab === 'market' && document.activeElement?.id === 'q')) render();
  else refreshBadge();
}

function refreshBadge() {
  const el = document.querySelector('.sync');
  if (el) el.outerHTML = syncBadge();
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

async function save() {
  if (!dirty) return;
  dirty = false;
  try { await saveState(state); } catch (e) { console.warn('save failed', e); dirty = true; }
}

function afterLoad() {
  state.settings ||= { proxy: '', leagues: { nba: true, nfl: true, mlb: true } };
  setProxy(state.settings.proxy);
  for (const lg of Object.keys(LEAGUES)) { recomputeStats(state, lg); rebuildInjuryCache(state, lg); }
}

// ---------- boot ----------

async function main() {
  state = (await loadState()) || newState();
  afterLoad();
  if (!STATIC && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  tick(state, Date.now());
  render();
  runSync();

  // The tape: prices wiggle around fair value every few seconds.
  setInterval(() => {
    if (document.hidden) return;
    tick(state, Date.now());
    dirty = true;
    updateNumbers();
  }, 4000);
  // Live games every minute, everything else every 10 minutes.
  setInterval(() => { if (!document.hidden && Object.keys(state.liveGames).length) runSync({ liveOnly: true }); }, 60e3);
  setInterval(() => { if (!document.hidden) runSync(); }, 10 * 60e3);
  setInterval(save, 20e3);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { save(); return; }
    tick(state, Date.now());
    const last = Math.max(0, ...enabledLeagues().map((l) => state.sync[l]?.scoreboard || 0));
    if (Date.now() - last > 5 * 60e3) runSync(); else render();
  });
  window.addEventListener('online', () => runSync());
}

main();
