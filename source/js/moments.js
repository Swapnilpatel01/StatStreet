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

// ---------- live play-by-play ----------
// The plays of one game, newest first, for the game screen. Pitch-by-pitch and clock
// bookkeeping lines are dropped; what's left is one row per thing that happened.
const NOISE_PLAY = /^(pitch \d|ball \d|strike \d|foul\b|.*\bpitches to\b|end of|start of|.* enters the game|.* substitution|timeout|jump ball|instant replay|coach.?s challenge|two-minute warning|official timeout)/i;
// A play boiled down to a few words: "7-yd catch", "29-yd FG", "25-ft three", "Home run".
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const shortPlay = (league, text, p = {}) => cap(shortPlay0(league, text, p));
function shortPlay0(league, text, p) {
  const t = String(text || ''); const type = String(p.type?.text || '');
  const yds = (re) => { const m = t.match(re); return m ? Math.abs(Number(m[1])) : null; };
  if (league === 'nfl') {
    const gain = Number.isFinite(Number(p.statYardage)) && p.statYardage !== null && p.statYardage !== undefined ? Number(p.statYardage) : (() => { const m = t.match(/for (-?\d+) yards?/i); return m ? Number(m[1]) : /for no gain/i.test(t) ? 0 : null; })();
    const y = gain == null ? '' : `${gain}-yd `;
    const td = /touchdown/i.test(type) || /\bTOUCHDOWN\b/.test(t);
    const fg = yds(/(\d+) yard field goal/i);
    if (/field goal/i.test(type + t)) return fg != null ? (/no good|missed|blocked/i.test(type + t) ? `Missed ${fg}-yd FG` : `${fg}-yd FG`) : 'Field goal';
    if (/extra point|PAT\b/i.test(type + t)) return /no good|missed|blocked|failed/i.test(type + t) ? 'Missed extra point' : 'Extra point';
    if (/two-point|2-pt|two point/i.test(type + t)) return /fail|no good/i.test(type + t) ? 'Failed 2-pt try' : '2-pt conversion';
    if (/intercept/i.test(type + t)) return td ? 'Pick six' : 'Interception';
    if (/fumble/i.test(type) || /FUMBLES/.test(t)) return /recovered by|RECOVERED/i.test(t) ? 'Fumble' : 'Fumble';
    if (/sack/i.test(type) || /\bsacked\b/i.test(t)) return `${gain == null ? '' : `${Math.abs(gain)}-yd `}sack`.replace(/^s/, 'S');
    if (/punt/i.test(type) || /\bpunts\b/i.test(t)) { const n = yds(/punts (\d+) yards?/i); return n != null ? `${n}-yd punt` : 'Punt'; }
    if (/kickoff/i.test(type) || /\bkicks\b/i.test(t)) return td ? 'Kickoff return TD' : 'Kickoff';
    if (/penalty/i.test(type) || /^PENALTY/i.test(t)) return 'Penalty';
    if (/incomplet/i.test(type + t)) return 'Incomplete pass';
    if (/pass/i.test(type) || /\bpass\b/i.test(t)) return td ? `${y}TD catch` : `${y}catch`;
    if (/rush/i.test(type) || /(left|right) (end|tackle|guard)|up the middle|scrambles|kneels/i.test(t)) return /kneels/i.test(t) ? 'Kneel' : td ? `${y}TD run` : `${y}run`;
    if (/timeout/i.test(type + t)) return 'Timeout';
    return type || cap(t.split(/[.(]/)[0].trim().slice(0, 40));
  }
  if (league === 'nba') {
    const shot = t.match(/\b(makes|misses)\s+(?:(\d+)-foot\s+)?(.*?)(?:\s*\(|$)/i);
    if (shot) {
      const miss = /miss/i.test(shot[1]); const d = shot[3].toLowerCase();
      if (/free throw/.test(d)) return miss ? 'Missed free throw' : 'Free throw';
      const kind = /three point/.test(d) ? 'three' : (d.match(/(alley oop dunk|driving dunk|dunk|driving layup|layup|hook shot|floating jump shot|step back jump shot|pullup jump shot|fadeaway|tip shot|jump shot|jumper|bank shot)/) || [, 'shot'])[1].replace('jump shot', 'jumper');
      return cap(`${miss ? 'missed ' : ''}${shot[2] ? `${shot[2]}-ft ` : ''}${kind}`);
    }
    if (/\bsteals?\b/i.test(t)) return 'Steal';
    if (/\bblocks?\b/i.test(t)) return 'Block';
    if (/offensive rebound/i.test(t)) return 'Offensive rebound';
    if (/rebound/i.test(t)) return 'Rebound';
    if (/turnover|bad pass|traveling|lost ball/i.test(t)) return 'Turnover';
    if (/foul/i.test(t)) return /technical/i.test(t) ? 'Technical foul' : /flagrant/i.test(t) ? 'Flagrant foul' : 'Foul';
    if (/timeout/i.test(t)) return 'Timeout';
    if (/enters the game/i.test(t)) return 'Substitution';
    if (/jump ball/i.test(t)) return 'Jump ball';
    return type || cap(t.slice(0, 40));
  }
  // baseball
  const ft = yds(/(\d{3}) feet/i);
  const rules = [[/grand slam/i, 'Grand slam'], [/homer(ed|s)|home run/i, ft ? `${ft}-ft home run` : 'Home run'], [/tripled/i, 'Triple'], [/doubled|ground rule double/i, 'Double'], [/singled/i, 'Single'],
    [/struck out|strikes out|called out on strikes/i, 'Strikeout'], [/intentionally walked/i, 'Intentional walk'], [/walked/i, 'Walk'], [/hit by pitch/i, 'Hit by pitch'],
    [/sacrifice fly|sac fly/i, 'Sacrifice fly'], [/sacrifice bunt|sacrificed/i, 'Sacrifice bunt'], [/double play/i, 'Double play'], [/grounded out|grounded into/i, 'Groundout'], [/flied out|flew out/i, 'Flyout'],
    [/lined out/i, 'Lineout'], [/popped out|fouled out/i, 'Pop out'], [/reached on .*error|error/i, 'Reached on error'], [/fielder's choice/i, "Fielder's choice"],
    [/caught stealing/i, 'Caught stealing'], [/stole|steals/i, 'Stolen base'], [/wild pitch/i, 'Wild pitch'], [/passed ball/i, 'Passed ball'], [/balk/i, 'Balk'], [/pitching change|relieved/i, 'Pitching change']];
  for (const [re, label] of rules) if (re.test(t)) return label;
  return type || cap(t.slice(0, 40));
}
// Big plays get a headline of their own. ctx: scores before and after the play (away, home),
// the period, seconds left in it, and for baseball whether it is the bottom of the inning.
// Returns null for an ordinary play.
export function bigPlay(league, text, p = {}, ctx = {}) {
  const t = String(text || ''); const base = shortPlay(league, text, p);
  const { a0, h0, a1, h1 } = ctx;
  const known = [a0, h0, a1, h1].every((x) => Number.isFinite(x));
  const scored = known && (a1 !== a0 || h1 !== h0);
  const before = known ? Math.sign(a0 - h0) : 0; const after = known ? Math.sign(a1 - h1) : 0;
  const scorer = known ? (a1 > a0 ? 1 : h1 > h0 ? -1 : 0) : 0; // +1 away scored, −1 home scored
  const goAhead = scored && after === scorer && before !== scorer; // took the lead
  const tying = scored && after === 0 && before !== 0;
  const late = ctx.period >= (league === 'mlb' ? 8 : 4) && (league === 'mlb' || (ctx.secs ?? 9999) <= 120);
  const num = (re) => { const x = base.match(re); return x ? Number(x[1]) : null; };
  if (league === 'nfl') {
    const y = num(/^(\d+)-yd/); const td = /TD/.test(base);
    if (/safety/i.test(t) && /SAFETY/.test(t)) return 'Safety';
    if (/blocked/i.test(t) && /punt|field goal/i.test(t)) return /field goal/i.test(t) ? 'Blocked field goal' : 'Blocked punt';
    if (base === 'Pick six') return 'Pick six';
    if (td && /kickoff|punt/i.test(base + t) && /return|kicks|punts/i.test(t)) return 'Return to the house';
    if (td && y >= 50) return `${y}-yd house call`;
    if (td && late && (goAhead || tying)) return `${goAhead ? 'Go-ahead' : 'Game-tying'} ${base.replace(/^(\d+-yd )?TD /, (m0, a) => `${a || ''}TD `)}`;
    if (/FG$/.test(base) && !/^Missed/.test(base)) {
      const n = num(/^(\d+)-yd/);
      if (late && goAhead) return `Go-ahead ${n}-yd FG`;
      if (late && tying) return `Game-tying ${n}-yd FG`;
      if (n >= 50) return `${n}-yd bomb of a kick`;
      return null;
    }
    if (/^Missed/.test(base) && late && known && Math.abs(a0 - h0) <= 3) return `${base}, no good late`;
    if (/catch$/.test(base) && !td && y >= 40) return `${y}-yd bomb`;
    if (/run$/.test(base) && !td && y >= 30) return `${y}-yd breakaway`;
    if (/sack$/.test(base) && Number(p.start?.down) >= 3) return `${base} on ${p.start.down === 4 ? '4th' : '3rd'} down`;
    if (Number(p.start?.down) === 4 && /(catch|run)$/.test(base) && y != null && Number(p.start?.distance) > 0 && y >= Number(p.start.distance)) return `4th-down conversion, ${base}`;
    if (base === 'Interception' || base === 'Fumble') return base === 'Fumble' && !/RECOVERED|recovered by/.test(t) ? null : `Turnover: ${base.toLowerCase()}`;
    return null;
  }
  if (league === 'nba') {
    if (!/\bmakes\b/i.test(t)) return null;
    const ft = num(/^(\d+)-ft/); const three = /three$/.test(base);
    const kind = base.replace(/^\d+-ft /, '').toLowerCase();
    if (ctx.secs === 0 && ctx.period >= 4 && (goAhead || tying)) return goAhead ? 'Buzzer-beater for the win' : 'Buzzer-beater to tie it';
    if (late && goAhead) return `Go-ahead ${kind}`;
    if (late && tying) return `Game-tying ${kind}`;
    if (ctx.secs === 0 && three) return `Buzzer-beating ${kind}`;
    if (three && ft >= 35) return `Logo three from ${ft} ft`;
    if (three && ft >= 30) return `${ft}-ft bomb`;
    if (/alley oop/.test(kind)) return 'Alley-oop slam';
    return null;
  }
  const walkoff = league === 'mlb' && ctx.bottom && ctx.period >= 9 && scored && scorer === -1 && after === -1 && before !== -1;
  if (/triple play/i.test(t)) return 'Triple play';
  if (base === 'Grand slam') return walkoff ? 'Walk-off grand slam' : 'Grand slam';
  if (walkoff) return `Walk-off ${base.replace(/^\d+-ft /, '').toLowerCase()}`;
  if (/home run$/.test(base)) {
    const ft = num(/^(\d+)-ft/);
    if (late && goAhead) return 'Go-ahead home run';
    if (late && tying) return 'Game-tying home run';
    if (ft >= 440) return `${ft}-ft moonshot`;
    return null;
  }
  if (late && goAhead && scored) return `Go-ahead ${base.toLowerCase()}`;
  if (late && tying && scored) return `Game-tying ${base.toLowerCase()}`;
  return null;
}
const playSecs = (p) => { const c = String(p.clock?.displayValue || ''); const x = c.match(/^(\d+):(\d{2})/); return x ? Number(x[1]) * 60 + Number(x[2]) : /^\d+(\.\d+)?$/.test(c) ? Math.floor(Number(c)) : null; };
export function parsePlays(league, json, limit = 60) {
  let raw = [];
  if (league === 'nfl') {
    const drives = [...(json?.drives?.previous || []), ...(json?.drives?.current ? [json.drives.current] : [])];
    const seen = new Set();
    for (const d of drives) for (const p of d.plays || []) { if (p.id && seen.has(p.id)) continue; if (p.id) seen.add(p.id); raw.push({ ...p, _team: d.team?.abbreviation }); }
    if (!raw.length) raw = json?.scoringPlays || [];
  } else raw = json?.plays || [];
  const out = [];
  let a0 = 0; let h0 = 0; // the score before each play
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    const a1 = num(p.awayScore); const h1 = num(p.homeScore);
    const ctx = { a0, h0, a1: a1 ?? a0, h1: h1 ?? h0, period: Number(p.period?.number) || 0, secs: playSecs(p), bottom: /bot/i.test(`${p.period?.type || ''} ${p.period?.displayValue || ''}`) };
    if (a1 != null) a0 = a1; if (h1 != null) h0 = h1;
    const text = clean(p.text || p.shortText || p.alternativeText);
    if (!text || NOISE_PLAY.test(text)) continue;
    // Baseball lists every pitch; keep the result of each at-bat and anything that scores.
    if (league === 'mlb' && p.type?.type && !/play-result|result/i.test(p.type.type) && !p.scoringPlay) continue;
    const sit = situation(league, p);
    const who = (p.participants || []).find((x) => /batter|scorer|shooter|passer|rusher|receiver/i.test(x.type || '')) || (p.participants || [])[0];
    const dd = league === 'nfl' ? String(p.start?.shortDownDistanceText || p.start?.downDistanceText || '').replace(/\s+at\s+.*$/i, '') : '';
    out.push({ id: String(p.id || `${i}`), text: text.replace(/\.$/, ''), head: shortPlay(league, text, p), big: bigPlay(league, text, p, ctx), sit: dd ? `${sit.text} · ${dd}` : sit.text,
      pids: [...new Set((p.participants || []).map((x) => (x.athlete?.id != null ? String(x.athlete.id) : null)).filter(Boolean))].slice(0, 3),
      away: num(p.awayScore), home: num(p.homeScore), scoring: !!p.scoringPlay, value: num(p.scoreValue) || 0,
      pid: who?.athlete?.id != null ? String(who.athlete.id) : null, team: p._team || p.team?.abbreviation || null, t: Date.parse(p.wallclock || p.modified || '') || null });
  }
  return out.slice(-limit).reverse();
}

// ---------- the current at-bat, pitch by pitch (baseball) ----------
// Returns the latest at-bat's pitches, plus a strike zone worked out from this game's own
// called strikes (so the plot is right whatever units the feed uses). zone is null until
// there are enough called strikes to place it.
const isPitch = (p) => !/play-result|result/i.test(p.type?.type || '') && (p.pitchVelocity != null || p.pitchType || p.pitchCoordinate || /^pitch\b/i.test(p.text || ''));
// Where the ball is in a football game: down, distance, yard line and who has it.
// The feed reports this in a few places depending on the endpoint, so each is tried.
export function parseSituation(json) {
  const drive = json?.drives?.current;
  const lastPlay = drive?.plays?.[drive.plays.length - 1];
  const s = json?.situation || json?.header?.competitions?.[0]?.situation || lastPlay?.end;
  if (!s) return null;
  const spot = String(s.possessionText || s.downDistanceText || '').match(/\b([A-Z]{2,4})\s+(\d{1,2})\b(?!.*\b[A-Z]{2,4}\s+\d)/);
  const mid = /\b50\b/.test(String(s.possessionText || '')) && !spot;
  if (!spot && !mid) return null;
  const down = Number(s.down) || 0; const dist = Number(s.distance);
  const dd = String(s.shortDownDistanceText || '').trim() || (down ? `${['', '1st', '2nd', '3rd', '4th'][down] || down} & ${dist > 0 ? dist : 'Goal'}` : '');
  return {
    down, distance: Number.isFinite(dist) ? dist : null, text: dd,
    side: mid ? null : spot[1], yard: mid ? 50 : Number(spot[2]),
    spot: mid ? '50' : `${spot[1]} ${spot[2]}`,
    poss: String(s.possession ?? s.team?.id ?? drive?.team?.id ?? '') || null, red: !!s.isRedZone,
  };
}
export function parseAtBat(json) {
  const plays = json?.plays || [];
  if (!plays.length) return null;
  const pitches = plays.filter(isPitch);
  if (!pitches.length) return null;
  const lastId = pitches[pitches.length - 1].atBatId;
  let cur = lastId != null ? pitches.filter((p) => p.atBatId === lastId) : [];
  if (!cur.length) { // no at-bat ids: take the run of pitches after the last result
    let i = plays.length - 1; while (i >= 0 && !isPitch(plays[i])) i--;
    const end = i; while (i >= 0 && isPitch(plays[i])) i--;
    cur = plays.slice(i + 1, end + 1);
  }
  const kindOf = (t) => (/in play|hit by/i.test(t) ? 'inplay' : /ball\b/i.test(t) && !/foul/i.test(t) ? 'ball' : 'strike');
  const list = cur.map((p, i) => {
    const call = clean(p.type?.text || String(p.text || '').replace(/^pitch\s*\d+\s*:?\s*/i, '')) || 'Pitch';
    const c = p.pitchCoordinate;
    return { n: num(p.atBatPitchNumber) ?? i + 1, call, kind: kindOf(call), type: p.pitchType?.text || p.pitchType?.abbreviation || '', mph: num(p.pitchVelocity),
      x: c && num(c.x) != null ? num(c.x) : null, y: c && num(c.y) != null ? num(c.y) : null };
  });
  // Zone: the middle 90% of where called strikes crossed the plate in this game.
  const called = pitches.filter((p) => /strike looking|called strike/i.test(p.type?.text || p.text || '') && p.pitchCoordinate && num(p.pitchCoordinate.x) != null);
  let zone = null;
  if (called.length >= 8) {
    const q = (arr, f) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))]; };
    const xs = called.map((p) => num(p.pitchCoordinate.x)); const ys = called.map((p) => num(p.pitchCoordinate.y));
    zone = { x0: q(xs, 0.05), x1: q(xs, 0.95), y0: q(ys, 0.05), y1: q(ys, 0.95) };
    if (!(zone.x1 > zone.x0) || !(zone.y1 > zone.y0)) zone = null;
  }
  const last = cur[cur.length - 1]; const idx = plays.indexOf(last);
  const result = plays.slice(idx + 1).find((p) => /play-result|result/i.test(p.type?.type || ''));
  const who = (x, re) => { const part = (x?.participants || []).find((q) => re.test(q.type || '')); return part?.athlete?.id != null ? String(part.athlete.id) : null; };
  const src = result || last;
  const balls = list.filter((p) => p.kind === 'ball').length; const strikes = Math.min(2 + (result ? 1 : 0), list.filter((p) => p.kind === 'strike' && !(/foul/i.test(p.call))).length + Math.min(2, list.filter((p) => /foul/i.test(p.call)).length));
  return { pitches: list, zone, done: !!result, result: result ? clean(result.text).replace(/\.$/, '') : '', batter: who(src, /batter/i) || who(last, /batter/i), pitcher: who(src, /pitcher/i) || who(last, /pitcher/i),
    count: `${Math.min(balls, 4)}-${Math.min(strikes, 3)}`, sit: situation('mlb', src).text };
}
