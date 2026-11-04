// Klient-preview av Elo-delta. Den faktiska uträkningen sker i Cloud
// Functions (reportMatch i functions/index.js), så detta är bara för att visa
// "+12 / −12"-känsla innan rapportering.
//
// K-faktor och skalfaktor läses från settings/elo i Firestore (se app.js).
// Standardvärdena nedan måste matcha DEFAULT_* i functions/index.js.

export const DEFAULT_ELO_SETTINGS = Object.freeze({ k: 32, scale: 400 });

let current = { ...DEFAULT_ELO_SETTINGS };

export function getEloSettings() {
  return { ...current };
}

export function setEloSettings(data) {
  const k = Number.isFinite(data?.k) ? data.k : DEFAULT_ELO_SETTINGS.k;
  const scale = Number.isFinite(data?.scale) && data.scale > 0 ? data.scale : DEFAULT_ELO_SETTINGS.scale;
  current = { k, scale };
}

export function expectedScore(ratingA, ratingB, scale = current.scale) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / scale));
}

export function previewDelta(winnerRating, loserRating, settings = current) {
  const expected = expectedScore(winnerRating, loserRating, settings.scale);
  return Math.round(settings.k * (1 - expected));
}
