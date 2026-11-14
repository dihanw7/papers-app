import { supabase } from '../supabaseClient.js';

// ---------- MEMBERS (admin only; checked again in the database) ----------
export async function fetchMembers() {
  const { data, error } = await supabase.rpc('admin_list_members');
  if (error) throw error;
  return data.map((m) => ({
    id: m.id,
    name: m.name,
    group: m.group,
    batch: m.batch,
    medNo: m.med_no,
    role: m.role,
    createdAt: m.created_at,
    lastSignInAt: m.last_sign_in_at,
    attemptCount: m.attempt_count,
  }));
}

export async function updateMember(id, { name, group, batch, role }) {
  const { error } = await supabase.rpc('admin_update_member', { uid: id, p_name: name, p_group: group, p_batch: batch, p_role: role });
  if (error) throw error;
}

export async function setMemberPassword(id, password) {
  const { error } = await supabase.rpc('admin_set_password', { uid: id, new_password: password });
  if (error) throw error;
}

export async function deleteMember(id) {
  const { error } = await supabase.rpc('admin_delete_member', { uid: id });
  if (error) throw error;
}

