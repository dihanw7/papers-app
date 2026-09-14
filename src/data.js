import { supabase, medNoToEmail } from './supabaseClient.js';

// ---------- AUTH ----------
export async function signUp({ name, group, medNo, password }) {
  const email = medNoToEmail(medNo);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, group, med_no: medNo.toUpperCase() } },
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

// ---------- PAPERS ----------
export async function fetchPapers(subjectId) {
  const { data, error } = await supabase
    .from('papers')
    .select('id, name, pass_mark, subject_id, questions(count)')
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    passMark: p.pass_mark,
    subjectId: p.subject_id,
    questionCount: p.questions?.[0]?.count ?? 0,
  }));
}

export async function createPaper({ subjectId, name, passMark }) {
  const { data, error } = await supabase
    .from('papers')
    .insert({ subject_id: subjectId, name, pass_mark: passMark })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function addQuestions(paperId, questions) {
  const rows = questions.map((q, idx) => ({
    paper_id: paperId,
    type: q.type,
    stem: q.stem,
    options: q.options,
    correct: q.correct,
    position: idx,
    group_id: q.groupId || null,
    group_stem: q.groupStem || null,
    group_order: q.groupId ? (q.groupOrder ?? idx) : null,
  }));
  const { error } = await supabase.from('questions').insert(rows);
  if (error) throw error;
}

export async function fetchPaperWithQuestions(paperId) {
  const { data: paper, error: pErr } = await supabase.from('papers').select('*').eq('id', paperId).single();
  if (pErr) throw pErr;
  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('*')
    .eq('paper_id', paperId)
    .order('position');
  if (qErr) throw qErr;
  return {
    id: paper.id,
    name: paper.name,
    passMark: paper.pass_mark,
    subjectId: paper.subject_id,
    questions: questions.map((q) => ({
      id: q.id,
      type: q.type,
      stem: q.stem,
      options: q.options,
      correct: q.correct,
      groupId: q.group_id || null,
      groupStem: q.group_stem || null,
      groupOrder: q.group_order,
    })),
  };
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

export async function submitAttempt({ paperId, userId, answers, score, total }) {
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
