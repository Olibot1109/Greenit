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

    let gameState = null;
    let playerData = null;
    let pollInterval = null;
    let currentBlook = null;

    function showError(message) {
      document.getElementById('loadingState').classList.add('hidden');
      document.getElementById('lobbyContent').classList.add('hidden');
      document.getElementById('errorState').classList.remove('hidden');
      document.getElementById('errorText').textContent = message;
    }

    function showLobby() {
      document.getElementById('loadingState').classList.add('hidden');
      document.getElementById('errorState').classList.add('hidden');
      document.getElementById('lobbyContent').classList.remove('hidden');
    }

    async function pollGame() {
      try {
        const res = await fetch(`/api/games/${gameCode}/player/${playerId}`);
        const data = await res.json();

        if (!res.ok) {
          if (shouldRedirectForMissingGame(res.status, data?.error)) {
            redirectToIndex();
            return;
          }
          console.error('Poll error:', data.error);
          return;
        }

        // Check if game has started - redirect to game
        if (data.state === 'live' && !data.waiting) {
          redirectToGame(data);
          return;
        }

        // Check if game ended
        if (data.state === 'ended' || data.ended) {
          redirectToGame(data);
          return;
        }

        // Update lobby UI
        updateLobby(data);
      } catch (err) {
        console.error('Poll error:', err);
      }
    }

    function updateLobby(data) {
      if (!document.getElementById('lobbyContent').classList.contains('hidden')) {
        // Already showing lobby
      } else if (data.playerName) {
        showLobby();
      }

      playerData = data;
      
      // Update player name in header
      if (data.playerName) {
        document.getElementById('playerNameDisplay').textContent = data.playerName;
      }

      // Update blook selection
      if (data.blookSelection) {
        updateBlookSelection(data.blookSelection);
        
        // Update preview if we have a current blook
        if (data.blookSelection.current && data.blookSelection.current.id !== currentBlook?.id) {
          currentBlook = data.blookSelection.current;
          updatePreview(currentBlook);
        }
      }
    }

    function updateBlookSelection(selection) {
      const catalog = selection.catalog || [];
      const takenIds = selection.takenIds || [];
      const current = selection.current;

      const grid = document.getElementById('blookGrid');
      
      // Fill with available blooks
      let html = catalog.map(blook => {
        const isTaken = takenIds.includes(blook.id);
        const isSelected = current?.id === blook.id;
        
        return `
          <div class="blook-option ${isTaken ? 'taken' : ''} ${isSelected ? 'selected' : ''}"
               ${!isTaken ? `onclick="selectBlook('${blook.id}', '${escapeHtml(blook.name)}', '${blook.imageUrl}')"` : ''}>
            <img src="${blook.imageUrl}" alt="${escapeHtml(blook.name)}" />
          </div>
        `;
      }).join('');

      grid.innerHTML = html;
    }

    function updatePreview(blook) {
      document.getElementById('previewName').textContent = blook.name;
      document.getElementById('previewImage').innerHTML = `<img src="${blook.imageUrl}" alt="${escapeHtml(blook.name)}" />`;
    }

    async function selectBlook(blookId, name, imageUrl) {
      // Optimistically update preview
      updatePreview({ name, imageUrl });
      
      try {
        const res = await fetch(`/api/games/${gameCode}/player/${playerId}/blook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blookId: blookId })
        });

        if (!res.ok) {
          if (shouldRedirectForMissingGame(res.status)) {
            redirectToIndex();
            return;
          }
          console.error('Failed to select blook');
        }
      } catch (err) {
        console.error('Error selecting blook:', err);
      }
    }

    function redirectToGame(data) {
      const mode = data.modeFamily || data.mode || 'goldquest';
      
      if (mode === 'goldquest') {
        window.location.href = `/goldquestplay.html?code=${gameCode}&player=${playerId}`;
      } else if (mode === 'assemble') {
        window.location.href = `/play.html?code=${gameCode}&player=${playerId}`;
      } else {
        window.location.href = `/play.html?code=${gameCode}&player=${playerId}`;
      }
    }

    async function leaveGame() {
      if (!confirm('Leave this game?')) return;

      try {
        await fetch(`/api/games/${gameCode}/player/${playerId}`, {
          method: 'DELETE'
        });
      } catch (err) {
        console.error('Error leaving game:', err);
      }
      
      window.location.href = '/';
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Start polling
    pollGame();
    pollInterval = setInterval(pollGame, 2000);

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      if (pollInterval) clearInterval(pollInterval);
    });
