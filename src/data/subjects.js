import { supabase } from '../supabaseClient.js';

// ---------- SUBJECTS ----------
export async function fetchSubjects() {
  const { data, error } = await supabase.from('subjects').select('*').order('name');
  if (error) throw error;
  return data.map((s) => ({ ...s, iconSvg: s.icon_svg || null }));
}

export async function createSubject(name, iconSvg) {
  const row = iconSvg ? { name, icon_svg: iconSvg } : { name };
  const { data, error } = await supabase.from('subjects').insert(row).select().single();
  if (error) throw error;
  return data;
}

// iconSvg null removes the custom icon (the subject falls back to a built-in one).
export async function setSubjectIcon(subjectId, iconSvg) {
  const { error } = await supabase.from('subjects').update({ icon_svg: iconSvg }).eq('id', subjectId);
  if (error) throw error;
}


export async function deleteSubject(subjectId) {
  const { error } = await supabase.from('subjects').delete().eq('id', subjectId);
  if (error) throw error;
}
