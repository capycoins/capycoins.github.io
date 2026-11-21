const SUPABASE_URL = 'https://iuvkbvfgrpxcjunizlde.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mUAmcG1Bwv9KctqTcfLdqw_W0fbmX6S';

// This creates the connection to your Supabase project
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);