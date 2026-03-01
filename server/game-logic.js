// Game logic modules - re-exported for convenience
// Each game mode has its own file for clean separation

const gameCore = require('./game-core');
const goldquestLogic = require('./goldquest-logic');
const assembleLogic = require('./assemble-logic');
const fishingFrenzyLogic = require('./fishingfrenzy-logic');

// Core game functionality
module.exports = {
  // From game-core.js
  createHostedGame: gameCore.createHostedGame,
  publicGame: gameCore.publicGame,
  isLiveGameTimerExpired: gameCore.isLiveGameTimerExpired,
  endGameWhenTimerExpires: gameCore.endGameWhenTimerExpires,

  // From goldquest-logic.js
  chestOptionLabel: goldquestLogic.chestOptionLabel,
  makeChestChoices: goldquestLogic.makeChestChoices,
  createPendingChest: goldquestLogic.createPendingChest,
  getChestTargetChoices: goldquestLogic.getChestTargetChoices,
  getChestPayload: goldquestLogic.getChestPayload,
  createChestSkipResult: goldquestLogic.createChestSkipResult,
  INTERACTION_CHEST_TYPES: goldquestLogic.INTERACTION_CHEST_TYPES,
  resolveChestChoice: goldquestLogic.resolveChestChoice,

  // From fishingfrenzy-logic.js
  createFishingState: fishingFrenzyLogic.createFishingState,
  ensureFishingState: fishingFrenzyLogic.ensureFishingState,
  advanceFishingState: fishingFrenzyLogic.advanceFishingState,
  getFishingPayload: fishingFrenzyLogic.getFishingPayload,
  maybeRollPotionEffect: fishingFrenzyLogic.maybeRollPotionEffect,
  setFishingWorldEffect: fishingFrenzyLogic.setFishingWorldEffect,
  getFishingWorldEffect: fishingFrenzyLogic.getFishingWorldEffect,
  rollFishingCatch: fishingFrenzyLogic.rollFishingCatch,
  randomBiteWaitMs: fishingFrenzyLogic.randomBiteWaitMs,

  // From assemble-logic.js
  createPuzzleState: assembleLogic.createPuzzleState,
  getPuzzlePayload: assembleLogic.getPuzzlePayload,
  revealNextPuzzleTile: assembleLogic.revealNextPuzzleTile,
};
