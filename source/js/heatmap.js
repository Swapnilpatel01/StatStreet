// Squarified treemap layout for the market heatmap (tiles sized by market value, colored by change).

function worst(row, side, total, area) {
  // Largest aspect ratio in a row laid along `side`.
  const s = row.reduce((a, r) => a + r.area, 0);
  let max = 0;
  for (const r of row) {
    const len = (s / side);
    const other = r.area / len;
    max = Math.max(max, len / other, other / len);
  }
  return max;
}

// items: [{ value, ...any }]. Returns the same items with x, y, w, h in the given rectangle.
export function squarify(items, W, H) {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = list.reduce((s, i) => s + i.value, 0);
  if (!total || W <= 0 || H <= 0) return [];
  const scale = (W * H) / total;
  const nodes = list.map((i) => ({ ...i, area: i.value * scale }));
  const out = [];
  let x = 0; let y = 0; let w = W; let h = H;
  let row = [];
  const layRow = () => {
    const s = row.reduce((a, r) => a + r.area, 0);
    if (w >= h) { // lay the row as a column on the left
      const cw = s / h; let cy = y;
      for (const r of row) { const rh = r.area / cw; out.push({ ...r, x, y: cy, w: cw, h: rh }); cy += rh; }
      x += cw; w -= cw;
    } else { // lay the row along the top
      const rh = s / w; let cx = x;
      for (const r of row) { const rw = r.area / rh; out.push({ ...r, x: cx, y, w: rw, h: rh }); cx += rw; }
      y += rh; h -= rh;
    }
    row = [];
  };
  for (const n of nodes) {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
    else { layRow(); row.push(n); }
  }
  if (row.length) layRow();
  return out;
}

// Color for a percentage change: deeper green/red for bigger moves, gray when flat.
export function heatColor(pct) {
  const k = Math.min(1, Math.abs(pct) / 0.06);
  if (Math.abs(pct) < 0.001) return 'rgb(58,63,72)';
  const base = [58, 63, 72];
  const tgt = pct > 0 ? [20, 170, 95] : [215, 60, 66];
  const c = base.map((b, i) => Math.round(b + (tgt[i] - b) * (0.35 + 0.65 * k)));
  return `rgb(${c.join(',')})`;
}
