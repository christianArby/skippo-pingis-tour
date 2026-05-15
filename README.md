# 🏓 Pingisstegen

Kontorets pingisstege. Statisk frontend (HTML/CSS/JS) hostas på GitHub Pages, Supabase är backend för data + realtime.

- **Stege** med Elo-rating (start 1000, K=32)
- **Öppen rapportering** — vem som helst kan logga en match mellan vilka två spelare som helst
- **Live-uppdatering** via Supabase Realtime
- **Ingen bundler, ingen build** — bara push och kör

## Kom igång

### 1. Skapa Supabase-projekt

1. Gå till <https://supabase.com> → New project. Välj region nära kontoret.
2. När projektet är klart, gå till **Settings → API** och kopiera:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon public** API key

> Anon-nyckeln är säker att exponera publikt — RLS i `schema.sql` styr vad anonyma användare får göra.

### 2. Kör schemat

I Supabase Studio: **SQL Editor → New query** → klistra in innehållet i [`supabase/schema.sql`](supabase/schema.sql) → **Run**.

Det skapar tabellerna `players` och `matches`, Elo-triggern, RLS-policies och realtime-prenumeration.

### 3. Koppla appen till Supabase

Öppna [`index.html`](index.html) och byt ut värdena i `window.SUPABASE_CONFIG`:

```html
<script>
  window.SUPABASE_CONFIG = {
    url:     'https://your-project.supabase.co',
    anonKey: 'eyJhbGc...'
  };
</script>
```

(Se [`.env.example`](.env.example) för var värdena hör hemma.)

### 4. Kör lokalt

```bash
cd pingis-ladder
python3 -m http.server 8000
# eller: npx serve .
```

Öppna <http://localhost:8000>. Lägg till två spelare → rapportera en match → kolla att stegen och historiken uppdateras.

### 5. Deploya till GitHub Pages

1. Pusha repot till GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch** → välj `main` och `/` (root).
3. Vänta ~30 s. Appen ligger på `https://<user>.github.io/<repo>/`.

## Importera spelare från Slack

Stegen kan populeras automatiskt från Slack-workspacens medlemslista, med rätta förnamn och profilbilder.

### 1. Migrera schemat

Kör i Supabase SQL Editor:
```sql
alter table players add column if not exists slack_id text;
alter table players add column if not exists avatar_url text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'players_slack_id_key') then
    alter table players add constraint players_slack_id_key unique (slack_id);
  end if;
end $$;
```

### 2. Skapa Slack-app + token

1. Gå till <https://api.slack.com/apps> → **Create New App** → **From scratch**.
2. Namn: "Pingisstegen import". Workspace: din Skippo-workspace.
3. Vänster meny → **OAuth & Permissions** → under **Scopes → Bot Token Scopes** → **Add an OAuth Scope** → `users:read`.
4. Rulla upp → **Install to Workspace** → bekräfta.
5. Kopiera **Bot User OAuth Token** (börjar med `xoxb-`).

### 3. Hämta Supabase service role-nyckel

Supabase Studio → **Project Settings → API → service_role secret**. Aldrig lägg den i webbappen — bara lokalt för det här skriptet.

### 4. Kör importen

```bash
cd pingis-ladder
SLACK_BOT_TOKEN=xoxb-... \
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_SERVICE_ROLE=eyJ... \
node scripts/import-slack.mjs
```

Skriptet:
- Hämtar alla Slack-medlemmar (paginerat)
- Filtrerar bort bots, Slackbot, deaktiverade konton
- Föredrar förnamn (sedan display name, sedan real name)
- Upsertar på `slack_id` så omkörningar är säkra — befintliga ratings/wins/losses rörs inte
- Hanterar namnkonflikter med suffix (`Anna`, `Anna 2`, …)

Kör det igen när nya personer börjar.

## Slack-notiser i #pingis

När en match rapporteras postas resultatet + aktuell topp-5 till #pingis-kanalen i Slack — drivs av en `pg_net`-baserad trigger på `matches`-tabellen.

### Setup

1. https://api.slack.com/apps → din app → **Incoming Webhooks** → toggla **On** → **Add New Webhook to Workspace** → välj **#pingis** → kopiera webhook-URL.
2. I `supabase/schema.sql`, ersätt placeholder-URL:en `https://hooks.slack.com/services/REPLACE/WITH/YOUR_URL` i `notify_slack_match()`-funktionen.
3. Kör hela `schema.sql` (eller bara `notify_slack_match`-blocket) i Supabase SQL Editor.

Slack-meddelandet ser ut såhär:
```
🏓 Christian def. Felix  (+16 / −16 Elo)

Aktuell topp 5
1. Anna — 1287 Elo  (12V-3F)
2. Bosse — 1198 Elo  (10V-5F)
...
```

Ångrade matcher (via `undo_match` RPC) skickar ingen notis — triggern fyrar bara på INSERT.

## Hur Elo funkar

Vinnaren får poäng baserat på motståndarens rating:

```
expected_winner = 1 / (1 + 10^((loser_rating - winner_rating) / 400))
delta           = round(32 * (1 - expected_winner))
```

Med K=32: två jämna spelare → ~±16 per match. Stor underdog som vinner → kan få +30. Stor favorit som vinner → kanske bara +6.

Uträkningen körs i en Postgres-trigger (`update_elo_after_match`) med radlås, så två samtidiga rapporter inte korruperar ratings.

## Felrapporterad match? Trasig spelare?

Klienten får bara läsa och skapa. **Korrigeringar gör du manuellt i Supabase Studio:**

- **Byt namn på spelare**: `Table Editor → players → ändra name`.
- **Radera en felaktig match**: `Table Editor → matches → radera raden` (du måste sedan manuellt justera vinnaren/förlorarens rating/wins/losses, eftersom triggern bara körs vid insert).
- **Återställ allt**: `truncate matches; update players set rating=1000, wins=0, losses=0;` i SQL Editor.

## Filstruktur

```
pingis-ladder/
├── index.html               # Tre vyer, sätter window.SUPABASE_CONFIG
├── css/styles.css
├── js/
│   ├── config.js            # Läser window.SUPABASE_CONFIG
│   ├── supabase.js          # Skapar supabase-klienten (ESM från esm.sh)
│   ├── app.js               # Vy-router, realtime
│   ├── ladder.js
│   ├── report.js
│   ├── history.js
│   ├── players.js
│   └── elo.js               # Klient-preview av Elo-delta
├── supabase/schema.sql      # Tabeller, trigger, RLS, realtime, undo_match RPC
├── scripts/
│   └── import-slack.mjs     # Engångs-/ad-hoc-import av Slack-medlemmar
├── assets/skippo-logo.svg
└── .env.example             # Dokumentation (ej använd vid runtime)
```

## Stack

- HTML/CSS/Vanilla JS (ES modules)
- [`@supabase/supabase-js`](https://supabase.com/docs/reference/javascript) v2 via [esm.sh](https://esm.sh)
- Google Fonts: Bowlby One + Space Grotesk
- Postgres + Row Level Security + Realtime (Supabase)

---

Byggt på kontoret hos [Skippo](https://www.skippo.se) 🚤
