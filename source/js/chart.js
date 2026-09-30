// Lightweight SVG charts: a full chart with touch scrubbing, and sparklines.

export function sliceRange(flat, from) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) if (flat[i] >= from) pts.push([flat[i], flat[i + 1]]);
  // Keep one point before the window so the line starts at the left edge.
  if (flat.length >= 2) {
    let prev = null;
    for (let i = 0; i < flat.length; i += 2) if (flat[i] < from) prev = [from, flat[i + 1]];
    if (prev) pts.unshift(prev);
  }
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
export function lineChart(el, flat, from, { onScrub } = {}) {
  const pts = sliceRange(flat, from);
  const w = el.clientWidth || 340; const h = 190;
  if (pts.length < 2) {
    el.innerHTML = `<div class="chart-empty">Not enough trading history yet for this range.</div>`;
    return;
  }
  const ys = pts.map((p) => p[1]);
  let lo = Math.min(...ys); let hi = Math.max(...ys);
  const pad = (hi - lo) * 0.12 || hi * 0.02 || 1; lo -= pad; hi += pad;
  const t0 = pts[0][0]; const t1 = pts[pts.length - 1][0];
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * (w - 4) + 2;
  const y = (v) => h - 6 - ((v - lo) / (hi - lo)) * (h - 12);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const up = ys[ys.length - 1] >= ys[0];
  const color = `var(--${up ? 'up' : 'down'})`;
  const base = y(ys[0]);
  el.innerHTML = `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="chart">
      <defs><linearGradient id="g${up ? 'u' : 'd'}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity="0.28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <line x1="0" x2="${w}" y1="${base}" y2="${base}" stroke="var(--line)" stroke-dasharray="2 4"/>
      <path d="${d}L${x(t1)},${h}L${x(t0)},${h}Z" fill="url(#g${up ? 'u' : 'd'})"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <g class="cursor" style="display:none">
        <line y1="0" y2="${h}" stroke="var(--muted)" stroke-width="1"/>
        <circle r="4.5" fill="${color}" stroke="var(--bg)" stroke-width="2"/>
      </g>
    </svg>`;
  const svg = el.querySelector('svg');
  const cur = svg.querySelector('.cursor');
  const move = (clientX) => {
    const r = svg.getBoundingClientRect();
    const t = t0 + ((clientX - r.left - 2) / (w - 4)) * (t1 - t0);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
    cur.style.display = '';
    cur.querySelector('line').setAttribute('x1', x(best[0])); cur.querySelector('line').setAttribute('x2', x(best[0]));
    cur.querySelector('circle').setAttribute('cx', x(best[0])); cur.querySelector('circle').setAttribute('cy', y(best[1]));
    onScrub?.({ t: best[0], p: best[1], first: ys[0] });
  };
  const end = () => { cur.style.display = 'none'; onScrub?.(null); };
  svg.addEventListener('touchstart', (e) => move(e.touches[0].clientX), { passive: true });
  svg.addEventListener('touchmove', (e) => { move(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  svg.addEventListener('touchend', end);
  svg.addEventListener('mousemove', (e) => move(e.clientX));
  svg.addEventListener('mouseleave', end);
}
