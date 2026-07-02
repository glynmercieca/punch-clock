/*
  PWA Punch Clock for Google Sheets

  Required Google Sheet columns:
  A: Date
  B: From
  C: To

  Before deploying, replace CLIENT_ID with your Google Cloud OAuth Client ID.
*/

const CONFIG = {
  CLIENT_ID: '898150360212-1pv0qasjo0pi6fngasu06940jej5gmqh.apps.googleusercontent.com',
  SPREADSHEET_ID: '1wCZYkXgZ_oQT2Q5FwnWlgQNzQHWYdO35CibUX-OZtWo',
  // Leave blank to automatically use the first tab in the spreadsheet.
  SHEET_NAME: '',
  DATE_COLUMN: 'A',
  FROM_COLUMN: 'B',
  TO_COLUMN: 'C',
};

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

const els = {
  currentDate: document.getElementById('currentDate'),
  currentTime: document.getElementById('currentTime'),
  signInButton: document.getElementById('signInButton'),
  startButton: document.getElementById('startButton'),
  endButton: document.getElementById('endButton'),
  message: document.getElementById('message'),
  version: document.getElementById('version'),
  connectionStatus: document.getElementById('connectionStatus'),
  accountPanel: document.getElementById('accountPanel'),
  accountAvatar: document.getElementById('accountAvatar'),
  accountName: document.getElementById('accountName'),
  accountEmail: document.getElementById('accountEmail'),
};

let tokenClient;
let accessToken = null;
let sheetName = CONFIG.SHEET_NAME;
let activeJob = loadActiveJob();

function init() {
  updateClock();
  setInterval(updateClock, 1000);
  registerServiceWorker();
  loadVersion();

  els.signInButton.addEventListener('click', signIn);
  els.startButton.addEventListener('click', startJob);
  els.endButton.addEventListener('click', endJob);

  waitForGoogleIdentity();
  updateButtonState();
}

function waitForGoogleIdentity() {
  if (!window.google?.accounts?.oauth2) {
    setTimeout(waitForGoogleIdentity, 100);
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: SCOPES,
    callback: async (response) => {
      if (response.error) {
        showMessage(`Sign in failed: ${response.error}`, true);
        return;
      }

      accessToken = response.access_token;
      await afterSignIn();
    },
  });
}

function signIn() {
  if (CONFIG.CLIENT_ID.includes('PASTE_')) {
    showMessage('Add your Google OAuth Client ID in app.js first.', true);
    return;
  }

  tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
}

async function afterSignIn() {
  try {
    await Promise.all([loadGoogleProfile(), resolveSheetName()]);
    els.connectionStatus.textContent = 'Signed in';
    els.connectionStatus.classList.remove('signed-out');
    els.connectionStatus.classList.add('signed-in');
    els.signInButton.textContent = 'Refresh Google access';
    showMessage(activeJob ? 'Signed in. You have an active job.' : 'Signed in. Ready to start a job.');
    updateButtonState();
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function loadGoogleProfile() {
  const profile = await googleFetch('https://www.googleapis.com/oauth2/v3/userinfo');
  els.accountName.textContent = profile.name || 'Google account';
  els.accountEmail.textContent = profile.email || '';

  if (profile.picture) {
    els.accountAvatar.src = profile.picture;
    els.accountAvatar.classList.remove('hidden');
  }

  els.accountPanel.classList.remove('hidden');
}

async function resolveSheetName() {
  if (sheetName) return;

  const data = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}?fields=sheets.properties.title`
  );

  const firstSheet = data.sheets?.[0]?.properties?.title;
  if (!firstSheet) throw new Error('Could not find a sheet tab in the spreadsheet.');
  sheetName = firstSheet;
}

async function startJob() {
  if (!ensureSignedIn()) return;

  setBusy(true);
  try {
    const now = new Date();
    const date = formatDate(now);
    const time = formatTime(now);
    const range = encodeURIComponent(`'${sheetName}'!${CONFIG.DATE_COLUMN}:${CONFIG.TO_COLUMN}`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&includeValuesInResponse=true`;

    const result = await googleFetch(url, {
      method: 'POST',
      body: JSON.stringify({ values: [[date, time, '']] }),
    });

    const updatedRange = result.updates?.updatedRange || '';
    const rowNumber = extractRowNumber(updatedRange);
    if (!rowNumber) throw new Error('The row was added, but the row number could not be detected.');

    activeJob = { rowNumber, date, from: time, sheetName };
    saveActiveJob(activeJob);
    showMessage(`Started job at ${time}. Row ${rowNumber} was created.`);
  } catch (error) {
    showMessage(`Could not start job: ${error.message}`, true);
  } finally {
    setBusy(false);
    updateButtonState();
  }
}

async function endJob() {
  if (!ensureSignedIn()) return;
  if (!activeJob?.rowNumber) {
    showMessage('No active job found. Start a job first.', true);
    updateButtonState();
    return;
  }

  setBusy(true);
  try {
    const time = formatTime(new Date());
    const targetSheet = activeJob.sheetName || sheetName;
    const range = encodeURIComponent(`'${targetSheet}'!${CONFIG.TO_COLUMN}${activeJob.rowNumber}:${CONFIG.TO_COLUMN}${activeJob.rowNumber}`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;

    await googleFetch(url, {
      method: 'PUT',
      body: JSON.stringify({ values: [[time]] }),
    });

    showMessage(`Ended job at ${time}. Row ${activeJob.rowNumber} was updated.`);
    activeJob = null;
    clearActiveJob();
  } catch (error) {
    showMessage(`Could not end job: ${error.message}`, true);
  } finally {
    setBusy(false);
    updateButtonState();
  }
}

async function googleFetch(url, options = {}) {
  if (!accessToken) throw new Error('Please sign in with Google first.');

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = data.error?.message || response.statusText || 'Google API request failed.';
    throw new Error(message);
  }

  return data;
}

function ensureSignedIn() {
  if (!accessToken) {
    showMessage('Sign in with Google first.', true);
    return false;
  }
  return true;
}

function updateButtonState() {
  const signedIn = Boolean(accessToken);
  els.startButton.disabled = !signedIn || Boolean(activeJob);
  els.endButton.disabled = !signedIn || !activeJob;
}

function setBusy(isBusy) {
  els.startButton.disabled = true;
  els.endButton.disabled = true;
  els.signInButton.disabled = isBusy;
  if (!isBusy) els.signInButton.disabled = false;
}

function updateClock() {
  const now = new Date();
  els.currentDate.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);

  els.currentTime.textContent = formatTime(now);
}

function formatDate(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-');
}

function formatTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function extractRowNumber(range) {
  // Example updatedRange: 'Sheet1'!A12:C12
  const match = range.match(/[A-Z]+(\d+):[A-Z]+\d+$/i);
  return match ? Number(match[1]) : null;
}

function showMessage(text, isError = false) {
  els.message.textContent = text;
  els.message.style.color = isError ? 'var(--red)' : 'var(--muted)';
}

function loadActiveJob() {
  try {
    return JSON.parse(localStorage.getItem('activeJob')) || null;
  } catch {
    return null;
  }
}

function saveActiveJob(job) {
  localStorage.setItem('activeJob', JSON.stringify(job));
}

function clearActiveJob() {
  localStorage.removeItem('activeJob');
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // The app still works without offline caching.
    });
  }
}

async function loadVersion() {
  if (!els.version) return;

  try {
    const response = await fetch('./version.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Version file not available.');

    const data = await response.json();
    els.version.textContent = `Version ${data.version || 'unknown'}`;
  } catch {
    els.version.textContent = 'Version unavailable';
  }
}

document.addEventListener('DOMContentLoaded', init);
