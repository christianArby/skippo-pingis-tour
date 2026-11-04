// Rules-vyn: reglerna är statisk markup i index.html. Här renderas
// kortet för Elo-inställningar — alla kan testa värden och se vad de ger,
// men det krävs lösenord för att spara (kontrolleras i updateEloSettings).

import { updateEloSettings } from './firebase.js';
import { getEloSettings, previewDelta, expectedScore } from './elo.js';

const DIFFS = [0, 50, 100, 150, 200, 300, 400];
let bound = false;

export async function render() {
  bindOnce();
  syncFromCurrent();
}

// Anropas från app.js när settings/elo ändras i Firestore.
export function onSettingsChanged() {
  const { k } = getEloSettings();
  const rule = document.getElementById('rule-even-delta');
  if (rule) rule.textContent = `±${previewDelta(1000, 1000)} poäng`;
  setText('elo-current-k', k);
  setText('elo-current-scale', getEloSettings().scale);
  // Skriv bara över testfälten om användaren inte håller på att ändra dem.
  if (!isEditing()) syncFromCurrent();
  else renderTable();
}

function bindOnce() {
  if (bound) return;
  const form = document.getElementById('elo-form');
  if (!form) return;
  bound = true;

  for (const id of ['elo-k', 'elo-scale']) {
    document.getElementById(id).addEventListener('input', renderTable);
  }
  document.getElementById('elo-reset').addEventListener('click', () => {
    syncFromCurrent();
    setStatus('', '');
  });
  form.addEventListener('submit', onSave);
}

function syncFromCurrent() {
  const { k, scale } = getEloSettings();
  const kInput = document.getElementById('elo-k');
  const scaleInput = document.getElementById('elo-scale');
  if (!kInput || !scaleInput) return;
  kInput.value = k;
  scaleInput.value = scale;
  setText('elo-current-k', k);
  setText('elo-current-scale', scale);
  renderTable();
}

function isEditing() {
  const { k, scale } = getEloSettings();
  const t = readInputs();
  return t !== null && (t.k !== k || t.scale !== scale);
}

function readInputs() {
  const k = Number(document.getElementById('elo-k')?.value);
  const scale = Number(document.getElementById('elo-scale')?.value);
  if (!Number.isInteger(k) || k < 1 || k > 200) return null;
  if (!Number.isInteger(scale) || scale < 50 || scale > 2000) return null;
  return { k, scale };
}

function renderTable() {
  const body = document.getElementById('elo-table-body');
  const note = document.getElementById('elo-diff-note');
  if (!body) return;

  const test = readInputs();
  if (!test) {
    body.innerHTML = `<tr><td colspan="4" class="elo-invalid">Ange K mellan 1 och 200 och skalfaktor mellan 50 och 2000.</td></tr>`;
    if (note) note.hidden = true;
    return;
  }

  const current = getEloSettings();
  const differs = test.k !== current.k || test.scale !== current.scale;
  if (note) note.hidden = !differs;

  body.innerHTML = DIFFS.map((d) => {
    const fav = 1000 + d;
    const dog = 1000;
    const chance = Math.round(expectedScore(fav, dog, test.scale) * 100);
    const favWin = previewDelta(fav, dog, test);
    const dogWin = previewDelta(dog, fav, test);
    const cell = (value, now) => differs
      ? `+${value} <span class="elo-was">(${now >= 0 ? '+' : ''}${now})</span>`
      : `+${value}`;
    return `<tr>
      <td>${d}</td>
      <td>${chance} %</td>
      <td>${cell(favWin, previewDelta(fav, dog, current))}</td>
      <td>${cell(dogWin, previewDelta(dog, fav, current))}</td>
    </tr>`;
  }).join('');
}

async function onSave(event) {
  event.preventDefault();
  const test = readInputs();
  if (!test) {
    setStatus('Ogiltiga värden.', 'error');
    return;
  }
  const passwordInput = document.getElementById('elo-password');
  const password = passwordInput.value;
  if (!password) {
    setStatus('Ange lösenordet för att spara.', 'error');
    passwordInput.focus();
    return;
  }

  const btn = document.getElementById('elo-save');
  btn.disabled = true;
  setStatus('Sparar…', '');
  try {
    await updateEloSettings(password, test.k, test.scale);
    passwordInput.value = '';
    setStatus(`Sparat. K = ${test.k}, skalfaktor = ${test.scale} gäller från nästa match.`, 'success');
  } catch (err) {
    setStatus(err?.message || 'Kunde inte spara.', 'error');
  } finally {
    btn.disabled = false;
  }
}

function setStatus(text, tone) {
  const el = document.getElementById('elo-status');
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}
