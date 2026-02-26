const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const HTML_PAGE = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const blookCatalog = [
  { id: 'chick', name: 'Chick', rarity: 'Common', imageUrl: 'https://greenit-aqfd.onrender.com/Blooket/IMG_1282.webp' },
  { id: 'cow', name: 'Cow', rarity: 'Common', imageUrl: 'https://greenit-aqfd.onrender.com/Blooket/IMG_1283.webp' },
  { id: 'goat', name: 'Goat', rarity: 'Common', imageUrl: 'https://greenit-aqfd.onrender.com/Blooket/IMG_1284.webp' },
  { id: 'horse', name: 'Horse', rarity: 'Common', imageUrl: 'https://greenit-aqfd.onrender.com/Blooket/IMG_1285.webp' },
  { id: 'duck', name: 'Duck', rarity: 'Epic', imageUrl: 'https://greenit-aqfd.onrender.com/Blooket/IMG_1286.webp' },
];

const fallbackSets = [
  {
    id: 'classic-geo',
    title: 'World Geography Sprint',
    description: 'Fast geography facts',
    source: 'Greenit fallback',
    questions: [
      { q: 'What is the capital of Japan?', answers: ['Tokyo', 'Kyoto', 'Osaka', 'Nagoya'], correct: 0 },
      { q: 'Which continent is Kenya in?', answers: ['Europe', 'Asia', 'Africa', 'South America'], correct: 2 },
      { q: 'Mount Everest is in which mountain range?', answers: ['Andes', 'Himalayas', 'Alps', 'Rockies'], correct: 1 },
    ],
  },
  {
    id: 'classic-science',
    title: 'Quick Science Check',
    description: 'General science review',
    source: 'Greenit fallback',
    questions: [
      { q: 'Water boils at what temperature (C)?', answers: ['90', '95', '100', '120'], correct: 2 },
      { q: 'What planet is known as the red planet?', answers: ['Venus', 'Mars', 'Saturn', 'Mercury'], correct: 1 },
      { q: 'Humans breathe in which gas?', answers: ['Carbon dioxide', 'Nitrogen', 'Oxygen', 'Hydrogen'], correct: 2 },
    ],
  },
];

const remoteTopics = [
  { id: 'opentdb-general-30', title: 'General Knowledge (OpenTDB)', provider: 'opentdb', category: 9 },
  { id: 'opentdb-science-30', title: 'Science & Nature (OpenTDB)', provider: 'opentdb', category: 17 },
  { id: 'opentdb-history-30', title: 'History (OpenTDB)', provider: 'opentdb', category: 23 },
  { id: 'opentdb-math-30', title: 'Math (OpenTDB)', provider: 'opentdb', category: 19 },
  { id: 'triviaapi-mixed-20', title: 'Mixed Trivia (The Trivia API)', provider: 'thetriviaapi', limit: 20 },
  { id: 'triviaapi-film-20', title: 'Film & TV (The Trivia API)', provider: 'thetriviaapi', categories: 'film_and_tv', limit: 20 },
  { id: 'jservice-random-25', title: 'Random Jeopardy! clues (jService)', provider: 'jservice', limit: 25 },
];

const remoteSetCache = new Map();
const games = new Map();

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendText(res, code, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function randomCode() {
  const chars = '1234567890';
  let code = '';
  for (let i = 0; i < 6; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function randomHostPin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sample(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'user-agent': 'greenit/2.0' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Remote response is not JSON'));
          }
        });
      })
      .on('error', reject);
  });
}

async function getRemoteSet(id) {
  if (remoteSetCache.has(id)) return remoteSetCache.get(id);
  const topic = remoteTopics.find((t) => t.id === id);
  if (!topic) return null;

  let questions = [];
  let source = 'Open Trivia DB';

  if (topic.provider === 'opentdb') {
    const remote = await fetchJson(`https://opentdb.com/api.php?amount=30&type=multiple&category=${topic.category}`);
    if (!Array.isArray(remote?.results) || !remote.results.length) return null;
    questions = remote.results.map((item) => {
      const correctAnswer = decodeHtmlEntities(item.correct_answer);
      const answers = shuffle([correctAnswer, ...item.incorrect_answers.map(decodeHtmlEntities)]);
      return {
        q: decodeHtmlEntities(item.question),
        answers,
        correct: answers.indexOf(correctAnswer),
      };
    });
  } else if (topic.provider === 'thetriviaapi') {
    source = 'The Trivia API';
    const params = new URLSearchParams({
      limit: String(topic.limit || 20),
      region: 'US',
      difficulty: 'easy,medium',
    });
    if (topic.categories) params.set('categories', topic.categories);
    const remote = await fetchJson(`https://the-trivia-api.com/v2/questions?${params.toString()}`);
    if (!Array.isArray(remote) || !remote.length) return null;
    questions = remote
      .map((item) => {
        const allAnswers = [...(item.incorrectAnswers || []), item.correctAnswer].map(decodeHtmlEntities).filter(Boolean);
        if (allAnswers.length !== 4) return null;
        const shuffled = shuffle(allAnswers);
        const correctAnswer = decodeHtmlEntities(item.correctAnswer);
        return {
          q: decodeHtmlEntities(item.question?.text || item.question),
          answers: shuffled,
          correct: shuffled.indexOf(correctAnswer),
        };
      })
      .filter(Boolean);
  } else if (topic.provider === 'jservice') {
    source = 'jService';
    const remote = await fetchJson(`https://jservice.io/api/random?count=${topic.limit || 25}`);
    if (!Array.isArray(remote) || !remote.length) return null;
    questions = remote
      .map((item) => {
        const answer = decodeHtmlEntities(item.answer).replace(/(<([^>]+)>)/gi, '').trim();
        const clue = decodeHtmlEntities(item.question).trim();
        if (!answer || !clue) return null;
        const decoys = shuffle([
          'Not enough info',
          'Unknown',
          'True',
          'False',
          'All of the above',
          'None of the above',
          'A',
          'B',
        ]).slice(0, 3);
        const answers = shuffle([answer, ...decoys]);
        return {
          q: clue,
          answers,
          correct: answers.indexOf(answer),
        };
      })
      .filter(Boolean);
  }

  if (!questions.length) return null;

  const set = {
    id,
    title: topic.title,
    description: `Loaded from ${source}`,
    source,
    questions,
  };
  remoteSetCache.set(id, set);
  return set;
}

async function searchQuizSets(query) {
  const q = String(query || '').trim().toLowerCase();
  const localMatches = fallbackSets.filter(
    (set) => !q || set.title.toLowerCase().includes(q) || set.description.toLowerCase().includes(q)
  );

  const topicMatches = remoteTopics
    .filter((t) => !q || t.title.toLowerCase().includes(q))
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: `Remote set from ${t.provider}`,
      source: t.provider,
      questionCount: t.limit || 30,
    }));

  return [...topicMatches, ...localMatches];
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length < 1) return 'Custom sets need at least 1 question.';
  for (const q of questions) {
    if (!q || typeof q.q !== 'string' || !q.q.trim()) return 'Each question needs text.';
    if (!Array.isArray(q.answers) || q.answers.length !== 4) return 'Each question needs exactly 4 answers.';
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) return 'Each question needs a valid correct index (0-3).';
  }
  return null;
}

function validateHostPayload(body) {
  if (!body || typeof body !== 'object') return 'Expected request body object.';
  if (!body.setId && !body.customSet) return 'Choose or create a game set first.';
  if (body.customSet) {
    if (!body.customSet.title || typeof body.customSet.title !== 'string') return 'Custom set title is required.';
    const err = validateQuestions(body.customSet.questions);
    if (err) return err;
  }
  const gameType = body.gameType || 'question';
  if (!['question', 'timed'].includes(gameType)) return 'Game type must be question or timed.';
  return null;
}

function validateJoinPayload(body) {
  if (!body || typeof body !== 'object') return 'Expected request body object.';
  if (!body.playerName || typeof body.playerName !== 'string') return 'Player name is required.';
  if (!body.blook?.name || !body.blook?.imageUrl) return 'Blook is required.';
  return null;
}

async function resolveSet({ setId, customSet }) {
  if (customSet) {
    return {
      id: `custom-${randomId()}`,
      title: customSet.title,
      description: customSet.description || 'Custom local set',
      source: 'Custom local set',
      questions: customSet.questions,
    };
  }

  const remote = await getRemoteSet(setId);
  if (remote) return remote;
  return fallbackSets.find((s) => s.id === setId) || fallbackSets[0];
}

async function createHostedGame({ setId, customSet, gameType, questionLimit, timeLimitSec }) {
  const selected = await resolveSet({ setId, customSet });
  let code;
  do code = randomCode(); while (games.has(code));

  const now = new Date().toISOString();
  const modeSettings = {
    gameType: gameType || 'question',
    questionLimit: Math.max(1, Math.min(Number(questionLimit) || selected.questions.length, selected.questions.length)),
    timeLimitSec: Math.max(30, Math.min(Number(timeLimitSec) || 120, 900)),
  };

  const game = {
    code,
    hostPin: randomHostPin(),
    mode: modeSettings.gameType === 'timed' ? 'Time Attack' : 'Gold Quest',
    set: selected,
    state: 'lobby',
    settings: modeSettings,
    createdAt: now,
    startedAt: null,
    endsAt: null,
    endedAt: null,
    eventLog: [],
    players: [],
  };
  games.set(code, game);
  return game;
}

function chestEvent(game, player) {
  if (!game.players.length) return null;
  const opponents = game.players.filter((p) => p.playerId !== player.playerId);
  const target = opponents.length ? sample(opponents) : null;
  const roll = Math.random();
  if (!target || roll < 0.35) {
    const bonus = Math.floor(35 + Math.random() * 61);
    player.gold += bonus;
    return { type: 'bonus', text: `${player.playerName} found ${bonus} gold in a chest!` };
  }
  if (roll < 0.65) {
    const steal = Math.min(target.gold, Math.floor(20 + Math.random() * 80));
    target.gold -= steal;
    player.gold += steal;
    return { type: 'steal', text: `${player.playerName} stole ${steal} gold from ${target.playerName}!`, target: target.playerName };
  }

  const original = player.gold;
  player.gold = target.gold;
  target.gold = original;
  return {
    type: 'swap',
    text: `${player.playerName} swapped gold totals with ${target.playerName}!`,
    target: target.playerName,
    newGold: player.gold,
  };
}

function publicGame(game) {
  return {
    code: game.code,
    hostPin: game.hostPin,
    mode: game.mode,
    state: game.state,
    setTitle: game.set.title,
    settings: game.settings,
    players: game.players.map((p) => ({ playerId: p.playerId, playerName: p.playerName, blook: p.blook, gold: p.gold, answered: p.questionIndex })),
    eventLog: game.eventLog.slice(-8),
  };
}

function routes(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname, searchParams } = requestUrl;

  if (req.method === 'GET' && pathname === '/') return sendText(res, 200, HTML_PAGE, 'text/html; charset=utf-8');
  if (req.method === 'GET' && pathname === '/api/blooks') return sendJson(res, 200, { blooks: blookCatalog });

  if (req.method === 'GET' && pathname === '/api/quiz/search') {
    searchQuizSets(searchParams.get('q') || '').then((sets) => sendJson(res, 200, { sets }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/host') {
    parseBody(req)
      .then(async (body) => {
        const error = validateHostPayload(body);
        if (error) return sendJson(res, 400, { error });
        const game = await createHostedGame(body);
        sendJson(res, 201, { game: publicGame(game), message: `${game.mode} lobby created.` });
      })
      .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
    return;
  }

  if (req.method === 'GET' && pathname.match(/^\/api\/games\/[^/]+\/lobby$/)) {
    const code = pathname.split('/')[3]?.toUpperCase();
    const game = code ? games.get(code) : null;
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    return sendJson(res, 200, { game: publicGame(game) });
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/join$/)) {
    const code = pathname.split('/')[3]?.toUpperCase();
    const game = code ? games.get(code) : null;
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    if (game.state !== 'lobby') return sendJson(res, 400, { error: 'Game already started. Cannot join now.' });

    parseBody(req)
      .then((body) => {
        const error = validateJoinPayload(body);
        if (error) return sendJson(res, 400, { error });
        if (game.players.some((p) => p.playerName.toLowerCase() === body.playerName.trim().toLowerCase())) {
          return sendJson(res, 409, { error: 'Player name already in use.' });
        }
        const player = {
          playerId: randomId(),
          playerName: body.playerName.trim(),
          blook: body.blook,
          joinedAt: new Date().toISOString(),
          gold: 0,
          questionIndex: 0,
        };
        game.players.push(player);
        sendJson(res, 201, { gameCode: game.code, player });
      })
      .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
    return;
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/start$/)) {
    const code = pathname.split('/')[3]?.toUpperCase();
    const game = code ? games.get(code) : null;
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    if (game.state !== 'lobby') return sendJson(res, 400, { error: 'Game already started.' });
    if (!game.players.length) return sendJson(res, 400, { error: 'Need at least 1 player before starting.' });

    game.state = 'live';
    game.startedAt = new Date().toISOString();
    if (game.settings.gameType === 'timed') {
      game.endsAt = new Date(Date.now() + game.settings.timeLimitSec * 1000).toISOString();
    }
    return sendJson(res, 200, { message: 'Game started! Players now see questions.' });
  }


  if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/kick$/)) {
    const code = pathname.split('/')[3]?.toUpperCase();
    const game = code ? games.get(code) : null;
    if (!game) return sendJson(res, 404, { error: 'Game not found' });

    parseBody(req)
      .then((body) => {
        const targetId = String(body.playerId || '');
        if (!targetId) return sendJson(res, 400, { error: 'playerId is required.' });
        const idx = game.players.findIndex((p) => p.playerId === targetId);
        if (idx < 0) return sendJson(res, 404, { error: 'Player not found' });
        const [removed] = game.players.splice(idx, 1);
        game.eventLog.push({ at: new Date().toISOString(), type: 'kick', text: `${removed.playerName} was kicked by host.` });
        sendJson(res, 200, { message: 'Player kicked.', playerId: removed.playerId });
      })
      .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
    return;
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/end$/)) {
    const code = pathname.split('/')[3]?.toUpperCase();
    const game = code ? games.get(code) : null;
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    if (game.state === 'ended') return sendJson(res, 200, { message: 'Game already ended.' });

    game.state = 'ended';
    game.endedAt = new Date().toISOString();
    game.eventLog.push({ at: game.endedAt, type: 'ended', text: 'Host ended the game for everyone.' });
    return sendJson(res, 200, { message: 'Game ended for all players.' });
  }

  if (req.method === 'GET' && pathname.match(/^\/api\/games\/[^/]+\/player\/[^/]+$/)) {
    const [, , , codeRaw, , playerId] = pathname.split('/');
    const game = games.get((codeRaw || '').toUpperCase());
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    const player = game.players.find((p) => p.playerId === playerId);
    if (!player) return sendJson(res, 404, { error: 'Player not found' });

    if (game.state === 'ended') {
      return sendJson(res, 200, { state: 'ended', ended: true, gold: player.gold, playerName: player.playerName, message: 'Host ended the game.' });
    }

    if (game.state !== 'live') {
      return sendJson(res, 200, { state: game.state, waiting: true, gold: player.gold, playerName: player.playerName });
    }

    const timed = game.settings.gameType === 'timed';
    const remainingSec = timed ? Math.max(0, Math.floor((new Date(game.endsAt).getTime() - Date.now()) / 1000)) : null;
    const limit = game.settings.questionLimit;
    const finished = timed ? remainingSec <= 0 : player.questionIndex >= limit;
    if (finished) return sendJson(res, 200, { state: 'finished', finished: true, gold: player.gold, answered: player.questionIndex, remainingSec });

    const question = game.set.questions[player.questionIndex % game.set.questions.length] || null;
    if (!question) return sendJson(res, 200, { state: 'finished', finished: true, gold: player.gold });

    return sendJson(res, 200, {
      state: 'live',
      gold: player.gold,
      questionIndex: player.questionIndex,
      gameType: game.settings.gameType,
      remainingSec,
      targetQuestions: limit,
      question: { q: question.q, answers: question.answers },
    });
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/player\/[^/]+\/answer$/)) {
    const [, , , codeRaw, , playerId] = pathname.split('/');
    const game = games.get((codeRaw || '').toUpperCase());
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    const player = game.players.find((p) => p.playerId === playerId);
    if (!player) return sendJson(res, 404, { error: 'Player not found' });
    if (game.state === 'ended') return sendJson(res, 410, { error: 'Game ended by host.' });
    if (game.state !== 'live') return sendJson(res, 400, { error: 'Game has not started.' });

    parseBody(req)
      .then((body) => {
        const timed = game.settings.gameType === 'timed';
        const remainingSec = timed ? Math.max(0, Math.floor((new Date(game.endsAt).getTime() - Date.now()) / 1000)) : 999;
        if (timed && remainingSec <= 0) return sendJson(res, 200, { finished: true, gold: player.gold });

        const index = Number(body.answerIndex);
        const question = game.set.questions[player.questionIndex % game.set.questions.length];
        if (!question) return sendJson(res, 200, { finished: true, gold: player.gold });

        const correct = index === question.correct;
        let gained = 0;
        let chest = null;
        if (correct) {
          gained = timed ? Math.floor(15 + Math.random() * 31) : Math.floor(20 + Math.random() * 61);
          player.gold += gained;
          chest = chestEvent(game, player);
          if (chest) {
            game.eventLog.push({ at: new Date().toISOString(), ...chest });
          }
        }
        player.questionIndex += 1;

        sendJson(res, 200, { correct, gained, totalGold: player.gold, chest, nextQuestion: player.questionIndex, remainingSec });
      })
      .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
    return;
  }

  if (req.method === 'DELETE' && pathname.match(/^\/api\/games\/[^/]+$/)) {
    const code = pathname.split('/')[3]?.toUpperCase();
    if (!code || !games.has(code)) return sendJson(res, 404, { error: 'Game not found' });
    games.delete(code);
    return sendJson(res, 200, { message: 'Game deleted.' });
  }

  sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(routes);
server.listen(PORT, () => {
  console.log(`Greenit server running at http://localhost:${PORT}`);
});
