import * as db from './data.js';

let state = {
  screen: 'loading',
  authMode: 'login',
  currentUser: null, // { id, name, group, medNo, role }
  subjects: [],
  selectedSubject: null,
  papers: [],
  selectedPaper: null,
  paperDetail: null,
  screens: [], // grouped view of the current paper's questions (single | group)
  attemptAnswers: {},
  attemptIndex: 0,
  reviewData: null,
  adminTab: 'papers',
  newPaperQuestions: [],
  errorMsg: '',
  busy: false,
  analyticsSubject: null,
  analyticsPaper: null,
  analyticsExpandedQ: null,
  analyticsTypeFilter: 'all', // all | SBA | TF | MTF
  analyticsViewingAttempt: null,
  attemptDeadline: null,
  attemptStartedAt: null, // ms, server clock; null if the database can't record it
  clockOffset: 0, // server time minus this device's time, in ms
  timedOut: false,
  draftStatus: 'idle', // idle | saving | saved
  settings: { groups: [], batches: [] },
  lockedMessage: '',
  submitError: '',
  myAttemptedPaperIds: [], // papers in the current subject this user has already submitted
  lockedKind: '', // upcoming | closed | locked — why the current paper can't be started
  answersLocked: false, // true once time is up, so answers can't change while a submit is retried
  // Paper builder / editor. editingPaperId is null when creating a new paper.
  editingPaperId: null,
  editingOriginalIds: [], // question ids the paper had when the editor opened
  editingAttemptCount: 0, // how many students had already submitted when the editor opened
  paperForm: { subjectId: '', name: '', passMark: '50', timeLimit: '', opens: '', closes: '', resultsAfterClose: true },
};

function esc(s) {
  return (s === undefined || s === null) ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// ---------- Paper availability ----------
// One place that decides whether a paper can be started right now
// (same rule as paper_is_open_now() in the database).
//  - Locked by an admin: closed, even inside its scheduled window.
//  - Otherwise scheduled papers follow their open/close times, and
//    unscheduled ones are open.
function paperStatus(p) {
  const now = Date.now();
  const scheduled = !!(p.opensAt || p.closesAt);
  if (p.closesAt && now >= new Date(p.closesAt).getTime()) return { kind: 'closed', open: false };
  if (!p.isOpen) return { kind: 'locked', open: false };
  if (p.opensAt && now < new Date(p.opensAt).getTime()) return { kind: 'upcoming', open: false };
  return { kind: 'open', open: true, scheduled };
}
function fmtWhen(iso) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
// Soft rounded padlock. `size` in px.
function lockIcon(size) {
  return '<svg class="lock-svg" width="' + size + '" height="' + size + '" viewBox="0 0 48 48" aria-hidden="true">'
    + '<path d="M15 21v-5.5a9 9 0 0 1 18 0V21" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linecap="round"/>'
    + '<rect x="9" y="20" width="30" height="23" rx="8" fill="currentColor"/>'
    + '<rect x="9" y="20" width="30" height="8" rx="4" fill="#fff" opacity=".18"/>'
    + '<circle cx="24" cy="30.5" r="3.4" fill="#fff"/>'
    + '<rect x="22.4" y="31" width="3.2" height="6.4" rx="1.6" fill="#fff"/>'
    + '</svg>';
}

// Turns Supabase/network errors into messages a student can act on.
function friendlyAuthError(e, fallback) {
  const msg = (e && e.message) ? e.message : '';
  if ((e && e.status === 429) || /rate limit|too many/i.test(msg)) {
    return 'Too many people are signing in from this network right now. Wait a minute and try again.';
  }
  if (/failed to fetch|network|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your internet connection and try again.';
  }
  return fallback || msg;
}
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
// MTF group ids are stored in a uuid column, so they need to be real UUIDs.
function newGroupId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
// ISO timestamp -> value for an <input type="datetime-local"> in the viewer's local time.
function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

const SWATCHES = [
  { bg: '#eef5ff', fg: '#0071e3' }, { bg: '#eafbf0', fg: '#1e8e3e' }, { bg: '#f3eefd', fg: '#7c3aed' },
  { bg: '#fff4e5', fg: '#c2740b' }, { bg: '#fdeef0', fg: '#c0255a' }, { bg: '#e8f8f6', fg: '#0a8a7c' },
];
function swatchFor(str) {
  let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const c = SWATCHES[h % SWATCHES.length];
  const letter = (str.trim()[0] || '?').toUpperCase();
  return '<div class="swatch" style="background:' + c.bg + '; color:' + c.fg + ';">' + esc(letter) + '</div>';
}

// Renders a True/False segmented control. `onFn` is the global function name
// to call on click (e.g. 'selectAnswer' or 'setCorrect').
function segToggle(qid, selectedKey, onFn) {
  return '<div class="seg-toggle">'
    + '<button class="seg-btn true ' + (selectedKey === 'A' ? 'selected' : '') + '" onclick="' + onFn + '(\'' + qid + '\',\'A\')">True</button>'
    + '<button class="seg-btn false ' + (selectedKey === 'B' ? 'selected' : '') + '" onclick="' + onFn + '(\'' + qid + '\',\'B\')">False</button>'
    + '</div>';
}

// Groups a flat, position-ordered list of question-like objects (each with
// an optional .groupId) into single items and contiguous MTF groups.
function groupConsecutive(list) {
  const out = [];
  let i = 0;
  while (i < list.length) {
    const item = list[i];
    if (item.groupId) {
      const gid = item.groupId;
      const items = [];
      while (i < list.length && list[i].groupId === gid) { items.push(list[i]); i++; }
      out.push({ kind: 'group', groupId: gid, groupStem: items[0].groupStem, items });
    } else {
      out.push({ kind: 'single', question: item });
      i++;
    }
  }
  return out;
}

// ---------- Timed papers ----------
let countdownTimer = null;
let draftSaveTimeout = null;
function scheduleDraftSave() {
  if (!state.selectedPaper || !state.currentUser) return;
  state.draftStatus = 'saving';
  clearTimeout(draftSaveTimeout);
  draftSaveTimeout = setTimeout(async () => {
    try {
      await db.saveDraft(state.selectedPaper, state.currentUser.id, state.attemptAnswers);
      if (state.screen === 'take') { state.draftStatus = 'saved'; render(); }
    } catch (e) {
      if (state.screen === 'take') { state.draftStatus = 'idle'; render(); }
    }
  }, 700);
}
// Deadlines come from the server, so count down against the server's clock
// (a student changing their device clock doesn't buy extra time).
function serverNow() { return Date.now() + state.clockOffset; }
function timerStorageKey(paperId) { return 'papers_attempt_start_' + paperId + '_' + state.currentUser.id; }
function clearCountdown() { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } }
function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}
const SBA_MARKS = 5;
const TF_MARKS = 1; // standalone TF (not part of an MTF group) — rare in practice
const MTF_MAX_MARKS = 5; // fixed cap per MTF group, regardless of how many statements it has

function screenMaxMarks(screen) {
  if (screen.kind === 'single') return screen.question.type === 'SBA' ? SBA_MARKS : TF_MARKS;
  return MTF_MAX_MARKS;
}
function screenEarnedMarks(screen, answers) {
  if (screen.kind === 'single') {
    const max = screenMaxMarks(screen);
    return answers[screen.question.id] === screen.question.correct ? max : 0;
  }
  let correct = 0, wrong = 0;
  screen.items.forEach(q => {
    const ans = answers[q.id];
    if (!ans) return;
    if (ans === q.correct) correct++; else wrong++;
  });
  return Math.max(0, Math.min(MTF_MAX_MARKS, correct - wrong));
}
function computeScore() {
  let totalPoints = 0, totalPossible = 0;
  state.screens.forEach(screen => {
    totalPossible += screenMaxMarks(screen);
    totalPoints += screenEarnedMarks(screen, state.attemptAnswers);
  });
  return { totalPoints, totalPossible };
}
let submitInFlight = false;
async function finalizeSubmit(timedOut) {
  if (submitInFlight) return;
  submitInFlight = true;
  clearCountdown();
  clearTimeout(draftSaveTimeout);
  if (timedOut) state.answersLocked = true; // freeze answers at the deadline
  const paperId = state.selectedPaper;
  const { totalPoints, totalPossible } = computeScore();
  state.busy = true; state.submitError = ''; render();
  let attempt;
  try {
    attempt = await db.submitAttempt({
      paperId, userId: state.currentUser.id,
      answers: state.attemptAnswers, score: totalPoints, total: totalPossible,
    });
  } catch (e) {
    // Network blip / server busy: keep everything, tell the student, retry.
    submitInFlight = false;
    state.busy = false;
    try { await db.saveDraft(paperId, state.currentUser.id, state.attemptAnswers); } catch (e2) { /* offline too */ }
    if (timedOut) {
      state.submitError = 'Time is up. Submitting your answers failed (connection problem) — retrying automatically. Please keep this page open.';
      setTimeout(() => { if (state.screen === 'take' && state.selectedPaper === paperId) finalizeSubmit(true); }, 5000);
    } else {
      state.submitError = 'Could not submit — check your connection and press Finish & submit again. Your answers are safe on this screen.';
      startCountdownIfNeeded(); // resume the clock; deadline is unchanged
    }
    render();
    return;
  }
  submitInFlight = false;
  localStorage.removeItem(timerStorageKey(paperId));
  try { await db.deleteDraft(paperId, state.currentUser.id); } catch (e) { /* non-fatal */ }
  state.busy = false;
  state.answersLocked = false;
  state.timedOut = timedOut;
  await buildReview(paperId, {
    score: attempt.score, total: attempt.total, answers: attempt.answers, submittedAt: attempt.submitted_at,
  });
  render();
}
function autoSubmitOnTimeout() {
  if (state.screen !== 'take') return;
  finalizeSubmit(true);
}
function startCountdownIfNeeded() {
  clearCountdown();
  const paper = state.paperDetail;
  let deadline = null;
  if (paper.timeLimitMinutes) {
    let startedAt = state.attemptStartedAt;
    if (startedAt == null) {
      // Older database without start_attempt(): fall back to this device's record.
      const key = timerStorageKey(paper.id);
      startedAt = parseInt(localStorage.getItem(key) || '0', 10);
      if (!startedAt) { startedAt = Date.now(); localStorage.setItem(key, String(startedAt)); }
    }
    deadline = startedAt + paper.timeLimitMinutes * 60000;
  }
  if (paper.closesAt) {
    const closesMs = new Date(paper.closesAt).getTime();
    deadline = deadline ? Math.min(deadline, closesMs) : closesMs;
  }
  state.attemptDeadline = deadline;
  if (!deadline) return; // no time pressure at all
  if (serverNow() >= deadline) {
    autoSubmitOnTimeout();
    return;
  }
  countdownTimer = setInterval(() => {
    if (state.screen !== 'take') { clearCountdown(); return; }
    if (serverNow() >= state.attemptDeadline) { autoSubmitOnTimeout(); }
    else { render(); }
  }, 1000);
}

async function boot() {
  try {
    state.settings = await db.fetchSettings();
  } catch (e) {
    state.settings = { groups: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], batches: ['30', '31', '32', '33', '34'] };
  }
  const session = await db.getSession();
  if (session) {
    try {
      const profile = await db.fetchMyProfile(session.user.id);
      state.currentUser = { id: profile.id, name: profile.name, group: profile.group, medNo: profile.med_no, role: profile.role, batch: profile.batch };
      state.screen = 'home';
      state.subjects = await db.fetchSubjects();
    } catch (e) {
      state.screen = 'auth';
    }
  } else {
    state.screen = 'auth';
  }
  render();
}
boot();

// ---------- AUTH ----------
window.doSignup = async function () {
  const name = document.getElementById('su_name').value.trim();
  const group = document.getElementById('su_group').value;
  const batch = document.getElementById('su_batch').value;
  const med = document.getElementById('su_med').value.trim().toUpperCase();
  const pass = document.getElementById('su_pass').value;
  if (!name || !group || !batch || !med || !pass) { state.errorMsg = 'Please fill in every field.'; render(); return; }
  if (pass.length < 6) { state.errorMsg = 'Password must be at least 6 characters.'; render(); return; }
  state.busy = true; state.errorMsg = ''; render();
  try {
    const result = await db.signUp({ name, group, medNo: med, password: pass, batch });
    if (!result.session) {
      state.busy = false;
      state.errorMsg = 'Account created. If your admin has email confirmation turned on, ask them to disable it — otherwise try logging in now.';
      state.authMode = 'login';
      render();
      return;
    }
    const profile = await db.fetchMyProfile(result.user.id);
    state.currentUser = { id: profile.id, name: profile.name, group: profile.group, medNo: profile.med_no, role: profile.role, batch: profile.batch };
    state.subjects = await db.fetchSubjects();
    state.busy = false;
    state.screen = 'home';
    render();
  } catch (e) {
    state.busy = false;
    state.errorMsg = /already registered/i.test(e.message || '') ? 'That MED number is already registered — try logging in instead.' : friendlyAuthError(e);
    render();
  }
};

window.doLogin = async function () {
  const med = document.getElementById('li_med').value.trim().toUpperCase();
  const pass = document.getElementById('li_pass').value;
  if (!med || !pass) { state.errorMsg = 'Enter your MED number and password.'; render(); return; }
  state.busy = true; state.errorMsg = ''; render();
  try {
    const result = await db.logIn({ medNo: med, password: pass });
    const profile = await db.fetchMyProfile(result.user.id);
    state.currentUser = { id: profile.id, name: profile.name, group: profile.group, medNo: profile.med_no, role: profile.role, batch: profile.batch };
    state.subjects = await db.fetchSubjects();
    state.busy = false;
    state.screen = 'home';
    render();
  } catch (e) {
    state.busy = false;
    state.errorMsg = friendlyAuthError(e, 'Incorrect MED number or password.');
    render();
  }
};

window.doLogout = async function () {
  await db.logOut();
  state.currentUser = null; state.screen = 'auth'; state.authMode = 'login'; state.errorMsg = '';
  render();
};

window.setAuthMode = function (m) { state.authMode = m; state.errorMsg = ''; render(); };

// ---------- NAV ----------
window.goto = async function (screen) {
  state.errorMsg = '';
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
  } else {
    // Record the start time on the server (first open only) and sync clocks.
    let started = null;
    try {
      started = await db.startAttempt(paperId);
    } catch (e) {
      state.lockedKind = 'locked';
      state.lockedMessage = e.message || 'This paper could not be opened.';
      state.screen = 'paper_locked';
      render();
      return;
    }
    state.attemptStartedAt = started ? new Date(started.startedAt).getTime() : null;
    state.clockOffset = started ? new Date(started.serverNow).getTime() - Date.now() : 0;
    const saved = started ? started.answers : (draft && draft.answers);
    state.attemptAnswers = saved ? { ...saved } : {};
    state.attemptIndex = 0;
    state.screen = 'take';
    state.draftStatus = 'idle';
    state.submitError = '';
    state.answersLocked = false;
    startCountdownIfNeeded();
  }
  render();
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

// ---------- TAKE PAPER ----------
window.selectAnswer = function (qid, key) {
  if (state.answersLocked || state.busy) return;
  if (state.attemptAnswers[qid] === key) { delete state.attemptAnswers[qid]; }
  else { state.attemptAnswers[qid] = key; }
  scheduleDraftSave();
  render();
};
window.gotoQIndex = function (i) { state.attemptIndex = i; render(); };
window.nextQ = function () { if (state.attemptIndex < state.screens.length - 1) { state.attemptIndex++; render(); } };
window.prevQ = function () { if (state.attemptIndex > 0) { state.attemptIndex--; render(); } };

window.submitPaper = async function () {
  if (state.busy || submitInFlight) return;
  const totalItems = state.paperDetail.questions.length;
  const answeredCount = Object.keys(state.attemptAnswers).length;
  const unanswered = totalItems - answeredCount;
  const msg = unanswered > 0
    ? unanswered + ' item(s) unanswered. Submit anyway? You will not be able to change answers after this.'
    : 'Submit paper? You will not be able to change your answers after this.';
  if (!confirm(msg)) return;
  await finalizeSubmit(false);
};

async function buildReview(paperId, attempt) {
  // Always refetch: the answer key may only become visible after submitting.
  const paper = await db.fetchPaperWithQuestions(paperId);
  state.paperDetail = paper;
  state.screens = groupConsecutive(paper.questions);
  const all = await db.fetchAllAttempts(paperId);
  const dist = {};
  paper.questions.forEach(q => { dist[q.id] = {}; q.options.forEach(o => dist[q.id][o.key] = 0); });
  all.forEach(a => { paper.questions.forEach(q => { const ans = a.answers[q.id]; if (ans && dist[q.id][ans] !== undefined) dist[q.id][ans]++; }); });
  state.reviewData = { attempt, allCount: all.length, dist };
  state.screen = 'review';
}

// ---------- ADMIN: subjects / papers ----------
window.setAdminTab = function (t) { state.adminTab = t; render(); };

window.saveSettings = async function () {
  const groups = document.getElementById('settings_groups').value.split(',').map(s => s.trim()).filter(Boolean);
  const batches = document.getElementById('settings_batches').value.split(',').map(s => s.trim()).filter(Boolean);
  if (groups.length === 0 || batches.length === 0) { alert('Add at least one group and one batch.'); return; }
  try {
    await db.updateSettings({ groups, batches });
    state.settings = { groups, batches };
    alert('Saved. New sign-ups will see the updated lists.');
  } catch (e) { alert(e.message); }
};

window.createSubject = async function () {
  const val = document.getElementById('newsubject').value.trim();
  if (!val) return;
  try {
    await db.createSubject(val);
    state.subjects = await db.fetchSubjects();
    document.getElementById('newsubject').value = '';
    render();
  } catch (e) { alert(e.message); }
};

window.startNewPaper = function () {
  state.editingPaperId = null;
  state.editingOriginalIds = [];
  state.editingAttemptCount = 0;
  // locked: null until the admin touches the box, then it defaults by schedule (see formLocked).
  state.paperForm = { subjectId: state.subjects[0] ? state.subjects[0].id : '', name: '', passMark: '50', timeLimit: '', opens: '', closes: '', resultsAfterClose: true, locked: null };
  state.newPaperQuestions = [];
  state.screen = 'admin_newpaper';
  render();
};

window.editPaper = async function (paperId) {
  try {
    if (state.subjects.length === 0) state.subjects = await db.fetchSubjects();
    const paper = await db.fetchPaperWithQuestions(paperId);
    const attemptCount = await db.countAttempts(paperId);
    state.editingPaperId = paperId;
    state.editingOriginalIds = paper.questions.map(q => q.id);
    state.editingAttemptCount = attemptCount;
    state.paperForm = {
      subjectId: paper.subjectId || '',
      name: paper.name || '',
      passMark: String(paper.passMark ?? 50),
      timeLimit: paper.timeLimitMinutes ? String(paper.timeLimitMinutes) : '',
      opens: isoToLocalInput(paper.opensAt),
      closes: isoToLocalInput(paper.closesAt),
      resultsAfterClose: paper.resultsAfterClose,
      locked: !paper.isOpen,
    };
    // Deep-copy so edits don't touch anything else holding this paper.
    state.newPaperQuestions = paper.questions.map(q => ({
      ...q, options: q.options.map(o => ({ ...o })), existing: true,
    }));
    state.screen = 'admin_newpaper';
    render();
    window.scrollTo(0, 0);
  } catch (e) { alert('Could not open that paper: ' + e.message); }
};

// Paper-level fields live in state so they survive re-renders
// (adding a question re-renders the whole page).
window.updatePaperField = function (field, value) { state.paperForm[field] = value; };

window.addBlankQuestion = function (type) {
  const q = { id: uid(), type, stem: '', correct: '', options: type === 'TF' ? [{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }] : [{ key: 'A', text: '' }, { key: 'B', text: '' }, { key: 'C', text: '' }, { key: 'D', text: '' }, { key: 'E', text: '' }] };
  state.newPaperQuestions.push(q);
  render();
};
window.removeQuestion = function (qid) { state.newPaperQuestions = state.newPaperQuestions.filter(q => q.id !== qid); render(); };
window.updateQField = function (qid, field, value) {
  const q = state.newPaperQuestions.find(q => q.id === qid);
  if (!q) return;
  if (field.startsWith('opt_')) { const key = field.split('_')[1]; const o = q.options.find(o => o.key === key); if (o) o.text = value; }
  else { q[field] = value; }
};
window.setCorrect = function (qid, key) { const q = state.newPaperQuestions.find(q => q.id === qid); if (q) { q.correct = key; render(); } };

// ---------- ADMIN: MTF groups ----------
window.addMTFGroup = function () {
  const gid = newGroupId();
  const mk = (order) => ({ id: uid(), type: 'TF', stem: '', correct: '', options: [{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }], groupId: gid, groupStem: '', groupOrder: order });
  state.newPaperQuestions.push(mk(0), mk(1));
  render();
};
window.addStatementToGroup = function (groupId) {
  const members = state.newPaperQuestions.filter(q => q.groupId === groupId);
  const groupStem = members.length ? members[0].groupStem : '';
  const ns = { id: uid(), type: 'TF', stem: '', correct: '', options: [{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }], groupId, groupStem, groupOrder: members.length };
  const lastIdx = state.newPaperQuestions.map(q => q.groupId).lastIndexOf(groupId);
  state.newPaperQuestions.splice(lastIdx + 1, 0, ns);
  render();
};
window.updateGroupStem = function (groupId, value) {
  state.newPaperQuestions.forEach(q => { if (q.groupId === groupId) q.groupStem = value; });
};
window.removeGroup = function (groupId) {
  state.newPaperQuestions = state.newPaperQuestions.filter(q => q.groupId !== groupId);
  render();
};

window.savePaper = async function () {
  const f = state.paperForm;
  const subjectId = f.subjectId;
  const name = (f.name || '').trim();
  const passMark = parseInt(f.passMark || '50');
  const timeLimitRaw = (f.timeLimit || '').toString().trim();
  const timeLimitMinutes = timeLimitRaw ? parseInt(timeLimitRaw) : null;
  const opensAt = f.opens ? new Date(f.opens).toISOString() : null;
  const closesAt = f.closes ? new Date(f.closes).toISOString() : null;
  if (opensAt && closesAt && new Date(closesAt) <= new Date(opensAt)) {
    alert('Closes at must be after opens at.');
    return;
  }
  if (!subjectId || !name) { alert('Choose a subject and give the paper a name.'); return; }
  if (isNaN(passMark) || passMark < 0 || passMark > 100) { alert('Pass mark must be a number from 0 to 100.'); return; }
  if (timeLimitRaw && (isNaN(timeLimitMinutes) || timeLimitMinutes <= 0)) { alert('Time limit must be a positive number of minutes, or left blank.'); return; }
  if (state.newPaperQuestions.length === 0) { alert('Add at least one question.'); return; }
  for (const q of state.newPaperQuestions) {
    if (!q.stem.trim() || !q.correct || q.options.some(o => !o.text.trim())) {
      alert('Every question or statement needs text, all options filled in, and a correct answer marked.');
      return;
    }
  }
  const groupIds = [...new Set(state.newPaperQuestions.filter(q => q.groupId).map(q => q.groupId))];
  for (const gid of groupIds) {
    const members = state.newPaperQuestions.filter(q => q.groupId === gid);
    if (!members[0].groupStem || !members[0].groupStem.trim()) {
      alert('Each MTF group needs a shared stem filled in.');
      return;
    }
  }
  const isEdit = !!state.editingPaperId;
  if (isEdit && state.editingAttemptCount > 0) {
    const removedCount = state.editingOriginalIds.filter(id => !state.newPaperQuestions.some(q => q.existing && q.id === id)).length;
    let msg = state.editingAttemptCount + ' student(s) have already submitted this paper. Their recorded scores will NOT change. '
      + 'Their review pages will show the updated questions and answer key.';
    if (removedCount > 0) msg += '\n\nYou are removing ' + removedCount + ' question/statement(s). Their answers to those will no longer be shown.';
    msg += '\n\nSave changes?';
    if (!confirm(msg)) return;
  }
  const orderCounters = {};
  state.newPaperQuestions.forEach(q => {
    if (q.groupId) {
      orderCounters[q.groupId] = (orderCounters[q.groupId] ?? -1) + 1;
      q.groupOrder = orderCounters[q.groupId];
    }
  });
  const fields = { subjectId, name, passMark, timeLimitMinutes, opensAt, closesAt, resultsAfterClose: !!f.resultsAfterClose, locked: formLocked(f) };
  state.busy = true; render();
  try {
    if (isEdit) {
      await db.updatePaper(state.editingPaperId, fields);
      await db.saveEditedQuestions(state.editingPaperId, state.newPaperQuestions, state.editingOriginalIds);
    } else {
      const paper = await db.createPaper(fields);
      await db.addQuestions(paper.id, state.newPaperQuestions);
    }
    analyticsCache = null; // make analytics refetch the updated paper
    state.busy = false;
    state.editingPaperId = null;
    alert(isEdit ? 'Changes saved.' : 'Paper saved.');
    state.screen = 'admin';
    state.adminTab = 'papers';
    render();
  } catch (e) {
    state.busy = false;
    alert(e.message);
    render();
  }
};

window.handleExcelUpload = function (evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const parsed = [];
      let lastGroupStem = null;
      let lastGroupId = null;
      let groupOrderCounter = 0;

      rows.forEach(row => {
        const norm = {};
        Object.keys(row).forEach(k => norm[k.trim().toLowerCase()] = row[k]);
        const rawType = (norm['type'] || 'SBA').toString().trim().toUpperCase();
        const type = rawType.startsWith('MTF') ? 'MTF' : (rawType.startsWith('T') ? 'TF' : 'SBA');
        const stem = (norm['stem'] || norm['question'] || '').toString().trim();
        if (!stem) return;

        if (type === 'MTF') {
          const statement = (norm['statement'] || '').toString().trim();
          if (!statement) return;
          if (stem !== lastGroupStem) {
            lastGroupStem = stem;
            lastGroupId = newGroupId();
            groupOrderCounter = 0;
          }
          const correctRaw = (norm['correct'] || norm['answer'] || '').toString().trim().toUpperCase();
          const correct = correctRaw.startsWith('T') ? 'A' : 'B';
          parsed.push({
            id: uid(), type: 'TF', stem: statement,
            options: [{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }],
            correct, groupId: lastGroupId, groupStem: stem, groupOrder: groupOrderCounter++,
          });
          return;
        }

        // A standalone SBA/TF row closes off any group we were tracking.
        lastGroupStem = null; lastGroupId = null;

        let options = [];
        if (type === 'TF') {
          options = [{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }];
        } else {
          ['a', 'b', 'c', 'd', 'e'].forEach(letter => {
            const val = norm['option' + letter] !== undefined ? norm['option' + letter] : norm[letter];
            if (val !== undefined && val !== '') { options.push({ key: letter.toUpperCase(), text: val.toString().trim() }); }
          });
        }
        const correctRaw = (norm['correct'] || norm['answer'] || '').toString().trim();
        let correct = '';
        if (type === 'TF') {
          correct = correctRaw.toUpperCase().startsWith('T') ? 'A' : (correctRaw.toUpperCase().startsWith('F') ? 'B' : correctRaw.toUpperCase());
        } else {
          correct = correctRaw.toUpperCase();
        }
        parsed.push({ id: uid(), type, stem, options, correct });
      });

      if (parsed.length === 0) { alert('No valid rows found. Check your column headers: Type, Stem, Statement (MTF), OptionA-E (SBA), Correct.'); return; }
      state.newPaperQuestions = state.newPaperQuestions.concat(parsed);
      render();
      alert(parsed.length + ' row(s) imported (MTF statements count individually). Review them below before saving.');
    } catch (err) {
      alert('Could not read that file: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
};

// ---------- ANALYTICS ----------
let analyticsCache = null; // { paperId, paper, all, dist }
window.setAnalyticsSubject = async function (subjId) {
  state.analyticsSubject = subjId;
  state.analyticsPaper = null;
  state.papers = subjId ? await db.fetchPapers(subjId) : [];
  render();
};
window.setAnalyticsPaper = async function (paperId) { state.analyticsPaper = paperId; state.analyticsExpandedQ = null; state.analyticsViewingAttempt = null; state.analyticsTypeFilter = 'all'; render(); };
window.toggleQuestionDetail = function (qid) {
  state.analyticsExpandedQ = state.analyticsExpandedQ === qid ? null : qid;
  render();
};

// ================= RENDER =================
function render() {
  const root = document.getElementById('root');
  if (state.screen === 'loading') { root.innerHTML = '<div class="center-wrap">Loading…</div>'; return; }
  if (state.screen === 'auth') { root.innerHTML = renderAuth(); return; }
  root.innerHTML = renderNav() + '<div class="wrap">' + renderScreen() + '</div>' + renderFooter();
  if (state.screen === 'review') { renderReviewDeferred(); }
  if (state.screen === 'analytics') { renderAnalyticsDeferred(); }
  if (state.screen === 'admin' && state.adminTab === 'analytics') { renderAnalyticsDeferred(); }
  if (state.screen === 'admin' && state.adminTab === 'papers') { renderAdminPapersDeferred(); }
}

function renderFooter() {
  return '<div class="footer-note">Signed in as ' + esc(state.currentUser ? state.currentUser.name : '') + '</div>';
}

const ICONS = {
  subjects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10"/><path d="M12 20V4"/><path d="M20 20v-7"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  signout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
};

function renderNav() {
  const u = state.currentUser;
  let tabs = [['home', 'Subjects', 'subjects'], ['analytics', 'Analytics', 'analytics']];
  if (u && u.role === 'admin') tabs.push(['admin', 'Admin', 'admin']);
  return '<div class="nav">'
    + '<div class="brand" onclick="goto(\'home\')">Papers</div>'
    + '<div class="links nav-desktop-links">'
    + tabs.map(t => '<button class="linkbtn ' + (state.screen === t[0] ? 'active' : '') + '" onclick="goto(\'' + t[0] + '\')">' + t[1] + '</button>').join('')
    + '<span class="who">' + esc(u.name) + ' · ' + esc(u.medNo) + '</span>'
    + '<button class="linkbtn" onclick="doLogout()">Sign out</button>'
    + '</div>'
    + '<div class="nav-mobile-actions">'
    + '<button class="icon-btn" onclick="doLogout()" aria-label="Sign out">' + ICONS.signout + '</button>'
    + '</div>'
    + '</div>'
    + '<nav class="bottom-tabbar">'
    + tabs.map(t => '<button class="tab-item ' + (state.screen === t[0] ? 'active' : '') + '" onclick="goto(\'' + t[0] + '\')">' + ICONS[t[2]] + '<span>' + t[1] + '</span></button>').join('')
    + '</nav>';
}

function renderScreen() {
  switch (state.screen) {
    case 'home': return renderHome();
    case 'papers': return renderPapers();
    case 'take': return renderTake();
    case 'review': return '<div id="reviewhost">Loading results…</div>';
    case 'paper_locked': return renderPaperLocked();
    case 'analytics': return renderAnalyticsShell();
    case 'admin': return renderAdmin();
    case 'admin_newpaper': return renderNewPaper();
    default: return '';
  }
}

function renderPaperLocked() {
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

// ---------- AUTH SCREEN ----------
function renderAuth() {
  const isLogin = state.authMode === 'login';
  return '<div class="center-wrap"><div style="max-width:400px; width:100%;">'
    + '<h1 style="text-align:center;">Papers</h1>'
    + '<p class="sub" style="text-align:center;">MCQ &amp; SBA exam practice</p>'
    + '<div class="card">'
    + '<div class="tabbar" style="justify-content:center;">'
    + '<button class="' + (isLogin ? 'active' : '') + '" onclick="setAuthMode(\'login\')">Log in</button>'
    + '<button class="' + (!isLogin ? 'active' : '') + '" onclick="setAuthMode(\'signup\')">Sign up</button>'
    + '</div>'
    + (state.errorMsg ? '<div class="err">' + esc(state.errorMsg) + '</div>' : '')
    + (isLogin ? renderLoginForm() : renderSignupForm())
    + '</div>'
    + '</div></div>';
}
function renderLoginForm() {
  return '<label class="flabel">MED number</label><input id="li_med" placeholder="e.g. 4892" autocapitalize="characters">'
    + '<label class="flabel">Password</label><input id="li_pass" type="password" placeholder="Password">'
    + '<button class="btn block" onclick="doLogin()" ' + (state.busy ? 'disabled' : '') + '>' + (state.busy ? 'Logging in…' : 'Log in') + '</button>';
}
function renderSignupForm() {
  const groups = state.settings.groups.length ? state.settings.groups : ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const batches = state.settings.batches.length ? state.settings.batches : ['30', '31', '32', '33', '34'];
  return '<label class="flabel">Name</label><input id="su_name" placeholder="e.g. Saman">'
    + '<label class="flabel">Group</label><select id="su_group">' + groups.map(g => '<option value="' + esc(g) + '">' + esc(g) + '</option>').join('') + '</select>'
    + '<label class="flabel">Batch</label><select id="su_batch">' + batches.map(b => '<option value="' + esc(b) + '">' + esc(b) + '</option>').join('') + '</select>'
    + '<label class="flabel">MED number</label><input id="su_med" placeholder="e.g. 4892" autocapitalize="characters">'
    + '<label class="flabel">Set a password</label><input id="su_pass" type="password" placeholder="At least 6 characters">'
    + '<button class="btn block" onclick="doSignup()" ' + (state.busy ? 'disabled' : '') + '>' + (state.busy ? 'Creating account…' : 'Create account') + '</button>';
}

// ---------- HOME ----------
function renderHome() {
  if (state.subjects.length === 0) {
    return '<h1>Subjects</h1><p class="sub">No subjects yet.</p><div class="empty"><div class="dot"></div>'
      + (state.currentUser.role === 'admin' ? 'Head to <b>Admin</b> to add your first subject and paper.' : 'Ask your admin to add a subject and paper to get started.') + '</div>';
  }
  return '<h1>Subjects</h1><p class="sub">Choose a subject to see its papers.</p>'
    + '<div class="grid">' + state.subjects.map(s =>
      '<div class="tile" onclick="selectSubject(\'' + s.id + '\',\'' + esc(s.name).replace(/'/g, "\\'") + '\')">' + swatchFor(s.name) + '<div class="t">' + esc(s.name) + '</div><div class="d">View papers</div></div>'
    ).join('') + '</div>';
}

function paperTile(p) {
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

function renderPapers() {
  return '<div class="flex-between"><h1>' + esc(state.selectedSubject.name) + '</h1><span class="link-a" onclick="goto(\'home\')">← Subjects</span></div>'
    + '<p class="sub">Choose a paper to begin.</p>'
    + (state.papers.length === 0 ? '<div class="empty"><div class="dot"></div>No papers in this subject yet.</div>' :
      '<div class="grid">' + state.papers.map(paperTile).join('') + '</div>');
}

// ---------- TAKE ----------
function renderTake() {
  const screens = state.screens;
  const i = state.attemptIndex;
  const screen = screens[i];
  const totalItems = state.paperDetail.questions.length;
  const answeredCount = Object.keys(state.attemptAnswers).length;

  let body;
  if (screen.kind === 'single') {
    const q = screen.question;
    body = '<div class="qmeta">Question ' + (i + 1) + ' of ' + screens.length + ' · ' + q.type + '</div>'
      + '<div class="qstem">' + esc(q.stem) + '</div>';
    if (q.type === 'TF') {
      const ans = state.attemptAnswers[q.id];
      body += '<div style="display:flex; justify-content:center; margin:18px 0 6px;">'
        + '<div style="transform:scale(1.15);">' + segToggle(q.id, ans, 'selectAnswer') + '</div></div>';
    } else {
      body += q.options.map(o => {
        const sel = state.attemptAnswers[q.id] === o.key;
        return '<div class="opt ' + (sel ? 'selected' : '') + '" onclick="selectAnswer(\'' + q.id + '\',\'' + o.key + '\')">'
          + '<div class="key">' + o.key + '</div><div class="txt">' + esc(o.text) + '</div></div>';
      }).join('');
    }
  } else {
    body = '<div class="qmeta">Question ' + (i + 1) + ' of ' + screens.length + ' · MTF · ' + screen.items.length + ' statements</div>'
      + '<div class="group-stem">' + esc(screen.groupStem) + '</div>'
      + '<div class="group-sub">Mark each statement True or False. You can leave any of them blank.</div>'
      + screen.items.map(q => {
        const ans = state.attemptAnswers[q.id];
        return '<div class="mtf-row"><div class="mtf-stmt">' + esc(q.stem) + '</div>'
          + segToggle(q.id, ans, 'selectAnswer') + '</div>';
      }).join('');
  }

  return '<div class="flex-between"><h2>' + esc(state.paperDetail.name) + '</h2>'
    + '<div class="row" style="gap:10px; align-items:center;">'
    + (state.attemptDeadline ? '<span class="timer-pill' + ((state.attemptDeadline - serverNow()) < 60000 ? ' low' : '') + '">' + formatCountdown(state.attemptDeadline - serverNow()) + '</span>' : '')
    + (state.draftStatus === 'saving' ? '<span style="font-size:12px;color:var(--text2);">Saving…</span>' : (state.draftStatus === 'saved' ? '<span style="font-size:12px;color:var(--text2);">Saved</span>' : ''))
    + '<span style="font-size:13px;color:var(--text2);">' + answeredCount + ' / ' + totalItems + ' answered</span>'
    + '</div></div>'
    + (state.submitError ? '<div class="timeout-banner">' + esc(state.submitError) + '</div>' : '')
    + (state.busy ? '<div class="timeout-banner" style="background:var(--accent-tint); border-color:#cfe2fb; color:var(--accent);">Submitting…</div>' : '')
    + '<div class="progressbar"><div class="progressfill" style="width:' + ((i + 1) / screens.length * 100) + '%"></div></div>'
    + '<div class="' + (screen.kind === 'group' ? 'group-card' : 'qcard') + '">'
    + body
    + '<div class="row" style="margin-top:22px;">'
    + '<button class="btn secondary" onclick="prevQ()" ' + (i === 0 ? 'disabled' : '') + '>Previous</button>'
    + (i < screens.length - 1 ? '<button class="btn" onclick="nextQ()">Next</button>' : '<button class="btn" onclick="submitPaper()" ' + (state.busy ? 'disabled' : '') + '>Finish &amp; submit</button>')
    + '</div>'
    + '</div>'
    + '<div class="qgrid">' + screens.map((sc, idx) => {
      const isAnswered = sc.kind === 'single' ? !!state.attemptAnswers[sc.question.id] : sc.items.every(q => state.attemptAnswers[q.id]);
      const cls = idx === i ? 'current' : (isAnswered ? 'answered' : '');
      return '<div class="qdot ' + cls + '" onclick="gotoQIndex(' + idx + ')">' + (idx + 1) + '</div>';
    }).join('') + '</div>'
    + (answeredCount === totalItems ? '<button class="btn" style="margin-top:14px;" onclick="submitPaper()" ' + (state.busy ? 'disabled' : '') + '>Finish &amp; submit</button>' : '');
}

// ---------- REVIEW ----------
function renderAttemptBody(screens, attempt, dist, allCount) {
  let html = '<div class="qgrid">' + screens.map((screen, idx) => {
    let cls;
    if (screen.kind === 'single') {
      cls = attempt.answers[screen.question.id] === screen.question.correct ? 'correct' : 'wrong';
    } else {
      const net = screenEarnedMarks(screen, attempt.answers);
      const max = screenMaxMarks(screen);
      cls = net === max ? 'correct' : (net === 0 ? 'wrong' : '');
    }
    return '<div class="qdot ' + cls + '" onclick="document.getElementById(\'rq_' + idx + '\').scrollIntoView({behavior:\'smooth\',block:\'center\'})">' + (idx + 1) + '</div>';
  }).join('') + '</div>';

  screens.forEach((screen, idx) => {
    if (screen.kind === 'single') {
      const q = screen.question;
      const yourAns = attempt.answers[q.id];
      const gotIt = yourAns === q.correct;
      html += '<div class="qcard" id="rq_' + idx + '" style="margin-bottom:14px;">'
        + '<div class="qmeta">Question ' + (idx + 1) + ' · ' + q.type + ' · ' + (gotIt ? '<span style="color:var(--success);">Correct</span>' : (yourAns ? '<span style="color:var(--danger);">Incorrect</span>' : '<span style="color:var(--text2);">Not answered</span>')) + '</div>'
        + '<div class="qstem">' + esc(q.stem) + '</div>';
      if (q.type === 'TF') {
        const correctLabel = q.correct === 'A' ? 'True' : 'False';
        const yourLabel = yourAns === 'A' ? 'True' : (yourAns === 'B' ? 'False' : 'Not answered');
        const pillCls = !yourAns ? 'blank' : (gotIt ? 'correct' : 'wrong');
        const count = (dist[q.id] && dist[q.id][q.correct]) || 0;
        const pctCorrectCohort = allCount > 0 ? Math.round(count / allCount * 100) : 0;
        html += '<div style="display:flex; justify-content:center; margin:16px 0 10px;"><span class="mtf-answer-pill ' + pillCls + '">Answer: ' + esc(yourLabel) + '</span></div>'
          + '<p class="sub" style="text-align:center; margin:0;">' + (pillCls !== 'correct' ? 'Correct answer: ' + correctLabel + ' · ' : '') + pctCorrectCohort + '% of the cohort got this right</p>';
      } else {
        html += q.options.map(o => {
          let cls = '';
          if (o.key === q.correct) cls = 'correct';
          else if (o.key === yourAns) cls = 'wrong';
          const count = (dist[q.id] && dist[q.id][o.key]) || 0;
          const p = allCount > 0 ? Math.round(count / allCount * 100) : 0;
          return '<div class="opt ' + cls + '">'
            + '<div class="key">' + o.key + '</div>'
            + '<div class="txt">' + esc(o.text) + '<div class="bar-track"><div class="bar-fill" style="width:' + p + '%; background:' + (o.key === q.correct ? '#34c759' : '#c7c7cc') + ';"></div></div></div>'
            + '<div class="pct">' + p + '%</div></div>';
        }).join('');
      }
      html += '</div>';
    } else {
      const n = screen.items.length;
      const net = screenEarnedMarks(screen, attempt.answers);
      const max = screenMaxMarks(screen);
      const netClass = net === max ? 'good' : (net === 0 ? 'low' : 'mid');
      html += '<div class="group-card" id="rq_' + idx + '" style="margin-bottom:14px;">'
        + '<div class="flex-between"><div class="qmeta" style="margin-bottom:0;">Question ' + (idx + 1) + ' · MTF · ' + n + ' statements</div>'
        + '<span class="net-score-pill ' + netClass + '">Net ' + net + ' / ' + max + '</span></div>'
        + '<div class="group-stem" style="margin-top:10px;">' + esc(screen.groupStem) + '</div>'
        + '<div class="net-strip">' + screen.items.map(q => {
          const a = attempt.answers[q.id];
          const chipCls = !a ? '' : (a === q.correct ? 'correct' : 'wrong');
          return '<div class="net-chip ' + chipCls + '"></div>';
        }).join('') + '</div>';
      screen.items.forEach(q => {
        const a = attempt.answers[q.id];
        const correctLabel = q.correct === 'A' ? 'True' : 'False';
        const yourLabel = a === 'A' ? 'True' : (a === 'B' ? 'False' : 'Not answered');
        const pillCls = !a ? 'blank' : (a === q.correct ? 'correct' : 'wrong');
        const count = (dist[q.id] && dist[q.id][q.correct]) || 0;
        const pctCorrectCohort = allCount > 0 ? Math.round(count / allCount * 100) : 0;
        html += '<div class="mtf-review-row"><div class="mtf-review-top">'
          + '<div class="mtf-review-text">' + esc(q.stem) + '</div>'
          + '<span class="mtf-answer-pill ' + pillCls + '">' + esc(yourLabel) + '</span>'
          + '</div>'
          + '<div class="mtf-review-meta">' + (pillCls !== 'correct' ? 'Correct answer: ' + correctLabel + ' · ' : '') + pctCorrectCohort + '% of cohort got this right</div>'
          + '</div>';
      });
      html += '</div>';
    }
  });
  return html;
}

function renderReviewDeferred() {
  const host = document.getElementById('reviewhost');
  if (!host || !state.reviewData) return;
  const { attempt, allCount, dist } = state.reviewData;
  const paper = state.paperDetail;
  // Admins always receive the answer key, so for their own attempt apply the
  // student rule here too; a test run then looks exactly like a student's.
  const heldBack = !paper.answersRevealed || (paper.resultsAfterClose && paperStatus(paper).open);
  if (heldBack) {
    // Results are held back until the paper closes (see results_after_close).
    let html = '<div class="flex-between"><h2>' + esc(paper.name) + '</h2><span class="link-a" onclick="goto(\'home\')">← Subjects</span></div>';
    if (state.timedOut) {
      html += '<div class="timeout-banner">Time ran out — your answers were submitted automatically.</div>';
      state.timedOut = false;
    }
    html += '<div class="lock-hero upcoming"><div class="lock-bubble">' + lockIcon(44) + '</div>'
      + '<div class="lock-title">Submitted</div>'
      + '<p class="lock-msg">Your answers were submitted ' + esc(new Date(attempt.submittedAt).toLocaleString()) + ' and can no longer be changed.</p>'
      + '<p class="lock-msg">Your score and the answers will be shown here '
      + (paper.closesAt ? 'after the paper closes on ' + esc(fmtWhen(paper.closesAt)) : 'once the paper is closed') + '.</p>'
      + '</div>';
    host.innerHTML = html;
    return;
  }
  const pct = Math.round(attempt.score / attempt.total * 100);
  const passed = pct >= (paper.passMark || 50);

  let singleCorrect = 0, singleTotal = 0, mtfNet = 0, mtfTotal = 0;
  state.screens.forEach(screen => {
    const max = screenMaxMarks(screen);
    const earned = screenEarnedMarks(screen, attempt.answers);
    if (screen.kind === 'single') {
      singleTotal += max;
      singleCorrect += earned;
    } else {
      mtfTotal += max;
      mtfNet += earned;
    }
  });

  let html = '<div class="flex-between"><h2>' + esc(paper.name) + ' — results</h2><span class="link-a" onclick="goto(\'home\')">← Subjects</span></div>';
  if (state.timedOut) {
    html += '<div class="timeout-banner">Time ran out — your answers were submitted automatically.</div>';
    state.timedOut = false;
  }
  html += '<div class="card" style="text-align:center;">'
    + '<div class="scorecircle" style="border-color:' + (passed ? '#c9f0d3' : '#fbdcda') + ';">'
    + '<div class="n">' + pct + '%</div><div class="l">' + attempt.score + ' / ' + attempt.total + '</div></div>'
    + '<span class="pill ' + (passed ? 'pass' : 'fail') + '">' + (passed ? 'Pass' : 'Below pass mark') + '</span>'
    + '<p class="sub" style="margin-top:14px;">Submitted ' + new Date(attempt.submittedAt).toLocaleString() + '. Answers are locked — you can review below but not change them.</p>';
  if (mtfTotal > 0 && singleTotal > 0) {
    html += '<div class="score-breakdown">'
      + '<div class="breakdown-chip"><b>' + singleCorrect + '/' + singleTotal + '</b>SBA &amp; TF</div>'
      + '<div class="breakdown-chip"><b>' + mtfNet + '/' + mtfTotal + '</b>MTF net (±1 marking)</div>'
      + '</div>';
  }
  html += '</div>';
  html += renderAttemptBody(state.screens, attempt, dist, allCount);
  host.innerHTML = html;
}

// ---------- ANALYTICS ----------
function renderAnalyticsShell() {
  return '<h1>Analytics</h1><p class="sub">Rankings and question difficulty, shared across everyone using this app.</p><div id="analyticshost">Loading…</div>';
}
async function renderAnalyticsDeferred() {
  const host = document.getElementById('analyticshost');
  if (!host) return;
  if (state.subjects.length === 0) state.subjects = await db.fetchSubjects();
  host.innerHTML = '<div class="card">'
    + '<label class="flabel">Subject</label>'
    + '<select onchange="setAnalyticsSubject(this.value)">'
    + '<option value="">Select a subject</option>'
    + state.subjects.map(s => '<option value="' + s.id + '" ' + (state.analyticsSubject === s.id ? 'selected' : '') + '>' + esc(s.name) + '</option>').join('')
    + '</select>'
    + (state.analyticsSubject ? renderAnalyticsPaperSelect() : '')
    + '</div>'
    + '<div id="analyticsresult"></div>';
  if (state.analyticsSubject && state.analyticsPaper) { await renderAnalyticsResult(); }
}
function renderAnalyticsPaperSelect() {
  return '<label class="flabel">Paper</label><select onchange="setAnalyticsPaper(this.value)">'
    + '<option value="">Select a paper</option>'
    + state.papers.map(p => '<option value="' + p.id + '" ' + (state.analyticsPaper === p.id ? 'selected' : '') + '>' + esc(p.name) + '</option>').join('')
    + '</select>';
}
window.viewStudentAttempt = function (userId) {
  state.analyticsViewingAttempt = userId;
  render();
};
window.setAnalyticsTypeFilter = function (t) {
  state.analyticsTypeFilter = t;
  render();
};

async function renderAnalyticsResult() {
  const resHost = document.getElementById('analyticsresult');
  if (!resHost) return;
  let paper, all, dist;
  if (analyticsCache && analyticsCache.paperId === state.analyticsPaper) {
    ({ paper, all, dist } = analyticsCache);
  } else {
    resHost.innerHTML = 'Loading…';
    paper = await db.fetchPaperWithQuestions(state.analyticsPaper);
    all = await db.fetchAllAttempts(state.analyticsPaper);
    dist = {};
    paper.questions.forEach(q => { dist[q.id] = {}; q.options.forEach(o => dist[q.id][o.key] = 0); });
    all.forEach(a => { paper.questions.forEach(q => { const ans = a.answers[q.id]; if (ans && dist[q.id][ans] !== undefined) dist[q.id][ans]++; }); });
    analyticsCache = { paperId: state.analyticsPaper, paper, all, dist };
  }
  const isAdmin = state.currentUser.role === 'admin';
  if (!isAdmin && (paper.questions.length === 0 || !paper.answersRevealed)) {
    resHost.innerHTML = '<div class="empty"><div class="dot"></div>Results for this paper will be available once it has closed'
      + (paper.questions.length === 0 ? ', for papers you have taken' : '') + '.</div>';
    return;
  }
  if (all.length === 0) { resHost.innerHTML = '<div class="empty"><div class="dot"></div>No one has completed this paper yet.</div>'; return; }

  // ---- Individual student attempt viewer (admin only) ----
  if (isAdmin && state.analyticsViewingAttempt) {
    const a = all.find(x => x.userId === state.analyticsViewingAttempt);
    if (!a) { state.analyticsViewingAttempt = null; }
    else {
      const pct = Math.round(a.score / a.total * 100);
      const passed = pct >= paper.passMark;
      const screens = groupConsecutive(paper.questions);
      let html = '<div class="card"><div class="flex-between">'
        + '<div><h2 style="margin-bottom:2px;">' + esc(a.name) + '</h2><p class="sub" style="margin:0;">' + esc(a.medNo) + ' · Group ' + esc(a.group) + '</p></div>'
        + '<span class="link-a" onclick="viewStudentAttempt(null)">← Back to leaderboard</span>'
        + '</div>'
        + '<div class="flex-between" style="margin-top:14px;">'
        + '<span class="pill ' + (passed ? 'pass' : 'fail') + '">' + (passed ? 'Pass' : 'Fail') + '</span>'
        + '<span style="font-weight:600;">' + a.score + ' / ' + a.total + ' (' + pct + '%)</span>'
        + '</div></div>';
      html += renderAttemptBody(screens, a, dist, all.length);
      resHost.innerHTML = html;
      return;
    }
  }

  all.sort((a, b) => b.score - a.score);
  let html = '<div class="card"><h2>Leaderboard</h2><p class="sub">' + all.length + ' attempt(s) · pass mark ' + paper.passMark + '%' + (isAdmin ? ' · tap a row to see that student\'s full paper' : '') + '</p><table><thead><tr><th>#</th><th>' + (isAdmin ? 'Name' : 'You') + '</th><th>Group</th><th>Score</th><th>Result</th></tr></thead><tbody>';
  all.forEach((a, idx) => {
    const pct = Math.round(a.score / a.total * 100);
    const passed = pct >= paper.passMark;
    const isMe = a.userId === state.currentUser.id;
    const nameShown = isAdmin ? esc(a.name) + ' (' + esc(a.medNo) + ')' : (isMe ? esc(a.name) + ' (you)' : 'Student ' + (idx + 1));
    const clickAttr = isAdmin ? ' onclick="viewStudentAttempt(\'' + a.userId + '\')" style="cursor:pointer;' + (isMe ? 'background:var(--accent-tint);' : '') + '"' : (isMe ? ' style="background:var(--accent-tint);"' : '');
    html += '<tr' + clickAttr + '><td>' + (idx + 1) + '</td><td>' + nameShown + '</td><td>' + esc(a.group) + '</td><td>' + a.score + '/' + a.total + ' (' + pct + '%)</td><td><span class="pill ' + (passed ? 'pass' : 'fail') + '">' + (passed ? 'Pass' : 'Fail') + '</span></td></tr>';
  });
  html += '</tbody></table></div>';

  // ---- Question difficulty, filterable by type ----
  const screens = groupConsecutive(paper.questions);
  const filters = [['all', 'All'], ['SBA', 'SBA'], ['TF', 'TF'], ['MTF', 'MTF']];
  html += '<div class="card"><h2>Question difficulty</h2><p class="sub">Ranked hardest first, by % who got it right.</p>'
    + '<div class="tabbar">' + filters.map(f => '<button class="' + (state.analyticsTypeFilter === f[0] ? 'active' : '') + '" onclick="setAnalyticsTypeFilter(\'' + f[0] + '\')">' + f[1] + '</button>').join('') + '</div>';

  if (state.analyticsTypeFilter === 'MTF') {
    const groups = screens.filter(s => s.kind === 'group').map(g => {
      const itemStats = g.items.map(q => {
        let c = 0; all.forEach(a => { if (a.answers[q.id] === q.correct) c++; });
        return { q, pct: Math.round(c / all.length * 100) };
      });
      const avg = Math.round(itemStats.reduce((sum, s) => sum + s.pct, 0) / itemStats.length);
      return { groupStem: g.groupStem, itemStats, avg };
    }).sort((a, b) => a.avg - b.avg);
    if (groups.length === 0) {
      html += '<p class="sub" style="margin:0;">No MTF questions in this paper.</p>';
    }
    groups.forEach(g => {
      html += '<div class="group-card" style="margin-bottom:14px; background:var(--surface);">'
        + '<div class="flex-between"><div class="group-stem" style="margin:0;">' + esc(g.groupStem) + '</div>'
        + '<span class="net-score-pill ' + (g.avg < 50 ? 'low' : (g.avg < 75 ? 'mid' : 'good')) + '">' + g.avg + '% avg</span></div>';
      g.itemStats.forEach(s => {
        const expanded = state.analyticsExpandedQ === s.q.id;
        html += '<div class="row" style="align-items:center; margin:10px 0 4px; cursor:pointer;" onclick="toggleQuestionDetail(\'' + s.q.id + '\')">'
          + '<div style="flex:1;"><div style="font-size:14px;">' + esc(s.q.stem) + '</div>'
          + '<div class="bar-track"><div class="bar-fill" style="width:' + s.pct + '%; background:' + (s.pct < 50 ? '#d93025' : (s.pct < 75 ? '#f2a900' : '#34c759')) + ';"></div></div></div>'
          + '<div style="width:50px; text-align:right; font-weight:600; font-size:13px;">' + s.pct + '%</div>'
          + '</div>';
        if (expanded) html += renderExpandedQuestionDetail(s.q, dist, all.length);
      });
      html += '</div>';
    });
  } else {
    const stats = screens.filter(s => s.kind === 'single' && (state.analyticsTypeFilter === 'all' || s.question.type === state.analyticsTypeFilter))
      .map(s => ({ id: s.question.id, q: s.question, label: s.question.stem, pct: (() => {
        let c = 0; all.forEach(a => { if (a.answers[s.question.id] === s.question.correct) c++; });
        return Math.round(c / all.length * 100);
      })() }))
      .sort((a, b) => a.pct - b.pct);
    if (stats.length === 0) {
      html += '<p class="sub" style="margin:0;">No questions of this type in this paper.</p>';
    }
    stats.forEach((s, idx) => {
      const expanded = state.analyticsExpandedQ === s.id;
      html += '<div class="row" style="align-items:center; margin-bottom:6px; cursor:pointer;" onclick="toggleQuestionDetail(\'' + s.id + '\')">'
        + '<div style="width:40px; font-weight:600; color:var(--text2); font-size:13px;">' + (idx + 1) + '</div>'
        + '<div style="flex:1;"><div style="font-size:14px;">' + esc(s.label.slice(0, 100)) + (s.label.length > 100 ? '…' : '') + '</div>'
        + '<div class="bar-track"><div class="bar-fill" style="width:' + s.pct + '%; background:' + (s.pct < 50 ? '#d93025' : (s.pct < 75 ? '#f2a900' : '#34c759')) + ';"></div></div></div>'
        + '<div style="width:50px; text-align:right; font-weight:600; font-size:13px;">' + s.pct + '%</div>'
        + '</div>';
      if (expanded) html += renderExpandedQuestionDetail(s.q, dist, all.length);
    });
  }
  html += '</div>';
  resHost.innerHTML = html;
}

function renderExpandedQuestionDetail(q, dist, allCount) {
  let html = '<div class="card" style="margin:2px 0 18px; background:var(--surface);">';
  if (q.groupStem) html += '<p class="sub" style="margin:0 0 10px;">Part of: ' + esc(q.groupStem) + '</p>';
  html += '<div class="qstem" style="font-size:16px; margin-bottom:14px;">' + esc(q.stem) + '</div>';
  html += q.options.map(o => {
    const count = (dist[q.id] && dist[q.id][o.key]) || 0;
    const p = allCount > 0 ? Math.round(count / allCount * 100) : 0;
    const cls = o.key === q.correct ? 'correct' : '';
    return '<div class="opt ' + cls + '"><div class="key">' + o.key + '</div><div class="txt">' + esc(o.text)
      + '<div class="bar-track"><div class="bar-fill" style="width:' + p + '%; background:' + (o.key === q.correct ? '#34c759' : '#c7c7cc') + ';"></div></div></div>'
      + '<div class="pct">' + p + '%</div></div>';
  }).join('');
  html += '</div>';
  return html;
}

// ---------- ADMIN ----------
// ---------- ADMIN: paper list / delete ----------
async function renderAdminPapersDeferred() {
  const host = document.getElementById('alladminpapers');
  if (!host) return;
  const papers = await db.fetchAllPapers();
  if (papers.length === 0) { host.innerHTML = '<p class="sub" style="margin:0;">No papers created yet.</p>'; return; }
  host.innerHTML = papers.map(p => {
    const st = paperStatus(p);
    let status, toggle = '';
    if (st.kind === 'upcoming') status = '<span class="status-pill locked">' + lockIcon(12) + ' Opens ' + esc(fmtWhen(p.opensAt)) + '</span>';
    else if (st.kind === 'closed') status = '<span class="status-pill locked">' + lockIcon(12) + ' Closed ' + esc(fmtWhen(p.closesAt)) + '</span>';
    else if (st.kind === 'locked') status = '<span class="status-pill locked">' + lockIcon(12) + ' Locked</span>';
    else status = '<span class="status-pill open">Open' + (st.scheduled && p.closesAt ? ' until ' + esc(fmtWhen(p.closesAt)) : '') + '</span>';
    if (st.kind !== 'closed') {
      toggle = p.isOpen
        ? '<button class="btn secondary" onclick="togglePaperOpen(\'' + p.id + '\', false)">Lock</button>'
        : '<button class="btn" onclick="togglePaperOpen(\'' + p.id + '\', true)">Unlock</button>';
    }
    return '<div class="admin-paper-row">'
      + '<div style="min-width:0;"><div style="font-weight:600; font-size:14px;">' + esc(p.name) + '</div>'
      + '<div style="font-size:13px; color:var(--text2); margin:1px 0 7px;">' + esc(p.subjectName || '—') + (p.timeLimitMinutes ? ', ' + p.timeLimitMinutes + ' min timer' : '') + ((p.opensAt || p.closesAt) ? ', scheduled' : '') + '</div>'
      + status + '</div>'
      + '<div class="row" style="flex-shrink:0; flex-wrap:wrap; justify-content:flex-end;">'
      + toggle
      + '<button class="btn secondary" onclick="editPaper(\'' + p.id + '\')">Edit</button>'
      + '<button class="btn danger" onclick="deletePaperConfirm(\'' + p.id + '\',\'' + esc(p.name).replace(/'/g, "\\'") + '\')">Delete</button>'
      + '</div>'
      + '</div>';
  }).join('');
}
window.deletePaperConfirm = async function (paperId, paperName) {
  if (!confirm('Delete "' + paperName + '"? This permanently removes all its questions and every student\'s attempt at it. This cannot be undone.')) return;
  try {
    await db.deletePaper(paperId);
    renderAdminPapersDeferred();
  } catch (e) { alert(e.message); }
};
window.deleteSubjectConfirm = async function (subjectId, subjectName) {
  if (!confirm('Delete "' + subjectName + '"? This permanently removes every paper, question, and student attempt under this subject. This cannot be undone.')) return;
  try {
    await db.deleteSubject(subjectId);
    state.subjects = await db.fetchSubjects();
    render();
    renderAdminPapersDeferred();
  } catch (e) { alert(e.message); }
};

function renderAdmin() {
  let html = '<h1>Admin</h1>'
    + '<div class="tabbar">'
    + '<button class="' + (state.adminTab === 'papers' ? 'active' : '') + '" onclick="setAdminTab(\'papers\')">Manage papers</button>'
    + '<button class="' + (state.adminTab === 'analytics' ? 'active' : '') + '" onclick="setAdminTab(\'analytics\')">Analytics</button>'
    + '</div>';
  if (state.adminTab === 'papers') {
    html += '<div class="card"><h2>Sign-up options</h2>'
      + '<p class="sub">Comma-separated. These drive the Group and Batch dropdowns on the sign-up form.</p>'
      + '<label class="flabel">Groups</label><input id="settings_groups" value="' + esc((state.settings.groups || []).join(', ')) + '">'
      + '<label class="flabel">Batches</label><input id="settings_batches" value="' + esc((state.settings.batches || []).join(', ')) + '">'
      + '<button class="btn" onclick="saveSettings()">Save</button>'
      + '</div>';
    html += '<div class="card"><h2>Subjects</h2>'
      + '<div class="row"><input id="newsubject" placeholder="e.g. Surgery" style="flex:1;"><button class="btn" onclick="createSubject()">Add</button></div>'
      + (state.subjects.length ? '<div style="margin-top:14px;">' + state.subjects.map(s =>
          '<div class="flex-between" style="padding:8px 0; border-bottom:1px solid #ececef;">'
          + '<span style="font-size:14px;">' + esc(s.name) + '</span>'
          + '<button class="btn danger" onclick="deleteSubjectConfirm(\'' + s.id + '\',\'' + esc(s.name).replace(/'/g, "\\'") + '\')">Delete</button>'
          + '</div>'
        ).join('') + '</div>' : '')
      + '</div>'
      + '<div class="card"><div class="flex-between"><h2>Papers</h2><button class="btn" onclick="startNewPaper()">+ New paper</button></div>'
      + '<p class="sub">Create a new paper manually or import questions from an Excel sheet.</p></div>'
      + '<div class="card"><h2>All papers</h2><div id="alladminpapers">Loading…</div></div>';
  } else {
    html += '<div id="analyticshost">Loading…</div>';
  }
  return html;
}

// New papers start locked unless they have a schedule to follow, until the
// admin sets the box themselves.
function formLocked(f) {
  return f.locked === null || f.locked === undefined ? !(f.opens || f.closes) : !!f.locked;
}

function renderNewPaper() {
  const f = state.paperForm;
  if (!f.subjectId && state.subjects[0]) f.subjectId = state.subjects[0].id; // match what the dropdown shows
  const isEdit = !!state.editingPaperId;
  let html = '<div class="flex-between"><h1>' + (isEdit ? 'Edit paper' : 'New paper') + '</h1><span class="link-a" onclick="goto(\'admin\')">← Cancel</span></div>'
    + (isEdit && state.editingAttemptCount > 0
      ? '<div class="timeout-banner">' + state.editingAttemptCount + ' student(s) have already submitted this paper. You can still edit it, but their recorded scores won\'t change. Fixing typos and timings is safe; changing answer keys or removing questions will make their review pages differ from their score.</div>'
      : '')
    + '<div class="card">'
    + '<label class="flabel">Subject</label><select onchange="updatePaperField(\'subjectId\',this.value)">'
    + state.subjects.map(s => '<option value="' + s.id + '" ' + (f.subjectId === s.id ? 'selected' : '') + '>' + esc(s.name) + '</option>').join('')
    + '</select>'
    + '<label class="flabel">Paper name</label><input placeholder="e.g. Mock 01" value="' + esc(f.name) + '" oninput="updatePaperField(\'name\',this.value)">'
    + '<label class="flabel">Pass mark (%)</label><input type="number" value="' + esc(f.passMark) + '" oninput="updatePaperField(\'passMark\',this.value)">'
    + '<label class="flabel">Time limit per student, in minutes (optional — leave blank for no limit)</label><input type="number" placeholder="e.g. 60" value="' + esc(f.timeLimit) + '" oninput="updatePaperField(\'timeLimit\',this.value)">'
    + '<label class="flabel">Opens at (optional — leave blank to make it available immediately)</label><input type="datetime-local" value="' + esc(f.opens) + '" onchange="updatePaperField(\'opens\',this.value)" oninput="updatePaperField(\'opens\',this.value)">'
    + '<label class="flabel">Closes at (optional — leave blank for no scheduled close)</label><input type="datetime-local" value="' + esc(f.closes) + '" onchange="updatePaperField(\'closes\',this.value)" oninput="updatePaperField(\'closes\',this.value)">'
    + '<p class="sub" style="margin:0 0 8px;">With open/close times set, the paper opens and closes on that schedule by itself (unless it is locked below). Without them, it is open whenever it is unlocked.</p>'
    + '<p class="sub" style="margin:0;">If both a time limit and a close time are set, whichever runs out first ends the attempt.'
    + (isEdit ? ' Changing timings affects students who open the paper from now on; anyone mid-attempt keeps their current deadline until they reload.' : '')
    + '</p>'
    + '<label class="check-row"><input type="checkbox" ' + (formLocked(f) ? 'checked' : '') + ' onchange="updatePaperField(\'locked\',this.checked)">'
    + '<span>Locked<br><small>Students can\'t open a locked paper, even during its scheduled time. Untick it (or press Unlock under Manage papers) to let them in.</small></span></label>'
    + '<label class="check-row"><input type="checkbox" ' + (f.resultsAfterClose ? 'checked' : '') + ' onchange="updatePaperField(\'resultsAfterClose\',this.checked)">'
    + '<span>Hide scores and answers until the paper closes<br><small>Recommended for exams: students who finish early can\'t share the answers. Leave unticked for practice papers so students see their results straight away.</small></span></label>'
    + '</div>'
    + '<div class="card"><h2>Import from Excel</h2>'
    + '<p class="sub">Columns: <b>Type</b> (SBA, TF, or MTF), <b>Stem</b>, <b>Statement</b> (MTF only — one row per statement, same Stem repeated for the whole group), <b>OptionA</b>–<b>OptionE</b> (SBA only), <b>Correct</b> (a letter for SBA, or True/False for TF and MTF rows).</p>'
    + '<div class="upload-box"><input type="file" accept=".xlsx,.xls,.csv" onchange="handleExcelUpload(event)"></div>'
    + '</div>'
    + '<div class="card"><div class="flex-between"><h2>Questions</h2>'
    + '<div class="row"><button class="btn secondary" onclick="addBlankQuestion(\'SBA\')">+ SBA</button><button class="btn secondary" onclick="addBlankQuestion(\'TF\')">+ TF</button><button class="btn secondary" onclick="addMTFGroup()">+ MTF group</button></div></div>';

  const grouped = groupConsecutive(state.newPaperQuestions);
  let qNum = 0;
  grouped.forEach(entry => {
    qNum++;
    if (entry.kind === 'single') {
      const q = entry.question;
      html += '<div class="questionrow"><div class="flex-between"><span class="badge">' + q.type + ' · Q' + qNum + '</span><span class="link-a" onclick="removeQuestion(\'' + q.id + '\')">Remove</span></div>'
        + '<textarea placeholder="Question stem" oninput="updateQField(\'' + q.id + '\',\'stem\',this.value)">' + esc(q.stem) + '</textarea>';
      q.options.forEach(o => {
        const isCorrect = q.correct === o.key;
        html += '<div class="row" style="align-items:center; margin-bottom:8px;">'
          + '<div class="key" style="cursor:pointer; ' + (isCorrect ? 'background:#34c759;border-color:#34c759;color:#fff;' : '') + '" onclick="setCorrect(\'' + q.id + '\',\'' + o.key + '\')" title="Mark as correct">' + o.key + '</div>'
          + '<input style="margin:0; flex:1;" placeholder="Option ' + o.key + '" value="' + esc(o.text) + '" oninput="updateQField(\'' + q.id + '\',\'opt_' + o.key + '\',this.value)" ' + (q.type === 'TF' ? 'readonly' : '') + '>'
          + '</div>';
      });
      html += '<p class="sub" style="margin:0;">Click the letter circle to mark the correct answer' + (q.correct ? ' — currently <b>' + q.correct + '</b>' : '') + '.</p></div>';
    } else {
      html += '<div class="questionrow" style="border-color:var(--accent); border-width:1.5px;">'
        + '<div class="flex-between"><span class="badge" style="background:var(--accent-tint); color:var(--accent);">MTF group · Q' + qNum + ' · ' + entry.items.length + ' statements</span>'
        + '<span class="link-a" onclick="removeGroup(\'' + entry.groupId + '\')">Remove group</span></div>'
        + '<textarea placeholder="Shared stem for this group of statements" oninput="updateGroupStem(\'' + entry.groupId + '\',this.value)">' + esc(entry.groupStem) + '</textarea>';
      entry.items.forEach((q, idx) => {
        html += '<div class="row" style="align-items:center; margin-bottom:8px; gap:10px;">'
          + '<input style="flex:1; margin:0;" placeholder="Statement ' + (idx + 1) + '" value="' + esc(q.stem) + '" oninput="updateQField(\'' + q.id + '\',\'stem\',this.value)">'
          + segToggle(q.id, q.correct, 'setCorrect')
          + '<span class="link-a" onclick="removeQuestion(\'' + q.id + '\')" style="flex-shrink:0;">Remove</span>'
          + '</div>';
      });
      html += '<button class="btn secondary" onclick="addStatementToGroup(\'' + entry.groupId + '\')">+ Add statement</button>'
        + '</div>';
    }
  });
  html += (state.newPaperQuestions.length === 0 ? '<div class="empty">No questions yet — add one above or import an Excel file.</div>' : '')
    + '</div>'
    + '<button class="btn block" onclick="savePaper()" ' + (state.busy ? 'disabled' : '') + '>' + (state.busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Save paper')) + '</button>';
  return html;
}
