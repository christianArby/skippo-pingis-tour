#!/usr/bin/env node
// Importera Slack-användare → Supabase players-tabellen.
//
// Krav:
//   - Node 18+ (för inbyggd fetch)
//   - SLACK_BOT_TOKEN  — Bot User OAuth Token från api.slack.com (scope: users:read)
//   - SUPABASE_URL     — t.ex. https://xxxx.supabase.co
//   - SUPABASE_SERVICE_ROLE — service role key (NEVER bundla i webbappen; bara lokalt!)
//
// Kör:
//   SLACK_BOT_TOKEN=xoxb-... \
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE=eyJ... \
//   node scripts/import-slack.mjs
//
// Skriptet är idempotent: kör så ofta du vill, befintliga spelare
// uppdateras på slack_id-matchning.

const SLACK_TOKEN  = process.env.SLACK_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE;

if (!SLACK_TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
  console.error('Saknar env-variabler. Se kommentaren högst upp.');
  process.exit(1);
}

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

// ---------- Upsert till Supabase ----------

async function upsertPlayer(row) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/players`);
  url.searchParams.set('on_conflict', 'slack_id');
  // Bara uppdatera dessa fält vid konflikt — rör inte rating/wins/losses
  url.searchParams.set('columns', 'slack_id,name,avatar_url');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
}

// Hantera namnkonflikter: om en player redan finns med samma namn men annat
// slack_id (eller utan slack_id), suffixa Slack-importens namn så vi inte
// kraschar på players.name unique-constraint.
async function fetchExistingNames() {
  const url = new URL(`${SUPABASE_URL}/rest/v1/players`);
  url.searchParams.set('select', 'name,slack_id');
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Kunde inte hämta befintliga spelare: ${res.status}`);
  return res.json();
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
