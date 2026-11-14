// Admin: sign-up options, subjects, and the list of all papers.
import * as db from '../data/index.js';
import { ICON_ACCEPT, readIconFile } from '../subjectIcons.js';
import { cache, state } from '../state.js';
import { esc, fmtWhen, paperStatus } from '../lib/helpers.js';
import { lockIcon, subjectIcon } from '../ui/components.js';
import { render } from '../render.js';

// ---------- ADMIN: subjects / papers ----------
window.setAdminTab = function (t) { state.adminTab = t; if (t === 'members') state.members = null; if (t === 'analytics') cache.analytics = null; render(); };

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
    await db.createSubject(val, state.newSubjectIcon);
    state.subjects = await db.fetchSubjects();
    state.newSubjectIcon = null;
    render();
  } catch (e) { alert(e.message); }
};

// Reads an icon file chosen by the admin; calls done(value) if it's usable.
export async function readSvgFile(evt, done) {
  const file = evt.target.files && evt.target.files[0];
  evt.target.value = ''; // let the same file be picked again later
  if (!file) return;
  const { value, error } = await readIconFile(file);
  if (error) { alert(error); return; }
  done(value);
}
window.pickNewSubjectIcon = function (evt) {
  const name = document.getElementById('newsubject').value;
  readSvgFile(evt, (svg) => { state.newSubjectIcon = svg; render(); document.getElementById('newsubject').value = name; });
};
window.clearNewSubjectIcon = function () {
  const name = document.getElementById('newsubject').value;
  state.newSubjectIcon = null; render(); document.getElementById('newsubject').value = name;
};
window.uploadSubjectIcon = function (evt, subjectId) {
  readSvgFile(evt, async (svg) => {
    try {
      await db.setSubjectIcon(subjectId, svg);
      state.subjects = await db.fetchSubjects();
      render();
    } catch (e) { alert(e.message); }
  });
};
window.removeSubjectIcon = async function (subjectId) {
  if (!confirm('Remove this subject\'s uploaded icon? It will go back to the built-in icon (if its name matches one) or a letter.')) return;
  try {
    await db.setSubjectIcon(subjectId, null);
    state.subjects = await db.fetchSubjects();
    render();
  } catch (e) { alert(e.message); }
};

// ---------- ADMIN ----------
// ---------- ADMIN: paper list / delete ----------
export async function renderAdminPapersDeferred() {
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
      + '<button class="btn secondary" onclick="resetPaperConfirm(\'' + p.id + '\',\'' + esc(p.name).replace(/'/g, "\\'") + '\')">Reset</button>'
      + '<button class="btn danger" onclick="deletePaperConfirm(\'' + p.id + '\',\'' + esc(p.name).replace(/'/g, "\\'") + '\')">Delete</button>'
      + '</div>'
      + '</div>';
  }).join('');
}
window.resetPaperConfirm = async function (paperId, paperName) {
  let activity;
  try { activity = await db.fetchPaperActivity(paperId); }
  catch (e) { alert('Could not check this paper: ' + e.message); return; }
  if (!activity.submitted && !activity.inProgress) {
    alert('"' + paperName + '" has no submissions or in-progress attempts, so there is nothing to reset.');
    return;
  }
  const lines = [];
  if (activity.submitted) lines.push(activity.submitted + ' submitted attempt' + (activity.submitted === 1 ? '' : 's') + ' (scores and answers)');
  if (activity.inProgress) lines.push(activity.inProgress + ' attempt' + (activity.inProgress === 1 ? '' : 's') + ' in progress (anyone taking it right now loses their answers)');
  const typed = prompt('Reset "' + paperName + '"?\n\n'
    + 'This permanently deletes:\n• ' + lines.join('\n• ') + '\n\n'
    + 'Leaderboards and analytics for this paper will be emptied. The questions and settings are kept, and everyone can take it again from the start'
    + ' (if it is open, straight away).\n\n'
    + 'This cannot be undone. Type RESET to confirm.');
  if (typed === null) return;
  if (typed.trim().toUpperCase() !== 'RESET') { alert('Not reset — you need to type RESET to confirm.'); return; }
  try {
    const done = await db.resetPaper(paperId);
    cache.analytics = null;
    alert('"' + paperName + '" has been reset. Deleted ' + done.submitted + ' submitted and ' + done.inProgress + ' in-progress attempt(s).');
    render();
  } catch (e) { alert(e.message); }
};

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

export function renderAdmin() {
  let html = '<h1>Admin</h1>'
    + '<div class="tabbar">'
    + '<button class="' + (state.adminTab === 'papers' ? 'active' : '') + '" onclick="setAdminTab(\'papers\')">Manage papers</button>'
    + '<button class="' + (state.adminTab === 'analytics' ? 'active' : '') + '" onclick="setAdminTab(\'analytics\')">Analytics</button>'
    + '<button class="' + (state.adminTab === 'members' ? 'active' : '') + '" onclick="setAdminTab(\'members\')">Members</button>'
    + '</div>';
  if (state.adminTab === 'papers') {
    html += '<div class="card"><h2>Sign-up options</h2>'
      + '<p class="sub">Comma-separated. These drive the Group and Batch dropdowns on the sign-up form.</p>'
      + '<label class="flabel">Groups</label><input id="settings_groups" value="' + esc((state.settings.groups || []).join(', ')) + '">'
      + '<label class="flabel">Batches</label><input id="settings_batches" value="' + esc((state.settings.batches || []).join(', ')) + '">'
      + '<button class="btn" onclick="saveSettings()">Save</button>'
      + '</div>';
    const previewIcon = state.newSubjectIcon ? subjectIcon({ name: '', iconSvg: state.newSubjectIcon }, 'subject-icon small') : '';
    html += '<div class="card"><h2>Subjects</h2>'
      + '<p class="sub">Paediatrics, Surgery, Medicine, Gyn &amp; Obs and Psychiatry get a built-in icon from their name. For any other subject, or to replace one, upload an icon (SVG, PNG, JPG or WebP; a round image with a transparent background looks best).</p>'
      + '<div class="row"><input id="newsubject" placeholder="e.g. Surgery" style="flex:1;"><button class="btn" onclick="createSubject()">Add</button></div>'
      + '<div class="row" style="margin-top:8px; align-items:center;">' + previewIcon
      + '<label class="btn secondary file-btn">' + (state.newSubjectIcon ? 'Change icon' : 'Choose icon (optional)') + '<input type="file" accept="' + ICON_ACCEPT + '" onchange="pickNewSubjectIcon(event)"></label>'
      + (state.newSubjectIcon ? '<span class="link-a" onclick="clearNewSubjectIcon()">Remove</span>' : '')
      + '</div>'
      + (state.subjects.length ? '<div style="margin-top:14px;">' + state.subjects.map(s =>
          '<div class="subject-admin-row">'
          + '<div class="row" style="align-items:center; min-width:0;">' + subjectIcon(s, 'subject-icon small')
          + '<span style="font-size:14px;">' + esc(s.name) + '</span></div>'
          + '<div class="row" style="flex-shrink:0; justify-content:flex-end; flex-wrap:wrap;">'
          + '<label class="btn secondary file-btn">' + (s.iconSvg ? 'Replace icon' : 'Upload icon') + '<input type="file" accept="' + ICON_ACCEPT + '" onchange="uploadSubjectIcon(event, \'' + s.id + '\')"></label>'
          + (s.iconSvg ? '<button class="btn secondary" onclick="removeSubjectIcon(\'' + s.id + '\')">Remove icon</button>' : '')
          + '<button class="btn danger" onclick="deleteSubjectConfirm(\'' + s.id + '\',\'' + esc(s.name).replace(/'/g, "\\'") + '\')">Delete</button>'
          + '</div></div>'
        ).join('') + '</div>' : '')
      + '</div>'
      + '<div class="card"><div class="flex-between"><h2>Papers</h2><button class="btn" onclick="startNewPaper()">+ New paper</button></div>'
      + '<p class="sub">Create a new paper manually or import questions from an Excel sheet.</p></div>'
      + '<div class="card"><h2>All papers</h2><div id="alladminpapers">Loading…</div></div>';
  } else if (state.adminTab === 'members') {
    html += '<div class="card"><div class="flex-between"><h2 style="margin:0;">Members</h2><span id="membercount" class="sub" style="margin:0;"></span></div>'
      + '<input id="membersearch" placeholder="Search by name, MED no., group, batch" value="' + esc(state.memberSearch) + '" oninput="setMemberSearch(this.value)" style="margin-top:12px;">'
      + '<div id="membershost">Loading…</div></div>';
  } else {
    html += '<div id="analyticshost">Loading…</div>';
  }
  return html;
}
