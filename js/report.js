import { supabase } from './supabase.js';
import { getPlayers, openAddPlayerDialog, invalidatePlayerCache } from './players.js';
import { previewDelta } from './elo.js';

export async function render() {
  const form = document.getElementById('report-form');
  const playerASelect = document.getElementById('report-player-a');
  const playerBSelect = document.getElementById('report-player-b');
  const winnerInput = document.getElementById('report-winner');
  const buttonA = document.getElementById('report-winner-a');
  const buttonB = document.getElementById('report-winner-b');
  const preview = document.getElementById('report-preview');
  const statusEl = document.getElementById('report-status');
  const emptyEl = document.getElementById('report-empty');
  if (!form) return;

  statusEl.textContent = '';
  statusEl.dataset.tone = '';
  preview.hidden = true;

  const players = await getPlayers({ forceRefresh: true });
  if (players.length < 2) {
    emptyEl.hidden = false;
    form.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  form.hidden = false;

  populateSelect(playerASelect, players);
  populateSelect(playerBSelect, players);
  resetSelects();

  const update = () => {
    refreshDisabledOptions(playerASelect, playerBSelect);
    refreshDisabledOptions(playerBSelect, playerASelect);
    refreshButtonLabels(buttonA, buttonB, playerASelect, playerBSelect, players);
    refreshPreview(preview, playerASelect, playerBSelect, players);
    refreshButtonEnabled(buttonA, playerASelect, playerBSelect);
    refreshButtonEnabled(buttonB, playerBSelect, playerASelect);
  };

  playerASelect.onchange = update;
  playerBSelect.onchange = update;
  update();

  buttonA.onclick = () => submit(playerASelect.value);
  buttonB.onclick = () => submit(playerBSelect.value);

  form.onsubmit = (e) => e.preventDefault();

  function resetSelects() {
    playerASelect.value = '';
    playerBSelect.value = '';
  }

  async function submit(winnerId) {
    statusEl.textContent = '';
    statusEl.dataset.tone = '';
    if (!winnerId) return;
    const aId = playerASelect.value;
    const bId = playerBSelect.value;
    if (!aId || !bId) {
      statusEl.dataset.tone = 'error';
      statusEl.textContent = 'Välj båda spelarna först.';
      return;
    }
    if (aId === bId) {
      statusEl.dataset.tone = 'error';
      statusEl.textContent = 'Välj två olika spelare.';
      return;
    }
    const loserId = winnerId === aId ? bId : aId;

    setBusy(true);
    const { data, error } = await supabase
      .from('matches')
      .insert({ winner_id: winnerId, loser_id: loserId })
      .select()
      .single();
    setBusy(false);

    if (error) {
      statusEl.dataset.tone = 'error';
      statusEl.textContent = `Kunde inte spara: ${error.message}`;
      return;
    }

    const winner = players.find((p) => p.id === winnerId);
    const loser = players.find((p) => p.id === loserId);
    const winnerDelta = data.winner_rating_after - data.winner_rating_before;
    const loserDelta = data.loser_rating_after - data.loser_rating_before;
    invalidatePlayerCache();

    // Rensa formuläret och stäng report-dialogen innan result-overlayen visas
    resetSelects();
    update();
    statusEl.textContent = '';
    statusEl.dataset.tone = '';
    document.getElementById('report-dialog')?.close();

    showMatchResult({
      matchId: data.id,
      winnerName: winner.name,
      loserName: loser.name,
      winnerAvatar: winner.avatar_url,
      loserAvatar: loser.avatar_url,
      winnerDelta,
      loserDelta,
    });
  }

  function setBusy(busy) {
    buttonA.disabled = busy;
    buttonB.disabled = busy;
    playerASelect.disabled = busy;
    playerBSelect.disabled = busy;
  }
}

function populateSelect(select, players) {
  const placeholder = `<option value="" disabled selected>Välj spelare…</option>`;
  const options = players
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${p.rating})</option>`)
    .join('');
  select.innerHTML = placeholder + options;
}

function refreshDisabledOptions(select, otherSelect) {
  const otherId = otherSelect.value;
  for (const opt of select.options) {
    // Lämna placeholdern ifred — den ska alltid vara disabled
    if (opt.value === '') continue;
    opt.disabled = otherId !== '' && opt.value === otherId;
  }
}

function refreshButtonEnabled(button, ownSelect, otherSelect) {
  const ready = ownSelect.value && otherSelect.value && ownSelect.value !== otherSelect.value;
  button.disabled = !ready;
}

function refreshButtonLabels(buttonA, buttonB, selectA, selectB, players) {
  const a = players.find((p) => p.id === selectA.value);
  const b = players.find((p) => p.id === selectB.value);
  setWinnerLabel(buttonA, a);
  setWinnerLabel(buttonB, b);
}

function setWinnerLabel(button, player) {
  const text = button.querySelector('.winner-btn-text');
  if (!text) return;
  text.textContent = player ? `${player.name} vann` : 'Välj spelare';
}

function refreshPreview(preview, selectA, selectB, players) {
  const a = players.find((p) => p.id === selectA.value);
  const b = players.find((p) => p.id === selectB.value);
  if (!a || !b || a.id === b.id) {
    preview.hidden = true;
    return;
  }
  const deltaIfAWins = previewDelta(a.rating, b.rating);
  const deltaIfBWins = previewDelta(b.rating, a.rating);
  preview.hidden = false;
  preview.innerHTML = `
    <span>Om <strong>${escapeHtml(a.name)}</strong> vinner: <em>+${deltaIfAWins}</em></span>
    <span>Om <strong>${escapeHtml(b.name)}</strong> vinner: <em>+${deltaIfBWins}</em></span>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function bindAddPlayerButton(onAdded) {
  const btn = document.getElementById('open-add-player');
  if (!btn) return;
  btn.onclick = () => openAddPlayerDialog({ onAdded });
}

// ---------- Match-result-overlay ----------

function showMatchResult({ matchId, winnerName, loserName, winnerAvatar, loserAvatar, winnerDelta, loserDelta }) {
  const overlay   = document.getElementById('result-overlay');
  const winnerEl  = document.getElementById('result-winner-name');
  const loserEl   = document.getElementById('result-loser-name');
  const winnerDel = document.getElementById('result-winner-delta');
  const loserDel  = document.getElementById('result-loser-delta');
  const winnerAv  = document.getElementById('result-winner-avatar');
  const loserAv   = document.getElementById('result-loser-avatar');
  const goBtn     = document.getElementById('result-go');
  const undoBtn   = document.getElementById('result-undo');
  const footnote  = document.getElementById('result-footnote');
  if (!overlay) return;

  winnerEl.textContent = winnerName;
  loserEl.textContent  = loserName;
  winnerDel.textContent = '+0';
  loserDel.textContent  = '−0';
  paintAvatar(winnerAv, winnerName, winnerAvatar);
  paintAvatar(loserAv,  loserName,  loserAvatar);
  footnote.textContent = 'Klicka utanför för att stänga';
  footnote.dataset.tone = '';
  undoBtn.disabled = false;
  goBtn.disabled = false;

  // Spela animationerna om från början varje gång genom att toggla .show
  overlay.classList.remove('show');
  overlay.hidden = false;
  overlay.setAttribute('aria-hidden', 'false');
  void overlay.offsetHeight;
  overlay.classList.add('show');

  const countUpStartMs = 600;
  setTimeout(() => animateCount(winnerDel, winnerDelta, 850), countUpStartMs);
  setTimeout(() => animateCount(loserDel,  loserDelta,  850), countUpStartMs);

  const hideOverlay = () => {
    cleanup();
    overlay.classList.remove('show');
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
  };

  const goToLadder = () => {
    hideOverlay();
    location.hash = 'ladder';
  };

  const undoMatch = async () => {
    if (!matchId) return;
    undoBtn.disabled = true;
    goBtn.disabled = true;
    footnote.dataset.tone = '';
    footnote.textContent = 'Ångrar matchen…';

    const { error } = await supabase.rpc('undo_match', { p_match_id: matchId });

    if (error) {
      undoBtn.disabled = false;
      goBtn.disabled = false;
      footnote.dataset.tone = 'error';
      footnote.textContent = friendlyUndoError(error);
      return;
    }

    invalidatePlayerCache();
    footnote.dataset.tone = 'success';
    footnote.textContent = 'Matchen ångrad';
    setTimeout(hideOverlay, 700);
  };

  const onClickBackdrop = (e) => {
    if (e.target === overlay) goToLadder();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') goToLadder();
  };

  function cleanup() {
    goBtn.removeEventListener('click', goToLadder);
    undoBtn.removeEventListener('click', undoMatch);
    overlay.removeEventListener('click', onClickBackdrop);
    document.removeEventListener('keydown', onKey);
  }

  goBtn.addEventListener('click', goToLadder);
  undoBtn.addEventListener('click', undoMatch);
  overlay.addEventListener('click', onClickBackdrop);
  document.addEventListener('keydown', onKey);
}

function paintAvatar(el, name, avatarUrl) {
  if (!el) return;
  el.textContent = '';
  const fallback = document.createElement('span');
  fallback.className = 'result-avatar-fallback';
  fallback.textContent = avatarInitials(name);
  el.appendChild(fallback);
  if (avatarUrl) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = avatarUrl;
    img.onerror = () => img.remove();
    el.appendChild(img);
  }
}

function avatarInitials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function friendlyUndoError(err) {
  const msg = err.message ?? '';
  if (msg.includes('senaste')) return 'Någon annan har redan rapporterat en match efter denna — kan inte ångras.';
  if (msg.includes('gammal'))  return 'Matchen är äldre än 5 min och kan inte ångras längre.';
  return `Kunde inte ångra: ${msg || err.code || 'okänt fel'}`;
}

function animateCount(el, target, durationMs) {
  const start = performance.now();
  const sign = target < 0 ? '−' : '+';
  const abs  = Math.abs(target);

  function step(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    const val = Math.round(abs * eased);
    el.textContent = `${sign}${val}`;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
