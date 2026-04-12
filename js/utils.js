export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function uid(length = 12) {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function getUrlParams() {
  return new URLSearchParams(window.location.search);
}

export function getSiteBaseUrl() {
  return new URL('.', window.location.href);
}

export function buildStudentUrl(sessionCode) {
  const base = getSiteBaseUrl();
  const url = new URL('student.html', base);
  url.searchParams.set('session', sessionCode);
  return url.toString();
}

export function buildTeacherUrl() {
  return new URL('teacher.html', getSiteBaseUrl()).toString();
}

export function formatDateTime(value) {
  return new Date(value).toLocaleString('de-DE');
}

export function percent(score, maxScore) {
  if (!maxScore) return 0;
  return Math.round((Number(score) / Number(maxScore)) * 100);
}

export function parseCsvLine(line, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

export function parseCsvText(csvText) {
  const cleanedText = csvText.replace(/^\uFEFF/, '');
  const lines = cleanedText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (!lines.length) {
    throw new Error('Die CSV-Datei ist leer.');
  }

  const firstLine = lines[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';
  const headers = parseCsvLine(firstLine, delimiter).map(h => h.trim());

  const vornameIndex = headers.findIndex(h => h === 'Vorname');
  const nachnameIndex = headers.findIndex(h => h === 'Nachname');

  if (vornameIndex === -1 || nachnameIndex === -1) {
    throw new Error('Die CSV muss die Spalten "Vorname" und "Nachname" enthalten.');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], delimiter);
    const vorname = (values[vornameIndex] || '').trim();
    const nachname = (values[nachnameIndex] || '').trim();
    if (!vorname || !nachname) continue;
    rows.push({
      vorname,
      nachname,
      displayName: `${vorname} ${nachname.charAt(0).toUpperCase()}.`
    });
  }

  return rows;
}
