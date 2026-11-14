// Redraws the whole page from state. Screens that need data from the server
// render a placeholder first, then fill it in (the *Deferred functions).
import { state } from './state.js';
import { renderFooter, renderNav } from './ui/components.js';
import { renderAuth } from './screens/auth.js';
import { renderHome, renderPaperLocked, renderPaperStart, renderPapers } from './screens/subjects.js';
import { renderTake } from './screens/take.js';
import { renderReviewDeferred } from './screens/review.js';
import { renderAnalyticsDeferred, renderAnalyticsShell } from './screens/analytics.js';
import { renderAdmin, renderAdminPapersDeferred } from './screens/admin.js';
import { renderMembersDeferred } from './screens/members.js';
import { renderNewPaper } from './screens/paperEditor.js';

// ================= RENDER =================
export function render() {
  const root = document.getElementById('root');
  if (state.screen === 'loading') { root.innerHTML = '<div class="center-wrap">Loading…</div>'; return; }
  if (state.screen === 'auth') { root.innerHTML = renderAuth(); return; }
  root.innerHTML = renderNav() + '<div class="wrap">' + renderScreen() + '</div>' + renderFooter();
  if (state.screen === 'review') { renderReviewDeferred(); }
  if (state.screen === 'analytics') { renderAnalyticsDeferred(); }
  if (state.screen === 'admin' && state.adminTab === 'analytics') { renderAnalyticsDeferred(); }
  if (state.screen === 'admin' && state.adminTab === 'papers') { renderAdminPapersDeferred(); }
  if (state.screen === 'admin' && state.adminTab === 'members') { renderMembersDeferred(); }
}

export function renderScreen() {
  switch (state.screen) {
    case 'home': return renderHome();
    case 'papers': return renderPapers();
    case 'take': return renderTake();
    case 'review': return '<div id="reviewhost">Loading results…</div>';
    case 'paper_locked': return renderPaperLocked();
    case 'paper_start': return renderPaperStart();
    case 'analytics': return renderAnalyticsShell();
    case 'admin': return renderAdmin();
    case 'admin_newpaper': return renderNewPaper();
    default: return '';
  }
}
