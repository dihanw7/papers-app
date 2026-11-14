import { supabase, medNoToEmail } from '../supabaseClient.js';

// ---------- AUTH ----------
export async function signUp({ name, group, medNo, password, batch }) {
  const email = medNoToEmail(medNo);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, group, med_no: medNo.toUpperCase(), batch } },
  });
  if (error) throw error;
  // If email confirmation is enabled in the Supabase project, data.session
  // will be null here. See README: turn "Confirm email" off for this app.
  return data;
}

export async function logIn({ medNo, password }) {
  const email = medNoToEmail(medNo);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function logOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// The signed-in user's profile, shaped as state.currentUser.
export async function fetchCurrentUser(userId) {
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return { id: profile.id, name: profile.name, group: profile.group, medNo: profile.med_no, role: profile.role, batch: profile.batch };
}
