    let selectedSet = null;
    let customQuestions = [];
    let currentMode = 'goldquest';
    let hasPreviewedCurrentSetup = false;

    function markPreviewDirty() {
      hasPreviewedCurrentSetup = false;
    }

    // Mode selection
    function selectMode(mode) {
      currentMode = mode;
      markPreviewDirty();
      document.querySelectorAll('.mode-option').forEach(el => {
        el.classList.toggle('selected', el.dataset.mode === mode);
      });

    }

    // Search sets
    async function searchSets(query = '') {
      const input = document.getElementById('searchInput');
      const term = query || input.value.trim();
      
      const resultsDiv = document.getElementById('setResults');
      resultsDiv.innerHTML = '<p style="text-align: center;"><i class="fas fa-spinner fa-spin"></i> Searching...</p>';

      try {
        const res = await fetch(`/api/quiz/search?q=${encodeURIComponent(term)}`);
        const data = await res.json();
        
        if (!data.sets || data.sets.length === 0) {
          resultsDiv.innerHTML = '<p style="text-align: center; color: rgba(0,0,0,0.5);">No sets found. Try AI generation!</p>';
          return;
        }

        resultsDiv.innerHTML = data.sets.map(set => `
          <div class="set-card" data-id="${set.id}" onclick="selectSet(this, '${set.id}')">
            <h4>${escapeHtml(set.title)}</h4>
            <p>${escapeHtml(set.description || '')} • ${set.questionCount} questions</p>
          </div>
        `).join('');
      } catch (err) {
        resultsDiv.innerHTML = `<p style="color: #c62828;">Error: ${err.message}</p>`;
      }
    }

    function quickSearch(term) {
      document.getElementById('searchInput').value = term;
      searchSets(term);
    }

    async function selectSet(element, id) {
      document.querySelectorAll('.set-card').forEach(c => c.classList.remove('selected'));
      element.classList.add('selected');
      
      // Fetch full set data including questions
      try {
        const res = await fetch(`/api/quiz/set/${id}`);
        const data = await res.json();
        if (data.set && data.set.questions) {
          selectedSet = { 
            id, 
            type: 'remote',
            title: data.set.title,
            questions: data.set.questions
          };
        } else {
          selectedSet = { id, type: 'remote' };
        }
        markPreviewDirty();
      } catch (err) {
        selectedSet = { id, type: 'remote' };
        markPreviewDirty();
      }
    }

    // AI Generation
    async function generateAISet() {
      const prompt = document.getElementById('aiPrompt').value.trim();
      if (!prompt) {
        showStatus('aiStatus', 'Please enter a topic description', 'error');
        return;
      }

      const btn = event.target;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';

      try {
        const res = await fetch('/api/quiz/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            questionCount: parseInt(document.getElementById('aiCount').value),
            difficulty: document.getElementById('aiDifficulty').value,
            withImages: document.getElementById('aiImages').value !== 'none',
            imageTheme: document.getElementById('aiImages').value
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Generation failed');

        // Store as AI-generated set
        selectedSet = {
          type: 'ai',
          title: data.set.title,
          questions: data.set.questions
        };
        markPreviewDirty();

        showStatus('aiStatus', `Generated "${data.set.title}" with ${data.set.questions.length} questions!`, 'success');
        
        // Show in results
        const resultsDiv = document.getElementById('setResults');
        resultsDiv.innerHTML = `
          <div class="set-card selected" style="border-color: var(--purple); background: #f3e5f5;">
            <h4><i class="fas fa-magic"></i> ${escapeHtml(data.set.title)}</h4>
            <p>AI Generated • ${data.set.questions.length} questions</p>
          </div>
        `;
      } catch (err) {
        showStatus('aiStatus', err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-magic"></i> Generate with AI';
      }
    }

    // Custom questions
    function addQuestion() {
      const question = document.getElementById('customQuestion').value.trim();
      const imageUrl = document.getElementById('customImage').value.trim();
      const answersText = document.getElementById('customAnswers').value.trim();
      const correct = parseInt(document.getElementById('customCorrect').value) - 1;

      if (!question || !answersText) {
        alert('Please enter question and answers');
        return;
      }

      const answers = answersText.split('\n').map(a => a.trim()).filter(a => a);
      if (answers.length < 2) {
        alert('Please enter at least 2 answers');
        return;
      }

      if (correct < 0 || correct >= answers.length) {
        alert('Invalid correct answer number');
        return;
      }

      customQuestions.push({ q: question, answers, correct, imageUrl: imageUrl || undefined });
      markPreviewDirty();
      renderCustomQuestions();
      
      // Clear inputs
      document.getElementById('customQuestion').value = '';
      document.getElementById('customImage').value = '';
      document.getElementById('customAnswers').value = '';
      document.getElementById('customCorrect').value = '1';
    }

    function renderCustomQuestions() {
      const list = document.getElementById('customQuestionsList');
      if (customQuestions.length === 0) {
        list.innerHTML = '';
        return;
      }

      list.innerHTML = customQuestions.map((q, i) => `
        <div class="custom-question">
          <strong>Q${i+1}:</strong> ${escapeHtml(q.q.substring(0, 50))}${q.q.length > 50 ? '...' : ''}
          <button onclick="removeQuestion(${i})" style="float: right; padding: 4px 8px; font-size: 0.8rem;">
            <i class="fas fa-trash"></i>
          </button>
          <div style="font-size: 0.85rem; color: rgba(0,0,0,0.6); margin-top: 4px;">
            ${q.answers.length} answers
          </div>
        </div>
      `).join('');
    }

    function removeQuestion(index) {
      customQuestions.splice(index, 1);
      markPreviewDirty();
      renderCustomQuestions();
    }

    function useCustomSet() {
      if (customQuestions.length === 0) {
        alert('Add at least one question first');
        return;
      }
      const title = document.getElementById('customTitle').value.trim() || 'Custom Set';
      selectedSet = { type: 'custom', title, questions: [...customQuestions] };
      markPreviewDirty();
      showStatus('createStatus', `Using custom set: ${title} (${customQuestions.length} questions)`, 'success');
    }

    function clearCustom() {
      customQuestions = [];
      document.getElementById('customTitle').value = '';
      document.getElementById('customQuestion').value = '';
      document.getElementById('customImage').value = '';
      document.getElementById('customAnswers').value = '';
      markPreviewDirty();
      renderCustomQuestions();
    }

    function requestCreateGame() {
      previewGame();
    }

    // Create game
    async function createGame(btnEl) {
      if (!selectedSet) {
        showStatus('createStatus', 'Please select or create a question set', 'error');
        return;
      }

      if (!hasPreviewedCurrentSetup) {
        showStatus('createStatus', 'Please preview questions before creating the game', 'error');
        return;
      }

      const btn = btnEl || document.getElementById('confirmCreateBtn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

      const body = {
        gameTypeFamily: currentMode,
        gameType: 'timed',
        maxPlayers: parseInt(document.getElementById('maxPlayers').value),
        feedbackDelaySec: parseFloat(document.getElementById('feedbackDelay').value),
        shuffleQuestions: document.getElementById('shuffleQuestions').checked,
        timeLimitSec: parseInt(document.getElementById('timeLimit').value) * 60
      };

      if (selectedSet.type === 'remote') {
        body.setId = selectedSet.id;
      } else {
        body.customSet = {
          title: selectedSet.title,
          questions: selectedSet.questions
        };
      }

      try {
        const res = await fetch('/api/host', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create game');

        // Redirect to host lobby (waits for players before game starts)
        window.location.href = `/host-lobby.html?code=${data.game.code}&pin=${data.game.hostPin}`;
      } catch (err) {
        showStatus('createStatus', err.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-play-circle"></i> Create Game Lobby';
      }
    }

    // Utilities
    function showStatus(id, message, type) {
      const el = document.getElementById(id);
      el.textContent = message;
      el.className = `status ${type}`;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Preview functions
    function previewGame() {
      if (!selectedSet) {
        showStatus('createStatus', 'Please select or create a question set first', 'error');
        return;
      }

      // Update basic settings
      document.getElementById('previewMode').textContent = currentMode === 'goldquest' ? 'Gold Quest' : currentMode;
      
      const timeLimit = parseInt(document.getElementById('timeLimit').value);
      document.getElementById('previewTime').textContent = timeLimit + (timeLimit === 1 ? ' minute' : ' minutes');
      document.getElementById('previewMaxPlayers').textContent = document.getElementById('maxPlayers').value;
      
      const delay = parseFloat(document.getElementById('feedbackDelay').value);
      document.getElementById('previewDelay').textContent = delay === 0 ? 'None' : (delay + (delay === 1 ? ' second' : ' seconds'));
      document.getElementById('previewShuffle').textContent = document.getElementById('shuffleQuestions').checked ? 'Yes' : 'No';

      // Update set info
      let setName = '-';
      let questionCount = '-';
      let source = '-';

      if (selectedSet.type === 'remote') {
        const selectedCard = document.querySelector('.set-card.selected');
        if (selectedCard) {
          setName = selectedCard.querySelector('h4')?.textContent || 'Selected Set';
        }
        if (selectedSet.questions) {
          questionCount = selectedSet.questions.length;
        }
        source = 'Quiz Database';
      } else if (selectedSet.type === 'custom') {
        setName = selectedSet.title;
        questionCount = selectedSet.questions.length;
        source = 'Custom Built';
      } else if (selectedSet.type === 'ai') {
        setName = selectedSet.title;
        questionCount = selectedSet.questions.length;
        source = 'AI Generated';
      }

      document.getElementById('previewSetName').textContent = setName;
      document.getElementById('previewQuestionCount').textContent = questionCount;
      document.getElementById('previewSetSource').textContent = source;

      // Show sample questions
      const questionsList = document.getElementById('previewQuestionsList');
      const questionsSection = document.getElementById('previewQuestionsSection');
      
      let questionsToShow = [];
      if (selectedSet.questions && selectedSet.questions.length > 0) {
        questionsToShow = selectedSet.questions.slice(0, 5);
      }

      if (questionsToShow.length > 0) {
        questionsList.innerHTML = questionsToShow.map((q, i) => {
          const answersHtml = q.answers.map((a, ai) => {
            const isCorrect = ai === q.correct;
            return `<span class="q-answer ${isCorrect ? 'correct' : ''}">${String.fromCharCode(65 + ai)}. ${escapeHtml(a)}${isCorrect ? ' ✓' : ''}</span>`;
          }).join('');
          
          const imageHtml = q.imageUrl ? `<img src="${escapeHtml(q.imageUrl)}" class="q-image" alt="Question image" onerror="this.style.display='none'">` : '';
          
          return `
            <div class="preview-question-item">
              ${imageHtml}
              <div class="q-text">${i + 1}. ${escapeHtml(q.q)}</div>
              <div class="q-answers">${answersHtml}</div>
            </div>
          `;
        }).join('');
        
        if (selectedSet.questions.length > 5) {
          questionsList.innerHTML += `<p style="text-align: center; color: rgba(0,0,0,0.5); margin-top: 12px; font-weight: 600;">... and ${selectedSet.questions.length - 5} more questions</p>`;
        }
        questionsSection.classList.remove('hidden');
      } else {
        questionsList.innerHTML = '<p class="preview-empty">Questions will be loaded when the game starts</p>';
        questionsSection.classList.remove('hidden');
      }

      // Show modal
      hasPreviewedCurrentSetup = true;
      document.getElementById('previewModal').classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }

    function closePreview() {
      document.getElementById('previewModal').classList.add('hidden');
      document.body.style.overflow = '';
    }

    function createGameFromPreview(btnEl) {
      closePreview();
      // Small delay to let modal close animation play
      setTimeout(() => createGame(btnEl), 100);
    }

    document.querySelectorAll('#timeLimit, #maxPlayers, #feedbackDelay, #shuffleQuestions').forEach((el) => {
      el.addEventListener('change', markPreviewDirty);
      el.addEventListener('input', markPreviewDirty);
    });

    // Close modal on backdrop click
    document.addEventListener('click', (e) => {
      const modal = document.getElementById('previewModal');
      if (e.target === modal) {
        closePreview();
      }
    });

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closePreview();
      }
    });

