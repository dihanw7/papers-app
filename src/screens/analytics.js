// Rankings and per-question difficulty (also shown under Admin > Analytics).
import * as db from '../data/index.js';
import { cache, state } from '../state.js';
import { esc, fmtWhen, groupConsecutive } from '../lib/helpers.js';
import { render } from '../render.js';
import { renderAttemptBody } from './review.js';

// ---------- ANALYTICS ----------
window.setAnalyticsSubject = async function (subjId) {
  state.analyticsSubject = subjId;
  state.analyticsPaper = null;
  state.papers = subjId ? await db.fetchPapers(subjId) : [];
  render();
};
window.setAnalyticsPaper = async function (paperId) { cache.analytics = null; state.analyticsPaper = paperId; state.analyticsExpandedQ = null; state.analyticsViewingAttempt = null; state.analyticsTypeFilter = 'all'; render(); };
window.toggleQuestionDetail = function (qid) {
  state.analyticsExpandedQ = state.analyticsExpandedQ === qid ? null : qid;
  render();
};

// ---------- ANALYTICS ----------
export function renderAnalyticsShell() {
  return '<h1>Analytics</h1><p class="sub">Rankings and question difficulty, shared across everyone using this app.</p><div id="analyticshost">Loading…</div>';
}
export async function renderAnalyticsDeferred() {
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
export function renderAnalyticsPaperSelect() {
  return '<label class="flabel">Paper</label><select onchange="setAnalyticsPaper(this.value)">'
    + '<option value="">Select a paper</option>'
    + state.papers.map(p => '<option value="' + p.id + '" ' + (state.analyticsPaper === p.id ? 'selected' : '') + '>' + esc(p.name) + '</option>').join('')
    + '</select>';
}
export function renderInProgressCard(list) {
  const rows = list || [];
  let html = '<div class="card"><h2>In progress</h2><p class="sub">Started but not submitted yet.'
    + (rows.length ? ' Reset someone to clear their answers and timer so they can start again.' : '') + '</p>';
  if (rows.length === 0) return html + '<p class="sub" style="margin:0;">No one is part-way through this paper.</p></div>';
  html += rows.map(d => '<div class="member-row"><div class="member-main"><div style="min-width:0;">'
    + '<div style="font-weight:600; font-size:14px;">' + esc(d.name || '(no name)') + '</div>'
    + '<div class="member-sub">' + esc([d.medNo, d.group ? 'Group ' + d.group : ''].filter(Boolean).join(' · ')) + '</div>'
    + '<div class="member-sub">Started ' + esc(fmtWhen(d.startedAt)) + ' · ' + d.answered + ' answered · last saved ' + esc(fmtWhen(d.updatedAt)) + '</div>'
    + '</div><div class="row" style="flex-shrink:0;"><button class="btn secondary" onclick="resetStudentAttemptConfirm(\'' + d.userId + '\')">Reset</button></div>'
    + '</div></div>').join('');
  return html + '</div>';
}

window.resetStudentAttemptConfirm = async function (userId) {
  const paper = cache.analytics && cache.analytics.paper;
  if (!paper) return;
  const a = cache.analytics.all.find(x => x.userId === userId);
  const d = !a && (cache.analytics.inProgress || []).find(x => x.userId === userId);
  if (!a && !d) return;
  const who = a || d;
  const what = a
    ? 'Their submission (' + a.score + ' / ' + a.total + ') and answers will be permanently deleted'
    : 'Their unfinished attempt (' + d.answered + ' answered so far) and their timer will be cleared. If they have the paper open right now, they will lose those answers';
  if (!confirm('Reset ' + who.name + ' (' + who.medNo + ') on "' + paper.name + '"?\n\n'
    + what + ', and they can take the paper again from the start'
    + (paper.timeLimitMinutes ? ' with a fresh ' + paper.timeLimitMinutes + '-minute timer' : '')
    + ' while it is open. Everyone else\'s results are kept.\n\nThis cannot be undone.')) return;
  try {
    await db.resetStudentAttempt(paper.id, userId);
    cache.analytics = null;
    state.analyticsViewingAttempt = null;
    alert(who.name + '\'s attempt has been reset.');
    render();
  } catch (e) { alert(e.message); }
};

window.viewStudentAttempt = function (userId) {
  state.analyticsViewingAttempt = userId;
  render();
};
window.setAnalyticsTypeFilter = function (t) {
  state.analyticsTypeFilter = t;
  render();
};

export async function renderAnalyticsResult() {
  const resHost = document.getElementById('analyticsresult');
  if (!resHost) return;
  let paper, all, dist, inProgress;
  if (cache.analytics && cache.analytics.paperId === state.analyticsPaper) {
    ({ paper, all, dist, inProgress } = cache.analytics);
  } else {
    resHost.innerHTML = 'Loading…';
    paper = await db.fetchPaperWithQuestions(state.analyticsPaper);
    all = await db.fetchAllAttempts(state.analyticsPaper);
    dist = {};
    paper.questions.forEach(q => { dist[q.id] = {}; q.options.forEach(o => dist[q.id][o.key] = 0); });
    all.forEach(a => { paper.questions.forEach(q => { const ans = a.answers[q.id]; if (ans && dist[q.id][ans] !== undefined) dist[q.id][ans]++; }); });
    // Admins also see who has started but not submitted.
    inProgress = [];
    if (state.currentUser.role === 'admin') {
      try { inProgress = await db.fetchInProgress(state.analyticsPaper); } catch (e) { inProgress = []; }
    }
    cache.analytics = { paperId: state.analyticsPaper, paper, all, dist, inProgress };
  }
  const isAdmin = state.currentUser.role === 'admin';
  const inProgressCard = isAdmin ? renderInProgressCard(inProgress) : '';
  if (!isAdmin && (paper.questions.length === 0 || !paper.answersRevealed)) {
    resHost.innerHTML = '<div class="empty"><div class="dot"></div>Results for this paper will be available once it has closed'
      + (paper.questions.length === 0 ? ', for papers you have taken' : '') + '.</div>';
    return;
  }
  if (all.length === 0) { resHost.innerHTML = '<div class="empty"><div class="dot"></div>No one has completed this paper yet.</div>' + inProgressCard; return; }

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
        + '</div>'
        + '<div class="reset-student"><button class="btn secondary" onclick="resetStudentAttemptConfirm(\'' + a.userId + '\')">Reset this student\'s attempt</button>'
        + '<span class="sub" style="margin:0; font-size:13px;">Deletes their submission so they can take this paper again.</span></div>'
        + '</div>';
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
  html += inProgressCard;

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

export function renderExpandedQuestionDetail(q, dist, allCount) {
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
