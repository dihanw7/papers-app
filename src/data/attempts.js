import { supabase } from '../supabaseClient.js';
import { isMissingFn } from './util.js';

// ---------- SUBMITTED ATTEMPTS: summaries ----------
// Which of these papers has this user already submitted? (for "Completed" badges)
export async function fetchMyAttemptedPaperIds(userId, paperIds) {
  if (!paperIds.length) return [];
  const { data, error } = await supabase
    .from('attempts')
    .select('paper_id')
    .eq('user_id', userId)
    .in('paper_id', paperIds);
  if (error) throw error;
  return data.map((r) => r.paper_id);
}

export async function countAttempts(paperId) {
  const { count, error } = await supabase
    .from('attempts')
    .select('id', { count: 'exact', head: true })
    .eq('paper_id', paperId);
  if (error) throw error;
  return count || 0;
}

// ---------- DRAFT ATTEMPTS (autosave) ----------
export async function fetchDraft(paperId, userId) {
  const { data, error } = await supabase
    .from('draft_attempts')
    .select('*')
    .eq('paper_id', paperId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Records when this student started (server clock) the first time they open
// the paper. Returns { startedAt, serverNow, answers }, or null if the
// database doesn't have start_attempt() yet.
export async function startAttempt(paperId) {
  const { data, error } = await supabase.rpc('start_attempt', { pid: paperId });
  if (error) {
    if (isMissingFn(error)) return null;
    throw error;
  }
  return { startedAt: data.started_at, serverNow: data.server_now, answers: data.answers || {} };
}

export async function saveDraft(paperId, userId, answers) {
  const { error: rpcErr } = await supabase.rpc('save_draft', { pid: paperId, p_answers: answers });
  if (!rpcErr) return;
  if (!isMissingFn(rpcErr)) throw rpcErr;
  const { error } = await supabase
    .from('draft_attempts')
    .upsert({ paper_id: paperId, user_id: userId, answers, updated_at: new Date().toISOString() }, { onConflict: 'paper_id,user_id' });
  if (error) throw error;
}

export async function deleteDraft(paperId, userId) {
  const { error } = await supabase.from('draft_attempts').delete().eq('paper_id', paperId).eq('user_id', userId);
  if (error) throw error;
}

// ---------- ATTEMPTS ----------
export async function fetchMyAttempt(paperId, userId) {
  const { data, error } = await supabase
    .from('attempts')
    .select('*')
    .eq('paper_id', paperId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// The database marks the answers (submit_attempt). score/total are only used
// by the fallback for databases that don't have that function yet.
export async function submitAttempt({ paperId, userId, answers, score, total }) {
  const { data: marked, error: rpcErr } = await supabase.rpc('submit_attempt', { pid: paperId, p_answers: answers });
  if (!rpcErr) return marked;
  if (!isMissingFn(rpcErr)) throw rpcErr;
  const { data, error } = await supabase
    .from('attempts')
    .insert({ paper_id: paperId, user_id: userId, answers, score, total })
    .select()
    .single();
  if (error) {
    // Unique constraint (paper_id, user_id) means this paper was already submitted.
    if (error.code === '23505') {
      return fetchMyAttempt(paperId, userId);
    }
    throw error;
  }
  return data;
}

export async function fetchAllAttempts(paperId) {
  const { data, error } = await supabase
    .from('attempts')
    .select('*, profiles(name, "group", med_no)')
    .eq('paper_id', paperId);
  if (error) throw error;
  return data.map((a) => ({
    userId: a.user_id,
    medNo: a.profiles?.med_no,
    name: a.profiles?.name,
    group: a.profiles?.group,
    answers: a.answers,
    score: a.score,
    total: a.total,
    submittedAt: a.submitted_at,
  }));
}

// ---------- PAPER RESET (admin only; checked again in the database) ----------
// { submitted, inProgress } for the reset warning.
export async function fetchPaperActivity(paperId) {
  const { data, error } = await supabase.rpc('admin_paper_activity', { pid: paperId });
  if (error) throw error;
  return { submitted: data.submitted, inProgress: data.in_progress };
}

// Deletes every submission and in-progress attempt for the paper.
export async function resetPaper(paperId) {
  const { data, error } = await supabase.rpc('admin_reset_paper', { pid: paperId });
  if (error) throw error;
  return { submitted: data.submitted, inProgress: data.in_progress };
}

// Deletes one student's submission and draft for a paper so they can retake it.
export async function resetStudentAttempt(paperId, userId) {
  const { error } = await supabase.rpc('admin_reset_attempt', { pid: paperId, uid: userId });
  if (error) throw error;
}

// Students who started this paper but haven't submitted (admin only).
export async function fetchInProgress(paperId) {
  const { data, error } = await supabase.rpc('admin_in_progress', { pid: paperId });
  if (error) throw error;
  return data.map((d) => ({
    userId: d.user_id,
    name: d.name,
    medNo: d.med_no,
    group: d.group,
    startedAt: d.started_at,
    updatedAt: d.updated_at,
    answered: d.answered,
  }));
}
