import { supabase } from './supabase.js';

let cachedPlayers = null;

export async function getPlayers({ forceRefresh = false } = {}) {
  if (cachedPlayers && !forceRefresh) return cachedPlayers;
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .order('rating', { ascending: false });
  if (error) throw error;
  cachedPlayers = data ?? [];
  return cachedPlayers;
}

export function invalidatePlayerCache() {
  cachedPlayers = null;
}

export async function addPlayer(name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Namnet får inte vara tomt.');
  if (trimmed.length > 40) throw new Error('Namnet får vara max 40 tecken.');

  const { data, error } = await supabase
    .from('players')
    .insert({ name: trimmed })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(`Det finns redan en spelare som heter "${trimmed}".`);
    }
    throw error;
  }
  invalidatePlayerCache();
  return data;
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
