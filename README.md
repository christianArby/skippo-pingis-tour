# 🏓 Pingisstegen

Kontorets pingisstege. Statisk frontend (HTML/CSS/JS) hostas på GitHub Pages, Firebase (Firestore + Cloud Functions) är backend.

- **Stege** med Elo-rating (start 1000, K=32)
- **Öppen rapportering** — vem som helst kan logga en match mellan vilka två spelare som helst
- **Live-uppdatering** via Firestore-snapshots
- **Ingen bundler, ingen build** — bara push och kör

## Arkitektur

- **Firestore** (`europe-west1`) har två samlingar, `players` och `matches`. Klienten får bara *läsa* (`firestore.rules`).
- **Cloud Functions** (`functions/index.js`, `europe-west1`) står för alla skrivningar:
  - `addPlayer` — ny spelare med unikt namn
  - `reportMatch` — räknar Elo i en transaktion, sparar matchen och postar till Slack
  - `undoMatch` — ångrar senaste matchen (max 5 min gammal)
- Cloud Functions kräver **Blaze-planen** (pay-as-you-go). Med kontorsvolymer kostar det i praktiken 0 kr.

## Kom igång

Firebase-projektet är `pingis-ladder-fca5b` (se `.firebaserc`). Webbappens config ligger i `window.FIREBASE_CONFIG` i [`index.html`](index.html) — den är publik, åtkomsten styrs av rules.

### Deploya backend

```bash
cd functions && npm install && cd ..
firebase functions:secrets:set SLACK_WEBHOOK_URL   # Slack Incoming Webhook för #pingis
firebase deploy --only firestore,functions
```

### Kör lokalt

```bash
python3 -m http.server 8000
```

Öppna <http://localhost:8000>. Lokalt pratar sidan med produktionsdatabasen. För att testa backend-ändringar, kör `firebase emulators:start --only functions,firestore` (lägg en dummy-webhook i `functions/.secret.local`).

### Deploya frontend till GitHub Pages

1. Pusha repot till GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch** → välj `main` och `/` (root).

## Importera spelare från Slack

Stegen kan populeras från Slack-workspacens medlemslista, med förnamn och profilbilder.

1. Slack-app med Bot Token Scope `users:read`, installerad i workspacen → kopiera **Bot User OAuth Token** (`xoxb-…`).
2. Firebase-konsolen → **Project settings → Service accounts → Generate new private key**. Spara utanför repot.
3. Kör:

```bash
(cd functions && npm install)
SLACK_BOT_TOKEN=xoxb-... \
GOOGLE_APPLICATION_CREDENTIALS=~/pingis-sa.json \
node scripts/import-slack.mjs
```

Skriptet upsertar på `slack_id` (ratings/wins/losses rörs inte) och suffixar dubblettnamn (`Anna`, `Anna 2`, …). Kör det igen när nya personer börjar.

## Slack-notiser i #pingis

När en match rapporteras postar `reportMatch` resultatet + aktuell topp-5 till #pingis via webhooken i secret `SLACK_WEBHOOK_URL`. Ett Slack-fel loggas men stoppar aldrig själva rapporteringen. Ångrade matcher skickar ingen notis.

```
🏓 Christian def. Felix  (+16 / −16 Elo)

Aktuell topp 5
1. Anna — 1287 Elo  (12V-3F)
2. Bosse — 1198 Elo  (10V-5F)
...
```

## Hur Elo funkar

Vinnaren får poäng baserat på motståndarens rating:

```
expected_winner = 1 / (1 + 10^((loser_rating - winner_rating) / 400))
delta           = round(32 * (1 - expected_winner))
```

Med K=32: två jämna spelare → ~±16 per match. Stor underdog som vinner → kan få +30. Stor favorit som vinner → kanske bara +6.

Uträkningen körs i `reportMatch` i en Firestore-transaktion, så två samtidiga rapporter inte korrumperar ratings.

## Felrapporterad match? Trasig spelare?

Klienten får bara läsa. **Korrigeringar gör du manuellt i Firebase-konsolen → Firestore:**

- **Byt namn på spelare**: ändra `name` på dokumentet i `players`.
- **Radera en felaktig match**: radera dokumentet i `matches` och justera vinnarens/förlorarens `rating`/`wins`/`losses` för hand.

## Filstruktur

```
pingis-ladder/
├── index.html               # Vyer, sätter window.FIREBASE_CONFIG
├── css/styles.css
├── js/
│   ├── config.js            # Läser window.FIREBASE_CONFIG
│   ├── firebase.js          # Firestore-läsning, callables, realtime (ESM från gstatic)
│   ├── app.js               # Vy-router, realtime
│   ├── ladder.js / report.js / history.js / players.js / rules.js
│   └── elo.js               # Klient-preview av Elo-delta
├── functions/index.js       # addPlayer, reportMatch, undoMatch, Slack-notis
├── firestore.rules          # Publik läsning, inga klient-skrivningar
├── firebase.json / .firebaserc
├── scripts/import-slack.mjs # Ad-hoc-import av Slack-medlemmar
└── assets/skippo-logo.svg
```

## Stack

- HTML/CSS/Vanilla JS (ES modules)
- Firebase JS SDK v10 via gstatic CDN
- Firestore + Cloud Functions (Node 22)

---

Byggt på kontoret hos [Skippo](https://www.skippo.se) 🚤
