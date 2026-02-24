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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'greenit/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
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

async function searchBlooketSets(query) {
  const q = String(query || '').trim().toLowerCase();
  let remoteSets = [];
  try {
    const remote = await fetchJson(`https://blooketbot.glitch.me/api/search?query=${encodeURIComponent(q || 'quiz')}`);
    if (Array.isArray(remote?.sets)) {
      remoteSets = remote.sets.slice(0, 8).map((set) => ({
        id: String(set.id || randomId()),
        title: String(set.title || 'Blooket Set'),
        description: String(set.desc || 'Imported set'),
        source: 'Blooket-compatible API',
        questions: Array.isArray(set.questions) && set.questions.length
          ? set.questions.slice(0, 8).map((qq) => ({
              q: qq.question,
              answers: qq.answers,
              correct: qq.correctIndex || 0,
            }))
          : fallbackSets[0].questions,
      }));
    }
  } catch {
    remoteSets = [];
  }

  const localMatches = fallbackSets.filter((set) => !q || set.title.toLowerCase().includes(q) || set.description.toLowerCase().includes(q));
  return remoteSets.length ? remoteSets : localMatches;
}

function validateHostPayload(body) {
  if (!body || typeof body !== 'object') return 'Expected request body object.';
  if (!body.hostBlook?.name || !body.hostBlook?.imageUrl) return 'Host blook is required.';
  if (!body.setId) return 'Choose a game set first.';
  return null;
}

function validateJoinPayload(body) {
  if (!body || typeof body !== 'object') return 'Expected request body object.';
  if (!body.playerName || typeof body.playerName !== 'string') return 'Player name is required.';
  if (!body.blook?.name || !body.blook?.imageUrl) return 'Blook is required.';
  return null;
}

async function createHostedGoldQuest({ setId, hostBlook }) {
  const sets = await searchBlooketSets('');
  const selected = sets.find((s) => s.id === setId) || fallbackSets[0];
  let code;
  do code = randomCode(); while (games.has(code));

  const now = new Date().toISOString();
  const game = {
    code,
    hostPin: randomHostPin(),
    mode: 'Gold Quest',
    hostBlook,
    set: selected,
    state: 'lobby',
    createdAt: now,
    startedAt: null,
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
    players: game.players.map((p) => ({ playerId: p.playerId, playerName: p.playerName, blook: p.blook, gold: p.gold })),
  };
}

function routes(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname, searchParams } = requestUrl;

  if (req.method === 'GET' && pathname === '/') return sendText(res, 200, HTML_PAGE, 'text/html; charset=utf-8');
  if (req.method === 'GET' && pathname === '/api/blooks') return sendJson(res, 200, { blooks: blookCatalog });

  if (req.method === 'GET' && pathname === '/api/blooket/search') {
    searchBlooketSets(searchParams.get('q') || '').then((sets) => sendJson(res, 200, { sets }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/host') {
    parseBody(req)
      .then(async (body) => {
        const error = validateHostPayload(body);
        if (error) return sendJson(res, 400, { error });
        const game = await createHostedGoldQuest(body);
        sendJson(res, 201, { game: publicGame(game), message: 'Gold Quest lobby created.' });
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

        sendJson(res, 200, { correct, gained, totalGold: player.gold, nextQuestion: player.questionIndex });
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
<title>Greenit - Gold Quest</title>
<style>
body{margin:0;font-family:Inter,system-ui;background:radial-gradient(circle at top,#18316e,#0d142b 60%);color:#ecf2ff}
.wrap{max-width:1100px;margin:auto;padding:24px}
.card{background:#111a34;border:1px solid #2b3d73;border-radius:16px;padding:16px;box-shadow:0 10px 25px #0007}
.row{display:flex;gap:12px;flex-wrap:wrap}.hidden{display:none}
button{background:#3d68ff;color:#fff;border:0;padding:10px 14px;border-radius:10px;font-weight:700;cursor:pointer}
button.alt{background:#20315f}input{background:#0d1530;color:#fff;border:1px solid #2f4177;padding:10px;border-radius:10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.blook{padding:8px;border:1px solid #334d8f;border-radius:10px;cursor:pointer;text-align:center}
.blook img{height:58px}.status{min-height:24px;color:#9ec0ff}.player{display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid #2a3a6d}
.gold{color:#ffdf4d;font-weight:700}.answer{width:100%;text-align:left;margin:6px 0}
</style>
</head>
<body><div class="wrap">
<h1>🟩 Greenit Gold Quest</h1>
<div id="home" class="card"><p>Pick mode:</p><div class="row"><button id="goHost">Host</button><button id="goJoin" class="alt">Join</button></div></div>
<div id="host" class="card hidden"><h2>Host Setup</h2><div class="row"><button id="backFromHost" class="alt">Back</button></div>
<input id="searchSets" placeholder="Search Blooket sets"/><button id="runSearch">Search</button><div id="setResults"></div>
<h3>Choose host blook</h3><div id="hostBlookGrid" class="grid"></div><button id="createHostLobby">Create Lobby</button><p id="hostStatus" class="status"></p></div>
<div id="join" class="card hidden"><h2>Join Game</h2><button id="backFromJoin" class="alt">Back</button>
<div class="row"><input id="joinCode" placeholder="Code"/><input id="joinName" placeholder="Name"/></div>
<div id="joinBlookGrid" class="grid"></div><button id="joinLobby">Join</button><p id="joinStatus" class="status"></p></div>
<div id="lobby" class="card hidden"><h2>Host Lobby <span id="lobbyCode"></span></h2><p id="lobbyMeta"></p><div id="players"></div><button id="startGame">Start</button><button id="closeLobby" class="alt">Close</button><p id="startStatus" class="status"></p></div>
<div id="playerGame" class="card hidden"><h2>Player Panel</h2><p id="playerMeta"></p><div id="questionPanel"></div><p id="playerStatus" class="status"></p></div>
</div>
<script>
const views=['home','host','join','lobby','playerGame'];
let hostSelectedBlook=null,joinSelectedBlook=null,currentHostGameCode=null,lobbyPoll=null,playerPoll=null;
let currentPlayer={code:null,id:null,name:null}; let selectedSetId=null;
const hostStatus=document.getElementById('hostStatus');const joinStatus=document.getElementById('joinStatus');const startStatus=document.getElementById('startStatus');
function showView(v){views.forEach(id=>document.getElementById(id).classList.toggle('hidden',id!==v));}
async function api(url,opt){const r=await fetch(url,opt);const d=await r.json();if(!r.ok) throw new Error(d.error||'Request failed');return d;}
async function loadBlooks(){const data=await api('/api/blooks');for(const [id,onPick] of [['hostBlookGrid',b=>{hostSelectedBlook=b;hostStatus.textContent='Host blook: '+b.name;}],['joinBlookGrid',b=>{joinSelectedBlook=b;joinStatus.textContent='Join blook: '+b.name;}]]){const el=document.getElementById(id);el.innerHTML='';data.blooks.forEach(b=>{const c=document.createElement('div');c.className='blook';c.innerHTML='<img src="'+b.imageUrl+'"/><div>'+b.name+'</div>';c.onclick=()=>onPick(b);el.appendChild(c);});}}
async function searchSets(){const q=document.getElementById('searchSets').value.trim();const data=await api('/api/blooket/search?q='+encodeURIComponent(q));const box=document.getElementById('setResults');box.innerHTML='';data.sets.forEach(set=>{const row=document.createElement('div');row.className='player';row.innerHTML='<span>'+set.title+' <small>('+set.source+')</small></span><button>Select</button>';row.querySelector('button').onclick=()=>{selectedSetId=set.id;hostStatus.textContent='Selected set: '+set.title;};box.appendChild(row);});if(!data.sets.length) box.textContent='No sets found.';}
async function refreshLobby(){if(!currentHostGameCode)return;const data=await api('/api/games/'+currentHostGameCode+'/lobby');document.getElementById('lobbyCode').textContent=data.game.code;document.getElementById('lobbyMeta').textContent='Set: '+data.game.setTitle+' | Host PIN: '+data.game.hostPin+' | '+data.game.state;const p=document.getElementById('players');p.innerHTML='';data.game.players.forEach(pl=>{const row=document.createElement('div');row.className='player';row.innerHTML='<span>'+pl.playerName+' ('+pl.blook.name+')</span><span class="gold">'+pl.gold+' gold</span>';p.appendChild(row);});if(!data.game.players.length)p.innerHTML='<p>Waiting for players...</p>';if(data.game.state==='live')startStatus.textContent='Live! Gold updates in real-time.';}
async function refreshPlayer(){if(!currentPlayer.code||!currentPlayer.id)return;const data=await api('/api/games/'+currentPlayer.code+'/player/'+currentPlayer.id);document.getElementById('playerMeta').textContent=currentPlayer.name+' | Gold: '+(data.gold||0);const panel=document.getElementById('questionPanel');if(data.waiting){panel.innerHTML='<h3>Waiting for host to start...</h3>';return;}if(data.finished){panel.innerHTML='<h3>Done! Final gold: '+data.gold+'</h3>';return;}panel.innerHTML='<h3>Q'+(data.questionIndex+1)+': '+data.question.q+'</h3>';data.question.answers.forEach((a,i)=>{const b=document.createElement('button');b.className='answer';b.textContent=a;b.onclick=async()=>{const result=await api('/api/games/'+currentPlayer.code+'/player/'+currentPlayer.id+'/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answerIndex:i})});document.getElementById('playerStatus').textContent=result.correct?'✅ Correct! +'+result.gained+' gold':'❌ Wrong answer';await refreshPlayer();};panel.appendChild(b);});}

document.getElementById('goHost').onclick=()=>showView('host');document.getElementById('goJoin').onclick=()=>showView('join');document.getElementById('backFromHost').onclick=()=>showView('home');document.getElementById('backFromJoin').onclick=()=>showView('home');
document.getElementById('runSearch').onclick=searchSets;
document.getElementById('createHostLobby').onclick=async()=>{try{if(!hostSelectedBlook)throw new Error('Pick a host blook.');if(!selectedSetId)throw new Error('Search and select a set first.');const data=await api('/api/host',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({setId:selectedSetId,hostBlook:hostSelectedBlook})});currentHostGameCode=data.game.code;showView('lobby');startStatus.textContent='Lobby ready. Players will wait until you press start.';await refreshLobby();if(lobbyPoll)clearInterval(lobbyPoll);lobbyPoll=setInterval(refreshLobby,1500);}catch(e){hostStatus.textContent=e.message;}};
document.getElementById('joinLobby').onclick=async()=>{try{const code=document.getElementById('joinCode').value.trim().toUpperCase();const name=document.getElementById('joinName').value.trim();if(!joinSelectedBlook)throw new Error('Pick a blook to join.');const data=await api('/api/games/'+code+'/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerName:name,blook:joinSelectedBlook})});currentPlayer={code,id:data.player.playerId,name:data.player.playerName};showView('playerGame');joinStatus.textContent='';await refreshPlayer();if(playerPoll)clearInterval(playerPoll);playerPoll=setInterval(refreshPlayer,1200);}catch(e){joinStatus.textContent=e.message;}};
document.getElementById('startGame').onclick=async()=>{try{const data=await api('/api/games/'+currentHostGameCode+'/start',{method:'POST'});startStatus.textContent=data.message;await refreshLobby();}catch(e){startStatus.textContent=e.message;}};
document.getElementById('closeLobby').onclick=async()=>{if(!currentHostGameCode)return showView('home');await fetch('/api/games/'+currentHostGameCode,{method:'DELETE'});currentHostGameCode=null;if(lobbyPoll)clearInterval(lobbyPoll);showView('home');};
loadBlooks();searchSets();
</script></body></html>`;
