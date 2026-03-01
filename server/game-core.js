const config = require('./config');
const { logInfo, randomCode, randomHostPin, randomId, shuffle, normalizeGold, clampPlayerGold, clampGameGold } = require('./utils');
const { resolveSet } = require('./quiz-api');
const { createPuzzleState, getPuzzlePayload } = require('./assemble-logic');
const { getFishingWorldEffect } = require('./fishingfrenzy-logic');

async function createHostedGame({
  setId,
  customSet,
  gameTypeFamily,
  gameType,
  questionLimit,
  timeLimitSec,
  maxPlayers,
  feedbackDelaySec,
  shuffleQuestions,
}) {
  const selectedRaw = await resolveSet({ setId, customSet });
  if (!selectedRaw || !Array.isArray(selectedRaw.questions) || !selectedRaw.questions.length) {
    throw new Error('Selected set could not be loaded. Try another set or use the custom editor.');
  }
  logInfo('game.create.request', {
    setId: setId || null,
    customSet: Boolean(customSet),
    gameType,
    timeLimitSec,
    maxPlayers,
    feedbackDelaySec,
    shuffleQuestions: Boolean(shuffleQuestions),
    sourceTitle: selectedRaw.title,
    sourceQuestions: selectedRaw.questions.length,
  });

  const selected = {
    ...selectedRaw,
    questions: selectedRaw.questions.map((question) => ({
      q: question.q,
      answers: Array.isArray(question.answers) ? [...question.answers] : [],
      correct: question.correct,
      imageUrl: question.imageUrl,
    })),
  };

  let code;
  do code = randomCode(); while (config.games.has(code));

  const now = new Date().toISOString();
  const shouldShuffle = Boolean(shuffleQuestions);
  if (shouldShuffle && selected.questions.length > 1) {
    selected.questions = shuffle(selected.questions);
  }

  const modeSettings = {
    gameTypeFamily: gameTypeFamily || 'goldquest',
    gameType: gameType || 'timed',
    questionLimit: Math.max(1, Math.min(Number(questionLimit) || selected.questions.length, selected.questions.length)),
    timeLimitSec: Math.max(60, Math.min(Number(timeLimitSec) || 120, 1800)),
    maxPlayers: Math.max(1, Math.min(Number(maxPlayers) || 60, 120)),
    feedbackDelaySec: Math.max(0, Math.min(Number(feedbackDelaySec) || 1, 5)),
    shuffleQuestions: shouldShuffle,
  };

  const modeNameByFamily = {
    goldquest: 'Gold Quest',
    fishingfrenzy: 'Fishing Frenzy',
    assemble: 'Block Builder',
  };

  const game = {
    code,
    hostPin: randomHostPin(),
    mode: modeNameByFamily[modeSettings.gameTypeFamily] || 'Gold Quest',
    set: selected,
    state: 'lobby',
    settings: modeSettings,
    createdAt: now,
    startedAt: null,
    endsAt: null,
    endedAt: null,
    eventLog: [],
    players: [],
    puzzle: modeSettings.gameTypeFamily === 'assemble' ? createPuzzleState(selected) : null,
  };

  config.games.set(code, game);
  logInfo('game.create.success', {
    code,
    mode: game.mode,
    setTitle: game.set.title,
    questionLimit: game.settings.questionLimit,
    players: game.players.length,
  });
  return game;
}

function publicGame(game) {
  clampGameGold(game);
  const remainingSec =
    game.state === 'live' && ['timed', 'hybrid'].includes(game.settings.gameType) && game.endsAt
      ? Math.max(0, Math.floor((new Date(game.endsAt).getTime() - Date.now()) / 1000))
      : null;

  return {
    code: game.code,
    hostPin: game.hostPin,
    mode: game.mode,
    state: game.state,
    setTitle: game.set.title,
    settings: game.settings,
    puzzle: null,
    fishingWorldEffect: game.settings?.gameTypeFamily === 'fishingfrenzy' ? getFishingWorldEffect(game) : null,
    remainingSec,
    players: game.players.map((p) => ({
      playerId: p.playerId,
      playerName: p.playerName,
      blook: p.blook || null,
      avatar: p.blook || null,
      gold: normalizeGold(p.gold),
      answered: p.questionIndex,
    })),
    eventLog: game.eventLog.slice(-8),
  };
}

function isLiveGameTimerExpired(game) {
  if (!game || game.state !== 'live') return false;
  if (!['timed', 'hybrid'].includes(game.settings?.gameType)) return false;
  if (!game.endsAt) return false;
  const endsAtMs = new Date(game.endsAt).getTime();
  if (!Number.isFinite(endsAtMs)) return false;
  return Date.now() >= endsAtMs;
}

function endGameWhenTimerExpires(game, { requestId } = {}) {
  if (!isLiveGameTimerExpired(game)) return false;
  game.state = 'ended';
  game.endedAt = game.endedAt || new Date().toISOString();
  game.eventLog.push({ at: game.endedAt, type: 'ended', text: 'Time is up. Game ended for everyone.' });
  logInfo('game.ended.timer', {
    requestId: requestId || null,
    code: game.code,
    players: game.players.length,
    endedAt: game.endedAt,
  });
  return true;
}

module.exports = {
  createHostedGame,
  publicGame,
  isLiveGameTimerExpired,
  endGameWhenTimerExpires,
};
