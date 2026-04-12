export const SUPABASE_URL = 'https://coefkjaznubmytkjtymn.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvZWZramF6bnVibXl0a2p0eW1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTcyMzQsImV4cCI6MjA5MDczMzIzNH0.PG7SBMz02PiqaUw6kjMz0uB1Y3KpcvHqFkvVToGNiak';

let supabaseClient = null;

export function validateSupabaseConfig() {
  return !SUPABASE_URL.startsWith('HIER_') && !SUPABASE_ANON_KEY.startsWith('HIER_');
}

export function getSupabaseClient() {
  if (!validateSupabaseConfig()) {
    throw new Error('Bitte zuerst Supabase-URL und Public Key eintragen.');
  }
  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}
