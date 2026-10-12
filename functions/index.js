// Pingis-stegens backend. Allt som skriver till Firestore går via de här
// callable-funktionerna — klienten har bara läsrättigheter (firestore.rules).

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions, logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';

initializeApp();
const db = getFirestore();

setGlobalOptions({ region: 'europe-west1', maxInstances: 5 });

// Sätts med: firebase functions:secrets:set SLACK_WEBHOOK_URL
const SLACK_WEBHOOK_URL = defineSecret('SLACK_WEBHOOK_URL');

const K_FACTOR = 32;
const START_RATING = 1000;
const UNDO_WINDOW_SEC = 300;
const LADDER_URL = 'https://christianarby.github.io/skippo-pingis-tour/';

// =====================================================================
// addPlayer: skapa en ny spelare med unikt namn
// =====================================================================

export const addPlayer = onCall(async (request) => {
  const name = String(request.data?.name ?? '').trim();
  if (!name) throw new HttpsError('invalid-argument', 'Namnet får inte vara tomt.');
  if (name.length > 40) throw new HttpsError('invalid-argument', 'Namnet får vara max 40 tecken.');

  const ref = db.collection('players').doc();
  const player = {
    name,
    rating: START_RATING,
    wins: 0,
    losses: 0,
    slack_id: null,
    avatar_url: null,
    created_at: Timestamp.now(),
  };

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(db.collection('players').where('name', '==', name).limit(1));
    if (!existing.empty) {
      throw new HttpsError('already-exists', `Det finns redan en spelare som heter "${name}".`);
    }
    tx.create(ref, player);
  });

  return { id: ref.id, ...player, created_at: player.created_at.toDate().toISOString() };
});

// =====================================================================
// reportMatch: räkna Elo och spara matchen atomiskt
// Transaktionen läser om båda spelarna, så två samtidiga rapporter inte
// korrumperar ratings (motsvarar radlåsen i den gamla Postgres-triggern).
// =====================================================================

export const reportMatch = onCall({ secrets: [SLACK_WEBHOOK_URL] }, async (request) => {
  const winnerId = String(request.data?.winnerId ?? '');
  const loserId = String(request.data?.loserId ?? '');
  if (!winnerId || !loserId) throw new HttpsError('invalid-argument', 'Välj båda spelarna först.');
  if (winnerId === loserId) throw new HttpsError('invalid-argument', 'Välj två olika spelare.');

  const winnerRef = db.collection('players').doc(winnerId);
  const loserRef = db.collection('players').doc(loserId);
  const matchRef = db.collection('matches').doc();

  const match = await db.runTransaction(async (tx) => {
    const [winnerSnap, loserSnap] = await tx.getAll(winnerRef, loserRef);
    if (!winnerSnap.exists) throw new HttpsError('not-found', `Vinnaren ${winnerId} finns inte`);
    if (!loserSnap.exists) throw new HttpsError('not-found', `Förloraren ${loserId} finns inte`);

    const winner = winnerSnap.data();
    const loser = loserSnap.data();
    const expectedWin = 1 / (1 + Math.pow(10, (loser.rating - winner.rating) / 400));
    const delta = Math.round(K_FACTOR * (1 - expectedWin));

    const m = {
      winner_id: winnerId,
      loser_id: loserId,
      winner_rating_before: winner.rating,
      loser_rating_before: loser.rating,
      winner_rating_after: winner.rating + delta,
      loser_rating_after: loser.rating - delta,
      played_at: Timestamp.now(),
    };

    tx.create(matchRef, m);
    tx.update(winnerRef, { rating: m.winner_rating_after, wins: (winner.wins ?? 0) + 1 });
    tx.update(loserRef, { rating: m.loser_rating_after, losses: (loser.losses ?? 0) + 1 });
    return { ...m, winner_name: winner.name, loser_name: loser.name };
  });

  // Slack-notisen får aldrig fälla själva rapporteringen
  try {
    await notifySlack(match);
  } catch (err) {
    logger.error('Slack-notis misslyckades', err);
  }

  const { winner_name, loser_name, ...stored } = match;
  return { id: matchRef.id, ...stored, played_at: stored.played_at.toDate().toISOString() };
});

// =====================================================================
// undoMatch: ångra senaste matchen
// Samma regler som tidigare:
//   * Bara den absolut senaste matchen kan ångras.
//   * Matchen får inte vara äldre än 5 minuter.
// =====================================================================

export const undoMatch = onCall(async (request) => {
  const matchId = String(request.data?.matchId ?? '');
  if (!matchId) throw new HttpsError('invalid-argument', 'matchId saknas');

  const matchRef = db.collection('matches').doc(matchId);

  await db.runTransaction(async (tx) => {
    const matchSnap = await tx.get(matchRef);
    if (!matchSnap.exists) throw new HttpsError('not-found', `Match ${matchId} finns inte`);
    const m = matchSnap.data();

    const ageSec = (Date.now() - m.played_at.toMillis()) / 1000;
    if (ageSec > UNDO_WINDOW_SEC) {
      throw new HttpsError(
        'failed-precondition',
        `Matchen är för gammal för att ångras (${Math.round(ageSec)} sekunder gammal, max ${UNDO_WINDOW_SEC})`
      );
    }

    const latest = await tx.get(db.collection('matches').orderBy('played_at', 'desc').limit(1));
    if (latest.empty || latest.docs[0].id !== matchId) {
      throw new HttpsError('failed-precondition', 'Bara den absolut senaste matchen kan ångras');
    }

    const winnerRef = db.collection('players').doc(m.winner_id);
    const loserRef = db.collection('players').doc(m.loser_id);
    const [winnerSnap, loserSnap] = await tx.getAll(winnerRef, loserRef);

    if (winnerSnap.exists) {
      tx.update(winnerRef, {
        rating: m.winner_rating_before,
        wins: Math.max((winnerSnap.data().wins ?? 0) - 1, 0),
      });
    }
    if (loserSnap.exists) {
      tx.update(loserRef, {
        rating: m.loser_rating_before,
        losses: Math.max((loserSnap.data().losses ?? 0) - 1, 0),
      });
    }
    tx.delete(matchRef);
  });

  return { ok: true };
});

// =====================================================================
// Slack-notis till #pingis
// =====================================================================

async function notifySlack(match) {
  const webhookUrl = SLACK_WEBHOOK_URL.value();
  if (!webhookUrl) return;

  const delta = match.winner_rating_after - match.winner_rating_before;

  const snap = await db.collection('players').get();
  const top5 = snap.docs
    .map((d) => d.data())
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, 'sv'))
    .slice(0, 5);
  const top5Text = top5.length
    ? top5.map((p, i) => `${i + 1}. *${p.name}* — ${p.rating} Elo  (${p.wins}V-${p.losses}F)`).join('\n')
    : '_(inga spelare ännu)_';

  const text =
    `🏓 *${match.winner_name}* def. *${match.loser_name}*  (+${delta} / −${delta} Elo)\n\n` +
    `*Aktuell topp 5*\n${top5Text}\n\n` +
    `<${LADDER_URL}|Se hela stegen>`;

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack svarade ${res.status}: ${await res.text()}`);
}
