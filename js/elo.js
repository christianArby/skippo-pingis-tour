// Klient-preview av Elo-delta. Den faktiska uträkningen sker i Cloud
// Functions (reportMatch i functions/index.js), så detta är bara för att visa
// "+12 / −12"-känsla innan rapportering.

const K = 32;

export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function previewDelta(winnerRating, loserRating) {
  const expected = expectedScore(winnerRating, loserRating);
  return Math.round(K * (1 - expected));
}
