// Admin > Members: search, edit, reset passwords, delete accounts.
import * as db from '../data/index.js';
import { cache, state } from '../state.js';
import { STAFF_GROUP, esc, fmtDate } from '../lib/helpers.js';

// ---------- ADMIN: members ----------

export async function renderMembersDeferred(forceReload) {
  const host = document.getElementById('membershost');
  if (!host) return;
  if (state.members === null || forceReload) {
    try { state.members = await db.fetchMembers(); }
    catch (e) { host.innerHTML = '<p class="sub" style="margin:12px 0 0;">Could not load members: ' + esc(e.message) + '</p>'; return; }
  }
  const q = state.memberSearch.trim().toLowerCase();
  const list = state.members.filter(m => !q || [m.name, m.medNo, m.group, m.batch].some(v => (v || '').toLowerCase().includes(q)));
  const countEl = document.getElementById('membercount');
  if (countEl) countEl.textContent = (q ? list.length + ' of ' : '') + state.members.length + ' member' + (state.members.length === 1 ? '' : 's');
  if (list.length === 0) { host.innerHTML = '<p class="sub" style="margin:14px 0 0;">' + (q ? 'No one matches that search.' : 'No one has signed up yet.') + '</p>'; return; }
  host.innerHTML = list.map(renderMemberRow).join('');
}
export function renderMemberRow(m) {
  const isMe = m.id === state.currentUser.id;
  const editing = state.memberEditing === m.id;
  const details = [m.medNo, m.group ? (m.group === STAFF_GROUP ? STAFF_GROUP : 'Group ' + m.group) : '', m.batch ? 'Batch ' + m.batch : ''].filter(Boolean).join(' · ');
  let html = '<div class="member-row">'
    + '<div class="member-main"><div style="min-width:0;">'
    + '<div style="font-weight:600; font-size:14px;">' + esc(m.name || '(no name)') + (isMe ? ' (you)' : '')
    + (m.role === 'admin' ? ' <span class="pill locked" style="margin-left:4px;">Admin</span>' : '') + '</div>'
    + '<div class="member-sub">' + esc(details) + '</div>'
    + '<div class="member-sub">' + m.attemptCount + ' paper' + (m.attemptCount === 1 ? '' : 's') + ' submitted · joined ' + esc(fmtDate(m.createdAt)) + ' · ' + (m.lastSignInAt ? 'last signed in ' + esc(fmtDate(m.lastSignInAt)) : 'never signed in') + '</div>'
    + '</div>'
    + '<div class="row" style="flex-shrink:0;">'
    + '<button class="btn secondary" onclick="toggleMemberEdit(\'' + m.id + '\')">' + (editing ? 'Close' : 'Edit') + '</button>'
    + (isMe ? '' : '<button class="btn danger" onclick="deleteMemberConfirm(\'' + m.id + '\')">Delete</button>')
    + '</div></div>';
  if (editing) {
    const opts = (list, cur) => {
      const all = list.includes(cur) || !cur ? list : [cur, ...list];
      return all.map(v => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
    };
    html += '<div class="member-edit">'
      + '<label class="flabel">Name</label><input id="me_name" value="' + esc(m.name) + '">'
      + '<div class="row"><div style="flex:1;"><label class="flabel">Group</label><select id="me_group">' + opts([...(state.settings.groups || []), STAFF_GROUP], m.group) + '</select></div>'
      + '<div style="flex:1;"><label class="flabel">Batch</label><select id="me_batch">' + opts(state.settings.batches || [], m.batch) + '</select></div></div>'
      + '<label class="flabel">Role</label><select id="me_role"' + (isMe ? ' disabled' : '') + '>'
      + '<option value="student"' + (m.role === 'student' ? ' selected' : '') + '>Student</option>'
      + '<option value="admin"' + (m.role === 'admin' ? ' selected' : '') + '>Admin — can create, edit and delete papers and manage members</option></select>'
      + '<button class="btn" onclick="saveMember(\'' + m.id + '\')">Save details</button>'
      + '<label class="flabel" style="margin-top:18px;">New password</label>'
      + '<div class="row"><input id="me_pw" type="text" autocomplete="off" placeholder="At least 6 characters" style="flex:1;">'
      + '<button class="btn secondary" onclick="setMemberPassword(\'' + m.id + '\')">Set password</button></div>'
      + '<p class="sub" style="margin:6px 0 0;">For students who forgot their password. Tell them the new one; they sign in with it straight away.</p>'
      + '</div>';
  }
  return html + '</div>';
}
window.setMemberSearch = function (v) { state.memberSearch = v; renderMembersDeferred(); };
window.toggleMemberEdit = function (id) { state.memberEditing = state.memberEditing === id ? null : id; renderMembersDeferred(); };
window.saveMember = async function (id) {
  const val = (el) => document.getElementById(el).value;
  const role = val('me_role');
  const m = state.members.find(x => x.id === id);
  if (m && role !== m.role && !confirm(role === 'admin' ? 'Make ' + m.name + ' an admin? They will be able to edit and delete papers and manage members.' : 'Remove admin access from ' + m.name + '?')) return;
  try {
    const group = val('me_group');
    await db.updateMember(id, { name: val('me_name'), group, batch: group === STAFF_GROUP ? '' : val('me_batch'), role });
    state.memberEditing = null;
    await renderMembersDeferred(true);
  } catch (e) { alert(e.message); }
};
window.setMemberPassword = async function (id) {
  const pw = document.getElementById('me_pw').value;
  const m = state.members.find(x => x.id === id);
  if (pw.length < 6) { alert('Password must be at least 6 characters.'); return; }
  if (!confirm('Set a new password for ' + (m ? m.name : 'this member') + '? Their old password will stop working.')) return;
  try {
    await db.setMemberPassword(id, pw);
    document.getElementById('me_pw').value = '';
    alert('Password changed. Tell ' + (m ? m.name : 'them') + ' their new password: ' + pw);
  } catch (e) { alert(e.message); }
};
window.deleteMemberConfirm = async function (id) {
  const m = state.members.find(x => x.id === id);
  if (!m) return;
  const msg = 'Permanently delete ' + m.name + ' (' + m.medNo + ')?\n\n'
    + (m.attemptCount
      ? 'Their account and ' + m.attemptCount + ' submitted paper' + (m.attemptCount === 1 ? '' : 's') + ' (scores and answers) will be removed, including from leaderboards and analytics.'
      : 'Their account will be removed.')
    + ' This cannot be undone.';
  if (!confirm(msg)) return;
  try {
    await db.deleteMember(id);
    cache.analytics = null;
    if (state.memberEditing === id) state.memberEditing = null;
    await renderMembersDeferred(true);
  } catch (e) { alert(e.message); }
};
