// Career progression primitives: XP, levels, reward money and what each level unlocks.
// Kept tiny and dependency-light so every game module can award XP.

import { notify } from './engine.js';

// Total XP needed to reach level L (L1 = 0, L2 = 100, L5 ≈ 920, L10 ≈ 3,370).
export const LEVEL_XP = (L) => (L <= 1 ? 0 : Math.round(100 * Math.pow(L - 1, 1.6)));
export const MAX_LEVEL = 30;

export function levelOf(xp) {
  let L = 1;
  while (L < MAX_LEVEL && xp >= LEVEL_XP(L + 1)) L++;
  return L;
}

export const UNLOCKS = {
  2: 'Pro contests',
  3: 'Rare packs · Ice theme',
  4: 'Prop parlays',
  5: 'Elite packs · Court theme',
  6: 'High Roller contests',
  7: 'Midnight theme',
  8: 'Legend packs',
  9: 'Gold Rush theme',
  10: '"Mogul" title',
};

export function career(state) {
  state.career ||= {};
  const c = state.career;
  c.xp ??= 0; c.coins ??= 0; c.title ??= 'Rookie'; c.theme ??= 'classic';
  c.owned ??= { themes: ['classic'], titles: ['Rookie'] };
  c.seasons ??= []; c.cursor ??= Date.now(); c.tradeXP ??= { day: '', n: 0 };
  c.packs ??= 0;
  return c;
}

export const level = (state) => levelOf(career(state).xp);
export const hasLevel = (state, L) => level(state) >= L;

// Award XP; each new level pays $0.50 and announces what it unlocked.
export function addXP(state, n, now = Date.now()) {
  const c = career(state);
  const before = levelOf(c.xp);
  c.xp += Math.max(0, Math.round(n));
  const after = levelOf(c.xp);
  for (let L = before + 1; L <= after; L++) {
    addCoins(state, 50);
    notify(state, 'level', `Level ${L}! +${centsFmt(50)}${UNLOCKS[L] ? ` · Unlocked: ${UNLOCKS[L]}` : ''}`, null, now);
  }
  return after > before;
}

// Cards, packs and rewards all use your cash. Amounts are whole cents (150 = $1.50).
// Every cent that moves this way is also tallied in state.flow, so season and weekly
// returns measure your trading only: rewards don't inflate them, card buys don't sink them.
export const centsFmt = (n) => `$${(Math.round(n) / 100).toFixed(2)}`;
export const wallet = (state) => Math.floor((state.cash || 0) * 100 + 1e-6);
function move(state, cents) {
  state.cash = Math.round((state.cash + cents / 100) * 100) / 100;
  state.flow = Math.round(((state.flow || 0) + cents / 100) * 100) / 100;
}
export function addCoins(state, n) { move(state, Math.round(n)); }

export function spendCoins(state, n) {
  n = Math.round(n);
  if (wallet(state) < n) throw new Error(`You need ${centsFmt(n)} in cash (you have ${centsFmt(wallet(state))})`);
  move(state, -n);
}
// Saves from when cards used coins: the coin balance becomes cash, 100 coins to the dollar.
export function convertCoins(state, now = Date.now()) {
  const c = career(state);
  if (!(c.coins > 0)) { c.coins = 0; return 0; }
  const n = Math.round(c.coins); c.coins = 0;
  addCoins(state, n);
  notify(state, 'info', `Coins are gone: cards and packs now cost cash. Your ${n.toLocaleString()} coins became ${centsFmt(n)}.`, null, now);
  return n;
}

export function xpProgress(state) {
  const c = career(state);
  const L = levelOf(c.xp);
  const lo = LEVEL_XP(L); const hi = LEVEL_XP(L + 1);
  return { level: L, xp: c.xp, into: c.xp - lo, need: hi - lo, frac: L >= MAX_LEVEL ? 1 : (c.xp - lo) / (hi - lo) };
}
