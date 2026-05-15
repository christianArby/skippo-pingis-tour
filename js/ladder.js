import { supabase } from './supabase.js';
import { invalidatePlayerCache } from './players.js';

export async function render() {
  const root = document.getElementById('ladder-list');
  const empty = document.getElementById('ladder-empty');
  if (!root) return;

  invalidatePlayerCache();
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .order('rating', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    root.innerHTML = `<li class="error-row">Kunde inte hämta stegen: ${escapeHtml(error.message)}</li>`;
    empty.hidden = true;
    return;
  }

  if (!data || data.length === 0) {
    root.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  root.innerHTML = data.map((p, i) => renderRow(p, i)).join('');
}

function renderRow(p, idx) {
  const rank = idx + 1;
  const total = p.wins + p.losses;
  const winrate = total > 0 ? Math.round((p.wins / total) * 100) + '%' : '–';
  const topClass = idx === 0 ? ' ladder-row--top-1' : '';

  return `
    <li class="ladder-row${topClass}">
      <span class="ladder-rank">${rank}</span>
      <span class="ladder-name">
        ${renderAvatar(p)}
        <span>${escapeHtml(p.name)}</span>
      </span>
      <span class="ladder-wins">${p.wins}</span>
      <span class="ladder-losses">${p.losses}</span>
      <span class="ladder-winrate col-winrate">${winrate}</span>
      <span class="ladder-rating">${p.rating}</span>
    </li>`;
}

function renderAvatar(p) {
  const initials = getInitials(p.name);
  const img = p.avatar_url
    ? `<img src="${escapeHtml(p.avatar_url)}" alt="" loading="lazy" onerror="this.remove()" />`
    : '';
  return `<span class="ladder-avatar" aria-hidden="true">
    <span class="ladder-avatar-fallback">${escapeHtml(initials)}</span>${img}
  </span>`;
}

function getInitials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
