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
    let lobbyAudio = null;
    let lobbyTracks = [];
    let lobbyTrackQueue = [];
    let lobbyCurrentTrack = '';
    let lobbyMuted = false;
    let audioUnlockBound = false;

    async function ensureTracks() {
      if (lobbyTracks.length) return lobbyTracks;
      try {
        const res = await fetch('/api/audio/tracks');
        const data = await res.json();
        const tracks = Array.isArray(data?.tracks)
          ? data.tracks.filter((item) => typeof item === 'string' && item.trim())
          : [];
        lobbyTracks = tracks.length ? tracks : ['/mp3/1.mp3'];
      } catch {
        lobbyTracks = ['/mp3/1.mp3'];
      }
      return lobbyTracks;
    }

    function shuffleCopy(list) {
      const out = Array.isArray(list) ? [...list] : [];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }

    function nextRandomTrack() {
      if (!lobbyTracks.length) return '';
      if (!lobbyTrackQueue.length) lobbyTrackQueue = shuffleCopy(lobbyTracks);
      if (!lobbyTrackQueue.length) return '';
      let next = String(lobbyTrackQueue.shift() || '');
      if (next === lobbyCurrentTrack && lobbyTrackQueue.length) {
        next = String(lobbyTrackQueue.shift() || next);
      }
      lobbyCurrentTrack = next;
      return next;
    }

    function ensureAudio() {
      if (lobbyAudio) return lobbyAudio;
      lobbyAudio = new Audio();
      lobbyAudio.preload = 'auto';
      lobbyAudio.volume = 0.55;
      lobbyAudio.muted = lobbyMuted;
      lobbyAudio.addEventListener('ended', () => {
        const next = nextRandomTrack();
        if (!next) return;
        lobbyAudio.src = next;
        lobbyAudio.play().catch(() => {});
      });
      return lobbyAudio;
    }

    function syncMuteIcon() {
      const icon = document.getElementById('muteIcon');
      if (!icon) return;
      icon.className = lobbyMuted ? 'fas fa-volume-xmark' : 'fas fa-volume-up';
    }

    function removeAudioUnlockListeners() {
      if (!audioUnlockBound) return;
      audioUnlockBound = false;
      document.removeEventListener('pointerdown', handleAudioUnlock);
      document.removeEventListener('keydown', handleAudioUnlock);
      document.removeEventListener('touchstart', handleAudioUnlock);
    }

    function bindAudioUnlockListeners() {
      if (audioUnlockBound) return;
      audioUnlockBound = true;
      document.addEventListener('pointerdown', handleAudioUnlock, { passive: true });
      document.addEventListener('keydown', handleAudioUnlock, { passive: true });
      document.addEventListener('touchstart', handleAudioUnlock, { passive: true });
    }

    async function playLobbyMusic() {
      const tracks = await ensureTracks();
      if (!tracks.length) return;
      const audio = ensureAudio();
      audio.muted = lobbyMuted;
      if (!audio.src) {
        const first = nextRandomTrack();
        audio.src = first || tracks[0];
      }
      if (!audio.paused) return;
      try {
        await audio.play();
        removeAudioUnlockListeners();
      } catch {
        bindAudioUnlockListeners();
      }
    }

    async function handleAudioUnlock() {
      if (lobbyMuted) return;
      await playLobbyMusic();
    }

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
          } else if (mode === 'fishingfrenzy') {
            window.location.href = `/fishingfrenzyhost.html?code=${gameCode}&pin=${hostPin}`;
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
        } else if (mode === 'fishingfrenzy') {
          window.location.href = `/fishingfrenzyhost.html?code=${gameCode}&pin=${hostPin}`;
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

    function toggleMute() {
      lobbyMuted = !lobbyMuted;
      if (lobbyAudio) lobbyAudio.muted = lobbyMuted;
      syncMuteIcon();
      if (!lobbyMuted) playLobbyMusic();
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Start polling
    pollGame();
    pollInterval = setInterval(pollGame, 2000);
    syncMuteIcon();
    playLobbyMusic();

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      if (pollInterval) clearInterval(pollInterval);
      if (lobbyAudio) {
        lobbyAudio.pause();
        lobbyAudio.src = '';
      }
      removeAudioUnlockListeners();
    });

    window.toggleMute = toggleMute;
