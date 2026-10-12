import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getFirestore, collection, query, orderBy, limit, getDocs, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getFunctions, httpsCallable,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';
import { FIREBASE_CONFIG, FUNCTIONS_REGION } from './config.js';

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const functions = getFunctions(app, FUNCTIONS_REGION);

// ---------- Läsning ----------

function toPlayer(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    ...d,
    created_at: d.created_at?.toDate?.().toISOString() ?? null,
  };
}

function toMatch(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    ...d,
    played_at: d.played_at?.toDate?.().toISOString() ?? null,
  };
}

// Sorterat på rating (högst först), sen namn
export async function fetchPlayers() {
  const snap = await getDocs(collection(db, 'players'));
  return snap.docs
    .map(toPlayer)
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, 'sv'));
}

export async function fetchRecentMatches(max) {
  const snap = await getDocs(
    query(collection(db, 'matches'), orderBy('played_at', 'desc'), limit(max))
  );
  return snap.docs.map(toMatch);
}

// ---------- Skrivning (via Cloud Functions) ----------

async function call(name, data) {
  const res = await httpsCallable(functions, name)(data);
  return res.data;
}

export const addPlayer   = (name)               => call('addPlayer',   { name });
export const reportMatch = (winnerId, loserId)  => call('reportMatch', { winnerId, loserId });
export const undoMatch   = (matchId)            => call('undoMatch',   { matchId });

// ---------- Realtime ----------

// onSnapshot levererar alltid nuvarande data direkt vid start — den
// första leveransen hoppas över så bara faktiska ändringar triggar.
function onChange(ref, callback) {
  let first = true;
  return onSnapshot(ref, () => {
    if (first) { first = false; return; }
    callback();
  }, (err) => console.error('Realtime-fel:', err));
}

export function subscribePlayers(callback) {
  return onChange(collection(db, 'players'), callback);
}

export function subscribeMatches(callback) {
  return onChange(query(collection(db, 'matches'), orderBy('played_at', 'desc'), limit(50)), callback);
}
