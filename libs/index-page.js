    const pageParams = new URLSearchParams(window.location.search);
    const joinCodeFromQuery = String(pageParams.get('join') || pageParams.get('code') || '').trim().toUpperCase();
    if (joinCodeFromQuery) {
      window.location.replace(`/join.html?join=${encodeURIComponent(joinCodeFromQuery)}`);
    }

    function showHome() {
      document.getElementById('joinScreen').classList.add('hidden');
      document.getElementById('homeScreen').classList.remove('hidden');
    }

    function showHostSetup() {
      window.location.href = '/host-setup.html';
    }

    function showJoinScreen() {
      document.getElementById('homeScreen').classList.add('hidden');
      document.getElementById('joinScreen').classList.remove('hidden');
      document.getElementById('joinCode').focus();
    }

    function selectMode(element) {
      document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
      element.classList.add('selected');
    }

    function getSelectedMode() {
      const selected = document.querySelector('.mode-card.selected');
      return selected ? selected.dataset.mode : 'goldquest';
    }

    async function joinGame() {
      const code = document.getElementById('joinCode').value.trim().toUpperCase();
      const name = document.getElementById('joinName').value.trim();
      const statusDiv = document.getElementById('joinStatus');

      if (!code || code.length !== 6) {
        statusDiv.textContent = 'Please enter a valid 6-digit game code';
        statusDiv.className = 'status error';
        return;
      }
      if (!name) {
        statusDiv.textContent = 'Please enter your name';
        statusDiv.className = 'status error';
        return;
      }

      const joinBtn = event.target;
      joinBtn.disabled = true;
      joinBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Joining...';

      try {
        // First get game info to know the mode
        const lobbyRes = await fetch(`/api/games/${code}/lobby`);
        const lobbyData = await lobbyRes.json();
        
        if (!lobbyRes.ok) throw new Error(lobbyData.error || 'Game not found');

        const mode = lobbyData.game?.settings?.gameTypeFamily || 'goldquest';

        // Join the game
        const res = await fetch(`/api/games/${code}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerName: name })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to join');

        // Redirect to lobby page (waits for host to start)
        window.location.href = `/lobby.html?code=${code}&player=${data.player.playerId}`;
      } catch (err) {
        joinBtn.disabled = false;
        joinBtn.innerHTML = '<i class="fas fa-play"></i> Join Game';
        statusDiv.textContent = err.message;
        statusDiv.className = 'status error';
      }
    }

    async function createGame(type) {
      if (type === 'quick') {
        try {
          const body = {
            gameTypeFamily: 'goldquest',
            gameType: 'timed',
            timeLimitSec: 300, // 5 minutes
            maxPlayers: 60,
            feedbackDelaySec: 1,
            shuffleQuestions: true,
            setId: 'random'
          };

          const res = await fetch('/api/host', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to create game');

          window.location.href = `/host-lobby.html?code=${data.game.code}&pin=${data.game.hostPin}`;
        } catch (err) {
          alert('Failed to create game: ' + err.message);
        }
      }
    }

    // Allow Enter key to submit
    document.getElementById('joinCode')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') document.getElementById('joinName').focus();
    });
    document.getElementById('joinName')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') joinGame();
    });
