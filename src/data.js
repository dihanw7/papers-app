import { supabase, medNoToEmail } from './supabaseClient.js';

// True when a database function doesn't exist yet (its migration hasn't been
// run), so callers can fall back to the older direct-table behaviour.
function isMissingFn(error) {
  return error && (error.code === 'PGRST202' || error.code === '42883');
}

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

export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_event, session) => cb(session));
}

export async function fetchMyProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}

// ---------- SUBJECTS ----------
export async function fetchSubjects() {
  const { data, error } = await supabase.from('subjects').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function createSubject(name) {
  const { data, error } = await supabase.from('subjects').insert({ name }).select().single();
  if (error) throw error;
  return data;
}

export async function fetchAllSubjects() {
  const { data, error } = await supabase.from('subjects').select('id, name').order('name');
  if (error) throw error;
  return data;
}

export async function deleteSubject(subjectId) {
  const { error } = await supabase.from('subjects').delete().eq('id', subjectId);
  if (error) throw error;
}

// ---------- PAPERS ----------
export async function fetchPapers(subjectId) {
  const { data: papers, error } = await supabase
    .from('papers')
    .select('*')
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (papers.length === 0) return [];
  const counts = await fetchQuestionCounts(papers.map((p) => p.id));
  return papers.map((p) => ({
    id: p.id,
    name: p.name,
    passMark: p.pass_mark,
    subjectId: p.subject_id,
    timeLimitMinutes: p.time_limit_minutes,
    opensAt: p.opens_at,
    closesAt: p.closes_at,
    isOpen: p.is_open,
    resultsAfterClose: !!p.results_after_close,
    questionCount: counts[p.id] || 0,
  }));
}

// { paperId: count }, with MTF groups counted as one question each, matching how
// they're shown to students. Uses the paper_question_counts() database function
// so counts show even for locked papers whose questions students can't read.
export async function fetchQuestionCounts(paperIds) {
  const counts = {};
  if (!paperIds.length) return counts;
  const { data, error } = await supabase.rpc('paper_question_counts', { paper_ids: paperIds });
  if (!error) {
    data.forEach((r) => { counts[r.paper_id] = r.question_count; });
    return counts;
  }
  // Fallback until migration_08 has been run: count the questions directly.
  const { data: qs, error: qErr } = await supabase
    .from('questions')
    .select('id, paper_id, group_id')
    .in('paper_id', paperIds);
  if (qErr) throw qErr;
  const sets = {};
  qs.forEach((q) => { (sets[q.paper_id] ||= new Set()).add(q.group_id || q.id); });
  Object.keys(sets).forEach((id) => { counts[id] = sets[id].size; });
  return counts;
}

export async function fetchAllPapers() {
  const { data, error } = await supabase
    .from('papers')
    .select('*, subjects(name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    passMark: p.pass_mark,
    timeLimitMinutes: p.time_limit_minutes,
    opensAt: p.opens_at,
    closesAt: p.closes_at,
    isOpen: p.is_open,
    resultsAfterClose: !!p.results_after_close,
    subjectName: p.subjects?.name,
  }));
}

export async function setPaperOpen(paperId, isOpen) {
  const { error } = await supabase.from('papers').update({ is_open: isOpen }).eq('id', paperId);
  if (error) throw error;
}

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

export async function deletePaper(paperId) {
  const { error } = await supabase.from('papers').delete().eq('id', paperId);
  if (error) throw error;
}

export async function createPaper({ subjectId, name, passMark, timeLimitMinutes, opensAt, closesAt, resultsAfterClose, locked }) {
  const { data, error } = await supabase
    .from('papers')
    .insert({
      subject_id: subjectId, name, pass_mark: passMark,
      time_limit_minutes: timeLimitMinutes || null,
      opens_at: opensAt || null,
      closes_at: closesAt || null,
      results_after_close: !!resultsAfterClose,
      is_open: !locked,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

function questionToRow(paperId, q, idx) {
  return {
    paper_id: paperId,
    type: q.type,
    stem: q.stem,
    options: q.options,
    correct: q.correct,
    position: idx,
    group_id: q.groupId || null,
    group_stem: q.groupId ? (q.groupStem || null) : null,
    group_order: q.groupId ? (q.groupOrder ?? idx) : null,
  };
}

export async function addQuestions(paperId, questions) {
  const rows = questions.map((q, idx) => questionToRow(paperId, q, idx));
  const { error } = await supabase.from('questions').insert(rows);
  if (error) throw error;
}

export async function updatePaper(paperId, { subjectId, name, passMark, timeLimitMinutes, opensAt, closesAt, resultsAfterClose, locked }) {
  const { error } = await supabase
    .from('papers')
    .update({
      subject_id: subjectId, name, pass_mark: passMark,
      time_limit_minutes: timeLimitMinutes || null,
      opens_at: opensAt || null,
      closes_at: closesAt || null,
      results_after_close: !!resultsAfterClose,
      is_open: !locked,
    })
    .eq('id', paperId);
  if (error) throw error;
}

// Saves an edited question list for an existing paper.
// - Questions that already existed keep their original id (updated in place),
//   so students' submitted answers stay linked to them.
// - Brand-new questions are inserted.
// - Questions that were removed in the editor are deleted.
// Positions are rewritten to match the editor's order.
export async function saveEditedQuestions(paperId, questions, originalIds) {
  const existingRows = [];
  const newRows = [];
  questions.forEach((q, idx) => {
    const row = questionToRow(paperId, q, idx);
    if (q.existing) existingRows.push({ id: q.id, ...row });
    else newRows.push(row);
  });
  if (existingRows.length) {
    const { error } = await supabase.from('questions').upsert(existingRows, { onConflict: 'id' });
    if (error) throw error;
  }
  if (newRows.length) {
    const { error } = await supabase.from('questions').insert(newRows);
    if (error) throw error;
  }
  const kept = new Set(existingRows.map((r) => r.id));
  const removed = originalIds.filter((id) => !kept.has(id));
  if (removed.length) {
    const { error } = await supabase.from('questions').delete().in('id', removed);
    if (error) throw error;
  }
}

export async function countAttempts(paperId) {
  const { count, error } = await supabase
    .from('attempts')
    .select('id', { count: 'exact', head: true })
    .eq('paper_id', paperId);
  if (error) throw error;
  return count || 0;
}

export async function fetchPaperWithQuestions(paperId) {
  const { data: paper, error: pErr } = await supabase.from('papers').select('*').eq('id', paperId).single();
  if (pErr) throw pErr;
  // Students get questions through get_paper_questions(), which leaves out the
  // answer key until results are released.
  let questions;
  const { data: rpcQs, error: rpcErr } = await supabase.rpc('get_paper_questions', { pid: paperId });
  if (!rpcErr) {
    questions = rpcQs || [];
  } else if (isMissingFn(rpcErr)) {
    const { data, error: qErr } = await supabase.from('questions').select('*').eq('paper_id', paperId).order('position');
    if (qErr) throw qErr;
    questions = data;
  } else {
    throw rpcErr;
  }
  return {
    id: paper.id,
    name: paper.name,
    passMark: paper.pass_mark,
    subjectId: paper.subject_id,
    timeLimitMinutes: paper.time_limit_minutes,
    opensAt: paper.opens_at,
    closesAt: paper.closes_at,
    isOpen: paper.is_open,
    resultsAfterClose: !!paper.results_after_close,
    // False while the answer key is being withheld from this student.
    answersRevealed: questions.every((q) => 'correct' in q),
    questions: questions.map((q) => ({
      id: q.id,
      type: q.type,
      stem: q.stem,
      options: q.options,
      correct: q.correct ?? null,
      groupId: q.group_id || null,
      groupStem: q.group_stem || null,
      groupOrder: q.group_order,
    })),
  };
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
