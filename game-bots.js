#!/usr/bin/env node

/*
 * Load-test bots for Greenit game sessions.
 *
 * Example:
 *   node scripts/game-bots.js --code 123456 --count 20 --base http://localhost:3000 --auto-start
 */

function parseArgs(argv) {
  const out = {
    base: 'http://localhost:3000',
    code: '',
    count: 10,
    prefix: 'Bot',
    tickMs: 300,
    timeoutSec: 420,
    autoStart: false,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = String(argv[i] || '');
    const next = argv[i + 1];
    if (raw === '--base' && next) {
      out.base = String(next).trim();
      i += 1;
      continue;
    }
    if (raw === '--code' && next) {
      out.code = String(next).trim().toUpperCase();
      i += 1;
      continue;
    }
    if (raw === '--count' && next) {
      out.count = Math.max(1, Math.min(1000, Number(next) || 10));
      i += 1;
      continue;
    }
    if (raw === '--prefix' && next) {
      out.prefix = String(next).trim() || 'Bot';
      i += 1;
      continue;
    }
    if (raw === '--tick' && next) {
      out.tickMs = Math.max(250, Math.min(5000, Number(next) || 900));
      i += 1;
      continue;
    }
    if (raw === '--timeout' && next) {
      out.timeoutSec = Math.max(10, Math.min(7200, Number(next) || 420));
      i += 1;
      continue;
    }
    if (raw === '--auto-start' || raw === '--start') {
      out.autoStart = true;
      continue;
    }
    if (raw === '--verbose' || raw === '-v') {
      out.verbose = true;
    }
  }

  return out;
}

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/game-bots.js --code <GAME_CODE> [options]',
      '',
      'Options:',
      '  --count <n>        Number of bots (default: 10)',
      '  --base <url>       Base URL (default: http://localhost:3000)',
      '  --prefix <name>    Bot name prefix (default: Bot)',
      '  --tick <ms>        Bot loop tick in ms (default: 900)',
      '  --timeout <sec>    Max run time (default: 420)',
      '  --auto-start       Start game after joins (if still in lobby)',
      '  --verbose          Print per-action logs',
      '',
      'Example:',
      '  node scripts/game-bots.js --code 123456 --count 30 --auto-start',
    ].join('\n')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  const safeMin = Math.floor(Math.min(min, max));
  const safeMax = Math.floor(Math.max(min, max));
  return safeMin + Math.floor(Math.random() * (safeMax - safeMin + 1));
}

function randomChoice(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

async function requestJson(base, path, method = 'GET', body = undefined) {
  const options = {
    method,
    headers: {},
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${trimSlash(base)}${path}`, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

async function joinBot(base, code, requestedName) {
  const joinPath = `/api/games/${encodeURIComponent(code)}/join`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${randomInt(10, 99)}`;
    const playerName = `${requestedName}${suffix}`;
    const joined = await requestJson(base, joinPath, 'POST', { playerName });
    if (joined.ok && joined.data?.player?.playerId) {
      return {
        ok: true,
        playerId: String(joined.data.player.playerId),
        playerName: String(joined.data.player.playerName || playerName),
      };
    }
    if (joined.status === 403 || joined.status === 404) return { ok: false, fatal: true, error: joined.data?.error || `Join failed (${joined.status})` };
  }
  return { ok: false, fatal: false, error: 'Could not join with a unique name.' };
}

async function maybeStartGame(base, code, verbose) {
  const result = await requestJson(base, `/api/games/${encodeURIComponent(code)}/start`, 'POST');
  if (result.ok) {
    console.log('Started game.');
    return true;
  }
  if (verbose) {
    console.log(`Start skipped (${result.status}): ${result.data?.error || 'unknown'}`);
  }
  return false;
}

async function submitRandomAnswer(base, code, playerId, question) {
  const answers = Array.isArray(question?.answers) ? question.answers : [];
  if (!answers.length) return { ok: false, reason: 'no answers' };
  const answerIndex = randomInt(0, answers.length - 1);
  return requestJson(base, `/api/games/${encodeURIComponent(code)}/player/${encodeURIComponent(playerId)}/answer`, 'POST', { answerIndex });
}

async function runFishingStep(base, code, bot, payload) {
  const fishing = payload?.fishing || null;
  const phase = String(fishing?.phase || 'cast');

  if (phase === 'cast') {
    return requestJson(base, `/api/games/${encodeURIComponent(code)}/player/${encodeURIComponent(bot.playerId)}/fishing`, 'POST', { action: 'cast' });
  }
  if (phase === 'pull') {
    return requestJson(base, `/api/games/${encodeURIComponent(code)}/player/${encodeURIComponent(bot.playerId)}/fishing`, 'POST', { action: 'pull' });
  }
  if (phase === 'result') {
    return requestJson(base, `/api/games/${encodeURIComponent(code)}/player/${encodeURIComponent(bot.playerId)}/fishing`, 'POST', { action: 'next' });
  }
  if (phase === 'question' && payload?.question) {
    return submitRandomAnswer(base, code, bot.playerId, payload.question);
  }
  return { ok: false, status: 204, data: null };
}

async function runClassicStep(base, code, bot, payload) {
  const chestPhase = String(payload?.chestPhase || '');
  if (chestPhase) {
    const chestPath = `/api/games/${encodeURIComponent(code)}/player/${encodeURIComponent(bot.playerId)}/chest`;
    if (chestPhase === 'choose') {
      const options = Array.isArray(payload?.chest?.options) ? payload.chest.options : [];
      const chestIndex = options.length ? randomInt(0, options.length - 1) : 0;
      return requestJson(base, chestPath, 'POST', { chestIndex });
    }
    if (chestPhase === 'target') {
      const targetChoices = Array.isArray(payload?.chest?.targetChoices) ? payload.chest.targetChoices : [];
      const target = randomChoice(targetChoices);
      if (target?.playerId) {
        return requestJson(base, chestPath, 'POST', { action: 'target', targetPlayerId: target.playerId });
      }
      return requestJson(base, chestPath, 'POST', { action: 'skip' });
    }
    if (chestPhase === 'result') {
      return requestJson(base, chestPath, 'POST', { action: 'next' });
    }
  }

  if (payload?.question) {
    return submitRandomAnswer(base, code, bot.playerId, payload.question);
  }

  return { ok: false, status: 204, data: null };
}

async function runBotStep(settings, bot, stats) {
  if (bot.finished) return;
  const { base, code, verbose } = settings;

  const stateRes = await requestJson(base, `/api/games/${encodeURIComponent(code)}/player/${encodeURIComponent(bot.playerId)}`, 'GET');
  if (!stateRes.ok) {
    if ([404, 410].includes(stateRes.status)) bot.finished = true;
    return;
  }

  const payload = stateRes.data || {};
  if (payload?.state === 'ended' || payload?.state === 'finished' || payload?.finished) {
    bot.finished = true;
    bot.lastGold = Number(payload?.gold || 0);
    return;
  }
  if (payload?.state !== 'live') return;

  const modeFamily = String(payload?.modeFamily || 'goldquest');
  let actionRes = null;
  if (modeFamily === 'fishingfrenzy') {
    actionRes = await runFishingStep(base, code, bot, payload);
  } else {
    actionRes = await runClassicStep(base, code, bot, payload);
  }

  if (actionRes?.ok) {
    stats.actions += 1;
    if (verbose) {
      console.log(`[${bot.playerName}] action ok (${modeFamily})`);
    }
  }
}

async function main() {
  const settings = parseArgs(process.argv.slice(2));
  if (!settings.code) {
    usage();
    process.exitCode = 1;
    return;
  }

  console.log(`Connecting ${settings.count} bots to ${settings.code} at ${settings.base}`);
  const bots = [];
  for (let i = 1; i <= settings.count; i += 1) {
    const requestedName = `${settings.prefix}${String(i).padStart(2, '0')}`;
    const joined = await joinBot(settings.base, settings.code, requestedName);
    if (!joined.ok) {
      console.log(`Join failed for ${requestedName}: ${joined.error}`);
      if (joined.fatal) break;
      continue;
    }
    bots.push({
      playerId: joined.playerId,
      playerName: joined.playerName,
      finished: false,
      lastGold: 0,
    });
    console.log(`Joined: ${joined.playerName}`);
    await sleep(randomInt(60, 180));
  }

  if (!bots.length) {
    console.log('No bots joined.');
    process.exitCode = 1;
    return;
  }

  if (settings.autoStart) {
    await maybeStartGame(settings.base, settings.code, settings.verbose);
  } else {
    console.log('Waiting for host to start...');
  }

  const startedAt = Date.now();
  const timeoutAt = startedAt + (settings.timeoutSec * 1000);
  const stats = { actions: 0 };
  let lastSummaryAt = 0;

  while (Date.now() < timeoutAt) {
    const activeBots = bots.filter((bot) => !bot.finished);
    if (!activeBots.length) break;

    await Promise.all(activeBots.map((bot) => runBotStep(settings, bot, stats).catch(() => {})));

    const now = Date.now();
    if (now - lastSummaryAt > 5000) {
      lastSummaryAt = now;
      const finished = bots.filter((bot) => bot.finished).length;
      console.log(`Progress: ${finished}/${bots.length} finished, actions=${stats.actions}`);
    }

    await sleep(settings.tickMs + randomInt(0, 240));
  }

  const finalStates = await Promise.all(
    bots.map(async (bot) => {
      const stateRes = await requestJson(
        settings.base,
        `/api/games/${encodeURIComponent(settings.code)}/player/${encodeURIComponent(bot.playerId)}`,
        'GET'
      ).catch(() => null);
      const gold = Number(stateRes?.data?.gold || bot.lastGold || 0);
      return { name: bot.playerName, gold };
    })
  );

  finalStates.sort((a, b) => b.gold - a.gold);
  console.log('\nTop bots:');
  finalStates.slice(0, 10).forEach((entry, index) => {
    console.log(`${index + 1}. ${entry.name} - ${entry.gold.toLocaleString()} lbs`);
  });
  console.log('\nDone.');
}

main().catch((error) => {
  console.error(`Bot runner failed: ${error.message}`);
  process.exitCode = 1;
});

