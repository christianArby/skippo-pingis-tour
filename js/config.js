const cfg = globalThis.FIREBASE_CONFIG;

if (!cfg || !cfg.apiKey || !cfg.projectId) {
  throw new Error(
    'FIREBASE_CONFIG saknas. Sätt window.FIREBASE_CONFIG i index.html ' +
    'med { apiKey, authDomain, projectId, appId } innan modulerna laddas.'
  );
}

export const FIREBASE_CONFIG = Object.freeze({ ...cfg });

// Samma region som functions/index.js
export const FUNCTIONS_REGION = 'europe-west1';
