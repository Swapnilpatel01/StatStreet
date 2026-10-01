// Moments: real plays pulled from ESPN game summaries (home runs, dunks, touchdowns…),
// each with a play rating, rarity and traits. They become player-specific boost cards.
// When a summary has no play-by-play, standout box-score lines become "big game" moments,
// so every game still produces cards.

import { gameScore, lineText, milestone } from './scoring.js';
import { clamp, seeded } from './util.js';

export const M_RARITY = [
  { key: 'common', name: 'Common', min: 0 },
  { key: 'uncommon', name: 'Uncommon', min: 3 },
  { key: 'rare', name: 'Rare', min: 4.5 },
  { key: 'epic', name: 'Epic', min: 6 },
  { key: 'legendary', name: 'Legendary', min: 7.5 },
  { key: 'iconic', name: 'Iconic', min: 9 },
];
export const rarityForRating = (r) => ([...M_RARITY].reverse().find((x) => r >= x.min) || M_RARITY[0]).key;

export const TRAITS = {
  goahead: { icon: '🔺', label: 'Go-ahead' },
  clutch: { icon: '🧊', label: 'Clutch' },
  walkoff: { icon: '🎆', label: 'Walk-off' },
  moon: { icon: '🚀', label: 'Moonshot' },
  multi: { icon: '💥', label: 'Multi-run' },
  slam: { icon: '👑', label: 'Grand slam' },
  deep: { icon: '🎯', label: 'Deep shot' },
  poster: { icon: '🔨', label: 'Slam dunk' },
  oop: { icon: '🪂', label: 'Alley-oop' },
  buzzer: { icon: '⏰', label: 'Buzzer beater' },
  long: { icon: '🏃', label: 'Long score' },
  pick6: { icon: '🛡️', label: 'Defensive score' },
  extra: { icon: '⚾', label: 'Extra bases' },
  late: { icon: '🌙', label: 'Late game' },
  monster: { icon: '🔥', label: 'Monster game' },
  record: { icon: '🏆', label: 'Milestone' },
};

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Find which game player a play is about: ESPN participants first, then names in the text.
function whoIs(play, players, text) {
  for (const p of play.participants || []) {
    const id = String(p.athlete?.id ?? p.id ?? '');
    const hit = players.find((x) => x.id === id);
    if (hit && (!p.type || /batter|scorer|shooter|passer|rusher|receiver/i.test(p.type) || !(play.participants || []).some((q) => /batter/i.test(q.type || '')))) return hit;
  }
  // The first name in the text is the one who scored ("Kelce 33 Yd pass from Mahomes").
  let best = null; let at = Infinity;
  for (const x of players) {
    const n = x.name || '';
    const i = n ? text.indexOf(n) : -1;
    if (i >= 0 && i < at) { best = x; at = i; }
  }
  if (best) return best;
  // "J. Allen 12 Yd pass…" style: match by last name
  for (const x of players) {
    const last = (x.name || '').split(' ').slice(-1)[0];
    if (last.length > 3 && new RegExp(`\\b${last}\\b`).test(text)) return x;
  }
  return null;
}

function opponentOf(play, players, me) {
  for (const p of play.participants || []) {
    const id = String(p.athlete?.id ?? '');
    if (/pitcher/i.test(p.type || '') && id !== me?.id) return players.find((x) => x.id === id) || null;
  }
  return null;
}

function classify(league, play, text) {
  const t = `${play.type?.text || ''} ${text}`.toLowerCase();
  if (league === 'mlb') {
    if (/grand slam/.test(t)) return { kind: 'GRAND SLAM', base: 6 };
    if (/home run|homered|homers/.test(t)) return { kind: 'HOME RUN', base: 3.8 };
    if (/triple|tripled/.test(t)) return { kind: 'TRIPLE', base: 3.2 };
    if (/double|doubled/.test(t) && !/double play|doubled off/.test(t)) return { kind: 'DOUBLE', base: 2.2 };
    if (play.scoringPlay && /single|singled/.test(t)) return { kind: 'RBI SINGLE', base: 1.5 };
    return null;
  }
  if (league === 'nba') {
    if (!play.scoringPlay && !/makes/.test(t)) return null;
    if (/alley oop/.test(t) && /dunk/.test(t)) return { kind: 'ALLEY-OOP', base: 3 };
    if (/dunk/.test(t)) return { kind: 'DUNK', base: 2.2 };
    if ((play.scoreValue === 3) || /three point|3-pt|three-point/.test(t)) return { kind: '3-POINTER', base: 2 };
    if (/layup|hook|jumper|jump shot|fadeaway|floater|bank/.test(t) && play.scoringPlay) return { kind: 'BUCKET', base: 1 };
    return null;
  }
  // NFL: scoring plays
  if (/interception return|fumble return|pick six|defensive/.test(t) && /touchdown|td/.test(t)) return { kind: 'DEFENSIVE TD', base: 5 };
  if (/pass/.test(t) && /touchdown|td\b|yd pass/.test(t)) return { kind: 'TD PASS', base: 3.4 };
  if (/run|rush/.test(t) && /touchdown|td\b|yd run/.test(t)) return { kind: 'TD RUN', base: 3.4 };
  if (/field goal|fg/.test(t)) return { kind: 'FIELD GOAL', base: 1.2 };
  if (/touchdown|td\b/.test(t)) return { kind: 'TOUCHDOWN', base: 3.4 };
  return null;
}

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th'}`;

function situation(league, play) {
  const per = play.period || {};
  const n = num(per.number) ?? 0;
  if (league === 'mlb') {
    const half = /bot|bottom/i.test(per.type || per.displayValue || '') ? 'Bot' : 'Top';
    const outs = num(play.outs);
    return { period: n, text: `${half} ${n || ''}${outs != null ? ` · ${outs} out${outs === 1 ? '' : 's'}` : ''}`.trim(), half };
  }
  const clock = play.clock?.displayValue || '';
  const q = n > 4 ? (league === 'nba' ? `OT${n - 4 > 1 ? n - 4 : ''}` : 'OT') : `Q${n}`;
  return { period: n, text: `${q}${clock ? ` · ${clock}` : ''}`, clock };
}

const clockSecs = (c) => { const m = String(c || '').match(/(\d+):(\d+)/); return m ? +m[1] * 60 + +m[2] : (num(c) ?? 999); };

// Turn one game's summary JSON into moments. `ev` is the scoreboard event, `players` the box score rows.
export function parseMoments(league, json, ev, players) {
  const out = [];
  const home = ev.teams.find((t) => t.home) || ev.teams[0];
  const away = ev.teams.find((t) => t !== home) || ev.teams[1];
  const plays = league === 'nfl' ? (json.scoringPlays || []) : (json.plays || []);
  let prevHome = 0; let prevAway = 0;
  const finalHome = home?.score; const finalAway = away?.score;
  plays.forEach((play, idx) => {
    const text = clean(play.text || play.shortText || play.alternativeText);
    const hs = num(play.homeScore); const as = num(play.awayScore);
    const beforeH = prevHome; const beforeA = prevAway;
    if (hs != null) prevHome = hs; if (as != null) prevAway = as;
    if (!text) return;
    const c = classify(league, play, text);
    if (!c) return;
    const who = whoIs(play, players, text);
    if (!who) return;
    const opp = opponentOf(play, players, who);
    const sit = situation(league, play);
    const isHome = who.teamId === home?.id;
    const mine = isHome ? hs : as; const theirs = isHome ? as : hs;
    const mineB = isHome ? beforeH : beforeA; const theirsB = isHome ? beforeA : beforeH;
    const traits = [];
    let r = c.base;
    const lateP = league === 'mlb' ? 7 : 4;
    const late = sit.period >= lateP;
    const closeAfter = mine != null && Math.abs(mine - theirs) <= (league === 'mlb' ? 2 : league === 'nba' ? 5 : 8);
    if (mine != null && mineB <= theirsB && mine > theirs) { traits.push('goahead'); r += 1.5; }
    if (late && closeAfter) { traits.push('clutch'); r += 1.2; } else if (late) { traits.push('late'); r += 0.3; }
    if (league === 'mlb') {
      const feet = num(text.match(/\((\d{3}) (?:feet|ft)\)/i)?.[1]);
      const runs = num(play.scoreValue) ?? (mine != null ? mine - mineB : 0);
      if (feet >= 430) { traits.push('moon'); r += 1; }
      if (c.kind === 'GRAND SLAM') traits.push('slam');
      else if (runs >= 2) { traits.push('multi'); r += 0.6 * (runs - 1); }
      if (['TRIPLE', 'DOUBLE'].includes(c.kind)) traits.push('extra');
      const last = idx === plays.length - 1 || plays.slice(idx + 1).every((p) => !p.scoringPlay);
      if (isHome && sit.half === 'Bot' && sit.period >= 9 && mine > theirs && mineB <= theirsB && last && finalHome > finalAway) { traits.push('walkoff'); r += 2.5; }
      out.push(moment({ league, ev, who, opp, c, text, sit, traits, r, home, away, hs, as, idx, extra: feet ? `${feet}'` : '' }));
      return;
    }
    if (league === 'nba') {
      const ft = num(text.match(/(\d{2})-foot/)?.[1]);
      if (ft >= 28) { traits.push('deep'); r += 0.8; }
      if (c.kind === 'DUNK') traits.push('poster');
      if (c.kind === 'ALLEY-OOP') traits.push('oop');
      if (sit.period >= 4 && clockSecs(sit.clock) <= 3 && traits.includes('goahead')) { traits.push('buzzer'); r += 2.5; }
      out.push(moment({ league, ev, who, opp, c, text, sit, traits, r, home, away, hs, as, idx }));
      return;
    }
    const yds = num(text.match(/(\d+)\s*(?:yd|yard)/i)?.[1]);
    if (c.kind === 'FIELD GOAL' && yds >= 50) { traits.push('long'); r += 1.5; } else if (yds >= 70) { traits.push('long'); r += 2; } else if (yds >= 40) { traits.push('long'); r += 1; }
    if (c.kind === 'DEFENSIVE TD') traits.push('pick6');
    out.push(moment({ league, ev, who, opp, c, text, sit, traits, r, home, away, hs, as, idx }));
  });
  // NBA games have ~80 baskets: keep each game's best few.
  let list = out;
  if (league === 'nba') list = out.sort((x, y) => y.rating - x.rating).slice(0, 8);
  if (league === 'mlb') list = out.sort((x, y) => y.rating - x.rating).slice(0, 10);
  // Big box-score games always make a card too.
  for (const p of players) {
    const m = boxMoment(league, ev, p, home, away);
    if (m) list.push(m);
  }
  return list;
}

function moment({ league, ev, who, opp, c, text, sit, traits, r, home, away, hs, as, idx, extra = '' }) {
  const rnd = seeded(`${ev.id}:${idx}`);
  const rating = Math.round(clamp(r + (rnd() - 0.5) * 0.6, 0.5, 9.9) * 10) / 10;
  return {
    id: `${ev.id}:${idx}`, league, game: ev.id, date: ev.date, kind: c.kind, rating, rarity: rarityForRating(rating),
    traits: [...new Set(traits)].slice(0, 3), desc: shortDesc(text, who.name, extra),
    player: { id: who.id, name: who.name, teamId: who.teamId, team: who.teamAbbr },
    opp: opp ? { id: opp.id, name: opp.name } : null,
    score: { away: away?.abbr, home: home?.abbr, a: as, h: hs }, sit: sit.text,
  };
}

function shortDesc(text, name, extra) {
  let s = text.replace(name, '').replace(/^[\s,.-]+/, '');
  s = s.replace(/\([^)]*\)/g, '').replace(/\s*\.\s*$/, '');
  s = s.split(/[.;]/)[0];
  if (s.length > 48) s = `${s.slice(0, 46)}…`;
  return clean(`${extra ? `${extra} ` : ''}${s}`);
}

// Standout lines from the box score (40-point games, 3-homer games, 4-TD days…).
function boxMoment(league, ev, p, home, away) {
  const l = p.line; const gs = gameScore(league, l);
  if (!Number.isFinite(gs)) return null;
  const ms = milestone(league, l);
  const thresh = { nba: 38, nfl: 28, mlb: 9 }[league];
  if (!ms && gs < thresh) return null;
  let r = 2.5 + (gs - thresh * 0.7) / (thresh * 0.18);
  if (ms) r += 1.2;
  const rnd = seeded(`${ev.id}:box:${p.id}`);
  const rating = Math.round(clamp(r + (rnd() - 0.5) * 0.6, 1, 9.8) * 10) / 10;
  const kind = ms ? ms.toUpperCase() : { nba: `${l.pts}-POINT GAME`, nfl: 'BIG GAME', mlb: 'BIG NIGHT' }[league];
  return {
    id: `${ev.id}:box:${p.id}`, league, game: ev.id, date: ev.date, kind: kind.length > 22 ? 'MONSTER GAME' : kind, rating, rarity: rarityForRating(rating),
    traits: ms ? ['record', 'monster'] : ['monster'], desc: lineText(league, l),
    player: { id: p.id, name: p.name, teamId: p.teamId, team: p.teamAbbr }, opp: null,
    score: { away: away?.abbr, home: home?.abbr, a: away?.score, h: home?.score }, sit: 'Final',
  };
}

export { ordinal };
