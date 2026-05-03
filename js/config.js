export const SUPABASE_URL = 'https://coefkjaznubmytkjtymn.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_qESYzhFnwJGGpH4ujKuKsw_KPjSYRgs';

export const APP_BUILD = '2026-05-03-2';
export const AUTH_STORAGE_VERSION = 'v2';

let supabaseClient = null;

function createMemoryStorage() {
  const store = new Map();

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
}

function getSafeStorage() {
  if (typeof window === 'undefined') {
    return createMemoryStorage();
  }

  try {
    const testKey = '__lk_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch (error) {
    console.warn('Local Storage nicht verfügbar, weiche auf Memory Storage aus.', error);
    return createMemoryStorage();
  }
}

function getStorageKey() {
  return `lernkontrollen-auth-${AUTH_STORAGE_VERSION}`;
}

export function validateSupabaseConfig() {
  return (
    !!SUPABASE_URL &&
    !!SUPABASE_ANON_KEY &&
    !SUPABASE_URL.startsWith('HIER_') &&
    !SUPABASE_ANON_KEY.startsWith('HIER_') &&
    !SUPABASE_ANON_KEY.startsWith('DEIN_')
  );
}

function buildSupabaseOptions() {
  return {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: getStorageKey(),
      storage: getSafeStorage()
    }
  };
}

export function getSupabaseClient() {
  if (!validateSupabaseConfig()) {
    throw new Error('Bitte zuerst Supabase-URL und Public Key eintragen.');
  }

  if (!window.supabase || !window.supabase.createClient) {
    throw new Error('Die Supabase-Bibliothek wurde nicht geladen.');
  }

  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      buildSupabaseOptions()
    );
  }

  return supabaseClient;
}

export async function refreshSupabaseSessionIfPossible() {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  if (data?.session) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw refreshError;
  }
}

export function clearLocalSupabaseState() {
  try {
    const storage = getSafeStorage();
    const storageKey = getStorageKey();

    storage.removeItem(storageKey);

    if (typeof window !== 'undefined' && window.localStorage) {
      const keysToRemove = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;

        if (
          key === storageKey ||
          key.startsWith('sb-') ||
          key.includes('supabase') ||
          key.includes('lernkontrollen-auth')
        ) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => window.localStorage.removeItem(key));
    }
  } catch (error) {
    console.warn('Lokaler Supabase-Status konnte nicht vollständig entfernt werden.', error);
  }

  resetSupabaseClient();
}

export function resetSupabaseClient() {
  supabaseClient = null;
}
