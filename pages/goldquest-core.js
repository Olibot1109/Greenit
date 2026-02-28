(function registerGreenitPageHandlers(global) {
  const presets = {
    goldquest: { view: "join", gameTypeFamily: "goldquest", gameType: "timed" },
    goldquesthost: { view: "host", gameTypeFamily: "goldquest", gameType: "timed" },
    hostgoldquest: { view: "host", gameTypeFamily: "goldquest", gameType: "timed" },
    hostgoldqueest: { view: "host", gameTypeFamily: "goldquest", gameType: "timed" },
    assemble: { view: "join", gameTypeFamily: "assemble", gameType: "timed" },
    hostassemble: { view: "host", gameTypeFamily: "assemble", gameType: "timed" },
  };

  function resolveEntryPreset(entry) {
    const key = String(entry || "").trim().toLowerCase();
    return presets[key] ? { ...presets[key] } : null;
  }

  function resolveEntryFromContext() {
    const override = String(global.__GREENIT_ENTRY_OVERRIDE || "").trim().toLowerCase();
    if (override) return override;
    const params = new URLSearchParams(global.location.search || "");
    return String(params.get("entry") || "").trim().toLowerCase();
  }

  const runtime = {
    hostMusicEnabled: true,
    hostMusicAudio: null,
    hostMusicNeedsUserGesture: false,
    hostMusicTracks: [],
    hostMusicQueue: [],
    hostMusicCurrentTrack: "",
    hostMusicTracksPromise: null,
    totalGoldDisplay: 0,
    totalGoldAnimationFrame: null,
    hasPlayedEndScreenIntro: false,
    lastEndScreenKey: "",
    endScreenIntroTimer: null,
    endScreenIntroInProgress: false,
    endLeaderboardOpen: false,
    latestEndedPlayers: [],
    lastEndedRenderKey: "",
  };

  function numberLabel(value) {
    return Number(value || 0).toLocaleString();
  }

  function shuffleCopy(list) {
    const out = Array.isArray(list) ? [...list] : [];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function clearEndIntroTimer() {
    if (!runtime.endScreenIntroTimer) return;
    clearTimeout(runtime.endScreenIntroTimer);
    runtime.endScreenIntroTimer = null;
  }

  function setEndLeaderboardOpen(open) {
    runtime.endLeaderboardOpen = !!open;
    const overlay = document.getElementById("fullLeaderboardOverlay");
    if (!overlay) return;
    overlay.classList.toggle("hidden", !runtime.endLeaderboardOpen);
  }

  function animateTotalGold(targetGold) {
    const label = document.getElementById("endTotalGold");
    if (!label) return;
    const target = Math.max(0, Number(targetGold) || 0);
    if (runtime.totalGoldAnimationFrame) cancelAnimationFrame(runtime.totalGoldAnimationFrame);
    const start = Number(runtime.totalGoldDisplay) || 0;
    const diff = target - start;
    if (!diff) {
      label.textContent = numberLabel(target);
      return;
    }
    const duration = 700;
    const started = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - ((1 - t) ** 3);
      runtime.totalGoldDisplay = Math.round(start + (diff * eased));
      label.textContent = numberLabel(runtime.totalGoldDisplay);
      if (t < 1) {
        runtime.totalGoldAnimationFrame = requestAnimationFrame(tick);
      } else {
        runtime.totalGoldAnimationFrame = null;
        runtime.totalGoldDisplay = target;
        label.textContent = numberLabel(target);
      }
    };
    runtime.totalGoldAnimationFrame = requestAnimationFrame(tick);
  }

  function ensureHostMusicAudio(playCb) {
    if (runtime.hostMusicAudio) return runtime.hostMusicAudio;
    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = 0.55;
    audio.addEventListener("ended", () => {
      runtime.hostMusicCurrentTrack = "";
      playCb();
    });
    audio.addEventListener("error", () => {
      runtime.hostMusicCurrentTrack = "";
      setTimeout(() => playCb(), 220);
    });
    runtime.hostMusicAudio = audio;
    return audio;
  }

  async function ensureHostMusicTracks(apiFn) {
    if (runtime.hostMusicTracks.length) return runtime.hostMusicTracks;
    if (runtime.hostMusicTracksPromise) return runtime.hostMusicTracksPromise;
    runtime.hostMusicTracksPromise = apiFn("/api/audio/tracks")
      .then((data) => {
        const tracks = Array.isArray(data?.tracks) ? data.tracks.filter((track) => typeof track === "string" && track.trim()) : [];
        runtime.hostMusicTracks = tracks.length ? tracks : ["/mp3/1.mp3"];
        runtime.hostMusicQueue = [];
        return runtime.hostMusicTracks;
      })
      .catch(() => {
        runtime.hostMusicTracks = ["/mp3/1.mp3"];
        runtime.hostMusicQueue = [];
        return runtime.hostMusicTracks;
      })
      .finally(() => {
        runtime.hostMusicTracksPromise = null;
      });
    return runtime.hostMusicTracksPromise;
  }

  function nextHostMusicTrack() {
    if (!runtime.hostMusicTracks.length) return "";
    if (!runtime.hostMusicQueue.length) runtime.hostMusicQueue = shuffleCopy(runtime.hostMusicTracks);
    if (!runtime.hostMusicQueue.length) return "";
    let next = runtime.hostMusicQueue.shift() || "";
    if (next === runtime.hostMusicCurrentTrack && runtime.hostMusicQueue.length) {
      next = runtime.hostMusicQueue.shift() || next;
    }
    return next;
  }

  function wireHostMusicUnlock(playCb) {
    if (!runtime.hostMusicNeedsUserGesture) return;
    const unlock = () => {
      runtime.hostMusicNeedsUserGesture = false;
      playCb();
    };
    global.addEventListener("pointerdown", unlock, { once: true, passive: true });
    global.addEventListener("keydown", unlock, { once: true });
  }

  async function playHostMusic({ api }) {
    if (!runtime.hostMusicEnabled || typeof api !== "function") return;
    const tracks = await ensureHostMusicTracks(api);
    if (!tracks.length) return;
    const audio = ensureHostMusicAudio(() => playHostMusic({ api }));
    if (!runtime.hostMusicCurrentTrack) {
      runtime.hostMusicCurrentTrack = nextHostMusicTrack();
      if (!runtime.hostMusicCurrentTrack) return;
      audio.src = runtime.hostMusicCurrentTrack;
    }
    if (!audio.paused) return;
    try {
      await audio.play();
      runtime.hostMusicNeedsUserGesture = false;
    } catch {
      runtime.hostMusicNeedsUserGesture = true;
      wireHostMusicUnlock(() => playHostMusic({ api }));
    }
  }

  function pauseHostMusic(reset = false) {
    if (!runtime.hostMusicAudio) return;
    runtime.hostMusicAudio.pause();
    if (!reset) return;
    try {
      runtime.hostMusicAudio.currentTime = 0;
    } catch {
      // noop
    }
    runtime.hostMusicCurrentTrack = "";
  }

  function renderFullLeaderboard(players, { escapeHtml, ordinalRank }) {
    const root = document.getElementById("fullLeaderboardList");
    if (!root) return;
    root.innerHTML = "";
    players.forEach((player, index) => {
      const blook = player.blook || player.avatar || {
        name: "No Blook",
        imageUrl: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=No%20Blook",
      };
      const row = document.createElement("div");
      row.className = "full-row";
      row.innerHTML = `
        <div class="full-row-rank">${ordinalRank(index + 1)}</div>
        <div class="full-row-main">
          <img src="${escapeHtml(blook.imageUrl)}" alt="${escapeHtml(blook.name)}" />
          <div class="full-row-name">${escapeHtml(player.playerName)}</div>
        </div>
        <div class="full-row-score">${numberLabel(player.gold)}</div>
      `;
      root.appendChild(row);
    });
  }

  function renderHostEndScreen({ sortedPlayers, escapeHtml, ordinalRank }) {
    const stage = document.getElementById("podiumStage");
    if (!stage) return;
    const renderKey = sortedPlayers
      .map((player) => `${player.playerId}:${player.playerName}:${player.gold}:${player?.blook?.id || player?.avatar?.id || ""}`)
      .join("|");
    const shouldRerender = renderKey !== runtime.lastEndedRenderKey;
    if (shouldRerender) {
      runtime.lastEndedRenderKey = renderKey;
      runtime.latestEndedPlayers = sortedPlayers.map((player) => ({ ...player }));
    }
    const endPlayerCount = document.getElementById("endPlayerCount");
    if (endPlayerCount) endPlayerCount.textContent = String(sortedPlayers.length);
    const totalGold = sortedPlayers.reduce((sum, player) => sum + (Number(player.gold) || 0), 0);
    animateTotalGold(totalGold);
    if (shouldRerender) {
      renderFullLeaderboard(sortedPlayers, { escapeHtml, ordinalRank });
    }

    const top = [sortedPlayers[1] || null, sortedPlayers[0] || null, sortedPlayers[2] || null];
    const rankMeta = [
      { rank: 2, label: "2nd" },
      { rank: 1, label: "1st" },
      { rank: 3, label: "3rd" },
    ];
    if (shouldRerender) {
      stage.innerHTML = top.map((player, index) => {
        const blook = player?.blook || player?.avatar || null;
        const imageUrl = blook?.imageUrl || "";
        const name = player?.playerName || "-";
        const gold = Number(player?.gold || 0);
        return `
          <div class="podium-slot rank-${rankMeta[index].rank}" data-rank="${rankMeta[index].rank}">
            <div class="podium-avatar-wrap">
              ${imageUrl ? `<img class="podium-avatar" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" />` : '<div class="podium-avatar"></div>'}
              <div class="podium-name">${escapeHtml(name)}</div>
              <div class="podium-gold">${player ? `${numberLabel(gold)} gold` : "-"}</div>
            </div>
            <div class="podium-block">${rankMeta[index].label}</div>
          </div>
        `;
      }).join("");
    }

    const revealKey = sortedPlayers.slice(0, 3).map((player) => `${player.playerId}:${player.gold}`).join("|");
    if (revealKey !== runtime.lastEndScreenKey) {
      runtime.lastEndScreenKey = revealKey;
      runtime.hasPlayedEndScreenIntro = false;
      runtime.endScreenIntroInProgress = false;
      clearEndIntroTimer();
    }

    const slots = Array.from(stage.querySelectorAll(".podium-slot"));
    if (!runtime.hasPlayedEndScreenIntro) {
      if (runtime.endScreenIntroInProgress) return;
      slots.forEach((slot) => slot.classList.remove("is-visible", "is-rise", "is-revealed"));
      const revealBase = [2, 0, 1];
      const revealOrder = [
        ...revealBase.filter((slotIndex) => top[slotIndex]),
        ...revealBase.filter((slotIndex) => !top[slotIndex]),
      ];
      let revealStep = 0;
      runtime.endScreenIntroInProgress = true;
      runtime.hasPlayedEndScreenIntro = true;
      const revealNext = () => {
        const slotIndex = revealOrder[revealStep];
        const slot = slots[slotIndex];
        if (slot) {
          slot.classList.add("is-visible");
          requestAnimationFrame(() => slot.classList.add("is-rise"));
          setTimeout(() => slot.classList.add("is-revealed"), 760);
        }
        revealStep += 1;
        if (revealStep < revealOrder.length) {
          runtime.endScreenIntroTimer = setTimeout(revealNext, 1200);
        } else {
          runtime.endScreenIntroTimer = null;
          runtime.endScreenIntroInProgress = false;
        }
      };
      clearEndIntroTimer();
      runtime.endScreenIntroTimer = setTimeout(revealNext, 280);
    } else if (!runtime.endScreenIntroInProgress) {
      slots.forEach((slot) => slot.classList.add("is-visible", "is-rise", "is-revealed"));
    }
  }

  function resetEndState() {
    runtime.hasPlayedEndScreenIntro = false;
    runtime.endScreenIntroInProgress = false;
    runtime.lastEndedRenderKey = "";
    runtime.latestEndedPlayers = [];
    clearEndIntroTimer();
  }

  async function handleLobbyPhase({ phase, sortedPlayers, startStatusEl, api, escapeHtml, ordinalRank }) {
    if (phase === "live" || phase === "ended") {
      await playHostMusic({ api });
    } else {
      pauseHostMusic(true);
    }

    if (phase === "ended") {
      document.getElementById("hostEndScreen")?.classList.remove("hidden");
      if (startStatusEl) startStatusEl.textContent = "";
      renderHostEndScreen({ sortedPlayers, escapeHtml, ordinalRank });
      return;
    }

    document.getElementById("hostEndScreen")?.classList.add("hidden");
    setEndLeaderboardOpen(false);
    resetEndState();
  }

  function onLeaveLobby() {
    pauseHostMusic(true);
    setEndLeaderboardOpen(false);
  }

  function chestIconMeta(type) {
    if (type === "double") return { glyph: "x2", className: "icon-gain" };
    if (type === "triple") return { glyph: "x3", className: "icon-gain" };
    if (type === "swap") return { glyph: "\u21c4", className: "icon-swap" };
    if (type === "take_percent") return { glyph: "\u2934", className: "icon-take" };
    if (type === "lose_percent" || type === "lose_flat") return { glyph: "\u2212", className: "icon-loss" };
    if (type === "bonus_percent" || type === "bonus_flat") return { glyph: "+", className: "icon-gain" };
    if (type === "no_interaction") return { glyph: "!", className: "icon-neutral" };
    return { glyph: "\u2022", className: "icon-neutral" };
  }

  function chestOutcomeDetail(result) {
    const before = Number(result?.playerBefore);
    const after = Number(result?.playerAfter);
    const parts = [];
    if (Number.isFinite(before) && Number.isFinite(after)) {
      parts.push(`You: ${before} \u2192 ${after}`);
    }
    if (result?.target && Number.isFinite(Number(result?.targetBefore)) && Number.isFinite(Number(result?.targetAfter))) {
      parts.push(`${result.target}: ${Number(result.targetBefore)} \u2192 ${Number(result.targetAfter)}`);
    }
    return parts.join(" | ");
  }

  function chestDeltaLabel(delta) {
    const value = Number(delta);
    if (!Number.isFinite(value)) return "";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value} gold`;
  }

  function chestImpactMarkup(result, { escapeHtml }) {
    const playerBefore = Number(result?.playerBefore);
    const playerAfter = Number(result?.playerAfter);
    const playerDelta = playerAfter - playerBefore;
    const hasPlayer = Number.isFinite(playerBefore) && Number.isFinite(playerAfter);
    const targetName = String(result?.target || "").trim();
    const targetBefore = Number(result?.targetBefore);
    const targetAfter = Number(result?.targetAfter);
    const hasTarget = !!targetName && Number.isFinite(targetBefore) && Number.isFinite(targetAfter);

    if (!hasPlayer) return "";

    const playerDeltaClass = playerDelta > 0 ? "positive" : playerDelta < 0 ? "negative" : "";
    const playerCard = `
      <div class="impact-card">
        <div class="impact-label">You</div>
        <div class="impact-main">${playerBefore} \u2192 ${playerAfter}</div>
        <div class="impact-delta ${playerDeltaClass}">${escapeHtml(chestDeltaLabel(playerDelta))}</div>
      </div>
    `;

    if (!hasTarget) return `<div class="chest-impact-grid single">${playerCard}</div>`;

    const targetDelta = targetAfter - targetBefore;
    const targetDeltaClass = targetDelta > 0 ? "positive" : targetDelta < 0 ? "negative" : "";
    const connector = result?.type === "swap" ? "\u21c4" : "\u2192";
    return `
      <div class="chest-impact-grid">
        ${playerCard}
        <div class="impact-connector">${connector}</div>
        <div class="impact-card">
          <div class="impact-label">${escapeHtml(targetName)}</div>
          <div class="impact-main">${targetBefore} \u2192 ${targetAfter}</div>
          <div class="impact-delta ${targetDeltaClass}">${escapeHtml(chestDeltaLabel(targetDelta))}</div>
        </div>
      </div>
    `;
  }

  function chestOutcomeMeta(type) {
    if (type === "bonus_flat" || type === "bonus_percent" || type === "double" || type === "triple") {
      return { className: "is-gain", badge: "+" };
    }
    if (type === "lose_flat" || type === "lose_percent") return { className: "is-loss", badge: "\u2212" };
    if (type === "take_percent") return { className: "is-take", badge: "\u2934" };
    if (type === "swap") return { className: "is-swap", badge: "\u21c4" };
    return { className: "is-neutral", badge: "\u2022" };
  }

  async function handlePlayerPhase({
    data,
    panel,
    answerGrid,
    metaEl,
    modeText,
    setStatus,
    escapeHtml,
    fitChestLayout,
    setPlayerShellMode,
    setPlayerHudState,
    chooseChestOption,
    chooseChestTarget,
    skipChestTarget,
    completeChestResult,
    refreshPlayer,
    isFeedbackLocked,
    lockFeedbackFor,
    clearFeedbackLock,
  }) {
    const status = typeof setStatus === "function" ? setStatus : () => {};
    const escape = typeof escapeHtml === "function" ? escapeHtml : (value) => String(value || "");
    const fitLayout = typeof fitChestLayout === "function" ? fitChestLayout : () => {};
    const setShell = typeof setPlayerShellMode === "function" ? setPlayerShellMode : () => {};
    const setHud = typeof setPlayerHudState === "function" ? setPlayerHudState : () => {};
    const refresh = typeof refreshPlayer === "function" ? refreshPlayer : async () => {};
    const locked = typeof isFeedbackLocked === "function" ? isFeedbackLocked : () => false;
    const lockFor = typeof lockFeedbackFor === "function" ? lockFeedbackFor : () => {};
    const unlock = typeof clearFeedbackLock === "function" ? clearFeedbackLock : () => {};
    const mode = String(modeText || "Gold Quest");
    if (!panel || !answerGrid || !metaEl) return false;

    if (data.chestPhase === "choose" && data.chest) {
      setShell("chest");
      setHud("correct", "CHEST");
      status("Choose a chest.");
      answerGrid.innerHTML = "";
      panel.innerHTML = `
        <div class="chest-screen">
          <div class="chest-banner">
            <div class="chest-banner-inner">Choose a Chest!</div>
          </div>
          <div class="chest-row">
            <button class="chest-btn" data-chest="0" type="button"><img src="/chetsicons/chest1.svg" alt="Chest 1" /></button>
            <button class="chest-btn" data-chest="1" type="button"><img src="/chetsicons/chest2.svg" alt="Chest 2" /></button>
            <button class="chest-btn" data-chest="2" type="button"><img src="/chetsicons/chest3.svg" alt="Chest 3" /></button>
          </div>
        </div>
      `;
      const chestButtons = Array.from(panel.querySelectorAll("[data-chest]"));
      chestButtons.forEach((button) => {
        button.onclick = async () => {
          try {
            if (locked()) return;
            lockFor(450);
            chestButtons.forEach((entry) => {
              entry.disabled = true;
              entry.classList.add("is-disabled");
              entry.style.pointerEvents = "none";
            });
            await chooseChestOption(Number(button.dataset.chest));
            unlock();
            await refresh();
          } catch (error) {
            unlock();
            status(error?.message || "Could not choose chest.");
            chestButtons.forEach((entry) => {
              entry.disabled = false;
              entry.classList.remove("is-disabled");
              entry.style.pointerEvents = "auto";
            });
          }
        };
      });
      let meta = `${mode} \u2022 Chest reward`;
      if (typeof data.remainingSec === "number") meta += ` \u2022 ${data.remainingSec}s left`;
      metaEl.textContent = meta;
      fitLayout();
      return true;
    }

    if (data.chestPhase === "target" && data.chest) {
      setShell("chest");
      setHud("correct", "TARGET");
      status("Choose a player or skip.");
      answerGrid.innerHTML = "";
      const choices = Array.isArray(data.chest.targetChoices) ? data.chest.targetChoices : [];
      const targetAction = String(data.chest.targetAction || "");
      const actionLabel = targetAction === "swap" ? "swap with" : "steal from";
      const choicesHtml = choices.map((target) => {
        const blook = target?.blook || {};
        const imageUrl = String(blook.imageUrl || "");
        return `
          <button class="chest-target-btn" data-target-player="${escape(target.playerId)}" type="button">
            ${imageUrl ? `<img src="${escape(imageUrl)}" alt="${escape(target.playerName)}" />` : '<div class="target-fallback">?</div>'}
            <div class="target-name">${escape(target.playerName)}</div>
            <div class="target-gold">${Number(target.gold || 0)} gold</div>
          </button>
        `;
      }).join("");
      panel.innerHTML = `
        <div class="chest-screen">
          <div class="chest-banner">
            <div class="chest-banner-inner">Choose Who to ${targetAction === "swap" ? "Swap" : "Steal"}!</div>
          </div>
          <div class="chest-target-grid">${choicesHtml || '<div class="small">No available targets.</div>'}</div>
          <div class="chest-target-actions">
            <button id="chestSkipTarget" class="ghost" type="button">Skip</button>
          </div>
        </div>
      `;
      const targetButtons = Array.from(panel.querySelectorAll("[data-target-player]"));
      targetButtons.forEach((button) => {
        button.onclick = async () => {
          try {
            if (locked()) return;
            lockFor(350);
            targetButtons.forEach((entry) => {
              entry.disabled = true;
            });
            const targetPlayerId = button.getAttribute("data-target-player") || "";
            await chooseChestTarget(targetPlayerId);
            unlock();
            await refresh();
          } catch (error) {
            unlock();
            targetButtons.forEach((entry) => {
              entry.disabled = false;
            });
            status(error?.message || "Could not choose target.");
          }
        };
      });
      const skipBtn = panel.querySelector("#chestSkipTarget");
      if (skipBtn) {
        skipBtn.onclick = async () => {
          try {
            if (locked()) return;
            lockFor(350);
            await skipChestTarget();
            unlock();
            await refresh();
          } catch (error) {
            unlock();
            status(error?.message || "Could not skip target.");
          }
        };
      }
      let meta = `${mode} \u2022 Choose who to ${actionLabel}`;
      if (typeof data.remainingSec === "number") meta += ` \u2022 ${data.remainingSec}s left`;
      metaEl.textContent = meta;
      fitLayout();
      return true;
    }

    if (data.chestPhase === "result" && data.chest) {
      setShell("chest");
      const options = Array.isArray(data.chest.options) ? data.chest.options : [];
      const selectedIndex = Number(data.chest.selectedIndex);
      const result = data.chest.result || {};
      const noInteraction = !!result.noInteraction;
      const outcomeHeadline = result.headline || result.label || "Chest Result";
      const outcomeDetail = chestOutcomeDetail(result);
      const impactHtml = chestImpactMarkup(result, { escapeHtml: escape });
      const outcome = chestOutcomeMeta(result.type);
      const outcomeClass = `chest-outcome ${outcome.className}`;
      setHud("correct", noInteraction ? "NO TARGET" : "CHEST");
      answerGrid.innerHTML = "";
      status(result.text || "");

      if (noInteraction) {
        panel.innerHTML = `
          <div class="chest-screen">
            <div class="chest-banner">
              <div class="chest-banner-inner">No Players to Interact With</div>
            </div>
            <button id="chestNextBtn" class="chest-next-btn" type="button">Next</button>
          </div>
        `;
      } else {
        const choicesHtml = options.map((option, index) => {
          const icon = chestIconMeta(option.type);
          return `
            <div class="result-choice ${index === selectedIndex ? "active" : ""}">
              <div class="result-icon ${icon.className}"><span>${icon.glyph}</span></div>
              <div class="result-label">${escape(option.label)}</div>
            </div>
          `;
        }).join("");

        panel.innerHTML = `
          <div class="chest-screen" id="chestResultRoot" style="cursor:pointer;">
            <div class="chest-banner">
              <div class="chest-banner-inner">Click Anywhere to Go Next</div>
            </div>
            <div class="chest-result-row">${choicesHtml}</div>
            <div class="${outcomeClass}">
              <div class="chest-outcome-top">
                <span class="chest-outcome-badge">${outcome.badge}</span>
                <div class="chest-outcome-head">${escape(outcomeHeadline)}</div>
              </div>
              <div class="chest-note">${escape(result.text || "")}</div>
              ${impactHtml || ""}
              ${!impactHtml && outcomeDetail ? `<div class="chest-note subtle">${escape(outcomeDetail)}</div>` : ""}
            </div>
          </div>
        `;
      }

      const goNext = async () => {
        try {
          if (locked()) return;
          lockFor(350);
          await completeChestResult();
          unlock();
          await refresh();
        } catch (error) {
          unlock();
          status(error?.message || "Could not continue.");
        }
      };

      const root = panel.querySelector("#chestResultRoot");
      if (root) root.onclick = goNext;
      const nextBtn = panel.querySelector("#chestNextBtn");
      if (nextBtn) nextBtn.onclick = goNext;

      let meta = `${mode} \u2022 Chest resolved`;
      if (typeof data.remainingSec === "number") meta += ` \u2022 ${data.remainingSec}s left`;
      metaEl.textContent = meta;
      fitLayout();
      return true;
    }

    return false;
  }

  function applyEntryPreset(context) {
    const entry = resolveEntryFromContext();
    if (!entry) return;
    const preset = resolveEntryPreset(entry);
    if (!preset) return;

    const familyEl = document.getElementById("gameTypeFamily");
    const gameTypeEl = document.getElementById("gameType");
    if (familyEl && preset.gameTypeFamily) familyEl.value = preset.gameTypeFamily;
    if (gameTypeEl && preset.gameType) gameTypeEl.value = preset.gameType;

    if (context && typeof context.updateGameTypeFields === "function") {
      context.updateGameTypeFields();
    }
    if (preset.view && context && typeof context.showView === "function") {
      context.showView(preset.view);
    }
  }

  global.GreenitPages = global.GreenitPages || {};
  global.GreenitPages.resolveEntryPreset = resolveEntryPreset;
  global.GreenitPages.applyEntryPreset = applyEntryPreset;
  global.GreenitPages.goldquest = {
    setEndLeaderboardOpen,
    playHostMusic,
    pauseHostMusic,
    renderHostEndScreen,
    handleLobbyPhase,
    handlePlayerPhase,
    onLeaveLobby,
    chestIconMeta,
    chestOutcomeDetail,
    chestImpactMarkup,
    chestOutcomeMeta,
  };
})(window);
