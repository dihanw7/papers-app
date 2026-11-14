// Small helpers with no UI or database dependencies.

export function esc(s) {
  return (s === undefined || s === null) ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Paper availability ----------
// One place that decides whether a paper can be started right now
// (same rule as paper_is_open_now() in the database).
//  - Locked by an admin: closed, even inside its scheduled window.
//  - Otherwise scheduled papers follow their open/close times, and
//    unscheduled ones are open.
export function paperStatus(p) {
  const now = Date.now();
  const scheduled = !!(p.opensAt || p.closesAt);
  if (p.closesAt && now >= new Date(p.closesAt).getTime()) return { kind: 'closed', open: false };
  if (!p.isOpen) return { kind: 'locked', open: false };
  if (p.opensAt && now < new Date(p.opensAt).getTime()) return { kind: 'upcoming', open: false };
  return { kind: 'open', open: true, scheduled };
}
export function fmtWhen(iso) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
// Soft rounded padlock. `size` in px.

// Turns Supabase/network errors into messages a student can act on.
export function friendlyAuthError(e, fallback) {
  const msg = (e && e.message) ? e.message : '';
  if ((e && e.status === 429) || /rate limit|too many/i.test(msg)) {
    return 'Too many people are signing in from this network right now. Wait a minute and try again.';
  }
  if (/failed to fetch|network|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your internet connection and try again.';
  }
  return fallback || msg;
}
export function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
// MTF group ids are stored in a uuid column, so they need to be real UUIDs.
export function newGroupId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
// ISO timestamp -> value for an <input type="datetime-local"> in the viewer's local time.
export function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// an optional .groupId) into single items and contiguous MTF groups.
export function groupConsecutive(list) {
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

export function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'never';
}

// Stored as the "group" of academic staff accounts.
export const STAFF_GROUP = 'Academic staff';
