// Native-feeling gestures: swipe-to-dismiss sheets, edge swipe back, pull to refresh, haptics.

// iOS Safari has no vibration API, but toggling a hidden switch control gives a
// system haptic tick (iOS 18+). Elsewhere we fall back to navigator.vibrate.
let hapticLabel = null;
export function haptic() {
  try {
    if (navigator.vibrate) { navigator.vibrate(8); return; }
    if (!hapticLabel) {
      hapticLabel = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
      hapticLabel.append(input);
      hapticLabel.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px';
      hapticLabel.dataset.haptic = '1';
      document.body.append(hapticLabel);
    }
    hapticLabel.click();
  } catch { /* no haptics available */ }
}

const EASE = 'transform .24s cubic-bezier(.2,.8,.2,1)';

// Slide an element off screen, then call done().
export function slideOut(el, axis, done, extra = []) {
  const all = [el, ...extra].filter(Boolean);
  for (const x of all) { x.style.transition = EASE; x.style.transform = axis === 'y' ? 'translateY(100%)' : 'translateX(100%)'; }
  setTimeout(() => { for (const x of all) { x.style.transition = ''; x.style.transform = ''; } done(); }, 240);
}

// Drag an element down (axis 'y') or right from the left edge (axis 'x') to dismiss it.
export function dismissable(el, { axis, canStart = () => true, onDismiss, extra = () => [], backdrop = null }) {
  let sx = 0; let sy = 0; let t0 = 0; let active = null; let dist = 0;
  const move = (v) => {
    const t = axis === 'y' ? `translateY(${v}px)` : `translateX(${v}px)`;
    for (const x of [el, ...extra()]) if (x) { x.style.transition = 'none'; x.style.transform = t; }
    if (backdrop) backdrop.style.backgroundColor = `rgba(0,0,0,${0.55 * Math.max(0, 1 - v / (el.offsetHeight || 1))})`;
  };
  const reset = () => {
    for (const x of [el, ...extra()]) if (x) { x.style.transition = EASE; x.style.transform = ''; }
    if (backdrop) backdrop.style.backgroundColor = '';
    setTimeout(() => { for (const x of [el, ...extra()]) if (x) x.style.transition = ''; }, 250);
  };
  el.addEventListener('touchstart', (e) => {
    active = null; dist = 0;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (axis === 'x' && t.clientX > 24) { active = false; return; }
    if (!canStart(e)) { active = false; return; }
    sx = t.clientX; sy = t.clientY; t0 = performance.now();
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (active === false) return;
    const t = e.touches[0]; const dx = t.clientX - sx; const dy = t.clientY - sy;
    if (active === null) {
      const main = axis === 'y' ? dy : dx; const cross = axis === 'y' ? dx : dy;
      if (main > 6 && main > Math.abs(cross)) active = true;
      else if (Math.abs(dx) > 6 || Math.abs(dy) > 6) { active = false; return; }
      else return;
    }
    e.preventDefault();
    dist = Math.max(0, axis === 'y' ? dy : dx);
    move(dist);
  }, { passive: false });
  const end = () => {
    if (!active) { active = null; return; }
    active = null;
    const size = axis === 'y' ? el.offsetHeight : el.offsetWidth;
    const v = dist / Math.max(1, performance.now() - t0);
    if (dist > size * 0.3 || (v > 0.5 && dist > 40)) {
      haptic();
      slideOut(el, axis, () => { if (backdrop) backdrop.style.backgroundColor = ''; onDismiss(); }, extra());
    } else reset();
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}

// Pull down at the top of a scroll container to refresh.
export function pullToRefresh(scroller, indicator, { enabled = () => true, onRefresh }) {
  let sy = 0; let pull = 0; let tracking = false; let busy = false;
  const THRESH = 70;
  const show = (p) => {
    indicator.style.opacity = String(Math.min(1, p / THRESH));
    indicator.style.transform = `translate(-50%, ${Math.min(p, 90) * 0.6}px) rotate(${p * 3}deg)`;
    indicator.classList.toggle('ready', p >= THRESH);
  };
  scroller.addEventListener('touchstart', (e) => {
    tracking = !busy && enabled() && scroller.scrollTop <= 0 && e.touches.length === 1;
    sy = e.touches[0].clientY; pull = 0;
  }, { passive: true });
  scroller.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const dy = e.touches[0].clientY - sy;
    if (dy <= 0 || scroller.scrollTop > 0) { if (pull) show(0); pull = 0; return; }
    pull = dy * 0.55; show(pull);
  }, { passive: true });
  scroller.addEventListener('touchend', async () => {
    if (!tracking) return;
    tracking = false;
    if (pull >= THRESH) {
      busy = true; haptic();
      indicator.classList.add('spin'); indicator.style.opacity = '1'; indicator.style.transform = 'translate(-50%, 36px)';
      try { await onRefresh(); } finally {
        busy = false; indicator.classList.remove('spin', 'ready');
        indicator.style.transition = 'opacity .2s'; indicator.style.opacity = '0';
        setTimeout(() => { indicator.style.transition = ''; }, 250);
      }
    } else show(0);
    pull = 0;
  });
}
