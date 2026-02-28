const params = new URLSearchParams(window.location.search);
const gameCode = String(params.get('join') || params.get('code') || '').trim().toUpperCase();

if (!gameCode) {
  window.location.replace('/index.html');
}

const codeLabel = document.getElementById('gameCodeLabel');
if (codeLabel) codeLabel.textContent = `Code: ${gameCode || '------'}`;

const nameInput = document.getElementById('joinName');
if (nameInput) nameInput.focus();

function setStatus(message) {
  const status = document.getElementById('joinStatus');
  if (!status) return;
  status.textContent = message;
  status.className = 'status error';
}

async function joinGame() {
  const name = String(document.getElementById('joinName')?.value || '').trim();
  if (!gameCode || gameCode.length !== 6) {
    setStatus('Invalid join code.');
    return;
  }
  if (!name) {
    setStatus('Please enter your username.');
    return;
  }

  const btn = document.getElementById('joinBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Joining...';
  }

  try {
    const res = await fetch(`/api/games/${gameCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: name })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to join game');

    window.location.href = `/lobby.html?code=${gameCode}&player=${data.player.playerId}`;
  } catch (error) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-play"></i> Join';
    }
    setStatus(error.message || 'Could not join game.');
  }
}

window.joinGame = joinGame;
nameInput?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinGame();
});
