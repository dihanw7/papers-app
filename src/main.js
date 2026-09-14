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
  attemptDeadline: null,
  timedOut: false,
  draftStatus: 'idle', // idle | saving | saved
};

function esc(s) {
  return (s === undefined || s === null) ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

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
function timerStorageKey(paperId) { return 'papers_attempt_start_' + paperId + '_' + state.currentUser.id; }
function clearCountdown() { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } }
function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}
function computeScore() {
  let totalPoints = 0, totalPossible = 0;
  state.screens.forEach(screen => {
    if (screen.kind === 'single') {
      totalPossible += 1;
      if (state.attemptAnswers[screen.question.id] === screen.question.correct) totalPoints += 1;
    } else {
      const n = screen.items.length;
      totalPossible += n;
      let correct = 0, wrong = 0;
      screen.items.forEach(q => {
        const ans = state.attemptAnswers[q.id];
        if (!ans) return;
        if (ans === q.correct) correct++; else wrong++;
      });
      totalPoints += Math.max(0, Math.min(n, correct - wrong));
    }
  });
  return { totalPoints, totalPossible };
}
async function finalizeSubmit(timedOut) {
  clearCountdown();
  clearTimeout(draftSaveTimeout);
  localStorage.removeItem(timerStorageKey(state.selectedPaper));
  const { totalPoints, totalPossible } = computeScore();
  state.busy = true; render();
  const attempt = await db.submitAttempt({
    paperId: state.selectedPaper, userId: state.currentUser.id,
    answers: state.attemptAnswers, score: totalPoints, total: totalPossible,
  });
  try { await db.deleteDraft(state.selectedPaper, state.currentUser.id); } catch (e) { /* non-fatal */ }
  state.busy = false;
  state.timedOut = timedOut;
  await buildReview(state.selectedPaper, {
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
  if (!paper.timeLimitMinutes) { state.attemptDeadline = null; return; }
  const key = timerStorageKey(paper.id);
  let startedAt = localStorage.getItem(key);
  if (!startedAt) {
    startedAt = Date.now().toString();
    localStorage.setItem(key, startedAt);
  }
  state.attemptDeadline = parseInt(startedAt, 10) + paper.timeLimitMinutes * 60000;
  if (Date.now() >= state.attemptDeadline) {
    autoSubmitOnTimeout();
    return;
  }
  countdownTimer = setInterval(() => {
    if (state.screen !== 'take') { clearCountdown(); return; }
    if (Date.now() >= state.attemptDeadline) { autoSubmitOnTimeout(); }
    else { render(); }
  }, 1000);
}

async function boot() {
  const session = await db.getSession();
  if (session) {
    try {
      const profile = await db.fetchMyProfile(session.user.id);
      state.currentUser = { id: profile.id, name: profile.name, group: profile.group, medNo: profile.med_no, role: profile.role };
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
  const group = document.getElementById('su_group').value.trim();
  const med = document.getElementById('su_med').value.trim().toUpperCase();
  const pass = document.getElementById('su_pass').value;
  if (!name || !group || !med || !pass) { state.errorMsg = 'Please fill in every field.'; render(); return; }
  if (pass.length < 6) { state.errorMsg = 'Password must be at least 6 characters.'; render(); return; }
  state.busy = true; state.errorMsg = ''; render();
  try {
    const result = await db.signUp({ name, group, medNo: med, password: pass });
    if (!result.session) {
      state.busy = false;
      state.errorMsg = 'Account created. If your admin has email confirmation turned on, ask them to disable it — otherwise try logging in now.';
      state.authMode = 'login';
      render();
      return;
    }
    const profile = await db.fetchMyProfile(result.user.id);
    state.currentUser = { id: profile.id, name: profile.name, group: profile.group, medNo: profile.med_no, role: profile.role };
    state.subjects = await db.fetchSubjects();
    state.busy = false;
    state.screen = 'home';
    render();
  } catch (e) {
    state.busy = false;
    state.errorMsg = e.message.includes('already registered') ? 'That MED number is already registered — try logging in instead.' : e.message;
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
    state.currentUser = { id: profile.id, name: profile.name, group: profile.group, medNo: profile.med_no, role: profile.role };
    state.subjects = await db.fetchSubjects();
    state.busy = false;
    state.screen = 'home';
    render();
  } catch (e) {
    state.busy = false;
    state.errorMsg = 'Incorrect MED number or password.';
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
  state.busy = false;
  if (existingAttempt) {
    await buildReview(paperId, {
      score: existingAttempt.score, total: existingAttempt.total,
      answers: existingAttempt.answers, submittedAt: existingAttempt.submitted_at,
    });
  } else {
    const draft = await db.fetchDraft(paperId, state.currentUser.id);
    state.attemptAnswers = (draft && draft.answers) ? draft.answers : {};
    state.attemptIndex = 0;
    state.screen = 'take';
    state.draftStatus = 'idle';
    startCountdownIfNeeded();
  }
  render();
};

// ---------- TAKE PAPER ----------
window.selectAnswer = function (qid, key) {
  if (state.attemptAnswers[qid] === key) { delete state.attemptAnswers[qid]; }
  else { state.attemptAnswers[qid] = key; }
  scheduleDraftSave();
  render();
};
window.gotoQIndex = function (i) { state.attemptIndex = i; render(); };
window.nextQ = function () { if (state.attemptIndex < state.screens.length - 1) { state.attemptIndex++; render(); } };
window.prevQ = function () { if (state.attemptIndex > 0) { state.attemptIndex--; render(); } };

window.submitPaper = async function () {
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
  const paper = (state.paperDetail && state.paperDetail.id === paperId) ? state.paperDetail : await db.fetchPaperWithQuestions(paperId);
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

window.startNewPaper = function () { state.newPaperQuestions = []; state.screen = 'admin_newpaper'; render(); };

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
  const gid = uid();
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

window.saveNewPaper = async function () {
  const subjectId = document.getElementById('np_subject').value;
  const name = document.getElementById('np_name').value.trim();
  const passMark = parseInt(document.getElementById('np_pass').value || '50');
  const timeLimitRaw = document.getElementById('np_timelimit').value.trim();
  const timeLimitMinutes = timeLimitRaw ? parseInt(timeLimitRaw) : null;
  if (!subjectId || !name) { alert('Choose a subject and give the paper a name.'); return; }
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
  const orderCounters = {};
  state.newPaperQuestions.forEach(q => {
    if (q.groupId) {
      orderCounters[q.groupId] = (orderCounters[q.groupId] ?? -1) + 1;
      q.groupOrder = orderCounters[q.groupId];
    }
  });
  state.busy = true; render();
  try {
    const paper = await db.createPaper({ subjectId, name, passMark, timeLimitMinutes });
    await db.addQuestions(paper.id, state.newPaperQuestions);
    state.busy = false;
    alert('Paper saved.');
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
            lastGroupId = uid();
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
window.setAnalyticsPaper = async function (paperId) { state.analyticsPaper = paperId; state.analyticsExpandedQ = null; render(); };
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

function renderNav() {
  const u = state.currentUser;
  let tabs = [['home', 'Subjects'], ['analytics', 'Analytics']];
  if (u && u.role === 'admin') tabs.push(['admin', 'Admin']);
  return '<div class="nav">'
    + '<div class="brand" onclick="goto(\'home\')">Papers</div>'
    + '<div class="links">'
    + tabs.map(t => '<button class="linkbtn ' + (state.screen === t[0] ? 'active' : '') + '" onclick="goto(\'' + t[0] + '\')">' + t[1] + '</button>').join('')
    + '<span class="who">' + esc(u.name) + ' · ' + esc(u.medNo) + '</span>'
    + '<button class="linkbtn" onclick="doLogout()">Sign out</button>'
    + '</div></div>';
}

function renderScreen() {
  switch (state.screen) {
    case 'home': return renderHome();
    case 'papers': return renderPapers();
    case 'take': return renderTake();
    case 'review': return '<div id="reviewhost">Loading results…</div>';
    case 'analytics': return renderAnalyticsShell();
    case 'admin': return renderAdmin();
    case 'admin_newpaper': return renderNewPaper();
    default: return '';
  }
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
  return '<label class="flabel">MED number</label><input id="li_med" placeholder="e.g. MED1234" autocapitalize="characters">'
    + '<label class="flabel">Password</label><input id="li_pass" type="password" placeholder="Password">'
    + '<button class="btn block" onclick="doLogin()" ' + (state.busy ? 'disabled' : '') + '>' + (state.busy ? 'Logging in…' : 'Log in') + '</button>';
}
function renderSignupForm() {
  return '<label class="flabel">Full name</label><input id="su_name" placeholder="Jane Smith">'
    + '<label class="flabel">Group</label><input id="su_group" placeholder="e.g. Group 3B">'
    + '<label class="flabel">MED number</label><input id="su_med" placeholder="e.g. MED1234" autocapitalize="characters">'
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

function renderPapers() {
  return '<div class="flex-between"><h1>' + esc(state.selectedSubject.name) + '</h1><span class="link-a" onclick="goto(\'home\')">← Subjects</span></div>'
    + '<p class="sub">Choose a paper to begin.</p>'
    + (state.papers.length === 0 ? '<div class="empty"><div class="dot"></div>No papers in this subject yet.</div>' :
      '<div class="grid">' + state.papers.map(p =>
        '<div class="tile" onclick="openPaper(\'' + p.id + '\')">' + swatchFor(p.name) + '<div class="t">' + esc(p.name) + '</div><div class="d">' + p.questionCount + ' questions · pass ' + p.passMark + '%' + (p.timeLimitMinutes ? ' · ' + p.timeLimitMinutes + ' min' : '') + '</div></div>'
      ).join('') + '</div>');
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
    + (state.paperDetail.timeLimitMinutes && state.attemptDeadline ? '<span class="timer-pill' + ((state.attemptDeadline - Date.now()) < 60000 ? ' low' : '') + '">' + formatCountdown(state.attemptDeadline - Date.now()) + '</span>' : '')
    + (state.draftStatus === 'saving' ? '<span style="font-size:12px;color:var(--text2);">Saving…</span>' : (state.draftStatus === 'saved' ? '<span style="font-size:12px;color:var(--text2);">Saved</span>' : ''))
    + '<span style="font-size:13px;color:var(--text2);">' + answeredCount + ' / ' + totalItems + ' answered</span>'
    + '</div></div>'
    + '<div class="progressbar"><div class="progressfill" style="width:' + ((i + 1) / screens.length * 100) + '%"></div></div>'
    + '<div class="' + (screen.kind === 'group' ? 'group-card' : 'qcard') + '">'
    + body
    + '<div class="row" style="margin-top:22px;">'
    + '<button class="btn secondary" onclick="prevQ()" ' + (i === 0 ? 'disabled' : '') + '>Previous</button>'
    + (i < screens.length - 1 ? '<button class="btn" onclick="nextQ()">Next</button>' : '<button class="btn" onclick="submitPaper()">Finish &amp; submit</button>')
    + '</div>'
    + '</div>'
    + '<div class="qgrid">' + screens.map((sc, idx) => {
      const isAnswered = sc.kind === 'single' ? !!state.attemptAnswers[sc.question.id] : sc.items.every(q => state.attemptAnswers[q.id]);
      const cls = idx === i ? 'current' : (isAnswered ? 'answered' : '');
      return '<div class="qdot ' + cls + '" onclick="gotoQIndex(' + idx + ')">' + (idx + 1) + '</div>';
    }).join('') + '</div>'
    + (answeredCount === totalItems ? '<button class="btn" style="margin-top:14px;" onclick="submitPaper()">Finish &amp; submit</button>' : '');
}

// ---------- REVIEW ----------
function renderReviewDeferred() {
  const host = document.getElementById('reviewhost');
  if (!host || !state.reviewData) return;
  const { attempt, allCount, dist } = state.reviewData;
  const paper = state.paperDetail;
  const pct = Math.round(attempt.score / attempt.total * 100);
  const passed = pct >= (paper.passMark || 50);

  let singleCorrect = 0, singleTotal = 0, mtfNet = 0, mtfTotal = 0;
  state.screens.forEach(screen => {
    if (screen.kind === 'single') {
      singleTotal += 1;
      if (attempt.answers[screen.question.id] === screen.question.correct) singleCorrect += 1;
    } else {
      const n = screen.items.length;
      mtfTotal += n;
      let c = 0, w = 0;
      screen.items.forEach(q => { const a = attempt.answers[q.id]; if (!a) return; if (a === q.correct) c++; else w++; });
      mtfNet += Math.max(0, Math.min(n, c - w));
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

  html += '<div class="qgrid">' + state.screens.map((screen, idx) => {
    let cls;
    if (screen.kind === 'single') {
      cls = attempt.answers[screen.question.id] === screen.question.correct ? 'correct' : 'wrong';
    } else {
      const n = screen.items.length;
      let c = 0, w = 0;
      screen.items.forEach(q => { const a = attempt.answers[q.id]; if (!a) return; if (a === q.correct) c++; else w++; });
      const net = Math.max(0, Math.min(n, c - w));
      cls = net === n ? 'correct' : (net === 0 ? 'wrong' : '');
    }
    return '<div class="qdot ' + cls + '" onclick="document.getElementById(\'rq_' + idx + '\').scrollIntoView({behavior:\'smooth\',block:\'center\'})">' + (idx + 1) + '</div>';
  }).join('') + '</div>';

  state.screens.forEach((screen, idx) => {
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
        html += '<div style="display:flex; justify-content:center; margin:16px 0 10px;"><span class="mtf-answer-pill ' + pillCls + '">Your answer: ' + esc(yourLabel) + '</span></div>'
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
      let c = 0, w = 0;
      screen.items.forEach(q => { const a = attempt.answers[q.id]; if (!a) return; if (a === q.correct) c++; else w++; });
      const net = Math.max(0, Math.min(n, c - w));
      const netClass = net === n ? 'good' : (net === 0 ? 'low' : 'mid');
      html += '<div class="group-card" id="rq_' + idx + '" style="margin-bottom:14px;">'
        + '<div class="flex-between"><div class="qmeta" style="margin-bottom:0;">Question ' + (idx + 1) + ' · MTF · ' + n + ' statements</div>'
        + '<span class="net-score-pill ' + netClass + '">Net ' + net + ' / ' + n + '</span></div>'
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
  if (all.length === 0) { resHost.innerHTML = '<div class="empty"><div class="dot"></div>No one has completed this paper yet.</div>'; return; }
  all.sort((a, b) => b.score - a.score);
  const isAdmin = state.currentUser.role === 'admin';
  let html = '<div class="card"><h2>Leaderboard</h2><p class="sub">' + all.length + ' attempt(s) · pass mark ' + paper.passMark + '%</p><table><thead><tr><th>#</th><th>' + (isAdmin ? 'Name' : 'You') + '</th><th>Group</th><th>Score</th><th>Result</th></tr></thead><tbody>';
  all.forEach((a, idx) => {
    const pct = Math.round(a.score / a.total * 100);
    const passed = pct >= paper.passMark;
    const isMe = a.userId === state.currentUser.id;
    const nameShown = isAdmin ? esc(a.name) + ' (' + esc(a.medNo) + ')' : (isMe ? esc(a.name) + ' (you)' : 'Student ' + (idx + 1));
    html += '<tr' + (isMe ? ' style="background:var(--accent-tint);"' : '') + '><td>' + (idx + 1) + '</td><td>' + nameShown + '</td><td>' + esc(a.group) + '</td><td>' + a.score + '/' + a.total + ' (' + pct + '%)</td><td><span class="pill ' + (passed ? 'pass' : 'fail') + '">' + (passed ? 'Pass' : 'Fail') + '</span></td></tr>';
  });
  html += '</tbody></table></div>';
  const stats = paper.questions.map(q => {
    let correctCount = 0;
    all.forEach(a => { if (a.answers[q.id] === q.correct) correctCount++; });
    const label = q.groupStem ? (q.groupStem + ' — ' + q.stem) : q.stem;
    return { id: q.id, q, label, pct: Math.round(correctCount / all.length * 100) };
  }).sort((a, b) => a.pct - b.pct);
  html += '<div class="card"><h2>Question difficulty</h2><p class="sub">Ranked hardest first, by % who got it right. Click a question to see it in full. MTF statements are ranked individually.</p>';
  stats.forEach((s, idx) => {
    const expanded = state.analyticsExpandedQ === s.id;
    html += '<div class="row" style="align-items:center; margin-bottom:6px; cursor:pointer;" onclick="toggleQuestionDetail(\'' + s.id + '\')">'
      + '<div style="width:40px; font-weight:600; color:var(--text2); font-size:13px;">' + (idx + 1) + '</div>'
      + '<div style="flex:1;"><div style="font-size:14px;">' + esc(s.label.slice(0, 100)) + (s.label.length > 100 ? '…' : '') + '</div>'
      + '<div class="bar-track"><div class="bar-fill" style="width:' + s.pct + '%; background:' + (s.pct < 50 ? '#d93025' : (s.pct < 75 ? '#f2a900' : '#34c759')) + ';"></div></div></div>'
      + '<div style="width:50px; text-align:right; font-weight:600; font-size:13px;">' + s.pct + '%</div>'
      + '</div>';
    if (expanded) {
      html += renderExpandedQuestionDetail(s.q, dist, all.length);
    }
  });
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
  host.innerHTML = papers.map(p =>
    '<div class="flex-between" style="padding:10px 0; border-bottom:1px solid #ececef;">'
    + '<div><div style="font-weight:600; font-size:14px;">' + esc(p.name) + '</div>'
    + '<div class="sub" style="margin:0;">' + esc(p.subjectName || '—') + (p.timeLimitMinutes ? ' · ' + p.timeLimitMinutes + ' min limit' : '') + '</div></div>'
    + '<button class="btn danger" onclick="deletePaperConfirm(\'' + p.id + '\',\'' + esc(p.name).replace(/'/g, "\\'") + '\')">Delete</button>'
    + '</div>'
  ).join('');
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

function renderNewPaper() {
  let html = '<div class="flex-between"><h1>New paper</h1><span class="link-a" onclick="goto(\'admin\')">← Cancel</span></div>'
    + '<div class="card">'
    + '<label class="flabel">Subject</label><select id="np_subject">'
    + state.subjects.map(s => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('')
    + '</select>'
    + '<label class="flabel">Paper name</label><input id="np_name" placeholder="e.g. Mock 01">'
    + '<label class="flabel">Pass mark (%)</label><input id="np_pass" type="number" value="50">'
    + '<label class="flabel">Time limit in minutes (optional — leave blank for no limit)</label><input id="np_timelimit" type="number" placeholder="e.g. 60">'
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
    + '<button class="btn block" onclick="saveNewPaper()">Save paper</button>';
  return html;
}
