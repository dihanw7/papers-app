import { supabase } from '../supabaseClient.js';
import { isMissingFn } from './util.js';

// ---------- Row <-> app object mapping ----------
// A papers row as the app uses it.
function toPaper(p) {
  return {
    id: p.id,
    name: p.name,
    passMark: p.pass_mark,
    subjectId: p.subject_id,
    timeLimitMinutes: p.time_limit_minutes,
    opensAt: p.opens_at,
    closesAt: p.closes_at,
    isOpen: p.is_open,
    resultsAfterClose: !!p.results_after_close,
  };
}

// The editable paper fields, as columns to write.
function paperFieldsToRow({ subjectId, name, passMark, timeLimitMinutes, opensAt, closesAt, resultsAfterClose, locked }) {
  return {
    subject_id: subjectId, name, pass_mark: passMark,
    time_limit_minutes: timeLimitMinutes || null,
    opens_at: opensAt || null,
    closes_at: closesAt || null,
    results_after_close: !!resultsAfterClose,
    is_open: !locked,
  };
}

// A questions row as the app uses it. `correct` is null while the answer key
// is withheld from this student.
function toQuestion(q) {
  return {
    id: q.id,
    type: q.type,
    stem: q.stem,
    options: q.options,
    correct: q.correct ?? null,
    groupId: q.group_id || null,
    groupStem: q.group_stem || null,
    groupOrder: q.group_order,
  };
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

// ---------- Papers ----------
export async function fetchPapers(subjectId) {
  const { data: papers, error } = await supabase
    .from('papers')
    .select('*')
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (papers.length === 0) return [];
  const counts = await fetchQuestionCounts(papers.map((p) => p.id));
  return papers.map((p) => ({ ...toPaper(p), questionCount: counts[p.id] || 0 }));
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
  return data.map((p) => ({ ...toPaper(p), subjectName: p.subjects?.name }));
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
    ...toPaper(paper),
    // False while the answer key is being withheld from this student.
    answersRevealed: questions.every((q) => 'correct' in q),
    questions: questions.map(toQuestion),
  };
}

export async function setPaperOpen(paperId, isOpen) {
  const { error } = await supabase.from('papers').update({ is_open: isOpen }).eq('id', paperId);
  if (error) throw error;
}

export async function deletePaper(paperId) {
  const { error } = await supabase.from('papers').delete().eq('id', paperId);
  if (error) throw error;
}

export async function createPaper(fields) {
  const { data, error } = await supabase
    .from('papers')
    .insert(paperFieldsToRow(fields))
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePaper(paperId, fields) {
  const { error } = await supabase
    .from('papers')
    .update(paperFieldsToRow(fields))
    .eq('id', paperId);
  if (error) throw error;
}

// ---------- Questions ----------
export async function addQuestions(paperId, questions) {
  const rows = questions.map((q, idx) => questionToRow(paperId, q, idx));
  const { error } = await supabase.from('questions').insert(rows);
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
