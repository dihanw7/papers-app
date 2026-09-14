import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env and fill in your Supabase project values.'
  );
}

export const supabase = createClient(url, anonKey);

// Students log in with a MED number, not an email. Supabase Auth requires an
// email address, so we map MED numbers to a synthetic, non-routable address.
// This never sends real mail — it's just used as Auth's unique identifier.
export function medNoToEmail(medNo) {
  return `${medNo.trim().toLowerCase()}@papers-app.com`;
}
