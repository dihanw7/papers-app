// Admin: creating and editing papers, including MTF groups and Excel import.
import * as db from '../data/index.js';
import { cache, state } from '../state.js';
import { esc, groupConsecutive, isoToLocalInput, newGroupId, uid } from '../lib/helpers.js';
import { segToggle } from '../ui/components.js';
import { render } from '../render.js';

window.startNewPaper = function () {
  state.editingPaperId = null;
  state.editingOriginalIds = [];
  state.editingAttemptCount = 0;
  // locked: null until the admin touches the box, then it defaults by schedule (see formLocked).
  state.paperForm = { subjectId: state.subjects[0] ? state.subjects[0].id : '', name: '', passMark: '50', timeLimit: '', opens: '', closes: '', resultsAfterClose: true, locked: null };
  state.newPaperQuestions = [];
  state.screen = 'admin_newpaper';
  render();
};

window.editPaper = async function (paperId) {
  try {
    if (state.subjects.length === 0) state.subjects = await db.fetchSubjects();
    const paper = await db.fetchPaperWithQuestions(paperId);
    const attemptCount = await db.countAttempts(paperId);
    state.editingPaperId = paperId;
    state.editingOriginalIds = paper.questions.map(q => q.id);
    state.editingAttemptCount = attemptCount;
    state.paperForm = {
      subjectId: paper.subjectId || '',
      name: paper.name || '',
      passMark: String(paper.passMark ?? 50),
      timeLimit: paper.timeLimitMinutes ? String(paper.timeLimitMinutes) : '',
      opens: isoToLocalInput(paper.opensAt),
      closes: isoToLocalInput(paper.closesAt),
      resultsAfterClose: paper.resultsAfterClose,
      locked: !paper.isOpen,
    };
    // Deep-copy so edits don't touch anything else holding this paper.
    state.newPaperQuestions = paper.questions.map(q => ({
      ...q, options: q.options.map(o => ({ ...o })), existing: true,
    }));
    state.screen = 'admin_newpaper';
    render();
    window.scrollTo(0, 0);
  } catch (e) { alert('Could not open that paper: ' + e.message); }
};

// Paper-level fields live in state so they survive re-renders
// (adding a question re-renders the whole page).
window.updatePaperField = function (field, value) { state.paperForm[field] = value; };

window.addBlankQuestion = function (type) {
  const q = { id: uid(), type, stem: '', correct: '', options: type === 'TF' ? [{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }] : [{ key: 'A', text: '' }, { key: 'B', text: '' }, { key: 'C', text: '' }, { key: 'D', text: '' }, { key: 'E', text: '' }] };
  state.newPaperQuestions.push(q);
  render();
};
window.removeQuestion = function (qid) { state.newPaperQuestions = state.newPaperQuestions.filter(q => q.id !== qid); render(); };
window.updateQField = function (qid, field, value) {
  const q = state.newPaperQuestions.find(q => q.id === qid);
  if (!q) return;
  if (field.startsWith('opt_')) { const key = field.split('_')[1]; const o = q.options.find(o => o.key === key); if (o) o.text = value; }
  else { q[field] = value; }
};
window.setCorrect = function (qid, key) { const q = state.newPaperQuestions.find(q => q.id === qid); if (q) { q.correct = key; render(); } };

// ---------- ADMIN: MTF groups ----------
window.addMTFGroup = function () {
  const gid = newGroupId();
  const mk = (order) => ({ id: uid(), type: 'TF', stem: '', correct: '', options: [{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }], groupId: gid, groupStem: '', groupOrder: order });
  state.newPaperQuestions.push(mk(0), mk(1));
  render();
};
window.addStatementToGroup = function (groupId) {
  const members = state.newPaperQuestions.filter(q => q.groupId === groupId);
  const groupStem = members.length ? members[0].groupStem : '';
  const ns = { id: uid(), type: 'TF', stem: '', correct: '', options: [{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }], groupId, groupStem, groupOrder: members.length };
  const lastIdx = state.newPaperQuestions.map(q => q.groupId).lastIndexOf(groupId);
  state.newPaperQuestions.splice(lastIdx + 1, 0, ns);
  render();
};
window.updateGroupStem = function (groupId, value) {
  state.newPaperQuestions.forEach(q => { if (q.groupId === groupId) q.groupStem = value; });
};
window.removeGroup = function (groupId) {
  state.newPaperQuestions = state.newPaperQuestions.filter(q => q.groupId !== groupId);
  render();
};

window.savePaper = async function () {
  const f = state.paperForm;
  const subjectId = f.subjectId;
  const name = (f.name || '').trim();
  const passMark = parseInt(f.passMark || '50');
  const timeLimitRaw = (f.timeLimit || '').toString().trim();
  const timeLimitMinutes = timeLimitRaw ? parseInt(timeLimitRaw) : null;
  const opensAt = f.opens ? new Date(f.opens).toISOString() : null;
  const closesAt = f.closes ? new Date(f.closes).toISOString() : null;
  if (opensAt && closesAt && new Date(closesAt) <= new Date(opensAt)) {
    alert('Closes at must be after opens at.');
    return;
  }
  if (!subjectId || !name) { alert('Choose a subject and give the paper a name.'); return; }
  if (isNaN(passMark) || passMark < 0 || passMark > 100) { alert('Pass mark must be a number from 0 to 100.'); return; }
  if (timeLimitRaw && (isNaN(timeLimitMinutes) || timeLimitMinutes <= 0)) { alert('Time limit must be a positive number of minutes, or left blank.'); return; }
  if (state.newPaperQuestions.length === 0) { alert('Add at least one question.'); return; }
  for (const q of state.newPaperQuestions) {
    if (!q.stem.trim() || !q.correct || q.options.some(o => !o.text.trim())) {
      alert('Every question or statement needs text, all options filled in, and a correct answer marked.');
      return;
    }
  }
  const groupIds = [...new Set(state.newPaperQuestions.filter(q => q.groupId).map(q => q.groupId))];
  for (const gid of groupIds) {
    const members = state.newPaperQuestions.filter(q => q.groupId === gid);
    if (!members[0].groupStem || !members[0].groupStem.trim()) {
      alert('Each MTF group needs a shared stem filled in.');
      return;
    }
  }
  const isEdit = !!state.editingPaperId;
  if (isEdit && state.editingAttemptCount > 0) {
    const removedCount = state.editingOriginalIds.filter(id => !state.newPaperQuestions.some(q => q.existing && q.id === id)).length;
    let msg = state.editingAttemptCount + ' student(s) have already submitted this paper. Their recorded scores will NOT change. '
      + 'Their review pages will show the updated questions and answer key.';
    if (removedCount > 0) msg += '\n\nYou are removing ' + removedCount + ' question/statement(s). Their answers to those will no longer be shown.';
    msg += '\n\nSave changes?';
    if (!confirm(msg)) return;
  }
  const orderCounters = {};
  state.newPaperQuestions.forEach(q => {
    if (q.groupId) {
      orderCounters[q.groupId] = (orderCounters[q.groupId] ?? -1) + 1;
      q.groupOrder = orderCounters[q.groupId];
    }
  });
  const fields = { subjectId, name, passMark, timeLimitMinutes, opensAt, closesAt, resultsAfterClose: !!f.resultsAfterClose, locked: formLocked(f) };
  state.busy = true; render();
  try {
    if (isEdit) {
      await db.updatePaper(state.editingPaperId, fields);
      await db.saveEditedQuestions(state.editingPaperId, state.newPaperQuestions, state.editingOriginalIds);
    } else {
      const paper = await db.createPaper(fields);
      await db.addQuestions(paper.id, state.newPaperQuestions);
    }
    cache.analytics = null; // make analytics refetch the updated paper
    state.busy = false;
    state.editingPaperId = null;
    alert(isEdit ? 'Changes saved.' : 'Paper saved.');
    state.screen = 'admin';
    state.adminTab = 'papers';
    render();
  } catch (e) {
    state.busy = false;
    alert(e.message);
    render();
  }
};

window.handleExcelUpload = function (evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const parsed = [];
      let lastGroupStem = null;
      let lastGroupId = null;
      let groupOrderCounter = 0;

      rows.forEach(row => {
        const norm = {};
        Object.keys(row).forEach(k => norm[k.trim().toLowerCase()] = row[k]);
        const rawType = (norm['type'] || 'SBA').toString().trim().toUpperCase();
        const type = rawType.startsWith('MTF') ? 'MTF' : (rawType.startsWith('T') ? 'TF' : 'SBA');
        const stem = (norm['stem'] || norm['question'] || '').toString().trim();
        if (!stem) return;

        if (type === 'MTF') {
          const statement = (norm['statement'] || '').toString().trim();
          if (!statement) return;
          if (stem !== lastGroupStem) {
            lastGroupStem = stem;
            lastGroupId = newGroupId();
            groupOrderCounter = 0;
          }
          const correctRaw = (norm['correct'] || norm['answer'] || '').toString().trim().toUpperCase();
          const correct = correctRaw.startsWith('T') ? 'A' : 'B';
          parsed.push({
            id: uid(), type: 'TF', stem: statement,
            options: [{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }],
            correct, groupId: lastGroupId, groupStem: stem, groupOrder: groupOrderCounter++,
          });
          return;
        }

        // A standalone SBA/TF row closes off any group we were tracking.
        lastGroupStem = null; lastGroupId = null;

        let options = [];
        if (type === 'TF') {
          options = [{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }];
        } else {
          ['a', 'b', 'c', 'd', 'e'].forEach(letter => {
            const val = norm['option' + letter] !== undefined ? norm['option' + letter] : norm[letter];
            if (val !== undefined && val !== '') { options.push({ key: letter.toUpperCase(), text: val.toString().trim() }); }
          });
        }
        const correctRaw = (norm['correct'] || norm['answer'] || '').toString().trim();
        let correct = '';
        if (type === 'TF') {
          correct = correctRaw.toUpperCase().startsWith('T') ? 'A' : (correctRaw.toUpperCase().startsWith('F') ? 'B' : correctRaw.toUpperCase());
        } else {
          correct = correctRaw.toUpperCase();
        }
        parsed.push({ id: uid(), type, stem, options, correct });
      });

      if (parsed.length === 0) { alert('No valid rows found. Check your column headers: Type, Stem, Statement (MTF), OptionA-E (SBA), Correct.'); return; }
      state.newPaperQuestions = state.newPaperQuestions.concat(parsed);
      render();
      alert(parsed.length + ' row(s) imported (MTF statements count individually). Review them below before saving.');
    } catch (err) {
      alert('Could not read that file: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
};

// New papers start locked unless they have a schedule to follow, until the
// admin sets the box themselves.
export function formLocked(f) {
  return f.locked === null || f.locked === undefined ? !(f.opens || f.closes) : !!f.locked;
}

export function renderNewPaper() {
  const f = state.paperForm;
  if (!f.subjectId && state.subjects[0]) f.subjectId = state.subjects[0].id; // match what the dropdown shows
  const isEdit = !!state.editingPaperId;
  let html = '<div class="flex-between"><h1>' + (isEdit ? 'Edit paper' : 'New paper') + '</h1><span class="link-a" onclick="goto(\'admin\')">← Cancel</span></div>'
    + (isEdit && state.editingAttemptCount > 0
      ? '<div class="timeout-banner">' + state.editingAttemptCount + ' student(s) have already submitted this paper. You can still edit it, but their recorded scores won\'t change. Fixing typos and timings is safe; changing answer keys or removing questions will make their review pages differ from their score.</div>'
      : '')
    + '<div class="card">'
    + '<label class="flabel">Subject</label><select onchange="updatePaperField(\'subjectId\',this.value)">'
    + state.subjects.map(s => '<option value="' + s.id + '" ' + (f.subjectId === s.id ? 'selected' : '') + '>' + esc(s.name) + '</option>').join('')
    + '</select>'
    + '<label class="flabel">Paper name</label><input placeholder="e.g. Mock 01" value="' + esc(f.name) + '" oninput="updatePaperField(\'name\',this.value)">'
    + '<label class="flabel">Pass mark (%)</label><input type="number" value="' + esc(f.passMark) + '" oninput="updatePaperField(\'passMark\',this.value)">'
    + '<label class="flabel">Time limit per student, in minutes (optional — leave blank for no limit)</label><input type="number" placeholder="e.g. 60" value="' + esc(f.timeLimit) + '" oninput="updatePaperField(\'timeLimit\',this.value)">'
    + '<label class="flabel">Opens at (optional — leave blank to make it available immediately)</label><input type="datetime-local" value="' + esc(f.opens) + '" onchange="updatePaperField(\'opens\',this.value)" oninput="updatePaperField(\'opens\',this.value)">'
    + '<label class="flabel">Closes at (optional — leave blank for no scheduled close)</label><input type="datetime-local" value="' + esc(f.closes) + '" onchange="updatePaperField(\'closes\',this.value)" oninput="updatePaperField(\'closes\',this.value)">'
    + '<p class="sub" style="margin:0 0 8px;">With open/close times set, the paper opens and closes on that schedule by itself (unless it is locked below). Without them, it is open whenever it is unlocked.</p>'
    + '<p class="sub" style="margin:0;">If both a time limit and a close time are set, whichever runs out first ends the attempt.'
    + (isEdit ? ' Changing timings affects students who open the paper from now on; anyone mid-attempt keeps their current deadline until they reload.' : '')
    + '</p>'
    + '<label class="check-row"><input type="checkbox" ' + (formLocked(f) ? 'checked' : '') + ' onchange="updatePaperField(\'locked\',this.checked)">'
    + '<span>Locked<br><small>Students can\'t open a locked paper, even during its scheduled time. Untick it (or press Unlock under Manage papers) to let them in.</small></span></label>'
    + '<label class="check-row"><input type="checkbox" ' + (f.resultsAfterClose ? 'checked' : '') + ' onchange="updatePaperField(\'resultsAfterClose\',this.checked)">'
    + '<span>Hide scores and answers until the paper closes<br><small>Recommended for exams: students who finish early can\'t share the answers. Leave unticked for practice papers so students see their results straight away.</small></span></label>'
    + '</div>'
    + '<div class="card"><h2>Import from Excel</h2>'
    + '<p class="sub">Columns: <b>Type</b> (SBA, TF, or MTF), <b>Stem</b>, <b>Statement</b> (MTF only — one row per statement, same Stem repeated for the whole group), <b>OptionA</b>–<b>OptionE</b> (SBA only), <b>Correct</b> (a letter for SBA, or True/False for TF and MTF rows).</p>'
    + '<div class="upload-box"><input type="file" accept=".xlsx,.xls,.csv" onchange="handleExcelUpload(event)"></div>'
    + '</div>'
    + '<div class="card"><div class="flex-between"><h2>Questions</h2>'
    + '<div class="row"><button class="btn secondary" onclick="addBlankQuestion(\'SBA\')">+ SBA</button><button class="btn secondary" onclick="addBlankQuestion(\'TF\')">+ TF</button><button class="btn secondary" onclick="addMTFGroup()">+ MTF group</button></div></div>';

  const grouped = groupConsecutive(state.newPaperQuestions);
  let qNum = 0;
  grouped.forEach(entry => {
    qNum++;
    if (entry.kind === 'single') {
      const q = entry.question;
      html += '<div class="questionrow"><div class="flex-between"><span class="badge">' + q.type + ' · Q' + qNum + '</span><span class="link-a" onclick="removeQuestion(\'' + q.id + '\')">Remove</span></div>'
        + '<textarea placeholder="Question stem" oninput="updateQField(\'' + q.id + '\',\'stem\',this.value)">' + esc(q.stem) + '</textarea>';
      q.options.forEach(o => {
        const isCorrect = q.correct === o.key;
        html += '<div class="row" style="align-items:center; margin-bottom:8px;">'
          + '<div class="key" style="cursor:pointer; ' + (isCorrect ? 'background:#34c759;border-color:#34c759;color:#fff;' : '') + '" onclick="setCorrect(\'' + q.id + '\',\'' + o.key + '\')" title="Mark as correct">' + o.key + '</div>'
          + '<input style="margin:0; flex:1;" placeholder="Option ' + o.key + '" value="' + esc(o.text) + '" oninput="updateQField(\'' + q.id + '\',\'opt_' + o.key + '\',this.value)" ' + (q.type === 'TF' ? 'readonly' : '') + '>'
          + '</div>';
      });
      html += '<p class="sub" style="margin:0;">Click the letter circle to mark the correct answer' + (q.correct ? ' — currently <b>' + q.correct + '</b>' : '') + '.</p></div>';
    } else {
      html += '<div class="questionrow" style="border-color:var(--accent); border-width:1.5px;">'
        + '<div class="flex-between"><span class="badge" style="background:var(--accent-tint); color:var(--accent);">MTF group · Q' + qNum + ' · ' + entry.items.length + ' statements</span>'
        + '<span class="link-a" onclick="removeGroup(\'' + entry.groupId + '\')">Remove group</span></div>'
        + '<textarea placeholder="Shared stem for this group of statements" oninput="updateGroupStem(\'' + entry.groupId + '\',this.value)">' + esc(entry.groupStem) + '</textarea>';
      entry.items.forEach((q, idx) => {
        html += '<div class="row" style="align-items:center; margin-bottom:8px; gap:10px;">'
          + '<input style="flex:1; margin:0;" placeholder="Statement ' + (idx + 1) + '" value="' + esc(q.stem) + '" oninput="updateQField(\'' + q.id + '\',\'stem\',this.value)">'
          + segToggle(q.id, q.correct, 'setCorrect')
          + '<span class="link-a" onclick="removeQuestion(\'' + q.id + '\')" style="flex-shrink:0;">Remove</span>'
          + '</div>';
      });
      html += '<button class="btn secondary" onclick="addStatementToGroup(\'' + entry.groupId + '\')">+ Add statement</button>'
        + '</div>';
    }
  });
  html += (state.newPaperQuestions.length === 0 ? '<div class="empty">No questions yet — add one above or import an Excel file.</div>' : '')
    + '</div>'
    + '<button class="btn block" onclick="savePaper()" ' + (state.busy ? 'disabled' : '') + '>' + (state.busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Save paper')) + '</button>';
  return html;
}
