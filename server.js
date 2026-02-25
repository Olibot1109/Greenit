const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const CUSTOM_GAMES_FILE = path.join(__dirname, 'custom_games.json');

// ─── Blook catalog ────────────────────────────────────────────────────────────
const blookCatalog = [
  { id: 'chick', name: 'Chick',  rarity: 'Common', imageUrl: 'https://greenit-aqfd.onrender.com/Blooket/IMG_1282.webp' },
  { id: 'cow',   name: 'Cow',   rarity: 'Common', imageUrl: 'https://greenit-aqfd.onrender.com/Blooket/IMG_1283.webp' },
  { id: 'goat',  name: 'Goat',  rarity: 'Common', imageUrl: 'https://greenit-aqfd.onrender.com/Blooket/IMG_1284.webp' },
  { id: 'horse', name: 'Horse', rarity: 'Common', imageUrl: 'https://greenit-aqfd.onrender.com/Blooket/IMG_1285.webp' },
  { id: 'duck',  name: 'Duck',  rarity: 'Epic',   imageUrl: 'https://greenit-aqfd.onrender.com/Blooket/IMG_1286.webp' },
];

// ─── Built-in fallback sets ────────────────────────────────────────────────────
const fallbackSets = [
  {
    id: 'classic-geo',
    title: 'World Geography Sprint',
    description: 'Fast geography facts',
    source: 'Built-in',
    questions: [
      { q: 'What is the capital of Japan?',               answers: ['Tokyo','Kyoto','Osaka','Nagoya'],            correct: 0 },
      { q: 'Which continent is Kenya in?',                answers: ['Europe','Asia','Africa','South America'],    correct: 2 },
      { q: 'Mount Everest is in which mountain range?',   answers: ['Andes','Himalayas','Alps','Rockies'],        correct: 1 },
    ],
  },
  {
    id: 'classic-science',
    title: 'Quick Science Check',
    description: 'General science review',
    source: 'Built-in',
    questions: [
      { q: 'Water boils at what temperature (°C)?', answers: ['90','95','100','120'],                      correct: 2 },
      { q: 'What planet is known as the red planet?', answers: ['Venus','Mars','Saturn','Mercury'],        correct: 1 },
      { q: 'Humans breathe in which gas?',           answers: ['Carbon dioxide','Nitrogen','Oxygen','Hydrogen'], correct: 2 },
    ],
  },
];

// ─── Custom games persistence ──────────────────────────────────────────────────
function loadCustomGames() {
  try {
    if (fs.existsSync(CUSTOM_GAMES_FILE)) {
      return JSON.parse(fs.readFileSync(CUSTOM_GAMES_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return [];
}

function saveCustomGames(sets) {
  try { fs.writeFileSync(CUSTOM_GAMES_FILE, JSON.stringify(sets, null, 2)); } catch { /* ignore */ }
}

let customSets = loadCustomGames();

// ─── Active game sessions ──────────────────────────────────────────────────────
const games = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function sendText(res, code, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 2_000_000) { req.destroy(); reject(new Error('Body too large')); } });
    req.on('end', () => { if (!body) return resolve({}); try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function randomCode() {
  let c = ''; for (let i = 0; i < 6; i++) c += Math.floor(Math.random() * 10); return c;
}
function randomHostPin() { return Math.floor(1000 + Math.random() * 9000).toString(); }
function randomId()      { return Math.random().toString(36).slice(2, 10); }

// ─── Open Trivia DB integration ───────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'greenit/2.0' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Not JSON')); } });
    }).on('error', reject);
  });
}

// Decode HTML entities from Open Trivia DB
function decodeHtml(str) {
  return String(str)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"').replace(/&lsquo;/g, "'").replace(/&rsquo;/g, "'");
}

const OTDB_CATEGORIES = [
  { id: 9,  name: 'General Knowledge' }, { id: 10, name: 'Books' },
  { id: 11, name: 'Film' },             { id: 12, name: 'Music' },
  { id: 14, name: 'Television' },       { id: 15, name: 'Video Games' },
  { id: 17, name: 'Science & Nature' }, { id: 18, name: 'Computers' },
  { id: 19, name: 'Mathematics' },      { id: 20, name: 'Mythology' },
  { id: 21, name: 'Sports' },           { id: 22, name: 'Geography' },
  { id: 23, name: 'History' },          { id: 27, name: 'Animals' },
];

async function searchQuizSets(query) {
  const q = String(query || '').trim().toLowerCase();
  let remoteSets = [];

  try {
    // Match query to a category
    const cat = OTDB_CATEGORIES.find(c => c.name.toLowerCase().includes(q)) || OTDB_CATEGORIES[0];
    const url = `https://opentdb.com/api.php?amount=8&category=${cat.id}&type=multiple`;
    const data = await fetchJson(url);

    if (data.response_code === 0 && Array.isArray(data.results)) {
      const setId = `otdb-${cat.id}-${Date.now()}`;
      remoteSets = [{
        id: setId,
        title: `${cat.name} Quiz`,
        description: `${data.results.length} questions from Open Trivia DB`,
        source: 'Open Trivia DB',
        questions: data.results.map(r => {
          const wrong = r.incorrect_answers.map(decodeHtml);
          const right = decodeHtml(r.correct_answer);
          const answers = [...wrong, right].sort(() => Math.random() - 0.5);
          return {
            q: decodeHtml(r.question),
            answers,
            correct: answers.indexOf(right),
          };
        }),
      }];
    }
  } catch { remoteSets = []; }

  // Also include matching custom sets
  const matchingCustom = customSets.filter(s =>
    !q || s.title.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)
  );

  const localMatches = fallbackSets.filter(s =>
    !q || s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  );

  return [...matchingCustom, ...remoteSets, ...localMatches];
}

// ─── Game helpers ──────────────────────────────────────────────────────────────
function validateHostPayload(body) {
  if (!body?.hostBlook?.name || !body.hostBlook?.imageUrl) return 'Host blook is required.';
  if (!body.setId) return 'Choose a game set first.';
  return null;
}

function validateJoinPayload(body) {
  if (!body?.playerName || typeof body.playerName !== 'string') return 'Player name is required.';
  if (!body.blook?.name || !body.blook?.imageUrl) return 'Blook is required.';
  return null;
}

async function createHostedGoldQuest({ setId, hostBlook }) {
  const sets = await searchQuizSets('');
  // Also check all custom sets + fallbacks directly
  const allSets = [...customSets, ...fallbackSets];
  const selected = allSets.find(s => s.id === setId) || sets.find(s => s.id === setId) || fallbackSets[0];

  let code; do { code = randomCode(); } while (games.has(code));
  const game = {
    code, hostPin: randomHostPin(), mode: 'Gold Quest', hostBlook, set: selected,
    state: 'lobby', createdAt: new Date().toISOString(), startedAt: null, players: [],
  };
  games.set(code, game);
  return game;
}

function publicGame(game) {
  return {
    code: game.code, hostPin: game.hostPin, mode: game.mode, state: game.state, setTitle: game.set.title,
    players: game.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, blook: p.blook, gold: p.gold })),
  };
}

// ─── File browser helper ───────────────────────────────────────────────────────
function listDirectory(dirPath) {
  const abs = path.resolve(__dirname, dirPath);
  // Security: must stay within project root
  if (!abs.startsWith(path.resolve(__dirname))) throw new Error('Access denied');
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  return entries.map(e => ({
    name: e.name,
    type: e.isDirectory() ? 'dir' : 'file',
    size: e.isFile() ? fs.statSync(path.join(abs, e.name)).size : null,
    path: path.posix.join(dirPath, e.name),
  }));
}

// ─── Router ────────────────────────────────────────────────────────────────────
async function routes(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname, searchParams } = reqUrl;
  const method = req.method;

  // Serve HTML
  if (method === 'GET' && pathname === '/') return sendText(res, 200, HTML_PAGE, 'text/html; charset=utf-8');

  // Blooks
  if (method === 'GET' && pathname === '/api/blooks') return sendJson(res, 200, { blooks: blookCatalog });

  // Quiz search (Open Trivia DB + custom + built-in)
  if (method === 'GET' && pathname === '/api/quiz/search') {
    try {
      const sets = await searchQuizSets(searchParams.get('q') || '');
      return sendJson(res, 200, { sets });
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  }

  // OTDB categories
  if (method === 'GET' && pathname === '/api/quiz/categories') {
    return sendJson(res, 200, { categories: OTDB_CATEGORIES });
  }

  // ── Custom game CRUD ──────────────────────────────────────────────────────────

  // List custom sets
  if (method === 'GET' && pathname === '/api/custom-sets') {
    return sendJson(res, 200, { sets: customSets });
  }

  // Create custom set
  if (method === 'POST' && pathname === '/api/custom-sets') {
    try {
      const body = await parseBody(req);
      if (!body.title || typeof body.title !== 'string') return sendJson(res, 400, { error: 'Title required.' });
      if (!Array.isArray(body.questions) || body.questions.length < 1) return sendJson(res, 400, { error: 'At least 1 question required.' });
      for (const [i, q] of body.questions.entries()) {
        if (!q.q || typeof q.q !== 'string') return sendJson(res, 400, { error: `Question ${i+1} text missing.` });
        if (!Array.isArray(q.answers) || q.answers.length < 2) return sendJson(res, 400, { error: `Question ${i+1} needs at least 2 answers.` });
        if (typeof q.correct !== 'number' || q.correct < 0 || q.correct >= q.answers.length) return sendJson(res, 400, { error: `Question ${i+1} correct index invalid.` });
      }
      const newSet = {
        id: `custom-${randomId()}`,
        title: body.title.trim(),
        description: (body.description || '').trim(),
        source: 'Custom',
        createdAt: new Date().toISOString(),
        questions: body.questions.map(q => ({
          q: q.q.trim(),
          answers: q.answers.map(a => String(a).trim()),
          correct: q.correct,
        })),
      };
      customSets.push(newSet);
      saveCustomGames(customSets);
      return sendJson(res, 201, { set: newSet, message: 'Custom set created.' });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  // Get single custom set
  if (method === 'GET' && pathname.match(/^\/api\/custom-sets\/[^/]+$/)) {
    const id = pathname.split('/')[3];
    const set = customSets.find(s => s.id === id);
    if (!set) return sendJson(res, 404, { error: 'Set not found.' });
    return sendJson(res, 200, { set });
  }

  // Update custom set
  if (method === 'PUT' && pathname.match(/^\/api\/custom-sets\/[^/]+$/)) {
    try {
      const id = pathname.split('/')[3];
      const idx = customSets.findIndex(s => s.id === id);
      if (idx === -1) return sendJson(res, 404, { error: 'Set not found.' });
      const body = await parseBody(req);
      const existing = customSets[idx];
      const updated = {
        ...existing,
        title: (body.title || existing.title).trim(),
        description: (body.description !== undefined ? body.description : existing.description).trim(),
        questions: Array.isArray(body.questions) ? body.questions.map(q => ({
          q: String(q.q).trim(), answers: q.answers.map(a => String(a).trim()), correct: q.correct,
        })) : existing.questions,
        updatedAt: new Date().toISOString(),
      };
      customSets[idx] = updated;
      saveCustomGames(customSets);
      return sendJson(res, 200, { set: updated, message: 'Set updated.' });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  // Delete custom set
  if (method === 'DELETE' && pathname.match(/^\/api\/custom-sets\/[^/]+$/)) {
    const id = pathname.split('/')[3];
    const before = customSets.length;
    customSets = customSets.filter(s => s.id !== id);
    if (customSets.length === before) return sendJson(res, 404, { error: 'Set not found.' });
    saveCustomGames(customSets);
    return sendJson(res, 200, { message: 'Set deleted.' });
  }

  // ── File browser ──────────────────────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/files') {
    try {
      const dir = searchParams.get('path') || '.';
      const entries = listDirectory(dir);
      return sendJson(res, 200, { path: dir, entries });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  if (method === 'GET' && pathname === '/api/files/read') {
    try {
      const filePath = searchParams.get('path');
      if (!filePath) return sendJson(res, 400, { error: 'path param required' });
      const abs = path.resolve(__dirname, filePath);
      if (!abs.startsWith(path.resolve(__dirname))) return sendJson(res, 403, { error: 'Access denied' });
      const content = fs.readFileSync(abs, 'utf8');
      return sendJson(res, 200, { path: filePath, content });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  // ── Game session routes ───────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/host') {
    try {
      const body = await parseBody(req);
      const error = validateHostPayload(body);
      if (error) return sendJson(res, 400, { error });
      const game = await createHostedGoldQuest(body);
      return sendJson(res, 201, { game: publicGame(game), message: 'Gold Quest lobby created.' });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  if (method === 'GET' && pathname.match(/^\/api\/games\/[^/]+\/lobby$/)) {
    const code = pathname.split('/')[3]?.toUpperCase();
    const game = games.get(code);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    return sendJson(res, 200, { game: publicGame(game) });
  }

  if (method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/join$/)) {
    const code = pathname.split('/')[3]?.toUpperCase();
    const game = games.get(code);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    if (game.state !== 'lobby') return sendJson(res, 400, { error: 'Game already started.' });
    try {
      const body = await parseBody(req);
      const error = validateJoinPayload(body);
      if (error) return sendJson(res, 400, { error });
      if (game.players.some(p => p.playerName.toLowerCase() === body.playerName.trim().toLowerCase()))
        return sendJson(res, 409, { error: 'Name already in use.' });
      const player = { playerId: randomId(), playerName: body.playerName.trim(), blook: body.blook, joinedAt: new Date().toISOString(), gold: 0, questionIndex: 0 };
      game.players.push(player);
      return sendJson(res, 201, { gameCode: game.code, player });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  if (method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/start$/)) {
    const code = pathname.split('/')[3]?.toUpperCase();
    const game = games.get(code);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    if (game.state !== 'lobby') return sendJson(res, 400, { error: 'Already started.' });
    if (!game.players.length) return sendJson(res, 400, { error: 'Need at least 1 player.' });
    game.state = 'live'; game.startedAt = new Date().toISOString();
    return sendJson(res, 200, { message: 'Game started!' });
  }

  if (method === 'GET' && pathname.match(/^\/api\/games\/[^/]+\/player\/[^/]+$/)) {
    const parts = pathname.split('/');
    const game = games.get((parts[3] || '').toUpperCase());
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    const player = game.players.find(p => p.playerId === parts[5]);
    if (!player) return sendJson(res, 404, { error: 'Player not found' });
    if (game.state !== 'live') return sendJson(res, 200, { state: game.state, waiting: true, gold: player.gold, playerName: player.playerName });
    const question = game.set.questions[player.questionIndex] || null;
    if (!question) return sendJson(res, 200, { state: 'finished', finished: true, gold: player.gold });
    return sendJson(res, 200, { state: 'live', gold: player.gold, questionIndex: player.questionIndex, question: { q: question.q, answers: question.answers } });
  }

  if (method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/player\/[^/]+\/answer$/)) {
    const parts = pathname.split('/');
    const game = games.get((parts[3] || '').toUpperCase());
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    const player = game.players.find(p => p.playerId === parts[5]);
    if (!player) return sendJson(res, 404, { error: 'Player not found' });
    if (game.state !== 'live') return sendJson(res, 400, { error: 'Game has not started.' });
    try {
      const body = await parseBody(req);
      const question = game.set.questions[player.questionIndex];
      if (!question) return sendJson(res, 200, { finished: true, gold: player.gold });
      const correct = Number(body.answerIndex) === question.correct;
      let gained = 0;
      if (correct) { gained = Math.floor(20 + Math.random() * 61); player.gold += gained; }
      player.questionIndex += 1;
      return sendJson(res, 200, { correct, gained, totalGold: player.gold, nextQuestion: player.questionIndex });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  if (method === 'DELETE' && pathname.match(/^\/api\/games\/[^/]+$/)) {
    const code = pathname.split('/')[3]?.toUpperCase();
    if (!code || !games.has(code)) return sendJson(res, 404, { error: 'Game not found' });
    games.delete(code);
    return sendJson(res, 200, { message: 'Game deleted.' });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  routes(req, res).catch(e => {
    console.error(e);
    try { res.writeHead(500); res.end(JSON.stringify({ error: 'Internal error' })); } catch { /* */ }
  });
});

server.listen(PORT, () => console.log(`Greenit server at http://localhost:${PORT}`));

// ─── HTML ─────────────────────────────────────────────────────────────────────
const HTML_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Greenit - Gold Quest</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,sans-serif;background:radial-gradient(circle at top,#18316e,#0d142b 60%);color:#ecf2ff;min-height:100vh}
.wrap{max-width:1140px;margin:auto;padding:20px}
nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
nav button{background:#1e2e5c;color:#a0b4ff;border:1px solid #2b3d73;padding:8px 14px;border-radius:8px;font-size:13px;cursor:pointer;font-weight:600}
nav button.active{background:#3d68ff;color:#fff;border-color:#3d68ff}
.card{background:#111a34;border:1px solid #2b3d73;border-radius:16px;padding:20px;box-shadow:0 10px 25px #0007;margin-bottom:16px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
button.primary{background:#3d68ff;color:#fff;border:0;padding:10px 16px;border-radius:10px;font-weight:700;cursor:pointer;font-size:14px}
button.secondary{background:#20315f;color:#a0b4ff;border:1px solid #2b3d73;padding:10px 16px;border-radius:10px;font-weight:600;cursor:pointer;font-size:14px}
button.danger{background:#6e1b1b;color:#ffaaaa;border:1px solid #a33;padding:8px 12px;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px}
button.sm{padding:6px 10px;font-size:12px;border-radius:7px}
input,select,textarea{background:#0d1530;color:#ecf2ff;border:1px solid #2f4177;padding:10px 12px;border-radius:10px;font-size:14px;font-family:inherit;width:100%}
textarea{resize:vertical;min-height:80px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.blook{padding:10px;border:2px solid #334d8f;border-radius:12px;cursor:pointer;text-align:center;transition:.15s}
.blook:hover,.blook.selected{border-color:#3d68ff;background:#1b2b5a}
.blook img{height:56px;display:block;margin:auto}
.blook span{font-size:12px;margin-top:4px;display:block}
.set-item{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #1e2e5c;gap:8px;flex-wrap:wrap}
.set-item:last-child{border-bottom:none}
.badge{background:#1b2b5a;border:1px solid #334d8f;border-radius:6px;padding:2px 8px;font-size:11px;color:#7fa0ff}
.badge.custom{border-color:#4db37a;color:#4db37a;background:#0d2a1a}
.badge.otdb{border-color:#f0a830;color:#f0a830;background:#2a1e0a}
.player-row{display:flex;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #1e2e5c;align-items:center}
.gold{color:#ffdf4d;font-weight:700}
.status{min-height:22px;font-size:13px;color:#7fa0ff;margin-top:6px}
.err{color:#ff7a7a}
.answer-btn{width:100%;text-align:left;margin:6px 0;background:#1b2b5a;color:#ecf2ff;border:1px solid #2b3d73;padding:12px 16px;border-radius:10px;cursor:pointer;font-size:15px;transition:.15s}
.answer-btn:hover{background:#223575;border-color:#3d68ff}
.q-builder{background:#0b1226;border:1px solid #243365;border-radius:12px;padding:14px;margin-bottom:10px;position:relative}
.q-builder h4{margin:0 0 8px;font-size:14px;color:#a0b4ff}
.answers-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.correct-radio{display:flex;align-items:center;gap:6px;font-size:12px;color:#7fa0ff;margin-top:6px}
/* File browser */
.file-entry{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #1a2550;cursor:pointer;font-size:13px}
.file-entry:hover{background:#1b2b5a}
.file-entry .icon{font-size:18px;width:24px;text-align:center}
.file-entry .name{flex:1;color:#c0d4ff}
.file-entry .meta{font-size:11px;color:#4a6199}
.breadcrumb{display:flex;gap:4px;align-items:center;flex-wrap:wrap;font-size:13px;color:#7fa0ff;margin-bottom:10px}
.breadcrumb span{cursor:pointer;color:#3d68ff}.breadcrumb span:hover{text-decoration:underline}
.file-content{background:#060d1e;border:1px solid #1a2550;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;max-height:400px;overflow:auto;white-space:pre-wrap;color:#a0c0ff}
h1{margin:0 0 16px;font-size:28px}h2{margin:0 0 14px}h3{margin:0 0 10px}
label{font-size:13px;color:#7fa0ff;display:block;margin-bottom:4px}
.hidden{display:none}
</style>
</head>
<body>
<div class="wrap">
  <h1>🟩 Greenit Gold Quest</h1>
  <nav>
    <button class="active" data-view="home">🏠 Home</button>
    <button data-view="host">🎮 Host</button>
    <button data-view="join">🙋 Join</button>
    <button data-view="custom">✏️ Custom Sets</button>
    <button data-view="files">📁 Files</button>
  </nav>

  <!-- HOME -->
  <div id="view-home" class="card">
    <h2>Welcome!</h2>
    <p>Host a Gold Quest game, join one with a code, create custom question sets, or browse server files.</p>
    <div class="row">
      <button class="primary" onclick="showView('host')">🎮 Host a Game</button>
      <button class="secondary" onclick="showView('join')">🙋 Join a Game</button>
      <button class="secondary" onclick="showView('custom')">✏️ Custom Sets</button>
      <button class="secondary" onclick="showView('files')">📁 File Browser</button>
    </div>
  </div>

  <!-- HOST -->
  <div id="view-host" class="card hidden">
    <h2>Host Setup</h2>
    <div class="card" style="margin-bottom:12px">
      <h3>1. Find a Quiz Set</h3>
      <div class="row">
        <input id="searchInput" placeholder="Search category (e.g. Geography, History, Science...)" style="flex:1"/>
        <button class="primary" onclick="doSearch()">Search</button>
      </div>
      <p id="searchStatus" class="status"></p>
      <div id="setResults"></div>
    </div>
    <div class="card" style="margin-bottom:12px">
      <h3>2. Pick Your Blook</h3>
      <div id="hostBlookGrid" class="grid"></div>
    </div>
    <button class="primary" onclick="createLobby()">Create Lobby →</button>
    <p id="hostStatus" class="status"></p>
  </div>

  <!-- LOBBY (host) -->
  <div id="view-lobby" class="card hidden">
    <h2>Lobby: <span id="lobbyCode" style="color:#ffdf4d"></span></h2>
    <p id="lobbyMeta" class="status"></p>
    <div id="lobbyPlayers"></div>
    <div class="row" style="margin-top:12px">
      <button class="primary" onclick="startGame()">▶ Start Game</button>
      <button class="danger" onclick="closeLobby()">✕ Close Lobby</button>
    </div>
    <p id="lobbyStatus" class="status"></p>
  </div>

  <!-- JOIN -->
  <div id="view-join" class="card hidden">
    <h2>Join a Game</h2>
    <div class="row" style="margin-bottom:12px">
      <div style="flex:1"><label>Game Code</label><input id="joinCode" placeholder="123456"/></div>
      <div style="flex:1"><label>Your Name</label><input id="joinName" placeholder="CoolPlayer"/></div>
    </div>
    <h3>Pick Your Blook</h3>
    <div id="joinBlookGrid" class="grid"></div>
    <button class="primary" style="margin-top:12px" onclick="joinGame()">Join →</button>
    <p id="joinStatus" class="status"></p>
  </div>

  <!-- PLAYER GAME -->
  <div id="view-game" class="card hidden">
    <h2>Gold Quest</h2>
    <p id="gameMeta" class="status"></p>
    <div id="questionPanel"></div>
    <p id="gameStatus" class="status"></p>
  </div>

  <!-- CUSTOM SETS -->
  <div id="view-custom" class="card hidden">
    <div class="row" style="margin-bottom:14px">
      <h2 style="margin:0;flex:1">Custom Question Sets</h2>
      <button class="primary" onclick="showCustomEditor()">+ New Set</button>
    </div>
    <div id="customSetsList"></div>

    <!-- Editor -->
    <div id="customEditor" class="hidden" style="margin-top:16px">
      <div class="card">
        <h3 id="editorTitle">New Set</h3>
        <label>Set Title</label>
        <input id="csTitle" placeholder="My Awesome Quiz" style="margin-bottom:10px"/>
        <label>Description</label>
        <input id="csDesc" placeholder="Short description..." style="margin-bottom:14px"/>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="margin:0">Questions</h3>
          <button class="primary sm" onclick="addQuestion()">+ Add Question</button>
        </div>
        <div id="questionsContainer"></div>
        <div class="row" style="margin-top:14px">
          <button class="primary" onclick="saveCustomSet()">💾 Save Set</button>
          <button class="secondary" onclick="cancelEditor()">Cancel</button>
        </div>
        <p id="editorStatus" class="status"></p>
      </div>
    </div>
  </div>

  <!-- FILE BROWSER -->
  <div id="view-files" class="card hidden">
    <h2>📁 File Browser</h2>
    <div class="breadcrumb" id="breadcrumb"></div>
    <div id="fileList"></div>
    <div id="fileContent" class="hidden" style="margin-top:12px">
      <div class="row" style="margin-bottom:8px">
        <h3 id="fileContentTitle" style="margin:0;flex:1"></h3>
        <button class="secondary sm" onclick="closeFile()">✕ Close</button>
      </div>
      <div class="file-content" id="fileContentBody"></div>
    </div>
  </div>
</div>

<script>
// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  hostBlook: null, joinBlook: null, selectedSetId: null, selectedSetTitle: '',
  lobbyCode: null, lobbyPoll: null,
  player: { code: null, id: null, name: null }, playerPoll: null,
  editingSetId: null, questions: [],
  filePath: '.',
};

// ─── Nav ──────────────────────────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('[id^=view-]').forEach(el => el.classList.add('hidden'));
  document.getElementById('view-' + name)?.classList.remove('hidden');
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'custom') loadCustomSets();
  if (name === 'files') loadFiles('.');
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => showView(b.dataset.view));

// ─── API ─────────────────────────────────────────────────────────────────────
async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

// ─── Blooks ──────────────────────────────────────────────────────────────────
async function loadBlooks() {
  const data = await api('/api/blooks');
  renderBlooks('hostBlookGrid', data.blooks, b => {
    state.hostBlook = b;
    document.querySelectorAll('#hostBlookGrid .blook').forEach(el => el.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
  });
  renderBlooks('joinBlookGrid', data.blooks, b => {
    state.joinBlook = b;
    document.querySelectorAll('#joinBlookGrid .blook').forEach(el => el.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
  });
}
function renderBlooks(containerId, blooks, onPick) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  blooks.forEach(b => {
    const c = document.createElement('div');
    c.className = 'blook'; c.innerHTML = '<img src="'+b.imageUrl+'"/><span>'+b.name+'</span>';
    c.onclick = e => { event = e; onPick(b); }; el.appendChild(c);
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────
async function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  const st = document.getElementById('searchStatus');
  st.textContent = 'Searching...'; st.className = 'status';
  try {
    const data = await api('/api/quiz/search?q=' + encodeURIComponent(q));
    const box = document.getElementById('setResults');
    box.innerHTML = '';
    if (!data.sets.length) { box.innerHTML = '<p style="color:#7fa0ff">No sets found.</p>'; st.textContent = ''; return; }
    data.sets.forEach(set => {
      const row = document.createElement('div'); row.className = 'set-item';
      const src = set.source === 'Custom' ? 'custom' : set.source === 'Open Trivia DB' ? 'otdb' : '';
      row.innerHTML = '<div><strong>' + esc(set.title) + '</strong><br><span style="font-size:12px;color:#7fa0ff">' + esc(set.description || '') + ' &bull; ' + set.questions.length + ' questions</span></div>'
        + '<div class="row"><span class="badge ' + src + '">' + esc(set.source) + '</span><button class="primary sm">Select</button></div>';
      row.querySelector('button').onclick = () => {
        state.selectedSetId = set.id; state.selectedSetTitle = set.title;
        st.textContent = '✅ Selected: ' + set.title; st.className = 'status';
        document.querySelectorAll('#setResults .set-item').forEach(r => r.style.background = '');
        row.style.background = '#1b2b5a';
      };
      box.appendChild(row);
    });
    st.textContent = data.sets.length + ' sets found.';
  } catch (e) { st.textContent = e.message; st.className = 'status err'; }
}

// ─── Host / Lobby ─────────────────────────────────────────────────────────────
async function createLobby() {
  const st = document.getElementById('hostStatus');
  try {
    if (!state.hostBlook) throw new Error('Pick a host blook first.');
    if (!state.selectedSetId) throw new Error('Search and select a set first.');
    const data = await api('/api/host', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ setId: state.selectedSetId, hostBlook: state.hostBlook }) });
    state.lobbyCode = data.game.code;
    showView('lobby');
    await refreshLobby();
    if (state.lobbyPoll) clearInterval(state.lobbyPoll);
    state.lobbyPoll = setInterval(refreshLobby, 1500);
  } catch(e) { st.textContent = e.message; st.className = 'status err'; }
}

async function refreshLobby() {
  if (!state.lobbyCode) return;
  const data = await api('/api/games/' + state.lobbyCode + '/lobby');
  document.getElementById('lobbyCode').textContent = data.game.code;
  document.getElementById('lobbyMeta').textContent = 'Set: ' + data.game.setTitle + '  |  PIN: ' + data.game.hostPin + '  |  State: ' + data.game.state;
  const pl = document.getElementById('lobbyPlayers');
  pl.innerHTML = data.game.players.length
    ? data.game.players.map(p => '<div class="player-row"><span>'+esc(p.playerName)+' ('+esc(p.blook.name)+')</span><span class="gold">'+p.gold+' 🪙</span></div>').join('')
    : '<p style="color:#4a6199">Waiting for players…</p>';
}

async function startGame() {
  const st = document.getElementById('lobbyStatus');
  try { const d = await api('/api/games/'+state.lobbyCode+'/start',{method:'POST'}); st.textContent = d.message; } catch(e){ st.textContent=e.message; st.className='status err'; }
}
async function closeLobby() {
  if (state.lobbyCode) { await fetch('/api/games/'+state.lobbyCode,{method:'DELETE'}); state.lobbyCode=null; }
  if (state.lobbyPoll) { clearInterval(state.lobbyPoll); state.lobbyPoll=null; }
  showView('home');
}

// ─── Join / Player ────────────────────────────────────────────────────────────
async function joinGame() {
  const st = document.getElementById('joinStatus');
  try {
    const code = document.getElementById('joinCode').value.trim().toUpperCase();
    const name = document.getElementById('joinName').value.trim();
    if (!state.joinBlook) throw new Error('Pick a blook.');
    if (!code || !name) throw new Error('Code and name required.');
    const data = await api('/api/games/'+code+'/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerName:name,blook:state.joinBlook})});
    state.player = { code, id: data.player.playerId, name: data.player.playerName };
    showView('game');
    await refreshPlayer();
    if (state.playerPoll) clearInterval(state.playerPoll);
    state.playerPoll = setInterval(refreshPlayer, 1200);
  } catch(e){ st.textContent=e.message; st.className='status err'; }
}

async function refreshPlayer() {
  if (!state.player.id) return;
  const data = await api('/api/games/'+state.player.code+'/player/'+state.player.id);
  document.getElementById('gameMeta').textContent = state.player.name + '  |  Gold: ' + (data.gold||0) + ' 🪙';
  const panel = document.getElementById('questionPanel');
  if (data.waiting) { panel.innerHTML='<h3 style="color:#7fa0ff">Waiting for host to start…</h3>'; return; }
  if (data.finished) {
    panel.innerHTML='<h3>🎉 Done! Final gold: <span class="gold">'+data.gold+'</span></h3>';
    if (state.playerPoll){ clearInterval(state.playerPoll); state.playerPoll=null; }
    return;
  }
  panel.innerHTML='<h3>Q'+(data.questionIndex+1)+': '+esc(data.question.q)+'</h3>';
  data.question.answers.forEach((a,i) => {
    const b = document.createElement('button'); b.className='answer-btn'; b.textContent=a;
    b.onclick = async () => {
      document.querySelectorAll('.answer-btn').forEach(x=>x.disabled=true);
      const result = await api('/api/games/'+state.player.code+'/player/'+state.player.id+'/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answerIndex:i})});
      document.getElementById('gameStatus').textContent = result.correct ? '✅ Correct! +'+result.gained+' gold' : '❌ Wrong!';
      document.getElementById('gameStatus').className = 'status' + (result.correct?'':' err');
      await refreshPlayer();
    };
    panel.appendChild(b);
  });
}

// ─── Custom Sets ──────────────────────────────────────────────────────────────
async function loadCustomSets() {
  const data = await api('/api/custom-sets');
  const el = document.getElementById('customSetsList');
  if (!data.sets.length) { el.innerHTML='<p style="color:#4a6199">No custom sets yet. Click "+ New Set" to create one.</p>'; return; }
  el.innerHTML = data.sets.map(s =>
    '<div class="set-item"><div><strong>'+esc(s.title)+'</strong><br><span style="font-size:12px;color:#7fa0ff">'+esc(s.description||'')+'  &bull;  '+s.questions.length+' questions</span></div>'
    +'<div class="row"><button class="secondary sm" onclick="editCustomSet(\''+s.id+'\')">✏️ Edit</button><button class="danger sm" onclick="deleteCustomSet(\''+s.id+'\')">🗑 Delete</button></div></div>'
  ).join('');
}

function showCustomEditor(set) {
  state.editingSetId = set?.id || null;
  state.questions = set ? set.questions.map(q=>({...q, answers:[...q.answers]})) : [blankQ()];
  document.getElementById('editorTitle').textContent = set ? 'Edit: '+set.title : 'New Set';
  document.getElementById('csTitle').value = set?.title || '';
  document.getElementById('csDesc').value = set?.description || '';
  document.getElementById('editorStatus').textContent = '';
  renderQuestions();
  document.getElementById('customEditor').classList.remove('hidden');
  document.getElementById('customEditor').scrollIntoView({behavior:'smooth'});
}

function cancelEditor() {
  document.getElementById('customEditor').classList.add('hidden');
  state.editingSetId = null; state.questions = [];
}

function blankQ() { return { q:'', answers:['','','',''], correct:0 }; }
function addQuestion() { state.questions.push(blankQ()); renderQuestions(); }

function renderQuestions() {
  const c = document.getElementById('questionsContainer');
  c.innerHTML = '';
  state.questions.forEach((q, qi) => {
    const div = document.createElement('div'); div.className='q-builder';
    div.innerHTML = '<h4>Question '+(qi+1)+'  '+(state.questions.length>1?'<button class="danger sm" onclick="removeQuestion('+qi+')">✕ Remove</button>':'')+'</h4>'
      +'<textarea placeholder="Question text..." onchange="state.questions['+qi+'].q=this.value">'+esc(q.q)+'</textarea>'
      +'<div class="answers-grid">'
      + q.answers.map((a,ai)=>'<div><input placeholder="Answer '+(ai+1)+'" value="'+esc(a)+'" onchange="state.questions['+qi+'].answers['+ai+']=this.value"/>'
        +'<label class="correct-radio"><input type="radio" name="correct-'+qi+'" '+(q.correct===ai?'checked':'')+' onchange="state.questions['+qi+'].correct='+ai+'"/> Correct</label></div>'
      ).join('')
      +'</div>';
    c.appendChild(div);
  });
}

function removeQuestion(i) {
  state.questions.splice(i,1);
  if (!state.questions.length) state.questions.push(blankQ());
  renderQuestions();
}

async function saveCustomSet() {
  const st = document.getElementById('editorStatus');
  try {
    const title = document.getElementById('csTitle').value.trim();
    const description = document.getElementById('csDesc').value.trim();
    if (!title) throw new Error('Title is required.');
    // Re-read textarea values (in case onchange missed anything)
    document.querySelectorAll('#questionsContainer textarea').forEach((ta,i) => { state.questions[i].q = ta.value; });
    document.querySelectorAll('#questionsContainer input[type=text], #questionsContainer input:not([type])').forEach(inp => {
      // inputs are also handled by onchange; this is a safety net
    });
    const payload = { title, description, questions: state.questions };
    if (state.editingSetId) {
      await api('/api/custom-sets/'+state.editingSetId, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    } else {
      await api('/api/custom-sets', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    }
    st.textContent = '✅ Saved!'; cancelEditor(); await loadCustomSets();
  } catch(e){ st.textContent=e.message; st.className='status err'; }
}

async function editCustomSet(id) {
  const data = await api('/api/custom-sets/'+id);
  showCustomEditor(data.set);
}

async function deleteCustomSet(id) {
  if (!confirm('Delete this set?')) return;
  await api('/api/custom-sets/'+id,{method:'DELETE'});
  await loadCustomSets();
}

// ─── File Browser ─────────────────────────────────────────────────────────────
async function loadFiles(dirPath) {
  state.filePath = dirPath;
  closeFile();
  const data = await api('/api/files?path='+encodeURIComponent(dirPath));
  // Breadcrumb
  const parts = dirPath === '.' ? ['.'] : ['.', ...dirPath.replace(/^\\.\\//,'').split('/').filter(Boolean)];
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = parts.map((p,i)=>{
    const pathSoFar = i===0 ? '.' : parts.slice(1,i+1).join('/');
    return '<span onclick="loadFiles(\''+pathSoFar+'\')">'+(p==='.'?'🏠 root':p)+'</span>' + (i<parts.length-1?' / ':'');
  }).join('');
  // List
  const el = document.getElementById('fileList');
  el.innerHTML = '';
  if (dirPath !== '.') {
    const up = document.createElement('div'); up.className='file-entry';
    up.innerHTML='<span class="icon">⬆️</span><span class="name">.. (parent)</span>';
    const parentPath = dirPath.split('/').slice(0,-1).join('/') || '.';
    up.onclick = () => loadFiles(parentPath); el.appendChild(up);
  }
  data.entries.sort((a,b)=>{ if(a.type!==b.type) return a.type==='dir'?-1:1; return a.name.localeCompare(b.name); });
  data.entries.forEach(e => {
    const row = document.createElement('div'); row.className='file-entry';
    const icon = e.type==='dir' ? '📁' : getFileIcon(e.name);
    const size = e.size != null ? formatSize(e.size) : '';
    row.innerHTML='<span class="icon">'+icon+'</span><span class="name">'+esc(e.name)+'</span><span class="meta">'+size+'</span>';
    if (e.type==='dir') row.onclick = () => loadFiles(e.path);
    else row.onclick = () => openFile(e.path, e.name);
    el.appendChild(row);
  });
  if (!data.entries.length) el.innerHTML='<p style="color:#4a6199;padding:12px">Empty directory.</p>';
}

async function openFile(filePath, name) {
  try {
    const data = await api('/api/files/read?path='+encodeURIComponent(filePath));
    document.getElementById('fileContentTitle').textContent = name;
    document.getElementById('fileContentBody').textContent = data.content;
    document.getElementById('fileContent').classList.remove('hidden');
  } catch(e) { alert('Cannot read file: '+e.message); }
}
function closeFile() { document.getElementById('fileContent').classList.add('hidden'); }

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = { js:'📜', json:'📋', html:'🌐', css:'🎨', md:'📝', txt:'📄', png:'🖼', jpg:'🖼', webp:'🖼', svg:'🖼', sh:'⚙️' };
  return map[ext] || '📄';
}
function formatSize(bytes) {
  if (bytes < 1024) return bytes+'B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1)+'KB';
  return (bytes/1048576).toFixed(1)+'MB';
}

// ─── Escape ───────────────────────────────────────────────────────────────────
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── Init ─────────────────────────────────────────────────────────────────────
loadBlooks();
doSearch();
</script>
</body>
</html>`;
