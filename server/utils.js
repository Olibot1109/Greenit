const { URL } = require('url');
const config = require('./config');

function shouldUseLogColor() {
  if (config.LOG_COLOR_MODE === 'off' || process.env.NO_COLOR !== undefined) return false;
  if (config.LOG_COLOR_MODE === 'on') return true;
  return Boolean(process.stdout?.isTTY || process.stderr?.isTTY || Number(process.env.FORCE_COLOR || 0) > 0);
}

const USE_LOG_COLOR = shouldUseLogColor();

function colorize(text, colorCode) {
  if (!USE_LOG_COLOR || !colorCode) return text;
  return `${colorCode}${text}${config.ANSI.reset}`;
}

function colorForLevel(level) {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'debug') return config.ANSI.cyan;
  if (normalized === 'info') return config.ANSI.green;
  if (normalized === 'warn') return config.ANSI.yellow;
  if (normalized === 'error') return config.ANSI.red;
  return '';
}

function shouldLog(level) {
  const wanted = config.LOG_LEVELS[String(level || '').toLowerCase()] || config.LOG_LEVELS.info;
  return wanted >= config.LOG_LEVELS[config.ACTIVE_LOG_LEVEL];
}

function truncateLogString(value, maxChars = config.MAX_LOG_CHARS) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…<trimmed ${text.length - maxChars} chars>`;
}

function safeLogMeta(meta) {
  if (meta === undefined) return '';
  try {
    return truncateLogString(JSON.stringify(meta));
  } catch {
    return truncateLogString(String(meta));
  }
}

function log(level, message, meta) {
  if (!shouldLog(level)) return;
  const stamp = new Date().toISOString();
  const levelText = String(level).toUpperCase();
  const levelColor = colorForLevel(level);
  const stampPart = colorize(`[${stamp}]`, config.ANSI.dim);
  const levelPart = colorize(`[${levelText}]`, levelColor);
  const messagePart = colorize(String(message || ''), levelColor);
  const metaPart = meta === undefined ? '' : ` ${colorize(safeLogMeta(meta), config.ANSI.dim)}`;
  const line = `${stampPart} ${levelPart} ${messagePart}${metaPart}`;
  if (level === 'warn' || level === 'error') {
    console.error(line);
    return;
  }
  console.log(line);
}

function logDebug(message, meta) {
  log('debug', message, meta);
}

function logInfo(message, meta) {
  log('info', message, meta);
}

function logWarn(message, meta) {
  log('warn', message, meta);
}

function logError(message, meta) {
  log('error', message, meta);
}

function logImageFallback(message, meta) {
  const level = config.IMAGE_FALLBACK_LOG_LEVEL === 'info' ? 'info' : 'debug';
  log(level, message, meta);
}

function sanitizeUrlForLog(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    ['key', 'api_key', 'apikey', 'token', 'auth', 'authorization', 'access_token'].forEach((name) => {
      if (url.searchParams.has(name)) url.searchParams.set(name, '***');
    });
    if (url.username) url.username = '***';
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return truncateLogString(rawUrl);
  }
}

function summarizePayloadForLog(data) {
  if (!data || typeof data !== 'object') return data;
  const summary = { keys: Object.keys(data).slice(0, 16) };
  if (typeof data.error === 'string') summary.error = data.error;
  if (typeof data.message === 'string') summary.message = data.message;
  if (Array.isArray(data.sets)) summary.sets = data.sets.length;
  if (Array.isArray(data.players)) summary.players = data.players.length;
  if (data.set && typeof data.set === 'object') {
    summary.set = {
      id: data.set.id,
      title: data.set.title,
      questionCount: Array.isArray(data.set.questions) ? data.set.questions.length : undefined,
    };
  }
  if (data.game && typeof data.game === 'object') {
    summary.game = {
      code: data.game.code,
      state: data.game.state,
      mode: data.game.mode,
      players: Array.isArray(data.game.players) ? data.game.players.length : undefined,
    };
  }
  return summary;
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/"/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');
}

function stripHtml(str) {
  return String(str || '').replace(/(<([^>]+)>)/gi, '').trim();
}

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
  const reqInfo = res.__reqInfo;
  if (reqInfo) {
    logDebug('http.response.json', {
      requestId: reqInfo.requestId,
      method: reqInfo.method,
      path: reqInfo.path,
      status: code,
      payload: summarizePayloadForLog(data),
    });
  }
}

function sendText(res, code, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(text);
  const reqInfo = res.__reqInfo;
  if (reqInfo) {
    logDebug('http.response.text', {
      requestId: reqInfo.requestId,
      method: reqInfo.method,
      path: reqInfo.path,
      status: code,
      contentType: type,
      bytes: Buffer.byteLength(String(text || '')),
    });
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const reqInfo = req.__reqInfo;
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        logWarn('http.body.too_large', {
          requestId: reqInfo?.requestId,
          method: reqInfo?.method,
          path: reqInfo?.path,
          bytes: body.length,
        });
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        logDebug('http.body.empty', {
          requestId: reqInfo?.requestId,
          method: reqInfo?.method,
          path: reqInfo?.path,
        });
        return resolve({});
      }
      try {
        const parsed = JSON.parse(body);
        logDebug('http.body.parsed', {
          requestId: reqInfo?.requestId,
          method: reqInfo?.method,
          path: reqInfo?.path,
          bytes: body.length,
          keys: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 16) : [],
        });
        resolve(parsed);
      } catch {
        logWarn('http.body.invalid_json', {
          requestId: reqInfo?.requestId,
          method: reqInfo?.method,
          path: reqInfo?.path,
          bytes: body.length,
          sample: truncateLogString(body, 220),
        });
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', (error) => {
      logWarn('http.body.read_error', {
        requestId: reqInfo?.requestId,
        method: reqInfo?.method,
        path: reqInfo?.path,
        error: error.message,
      });
      reject(error);
    });
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

function normalizeGold(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

function clampPlayerGold(player) {
  if (!player || typeof player !== 'object') return 0;
  player.gold = normalizeGold(player.gold);
  return player.gold;
}

function clampGameGold(game) {
  if (!game || !Array.isArray(game.players)) return;
  game.players.forEach((entry) => {
    clampPlayerGold(entry);
  });
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

function getBlookById(blookId) {
  const target = String(blookId || '').trim();
  if (!target) return null;
  return config.blookCatalog.find((blook) => blook.id === target) || null;
}

function getTakenBlookIds(game, excludePlayerId = null) {
  return new Set(
    (game.players || [])
      .filter((player) => !excludePlayerId || player.playerId !== excludePlayerId)
      .map((player) => player.blook?.id)
      .filter(Boolean)
  );
}

function toSlug(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function titleCase(text) {
  return String(text || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function uniqStrings(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function isAbsoluteHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function normalizeAbsoluteHttpUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

module.exports = {
  USE_LOG_COLOR,
  shouldUseLogColor,
  colorize,
  colorForLevel,
  shouldLog,
  truncateLogString,
  safeLogMeta,
  log,
  logDebug,
  logInfo,
  logWarn,
  logError,
  logImageFallback,
  sanitizeUrlForLog,
  summarizePayloadForLog,
  decodeHtmlEntities,
  stripHtml,
  sendJson,
  sendText,
  parseBody,
  randomCode,
  randomHostPin,
  randomId,
  normalizeGold,
  clampPlayerGold,
  clampGameGold,
  shuffle,
  sample,
  getBlookById,
  getTakenBlookIds,
  toSlug,
  titleCase,
  uniqStrings,
  isAbsoluteHttpUrl,
  normalizeAbsoluteHttpUrl,
};
