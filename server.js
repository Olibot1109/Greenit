const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const HTML_DIR = path.join(__dirname, 'pagess');
const HTML_PAGE = fs.readFileSync(path.join(HTML_DIR, 'index.html'), 'utf8');
const HTML_JS = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const ENTRY_PAGE_OVERRIDES = Object.freeze({
  'goldquest.html': 'goldquest',
  'goldquesthost.html': 'goldquesthost',
  'hostgoldquest.html': 'goldquesthost',
  'hostgoldqueest.html': 'goldquesthost',
  'assemble.html': 'assemble',
  'hostassemble.html': 'hostassemble',
});
const ENTRY_HTML_FILES = new Set(Object.keys(ENTRY_PAGE_OVERRIDES));
const ENTRY_HTML_CACHE = new Map();

function renderEntryHtml(entry) {
  const safeEntry = String(entry || '').trim().toLowerCase();
  if (!safeEntry) return HTML_PAGE;
  const cached = ENTRY_HTML_CACHE.get(safeEntry);
  if (cached) return cached;
  const entryScript = `<script>window.__GREENIT_ENTRY_OVERRIDE=${JSON.stringify(safeEntry)};</script>`;
  const standaloneTag = '<script src="/pages/goldquest.js"></script>';
  const html = HTML_PAGE
    .replace('<script src="/pages/goldquest-core.js"></script>', '')
    .replace('<script src="/pages/goldquest.js"></script>', '')
    .replace('<script src="script.js"></script>', '')
    .replace('</body>', `  ${entryScript}\n  ${standaloneTag}\n</body>`);
  ENTRY_HTML_CACHE.set(safeEntry, html);
  return html;
}
const PFP_DIR = path.join(__dirname, 'pfp');
const MP3_DIR = path.join(__dirname, 'mp3');
const blookSeeds = [
  'Nova',
  'Atlas',
  'Pixel',
  'Orbit',
  'Flare',
  'Echo',
  'Blitz',
  'Comet',
  'Sage',
  'Raven',
  'Mango',
  'Frost',
  'Viper',
  'Drift',
  'Quartz',
  'Neon',
  'Titan',
  'Cinder',
  'Onyx',
  'Lynx',
  'Basil',
  'Rogue',
  'Ember',
];

function loadLocalBlookCatalog() {
  try {
    const files = fs.readdirSync(PFP_DIR)
      .filter((entry) => /\.svg$/i.test(String(entry || '')))
      .sort((a, b) => a.localeCompare(b));
    return files.map((file, index) => {
      const name = String(file).replace(/\.svg$/i, '');
      return {
        id: `blook-${index + 1}`,
        name,
        rarity: 'Blook',
        imageUrl: `/pfp/${encodeURIComponent(file)}`,
      };
    });
  } catch {
    return [];
  }
}

const localBlookCatalog = loadLocalBlookCatalog();
const blookCatalog = (localBlookCatalog.length ? localBlookCatalog : blookSeeds.map((name, index) => ({
  id: `blook-${index + 1}`,
  name,
  rarity: 'Blook',
  imageUrl: `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(name)}`,
})));

const avatarCatalog = blookCatalog;

const remoteSetCache = new Map();
const games = new Map();

const TOPIC_TTL_MS = 15 * 60 * 1000;
const COUNTRIES_TTL_MS = 60 * 60 * 1000;
const IMAGE_SEARCH_TTL_MS = 6 * 60 * 60 * 1000;
let topicCache = { expiresAt: 0, topics: [] };
let countriesCache = { expiresAt: 0, countries: [] };
const imageSearchCache = new Map();

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LOG_LEVEL = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const ACTIVE_LOG_LEVEL = LOG_LEVELS[LOG_LEVEL] ? LOG_LEVEL : 'info';
const MAX_LOG_CHARS = Math.max(200, Math.min(Number(process.env.LOG_MAX_CHARS) || 1800, 20_000));
const IMAGE_FALLBACK_LOG_LEVEL = String(process.env.IMAGE_FALLBACK_LOG_LEVEL || 'debug').toLowerCase();
const LOG_COLOR_MODE = String(process.env.LOG_COLOR || 'auto').toLowerCase();

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function shouldUseLogColor() {
  if (LOG_COLOR_MODE === 'off' || process.env.NO_COLOR !== undefined) return false;
  if (LOG_COLOR_MODE === 'on') return true;
  return Boolean(process.stdout?.isTTY || process.stderr?.isTTY || Number(process.env.FORCE_COLOR || 0) > 0);
}

const USE_LOG_COLOR = shouldUseLogColor();

function colorize(text, colorCode) {
  if (!USE_LOG_COLOR || !colorCode) return text;
  return `${colorCode}${text}${ANSI.reset}`;
}

function colorForLevel(level) {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'debug') return ANSI.cyan;
  if (normalized === 'info') return ANSI.green;
  if (normalized === 'warn') return ANSI.yellow;
  if (normalized === 'error') return ANSI.red;
  return '';
}

function shouldLog(level) {
  const wanted = LOG_LEVELS[String(level || '').toLowerCase()] || LOG_LEVELS.info;
  return wanted >= LOG_LEVELS[ACTIVE_LOG_LEVEL];
}

function truncateLogString(value, maxChars = MAX_LOG_CHARS) {
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
  const stampPart = colorize(`[${stamp}]`, ANSI.dim);
  const levelPart = colorize(`[${levelText}]`, levelColor);
  const messagePart = colorize(String(message || ''), levelColor);
  const metaPart = meta === undefined ? '' : ` ${colorize(safeLogMeta(meta), ANSI.dim)}`;
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
  const level = IMAGE_FALLBACK_LOG_LEVEL === 'info' ? 'info' : 'debug';
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
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
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
  return blookCatalog.find((blook) => blook.id === target) || null;
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

function requestJson(url, options = {}, depth = 0) {
  return new Promise((resolve, reject) => {
    const {
      method = 'GET',
      headers = {},
      body = null,
      timeoutMs = 10_000,
      maxRedirects = 4,
      allowStatusCodes = [],
    } = options;
    const startedAt = Date.now();
    const safeUrl = sanitizeUrlForLog(url);
    logDebug('remote.json.start', {
      method,
      url: safeUrl,
      timeoutMs,
      bodyBytes: body ? Buffer.byteLength(String(body)) : 0,
    });
    const client = String(url).startsWith('http://') ? http : https;
    const request = client.request(
      url,
      {
        method,
        headers: {
          'user-agent': 'greenit/3.0',
          ...headers,
        },
      },
      (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (depth >= maxRedirects) {
            logWarn('remote.json.redirect_limit', {
              method,
              url: safeUrl,
              statusCode: res.statusCode,
              location: sanitizeUrlForLog(res.headers.location),
              depth,
            });
            reject(new Error(`Remote redirect limit exceeded (${res.statusCode})`));
            return;
          }
          const nextUrl = new URL(res.headers.location, url).toString();
          logDebug('remote.json.redirect', {
            method,
            from: safeUrl,
            to: sanitizeUrlForLog(nextUrl),
            statusCode: res.statusCode,
            depth,
          });
          requestJson(nextUrl, options, depth + 1).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          if (allowStatusCodes.includes(res.statusCode)) {
            logDebug('remote.json.allowed_status', {
              method,
              url: safeUrl,
              statusCode: res.statusCode,
              durationMs: Date.now() - startedAt,
            });
            resolve(null);
            return;
          }
          const sample = String(data || '').slice(0, 220);
          logWarn('remote.json.http_error', {
            method,
            url: safeUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
            sample,
          });
          reject(new Error(`Remote request failed (${res.statusCode})${sample ? `: ${sample}` : ''}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          logDebug('remote.json.success', {
            method,
            url: safeUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
            bytes: Buffer.byteLength(data),
          });
          resolve(parsed);
        } catch {
          logWarn('remote.json.parse_error', {
            method,
            url: safeUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
            sample: truncateLogString(data, 220),
          });
          reject(new Error('Remote response is not JSON'));
        }
      });
      }
    );

    if (body) request.write(body);
    request.end();

    request.on('error', (error) => {
      logWarn('remote.json.request_error', {
        method,
        url: safeUrl,
        durationMs: Date.now() - startedAt,
        error: error.message,
      });
      reject(error);
    });
    request.setTimeout(timeoutMs, () => {
      logWarn('remote.json.timeout', {
        method,
        url: safeUrl,
        timeoutMs,
      });
      request.destroy(new Error('Remote request timed out'));
    });
  });
}

function requestText(url, options = {}, depth = 0) {
  return new Promise((resolve, reject) => {
    const {
      method = 'GET',
      headers = {},
      body = null,
      timeoutMs = 10_000,
      maxRedirects = 4,
      allowStatusCodes = [],
    } = options;
    const startedAt = Date.now();
    const safeUrl = sanitizeUrlForLog(url);
    logDebug('remote.text.start', {
      method,
      url: safeUrl,
      timeoutMs,
      bodyBytes: body ? Buffer.byteLength(String(body)) : 0,
    });
    const client = String(url).startsWith('http://') ? http : https;
    const request = client.request(
      url,
      {
        method,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (depth >= maxRedirects) {
              logWarn('remote.text.redirect_limit', {
                method,
                url: safeUrl,
                statusCode: res.statusCode,
                location: sanitizeUrlForLog(res.headers.location),
                depth,
              });
              reject(new Error(`Remote redirect limit exceeded (${res.statusCode})`));
              return;
            }
            const nextUrl = new URL(res.headers.location, url).toString();
            logDebug('remote.text.redirect', {
              method,
              from: safeUrl,
              to: sanitizeUrlForLog(nextUrl),
              statusCode: res.statusCode,
              depth,
            });
            requestText(nextUrl, options, depth + 1).then(resolve).catch(reject);
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            if (allowStatusCodes.includes(res.statusCode)) {
              logDebug('remote.text.allowed_status', {
                method,
                url: safeUrl,
                statusCode: res.statusCode,
                durationMs: Date.now() - startedAt,
              });
              resolve('');
              return;
            }
            const sample = String(data || '').slice(0, 220);
            logWarn('remote.text.http_error', {
              method,
              url: safeUrl,
              statusCode: res.statusCode,
              durationMs: Date.now() - startedAt,
              sample,
            });
            reject(new Error(`Remote request failed (${res.statusCode})${sample ? `: ${sample}` : ''}`));
            return;
          }
          logDebug('remote.text.success', {
            method,
            url: safeUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
            bytes: Buffer.byteLength(data),
          });
          resolve(String(data || ''));
        });
      }
    );

    if (body) request.write(body);
    request.end();

    request.on('error', (error) => {
      logWarn('remote.text.request_error', {
        method,
        url: safeUrl,
        durationMs: Date.now() - startedAt,
        error: error.message,
      });
      reject(error);
    });
    request.setTimeout(timeoutMs, () => {
      logWarn('remote.text.timeout', {
        method,
        url: safeUrl,
        timeoutMs,
      });
      request.destroy(new Error('Remote request timed out'));
    });
  });
}

function requestBinary(url, options = {}, depth = 0) {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, body = null, timeoutMs = 12_000, maxBytes = 8_000_000 } = options;
    const target = normalizeAbsoluteHttpUrl(url);
    if (!target) {
      reject(new Error('Invalid URL'));
      return;
    }
    if (depth > 4) {
      reject(new Error('Too many redirects'));
      return;
    }

    const startedAt = Date.now();
    const safeUrl = sanitizeUrlForLog(target);
    if (depth === 0) {
      logDebug('remote.binary.start', {
        method,
        url: safeUrl,
        timeoutMs,
        maxBytes,
      });
    }
    const client = target.startsWith('http://') ? http : https;
    const request = client.request(
      target,
      {
        method,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          ...headers,
        },
      },
      (res) => {
        const status = Number(res.statusCode) || 0;
        const location = String(res.headers.location || '').trim();
        if (status >= 300 && status < 400 && location) {
          const nextUrl = new URL(location, target).toString();
          logDebug('remote.binary.redirect', {
            method,
            from: safeUrl,
            to: sanitizeUrlForLog(nextUrl),
            statusCode: status,
            depth,
          });
          res.resume();
          requestBinary(nextUrl, options, depth + 1).then(resolve).catch(reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          logWarn('remote.binary.http_error', {
            method,
            url: safeUrl,
            statusCode: status,
            depth,
            durationMs: Date.now() - startedAt,
          });
          reject(new Error(`Remote request failed (${status})`));
          return;
        }

        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy(new Error('Remote image too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          logDebug('remote.binary.success', {
            method,
            url: safeUrl,
            statusCode: status,
            bytes: size,
            depth,
            durationMs: Date.now() - startedAt,
          });
          resolve({
            data: Buffer.concat(chunks),
            contentType: String(res.headers['content-type'] || '').trim(),
            finalUrl: target,
          });
        });
      }
    );

    if (body) request.write(body);
    request.end();

    request.on('error', (error) => {
      logWarn('remote.binary.request_error', {
        method,
        url: safeUrl,
        depth,
        durationMs: Date.now() - startedAt,
        error: error.message,
      });
      reject(error);
    });
    request.setTimeout(timeoutMs, () => {
      logWarn('remote.binary.timeout', {
        method,
        url: safeUrl,
        depth,
        timeoutMs,
      });
      request.destroy(new Error('Remote request timed out'));
    });
  });
}

function fetchJson(url, options = {}) {
  return requestJson(url, options);
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

function normalizeImageTheme(value) {
  const theme = String(value || 'auto').trim().toLowerCase();
  if (theme === 'logos' || theme === 'flags' || theme === 'auto') return theme;
  return 'auto';
}

function inferImageContentType(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith('.png')) return 'image/png';
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
    if (pathname.endsWith('.webp')) return 'image/webp';
    if (pathname.endsWith('.gif')) return 'image/gif';
    if (pathname.endsWith('.svg')) return 'image/svg+xml';
  } catch {
    return '';
  }
  return '';
}

function isWikimediaHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('wikimedia.org') || host.endsWith('wikipedia.org');
  } catch {
    return false;
  }
}

function getGoogleSearchConfig() {
  const apiKey = String(process.env.GOOGLE_CSE_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  const cx = String(process.env.GOOGLE_CSE_CX || process.env.GOOGLE_CX || '').trim();
  if (!apiKey || !cx) return null;
  return { apiKey, cx };
}

function decodeGoogleEscapedUrl(value) {
  return String(value || '')
    .replace(/\\u003d/g, '=')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim();
}

function isGoogleOwnedImageHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('google.com') || host.endsWith('gstatic.com');
  } catch {
    return false;
  }
}

function unwrapGoogleRedirectUrl(value) {
  const absolute = normalizeAbsoluteHttpUrl(value);
  if (!absolute) return null;
  try {
    const parsed = new URL(absolute);
    const candidates = [
      parsed.searchParams.get('imgurl'),
      parsed.searchParams.get('url'),
      parsed.searchParams.get('q'),
    ];
    for (const candidate of candidates) {
      const unwrapped = normalizeAbsoluteHttpUrl(candidate);
      if (unwrapped) return unwrapped;
    }
    return absolute;
  } catch {
    return absolute;
  }
}

function extractGoogleImageCandidatesFromHtml(html) {
  const text = String(html || '');
  const found = [];

  const ouMatches = text.matchAll(/"ou":"(https?:\\\/\\\/[^"]+)"/g);
  for (const match of ouMatches) {
    found.push(decodeGoogleEscapedUrl(match[1]));
  }

  const imgUrlMatches = text.matchAll(/imgurl=([^&"]+)/g);
  for (const match of imgUrlMatches) {
    try {
      found.push(decodeURIComponent(match[1]));
    } catch {
      found.push(String(match[1]));
    }
  }

  const directMatches = text.matchAll(/"(https?:\/\/[^"]+\.(?:png|jpe?g|webp|gif|svg)(?:\?[^"]*)?)"/gi);
  for (const match of directMatches) {
    found.push(decodeGoogleEscapedUrl(match[1]));
  }

  const normalized = uniqStrings(
    found
      .map((url) => decodeGoogleEscapedUrl(url))
      .map((url) => unwrapGoogleRedirectUrl(url))
      .map((url) => normalizeAbsoluteHttpUrl(url))
      .filter((url) => url && !/^data:/i.test(url))
  );

  const nonGoogle = normalized.filter((url) => !isGoogleOwnedImageHost(url));
  return nonGoogle;
}

function getImageSearchCandidates(question, imageTheme) {
  const priority = [];
  const candidates = [];
  const googleImagePrompt = String(question?.googleImagePrompt || question?.imagePrompt || '').trim();
  const q = String(question?.q || '').trim();
  const answers = Array.isArray(question?.answers) ? question.answers : [];
  const correct = Number.isInteger(question?.correct) ? question.correct : -1;
  const correctAnswer = correct >= 0 && correct < answers.length ? String(answers[correct] || '').trim() : '';

  if (googleImagePrompt) priority.push(googleImagePrompt);

  const signal = `${googleImagePrompt} ${q}`.toLowerCase();
  const wantsLogo = imageTheme === 'logos' || /logo|brand|company|corporate/i.test(signal);
  const wantsFlag = imageTheme === 'flags' || /flag|country|nation/i.test(signal);

  if (correctAnswer) {
    if (wantsLogo) {
      priority.push(`${correctAnswer} official logo`);
      priority.push(`${correctAnswer} logo png transparent`);
      candidates.push(`${correctAnswer} logo`);
    }
    if (wantsFlag) {
      priority.push(`${correctAnswer} national flag`);
      candidates.push(`${correctAnswer} flag`);
    }
    candidates.push(correctAnswer);
  }

  if (q) {
    const questionText = q.replace(/\?+$/, '').slice(0, 100);
    if (wantsLogo) candidates.push(`${questionText} logo`);
    else if (wantsFlag) candidates.push(`${questionText} flag`);
    else candidates.push(questionText);
  }

  return uniqStrings([...priority, ...candidates]).slice(0, 8);
}

function normalizeWikipediaTitleCandidate(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  text = text
    .replace(/^what\s+is\s+the\s+/i, '')
    .replace(/\blogo\s+of\b/gi, '')
    .replace(/\b(official|logo|png|transparent|vector|svg|icon|brand|company|national|flag)\b/gi, '')
    .replace(/[(){}\[\]]/g, ' ')
    .replace(/[.,!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function getWikipediaTitleCandidates(query) {
  const raw = String(query || '').trim();
  if (!raw) return [];

  const cleaned = normalizeWikipediaTitleCandidate(raw);
  const alt = cleaned.replace(/\s+/g, '_').trim();
  return uniqStrings([cleaned, alt, raw]).filter(Boolean).slice(0, 4);
}

const logoDomainOverrides = {
  "facebook's meta": 'meta.com',
  'meta': 'meta.com',
  "mcdonald's": 'mcdonalds.com',
  'mcdonalds': 'mcdonalds.com',
  'coca-cola': 'coca-cola.com',
  'cocacola': 'coca-cola.com',
  'google': 'google.com',
  'facebook': 'facebook.com',
  'amazon': 'amazon.com',
  'microsoft': 'microsoft.com',
  'apple': 'apple.com',
  'nike': 'nike.com',
  'adidas': 'adidas.com',
  'toyota': 'toyota.com',
  'starbucks': 'starbucks.com',
};

function normalizeLogoBrand(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getLogoDomainCandidates(question) {
  const candidates = [];
  const q = String(question?.q || '').trim();
  const answers = Array.isArray(question?.answers) ? question.answers : [];
  const correct = Number.isInteger(question?.correct) ? question.correct : -1;
  const correctAnswer = correct >= 0 && correct < answers.length ? String(answers[correct] || '').trim() : '';

  if (correctAnswer) candidates.push(correctAnswer);
  const match = q.match(/logo\s+of\s+(.+?)(?:\?|$)/i);
  if (match) candidates.push(String(match[1] || '').trim());

  const normalized = uniqStrings(candidates);
  const domains = [];
  for (const brand of normalized) {
    const clean = normalizeLogoBrand(brand);
    if (!clean) continue;
    const direct = logoDomainOverrides[clean];
    if (direct) {
      domains.push(direct);
      continue;
    }
    const compact = clean.replace(/\s+/g, '');
    if (logoDomainOverrides[compact]) {
      domains.push(logoDomainOverrides[compact]);
      continue;
    }
    const firstToken = clean.split(' ')[0];
    if (firstToken) {
      domains.push(`${firstToken}.com`);
      domains.push(`${firstToken}.org`);
    }
  }
  return uniqStrings(domains).slice(0, 6);
}

async function searchLogoByDomain(question) {
  const domains = getLogoDomainCandidates(question);
  for (const domain of domains) {
    const candidate = `https://logo.clearbit.com/${encodeURIComponent(domain)}`;
    const usable = await probeImageUrl(candidate);
    if (usable) return usable;
  }
  return null;
}

function probeImageUrl(url, depth = 0) {
  return new Promise((resolve) => {
    const absolute = normalizeAbsoluteHttpUrl(url);
    if (!absolute) return resolve(null);
    if (depth > 4) return resolve(null);

    let finished = false;
    const done = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
    };

    const client = absolute.startsWith('http://') ? http : https;
    const request = client.request(
      absolute,
      {
        method: 'GET',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          range: 'bytes=0-0',
          referer: 'https://www.google.com/',
        },
      },
      (res) => {
        const status = Number(res.statusCode) || 0;
        const location = String(res.headers.location || '').trim();
        if (status >= 300 && status < 400 && location) {
          const nextUrl = normalizeAbsoluteHttpUrl(new URL(location, absolute).toString());
          res.resume();
          if (!nextUrl) return done(null);
          probeImageUrl(nextUrl, depth + 1).then(done).catch(() => done(null));
          return;
        }

        const contentType = String(res.headers['content-type'] || '').toLowerCase();
        const imageByHeader = /^image\//i.test(contentType);
        const ok = status >= 200 && status < 300 && imageByHeader;
        res.destroy();
        if (!ok) {
          logDebug('image.probe.reject', {
            url: sanitizeUrlForLog(absolute),
            statusCode: status,
            contentType,
          });
        }
        return done(ok ? absolute : null);
      }
    );

    request.on('error', () => done(null));
    request.setTimeout(8_000, () => request.destroy(new Error('probe timeout')));
    request.end();
  });
}

async function searchGoogleImage(query) {
  const key = `google:${String(query || '').trim().toLowerCase()}`;
  if (!key || key === 'google:') return null;

  const cached = imageSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const cfg = getGoogleSearchConfig();

  let url = null;

  if (cfg) {
    const endpoint =
      'https://www.googleapis.com/customsearch/v1' +
      `?key=${encodeURIComponent(cfg.apiKey)}` +
      `&cx=${encodeURIComponent(cfg.cx)}` +
      '&searchType=image&num=1&safe=active' +
      `&q=${encodeURIComponent(query)}`;
    try {
      const payload = await fetchJson(endpoint);
      const first = Array.isArray(payload?.items) ? payload.items[0] : null;
      const candidate = normalizeAbsoluteHttpUrl(first?.link);
      if (candidate) {
        const usable = await probeImageUrl(candidate);
        if (usable) url = usable;
      }
    } catch {
      url = null;
    }
  }

  if (!url) {
    const scrapeUrl =
      `https://www.google.com/search?tbm=isch&hl=en&safe=active&num=1&q=${encodeURIComponent(query)}`;
    try {
      const html = await requestText(scrapeUrl, {
        timeoutMs: 12_000,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en-US,en;q=0.8',
        },
      });
      const candidates = extractGoogleImageCandidatesFromHtml(html);
      for (const candidate of candidates.slice(0, 8)) {
        const usable = await probeImageUrl(candidate);
        if (usable) {
          url = usable;
          break;
        }
      }
    } catch {
      url = null;
    }
  }

  imageSearchCache.set(key, { url, expiresAt: Date.now() + IMAGE_SEARCH_TTL_MS });
  return url;
}

async function searchWikipediaSummaryImage(query) {
  const key = `wikisummary:${String(query || '').trim().toLowerCase()}`;
  if (!key || key === 'wikisummary:') return null;

  const cached = imageSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  let url = null;
  const titleCandidates = getWikipediaTitleCandidates(query);
  for (const title of titleCandidates) {
    const endpoint = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    try {
      const payload = await fetchJson(endpoint, { allowStatusCodes: [404] });
      if (!payload) continue;
      const directUrl = normalizeAbsoluteHttpUrl(payload?.originalimage?.source || payload?.thumbnail?.source);
      if (!directUrl) continue;
      const usable = await probeImageUrl(directUrl);
      if (usable) {
        url = usable;
        logDebug('images.wikipedia.summary_hit', {
          query: truncateLogString(query, 120),
          title,
          imageUrl: sanitizeUrlForLog(url),
        });
        break;
      }
    } catch (error) {
      logDebug('images.wikipedia.summary_miss', {
        query: truncateLogString(query, 120),
        title,
        error: error.message,
      });
    }
  }

  imageSearchCache.set(key, { url, expiresAt: Date.now() + IMAGE_SEARCH_TTL_MS });
  return url;
}

async function searchWikimediaImage(query) {
  const key = String(query || '').trim().toLowerCase();
  if (!key) return null;

  const cached = imageSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const endpoint =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search` +
    `&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(query)}` +
    `&prop=imageinfo&iiprop=url|mime`;

  let url = null;
  try {
    const payload = await fetchJson(endpoint);
    const pages = Object.values(payload?.query?.pages || {});
    for (const page of pages) {
      const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
      const imageUrl = String(info?.url || '').trim();
      const mime = String(info?.mime || '').trim().toLowerCase();
      const looksImageMime = /^image\/(svg\+xml|png|jpe?g|webp|gif)$/i.test(mime);
      const looksImageUrl = /\.(svg|png|jpe?g|webp|gif)(?:$|[?#])/i.test(imageUrl);
      if (isAbsoluteHttpUrl(imageUrl) && (looksImageMime || looksImageUrl)) {
        url = imageUrl;
        break;
      }
    }
  } catch {
    url = null;
  }

  imageSearchCache.set(key, { url, expiresAt: Date.now() + IMAGE_SEARCH_TTL_MS });
  return url;
}

async function applyGeneratedImages(questions, imageTheme) {
  const resolved = [];
  const theme = normalizeImageTheme(imageTheme);
  let mappedCount = 0;
  let unresolvedCount = 0;
  logInfo('images.resolve.start', { questions: questions.length, theme });
  for (const question of questions) {
    let imageUrl = null;
    if (theme === 'logos') {
      imageUrl = await searchLogoByDomain(question);
      if (imageUrl) {
        logDebug('images.resolve.logo_domain_hit', {
          question: truncateLogString(question.q, 90),
          imageUrl: sanitizeUrlForLog(imageUrl),
        });
      }
    }

    const candidates = getImageSearchCandidates(question, theme);
    logDebug('images.resolve.candidates', {
      question: truncateLogString(question.q, 90),
      candidates: candidates.slice(0, 5),
    });
    if (!imageUrl) {
      for (const candidate of candidates) {
        imageUrl = await searchGoogleImage(candidate);
        if (!imageUrl) {
          imageUrl = await searchWikipediaSummaryImage(candidate);
        }
        if (!imageUrl) {
          const wiki = await searchWikimediaImage(candidate);
          imageUrl = wiki ? await probeImageUrl(wiki) : null;
        }
        if (imageUrl) break;
      }
    }

    if (imageUrl) mappedCount += 1;
    else unresolvedCount += 1;
    logDebug('images.resolve.result', {
      question: truncateLogString(question.q, 90),
      resolved: Boolean(imageUrl),
      imageUrl: imageUrl ? sanitizeUrlForLog(imageUrl) : null,
    });

    resolved.push({
      ...question,
      ...(imageUrl ? { imageUrl } : {}),
    });
  }
  logInfo('images.resolve.done', {
    total: questions.length,
    mappedCount,
    unresolvedCount,
    theme,
  });
  return resolved;
}

async function fetchOpenTdbTopics() {
  const remote = await fetchJson('https://opentdb.com/api_category.php');
  const categories = Array.isArray(remote?.trivia_categories) ? remote.trivia_categories : [];
  return categories
    .map((item) => {
      const category = Number(item?.id);
      const name = String(item?.name || '').trim();
      if (!Number.isInteger(category) || !name) return null;
      return {
        id: `opentdb:${category}`,
        title: `${name} (OpenTDB)`,
        description: 'Live category from Open Trivia DB',
        source: 'OpenTDB',
        provider: 'opentdb',
        category,
        questionCount: 30,
      };
    })
    .filter(Boolean);
}

function flattenTriviaApiCategoryPayload(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return item.id || item.slug || item.name || '';
        return '';
      })
      .filter(Boolean);
  }

  if (typeof raw !== 'object') return [];

  const categories = [];
  const stack = [raw];

  while (stack.length) {
    const next = stack.pop();
    if (!next || typeof next !== 'object') continue;
    for (const [key, value] of Object.entries(next)) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (typeof entry === 'string') categories.push(entry);
          else if (entry && typeof entry === 'object') {
            categories.push(entry.id || entry.slug || entry.name || '');
          }
        }
        continue;
      }

      if (value && typeof value === 'object') {
        if (value.id || value.slug || value.name) {
          categories.push(value.id || value.slug || value.name);
        } else {
          stack.push(value);
        }
        continue;
      }

      if (typeof value === 'string' && /^[a-z0-9_ -]+$/i.test(value)) {
        categories.push(value);
      } else if (/^[a-z0-9_ -]+$/i.test(key)) {
        categories.push(key);
      }
    }
  }

  return categories;
}

async function fetchTriviaApiTopics() {
  const remote = await fetchJson('https://the-trivia-api.com/v2/categories');
  const flat = uniqStrings(flattenTriviaApiCategoryPayload(remote));
  const topics = flat
    .map((raw) => {
      const slug = toSlug(raw);
      if (!slug) return null;
      return {
        id: `thetriviaapi:${slug}`,
        title: `${titleCase(slug)} (The Trivia API)`,
        description: 'Live category from The Trivia API',
        source: 'The Trivia API',
        provider: 'thetriviaapi',
        categorySlug: slug,
        questionCount: 20,
      };
    })
    .filter(Boolean);

  const mixed = {
    id: 'thetriviaapi:mixed',
    title: 'Mixed Trivia (The Trivia API)',
    description: 'Randomized categories from The Trivia API',
    source: 'The Trivia API',
    provider: 'thetriviaapi',
    categorySlug: null,
    questionCount: 20,
  };

  const byId = new Map([[mixed.id, mixed]]);
  topics.forEach((topic) => {
    if (!byId.has(topic.id)) byId.set(topic.id, topic);
  });
  return [...byId.values()];
}

async function fetchJserviceTopics() {
  const remote = await fetchJson('https://jservice.io/api/categories?count=100');
  const categories = Array.isArray(remote) ? remote : [];
  return categories
    .map((item) => {
      const categoryId = Number(item?.id);
      const title = String(item?.title || '').trim();
      const clueCount = Number(item?.clues_count) || 0;
      if (!Number.isInteger(categoryId) || !title || clueCount < 5) return null;
      return {
        id: `jservice:${categoryId}`,
        title: `${titleCase(title)} (jService)`,
        description: `Jeopardy-style clues from jService (${clueCount} clues)`,
        source: 'jService',
        provider: 'jservice',
        categoryId,
        questionCount: Math.min(25, Math.max(10, clueCount)),
      };
    })
    .filter(Boolean);
}

async function fetchCountries() {
  if (countriesCache.countries.length && countriesCache.expiresAt > Date.now()) {
    logDebug('countries.cache.hit', { count: countriesCache.countries.length });
    return countriesCache.countries;
  }

  const remote = await fetchJson('https://restcountries.com/v3.1/all?fields=name,flags,region');
  const countries = (Array.isArray(remote) ? remote : [])
    .map((item) => {
      const name = String(item?.name?.common || '').trim();
      const flagUrl = String(item?.flags?.png || item?.flags?.svg || '').trim();
      const region = String(item?.region || '').trim() || 'Other';
      if (!name || !flagUrl || !/^https?:\/\//i.test(flagUrl)) return null;
      return { name, flagUrl, region };
    })
    .filter(Boolean);

  countriesCache = {
    expiresAt: Date.now() + COUNTRIES_TTL_MS,
    countries,
  };
  logInfo('countries.cache.refresh', { count: countries.length });

  return countries;
}

async function fetchFlagTopics() {
  const countries = await fetchCountries();
  const regions = uniqStrings(countries.map((c) => c.region));
  const topics = [
    {
      id: 'flagquiz:all',
      title: 'World Flags (Logo Style)',
      description: 'Image-based quizzes generated live from country flag data',
      source: 'REST Countries',
      provider: 'flagquiz',
      region: 'all',
      questionCount: 20,
    },
  ];

  regions.forEach((region) => {
    if (region.toLowerCase() === 'other') return;
    topics.push({
      id: `flagquiz:${toSlug(region)}`,
      title: `${region} Flags (Logo Style)`,
      description: `Image-based flag quiz for ${region}`,
      source: 'REST Countries',
      provider: 'flagquiz',
      region,
      questionCount: 20,
    });
  });

  return topics;
}

async function fetchDynamicTopics() {
  if (topicCache.topics.length && topicCache.expiresAt > Date.now()) {
    logDebug('topics.cache.hit', { count: topicCache.topics.length });
    return topicCache.topics;
  }

  const requests = [
    fetchOpenTdbTopics().catch(() => []),
    fetchTriviaApiTopics().catch(() => []),
    fetchJserviceTopics().catch(() => []),
    fetchFlagTopics().catch(() => []),
  ];

  const [opentdb, triviaApi, jservice, flags] = await Promise.all(requests);
  logInfo('topics.providers.result', {
    opentdb: opentdb.length,
    triviaApi: triviaApi.length,
    jservice: jservice.length,
    flags: flags.length,
  });
  const combined = [...opentdb, ...triviaApi, ...jservice, ...flags];
  const byId = new Map();
  combined.forEach((topic) => {
    if (!topic || !topic.id) return;
    if (!byId.has(topic.id)) byId.set(topic.id, topic);
  });

  const topics = [...byId.values()].sort((a, b) => {
    const sourceCompare = String(a.source).localeCompare(String(b.source));
    if (sourceCompare) return sourceCompare;
    return String(a.title).localeCompare(String(b.title));
  });

  if (topics.length) {
    topicCache = {
      expiresAt: Date.now() + TOPIC_TTL_MS,
      topics,
    };
    logInfo('topics.cache.refresh', { count: topics.length });
    return topics;
  }

  logWarn('topics.empty_return', { fallbackCount: (topicCache.topics || []).length });
  return topicCache.topics || [];
}

async function fetchOpenTdbQuestions(topic) {
  const params = new URLSearchParams({
    amount: String(topic.questionCount || 30),
    category: String(topic.category),
  });

  const remote = await fetchJson(`https://opentdb.com/api.php?${params.toString()}`);
  const results = Array.isArray(remote?.results) ? remote.results : [];
  return results
    .map((item) => {
      const questionText = decodeHtmlEntities(item?.question).trim();
      const correctAnswer = decodeHtmlEntities(item?.correct_answer).trim();
      const incorrect = Array.isArray(item?.incorrect_answers)
        ? item.incorrect_answers.map((ans) => decodeHtmlEntities(ans).trim())
        : [];
      const answers = shuffle(uniqStrings([correctAnswer, ...incorrect]));
      if (!questionText || answers.length < 2) return null;
      const correct = answers.findIndex((ans) => ans.toLowerCase() === correctAnswer.toLowerCase());
      if (correct < 0) return null;
      return {
        q: questionText,
        answers,
        correct,
      };
    })
    .filter(Boolean);
}

async function fetchTriviaApiQuestions(topic) {
  const params = new URLSearchParams({
    limit: String(topic.questionCount || 20),
    region: 'US',
  });

  if (topic.categorySlug) params.set('categories', topic.categorySlug);

  const remote = await fetchJson(`https://the-trivia-api.com/v2/questions?${params.toString()}`);
  const rows = Array.isArray(remote) ? remote : [];

  return rows
    .map((item) => {
      const q = decodeHtmlEntities(item?.question?.text || item?.question || '').trim();
      const correctAnswer = decodeHtmlEntities(item?.correctAnswer || '').trim();
      const incorrect = Array.isArray(item?.incorrectAnswers)
        ? item.incorrectAnswers.map((ans) => decodeHtmlEntities(ans).trim())
        : [];
      const answers = shuffle(uniqStrings([...incorrect, correctAnswer]));
      if (!q || !correctAnswer || answers.length < 2) return null;
      const correct = answers.findIndex((ans) => ans.toLowerCase() === correctAnswer.toLowerCase());
      if (correct < 0) return null;

      const imageUrl = String(item?.image || item?.media?.url || item?.question?.image || '').trim();
      return {
        q,
        answers,
        correct,
        imageUrl: /^https?:\/\//i.test(imageUrl) ? imageUrl : undefined,
      };
    })
    .filter(Boolean);
}

async function fetchJserviceQuestions(topic) {
  const remote = await fetchJson(`https://jservice.io/api/clues?category=${encodeURIComponent(topic.categoryId)}`);
  const clues = (Array.isArray(remote) ? remote : [])
    .map((item) => {
      const q = stripHtml(decodeHtmlEntities(item?.question));
      const answer = stripHtml(decodeHtmlEntities(item?.answer));
      if (!q || !answer) return null;
      return { q, answer };
    })
    .filter(Boolean);

  if (!clues.length) return [];

  const answerPool = uniqStrings(clues.map((clue) => clue.answer));
  const questions = clues
    .map((item) => {
      const decoys = shuffle(answerPool.filter((ans) => ans.toLowerCase() !== item.answer.toLowerCase())).slice(0, 3);
      const answers = shuffle(uniqStrings([item.answer, ...decoys]));
      if (answers.length < 2) return null;
      return {
        q: item.q,
        answers,
        correct: answers.findIndex((ans) => ans.toLowerCase() === item.answer.toLowerCase()),
      };
    })
    .filter((item) => item && item.correct >= 0);

  return shuffle(questions).slice(0, topic.questionCount || 20);
}

async function fetchFlagQuestions(topic) {
  const countries = await fetchCountries();
  if (countries.length < 4) return [];

  let pool = countries;
  if (topic.region && topic.region !== 'all') {
    pool = countries.filter((country) => country.region.toLowerCase() === String(topic.region).toLowerCase());
    if (pool.length < 4) pool = countries;
  }

  const picked = shuffle(pool).slice(0, Math.min(topic.questionCount || 20, pool.length));
  return picked
    .map((country) => {
      const decoys = shuffle(countries.filter((item) => item.name !== country.name)).slice(0, 3);
      const answers = shuffle(uniqStrings([country.name, ...decoys.map((item) => item.name)]));
      const correct = answers.findIndex((ans) => ans.toLowerCase() === country.name.toLowerCase());
      if (answers.length < 2 || correct < 0) return null;
      return {
        q: 'Which country does this flag belong to?',
        imageUrl: country.flagUrl,
        answers,
        correct,
      };
    })
    .filter(Boolean);
}

async function getRemoteSet(id) {
  if (!id) return null;
  if (remoteSetCache.has(id)) {
    const cached = remoteSetCache.get(id);
    logDebug('set.cache.hit', { setId: id, questionCount: cached?.questions?.length || 0 });
    return cached;
  }

  const topics = await fetchDynamicTopics();
  const topic = topics.find((item) => item.id === id);
  if (!topic) return null;
  logInfo('set.load.start', { setId: id, provider: topic.provider, title: topic.title });

  let questions = [];
  if (topic.provider === 'opentdb') {
    questions = await fetchOpenTdbQuestions(topic);
  } else if (topic.provider === 'thetriviaapi') {
    questions = await fetchTriviaApiQuestions(topic);
  } else if (topic.provider === 'jservice') {
    questions = await fetchJserviceQuestions(topic);
  } else if (topic.provider === 'flagquiz') {
    questions = await fetchFlagQuestions(topic);
  }

  if (!questions.length) return null;

  const set = {
    id: topic.id,
    title: topic.title,
    description: topic.description,
    source: topic.source,
    questions,
  };
  remoteSetCache.set(id, set);
  logInfo('set.load.success', { setId: id, provider: topic.provider, questionCount: questions.length });
  return set;
}

async function searchQuizSets(query) {
  const q = String(query || '').trim().toLowerCase();
  const topics = await fetchDynamicTopics();
  const maxResults = q ? 90 : 24;

  const sets = topics
    .filter((topic) => {
      if (!q) return true;
      return [topic.title, topic.description, topic.source].some((value) =>
        String(value || '').toLowerCase().includes(q)
      );
    })
    .slice(0, maxResults)
    .map((topic) => ({
      id: topic.id,
      title: topic.title,
      description: topic.description,
      source: topic.source,
      questionCount: topic.questionCount || 20,
    }));
  logDebug('sets.search', { query: q, totalTopics: topics.length, returned: sets.length });
  return sets;
}

function extractJsonString(text) {
  let value = String(text || '').trim();
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) value = fenced[1].trim();
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start >= 0 && end > start) value = value.slice(start, end + 1);
  return value;
}

function normalizeGeneratedQuestion(item) {
  if (!item || typeof item !== 'object') return null;

  let q = String(item.q || item.question || item.prompt || '').trim();
  if (!q) return null;

  const rawAnswers = Array.isArray(item.answers)
    ? item.answers
    : Array.isArray(item.options)
      ? item.options
      : [item.a, item.b, item.c, item.d].filter((entry) => entry !== undefined && entry !== null);
  const answers = uniqStrings(rawAnswers.map((entry) => String(entry || '').trim())).slice(0, 8);
  if (answers.length < 2) return null;

  const googleImagePrompt = String(
    item.googleImagePrompt || item.imagePrompt || item.image_search_prompt || item.googlePrompt || ''
  ).trim();
  const taggedPrompt = q.match(/\[gimg:([^\]]+)\]/i);
  let taggedGooglePrompt = '';
  if (taggedPrompt) {
    taggedGooglePrompt = String(taggedPrompt[1] || '').trim();
    q = q.replace(taggedPrompt[0], '').trim();
  }

  let correctAnswerText = '';
  if (Number.isInteger(item.correct) && item.correct >= 0 && item.correct < rawAnswers.length) {
    correctAnswerText = String(rawAnswers[item.correct] || '').trim();
  } else if (typeof item.correctAnswer === 'string') {
    correctAnswerText = item.correctAnswer.trim();
  } else if (Array.isArray(item.correctAnswers) && item.correctAnswers.length) {
    correctAnswerText = String(item.correctAnswers[0] || '').trim();
  } else if (typeof item.correct === 'string') {
    correctAnswerText = item.correct.trim();
  }

  let correct = -1;
  if (correctAnswerText) {
    correct = answers.findIndex((entry) => entry.toLowerCase() === correctAnswerText.toLowerCase());
  } else if (Number.isInteger(item.correct) && item.correct >= 0 && item.correct < answers.length) {
    correct = item.correct;
  }
  if (correct < 0) correct = 0;

  const shuffledAnswers = shuffle(
    answers.map((answer, index) => ({
      answer,
      correct: index === correct,
    }))
  );
  const randomizedAnswers = shuffledAnswers.map((entry) => entry.answer);
  const randomizedCorrect = shuffledAnswers.findIndex((entry) => entry.correct);

  return {
    q,
    answers: randomizedAnswers,
    correct: randomizedCorrect >= 0 ? randomizedCorrect : 0,
    googleImagePrompt: googleImagePrompt || taggedGooglePrompt || undefined,
  };
}

function normalizeGeneratedSet(raw, fallbackTitle, requestedCount) {
  const candidate = raw?.quiz || raw?.data || raw;
  if (!candidate || typeof candidate !== 'object') throw new Error('Groq did not return a valid quiz object.');

  const title = String(candidate.title || candidate.name || fallbackTitle || 'AI Quiz Set').trim();
  const rawQuestions = Array.isArray(candidate.questions)
    ? candidate.questions
    : Array.isArray(candidate.items)
      ? candidate.items
      : [];

  const questions = rawQuestions
    .map(normalizeGeneratedQuestion)
    .filter(Boolean)
    .slice(0, Math.max(1, Number(requestedCount) || 12));

  if (!questions.length) throw new Error('Groq response did not include usable questions.');

  return {
    id: `ai-${randomId()}`,
    title,
    description: 'Generated by Groq',
    source: 'Groq AI',
    questions,
  };
}

function parseQuizGeneratePayload(body) {
  if (!body || typeof body !== 'object') throw new Error('Expected request body object.');
  const prompt = String(body.prompt || body.topic || '').trim();
  if (!prompt) throw new Error('Prompt is required.');
  if (prompt.length < 4) throw new Error('Prompt is too short.');

  const questionCount = Math.max(3, Math.min(40, Number(body.questionCount) || 12));
  const difficultyRaw = String(body.difficulty || 'mixed').trim().toLowerCase();
  const difficulty = ['easy', 'medium', 'hard', 'mixed'].includes(difficultyRaw) ? difficultyRaw : 'mixed';
  const withImages =
    body.withImages === true ||
    String(body.withImages || '').trim().toLowerCase() === 'true' ||
    body.includeImages === true ||
    String(body.includeImages || '').trim().toLowerCase() === 'true';
  const imageTheme = normalizeImageTheme(body.imageTheme);

  return { prompt, questionCount, difficulty, withImages, imageTheme };
}

async function generateQuizSetWithGroq({ prompt, questionCount, difficulty, withImages, imageTheme }) {
  const apiKey = "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"
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured on the server.');
  const startedAt = Date.now();
  logInfo('ai.generate.start', {
    prompt: truncateLogString(prompt, 120),
    questionCount,
    difficulty,
    withImages,
    imageTheme,
  });

  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const systemPrompt =
    'You are a quiz generator. Return valid JSON only with this shape: ' +
    '{"title":"string","questions":[{"q":"string","answers":["a","b","c","d"],"correct":0,"googleImagePrompt":"optional image search prompt"}]}. ' +
    'Rules: 2-8 unique answers per question, correct is a zero-based answer index, no markdown.';
  const userPrompt = [
    `Topic/instructions: ${prompt}`,
    `Question count: ${questionCount}`,
    `Difficulty: ${difficulty}`,
    'Audience: classroom-friendly.',
    withImages
      ? `Include googleImagePrompt for each question so server can fetch the first Google image result. Visual style: ${normalizeImageTheme(imageTheme)}.`
      : 'Do not include any image fields.',
    'Output JSON only.',
  ].join('\n');

  const remote = await requestJson('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    timeoutMs: 30_000,
    body: JSON.stringify({
      model,
      temperature: 0.5,
      max_tokens: 3200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  const content = String(remote?.choices?.[0]?.message?.content || '').trim();
  if (!content) throw new Error('Groq returned an empty response.');

  let parsed;
  try {
    parsed = JSON.parse(extractJsonString(content));
  } catch {
    throw new Error('Groq response was not valid JSON.');
  }

  const normalized = normalizeGeneratedSet(parsed, `AI Quiz: ${prompt.slice(0, 44)}`, questionCount);
  const themed = normalizeImageTheme(imageTheme);
  const questions = withImages ? await applyGeneratedImages(normalized.questions, themed) : normalized.questions;
  logInfo('ai.generate.success', {
    title: normalized.title,
    questionCount: questions.length,
    withImages,
    imageTheme: themed,
    durationMs: Date.now() - startedAt,
  });

  return {
    ...normalized,
    description: withImages ? 'Generated by Groq with images' : normalized.description,
    questions: questions.map((question) => ({
      q: question.q,
      answers: question.answers,
      correct: question.correct,
      ...(question.imageUrl ? { imageUrl: question.imageUrl } : {}),
    })),
  };
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length < 1) return 'Custom sets need at least 1 question.';

  for (const question of questions) {
    if (!question || typeof question.q !== 'string' || !question.q.trim()) {
      return 'Each question needs text.';
    }

    if (question.imageUrl !== undefined && question.imageUrl !== null) {
      const imageUrl = String(question.imageUrl).trim();
      if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
        return 'Question image URL must be absolute (http/https).';
      }
    }

    if (!Array.isArray(question.answers) || question.answers.length < 2 || question.answers.length > 8) {
      return 'Each question needs between 2 and 8 answers.';
    }

    const cleanAnswers = question.answers.map((ans) => String(ans || '').trim()).filter(Boolean);
    if (cleanAnswers.length !== question.answers.length) {
      return 'Answers cannot be blank.';
    }

    const uniqueCount = new Set(cleanAnswers.map((ans) => ans.toLowerCase())).size;
    if (uniqueCount !== cleanAnswers.length) {
      return 'Answers for each question must be unique.';
    }

    if (!Number.isInteger(question.correct) || question.correct < 0 || question.correct >= question.answers.length) {
      return 'Each question needs a valid correct index.';
    }
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

  const gameType = body.gameType || 'timed';
  if (!['question', 'timed', 'hybrid'].includes(gameType)) return 'Game type must be question, timed, or hybrid.';
  const gameTypeFamily = body.gameTypeFamily || 'goldquest';
  if (!['goldquest', 'assemble'].includes(gameTypeFamily)) return 'Type must be goldquest or assemble.';

  if (body.maxPlayers !== undefined) {
    const maxPlayers = Number(body.maxPlayers);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 120) {
      return 'Max players must be between 1 and 120.';
    }
  }

  if (body.feedbackDelaySec !== undefined) {
    const delay = Number(body.feedbackDelaySec);
    if (!Number.isFinite(delay) || delay < 0 || delay > 5) {
      return 'Feedback delay must be between 0 and 5 seconds.';
    }
  }

  if (body.timeLimitSec !== undefined) {
    const timeLimitSec = Number(body.timeLimitSec);
    if (!Number.isFinite(timeLimitSec) || timeLimitSec < 60 || timeLimitSec > 1800) {
      return 'Time must be between 1 and 30 minutes.';
    }
  }

  return null;
}

function validateJoinPayload(body) {
  if (!body || typeof body !== 'object') return 'Expected request body object.';
  if (!body.playerName || typeof body.playerName !== 'string') return 'Player name is required.';
  if (!String(body.playerName).trim()) return 'Player name is required.';
  return null;
}

async function resolveSet({ setId, customSet }) {
  if (customSet) {
    return {
      id: `custom-${randomId()}`,
      title: customSet.title,
      description: customSet.description || 'Custom local set',
      source: 'Custom local set',
      questions: customSet.questions.map((item) => ({
        q: String(item.q || '').trim(),
        answers: item.answers.map((ans) => String(ans || '').trim()),
        correct: item.correct,
        imageUrl: item.imageUrl ? String(item.imageUrl).trim() : undefined,
      })),
    };
  }

  if (!setId) return null;
  return getRemoteSet(setId);
}

async function createHostedGame({
  setId,
  customSet,
  gameTypeFamily,
  gameType,
  questionLimit,
  timeLimitSec,
  maxPlayers,
  feedbackDelaySec,
  shuffleQuestions,
}) {
  const selectedRaw = await resolveSet({ setId, customSet });
  if (!selectedRaw || !Array.isArray(selectedRaw.questions) || !selectedRaw.questions.length) {
    throw new Error('Selected set could not be loaded. Try another set or use the custom editor.');
  }
  logInfo('game.create.request', {
    setId: setId || null,
    customSet: Boolean(customSet),
    gameType,
    questionLimit,
    timeLimitSec,
    maxPlayers,
    feedbackDelaySec,
    shuffleQuestions: Boolean(shuffleQuestions),
    sourceTitle: selectedRaw.title,
    sourceQuestions: selectedRaw.questions.length,
  });

  const selected = {
    ...selectedRaw,
    questions: selectedRaw.questions.map((question) => ({
      q: question.q,
      answers: Array.isArray(question.answers) ? [...question.answers] : [],
      correct: question.correct,
      imageUrl: question.imageUrl,
    })),
  };

  let code;
  do code = randomCode(); while (games.has(code));

  const now = new Date().toISOString();
  const shouldShuffle = Boolean(shuffleQuestions);
  if (shouldShuffle && selected.questions.length > 1) {
    selected.questions = shuffle(selected.questions);
  }

  const modeSettings = {
    gameTypeFamily: gameTypeFamily || 'goldquest',
    gameType: gameType || 'timed',
    questionLimit: Math.max(1, Math.min(Number(questionLimit) || selected.questions.length, selected.questions.length)),
    timeLimitSec: Math.max(60, Math.min(Number(timeLimitSec) || 120, 1800)),
    maxPlayers: Math.max(1, Math.min(Number(maxPlayers) || 60, 120)),
    feedbackDelaySec: Math.max(0, Math.min(Number(feedbackDelaySec) || 1, 5)),
    shuffleQuestions: shouldShuffle,
  };

  const game = {
    code,
    hostPin: randomHostPin(),
    mode: modeSettings.gameTypeFamily === 'assemble' ? 'Block Builder' : 'Gold Quest',
    set: selected,
    state: 'lobby',
    settings: modeSettings,
    createdAt: now,
    startedAt: null,
    endsAt: null,
    endedAt: null,
    eventLog: [],
    players: [],
    puzzle: modeSettings.gameTypeFamily === 'assemble' ? createPuzzleState(selected) : null,
  };

  games.set(code, game);
  logInfo('game.create.success', {
    code,
    mode: game.mode,
    setTitle: game.set.title,
    questionLimit: game.settings.questionLimit,
    players: game.players.length,
  });
  return game;
}

function chestOptionLabel(option) {
  if (option.type === 'bonus_flat') return `+ ${option.value} Gold`;
  if (option.type === 'bonus_percent') return `+ ${option.percent}%`;
  if (option.type === 'double') return 'DOUBLE!';
  if (option.type === 'triple') return 'TRIPLE!';
  if (option.type === 'lose_percent') return `Lose ${option.percent}%`;
  if (option.type === 'lose_flat') return `- ${option.value} Gold`;
  if (option.type === 'take_percent') return `Take ${option.percent}%`;
  if (option.type === 'swap') return 'SWAP!';
  return option.type;
}

function makeChestChoices() {
  const percentValues = [15, 25, 40, 50, 75];
  const gainOptions = [
    { type: 'bonus_flat', value: Math.floor(40 + Math.random() * 141) },
    { type: 'bonus_flat', value: Math.floor(35 + Math.random() * 96) },
    { type: 'bonus_percent', percent: sample(percentValues) },
    { type: 'double' },
    { type: 'triple' },
  ];
  const riskOptions = [
    { type: 'lose_percent', percent: sample([10, 25, 50]) },
    { type: 'lose_flat', value: Math.floor(15 + Math.random() * 66) },
  ];
  const interactionOptions = [
    { type: 'take_percent', percent: sample([15, 25, 40, 60]) },
    { type: 'swap' },
  ];

  const picks = [sample(gainOptions), sample(riskOptions), sample(interactionOptions)];
  if (Math.random() < 0.5) {
    picks[1] = sample(gainOptions);
  }

  return shuffle(picks).map((option) => ({ ...option, label: chestOptionLabel(option) }));
}

function createPendingChest() {
  return {
    phase: 'choose',
    options: makeChestChoices(),
    selectedIndex: null,
    result: null,
  };
}

function createPuzzleState(set) {
  const rows = 4;
  const cols = 4;
  const totalTiles = rows * cols;
  const imageUrl = (Array.isArray(set?.questions) ? set.questions : []).find((question) => String(question?.imageUrl || '').trim())?.imageUrl || null;
  const revealOrder = shuffle(Array.from({ length: totalTiles }, (_, index) => index));
  return {
    rows,
    cols,
    totalTiles,
    imageUrl,
    revealOrder,
    revealedTileIndices: [],
    lastRevealedTile: null,
    completedAt: null,
  };
}

function getPuzzlePayload(game) {
  const puzzle = game?.puzzle;
  if (!puzzle) return null;
  const rows = Math.max(1, Number(puzzle.rows) || 4);
  const cols = Math.max(1, Number(puzzle.cols) || 4);
  const totalTiles = Math.max(1, Number(puzzle.totalTiles) || rows * cols);
  const revealed = Array.isArray(puzzle.revealedTileIndices) ? puzzle.revealedTileIndices.map((index) => Number(index)).filter(Number.isInteger) : [];
  const revealedSet = new Set(revealed);
  return {
    rows,
    cols,
    totalTiles,
    imageUrl: puzzle.imageUrl || null,
    revealedCount: revealed.length,
    completed: revealed.length >= totalTiles,
    lastRevealedTile: Number.isInteger(puzzle.lastRevealedTile) ? puzzle.lastRevealedTile : null,
    tiles: Array.from({ length: totalTiles }, (_, index) => ({
      index,
      number: index + 1,
      revealed: revealedSet.has(index),
      row: Math.floor(index / cols),
      col: index % cols,
    })),
  };
}

function revealNextPuzzleTile(game) {
  const puzzle = game?.puzzle;
  if (!puzzle) return null;
  if (!Array.isArray(puzzle.revealedTileIndices)) puzzle.revealedTileIndices = [];
  if (!Array.isArray(puzzle.revealOrder)) puzzle.revealOrder = [];
  const revealedSet = new Set(puzzle.revealedTileIndices.map((index) => Number(index)).filter(Number.isInteger));
  let tileIndex = null;
  for (const candidate of puzzle.revealOrder) {
    const normalized = Number(candidate);
    if (!Number.isInteger(normalized)) continue;
    if (revealedSet.has(normalized)) continue;
    tileIndex = normalized;
    break;
  }
  if (!Number.isInteger(tileIndex)) {
    return {
      tileIndex: null,
      tileNumber: null,
      revealedCount: revealedSet.size,
      totalTiles: puzzle.totalTiles,
      completed: revealedSet.size >= puzzle.totalTiles,
    };
  }
  puzzle.revealedTileIndices.push(tileIndex);
  puzzle.lastRevealedTile = tileIndex;
  const revealedCount = puzzle.revealedTileIndices.length;
  const completed = revealedCount >= puzzle.totalTiles;
  if (completed && !puzzle.completedAt) puzzle.completedAt = new Date().toISOString();
  return {
    tileIndex,
    tileNumber: tileIndex + 1,
    revealedCount,
    totalTiles: puzzle.totalTiles,
    completed,
  };
}

function getChestTargetChoices(game, player) {
  clampGameGold(game);
  return game.players
    .filter((entry) => entry.playerId !== player.playerId)
    .map((entry) => ({
      playerId: entry.playerId,
      playerName: entry.playerName,
      gold: normalizeGold(entry.gold),
      blook: entry.blook || null,
    }));
}

function getChestPayload(game, player) {
  const pending = player.pendingChest;
  if (!pending) return null;
  const payload = {
    options: pending.options.map((option) => ({
      label: option.label,
      type: option.type,
    })),
    selectedIndex: pending.selectedIndex,
    result: pending.result,
  };
  if (pending.phase === 'target') {
    const selected = Number.isInteger(pending.selectedIndex) ? pending.options[pending.selectedIndex] : null;
    payload.targetAction = selected?.type || null;
    payload.targetChoices = getChestTargetChoices(game, player);
    payload.allowSkip = true;
  }
  return payload;
}

function createChestSkipResult(player, option) {
  const playerBefore = clampPlayerGold(player);
  return {
    type: 'skipped',
    label: option.label,
    headline: 'SKIPPED',
    text: 'You skipped this interaction.',
    delta: 0,
    playerBefore,
    playerAfter: playerBefore,
    eventText: `${player.playerName} skipped a ${option.type === 'swap' ? 'swap' : 'steal'} chest.`,
  };
}

const INTERACTION_CHEST_TYPES = new Set(['take_percent', 'swap']);

function resolveChestChoice(game, player, option, targetPlayerId = null) {
  const opponents = game.players.filter((p) => p.playerId !== player.playerId);
  const target = targetPlayerId
    ? opponents.find((entry) => entry.playerId === targetPlayerId) || null
    : (opponents.length ? sample(opponents) : null);
  const playerBefore = clampPlayerGold(player);
  const targetGoldBefore = target ? clampPlayerGold(target) : null;
  const bonusFlat = normalizeGold(option.value);
  const bonusPercent = normalizeGold(option.percent);

  if (option.type === 'bonus_flat') {
    player.gold = normalizeGold(playerBefore + bonusFlat);
    return {
      type: option.type,
      label: option.label,
      headline: `+${bonusFlat} GOLD`,
      text: `+${bonusFlat} gold`,
      delta: bonusFlat,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} gained ${bonusFlat} gold from a chest.`,
    };
  }

  if (option.type === 'bonus_percent') {
    const gain = Math.max(1, Math.floor(playerBefore * (bonusPercent / 100)));
    player.gold = normalizeGold(playerBefore + gain);
    return {
      type: option.type,
      label: option.label,
      headline: `+${bonusPercent}% BONUS`,
      text: `+${gain} gold (${bonusPercent}%)`,
      delta: gain,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} gained ${gain} gold from a ${bonusPercent}% chest.`,
    };
  }

  if (option.type === 'double') {
    const gain = playerBefore > 0 ? playerBefore : Math.floor(30 + Math.random() * 41);
    player.gold = normalizeGold(playerBefore + gain);
    return {
      type: option.type,
      label: option.label,
      headline: 'DOUBLE!',
      text: `+${gain} gold`,
      delta: gain,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} doubled for +${gain} gold from a chest.`,
    };
  }

  if (option.type === 'triple') {
    const gain = playerBefore > 0 ? (playerBefore * 2) : Math.floor(75 + Math.random() * 71);
    player.gold = normalizeGold(playerBefore + gain);
    return {
      type: option.type,
      label: option.label,
      headline: 'TRIPLE!',
      text: `+${gain} gold`,
      delta: gain,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} tripled for +${gain} gold from a chest.`,
    };
  }

  if (option.type === 'lose_percent') {
    const loss = Math.min(playerBefore, Math.floor(playerBefore * (bonusPercent / 100)));
    player.gold = normalizeGold(playerBefore - loss);
    return {
      type: option.type,
      label: option.label,
      headline: `LOSE ${bonusPercent}%`,
      text: `-${loss} gold (${bonusPercent}%)`,
      delta: -loss,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} lost ${loss} gold from a chest.`,
    };
  }

  if (option.type === 'lose_flat') {
    const loss = Math.min(playerBefore, bonusFlat);
    player.gold = normalizeGold(playerBefore - loss);
    return {
      type: option.type,
      label: option.label,
      headline: `-${loss} GOLD`,
      text: `-${loss} gold`,
      delta: -loss,
      playerBefore,
      playerAfter: player.gold,
      eventText: `${player.playerName} lost ${loss} gold from a chest.`,
    };
  }

  if (option.type === 'take_percent') {
    if (!target) {
      return {
        type: 'no_interaction',
        label: option.label,
        headline: 'NO INTERACTION',
        text: 'No players to interact with',
        noInteraction: true,
        delta: 0,
        playerBefore,
        playerAfter: player.gold,
        eventText: `${player.playerName} rolled an interaction chest but had no opponents.`,
      };
    }
    const steal = Math.min(targetGoldBefore, Math.max(1, Math.floor(targetGoldBefore * (bonusPercent / 100))));
    if (steal <= 0) {
      return {
        type: 'no_effect',
        label: option.label,
        headline: 'NO EFFECT',
        text: `${target.playerName} had no gold to take`,
        delta: 0,
        playerBefore,
        playerAfter: player.gold,
        target: target.playerName,
        targetBefore: targetGoldBefore,
        targetAfter: targetGoldBefore,
        eventText: `${player.playerName} tried to steal from ${target.playerName}, but no gold was available.`,
      };
    }
    target.gold = normalizeGold(targetGoldBefore - steal);
    player.gold = normalizeGold(playerBefore + steal);
    return {
      type: option.type,
      label: option.label,
      headline: `TAKE ${bonusPercent}%`,
      text: `Took ${steal} gold from ${target.playerName}`,
      delta: steal,
      playerBefore,
      playerAfter: player.gold,
      target: target.playerName,
      targetBefore: targetGoldBefore,
      targetAfter: target.gold,
      eventText: `${player.playerName} took ${steal} gold from ${target.playerName}.`,
    };
  }

  if (option.type === 'swap') {
    if (!target) {
      return {
        type: 'no_interaction',
        label: option.label,
        headline: 'NO SWAP TARGET',
        text: 'No players to interact with',
        noInteraction: true,
        delta: 0,
        playerBefore,
        playerAfter: player.gold,
        eventText: `${player.playerName} rolled SWAP but had no opponents.`,
      };
    }
    const original = playerBefore;
    player.gold = normalizeGold(targetGoldBefore);
    target.gold = normalizeGold(original);
    return {
      type: option.type,
      label: option.label,
      headline: 'SWAP!',
      text: `Swapped with ${target.playerName} (${original} -> ${player.gold})`,
      delta: player.gold - original,
      playerBefore: original,
      playerAfter: player.gold,
      target: target.playerName,
      targetBefore: targetGoldBefore,
      targetAfter: target.gold,
      eventText: `${player.playerName} swapped gold totals with ${target.playerName}.`,
    };
  }

  return {
    type: 'no_effect',
    label: option.label,
    headline: 'NO EFFECT',
    text: 'No effect',
    delta: 0,
    playerBefore,
    playerAfter: player.gold,
    eventText: `${player.playerName} opened a chest with no effect.`,
  };
}

function publicGame(game) {
  clampGameGold(game);
  const remainingSec =
    game.state === 'live' && ['timed', 'hybrid'].includes(game.settings.gameType) && game.endsAt
      ? Math.max(0, Math.floor((new Date(game.endsAt).getTime() - Date.now()) / 1000))
      : null;

  return {
    code: game.code,
    hostPin: game.hostPin,
    mode: game.mode,
    state: game.state,
    setTitle: game.set.title,
    settings: game.settings,
    puzzle: getPuzzlePayload(game),
    remainingSec,
    players: game.players.map((p) => ({
      playerId: p.playerId,
      playerName: p.playerName,
      blook: p.blook || null,
      avatar: p.blook || null,
      gold: normalizeGold(p.gold),
      answered: p.questionIndex,
    })),
    eventLog: game.eventLog.slice(-8),
  };
}

function isLiveGameTimerExpired(game) {
  if (!game || game.state !== 'live') return false;
  if (!['timed', 'hybrid'].includes(game.settings?.gameType)) return false;
  if (!game.endsAt) return false;
  const endsAtMs = new Date(game.endsAt).getTime();
  if (!Number.isFinite(endsAtMs)) return false;
  return Date.now() >= endsAtMs;
}

function endGameWhenTimerExpires(game, { requestId } = {}) {
  if (!isLiveGameTimerExpired(game)) return false;
  game.state = 'ended';
  game.endedAt = game.endedAt || new Date().toISOString();
  game.eventLog.push({ at: game.endedAt, type: 'ended', text: 'Time is up. Game ended for everyone.' });
  logInfo('game.ended.timer', {
    requestId: requestId || null,
    code: game.code,
    players: game.players.length,
    endedAt: game.endedAt,
  });
  return true;
}

function routes(req, res) {
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

  if (req.method === 'GET' && pathname === '/script.js') {
    return sendText(res, 200, HTML_JS, 'text/javascript; charset=utf-8');
  }

  if (req.method === 'GET' && pathname.startsWith('/pages/')) {
    const fileName = path.basename(pathname);
    if (!/^[a-zA-Z0-9._-]+\.js$/.test(fileName)) {
      return sendJson(res, 400, { error: 'Invalid page script path' });
    }
    const scriptPath = path.join(__dirname, 'pages', fileName);
    return fs.readFile(scriptPath, 'utf8', (error, data) => {
      if (error) return sendJson(res, 404, { error: 'Page script not found' });
      return sendText(res, 200, data, 'text/javascript; charset=utf-8');
    });
  }

  if (req.method === 'GET' && pathname === '/index.html') {
    return sendText(res, 200, HTML_PAGE, 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && ENTRY_HTML_FILES.has(pathname.replace(/^\//, ''))) {
    const fileName = pathname.replace(/^\//, '');
    const override = ENTRY_PAGE_OVERRIDES[fileName];
    if (override) {
      return sendText(res, 200, renderEntryHtml(override), 'text/html; charset=utf-8');
    }
    const pagePath = path.join(HTML_DIR, fileName);
    return fs.readFile(pagePath, 'utf8', (error, data) => {
      if (error) return sendJson(res, 404, { error: 'Page not found' });
      return sendText(res, 200, data, 'text/html; charset=utf-8');
    });
  }

  if (req.method === 'GET' && pathname === '/') {
    return sendText(res, 200, HTML_PAGE, 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && pathname.startsWith('/chetsicons/')) {
    const fileName = path.basename(pathname);
    if (!/^[a-zA-Z0-9._-]+\.svg$/.test(fileName)) {
      return sendJson(res, 400, { error: 'Invalid icon path' });
    }
    const iconPath = path.join(__dirname, 'chetsicons', fileName);
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
    const pfpPath = path.join(PFP_DIR, fileName);
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
    const mp3Path = path.join(MP3_DIR, fileName);
    return fs.readFile(mp3Path, (error, data) => {
      if (error) return sendJson(res, 404, { error: 'MP3 not found' });
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=43200' });
      return res.end(data);
    });
  }

  if (req.method === 'GET' && pathname === '/api/audio/tracks') {
    return fs.readdir(MP3_DIR, (error, entries) => {
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

  if (req.method === 'GET' && pathname === '/api/blooks') {
    return sendJson(res, 200, { blooks: blookCatalog });
  }

  if (req.method === 'GET' && pathname === '/api/avatars') {
    return sendJson(res, 200, { avatars: avatarCatalog });
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
    const game = code ? games.get(code) : null;
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    endGameWhenTimerExpires(game, { requestId: reqInfo.requestId });
    return sendJson(res, 200, { game: publicGame(game) });
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/join$/)) {
    const code = pathname.split('/')[3]?.toUpperCase();
    const game = code ? games.get(code) : null;
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

        const player = {
          playerId: randomId(),
          playerName: body.playerName.trim(),
          blook: null,
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
          players: game.players.length,
        });
        sendJson(res, 201, { gameCode: game.code, player });
      })
      .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
    return;
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/games\/[^/]+\/player\/[^/]+\/blook$/)) {
    const [, , , codeRaw, , playerId] = pathname.split('/');
    const game = games.get((codeRaw || '').toUpperCase());
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
    const game = code ? games.get(code) : null;
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
    const game = code ? games.get(code) : null;
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
    const game = games.get((codeRaw || '').toUpperCase());
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
          catalog: blookCatalog,
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
    const game = games.get((codeRaw || '').toUpperCase());
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

        const correct = index === question.correct;
        let gained = 0;
        let awaitingChestChoice = false;
        let puzzleReveal = null;
        if (correct) {
          gained = isAssembleMode
            ? (timedScoring ? Math.floor(60 + Math.random() * 121) : Math.floor(90 + Math.random() * 181))
            : (timedScoring ? Math.floor(30 + Math.random() * 71) : Math.floor(45 + Math.random() * 106));
          player.gold += gained;
          if (isAssembleMode) {
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
          correctIndex: question.correct,
          gained,
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
    const game = games.get((codeRaw || '').toUpperCase());
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
          const index = Number(body.optionIndex);
          if (!Number.isInteger(index) || index < 0 || index >= player.pendingChest.options.length) {
            return sendJson(res, 400, { error: 'Valid optionIndex is required.' });
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
            return sendJson(res, 400, { error: 'Use action=\"target\" or action=\"skip\".' });
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
            gold: player.gold,
            chest: {
              options: player.pendingChest.options.map((item) => ({ label: item.label, type: item.type })),
              selectedIndex: player.pendingChest.selectedIndex,
              result: player.pendingChest.result,
            },
          });
        }

        if (body.action !== 'next') return sendJson(res, 400, { error: 'Use action=\"next\" to continue.' });
        player.pendingChest = null;
        logDebug('game.chest.next', {
          requestId: reqInfo.requestId,
          code: game.code,
          playerId: player.playerId,
          nextQuestion: player.questionIndex,
        });
        return sendJson(res, 200, { ok: true, gold: player.gold, nextQuestion: player.questionIndex });
      })
      .catch((error) => sendJson(res, 400, { error: error.message || 'Unable to parse request' }));
    return;
  }

  if (req.method === 'DELETE' && pathname.match(/^\/api\/games\/[^/]+$/)) {
    const code = pathname.split('/')[3]?.toUpperCase();
    if (!code || !games.has(code)) return sendJson(res, 404, { error: 'Game not found' });
    games.delete(code);
    logInfo('game.deleted', {
      requestId: reqInfo.requestId,
      code,
      remainingGames: games.size,
    });
    return sendJson(res, 200, { message: 'Game deleted.' });
  }

  logWarn('http.route.not_found', {
    requestId: reqInfo.requestId,
    method: reqInfo.method,
    path: reqInfo.path,
  });
  sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(routes);
server.listen(PORT, () => {
  logInfo('server.started', {
    port: PORT,
    baseUrl: `http://localhost:${PORT}`,
    logLevel: ACTIVE_LOG_LEVEL,
    maxLogChars: MAX_LOG_CHARS,
  });
});
