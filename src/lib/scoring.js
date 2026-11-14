// Client-side marking, used for the score sent with a submission (the
// database re-marks it with submit_attempt where available).
import { state } from '../state.js';

export const SBA_MARKS = 5;
export const TF_MARKS = 1; // standalone TF (not part of an MTF group) — rare in practice
export const MTF_MAX_MARKS = 5; // fixed cap per MTF group, regardless of how many statements it has

export function screenMaxMarks(screen) {
  if (screen.kind === 'single') return screen.question.type === 'SBA' ? SBA_MARKS : TF_MARKS;
  return MTF_MAX_MARKS;
}
export function screenEarnedMarks(screen, answers) {
  if (screen.kind === 'single') {
    const max = screenMaxMarks(screen);
    return answers[screen.question.id] === screen.question.correct ? max : 0;
  }
  let correct = 0, wrong = 0;
  screen.items.forEach(q => {
    const ans = answers[q.id];
    if (!ans) return;
    if (ans === q.correct) correct++; else wrong++;
  });
  return Math.max(0, Math.min(MTF_MAX_MARKS, correct - wrong));
}
export function computeScore() {
  let totalPoints = 0, totalPossible = 0;
  state.screens.forEach(screen => {
    totalPossible += screenMaxMarks(screen);
    totalPoints += screenEarnedMarks(screen, state.attemptAnswers);
  });
  return { totalPoints, totalPossible };
}
