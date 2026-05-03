import { getSupabaseClient } from './config.js?v=2026-04-13-6';
import { uid } from './utils.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error) {
  if (!error) return false;

  const message = String(error.message || '').toLowerCase();
  const name = String(error.name || '').toLowerCase();
  const status = Number(error.status || 0);

  return (
    name.includes('abort') ||
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('networkerror') ||
    message.includes('load failed') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    status >= 500
  );
}

async function withRetry(fn, options = {}) {
  const {
    retries = 2,
    baseDelayMs = 400
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= retries || !isRetryableError(error)) {
        throw error;
      }

      await sleep(baseDelayMs * (attempt + 1));
    }
  }

  throw lastError;
}

export async function hasTeacherSession() {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return !!data.session;
  });
}

export async function loginTeacher(email, password) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function logoutTeacher() {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function onTeacherAuthChange(callback) {
  const supabase = getSupabaseClient();
  return supabase.auth.onAuthStateChange(callback);
}

export async function testSupabaseConnection() {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data, error } = await supabase
      .from('classes')
      .select('id, name')
      .limit(1);

    if (error) throw error;
    return data;
  });
}

export async function loadClasses() {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data, error } = await supabase
      .from('classes')
      .select('id, name')
      .order('name');

    if (error) throw error;
    return data || [];
  });
}

export async function loadTests() {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data, error } = await supabase
      .from('tests')
      .select('id, title, duration_minutes, is_active')
      .eq('is_active', true)
      .order('title');

    if (error) throw error;
    return data || [];
  });
}

export async function loadTestById(testId) {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data, error } = await supabase
      .from('tests')
      .select('id, title, duration_minutes')
      .eq('id', testId)
      .single();

    if (error) throw error;
    return data;
  });
}

export async function loadClassById(classId) {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data, error } = await supabase
      .from('classes')
      .select('id, name')
      .eq('id', classId)
      .single();

    if (error) throw error;
    return data;
  });
}

export async function loadOpenSession() {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data, error } = await supabase
      .from('test_sessions')
      .select('id, title, access_code, is_open, starts_at, ends_at, class_id, test_id, created_at')
      .eq('is_open', true)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw error;
    return data?.[0] || null;
  });
}

export async function createSession({ classId, testId, durationMinutes, title, existingSessionId = null }) {
  const supabase = getSupabaseClient();

  if (existingSessionId) {
    const { error: closeError } = await supabase
      .from('test_sessions')
      .update({ is_open: false })
      .eq('id', existingSessionId);

    if (closeError) throw closeError;
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + durationMinutes * 60 * 1000);
  const accessCode = uid(16);

  const { data, error } = await supabase
    .from('test_sessions')
    .insert({
      class_id: classId,
      test_id: testId,
      title,
      access_code: accessCode,
      is_open: true,
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString()
    })
    .select('id, title, access_code, class_id, test_id, starts_at, ends_at, is_open')
    .single();

  if (error) throw error;
  return data;
}

export async function closeSession(sessionId) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('test_sessions')
    .update({ is_open: false })
    .eq('id', sessionId);

  if (error) throw error;
}

export async function loadStudentsByClassId(classId) {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data, error } = await supabase
      .from('students')
      .select('id, full_name, class_id')
      .eq('class_id', classId)
      .order('full_name');

    if (error) throw error;
    return data || [];
  });
}

export async function importStudents(classId, displayNames) {
  const supabase = getSupabaseClient();

  const dedupedNames = [...new Set(displayNames.filter(Boolean))];
  const rowsToInsert = dedupedNames.map(full_name => ({ class_id: classId, full_name }));

  const { error } = await supabase.from('students').insert(rowsToInsert);
  if (error) throw error;

  return rowsToInsert.length;
}

export async function loadSubmittedStudentIds(sessionId) {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data, error } = await supabase
      .from('submissions')
      .select('student_id')
      .eq('session_id', sessionId);

    if (error) throw error;
    return (data || []).map(entry => entry.student_id);
  });
}

export async function loadQuestionsForTest(testId) {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select('id, question_text, question_order, max_points')
      .eq('test_id', testId)
      .order('question_order', { ascending: true });

    if (questionsError) throw questionsError;
    if (!questions.length) return [];

    const questionIds = questions.map(q => q.id);

    const { data: options, error: optionsError } = await supabase
      .from('answer_options')
      .select('id, question_id, option_text, is_correct, option_order')
      .in('question_id', questionIds)
      .order('option_order', { ascending: true });

    if (optionsError) throw optionsError;

    const optionsByQuestion = {};
    for (const opt of options || []) {
      if (!optionsByQuestion[opt.question_id]) optionsByQuestion[opt.question_id] = [];
      optionsByQuestion[opt.question_id].push(opt);
    }

    return questions.map(q => ({
      ...q,
      options: optionsByQuestion[q.id] || []
    }));
  });
}

export async function studentAlreadySubmitted(sessionId, studentId) {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data, error } = await supabase
      .from('submissions')
      .select('id')
      .eq('session_id', sessionId)
      .eq('student_id', studentId)
      .maybeSingle();

    if (error) throw error;
    return !!data;
  });
}

export async function saveSubmissionWithAnswers({ session, studentId, answers, score, maxScore }) {
  const supabase = getSupabaseClient();

  const { data: submission, error: submissionError } = await supabase
    .from('submissions')
    .insert({
      session_id: session.id,
      student_id: studentId,
      score,
      max_score: maxScore
    })
    .select('id')
    .single();

  if (submissionError) throw submissionError;

  const answerRows = answers.map(answer => ({
    submission_id: submission.id,
    question_id: answer.question_id,
    selected_option_ids: answer.selected_option_ids,
    awarded_points: answer.awarded_points
  }));

  if (answerRows.length) {
    const { error: answersError } = await supabase
      .from('submission_answers')
      .insert(answerRows);

    if (answersError) throw answersError;
  }

  return submission;
}

export async function loadSessionByAccessCode(accessCode) {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data, error } = await supabase
      .from('test_sessions')
      .select('id, title, access_code, is_open, starts_at, ends_at, class_id, test_id')
      .eq('access_code', accessCode)
      .eq('is_open', true)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  });
}

export async function loadResultsDetailed() {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data: submissions, error: submissionsError } = await supabase
      .from('submissions')
      .select('id, session_id, student_id, score, max_score, submitted_at')
      .order('submitted_at', { ascending: false });

    if (submissionsError) throw submissionsError;
    if (!submissions.length) return [];

    const studentIds = [...new Set(submissions.map(s => s.student_id))];
    const sessionIds = [...new Set(submissions.map(s => s.session_id))];

    const [{ data: students, error: studentsError }, { data: sessions, error: sessionsError }] = await Promise.all([
      supabase.from('students').select('id, full_name, class_id').in('id', studentIds),
      supabase.from('test_sessions').select('id, title, class_id, test_id').in('id', sessionIds)
    ]);

    if (studentsError) throw studentsError;
    if (sessionsError) throw sessionsError;

    const classIds = [...new Set((students || []).map(s => s.class_id).concat((sessions || []).map(s => s.class_id)))];
    const testIds = [...new Set((sessions || []).map(s => s.test_id))];

    const [{ data: classes, error: classesError }, { data: tests, error: testsError }] = await Promise.all([
      classIds.length
        ? supabase.from('classes').select('id, name').in('id', classIds)
        : Promise.resolve({ data: [], error: null }),
      testIds.length
        ? supabase.from('tests').select('id, title').in('id', testIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (classesError) throw classesError;
    if (testsError) throw testsError;

    const studentsMap = Object.fromEntries((students || []).map(s => [s.id, s]));
    const sessionsMap = Object.fromEntries((sessions || []).map(s => [s.id, s]));
    const classesMap = Object.fromEntries((classes || []).map(c => [c.id, c]));
    const testsMap = Object.fromEntries((tests || []).map(t => [t.id, t]));

    return submissions.map(sub => {
      const student = studentsMap[sub.student_id];
      const session = sessionsMap[sub.session_id];
      const cls = classesMap[student?.class_id || session?.class_id];
      const test = testsMap[session?.test_id];

      return {
        ...sub,
        session_title: session?.title || 'Unbekannt',
        student_name: student?.full_name || 'Unbekannt',
        class_name: cls?.name || 'Unbekannt',
        test_title: test?.title || 'Unbekannt'
      };
    });
  });
}

export async function loadSubmissionDetail(submissionId) {
  const supabase = getSupabaseClient();

  return withRetry(async () => {
    const { data: submission, error: submissionError } = await supabase
      .from('submissions')
      .select('id, session_id, student_id, score, max_score, submitted_at')
      .eq('id', submissionId)
      .single();

    if (submissionError) throw submissionError;

    const [{ data: student, error: studentError }, { data: session, error: sessionError }, { data: answers, error: answersError }] = await Promise.all([
      supabase.from('students').select('id, full_name, class_id').eq('id', submission.student_id).single(),
      supabase.from('test_sessions').select('id, title, class_id, test_id').eq('id', submission.session_id).single(),
      supabase.from('submission_answers').select('question_id, selected_option_ids, awarded_points').eq('submission_id', submission.id)
    ]);

    if (studentError) throw studentError;
    if (sessionError) throw sessionError;
    if (answersError) throw answersError;

    const [{ data: cls, error: classError }, { data: test, error: testError }, questions] = await Promise.all([
      supabase.from('classes').select('id, name').eq('id', student.class_id || session.class_id).single(),
      supabase.from('tests').select('id, title').eq('id', session.test_id).single(),
      loadQuestionsForTest(session.test_id)
    ]);

    if (classError) throw classError;
    if (testError) throw testError;

    const answersMap = Object.fromEntries((answers || []).map(a => [a.question_id, a]));

    const questionDetails = questions.map(question => {
      const answer = answersMap[question.id] || { selected_option_ids: [], awarded_points: 0 };
      const selectedIds = answer.selected_option_ids || [];

      return {
        id: question.id,
        order: question.question_order,
        text: question.question_text,
        max_points: Number(question.max_points || 1),
        awarded_points: Number(answer.awarded_points || 0),
        options: question.options.map(option => ({
          id: option.id,
          text: option.option_text,
          is_correct: !!option.is_correct,
          is_selected: selectedIds.includes(option.id)
        }))
      };
    });

    return {
      submission,
      student,
      classInfo: cls,
      test,
      session,
      questions: questionDetails
    };
  });
}

export async function resetSubmission(submissionId) {
  const supabase = getSupabaseClient();

  const { error: answersError } = await supabase
    .from('submission_answers')
    .delete()
    .eq('submission_id', submissionId);

  if (answersError) throw answersError;

  const { error: submissionError } = await supabase
    .from('submissions')
    .delete()
    .eq('id', submissionId);

  if (submissionError) throw submissionError;
}
