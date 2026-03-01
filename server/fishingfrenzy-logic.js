const { normalizeGold } = require('./utils');

const CATCH_TABLE = [
  { id: 'rubber-boot', name: 'Rubber Boot', tier: 'F', weight: 20, min: 1, max: 5, imageUrl: '/icons/RubberBoot.svg' },
  { id: 'rusty-can', name: 'Rusty Can', tier: 'F', weight: 18, min: 1, max: 6, imageUrl: '/icons/RustyCan.svg' },
  { id: 'old-bottle', name: 'Old Bottle', tier: 'F', weight: 17, min: 1, max: 7, imageUrl: '/icons/OldBottle.svg' },
  { id: 'torn-net', name: 'Torn Net', tier: 'F', weight: 15, min: 2, max: 8, imageUrl: '/icons/TornNet.svg' },
  { id: 'broken-lure', name: 'Broken Lure', tier: 'F', weight: 13, min: 2, max: 8, imageUrl: '/icons/BrokenLure.svg' },
  { id: 'bottle-cap', name: 'Bottle Cap', tier: 'F', weight: 12, min: 2, max: 9, imageUrl: '/icons/BottleCap.svg' },
  { id: 'seaweed-clump', name: 'Seaweed Clump', tier: 'E', weight: 14, min: 4, max: 12, imageUrl: '/icons/SeaweedClump.svg' },
  { id: 'driftwood', name: 'Driftwood', tier: 'E', weight: 13, min: 5, max: 14, imageUrl: '/icons/Driftwood.svg' },
  { id: 'old-tire', name: 'Old Tire', tier: 'E', weight: 12, min: 6, max: 15, imageUrl: '/icons/OldTire.svg' },
  { id: 'cracked-buoy', name: 'Cracked Buoy', tier: 'E', weight: 10, min: 8, max: 18, imageUrl: '/icons/Driftwood.svg' },
  { id: 'sardine', name: 'Sardine', tier: 'D', weight: 16, min: 8, max: 19, imageUrl: '/icons/Sardine.svg' },
  { id: 'anchovy', name: 'Anchovy', tier: 'D', weight: 14, min: 9, max: 21, imageUrl: '/icons/Sardine.svg' },
  { id: 'minnow', name: 'Minnow', tier: 'D', weight: 13, min: 10, max: 22, imageUrl: '/icons/Clownfish.svg' },
  { id: 'herring', name: 'Herring', tier: 'D', weight: 12, min: 11, max: 24, imageUrl: '/icons/Sardine.svg' },
  { id: 'sprat', name: 'Sprat', tier: 'D', weight: 10, min: 12, max: 25, imageUrl: '/icons/Sardine.svg' },
  { id: 'clownfish', name: 'Clownfish', tier: 'C', weight: 11, min: 15, max: 31, imageUrl: '/icons/Clownfish.svg' },
  { id: 'mackerel', name: 'Mackerel', tier: 'C', weight: 10, min: 17, max: 35, imageUrl: '/icons/Clownfish.svg' },
  { id: 'bluegill', name: 'Bluegill', tier: 'C', weight: 9, min: 18, max: 38, imageUrl: '/icons/Clownfish.svg' },
  { id: 'snapper', name: 'Snapper', tier: 'C', weight: 8, min: 20, max: 41, imageUrl: '/icons/Puffer.svg' },
  { id: 'cod', name: 'Cod', tier: 'C', weight: 7, min: 22, max: 45, imageUrl: '/icons/Tuna.svg' },
  { id: 'puffer', name: 'Puffer', tier: 'B', weight: 8, min: 24, max: 52, imageUrl: '/icons/Puffer.svg' },
  { id: 'salmon', name: 'Salmon', tier: 'B', weight: 7, min: 28, max: 61, imageUrl: '/icons/Puffer.svg' },
  { id: 'tuna', name: 'Tuna', tier: 'B', weight: 6, min: 34, max: 76, imageUrl: '/icons/Tuna.svg' },
  { id: 'barracuda', name: 'Barracuda', tier: 'B', weight: 5, min: 36, max: 83, imageUrl: '/icons/Barracuda.svg' },
  { id: 'mahi-mahi', name: 'Mahi-Mahi', tier: 'B', weight: 4, min: 38, max: 88, imageUrl: '/icons/MahiMahi.svg' },
  { id: 'wahoo', name: 'Wahoo', tier: 'A', weight: 4, min: 52, max: 116, imageUrl: '/icons/Wahoo.svg' },
  { id: 'swordfish', name: 'Swordfish', tier: 'A', weight: 3, min: 57, max: 124, imageUrl: '/icons/Swordfish.svg' },
  { id: 'marlin', name: 'Marlin', tier: 'A', weight: 3, min: 62, max: 136, imageUrl: '/icons/Marlin.svg' },
  { id: 'manta-ray', name: 'Manta Ray', tier: 'A', weight: 2, min: 70, max: 152, imageUrl: '/icons/MantaRay.svg' },
  { id: 'angler', name: 'Angler', tier: 'S', weight: 2, min: 102, max: 198, imageUrl: '/icons/Angler.svg' },
  { id: 'krakenling', name: 'Krakenling', tier: 'S', weight: 2, min: 122, max: 236, imageUrl: '/icons/Krakenling.svg' },
  { id: 'leviathan', name: 'Leviathan', tier: 'S', weight: 1, min: 160, max: 312, imageUrl: '/icons/Leviathan.svg' },
];
const RARE_CATCH_CHANCE = 0.07;
const RARE_CATCH_TABLE = [
  { id: 'crystal-koi', name: 'Crystal Koi', tier: 'S', weight: 20, min: 130, max: 285, imageUrl: '/icons/MahiMahi.svg' },
  { id: 'ember-eel', name: 'Ember Eel', tier: 'S', weight: 18, min: 145, max: 310, imageUrl: '/icons/Barracuda.svg' },
  { id: 'storm-ray', name: 'Storm Ray', tier: 'S', weight: 15, min: 160, max: 345, imageUrl: '/icons/MantaRay.svg' },
  { id: 'deep-crown-whale', name: 'Deep Crown Whale', tier: 'SS', weight: 9, min: 220, max: 500, imageUrl: '/icons/CrownWhale.svg' },
  { id: 'void-ray', name: 'Void Ray', tier: 'SS', weight: 7, min: 260, max: 560, imageUrl: '/icons/VoidRay.svg' },
  { id: 'abyss-kraken', name: 'Abyss Kraken', tier: 'SS', weight: 4, min: 320, max: 720, imageUrl: '/icons/Krakenling.svg' },
];
const CATCH_EVENT_CHANCE = 0.24;
const CATCH_EVENTS = [
  { id: 'bait-ball', label: 'Bait Ball', weight: 32, multiplierMin: 1.1, multiplierMax: 1.35, flatMin: 5, flatMax: 24, tierBoost: 0 },
  { id: 'sunburst-current', label: 'Sunburst Current', weight: 24, multiplierMin: 1.25, multiplierMax: 1.65, flatMin: 0, flatMax: 0, tierBoost: 0 },
  { id: 'echo-school', label: 'Echo School', weight: 18, multiplierMin: 1.1, multiplierMax: 1.3, flatMin: 12, flatMax: 38, tierBoost: 1 },
  { id: 'abyss-rift', label: 'Abyss Rift', weight: 10, multiplierMin: 1.4, multiplierMax: 1.95, flatMin: 20, flatMax: 52, tierBoost: 1 },
  { id: 'royal-wave', label: 'Royal Wave', weight: 5, multiplierMin: 1.55, multiplierMax: 2.25, flatMin: 30, flatMax: 76, tierBoost: 2 },
];
const TIER_ORDER = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS'];
const TIDE_SHIFT_CHANCE = 0.12;
const TIDE_SHIFTS = [
  { id: 'moon-tide', label: 'Moon Tide', multiplier: 1.5 },
  { id: 'storm-surge', label: 'Storm Surge', multiplier: 1.8 },
  { id: 'glass-current', label: 'Glass Current', multiplier: 1.3 },
];
const POTION_CHANCE = 0.11;
const POTION_EFFECTS = [
  { id: 'ink-cloud', label: 'Ink Cloud Potion', style: 'ink', durationMs: 7000 },
  { id: 'prism-wave', label: 'Prism Wave Potion', style: 'prism', durationMs: 8000 },
  { id: 'fog-bloom', label: 'Fog Bloom Potion', style: 'fog', durationMs: 6500 },
];

function randomInt(min, max) {
  const safeMin = Math.floor(Math.min(min, max));
  const safeMax = Math.floor(Math.max(min, max));
  return safeMin + Math.floor(Math.random() * (safeMax - safeMin + 1));
}

function randomFloat(min, max) {
  const safeMin = Math.min(Number(min || 0), Number(max || 0));
  const safeMax = Math.max(Number(min || 0), Number(max || 0));
  return safeMin + (Math.random() * (safeMax - safeMin));
}

function weightedPick(table) {
  if (!Array.isArray(table) || !table.length) return null;
  const totalWeight = table.reduce((sum, entry) => sum + Number(entry.weight || 0), 0);
  let roll = Math.random() * Math.max(1, totalWeight);
  for (const entry of table) {
    roll -= Number(entry.weight || 0);
    if (roll <= 0) return entry;
  }
  return table[0];
}

function weightedCatchPick() {
  const rareRoll = Math.random() < RARE_CATCH_CHANCE;
  if (rareRoll) {
    const rarePick = weightedPick(RARE_CATCH_TABLE);
    if (rarePick) return { ...rarePick, rarity: 'rare' };
  }
  const commonPick = weightedPick(CATCH_TABLE) || CATCH_TABLE[0];
  return { ...commonPick, rarity: 'common' };
}

function boostTier(baseTier, steps = 0) {
  const index = TIER_ORDER.indexOf(String(baseTier || '').toUpperCase());
  if (index < 0) return String(baseTier || '-').toUpperCase();
  const targetIndex = Math.max(0, Math.min(TIER_ORDER.length - 1, index + Math.max(0, Number(steps || 0))));
  return TIER_ORDER[targetIndex];
}

function randomCatchEvent() {
  if (Math.random() >= CATCH_EVENT_CHANCE) return null;
  const picked = weightedPick(CATCH_EVENTS);
  if (!picked) return null;
  return {
    active: true,
    id: String(picked.id || 'catch-event'),
    label: String(picked.label || 'Current Shift'),
    multiplier: Number(randomFloat(picked.multiplierMin || 1, picked.multiplierMax || 1).toFixed(2)),
    flatBonus: normalizeGold(randomInt(Number(picked.flatMin || 0), Number(picked.flatMax || 0))),
    tierBoost: Math.max(0, Math.floor(Number(picked.tierBoost || 0))),
    token: `e-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
  };
}

function randomTideShift() {
  if (Math.random() >= TIDE_SHIFT_CHANCE) return null;
  const picked = TIDE_SHIFTS[Math.floor(Math.random() * TIDE_SHIFTS.length)] || TIDE_SHIFTS[0];
  return {
    active: true,
    id: picked.id,
    label: picked.label,
    multiplier: Number(picked.multiplier || 1),
    token: `t-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
  };
}

function maybeRollPotionEffect() {
  if (Math.random() >= POTION_CHANCE) return null;
  const picked = POTION_EFFECTS[Math.floor(Math.random() * POTION_EFFECTS.length)] || POTION_EFFECTS[0];
  return {
    active: true,
    id: picked.id,
    label: picked.label,
    style: picked.style,
    durationMs: Math.max(2500, Number(picked.durationMs || 7000)),
    token: `p-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
  };
}

function setFishingWorldEffect(game, effect, nowMs = Date.now()) {
  if (!game || typeof game !== 'object') return null;
  if (!effect || typeof effect !== 'object' || !effect.active) {
    game.fishingWorldEffect = null;
    return null;
  }
  const startedAtMs = Number(nowMs);
  const durationMs = Math.max(2500, Number(effect.durationMs || 7000));
  game.fishingWorldEffect = {
    ...effect,
    startedAtMs,
    untilMs: startedAtMs + durationMs,
  };
  return { ...game.fishingWorldEffect };
}

function getFishingWorldEffect(game, nowMs = Date.now()) {
  if (!game || typeof game !== 'object') return null;
  const effect = game.fishingWorldEffect;
  if (!effect || typeof effect !== 'object') return null;
  const now = Number(nowMs);
  if (now >= Number(effect.untilMs || 0)) {
    game.fishingWorldEffect = null;
    return null;
  }
  return {
    ...effect,
    remainingMs: Math.max(0, Number(effect.untilMs || 0) - now),
  };
}

function rollFishingCatch() {
  const picked = weightedCatchPick();
  const baseLbs = normalizeGold(randomInt(Number(picked.min), Number(picked.max)));
  const event = randomCatchEvent();
  const tide = randomTideShift();
  const tideMultiplier = tide?.active ? Number(tide.multiplier || 1) : 1;
  const afterTideLbs = normalizeGold(baseLbs * tideMultiplier);
  const eventMultiplier = event?.active ? Number(event.multiplier || 1) : 1;
  const eventFlatBonus = event?.active ? normalizeGold(Number(event.flatBonus || 0)) : 0;
  const lbs = normalizeGold((afterTideLbs * eventMultiplier) + eventFlatBonus);
  const tier = event?.active && Number(event.tierBoost || 0) > 0
    ? boostTier(picked.tier, Number(event.tierBoost || 0))
    : picked.tier;
  return {
    id: picked.id,
    name: picked.name,
    tier,
    baseTier: picked.tier,
    rarity: String(picked.rarity || 'common'),
    baseLbs,
    lbs,
    imageUrl: picked.imageUrl || null,
    tide: tide?.active
      ? {
        ...tide,
        bonusLbs: normalizeGold(afterTideLbs - baseLbs),
      }
      : null,
    event: event?.active
      ? {
        ...event,
        bonusLbs: normalizeGold(lbs - afterTideLbs),
        tierAfter: tier,
      }
      : null,
  };
}

function randomBiteWaitMs() {
  return randomInt(1300, 3600);
}

function createFishingState() {
  return {
    phase: 'cast',
    waitUntilMs: 0,
    pendingCatch: null,
    lastResult: null,
  };
}

function ensureFishingState(player) {
  if (!player || typeof player !== 'object') return createFishingState();
  if (!player.fishing || typeof player.fishing !== 'object') {
    player.fishing = createFishingState();
    return player.fishing;
  }
  const state = player.fishing;
  const validPhases = new Set(['cast', 'waiting', 'pull', 'question', 'result']);
  if (!validPhases.has(state.phase)) state.phase = 'cast';
  if (!Number.isFinite(Number(state.waitUntilMs))) state.waitUntilMs = 0;
  if (state.pendingCatch && typeof state.pendingCatch !== 'object') state.pendingCatch = null;
  if (state.lastResult && typeof state.lastResult !== 'object') state.lastResult = null;
  return state;
}

function advanceFishingState(player, nowMs = Date.now()) {
  const state = ensureFishingState(player);
  if (state.phase === 'waiting' && Number(nowMs) >= Number(state.waitUntilMs || 0)) {
    state.phase = 'pull';
  }
  return state;
}

function getFishingPayload(player, nowMs = Date.now()) {
  const state = advanceFishingState(player, nowMs);
  const waitRemainingMs = state.phase === 'waiting'
    ? Math.max(0, Math.floor(Number(state.waitUntilMs || 0) - Number(nowMs)))
    : 0;
  return {
    phase: state.phase,
    waitRemainingMs,
    pendingCatch: state.pendingCatch
      ? {
        ...state.pendingCatch,
        tide: state.pendingCatch.tide ? { ...state.pendingCatch.tide } : null,
        event: state.pendingCatch.event ? { ...state.pendingCatch.event } : null,
      }
      : null,
    lastResult: state.lastResult
      ? {
        ...state.lastResult,
        tide: state.lastResult.tide ? { ...state.lastResult.tide } : null,
        event: state.lastResult.event ? { ...state.lastResult.event } : null,
      }
      : null,
  };
}

module.exports = {
  CATCH_TABLE,
  createFishingState,
  ensureFishingState,
  advanceFishingState,
  getFishingPayload,
  maybeRollPotionEffect,
  setFishingWorldEffect,
  getFishingWorldEffect,
  rollFishingCatch,
  randomBiteWaitMs,
};
