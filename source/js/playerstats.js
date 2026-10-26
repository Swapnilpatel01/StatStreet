// Player stats by season: last season, this season and a projection for next season.
// Data is ESPN's per-athlete stats page (one row per season, per category such as
// "Averages", "Passing" or "Batting"). Pure functions, so it can be tested in Node.

// The season a date belongs to, in ESPN's numbering: NBA seasons are named for the year
// they end in (2025-26 is 2026); NFL and MLB seasons for the year they start in.
export function seasonYear(league, now = Date.now()) {
  const d = new Date(now); const y = d.getFullYear(); const m = d.getMonth() + 1;
  if (league === 'nba') return m >= 9 ? y + 1 : y;        // new NBA season from training camp
  if (league === 'nfl') return m >= 3 ? y : y - 1;         // Jan-Feb playoffs belong to last year's season
  return m >= 2 ? y : y - 1;                               // MLB: from spring training
}
// "2025-26" for the NBA, "2026" otherwise.
export const seasonName = (league, year) => (league === 'nba' ? `${year - 1}-${String(year).slice(2)}` : String(year));

const num = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/,/g, '').trim();
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(t);
};
const decimals = (s) => { const m = String(s).replace(/,/g, '').match(/\.(\d+)$/); return m ? m[1].length : 0; };

// ESPN's athlete stats JSON → [{ key, name, labels, names, rows: [{ year, season, team, gp, values }] }].
// Rows for the same season (a mid-season trade) are kept separately; `team` tells them apart,
// and a combined row (no team, or "TOT") is preferred when picking one row per season.
export function parseCareerStats(league, json) {
  const cats = [];
  for (const c of json?.categories || []) {
    const labels = c.labels || c.displayNames || c.names || [];
    const names = c.names || labels;
    if (!labels.length) continue;
    const rows = [];
    for (const r of c.statistics || []) {
      const year = Number(r.season?.year ?? r.year);
      if (!year || !Array.isArray(r.stats)) continue;
      const team = r.teamSlug || r.teamId || r.team?.abbreviation || '';
      const abbr = r.team?.abbreviation || r.teamAbbreviation || '';
      rows.push({ year, season: r.season?.displayName || seasonName(league, year), team: String(team), abbr, values: r.stats.map((v) => (v == null ? '' : String(v))) });
    }
    if (!rows.length) continue;
    const gi = gpIndex(labels, names);
    for (const r of rows) r.gp = gi >= 0 ? num(r.values[gi]) : null;
    rows.sort((x, y) => x.year - y.year);
    cats.push({ key: c.name || labels.join('|'), name: c.displayName || titleCase(c.name || 'Stats'), labels, names, full: c.displayNames || c.descriptions || names, rows, totals: Array.isArray(c.totals) ? c.totals.map(String) : null });
  }
  return cats;
}
const titleCase = (s) => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
function gpIndex(labels, names) {
  let i = names.findIndex((n) => /^gamesPlayed$/i.test(n));
  if (i < 0) i = labels.findIndex((l) => /^(GP|G)$/i.test(String(l).trim()));
  return i;
}

// One row per season: a combined row if the player was traded mid-season, else the sum of games.
export function seasonRow(cat, year) {
  const rs = cat.rows.filter((r) => r.year === year);
  if (!rs.length) return null;
  if (rs.length === 1) return rs[0];
  const tot = rs.find((r) => !r.team || /^(tot|total)$/i.test(r.abbr || r.team));
  if (tot) return tot;
  // No combined row: take the stint with the most games (the table shows every stint anyway).
  return rs.slice().sort((x, y) => (y.gp || 0) - (x.gp || 0))[0];
}

const SEASON_GAMES = { nba: 82, nfl: 17, mlb: 162 };
// Columns that are already a rate (a percentage, an average, a per-game number): averaged, not scaled.
const RATE = /%|AVG|ERA|WHIP|OBP|SLG|OPS|RTG|QBR|\/G|Y\/A|Y\/R|Y\/C|LNG|LONG|^MIN$|PCT|K\/9|BB\/9|WAR/i;
// Columns that don't project (games started, ages, ranks): left blank in the projection.
const SKIP = /^(GS|AGE|RK|RANK)$/i;

// A projection for next season, in the spirit of Tom Tango's Marcel: the last three seasons
// weighted 5-4-3 (each also weighted by how many games it covers, so a half-finished season
// counts for its share), with a small age adjustment. Totals columns are projected as a
// per-game rate times projected games; rate columns are averaged directly.
export function projectNext(league, cat, { now = Date.now(), age = null } = {}) {
  const cur = seasonYear(league, now);
  const W = [5, 4, 3];
  const full = SEASON_GAMES[league] || 82;
  const seasons = [cur, cur - 1, cur - 2].map((y) => seasonRow(cat, y));
  if (!seasons.some(Boolean)) return null;
  const gi = gpIndex(cat.labels, cat.names);
  const perGameCat = /average|per ?game/i.test(`${cat.key} ${cat.name}`) || gi < 0;
  // How much each season counts.
  const wts = seasons.map((r, i) => {
    if (!r) return 0;
    const gp = r.gp ?? full;
    const share = Math.min(1, gp / full);
    return W[i] * Math.max(share, gp > 0 ? 0.05 : 0);
  });
  const wsum = wts.reduce((s, w) => s + w, 0);
  if (!(wsum > 0)) return null;
  // Games played next season: the full-season games he's averaged (this season counts at its pace).
  let gpProj = null;
  if (gi >= 0) {
    let n = 0; let d = 0;
    seasons.forEach((r, i) => {
      if (!r || r.gp == null) return;
      const isCur = i === 0;
      // A season still in progress is projected to its full length at the current pace,
      // except early on, when it says little: then lean on past seasons.
      const g = isCur ? Math.min(full, r.gp / Math.max(seasonShare(league, now), 0.05)) : r.gp;
      const w = W[i] * (isCur ? Math.min(1, seasonShare(league, now) * 2) : 1);
      n += g * w; d += w;
    });
    gpProj = d > 0 ? Math.round(Math.min(full, n / d)) : null;
  }
  const ageMult = age == null ? 1 : age < 28 ? 1 + 0.006 * (28 - age) * 2 : 1 - 0.003 * (age - 28) * 2;
  const values = cat.labels.map((lab, j) => {
    if (j === gi) return gpProj != null ? String(gpProj) : '';
    if (SKIP.test(String(lab).trim())) return '';
    const sample = seasons.find((r) => r && r.values[j] != null && r.values[j] !== '')?.values[j];
    if (sample == null) return '';
    // "made-attempted" pairs such as 10.2-20.2: project each side.
    if (/^\d+(\.\d+)?-\d+(\.\d+)?$/.test(sample)) {
      const parts = [0, 1].map((k) => blend(seasons, wts, (r) => { const m = String(r.values[j]).split('-'); return m.length === 2 ? num(m[k]) : null; }, perGameCat, gi));
      if (parts.some((p) => p == null)) return '';
      const dp = decimals(sample.split('-')[0]);
      return parts.map((p) => scale(p, perGameCat, gpProj, ageMult).toFixed(dp)).join('-');
    }
    if (num(sample) == null) return '';
    const isRate = RATE.test(String(lab)) || /percent|average|perGame|pct/i.test(cat.names[j] || '');
    const v = blend(seasons, wts, (r) => num(r.values[j]), perGameCat || isRate, gi);
    if (v == null) return '';
    const out = isRate ? v : scale(v, perGameCat, gpProj, ageMult); // age only scales volume, never a rate like ERA
    const dp = decimals(sample);
    return isRate && /^\.\d+$/.test(sample) ? out.toFixed(dp).replace(/^0(?=\.)/, '') : out.toFixed(dp);
  });
  return { year: cur + 1, season: seasonName(league, cur + 1), values, gp: gpProj, projected: true };
}
// Weighted average of a column. For totals tables the column is turned into a per-game rate first.
function blend(seasons, wts, get, perGame, gi) {
  let n = 0; let d = 0;
  seasons.forEach((r, i) => {
    if (!r || !wts[i]) return;
    let v = get(r);
    if (v == null) return;
    if (!perGame) { if (!(r.gp > 0)) return; v /= r.gp; }
    n += v * wts[i]; d += wts[i];
  });
  return d > 0 ? n / d : null;
}
const scale = (rate, perGame, gp, ageMult) => (perGame ? rate * ageMult : rate * (gp ?? 0) * ageMult);

// How far through the regular season we are (0 at the opener, 1 at the end).
const SPAN = { nba: [[10, 21], [4, 12]], nfl: [[9, 4], [1, 4]], mlb: [[3, 26], [9, 28]] };
export function seasonShare(league, now = Date.now()) {
  const sp = SPAN[league]; if (!sp) return 0.5;
  const d = new Date(now); const y = d.getFullYear();
  let start = new Date(y, sp[0][0] - 1, sp[0][1]).getTime();
  let end = new Date(sp[1][0] < sp[0][0] ? y + 1 : y, sp[1][0] - 1, sp[1][1]).getTime();
  if (now < start && sp[1][0] < sp[0][0]) { start = new Date(y - 1, sp[0][0] - 1, sp[0][1]).getTime(); end = new Date(y, sp[1][0] - 1, sp[1][1]).getTime(); }
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
}

// Everything the Stats tab shows for one category.
export function statsView(league, cat, opts = {}) {
  const cur = seasonYear(league, opts.now);
  return {
    last: seasonRow(cat, cur - 1), now: seasonRow(cat, cur), next: projectNext(league, cat, opts),
    lastName: seasonName(league, cur - 1), nowName: seasonName(league, cur), nextName: seasonName(league, cur + 1),
  };
}

// Pick the categories worth showing first for a position (ESPN lists every one a player has).
export function orderCats(league, cats, pos = '') {
  const pref = league === 'nfl'
    ? ({ QB: ['passing', 'rushing'], RB: ['rushing', 'receiving'], WR: ['receiving'], TE: ['receiving'], K: ['kicking'], P: ['punting'] }[pos] || ['defensive', 'defense'])
    : league === 'mlb' ? (/P$/.test(pos) ? ['pitching'] : ['batting']) : ['averages'];
  const rank = (c) => { const i = pref.findIndex((p) => new RegExp(p, 'i').test(c.key)); return i < 0 ? 99 : i; };
  return cats.slice().sort((x, y) => rank(x) - rank(y));
}
