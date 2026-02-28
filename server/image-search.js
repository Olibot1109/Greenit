const http = require('http');
const https = require('https');
const { URL } = require('url');
const config = require('./config');
const { logDebug, logInfo, logWarn, sanitizeUrlForLog, truncateLogString, uniqStrings, isAbsoluteHttpUrl, normalizeAbsoluteHttpUrl } = require('./utils');
const { fetchJson, requestText } = require('./http-client');

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
    .replace(/&/g, '&')
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

  const cached = config.imageSearchCache.get(key);
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

  config.imageSearchCache.set(key, { url, expiresAt: Date.now() + config.IMAGE_SEARCH_TTL_MS });
  return url;
}

async function searchWikipediaSummaryImage(query) {
  const key = `wikisummary:${String(query || '').trim().toLowerCase()}`;
  if (!key || key === 'wikisummary:') return null;

  const cached = config.imageSearchCache.get(key);
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

  config.imageSearchCache.set(key, { url, expiresAt: Date.now() + config.IMAGE_SEARCH_TTL_MS });
  return url;
}

async function searchWikimediaImage(query) {
  const key = String(query || '').trim().toLowerCase();
  if (!key) return null;

  const cached = config.imageSearchCache.get(key);
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

  config.imageSearchCache.set(key, { url, expiresAt: Date.now() + config.IMAGE_SEARCH_TTL_MS });
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

module.exports = {
  normalizeImageTheme,
  inferImageContentType,
  isWikimediaHost,
  getGoogleSearchConfig,
  decodeGoogleEscapedUrl,
  isGoogleOwnedImageHost,
  unwrapGoogleRedirectUrl,
  extractGoogleImageCandidatesFromHtml,
  getImageSearchCandidates,
  normalizeWikipediaTitleCandidate,
  getWikipediaTitleCandidates,
  getLogoDomainCandidates,
  searchLogoByDomain,
  probeImageUrl,
  searchGoogleImage,
  searchWikipediaSummaryImage,
  searchWikimediaImage,
  applyGeneratedImages,
};
