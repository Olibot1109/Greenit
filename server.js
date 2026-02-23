const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;

const blookCatalog = [
  { id: 'chick', name: 'Chick', rarity: 'Common', imageUrl: 'https://ac.blooket.com/dashboard/blooks/chick.svg' },
  { id: 'fox', name: 'Fox', rarity: 'Common', imageUrl: 'https://ac.blooket.com/dashboard/blooks/fox.svg' },
  { id: 'frog', name: 'Frog', rarity: 'Common', imageUrl: 'https://ac.blooket.com/dashboard/blooks/frog.svg' },
  { id: 'unicorn', name: 'Unicorn', rarity: 'Rare', imageUrl: 'https://ac.blooket.com/dashboard/blooks/unicorn.svg' },
  { id: 'astronaut', name: 'Astronaut', rarity: 'Epic', imageUrl: 'https://ac.blooket.com/dashboard/blooks/astronaut.svg' },
];

const questionBank = [
  { prompt: 'What is 5 + 7?', choices: ['10', '11', '12', '13'], correctIndex: 2 },
  { prompt: 'Which planet is known as the Red Planet?', choices: ['Mars', 'Earth', 'Jupiter', 'Venus'], correctIndex: 0 },
  { prompt: 'What color do blue and yellow make?', choices: ['Purple', 'Green', 'Orange', 'Red'], correctIndex: 1 },
  { prompt: 'How many sides does a triangle have?', choices: ['2', '3', '4', '5'], correctIndex: 1 },
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
      if (!body) {
        resolve({});
        return;
      }
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

function randomGoldReward() {
  return Math.floor(8 + Math.random() * 8);
}

function publicQuestion(question) {
  return {
    prompt: question.prompt,
    choices: question.choices,
  };
}

function sanitizeGameForHost(game) {
  return {
    code: game.code,
    hostPin: game.hostPin,
    blooketUrl: game.blooketUrl,
    mode: game.mode,
    state: game.state,
    createdAt: game.createdAt,
    startedAt: game.startedAt,
    currentQuestionIndex: game.currentQuestionIndex,
    totalQuestions: game.questions.length,
    currentQuestion: game.questions[game.currentQuestionIndex] ? publicQuestion(game.questions[game.currentQuestionIndex]) : null,
    players: game.players.map((player) => ({
      id: player.id,
      playerName: player.playerName,
      blook: player.blook,
      joinedAt: player.joinedAt,
      gold: player.gold,
      answeredCurrent: Boolean(game.roundAnswers[player.id]),
    })),
  };
}

function createHostedGoldQuest({ blooketUrl, hostBlook }) {
  let code;
  do {
    code = randomCode();
  } while (games.has(code));

  const now = new Date().toISOString();
  const game = {
    code,
    hostPin: randomHostPin(),
    blooketUrl,
    hostBlook,
    mode: 'Gold Quest',
    state: 'lobby',
    createdAt: now,
    startedAt: null,
    currentQuestionIndex: 0,
    questions: questionBank,
    roundAnswers: {},
    players: [],
  };

  games.set(code, game);
  return game;
}

function validateHostPayload(body) {
  if (!body || typeof body !== 'object') return 'Expected request body object.';
  if (!body.blooketUrl || typeof body.blooketUrl !== 'string') return 'Blooket game URL is required.';
  if (!/^https?:\/\//i.test(body.blooketUrl)) return 'Blooket game URL must start with http:// or https://.';
  if (!body.hostBlook || typeof body.hostBlook !== 'object') return 'Host blook is required.';
  if (!body.hostBlook.name || typeof body.hostBlook.name !== 'string') return 'Host blook name is required.';
  if (!body.hostBlook.imageUrl || typeof body.hostBlook.imageUrl !== 'string') return 'Host blook image URL is required.';
  return null;
}

function validateJoinPayload(body) {
  if (!body || typeof body !== 'object') return 'Expected request body object.';
  if (!body.playerName || typeof body.playerName !== 'string') return 'Player name is required.';
  if (!body.blook || typeof body.blook !== 'object') return 'Blook is required.';
  if (!body.blook.name || typeof body.blook.name !== 'string') return 'Blook name is required.';
  if (!body.blook.imageUrl || typeof body.blook.imageUrl !== 'string') return 'Blook image URL is required.';
  return null;
}

function findGame(code) {
  return code ? games.get(code.toUpperCase()) : null;
}

function routes(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parts = requestUrl.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && requestUrl.pathname === '/') return sendText(res, 200, HTML_PAGE, 'text/html; charset=utf-8');
  if (req.method === 'GET' && requestUrl.pathname === '/api/blooks') return sendJson(res, 200, { blooks: blookCatalog });

  if (req.method === 'POST' && requestUrl.pathname === '/api/host') {
    return parseBody(req)
      .then((body) => {
        const error = validateHostPayload(body);
        if (error) return sendJson(res, 400, { error });
        const game = createHostedGoldQuest(body);
        return sendJson(res, 201, { game: sanitizeGameForHost(game), message: 'Gold Quest lobby created.' });
      })
      .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'games' && parts[3] === 'lobby') {
    const game = findGame(parts[2]);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    return sendJson(res, 200, { game: sanitizeGameForHost(game) });
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'games' && parts[3] === 'join') {
    const game = findGame(parts[2]);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    if (game.state !== 'lobby') return sendJson(res, 400, { error: 'Game already started. Cannot join now.' });

    return parseBody(req)
      .then((body) => {
        const error = validateJoinPayload(body);
        if (error) return sendJson(res, 400, { error });
        const nameTaken = game.players.some((p) => p.playerName.toLowerCase() === body.playerName.trim().toLowerCase());
        if (nameTaken) return sendJson(res, 409, { error: 'Player name already in this lobby.' });

        const player = {
          id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          playerName: body.playerName.trim(),
          blook: body.blook,
          joinedAt: new Date().toISOString(),
          gold: 0,
        };
        game.players.push(player);

        return sendJson(res, 201, {
          player,
          gameCode: game.code,
          state: game.state,
          message: 'Joined lobby. Waiting for host to start.',
        });
      })
      .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'games' && parts[3] === 'player' && parts[5] === 'state') {
    const game = findGame(parts[2]);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    const player = game.players.find((p) => p.id === parts[4]);
    if (!player) return sendJson(res, 404, { error: 'Player not found' });

    const question = game.questions[game.currentQuestionIndex] || null;
    const answered = Boolean(game.roundAnswers[player.id]);
    return sendJson(res, 200, {
      state: game.state,
      gold: player.gold,
      currentQuestionIndex: game.currentQuestionIndex,
      totalQuestions: game.questions.length,
      question: game.state === 'live' && question ? publicQuestion(question) : null,
      answeredCurrent: answered,
      finished: game.state === 'ended',
    });
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'games' && parts[3] === 'player' && parts[5] === 'answer') {
    const game = findGame(parts[2]);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    const player = game.players.find((p) => p.id === parts[4]);
    if (!player) return sendJson(res, 404, { error: 'Player not found' });
    if (game.state !== 'live') return sendJson(res, 400, { error: 'Game has not started yet.' });
    if (game.roundAnswers[player.id]) return sendJson(res, 409, { error: 'Already answered this question.' });

    return parseBody(req)
      .then((body) => {
        if (typeof body.answerIndex !== 'number') return sendJson(res, 400, { error: 'answerIndex must be a number.' });
        const question = game.questions[game.currentQuestionIndex];
        if (!question) return sendJson(res, 400, { error: 'No active question.' });

        const correct = body.answerIndex === question.correctIndex;
        const earned = correct ? randomGoldReward() : 0;
        player.gold += earned;
        game.roundAnswers[player.id] = {
          questionIndex: game.currentQuestionIndex,
          correct,
          earned,
          answerIndex: body.answerIndex,
        };

        return sendJson(res, 200, {
          correct,
          earned,
          gold: player.gold,
          message: correct ? `Correct! +${earned} gold.` : 'Incorrect. +0 gold.',
        });
      })
      .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'games' && parts[3] === 'start') {
    const game = findGame(parts[2]);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    if (game.state !== 'lobby') return sendJson(res, 200, { game: sanitizeGameForHost(game), message: 'Game already started.' });
    game.state = 'live';
    game.startedAt = new Date().toISOString();
    game.roundAnswers = {};
    return sendJson(res, 200, { game: sanitizeGameForHost(game), message: 'Gold Quest started. Question 1 is live.' });
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'games' && parts[3] === 'next') {
    const game = findGame(parts[2]);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    if (game.state !== 'live') return sendJson(res, 400, { error: 'Game is not live.' });

    game.currentQuestionIndex += 1;
    if (game.currentQuestionIndex >= game.questions.length) {
      game.currentQuestionIndex = game.questions.length;
      game.state = 'ended';
      return sendJson(res, 200, { game: sanitizeGameForHost(game), message: 'Game ended. Final gold shown.' });
    }

    game.roundAnswers = {};
    return sendJson(res, 200, { game: sanitizeGameForHost(game), message: `Moved to question ${game.currentQuestionIndex + 1}.` });
  }

  if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'games' && parts[2]) {
    const code = parts[2].toUpperCase();
    const deleted = games.delete(code);
    if (!deleted) return sendJson(res, 404, { error: 'Game not found' });
    return sendJson(res, 200, { message: `Game ${code} deleted.` });
  }

  return sendJson(res, 404, { error: 'Route not found' });
}

const server = http.createServer(routes);
server.listen(PORT, () => console.log(`Greenit running at http://localhost:${PORT}`));

const HTML_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Greenit Gold Quest</title>
<style>
:root { color-scheme: dark; --bg:#0f1b16; --panel:#16271f; --green:#3ad972; --text:#e6fff0; --muted:#9ec9b0; }
body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(180deg,#0d1914 0%,#09100d 100%);color:var(--text)}
.container{max-width:1100px;margin:0 auto;padding:20px}
.panel{background:var(--panel);border:1px solid #2d4b3b;border-radius:12px;padding:16px;margin-top:16px}
button,input{border:1px solid #355843;border-radius:8px;background:#0f1b16;color:var(--text);padding:10px;margin:6px 0}
button{background:var(--green);color:#053219;font-weight:bold;cursor:pointer}
.ghost{background:transparent;color:var(--text);border:1px solid #4f7b63}
.hidden{display:none}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.blook-card{border:1px solid #31503f;border-radius:10px;padding:10px;background:#13221b}
.blook-card img{width:100%;height:90px;object-fit:contain;background:#101c17;border-radius:8px}
.selected{outline:2px solid var(--green)}
.player{display:flex;justify-content:space-between;border-bottom:1px solid #294636;padding:8px 0}
.hint{color:var(--muted);font-size:14px}.question{font-size:20px;font-weight:700;margin:10px 0}
.choice{display:block;width:100%;text-align:left}
</style>
</head>
<body>
<div class="container">
  <h1>Greenit</h1>
  <p>Host and play Gold Quest-style in RAM only.</p>

  <div id="homeView" class="panel">
    <button id="goHost">Host</button>
    <button id="goJoin" class="ghost">Join</button>
  </div>

  <div id="hostView" class="panel hidden">
    <h2>Host Lobby</h2>
    <input id="hostUrl" placeholder="Paste Blooket URL" />
    <div id="hostBlookGrid" class="grid"></div>
    <button id="createHostLobby">Create Lobby</button>
    <button id="backFromHost" class="ghost">Back</button>
    <p id="hostStatus" class="hint"></p>
  </div>

  <div id="joinView" class="panel hidden">
    <h2>Join</h2>
    <input id="joinCode" placeholder="Game code" />
    <input id="joinName" placeholder="Player name" />
    <div id="joinBlookGrid" class="grid"></div>
    <button id="joinLobby">Join Lobby</button>
    <button id="backFromJoin" class="ghost">Back</button>
    <p id="joinStatus" class="hint"></p>
  </div>

  <div id="hostLobbyView" class="panel hidden">
    <h2>Host Screen</h2>
    <p id="hostLobbyMeta" class="hint"></p>
    <button id="startGame">Start</button>
    <button id="nextQuestion">Next Question</button>
    <button id="closeLobby" class="ghost">Close Lobby</button>
    <div id="hostQuestion" class="question"></div>
    <h3>Players / Gold</h3>
    <div id="hostPlayers"></div>
  </div>

  <div id="playerView" class="panel hidden">
    <h2>Player</h2>
    <p id="playerMeta" class="hint"></p>
    <div id="playerQuestion" class="question"></div>
    <div id="playerChoices"></div>
    <p id="playerStatus" class="hint">Waiting for host to start...</p>
  </div>
</div>

<script>
const views={home:homeView,host:hostView,join:joinView,hostLobby:hostLobbyView,player:playerView};
const hostStatus=document.getElementById('hostStatus');
const joinStatus=document.getElementById('joinStatus');
let hostSelectedBlook=null, joinSelectedBlook=null;
let currentHostGameCode=null, hostPoll=null;
let playerSession={gameCode:null,playerId:null,playerName:null}, playerPoll=null, lastQuestion=-1;

function showView(name){Object.values(views).forEach(v=>v.classList.add('hidden'));views[name].classList.remove('hidden');}
function renderBlooks(targetId,onSelect){fetch('/api/blooks').then(r=>r.json()).then(data=>{const grid=document.getElementById(targetId);grid.innerHTML='';data.blooks.forEach(b=>{const c=document.createElement('button');c.className='blook-card';c.innerHTML='<img src="'+b.imageUrl+'"><div>'+b.name+'</div>';c.onclick=()=>{onSelect(b);grid.querySelectorAll('.blook-card').forEach(x=>x.classList.remove('selected'));c.classList.add('selected');};grid.appendChild(c);});});}

async function refreshHostLobby(){
  if(!currentHostGameCode)return;
  const res=await fetch('/api/games/'+currentHostGameCode+'/lobby'); const data=await res.json(); if(!res.ok)return;
  const game=data.game;
  document.getElementById('hostLobbyMeta').textContent='Code: '+game.code+' | State: '+game.state+' | Question '+(game.currentQuestionIndex+1)+'/'+game.totalQuestions;
  const question = game.currentQuestion ? game.currentQuestion.prompt : (game.state==='ended'?'Game ended':'Waiting to start');
  document.getElementById('hostQuestion').textContent = question;
  const list=document.getElementById('hostPlayers'); list.innerHTML='';
  if(!game.players.length){ list.innerHTML='<p class="hint">No players yet.</p>'; return; }
  game.players.forEach(p=>{const row=document.createElement('div');row.className='player';row.innerHTML='<span>'+p.playerName+(p.answeredCurrent?' ✅':'')+'</span><span>'+p.gold+' gold</span>';list.appendChild(row);});
}

async function refreshPlayerState(){
  if(!playerSession.gameCode||!playerSession.playerId)return;
  const res=await fetch('/api/games/'+playerSession.gameCode+'/player/'+playerSession.playerId+'/state');
  const data=await res.json();
  if(!res.ok){document.getElementById('playerStatus').textContent=data.error||'Error';return;}
  document.getElementById('playerMeta').textContent='Player: '+playerSession.playerName+' | Gold: '+data.gold;
  if(data.state==='lobby'){
    document.getElementById('playerQuestion').textContent='Waiting Room';
    document.getElementById('playerChoices').innerHTML='';
    document.getElementById('playerStatus').textContent='Waiting for host to start...';
    return;
  }
  if(data.state==='ended'){
    document.getElementById('playerQuestion').textContent='Game finished!';
    document.getElementById('playerChoices').innerHTML='';
    document.getElementById('playerStatus').textContent='Final gold: '+data.gold;
    return;
  }

  if(data.question){
    if(lastQuestion!==data.currentQuestionIndex){
      lastQuestion=data.currentQuestionIndex;
      document.getElementById('playerStatus').textContent='Answer now!';
    }
    document.getElementById('playerQuestion').textContent=data.question.prompt;
    const choices=document.getElementById('playerChoices'); choices.innerHTML='';
    data.question.choices.forEach((choice,idx)=>{const b=document.createElement('button');b.className='choice';b.textContent=choice;b.disabled=data.answeredCurrent;b.onclick=async()=>{const r=await fetch('/api/games/'+playerSession.gameCode+'/player/'+playerSession.playerId+'/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answerIndex:idx})});const d=await r.json();document.getElementById('playerStatus').textContent=d.message||d.error;await refreshPlayerState();};choices.appendChild(b);});
  }
}

goHost.onclick=()=>showView('host');
goJoin.onclick=()=>showView('join');
backFromHost.onclick=()=>showView('home');
backFromJoin.onclick=()=>showView('home');

createHostLobby.onclick=async()=>{
  if(!hostSelectedBlook){hostStatus.textContent='Pick a host blook.';return;}
  const res=await fetch('/api/host',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({blooketUrl:hostUrl.value.trim(),hostBlook:hostSelectedBlook})});
  const data=await res.json(); if(!res.ok){hostStatus.textContent=data.error||'Failed';return;}
  currentHostGameCode=data.game.code; showView('hostLobby'); await refreshHostLobby();
  if(hostPoll)clearInterval(hostPoll); hostPoll=setInterval(refreshHostLobby,1500);
};

joinLobby.onclick=async()=>{
  if(!joinSelectedBlook){joinStatus.textContent='Pick a blook.';return;}
  const code=joinCode.value.trim().toUpperCase(); const playerName=joinName.value.trim();
  const res=await fetch('/api/games/'+code+'/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerName,blook:joinSelectedBlook})});
  const data=await res.json(); if(!res.ok){joinStatus.textContent=data.error||'Join failed';return;}
  playerSession={gameCode:data.gameCode,playerId:data.player.id,playerName:data.player.playerName};
  showView('player');
  if(playerPoll)clearInterval(playerPoll); playerPoll=setInterval(refreshPlayerState,1200);
  await refreshPlayerState();
};

startGame.onclick=async()=>{if(!currentHostGameCode)return; await fetch('/api/games/'+currentHostGameCode+'/start',{method:'POST'}); await refreshHostLobby();};
nextQuestion.onclick=async()=>{if(!currentHostGameCode)return; const res=await fetch('/api/games/'+currentHostGameCode+'/next',{method:'POST'}); const data=await res.json(); document.getElementById('hostQuestion').textContent=data.message||''; await refreshHostLobby();};
closeLobby.onclick=async()=>{if(currentHostGameCode)await fetch('/api/games/'+currentHostGameCode,{method:'DELETE'}); currentHostGameCode=null; if(hostPoll)clearInterval(hostPoll); showView('home');};

renderBlooks('hostBlookGrid',(b)=>{hostSelectedBlook=b;hostStatus.textContent='Host blook: '+b.name;});
renderBlooks('joinBlookGrid',(b)=>{joinSelectedBlook=b;joinStatus.textContent='Join blook: '+b.name;});
</script>
</body>
</html>`;
