const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const config = require('./config');
const { logInfo, logWarn, logDebug, sendJson, sendText, parseBody, truncateLogString, randomId, normalizeAbsoluteHttpUrl, sanitizeUrlForLog, clampGameGold, getBlookById, getTakenBlookIds } = require('./utils');
const { requestBinary } = require('./http-client');
const { isWikimediaHost, inferImageContentType } = require('./image-search');
const { searchQuizSets, getRemoteSet, parseQuizGeneratePayload, generateQuizSetWithGroq, validateHostPayload, validateJoinPayload } = require('./quiz-api');
const { createHostedGame, publicGame, endGameWhenTimerExpires, createPendingChest, getChestPayload, getChestTargetChoices, resolveChestChoice, createChestSkipResult, INTERACTION_CHEST_TYPES } = require('./game-logic');
const { createPuzzleState, getPuzzlePayload, revealNextPuzzleTile } = require('./assemble-logic');

function createRoutes() {
  return function routes(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { pathname, searchParams } = requestUrl;
    const requestId = randomId();
    const startedAt = Date.now();
    const reqInfo = {
      requestId,
      method: req.method,
      path: pathname,
      query: searchParams.toString(),
      ip: String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''),
      userAgent: String(req.headers['user-agent'] || ''),
    };
    req.__reqInfo = reqInfo;
    res.__reqInfo = reqInfo;
    logInfo('http.request.start', {
      requestId,
      method: reqInfo.method,
      path: reqInfo.path,
      query: reqInfo.query,
      ip: reqInfo.ip,
      ua: truncateLogString(reqInfo.userAgent, 120),
    });
    let finishedLogged = false;
    const finishLog = (event) => {
      if (finishedLogged) return;
      finishedLogged = true;
      logInfo('http.request.finish', {
        requestId,
        method: reqInfo.method,
        path: reqInfo.path,
        event,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    };
    res.on('finish', () => finishLog('finish'));
    res.on('close', () => finishLog('close'));

    // Static file routes
    if (req.method === 'GET' && pathname.startsWith('/pages/')) {
      const fileName = path.basename(pathname);
      if (!/^[a-zA-Z0-9._-]+\.js$/.test(fileName)) {
        return sendJson(res, 400, { error: 'Invalid page script path' });
      }
      const scriptPath = path.join(__dirname, '..', 'pages', fileName);
      return fs.readFile(scriptPath, 'utf8', (error, data) => {
        if (error) return sendJson(res, 404, { error: 'Page script not found' });
        return sendText(res, 200, data, 'text/javascript; charset=utf-8');
      });
    }

    if (req.method === 'GET' && pathname.startsWith('/libs/')) {
      const fileName = path.basename(pathname);
      if (!/^[a-zA-Z0-9._-]+\.(js|css)$/.test(fileName)) {
        return sendJson(res, 404, { error: 'Lib not found or invalid file name' });
      }
      const libPath = path.join(__dirname, '..', 'libs', fileName);
      const ext = path.extname(fileName).toLowerCase();
      const contentType = ext === '.css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
      return fs.readFile(libPath, 'utf8', (error, data) => {
        if (error) return sendJson(res, 404, { error: 'Lib not found' });
        return sendText(res, 200, data, contentType);
      });
    }

    // HTML page routes
    const htmlPages = {
      '/': 'index.html',
      '/index.html': 'index.html',
      '/join.html': 'join.html',
      '/host-setup.html': 'host-setup.html',
      '/host-lobby.html': 'host-lobby.html',
      '/lobby.html': 'lobby.html',
      '/goldquesthost.html': 'goldquesthost.html',
      '/goldquestplay.html': 'goldquestplay.html',
      '/play.html': 'play.html'
    };

    if (req.method === 'GET' && htmlPages[pathname]) {
      const pagePath = path.join(__dirname, '..', 'pages', htmlPages[pathname]);
      return fs.readFile(pagePath, 'utf8', (error, data) => {
        if (error) {
          logWarn('html.read_error', { path: pathname, error: error.message });
          return sendJson(res, 404, { error: 'Page not found' });
        }
        return sendText(res, 200, data, 'text/html; charset=utf-8');
      });
    }

    if (req.method === 'GET' && pathname.startsWith('/chetsicons/')) {
      const fileName = path.basename(pathname);
      if (!/^[a-zA-Z0-9._-]+\.svg$/.test(fileName)) {
        return sendJson(res, 400, { error: 'Invalid icon path' });
      }
      const iconPath = path.join(__dirname, '..', 'chetsicons', fileName);
      return fs.readFile(iconPath, (error, data) => {
        if (error) return sendJson(res, 404, { error: 'Icon not found' });
        return sendText(res, 200, data, 'image/svg+xml; charset=utf-8');
      });
    }

    if (req.method === 'GET' && pathname.startsWith('/pfp/')) {
      const rawName = path.basename(pathname);
      let fileName = '';
      try {
        fileName = decodeURIComponent(rawName);
      } catch {
        return sendJson(res, 400, { error: 'Invalid pfp path' });
      }
      if (!/^[a-zA-Z0-9._\- ]+\.svg$/i.test(fileName)) {
        return sendJson(res, 400, { error: 'Invalid pfp path' });
      }
      const pfpPath = path.join(config.PFP_DIR, fileName);
      return fs.readFile(pfpPath, (error, data) => {
        if (error) return sendJson(res, 404, { error: 'PFP not found' });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=43200' });
        return res.end(data);
      });
    }

    if (req.method === 'GET' && pathname.startsWith('/mp3/')) {
      const rawName = path.basename(pathname);
      let fileName = '';
      try {
        fileName = decodeURIComponent(rawName);
      } catch {
        return sendJson(res, 400, { error: 'Invalid mp3 path' });
      }
      if (!/^[a-zA-Z0-9._\- ]+\.mp3$/i.test(fileName)) {
        return sendJson(res, 400, { error: 'Invalid mp3 path' });
      }
      const mp3Path = path.join(config.MP3_DIR, fileName);
      return fs.readFile(mp3Path, (error, data) => {
        if (error) return sendJson(res, 404, { error: 'MP3 not found' });
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=43200' });
        return res.end(data);
      });
    }

    if (req.method === 'GET' && pathname === '/api/audio/tracks') {
      return fs.readdir(config.MP3_DIR, (error, entries) => {
        if (error) return sendJson(res, 200, { tracks: ['/mp3/1.mp3'] });
        const tracks = (Array.isArray(entries) ? entries : [])
          .filter((name) => /^[a-zA-Z0-9._\- ]+\.mp3$/i.test(String(name || '')))
          .sort((a, b) => a.localeCompare(b))
          .map((name) => `/mp3/${encodeURIComponent(name)}`);
        if (!tracks.length) return sendJson(res, 200, { tracks: ['/mp3/1.mp3'] });
        return sendJson(res, 200, { tracks });
      });
    }

    if (req.method === 'GET' && (pathname === '/api/image-proxy' || pathname === '/image-proxy')) {
      const target = normalizeAbsoluteHttpUrl(searchParams.get('url'));
      if (!target) return sendJson(res, 400, { error: 'Invalid image URL.' });
      logDebug('image.proxy.fetch.start', {
        requestId: reqInfo.requestId,
        target: sanitizeUrlForLog(target),
      });

      if (isWikimediaHost(target)) {
        logDebug('image.proxy.wikimedia.redirect', {
          requestId: reqInfo.requestId,
          target: sanitizeUrlForLog(target),
        });
        res.writeHead(307, { Location: target, 'Cache-Control': 'public, max-age=43200' });
        res.end();
        return;
      }

      requestBinary(target, {
        timeoutMs: 12_000,
        maxBytes: 8_000_000,
      })
        .then(({ data, contentType, finalUrl }) => {
          const inferred = inferImageContentType(finalUrl);
          const type = String(contentType || inferred).toLowerCase();
          if (!/^image\//i.test(type)) {
            logWarn('image.proxy.non_image', {
              requestId: reqInfo.requestId,
              target: sanitizeUrlForLog(target),
              finalUrl: sanitizeUrlForLog(finalUrl),
              contentType: type,
            });
            return sendJson(res, 415, { error: 'URL did not return an image.' });
          }
          logDebug('image.proxy.fetch.success', {
            requestId: reqInfo.requestId,
            target: sanitizeUrlForLog(target),
            finalUrl: sanitizeUrlForLog(finalUrl),
            contentType: type,
            bytes: data.length,
          });
          res.writeHead(200, {
            'Content-Type': type,
            'Cache-Control': 'public, max-age=43200',
          });
          return res.end(data);
        })
        .catch((error) => {
          const message = String(error?.message || '');
          const statusMatch = message.match(/\((\d{3})\)/);
          const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
          if (statusCode === 429) {
            logWarn('image.proxy.rate_limited.redirect_fallback', {
              requestId: reqInfo.requestId,
              target: sanitizeUrlForLog(target),
            });
            res.writeHead(307, { Location: target, 'Cache-Control': 'no-store' });
            res.end();
            return;
          }
          logWarn('image.proxy.fetch.error', {
            requestId: reqInfo.requestId,
            target: sanitizeUrlForLog(target),
            error: error.message,
          });
          return sendJson(res, 502, { error: error.message || 'Could not fetch image.' });
        });
      return;
    }

    // API routes
    if (req.method === 'GET' && pathname === '/api/blooks') {
      return sendJson(res, 200, { blooks: config.blookCatalog });
    }

    if (req.method === 'GET' && pathname === '/api/avatars') {
      return sendJson(res, 200, { avatars: config.avatarCatalog });
    }

    if (req.method === 'GET' && pathname === '/api/quiz/search') {
      searchQuizSets(searchParams.get('q') || '')
        .then((sets) => sendJson(res, 200, { sets }))
        .catch((error) => sendJson(res, 502, { error: error.message || 'Could not load quiz providers.' }));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/quiz/set') {
      const id = String(searchParams.get('id') || '').trim();
      if (!id) return sendJson(res, 400, { error: 'Set id is required.' });
      getRemoteSet(id)
        .then((set) => {
          if (!set) return sendJson(res, 404, { error: 'Set not found.' });
          return sendJson(res, 200, {
            set: {
              id: set.id,
              title: set.title,
              description: set.description,
              source: set.source,
              questionCount: set.questions.length,
              questions: set.questions.map((question) => ({
                q: question.q,
                answers: Array.isArray(question.answers) ? [...question.answers] : [],
                correct: question.correct,
                ...(question.imageUrl ? { imageUrl: question.imageUrl } : {}),
              })),
            },
          });
        })
        .catch((error) => sendJson(res, 502, { error: error.message || 'Could not load set questions.' }));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/quiz/generate') {
      parseBody(req)
        .then(async (body) => {
          let payload;
          try {
            payload = parseQuizGeneratePayload(body);
          } catch (error) {
            return sendJson(res, 400, { error: error.message || 'Invalid generation payload.' });
          }

          try {
            const set = await generateQuizSetWithGroq(payload);
            return sendJson(res, 200, { set });
          } catch (error) {
            const message = error.message || 'AI quiz generation failed.';
            const code = /GROQ_API_KEY/i.test(message) ? 501 : 502;
            return sendJson(res, code, { error: message });
          }
        })
        .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
      return;
    }

    // Game routes
    if (req.method === 'POST' && pathname === '/api/host') {
      parseBody(req)
        .then(async (body) => {
          const error = validateHostPayload(body);
          if (error) return sendJson(res, 400, { error });
          const game = await createHostedGame(body);
          logInfo('game.host.created', {
            requestId: reqInfo.requestId,
            code: game.code,
            mode: game.mode,
            setTitle: game.set.title,
            players: game.players.length,
          });
          sendJson(res, 201, { game: publicGame(game), message: `${game.mode} lobby created.` });
        })
        .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
      return;
    }

    if (req.method === 'GET' && pathname.match(/^\/api\/games\/[^/]+\/lobby$/)) {
      const code = pathname.split('/')[3]?.toUpperCase();
      const game = code ? config.games.get(code) : null;
      if (!game) return sendJson(res, 404, { error: 'Game not found' });
      endGameWhenTimerExpires(game, { requestId: reqInfo.requestId });
      return sendJson(res, 200, { game: publicGame(game) });
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/join$/)) {
      const code = pathname.split('/')[3]?.toUpperCase();
      const game = code ? config.games.get(code) : null;
      if (!game) return sendJson(res, 404, { error: 'Game not found' });
      if (game.state !== 'lobby') return sendJson(res, 400, { error: 'Game already started. Cannot join now.' });
      if (game.players.length >= game.settings.maxPlayers) return sendJson(res, 403, { error: 'Lobby is full.' });

      parseBody(req)
        .then((body) => {
          const error = validateJoinPayload(body);
          if (error) return sendJson(res, 400, { error });
          if (game.players.some((p) => p.playerName.toLowerCase() === body.playerName.trim().toLowerCase())) {
            return sendJson(res, 409, { error: 'Player name already in use.' });
          }

          // Get taken blook IDs and assign a random unused one
          const takenBlookIds = getTakenBlookIds(game);
          const availableBlooks = config.blookCatalog.filter((b) => !takenBlookIds.has(b.id));
          const randomBlook = availableBlooks.length > 0
            ? availableBlooks[Math.floor(Math.random() * availableBlooks.length)]
            : config.blookCatalog[Math.floor(Math.random() * config.blookCatalog.length)];

          const player = {
            playerId: randomId(),
            playerName: body.playerName.trim(),
            blook: randomBlook || null,
            joinedAt: new Date().toISOString(),
            gold: 0,
            questionIndex: 0,
            pendingChest: null,
          };

          game.players.push(player);
          logInfo('game.player.joined', {
            requestId: reqInfo.requestId,
            code: game.code,
            playerId: player.playerId,
            playerName: player.playerName,
            blookId: player.blook?.id,
            blookName: player.blook?.name,
            players: game.players.length,
          });
          sendJson(res, 201, { gameCode: game.code, player });
        })
        .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
      return;
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/player\/[^/]+\/blook$/)) {
      const [, , , codeRaw, , playerId] = pathname.split('/');
      const game = config.games.get((codeRaw || '').toUpperCase());
      if (!game) return sendJson(res, 404, { error: 'Game not found' });
      if (game.state !== 'lobby') return sendJson(res, 400, { error: 'Blook can only be changed before the game starts.' });
      const player = game.players.find((p) => p.playerId === playerId);
      if (!player) return sendJson(res, 404, { error: 'Player not found' });

      parseBody(req)
        .then((body) => {
          const selected = getBlookById(body.blookId);
          if (!selected) return sendJson(res, 400, { error: 'Valid blookId is required.' });

          const taken = getTakenBlookIds(game, player.playerId);
          if (taken.has(selected.id)) {
            return sendJson(res, 409, { error: 'That blook is already taken.' });
          }

          player.blook = selected;
          logInfo('game.player.blook_selected', {
            requestId: reqInfo.requestId,
            code: game.code,
            playerId: player.playerId,
            playerName: player.playerName,
            blookId: selected.id,
            blookName: selected.name,
          });
          return sendJson(res, 200, { player: { playerId: player.playerId, blook: player.blook } });
        })
        .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
      return;
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/start$/)) {
      const code = pathname.split('/')[3]?.toUpperCase();
      const game = code ? config.games.get(code) : null;
      if (!game) return sendJson(res, 404, { error: 'Game not found' });
      if (game.state !== 'lobby') return sendJson(res, 400, { error: 'Game already started.' });
      if (!game.players.length) return sendJson(res, 400, { error: 'Need at least 1 player before starting.' });

      game.state = 'live';
      game.startedAt = new Date().toISOString();
      if (['timed', 'hybrid'].includes(game.settings.gameType)) {
        game.endsAt = new Date(Date.now() + game.settings.timeLimitSec * 1000).toISOString();
      }
      logInfo('game.started', {
        requestId: reqInfo.requestId,
        code: game.code,
        mode: game.mode,
        players: game.players.length,
        endsAt: game.endsAt || null,
      });
      return sendJson(res, 200, { message: 'Game started! Players now see questions.' });
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/kick$/)) {
      const code = pathname.split('/')[3]?.toUpperCase();
      const game = code ? config.games.get(code) : null;
      if (!game) return sendJson(res, 404, { error: 'Game not found' });

      parseBody(req)
        .then((body) => {
          const targetId = String(body.playerId || '');
          if (!targetId) return sendJson(res, 400, { error: 'playerId is required.' });
          const idx = game.players.findIndex((p) => p.playerId === targetId);
          if (idx < 0) return sendJson(res, 404, { error: 'Player not found' });
          const [removed] = game.players.splice(idx, 1);
          game.eventLog.push({ at: new Date().toISOString(), type: 'kick', text: `${removed.playerName} was kicked by host.` });
          logInfo('game.player.kicked', {
            requestId: reqInfo.requestId,
            code: game.code,
            removedPlayerId: removed.playerId,
            removedPlayerName: removed.playerName,
            players: game.players.length,
          });
          sendJson(res, 200, { message: 'Player kicked.', playerId: removed.playerId });
        })
        .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
      return;
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/end$/)) {
      const code = pathname.split('/')[3]?.toUpperCase();
      const game = code ? config.games.get(code) : null;
      if (!game) return sendJson(res, 404, { error: 'Game not found' });
      if (game.state === 'ended') return sendJson(res, 200, { message: 'Game already ended.' });

      game.state = 'ended';
      game.endedAt = new Date().toISOString();
      game.eventLog.push({ at: game.endedAt, type: 'ended', text: 'Host ended the game for everyone.' });
      logInfo('game.ended', {
        requestId: reqInfo.requestId,
        code: game.code,
        players: game.players.length,
      });
      return sendJson(res, 200, { message: 'Game ended for all players.' });
    }

    if (req.method === 'GET' && pathname.match(/^\/api\/games\/[^/]+\/player\/[^/]+$/)) {
      const [, , , codeRaw, , playerId] = pathname.split('/');
      const game = config.games.get((codeRaw || '').toUpperCase());
      if (!game) return sendJson(res, 404, { error: 'Game not found' });
      const player = game.players.find((p) => p.playerId === playerId);
      if (!player) return sendJson(res, 404, { error: 'Player not found' });
      clampGameGold(game);
      endGameWhenTimerExpires(game, { requestId: reqInfo.requestId });

      if (game.state === 'ended') {
        return sendJson(res, 200, {
          state: 'ended',
          ended: true,
          mode: game.mode,
          modeFamily: game.settings.gameTypeFamily || 'goldquest',
          gold: player.gold,
          puzzle: getPuzzlePayload(game),
          playerName: player.playerName,
          message: 'Host ended the game.',
        });
      }

      if (game.state !== 'live') {
        const takenIds = [...getTakenBlookIds(game, player.playerId)];
        return sendJson(res, 200, {
          state: game.state,
          waiting: true,
          mode: game.mode,
          modeFamily: game.settings.gameTypeFamily || 'goldquest',
          gold: player.gold,
          puzzle: getPuzzlePayload(game),
          playerName: player.playerName,
          feedbackDelaySec: game.settings.feedbackDelaySec,
          blookSelection: {
            catalog: config.blookCatalog,
            takenIds,
            current: player.blook || null,
          },
        });
      }

      const hasTimer = ['timed', 'hybrid'].includes(game.settings.gameType);
      const remainingSec = hasTimer ? Math.max(0, Math.floor((new Date(game.endsAt).getTime() - Date.now()) / 1000)) : null;
      const limit = game.settings.questionLimit;

      if (player.pendingChest) {
        return sendJson(res, 200, {
          state: 'live',
          mode: game.mode,
          modeFamily: game.settings.gameTypeFamily || 'goldquest',
          playerName: player.playerName,
          gold: player.gold,
          questionIndex: player.questionIndex,
          gameType: game.settings.gameType,
          remainingSec,
          targetQuestions: limit,
          feedbackDelaySec: game.settings.feedbackDelaySec,
          puzzle: getPuzzlePayload(game),
          chestPhase: player.pendingChest.phase,
          chest: getChestPayload(game, player),
        });
      }

      const finishedByTime = hasTimer ? remainingSec <= 0 : false;
      const finishedByQuestions = player.questionIndex >= limit;
      const finished =
        game.settings.gameType === 'timed'
          ? finishedByTime
          : game.settings.gameType === 'hybrid'
            ? (finishedByTime || finishedByQuestions)
            : finishedByQuestions;
      if (finished) {
        return sendJson(res, 200, {
          state: 'finished',
          finished: true,
          mode: game.mode,
          modeFamily: game.settings.gameTypeFamily || 'goldquest',
          playerName: player.playerName,
          gold: player.gold,
          puzzle: getPuzzlePayload(game),
          answered: player.questionIndex,
          remainingSec,
        });
      }

      const question = game.set.questions[player.questionIndex % game.set.questions.length] || null;
      if (!question) return sendJson(res, 200, { state: 'finished', finished: true, gold: player.gold });

      return sendJson(res, 200, {
        state: 'live',
        mode: game.mode,
        modeFamily: game.settings.gameTypeFamily || 'goldquest',
        playerName: player.playerName,
        gold: player.gold,
        questionIndex: player.questionIndex,
        gameType: game.settings.gameType,
        remainingSec,
        targetQuestions: limit,
        feedbackDelaySec: game.settings.feedbackDelaySec,
        puzzle: getPuzzlePayload(game),
        question: {
          q: question.q,
          answers: question.answers,
          imageUrl: question.imageUrl || null,
        },
      });
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/player\/[^/]+\/answer$/)) {
      const [, , , codeRaw, , playerId] = pathname.split('/');
      const game = config.games.get((codeRaw || '').toUpperCase());
      if (!game) return sendJson(res, 404, { error: 'Game not found' });
      const player = game.players.find((p) => p.playerId === playerId);
      if (!player) return sendJson(res, 404, { error: 'Player not found' });
      clampGameGold(game);
      endGameWhenTimerExpires(game, { requestId: reqInfo.requestId });
      if (game.state === 'ended') return sendJson(res, 410, { error: 'Game ended by host.' });
      if (game.state !== 'live') return sendJson(res, 400, { error: 'Game has not started.' });
      if (player.pendingChest) return sendJson(res, 409, { error: 'Resolve your chest first.' });

      parseBody(req)
        .then((body) => {
          const hasTimer = ['timed', 'hybrid'].includes(game.settings.gameType);
          const timedScoring = game.settings.gameType === 'timed';
          const isAssembleMode = game.settings.gameTypeFamily === 'assemble';
          const remainingSec = hasTimer ? Math.max(0, Math.floor((new Date(game.endsAt).getTime() - Date.now()) / 1000)) : 999;
          if (hasTimer && remainingSec <= 0) return sendJson(res, 200, { finished: true, gold: player.gold });

          const index = Number(body.answerIndex);
          const question = game.set.questions[player.questionIndex % game.set.questions.length];
          if (!question) return sendJson(res, 200, { finished: true, gold: player.gold });

          const correctIndex = Number(question.correct);
          if (!Number.isInteger(index) || index < 0 || index >= (Array.isArray(question.answers) ? question.answers.length : 0)) {
            return sendJson(res, 400, { error: 'Valid answerIndex is required.' });
          }
          const correct = Number.isInteger(correctIndex) && index === correctIndex;
          let gained = 0;
          let awaitingChestChoice = false;
          let puzzleReveal = null;
          if (correct) {
            if (isAssembleMode) {
              gained = timedScoring ? Math.floor(60 + Math.random() * 121) : Math.floor(90 + Math.random() * 181);
              player.gold += gained;
              puzzleReveal = revealNextPuzzleTile(game);
              if (puzzleReveal?.tileNumber) {
                game.eventLog.push({
                  at: new Date().toISOString(),
                  type: 'puzzle',
                  text: `${player.playerName} revealed tile #${puzzleReveal.tileNumber} (${puzzleReveal.revealedCount}/${puzzleReveal.totalTiles}).`,
                });
              }
            } else {
              player.pendingChest = createPendingChest();
              awaitingChestChoice = true;
            }
          }
          player.questionIndex += 1;

          sendJson(res, 200, {
            correct,
            correctIndex: Number.isInteger(correctIndex) ? correctIndex : 0,
            gained,
            goldGained: gained,
            playerName: player.playerName,
            totalGold: player.gold,
            awaitingChestChoice,
            puzzleReveal,
            puzzle: getPuzzlePayload(game),
            nextQuestion: player.questionIndex,
            remainingSec,
          });
          logDebug('game.answer.submitted', {
            requestId: reqInfo.requestId,
            code: game.code,
            playerId: player.playerId,
            answerIndex: index,
            correct,
            gained,
            totalGold: player.gold,
            questionIndex: player.questionIndex,
            awaitingChestChoice,
            puzzleReveal: puzzleReveal?.tileNumber || null,
          });
        })
        .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
      return;
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/player\/[^/]+\/chest$/)) {
      const [, , , codeRaw, , playerId] = pathname.split('/');
      const game = config.games.get((codeRaw || '').toUpperCase());
      if (!game) return sendJson(res, 404, { error: 'Game not found' });
      const player = game.players.find((p) => p.playerId === playerId);
      if (!player) return sendJson(res, 404, { error: 'Player not found' });
      clampGameGold(game);
      endGameWhenTimerExpires(game, { requestId: reqInfo.requestId });
      if (game.state === 'ended') return sendJson(res, 410, { error: 'Game ended by host.' });
      if (game.state !== 'live') return sendJson(res, 400, { error: 'Game has not started.' });
      if (!player.pendingChest) return sendJson(res, 400, { error: 'No chest action pending.' });

      parseBody(req)
        .then((body) => {
          if (player.pendingChest.phase === 'choose') {
            const rawIndex = body.chestIndex !== undefined ? body.chestIndex : body.optionIndex;
            const index = Number(rawIndex);
            if (!Number.isInteger(index) || index < 0 || index >= player.pendingChest.options.length) {
              return sendJson(res, 400, { error: 'Valid chestIndex is required.' });
            }

            const option = player.pendingChest.options[index];
            player.pendingChest.selectedIndex = index;
            const requiresTarget = INTERACTION_CHEST_TYPES.has(option.type);
            const targetChoices = requiresTarget ? getChestTargetChoices(game, player) : [];
            if (requiresTarget && targetChoices.length) {
              player.pendingChest.phase = 'target';
              player.pendingChest.result = null;
              logDebug('game.chest.target_required', {
                requestId: reqInfo.requestId,
                code: game.code,
                playerId: player.playerId,
                optionIndex: index,
                optionType: option.type,
                targets: targetChoices.length,
              });
              return sendJson(res, 200, {
                chestPhase: 'target',
                playerName: player.playerName,
                gold: player.gold,
                chest: getChestPayload(game, player),
              });
            }

            const result = resolveChestChoice(game, player, option);
            player.pendingChest.phase = 'result';
            player.pendingChest.result = result;
            if (result?.eventText) {
              game.eventLog.push({ at: new Date().toISOString(), type: 'chest', text: result.eventText });
            }
            logDebug('game.chest.resolved', {
              requestId: reqInfo.requestId,
              code: game.code,
              playerId: player.playerId,
              optionIndex: index,
              optionType: option.type,
              resultType: result?.type,
              playerGold: player.gold,
              target: result?.target || null,
            });

            return sendJson(res, 200, {
              chestPhase: 'result',
              playerName: player.playerName,
              gold: player.gold,
              chest: {
                options: player.pendingChest.options.map((item) => ({ label: item.label, type: item.type })),
                selectedIndex: player.pendingChest.selectedIndex,
                result: player.pendingChest.result,
              },
            });
          }

          if (player.pendingChest.phase === 'target') {
            const index = Number(player.pendingChest.selectedIndex);
            if (!Number.isInteger(index) || index < 0 || index >= player.pendingChest.options.length) {
              return sendJson(res, 400, { error: 'Chest target action is invalid.' });
            }
            const option = player.pendingChest.options[index];
            if (!INTERACTION_CHEST_TYPES.has(option.type)) {
              return sendJson(res, 400, { error: 'Selected chest option does not need a target.' });
            }

            let result = null;
            if (body.action === 'skip') {
              result = createChestSkipResult(player, option);
            } else if (body.action === 'target') {
              const targetPlayerId = String(body.targetPlayerId || '');
              if (!targetPlayerId) return sendJson(res, 400, { error: 'targetPlayerId is required.' });
              const validTargets = getChestTargetChoices(game, player);
              if (!validTargets.some((entry) => entry.playerId === targetPlayerId)) {
                return sendJson(res, 404, { error: 'Target player not found.' });
              }
              result = resolveChestChoice(game, player, option, targetPlayerId);
            } else {
              return sendJson(res, 400, { error: 'Use action="target" or action="skip".' });
            }

            player.pendingChest.phase = 'result';
            player.pendingChest.result = result;
            if (result?.eventText) {
              game.eventLog.push({ at: new Date().toISOString(), type: 'chest', text: result.eventText });
            }
            logDebug('game.chest.target_resolved', {
              requestId: reqInfo.requestId,
              code: game.code,
              playerId: player.playerId,
              optionType: option.type,
              action: body.action,
              target: result?.target || body.targetPlayerId || null,
              resultType: result?.type || null,
              playerGold: player.gold,
            });
            return sendJson(res, 200, {
              chestPhase: 'result',
              playerName: player.playerName,
              gold: player.gold,
              chest: {
                options: player.pendingChest.options.map((item) => ({ label: item.label, type: item.type })),
                selectedIndex: player.pendingChest.selectedIndex,
                result: player.pendingChest.result,
              },
            });
          }

          if (body.action !== 'next') return sendJson(res, 400, { error: 'Use action="next" to continue.' });
          player.pendingChest = null;
          logDebug('game.chest.next', {
            requestId: reqInfo.requestId,
            code: game.code,
            playerId: player.playerId,
            nextQuestion: player.questionIndex,
          });
          return sendJson(res, 200, { ok: true, playerName: player.playerName, gold: player.gold, nextQuestion: player.questionIndex });
        })
        .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
      return;
    }

    if (req.method === 'DELETE' && pathname.match(/^\/api\/games\/[^/]+$/)) {
      const code = pathname.split('/')[3]?.toUpperCase();
      if (!code || !config.games.has(code)) return sendJson(res, 404, { error: 'Game not found' });
      config.games.delete(code);
      logInfo('game.deleted', {
        requestId: reqInfo.requestId,
        code,
        remainingGames: config.games.size,
      });
      return sendJson(res, 200, { message: 'Game deleted.' });
    }

    logWarn('http.route.not_found', {
      requestId: reqInfo.requestId,
      method: reqInfo.method,
      path: reqInfo.path,
    });
    sendJson(res, 404, { error: 'Not found' });
  };
}

module.exports = { createRoutes };
