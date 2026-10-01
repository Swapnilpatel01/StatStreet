// Career progression primitives: XP, levels, coins and what each level unlocks.
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

// Award XP; each new level pays 50 coins and announces what it unlocked.
export function addXP(state, n, now = Date.now()) {
  const c = career(state);
  const before = levelOf(c.xp);
  c.xp += Math.max(0, Math.round(n));
  const after = levelOf(c.xp);
  for (let L = before + 1; L <= after; L++) {
    c.coins += 50;
    notify(state, 'level', `Level ${L}! +50 coins${UNLOCKS[L] ? ` · Unlocked: ${UNLOCKS[L]}` : ''}`, null, now);
  }
  return after > before;
}

export function addCoins(state, n) {
  const c = career(state);
  c.coins = Math.max(0, c.coins + Math.round(n));
}

export function spendCoins(state, n) {
  const c = career(state);
  if (c.coins < n) throw new Error(`You need ${n} coins (you have ${c.coins})`);
  c.coins -= n;
}

export function xpProgress(state) {
  const c = career(state);
  const L = levelOf(c.xp);
  const lo = LEVEL_XP(L); const hi = LEVEL_XP(L + 1);
  return { level: L, xp: c.xp, into: c.xp - lo, need: hi - lo, frac: L >= MAX_LEVEL ? 1 : (c.xp - lo) / (hi - lo) };
}
