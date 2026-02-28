    // Get game code and pin from URL
    const urlParams = new URLSearchParams(window.location.search);
    const gameCode = urlParams.get('code');
    const hostPin = urlParams.get('pin');

    function redirectToIndex() {
      window.location.replace('/index.html');
    }

    function shouldRedirectForMissingGame(status, message) {
      const normalized = String(message || '').toLowerCase();
      return status === 404 || status === 410 || normalized.includes('game not found') || normalized.includes('player not found');
    }

    if (!gameCode) {
      redirectToIndex();
    }

    // Set site URL dynamically
    const siteUrlLink = document.getElementById('siteUrlLink');
    siteUrlLink.textContent = window.location.host;
    siteUrlLink.href = '/';

    // Display game code
    document.getElementById('gameCode').textContent = gameCode;

    // Generate QR code
    const joinUrl = `${window.location.origin}/?join=${gameCode}`;
    new QRCode(document.getElementById('qrWrap'), {
      text: joinUrl,
      width: 80,
      height: 80,
      colorDark: '#1a2a43',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });

    let gameState = null;
    let pollInterval = null;

    // Poll for updates
    async function pollGame() {
      try {
        const res = await fetch(`/api/games/${gameCode}/lobby`);
        const data = await res.json();
        
        if (!res.ok) {
          if (shouldRedirectForMissingGame(res.status, data?.error)) {
            redirectToIndex();
            return;
          }
          console.error('Failed to fetch game state:', data.error);
          return;
        }

        gameState = data.game;
        updateUI(data.game);

        // If game started or ended, redirect
        if (data.game.state === 'live') {
          const mode = data.game.settings?.gameTypeFamily || 'goldquest';
          if (mode === 'goldquest') {
            window.location.href = `/goldquesthost.html?code=${gameCode}&pin=${hostPin}`;
          }
        } else if (data.game.state === 'ended') {
          console.log('Game has ended');
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }

    function updateUI(game) {
      const players = game.players || [];
      
      // Update player count
      document.getElementById('playerCountNum').textContent = players.length;

      // Update players grid
      const container = document.getElementById('playersContainer');
      if (players.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-user-clock"></i>
            <p>Waiting for players to join...</p>
          </div>
        `;
      } else {
        container.innerHTML = players.map((p, index) => `
          <div class="player-card ${index === 0 ? 'host-card' : ''}">
            <button class="kick-btn" onclick="kickPlayer('${p.playerId}')" title="Kick player">
              <i class="fas fa-times"></i>
            </button>
            <div class="blook-avatar">
              ${p.blook ? `<img src="${p.blook.imageUrl}" alt="${p.blook.name}" />` : 
                `<i class="fas fa-user"></i>`}
            </div>
            <div class="player-info">
              <div class="player-name">${escapeHtml(p.playerName)}</div>
            </div>
          </div>
        `).join('');
      }
    }

    async function kickPlayer(playerId) {
      if (!confirm('Kick this player?')) return;

      try {
        const res = await fetch(`/api/games/${gameCode}/kick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId })
        });

        if (res.ok) {
          pollGame();
          return;
        }
        if (shouldRedirectForMissingGame(res.status)) {
          redirectToIndex();
        }
      } catch (err) {
        alert('Failed to kick player: ' + err.message);
      }
    }

    async function startGame() {
      try {
        const res = await fetch(`/api/games/${gameCode}/start`, {
          method: 'POST'
        });

        const data = await res.json();
        if (!res.ok) {
          if (shouldRedirectForMissingGame(res.status, data?.error)) {
            redirectToIndex();
            return;
          }
          throw new Error(data.error);
        }
        
        // Redirect to mode-specific host page
        const mode = gameState?.settings?.gameTypeFamily || 'goldquest';
        if (mode === 'goldquest') {
          window.location.href = `/goldquesthost.html?code=${gameCode}&pin=${hostPin}`;
        }
      } catch (err) {
        alert('Failed to start: ' + err.message);
      }
    }

    async function closeLobby() {
      if (!confirm('Delete this lobby? This cannot be undone.')) return;

      try {
        const res = await fetch(`/api/games/${gameCode}`, {
          method: 'DELETE'
        });

        if (res.ok) {
          window.location.href = '/';
          return;
        }
        if (shouldRedirectForMissingGame(res.status)) {
          redirectToIndex();
        }
      } catch (err) {
        alert('Failed to close lobby: ' + err.message);
      }
    }

    function copyJoinLink() {
      const link = `${window.location.origin}/?join=${gameCode}`;
      navigator.clipboard.writeText(link).then(() => {
        alert('Join link copied to clipboard!');
      });
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
