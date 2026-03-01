const config = require('./config');
const { logDebug, logInfo, logWarn, truncateLogString, uniqStrings, toSlug, titleCase, decodeHtmlEntities, stripHtml, shuffle, randomId } = require('./utils');
const { fetchJson, requestJson } = require('./http-client');
const { normalizeImageTheme, applyGeneratedImages } = require('./image-search');

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
  if (config.countriesCache.countries.length && config.countriesCache.expiresAt > Date.now()) {
    logDebug('countries.cache.hit', { count: config.countriesCache.countries.length });
    return config.countriesCache.countries;
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

  config.countriesCache = {
    expiresAt: Date.now() + config.COUNTRIES_TTL_MS,
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
  if (config.topicCache.topics.length && config.topicCache.expiresAt > Date.now()) {
    logDebug('topics.cache.hit', { count: config.topicCache.topics.length });
    return config.topicCache.topics;
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
    config.topicCache = {
      expiresAt: Date.now() + config.TOPIC_TTL_MS,
      topics,
    };
    logInfo('topics.cache.refresh', { count: topics.length });
    return topics;
  }

  logWarn('topics.empty_return', { fallbackCount: (config.topicCache.topics || []).length });
  return config.topicCache.topics || [];
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
  if (config.remoteSetCache.has(id)) {
    const cached = config.remoteSetCache.get(id);
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
  config.remoteSetCache.set(id, set);
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
  let answers = uniqStrings(rawAnswers.map((entry) => String(entry || '').trim())).slice(0, 4);
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

  if (correctAnswerText && !answers.some((entry) => entry.toLowerCase() === correctAnswerText.toLowerCase())) {
    if (answers.length >= 4) {
      answers[answers.length - 1] = correctAnswerText;
    } else {
      answers.push(correctAnswerText);
    }
    answers = uniqStrings(answers).slice(0, 4);
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
    'Rules: 2-4 unique answers per question (prefer exactly 4), correct is a zero-based answer index, no markdown.';
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
  if (!['goldquest', 'fishingfrenzy', 'assemble'].includes(gameTypeFamily)) return 'Type must be goldquest, fishingfrenzy, or assemble.';

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

module.exports = {
  fetchOpenTdbTopics,
  flattenTriviaApiCategoryPayload,
  fetchTriviaApiTopics,
  fetchJserviceTopics,
  fetchCountries,
  fetchFlagTopics,
  fetchDynamicTopics,
  fetchOpenTdbQuestions,
  fetchTriviaApiQuestions,
  fetchJserviceQuestions,
  fetchFlagQuestions,
  getRemoteSet,
  searchQuizSets,
  extractJsonString,
  normalizeGeneratedQuestion,
  normalizeGeneratedSet,
  parseQuizGeneratePayload,
  generateQuizSetWithGroq,
  validateQuestions,
  validateHostPayload,
  validateJoinPayload,
  resolveSet,
};
