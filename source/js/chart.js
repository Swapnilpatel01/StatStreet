// Lightweight SVG charts: a full chart with touch scrubbing, sparklines, and an options payoff chart.

export function sliceRange(flat, from) {
  const pts = [];
  let prev = null;
  for (let i = 0; i < flat.length; i += 2) {
    if (flat[i] >= from) pts.push([flat[i], flat[i + 1]]);
    else prev = [from, flat[i + 1]];
  }
  if (prev) pts.unshift(prev); // start the line at the left edge
  return pts;
}

export function sparkline(flat, from, w = 64, h = 28) {
  const pts = sliceRange(flat, from);
  if (pts.length < 2) return `<svg class="spark" width="${w}" height="${h}"></svg>`;
  const ys = pts.map((p) => p[1]);
  const lo = Math.min(...ys); const hi = Math.max(...ys);
  const t0 = pts[0][0]; const t1 = pts[pts.length - 1][0] || t0 + 1;
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * (w - 2) + 1;
  const y = (v) => h - 2 - ((v - lo) / Math.max(1e-9, hi - lo)) * (h - 4);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const up = ys[ys.length - 1] >= ys[0];
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="var(--${up ? 'up' : 'down'})" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

// Full-width chart. onScrub(point|null) lets the header show the touched price.
// Scrubbing starts only on a sideways drag or a press-and-hold, so vertical
// swipes that begin on the chart still scroll the page.
export function lineChart(el, flat, from, { onScrub, height = 190, animate = false, marks = [] } = {}) {
  const pts = sliceRange(flat, from);
  const w = el.clientWidth || 340; const h = height;
  if (pts.length < 2) {
    el.innerHTML = `<div class="chart-empty" style="height:${h}px">Not enough trading history yet for this range.</div>`;
    return;
  }
  const ys = pts.map((p) => p[1]);
  let lo = Math.min(...ys); let hi = Math.max(...ys);
  const pad = (hi - lo) * 0.12 || hi * 0.02 || 1; lo -= pad; hi += pad;
  const t0 = pts[0][0]; const t1 = pts[pts.length - 1][0];
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * (w - 12) + 2;
  const y = (v) => h - 6 - ((v - lo) / (hi - lo)) * (h - 12);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const up = ys[ys.length - 1] >= ys[0];
  const color = `var(--${up ? 'up' : 'down'})`;
  const base = y(ys[0]);
  const gid = `g${Math.random().toString(36).slice(2, 7)}`;
  const last = pts[pts.length - 1];
  // Game days: a bar along the bottom, taller for bigger moves, green or red by direction.
  const inR = marks.filter((m) => m.t >= t0 && m.t <= t1);
  const top = Math.max(0.02, ...inR.map((m) => Math.abs(m.v)));
  const bw = Math.max(2, Math.min(7, (w - 12) / Math.max(12, inR.length * 2.2)));
  const bars = inR.map((m) => { const bh = 3 + 17 * Math.min(1, Math.abs(m.v) / top); return `<rect class="gbar" x="${(x(m.t) - bw / 2).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="var(--${m.v >= 0 ? 'up' : 'down'})"/>`; }).join('');
  el.innerHTML = `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="chart ${animate ? 'draw' : ''}" role="img" aria-label="Price chart: ${up ? 'up' : 'down'} ${Math.abs((ys[ys.length - 1] / ys[0] - 1) * 100).toFixed(1)} percent over this range, now ${ys[ys.length - 1].toFixed(2)}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity="0.28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <line x1="0" x2="${w}" y1="${base}" y2="${base}" stroke="var(--line)" stroke-dasharray="2 4"/>
      <path class="area" d="${d}L${x(t1)},${h}L${x(t0)},${h}Z" fill="url(#${gid})"/>
      ${bars}
      <path class="ln" pathLength="1" d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${inR.map((m) => { let b = pts[0]; for (const p of pts) if (Math.abs(p[0] - m.t) < Math.abs(b[0] - m.t)) b = p; return `<circle class="gdot" cx="${x(b[0]).toFixed(1)}" cy="${y(b[1]).toFixed(1)}" r="5" fill="var(--${m.v >= 0 ? 'up' : 'down'})" stroke="var(--bg)" stroke-width="2.5"/>`; }).join('')}
      <circle cx="${x(last[0])}" cy="${y(last[1])}" r="3.5" fill="${color}"/>
      <g class="cursor" style="display:none">
        <line y1="0" y2="${h}" stroke="var(--muted)" stroke-width="1"/>
        <circle r="4.5" fill="${color}" stroke="var(--bg)" stroke-width="2"/>
      </g>
    </svg>`;
  const svg = el.querySelector('svg');
  const cur = svg.querySelector('.cursor');
  const move = (clientX) => {
    const r = svg.getBoundingClientRect();
    const t = t0 + ((clientX - r.left - 2) / (w - 12)) * (t1 - t0);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
    cur.style.display = '';
    const cx = x(best[0]);
    cur.querySelector('line').setAttribute('x1', cx); cur.querySelector('line').setAttribute('x2', cx);
    cur.querySelector('circle').setAttribute('cx', cx); cur.querySelector('circle').setAttribute('cy', y(best[1]));
    let mark = null; for (const m of inR) if (Math.abs(x(m.t) - cx) < 16 && (!mark || Math.abs(x(m.t) - cx) < Math.abs(x(mark.t) - cx))) mark = m;
    onScrub?.({ t: best[0], p: best[1], first: ys[0], mark });
  };
  const end = () => { cur.style.display = 'none'; onScrub?.(null); };

  let mode = null; let sx = 0; let sy = 0; let hold = null;
  svg.addEventListener('touchstart', (e) => {
    const tp = e.touches[0]; sx = tp.clientX; sy = tp.clientY; mode = null;
    clearTimeout(hold);
    if (sx < 26) { mode = 'scroll'; return; } // left edge belongs to the swipe-back gesture
    hold = setTimeout(() => { if (!mode) { mode = 'scrub'; move(sx); } }, 280);
  }, { passive: true });
  svg.addEventListener('touchmove', (e) => {
    const tp = e.touches[0]; const dx = tp.clientX - sx; const dy = tp.clientY - sy;
    if (!mode) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) mode = 'scrub';
      else if (Math.abs(dy) > 8) mode = 'scroll';
      if (mode) clearTimeout(hold);
    }
    if (mode === 'scrub') move(tp.clientX);
  }, { passive: true });
  const stop = () => { clearTimeout(hold); if (mode === 'scrub') end(); mode = null; };
  svg.addEventListener('touchend', stop);
  svg.addEventListener('touchcancel', stop);
  svg.addEventListener('mousemove', (e) => move(e.clientX));
  svg.addEventListener('mouseleave', end);
}

// Profit/loss at expiry. pts = [[underlyingPrice, pnl], ...]
export function payoffChart(el, pts, { current, breakeven } = {}) {
  const w = el.clientWidth || 340; const h = 130;
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  let lo = Math.min(...ys, 0); let hi = Math.max(...ys, 0);
  const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const x = (v) => ((v - x0) / (x1 - x0)) * (w - 8) + 4;
  const y = (v) => h - 16 - ((v - lo) / (hi - lo)) * (h - 24);
  const zero = y(0);
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    segs.push(`<line x1="${x(a[0]).toFixed(1)}" y1="${y(a[1]).toFixed(1)}" x2="${x(b[0]).toFixed(1)}" y2="${y(b[1]).toFixed(1)}" stroke="var(--${(a[1] + b[1]) / 2 >= 0 ? 'up' : 'down'})" stroke-width="2.2" stroke-linecap="round"/>`);
  }
  const mark = (v, label, color, ty) => (v >= x0 && v <= x1 ? `<line x1="${x(v)}" x2="${x(v)}" y1="14" y2="${h - 16}" stroke="${color}" stroke-dasharray="3 3"/>
      <text x="${Math.min(Math.max(x(v), 44), w - 44)}" y="${ty}" fill="${color}" font-size="10.5" text-anchor="middle">${label}</text>` : '');
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <line x1="0" x2="${w}" y1="${zero}" y2="${zero}" stroke="var(--line)"/>
    ${mark(current, `now $${current?.toFixed(2)}`, 'var(--muted)', 10)}
    ${mark(breakeven, `breakeven $${breakeven?.toFixed(2)}`, 'var(--text)', h - 3)}
    ${segs.join('')}
  </svg>`;
}
