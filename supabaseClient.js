const SUPABASE_URL = 'https://iuvkbvfgrpxcjunizlde.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mUAmcG1Bwv9KctqTcfLdqw_W0fbmX6S';

// The publishable key is safe to expose; RLS and RPC grants enforce authority.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'capycoins-auth'
  }
});
