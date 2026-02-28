const { sample, shuffle, normalizeGold, clampPlayerGold, clampGameGold } = require('./utils');

function chestOptionLabel(option) {
  if (option.type === 'bonus_flat') return `+ ${option.value} Gold`;
  if (option.type === 'bonus_percent') return `+ ${option.percent}%`;
  if (option.type === 'double') return 'DOUBLE!';
  if (option.type === 'triple') return 'TRIPLE!';
  if (option.type === 'lose_percent') return `Lose ${option.percent}%`;
  if (option.type === 'lose_flat') return `- ${option.value} Gold`;
  if (option.type === 'take_percent') return `Take ${option.percent}%`;
  if (option.type === 'swap') return 'SWAP!';
  if (option.type === 'nothing') return 'Empty';
  if (option.type === 'mega_bonus') return `MEGA +${option.value}!`;
  if (option.type === 'random') return '???';
  return option.type;
}

function makeChestChoices() {
  const percentValues = [15, 25, 40, 50, 75];
  const gainOptions = [
    { type: 'bonus_flat', value: Math.floor(40 + Math.random() * 141) },
    { type: 'bonus_flat', value: Math.floor(35 + Math.random() * 96) },
    { type: 'bonus_percent', percent: sample(percentValues) },
    { type: 'double' },
    { type: 'triple' },
    { type: 'mega_bonus', value: Math.floor(150 + Math.random() * 201) },
  ];
  const riskOptions = [
    { type: 'nothing' },
    { type: 'lose_percent', percent: sample([10, 15, 25, 40]) },
    { type: 'lose_flat', value: Math.floor(35 + Math.random() * 101) },
    { type: 'random' },
  ];
  const interactionOptions = [
    { type: 'take_percent', percent: sample([15, 25, 35, 50]) },
    { type: 'swap' },
  ];

  const allOptions = [...gainOptions, ...riskOptions, ...interactionOptions];
  const unique = shuffle(allOptions).slice(0, 3);
  return unique.map((option) => ({ ...option, label: chestOptionLabel(option) }));
}

function createPendingChest() {
  return {
    phase: 'choose',
    options: makeChestChoices(),
    selectedIndex: null,
    result: null,
  };
}

function getChestTargetChoices(game, player) {
  clampGameGold(game);
  return game.players
    .filter((entry) => entry.playerId !== player.playerId)
    .map((entry) => ({
      playerId: entry.playerId,
      playerName: entry.playerName,
      gold: normalizeGold(entry.gold),
      blook: entry.blook || null,
    }));
}

function getChestPayload(game, player) {
  const pending = player.pendingChest;
  if (!pending) return null;
  const payload = {
    options: pending.options.map((option) => ({
      label: option.label,
      type: option.type,
    })),
    selectedIndex: pending.selectedIndex,
    result: pending.result,
  };
  if (pending.phase === 'target') {
    const selected = Number.isInteger(pending.selectedIndex) ? pending.options[pending.selectedIndex] : null;
    payload.targetAction = selected?.type || null;
    payload.targetChoices = getChestTargetChoices(game, player);
    payload.allowSkip = true;
  }
  return payload;
}

function createChestSkipResult(player, option) {
  const playerBefore = clampPlayerGold(player);
  return {
    type: 'skipped',
    label: option.label,
    headline: 'SKIPPED',
    text: 'You skipped this interaction.',
    delta: 0,
    playerBefore,
    playerAfter: playerBefore,
    eventText: `${player.playerName} skipped a ${option.type === 'swap' ? 'swap' : 'steal'} chest.`,
  };
}

const INTERACTION_CHEST_TYPES = new Set(['take_percent', 'swap']);

function resolveChestChoice(game, player, option, targetPlayerId = null) {
  const opponents = game.players.filter((p) => p.playerId !== player.playerId);
  const target = targetPlayerId
    ? opponents.find((entry) => entry.playerId === targetPlayerId) || null
    : (opponents.length ? sample(opponents) : null);
  const playerBefore = clampPlayerGold(player);
  const targetGoldBefore = target ? clampPlayerGold(target) : null;
  const bonusFlat = normalizeGold(option.value);
  const bonusPercent = normalizeGold(option.percent);

  if (option.type === 'bonus_flat') {
    player.gold = normalizeGold(playerBefore + bonusFlat);
    return {
      type: option.type,
      label: option.label,
      headline: `+${bonusFlat} GOLD`,
      text: `+${bonusFlat} gold`,
      delta: bonusFlat,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} gained ${bonusFlat} gold from a chest.`,
    };
  }

  if (option.type === 'bonus_percent') {
    const gain = Math.max(1, Math.floor(playerBefore * (bonusPercent / 100)));
    player.gold = normalizeGold(playerBefore + gain);
    return {
      type: option.type,
      label: option.label,
      headline: `+${bonusPercent}% BONUS`,
      text: `+${gain} gold (${bonusPercent}%)`,
      delta: gain,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} gained ${gain} gold from a ${bonusPercent}% chest.`,
    };
  }

  if (option.type === 'double') {
    const gain = playerBefore > 0 ? playerBefore : Math.floor(30 + Math.random() * 41);
    player.gold = normalizeGold(playerBefore + gain);
    return {
      type: option.type,
      label: option.label,
      headline: 'DOUBLE!',
      text: `+${gain} gold`,
      delta: gain,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} doubled for +${gain} gold from a chest.`,
    };
  }

  if (option.type === 'triple') {
    const gain = playerBefore > 0 ? (playerBefore * 2) : Math.floor(75 + Math.random() * 71);
    player.gold = normalizeGold(playerBefore + gain);
    return {
      type: option.type,
      label: option.label,
      headline: 'TRIPLE!',
      text: `+${gain} gold`,
      delta: gain,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} tripled for +${gain} gold from a chest.`,
    };
  }

  if (option.type === 'lose_percent') {
    const loss = Math.min(playerBefore, Math.floor(playerBefore * (bonusPercent / 100)));
    player.gold = normalizeGold(playerBefore - loss);
    return {
      type: option.type,
      label: option.label,
      headline: `LOSE ${bonusPercent}%`,
      text: `-${loss} gold (${bonusPercent}%)`,
      delta: -loss,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} lost ${loss} gold from a chest.`,
    };
  }

  if (option.type === 'lose_flat') {
    const loss = Math.min(playerBefore, bonusFlat);
    player.gold = normalizeGold(playerBefore - loss);
    return {
      type: option.type,
      label: option.label,
      headline: `-${loss} GOLD`,
      text: `-${loss} gold`,
      delta: -loss,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} lost ${loss} gold from a chest.`,
    };
  }

  if (option.type === 'take_percent') {
    if (!target) {
      return {
        type: 'no_interaction',
        label: option.label,
        headline: 'NO INTERACTION',
        text: 'No players to interact with',
        noInteraction: true,
        delta: 0,
        playerBefore,
        playerAfter: player.gold,
        eventText: `${player.playerName} rolled an interaction chest but had no opponents.`,
      };
    }
    const steal = Math.min(targetGoldBefore, Math.max(1, Math.floor(targetGoldBefore * (bonusPercent / 100))));
    if (steal <= 0) {
      return {
        type: 'no_effect',
        label: option.label,
        headline: 'NO EFFECT',
        text: `${target.playerName} had no gold to take`,
        delta: 0,
        playerBefore,
        playerAfter: player.gold,
        target: target.playerName,
        targetBefore: targetGoldBefore,
        targetAfter: targetGoldBefore,
        eventText: `${player.playerName} tried to steal from ${target.playerName}, but no gold was available.`,
      };
    }
    target.gold = normalizeGold(targetGoldBefore - steal);
    player.gold = normalizeGold(playerBefore + steal);
    return {
      type: option.type,
      label: option.label,
      headline: `TAKE ${bonusPercent}%`,
      text: `Took ${steal} gold from ${target.playerName}`,
      delta: steal,
      playerBefore,
      playerAfter: player.gold,
      target: target.playerName,
      targetBefore: targetGoldBefore,
      targetAfter: target.gold,
      eventText: `${player.playerName} took ${steal} gold from ${target.playerName}.`,
    };
  }

  if (option.type === 'swap') {
    if (!target) {
      return {
        type: 'no_interaction',
        label: option.label,
        headline: 'NO SWAP TARGET',
        text: 'No players to interact with',
        noInteraction: true,
        delta: 0,
        playerBefore,
        playerAfter: player.gold,
        eventText: `${player.playerName} rolled SWAP but had no opponents.`,
      };
    }
    const original = playerBefore;
    player.gold = normalizeGold(targetGoldBefore);
    target.gold = normalizeGold(original);
    return {
      type: option.type,
      label: option.label,
      headline: 'SWAP!',
      text: `Swapped with ${target.playerName} (${original} -> ${player.gold})`,
      delta: player.gold - original,
      playerBefore: original,
      playerAfter: player.gold,
      target: target.playerName,
      targetBefore: targetGoldBefore,
      targetAfter: target.gold,
      eventText: `${player.playerName} swapped gold totals with ${target.playerName}.`,
    };
  }

  if (option.type === 'nothing') {
    return {
      type: option.type,
      label: option.label,
      headline: 'EMPTY',
      text: 'The chest was empty!',
      delta: 0,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} found an empty chest.`,
    };
  }

  if (option.type === 'mega_bonus') {
    const gain = Math.floor(bonusFlat * 1.5);
    player.gold = normalizeGold(playerBefore + gain);
    return {
      type: option.type,
      label: option.label,
      headline: `MEGA +${gain}!`,
      text: `Mega jackpot! +${gain} gold`,
      delta: gain,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} hit a MEGA jackpot for ${gain} gold!`,
    };
  }

  if (option.type === 'random') {
    const outcomes = [
      { type: 'gain', value: Math.floor(50 + Math.random() * 100) },
      { type: 'gain', value: Math.floor(20 + Math.random() * 50) },
      { type: 'lose', value: Math.floor(10 + Math.random() * 40) },
      { type: 'gain', value: Math.floor(100 + Math.random() * 100) },
      { type: 'lose', value: Math.floor(30 + Math.random() * 60) },
    ];
    const outcome = sample(outcomes);
    if (outcome.type === 'gain') {
      player.gold = normalizeGold(playerBefore + outcome.value);
      return {
        type: option.type,
        label: option.label,
        headline: `+${outcome.value} GOLD`,
        text: `Lucky! +${outcome.value} gold`,
        delta: outcome.value,
        playerBefore,
        playerAfter: player.gold,
        eventText: `${player.playerName} got lucky and won ${outcome.value} gold!`,
      };
    } else {
      const loss = Math.min(playerBefore, outcome.value);
      player.gold = normalizeGold(playerBefore - loss);
      return {
        type: option.type,
        label: option.label,
        headline: `-${loss} GOLD`,
        text: `Unlucky! -${loss} gold`,
        delta: -loss,
        playerBefore,
        playerAfter: player.gold,
        eventText: `${player.playerName} was unlucky and lost ${loss} gold.`,
      };
    }
  }

  return {
    type: 'no_effect',
    label: option.label,
    headline: 'NO EFFECT',
    text: 'No effect',
    delta: 0,
    playerBefore,
    playerAfter: player.gold,
    eventText: `${player.playerName} opened a chest with no effect.`,
  };
}

module.exports = {
  chestOptionLabel,
  makeChestChoices,
  createPendingChest,
  getChestTargetChoices,
  getChestPayload,
  createChestSkipResult,
  INTERACTION_CHEST_TYPES,
  resolveChestChoice,
};
