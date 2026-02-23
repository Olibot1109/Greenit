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
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function randomHostPin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function getSafeCodeFromPath(pathname) {
  const code = pathname.split('/').filter(Boolean).pop();
  if (!code) {
    return null;
  }
  return code.toUpperCase();
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
    mode: 'Gold Quest',
    hostBlook,
    state: 'lobby',
    createdAt: now,
    startedAt: null,
    players: [],
  };

  games.set(code, game);
  return game;
}

function validateHostPayload(body) {
  if (!body || typeof body !== 'object') return 'Expected request body object.';
  const { blooketUrl, hostBlook } = body;

  if (!blooketUrl || typeof blooketUrl !== 'string') return 'Blooket game URL is required.';
  if (!/^https?:\/\//i.test(blooketUrl)) return 'Blooket game URL must start with http:// or https://.';

  if (!hostBlook || typeof hostBlook !== 'object') return 'Host blook is required.';
  if (!hostBlook.name || typeof hostBlook.name !== 'string') return 'Host blook name is required.';
  if (!hostBlook.imageUrl || typeof hostBlook.imageUrl !== 'string') return 'Host blook image URL is required.';

  return null;
}

function validateJoinPayload(body) {
  if (!body || typeof body !== 'object') return 'Expected request body object.';
  const { playerName, blook } = body;

  if (!playerName || typeof playerName !== 'string') return 'Player name is required.';
  if (!blook || typeof blook !== 'object') return 'Blook is required.';
  if (!blook.name || typeof blook.name !== 'string') return 'Blook name is required.';
  if (!blook.imageUrl || typeof blook.imageUrl !== 'string') return 'Blook image URL is required.';

  return null;
}

function routes(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = requestUrl;

  if (req.method === 'GET' && pathname === '/') {
    sendText(res, 200, HTML_PAGE, 'text/html; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && pathname === '/api/blooks') {
    sendJson(res, 200, { blooks: blookCatalog });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/games') {
    sendJson(res, 200, { games: Array.from(games.values()) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/host') {
    parseBody(req)
      .then((body) => {
        const error = validateHostPayload(body);
        if (error) {
          sendJson(res, 400, { error });
          return;
        }

        const game = createHostedGoldQuest(body);
        sendJson(res, 201, { game, message: 'Gold Quest lobby created.' });
      })
      .catch((error) => {
        sendJson(res, 400, { error: error.message || 'Unable to parse request' });
      });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/games/') && pathname.endsWith('/lobby')) {
    const code = pathname.split('/')[3]?.toUpperCase();
    const game = code ? games.get(code) : null;

    if (!game) {
      sendJson(res, 404, { error: 'Game not found' });
      return;
    }

    sendJson(res, 200, { game });
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/games/') && pathname.endsWith('/join')) {
    const code = pathname.split('/')[3]?.toUpperCase();
    const game = code ? games.get(code) : null;

    if (!game) {
      sendJson(res, 404, { error: 'Game not found' });
      return;
    }

    if (game.state !== 'lobby') {
      sendJson(res, 400, { error: 'Game already started. Cannot join now.' });
      return;
    }

    parseBody(req)
      .then((body) => {
        const error = validateJoinPayload(body);
        if (error) {
          sendJson(res, 400, { error });
          return;
        }

        const nameTaken = game.players.some(
          (player) => player.playerName.toLowerCase() === body.playerName.trim().toLowerCase(),
        );

        if (nameTaken) {
          sendJson(res, 409, { error: 'Player name already in this lobby.' });
          return;
        }

        const player = {
          id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          playerName: body.playerName.trim(),
          blook: body.blook,
          joinedAt: new Date().toISOString(),
        };

        game.players.push(player);
        sendJson(res, 201, { player, gameCode: game.code, mode: game.mode });
      })
      .catch((error) => {
        sendJson(res, 400, { error: error.message || 'Unable to parse request' });
      });
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/games/') && pathname.endsWith('/start')) {
    const code = pathname.split('/')[3]?.toUpperCase();
    const game = code ? games.get(code) : null;

    if (!game) {
      sendJson(res, 404, { error: 'Game not found' });
      return;
    }

    if (game.state === 'live') {
      sendJson(res, 200, { game, message: 'Game already started.' });
      return;
    }

    game.state = 'live';
    game.startedAt = new Date().toISOString();

    sendJson(res, 200, {
      game,
      message: `Gold Quest started with ${game.players.length} player(s).`,
    });
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/games/')) {
    const code = getSafeCodeFromPath(pathname);
    const deleted = code ? games.delete(code) : false;

    if (!deleted) {
      sendJson(res, 404, { error: 'Game not found' });
      return;
    }

    sendJson(res, 200, { message: `Game ${code} deleted.` });
    return;
  }

  sendJson(res, 404, { error: 'Route not found' });
}

const server = http.createServer(routes);

server.listen(PORT, () => {
  console.log(`Greenit running at http://localhost:${PORT}`);
});

const HTML_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Greenit Host + Join (Gold Quest)</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f1b16;
        --panel: #16271f;
        --green: #3ad972;
        --text: #e6fff0;
        --muted: #9ec9b0;
      }
      body {
        margin: 0;
        font-family: Arial, sans-serif;
        background: linear-gradient(180deg, #0d1914 0%, #09100d 100%);
        color: var(--text);
      }
      .container {
        max-width: 1100px;
        margin: 0 auto;
        padding: 20px;
      }
      h1 { margin: 0 0 8px; }
      .panel {
        background: var(--panel);
        border: 1px solid #2d4b3b;
        border-radius: 12px;
        padding: 16px;
        margin-top: 16px;
      }
      .row { display: flex; gap: 12px; flex-wrap: wrap; }
      .grow { flex: 1 1 250px; }
      input, button {
        border: 1px solid #355843;
        border-radius: 8px;
        background: #0f1b16;
        color: var(--text);
        padding: 10px;
        margin: 6px 0;
        width: 100%;
        box-sizing: border-box;
      }
      button {
        background: var(--green);
        color: #053219;
        font-weight: bold;
        cursor: pointer;
        width: auto;
      }
      .ghost {
        background: transparent;
        color: var(--text);
        border: 1px solid #4f7b63;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 10px;
      }
      .blook-card {
        border: 1px solid #31503f;
        border-radius: 10px;
        padding: 10px;
        background: #13221b;
      }
      .blook-card img {
        width: 100%;
        height: 100px;
        object-fit: contain;
        background: #101c17;
        border-radius: 8px;
      }
      .selected { outline: 2px solid var(--green); }
      .hidden { display: none; }
      .hint { color: var(--muted); font-size: 14px; margin: 4px 0; }
      .join-code {
        font-size: 40px;
        letter-spacing: 6px;
        font-weight: 800;
        margin: 8px 0;
      }
      .player-list { margin-top: 12px; }
      .player {
        border-bottom: 1px solid #294636;
        padding: 8px 0;
        display: flex;
        justify-content: space-between;
      }
      .badge {
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid #4f7b63;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Greenit</h1>
      <p>Create a normal Gold Quest-style hosted lobby. Data is RAM-only and resets on restart.</p>

      <div id="homeView" class="panel">
        <h2>Choose mode</h2>
        <button id="goHost">Host</button>
        <button id="goJoin" class="ghost">Join</button>
      </div>

      <div id="hostView" class="panel hidden">
        <h2>Host Gold Quest</h2>
        <p class="hint">Paste a Blooket game URL, choose your blook, then create your host lobby.</p>
        <input id="hostUrl" placeholder="https://play.blooket.com/play?id=..." />

        <h3>Host blook</h3>
        <div id="hostBlookGrid" class="grid"></div>
        <input id="manualName" placeholder="Manual blook name (optional)" />
        <input id="manualImage" placeholder="Manual blook image URL (optional)" />
        <div class="row">
          <button id="useManualHost">Use manual host blook</button>
          <button id="createHostLobby">Create Host Lobby</button>
          <button id="backFromHost" class="ghost">Back</button>
        </div>
        <p id="hostStatus" class="hint">Not hosting yet.</p>
      </div>

      <div id="joinView" class="panel hidden">
        <h2>Join a lobby</h2>
        <div class="row">
          <div class="grow">
            <input id="joinCode" placeholder="Enter join code" />
          </div>
          <div class="grow">
            <input id="joinName" placeholder="Enter player name" />
          </div>
        </div>

        <h3>Choose blook to join</h3>
        <div id="joinBlookGrid" class="grid"></div>
        <input id="manualJoinName" placeholder="Manual blook name (optional)" />
        <input id="manualJoinImage" placeholder="Manual blook image URL (optional)" />

        <div class="row">
          <button id="useManualJoin">Use manual join blook</button>
          <button id="joinLobby">Join Lobby</button>
          <button id="backFromJoin" class="ghost">Back</button>
        </div>
        <p id="joinStatus" class="hint">Not joined yet.</p>
      </div>

      <div id="lobbyView" class="panel hidden">
        <h2>Host Lobby</h2>
        <div class="badge">Mode: Gold Quest</div>
        <p class="hint">Code for players to join:</p>
        <div id="lobbyCode" class="join-code">------</div>
        <p id="lobbyMeta" class="hint"></p>

        <div class="row">
          <button id="startGame">Start</button>
          <button id="closeLobby" class="ghost">Close Lobby</button>
        </div>

        <h3>Players joining</h3>
        <div id="players" class="player-list"></div>
        <p id="startStatus" class="hint"></p>
      </div>
    </div>

    <script>
      const views = {
        home: document.getElementById('homeView'),
        host: document.getElementById('hostView'),
        join: document.getElementById('joinView'),
        lobby: document.getElementById('lobbyView')
      };

      const hostStatus = document.getElementById('hostStatus');
      const joinStatus = document.getElementById('joinStatus');
      const startStatus = document.getElementById('startStatus');

      let hostSelectedBlook = null;
      let joinSelectedBlook = null;
      let currentHostGameCode = null;
      let lobbyPoll = null;

      function showView(name) {
        Object.values(views).forEach((x) => x.classList.add('hidden'));
        views[name].classList.remove('hidden');
      }

      function renderBlooks(targetId, onSelect) {
        return fetch('/api/blooks')
          .then((res) => res.json())
          .then((data) => {
            const grid = document.getElementById(targetId);
            grid.innerHTML = '';
            data.blooks.forEach((blook) => {
              const card = document.createElement('button');
              card.className = 'blook-card';
              card.innerHTML = '<img src="' + blook.imageUrl + '" alt="' + blook.name + '"><strong>' + blook.name + '</strong><br><span class="hint">' + blook.rarity + '</span>';
              card.onclick = () => {
                onSelect(blook);
                grid.querySelectorAll('.blook-card').forEach((x) => x.classList.remove('selected'));
                card.classList.add('selected');
              };
              grid.appendChild(card);
            });
          });
      }

      function readManualBlook(nameId, imageId) {
        const name = document.getElementById(nameId).value.trim();
        const imageUrl = document.getElementById(imageId).value.trim();
        if (!name || !imageUrl) {
          return null;
        }
        return { id: 'manual-' + Date.now(), name, imageUrl, rarity: 'Custom' };
      }

      async function refreshLobby() {
        if (!currentHostGameCode) return;
        const res = await fetch('/api/games/' + currentHostGameCode + '/lobby');
        const data = await res.json();

        if (!res.ok) {
          startStatus.textContent = data.error || 'Could not load lobby.';
          return;
        }

        const game = data.game;
        document.getElementById('lobbyCode').textContent = game.code;
        document.getElementById('lobbyMeta').textContent =
          'Blooket URL: ' + game.blooketUrl + ' | Host PIN: ' + game.hostPin + ' | State: ' + game.state;

        const players = document.getElementById('players');
        players.innerHTML = '';

        if (!game.players.length) {
          players.innerHTML = '<p class="hint">Waiting for players to join...</p>';
        } else {
          game.players.forEach((player) => {
            const row = document.createElement('div');
            row.className = 'player';
            row.innerHTML = '<span>' + player.playerName + '</span><span>' + player.blook.name + '</span>';
            players.appendChild(row);
          });
        }

        if (game.state === 'live') {
          startStatus.textContent = 'Gold Quest is LIVE!';
        }
      }

      document.getElementById('goHost').onclick = () => {
        showView('host');
      };

      document.getElementById('goJoin').onclick = () => {
        showView('join');
      };

      document.getElementById('backFromHost').onclick = () => {
        showView('home');
      };

      document.getElementById('backFromJoin').onclick = () => {
        showView('home');
      };

      document.getElementById('useManualHost').onclick = () => {
        const blook = readManualBlook('manualName', 'manualImage');
        if (!blook) {
          hostStatus.textContent = 'Manual host blook needs both name + image URL.';
          return;
        }
        hostSelectedBlook = blook;
        hostStatus.textContent = 'Manual host blook selected: ' + blook.name;
      };

      document.getElementById('useManualJoin').onclick = () => {
        const blook = readManualBlook('manualJoinName', 'manualJoinImage');
        if (!blook) {
          joinStatus.textContent = 'Manual join blook needs both name + image URL.';
          return;
        }
        joinSelectedBlook = blook;
        joinStatus.textContent = 'Manual join blook selected: ' + blook.name;
      };

      document.getElementById('createHostLobby').onclick = async () => {
        const blooketUrl = document.getElementById('hostUrl').value.trim();

        if (!hostSelectedBlook) {
          hostStatus.textContent = 'Choose or enter a host blook first.';
          return;
        }

        const res = await fetch('/api/host', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blooketUrl, hostBlook: hostSelectedBlook })
        });

        const data = await res.json();
        if (!res.ok) {
          hostStatus.textContent = data.error || 'Could not create lobby.';
          return;
        }

        currentHostGameCode = data.game.code;
        showView('lobby');
        startStatus.textContent = 'Lobby ready. Waiting for players...';
        await refreshLobby();

        if (lobbyPoll) clearInterval(lobbyPoll);
        lobbyPoll = setInterval(refreshLobby, 2000);
      };

      document.getElementById('joinLobby').onclick = async () => {
        const code = document.getElementById('joinCode').value.trim().toUpperCase();
        const playerName = document.getElementById('joinName').value.trim();

        if (!code) {
          joinStatus.textContent = 'Enter a join code.';
          return;
        }
        if (!playerName) {
          joinStatus.textContent = 'Enter a player name.';
          return;
        }
        if (!joinSelectedBlook) {
          joinStatus.textContent = 'Choose or enter a blook to join.';
          return;
        }

        const res = await fetch('/api/games/' + code + '/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerName, blook: joinSelectedBlook })
        });

        const data = await res.json();
        if (!res.ok) {
          joinStatus.textContent = data.error || 'Join failed.';
          return;
        }

        joinStatus.textContent = 'Joined ' + data.gameCode + ' as ' + data.player.playerName + ' for Gold Quest.';
      };

      document.getElementById('startGame').onclick = async () => {
        if (!currentHostGameCode) return;

        const res = await fetch('/api/games/' + currentHostGameCode + '/start', {
          method: 'POST'
        });
        const data = await res.json();

        if (!res.ok) {
          startStatus.textContent = data.error || 'Could not start game.';
          return;
        }

        startStatus.textContent = data.message;
        await refreshLobby();
      };

      document.getElementById('closeLobby').onclick = async () => {
        if (!currentHostGameCode) {
          showView('home');
          return;
        }

        await fetch('/api/games/' + currentHostGameCode, { method: 'DELETE' });
        currentHostGameCode = null;
        if (lobbyPoll) {
          clearInterval(lobbyPoll);
          lobbyPoll = null;
        }
        startStatus.textContent = '';
        showView('home');
      };

      renderBlooks('hostBlookGrid', (blook) => {
        hostSelectedBlook = blook;
        hostStatus.textContent = 'Host blook selected: ' + blook.name;
      });

      renderBlooks('joinBlookGrid', (blook) => {
        joinSelectedBlook = blook;
        joinStatus.textContent = 'Join blook selected: ' + blook.name;
      });
    </script>
  </body>
</html>`;
