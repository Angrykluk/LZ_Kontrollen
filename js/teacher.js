import { getSupabaseClient, validateSupabaseConfig } from './config.js';
import { typesetMath } from './math.js';
import { escapeHtml, buildStudentUrl, formatDateTime, parseCsvText, percent } from './utils.js';
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
} from './api.js';

const loadingApp = document.getElementById('loadingApp');
const teacherLoginView = document.getElementById('teacherLogin');
const teacherApp = document.getElementById('teacherApp');
const teacherStatusBox = document.getElementById('teacherStatusBox');

const state = {
  activeSession: null,
  tests: [],
  results: [],
  selectedSubmissionId: null,
  renderRun: 0
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

async function tryRefreshExistingSession() {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();

    if (data?.session) {
      await supabase.auth.refreshSession();
    }
  } catch (error) {
    console.warn('Session-Refresh fehlgeschlagen:', error);
  }
}

async function populateTeacherSelectors() {
  const [classes, tests] = await Promise.all([loadClasses(), loadTests()]);
  state.tests = tests;

  const classSelect = document.getElementById('classSelect');
  const testSelect = document.getElementById('testSelect');
  const importClassSelect = document.getElementById('importClassSelect');

  classSelect.innerHTML = classes.length
    ? classes.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
    : '<option value="">Keine Klasse vorhanden</option>';

  importClassSelect.innerHTML = classes.length
    ? classes.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
    : '<option value="">Keine Klasse vorhanden</option>';

  testSelect.innerHTML = tests.length
    ? tests.map(t => `<option value="${t.id}" data-duration="${t.duration_minutes}">${escapeHtml(t.title)}</option>`).join('')
    : '<option value="">Kein Test vorhanden</option>';

  if (tests.length) {
    document.getElementById('durationInput').value = tests[0].duration_minutes || 15;
  }

  testSelect.onchange = () => {
    const selected = state.tests.find(t => t.id === testSelect.value);
    if (selected) {
      document.getElementById('durationInput').value = selected.duration_minutes || 15;
    }
  };
}

async function renderTeacherActiveSession() {
  const active = await loadOpenSession();
  state.activeSession = active;

  const infoBox = document.getElementById('activeSessionInfo');
  const linkBox = document.getElementById('sessionLinkBox');
  const qrcodeBox = document.getElementById('qrcode');

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
  new QRCode(qrcodeBox, {
    text: sessionUrl,
    width: 200,
    height: 200
  });
}

function renderResultDetailEmpty(message = 'Wähle in der Tabelle einen Eintrag aus, um die Detailauswertung zu sehen.') {
  const panel = document.getElementById('resultDetailPanel');
  if (!panel) return;
  panel.innerHTML = `<div class="result-detail-empty">${escapeHtml(message)}</div>`;
}

async function renderResultsOverview() {
  const rows = await loadResultsDetailed();
  state.results = rows;

  const tbody = document.getElementById('resultsTableBody');
  const summary = document.getElementById('resultsSummary');

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="small">Noch keine Ergebnisse vorhanden.</td></tr>';
    summary.textContent = 'Noch keine Ergebnisse vorhanden.';
    renderResultDetailEmpty();
    return;
  }

  summary.textContent = `${rows.length} Ergebnis(se) gespeichert. Klicke auf „Ansehen“, um Fragen und Antworten zu prüfen.`;

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

  if (state.selectedSubmissionId && rows.some(r => r.id === state.selectedSubmissionId)) {
    await renderResultDetail(state.selectedSubmissionId);
  } else {
    state.selectedSubmissionId = null;
    renderResultDetailEmpty();
  }
}

async function renderResultDetail(submissionId) {
  state.selectedSubmissionId = submissionId;

  const panel = document.getElementById('resultDetailPanel');
  if (!panel) return;

  panel.innerHTML = '<div class="small">Detailauswertung wird geladen ...</div>';

  try {
    const detail = await loadSubmissionDetail(submissionId);
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
    // Kein direktes renderTeacherApp() hier.
    // Das übernimmt onTeacherAuthChange().
  } catch (error) {
    console.error(error);
    messageBox.textContent = 'Login fehlgeschlagen: ' + error.message;
  }
}

async function handleLogout() {
  clearTeacherLoginFields();
  showTeacherLogin();

  try {
    await logoutTeacher();
  } catch (error) {
    console.error('Logout fehlgeschlagen:', error);
  } finally {
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

  await typesetMath(teacherApp);
}

async function renderTeacherApp() {
  showTeacherApp();
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
    await tryRefreshExistingSession();
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
    showTeacherLogin();

    const messageBox = document.getElementById('teacherLoginMessage');
    if (messageBox) {
      messageBox.textContent = 'Die Session konnte nicht geprüft werden: ' + error.message;
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

  const viewButton = event.target.closest('.js-view-result');
  if (viewButton) {
    await renderResultDetail(viewButton.dataset.submissionId);
  }

  const resetButton = event.target.closest('.js-reset-result');
  if (resetButton) {
    await handleResetSubmission(
      resetButton.dataset.submissionId,
      resetButton.dataset.studentName || 'diesem Schüler'
    );
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
