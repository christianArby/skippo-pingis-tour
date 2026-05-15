import { supabase } from './supabase.js';

const HISTORY_LIMIT = 50;

export async function render() {
  const root = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  if (!root) return;

  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, played_at,
      winner_rating_before, winner_rating_after,
      loser_rating_before,  loser_rating_after,
      winner:players!matches_winner_id_fkey ( id, name, avatar_url ),
      loser:players!matches_loser_id_fkey   ( id, name, avatar_url )
    `)
    .order('played_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) {
    root.innerHTML = `<li class="error-row">Kunde inte hämta historik: ${escapeHtml(error.message)}</li>`;
    empty.hidden = true;
    return;
  }
  if (!data || data.length === 0) {
    root.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  root.innerHTML = data.map(renderMatch).join('');
}

function renderMatch(m) {
  const winnerDelta = m.winner_rating_after - m.winner_rating_before;
  const loserDelta = m.loser_rating_after - m.loser_rating_before;
  const time = formatRelative(new Date(m.played_at));
  const winnerName = m.winner?.name ?? '(borttagen)';
  const loserName = m.loser?.name ?? '(borttagen)';
  return `
    <li class="history-row">
      <span class="history-result">
        ${renderHistoryAvatar(m.winner, winnerName)}
        <strong class="history-winner">${escapeHtml(winnerName)}</strong>
        <span class="history-vs">slog</span>
        ${renderHistoryAvatar(m.loser, loserName)}
        <span class="history-loser">${escapeHtml(loserName)}</span>
      </span>
      <span class="history-delta">
        <span class="delta-pos">+${winnerDelta}</span>
        <span class="delta-sep">/</span>
        <span class="delta-neg">${loserDelta}</span>
      </span>
      <time class="history-time" datetime="${m.played_at}" title="${new Date(m.played_at).toLocaleString('sv-SE')}">${time}</time>
    </li>`;
}

function renderHistoryAvatar(player, name) {
  const initials = getInitials(name);
  const img = player?.avatar_url
    ? `<img src="${escapeHtml(player.avatar_url)}" alt="" loading="lazy" onerror="this.remove()" />`
    : '';
  return `<span class="history-avatar" aria-hidden="true">
    <span class="history-avatar-fallback">${escapeHtml(initials)}</span>${img}
  </span>`;
}

function getInitials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelative(date) {
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return 'nyss';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min sedan`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h sedan`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} d sedan`;
  return date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
