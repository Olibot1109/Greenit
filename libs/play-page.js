    const urlParams = new URLSearchParams(window.location.search);
    const gameCode = urlParams.get('code');
    const playerId = urlParams.get('player');

    function redirectToIndex() {
      window.location.replace('/index.html');
    }

    function shouldRedirectForMissingGame(status, message) {
      const normalized = String(message || '').toLowerCase();
      return status === 404 || status === 410 || normalized.includes('game not found') || normalized.includes('player not found');
    }

    if (!gameCode || !playerId) {
      redirectToIndex();
    }

    let pollInterval = null;
    let fitRafId = 0;

    async function pollGame() {
      try {
        const res = await fetch(`/api/games/${gameCode}/player/${playerId}`);
        const data = await res.json();

        if (!res.ok) {
          if (shouldRedirectForMissingGame(res.status, data?.error)) {
            redirectToIndex();
          }
          return;
        }

        updateUI(data);
      } catch (err) {
        console.error(err);
      }
    }

    function updateUI(data) {
      document.getElementById('playerName').textContent = data.playerName || 'Player';

      if (data.state === 'ended' || data.ended) {
        hideAll();
        document.getElementById('finishedStage').classList.remove('hidden');
        return;
      }

      if (data.state !== 'live') {
        hideAll();
        document.getElementById('waitingStage').classList.remove('hidden');
        renderBlooks(data.blookSelection);
        return;
      }

      hideAll();

      if (data.puzzle?.completed !== undefined && !data.question) {
        // Show puzzle progress for assemble mode
        document.getElementById('puzzleStage').classList.remove('hidden');
        const p = data.puzzle;
        document.getElementById('puzzleInfo').innerHTML = `
          <i class="fas fa-cubes" style="font-size: 3rem; color: var(--purple);"></i><br/><br/>
          Revealed: ${p.revealedCount} / ${p.totalTiles} tiles<br/>
          ${p.completed ? '<strong>Puzzle Complete!</strong>' : 'Keep answering to reveal more!'}
        `;
      } else if (data.question) {
        document.getElementById('questionStage').classList.remove('hidden');
        showQuestion(data);
      } else if (data.finished) {
        document.getElementById('finishedStage').classList.remove('hidden');
      }
    }

    function showQuestion(data) {
      const q = data.question;
      const current = (data.questionIndex || 0) + 1;
      const total = data.targetQuestions || 20;

      document.getElementById('questionNumber').textContent = `Question ${current} of ${total}`;
      document.getElementById('questionNum').textContent = `Q${current}`;
      document.getElementById('questionText').textContent = q.q;

      const img = document.getElementById('questionImage');
      if (q.imageUrl) {
        img.src = q.imageUrl;
        img.classList.remove('hidden');
      } else {
        img.classList.add('hidden');
      }

      document.getElementById('answerGrid').innerHTML = q.answers.map((ans, i) => `
        <button class="answer-btn" onclick="submitAnswer(${i})">${escapeHtml(ans)}</button>
      `).join('');

      if (fitRafId) cancelAnimationFrame(fitRafId);
      fitRafId = requestAnimationFrame(() => {
        fitQuestionLayout();
        fitRafId = 0;
      });
    }

    async function submitAnswer(index) {
      document.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);

      try {
        const res = await fetch(`/api/games/${gameCode}/player/${playerId}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answerIndex: index })
        });

        const data = await res.json();
        if (!res.ok) {
          if (shouldRedirectForMissingGame(res.status, data?.error)) {
            redirectToIndex();
            return;
          }
          throw new Error(data.error);
        }

        // Visual feedback
        const buttons = document.querySelectorAll('.answer-btn');
        buttons[index].classList.add(data.correct ? 'correct' : 'wrong');
        if (!data.correct) {
          buttons[data.correctIndex]?.classList.add('correct');
        }
      } catch (err) {
        alert(err.message);
      }
    }

    function renderBlooks(selection) {
      if (!selection?.catalog) return;
      const grid = document.getElementById('blookGrid');
      grid.innerHTML = selection.catalog.map(b => {
        const taken = selection.takenIds?.includes(b.id);
        const selected = selection.current?.id === b.id;
        return `
          <div class="blook-card ${taken ? 'taken' : ''} ${selected ? 'selected' : ''}" 
               ${!taken ? `onclick="selectBlook('${b.id}')"` : ''}>
            <img src="${b.imageUrl}" alt="${b.name}" />
            <div style="font-size: 0.85rem; font-weight: 700;">${b.name}</div>
          </div>
        `;
      }).join('');
    }

    async function selectBlook(id) {
      const res = await fetch(`/api/games/${gameCode}/player/${playerId}/blook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blookId: id })
      });
      if (!res.ok && shouldRedirectForMissingGame(res.status)) {
        redirectToIndex();
      }
    }

    function hideAll() {
      document.getElementById('waitingStage').classList.add('hidden');
      document.getElementById('questionStage').classList.add('hidden');
      document.getElementById('puzzleStage').classList.add('hidden');
      document.getElementById('finishedStage').classList.add('hidden');
    }

    function escapeHtml(text) {
      const d = document.createElement('div');
      d.textContent = text;
      return d.innerHTML;
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

    function nudgeFontDown(el, minSize) {
      if (!el) return false;
      const current = Number.parseFloat(getComputedStyle(el).fontSize || '0');
      if (!Number.isFinite(current) || current <= minSize) return false;
      el.style.fontSize = `${Math.max(minSize, current - 1)}px`;
      return true;
    }

    function fitQuestionLayout() {
      const panel = document.querySelector('#questionStage .panel');
      const qText = document.getElementById('questionText');
      if (!qText) return;
      qText.style.fontSize = '';
      fitTextToBox(qText, 44, 18);
      const buttons = Array.from(document.querySelectorAll('#answerGrid .answer-btn'));
      buttons.forEach((btn) => fitTextToBox(btn, 24, 13));

      let guard = 0;
      while (panel && panel.scrollHeight > panel.clientHeight && guard < 32) {
        let changed = nudgeFontDown(qText, 16);
        buttons.forEach((btn) => {
          changed = nudgeFontDown(btn, 11) || changed;
        });
        if (!changed) break;
        guard += 1;
      }
    }

    pollGame();
    pollInterval = setInterval(pollGame, 1500);

    window.addEventListener('resize', () => {
      if (!document.getElementById('questionStage')?.classList.contains('hidden')) {
        if (fitRafId) cancelAnimationFrame(fitRafId);
        fitRafId = requestAnimationFrame(() => {
          fitQuestionLayout();
          fitRafId = 0;
        });
      }
    });
