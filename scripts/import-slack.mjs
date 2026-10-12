#!/usr/bin/env node
// Importera Slack-användare → Firestore players-samlingen.
//
// Krav:
//   - Node 18+ (för inbyggd fetch)
//   - `npm install` i functions/ (skriptet lånar firebase-admin därifrån)
//   - SLACK_BOT_TOKEN  — Bot User OAuth Token från api.slack.com (scope: users:read)
//   - GOOGLE_APPLICATION_CREDENTIALS — sökväg till en service account-nyckel
//     (Firebase-konsolen → Project settings → Service accounts → Generate new
//     private key). NEVER committa den; bara lokalt!
//
// Kör:
//   SLACK_BOT_TOKEN=xoxb-... \
//   GOOGLE_APPLICATION_CREDENTIALS=~/pingis-sa.json \
//   node scripts/import-slack.mjs
//
// Skriptet är idempotent: kör så ofta du vill, befintliga spelare
// uppdateras på slack_id-matchning.

import { createRequire } from 'node:module';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const SLACK_TOKEN  = process.env.SLACK_BOT_TOKEN;
const PROJECT_ID   = process.env.FIREBASE_PROJECT_ID ?? 'pingis-ladder-fca5b';

if (!SLACK_TOKEN || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Saknar env-variabler. Se kommentaren högst upp.');
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

const PAGE_SIZE = 200;

// ---------- Hämta Slack-användare ----------

async function fetchAllSlackUsers() {
  const all = [];
  let cursor = '';
  let page = 0;
  do {
    page++;
    const url = new URL('https://slack.com/api/users.list');
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
    });
    const json = await res.json();
    if (!json.ok) {
      throw new Error(`Slack API-fel: ${json.error}`);
    }
    all.push(...json.members);
    cursor = json.response_metadata?.next_cursor ?? '';
    console.log(`Slack-sida ${page}: ${json.members.length} medlemmar (totalt ${all.length})`);
  } while (cursor);
  return all;
}

// ---------- Filter: bara aktiva människor ----------

function isHumanUser(u) {
  if (u.deleted) return false;
  if (u.is_bot) return false;
  if (u.is_app_user) return false;
  if (u.id === 'USLACKBOT') return false;
  // Workflow Builder, integrationer etc. har is_bot=true så de fångas ovan,
  // men vissa workflows kan vara is_app_user. Båda filtreras.
  return true;
}

// ---------- Mappa till players-rader ----------

function pickName(u) {
  const p = u.profile ?? {};
  const candidates = [
    p.first_name,
    p.display_name_normalized,
    p.display_name,
    p.real_name_normalized,
    p.real_name,
    u.real_name,
    u.name,
  ];
  for (const c of candidates) {
    if (typeof c === 'string') {
      const trimmed = c.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function pickAvatar(u) {
  const p = u.profile ?? {};
  return p.image_192 || p.image_72 || p.image_512 || p.image_original || null;
}

function toPlayerRow(u) {
  const name = pickName(u);
  if (!name) return null;
  return {
    slack_id:   u.id,
    name,
    avatar_url: pickAvatar(u),
  };
}

// ---------- Upsert till Firestore ----------

async function upsertPlayer(row) {
  const existing = await db.collection('players').where('slack_id', '==', row.slack_id).limit(1).get();
  if (!existing.empty) {
    // Bara uppdatera dessa fält — rör inte rating/wins/losses
    await existing.docs[0].ref.update({ name: row.name, avatar_url: row.avatar_url });
    return;
  }
  await db.collection('players').add({
    ...row,
    rating: 1000,
    wins: 0,
    losses: 0,
    created_at: Timestamp.now(),
  });
}

// Hantera namnkonflikter: om en player redan finns med samma namn men annat
// slack_id (eller utan slack_id), suffixa Slack-importens namn så vi inte
// får två spelare med samma namn.
async function fetchExistingNames() {
  const snap = await db.collection('players').get();
  return snap.docs.map((d) => ({ name: d.get('name'), slack_id: d.get('slack_id') ?? null }));
}

function dedupeNames(rows, existing) {
  const taken = new Map(); // lowercase-name -> slack_id (eller null)
  for (const e of existing) {
    if (e.name) taken.set(e.name.toLowerCase(), e.slack_id ?? null);
  }
  for (const r of rows) {
    let candidate = r.name;
    let suffix = 1;
    while (true) {
      const lower = candidate.toLowerCase();
      const owner = taken.get(lower);
      if (!owner || owner === r.slack_id) {
        r.name = candidate;
        taken.set(lower, r.slack_id);
        break;
      }
      suffix++;
      // "Anna" → "Anna 2", "Anna 3" ...
      candidate = `${r.name} ${suffix}`;
    }
  }
  return rows;
}

// ---------- Main ----------

async function main() {
  console.log('Hämtar Slack-användare…');
  const members = await fetchAllSlackUsers();
  const humans  = members.filter(isHumanUser);
  console.log(`Av ${members.length} totalt: ${humans.length} aktiva människor`);

  const rows = humans.map(toPlayerRow).filter(Boolean);

  console.log('Hämtar befintliga spelare för dubblett-koll…');
  const existing = await fetchExistingNames();

  const finalRows = dedupeNames(rows, existing);

  console.log(`Upsertar ${finalRows.length} spelare…`);
  let ok = 0, fail = 0;
  for (const row of finalRows) {
    try {
      await upsertPlayer(row);
      console.log(`  ✓ ${row.name}  (${row.slack_id})`);
      ok++;
    } catch (err) {
      console.error(`  ✗ ${row.name}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\nKlart. ${ok} lyckade, ${fail} misslyckade.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
