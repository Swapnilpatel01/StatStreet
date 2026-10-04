// Turns raw ESPN JSON into normalized records, and scores performances.
// Pure functions only, so they can be unit tested in Node.

import { num, pair, innings, clamp } from './util.js';

export const LEAGUES = {
  nba: { key: 'nba', name: 'NBA', path: 'basketball/nba', alpha: 0.15, gameHours: 2.5, backfillDays: 5, regress: 12, color: '#f97316' },
  nfl: { key: 'nfl', name: 'NFL', path: 'football/nfl', alpha: 0.22, gameHours: 3.25, backfillDays: 20, regress: 4, color: '#22c55e' },
  mlb: { key: 'mlb', name: 'MLB', path: 'baseball/mlb', alpha: 0.1, gameHours: 3, backfillDays: 3, regress: 25, color: '#3b82f6' },
};

// ---------- Position groups (players are compared against their own group) ----------

const NFL_GROUPS = {
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'WR',
  K: 'K', PK: 'K', P: 'K',
};

export function posGroup(league, pos) {
  const p = String(pos || '').toUpperCase();
  if (league === 'nba') return 'ALL';
  if (league === 'mlb') return ['SP', 'RP', 'P'].includes(p) ? 'P' : 'H';
  if (NFL_GROUPS[p]) return NFL_GROUPS[p];
  if (['OT', 'OG', 'G', 'T', 'C', 'OL', 'LS'].includes(p)) return 'OL';
  return 'DEF';
}

// Positional "market cap" multiplier: a franchise QB is worth more than an elite kicker.
export function posMultiplier(league, pos) {
  const p = String(pos || '').toUpperCase();
  if (league === 'nba') return 1.25;
  if (league === 'mlb') return p === 'SP' ? 1.15 : p === 'RP' ? 0.75 : p === 'P' ? 0.95 : 1.0;
  return { QB: 1.7, RB: 1.15, WR: 1.15, DEF: 0.85, K: 0.55, OL: 0.6 }[posGroup('nfl', p)] ?? 0.8;
}

// ---------- Game scores ----------
// Each sport gets one formula used for both season averages and single games,
// so a player's season baseline and his box scores are on the same scale.

export function gameScore(league, l) {
  if (league === 'nba') {
    return l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.4 * l.reb
      + l.stl + 0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.to;
  }
  if (league === 'nfl') {
    return l.passYds / 25 + 4 * l.passTD - 2 * l.int + l.rushYds / 10 + 6 * l.rushTD
      + 0.5 * l.rec + l.recYds / 10 + 6 * l.recTD - 2 * l.fumLost
      + l.tkl + 3 * l.sacks + 4 * l.defInt + l.pd + 6 * l.defTD + 3 * l.fg + l.xp;
  }
  // MLB: hitters and pitchers both scored; two-way players get both.
  const bat = l.h + 2 * l.hr + l.r + l.rbi + 0.8 * l.bb - 0.3 * l.k - 0.25 * Math.max(0, l.ab - l.h);
  const pit = l.ip > 0 ? 2.25 * l.ip + l.pk - 2 * l.er - 0.6 * (l.ph + l.pbb) : 0;
  return bat + pit;
}

// ---------- Performance rating for one game ----------
// A rating for a single game from its stat line, on the scale the Real app uses: about 1 for a
// quiet game, 4–6 for a good one, 8+ for a monster, a little below zero for an empty one.
// Real builds its rating play by play (how close the game was, when the play came, how much
// it mattered), which a box score can't see, so this is a fit to ratings Real showed for known
// stat lines (test/rating.test.mjs), not their formula. Expect to be within about a point.
//
//   fantasy points (fp):
//     NFL   pass yds/25 + 4·pass TD − 2·INT + (rush + rec yds)/10 + 6·TD + 1·catch − 2·fumble + 3·FG + XP
//     NBA   pts + 1.2·reb + 1.5·ast + 3·stl + 3·blk − TO
//     MLB hitter   H + 2·HR + R + RBI + BB − 0.25·outs
//     MLB pitcher  2·IP + 2·K − 3·ER − 0.6·(H + BB)
//   rating:
//     NFL backs, receivers, kickers   0.068 · fp^1.3      (9 fp → 1.2, 18 → 3.0, 26 → 4.8, 42 → 8.8)
//     NFL quarterbacks                0.185 · fp          (8 fp → 1.5, 18 → 3.3, 36 → 6.7)
//     NFL defenders                   1.4·sack + 3.5·INT + 0.2·tackle + 0.5·pass defended + 5·TD
//     NBA                             0.1 · fp − 0.9      (48 fp → 3.9, 56 → 4.7, 78 → 6.9)
//     MLB hitter                      0.55 · fp up to 7 fp, then 0.22 a point   (−1 → −0.6, 5 → 2.8)
//     MLB pitcher                     0.8 + 0.235 · fp    (14 fp → 4.1, 33 → 8.6)
const mlbIp = (ip) => Math.floor(ip) + ((ip % 1) * 10) / 3; // 6.2 innings is 6⅔
export function perfRating(league, l) {
  let r;
  if (league === 'nba') {
    const fp = l.pts + 1.2 * l.reb + 1.5 * l.ast + 3 * l.stl + 3 * l.blk - l.to;
    r = Math.max(0.02 * fp, 0.1 * fp - 0.9);
  } else if (league === 'nfl') {
    const fp = l.passYds / 25 + 4 * l.passTD - 2 * l.int + (l.rushYds + l.recYds) / 10 + 6 * (l.rushTD + l.recTD) + l.rec - 2 * l.fumLost + 3 * l.fg + l.xp;
    const off = l.att >= 10 ? 0.185 * fp : fp > 0 ? 0.068 * fp ** 1.3 : 0.1 * fp;
    const defended = l.tkl > 0 || l.sacks > 0 || l.defInt > 0 || l.pd > 0 || l.defTD > 0;
    const def = 1.4 * l.sacks + 3.5 * l.defInt + 0.2 * l.tkl + 0.5 * l.pd + 5 * l.defTD;
    r = defended ? Math.max(off, def) : off;
  } else {
    const batted = l.ab > 0 || l.bb > 0;
    const bfp = l.h + 2 * l.hr + l.r + l.rbi + l.bb - 0.25 * Math.max(0, l.ab - l.h);
    const bat = bfp <= 7 ? 0.55 * bfp : 3.85 + 0.22 * (bfp - 7);
    const pit = l.ip > 0 ? 0.8 + 0.235 * (2 * mlbIp(l.ip) + 2 * l.pk - 3 * l.er - 0.6 * (l.ph + l.pbb)) : null;
    r = pit != null && batted ? Math.max(pit, bat) : pit != null ? pit : bat;
  }
  return Math.round(Math.max(-2, Math.min(15, r)) * 10) / 10;
}

export function emptyLine(league) {
  if (league === 'nba') return { min: 0, pts: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 };
  if (league === 'nfl') return { passYds: 0, passTD: 0, int: 0, cmp: 0, att: 0, rushYds: 0, rushTD: 0, car: 0, rec: 0, recYds: 0, recTD: 0, fumLost: 0, tkl: 0, sacks: 0, defInt: 0, pd: 0, defTD: 0, fg: 0, xp: 0 };
  return { ab: 0, h: 0, r: 0, rbi: 0, hr: 0, bb: 0, k: 0, ip: 0, ph: 0, er: 0, pbb: 0, pk: 0 };
}

// Short human-readable stat line for event logs.
export function lineText(league, l) {
  if (league === 'nba') {
    return `${l.pts} PTS · ${l.reb} REB · ${l.ast} AST` + (l.stl + l.blk >= 3 ? ` · ${l.stl} STL · ${l.blk} BLK` : '');
  }
  if (league === 'nfl') {
    const bits = [];
    if (l.att > 0) bits.push(`${l.cmp}/${l.att} · ${l.passYds} YDS · ${l.passTD} TD` + (l.int ? ` · ${l.int} INT` : ''));
    if (l.car > 0) bits.push(`${l.car} CAR · ${l.rushYds} YDS` + (l.rushTD ? ` · ${l.rushTD} TD` : ''));
    if (l.rec > 0) bits.push(`${l.rec} REC · ${l.recYds} YDS` + (l.recTD ? ` · ${l.recTD} TD` : ''));
    if (l.tkl > 0 || l.sacks > 0 || l.defInt > 0) bits.push(`${l.tkl} TKL` + (l.sacks ? ` · ${l.sacks} SCK` : '') + (l.defInt ? ` · ${l.defInt} INT` : ''));
    if (l.fg > 0 || l.xp > 0) bits.push(`${l.fg} FG · ${l.xp} XP`);
    return bits.slice(0, 2).join(' | ') || 'No stats';
  }
  const bits = [];
  if (l.ab > 0) bits.push(`${l.h}-${l.ab}` + (l.hr ? ` · ${l.hr} HR` : '') + (l.rbi ? ` · ${l.rbi} RBI` : '') + (l.bb ? ` · ${l.bb} BB` : ''));
  if (l.ip > 0) bits.push(`${fmtIP(l.ip)} IP · ${l.pk} K · ${l.er} ER`);
  return bits.join(' | ') || 'No stats';
}

const fmtIP = (ip) => `${Math.floor(ip)}.${Math.round((ip % 1) * 3)}`;

// Detects standout / record-type performances. Returns a label or null.
export function milestone(league, l) {
  if (league === 'nba') {
    const dd = [l.pts, l.reb, l.ast, l.stl, l.blk].filter((x) => x >= 10).length;
    if (l.pts >= 50) return `${l.pts}-point explosion`;
    if (dd >= 3) return 'Triple-double';
    if (l.pts >= 40) return `${l.pts}-point game`;
    return null;
  }
  if (league === 'nfl') {
    if (l.passTD >= 5) return `${l.passTD} TD passes`;
    if (l.passYds >= 400) return `${l.passYds} passing yards`;
    if (l.rushYds >= 175) return `${l.rushYds} rushing yards`;
    if (l.recYds >= 175) return `${l.recYds} receiving yards`;
    if (l.rushTD + l.recTD >= 3) return `${l.rushTD + l.recTD} touchdowns`;
    if (l.sacks >= 3) return `${l.sacks} sacks`;
    if (l.defInt >= 2) return `${l.defInt} interceptions`;
    return null;
  }
  if (l.ip >= 9 && l.ph === 0) return 'No-hitter';
  if (l.hr >= 3) return `${l.hr}-homer game`;
  if (l.pk >= 13) return `${l.pk} strikeouts`;
  if (l.ip >= 7 && l.er === 0 && l.ph <= 2) return 'Dominant start';
  if (l.h >= 5) return `${l.h}-hit game`;
  return null;
}

// ---------- ESPN parsers ----------

export function parseStandings(league, json) {
  const entries = [];
  const walk = (node) => {
    if (!node) return;
    if (node.standings?.entries) entries.push(...node.standings.entries);
    (node.children || []).forEach(walk);
  };
  walk(json);
  const seen = new Set();
  return entries.filter((e) => e.team && !seen.has(e.team.id) && seen.add(e.team.id)).map((e) => {
    const s = {};
    for (const st of e.stats || []) if (st.name && st.value != null) s[st.name] = st.value;
    const logo = (e.team.logos || []).find((l) => (l.rel || []).includes('default'))?.href || e.team.logos?.[0]?.href || '';
    const gp = s.gamesPlayed ?? (num(s.wins) + num(s.losses) + num(s.ties));
    return {
      id: String(e.team.id), abbr: e.team.abbreviation, name: e.team.displayName, short: e.team.shortDisplayName || e.team.name,
      logo, w: num(s.wins), l: num(s.losses), t: num(s.ties), gp: num(gp),
      diff: num(s.pointDifferential ?? (s.differential != null ? s.differential * gp : 0)),
      streak: num(s.streak), playoffPct: s.playoffPercent != null ? num(s.playoffPercent) : null,
    };
  });
}

// Season stats from the "byathlete" endpoint -> per-game line.
export function parseSeasonAthletes(league, json) {
  const cats = json.categories || [];
  const out = [];
  for (const row of json.athletes || []) {
    const a = row.athlete || {};
    const d = {};
    for (const c of row.categories || []) {
      const def = cats.find((x) => x.name === c.name);
      if (!def) continue;
      const cname = String(c.name).toLowerCase();
      def.names.forEach((n, i) => {
        const v = c.values?.[i];
        if (v != null && d[`${cname}.${n}`] == null) d[`${cname}.${n}`] = v;
      });
    }
    const g = (k) => num(d[k]);
    const gp = Math.max(g('general.gamesPlayed'), g('batting.gamesPlayed'), g('pitching.gamesPlayed'));
    if (!gp) continue;
    const l = emptyLine(league);
    let keep = true;
    if (league === 'nba') {
      Object.assign(l, {
        min: g('general.minutes') / gp, pts: g('offensive.points') / gp, fgm: g('offensive.fieldGoalsMade') / gp,
        fga: g('offensive.fieldGoalsAttempted') / gp, ftm: g('offensive.freeThrowsMade') / gp, fta: g('offensive.freeThrowsAttempted') / gp,
        reb: g('general.rebounds') / gp, ast: g('offensive.assists') / gp, stl: g('defensive.steals') / gp,
        blk: g('defensive.blocks') / gp, to: g('offensive.turnovers') / gp, pf: g('general.fouls') / gp,
      });
      keep = l.min >= 8 && gp >= 5;
    } else if (league === 'nfl') {
      Object.assign(l, {
        passYds: g('passing.passingYards') / gp, passTD: g('passing.passingTouchdowns') / gp, int: g('passing.interceptions') / gp,
        att: g('passing.passingAttempts') / gp, cmp: g('passing.completions') / gp,
        rushYds: g('rushing.rushingYards') / gp, rushTD: g('rushing.rushingTouchdowns') / gp, car: g('rushing.rushingAttempts') / gp,
        rec: g('receiving.receptions') / gp, recYds: g('receiving.receivingYards') / gp, recTD: g('receiving.receivingTouchdowns') / gp,
        fumLost: (g('rushing.rushingFumblesLost') + g('receiving.receivingFumblesLost')) / gp,
        tkl: g('defensive.totalTackles') / gp, sacks: g('defensive.sacks') / gp, pd: g('defensive.passesDefended') / gp,
        defInt: g('defensiveinterceptions.interceptions') / gp, defTD: g('defensiveinterceptions.interceptionTouchdowns') / gp,
        fg: g('kicking.fieldGoalsMade') / gp, xp: g('kicking.extraPointsMade') / gp,
      });
    } else {
      Object.assign(l, {
        ab: g('batting.atBats') / gp, h: g('batting.hits') / gp, r: g('batting.runs') / gp, rbi: g('batting.RBIs') / gp,
        hr: g('batting.homeRuns') / gp, bb: g('batting.walks') / gp, k: g('batting.strikeouts') / gp,
        ip: innings(d['pitching.innings']) / gp, ph: g('pitching.hits') / gp, er: g('pitching.earnedRuns') / gp,
        pbb: g('pitching.walks') / gp, pk: g('pitching.strikeouts') / gp,
      });
      keep = g('batting.atBats') >= 20 || innings(d['pitching.innings']) >= 5;
    }
    const gs = gameScore(league, l);
    if (league === 'nfl') keep = gs >= 1.5; // filters out special-teamers with one tackle
    if (!keep) continue;
    out.push({
      id: String(a.id), name: a.displayName, first: a.firstName, last: a.lastName,
      pos: a.position?.abbreviation || '', teamId: a.teamId ? String(a.teamId) : '', teamAbbr: a.teamShortName || '',
      img: a.headshot?.href || '', gp, gs, line: l,
    });
  }
  return out;
}

export function parseScoreboard(league, json) {
  return (json.events || []).map((ev) => {
    const comp = ev.competitions?.[0] || {};
    const st = ev.status?.type || comp.status?.type || {};
    const status = ev.status || comp.status || {};
    return {
      id: String(ev.id), date: Date.parse(ev.date), name: ev.shortName || ev.name,
      preseason: (ev.season?.type ?? 2) === 1,
      state: st.state, completed: !!st.completed, detail: st.shortDetail || st.detail || '',
      period: num(status.period), clock: status.displayClock || '',
      regPeriods: comp.format?.regulation?.periods || (league === 'mlb' ? 9 : 4),
      teams: (comp.competitors || []).map((c) => ({
        id: String(c.team?.id ?? c.id), abbr: c.team?.abbreviation, score: num(c.score),
        winner: c.winner === true, home: c.homeAway === 'home', logo: c.team?.logo || '', color: /^[0-9a-f]{6}$/i.test(c.team?.color || '') ? c.team.color : '',
        lines: (c.linescores || []).map((l) => num(l.value ?? l.displayValue)),
        ...(c.probables ? { probables: c.probables.map((p) => String(p.athlete?.id ?? p.playerId ?? '')).filter(Boolean) } : {}),
      })),
    };
  });
}

// Box score from the "summary" endpoint -> list of player lines.
export function parseBoxScore(league, json) {
  const players = new Map();
  for (const side of json.boxscore?.players || []) {
    const teamId = String(side.team?.id ?? '');
    const teamAbbr = side.team?.abbreviation || '';
    for (const cat of side.statistics || []) {
      const labels = (cat.labels || []).map((x) => String(x).toUpperCase());
      const catName = String(cat.name || cat.type || '').toLowerCase();
      for (const row of cat.athletes || []) {
        const a = row.athlete;
        if (!a || !row.stats?.length || row.didNotPlay) continue;
        const id = String(a.id);
        if (!players.has(id)) {
          players.set(id, {
            id, name: a.displayName, pos: a.position?.abbreviation || '', teamId, teamAbbr,
            img: a.headshot?.href || '', line: emptyLine(league),
          });
        }
        const l = players.get(id).line;
        const v = (lab) => row.stats[labels.indexOf(lab)];
        const has = (lab) => labels.includes(lab);
        if (league === 'nba') {
          const [fgm, fga] = pair(v('FG')); const [ftm, fta] = pair(v('FT'));
          Object.assign(l, {
            min: num(v('MIN')), pts: num(v('PTS')), fgm, fga, ftm, fta, reb: num(v('REB')), ast: num(v('AST')),
            stl: num(v('STL')), blk: num(v('BLK')), to: num(v('TO')), pf: num(v('PF')),
          });
        } else if (league === 'nfl') {
          if (catName === 'passing') { const [c, at] = pair(v('C/ATT')); l.cmp += c; l.att += at; l.passYds += num(v('YDS')); l.passTD += num(v('TD')); l.int += num(v('INT')); }
          else if (catName === 'rushing') { l.car += num(v('CAR')); l.rushYds += num(v('YDS')); l.rushTD += num(v('TD')); }
          else if (catName === 'receiving') { l.rec += num(v('REC')); l.recYds += num(v('YDS')); l.recTD += num(v('TD')); }
          else if (catName === 'fumbles') { l.fumLost += num(v('LOST')); }
          else if (catName === 'defensive') { l.tkl += num(v('TOT')); l.sacks += num(v('SACKS')); l.pd += num(v('PD')); l.defTD += num(v('TD')); }
          else if (catName === 'interceptions') { l.defInt += num(v('INT')); l.defTD += num(v('TD')); }
          else if (catName === 'kicking') { l.fg += pair(v('FG'))[0]; l.xp += pair(v('XP'))[0]; }
        } else {
          if (has('IP')) {
            l.ip += innings(v('IP')); l.ph += num(v('H')); l.er += num(v('ER')); l.pbb += num(v('BB')); l.pk += num(v('K'));
          } else if (has('AB')) {
            l.ab += num(v('AB')); l.h += num(v('H')); l.r += num(v('R')); l.rbi += num(v('RBI'));
            l.hr += num(v('HR')); l.bb += num(v('BB')); l.k += num(v('K'));
          }
        }
      }
    }
  }
  const list = [...players.values()];
  if (league === 'nba') return list.filter((p) => p.line.min > 0);
  if (league === 'nfl') return list.filter((p) => gameScore('nfl', p.line) !== 0 || p.line.att > 0 || p.line.car > 0 || p.line.rec > 0);
  return list.filter((p) => p.line.ab > 0 || p.line.ip > 0 || p.line.bb > 0);
}

export function parseInjuries(json) {
  const out = [];
  for (const team of json.injuries || []) {
    for (const inj of team.injuries || []) {
      const a = inj.athlete || {};
      let id = a.id;
      if (!id) {
        const href = (a.links || []).map((l) => l.href).find((h) => /\/id\/\d+/.test(h || ''));
        id = href?.match(/\/id\/(\d+)/)?.[1];
      }
      if (!id) continue;
      out.push({
        athleteId: String(id), name: a.displayName, status: inj.status || inj.type?.description || 'Injured',
        detail: inj.shortComment || inj.details?.type || '', date: Date.parse(inj.date) || 0,
      });
    }
  }
  return out;
}

export function parseNews(league, json) {
  return (json.articles || []).map((a) => {
    const athletes = []; const teams = [];
    for (const c of a.categories || []) {
      if (c.type === 'athlete') { const id = c.athleteId ?? c.athlete?.id; if (id) athletes.push(String(id)); }
      if (c.type === 'team') { const id = c.teamId ?? c.team?.id; if (id) teams.push(String(id)); }
    }
    return {
      id: String(a.dataSourceIdentifier || a.id || a.headline), league,
      headline: a.headline || '', desc: a.description || '',
      url: a.links?.web?.href || a.links?.mobile?.href || '',
      img: a.images?.[0]?.url || '', published: Date.parse(a.published) || Date.now(),
      athletes: [...new Set(athletes)], teams: [...new Set(teams)],
      aid: /^\d+$/.test(String(a.id ?? '')) ? String(a.id) : '', by: a.byline || '',
    };
  }).filter((n) => n.headline);
}

// ---------- Injury severity ----------

// The report that comes with a status matters as much as the status: "could begin
// practicing next week" is a player on his way back, "no timetable" is the opposite.
const OUTLOOK_UP = /\b(could|expected to|set to|will|may|might|hopes? to|on track to|close to|nearing|eligible to) (begin|start|resume|return|play|practice|be back|be activated|come off)|\b(began|begins?|begun|resumed?|returned|returns|back) (to |at )?practic|\bpractic(ed|ing)\b|\bdesignated (to|for) return|\b21-day (practice )?window|\b(limited|full) participant|\bnearing (a |his )?return|\bexpected back|\bactivated\b|\bcleared\b|\bprogressing\b|\bahead of schedule\b|\bwithout (a )?setback/i;
const OUTLOOK_DOWN = /\bseason-ending\b|\bout for the (season|year)\b|\bmiss the (rest|remainder)\b|\bindefinitely\b|\bno timetable\b|\bsetback\b|\bsurgery\b|\btorn\b|\bruptured?\b|\bnot expected (back|to return|to play)/i;
export function injuryOutlook(detail) {
  const d = String(detail || '');
  if (OUTLOOK_DOWN.test(d) && !/\bwithout (a )?setback|\bavoid(s|ed)? surgery|\bno surgery/i.test(d)) return -1;
  return OUTLOOK_UP.test(d) ? 1 : 0;
}

export function injuryFactor(status, detail) {
  const base = statusFactor(status);
  const o = injuryOutlook(detail);
  // On the way back: half the discount. Bad report: a quarter more.
  return Math.round((1 - (1 - base) * (o > 0 ? 0.5 : o < 0 ? 1.25 : 1)) * 1000) / 1000;
}
function statusFactor(status) {
  const s = String(status || '').toLowerCase();
  if (!s || s === 'active') return 1;
  if (s.includes('day-to-day') || s.includes('day to day')) return 0.96;
  if (s.includes('probable')) return 0.99;
  if (s.includes('questionable')) return 0.95;
  if (s.includes('doubtful')) return 0.88;
  if (s.includes('60-day')) return 0.7;
  if (s.includes('injured reserve') || s === 'ir' || s.includes('physically unable')) return 0.72;
  if (s.includes('suspen')) return 0.8;
  if (s.includes('out') || /\d+-day/.test(s) || /\bil\b/.test(s) || s.includes('injured list')) return 0.8;
  return 0.93;
}

// ---------- Headline sentiment ----------
// Lexicon tuned for sports news. Phrases are checked before single words.

const LEXICON = [
  // strongly negative
  ['season-ending', -3], ['torn acl', -3], ['torn achilles', -3], ['acl', -2.5], ['achilles', -2.5], ['out for the season', -3],
  ['out indefinitely', -2.5], ['surgery', -2], ['fracture', -2], ['broken', -1.5], ['placed on ir', -2], ['injured reserve', -2],
  ['injured list', -1.5], ['concussion', -1.5], ['arrested', -3], ['charged with', -2.5], ['suspended', -2.5], ['suspension', -2.5],
  ['domestic', -2.5], ['lawsuit', -1.5], ['investigation', -1.5], ['fined', -1], ['ejected', -1],
  // mild negative
  ['ruled out', -1.5], ['will miss', -1.5], ['to miss', -1.2], ['sidelined', -1.5], ['hamstring', -1], ['ankle', -0.8], ['knee', -1],
  ['strain', -0.8], ['sprain', -0.8], ['injury', -0.8], ['injuries', -0.8], ['injured', -1], ['to sit', -1.2], ['inactive', -1.2], ['out vs', -1.3], ['out for', -1.3], ['questionable', -0.6], ['doubtful', -1],
  ['benched', -1.5], ['demoted', -1.5], ['released', -1.5], ['waived', -1.5], ['slump', -1.2], ['struggle', -1], ['struggles', -1],
  ['losing streak', -1.5], ['skid', -1], ['blowout loss', -1.5], ['collapse', -1.2], ['blown', -1], ['fumble', -0.6], ['turnovers', -0.5],
  ['trade request', -1.5], ['holdout', -1.2], ['fired', -1.2], ['eliminated', -1.5], ['upset by', -1],
  // mild positive
  ['returns', 1], ['return from', 1], ['activated', 1.2], ['cleared', 1.2], ['back in lineup', 1.2], ['expected to play', 0.8],
  ['set to return', 1.2], ['to return', 1], ['will return', 1], ['will play', 0.9], ['good to go', 1.2], ['back vs', 1.2], ['back against', 1.2],
  ['back for', 1], ['back at practice', 0.9], ['returns to practice', 1], ['full participant', 0.9], ['off injury report', 1.2],
  ['off the injury report', 1.2], ['active for', 0.9], ['makes debut', 0.8], ['named starter', 1.3], ['to start', 0.6],
  ['wins', 0.8], ['win over', 0.8], ['beat', 0.7], ['beats', 0.7], ['victory', 0.8], ['rally', 0.8], ['comeback', 1], ['clinch', 1.5],
  ['clinches', 1.5], ['playoff berth', 1.5], ['winning streak', 1.2], ['streak', 0.3], ['extension', 1.2], ['signs', 0.6],
  ['contract', 0.3], ['breakout', 1.3], ['dominant', 1.3], ['dominates', 1.3], ['stars', 0.8], ['shines', 1], ['leads', 0.5],
  ['walk-off', 1.5], ['shutout', 1.2], ['no-hitter', 2.5], ['perfect game', 3], ['grand slam', 1.3], ['hat trick', 1.2],
  ['triple-double', 1.5], ['double-double', 0.6], ['career-high', 1.8], ['career high', 1.8], ['season-high', 1],
  // records / honors
  ['record', 0.4], ['breaks record', 2.5], ['sets record', 2.5], ['franchise record', 2.2], ['all-time', 1.5], ['milestone', 1.5],
  ['first player', 1.2], ['mvp', 1.8], ['player of the week', 1.5], ['player of the month', 1.8], ['all-star', 1.5], ['pro bowl', 1.3],
  ['rookie of the year', 1.5], ['cy young', 1.8], ['award', 0.8],
];

// "Texans get Collins (hamstring) back": when a headline is about a return, the injury it
// mentions is the one he is coming back from, so it doesn't count against him.
const RETURN_RE = /\b(gets?|getting|welcomes?) [^,;:]{0,40}\bback\b|\bback (vs|against|for|in lineup|at practice)\b|\breturn(s|ed|ing)?\b|\bactivated\b|\bcleared\b|\bgood to go\b|\bwill play\b|\bexpected to play\b|\boff (the )?injury report\b|\bfull participant\b/;
const INJURY_WORDS = new Set(['acl', 'achilles', 'surgery', 'fracture', 'broken', 'injured reserve', 'injured list', 'concussion', 'hamstring',
  'ankle', 'knee', 'strain', 'sprain', 'injury', 'injuries', 'injured', 'questionable', 'doubtful', 'sidelined']);
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`);
// Whole words only ("wins" must not match "Twins"), allowing simple endings.
const LEX_RE = LEXICON.map(([phrase, w]) => [phrase, w, new RegExp(`(?<![a-z])${esc(phrase)}(?:s|es|ed|ing)?(?![a-z])`, 'g')]);

const NEGATORS = ['not ', "won't ", 'avoids ', 'avoided ', 'no ', 'without ', 'escapes '];

export function sentimentScore(text) {
  const t = ` ${String(text).toLowerCase().replace(/[’']/g, "'")} `;
  let score = 0; const hits = [];
  const used = [];
  const comeback = RETURN_RE.test(t);
  for (const [phrase, w0, re] of LEX_RE) {
    const w = comeback && INJURY_WORDS.has(phrase) ? 0 : w0;
    re.lastIndex = 0;
    for (let m = re.exec(t); m; m = re.exec(t)) {
      const idx = m.index; const end = idx + m[0].length;
      if (used.some(([s0, e]) => idx < e && end > s0)) continue;
      used.push([idx, end]);
      if (!w) continue;
      const clause = t.slice(Math.max(0, idx - 40), idx).split(/[,.;:!?]/).pop();
      const before = ' ' + clause.trim().split(/\s+/).slice(-3).join(' ') + ' ';
      const neg = NEGATORS.some((n) => before.includes(' ' + n));
      score += neg ? -w * 0.6 : w;
      hits.push(phrase);
    }
  }
  if (comeback && !hits.length) { score += 1; hits.push('back'); }
  return { score: clamp(Math.tanh(score / 2.5), -1, 1), hits };
}

// ---------- Who a headline is actually about ----------

// Round-ups (fantasy columns, rankings, previews) tag dozens of players; they only say
// something about the ones named in the headline.
const ROUNDUP_RE = /\b(fantasy|rankings?|mock draft|picks|odds|betting|best bets|start ?'?em|sit ?'?em|waiver|inactives|takeaways|grades|predictions?|what to know|how to watch|preview|props|dfs|sleepers|buzz|mailbag|podcast|tracker|round-?up|winners and losers|injury report|live updates|questions)\b/i;
const nameRe = (w) => new RegExp(`(?<![A-Za-z])${esc(w)}(?![A-Za-z])`, 'i');
export function nameIn(text, name) {
  const parts = String(name || '').replace(/\b(jr|sr|ii|iii|iv)\.?$/i, '').trim().split(/\s+/);
  if (!parts[0]) return -1;
  const last = parts[parts.length - 1]; const first = parts[0];
  let m = last.length >= 3 ? nameRe(last).exec(text) : null;
  if (!m && parts.length > 1 && first.length >= 5) m = nameRe(first).exec(text);
  return m ? m.index : -1;
}

// How much one article says about each tagged player or team: { assetId: score }.
// subjects: [{ id, kind, name, abbr }]
export function newsEffects(art, subjects) {
  const head = art.headline || '';
  const roundup = ROUNDUP_RE.test(head);
  const players = subjects.filter((x) => x.kind === 'player');
  const whole = sentimentScore(roundup ? head : `${head}. ${art.desc || ''}`).score;
  const headOnly = sentimentScore(head).score;
  // Clause by clause: "Daniels, DeVonta to sit, McConkey questionable". A bare name
  // takes the verdict of the clause that follows it.
  const clauses = []; let pos = 0;
  for (const c of head.split(/[,;:]| and | but /)) { clauses.push({ start: pos, end: pos + c.length, score: sentimentScore(c).score }); pos += c.length + 1; }
  for (let i = clauses.length - 2; i >= 0; i--) if (!clauses[i].score && head.slice(clauses[i].start, clauses[i].end).trim().split(/\s+/).length <= 3) clauses[i].score = clauses[i + 1].score;
  const named = players.map((x) => [x, nameIn(head, x.name)]).filter(([, i]) => i >= 0);
  const out = {};
  for (const x of players) {
    const at = nameIn(head, x.name);
    if (at >= 0) {
      const several = named.length > 1 || roundup;
      out[x.id] = several ? (clauses.find((c) => at >= c.start && at <= c.end)?.score ?? 0) : whole;
    } else if (players.length === 1 && !roundup) {
      out[x.id] = whole; // the only player tagged: the story is about him
    } else if (!roundup && art.desc) {
      // Named only in the summary: he gets what the sentence about him says.
      const sent = String(art.desc).split(/(?<=[.!?])\s+/).find((t) => nameIn(t, x.name) >= 0);
      if (sent) out[x.id] = sentimentScore(sent).score || (named.length === 0 ? whole : 0);
    }
  }
  if (!roundup) {
    const teams = subjects.filter((x) => x.kind === 'team');
    for (const x of teams) {
      const nick = String(x.name || '').split(/\s+/).pop();
      const inHead = (nick && nameRe(nick).test(head)) || (x.abbr && new RegExp(`(?<![A-Za-z])${esc(x.abbr)}(?![A-Za-z])`).test(head));
      if (inHead || teams.length === 1) out[x.id] = headOnly || (inHead ? whole : 0);
    }
  }
  return out;
}

// ---------- Article text ----------
// ESPN sends the story as HTML. Keep only the words: paragraphs, subheadings, lists and
// quotes. Everything else (scripts, embeds, photo and video placeholders) is dropped.
export function storyBlocks(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const out = [];
  const text = (n) => (n.textContent || '').replace(/\s+/g, ' ').trim();
  const walk = (node) => {
    for (const el of node.children) {
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'iframe', 'aside', 'figure', 'table', 'form'].includes(tag) || /^(photo|video|inline|alsosee|offer|module)\d*$/.test(tag)) continue;
      if (tag === 'p' || tag === 'blockquote') { const t = text(el); if (t) out.push({ t: tag === 'p' ? 'p' : 'q', x: t }); }
      else if (/^h[1-6]$/.test(tag)) { const t = text(el); if (t) out.push({ t: 'h', x: t }); }
      else if (tag === 'ul' || tag === 'ol') { for (const li of el.children) { const t = text(li); if (t) out.push({ t: 'li', x: t }); } }
      else walk(el);
    }
  };
  walk(doc.body);
  return out;
}
