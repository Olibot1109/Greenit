const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HTML_DIR = path.join(__dirname, '..', 'pages');
const HTML_PAGE = fs.readFileSync(path.join(HTML_DIR, 'index.html'), 'utf8');

const PFP_DIR = path.join(__dirname, '..', 'pfp');
const MP3_DIR = path.join(__dirname, '..', 'mp3');
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
  imageUrl: `/pfp/${encodeURIComponent(name)}.svg`,
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

module.exports = {
  PORT,
  HTML_DIR,
  HTML_PAGE,
  PFP_DIR,
  MP3_DIR,
  blookSeeds,
  blookCatalog,
  avatarCatalog,
  remoteSetCache,
  games,
  TOPIC_TTL_MS,
  COUNTRIES_TTL_MS,
  IMAGE_SEARCH_TTL_MS,
  topicCache,
  countriesCache,
  imageSearchCache,
  LOG_LEVELS,
  LOG_LEVEL,
  ACTIVE_LOG_LEVEL,
  MAX_LOG_CHARS,
  IMAGE_FALLBACK_LOG_LEVEL,
  LOG_COLOR_MODE,
  ANSI,
  get localBlookCatalog() { return localBlookCatalog; },
};
