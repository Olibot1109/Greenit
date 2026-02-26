const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;

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
  { id: 'remote-general-30', title: 'General Knowledge (30)', category: 9 },
  { id: 'remote-science-30', title: 'Science & Nature (30)', category: 17 },
  { id: 'remote-history-30', title: 'History (30)', category: 23 },
  { id: 'remote-math-30', title: 'Math (30)', category: 19 },
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

  const remote = await fetchJson(`https://opentdb.com/api.php?amount=30&type=multiple&category=${topic.category}`);
  if (!Array.isArray(remote?.results) || !remote.results.length) return null;

  const questions = remote.results.map((item) => {
    const correctAnswer = decodeHtmlEntities(item.correct_answer);
    const answers = shuffle([correctAnswer, ...item.incorrect_answers.map(decodeHtmlEntities)]);
    return {
      q: decodeHtmlEntities(item.question),
      answers,
      correct: answers.indexOf(correctAnswer),
    };
  });

  const set = {
    id,
    title: topic.title,
    description: 'Loaded from Open Trivia DB',
    source: 'Open Trivia DB',
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
      description: '30-question pack from Open Trivia DB',
      source: 'Open Trivia DB',
      questionCount: 30,
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
  if (!body.hostBlook?.name || !body.hostBlook?.imageUrl) return 'Host blook is required.';
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

async function createHostedGame({ setId, hostBlook, customSet, gameType, questionLimit, timeLimitSec }) {
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
    hostBlook,
    set: selected,
    state: 'lobby',
    settings: modeSettings,
    createdAt: now,
    startedAt: null,
    endsAt: null,
    players: [],
  };
  games.set(code, game);
  return game;
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

  if (req.method === 'GET' && pathname.match(/^\/api\/games\/[^/]+\/player\/[^/]+$/)) {
    const [, , , codeRaw, , playerId] = pathname.split('/');
    const game = games.get((codeRaw || '').toUpperCase());
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    const player = game.players.find((p) => p.playerId === playerId);
    if (!player) return sendJson(res, 404, { error: 'Player not found' });

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
        if (correct) {
          gained = timed ? Math.floor(15 + Math.random() * 31) : Math.floor(20 + Math.random() * 61);
          player.gold += gained;
        }
        player.questionIndex += 1;

        sendJson(res, 200, { correct, gained, totalGold: player.gold, nextQuestion: player.questionIndex, remainingSec });
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

const HTML_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Greenit - Quiz Arena</title>
<style>
:root{--bg:#0b1022;--card:#111833;--line:#2c3f76;--text:#eef3ff;--muted:#9bb0de;--accent:#4f7dff;--accent2:#28c2a7;--gold:#ffdf4d}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui;background:radial-gradient(circle at top,#172f66,#0b1022 65%);color:var(--text)}
.wrap{max-width:1160px;margin:auto;padding:24px}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.tag{padding:6px 10px;border-radius:999px;background:#1b2550;color:var(--muted);font-weight:700;font-size:12px}
.card{background:linear-gradient(180deg,#141d3c,#101732);border:1px solid var(--line);border-radius:16px;padding:18px;box-shadow:0 12px 28px #0006;margin-top:14px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.hidden{display:none}
button{background:var(--accent);color:#fff;border:0;padding:10px 14px;border-radius:10px;font-weight:700;cursor:pointer;transition:transform .1s ease,filter .2s}
button:hover{filter:brightness(1.08)}button:active{transform:translateY(1px)}button.alt{background:#283b71}button.sub{background:#1a264f}
input,textarea,select{background:#0c1330;color:#fff;border:1px solid #2c3f76;padding:10px;border-radius:10px}
textarea{width:100%;min-height:84px;resize:vertical}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.blook{padding:8px;border:1px solid #334d8f;border-radius:10px;cursor:pointer;text-align:center;background:#0e1735}
.blook img{height:58px}.status{min-height:24px;color:#9ec0ff}.player{display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid #263665;gap:8px}
.player:last-child{border-bottom:0}.gold{color:var(--gold);font-weight:700}.answer{width:100%;text-align:left;margin:6px 0;background:#1a295b}
.columns{display:grid;grid-template-columns:1.3fr .9fr;gap:14px}@media (max-width:900px){.columns{grid-template-columns:1fr}}
.small{font-size:13px;color:var(--muted)}
</style>
</head>
<body><div class="wrap">
<div class="top"><h1>🟩 Greenit Quiz Arena</h1><span class="tag">Remote source: Open Trivia DB + Local custom sets</span></div>
<div id="home" class="card"><p>Choose a role:</p><div class="row"><button id="goHost">Host Game</button><button id="goJoin" class="alt">Join Game</button></div></div>
<div id="host" class="card hidden">
  <h2>Host Setup</h2><div class="row"><button id="backFromHost" class="alt">Back</button></div>
  <div class="columns">
    <div>
      <h3>1) Pick a set</h3>
      <div class="row"><input id="searchSets" placeholder="Search sets"/><button id="runSearch">Search</button></div>
      <div id="setResults"></div>
      <p class="small">Or create your own local custom game and save it in this browser.</p>
      <input id="customTitle" placeholder="Custom set title"/>
      <textarea id="customQuestions" placeholder='One per line:\nQuestion?|A|B|C|D|correct_index(0-3)'></textarea>
      <div class="row"><button id="saveCustom" class="sub">Save custom set locally</button><button id="loadCustom" class="sub">Use saved set</button></div>
    </div>
    <div>
      <h3>2) Game mode</h3>
      <div class="row"><select id="gameType"><option value="question">Question count mode</option><option value="timed">Time attack mode</option></select></div>
      <div class="row"><input id="questionLimit" type="number" min="1" max="30" value="30"/><span class="small">Questions (max 30)</span></div>
      <div class="row"><input id="timeLimit" type="number" min="30" max="900" value="120"/><span class="small">Timer seconds (timed mode)</span></div>
      <h3>3) Choose host blook</h3><div id="hostBlookGrid" class="grid"></div>
      <button id="createHostLobby">Create Lobby</button><p id="hostStatus" class="status"></p>
    </div>
  </div>
</div>
<div id="join" class="card hidden"><h2>Join Game</h2><button id="backFromJoin" class="alt">Back</button>
<div class="row"><input id="joinCode" placeholder="Code"/><input id="joinName" placeholder="Name"/></div>
<div id="joinBlookGrid" class="grid"></div><button id="joinLobby">Join</button><p id="joinStatus" class="status"></p></div>
<div id="lobby" class="card hidden"><h2>Host Lobby <span id="lobbyCode"></span></h2><p id="lobbyMeta"></p><div id="players"></div><button id="startGame">Start</button><button id="closeLobby" class="alt">Close</button><p id="startStatus" class="status"></p></div>
<div id="playerGame" class="card hidden"><h2>Player Panel</h2><p id="playerMeta"></p><div id="questionPanel"></div><p id="playerStatus" class="status"></p></div>
</div>
<script>
const views=['home','host','join','lobby','playerGame'];
let hostSelectedBlook=null,joinSelectedBlook=null,currentHostGameCode=null,lobbyPoll=null,playerPoll=null;
let currentPlayer={code:null,id:null,name:null}; let selectedSetId=null; let selectedCustomSet=null;
const hostStatus=document.getElementById('hostStatus');const joinStatus=document.getElementById('joinStatus');const startStatus=document.getElementById('startStatus');
function showView(v){views.forEach(id=>document.getElementById(id).classList.toggle('hidden',id!==v));}
async function api(url,opt){const r=await fetch(url,opt);const d=await r.json();if(!r.ok) throw new Error(d.error||'Request failed');return d;}
async function loadBlooks(){const data=await api('/api/blooks');for(const [id,onPick] of [['hostBlookGrid',b=>{hostSelectedBlook=b;hostStatus.textContent='Host blook: '+b.name;}],['joinBlookGrid',b=>{joinSelectedBlook=b;joinStatus.textContent='Join blook: '+b.name;}]]){const el=document.getElementById(id);el.innerHTML='';data.blooks.forEach(b=>{const c=document.createElement('div');c.className='blook';c.innerHTML='<img src="'+b.imageUrl+'"/><div>'+b.name+'</div><small>'+b.rarity+'</small>';c.onclick=()=>onPick(b);el.appendChild(c);});}}
async function searchSets(){const q=document.getElementById('searchSets').value.trim();const data=await api('/api/quiz/search?q='+encodeURIComponent(q));const box=document.getElementById('setResults');box.innerHTML='';data.sets.forEach(set=>{const row=document.createElement('div');row.className='player';row.innerHTML='<span>'+set.title+' <small>('+set.source+')</small></span><button>Select</button>';row.querySelector('button').onclick=()=>{selectedSetId=set.id;selectedCustomSet=null;hostStatus.textContent='Selected set: '+set.title;};box.appendChild(row);});if(!data.sets.length) box.textContent='No sets found.';}
function parseCustomQuestionLines(raw){const lines=raw.split('\n').map(x=>x.trim()).filter(Boolean);const questions=[];for(const line of lines){const parts=line.split('|');if(parts.length!==6) throw new Error('Each line must have 6 fields separated by |');const [q,a,b,c,d,correctRaw]=parts;const correct=Number(correctRaw);if(!q||[a,b,c,d].some(x=>!x)||!Number.isInteger(correct)||correct<0||correct>3) throw new Error('Bad custom question format.');questions.push({q,answers:[a,b,c,d],correct});}if(!questions.length) throw new Error('Add at least one custom question.');return questions;}
function saveCustomSet(){try{const title=document.getElementById('customTitle').value.trim();if(!title) throw new Error('Custom title required.');const questions=parseCustomQuestionLines(document.getElementById('customQuestions').value);const payload={title,description:'Saved from browser localStorage',questions};localStorage.setItem('greenit.customSet',JSON.stringify(payload));hostStatus.textContent='Saved custom set locally ✔';}catch(e){hostStatus.textContent=e.message;}}
function useSavedCustomSet(){try{const raw=localStorage.getItem('greenit.customSet');if(!raw) throw new Error('No saved custom set found.');selectedCustomSet=JSON.parse(raw);selectedSetId=null;hostStatus.textContent='Using local custom set: '+selectedCustomSet.title;}catch(e){hostStatus.textContent=e.message;}}
async function refreshLobby(){if(!currentHostGameCode)return;const data=await api('/api/games/'+currentHostGameCode+'/lobby');document.getElementById('lobbyCode').textContent=data.game.code;const s=data.game.settings;document.getElementById('lobbyMeta').textContent='Set: '+data.game.setTitle+' | '+data.game.mode+' | '+(s.gameType==='timed'?(s.timeLimitSec+'s timer'):(s.questionLimit+' questions'))+' | Host PIN: '+data.game.hostPin+' | '+data.game.state;const p=document.getElementById('players');p.innerHTML='';data.game.players.forEach(pl=>{const row=document.createElement('div');row.className='player';row.innerHTML='<span>'+pl.playerName+' ('+pl.blook.name+')</span><span class="gold">'+pl.gold+' gold</span>';p.appendChild(row);});if(!data.game.players.length)p.innerHTML='<p>Waiting for players...</p>';if(data.game.state==='live')startStatus.textContent='Live!';}
async function refreshPlayer(){if(!currentPlayer.code||!currentPlayer.id)return;const data=await api('/api/games/'+currentPlayer.code+'/player/'+currentPlayer.id);let meta=currentPlayer.name+' | Gold: '+(data.gold||0);if(typeof data.remainingSec==='number') meta+=' | ⏱ '+data.remainingSec+'s';document.getElementById('playerMeta').textContent=meta;const panel=document.getElementById('questionPanel');if(data.waiting){panel.innerHTML='<h3>Waiting for host to start...</h3>';return;}if(data.finished){panel.innerHTML='<h3>Done! Final gold: '+data.gold+' | Answered: '+(data.answered||0)+'</h3>';return;}panel.innerHTML='<h3>Q'+(data.questionIndex+1)+': '+data.question.q+'</h3><p class="small">Mode: '+(data.gameType==='timed'?'Time attack':'Question count')+' | Target: '+data.targetQuestions+' questions</p>';data.question.answers.forEach((a,i)=>{const b=document.createElement('button');b.className='answer';b.textContent=a;b.onclick=async()=>{const result=await api('/api/games/'+currentPlayer.code+'/player/'+currentPlayer.id+'/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answerIndex:i})});document.getElementById('playerStatus').textContent=result.correct?'✅ Correct! +'+result.gained+' gold':'❌ Wrong answer';await refreshPlayer();};panel.appendChild(b);});}

document.getElementById('goHost').onclick=()=>showView('host');document.getElementById('goJoin').onclick=()=>showView('join');document.getElementById('backFromHost').onclick=()=>showView('home');document.getElementById('backFromJoin').onclick=()=>showView('home');
document.getElementById('runSearch').onclick=searchSets;document.getElementById('saveCustom').onclick=saveCustomSet;document.getElementById('loadCustom').onclick=useSavedCustomSet;
document.getElementById('createHostLobby').onclick=async()=>{try{if(!hostSelectedBlook)throw new Error('Pick a host blook.');if(!selectedSetId&&!selectedCustomSet)throw new Error('Select a set or load your custom set.');const gameType=document.getElementById('gameType').value;const questionLimit=Number(document.getElementById('questionLimit').value||30);const timeLimitSec=Number(document.getElementById('timeLimit').value||120);const body={setId:selectedSetId,customSet:selectedCustomSet,hostBlook:hostSelectedBlook,gameType,questionLimit,timeLimitSec};const data=await api('/api/host',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});currentHostGameCode=data.game.code;showView('lobby');startStatus.textContent='Lobby ready. Players wait until start.';await refreshLobby();if(lobbyPoll)clearInterval(lobbyPoll);lobbyPoll=setInterval(refreshLobby,1500);}catch(e){hostStatus.textContent=e.message;}};
document.getElementById('joinLobby').onclick=async()=>{try{const code=document.getElementById('joinCode').value.trim().toUpperCase();const name=document.getElementById('joinName').value.trim();if(!joinSelectedBlook)throw new Error('Pick a blook to join.');const data=await api('/api/games/'+code+'/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerName:name,blook:joinSelectedBlook})});currentPlayer={code,id:data.player.playerId,name:data.player.playerName};showView('playerGame');joinStatus.textContent='';await refreshPlayer();if(playerPoll)clearInterval(playerPoll);playerPoll=setInterval(refreshPlayer,1200);}catch(e){joinStatus.textContent=e.message;}};
document.getElementById('startGame').onclick=async()=>{try{const data=await api('/api/games/'+currentHostGameCode+'/start',{method:'POST'});startStatus.textContent=data.message;await refreshLobby();}catch(e){startStatus.textContent=e.message;}};
document.getElementById('closeLobby').onclick=async()=>{if(!currentHostGameCode)return showView('home');await fetch('/api/games/'+currentHostGameCode,{method:'DELETE'});currentHostGameCode=null;if(lobbyPoll)clearInterval(lobbyPoll);showView('home');};
loadBlooks();searchSets();
</script></body></html>`;
