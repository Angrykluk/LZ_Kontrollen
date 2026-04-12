import { validateSupabaseConfig } from './config.js';
import { typesetMath } from './math.js';
import { escapeHtml, getUrlParams, shuffle } from './utils.js';
import {
  testSupabaseConnection,
  loadSessionByAccessCode,
  loadClassById,
  loadTestById,
  loadStudentsByClassId,
  loadSubmittedStudentIds,
  loadQuestionsForTest,
  studentAlreadySubmitted,
  saveSubmissionWithAnswers
} from './api.js';

const loadingApp = document.getElementById('loadingApp');
const studentApp = document.getElementById('studentApp');
let studentTestRuntime = null;

function hideAllViews() {
  loadingApp.classList.add('hidden');
  studentApp.classList.add('hidden');
}

function showStudentApp() {
  hideAllViews();
  studentApp.classList.remove('hidden');
}

function showLoading(message = 'Die Anwendung wird geladen ...') {
  hideAllViews();
  loadingApp.classList.remove('hidden');
  loadingApp.innerHTML = `<h1>Lernkontrollen</h1><p class="subtitle">${escapeHtml(message)}</p>`;
}

async function showStudentMessage(title, text, type = 'info') {
  const boxClass = type === 'error' ? 'error-box' : type === 'success' ? 'success-box' : 'info';
  showStudentApp();
  studentApp.innerHTML = `
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      <div class="${boxClass}">${escapeHtml(text)}</div>
    </div>
  `;
  await typesetMath(studentApp);
}

async function renderStudentEntry(sessionCode) {
  try {
    const session = await loadSessionByAccessCode(sessionCode);
    if (!session) {
      await showStudentMessage('Kein aktiver Test', 'Dieser Link ist nicht aktiv oder die Freigabe wurde bereits geschlossen.', 'error');
      return;
    }

    const now = new Date();
    if (session.ends_at && new Date(session.ends_at) < now) {
      await showStudentMessage('Test beendet', 'Die Bearbeitungszeit dieser Session ist bereits abgelaufen.', 'error');
      return;
    }

    const [cls, test, students, submittedIds] = await Promise.all([
      loadClassById(session.class_id),
      loadTestById(session.test_id),
      loadStudentsByClassId(session.class_id),
      loadSubmittedStudentIds(session.id)
    ]);

    const options = students.map(student => {
      const done = submittedIds.includes(student.id);
      return `<option value="${student.id}" ${done ? 'disabled' : ''}>${escapeHtml(student.full_name)}${done ? ' (bereits durchgeführt)' : ''}</option>`;
    }).join('');

    showStudentApp();
    studentApp.innerHTML = `
      <div class="card">
        <div class="topbar">
          <div>
            <h1>${escapeHtml(test.title)}</h1>
            <p class="subtitle">${escapeHtml(cls.name)} · ${escapeHtml(session.title)}</p>
          </div>
          <span class="badge success">Session aktiv</span>
        </div>
        <div class="notice">Fragen und Antwortreihenfolgen werden beim Start zufällig gemischt.</div>
        <label for="studentNameSelect">Name auswählen</label>
        <select id="studentNameSelect">
          <option value="">Bitte Namen wählen</option>
          ${options}
        </select>
        <div class="row" style="margin-top:12px;">
          <button id="startTestBtn">Test starten</button>
        </div>
        <p class="small">Ein Name kann diese Session nur einmal abgeben.</p>
      </div>
    `;
    await typesetMath(studentApp);

    document.getElementById('startTestBtn').onclick = async () => {
      const studentId = document.getElementById('studentNameSelect').value;
      if (!studentId) {
        alert('Bitte zuerst einen Namen auswählen.');
        return;
      }
      const selectedStudent = students.find(s => s.id === studentId);
      const alreadyDone = await studentAlreadySubmitted(session.id, studentId);
      if (alreadyDone) {
        await showStudentMessage('Bereits durchgeführt', `${selectedStudent.full_name} hat diesen Test bereits bearbeitet.`, 'error');
        return;
      }
      await startStudentTest({ session, cls, test, student: selectedStudent });
    };
  } catch (error) {
    console.error(error);
    await showStudentMessage('Fehler', 'Die Session konnte nicht geladen werden: ' + error.message, 'error');
  }
}

async function startStudentTest({ session, cls, test, student }) {
  try {
    const rawQuestions = await loadQuestionsForTest(test.id);
    if (!rawQuestions.length) {
      await showStudentMessage('Keine Fragen gefunden', 'Für diesen Test wurden noch keine Fragen hinterlegt.', 'error');
      return;
    }

    const randomizedQuestions = shuffle(rawQuestions).map((q, qIndex) => {
      const shuffledOptions = shuffle(q.options).map(opt => ({
        id: opt.id,
        text: opt.option_text,
        is_correct: !!opt.is_correct
      }));
      return {
        id: q.id,
        order: qIndex + 1,
        text: q.question_text,
        max_points: q.max_points || 1,
        options: shuffledOptions
      };
    });

    const startTime = Date.now();
    const endTime = session.ends_at ? new Date(session.ends_at).getTime() : (startTime + (test.duration_minutes || 15) * 60000);
    let submitted = false;

    if (studentTestRuntime?.timerHandle) {
      clearInterval(studentTestRuntime.timerHandle);
    }

    showStudentApp();
    studentApp.innerHTML = `
      <div class="card">
        <div class="topbar">
          <div>
            <h1>${escapeHtml(test.title)}</h1>
            <p class="subtitle">Name: ${escapeHtml(student.full_name)} · ${escapeHtml(cls.name)}</p>
          </div>
          <div class="timer" id="timerDisplay">--:--</div>
        </div>
        <form id="testForm"></form>
        <div class="row">
          <button id="submitTestBtn" type="button">Abgeben</button>
        </div>
      </div>
    `;

    const form = document.getElementById('testForm');
    form.innerHTML = randomizedQuestions.map((q, qi) => `
      <div class="question">
        <h3>Frage ${qi + 1}</h3>
        <p>${escapeHtml(q.text)}</p>
        ${q.options.map((opt, oi) => `
          <label class="option">
            <input type="checkbox" name="q_${qi}" value="${oi}" />
            <span>${escapeHtml(opt.text)}</span>
          </label>
        `).join('')}
      </div>
    `).join('');

    await typesetMath(studentApp);

    async function submitTest(autoSubmitted = false) {
      if (submitted) return;
      submitted = true;
      clearInterval(studentTestRuntime?.timerHandle);
    
      const doubleCheck = await studentAlreadySubmitted(session.id, student.id);
      if (doubleCheck) {
        await showStudentMessage('Bereits durchgeführt', `${student.full_name} hat diesen Test bereits bearbeitet.`, 'error');
        return;
      }
    
      const answerPayload = [];
      let score = 0;
      let maxScore = 0;
    
      randomizedQuestions.forEach((question, qi) => {
        const selectedIndices = [...document.querySelectorAll(`input[name="q_${qi}"]:checked`)]
          .map(input => Number(input.value));
        const selectedOptions = selectedIndices.map(index => question.options[index]);
        const selectedOptionIds = selectedOptions.map(opt => opt.id);
    
        const totalCorrect = question.options.filter(opt => opt.is_correct).length;
        const correctSelected = selectedOptions.filter(opt => opt.is_correct).length;
        const wrongSelected = selectedOptions.filter(opt => !opt.is_correct).length;
    
        const rawFraction = (correctSelected - wrongSelected) / totalCorrect;
        const fraction = Math.max(0, Math.min(1, rawFraction));
        const awardedPoints = Number((fraction * (question.max_points || 1)).toFixed(2));
    
        score += awardedPoints;
        maxScore += (question.max_points || 1);
    
        answerPayload.push({
          question_id: question.id,
          selected_option_ids: selectedOptionIds,
          awarded_points: awardedPoints,
          selected_indices: selectedIndices
        });
      });
    
      try {
        await saveSubmissionWithAnswers({
          session,
          studentId: student.id,
          answers: answerPayload,
          score: Number(score.toFixed(2)),
          maxScore: Number(maxScore.toFixed(2))
        });
    
        const reviewHtml = randomizedQuestions.map((question, qi) => {
          const answer = answerPayload.find(a => a.question_id === question.id);
          const selectedIds = new Set(answer?.selected_option_ids || []);
    
          const optionsHtml = question.options.map((opt) => {
            const wasSelected = selectedIds.has(opt.id);
            const isCorrect = !!opt.is_correct;
    
            let badges = '';
            if (wasSelected) badges += '<span class="badge warning">Gewählt</span> ';
            if (isCorrect) badges += '<span class="badge success">Richtig</span>';
            if (wasSelected && !isCorrect) badges += '<span class="badge danger">Falsch gewählt</span>';
    
            return `
              <div class="review-option ${isCorrect ? 'review-correct' : ''} ${wasSelected ? 'review-selected' : ''}">
                <div>
                  <div>${escapeHtml(opt.text)}</div>
                  <div class="row" style="margin-top:8px;">${badges}</div>
                </div>
              </div>
            `;
          }).join('');
    
          return `
            <div class="question">
              <h3>Frage ${qi + 1}</h3>
              <p>${escapeHtml(question.text)}</p>
              <div class="small" style="margin-bottom:10px;">
                Erreichte Punkte: <strong>${answer ? answer.awarded_points.toFixed(2) : '0.00'}</strong> / ${(question.max_points || 1).toFixed(2)}
              </div>
              ${optionsHtml}
            </div>
          `;
        }).join('');
    
        showStudentApp();
        studentApp.innerHTML = `
          <div class="card">
            <h1>Ergebnis</h1>
            <div class="result-box">
              <p><strong>${escapeHtml(student.full_name)}</strong>, du hast <strong>${score.toFixed(2)} von ${maxScore.toFixed(2)}</strong> Punkten erreicht.</p>
              <p>Quote: <strong>${Math.round((score / maxScore) * 100)}%</strong></p>
              <p>${autoSubmitted ? 'Der Test wurde wegen Zeitablauf automatisch abgegeben.' : 'Der Test wurde erfolgreich abgegeben.'}</p>
            </div>
    
            <div class="info">
              <strong>Legende:</strong><br>
              <span class="badge warning">Gewählt</span>
              <span class="badge success">Richtig</span>
              <span class="badge danger">Falsch gewählt</span>
            </div>
    
            <h3>Auswertung im Detail</h3>
            ${reviewHtml}
          </div>
        `;
        await typesetMath(studentApp);
      } catch (error) {
        console.error(error);
        await showStudentMessage('Fehler beim Speichern', 'Die Abgabe konnte nicht gespeichert werden: ' + error.message, 'error');
      }
    }

    function updateTimer() {
      const remaining = Math.max(0, endTime - Date.now());
      const totalSeconds = Math.ceil(remaining / 1000);
      const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
      const ss = String(totalSeconds % 60).padStart(2, '0');
      const timerDisplay = document.getElementById('timerDisplay');
      if (timerDisplay) timerDisplay.textContent = `${mm}:${ss}`;
      if (remaining <= 0) {
        submitTest(true);
      }
    }

    document.getElementById('submitTestBtn').onclick = () => submitTest(false);
    const timerHandle = setInterval(updateTimer, 250);
    studentTestRuntime = { timerHandle };
    updateTimer();
  } catch (error) {
    console.error(error);
    await showStudentMessage('Fehler', 'Der Test konnte nicht gestartet werden: ' + error.message, 'error');
  }
}

async function route() {
  showLoading('Die Anwendung wird geladen ...');

  if (!validateSupabaseConfig()) {
    showLoading('Bitte zuerst in js/config.js deine Supabase-URL und deinen Public Key eintragen.');
    return;
  }

  const sessionCode = getUrlParams().get('session');
  if (!sessionCode) {
    await showStudentMessage('Kein aktiver Test', 'Dieser Link enthält keine Session-ID. Nutze den QR-Code oder den Session-Link der Lehrkraft.', 'error');
    return;
  }

  await renderStudentEntry(sessionCode);
}

route();
