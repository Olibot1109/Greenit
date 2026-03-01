const urlParams = new URLSearchParams(window.location.search);
const gameCode = urlParams.get('code');
const playerId = urlParams.get('player');

if (!gameCode || !playerId) window.location.replace('/index.html');

const stageIds = [
  'fishingActionStage', 'questionStage', 'feedbackStage', 'catchResultStage', 'waitingStage', 'finishedStage'
];
const LURE_ARTS = [
  '/icons/lure1.svg',
  '/icons/lure2.svg',
  '/icons/lure3.svg',
  '/icons/lure4.svg',
  '/icons/lure5.svg',
  '/icons/lure6.svg',
];

let pollInterval = null;
let playerName = 'player';
let transitionLock = false;
let actionBusy = false;
let currentAnswers = [];
let currentStageId = '';
let currentFishingAction = '';
let lastQuestionRenderKey = '';
let fitRafId = 0;
let lastServerData = null;
let lureSyncRafId = 0;
let lastWorldPotionToken = '';
let wrongFeedbackTimer = 0;
let lastWrongFeedbackKey = '';
let currentLureIndex = 0;

function setLureArtByIndex(index) {
  const lureEl = document.querySelector('.lure-art');
  if (!lureEl || !LURE_ARTS.length) return;
  const safeIndex = Math.max(0, Math.min(LURE_ARTS.length - 1, Number(index || 0)));
  const nextSrc = LURE_ARTS[safeIndex];
  if (String(lureEl.getAttribute('src') || '') !== nextSrc) {
    lureEl.setAttribute('src', nextSrc);
  }
}

function lureIndexFromProgress(data) {
  const lbs = Number(data?.gold || data?.totalGold || 0);
  if (lbs >= 1800) return 5;
  if (lbs >= 1000) return 4;
  if (lbs >= 550) return 3;
  if (lbs >= 250) return 2;
  if (lbs >= 90) return 1;
  return 0;
}

function syncLureVariant(data) {
  currentLureIndex = lureIndexFromProgress(data);
  setLureArtByIndex(currentLureIndex);
}

function syncLureRigToRodTip() {
  const scene = document.querySelector('.fishing-scene');
  const rod = document.querySelector('.rod-art');
  const lureRig = document.querySelector('.lure-rig');
  if (!scene || !rod || !lureRig) return;

  const sceneRect = scene.getBoundingClientRect();
  const rodRect = rod.getBoundingClientRect();
  const css = getComputedStyle(scene);
  const tipXFactor = Number.parseFloat(css.getPropertyValue('--rod-tip-x-factor')) || 0.93;
  const tipYFactor = Number.parseFloat(css.getPropertyValue('--rod-tip-y-factor')) || 0.08;
  const tipXOffset = Number.parseFloat(css.getPropertyValue('--rod-tip-x-offset')) || 0;
  const tipYOffset = Number.parseFloat(css.getPropertyValue('--rod-tip-y-offset')) || 0;
  const tipX = rodRect.left + (rodRect.width * tipXFactor) + tipXOffset;
  const tipY = rodRect.top + (rodRect.height * tipYFactor) + tipYOffset;

  lureRig.style.left = `${Math.round(tipX - sceneRect.left - (lureRig.offsetWidth / 2))}px`;
  lureRig.style.top = `${Math.round(tipY - sceneRect.top)}px`;
}

function queueLureSync() {
  if (lureSyncRafId) cancelAnimationFrame(lureSyncRafId);
  lureSyncRafId = requestAnimationFrame(() => {
    syncLureRigToRodTip();
    lureSyncRafId = 0;
  });
}

function setVisualPhase(phase) {
  const main = document.querySelector('.main');
  if (!main) return;
  main.classList.remove('phase-cast', 'phase-waiting', 'phase-pull', 'phase-question', 'phase-result');
  main.classList.add(`phase-${String(phase || 'cast')}`);
  queueLureSync();
}

function triggerCastAnimation(kind) {
  const main = document.querySelector('.main');
  if (!main) return;
  if (kind === 'cast') {
    main.classList.remove('cast-anim');
    // Force reflow so animation can retrigger on rapid casts.
    // eslint-disable-next-line no-unused-expressions
    main.offsetWidth;
    main.classList.add('cast-anim');
    queueLureSync();
    setTimeout(queueLureSync, 90);
    setTimeout(queueLureSync, 240);
    setTimeout(() => main.classList.remove('cast-anim'), 540);
    return;
  }
  if (kind === 'pull') {
    main.classList.remove('pull-anim');
    // eslint-disable-next-line no-unused-expressions
    main.offsetWidth;
    main.classList.add('pull-anim');
    queueLureSync();
    setTimeout(queueLureSync, 90);
    setTimeout(queueLureSync, 210);
    setTimeout(() => main.classList.remove('pull-anim'), 420);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text || '');
  return div.innerHTML;
}

function shouldRedirectForMissingGame(status, message) {
  const normalized = String(message || '').toLowerCase();
  return status === 404 || status === 410 || normalized.includes('game not found') || normalized.includes('player not found');
}

function showStage(id) {
  currentStageId = id;
  stageIds.forEach((stageId) => {
    const el = document.getElementById(stageId);
    if (el) el.classList.toggle('active', stageId === id);
  });
}

function setHud(data) {
  if (data?.playerName) playerName = data.playerName;
  document.getElementById('hudName').textContent = playerName;
  const pounds = Number(data?.gold || data?.totalGold || 0);
  document.getElementById('goldAmount').textContent = pounds.toLocaleString();
}

function setSceneHint(text) {
  const el = document.getElementById('sceneHint');
  if (!el) return;
  el.textContent = String(text || '');
}

function updateLureBadge(resultOrCatch) {
  const badge = document.getElementById('lureCatchBadge');
  if (!badge) return;
  const payload = resultOrCatch && typeof resultOrCatch === 'object' ? resultOrCatch : null;
  if (!payload) {
    badge.classList.add('hidden');
    badge.textContent = '';
    return;
  }
  badge.classList.remove('hidden');
  badge.classList.add('hidden');
  badge.textContent = '';
}

function applyWorldPotionEffect(effect) {
  const main = document.querySelector('.main');
  if (!main) return;
  main.classList.remove('world-potion-active', 'world-potion-ink', 'world-potion-prism', 'world-potion-fog');
  if (!effect?.active) return;

  const style = String(effect.style || 'ink').toLowerCase();
  main.classList.add('world-potion-active');
  if (style === 'prism') {
    main.classList.add('world-potion-prism');
  } else if (style === 'fog') {
    main.classList.add('world-potion-fog');
  } else {
    main.classList.add('world-potion-ink');
  }

  const token = String(effect.token || '');
  if (token && token !== lastWorldPotionToken && currentStageId === 'fishingActionStage') {
    setSceneHint(`${String(effect.label || 'Potion Effect')} is active for everyone.`);
    lastWorldPotionToken = token;
  }
}

async function pollGame() {
  if (transitionLock) return;
  try {
    const res = await fetch(`/api/games/${gameCode}/player/${playerId}`);
    const data = await res.json();

    if (!res.ok) {
      if (shouldRedirectForMissingGame(res.status, data?.error)) {
        window.location.replace('/index.html');
        return;
      }
      return;
    }

    lastServerData = data;
    setHud(data);
    updateUI(data);
  } catch (error) {
    console.error('poll error', error);
  }
}

function updateUI(data) {
  applyWorldPotionEffect(data?.fishingWorldEffect || null);

  if (data.state === 'ended' || data.ended || data.state === 'finished' || data.finished) {
    showFinished(data);
    return;
  }

  if (data.state !== 'live') {
    showWaiting(data);
    return;
  }

  const fishing = data.fishing || null;
  if (!fishing) {
    if (data.question) {
      showQuestion(data);
      return;
    }
    showFishingAction({ fishing: { phase: 'cast' } });
    return;
  }
  syncLureVariant(data);

  if (fishing.phase === 'question' && data.question) {
    showQuestion(data);
    return;
  }

  if (fishing.phase === 'result') {
    showCatchResult(data);
    return;
  }

  showFishingAction(data);
}

function showWaiting(data) {
  showStage('waitingStage');
  setVisualPhase('cast');
  setSceneHint('Waiting for host to start...');
  updateLureBadge(null);

  const waitingSub = document.getElementById('waitingSub');
  if (waitingSub) waitingSub.textContent = 'Choose your blook while you wait.';

  const grid = document.getElementById('blookGrid');
  const catalog = data?.blookSelection?.catalog || [];
  const takenIds = data?.blookSelection?.takenIds || [];
  const current = data?.blookSelection?.current;

  if (!catalog.length) {
    grid.innerHTML = '';
    return;
  }

  grid.innerHTML = catalog.map((blook) => {
    const isTaken = takenIds.includes(blook.id);
    const isSelected = current?.id === blook.id;
    return `
      <div class="blook-card ${isTaken ? 'taken' : ''} ${isSelected ? 'selected' : ''}" ${!isTaken ? `onclick="selectBlook('${escapeHtml(blook.id)}')"` : ''}>
        <img src="${escapeHtml(blook.imageUrl)}" alt="${escapeHtml(blook.name)}" />
        <div>${escapeHtml(blook.name)}</div>
      </div>
    `;
  }).join('');
}

async function selectBlook(blookId) {
  try {
    await fetch(`/api/games/${gameCode}/player/${playerId}/blook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blookId }),
    });
  } catch (error) {
    console.error('blook select error', error);
  }
}

function showFishingAction(data) {
  showStage('fishingActionStage');
  const fishing = data?.fishing || { phase: 'cast' };
  const phase = String(fishing.phase || 'cast');
  const remainingSec = Math.max(0, Math.ceil(Number(fishing.waitRemainingMs || 0) / 1000));

  const titleEl = document.getElementById('fishingActionTitle');
  const subEl = document.getElementById('fishingActionSub');
  const btn = document.getElementById('fishingActionBtn');

  currentFishingAction = '';
  btn.disabled = false;

  if (phase === 'cast') {
    setVisualPhase('cast');
    titleEl.textContent = 'Ready to Cast';
    subEl.textContent = 'Click to cast your rod into the ocean.';
    btn.textContent = actionBusy ? 'Casting...' : 'Cast Rod';
    currentFishingAction = 'cast';
    setSceneHint('Click anywhere to cast');
    updateLureBadge(null);
    return;
  }

  if (phase === 'waiting') {
    setVisualPhase('waiting');
    titleEl.textContent = 'Waiting for a Bite';
    subEl.textContent = 'Hold tight. The fish is approaching your lure.';
    btn.textContent = `Waiting... ${remainingSec}s`;
    btn.disabled = true;
    const tide = fishing.pendingCatch?.tide || null;
    setSceneHint(tide?.active ? `${tide.label} is flowing... wait for a bite.` : 'Waiting for a bite...');
    updateLureBadge(fishing.pendingCatch || null);
    return;
  }

  if (phase === 'pull') {
    setVisualPhase('pull');
    titleEl.textContent = 'Fish on the Hook';
    subEl.textContent = 'Click to pull up and answer the question.';
    btn.textContent = actionBusy ? 'Pulling...' : 'Pull Up';
    currentFishingAction = 'pull';
    const tide = fishing.pendingCatch?.tide || null;
    setSceneHint(tide?.active ? `${tide.label}! Pull up now!` : 'Click to pull up');
    updateLureBadge(fishing.pendingCatch || null);
    return;
  }

  setVisualPhase('cast');
  titleEl.textContent = 'Get Ready';
  subEl.textContent = 'Cast when you are ready.';
  btn.textContent = 'Cast Rod';
  currentFishingAction = 'cast';
  setSceneHint('Click anywhere to cast');
  updateLureBadge(null);
}

async function runFishingAction() {
  if (!currentFishingAction || actionBusy) return;
  const requestedAction = currentFishingAction;
  actionBusy = true;
  if (requestedAction === 'cast') {
    setVisualPhase('waiting');
    triggerCastAnimation('cast');
  } else if (requestedAction === 'pull') {
    setVisualPhase('pull');
    triggerCastAnimation('pull');
  }
  showFishingAction(lastServerData || { fishing: { phase: currentFishingAction === 'cast' ? 'cast' : 'pull' } });
  try {
    const res = await fetch(`/api/games/${gameCode}/player/${playerId}/fishing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: requestedAction }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (shouldRedirectForMissingGame(res.status, data?.error)) {
        window.location.replace('/index.html');
        return;
      }
    }
  } catch (error) {
    console.error('fishing action error', error);
  } finally {
    actionBusy = false;
    await pollGame();
  }
}

function showQuestion(data) {
  const q = data.question || {};
  const answers = Array.isArray(q.answers) ? q.answers : [];
  const renderKey = [
    String(Number(data.questionIndex || 0)),
    String(q.q || '').trim(),
    String(q.imageUrl || '').trim(),
    answers.join('\u0001'),
    String(data?.fishing?.pendingCatch?.id || ''),
    String(data?.fishing?.pendingCatch?.tide?.token || ''),
  ].join('\u0002');

  if (renderKey === lastQuestionRenderKey && currentStageId === 'questionStage') {
    return;
  }

  lastQuestionRenderKey = renderKey;
  showStage('questionStage');
  setVisualPhase('question');
  setSceneHint('Answer correctly to secure the catch');

  document.getElementById('questionText').textContent = String(q.q || '').trim() || `Question ${(Number(data.questionIndex || 0) + 1)}`;
  const pending = data?.fishing?.pendingCatch || null;
  const context = document.getElementById('questionContext');
  if (context) {
    context.textContent = '';
  }

  const img = document.getElementById('questionImage');
  if (q.imageUrl) {
    img.src = q.imageUrl;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
  }

  updateLureBadge(pending);

  currentAnswers = answers.slice();
  const classes = ['a-yellow', 'a-blue', 'a-green', 'a-red'];
  const grid = document.getElementById('answerGrid');
  grid.innerHTML = answers.map((answer, index) => `
    <button class="answer-btn ${classes[index % classes.length]}" onclick="submitAnswer(${index})">${escapeHtml(answer)}</button>
  `).join('');

  if (fitRafId) cancelAnimationFrame(fitRafId);
  fitRafId = requestAnimationFrame(() => {
    fitQuestionLayout();
    fitRafId = 0;
  });
}

async function submitAnswer(answerIndex) {
  if (transitionLock) return;
  transitionLock = true;
  document.querySelectorAll('#answerGrid .answer-btn').forEach((btn) => { btn.disabled = true; });
  try {
    const res = await fetch(`/api/games/${gameCode}/player/${playerId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answerIndex }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (shouldRedirectForMissingGame(res.status, data?.error)) {
        window.location.replace('/index.html');
        return;
      }
      transitionLock = false;
      await pollGame();
      return;
    }

    setHud({ playerName: data.playerName, gold: data.totalGold });
    lastServerData = {
      ...(lastServerData || {}),
      state: 'live',
      playerName: data.playerName || playerName,
      gold: data.totalGold,
      fishing: data.fishing || null,
    };
    updateUI(lastServerData);
  } catch (error) {
    console.error('answer error', error);
  } finally {
    transitionLock = false;
  }
}

function showCatchResult(data) {
  const result = data?.fishing?.lastResult || data?.fishingResult || null;
  const caught = Boolean(result?.caught);
  if (!caught) {
    showIncorrectFeedback(data);
    return;
  }

  showStage('catchResultStage');
  setVisualPhase('result');
  const tier = String(result?.tier || '-').toUpperCase();

  const cardEl = document.querySelector('.catch-result-card');
  const kickerEl = document.getElementById('catchResultKicker');
  const titleEl = document.getElementById('catchResultTitle');
  const subEl = document.getElementById('catchResultSub');
  const tierLetterEl = document.getElementById('catchTierLetter');
  const weightEl = document.getElementById('catchWeightText');
  const imageEl = document.getElementById('catchResultImage');

  const tierKicker = {
    S: "Angler's Legend",
    SS: 'Mythic Catch',
    A: 'Master Catch',
    B: 'Skilled Reel',
    C: 'Easy One',
    D: 'Small Fry',
    E: 'Debris Haul',
    F: 'Barely Biting',
  };

  cardEl?.classList.remove('lost');
  if (String(result?.rarity || '').toLowerCase() === 'rare') {
    kickerEl.textContent = 'Rare Encounter';
  } else if (result?.event?.active) {
    kickerEl.textContent = result.event.label || "Angler's Catch";
  } else if (result?.tide?.active) {
    kickerEl.textContent = `${result.tide.label} Catch`;
  } else {
    kickerEl.textContent = tierKicker[tier] || "Angler's Catch";
  }
  titleEl.textContent = result?.name || 'Unknown Catch';
  subEl.textContent = result?.text || 'You landed it.';
  setSceneHint('Click cast again to throw another line');
  updateLureBadge(result);

  tierLetterEl.textContent = tier || '-';
  weightEl.textContent = `${Number(result?.lbs || 0).toLocaleString()} lbs`;

  if (result?.imageUrl) {
    imageEl.src = result.imageUrl;
    imageEl.classList.remove('hidden');
  } else {
    imageEl.classList.add('hidden');
  }
}

function showIncorrectFeedback(data) {
  showStage('feedbackStage');
  setVisualPhase('result');
  setSceneHint('');
  updateLureBadge(null);

  const result = data?.fishing?.lastResult || data?.fishingResult || null;
  const key = [
    String(data?.questionIndex || ''),
    String(result?.name || ''),
    String(result?.lbs || ''),
    String(result?.tier || ''),
  ].join('|');
  const isSame = key === lastWrongFeedbackKey;
  lastWrongFeedbackKey = key;

  const wrap = document.getElementById('feedbackWrap');
  const title = document.getElementById('feedbackTitle');
  const icon = document.getElementById('feedbackIcon');
  const sub = document.getElementById('feedbackSub');
  if (!wrap || !title || !icon || !sub) return;

  wrap.className = 'feedback-wrap incorrect';
  title.textContent = 'INCORRECT';
  icon.innerHTML = '<i class="fa-solid fa-xmark"></i>';

  let canContinue = false;
  if (!isSame) {
    sub.textContent = 'Wait...';
    if (wrongFeedbackTimer) clearTimeout(wrongFeedbackTimer);
    wrongFeedbackTimer = setTimeout(() => {
      canContinue = true;
      sub.textContent = 'Click Anywhere to Cast Again';
    }, 1200);
  } else {
    canContinue = true;
    sub.textContent = 'Click Anywhere to Cast Again';
  }

  wrap.onclick = async () => {
    if (!canContinue || actionBusy) return;
    wrap.onclick = null;
    await nextCast();
  };
}

async function nextCast() {
  if (actionBusy) return;
  actionBusy = true;
  try {
    const res = await fetch(`/api/games/${gameCode}/player/${playerId}/fishing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'next' }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (shouldRedirectForMissingGame(res.status, data?.error)) {
        window.location.replace('/index.html');
        return;
      }
    }
  } catch (error) {
    console.error('next cast error', error);
  } finally {
    actionBusy = false;
    await pollGame();
  }
}

function fitTextToBox(el, maxSize, minSize) {
  if (!el) return;
  let size = maxSize;
  el.style.fontSize = `${size}px`;
  while (size > minSize && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
    size -= 1;
    el.style.fontSize = `${size}px`;
  }
}

function fitQuestionLayout() {
  const qText = document.getElementById('questionText');
  fitTextToBox(qText, 86, 26);
  document.querySelectorAll('#answerGrid .answer-btn').forEach((btn) => fitTextToBox(btn, 56, 18));
}

function showFinished(data) {
  if (wrongFeedbackTimer) {
    clearTimeout(wrongFeedbackTimer);
    wrongFeedbackTimer = 0;
  }
  showStage('finishedStage');
  setVisualPhase('result');
  setSceneHint('Game complete');
  updateLureBadge(null);
  document.getElementById('finalGold').innerHTML = `${Number(data?.gold || 0).toLocaleString()} lbs`;
  const winnerEl = document.getElementById('finalWinner');
  if (winnerEl) {
    const winnerName = String(data?.winner?.playerName || '').trim();
    const winnerLbs = Number(data?.winner?.lbs || 0);
    if (winnerName) {
      const ownName = String(data?.playerName || playerName || '').trim();
      winnerEl.textContent = winnerName === ownName
        ? `Winner: You (${winnerLbs.toLocaleString()} lbs)`
        : `Winner: ${winnerName} (${winnerLbs.toLocaleString()} lbs)`;
    } else {
      winnerEl.textContent = '';
    }
  }
}

pollGame();
pollInterval = setInterval(pollGame, 1000);
setLureArtByIndex(currentLureIndex);
queueLureSync();
setTimeout(queueLureSync, 120);
setTimeout(queueLureSync, 320);

window.addEventListener('beforeunload', () => {
  if (pollInterval) clearInterval(pollInterval);
});

window.selectBlook = selectBlook;
window.submitAnswer = submitAnswer;
window.runFishingAction = runFishingAction;
window.nextCast = nextCast;

window.addEventListener('resize', () => {
  queueLureSync();
  if (document.getElementById('questionStage')?.classList.contains('active')) {
    if (fitRafId) cancelAnimationFrame(fitRafId);
    fitRafId = requestAnimationFrame(() => {
      fitQuestionLayout();
      fitRafId = 0;
    });
  }
});

document.querySelector('.main')?.addEventListener('click', (event) => {
  if (currentStageId !== 'fishingActionStage') return;
  if (!currentFishingAction || actionBusy) return;
  const isButton = event.target?.closest?.('#fishingActionBtn');
  if (isButton) return;
  runFishingAction();
});
