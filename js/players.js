import { fetchPlayers, addPlayer as addPlayerRemote } from './firebase.js';

let cachedPlayers = null;

export async function getPlayers({ forceRefresh = false } = {}) {
  if (cachedPlayers && !forceRefresh) return cachedPlayers;
  cachedPlayers = await fetchPlayers();
  return cachedPlayers;
}

export function invalidatePlayerCache() {
  cachedPlayers = null;
}

export async function addPlayer(name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Namnet får inte vara tomt.');
  if (trimmed.length > 40) throw new Error('Namnet får vara max 40 tecken.');

  // Funktionen kollar unika namn och returnerar en svensk felbeskrivning
  const player = await addPlayerRemote(trimmed);
  invalidatePlayerCache();
  return player;
}

// ---------- Dialog UI ----------

export function openAddPlayerDialog({ onAdded } = {}) {
  const dialog = document.getElementById('add-player-dialog');
  const form = document.getElementById('add-player-form');
  const input = document.getElementById('add-player-name');
  const errorEl = document.getElementById('add-player-error');

  errorEl.textContent = '';
  input.value = '';
  dialog.showModal();
  // requestAnimationFrame så att autofocus funkar i Safari
  requestAnimationFrame(() => input.focus());

  const handleSubmit = async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const player = await addPlayer(input.value);
      dialog.close();
      onAdded?.(player);
    } catch (err) {
      errorEl.textContent = err.message ?? String(err);
    } finally {
      submitBtn.disabled = false;
    }
  };

  // Replace listener to avoid stacking
  form.onsubmit = handleSubmit;
}
