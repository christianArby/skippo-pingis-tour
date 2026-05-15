const cfg = globalThis.SUPABASE_CONFIG;

if (!cfg || !cfg.url || !cfg.anonKey) {
  throw new Error(
    'SUPABASE_CONFIG saknas. Sätt window.SUPABASE_CONFIG i index.html ' +
    'med { url, anonKey } innan modulerna laddas.'
  );
}

if (cfg.url.includes('your-project') || cfg.anonKey.startsWith('eyJhbGc...')) {
  throw new Error(
    'SUPABASE_CONFIG innehåller placeholder-värden. ' +
    'Byt ut url och anonKey i index.html mot dina riktiga Supabase-värden.'
  );
}

export const SUPABASE_CONFIG = Object.freeze({
  url: cfg.url,
  anonKey: cfg.anonKey,
});
