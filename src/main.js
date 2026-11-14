// Entry point. Importing the screen modules registers the window.* handlers
// that the inline onclick="..." attributes call.
import * as db from './data/index.js';
import { state } from './state.js';
import { render } from './render.js';
import './screens/auth.js';
import './screens/subjects.js';
import './screens/take.js';
import './screens/review.js';
import './screens/analytics.js';
import './screens/admin.js';
import './screens/members.js';
import './screens/paperEditor.js';

async function boot() {
  try {
    state.settings = await db.fetchSettings();
  } catch (e) {
    state.settings = { groups: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], batches: ['30', '31', '32', '33', '34'] };
  }
  const session = await db.getSession();
  if (session) {
    try {
      state.currentUser = await db.fetchCurrentUser(session.user.id);
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
