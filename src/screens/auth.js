// Log in, sign up and log out.
import * as db from '../data/index.js';
import { state } from '../state.js';
import { STAFF_GROUP, esc, friendlyAuthError } from '../lib/helpers.js';
import { COPYRIGHT } from '../ui/components.js';
import { render } from '../render.js';
import { cancelDraftSave, clearCountdown } from './take.js';

// ---------- AUTH ----------
// Switches the sign-up form between student and academic staff without
// re-rendering, so anything already typed stays put.
window.setSignupKind = function (kind) {
  state.signupKind = kind;
  document.querySelectorAll('.kind-btn').forEach(b => b.classList.toggle('selected', b.dataset.kind === kind));
  const fields = document.getElementById('su_student_fields');
  if (fields) fields.hidden = kind === 'staff';
};

window.doSignup = async function () {
  const staff = state.signupKind === 'staff';
  const name = document.getElementById('su_name').value.trim();
  // Academic staff don't belong to a group or batch.
  const group = staff ? STAFF_GROUP : document.getElementById('su_group').value;
  const batch = staff ? '' : document.getElementById('su_batch').value;
  const med = document.getElementById('su_med').value.trim().toUpperCase();
  const pass = document.getElementById('su_pass').value;
  if (!name || !group || (!staff && !batch) || !med || !pass) { state.errorMsg = 'Please fill in every field.'; render(); return; }
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
    state.currentUser = await db.fetchCurrentUser(result.user.id);
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
    state.currentUser = await db.fetchCurrentUser(result.user.id);
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
  if (state.screen === 'take' && !confirm('Log out in the middle of this paper? Your answers so far are saved, but your timer keeps running while you are logged out.')) return;
  clearCountdown();
  cancelDraftSave();
  await db.logOut();
  state.currentUser = null; state.screen = 'auth'; state.authMode = 'login'; state.errorMsg = '';
  render();
};

window.setAuthMode = function (m) { state.authMode = m; state.errorMsg = ''; render(); };

// ---------- AUTH SCREEN ----------
export function renderAuth() {
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
    + '<div class="copyright" style="text-align:center;">' + COPYRIGHT + '</div>'
    + '</div></div>';
}
export function renderLoginForm() {
  return '<label class="flabel">MED number</label><input id="li_med" placeholder="e.g. 4892" autocapitalize="characters">'
    + '<label class="flabel">Password</label><input id="li_pass" type="password" placeholder="Password">'
    + '<button class="btn block" onclick="doLogin()" ' + (state.busy ? 'disabled' : '') + '>' + (state.busy ? 'Logging in…' : 'Log in') + '</button>';
}
export function renderSignupForm() {
  const groups = state.settings.groups.length ? state.settings.groups : ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const batches = state.settings.batches.length ? state.settings.batches : ['30', '31', '32', '33', '34'];
  const staff = state.signupKind === 'staff';
  const kindBtn = (k, label) => '<button type="button" class="kind-btn' + (state.signupKind === k ? ' selected' : '') + '" data-kind="' + k + '" onclick="setSignupKind(\'' + k + '\')">' + label + '</button>';
  return '<label class="flabel">I am</label><div class="kind-toggle">' + kindBtn('student', 'A student') + kindBtn('staff', 'Academic staff') + '</div>'
    + '<label class="flabel">Name</label><input id="su_name" placeholder="e.g. Saman">'
    + '<div id="su_student_fields"' + (staff ? ' hidden' : '') + '>'
    + '<label class="flabel">Group</label><select id="su_group">' + groups.map(g => '<option value="' + esc(g) + '">' + esc(g) + '</option>').join('') + '</select>'
    + '<label class="flabel">Batch</label><select id="su_batch">' + batches.map(b => '<option value="' + esc(b) + '">' + esc(b) + '</option>').join('') + '</select>'
    + '</div>'
    + '<label class="flabel">MED number</label><input id="su_med" placeholder="e.g. 4892" autocapitalize="characters">'
    + '<label class="flabel">Set a password</label><input id="su_pass" type="password" placeholder="At least 6 characters">'
    + '<button class="btn block" onclick="doSignup()" ' + (state.busy ? 'disabled' : '') + '>' + (state.busy ? 'Creating account…' : 'Create account') + '</button>';
}
