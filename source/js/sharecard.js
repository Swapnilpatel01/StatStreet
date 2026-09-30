// Shareable images drawn on a canvas: a portfolio brag card and a player/team card.

const W = 1080; const H = 1350;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif';

function base(ctx, accent) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#11151b'); g.addColorStop(1, '#07090b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, 120, 20, W * 0.85, 120, 700);
  glow.addColorStop(0, accent + '55'); glow.addColorStop(1, accent + '00');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#eceef1'; ctx.font = `800 54px ${FONT}`;
  ctx.fillText('Stat', 80, 130);
  const sw = ctx.measureText('Stat').width;
  ctx.fillStyle = '#1fd67a'; ctx.fillText('Street', 80 + sw, 130);
  ctx.fillStyle = '#5b636e'; ctx.font = `500 30px ${FONT}`;
  ctx.fillText('The sports stock market · play money', 80, H - 70);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function fitText(ctx, text, maxW, weight, size) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${FONT}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 20);
}

const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(Math.abs(x) < 0.1 ? 2 : 1)}%`;
const usd = (x) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// d: { netWorth, ret, bench, holdings: [{ticker, name, pct}], picks: 'W-L', streak, cards, trophies }
export function portfolioCard(d) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const up = d.ret >= 0; const col = up ? '#1fd67a' : '#ff5a5f';
  base(ctx, col);
  ctx.fillStyle = '#8b939e'; ctx.font = `600 36px ${FONT}`; ctx.fillText('My portfolio', 80, 270);
  ctx.fillStyle = '#eceef1'; fitText(ctx, usd(d.netWorth), W - 160, 800, 150); ctx.fillText(usd(d.netWorth), 80, 420);
  ctx.fillStyle = col; ctx.font = `800 64px ${FONT}`; ctx.fillText(`${up ? '▲' : '▼'} ${pct(d.ret)} all time`, 80, 510);
  if (d.bench != null) {
    ctx.fillStyle = '#8b939e'; ctx.font = `500 34px ${FONT}`;
    ctx.fillText(`StatStreet 500 ${pct(d.bench)} over the same time`, 80, 570);
  }
  let y = 660;
  if (d.holdings.length) {
    ctx.fillStyle = '#8b939e'; ctx.font = `700 30px ${FONT}`; ctx.fillText('TOP HOLDINGS', 80, y); y += 30;
    for (const h of d.holdings.slice(0, 3)) {
      roundRect(ctx, 80, y, W - 160, 104, 24); ctx.fillStyle = '#161a20'; ctx.fill();
      ctx.fillStyle = '#eceef1'; fitText(ctx, h.name, W - 480, 700, 40); ctx.fillText(h.name, 116, y + 66);
      ctx.fillStyle = h.pct >= 0 ? '#1fd67a' : '#ff5a5f'; ctx.font = `800 40px ${FONT}`; ctx.textAlign = 'right';
      ctx.fillText(pct(h.pct), W - 116, y + 66); ctx.textAlign = 'left';
      y += 124;
    }
  }
  const stats = [['Pick\'em', d.picks], ['Streak', `${d.streak}🔥`], ['Cards', String(d.cards)], ['Trophies', String(d.trophies)]];
  const bw = (W - 160 - 3 * 20) / 4;
  stats.forEach(([k, v], i) => {
    const x = 80 + i * (bw + 20);
    roundRect(ctx, x, H - 300, bw, 150, 24); ctx.fillStyle = '#161a20'; ctx.fill();
    ctx.fillStyle = '#eceef1'; ctx.font = `800 48px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(v, x + bw / 2, H - 215);
    ctx.fillStyle = '#8b939e'; ctx.font = `600 28px ${FONT}`; ctx.fillText(k, x + bw / 2, H - 175); ctx.textAlign = 'left';
  });
  return c;
}

// d: { name, ticker, sub, price, change, rarity: {name,color}, level, stats: [[k,v]...] }
export function assetCard(d) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const col = d.rarity?.color || '#1fd67a';
  base(ctx, col);
  const x = 110; const y = 200; const w = W - 220; const h = 880;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, col); g.addColorStop(0.5, '#ffffff66'); g.addColorStop(1, col);
  roundRect(ctx, x - 8, y - 8, w + 16, h + 16, 48); ctx.fillStyle = g; ctx.fill();
  const inner = ctx.createLinearGradient(x, y, x, y + h);
  inner.addColorStop(0, '#1d232c'); inner.addColorStop(1, '#0d1014');
  roundRect(ctx, x, y, w, h, 42); ctx.fillStyle = inner; ctx.fill();
  ctx.fillStyle = col; ctx.font = `800 34px ${FONT}`; ctx.fillText((d.rarity?.name || '').toUpperCase(), x + 50, y + 80);
  if (d.level) { ctx.textAlign = 'right'; ctx.fillStyle = '#eceef1'; ctx.fillText(`LV ${d.level}`, x + w - 50, y + 80); ctx.textAlign = 'left'; }
  // monogram
  ctx.beginPath(); ctx.arc(x + w / 2, y + 290, 150, 0, Math.PI * 2); ctx.fillStyle = col + '33'; ctx.fill();
  ctx.fillStyle = '#eceef1'; ctx.font = `800 120px ${FONT}`; ctx.textAlign = 'center';
  ctx.fillText(d.ticker.slice(0, 4), x + w / 2, y + 332);
  fitText(ctx, d.name, w - 100, 800, 64); ctx.fillText(d.name, x + w / 2, y + 540);
  ctx.fillStyle = '#8b939e'; ctx.font = `600 32px ${FONT}`; ctx.fillText(d.sub, x + w / 2, y + 590);
  ctx.fillStyle = '#eceef1'; ctx.font = `800 84px ${FONT}`; ctx.fillText(usd(d.price), x + w / 2, y + 700);
  ctx.fillStyle = d.change >= 0 ? '#1fd67a' : '#ff5a5f'; ctx.font = `700 40px ${FONT}`;
  ctx.fillText(`${pct(d.change)} this week`, x + w / 2, y + 760);
  ctx.textAlign = 'left';
  const sy = y + h + 80;
  (d.stats || []).slice(0, 3).forEach(([k, v], i) => {
    const bw = (W - 160 - 40) / 3; const bx = 80 + i * (bw + 20);
    ctx.fillStyle = '#eceef1'; ctx.font = `800 40px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(String(v), bx + bw / 2, sy);
    ctx.fillStyle = '#8b939e'; ctx.font = `600 26px ${FONT}`; ctx.fillText(k, bx + bw / 2, sy + 40); ctx.textAlign = 'left';
  });
  return c;
}

// Share through the iOS share sheet when possible, otherwise download the PNG.
export async function shareCanvas(canvas, name, text) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Could not draw the image');
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return 'shared'; } catch (e) { if (e?.name === 'AbortError') return 'canceled'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}
