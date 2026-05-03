import {
  getSupabaseClient,
  validateSupabaseConfig,
  refreshSupabaseSessionIfPossible,
  clearLocalSupabaseState
} from './config.js?v=2026-05-03-1';
import { typesetMath } from './math.js?v=2026-05-03-1';
import { escapeHtml, buildStudentUrl, formatDateTime, parseCsvText, percent } from './utils.js?v=2026-05-03-1';
import {
  hasTeacherSession,
  loginTeacher,
  logoutTeacher,
  onTeacherAuthChange,
  loadClasses,
  loadTests,
  loadOpenSession,
  loadClassById,
  loadTestById,
  createSession,
  closeSession,
  importStudents,
  loadResultsDetailed,
  loadSubmissionDetail,
  resetSubmission
} from './api.js?v=2026-05-03-1';

const loadingApp = document.getElementById('loadingApp');
const teacherLoginView = document.getElementById('teacherLogin');
const teacherApp = document.getElementById('teacherApp');
const teacherStatusBox = document.getElementById('teacherStatusBox');

const state = {
  activeSession: null,
  tests: [],
  results: [],
  filteredResults: [],
  selectedSubmissionId: null,
  renderRun: 0,
  detailVisible: true,
  matrixVisible: false,
  detailCache: new Map()
};

function hideAllViews() {
  loadingApp.classList.add('hidden');
  teacherLoginView.classList.add('hidden');
  teacherApp.classList.add('hidden');
}

function showLoading(message = 'Die Anwendung wird geladen ...') {
  hideAllViews();
  loadingApp.classList.remove('hidden');
  loadingApp.innerHTML = `<h1>Lernkontrollen</h1><p class="subtitle">${escapeHtml(message)}</p>`;
}

function showTeacherLogin() {
  hideAllViews();
  teacherLoginView.classList.remove('hidden');
}

function showTeacherApp() {
  hideAllViews();
  teacherApp.classList.remove('hidden');
}

function setTeacherStatus(type, message) {
  if (!teacherStatusBox) return;

  teacherStatusBox.className =
    type === 'success' ? 'success-box' :
    type === 'error' ? 'error-box' :
    'info';

  teacherStatusBox.textContent = message;
}

function clearTeacherLoginFields() {
  const emailInput = document.getElementById('teacherEmail');
  const passwordInput = document.getElementById('teacherPassword');
  const messageBox = document.getElementById('teacherLoginMessage');

  if (emailInput) emailInput.value = '';
  if (passwordInput) passwordInput.value = '';
  if (messageBox) messageBox.textContent = '';
}

function byLocale(a, b) {
  return String(a).localeCompare(String(b), 'de');
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort(byLocale);
}

function getResultFilterElements() {
  return {
    classFilter: document.getElementById('resultClassFilter'),
    testFilter: document.getElementById('resultTestFilter'),
    sessionFilter: document.getElementById('resultSessionFilter')
  };
}

function getResultsTableBody() {
  return document.getElementById('resultsTableBody');
}

function getResultsSummary() {
  return document.getElementById('resultsSummary');
}

function getDetailSection() {
  return document.getElementById('detailSection');
}

function getMatrixSection() {
  return document.getElementById('matrixSection');
}

function getToggleDetailBtn() {
  return document.getElementById('toggleDetailBtn');
}

function getToggleMatrixBtn() {
  return document.getElementById('toggleMatrixBtn');
}

function getMatrixHead() {
  return document.getElementById('resultsMatrixHead');
}

function getMatrixBody() {
  return document.getElementById('resultsMatrixBody');
}

function syncPanelVisibility() {
  const detailSection = getDetailSection();
  const matrixSection = getMatrixSection();
  const toggleDetailBtn = getToggleDetailBtn();
  const toggleMatrixBtn = getToggleMatrixBtn();

  if (detailSection) {
    detailSection.classList.toggle('hidden', !state.detailVisible);
  }

  if (matrixSection) {
    matrixSection.classList.toggle('hidden', !state.matrixVisible);
  }

  if (toggleDetailBtn) {
    toggleDetailBtn.textContent = state.detailVisible
      ? 'Detailansicht ausblenden'
      : 'Detailansicht einblenden';
  }

  if (toggleMatrixBtn) {
    toggleMatrixBtn.textContent = state.matrixVisible
      ? 'Matrix ausblenden'
      : 'Matrix einblenden';
  }
}

function renderResultDetailEmpty(message = 'Wähle in der Tabelle einen Eintrag aus, um die Detailauswertung zu sehen.') {
  const panel = document.getElementById('resultDetailPanel');
  if (!panel) return;
  panel.innerHTML = `<div class="result-detail-empty">${escapeHtml(message)}</div>`;
}

function fillSelectOptions(selectEl, values, placeholder, selectedValue = '') {
  if (!selectEl) return;

  const options = [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(values.map(value => {
      const isSelected = value === selectedValue ? ' selected' : '';
      return `<option value="${escapeHtml(value)}"${isSelected}>${escapeHtml(value)}</option>`;
    }));

  selectEl.innerHTML = options.join('');
}

function populateResultFilters() {
  const { classFilter, testFilter, sessionFilter } = getResultFilterElements();

  const prevClass = classFilter?.value || '';
  const prevTest = testFilter?.value || '';
  const prevSession = sessionFilter?.value || '';

  fillSelectOptions(
    classFilter,
    uniqueSorted(state.results.map(r => r.class_name)),
    'Alle Klassen',
    prevClass
  );

  fillSelectOptions(
    testFilter,
    uniqueSorted(state.results.map(r => r.test_title)),
    'Alle Tests',
    prevTest
  );

  fillSelectOptions(
    sessionFilter,
    uniqueSorted(state.results.map(r => r.session_title)),
    'Alle Sessions',
    prevSession
  );
}

function getFilteredResults() {
  const { classFilter, testFilter, sessionFilter } = getResultFilterElements();

  const selectedClass = classFilter?.value || '';
  const selectedTest = testFilter?.value || '';
  const selectedSession = sessionFilter?.value || '';

  return state.results.filter(row => {
    if (selectedClass && row.class_name !== selectedClass) return false;
    if (selectedTest && row.test_title !== selectedTest) return false;
    if (selectedSession && row.session_title !== selectedSession) return false;
    return true;
  });
}

function updateResultsSummary() {
  const summary = getResultsSummary();
  if (!summary) return;

  const total = state.results.length;
  const filtered = state.filteredResults.length;

  if (!total) {
    summary.textContent = 'Noch keine Ergebnisse vorhanden.';
    return;
  }

  if (filtered === total) {
    summary.textContent = `${total} Ergebnis(se) gespeichert. Klicke auf „Ansehen“, um Fragen und Antworten zu prüfen.`;
    return;
  }

  summary.textContent = `${filtered} von ${total} Ergebnis(se) angezeigt. Klicke auf „Ansehen“, um Fragen und Antworten zu prüfen.`;
}

function renderResultsTable() {
  const tbody = getResultsTableBody();
  if (!tbody) return;

  const rows = state.filteredResults;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="small">Keine Ergebnisse für die aktuelle Filterung gefunden.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr data-submission-id="${r.id}">
      <td>${escapeHtml(r.class_name)}</td>
      <td>${escapeHtml(r.test_title)}</td>
      <td>${escapeHtml(r.session_title)}</td>
      <td>${escapeHtml(r.student_name)}</td>
      <td>${Number(r.score).toFixed(2)} / ${Number(r.max_score).toFixed(2)}</td>
      <td>${percent(r.score, r.max_score)}%</td>
      <td>${formatDateTime(r.submitted_at)}</td>
      <td>
        <div class="actions-cell">
          <button class="ghost js-view-result" data-submission-id="${r.id}">Ansehen</button>
          <button class="danger js-reset-result" data-submission-id="${r.id}" data-student-name="${escapeHtml(r.student_name)}">Zurücksetzen</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const csvContent = rows.map(row => row.map(csvEscape).join(';')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

function slugify(value) {
  return String(value || 'export')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'export';
}

function exportFilteredResultsCsv() {
  if (!state.filteredResults.length) {
    alert('Für die aktuelle Filterung sind keine Ergebnisse vorhanden.');
    return;
  }

  const rows = [
    ['Klasse', 'Test', 'Session', 'Name', 'Punkte', 'Maximalpunkte', 'Quote (%)', 'Abgegeben']
  ];

  state.filteredResults.forEach(row => {
    rows.push([
      row.class_name,
      row.test_title,
      row.session_title,
      row.student_name,
      Number(row.score).toFixed(2),
      Number(row.max_score).toFixed(2),
      String(percent(row.score, row.max_score)),
      formatDateTime(row.submitted_at)
    ]);
  });

  const { classFilter, testFilter, sessionFilter } = getResultFilterElements();
  const parts = [
    classFilter?.value || 'alle-klassen',
    testFilter?.value || 'alle-tests',
    sessionFilter?.value || 'alle-sessions'
  ];

  downloadCsv(`ergebnisse-${parts.map(slugify).join('-')}.csv`, rows);
}

function exportClassResultsCsv() {
  const { classFilter } = getResultFilterElements();
  const selectedClass = classFilter?.value || '';

  if (!selectedClass) {
    alert('Bitte zuerst im Ergebnisbereich eine Klasse filtern.');
    return;
  }

  const classRows = state.results.filter(row => row.class_name === selectedClass);

  if (!classRows.length) {
    alert('Für diese Klasse liegen keine Ergebnisse vor.');
    return;
  }

  const rows = [
    ['Klasse', 'Test', 'Session', 'Name', 'Punkte', 'Maximalpunkte', 'Quote (%)', 'Abgegeben']
  ];

  classRows.forEach(row => {
    rows.push([
      row.class_name,
      row.test_title,
      row.session_title,
      row.student_name,
      Number(row.score).toFixed(2),
      Number(row.max_score).toFixed(2),
      String(percent(row.score, row.max_score)),
      formatDateTime(row.submitted_at)
    ]);
  });

  downloadCsv(`ergebnisse-klasse-${slugify(selectedClass)}.csv`, rows);
}

async function getSubmissionDetailCached(submissionId) {
  if (state.detailCache.has(submissionId)) {
    return state.detailCache.get(submissionId);
  }

  const detail = await loadSubmissionDetail(submissionId);
  state.detailCache.set(submissionId, detail);
  return detail;
}

async function renderResultDetail(submissionId) {
  state.selectedSubmissionId = submissionId;
  state.detailVisible = true;
  syncPanelVisibility();

  const panel = document.getElementById('resultDetailPanel');
  if (!panel) return;

  panel.innerHTML = '<div class="small">Detailauswertung wird geladen ...</div>';

  try {
    const detail = await getSubmissionDetailCached(submissionId);
    const meta = detail.submission;

    const questionsHtml = detail.questions.map((question, index) => `
      <div class="detail-question">
        <div class="detail-question-head">
          <div>
            <h3>Frage ${index + 1}</h3>
            <div>${escapeHtml(question.text)}</div>
          </div>
          <div class="points-pill">${Number(question.awarded_points).toFixed(2)} / ${Number(question.max_points).toFixed(2)} Punkte</div>
        </div>
        ${question.options.map(option => {
          const classes = ['option-review'];
          if (option.is_correct) classes.push('correct');
          if (option.is_selected) classes.push('selected');
          if (option.is_selected && !option.is_correct) classes.push('wrong');

          return `
            <div class="${classes.join(' ')}">
              <div>${escapeHtml(option.text)}</div>
              <div class="option-tags">
                ${option.is_correct ? '<span class="tag correct">richtig</span>' : ''}
                ${option.is_selected ? '<span class="tag selected">gewählt</span>' : ''}
                ${option.is_selected && !option.is_correct ? '<span class="tag wrong">falsch gewählt</span>' : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `).join('');

    panel.innerHTML = `
      <div class="result-box">
        <p><strong>${escapeHtml(detail.student.full_name)}</strong> · ${escapeHtml(detail.classInfo.name)}</p>
        <p>Test: <strong>${escapeHtml(detail.test.title)}</strong></p>
        <p>Session: <strong>${escapeHtml(detail.session.title)}</strong></p>
        <p>Punkte: <strong>${Number(meta.score).toFixed(2)} / ${Number(meta.max_score).toFixed(2)}</strong> · ${percent(meta.score, meta.max_score)}%</p>
        <p>Abgegeben: <strong>${formatDateTime(meta.submitted_at)}</strong></p>
      </div>
      <div class="notice small">
        Die Detailansicht zeigt Fragen und Antworten in der gespeicherten Standardreihenfolge.
        Die ursprünglich zufällig angezeigte Reihenfolge wird im aktuellen Datenmodell nicht separat gespeichert.
      </div>
      ${questionsHtml}
    `;

    await typesetMath(panel);
  } catch (error) {
    console.error(error);
    panel.innerHTML = `<div class="error-box">Die Detailauswertung konnte nicht geladen werden: ${escapeHtml(error.message)}</div>`;
  }
}

function getQuestionStatus(question) {
  const awarded = Number(question.awarded_points || 0);
  const max = Number(question.max_points || 0);

  if (max <= 0) return 'empty';
  if (awarded >= max) return 'full';
  if (awarded <= 0) return 'wrong';
  return 'partial';
}

function getMatrixCellStyle(status) {
  switch (status) {
    case 'full':
      return 'background:#dcfce7;color:#166534;font-weight:700;';
    case 'partial':
      return 'background:#fef3c7;color:#92400e;font-weight:700;';
    case 'wrong':
      return 'background:#fee2e2;color:#991b1b;font-weight:700;';
    default:
      return 'background:#f3f4f6;color:#6b7280;';
  }
}

function buildMatrixTooltip(detail, question) {
  const selected = question.options.filter(o => o.is_selected).map(o => o.text);
  const correct = question.options.filter(o => o.is_correct).map(o => o.text);

  const lines = [
    `${detail.student.full_name} – ${detail.test.title}`,
    `Frage ${question.order}: ${question.text}`,
    `Punkte: ${Number(question.awarded_points).toFixed(2)} / ${Number(question.max_points).toFixed(2)}`,
    `Gewählt: ${selected.length ? selected.join(' | ') : 'nichts'}`,
    `Richtig: ${correct.length ? correct.join(' | ') : 'keine Angabe'}`
  ];

  return escapeHtml(lines.join('\n'));
}

async function buildMatrixPayload() {
  const filtered = state.filteredResults;

  if (!filtered.length) {
    return { columns: [], rows: [] };
  }

  const details = await Promise.all(filtered.map(row => getSubmissionDetailCached(row.id)));

  const testTitles = uniqueSorted(details.map(detail => detail.test?.title || ''));
  const multipleTests = testTitles.length > 1;

  const columnMap = new Map();

  details.forEach(detail => {
    detail.questions.forEach(question => {
      const key = multipleTests
        ? `${detail.test.title}__${question.order}`
        : `q__${question.order}`;

      if (!columnMap.has(key)) {
        columnMap.set(key, {
          key,
          order: Number(question.order || 0),
          testTitle: detail.test.title,
          label: multipleTests
            ? `${detail.test.title} – F${question.order}`
            : `F${question.order}`,
          questionText: question.text
        });
      }
    });
  });

  const columns = [...columnMap.values()].sort((a, b) => {
    if (multipleTests) {
      const titleCmp = byLocale(a.testTitle, b.testTitle);
      if (titleCmp !== 0) return titleCmp;
    }
    return a.order - b.order;
  });

  const rows = details.map(detail => {
    const questionMap = new Map(
      detail.questions.map(question => {
        const key = multipleTests
          ? `${detail.test.title}__${question.order}`
          : `q__${question.order}`;
        return [key, question];
      })
    );

    return {
      detail,
      cells: columns.map(column => {
        const question = questionMap.get(column.key);
        if (!question) {
          return {
            status: 'empty',
            text: '–',
            pointsText: '',
            tooltip: `${detail.student.full_name}\nKeine Frage in dieser Auswahl`
          };
        }

        const status = getQuestionStatus(question);
        return {
          status,
          text:
            status === 'full' ? '✓' :
            status === 'partial' ? '△' :
            status === 'wrong' ? '✕' :
            '–',
          pointsText: `${Number(question.awarded_points).toFixed(2)}/${Number(question.max_points).toFixed(2)}`,
          tooltip: buildMatrixTooltip(detail, question)
        };
      })
    };
  });

  return { columns, rows, multipleTests };
}

async function renderResultsMatrix() {
  const matrixHead = getMatrixHead();
  const matrixBody = getMatrixBody();

  if (!matrixHead || !matrixBody) return;

  if (!state.matrixVisible) {
    matrixHead.innerHTML = '';
    matrixBody.innerHTML = '';
    return;
  }

  if (!state.filteredResults.length) {
    matrixHead.innerHTML = '';
    matrixBody.innerHTML = '<tr><td class="small">Keine Ergebnisse für die Matrix vorhanden.</td></tr>';
    return;
  }

  matrixHead.innerHTML = '<tr><th>Schüler/in</th><th>Klasse</th><th>Test</th><th>Quote</th></tr>';
  matrixBody.innerHTML = '<tr><td colspan="999" class="small">Matrix wird geladen ...</td></tr>';

  try {
    const { columns, rows } = await buildMatrixPayload();

    matrixHead.innerHTML = `
      <tr>
        <th>Schüler/in</th>
        <th>Klasse</th>
        <th>Test</th>
        <th>Quote</th>
        ${columns.map(column => `
          <th title="${escapeHtml(column.questionText)}">${escapeHtml(column.label)}</th>
        `).join('')}
      </tr>
    `;

    matrixBody.innerHTML = rows.map(({ detail, cells }) => `
      <tr>
        <td>${escapeHtml(detail.student.full_name)}</td>
        <td>${escapeHtml(detail.classInfo.name)}</td>
        <td>${escapeHtml(detail.test.title)}</td>
        <td>${percent(detail.submission.score, detail.submission.max_score)}%</td>
        ${cells.map(cell => `
          <td
            title="${cell.tooltip}"
            style="min-width:78px;text-align:center;${getMatrixCellStyle(cell.status)}"
          >
            <div>${cell.text}</div>
            <div style="font-size:0.75rem;font-weight:500;">${escapeHtml(cell.pointsText)}</div>
          </td>
        `).join('')}
      </tr>
    `).join('');

    await typesetMath(document.getElementById('matrixSection'));
  } catch (error) {
    console.error(error);
    matrixHead.innerHTML = '';
    matrixBody.innerHTML = `<tr><td class="error-box">Die Matrix konnte nicht geladen werden: ${escapeHtml(error.message)}</td></tr>`;
  }
}

async function exportMatrixCsv() {
  if (!state.filteredResults.length) {
    alert('Für die aktuelle Filterung sind keine Ergebnisse vorhanden.');
    return;
  }

  const { columns, rows } = await buildMatrixPayload();
  const csvRows = [[
    'Schüler/in',
    'Klasse',
    'Test',
    'Quote (%)',
    ...columns.map(column => column.label)
  ]];

  rows.forEach(({ detail, cells }) => {
    csvRows.push([
      detail.student.full_name,
      detail.classInfo.name,
      detail.test.title,
      String(percent(detail.submission.score, detail.submission.max_score)),
      ...cells.map(cell => {
        if (!cell.pointsText) return 'keine Daten';
        return `${cell.text} ${cell.pointsText}`;
      })
    ]);
  });

  const { classFilter, testFilter, sessionFilter } = getResultFilterElements();
  const parts = [
    classFilter?.value || 'alle-klassen',
    testFilter?.value || 'alle-tests',
    sessionFilter?.value || 'alle-sessions'
  ];

  downloadCsv(`matrix-${parts.map(slugify).join('-')}.csv`, csvRows);
}

async function applyResultsView() {
  state.filteredResults = getFilteredResults();
  updateResultsSummary();
  renderResultsTable();

  if (!state.filteredResults.length) {
    state.selectedSubmissionId = null;
    renderResultDetailEmpty('Keine Ergebnisse für die aktuelle Filterung.');
  } else if (
    state.selectedSubmissionId &&
    !state.filteredResults.some(row => row.id === state.selectedSubmissionId)
  ) {
    state.selectedSubmissionId = null;
    renderResultDetailEmpty();
  } else if (state.selectedSubmissionId) {
    await renderResultDetail(state.selectedSubmissionId);
  } else {
    renderResultDetailEmpty();
  }

  await renderResultsMatrix();
}

async function renderResultsOverview() {
  const rows = await loadResultsDetailed();
  state.results = rows;

  populateResultFilters();
  await applyResultsView();
}

async function handleCreateSession() {
  const classId = document.getElementById('classSelect').value;
  const testId = document.getElementById('testSelect').value;
  const durationMinutes = Number(document.getElementById('durationInput').value) || 15;
  const title = document.getElementById('sessionLabel').value.trim() || 'Lernkontrolle';
  const actionBox = document.getElementById('teacherActionMessage');

  if (!classId || !testId) {
    actionBox.textContent = 'Bitte zuerst Klasse und Test auswählen.';
    return;
  }

  try {
    await createSession({
      classId,
      testId,
      durationMinutes,
      title,
      existingSessionId: state.activeSession?.id || null
    });

    actionBox.textContent = 'Session erfolgreich erzeugt.';
    await refreshTeacherAppSections();
  } catch (error) {
    console.error(error);
    actionBox.textContent = 'Fehler beim Erzeugen der Session: ' + error.message;
  }
}

async function handleCloseSession() {
  const actionBox = document.getElementById('teacherActionMessage');

  if (!state.activeSession) {
    actionBox.textContent = 'Es gibt aktuell keine offene Session.';
    return;
  }

  try {
    await closeSession(state.activeSession.id);
    actionBox.textContent = 'Session wurde geschlossen.';
    await refreshTeacherAppSections();
  } catch (error) {
    console.error(error);
    actionBox.textContent = 'Fehler beim Schließen der Session: ' + error.message;
  }
}

async function handleImportCsv() {
  const fileInput = document.getElementById('csvFileInput');
  const classSelect = document.getElementById('importClassSelect');
  const messageBox = document.getElementById('csvImportMessage');

  messageBox.textContent = '';

  const classId = classSelect.value;
  const file = fileInput.files?.[0];

  if (!classId) {
    messageBox.textContent = 'Bitte zuerst eine Klasse auswählen.';
    return;
  }

  if (!file) {
    messageBox.textContent = 'Bitte zuerst eine CSV-Datei auswählen.';
    return;
  }

  try {
    const csvText = await file.text();
    const parsedRows = parseCsvText(csvText);

    if (!parsedRows.length) {
      messageBox.textContent = 'Es wurden keine gültigen Einträge gefunden.';
      return;
    }

    const count = await importStudents(classId, parsedRows.map(row => row.displayName));
    messageBox.textContent = `${count} Schüler erfolgreich importiert.`;
    fileInput.value = '';
  } catch (error) {
    console.error(error);
    messageBox.textContent = 'Fehler beim CSV-Import: ' + error.message;
  }
}

async function handleLogin() {
  const email = document.getElementById('teacherEmail').value.trim();
  const password = document.getElementById('teacherPassword').value;
  const messageBox = document.getElementById('teacherLoginMessage');

  messageBox.textContent = '';

  if (!email || !password) {
    messageBox.textContent = 'Bitte E-Mail und Passwort eingeben.';
    return;
  }

  try {
    await loginTeacher(email, password);
    messageBox.textContent = '';
  } catch (error) {
    console.error(error);
    messageBox.textContent = 'Login fehlgeschlagen: ' + error.message;
  }
}

async function handleLogout() {
  clearTeacherLoginFields();
  showTeacherLogin();
  setTeacherStatus('info', 'Lokale Sitzung wird zurückgesetzt ...');

  try {
    await logoutTeacher();
  } catch (error) {
    console.error('Logout fehlgeschlagen:', error);
  } finally {
    clearLocalSupabaseState();
    window.location.replace('./teacher.html');
  }
}

async function handleResetSubmission(submissionId, studentName) {
  const ok = window.confirm(
    `Soll die Abgabe von ${studentName} wirklich zurückgesetzt werden? Danach kann der Test erneut geschrieben werden.`
  );
  if (!ok) return;

  try {
    await resetSubmission(submissionId);
    state.detailCache.delete(submissionId);

    if (state.selectedSubmissionId === submissionId) {
      state.selectedSubmissionId = null;
    }

    await renderResultsOverview();
  } catch (error) {
    console.error(error);
    alert(
      'Zurücksetzen fehlgeschlagen: ' +
      error.message +
      '\n\nDafür ist in Supabase zusätzlich eine DELETE-Policy für submissions und submission_answers nötig.'
    );
  }
}

async function populateTeacherSelectors() {
  const [classes, tests] = await Promise.all([loadClasses(), loadTests()]);
  state.tests = tests;

  const classSelect = document.getElementById('classSelect');
  const testSelect = document.getElementById('testSelect');
  const importClassSelect = document.getElementById('importClassSelect');

  if (classSelect) {
    classSelect.innerHTML = classes.length
      ? classes.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
      : '<option value="">Keine Klasse vorhanden</option>';
  }

  if (importClassSelect) {
    importClassSelect.innerHTML = classes.length
      ? classes.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
      : '<option value="">Keine Klasse vorhanden</option>';
  }

  if (testSelect) {
    testSelect.innerHTML = tests.length
      ? tests.map(t => `<option value="${t.id}" data-duration="${t.duration_minutes}">${escapeHtml(t.title)}</option>`).join('')
      : '<option value="">Kein Test vorhanden</option>';
  }

  if (tests.length && document.getElementById('durationInput')) {
    document.getElementById('durationInput').value = tests[0].duration_minutes || 15;
  }

  if (testSelect) {
    testSelect.onchange = () => {
      const selected = state.tests.find(t => t.id === testSelect.value);
      if (selected && document.getElementById('durationInput')) {
        document.getElementById('durationInput').value = selected.duration_minutes || 15;
      }
    };
  }
}

async function renderTeacherActiveSession() {
  const active = await loadOpenSession();
  state.activeSession = active;

  const infoBox = document.getElementById('activeSessionInfo');
  const linkBox = document.getElementById('sessionLinkBox');
  const qrcodeBox = document.getElementById('qrcode');

  if (!infoBox || !linkBox || !qrcodeBox) return;

  qrcodeBox.innerHTML = '';

  if (!active) {
    infoBox.textContent = 'Keine offene Session gefunden.';
    linkBox.textContent = 'Noch kein Link erzeugt.';
    qrcodeBox.innerHTML = '<span class="small">Nach dem Erzeugen erscheint hier der QR-Code.</span>';
    return;
  }

  const [cls, test] = await Promise.all([
    loadClassById(active.class_id),
    loadTestById(active.test_id)
  ]);

  const sessionUrl = buildStudentUrl(active.access_code);

  infoBox.innerHTML = `
    <div class="success-box">
      <strong>${escapeHtml(active.title)}</strong><br>
      ${escapeHtml(cls.name)} · ${escapeHtml(test.title)}<br>
      Code: <strong>${escapeHtml(active.access_code)}</strong>
    </div>
  `;

  linkBox.textContent = sessionUrl;

  if (typeof QRCode !== 'undefined') {
    new QRCode(qrcodeBox, {
      text: sessionUrl,
      width: 200,
      height: 200
    });
  } else {
    qrcodeBox.innerHTML = '<span class="small">QR-Code-Bibliothek wurde nicht geladen.</span>';
  }
}

async function refreshTeacherAppSections() {
  const thisRun = ++state.renderRun;
  setTeacherStatus('info', 'Daten werden geladen ...');

  const results = await Promise.allSettled([
    populateTeacherSelectors(),
    renderTeacherActiveSession(),
    renderResultsOverview()
  ]);

  if (thisRun !== state.renderRun) return;

  const errors = results
    .filter(result => result.status === 'rejected')
    .map(result => result.reason?.message || 'Unbekannter Fehler');

  if (errors.length === 0) {
    setTeacherStatus('success', 'Verbindung zu Supabase erfolgreich.');
  } else {
    console.error('Teilweise Ladefehler:', errors);
    setTeacherStatus('error', 'Ein Teil der Daten konnte nicht geladen werden: ' + errors.join(' | '));
  }

  syncPanelVisibility();
  await typesetMath(teacherApp);
}

async function renderTeacherApp() {
  showTeacherApp();
  syncPanelVisibility();
  await refreshTeacherAppSections();
}

async function route() {
  showLoading('Die Anwendung wird geladen ...');

  if (!validateSupabaseConfig()) {
    showLoading('Bitte zuerst in js/config.js deine Supabase-URL und deinen Public Key eintragen.');
    return;
  }

  try {
    getSupabaseClient();
    await refreshSupabaseSessionIfPossible();
  } catch (error) {
    console.error(error);
    showLoading('Supabase konnte nicht initialisiert werden: ' + error.message);
    return;
  }

  try {
    const loggedIn = await hasTeacherSession();

    if (loggedIn) {
      await renderTeacherApp();
    } else {
      showTeacherLogin();
    }
  } catch (error) {
    console.error(error);
    clearLocalSupabaseState();
    showTeacherLogin();

    const messageBox = document.getElementById('teacherLoginMessage');
    if (messageBox) {
      messageBox.textContent = 'Die lokale Sitzung wurde zurückgesetzt. Bitte erneut einloggen.';
    }
  }
}

document.addEventListener('click', async (event) => {
  const id = event.target.id;

  if (id === 'teacherLoginBtn') await handleLogin();
  if (id === 'teacherLogoutBtn') await handleLogout();
  if (id === 'createSessionBtn') await handleCreateSession();
  if (id === 'closeSessionBtn') await handleCloseSession();
  if (id === 'refreshResultsBtn') await renderResultsOverview();
  if (id === 'importCsvBtn') await handleImportCsv();

  if (id === 'repairConnectionBtn' || id === 'repairConnectionBtnTop') {
    clearLocalSupabaseState();
    window.location.replace('./teacher.html');
  }

  if (id === 'toggleDetailBtn') {
    state.detailVisible = !state.detailVisible;
    syncPanelVisibility();
  }

  if (id === 'toggleMatrixBtn') {
    state.matrixVisible = !state.matrixVisible;
    syncPanelVisibility();
    await renderResultsMatrix();
  }

  if (id === 'downloadCsvFilteredBtn') {
    exportFilteredResultsCsv();
  }

  if (id === 'downloadCsvClassBtn') {
    exportClassResultsCsv();
  }

  if (id === 'downloadMatrixCsvBtn') {
    await exportMatrixCsv();
  }

  const viewButton = event.target.closest('.js-view-result');
  if (viewButton) {
    await renderResultDetail(viewButton.dataset.submissionId);
    document.getElementById('resultDetailPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const resetButton = event.target.closest('.js-reset-result');
  if (resetButton) {
    await handleResetSubmission(
      resetButton.dataset.submissionId,
      resetButton.dataset.studentName || 'diesem Schüler'
    );
  }
});

document.addEventListener('change', async (event) => {
  const id = event.target.id;

  if (id === 'resultClassFilter' || id === 'resultTestFilter' || id === 'resultSessionFilter') {
    await applyResultsView();
  }
});

onTeacherAuthChange(async (_event, session) => {
  if (session) {
    await renderTeacherApp();
  } else {
    showTeacherLogin();
  }
});

window.addEventListener('offline', () => {
  setTeacherStatus('error', 'Keine Netzwerkverbindung. Bitte Verbindung prüfen.');
});

window.addEventListener('online', async () => {
  if (!teacherApp.classList.contains('hidden')) {
    setTeacherStatus('info', 'Netzwerk wieder verfügbar. Daten werden neu geladen ...');
    await refreshTeacherAppSections();
  }
});

route();
