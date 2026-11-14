// Taking a paper: timer, autosave, answering, and submitting.
import * as db from '../data/index.js';
import { state } from '../state.js';
import { esc } from '../lib/helpers.js';
import { computeScore } from '../lib/scoring.js';
import { segToggle } from '../ui/components.js';
import { render } from '../render.js';
import { buildReview } from './review.js';

// ---------- Timed papers ----------
let countdownTimer = null;
let draftSaveTimeout = null;
export function scheduleDraftSave() {
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
// Drops a pending autosave (used on logout).
export function cancelDraftSave() { clearTimeout(draftSaveTimeout); }
// Deadlines come from the server, so count down against the server's clock
// (a student changing their device clock doesn't buy extra time).
export function serverNow() { return Date.now() + state.clockOffset; }
export function timerStorageKey(paperId) { return 'papers_attempt_start_' + paperId + '_' + state.currentUser.id; }
export function clearCountdown() { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } }
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}

let submitInFlight = false;
export async function finalizeSubmit(timedOut) {
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
    submitInFlight = false;
    state.busy = false;
    if (/was reset|not been started/i.test(e.message || '')) {
      // An admin reset this attempt while it was open. Nothing to retry:
      // send them back so reopening the paper starts a fresh attempt.
      alert('Your attempt at this paper was reset by an admin, so these answers could not be submitted. Open the paper again to start afresh.');
      state.answersLocked = false;
      await window.goto('papers');
      return;
    }
    // Network blip / server busy: keep everything, tell the student, retry.
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
export function autoSubmitOnTimeout() {
  if (state.screen !== 'take') return;
  finalizeSubmit(true);
}
export function startCountdownIfNeeded() {
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

// Starts (or resumes) the attempt and shows the questions.
export async function enterPaper(paperId, draft) {
  // Record the start time on the server (first open only) and sync clocks.
  let started = null;
  try {
    started = await db.startAttempt(paperId);
  } catch (e) {
    state.busy = false;
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
  state.busy = false;
  startCountdownIfNeeded();
  render();
}

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

// ---------- TAKE ----------
export function renderTake() {
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
