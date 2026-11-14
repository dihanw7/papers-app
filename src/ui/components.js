// Shared bits of markup: icons, subject tiles, toggles, nav bar and footer.
import { subjectIconSrc } from '../subjectIcons.js';
import { state } from '../state.js';
import { esc } from '../lib/helpers.js';

export function lockIcon(size) {
  return '<svg class="lock-svg" width="' + size + '" height="' + size + '" viewBox="0 0 48 48" aria-hidden="true">'
    + '<path d="M15 21v-5.5a9 9 0 0 1 18 0V21" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linecap="round"/>'
    + '<rect x="9" y="20" width="30" height="23" rx="8" fill="currentColor"/>'
    + '<rect x="9" y="20" width="30" height="8" rx="4" fill="#fff" opacity=".18"/>'
    + '<circle cx="24" cy="30.5" r="3.4" fill="#fff"/>'
    + '<rect x="22.4" y="31" width="3.2" height="6.4" rx="1.6" fill="#fff"/>'
    + '</svg>';
}

export const SWATCHES = [
  { bg: '#eef5ff', fg: '#0071e3' }, { bg: '#eafbf0', fg: '#1e8e3e' }, { bg: '#f3eefd', fg: '#7c3aed' },
  { bg: '#fff4e5', fg: '#c2740b' }, { bg: '#fdeef0', fg: '#c0255a' }, { bg: '#e8f8f6', fg: '#0a8a7c' },
];
// A subject's icon (uploaded or built-in), or its letter tile if it has none.
export function subjectIcon(subject, cls) {
  const src = subjectIconSrc(subject);
  return src ? '<img class="' + (cls || 'subject-icon') + '" src="' + src + '" alt="">' : swatchFor(subject.name);
}
export function swatchFor(str) {
  let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const c = SWATCHES[h % SWATCHES.length];
  const letter = (str.trim()[0] || '?').toUpperCase();
  return '<div class="swatch" style="background:' + c.bg + '; color:' + c.fg + ';">' + esc(letter) + '</div>';
}

// Renders a True/False segmented control. `onFn` is the global function name
// to call on click (e.g. 'selectAnswer' or 'setCorrect').
export function segToggle(qid, selectedKey, onFn) {
  return '<div class="seg-toggle">'
    + '<button class="seg-btn true ' + (selectedKey === 'A' ? 'selected' : '') + '" onclick="' + onFn + '(\'' + qid + '\',\'A\')">True</button>'
    + '<button class="seg-btn false ' + (selectedKey === 'B' ? 'selected' : '') + '" onclick="' + onFn + '(\'' + qid + '\',\'B\')">False</button>'
    + '</div>';
}

// Groups a flat, position-ordered list of question-like objects (each with

export const COPYRIGHT = '&copy; ' + new Date().getFullYear() + ' DW';

export function renderFooter() {
  return '<div class="footer-note">Signed in as ' + esc(state.currentUser ? state.currentUser.name : '') + '<div class="copyright">' + COPYRIGHT + '</div></div>';
}

export const ICONS = {
  play: '<svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  subjects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10"/><path d="M12 20V4"/><path d="M20 20v-7"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  signout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
};

export function renderNav() {
  const u = state.currentUser;
  let tabs = [['home', 'Subjects', 'subjects'], ['analytics', 'Analytics', 'analytics']];
  if (u && u.role === 'admin') tabs.push(['admin', 'Admin', 'admin']);
  return '<div class="nav">'
    + '<div class="brand" onclick="goto(\'home\')">Papers</div>'
    + '<div class="links nav-desktop-links">'
    + tabs.map(t => '<button class="linkbtn ' + (state.screen === t[0] ? 'active' : '') + '" onclick="goto(\'' + t[0] + '\')">' + t[1] + '</button>').join('')
    + '<span class="who">' + esc(u.name) + ' · ' + esc(u.medNo) + '</span>'
    + '<button class="linkbtn" onclick="doLogout()">Log out</button>'
    + '</div>'
    + '<div class="nav-mobile-actions">'
    + '<button class="icon-btn logout-btn" onclick="doLogout()">' + ICONS.signout + '<span>Log out</span></button>'
    + '</div>'
    + '</div>'
    + '<nav class="bottom-tabbar">'
    + tabs.map(t => '<button class="tab-item ' + (state.screen === t[0] ? 'active' : '') + '" onclick="goto(\'' + t[0] + '\')">' + ICONS[t[2]] + '<span>' + t[1] + '</span></button>').join('')
    + '</nav>';
}
