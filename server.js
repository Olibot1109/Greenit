const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;

const blookCatalog = [
  { id: 'chick', name: 'Chick', rarity: 'Common', imageUrl: 'https://ac.blooket.com/dashboard/blooks/chick.svg' },
  { id: 'fox', name: 'Fox', rarity: 'Common', imageUrl: 'https://ac.blooket.com/dashboard/blooks/fox.svg' },
  { id: 'frog', name: 'Frog', rarity: 'Common', imageUrl: 'https://ac.blooket.com/dashboard/blooks/frog.svg' },
  { id: 'unicorn', name: 'Unicorn', rarity: 'Rare', imageUrl: 'https://ac.blooket.com/dashboard/blooks/unicorn.svg' },
  { id: 'astronaut', name: 'Astronaut', rarity: 'Epic', imageUrl: 'https://ac.blooket.com/dashboard/blooks/astronaut.svg' },
];

const fallbackQuizzes = [
  {
    id: 'fallback-science',
    title: 'Science Burst',
    description: 'Quick science facts',
    source: 'Greenit fallback',
    questions: [
      { q: 'What planet is known as the red planet?', answers: ['Mars', 'Jupiter', 'Venus', 'Mercury'], correct: 0 },
      { q: 'What gas do plants absorb?', answers: ['Oxygen', 'Hydrogen', 'Carbon dioxide', 'Helium'], correct: 2 },
      { q: 'How many bones in adult human body?', answers: ['206', '186', '256', '196'], correct: 0 },
    ],
  },
  {
    id: 'fallback-mix',
    title: 'Mixed Trivia',
    description: 'General knowledge warmup',
    source: 'Greenit fallback',
    questions: [
      { q: 'Capital of France?', answers: ['Madrid', 'Paris', 'Rome', 'Berlin'], correct: 1 },
      { q: 'Which ocean is largest?', answers: ['Atlantic', 'Indian', 'Pacific', 'Arctic'], correct: 2 },
      { q: '2 + 2 * 2 = ?', answers: ['6', '8', '4', '2'], correct: 0 },
    ],
  },
];

const games = new Map();

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
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'greenit/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Remote response is not JSON'));
        }
      });
    }).on('error', reject);
  });
}

async function searchQuizSets(query) {
  const q = String(query || '').trim().toLowerCase();
  let remoteSets = [];

  try {
    const data = await fetchJson(`https://opentdb.com/api.php?amount=8&type=multiple&encode=url3986`);
    if (Array.isArray(data?.results) && data.results.length) {
      const byCategory = new Map();
      data.results.forEach((item) => {
        const category = decodeURIComponent(item.category || 'General');
        if (!byCategory.has(category)) byCategory.set(category, []);
        const correctAnswer = decodeURIComponent(item.correct_answer || '');
        const wrong = Array.isArray(item.incorrect_answers) ? item.incorrect_answers.map((a) => decodeURIComponent(a)) : [];
        const all = [...wrong, correctAnswer].sort(() => Math.random() - 0.5);
        byCategory.get(category).push({
          q: decodeURIComponent(item.question || ''),
          answers: all,
          correct: all.indexOf(correctAnswer),
        });
      });

      remoteSets = Array.from(byCategory.entries()).map(([category, questions], idx) => ({
        id: `api-${idx}-${randomId()}`,
        title: `${category} Pack`,
        description: 'Pulled from Open Trivia DB',
        source: 'Open Trivia DB',
        questions: questions.slice(0, 8),
      }));
    }
  } catch {
    remoteSets = [];
  }

  const filteredRemote = remoteSets.filter((set) => !q || set.title.toLowerCase().includes(q) || set.description.toLowerCase().includes(q));
  const filteredFallback = fallbackQuizzes.filter((set) => !q || set.title.toLowerCase().includes(q) || set.description.toLowerCase().includes(q));

  if (filteredRemote.length) return filteredRemote;
  return filteredFallback;
}

function validateHostPayload(body) {
  if (!body || typeof body !== 'object') return 'Expected request body object.';
  if (!body.hostBlook?.name || !body.hostBlook?.imageUrl) return 'Host blook is required.';

  const hasQuizId = typeof body.quizId === 'string' && body.quizId.trim();
  const hasCustomQuiz = body.customQuiz && typeof body.customQuiz === 'object';
  if (!hasQuizId && !hasCustomQuiz) return 'Choose a quiz or provide a custom quiz.';

  if (hasCustomQuiz) {
    if (!body.customQuiz.title || typeof body.customQuiz.title !== 'string') return 'Custom quiz title is required.';
    if (!Array.isArray(body.customQuiz.questions) || body.customQuiz.questions.length < 1) return 'Custom quiz needs at least 1 question.';
    const invalidQuestion = body.customQuiz.questions.find((q) => !q.q || !Array.isArray(q.answers) || q.answers.length < 2 || typeof q.correct !== 'number');
    if (invalidQuestion) return 'Each custom question needs text, 2+ answers, and correct answer index.';
  }

  return null;
}

function validateJoinPayload(body) {
  if (!body || typeof body !== 'object') return 'Expected request body object.';
  if (!body.playerName || typeof body.playerName !== 'string') return 'Player name is required.';
  if (!body.blook?.name || !body.blook?.imageUrl) return 'Blook is required.';
  return null;
}

function publicGame(game) {
  return {
    code: game.code,
    hostPin: game.hostPin,
    mode: game.mode,
    state: game.state,
    setTitle: game.set.title,
    players: game.players.map((p) => ({ playerId: p.playerId, playerName: p.playerName, blook: p.blook, gold: p.gold })),
  };
}

async function createHostedGoldQuest({ quizId, customQuiz, hostBlook }) {
  let selectedQuiz = null;

  if (customQuiz) {
    selectedQuiz = {
      id: `custom-${randomId()}`,
      title: customQuiz.title,
      description: customQuiz.description || 'Custom quiz',
      source: 'Custom Local Quiz',
      questions: customQuiz.questions.map((q) => ({ q: q.q, answers: q.answers, correct: q.correct })),
    };
  } else {
    const sets = await searchQuizSets('');
    selectedQuiz = sets.find((s) => s.id === quizId) || fallbackQuizzes[0];
  }

  let code;
  do {
    code = randomCode();
  } while (games.has(code));

  const game = {
    code,
    hostPin: randomHostPin(),
    mode: 'Gold Quest',
    hostBlook,
    set: selectedQuiz,
    state: 'lobby',
    startedAt: null,
    players: [],
  };

  games.set(code, game);
  return game;
}

function routes(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname, searchParams } = requestUrl;

  if (req.method === 'GET' && pathname === '/') return sendText(res, 200, HTML_PAGE, 'text/html; charset=utf-8');
  if (req.method === 'GET' && pathname === '/api/blooks') return sendJson(res, 200, { blooks: blookCatalog });

  if (req.method === 'GET' && pathname === '/api/quizzes/search') {
    searchQuizSets(searchParams.get('q') || '').then((sets) => sendJson(res, 200, { sets }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/host') {
    parseBody(req)
      .then(async (body) => {
        const error = validateHostPayload(body);
        if (error) return sendJson(res, 400, { error });
        const game = await createHostedGoldQuest(body);
        return sendJson(res, 201, { game: publicGame(game), message: 'Gold Quest lobby created.' });
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

        const nameTaken = game.players.some((p) => p.playerName.toLowerCase() === body.playerName.trim().toLowerCase());
        if (nameTaken) return sendJson(res, 409, { error: 'Player name already in use.' });

        const player = {
          playerId: randomId(),
          playerName: body.playerName.trim(),
          blook: body.blook,
          gold: 0,
          questionIndex: 0,
        };
        game.players.push(player);
        return sendJson(res, 201, { gameCode: game.code, player });
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
    return sendJson(res, 200, { message: 'Game started! Players now see questions.' });
  }

  if (req.method === 'GET' && pathname.match(/^\/api\/games\/[^/]+\/player\/[^/]+$/)) {
    const [, , , codeRaw, , playerId] = pathname.split('/');
    const game = games.get((codeRaw || '').toUpperCase());
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    const player = game.players.find((p) => p.playerId === playerId);
    if (!player) return sendJson(res, 404, { error: 'Player not found' });

    if (game.state !== 'live') return sendJson(res, 200, { state: game.state, waiting: true, gold: player.gold, playerName: player.playerName });

    const question = game.set.questions[player.questionIndex] || null;
    if (!question) return sendJson(res, 200, { state: 'finished', finished: true, gold: player.gold });

    return sendJson(res, 200, {
      state: 'live',
      gold: player.gold,
      questionIndex: player.questionIndex,
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
        const index = Number(body.answerIndex);
        const question = game.set.questions[player.questionIndex];
        if (!question) return sendJson(res, 200, { finished: true, gold: player.gold });

        const correct = index === question.correct;
        let gained = 0;
        if (correct) {
          gained = Math.floor(20 + Math.random() * 61);
          player.gold += gained;
        }

        player.questionIndex += 1;
        return sendJson(res, 200, { correct, gained, totalGold: player.gold, nextQuestion: player.questionIndex });
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

  return sendJson(res, 404, { error: 'Not found' });
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
<title>Greenit Gold Quest</title>
<style>
body{margin:0;font-family:Inter,Arial,sans-serif;background:radial-gradient(circle at top,#18316e,#0d142b 60%);color:#ecf2ff}
.wrap{max-width:1100px;margin:auto;padding:24px}
.card{background:#111a34;border:1px solid #2b3d73;border-radius:16px;padding:16px;box-shadow:0 10px 25px #0007;margin-bottom:14px}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.hidden{display:none}
button{background:#3d68ff;color:#fff;border:0;padding:10px 14px;border-radius:10px;font-weight:700;cursor:pointer}
button.alt{background:#20315f}
input,textarea{background:#0d1530;color:#fff;border:1px solid #2f4177;padding:10px;border-radius:10px}
textarea{width:100%;min-height:90px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.blook{padding:8px;border:1px solid #334d8f;border-radius:10px;cursor:pointer;text-align:center}
.blook img{height:58px}
.status{min-height:24px;color:#9ec0ff}
.player{display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid #2a3a6d}
.gold{color:#ffdf4d;font-weight:700}.answer{width:100%;text-align:left;margin:6px 0}
.small{opacity:.85;font-size:13px}
</style>
</head>
<body><div class="wrap">
<h1>🟩 Greenit Gold Quest</h1>
<div id="home" class="card"><p>Pick mode:</p><div class="row"><button id="goHost">Host</button><button id="goJoin" class="alt">Join</button></div></div>
<div id="host" class="card hidden">
<h2>Host Setup</h2>
<div class="row"><button id="backFromHost" class="alt">Back</button></div>
<p class="small">Quiz source is now Open Trivia API + your local custom quizzes (not Blooket quizzes).</p>
<div class="row"><input id="searchSets" placeholder="Search quiz packs"/><button id="runSearch">Search</button></div>
<div id="setResults"></div>
<h3>Create your own quiz (saved in localStorage)</h3>
<input id="customTitle" placeholder="Custom quiz title" />
<textarea id="customQuestions" placeholder='One question per line:\nQuestion?|Answer A|Answer B|Answer C|Answer D|correctIndex'></textarea>
<div class="row"><button id="saveCustomQuiz" class="alt">Save Custom Quiz</button><button id="loadCustomQuizzes" class="alt">Load Saved Quizzes</button></div>
<div id="customList"></div>
<h3>Choose host blook (Blooket style)</h3>
<div id="hostBlookGrid" class="grid"></div>
<button id="createHostLobby">Create Lobby</button>
<p id="hostStatus" class="status"></p>
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
let currentPlayer={code:null,id:null,name:null}; let selectedQuizId=null; let selectedCustomQuiz=null;
const hostStatus=document.getElementById('hostStatus'); const joinStatus=document.getElementById('joinStatus'); const startStatus=document.getElementById('startStatus');
function showView(v){views.forEach(id=>document.getElementById(id).classList.toggle('hidden',id!==v));}
async function api(url,opt){const r=await fetch(url,opt);const d=await r.json();if(!r.ok) throw new Error(d.error||'Request failed');return d;}
function readStoredCustomQuizzes(){try{return JSON.parse(localStorage.getItem('greenit-custom-quizzes')||'[]');}catch{return [];}}
function writeStoredCustomQuizzes(list){localStorage.setItem('greenit-custom-quizzes',JSON.stringify(list));}
function parseCustomInput(){
  const title=document.getElementById('customTitle').value.trim();
  const raw=document.getElementById('customQuestions').value.trim();
  if(!title||!raw) throw new Error('Need custom title and questions.');
  const lines=raw.split('\n').map(l=>l.trim()).filter(Boolean);
  const questions=lines.map((line)=>{
    const parts=line.split('|').map(p=>p.trim());
    if(parts.length<4) throw new Error('Use format: question|a|b|...|correctIndex');
    const q=parts[0];
    const correct=Number(parts[parts.length-1]);
    const answers=parts.slice(1,parts.length-1);
    if(!q||answers.length<2||Number.isNaN(correct)||correct<0||correct>=answers.length) throw new Error('Invalid custom quiz line.');
    return {q,answers,correct};
  });
  return {id:'local-'+Date.now(),title,description:'Custom local quiz',source:'Local Storage',questions};
}
function renderCustomList(){
  const box=document.getElementById('customList'); box.innerHTML='';
  const list=readStoredCustomQuizzes();
  if(!list.length){box.innerHTML='<p class="small">No saved custom quizzes yet.</p>'; return;}
  list.forEach((quiz)=>{const row=document.createElement('div'); row.className='player'; row.innerHTML='<span>'+quiz.title+' <small>(Local)</small></span><button>Select</button>'; row.querySelector('button').onclick=()=>{selectedCustomQuiz=quiz; selectedQuizId=null; hostStatus.textContent='Selected custom quiz: '+quiz.title;}; box.appendChild(row);});
}
async function loadBlooks(){const data=await api('/api/blooks');[['hostBlookGrid',b=>{hostSelectedBlook=b;hostStatus.textContent='Host blook: '+b.name;}],['joinBlookGrid',b=>{joinSelectedBlook=b;joinStatus.textContent='Join blook: '+b.name;}]].forEach(([id,onPick])=>{const el=document.getElementById(id);el.innerHTML='';data.blooks.forEach(b=>{const c=document.createElement('div');c.className='blook';c.innerHTML='<img src="'+b.imageUrl+'"/><div>'+b.name+'</div>';c.onclick=()=>onPick(b);el.appendChild(c);});});}
async function searchQuizzes(){const q=document.getElementById('searchSets').value.trim();const data=await api('/api/quizzes/search?q='+encodeURIComponent(q));const box=document.getElementById('setResults');box.innerHTML='';data.sets.forEach(set=>{const row=document.createElement('div');row.className='player';row.innerHTML='<span>'+set.title+' <small>('+set.source+')</small></span><button>Select</button>';row.querySelector('button').onclick=()=>{selectedQuizId=set.id;selectedCustomQuiz=null;hostStatus.textContent='Selected quiz: '+set.title;};box.appendChild(row);});if(!data.sets.length) box.innerHTML='<p class="small">No quizzes found.</p>';}
async function refreshLobby(){if(!currentHostGameCode)return;const data=await api('/api/games/'+currentHostGameCode+'/lobby');document.getElementById('lobbyCode').textContent=data.game.code;document.getElementById('lobbyMeta').textContent='Quiz: '+data.game.setTitle+' | Host PIN: '+data.game.hostPin+' | '+data.game.state;const p=document.getElementById('players');p.innerHTML='';data.game.players.forEach(pl=>{const row=document.createElement('div');row.className='player';row.innerHTML='<span>'+pl.playerName+' ('+pl.blook.name+')</span><span class="gold">'+pl.gold+' gold</span>';p.appendChild(row);});if(!data.game.players.length)p.innerHTML='<p>Waiting for players...</p>';if(data.game.state==='live')startStatus.textContent='Live! Gold updates in real-time.';}
async function refreshPlayer(){if(!currentPlayer.code||!currentPlayer.id)return;const data=await api('/api/games/'+currentPlayer.code+'/player/'+currentPlayer.id);document.getElementById('playerMeta').textContent=currentPlayer.name+' | Gold: '+(data.gold||0);const panel=document.getElementById('questionPanel');if(data.waiting){panel.innerHTML='<h3>Waiting for host to start...</h3>';return;}if(data.finished){panel.innerHTML='<h3>Done! Final gold: '+data.gold+'</h3>';return;}panel.innerHTML='<h3>Q'+(data.questionIndex+1)+': '+data.question.q+'</h3>';data.question.answers.forEach((a,i)=>{const b=document.createElement('button');b.className='answer';b.textContent=a;b.onclick=async()=>{const result=await api('/api/games/'+currentPlayer.code+'/player/'+currentPlayer.id+'/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answerIndex:i})});document.getElementById('playerStatus').textContent=result.correct?'✅ Correct! +'+result.gained+' gold':'❌ Wrong answer';await refreshPlayer();};panel.appendChild(b);});}

document.getElementById('goHost').onclick=()=>showView('host');
document.getElementById('goJoin').onclick=()=>showView('join');
document.getElementById('backFromHost').onclick=()=>showView('home');
document.getElementById('backFromJoin').onclick=()=>showView('home');
document.getElementById('runSearch').onclick=searchQuizzes;
document.getElementById('saveCustomQuiz').onclick=()=>{try{const quiz=parseCustomInput();const list=readStoredCustomQuizzes();list.push(quiz);writeStoredCustomQuizzes(list);hostStatus.textContent='Saved custom quiz: '+quiz.title;renderCustomList();}catch(e){hostStatus.textContent=e.message;}};
document.getElementById('loadCustomQuizzes').onclick=renderCustomList;
document.getElementById('createHostLobby').onclick=async()=>{try{if(!hostSelectedBlook)throw new Error('Pick a host blook.');if(!selectedQuizId&&!selectedCustomQuiz)throw new Error('Pick API quiz or select custom quiz.');const payload={hostBlook:hostSelectedBlook};if(selectedCustomQuiz)payload.customQuiz=selectedCustomQuiz;else payload.quizId=selectedQuizId;const data=await api('/api/host',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});currentHostGameCode=data.game.code;showView('lobby');startStatus.textContent='Lobby ready. Players wait until you press start.';await refreshLobby();if(lobbyPoll)clearInterval(lobbyPoll);lobbyPoll=setInterval(refreshLobby,1200);}catch(e){hostStatus.textContent=e.message;}};
document.getElementById('joinLobby').onclick=async()=>{try{const code=document.getElementById('joinCode').value.trim().toUpperCase();const name=document.getElementById('joinName').value.trim();if(!joinSelectedBlook)throw new Error('Pick a blook to join.');if(!code||!name)throw new Error('Need code and name.');const data=await api('/api/games/'+code+'/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerName:name,blook:joinSelectedBlook})});currentPlayer={code,id:data.player.playerId,name:data.player.playerName};showView('playerGame');await refreshPlayer();if(playerPoll)clearInterval(playerPoll);playerPoll=setInterval(refreshPlayer,1000);}catch(e){joinStatus.textContent=e.message;}};
document.getElementById('startGame').onclick=async()=>{try{const data=await api('/api/games/'+currentHostGameCode+'/start',{method:'POST'});startStatus.textContent=data.message;await refreshLobby();}catch(e){startStatus.textContent=e.message;}};
document.getElementById('closeLobby').onclick=async()=>{if(!currentHostGameCode)return showView('home');await fetch('/api/games/'+currentHostGameCode,{method:'DELETE'});currentHostGameCode=null;if(lobbyPoll)clearInterval(lobbyPoll);showView('home');};

loadBlooks();searchQuizzes();renderCustomList();
</script></body></html>`;
