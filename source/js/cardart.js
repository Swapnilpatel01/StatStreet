// Card art, drawn in code: a scene for each kind of play, varied a little by the card's
// serial number so no two cards are quite the same. Returns an SVG string.
// Colours come from CSS: `currentColor` is the rarity colour, set on .mc-art.

const rng = (seed) => { let s = (seed * 9301 + 49297) % 233280; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; };
const hash = (str) => { let h = 11; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const W = 200; const H = 280;
const f = (n) => n.toFixed(1);

const ball = (x, y, r, kind) => {
  if (kind === 'base') return `<g transform="translate(${f(x)} ${f(y)})"><circle r="${r}" fill="#f4f1ea"/><path d="M${-r * 0.55} ${-r * 0.8}q${r * 0.5} ${r * 0.8} 0 ${r * 1.6}M${r * 0.55} ${-r * 0.8}q${-r * 0.5} ${r * 0.8} 0 ${r * 1.6}" fill="none" stroke="#d6453d" stroke-width="${r * 0.14}"/></g>`;
  if (kind === 'hoop') return `<g transform="translate(${f(x)} ${f(y)})"><circle r="${r}" fill="#e8772e"/><path d="M${-r} 0h${2 * r}M0 ${-r}v${2 * r}M${-r * 0.72} ${-r * 0.7}q${r * 0.5} ${r * 0.7} 0 ${r * 1.4}M${r * 0.72} ${-r * 0.7}q${-r * 0.5} ${r * 0.7} 0 ${r * 1.4}" fill="none" stroke="#3a1c08" stroke-width="${r * 0.11}"/></g>`;
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(-28)"><ellipse rx="${r * 1.5}" ry="${r * 0.92}" fill="#8a4b2a"/><path d="M${-r * 0.7} 0h${r * 1.4}M${-r * 0.4} ${-r * 0.3}v${r * 0.6}M0 ${-r * 0.3}v${r * 0.6}M${r * 0.4} ${-r * 0.3}v${r * 0.6}" stroke="#f4f1ea" stroke-width="${r * 0.13}" stroke-linecap="round"/></g>`;
};
// A dotted flight path ending in a ball.
const flight = (x0, y0, cx, cy, x1, y1, kind, r = 9) => `<path d="M${x0} ${y0}Q${f(cx)} ${f(cy)} ${f(x1)} ${f(y1)}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="2 7" stroke-linecap="round" opacity=".9"/>${ball(x1, y1, r, kind)}`;
const streaks = (r, n, x0, x1, y0, y1) => Array.from({ length: n }, () => { const y = y0 + r() * (y1 - y0); const x = x0 + r() * (x1 - x0); const len = 14 + r() * 34; return `<path d="M${f(x)} ${f(y)}h${f(len)}" stroke="currentColor" stroke-width="${f(1 + r() * 1.6)}" stroke-linecap="round" opacity="${f(0.15 + r() * 0.35)}"/>`; }).join('');
const stars = (r, n) => Array.from({ length: n }, () => { const x = r() * W; const y = r() * H * 0.6; const s = 1 + r() * 2.2; return `<path d="M${f(x)} ${f(y - s * 2)}l${f(s * 0.6)} ${f(s * 1.4)}l${f(s * 1.4)} ${f(s * 0.6)}l${f(-s * 1.4)} ${f(s * 0.6)}l${f(-s * 0.6)} ${f(s * 1.4)}l${f(-s * 0.6)} ${f(-s * 1.4)}l${f(-s * 1.4)} ${f(-s * 0.6)}l${f(s * 1.4)} ${f(-s * 0.6)}z" fill="currentColor" opacity="${f(0.25 + r() * 0.5)}"/>`; }).join('');

function diamond(r, kind) {
  // Infield diamond seen from behind home plate, outfield wall and stands behind it.
  const lift = kind === 'GRAND SLAM' || kind === 'HOME RUN';
  const reach = lift ? 0 : kind === 'TRIPLE' ? 1 : kind === 'DOUBLE' ? 2 : 3;
  const tx = 40 + r() * 120; const peak = lift ? -30 - r() * 30 : 60 + r() * 30;
  const endY = lift ? 46 + r() * 16 : [120, 150, 175, 190][reach];
  const bases = [[100, 232], [150, 190], [100, 150], [50, 190]];
  const lit = kind === 'GRAND SLAM' ? 4 : kind === 'HOME RUN' ? 4 : kind === 'TRIPLE' ? 3 : kind === 'DOUBLE' ? 2 : 1;
  return `<path d="M-10 96Q100 20 210 96L210 70Q100 -6 -10 70Z" fill="currentColor" opacity=".10"/>
    <path d="M-10 96Q100 20 210 96" fill="none" stroke="currentColor" stroke-width="2.5" opacity=".55"/>
    ${Array.from({ length: 9 }, (_, i) => `<path d="M${12 + i * 22} ${f(88 - Math.sin((i + 0.5) / 9 * Math.PI) * 48)}v-9" stroke="currentColor" stroke-width="1.4" opacity=".3"/>`).join('')}
    <path d="M100 236L20 172Q100 96 180 172Z" fill="currentColor" opacity=".07"/>
    <path d="M100 232L150 190L100 150L50 190Z" fill="none" stroke="currentColor" stroke-width="2" opacity=".6"/>
    <path d="M100 232L4 150M100 232L196 150" stroke="currentColor" stroke-width="1.2" opacity=".3"/>
    ${bases.map(([x, y], i) => `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${x} ${y})" fill="${i > 0 && i <= lit % 4 || lit === 4 ? 'currentColor' : '#f4f1ea'}" opacity="${i === 0 ? 0.9 : i <= lit || lit === 4 ? 1 : 0.35}"/>`).join('')}
    <circle cx="100" cy="192" r="5" fill="currentColor" opacity=".35"/>
    ${flight(100, 226, (100 + tx) / 2, peak, tx, endY, 'base', lift ? 10 : 8)}
    ${kind === 'GRAND SLAM' ? stars(r, 7) : lift ? stars(r, 3) : ''}`;
}
function hoop(r, kind) {
  const dunk = kind === 'DUNK' || kind === 'ALLEY-OOP';
  const sx = 16 + r() * 30;
  return `<rect x="52" y="34" width="96" height="62" rx="5" fill="currentColor" opacity=".08" stroke="currentColor" stroke-width="2.5" stroke-opacity=".6"/>
    <rect x="82" y="58" width="36" height="26" fill="none" stroke="currentColor" stroke-width="2" opacity=".7"/>
    <path d="M96 96h8v18h-8z" fill="currentColor" opacity=".5"/>
    <ellipse cx="100" cy="116" rx="27" ry="7" fill="none" stroke="#ff7a3d" stroke-width="3.5"/>
    <path d="M74 118l8 34M83 122l5 32M100 123v33M117 122l-5 32M126 118l-8 34M77 133h46M80 146h40" stroke="#f4f1ea" stroke-width="1.2" opacity=".55" fill="none"/>
    ${dunk ? `${streaks(r, 9, 10, 150, 20, 108)}<path d="M100 20v62" stroke="currentColor" stroke-width="3" stroke-dasharray="3 6" stroke-linecap="round"/>
      ${kind === 'ALLEY-OOP' ? `<path d="M12 150Q40 40 92 76" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round" opacity=".7"/>` : ''}
      ${ball(100, 96, 12, 'hoop')}<path d="M70 108l-10 -8M130 108l10 -8M66 122h-12M134 122h12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`
    : `<path d="M-6 268Q100 150 206 268" fill="none" stroke="currentColor" stroke-width="2.2" opacity="${kind === '3-POINTER' ? 0.7 : 0.3}"/>
      <path d="M62 280V214h76v66" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".35"/><circle cx="100" cy="214" r="22" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".35"/>
      ${flight(kind === '3-POINTER' ? sx : 60 + r() * 20, kind === '3-POINTER' ? 236 : 200, 60, kind === '3-POINTER' ? -10 - r() * 30 : 40, 100, 104, 'hoop', 10)}`}`;
}
function gridiron(r, kind) {
  const lines = Array.from({ length: 6 }, (_, i) => { const y = 250 - i * 30; const w = 100 - i * 9; return `<path d="M${100 - w} ${y}H${100 + w}" stroke="currentColor" stroke-width="1.6" opacity="${f(0.5 - i * 0.05)}"/>${i < 5 ? `<path d="M${88} ${y - 15}h6M${106} ${y - 15}h6" stroke="currentColor" stroke-width="1.2" opacity=".3"/>` : ''}`; }).join('');
  const posts = `<path d="M100 104V72M74 72H126M74 72V22M126 72V22" fill="none" stroke="#ffd23d" stroke-width="3.5" stroke-linecap="round"/>`;
  const field = `<path d="M0 262L48 96H152L200 262Z" fill="currentColor" opacity=".07"/><path d="M48 96H152L158 116H42Z" fill="currentColor" opacity=".22"/>${lines}<path d="M0 262L48 96M200 262L152 96" stroke="currentColor" stroke-width="1.6" opacity=".45"/>${posts}`;
  if (kind === 'FIELD GOAL') return `${field}${flight(100, 250, 60 + r() * 80, 80, 92 + r() * 16, 44, 'foot', 8)}${stars(r, 2)}`;
  if (kind === 'TD PASS') { const x = 60 + r() * 80; return `${field}${flight(20 + r() * 30, 250, 60, 20 + r() * 40, x, 108, 'foot', 9)}<circle cx="${f(x)}" cy="108" r="15" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".5"/>`; }
  if (kind === 'TD RUN') { let d = 'M100 256'; let x = 100; for (let i = 1; i <= 5; i++) { x += (i % 2 ? 1 : -1) * (14 + r() * 22); d += `L${f(x)} ${f(256 - i * 29)}`; } return `${field}<path d="${d}" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="1 8"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="9" stroke-linejoin="round" opacity=".12"/>${ball(x, 108, 8, 'foot')}`; }
  if (kind === 'DEFENSIVE TD') return `${field}<path d="M100 132l34 12v30c0 22-15 38-34 46c-19-8-34-24-34-46v-30z" fill="currentColor" opacity=".2" stroke="currentColor" stroke-width="2.5"/><path d="M86 176l10 10l20-24" fill="none" stroke="#f4f1ea" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${streaks(r, 6, 4, 150, 110, 240)}`;
  return `${field}${ball(100, 112, 11, 'foot')}${stars(r, 5)}`;
}
function burst(r, league) {
  const n = 18; const cx = 100; const cy = 112;
  const rays = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + r() * 0.1; const r1 = 34 + r() * 8; const r2 = 80 + r() * 70; return `<path d="M${f(cx + Math.cos(a) * r1)} ${f(cy + Math.sin(a) * r1)}L${f(cx + Math.cos(a) * r2)} ${f(cy + Math.sin(a) * r2)}" stroke="currentColor" stroke-width="${f(1.5 + r() * 3)}" stroke-linecap="round" opacity="${f(0.2 + r() * 0.4)}"/>`; }).join('');
  return `${rays}<circle cx="${cx}" cy="${cy}" r="30" fill="currentColor" opacity=".14"/><circle cx="${cx}" cy="${cy}" r="30" fill="none" stroke="currentColor" stroke-width="2" opacity=".6"/>${ball(cx, cy, league === 'nfl' ? 12 : 17, league === 'nba' ? 'hoop' : league === 'mlb' ? 'base' : 'foot')}${stars(r, 6)}`;
}

export function cardArt(m, serial = 1) {
  const r = rng(hash(`${m.id || ''}:${serial}`) % 100000 + 1);
  const k = m.kind || '';
  const body = ['HOME RUN', 'GRAND SLAM', 'TRIPLE', 'DOUBLE', 'RBI SINGLE'].includes(k) ? diamond(r, k)
    : ['DUNK', 'ALLEY-OOP', '3-POINTER', 'BUCKET'].includes(k) ? hoop(r, k)
      : ['TD PASS', 'TD RUN', 'TOUCHDOWN', 'DEFENSIVE TD', 'FIELD GOAL'].includes(k) ? gridiron(r, k)
        : burst(r, m.league);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${body}</svg>`;
}
