// Orchestrates data pulls for each league and feeds them to the engine.

import { api, SEASON_CATEGORIES } from './api.js';
import { LEAGUES, parseStandings, parseSeasonAthletes, parseScoreboard, parseBoxScore, parseInjuries, parseNews } from './scoring.js';
import {
  upsertTeam, seedPlayer, repriceLeague, rewindTeamRecords, applyFinalGame, applyLiveGame,
  applyNews, applyInjuries, clearStaleLive,
} from './engine.js';
import { etDays, pool, HOUR, DAY } from './util.js';

const MIN = 60e3;

async function loadStandings(state, league) {
  const json = await api.standings(league);
  let teams = parseStandings(league, json);
  if (teams.length && teams.every((t) => t.gp === 0)) {
    // New season hasn't started: fall back to last season as a prior.
    const season = findSeason(json);
    if (season) {
      try {
        const prev = parseStandings(league, await api.standings(league, season - 1));
        if (prev.length) teams = prev.map((t) => ({ ...t, prior: true }));
      } catch { /* keep zeros */ }
    }
  }
  for (const t of teams) upsertTeam(state, league, t);
  return teams.length;
}

function findSeason(json) {
  let found = null;
  const walk = (n) => { if (!n || found) return; if (n.standings?.season) found = n.standings.season; (n.children || []).forEach(walk); };
  walk(json);
  return found || json.season?.year || null;
}

async function loadSeasonStats(state, league, progress) {
  const byId = new Map();
  let season = null;
  for (const category of SEASON_CATEGORIES[league]) {
    let first;
    try { first = await api.seasonStats(league, { category, season }); } catch { continue; }
    // In the off-season the current season is empty: use the previous one.
    if (!season && (first.pagination?.count || 0) < 40) {
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
    progress?.(`${LEAGUES[league].name}: ${byId.size} players listed`);
  }
  for (const rec of byId.values()) seedPlayer(state, league, rec);
  return byId.size;
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
  repriceLeague(state, league, now);
  const s = state.sync[league];
  Object.assign(s, { seeded: true, scoreboard: now, standings: now });
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
    // Standings after games so a just-finished game isn't counted twice.
    try { await loadStandings(state, league); s.standings = now; } catch { /* keep last */ }
    await newsAndInjuries(state, league, now, false);
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
  return refresh(state, league, progress, now, { liveOnly });
}

export const hasLive = (state, league) => Object.values(state.liveGames).some((g) => g.league === league);
