import { supabase } from './supabase.js';
import * as ladder from './ladder.js';
import * as report from './report.js';
import * as historyView from './history.js';
import * as rulesView from './rules.js';
import { openAddPlayerDialog, invalidatePlayerCache } from './players.js';

const VIEWS = {
  ladder:  { render: ladder.render,      section: 'view-ladder',  tab: 'tab-ladder' },
  history: { render: historyView.render, section: 'view-history', tab: 'tab-history' },
  rules:   { render: rulesView.render,   section: 'view-rules',   tab: 'tab-rules' },
};

function currentView() {
  const hash = location.hash.replace('#', '');
  return VIEWS[hash] ? hash : 'ladder';
}

async function showView(name) {
  for (const [key, view] of Object.entries(VIEWS)) {
    const section = document.getElementById(view.section);
    const tab = document.getElementById(view.tab);
    const active = key === name;
    if (section) section.hidden = !active;
    if (tab) tab.classList.toggle('tab--active', active);
  }
  try {
    await VIEWS[name].render();
  } catch (err) {
    console.error(`Render error in ${name}:`, err);
  }
}

function isReportDialogOpen() {
  const d = document.getElementById('report-dialog');
  return !!(d && d.open);
}

async function openReportDialog() {
  const d = document.getElementById('report-dialog');
  if (!d) return;
  await report.render();
  if (!d.open) d.showModal();
}

function bindGlobalUI() {
  // + Ny spelare
  for (const btn of document.querySelectorAll('[data-action="add-player"]')) {
    btn.addEventListener('click', () => {
      openAddPlayerDialog({
        onAdded: async () => {
          invalidatePlayerCache();
          if (isReportDialogOpen()) await report.render();
          await showView(currentView());
        },
      });
    });
  }

  // 🏓 Rapportera match
  for (const btn of document.querySelectorAll('[data-action="report-match"]')) {
    btn.addEventListener('click', () => openReportDialog());
  }

  // Stäng-knappen i report-dialogen
  document.getElementById('report-close')?.addEventListener('click', () => {
    document.getElementById('report-dialog')?.close();
  });

  // Stäng-knappen i add-player-dialogen
  const addPlayerDialog = document.getElementById('add-player-dialog');
  const cancelBtn = document.getElementById('add-player-cancel');
  if (cancelBtn && addPlayerDialog) {
    cancelBtn.addEventListener('click', () => addPlayerDialog.close());
  }
}

function subscribeRealtime() {
  const channel = supabase.channel('pingis-ladder-live');

  channel
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'players' },
        () => {
          invalidatePlayerCache();
          const view = currentView();
          if (view === 'ladder') VIEWS[view].render();
          if (isReportDialogOpen()) report.render();
        })
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => {
          invalidatePlayerCache();
          const view = currentView();
          if (view === 'ladder' || view === 'history') VIEWS[view].render();
        })
    .subscribe();
}

async function boot() {
  if (!location.hash) location.hash = 'ladder';

  bindGlobalUI();
  subscribeRealtime();

  window.addEventListener('hashchange', () => showView(currentView()));
  await showView(currentView());
}

if (typeof HTMLDialogElement === 'undefined') {
  console.warn('<dialog> stöds inte i denna browser; modaler funkar inte.');
}

boot().catch((err) => {
  console.error('Boot failed:', err);
  const banner = document.getElementById('boot-error');
  if (banner) {
    banner.hidden = false;
    banner.textContent = `Uppstart misslyckades: ${err.message ?? err}`;
  }
});
