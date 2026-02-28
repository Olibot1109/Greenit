const views = ["home", "host", "hostMode", "join", "lobby", "playerGame"];
let currentHostGameCode = null;
let lobbyPoll = null;
let playerPoll = null;
let currentPlayer = { code: null, id: null, name: null, blook: null };
let selectedSetId = null;
let selectedSetLabel = "";
let selectedCustomSet = null;
let generatedAiSet = null;
let customDraftQuestions = [];
let currentEditorSource = "manual";
let latestJoinUrl = "";
let playerFeedbackLockUntil = 0;
let playerFeedbackTimer = null;
const lobbyRowElements = new Map();
const lobbyPlayerGoldDisplay = new Map();
const lobbyPlayerGoldAnimationFrames = new Map();
const goldquestPage = (window.GreenitPages && window.GreenitPages.goldquest) ? window.GreenitPages.goldquest : null;
const currentPath = String(window.location.pathname || "/").toLowerCase();
const isIndexPage = currentPath === "/" || currentPath === "/index.html";
const isGoldquestPlayerPage = currentPath === "/goldquest.html";
const isGoldquestHostPage = currentPath === "/goldquesthost.html" || currentPath === "/hostgoldquest.html" || currentPath === "/hostgoldqueest.html";
const hostSessionStorageKey = "greenit.host.session.v1";
const playerSessionStorageKey = "greenit.player.session.v1";

const hostStatus = document.getElementById("hostStatus");
const hostModeStatus = document.getElementById("hostModeStatus");
const joinStatus = document.getElementById("joinStatus");
const startStatus = document.getElementById("startStatus");

function normalizeGameCode(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  return /^\d{6}$/.test(code) ? code : "";
}

function normalizePlayerId(rawPlayerId) {
  const playerId = String(rawPlayerId || "").trim();
  return /^[a-z0-9]{6,24}$/i.test(playerId) ? playerId : "";
}

function saveStorageJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures.
  }
}

function loadStorageJson(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearStorageJson(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

function persistHostSession() {
  const code = normalizeGameCode(currentHostGameCode);
  if (!code) return;
  saveStorageJson(hostSessionStorageKey, { code });
}

function restoreHostSession() {
  const saved = loadStorageJson(hostSessionStorageKey);
  const code = normalizeGameCode(saved?.code);
  return code ? { code } : null;
}

function clearHostSession() {
  clearStorageJson(hostSessionStorageKey);
}

function persistPlayerSession() {
  const code = normalizeGameCode(currentPlayer.code);
  const playerId = normalizePlayerId(currentPlayer.id);
  if (!code || !playerId) return;
  saveStorageJson(playerSessionStorageKey, {
    code,
    playerId,
    name: String(currentPlayer.name || "").slice(0, 64),
  });
}

function restorePlayerSession() {
  const saved = loadStorageJson(playerSessionStorageKey);
  const code = normalizeGameCode(saved?.code);
  const playerId = normalizePlayerId(saved?.playerId);
  const name = String(saved?.name || "").trim().slice(0, 64);
  if (!code || !playerId) return null;
  return { code, playerId, name };
}

function clearPlayerSession() {
  clearStorageJson(playerSessionStorageKey);
}

function getCurrentPlayerRoute() {
  const params = new URLSearchParams();
  const code = normalizeGameCode(currentPlayer.code);
  const playerId = normalizePlayerId(currentPlayer.id);
  if (code) params.set("code", code);
  if (playerId) params.set("playerId", playerId);
  if (currentPlayer.name) params.set("name", String(currentPlayer.name));
  const query = params.toString();
  return query ? `/goldquest.html?${query}` : "/goldquest.html";
}

function getCurrentHostRoute() {
  const code = normalizeGameCode(currentHostGameCode);
  return code ? `/goldquesthost.html?code=${encodeURIComponent(code)}` : "/goldquesthost.html";
}

function showView(viewId) {
  views.forEach((id) => {
    document.getElementById(id).classList.toggle("hidden", id !== viewId);
  });
  document.body.classList.toggle("play-view-active", viewId === "playerGame");
  if (viewId !== "lobby") {
    document.body.classList.remove("host-ended-view");
  }
  if (viewId !== "playerGame") {
    const shell = document.querySelector(".player-shell");
    if (shell) {
      shell.classList.remove("is-waiting");
      shell.classList.remove("is-chest");
    }
  }
}

function getPendingHostCustomSet() {
  if (selectedCustomSet) return selectedCustomSet;
  if (!selectedSetId && customDraftQuestions.length) {
    try {
      return getEditorCustomSet();
    } catch {
      return null;
    }
  }
  return null;
}

function updateHostModeSummary() {
  const summaryEl = document.getElementById("hostModeSetSummary");
  if (!summaryEl) return;
  const pendingCustomSet = getPendingHostCustomSet();
  if (selectedSetId) {
    summaryEl.textContent = `Quiz ready: ${selectedSetLabel || "live set selected"}.`;
    return;
  }
  if (pendingCustomSet) {
    const questionCount = Array.isArray(pendingCustomSet.questions) ? pendingCustomSet.questions.length : 0;
    summaryEl.textContent = `Quiz ready: ${pendingCustomSet.title}${questionCount ? ` (${questionCount} questions)` : ""}.`;
    return;
  }
  summaryEl.textContent = "Pick a quiz set first.";
}

function updateGameTypeFields() {
  const gameType = document.getElementById("gameType");
  const questionWrap = document.getElementById("questionLimitWrap");
  const timeWrap = document.getElementById("timeLimitWrap");
  const questionInput = document.getElementById("questionLimit");
  const timeInput = document.getElementById("timeLimit");
  if (!gameType || !questionWrap || !timeWrap || !questionInput || !timeInput) return;

  const value = gameType.value;
  const isTimed = value === "timed";
  const isQuestion = value === "question";
  questionWrap.classList.toggle("hidden", isTimed);
  timeWrap.classList.toggle("hidden", isQuestion);
  questionInput.disabled = isTimed;
  timeInput.disabled = isQuestion;
}

function goToHostModeSetup() {
  let pendingCustomSet = selectedCustomSet;
  if (!selectedSetId && !pendingCustomSet && customDraftQuestions.length) {
    try {
      pendingCustomSet = getEditorCustomSet();
    } catch (error) {
      hostStatus.textContent = error.message;
      return;
    }
  }
  if (!selectedSetId && !pendingCustomSet) {
    hostStatus.textContent = "Pick a live set or use your custom set first.";
    return;
  }
  if (hostModeStatus) hostModeStatus.textContent = "";
  updateHostModeSummary();
  updateGameTypeFields();
  showView("hostMode");
}

async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stableHash(input) {
  let hash = 2166136261;
  const text = String(input || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildShuffledAnswerChoices(question, questionIndex) {
  const answers = Array.isArray(question?.answers) ? question.answers : [];
  const seedBase = `${currentPlayer.id || "player"}|${questionIndex}|${String(question?.q || "")}`;
  return answers
    .map((answer, answerIndex) => ({
      answerIndex,
      answerText: String(answer || ""),
      key: stableHash(`${seedBase}|${answerIndex}|${answer}`),
    }))
    .sort((a, b) => (a.key === b.key ? a.answerIndex - b.answerIndex : a.key - b.key))
    .map(({ answerIndex, answerText }) => ({ answerIndex, answerText }));
}

function toQuestionImageSrc(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^\/?api\/image-proxy\?url=/i.test(value)) return value.startsWith("/") ? value : `/${value}`;
  if (/^\/?image-proxy\?url=/i.test(value)) {
    const encodedTarget = value.replace(/^\/?image-proxy\?url=/i, "");
    return `/api/image-proxy?url=${encodedTarget}`;
  }
  if (/^https?:\/\//i.test(value)) return `/api/image-proxy?url=${encodeURIComponent(value)}`;
  return value;
}

function renderPuzzleBoard(puzzle, highlightedTileIndex = null) {
  if (!puzzle || typeof puzzle !== "object") return "";
  const rows = Math.max(1, Number(puzzle.rows) || 4);
  const cols = Math.max(1, Number(puzzle.cols) || 4);
  const totalTiles = Math.max(1, Number(puzzle.totalTiles) || (rows * cols));
  const revealedCount = Math.max(0, Math.min(totalTiles, Number(puzzle.revealedCount) || 0));
  const imageUrl = toQuestionImageSrc(puzzle.imageUrl || "");
  const tiles = Array.isArray(puzzle.tiles) && puzzle.tiles.length
    ? puzzle.tiles.slice(0, totalTiles)
    : Array.from({ length: totalTiles }, (_, index) => ({
      index,
      number: index + 1,
      revealed: false,
      row: Math.floor(index / cols),
      col: index % cols,
    }));

  const tileHtml = tiles.map((tile, fallbackIndex) => {
    const index = Number.isInteger(Number(tile.index)) ? Number(tile.index) : fallbackIndex;
    const number = Number.isInteger(Number(tile.number)) ? Number(tile.number) : (index + 1);
    const revealed = !!tile.revealed;
    const row = Number.isInteger(Number(tile.row)) ? Number(tile.row) : Math.floor(index / cols);
    const col = Number.isInteger(Number(tile.col)) ? Number(tile.col) : (index % cols);
    const posX = cols <= 1 ? 0 : Math.round((col / (cols - 1)) * 10000) / 100;
    const posY = rows <= 1 ? 0 : Math.round((row / (rows - 1)) * 10000) / 100;
    const inlineStyle = revealed && imageUrl
      ? ` style="background-image:url('${escapeHtml(imageUrl)}');background-size:${cols * 100}% ${rows * 100}%;background-position:${posX}% ${posY}%;" `
      : "";
    const classes = `coop-tile${revealed ? " is-revealed" : ""}${Number(highlightedTileIndex) === index ? " is-new" : ""}`;
    return `<div class="${classes}"${inlineStyle}><span>${number}</span></div>`;
  }).join("");

  return `
    <div class="coop-wrap">
      <div class="coop-board-head">Team image: ${revealedCount}/${totalTiles} blocks assembled</div>
      <div class="coop-board-grid" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr));">
        ${tileHtml}
      </div>
    </div>
  `;
}

function setEditorSource(source) {
  currentEditorSource = source || "manual";
  const saveBtn = document.getElementById("saveCustom");
  if (!saveBtn) return;
  const aiLocked = currentEditorSource === "ai-onetime";
  saveBtn.disabled = aiLocked;
  saveBtn.textContent = aiLocked ? "AI set is one-time" : "Save custom set";
}

function renderSetPreview(set) {
  const wrap = document.getElementById("setPreviewWrap");
  const title = document.getElementById("setPreviewTitle");
  const list = document.getElementById("setPreviewList");
  const questions = Array.isArray(set?.questions) ? set.questions : [];
  title.textContent = `${set?.title || "Question preview"} (${questions.length} questions)`;
  list.innerHTML = "";

  if (!questions.length) {
    list.innerHTML = '<p class="small">No questions available for preview.</p>';
  } else {
    questions.forEach((question, index) => {
      const row = document.createElement("div");
      row.className = "preview-item";
      const answers = (Array.isArray(question.answers) ? question.answers : [])
        .map((answer, answerIndex) => {
          const isCorrect = Number(question.correct) === answerIndex;
          return `<div class="preview-answer ${isCorrect ? "is-correct" : ""}">${answerIndex + 1}. ${escapeHtml(answer)}</div>`;
        })
        .join("");
      row.innerHTML = `
        <div class="preview-question">${index + 1}. ${escapeHtml(question.q || "")}</div>
        ${question.imageUrl ? `<div class="preview-image"><img src="${escapeHtml(toQuestionImageSrc(question.imageUrl))}" alt="preview question image" loading="lazy" /></div>` : ""}
        <div class="preview-answers">${answers}</div>
      `;
      list.appendChild(row);
    });
  }

  wrap.classList.remove("hidden");
}

function renderGeneratedAiSetCard() {
  const root = document.getElementById("generatedSetResults");
  if (!root) return;
  root.innerHTML = "";
  if (!generatedAiSet || !Array.isArray(generatedAiSet.questions) || !generatedAiSet.questions.length) return;

  const questionCount = generatedAiSet.questions.length;
  const row = document.createElement("div");
  row.className = "set-card";
  row.innerHTML = `
    <div class="set-top">
      <div class="set-title">${escapeHtml(generatedAiSet.title || "AI Generated Set")}</div>
      <div class="set-badges">
        <span class="pill">Groq AI</span>
        <span class="pill">${questionCount} Q</span>
        <span class="pill">One-time</span>
      </div>
    </div>
    <small>${escapeHtml(generatedAiSet.description || "Generated set from AI")}</small>
    <div class="set-actions">
      <button class="sub" data-action="use">Use set</button>
      <button class="ghost" data-action="preview">View questions</button>
    </div>
  `;

  const useBtn = row.querySelector('[data-action="use"]');
  const previewBtn = row.querySelector('[data-action="preview"]');
  if (useBtn) {
    useBtn.onclick = () => {
      selectedSetId = null;
      selectedCustomSet = generatedAiSet;
      hostStatus.textContent = `Selected set: ${generatedAiSet.title}`;
      renderSetPreview(generatedAiSet);
    };
  }
  if (previewBtn) {
    previewBtn.onclick = () => renderSetPreview(generatedAiSet);
  }

  root.appendChild(row);
}

async function previewRemoteSet(setId, setTitle) {
  try {
    hostStatus.textContent = `Loading questions: ${setTitle}...`;
    const data = await api(`/api/quiz/set?id=${encodeURIComponent(setId)}`);
    renderSetPreview(data.set || {});
    hostStatus.textContent = `Previewing: ${setTitle}`;
  } catch (error) {
    hostStatus.textContent = error.message;
  }
}

function formatClock(totalSec) {
  const safe = Math.max(0, Number(totalSec) || 0);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function ordinalRank(position) {
  if (position === 1) return "1st";
  if (position === 2) return "2nd";
  if (position === 3) return "3rd";
  return `${position}th`;
}

function getQuestionMedia(question) {
  let text = String(question?.q || question || "").trim();
  let imageUrl = String(question?.imageUrl || "").trim() || null;
  let usesBlookFallback = false;

  const tagged = text.match(/\[img:(https?:\/\/[^\]\s]+)\]/i);
  if (tagged) {
    imageUrl = tagged[1];
    text = text.replace(tagged[0], "").trim();
  } else {
    const inline = text.match(/(https?:\/\/\S+\.(?:png|jpe?g|gif|webp))/i);
    if (inline) {
      imageUrl = inline[1];
      text = text.replace(inline[1], "").trim();
    }
  }

  if (!imageUrl && currentPlayer.blook?.imageUrl) {
    imageUrl = currentPlayer.blook.imageUrl;
    usesBlookFallback = true;
  }
  const displayImageUrl = imageUrl && !usesBlookFallback ? toQuestionImageSrc(imageUrl) : imageUrl;
  return { text, imageUrl: displayImageUrl };
}

function setPlayerHudState(state, label) {
  const hud = document.querySelector(".play-hud");
  const resultEl = document.getElementById("playerHudResult");
  hud.classList.remove("is-correct", "is-incorrect");
  if (state === "correct") hud.classList.add("is-correct");
  if (state === "incorrect") hud.classList.add("is-incorrect");
  resultEl.textContent = label || "";
}

function hideFeedbackBanner() {
  const feedbackEl = document.getElementById("answerFeedback");
  const iconEl = document.getElementById("feedbackIcon");
  const textEl = document.getElementById("feedbackText");
  feedbackEl.classList.add("hidden");
  feedbackEl.classList.remove("correct");
  iconEl.textContent = "?";
  textEl.textContent = "";
}

function setPlayerShellMode(mode) {
  const shell = document.querySelector(".player-shell");
  if (!shell) return;
  shell.classList.toggle("is-waiting", mode === "waiting");
  shell.classList.toggle("is-chest", mode === "chest");
}

function fitChestLayout() {
  const shell = document.querySelector(".player-shell");
  const stage = document.getElementById("questionPanel");
  const chest = stage?.querySelector(".chest-screen");
  if (!shell || !stage || !chest || !shell.classList.contains("is-chest")) return;
  chest.style.transform = "";
  chest.style.width = "";
  const available = Math.max(80, stage.clientHeight - 4);
  const needed = chest.scrollHeight;
  if (needed <= available) return;
  const scale = Math.max(0.7, Math.min(1, available / needed));
  chest.style.transform = `scale(${scale})`;
  chest.style.width = `${100 / scale}%`;
}

function prefillJoinCodeFromQuery() {
  const code = new URLSearchParams(location.search).get("code");
  if (code) {
    document.getElementById("joinCode").value = code.toUpperCase();
  }
}

function hydrateHostSessionFromLocation() {
  const params = new URLSearchParams(window.location.search || "");
  const codeFromQuery = normalizeGameCode(params.get("code"));
  if (codeFromQuery) {
    currentHostGameCode = codeFromQuery;
    persistHostSession();
    return true;
  }
  const saved = restoreHostSession();
  if (!saved?.code) return false;
  currentHostGameCode = saved.code;
  return true;
}

function hydratePlayerSessionFromLocation() {
  const params = new URLSearchParams(window.location.search || "");
  const codeFromQuery = normalizeGameCode(params.get("code"));
  const playerIdFromQuery = normalizePlayerId(params.get("playerId") || params.get("id"));
  const nameFromQuery = String(params.get("name") || "").trim().slice(0, 64);
  if (codeFromQuery && playerIdFromQuery) {
    currentPlayer = { code: codeFromQuery, id: playerIdFromQuery, name: nameFromQuery || currentPlayer.name, blook: currentPlayer.blook || null };
    persistPlayerSession();
    return true;
  }
  const saved = restorePlayerSession();
  if (!saved?.code || !saved?.playerId) return false;
  currentPlayer = { code: saved.code, id: saved.playerId, name: saved.name || currentPlayer.name, blook: currentPlayer.blook || null };
  return true;
}

async function resumeHostGamePage() {
  if (!hydrateHostSessionFromLocation()) return false;
  showView("lobby");
  startStatus.textContent = "Lobby connected.";
  await refreshLobby();
  if (lobbyPoll) clearInterval(lobbyPoll);
  lobbyPoll = setInterval(refreshLobby, 1500);
  return true;
}

async function resumePlayerGamePage() {
  const hasPlayerSession = hydratePlayerSessionFromLocation();
  if (!hasPlayerSession) return false;
  showView("playerGame");
  await refreshPlayer();
  if (playerPoll) clearInterval(playerPoll);
  playerPoll = setInterval(refreshPlayer, 1200);
  return true;
}

async function choosePlayerBlook(blookId) {
  const data = await api(`/api/games/${currentPlayer.code}/player/${currentPlayer.id}/blook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blookId }),
  });
  currentPlayer.blook = data.player?.blook || currentPlayer.blook;
  return data;
}

async function searchSets() {
  const root = document.getElementById("setResults");
  root.innerHTML = "";
  try {
    const rawQuery = document.getElementById("searchSets").value.trim();
    const query = encodeURIComponent(rawQuery);
    const data = await api(`/api/quiz/search?q=${query}`);

    data.sets.forEach((set) => {
      const row = document.createElement("div");
      row.className = "set-card";
      const questionCount = Number(set.questionCount) || 0;
      const disabled = questionCount < 1;
      row.innerHTML = `
        <div class="set-top">
          <div class="set-title">${escapeHtml(set.title)}</div>
          <div class="set-badges">
            <span class="pill">${escapeHtml(set.source || "set")}</span>
            <span class="pill">${questionCount} Q</span>
          </div>
        </div>
        <small>${escapeHtml(set.description || "")}</small>
        <div class="set-actions">
          <button class="sub" data-action="use" ${disabled ? "disabled" : ""}>${disabled ? "Unavailable" : "Use set"}</button>
          <button class="ghost" data-action="preview" ${disabled ? "disabled" : ""}>View questions</button>
        </div>
      `;
      const useBtn = row.querySelector('[data-action="use"]');
      const previewBtn = row.querySelector('[data-action="preview"]');
      if (!disabled && useBtn) {
        useBtn.onclick = () => {
          selectedSetId = set.id;
          selectedCustomSet = null;
          hostStatus.textContent = `Selected set: ${set.title}`;
          previewRemoteSet(set.id, set.title);
        };
      }
      if (!disabled && previewBtn) {
        previewBtn.onclick = () => previewRemoteSet(set.id, set.title);
      }
      root.appendChild(row);
    });

    if (!data.sets.length) {
      root.innerHTML = '<p class="small">No sets found.</p>';
    } else if (rawQuery) {
      const top = data.sets[0];
      if (top?.id) previewRemoteSet(top.id, top.title || "Top result");
    }
  } catch (error) {
    root.innerHTML = '<p class="small">Could not load remote categories right now.</p>';
    hostStatus.textContent = error.message;
  }
}

async function generateAiSet() {
  const button = document.getElementById("generateAiSet");
  try {
    const prompt = document.getElementById("aiPrompt").value.trim();
    if (!prompt) throw new Error("AI prompt is required.");
    const questionCount = Number(document.getElementById("aiQuestionCount").value || 12);
    const difficulty = document.getElementById("aiDifficulty").value || "mixed";
    const withImages = !!document.getElementById("aiWithImages").checked;
    const imageTheme = document.getElementById("aiImageTheme").value || "auto";

    button.disabled = true;
    hostStatus.textContent = withImages ? "Generating AI quiz + images with Groq..." : "Generating AI quiz with Groq...";

    const data = await api("/api/quiz/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, questionCount, difficulty, withImages, imageTheme }),
    });

    const set = data.set || {};
    if (!set.title || !Array.isArray(set.questions) || !set.questions.length) {
      throw new Error("AI returned an invalid set.");
    }

    document.getElementById("customTitle").value = set.title;
    customDraftQuestions = set.questions.map((question) => ({
      q: String(question.q || "").trim(),
      answers: Array.isArray(question.answers) ? question.answers.map((answer) => String(answer || "").trim()).filter(Boolean) : [],
      correct: Number(question.correct) || 0,
      ...(question.imageUrl ? { imageUrl: String(question.imageUrl).trim() } : {}),
    })).filter((question) => question.q && question.answers.length >= 2 && question.correct < question.answers.length);

    if (!customDraftQuestions.length) throw new Error("AI did not return usable questions.");

    selectedSetId = null;
    selectedCustomSet = {
      title: set.title,
      description: set.description || "Generated by Groq",
      oneTime: true,
      questions: customDraftQuestions.map((question) => ({
        q: question.q,
        answers: [...question.answers],
        correct: question.correct,
        ...(question.imageUrl ? { imageUrl: question.imageUrl } : {}),
      })),
    };
    generatedAiSet = selectedCustomSet;
    setEditorSource("ai-onetime");
    renderCustomQuestionList();
    renderGeneratedAiSetCard();
    renderSetPreview(selectedCustomSet);
    hostStatus.textContent = `AI set ready (one-time): ${set.title} (${customDraftQuestions.length} questions${withImages ? ", images on" : ""})`;
  } catch (error) {
    hostStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function parseEditorAnswers(rawValue) {
  return rawValue
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function clearEditorInputs() {
  document.getElementById("builderQuestion").value = "";
  document.getElementById("builderImage").value = "";
  document.getElementById("builderAnswers").value = "";
  document.getElementById("builderCorrect").value = "1";
}

function renderCustomQuestionList() {
  const root = document.getElementById("customQuestionList");
  root.innerHTML = "";

  if (!customDraftQuestions.length) {
    root.innerHTML = '<p class="small">No custom questions yet.</p>';
    return;
  }

  customDraftQuestions.forEach((question, index) => {
    const row = document.createElement("div");
    row.className = "custom-item";
    row.innerHTML = `
      <div class="custom-item-head">
        <div class="custom-item-title">${index + 1}. ${escapeHtml(question.q)}</div>
        <div class="row">
          <button type="button" class="sub" data-action="edit">Edit</button>
          <button type="button" class="warn" data-action="remove">Remove</button>
        </div>
      </div>
      <div class="custom-item-meta">
        <span>${question.answers.length} answers</span>
        <span>Correct: #${question.correct + 1}</span>
        ${question.imageUrl ? `<span>Image</span>` : ""}
      </div>
      ${question.imageUrl ? `<div class="preview-image"><img src="${escapeHtml(toQuestionImageSrc(question.imageUrl))}" alt="question image" loading="lazy" /></div>` : ""}
    `;

    row.querySelector('[data-action="edit"]').onclick = () => {
      document.getElementById("builderQuestion").value = question.q;
      document.getElementById("builderImage").value = question.imageUrl || "";
      document.getElementById("builderAnswers").value = question.answers.join("\n");
      document.getElementById("builderCorrect").value = String(question.correct + 1);
      customDraftQuestions.splice(index, 1);
      renderCustomQuestionList();
    };

    row.querySelector('[data-action="remove"]').onclick = () => {
      customDraftQuestions.splice(index, 1);
      renderCustomQuestionList();
    };

    root.appendChild(row);
  });
}

function addCustomQuestion() {
  try {
    const q = document.getElementById("builderQuestion").value.trim();
    const imageUrl = document.getElementById("builderImage").value.trim();
    const answers = parseEditorAnswers(document.getElementById("builderAnswers").value);
    const correct = Number(document.getElementById("builderCorrect").value) - 1;

    if (!q) throw new Error("Question text is required.");
    if (answers.length < 2 || answers.length > 8) throw new Error("Use 2 to 8 answers.");
    if (!Number.isInteger(correct) || correct < 0 || correct >= answers.length) {
      throw new Error("Correct answer # is out of range.");
    }
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      throw new Error("Image URL must start with http:// or https://.");
    }

    const uniqueCount = new Set(answers.map((answer) => answer.toLowerCase())).size;
    if (uniqueCount !== answers.length) throw new Error("Answers must be unique.");

    customDraftQuestions.push({
      q,
      answers,
      correct,
      ...(imageUrl ? { imageUrl } : {}),
    });

    clearEditorInputs();
    renderCustomQuestionList();
    hostStatus.textContent = `Added question ${customDraftQuestions.length}.`;
  } catch (error) {
    hostStatus.textContent = error.message;
  }
}

function getEditorCustomSet() {
  const title = document.getElementById("customTitle").value.trim();
  if (!title) throw new Error("Custom set title required.");
  if (!customDraftQuestions.length) throw new Error("Add at least one custom question.");
  return {
    title,
    description: "Created in custom editor",
    ...(currentEditorSource === "ai-onetime" ? { oneTime: true } : {}),
    questions: customDraftQuestions.map((question) => ({
      q: question.q,
      answers: [...question.answers],
      correct: question.correct,
      ...(question.imageUrl ? { imageUrl: question.imageUrl } : {}),
    })),
  };
}

function useEditorCustomSet() {
  try {
    selectedCustomSet = getEditorCustomSet();
    selectedSetId = null;
    renderSetPreview(selectedCustomSet);
    hostStatus.textContent = `Using editor set: ${selectedCustomSet.title}`;
  } catch (error) {
    hostStatus.textContent = error.message;
  }
}

function saveCustomSet() {
  try {
    if (currentEditorSource === "ai-onetime") {
      throw new Error("AI-generated sets are one-time and cannot be saved locally.");
    }
    const set = getEditorCustomSet();
    localStorage.setItem("greenit.customSet.v2", JSON.stringify(set));
    hostStatus.textContent = "Saved custom set.";
  } catch (error) {
    hostStatus.textContent = error.message;
  }
}

function useSavedCustomSet() {
  try {
    const raw = localStorage.getItem("greenit.customSet.v2") || localStorage.getItem("greenit.customSet");
    if (!raw) throw new Error("No saved custom set.");
    const loaded = JSON.parse(raw);
    if (!loaded?.title || !Array.isArray(loaded.questions) || !loaded.questions.length) {
      throw new Error("Saved custom set is invalid.");
    }
    document.getElementById("customTitle").value = loaded.title;
    customDraftQuestions = loaded.questions.map((question) => ({
      q: String(question.q || "").trim(),
      answers: Array.isArray(question.answers) ? question.answers.map((answer) => String(answer || "").trim()).filter(Boolean) : [],
      correct: Number(question.correct) || 0,
      ...(question.imageUrl ? { imageUrl: String(question.imageUrl) } : {}),
    })).filter((question) => question.q && question.answers.length >= 2 && question.correct < question.answers.length);
    if (!customDraftQuestions.length) throw new Error("Saved set has no valid questions.");
    selectedCustomSet = {
      title: loaded.title,
      description: loaded.description || "Saved in browser",
      questions: customDraftQuestions.map((question) => ({
        q: question.q,
        answers: [...question.answers],
        correct: question.correct,
        ...(question.imageUrl ? { imageUrl: question.imageUrl } : {}),
      })),
    };
    setEditorSource("saved");
    selectedSetId = null;
    renderCustomQuestionList();
    renderSetPreview(selectedCustomSet);
    hostStatus.textContent = `Using saved set: ${selectedCustomSet.title}`;
  } catch (error) {
    hostStatus.textContent = error.message;
  }
}

function clearCustomEditor(statusText = "Custom editor cleared.") {
  customDraftQuestions = [];
  selectedCustomSet = null;
  generatedAiSet = null;
  document.getElementById("customTitle").value = "";
  clearEditorInputs();
  renderCustomQuestionList();
  renderGeneratedAiSetCard();
  document.getElementById("setPreviewWrap").classList.add("hidden");
  setEditorSource("manual");
  if (statusText) hostStatus.textContent = statusText;
}

function renderJoinQr(code) {
  latestJoinUrl = `${location.origin}/?code=${encodeURIComponent(code)}`;
  const hostLabel = document.getElementById("joinHost");
  if (hostLabel) hostLabel.textContent = location.host || "play.greenit.com";

  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(latestJoinUrl)}`;
  document.getElementById("qrWrap").innerHTML = `<img src="${qrSrc}" width="120" height="120" alt="Join QR" />`;
}

async function kickPlayer(playerId) {
  try {
    await api(`/api/games/${currentHostGameCode}/kick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    await refreshLobby();
  } catch (error) {
    startStatus.textContent = error.message;
  }
}

function renderLobbyPlayers(players, phase) {
  const root = document.getElementById("players");
  root.innerHTML = "";

  if (!players.length) {
    root.innerHTML = '<p class="small" style="color:#fff;">Waiting for players...</p>';
    return;
  }

  players.forEach((player, index) => {
    const row = document.createElement("div");
    const blook = player.blook || player.avatar || {
      name: "No Blook",
      imageUrl: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=No%20Blook",
    };

    if (phase === "lobby") {
      row.className = "player-row player-card";
      row.innerHTML = `
        <div class="player-main">
          <img src="${blook.imageUrl}" alt="${escapeHtml(blook.name)}" />
          <span class="player-name">${escapeHtml(player.playerName)}</span>
        </div>
        <div class="player-side">
          <span class="gold-chip">${player.gold}</span>
          <button class="warn kick">Kick</button>
        </div>
      `;
      row.querySelector("button").onclick = () => kickPlayer(player.playerId);
    } else {
      row.className = "player-row leader-row";
      row.innerHTML = `
        <span class="rank">${ordinalRank(index + 1)}</span>
        <div class="player-main">
          <img src="${blook.imageUrl}" alt="${escapeHtml(blook.name)}" />
          <span class="leader-name">${escapeHtml(player.playerName)}</span>
        </div>
        <span class="leader-score">${player.gold}</span>
      `;
    }

    root.appendChild(row);
  });
}

function renderEventFeed(events) {
  const feed = document.getElementById("eventFeed");
  feed.innerHTML = "";
  events.slice().reverse().forEach((event) => {
    const row = document.createElement("div");
    row.className = "event";
    row.innerHTML = `
      <div>${escapeHtml(event.text)}</div>
      <div class="small">${new Date(event.at).toLocaleTimeString()}</div>
    `;
    feed.appendChild(row);
  });
  if (!events.length) feed.innerHTML = '<div class="event"><span class="small">No events yet.</span></div>';
}

function setEndLeaderboardOpen(open) {
  if (!goldquestPage || typeof goldquestPage.setEndLeaderboardOpen !== "function") return;
  goldquestPage.setEndLeaderboardOpen(Boolean(open));
}

async function playHostMusic() {
  if (!goldquestPage || typeof goldquestPage.playHostMusic !== "function") return;
  await goldquestPage.playHostMusic({ api });
}

function pauseHostMusic(reset = false) {
  if (!goldquestPage || typeof goldquestPage.pauseHostMusic !== "function") return;
  goldquestPage.pauseHostMusic(Boolean(reset));
}

function renderHostEndScreen(sortedPlayers) {
  if (!goldquestPage || typeof goldquestPage.renderHostEndScreen !== "function") return;
  goldquestPage.renderHostEndScreen({
    sortedPlayers,
    escapeHtml,
    ordinalRank,
  });
}

async function refreshLobby() {
  if (!currentHostGameCode) return;
  const data = await api(`/api/games/${currentHostGameCode}/lobby`);
  const phase = data.game.state === "lobby" ? "lobby" : data.game.state === "live" ? "live" : "ended";
  const sortedPlayers = [...data.game.players].sort((a, b) => b.gold - a.gold);

  const lobbyEl = document.getElementById("lobby");
  lobbyEl.dataset.phase = phase;
  document.body.classList.toggle("host-ended-view", phase === "ended");
  document.getElementById("lobbyCode").textContent = data.game.code;
  document.getElementById("liveCode").textContent = data.game.code;
  document.getElementById("playersTitle").textContent = phase === "lobby" ? "Players" : "Leaderboard";
  document.getElementById("playerCount").textContent = data.game.players.length;
  renderJoinQr(data.game.code);

  if (typeof data.game.remainingSec === "number") {
    document.getElementById("liveClock").textContent = formatClock(data.game.remainingSec);
  } else if (phase === "ended") {
    document.getElementById("liveClock").textContent = "Game Over";
  } else {
    document.getElementById("liveClock").textContent = data.game.mode;
  }

  const settings = data.game.settings;
  document.getElementById("lobbyMeta").textContent =
    `${data.game.mode} \u2022 ${data.game.setTitle} \u2022 PIN ${data.game.hostPin} \u2022 ${settings.gameType === "timed" ? `${settings.timeLimitSec}s` : `${settings.questionLimit} Q`} \u2022 ${data.game.state}`;

  renderLobbyPlayers(sortedPlayers, phase);
  renderEventFeed(data.game.eventLog || []);

  const startBtn = document.getElementById("startGame");
  startBtn.disabled = phase !== "lobby";
  startBtn.textContent = phase === "lobby" ? "Start" : phase === "live" ? "Live" : "Ended";

  if (goldquestPage && typeof goldquestPage.handleLobbyPhase === "function") {
    await goldquestPage.handleLobbyPhase({
      phase,
      sortedPlayers,
      startStatusEl: startStatus,
      api,
      escapeHtml,
      ordinalRank,
    });
  } else {
    if (phase === "live" || phase === "ended") {
      playHostMusic();
    } else {
      pauseHostMusic(true);
    }
    if (phase === "ended") {
      document.getElementById("hostEndScreen")?.classList.remove("hidden");
      startStatus.textContent = "";
      renderHostEndScreen(sortedPlayers);
    } else {
      document.getElementById("hostEndScreen")?.classList.add("hidden");
      setEndLeaderboardOpen(false);
    }
  }
}

async function chooseChestOption(optionIndex) {
  return api(`/api/games/${currentPlayer.code}/player/${currentPlayer.id}/chest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ optionIndex }),
  });
}

async function chooseChestTarget(targetPlayerId) {
  return api(`/api/games/${currentPlayer.code}/player/${currentPlayer.id}/chest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "target", targetPlayerId }),
  });
}

async function skipChestTarget() {
  return api(`/api/games/${currentPlayer.code}/player/${currentPlayer.id}/chest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "skip" }),
  });
}

async function completeChestResult() {
  return api(`/api/games/${currentPlayer.code}/player/${currentPlayer.id}/chest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "next" }),
  });
}

async function refreshPlayer() {
  if (!currentPlayer.code || !currentPlayer.id) return;
  if (Date.now() < playerFeedbackLockUntil) return;
  try {
    const data = await api(`/api/games/${currentPlayer.code}/player/${currentPlayer.id}`);
    const panel = document.getElementById("questionPanel");
    const answerGrid = document.getElementById("answerGrid");
    const metaEl = document.getElementById("playerMeta");
    const statusEl = document.getElementById("playerStatus");
    const setStatus = (text) => {
      if (statusEl) statusEl.textContent = text || "";
    };
    document.getElementById("playerHudName").textContent = currentPlayer.name || "player";
    document.getElementById("playerHudGold").textContent = String(data.gold || 0);
    const modeText = String(data.mode || "Gold Quest");
    const modeFamily = String(data.modeFamily || "goldquest");
    const feedbackDelaySec = Math.max(0, Math.min(Number(data.feedbackDelaySec ?? 1), 5));
    const feedbackDelayMs = Math.round(feedbackDelaySec * 1000);

    if (isIndexPage && data.state === "live") {
      persistPlayerSession();
      window.location.assign(getCurrentPlayerRoute());
      return;
    }

    hideFeedbackBanner();
    if (playerFeedbackTimer) {
      clearTimeout(playerFeedbackTimer);
      playerFeedbackTimer = null;
    }

    if (data.ended) {
      setPlayerShellMode("game");
      setPlayerHudState("incorrect", "GAME OVER");
      const puzzleMarkup = modeFamily === "assemble" ? renderPuzzleBoard(data.puzzle, data?.puzzle?.lastRevealedTile) : "";
      panel.innerHTML = `${puzzleMarkup}<h2 class="question-title">Host ended the game.</h2>`;
      answerGrid.innerHTML = "";
      metaEl.textContent = "Game ended";
      if (playerPoll) {
        clearInterval(playerPoll);
        playerPoll = null;
      }
      return;
    }

    if (data.waiting) {
      setPlayerShellMode("waiting");
      setPlayerHudState("", "Waiting in Lobby");
      answerGrid.innerHTML = "";
      const selection = data.blookSelection || {};
      const catalog = Array.isArray(selection.catalog) ? selection.catalog : [];
      const takenIds = new Set(Array.isArray(selection.takenIds) ? selection.takenIds : []);
      const current = selection.current || currentPlayer.blook || null;
      if (current) currentPlayer.blook = current;

      if (!catalog.length) {
        panel.innerHTML = '<h2 class="question-title">Waiting for host to start...</h2>';
        metaEl.textContent = "Lobby waiting room";
        return;
      }

      const catalogKey = catalog.map((blook) => blook.id).join("|");
      const mountedGrid = document.getElementById("waitBlookGrid");
      const needsMount = !mountedGrid || panel.dataset.waitBlookCatalogKey !== catalogKey;

      if (needsMount) {
        panel.innerHTML = `
          <div class="wait-lobby-main">
            <div class="wait-blook-board">
              <div id="waitBlookGrid" class="wait-blook-grid"></div>
            </div>
            <div class="wait-selected-panel">
              <div class="wait-selected-card">
                <div id="waitSelectedImage" class="wait-selected-image"></div>
                <div id="waitSelectedName" class="wait-selected-name"></div>
              </div>
              <div class="wait-host-pill">Waiting for Host</div>
            </div>
          </div>
        `;
        panel.dataset.waitBlookCatalogKey = catalogKey;
        const waitGrid = document.getElementById("waitBlookGrid");
        catalog.forEach((blook) => {
          const card = document.createElement("button");
          card.type = "button";
          card.className = "wait-blook-tile";
          card.dataset.blookId = blook.id;
          card.innerHTML = `
            <img src="${blook.imageUrl}" alt="${escapeHtml(blook.name)}" />
          `;
          card.onclick = async () => {
            try {
              if (Date.now() < playerFeedbackLockUntil) return;
              if (card.classList.contains("is-taken") && !card.classList.contains("is-current")) return;
              playerFeedbackLockUntil = Date.now() + 350;
              await choosePlayerBlook(blook.id);
              playerFeedbackLockUntil = 0;
              await refreshPlayer();
            } catch (error) {
              playerFeedbackLockUntil = 0;
	              setStatus(error.message);
            }
          };
          waitGrid.appendChild(card);
        });
      }

      const waitGrid = document.getElementById("waitBlookGrid");
      Array.from(waitGrid.querySelectorAll(".wait-blook-tile")).forEach((card) => {
        const blookId = card.dataset.blookId || "";
        const takenByOther = takenIds.has(blookId);
        const isCurrent = !!(current && current.id === blookId);
        card.classList.toggle("is-current", isCurrent);
        card.classList.toggle("is-taken", takenByOther);
        card.disabled = takenByOther && !isCurrent;
      });

      const selectedImage = document.getElementById("waitSelectedImage");
      const selectedName = document.getElementById("waitSelectedName");
      if (selectedImage) {
        selectedImage.innerHTML = current
          ? `<img src="${escapeHtml(current.imageUrl)}" alt="${escapeHtml(current.name)}" />`
          : '<div class="question-title">?</div>';
      }
      if (selectedName) selectedName.textContent = current?.name || "Pick a blook";

	      setStatus(current ? `Selected blook: ${current.name}` : "Select a blook (unique per lobby).");
      metaEl.textContent = "Lobby waiting room";
      return;
    }

    if (data.finished) {
      setPlayerShellMode("game");
      setPlayerHudState("correct", "COMPLETE");
      const puzzleMarkup = modeFamily === "assemble" ? renderPuzzleBoard(data.puzzle, data?.puzzle?.lastRevealedTile) : "";
      panel.innerHTML = `${puzzleMarkup}<h2 class="question-title">Done! Final gold: ${data.gold}</h2>`;
      answerGrid.innerHTML = "";
      metaEl.textContent = `Answered: ${data.answered || 0}`;
      if (playerPoll) {
        clearInterval(playerPoll);
        playerPoll = null;
      }
      return;
    }

    if (goldquestPage && typeof goldquestPage.handlePlayerPhase === "function") {
      const handledByGoldquest = await goldquestPage.handlePlayerPhase({
        data,
        panel,
        answerGrid,
        metaEl,
        modeText,
        setStatus,
        escapeHtml,
        fitChestLayout,
        setPlayerShellMode,
        setPlayerHudState,
        chooseChestOption,
        chooseChestTarget,
        skipChestTarget,
        completeChestResult,
        refreshPlayer,
        isFeedbackLocked: () => Date.now() < playerFeedbackLockUntil,
        lockFeedbackFor: (durationMs) => {
          const lockMs = Math.max(0, Number(durationMs) || 0);
          playerFeedbackLockUntil = Date.now() + lockMs;
        },
        clearFeedbackLock: () => {
          playerFeedbackLockUntil = 0;
        },
      });
      if (handledByGoldquest) return;
    }

    const media = getQuestionMedia(data.question);
    const puzzleMarkup = modeFamily === "assemble" ? renderPuzzleBoard(data.puzzle, data?.puzzle?.lastRevealedTile) : "";
	    setPlayerShellMode("game");
	    setPlayerHudState("", modeText.toUpperCase());
	    setStatus("");
    const promptClass = media.imageUrl ? "prompt-wrap" : "prompt-wrap prompt-no-media";
    panel.innerHTML = `
      ${puzzleMarkup}
      <div class="${promptClass}">
        ${media.imageUrl ? `<div class="question-visual"><img src="${escapeHtml(media.imageUrl)}" alt="question" /></div>` : ""}
        <h2 class="question-title">${escapeHtml(media.text || `Question ${data.questionIndex + 1}`)}</h2>
      </div>
    `;
    answerGrid.innerHTML = "";
    const colors = ["tile-0", "tile-1", "tile-2", "tile-3"];
    const answerChoices = buildShuffledAnswerChoices(data.question, data.questionIndex);

    answerChoices.forEach((choice, displayIndex) => {
      const button = document.createElement("button");
      button.className = `answer-tile ${colors[displayIndex % colors.length]}`;
      button.dataset.answerIndex = String(choice.answerIndex);
      button.innerHTML = '<span class="tile-symbol"></span><span class="tile-label"></span>';
      button.querySelector(".tile-label").textContent = choice.answerText;
      button.onclick = async () => {
        try {
          if (Date.now() < playerFeedbackLockUntil) return;
          const selectedAnswerIndex = Number(button.dataset.answerIndex);
          const buttons = Array.from(answerGrid.querySelectorAll(".answer-tile"));
          buttons.forEach((el) => el.classList.add("is-locked"));
          playerFeedbackLockUntil = Date.now() + 500;
          const result = await api(`/api/games/${currentPlayer.code}/player/${currentPlayer.id}/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answerIndex: selectedAnswerIndex }),
          });
          const correct = !!result.correct;
          const correctIndex = Number.isInteger(result.correctIndex) ? result.correctIndex : null;
          const revealDelayMs = correct ? feedbackDelayMs : 2000;
          const revealDelaySec = revealDelayMs / 1000;
          playerFeedbackLockUntil = Date.now() + revealDelayMs + 80;
          if (typeof result.totalGold === "number") {
            document.getElementById("playerHudGold").textContent = String(result.totalGold);
          }

          buttons.forEach((el) => {
            const btnAnswerIndex = Number(el.dataset.answerIndex);
            const symbolEl = el.querySelector(".tile-symbol");
            el.classList.remove("is-muted", "is-wrong", "is-right");
            const isChosen = btnAnswerIndex === selectedAnswerIndex;
            const isRealCorrect = correctIndex !== null ? btnAnswerIndex === correctIndex : isChosen && correct;
            if (isRealCorrect) {
              el.classList.add("is-right");
              symbolEl.textContent = "\u2713";
            } else if (isChosen && !correct) {
              el.classList.add("is-wrong");
              symbolEl.textContent = "x";
            } else {
              el.classList.add("is-muted");
              symbolEl.textContent = "?";
            }
          });

          setPlayerHudState(correct ? "correct" : "incorrect", correct ? "CORRECT" : "INCORRECT");
          const feedbackEl = document.getElementById("answerFeedback");
          const feedbackIcon = document.getElementById("feedbackIcon");
          const feedbackText = document.getElementById("feedbackText");
          feedbackEl.classList.remove("hidden");
          feedbackEl.classList.toggle("correct", correct);
          feedbackIcon.textContent = correct ? "\u2713" : "x";
          if (correct && result.awaitingChestChoice) {
            feedbackText.textContent = "Chest incoming";
          } else if (correct && modeFamily === "assemble" && result?.puzzleReveal?.tileNumber) {
            feedbackText.textContent = `Tile #${result.puzzleReveal.tileNumber} revealed`;
          } else {
            feedbackText.textContent = revealDelayMs > 0
              ? `Wait ${revealDelaySec % 1 === 0 ? revealDelaySec.toFixed(0) : revealDelaySec} second${revealDelaySec === 1 ? "" : "s"}`
              : "Next question";
          }

	          setStatus(correct
	            ? `+${result.gained} gold${result.awaitingChestChoice ? " | chest time" : result?.puzzleReveal?.tileNumber ? ` | tile #${result.puzzleReveal.tileNumber}` : ""}`
	            : "Incorrect");

          playerFeedbackTimer = setTimeout(async () => {
            playerFeedbackLockUntil = 0;
            hideFeedbackBanner();
            await refreshPlayer();
          }, Math.max(10, revealDelayMs));
        } catch (error) {
          playerFeedbackLockUntil = 0;
          setPlayerHudState("", modeText.toUpperCase());
          hideFeedbackBanner();
          Array.from(answerGrid.querySelectorAll(".answer-tile")).forEach((el) => {
            el.classList.remove("is-locked", "is-muted", "is-wrong", "is-right");
            const symbolEl = el.querySelector(".tile-symbol");
            if (symbolEl) symbolEl.textContent = "";
          });
	          setStatus(error.message);
        }
      };
      answerGrid.appendChild(button);
    });

	    let meta = `${modeText} \u2022 Question ${data.questionIndex + 1}/${data.targetQuestions}`;
	    if (typeof data.remainingSec === "number") meta += ` \u2022 ${data.remainingSec}s left`;
	    metaEl.textContent = meta;
	  } catch (error) {
	    document.getElementById("questionPanel").innerHTML = `<h2 class="question-title">${escapeHtml(error.message)}</h2>`;
	    document.getElementById("answerGrid").innerHTML = "";
    if (playerPoll) {
      clearInterval(playerPoll);
      playerPoll = null;
    }
  }
}

document.getElementById("goHost").onclick = () => showView("host");
document.getElementById("goJoin").onclick = () => showView("join");
document.getElementById("backFromHost").onclick = () => showView("home");
document.getElementById("backFromJoin").onclick = () => showView("home");
document.getElementById("runSearch").onclick = searchSets;
document.getElementById("generateAiSet").onclick = generateAiSet;
document.getElementById("aiWithImages").onchange = (event) => {
  const theme = document.getElementById("aiImageTheme");
  theme.disabled = !event.target.checked;
};
document.getElementById("addCustomQuestion").onclick = addCustomQuestion;
document.getElementById("useEditorCustom").onclick = useEditorCustomSet;
document.getElementById("saveCustom").onclick = saveCustomSet;
document.getElementById("loadCustom").onclick = useSavedCustomSet;
document.getElementById("clearCustom").onclick = () => clearCustomEditor();
document.getElementById("closeSetPreview").onclick = () => {
  document.getElementById("setPreviewWrap").classList.add("hidden");
};
document.querySelectorAll(".quick-btn").forEach((btn) => {
  btn.onclick = () => {
    const query = btn.dataset.query || "";
    document.getElementById("searchSets").value = query;
    searchSets();
  };
});
document.getElementById("searchSets").addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchSets();
});
document.getElementById("gameType").addEventListener("change", updateGameTypeFields);
document.getElementById("gameTypeFamily").addEventListener("change", updateGameTypeFields);
updateGameTypeFields();
document.getElementById("goHostMode").onclick = goToHostModeSetup;
document.getElementById("backFromHostMode").onclick = () => showView("host");
document.getElementById("copyJoinLink").onclick = async () => {
  try {
    if (!latestJoinUrl) return;
    await navigator.clipboard.writeText(latestJoinUrl);
    startStatus.textContent = "Join link copied.";
  } catch {
    startStatus.textContent = "Clipboard blocked by browser.";
  }
};

document.getElementById("createHostLobby").onclick = async () => {
  try {
    let customSetPayload = selectedCustomSet;
    if (!selectedSetId && !customSetPayload && customDraftQuestions.length) {
      customSetPayload = getEditorCustomSet();
    }
    if (!selectedSetId && !customSetPayload) throw new Error("Select a live set or build a custom set.");
    const usedOneTimeAiSet = Boolean(customSetPayload?.oneTime);
    const payload = {
      setId: selectedSetId,
      customSet: customSetPayload,
      gameTypeFamily: document.getElementById("gameTypeFamily").value,
      gameType: document.getElementById("gameType").value,
      questionLimit: Number(document.getElementById("questionLimit").value || 20),
      timeLimitSec: Math.round(Number(document.getElementById("timeLimit").value || 2) * 60),
      maxPlayers: Number(document.getElementById("maxPlayers").value || 60),
      feedbackDelaySec: Number(document.getElementById("feedbackDelay").value || 1),
      shuffleQuestions: document.getElementById("shuffleQuestions").checked,
    };
    const data = await api("/api/host", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    currentHostGameCode = data.game.code;
    persistHostSession();
    showView("lobby");
    startStatus.textContent = "Lobby ready.";
    await refreshLobby();
    if (lobbyPoll) clearInterval(lobbyPoll);
    lobbyPoll = setInterval(refreshLobby, 1500);
    if (usedOneTimeAiSet) {
      clearCustomEditor("");
      hostStatus.textContent = "AI one-time set was used and cleared from local editor.";
    }
  } catch (error) {
    if (hostModeStatus) hostModeStatus.textContent = error.message;
    hostStatus.textContent = error.message;
  }
};

document.getElementById("joinLobby").onclick = async () => {
  try {
    const code = document.getElementById("joinCode").value.trim().toUpperCase();
    const name = document.getElementById("joinName").value.trim();
    if (!code || !name) throw new Error("Code and name are required.");
    const data = await api(`/api/games/${code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerName: name }),
    });
    currentPlayer = { code, id: data.player.playerId, name: data.player.playerName, blook: data.player.blook || null };
    persistPlayerSession();
    showView("playerGame");
    await refreshPlayer();
    if (playerPoll) clearInterval(playerPoll);
    playerPoll = setInterval(refreshPlayer, 1200);
  } catch (error) {
    joinStatus.textContent = error.message;
  }
};

document.getElementById("startGame").onclick = async () => {
  try {
    const data = await api(`/api/games/${currentHostGameCode}/start`, { method: "POST" });
    startStatus.textContent = data.message;
    persistHostSession();
    if (isIndexPage) {
      window.location.assign(getCurrentHostRoute());
      return;
    }
    await refreshLobby();
  } catch (error) {
    startStatus.textContent = error.message;
  }
};

async function deleteCurrentLobbyAndExit() {
  if (currentHostGameCode) {
    await fetch(`/api/games/${currentHostGameCode}`, { method: "DELETE" });
  }
  currentHostGameCode = null;
  clearHostSession();
  if (lobbyPoll) clearInterval(lobbyPoll);
  if (goldquestPage && typeof goldquestPage.onLeaveLobby === "function") {
    goldquestPage.onLeaveLobby();
  } else {
    pauseHostMusic(true);
    setEndLeaderboardOpen(false);
  }
  if (isIndexPage) {
    showView("home");
  } else {
    window.location.assign("/index.html");
  }
}

function exitLobbyView() {
  if (lobbyPoll) clearInterval(lobbyPoll);
  lobbyPoll = null;
  if (goldquestPage && typeof goldquestPage.onLeaveLobby === "function") {
    goldquestPage.onLeaveLobby();
  } else {
    pauseHostMusic(true);
    setEndLeaderboardOpen(false);
  }
  clearHostSession();
  if (isIndexPage) {
    showView("home");
  } else {
    window.location.assign("/index.html");
  }
}

const endGameBtn = document.getElementById("endGame");
if (endGameBtn) {
  endGameBtn.onclick = async () => {
    try {
      const data = await api(`/api/games/${currentHostGameCode}/end`, { method: "POST" });
      startStatus.textContent = data.message;
      await refreshLobby();
    } catch (error) {
      startStatus.textContent = error.message;
    }
  };
}

const closeLobbyBtn = document.getElementById("closeLobby");
if (closeLobbyBtn) {
  closeLobbyBtn.onclick = async () => {
    try {
      await deleteCurrentLobbyAndExit();
    } catch (error) {
      startStatus.textContent = error.message || "Could not close lobby.";
    }
  };
}

const endShowAllBtn = document.getElementById("endShowAllBtn");
if (endShowAllBtn) {
  endShowAllBtn.onclick = () => {
    setEndLeaderboardOpen(true);
  };
}

const closeFullLeaderboardBtn = document.getElementById("closeFullLeaderboard");
if (closeFullLeaderboardBtn) {
  closeFullLeaderboardBtn.onclick = () => {
    setEndLeaderboardOpen(false);
  };
}

const fullLeaderboardOverlay = document.getElementById("fullLeaderboardOverlay");
if (fullLeaderboardOverlay) {
  fullLeaderboardOverlay.onclick = (event) => {
    if (event.target === fullLeaderboardOverlay) setEndLeaderboardOpen(false);
  };
}

const endExitBtn = document.getElementById("endExitBtn");
if (endExitBtn) {
  endExitBtn.onclick = () => {
    exitLobbyView();
  };
}

const endActionBtn = document.getElementById("endActionBtn");
if (endActionBtn) {
  endActionBtn.onclick = async () => {
    try {
      await deleteCurrentLobbyAndExit();
    } catch (error) {
      startStatus.textContent = error.message || "Could not close lobby.";
    }
  };
}

window.addEventListener("resize", () => {
  fitChestLayout();
});

document.getElementById("aiImageTheme").disabled = !document.getElementById("aiWithImages").checked;
setEditorSource("manual");
if (isIndexPage) {
  renderCustomQuestionList();
  searchSets();
}
prefillJoinCodeFromQuery();
if (window.GreenitPages && typeof window.GreenitPages.applyEntryPreset === "function") {
  window.GreenitPages.applyEntryPreset({
    showView,
    updateGameTypeFields,
  });
}

(async () => {
  if (isGoldquestHostPage) {
    const resumed = await resumeHostGamePage();
    if (!resumed) showView("host");
    return;
  }
  if (isGoldquestPlayerPage) {
    const resumed = await resumePlayerGamePage();
    if (!resumed) showView("join");
  }
})();
