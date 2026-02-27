const views = ["home", "host", "join", "lobby", "playerGame"];
let currentHostGameCode = null;
let lobbyPoll = null;
let playerPoll = null;
let currentPlayer = { code: null, id: null, name: null, blook: null };
let selectedSetId = null;
let selectedCustomSet = null;
let generatedAiSet = null;
let customDraftQuestions = [];
let currentEditorSource = "manual";
let latestJoinUrl = "";
let playerFeedbackLockUntil = 0;
let playerFeedbackTimer = null;

const hostStatus = document.getElementById("hostStatus");
const joinStatus = document.getElementById("joinStatus");
const startStatus = document.getElementById("startStatus");

function showView(viewId) {
  views.forEach((id) => {
    document.getElementById(id).classList.toggle("hidden", id !== viewId);
  });
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

function prefillJoinCodeFromQuery() {
  const code = new URLSearchParams(location.search).get("code");
  if (code) {
    document.getElementById("joinCode").value = code.toUpperCase();
  }
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

async function refreshLobby() {
  if (!currentHostGameCode) return;
  const data = await api(`/api/games/${currentHostGameCode}/lobby`);
  const phase = data.game.state === "lobby" ? "lobby" : data.game.state === "live" ? "live" : "ended";

  const lobbyEl = document.getElementById("lobby");
  lobbyEl.dataset.phase = phase;
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
    `${data.game.mode} â¢ ${data.game.setTitle} â¢ PIN ${data.game.hostPin} â¢ ${settings.gameType === "timed" ? `${settings.timeLimitSec}s` : `${settings.questionLimit} Q`} â¢ ${data.game.state}`;

  const sortedPlayers = [...data.game.players].sort((a, b) => b.gold - a.gold);
  renderLobbyPlayers(sortedPlayers, phase);
  renderEventFeed(data.game.eventLog || []);

  const startBtn = document.getElementById("startGame");
  startBtn.disabled = phase !== "lobby";
  startBtn.textContent = phase === "lobby" ? "Start" : phase === "live" ? "Live" : "Ended";

  if (data.game.state === "ended") startStatus.textContent = "Game ended for everyone.";
}

function chestIconMeta(type) {
  if (type === "swap") return { glyph: "â", className: "icon-swap" };
  if (type === "take_percent") return { glyph: "â¤´", className: "icon-take" };
  if (type === "lose_percent" || type === "lose_flat") return { glyph: "â", className: "icon-loss" };
  if (type === "bonus_percent" || type === "bonus_flat") return { glyph: "+", className: "icon-gain" };
  if (type === "no_interaction") return { glyph: "!", className: "icon-neutral" };
  return { glyph: "â¢", className: "icon-neutral" };
}

function chestOutcomeDetail(result) {
  const before = Number(result?.playerBefore);
  const after = Number(result?.playerAfter);
  const parts = [];
  if (Number.isFinite(before) && Number.isFinite(after)) {
    parts.push(`You: ${before} â ${after}`);
  }
  if (result?.target && Number.isFinite(Number(result?.targetBefore)) && Number.isFinite(Number(result?.targetAfter))) {
    parts.push(`${result.target}: ${Number(result.targetBefore)} â ${Number(result.targetAfter)}`);
  }
  return parts.join(" | ");
}

function chestDeltaLabel(delta) {
  const value = Number(delta);
  if (!Number.isFinite(value)) return "";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value} gold`;
}

function chestImpactMarkup(result) {
  const playerBefore = Number(result?.playerBefore);
  const playerAfter = Number(result?.playerAfter);
  const playerDelta = playerAfter - playerBefore;
  const hasPlayer = Number.isFinite(playerBefore) && Number.isFinite(playerAfter);
  const targetName = String(result?.target || "").trim();
  const targetBefore = Number(result?.targetBefore);
  const targetAfter = Number(result?.targetAfter);
  const hasTarget = !!targetName && Number.isFinite(targetBefore) && Number.isFinite(targetAfter);

  if (!hasPlayer) return "";

  const playerDeltaClass = playerDelta > 0 ? "positive" : playerDelta < 0 ? "negative" : "";
  const playerCard = `
    <div class="impact-card">
      <div class="impact-label">You</div>
      <div class="impact-main">${playerBefore} â ${playerAfter}</div>
      <div class="impact-delta ${playerDeltaClass}">${escapeHtml(chestDeltaLabel(playerDelta))}</div>
    </div>
  `;

  if (!hasTarget) {
    return `<div class="chest-impact-grid single">${playerCard}</div>`;
  }

  const targetDelta = targetAfter - targetBefore;
  const targetDeltaClass = targetDelta > 0 ? "positive" : targetDelta < 0 ? "negative" : "";
  const connector = result?.type === "swap" ? "â" : "â";
  return `
    <div class="chest-impact-grid">
      ${playerCard}
      <div class="impact-connector">${connector}</div>
      <div class="impact-card">
        <div class="impact-label">${escapeHtml(targetName)}</div>
        <div class="impact-main">${targetBefore} â ${targetAfter}</div>
        <div class="impact-delta ${targetDeltaClass}">${escapeHtml(chestDeltaLabel(targetDelta))}</div>
      </div>
    </div>
  `;
}

function chestOutcomeMeta(type) {
  if (type === "bonus_flat" || type === "bonus_percent") return { className: "is-gain", badge: "+" };
  if (type === "lose_flat" || type === "lose_percent") return { className: "is-loss", badge: "â" };
  if (type === "take_percent") return { className: "is-take", badge: "â¤´" };
  if (type === "swap") return { className: "is-swap", badge: "â" };
  return { className: "is-neutral", badge: "â¢" };
}

async function chooseChestOption(optionIndex) {
  return api(`/api/games/${currentPlayer.code}/player/${currentPlayer.id}/chest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ optionIndex }),
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
    document.getElementById("playerHudName").textContent = currentPlayer.name || "player";
    document.getElementById("playerHudGold").textContent = String(data.gold || 0);
    const modeText = data.gameType === "timed" ? "Time Attack" : "Gold Quest";
    const feedbackDelaySec = Math.max(0, Math.min(Number(data.feedbackDelaySec ?? 1), 5));
    const feedbackDelayMs = Math.round(feedbackDelaySec * 1000);
    hideFeedbackBanner();
    if (playerFeedbackTimer) {
      clearTimeout(playerFeedbackTimer);
      playerFeedbackTimer = null;
    }

    if (data.ended) {
      setPlayerHudState("incorrect", "GAME OVER");
      panel.innerHTML = '<h2 class="question-title">Host ended the game.</h2>';
      answerGrid.innerHTML = "";
      metaEl.textContent = "Game ended";
      if (playerPoll) {
        clearInterval(playerPoll);
        playerPoll = null;
      }
      return;
    }

    if (data.waiting) {
      setPlayerHudState("", "WAITING");
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
          <div class="wait-pick-wrap">
            <div class="wait-pick-head">Waiting for host to start. Pick your blook:</div>
            <div id="waitBlookGrid" class="grid"></div>
          </div>
        `;
        panel.dataset.waitBlookCatalogKey = catalogKey;
        const waitGrid = document.getElementById("waitBlookGrid");
        catalog.forEach((blook) => {
          const card = document.createElement("div");
          card.className = "avatar";
          card.dataset.blookId = blook.id;
          card.innerHTML = `
            <img src="${blook.imageUrl}" alt="${escapeHtml(blook.name)}" />
            <div>${escapeHtml(blook.name)}</div>
            <small>Available</small>
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
              statusEl.textContent = error.message;
            }
          };
          waitGrid.appendChild(card);
        });
      }

      const waitGrid = document.getElementById("waitBlookGrid");
      Array.from(waitGrid.querySelectorAll(".avatar")).forEach((card) => {
        const blookId = card.dataset.blookId || "";
        const takenByOther = takenIds.has(blookId);
        const isCurrent = !!(current && current.id === blookId);
        card.classList.toggle("is-current", isCurrent);
        card.classList.toggle("is-taken", takenByOther);
        card.style.pointerEvents = takenByOther && !isCurrent ? "none" : "auto";
        const label = card.querySelector("small");
        if (label) label.textContent = isCurrent ? "Selected" : takenByOther ? "Taken" : "Available";
      });

      statusEl.textContent = current ? `Selected blook: ${current.name}` : "Select a blook (unique per lobby).";
      metaEl.textContent = "Lobby waiting room";
      return;
    }

    if (data.finished) {
      setPlayerHudState("correct", "COMPLETE");
      panel.innerHTML = `<h2 class="question-title">Done! Final gold: ${data.gold}</h2>`;
      answerGrid.innerHTML = "";
      metaEl.textContent = `Answered: ${data.answered || 0}`;
      if (playerPoll) {
        clearInterval(playerPoll);
        playerPoll = null;
      }
      return;
    }

    if (data.chestPhase === "choose" && data.chest) {
      setPlayerHudState("correct", "CHEST");
      statusEl.textContent = "Choose a chest.";
      answerGrid.innerHTML = "";
      panel.innerHTML = `
        <div class="chest-screen">
          <div class="chest-banner">
            <div class="chest-banner-inner">Choose a Chest!</div>
          </div>
          <div class="chest-row">
            <button class="chest-btn" data-chest="0" type="button"><img src="/chetsicons/chest1.svg" alt="Chest 1" /></button>
            <button class="chest-btn" data-chest="1" type="button"><img src="/chetsicons/chest2.svg" alt="Chest 2" /></button>
            <button class="chest-btn" data-chest="2" type="button"><img src="/chetsicons/chest3.svg" alt="Chest 3" /></button>
          </div>
        </div>
      `;
      const chestButtons = Array.from(panel.querySelectorAll("[data-chest]"));
      chestButtons.forEach((button) => {
        button.onclick = async () => {
          try {
            if (Date.now() < playerFeedbackLockUntil) return;
            playerFeedbackLockUntil = Date.now() + 450;
            chestButtons.forEach((entry) => {
              entry.disabled = true;
              entry.classList.add("is-disabled");
              entry.style.pointerEvents = "none";
            });
            await chooseChestOption(Number(button.dataset.chest));
            playerFeedbackLockUntil = 0;
            await refreshPlayer();
          } catch (error) {
            playerFeedbackLockUntil = 0;
            statusEl.textContent = error.message;
            chestButtons.forEach((entry) => {
              entry.disabled = false;
              entry.classList.remove("is-disabled");
              entry.style.pointerEvents = "auto";
            });
          }
        };
      });
      let meta = `${modeText} â¢ Chest reward`;
      if (typeof data.remainingSec === "number") meta += ` â¢ ${data.remainingSec}s left`;
      metaEl.textContent = meta;
      return;
    }

    if (data.chestPhase === "result" && data.chest) {
      const options = Array.isArray(data.chest.options) ? data.chest.options : [];
      const selectedIndex = Number(data.chest.selectedIndex);
      const result = data.chest.result || {};
      const noInteraction = !!result.noInteraction;
      const outcomeHeadline = result.headline || result.label || "Chest Result";
      const outcomeDetail = chestOutcomeDetail(result);
      const impactHtml = chestImpactMarkup(result);
      const outcomeMeta = chestOutcomeMeta(result.type);
      const outcomeClass = `chest-outcome ${outcomeMeta.className}`;
      setPlayerHudState("correct", noInteraction ? "NO TARGET" : "CHEST");
      answerGrid.innerHTML = "";
      statusEl.textContent = result.text || "";

      if (noInteraction) {
        panel.innerHTML = `
          <div class="chest-screen">
            <div class="chest-banner">
              <div class="chest-banner-inner">No Players to Interact With</div>
            </div>
            <button id="chestNextBtn" class="chest-next-btn" type="button">Next</button>
          </div>
        `;
      } else {
        const choicesHtml = options.map((option, index) => {
          const icon = chestIconMeta(option.type);
          return `
            <div class="result-choice ${index === selectedIndex ? "active" : ""}">
              <div class="result-icon ${icon.className}"><span>${icon.glyph}</span></div>
              <div class="result-label">${escapeHtml(option.label)}</div>
            </div>
          `;
        }).join("");

        panel.innerHTML = `
          <div class="chest-screen" id="chestResultRoot" style="cursor:pointer;">
            <div class="chest-banner">
              <div class="chest-banner-inner">Click Anywhere to Go Next</div>
            </div>
            <div class="chest-result-row">${choicesHtml}</div>
            <div class="${outcomeClass}">
              <div class="chest-outcome-top">
                <span class="chest-outcome-badge">${outcomeMeta.badge}</span>
                <div class="chest-outcome-head">${escapeHtml(outcomeHeadline)}</div>
              </div>
              <div class="chest-note">${escapeHtml(result.text || "")}</div>
              ${impactHtml || ""}
              ${!impactHtml && outcomeDetail ? `<div class="chest-note subtle">${escapeHtml(outcomeDetail)}</div>` : ""}
            </div>
          </div>
        `;
      }

      const goNext = async () => {
        try {
          if (Date.now() < playerFeedbackLockUntil) return;
          playerFeedbackLockUntil = Date.now() + 350;
          await completeChestResult();
          playerFeedbackLockUntil = 0;
          await refreshPlayer();
        } catch (error) {
          playerFeedbackLockUntil = 0;
          statusEl.textContent = error.message;
        }
      };

      const root = document.getElementById("chestResultRoot");
      if (root) root.onclick = goNext;
      const nextBtn = document.getElementById("chestNextBtn");
      if (nextBtn) nextBtn.onclick = goNext;

      let meta = `${modeText} â¢ Chest resolved`;
      if (typeof data.remainingSec === "number") meta += ` â¢ ${data.remainingSec}s left`;
      metaEl.textContent = meta;
      return;
    }

    const media = getQuestionMedia(data.question);
    setPlayerHudState("", modeText.toUpperCase());
    statusEl.textContent = "";
    const promptClass = media.imageUrl ? "prompt-wrap" : "prompt-wrap prompt-no-media";
    panel.innerHTML = `
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
              symbolEl.textContent = "â";
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
          feedbackIcon.textContent = correct ? "â" : "x";
          if (correct && result.awaitingChestChoice) {
            feedbackText.textContent = "Chest incoming";
          } else {
            feedbackText.textContent = revealDelayMs > 0
              ? `Wait ${revealDelaySec % 1 === 0 ? revealDelaySec.toFixed(0) : revealDelaySec} second${revealDelaySec === 1 ? "" : "s"}`
              : "Next question";
          }

          statusEl.textContent = correct
            ? `+${result.gained} gold${result.awaitingChestChoice ? " | chest time" : ""}`
            : "Incorrect";

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
          statusEl.textContent = error.message;
        }
      };
      answerGrid.appendChild(button);
    });

    let meta = `${modeText} â¢ Question ${data.questionIndex + 1}/${data.targetQuestions}`;
    if (typeof data.remainingSec === "number") meta += ` â¢ ${data.remainingSec}s left`;
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
    if (!selectedSetId && customDraftQuestions.length) {
      customSetPayload = getEditorCustomSet();
    }
    if (!selectedSetId && !customSetPayload) throw new Error("Select a live set or build a custom set.");
    const usedOneTimeAiSet = Boolean(customSetPayload?.oneTime);
    const payload = {
      setId: selectedSetId,
      customSet: customSetPayload,
      gameType: document.getElementById("gameType").value,
      questionLimit: Number(document.getElementById("questionLimit").value || 20),
      timeLimitSec: Number(document.getElementById("timeLimit").value || 120),
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
    await refreshLobby();
  } catch (error) {
    startStatus.textContent = error.message;
  }
};

document.getElementById("endGame").onclick = async () => {
  try {
    const data = await api(`/api/games/${currentHostGameCode}/end`, { method: "POST" });
    startStatus.textContent = data.message;
    await refreshLobby();
  } catch (error) {
    startStatus.textContent = error.message;
  }
};

document.getElementById("closeLobby").onclick = async () => {
  if (!currentHostGameCode) return showView("home");
  await fetch(`/api/games/${currentHostGameCode}`, { method: "DELETE" });
  currentHostGameCode = null;
  if (lobbyPoll) clearInterval(lobbyPoll);
  showView("home");
};

document.getElementById("aiImageTheme").disabled = !document.getElementById("aiWithImages").checked;
setEditorSource("manual");
renderCustomQuestionList();
searchSets();
prefillJoinCodeFromQuery();
