// Subjects, the paper list for a subject, and the screens shown before a
// paper starts (start / locked / not open yet).
import * as db from '../data/index.js';
import { subjectIconSrc } from '../subjectIcons.js';
import { cache, state } from '../state.js';
import { esc, fmtWhen, groupConsecutive, paperStatus } from '../lib/helpers.js';
import { ICONS, lockIcon, subjectIcon, swatchFor } from '../ui/components.js';
import { render } from '../render.js';
import { enterPaper, finalizeSubmit } from './take.js';
import { buildReview } from './review.js';

// ---------- NAV ----------
window.goto = async function (screen) {
  state.errorMsg = '';
  if (screen === 'analytics' || screen === 'admin') cache.analytics = null; // show fresh results
  if (screen === 'home') { state.subjects = await db.fetchSubjects(); }
  state.screen = screen;
  render();
};

window.selectSubject = async function (subjId, subjName) {
  state.selectedSubject = { id: subjId, name: subjName };
  state.papers = await db.fetchPapers(subjId);
  try {
    state.myAttemptedPaperIds = await db.fetchMyAttemptedPaperIds(state.currentUser.id, state.papers.map(p => p.id));
  } catch (e) { state.myAttemptedPaperIds = []; }
  state.screen = 'papers';
  render();
};

window.openPaper = async function (paperId) {
  state.busy = true; render();
  const paper = await db.fetchPaperWithQuestions(paperId);
  state.selectedPaper = paperId;
  state.paperDetail = paper;
  state.screens = groupConsecutive(paper.questions);
  const existingAttempt = await db.fetchMyAttempt(paperId, state.currentUser.id);
  const status = paperStatus(paper);
  const draft = (!existingAttempt && status.kind !== 'upcoming') ? await db.fetchDraft(paperId, state.currentUser.id) : null;
  if (!existingAttempt && !status.open) {
    // Students can't read a locked paper's questions, so count them separately.
    const listed = state.papers.find((p) => p.id === paperId);
    paper.questionCount = listed ? listed.questionCount : ((await db.fetchQuestionCounts([paperId]))[paperId] || 0);
  }
  state.busy = false;
  state.lockedKind = status.open ? '' : status.kind;
  if (existingAttempt) {
    // Results stay viewable whatever the paper's lock state.
    await buildReview(paperId, {
      score: existingAttempt.score, total: existingAttempt.total,
      answers: existingAttempt.answers, submittedAt: existingAttempt.submitted_at,
    });
  } else if (status.kind === 'upcoming') {
    state.lockedMessage = 'This paper opens ' + fmtWhen(paper.opensAt) + '. Come back then to start it.';
    state.screen = 'paper_locked';
  } else if (status.kind === 'closed' && draft) {
    // Student started it but never submitted (e.g. closed the tab) and the
    // window has now closed: submit what they had, same as a timeout.
    state.attemptAnswers = draft.answers || {};
    state.attemptIndex = 0;
    state.attemptDeadline = null;
    state.screen = 'take';
    state.answersLocked = true;
    state.submitError = '';
    render();
    await finalizeSubmit(true);
    return;
  } else if (status.kind === 'closed') {
    state.lockedMessage = 'This paper closed ' + fmtWhen(paper.closesAt) + ' and can no longer be started.';
    state.screen = 'paper_locked';
  } else if (status.kind === 'locked') {
    // Manual lock is reversible, so an in-progress draft is kept, not submitted.
    state.lockedMessage = draft
      ? 'This paper has been locked by your lecturer. Your answers so far are saved, and you can carry on when it is unlocked.'
      : 'This paper is locked. It will open when your lecturer unlocks it.';
    state.screen = 'paper_locked';
  } else if (!draft) {
    // First time in: show the start screen. The clock only starts when they
    // press Start paper (start_attempt records the start time).
    state.screen = 'paper_start';
  } else {
    // Already started (their clock is running): go straight back in.
    await enterPaper(paperId, draft);
    return;
  }
  render();
};

window.beginPaper = async function () {
  if (state.busy) return;
  state.busy = true; render();
  await enterPaper(state.selectedPaper, null);
};

window.togglePaperOpen = async function (paperId, open) {
  if (!open && !confirm('Lock this paper? Nobody new can start it, and students part-way through can no longer change answers. Their answers saved so far are kept, and count if they submit.')) return;
  try {
    await db.setPaperOpen(paperId, open);
    if (state.screen === 'paper_locked' && state.selectedPaper === paperId) {
      state.papers = state.selectedSubject ? await db.fetchPapers(state.selectedSubject.id) : state.papers;
      state.screen = 'papers';
    }
    if (state.screen === 'papers' && state.selectedSubject) {
      state.papers = await db.fetchPapers(state.selectedSubject.id);
    }
    render();
  } catch (e) { alert(e.message); }
};

// ---------- HOME ----------
export function renderHome() {
  if (state.subjects.length === 0) {
    return '<h1>Subjects</h1><p class="sub">No subjects yet.</p><div class="empty"><div class="dot"></div>'
      + (state.currentUser.role === 'admin' ? 'Head to <b>Admin</b> to add your first subject and paper.' : 'Ask your admin to add a subject and paper to get started.') + '</div>';
  }
  return '<h1>Subjects</h1><p class="sub">Choose a subject to see its papers.</p>'
    + '<div class="grid subject-grid">' + state.subjects.map(s =>
      '<div class="tile" onclick="selectSubject(\'' + s.id + '\',\'' + esc(s.name).replace(/'/g, "\\'") + '\')">' + subjectIcon(s) + '<div class="t">' + esc(s.name) + '</div><div class="d">View papers</div></div>'
    ).join('') + '</div>';
}

export function paperTile(p) {
  const st = paperStatus(p);
  const done = state.myAttemptedPaperIds.includes(p.id);
  const locked = !st.open && !done;
  let badge = '';
  if (done) badge = '<span class="status-pill done">Completed</span>';
  else if (st.kind === 'upcoming') badge = '<span class="status-pill locked">Opens ' + esc(fmtWhen(p.opensAt)) + '</span>';
  else if (st.kind === 'closed') badge = '<span class="status-pill locked">Closed</span>';
  else if (st.kind === 'locked') badge = '<span class="status-pill locked">Locked</span>';
  else if (st.scheduled && p.closesAt) badge = '<span class="status-pill open">Open until ' + esc(fmtWhen(p.closesAt)) + '</span>';
  else badge = '<span class="status-pill open">Open</span>';
  const meta = p.questionCount + ' questions, pass ' + p.passMark + '%' + (p.timeLimitMinutes ? ', ' + p.timeLimitMinutes + ' min' : '');
  return '<div class="tile' + (locked ? ' is-locked' : '') + '" onclick="openPaper(\'' + p.id + '\')">'
    + (locked ? '<div class="swatch lock-swatch">' + lockIcon(22) + '</div>' : swatchFor(p.name))
    + '<div class="t">' + esc(p.name) + '</div>'
    + '<div class="d">' + meta + '</div>'
    + '<div class="tile-status">' + badge + '</div>'
    + '</div>';
}

export function renderPapers() {
  return '<div class="flex-between"><h1>' + esc(state.selectedSubject.name) + '</h1><span class="link-a" onclick="goto(\'home\')">← Subjects</span></div>'
    + '<p class="sub">Choose a paper to begin.</p>'
    + (state.papers.length === 0 ? '<div class="empty"><div class="dot"></div>No papers in this subject yet.</div>' :
      '<div class="grid">' + state.papers.map(paperTile).join('') + '</div>');
}

export function renderPaperStart() {
  const p = state.paperDetail;
  const subject = state.selectedSubject ? (state.subjects.find(s => s.id === state.selectedSubject.id) || state.selectedSubject) : null;
  const icon = subject && subjectIconSrc(subject);
  const minsToClose = p.closesAt ? Math.floor((new Date(p.closesAt).getTime() - Date.now()) / 60000) : null;

  let timing;
  if (p.timeLimitMinutes && p.closesAt && minsToClose < p.timeLimitMinutes) {
    timing = 'The paper closes ' + fmtWhen(p.closesAt) + ', so you will have about ' + Math.max(minsToClose, 0) + ' minutes, not the full ' + p.timeLimitMinutes + '.';
  } else if (p.timeLimitMinutes) {
    timing = 'You have ' + p.timeLimitMinutes + ' minutes. The timer starts when you press Start paper and keeps running if you leave or refresh the page.';
  } else if (p.closesAt) {
    timing = 'You can work on it until the paper closes ' + fmtWhen(p.closesAt) + '.';
  } else {
    timing = 'There is no time limit.';
  }

  const facts = [];
  if (state.selectedSubject) facts.push(['Subject', state.selectedSubject.name]);
  facts.push(['Questions', String(state.screens.length)]);
  facts.push(['Time allowed', p.timeLimitMinutes ? p.timeLimitMinutes + ' min' : 'No time limit']);
  if (p.closesAt) facts.push(['Closes', fmtWhen(p.closesAt)]);
  facts.push(['Pass mark', (p.passMark ?? 50) + '%']);

  return '<div class="flex-between"><h1>' + esc(p.name) + '</h1><span class="link-a" onclick="goto(\'papers\')">← Back</span></div>'
    + '<div class="lock-hero start">'
    + (icon ? '<img class="start-icon" src="' + icon + '" alt="">' : '<div class="lock-bubble">' + ICONS.play + '</div>')
    + '<div class="lock-title">Ready to start?</div>'
    + '<p class="lock-msg">' + esc(timing) + '</p>'
    + '<dl class="lock-facts">' + facts.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>'
    + '<ul class="start-rules">'
    + '<li>Your answers save automatically as you go.</li>'
    + '<li>You can only submit once. After that your answers can\'t be changed.</li>'
    + '<li>' + (p.resultsAfterClose ? 'Your score and the answers will be shown after the paper closes.' : 'You will see your score and the answers straight after submitting.') + '</li>'
    + '</ul>'
    + '<button class="btn start-btn" onclick="beginPaper()" ' + (state.busy ? 'disabled' : '') + '>' + (state.busy ? 'Starting…' : 'Start paper') + '</button>'
    + '</div>';
}

export function renderPaperLocked() {
  const p = state.paperDetail;
  const isAdmin = state.currentUser.role === 'admin';
  const title = state.lockedKind === 'upcoming' ? 'Not open yet' : (state.lockedKind === 'closed' ? 'Closed' : 'Locked');
  let html = '<div class="flex-between"><h1>' + esc(p.name) + '</h1><span class="link-a" onclick="goto(\'papers\')">← Back</span></div>'
    + '<div class="lock-hero ' + esc(state.lockedKind) + '">'
    + '<div class="lock-bubble">' + lockIcon(44) + '</div>'
    + '<div class="lock-title">' + title + '</div>'
    + '<p class="lock-msg">' + esc(state.lockedMessage) + '</p>';
  const facts = [];
  if (state.selectedSubject) facts.push(['Subject', state.selectedSubject.name]);
  facts.push(['Questions', String(p.questionCount ?? p.questions.length)]);
  facts.push(['Time allowed', p.timeLimitMinutes ? p.timeLimitMinutes + ' min' : 'No time limit']);
  if (p.opensAt) facts.push([state.lockedKind === 'upcoming' ? 'Opens' : 'Opened', fmtWhen(p.opensAt)]);
  if (p.closesAt) facts.push([state.lockedKind === 'closed' ? 'Closed' : 'Closes', fmtWhen(p.closesAt)]);
  html += '<dl class="lock-facts">' + facts.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>';
  if (isAdmin && state.lockedKind === 'locked') {
    html += '<button class="btn" style="margin-top:6px;" onclick="togglePaperOpen(\'' + p.id + '\', true)">Unlock for students</button>';
  } else if (isAdmin) {
    html += '<p class="lock-msg small">This paper runs on a schedule. Edit its open and close times from Admin to change when it is available.</p>';
  }
  return html + '</div>';
}
