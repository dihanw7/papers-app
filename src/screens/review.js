// Results page after a paper is submitted.
import * as db from '../data/index.js';
import { state } from '../state.js';
import { esc, fmtWhen, groupConsecutive, paperStatus } from '../lib/helpers.js';
import { screenEarnedMarks, screenMaxMarks } from '../lib/scoring.js';
import { lockIcon } from '../ui/components.js';

export async function buildReview(paperId, attempt) {
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

// ---------- REVIEW ----------
export function renderAttemptBody(screens, attempt, dist, allCount) {
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

export function renderReviewDeferred() {
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
