// Orchestrates data pulls for each league and feeds them to the engine.

import { api, SEASON_CATEGORIES } from './api.js';
import { LEAGUES, parseStandings, parseSeasonAthletes, parseScoreboard, parseBoxScore, parseInjuries, parseNews } from './scoring.js';
import {
  upsertTeam, seedPlayer, seedPrior, setTeamPrior, initForm, withRebase, MODEL_V, repriceLeague, rewindTeamRecords,
  applyFinalGame, applyLiveGame, applyNews, applyInjuries, clearStaleLive,
} from './engine.js';
import { etDays, pool, HOUR, DAY } from './util.js';

const MIN = 60e3;

async function loadStandings(state, league) {
  const json = await api.standings(league);
  const teams = parseStandings(league, json);
  for (const t of teams) upsertTeam(state, league, t);
  const season = findSeason(json);
  if (season) state.sync[league].season = season;
  return teams.length;
}

// Last season's standings and player averages: the starting point ("prior") for this
// season's prices. Fetched once per season.
async function loadPriors(state, league, progress, playerSeason) {
  const s = state.sync[league];
  const season = s.season;
  if (season) {
    try {
      const teams = parseStandings(league, await api.standings(league, season - 1));
      // Teams must exist before priors attach; off-season teams come from last year's table.
      for (const t of teams) { if (!state.assets[`${league}:t:${t.id}`]) upsertTeam(state, league, { ...t, w: 0, l: 0, t: 0, gp: 0, diff: 0, streak: 0 }); setTeamPrior(state, league, t); }
    } catch { /* optional */ }
  }
  const ps = playerSeason || s.statSeason;
  if (ps) {
    progress?.(`${LEAGUES[league].name}: loading last season`);
    const recs = await loadSeasonRecords(league, ps - 1, null);
    for (const rec of recs.values()) seedPrior(state, league, rec);
  }
  s.priorV = MODEL_V;
  s.priorSeason = s.season;
  s.avgV = 1;
}

function findSeason(json) {
  let found = null;
  const walk = (n) => { if (!n || found) return; if (n.standings?.season) found = n.standings.season; (n.children || []).forEach(walk); };
  walk(json);
  return found || json.season?.year || null;
}

async function loadSeasonStats(state, league, progress) {
  const ctx = {};
  const byId = await loadSeasonRecords(league, null, progress, ctx);
  for (const rec of byId.values()) seedPlayer(state, league, rec);
  if (ctx.season) state.sync[league].statSeason = ctx.season;
  return byId.size;
}

async function loadSeasonRecords(league, forceSeason, progress, ctx = {}) {
  const byId = new Map();
  let season = forceSeason;
  for (const category of SEASON_CATEGORIES[league]) {
    let first;
    try { first = await api.seasonStats(league, { category, season }); } catch { continue; }
    // In the off-season the current season is empty: use the previous one.
    if (!season && !forceSeason && (first.pagination?.count || 0) < 40) {
      const yr = first.requestedSeason?.year || first.currentSeason?.year;
      if (yr) {
        season = yr - 1;
        try { first = await api.seasonStats(league, { category, season }); } catch { continue; }
      }
    } else if (!season) {
      season = first.requestedSeason?.year || null;
    }
    const pages = Math.min(first.pagination?.pages || 1, 8);
    const rest = await pool(Array.from({ length: pages - 1 }, (_, i) => i + 2), 3,
      (page) => api.seasonStats(league, { category, season, page }));
    for (const json of [first, ...rest]) {
      if (!json || json.error) continue;
      for (const rec of parseSeasonAthletes(league, json)) if (!byId.has(rec.id)) byId.set(rec.id, rec);
    }
    if (!forceSeason) progress?.(`${LEAGUES[league].name}: ${byId.size} players listed`);
  }
  ctx.season = season;
  return byId;
}

async function loadScoreboards(league, fromTs, toTs) {
  const days = etDays(fromTs, toTs);
  const res = await pool(days, 4, (d) => api.scoreboard(league, d));
  const events = new Map();
  for (const json of res) {
    if (!json || json.error) continue;
    for (const ev of parseScoreboard(league, json)) events.set(ev.id, ev);
  }
  return [...events.values()].sort((a, b) => a.date - b.date);
}

async function withBox(league, events, progress, label) {
  let done = 0;
  return pool(events, 5, async (ev) => {
    let players = [];
    try { players = parseBoxScore(league, await api.summary(league, ev.id)); } catch { /* team result still counts */ }
    done++;
    if (progress && events.length > 3) progress(`${label} ${done}/${events.length}`);
    return { ...ev, players };
  });
}

// ---------- first launch for a league ----------

async function firstRun(state, league, progress, now) {
  const L = LEAGUES[league];
  progress(`${L.name}: loading standings`);
  await loadStandings(state, league);
  progress(`${L.name}: loading season stats`);
  await loadSeasonStats(state, league, progress);
  await loadPriors(state, league, progress);
  initForm(state, league, { all: true });

  const t0 = now - L.backfillDays * DAY;
  progress(`${L.name}: loading recent games`);
  const events = await loadScoreboards(league, t0, now);
  const finals = events.filter((e) => e.completed && e.date >= t0 - DAY);
  rewindTeamRecords(state, league, finals);
  repriceLeague(state, league, now, { at: t0 }); // opening prices ("IPO")

  const boxed = await withBox(league, finals, progress, `${L.name}: replaying games`);
  for (const g of boxed) if (g && !g.error) applyFinalGame(state, league, g, { now, backfill: true });

  await liveGames(state, league, events, now);
  await newsAndInjuries(state, league, now, true);
  await loadSchedule(state, league, now);
  repriceLeague(state, league, now);
  const s = state.sync[league];
  Object.assign(s, { seeded: true, scoreboard: now, standings: now });
}

// Upcoming games for the next few days (shown as "next game" and before option expiries).
async function loadSchedule(state, league, now) {
  const s = state.sync[league];
  if (now - (s.schedule || 0) < 30 * MIN) return;
  try {
    const events = await loadScoreboards(league, now, now + 4 * DAY);
    state.schedule[league] = events.filter((e) => e.state === 'pre' && e.date > now - HOUR).slice(0, 120)
      .map((e) => ({ id: e.id, date: e.date, name: e.name, preseason: e.preseason, teams: e.teams.map((t) => ({ id: t.id, abbr: t.abbr, home: t.home })) }));
    s.schedule = now; s.scheduleTo = now + 4 * DAY;
  } catch { /* optional */ }
}

async function liveGames(state, league, events, now) {
  const live = events.filter((e) => e.state === 'in');
  const boxed = await withBox(league, live);
  for (const g of boxed) if (g && !g.error) applyLiveGame(state, league, g, { now });
  return live.length;
}

async function newsAndInjuries(state, league, now, force) {
  const s = state.sync[league];
  if (force || now - (s.injuries || 0) > 20 * MIN) {
    try { applyInjuries(state, league, parseInjuries(await api.injuries(league)), { now }); s.injuries = now; } catch { /* optional feed */ }
  }
  if (force || now - (s.news || 0) > 10 * MIN) {
    try { applyNews(state, league, parseNews(league, await api.news(league)), { now }); s.news = now; } catch { /* optional feed */ }
  }
}

// ---------- regular refresh ----------

async function refresh(state, league, progress, now, { liveOnly = false } = {}) {
  const L = LEAGUES[league];
  const s = state.sync[league];
  const from = liveOnly ? now - 6 * HOUR : Math.max((s.scoreboard || now) - DAY, now - 10 * DAY);
  const events = await loadScoreboards(league, from, now);
  const finals = events.filter((e) => e.completed && !state.games[e.id]?.final);
  if (finals.length) {
    const boxed = await withBox(league, finals, progress, `${L.name}: new results`);
    for (const g of boxed) {
      if (!g || g.error) continue;
      applyFinalGame(state, league, g, { now, at: Math.min(now, g.date + L.gameHours * HOUR) });
    }
  }
  const liveCount = await liveGames(state, league, events, now);
  if (!liveOnly) {
    // Standings after games so a just-finished game isn't counted twice. The rest in parallel.
    await Promise.all([
      loadStandings(state, league).then(() => { s.standings = now; }).catch(() => { /* keep last */ }),
      newsAndInjuries(state, league, now, false),
      loadSchedule(state, league, now),
    ]);
    s.scoreboard = now;
  }
  clearStaleLive(state, now);
  repriceLeague(state, league, now, { record: false });
  return { finals: finals.length, live: liveCount };
}

export async function syncLeague(state, league, { progress = () => {}, now = Date.now(), liveOnly = false } = {}) {
  state.sync[league] ||= {};
  if (!state.sync[league].seeded) {
    if (liveOnly) return { finals: 0, live: 0 };
    await firstRun(state, league, progress, now);
    return { finals: 0, live: Object.keys(state.liveGames).length, first: true };
  }
  const r = await refresh(state, league, progress, now, { liveOnly });
  const s = state.sync[league];
  if (!liveOnly && (s.priorV !== MODEL_V || (s.season && s.priorSeason !== s.season))) await reseedSeason(state, league, now);
  else if (!liveOnly && !s.avgV) {
    // Per-stat season averages (for prop lines) weren't kept by older versions.
    try { await loadSeasonStats(state, league, null); initForm(state, league); s.avgV = 1; } catch { /* next time */ }
  }
  return r;
}

// Once per season (and once for saves made before last-season priors existed): reload
// season averages and last season's numbers, then reprice at equal value for holders.
async function reseedSeason(state, league, now) {
  try {
    await loadSeasonStats(state, league, null);
    await loadPriors(state, league, null);
  } catch { return; }
  withRebase(state, now, () => {
    initForm(state, league, { all: true, fromSeason: true });
    repriceLeague(state, league, now, { record: false });
  });
}

export const hasLive = (state, league) => Object.values(state.liveGames).some((g) => g.league === league);
