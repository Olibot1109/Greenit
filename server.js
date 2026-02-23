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

function createGame({ title, mode, blook }) {
  let code;
  do {
    code = randomCode();
  } while (games.has(code));

  const now = new Date().toISOString();
  const game = {
    code,
    title,
    mode,
    blook,
    createdAt: now,
    hostPin: Math.floor(1000 + Math.random() * 9000).toString(),
  };

  games.set(code, game);
  return game;
}

function validateGameInput(body) {
  if (!body || typeof body !== 'object') {
    return 'Expected request body object.';
  }

  const { title, mode, blook } = body;
  if (!title || typeof title !== 'string') {
    return 'Game title is required.';
  }
  if (!mode || typeof mode !== 'string') {
    return 'Mode is required.';
  }
  if (!blook || typeof blook !== 'object') {
    return 'Blook choice is required.';
  }
  if (!blook.name || typeof blook.name !== 'string') {
    return 'Blook name is required.';
  }
  if (!blook.imageUrl || typeof blook.imageUrl !== 'string') {
    return 'Blook image URL is required.';
  }

  return null;
}

function routes(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && requestUrl.pathname === '/') {
    sendText(res, 200, HTML_PAGE, 'text/html; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/blooks') {
    sendJson(res, 200, { blooks: blookCatalog });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/games') {
    sendJson(res, 200, { games: Array.from(games.values()) });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/games/')) {
    const code = requestUrl.pathname.split('/').pop().toUpperCase();
    const game = games.get(code);

    if (!game) {
      sendJson(res, 404, { error: 'Game not found' });
      return;
    }

    sendJson(res, 200, { game });
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/games') {
    parseBody(req)
      .then((body) => {
        const error = validateGameInput(body);
        if (error) {
          sendJson(res, 400, { error });
          return;
        }

        const game = createGame(body);
        sendJson(res, 201, { game, message: 'Greenit game created in memory.' });
      })
      .catch((error) => {
        sendJson(res, 400, { error: error.message || 'Unable to parse request' });
      });
    return;
  }

  if (req.method === 'DELETE' && requestUrl.pathname.startsWith('/api/games/')) {
    const code = requestUrl.pathname.split('/').pop().toUpperCase();
    const deleted = games.delete(code);
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
    <title>Greenit - Build Blook-Style Games</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f1b16;
        --card: #16271f;
        --green: #3ad972;
        --text: #e6fff0;
      }
      body {
        margin: 0;
        font-family: Arial, sans-serif;
        background: linear-gradient(180deg, #0d1914 0%, #09100d 100%);
        color: var(--text);
      }
      .container {
        max-width: 1000px;
        margin: 0 auto;
        padding: 20px;
      }
      h1 {
        margin-bottom: 8px;
      }
      .panel {
        background: var(--card);
        border: 1px solid #2d4b3b;
        border-radius: 12px;
        padding: 16px;
        margin-top: 16px;
      }
      input, select, button {
        border: 1px solid #355843;
        border-radius: 8px;
        background: #0f1b16;
        color: var(--text);
        padding: 10px;
        margin: 6px 0;
      }
      button {
        background: var(--green);
        color: #053219;
        font-weight: bold;
        cursor: pointer;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
        gap: 12px;
      }
      .blook-card {
        border: 1px solid #31503f;
        border-radius: 10px;
        padding: 10px;
      }
      .blook-card img {
        width: 100%;
        height: 120px;
        object-fit: contain;
        background: #101c17;
        border-radius: 8px;
      }
      .game {
        border-bottom: 1px solid #284434;
        padding: 8px 0;
      }
      .hint { opacity: 0.75; font-size: 14px; }
      .selected { outline: 2px solid var(--green); }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Greenit</h1>
      <p>Create Blook-style games fast. All data is stored in RAM and resets when the server restarts.</p>

      <div class="panel">
        <h2>1) Choose a blook</h2>
        <p class="hint">Pick a preset blook, or paste any blook image/name from Blooket manually.</p>
        <div id="blookGrid" class="grid"></div>
        <h3>Manual blook input (for any Blooket blook)</h3>
        <input id="manualName" placeholder="Blook name (e.g. Spooky Ghost)" />
        <input id="manualImage" placeholder="Blook image URL" />
        <button id="useManual">Use manual blook</button>
      </div>

      <div class="panel">
        <h2>2) Create game</h2>
        <input id="title" placeholder="Game title" value="Friday Review" />
        <select id="mode">
          <option value="Gold Quest">Gold Quest</option>
          <option value="Factory">Factory</option>
          <option value="Cafe">Cafe</option>
          <option value="Crypto Hack">Crypto Hack</option>
        </select>
        <button id="createGame">Create Greenit Game</button>
        <p id="status" class="hint">No game created yet.</p>
      </div>

      <div class="panel">
        <h2>Live games (RAM only)</h2>
        <div id="games"></div>
      </div>
    </div>

    <script>
      let selectedBlook = null;

      async function loadBlooks() {
        const res = await fetch('/api/blooks');
        const data = await res.json();
        const grid = document.getElementById('blookGrid');
        grid.innerHTML = '';

        data.blooks.forEach((blook) => {
          const card = document.createElement('button');
          card.className = 'blook-card';
          card.innerHTML = '<img src="' + blook.imageUrl + '" alt="' + blook.name + '"><strong>' + blook.name + '</strong><br><span class="hint">' + blook.rarity + '</span>';
          card.onclick = () => {
            selectedBlook = blook;
            document.querySelectorAll('.blook-card').forEach((x) => x.classList.remove('selected'));
            card.classList.add('selected');
          };
          grid.appendChild(card);
        });
      }

      async function loadGames() {
        const res = await fetch('/api/games');
        const data = await res.json();
        const games = document.getElementById('games');
        games.innerHTML = '';

        if (!data.games.length) {
          games.innerHTML = '<p class="hint">No games yet.</p>';
          return;
        }

        data.games.forEach((game) => {
          const row = document.createElement('div');
          row.className = 'game';
          row.innerHTML = '<strong>' + game.title + '</strong> (' + game.mode + ') · Code: <b>' + game.code + '</b> · Blook: ' + game.blook.name;
          games.appendChild(row);
        });
      }

      document.getElementById('useManual').onclick = () => {
        const name = document.getElementById('manualName').value.trim();
        const imageUrl = document.getElementById('manualImage').value.trim();

        if (!name || !imageUrl) {
          alert('Enter both a manual blook name and image URL.');
          return;
        }

        selectedBlook = { id: 'manual-' + Date.now(), name, imageUrl, rarity: 'Custom' };
        alert('Manual blook selected: ' + name);
      };

      document.getElementById('createGame').onclick = async () => {
        const title = document.getElementById('title').value.trim();
        const mode = document.getElementById('mode').value;

        if (!selectedBlook) {
          alert('Choose or enter a blook first.');
          return;
        }

        const res = await fetch('/api/games', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, mode, blook: selectedBlook })
        });

        const data = await res.json();
        if (res.ok) {
          document.getElementById('status').textContent =
            'Created! Code ' + data.game.code + ', host pin ' + data.game.hostPin + '.';
          loadGames();
        } else {
          document.getElementById('status').textContent = data.error;
        }
      };

      loadBlooks();
      loadGames();
    </script>
  </body>
</html>`;
