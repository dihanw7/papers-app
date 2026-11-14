import { supabase } from '../supabaseClient.js';

// ---------- SETTINGS (drives sign-up form dropdowns) ----------
export async function fetchSettings() {
  const { data, error } = await supabase.from('app_settings').select('groups, batches').eq('id', true).single();
  if (error) throw error;
  return { groups: data.groups || [], batches: data.batches || [] };
}

export async function updateSettings({ groups, batches }) {
  const { error } = await supabase.from('app_settings').update({ groups, batches }).eq('id', true);
  if (error) throw error;
}
