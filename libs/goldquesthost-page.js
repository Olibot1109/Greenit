    const urlParams = new URLSearchParams(window.location.search);
    const gameCode = urlParams.get('code');

    function redirectToIndex() {
      window.location.replace('/index.html');
    }

    function shouldRedirectForMissingGame(status, message) {
      const normalized = String(message || '').toLowerCase();
      return status === 404 || status === 410 || normalized.includes('game not found') || normalized.includes('player not found');
    }

    if (!gameCode) redirectToIndex();

    const idLabel = document.getElementById('idLabel');
    idLabel.textContent = `ID: ${gameCode}`;

    let pollInterval = null;
    let gameEnded = false;
    let lastRemainingSec = null;
    let lastClockTickMs = Date.now();
    let hostAudio = null;
    let hostTracks = [];
    let hostTrackQueue = [];
    let hostCurrentTrack = '';
    let hostMuted = false;
    let endRevealTimers = [];
    let isEndMusicMode = false;
    let audioUnlockBound = false;
    let latestPlayersSnapshot = [];

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function ordinalLabel(num) {
      const n = Number(num || 0);
      if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
      if (n % 10 === 1) return `${n}st`;
      if (n % 10 === 2) return `${n}nd`;
      if (n % 10 === 3) return `${n}rd`;
      return `${n}th`;
    }

    function setClockText(seconds) {
      const value = Math.max(0, Number(seconds || 0));
      const minutes = Math.floor(value / 60);
      const remain = value % 60;
      document.getElementById('clock').textContent = `${minutes}:${String(remain).padStart(2, '0')}`;
    }

    async function ensureTracks() {
      if (hostTracks.length) return hostTracks;
      try {
        const res = await fetch('/api/audio/tracks');
        const data = await res.json();
        const tracks = Array.isArray(data?.tracks) ? data.tracks.filter((item) => typeof item === 'string' && item.trim()) : [];
        hostTracks = tracks.length ? tracks : ['/mp3/1.mp3'];
      } catch {
        hostTracks = ['/mp3/1.mp3'];
      }
      return hostTracks;
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
      if (!hostTracks.length) return '';
      if (!hostTrackQueue.length) {
        hostTrackQueue = shuffleCopy(hostTracks);
      }
      if (!hostTrackQueue.length) return '';
      let next = String(hostTrackQueue.shift() || '');
      if (next === hostCurrentTrack && hostTrackQueue.length) {
        next = String(hostTrackQueue.shift() || next);
      }
      hostCurrentTrack = next;
      return next;
    }

    function ensureAudio() {
      if (hostAudio) return hostAudio;
      hostAudio = new Audio();
      hostAudio.preload = 'auto';
      hostAudio.volume = 0.55;
      hostAudio.muted = hostMuted;
      hostAudio.addEventListener('ended', () => {
        const next = nextRandomTrack();
        if (!next) return;
        hostAudio.src = next;
        hostAudio.play().catch(() => {});
      });
      return hostAudio;
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

    function syncMuteIcon() {
      const icon = document.getElementById('muteIcon');
      if (!icon) return;
      icon.className = hostMuted ? 'fa-solid fa-volume-xmark hud-icon' : 'fa-solid fa-volume-high hud-icon';
    }

    function updateFullscreenIcon() {
      const icon = document.getElementById('fullscreenIcon');
      if (!icon) return;
      icon.className = document.fullscreenElement ? 'fa-solid fa-compress hud-icon' : 'fa-solid fa-expand hud-icon';
    }

    async function playLobbyMusic() {
      const tracks = await ensureTracks();
      if (!tracks.length) return;
      const audio = ensureAudio();
      isEndMusicMode = false;
      audio.muted = hostMuted;
      audio.volume = 0.55;
      if (!audio.src) {
        const first = nextRandomTrack();
        audio.src = first || tracks[0];
      }
      if (!audio.paused) return;
      try {
        await audio.play();
      } catch {
        // Browser may block autoplay until a user gesture.
        bindAudioUnlockListeners();
      }
    }

    async function playEndMusic() {
      const tracks = await ensureTracks();
      if (!tracks.length) return;
      const audio = ensureAudio();
      isEndMusicMode = true;
      audio.muted = hostMuted;
      audio.volume = 0.62;
      const next = nextRandomTrack() || tracks[0];
      if (next) audio.src = next;
      try {
        await audio.play();
      } catch {
        // Browser may require another interaction for autoplay.
        bindAudioUnlockListeners();
      }
    }

    async function handleAudioUnlock() {
      if (hostMuted) return;
      if (gameEnded || isEndMusicMode) {
        await playEndMusic();
      } else {
        await playLobbyMusic();
      }
      const audio = ensureAudio();
      if (audio && !audio.paused) removeAudioUnlockListeners();
    }

    function toggleMute() {
      hostMuted = !hostMuted;
      if (hostAudio) hostAudio.muted = hostMuted;
      syncMuteIcon();
      if (!hostMuted) {
        if (gameEnded || isEndMusicMode) {
          playEndMusic();
        } else {
          playLobbyMusic();
        }
      }
    }

    async function toggleFullscreen() {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else {
          await document.documentElement.requestFullscreen();
        }
      } catch {
        // noop
      }
      updateFullscreenIcon();
      playLobbyMusic();
    }

    function updateLobby(game) {
      const state = String(game.state || 'lobby');
      const isLobby = state === 'lobby';
      const isLive = state === 'live';
      const players = [...(Array.isArray(game.players) ? game.players : [])].sort((a, b) => Number(b.gold || 0) - Number(a.gold || 0));
      latestPlayersSnapshot = players;

      const totalGold = players.reduce((sum, player) => sum + Number(player.gold || 0), 0);
      document.getElementById('totalGold').textContent = totalGold.toLocaleString();

      const startBtn = document.getElementById('startGameBtn');
      startBtn.disabled = !isLobby;
      startBtn.classList.toggle('hidden', !isLobby);

      const leaderboard = document.getElementById('leaderboard');
      if (!players.length) {
        leaderboard.innerHTML = '<div class="empty">Waiting for players...</div>';
      } else {
        leaderboard.innerHTML = players.map((player, index) => {
          const avatar = player?.blook?.imageUrl
            ? `<img src="${escapeHtml(player.blook.imageUrl)}" alt="${escapeHtml(player.blook.name || player.playerName || 'player')}" />`
            : '<i class="fa-solid fa-user"></i>';
          return `
            <div class="rank-row">
              <div class="rank-inner">
                <div class="rank-place">${ordinalLabel(index + 1)}</div>
                <div class="rank-avatar">${avatar}</div>
                <div class="rank-name">${escapeHtml(player.playerName || 'Player')}</div>
                <div class="rank-gold">${Number(player.gold || 0).toLocaleString()} <i class="fa-solid fa-coins" style="font-size:0.68em;"></i></div>
              </div>
            </div>
          `;
        }).join('');
      }

      if (isLive && typeof game.remainingSec === 'number') {
        lastRemainingSec = Math.max(0, Number(game.remainingSec));
        lastClockTickMs = Date.now();
        setClockText(lastRemainingSec);
      } else {
        lastRemainingSec = null;
        document.getElementById('clock').textContent = '--:--';
      }

      renderEventLog(game);
      const modal = document.getElementById('leaderboardModal');
      if (modal?.classList.contains('active')) {
        renderFullLeaderboard(latestPlayersSnapshot);
      }
    }

    function renderEventLog(game) {
      const progressLog = document.getElementById('progressLog');
      const events = Array.isArray(game?.eventLog) ? game.eventLog.slice(-80).reverse() : [];
      const players = Array.isArray(game?.players) ? game.players : [];
      const namedPlayers = players
        .map((player) => ({
          name: String(player?.playerName || ''),
          blook: player?.blook || null,
        }))
        .filter((entry) => entry.name)
        .sort((a, b) => b.name.length - a.name.length);
      const namePalette = ['#ff5b7f', '#ffb347', '#79d96f', '#79c8ff', '#d7a9ff', '#ff8f66', '#9ef0c7'];
      const nameColor = (name) => {
        const text = String(name || '');
        let hash = 0;
        for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash) + text.charCodeAt(i);
        return namePalette[Math.abs(hash) % namePalette.length];
      };
      const splitEventText = (text) => {
        const raw = String(text || '').trim();
        for (const entry of namedPlayers) {
          if (raw.startsWith(`${entry.name} `) || raw === entry.name) {
            return {
              name: entry.name,
              rest: raw.slice(entry.name.length).trim() || '',
              blook: entry.blook,
            };
          }
        }
        return { name: '', rest: raw, blook: null };
      };
      if (!progressLog) return;
      const isLive = String(game?.state || '') === 'live';
      if (!isLive || !events.length) {
        progressLog.classList.add('hidden');
        progressLog.innerHTML = '';
        return;
      }
      const compact = events.slice(0, 8);
      progressLog.innerHTML = compact.map((event) => {
        const parsed = splitEventText(event.text);
        return `
          <div class="progress-log-item">
            <div class="log-text">
              ${parsed.name ? `<span class="log-name" style="color:${nameColor(parsed.name)};">${escapeHtml(parsed.name)}</span>` : ''}
              ${parsed.name && parsed.rest ? ' ' : ''}
              ${escapeHtml(parsed.rest || '')}
            </div>
          </div>
        `;
      }).join('');
      progressLog.classList.remove('hidden');
    }

    function tickClock() {
      if (lastRemainingSec === null) return;
      const now = Date.now();
      const diff = Math.floor((now - lastClockTickMs) / 1000);
      if (diff <= 0) return;
      lastClockTickMs += diff * 1000;
      lastRemainingSec = Math.max(0, lastRemainingSec - diff);
      setClockText(lastRemainingSec);
    }

    function clearEndRevealTimers() {
      endRevealTimers.forEach((timerId) => clearTimeout(timerId));
      endRevealTimers = [];
    }

    function renderFullLeaderboard(players) {
      const list = document.getElementById('allLeaderboardList');
      if (!list) return;
      if (!Array.isArray(players) || !players.length) {
        list.innerHTML = '<div class="empty">No players yet.</div>';
        return;
      }
      list.innerHTML = players.map((player, index) => {
        const avatar = player?.blook?.imageUrl
          ? `<img src="${escapeHtml(player.blook.imageUrl)}" alt="${escapeHtml(player.playerName || 'player')}" />`
          : '<i class="fa-solid fa-user"></i>';
        return `
          <div class="leaderboard-item">
            <div class="leaderboard-item-place">${ordinalLabel(index + 1)}</div>
            <div class="leaderboard-item-avatar">${avatar}</div>
            <div class="leaderboard-item-name">${escapeHtml(player.playerName || 'Player')}</div>
            <div class="leaderboard-item-gold">${Number(player.gold || 0).toLocaleString()} <i class="fa-solid fa-coins"></i></div>
          </div>
        `;
      }).join('');
    }

    function openLeaderboardModal() {
      renderFullLeaderboard(latestPlayersSnapshot);
      const modal = document.getElementById('leaderboardModal');
      if (modal) modal.classList.add('active');
    }

    function closeLeaderboardModal() {
      const modal = document.getElementById('leaderboardModal');
      if (modal) modal.classList.remove('active');
    }

    function showEndScreen(game) {
      clearEndRevealTimers();
      playEndMusic();
      const players = [...(game.players || [])].sort((a, b) => Number(b.gold || 0) - Number(a.gold || 0));
      const top3 = players.slice(0, 3);
      const byPlace = {
        1: top3[0] || null,
        2: top3[1] || null,
        3: top3[2] || null,
      };
      const slots = [2, 1, 3];
      const podium = document.getElementById('podiumPlaces');
      podium.innerHTML = slots.map((place) => {
        const player = byPlace[place];
        const avatar = player?.blook?.imageUrl
          ? `<img src="${escapeHtml(player.blook.imageUrl)}" alt="${escapeHtml(player.playerName || `Place ${place}`)}" />`
          : '<i class="fa-solid fa-user"></i>';
        return `
          <div class="podium-slot place-${place}" data-place="${place}">
            <div class="podium-top">
              <div class="podium-head"><div class="podium-avatar">${avatar}</div></div>
              <div class="podium-name">${escapeHtml(player?.playerName || '-')}</div>
              <div class="podium-gold">${Number(player?.gold || 0).toLocaleString()} gold</div>
            </div>
            <div class="podium-inner">
              <div class="podium-rank">${ordinalLabel(place)}</div>
            </div>
          </div>
        `;
      }).join('');

      document.getElementById('endScreen').classList.add('active');
      const revealOrder = [3, 2, 1];
      revealOrder.forEach((place, index) => {
        const timerId = setTimeout(() => {
          const slot = podium.querySelector(`.podium-slot.place-${place}`);
          if (slot) slot.classList.add('reveal');
        }, 260 + (index * 640));
        endRevealTimers.push(timerId);
      });
    }

    async function pollGame() {
      if (gameEnded) return;
      try {
        const res = await fetch(`/api/games/${gameCode}/lobby`);
        const data = await res.json();

        if (!res.ok) {
          if (shouldRedirectForMissingGame(res.status, data?.error)) {
            redirectToIndex();
            return;
          }
          return;
        }

        updateLobby(data.game);
        playLobbyMusic();

        if (data.game.state === 'ended') {
          gameEnded = true;
          showEndScreen(data.game);
        }
      } catch (error) {
        console.error('Poll error:', error);
      }
    }

    async function startGame() {
      try {
        playLobbyMusic();
        const res = await fetch(`/api/games/${gameCode}/start`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (shouldRedirectForMissingGame(res.status, data?.error)) {
            redirectToIndex();
            return;
          }
          return;
        }
      } catch (error) {
        // noop
      }
    }

    async function endGame() {
      if (!confirm('End the game for all players?')) return;
      try {
        playLobbyMusic();
        const res = await fetch(`/api/games/${gameCode}/end`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (shouldRedirectForMissingGame(res.status, data?.error)) {
            redirectToIndex();
            return;
          }
          return;
        }
      } catch (error) {
        // noop
      }
    }

    async function closeLobby() {
      try {
        const res = await fetch(`/api/games/${gameCode}`, { method: 'DELETE' });
        if (res.ok) {
          window.location.href = '/';
          return;
        }
        if (shouldRedirectForMissingGame(res.status)) redirectToIndex();
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }

    function showAllPlayers() {}

    document.getElementById('endGameTopBtn').addEventListener('click', endGame);
    document.getElementById('startGameBtn').addEventListener('click', startGame);
    document.getElementById('viewAllLeaderboardBtn')?.addEventListener('click', openLeaderboardModal);
    document.getElementById('closeLeaderboardModalBtn')?.addEventListener('click', closeLeaderboardModal);
    document.getElementById('closeLeaderboardModalBtnBottom')?.addEventListener('click', closeLeaderboardModal);
    document.getElementById('leaderboardModal')?.addEventListener('click', (event) => {
      if (event.target?.id === 'leaderboardModal') closeLeaderboardModal();
    });
    document.getElementById('muteBtn').addEventListener('click', toggleMute);
    document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', updateFullscreenIcon);
    syncMuteIcon();
    updateFullscreenIcon();
    bindAudioUnlockListeners();
    playLobbyMusic();
    pollGame();
    pollInterval = setInterval(pollGame, 1500);
    setInterval(tickClock, 250);

    window.addEventListener('beforeunload', () => {
      if (pollInterval) clearInterval(pollInterval);
    });
