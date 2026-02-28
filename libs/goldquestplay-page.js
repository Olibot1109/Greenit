    const urlParams = new URLSearchParams(window.location.search);
    const gameCode = urlParams.get('code');
    const playerId = urlParams.get('player');

    if (!gameCode || !playerId) window.location.replace('/index.html');

    const stageIds = [
      'questionStage', 'feedbackStage', 'chestChooseStage', 'chestTargetStage', 'chestResultStage', 'waitingStage', 'finishedStage'
    ];

    let pollInterval = null;
    let playerName = 'player';
    let transitionLock = false;
    let chestBusy = false;
    let chestResultData = null;
    let chestResultStep = 'reveal';
    let chestResultKey = '';
    let currentAnswers = [];

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
      stageIds.forEach((stageId) => {
        const el = document.getElementById(stageId);
        if (el) el.classList.toggle('active', stageId === id);
      });
    }

    function setHud(data) {
      if (data?.playerName) playerName = data.playerName;
      document.getElementById('hudName').textContent = playerName;
      document.getElementById('goldAmount').textContent = Number(data?.gold || 0).toLocaleString();
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

        setHud(data);
        updateUI(data);
      } catch (error) {
        console.error('poll error', error);
      }
    }

    function updateUI(data) {
      if (data.state === 'ended' || data.ended || data.state === 'finished' || data.finished) {
        showFinished(data);
        return;
      }

      if (data.state !== 'live') {
        showWaiting(data);
        return;
      }

      if (data.chestPhase === 'choose') {
        showChestChoose(data);
        return;
      }

      if (data.chestPhase === 'target') {
        showChestTarget(data);
        return;
      }

      if (data.chestPhase === 'result') {
        showChestResult(data);
        return;
      }

      if (data.question) {
        showQuestion(data);
      }
    }

    function showWaiting(data) {
      showStage('waitingStage');
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
          body: JSON.stringify({ blookId })
        });
      } catch (error) {
        console.error('blook select error', error);
      }
    }

    function showQuestion(data) {
      showStage('questionStage');
      const q = data.question || {};
      document.getElementById('questionText').textContent = String(q.q || '').trim() || `Question ${(Number(data.questionIndex || 0) + 1)}`;

      const img = document.getElementById('questionImage');
      if (q.imageUrl) {
        img.src = q.imageUrl;
        img.classList.remove('hidden');
      } else {
        img.classList.add('hidden');
      }

      const answers = Array.isArray(q.answers) ? q.answers : [];
      currentAnswers = answers.slice();
      const classes = ['a-yellow', 'a-blue', 'a-green', 'a-red'];
      const grid = document.getElementById('answerGrid');
      grid.innerHTML = answers.map((answer, index) => `
        <button class="answer-btn ${classes[index % classes.length]}" onclick="submitAnswer(${index})">${escapeHtml(answer)}</button>
      `).join('');
      requestAnimationFrame(fitQuestionLayout);
    }

    async function submitAnswer(answerIndex) {
      if (transitionLock) return;
      transitionLock = true;
      document.querySelectorAll('#answerGrid .answer-btn').forEach((btn) => { btn.disabled = true; });
      try {
        const res = await fetch(`/api/games/${gameCode}/player/${playerId}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answerIndex })
        });
        const data = await res.json();
        if (!res.ok) {
          if (shouldRedirectForMissingGame(res.status, data?.error)) {
            window.location.replace('/index.html');
            return;
          }
          transitionLock = false;
          return;
        }

        setHud({ playerName: data.playerName, gold: data.totalGold });
        const correctIndex = Number(data.correctIndex);
        const correctAnswerText = Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < currentAnswers.length
          ? String(currentAnswers[correctIndex])
          : '';
        showFeedback(Boolean(data.correct), correctAnswerText);
      } catch (error) {
        transitionLock = false;
      }
    }

    function showFeedback(correct, correctAnswerText = '') {
      showStage('feedbackStage');
      const wrap = document.getElementById('feedbackWrap');
      const title = document.getElementById('feedbackTitle');
      const icon = document.getElementById('feedbackIcon');
      const correctAnswer = document.getElementById('feedbackCorrectAnswer');
      const sub = document.getElementById('feedbackSub');
      let canContinue = correct;

      if (correct) {
        wrap.className = 'feedback-wrap correct';
        title.textContent = 'CORRECT';
        icon.innerHTML = '<i class="fa-solid fa-check"></i>';
        correctAnswer.textContent = '';
        correctAnswer.classList.add('hidden');
        sub.textContent = 'Click Anywhere to Go Next';
      } else {
        wrap.className = 'feedback-wrap incorrect';
        title.textContent = 'INCORRECT';
        icon.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        correctAnswer.textContent = correctAnswerText ? `Correct answer: ${correctAnswerText}` : '';
        correctAnswer.classList.toggle('hidden', !correctAnswerText);
        sub.textContent = 'Wait 2s...';
        setTimeout(() => {
          canContinue = true;
          sub.textContent = 'Click Anywhere to Go Next';
        }, 2000);
      }

      const continueNow = async () => {
        wrap.onclick = null;
        transitionLock = false;
        await pollGame();
      };

      wrap.onclick = () => {
        if (!canContinue) return;
        continueNow();
      };
    }

    function showChestChoose(data) {
      showStage('chestChooseStage');
      const root = document.getElementById('chestChooseStage');
      const iconPaths = ['/chetsicons/chest1.svg', '/chetsicons/chest2.svg', '/chetsicons/chest3.svg'];

      root.innerHTML = `
        <div class="chest-wrap">
          <div class="banner"><div class="banner-inner">Choose a Chest!</div></div>
          <div class="chest-grid">
            ${iconPaths.map((src, idx) => `
              <button class="chest-btn" ${chestBusy ? 'disabled' : ''} onclick="selectChest(${idx})">
                <img src="${src}" alt="Chest ${idx + 1}" />
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }

    function showChestTarget(data) {
      showStage('chestTargetStage');
      const root = document.getElementById('chestTargetStage');
      const action = String(data?.chest?.targetAction || 'target');
      const choices = Array.isArray(data?.chest?.targetChoices) ? data.chest.targetChoices : [];

      root.innerHTML = `
        <div class="chest-wrap">
          <div class="banner"><div class="banner-inner">Choose Who to ${action === 'swap' ? 'Swap' : 'Steal'}!</div></div>
          <div>
            <div class="target-grid">
              ${choices.map((target) => `
                <button class="target-btn" onclick="chooseTarget('${escapeHtml(target.playerId)}')">
                  ${target?.blook?.imageUrl ? `<img src="${escapeHtml(target.blook.imageUrl)}" alt="${escapeHtml(target.playerName)}" />` : '<div style="font-size:2rem;line-height:1">?</div>'}
                  <div>${escapeHtml(target.playerName)}</div>
                  <div style="color:#754c12;">${Number(target.gold || 0).toLocaleString()} gold</div>
                </button>
              `).join('')}
            </div>
            <div class="target-actions"><button class="skip-btn" onclick="skipTarget()">Skip</button></div>
          </div>
        </div>
      `;
    }

    function outcomeIcon(type) {
      if (type === 'take_percent') return 'fa-user-minus';
      if (type === 'swap') return 'fa-right-left';
      if (type === 'lose_percent' || type === 'lose_flat') return 'fa-skull-crossbones';
      if (type === 'nothing') return 'fa-ban';
      if (type === 'double' || type === 'triple' || type === 'mega_bonus') return 'fa-bolt';
      return 'fa-coins';
    }

    function showChestResult(data) {
      showStage('chestResultStage');
      const chest = data?.chest || {};
      const result = chest.result || {};
      const key = [
        String(chest.selectedIndex ?? ''),
        String(result.type || ''),
        String(result.delta ?? ''),
        String(result.text || ''),
      ].join('|');

      // Keep current step when polling returns the same chest result.
      if (key !== chestResultKey) {
        chestResultKey = key;
        chestResultStep = 'reveal';
      }
      chestResultData = data || null;
      renderChestResultStage();
    }

    function renderChestResultStage() {
      const root = document.getElementById('chestResultStage');
      const chest = chestResultData?.chest || {};
      const result = chest.result || {};
      const options = Array.isArray(chest.options) ? chest.options : [];
      const selectedIndex = Number(chest.selectedIndex);

      if (result.noInteraction) {
        root.innerHTML = `
          <div class="message-only">
            <div class="banner"><div class="banner-inner">No Players to Interact With</div></div>
            <div class="center-next"><button class="next-btn" onclick="nextFromChest()"><span>Next</span></button></div>
          </div>
        `;
        return;
      }

      root.innerHTML = `
        <div class="message-only" onclick="nextFromChest()">
          <div class="banner"><div class="banner-inner">Click Anywhere to Go Next</div></div>
          <div class="chest-outcomes">
            ${options.map((option, index) => `
              ${(() => {
                const selected = index === selectedIndex;
                const delta = Number(result.delta || 0);
                const deltaLabel = `${delta > 0 ? '+' : ''}${delta.toLocaleString()} Gold`;
                const resolvedLabel = result?.text ? String(result.text) : (result?.headline ? String(result.headline) : deltaLabel);
                const labelText = selected ? resolvedLabel : (option.label || '');
                return `
              <div class="outcome-item ${index === selectedIndex ? 'selected' : ''}">
                <div class="icon"><i class="fa-solid ${outcomeIcon(option.type)}"></i></div>
                <div class="label">${escapeHtml(labelText)}</div>
              </div>
                `;
              })()}
            `).join('')}
          </div>
        </div>
      `;
    }

    async function selectChest(chestIndex) {
      if (chestBusy || transitionLock) return;
      chestBusy = true;
      try {
        const res = await fetch(`/api/games/${gameCode}/player/${playerId}/chest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chestIndex })
        });
        const data = await res.json();
        if (!res.ok) {
          if (shouldRedirectForMissingGame(res.status, data?.error)) {
            window.location.replace('/index.html');
            return;
          }
          chestBusy = false;
          return;
        }

        setHud(data);
        chestBusy = false;
        updateUI({ state: 'live', chestPhase: data.chestPhase, chest: data.chest, playerName, gold: data.gold });
      } catch (error) {
        chestBusy = false;
      }
    }

    async function chooseTarget(targetPlayerId) {
      if (chestBusy) return;
      chestBusy = true;
      try {
        const res = await fetch(`/api/games/${gameCode}/player/${playerId}/chest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'target', targetPlayerId })
        });
        const data = await res.json();
        if (!res.ok) {
          chestBusy = false;
          return;
        }
        setHud(data);
        chestBusy = false;
        updateUI({ state: 'live', chestPhase: data.chestPhase, chest: data.chest, playerName, gold: data.gold });
      } catch {
        chestBusy = false;
      }
    }

    async function skipTarget() {
      if (chestBusy) return;
      chestBusy = true;
      try {
        const res = await fetch(`/api/games/${gameCode}/player/${playerId}/chest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'skip' })
        });
        const data = await res.json();
        if (!res.ok) {
          chestBusy = false;
          return;
        }
        setHud(data);
        chestBusy = false;
        updateUI({ state: 'live', chestPhase: data.chestPhase, chest: data.chest, playerName, gold: data.gold });
      } catch {
        chestBusy = false;
      }
    }

    async function nextFromChest() {
      if (chestBusy) return;
      chestBusy = true;
      try {
        const res = await fetch(`/api/games/${gameCode}/player/${playerId}/chest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'next' })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (shouldRedirectForMissingGame(res.status, data?.error)) {
            window.location.replace('/index.html');
            return;
          }
          chestBusy = false;
          return;
        }
        chestResultData = null;
        chestResultKey = '';
        chestResultStep = 'reveal';
        chestBusy = false;
        await pollGame();
      } catch {
        chestBusy = false;
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
      fitTextToBox(qText, 92, 28);
      document.querySelectorAll('#answerGrid .answer-btn').forEach((btn) => fitTextToBox(btn, 56, 18));
    }

    function showFinished(data) {
      showStage('finishedStage');
      document.getElementById('finalGold').innerHTML = `${Number(data?.gold || 0).toLocaleString()} <i class='fa-solid fa-coins'></i>`;
    }

    pollGame();
    pollInterval = setInterval(pollGame, 1300);

    window.addEventListener('beforeunload', () => {
      if (pollInterval) clearInterval(pollInterval);
    });

    window.selectBlook = selectBlook;
    window.submitAnswer = submitAnswer;
    window.selectChest = selectChest;
    window.chooseTarget = chooseTarget;
    window.skipTarget = skipTarget;
    window.nextFromChest = nextFromChest;

    window.addEventListener('resize', () => {
      if (document.getElementById('questionStage')?.classList.contains('active')) {
        fitQuestionLayout();
      }
    });
