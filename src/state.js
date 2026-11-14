// App-wide state. Every screen reads and writes this one object, then calls
// render() to redraw.

export const state = {
  screen: 'loading',
  authMode: 'login',
  signupKind: 'student', // student | staff (academic staff skip group and batch)
  currentUser: null, // { id, name, group, medNo, role }
  subjects: [],
  selectedSubject: null,
  papers: [],
  selectedPaper: null,
  paperDetail: null,
  screens: [], // grouped view of the current paper's questions (single | group)
  attemptAnswers: {},
  attemptIndex: 0,
  reviewData: null,
  adminTab: 'papers',
  newPaperQuestions: [],
  errorMsg: '',
  busy: false,
  analyticsSubject: null,
  analyticsPaper: null,
  analyticsExpandedQ: null,
  analyticsTypeFilter: 'all', // all | SBA | TF | MTF
  analyticsViewingAttempt: null,
  newSubjectIcon: null, // SVG text chosen for the subject being added
  members: null, // admin Members tab; null until loaded
  memberSearch: '',
  memberEditing: null, // id of the member whose edit panel is open
  attemptDeadline: null,
  attemptStartedAt: null, // ms, server clock; null if the database can't record it
  clockOffset: 0, // server time minus this device's time, in ms
  timedOut: false,
  draftStatus: 'idle', // idle | saving | saved
  settings: { groups: [], batches: [] },
  lockedMessage: '',
  submitError: '',
  myAttemptedPaperIds: [], // papers in the current subject this user has already submitted
  lockedKind: '', // upcoming | closed | locked — why the current paper can't be started
  answersLocked: false, // true once time is up, so answers can't change while a submit is retried
  // Paper builder / editor. editingPaperId is null when creating a new paper.
  editingPaperId: null,
  editingOriginalIds: [], // question ids the paper had when the editor opened
  editingAttemptCount: 0, // how many students had already submitted when the editor opened
  paperForm: { subjectId: '', name: '', passMark: '50', timeLimit: '', opens: '', closes: '', resultsAfterClose: true },
};

// Cached results that are dropped whenever they might be stale.
export const cache = {
  analytics: null, // { paperId, paper, all, dist, inProgress }
};
