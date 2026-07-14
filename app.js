/*
  PWA Punch Clock for Google Sheets

  Required Google Sheet columns:
  A: Date
  B: From
  C: To

  Authentication is handled by Firebase Authentication with the Google provider.
*/

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

const CONFIG = {
  FIREBASE: {
    apiKey: 'AIzaSyA-NIbcUadW7ihdFm_BWshb_kKEq2drEPg',
    authDomain: 'punch-clock-4da13.firebaseapp.com',
    projectId: 'punch-clock-4da13',
    storageBucket: 'punch-clock-4da13.firebasestorage.app',
    messagingSenderId: '915576697535',
    appId: '1:915576697535:web:229e389b0118cdb439cc0a',
    measurementId: 'G-NGHPVYE233',
  },
  SPREADSHEET_ID: '1wCZYkXgZ_oQT2Q5FwnWlgQNzQHWYdO35CibUX-OZtWo',
  // Leave blank to automatically use the first tab in the spreadsheet.
  SHEET_NAME: '',
  DATE_COLUMN: 'A',
  FROM_COLUMN: 'B',
  TO_COLUMN: 'C',
};

const firebaseApp = initializeApp(CONFIG.FIREBASE);
const auth = getAuth(firebaseApp);
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');

// Firebase refreshes its own ID token automatically. Google API access tokens are
// separate, short-lived credentials, so retain one only for its normal lifetime.
const GOOGLE_ACCESS_TOKEN_KEY = 'googleSheetsAccess';
const GOOGLE_ACCESS_TOKEN_LIFETIME_MS = 55 * 60 * 1000;

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

let accessToken = null;
let googleAccessExpiresAt = 0;
let sheetName = CONFIG.SHEET_NAME;
let activeJob = loadActiveJob();

async function init() {
  updateClock();
  setInterval(updateClock, 1000);
  registerServiceWorker();
  loadVersion();

  els.signInButton.addEventListener('click', signIn);
  els.startButton.addEventListener('click', startJob);
  els.endButton.addEventListener('click', endJob);

  try {
    await setPersistence(auth, browserLocalPersistence);
    onAuthStateChanged(auth, async (user) => {
      const savedAccess = loadGoogleAccess(user?.uid);
      if (!savedAccess) {
        accessToken = null;
        updateButtonState();
        return;
      }

      accessToken = savedAccess.token;
      googleAccessExpiresAt = savedAccess.expiresAt;
      await afterSignIn();
    });
  } catch (error) {
    showMessage(`Could not restore the sign-in session: ${error.message}`, true);
    updateButtonState();
  }
}

async function signIn() {
  setBusy(true);
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    accessToken = credential?.accessToken || null;

    if (!accessToken) {
      throw new Error('Firebase signed you in, but did not return Google Sheets access. Try signing in again.');
    }

    googleAccessExpiresAt = saveGoogleAccess(result.user.uid, accessToken);
    await afterSignIn();
  } catch (error) {
    showMessage(`Sign in failed: ${error.message}`, true);
  } finally {
    setBusy(false);
    updateButtonState();
  }
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
  if (!(await ensureSignedIn())) return;

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
  if (!(await ensureSignedIn())) return;
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
    if (response.status === 401) {
      clearGoogleAccess();
      accessToken = null;
      googleAccessExpiresAt = 0;
      updateButtonState();
      throw new Error('Google Sheets access has expired. Select “Refresh Google access” and try again.');
    }

    const message = data.error?.message || response.statusText || 'Google API request failed.';
    throw new Error(message);
  }

  return data;
}

async function ensureSignedIn() {
  if (hasUsableGoogleAccess()) return true;

  clearGoogleAccess();
  accessToken = null;
  googleAccessExpiresAt = 0;

  if (auth.currentUser) {
    await signIn();
    return hasUsableGoogleAccess();
  }

  if (!accessToken) {
    showMessage('Sign in with Google first.', true);
    return false;
  }
}

function updateButtonState() {
  // A persisted Firebase user can renew Google Sheets access from a Start/End click.
  const signedIn = hasUsableGoogleAccess() || Boolean(auth.currentUser);
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

function hasUsableGoogleAccess() {
  return Boolean(accessToken) && googleAccessExpiresAt > Date.now();
}

function saveGoogleAccess(userId, token) {
  const expiresAt = Date.now() + GOOGLE_ACCESS_TOKEN_LIFETIME_MS;
  localStorage.setItem(
    GOOGLE_ACCESS_TOKEN_KEY,
    JSON.stringify({ userId, token, expiresAt })
  );
  return expiresAt;
}

function loadGoogleAccess(userId) {
  if (!userId) return null;

  try {
    const saved = JSON.parse(localStorage.getItem(GOOGLE_ACCESS_TOKEN_KEY));
    if (saved?.userId === userId && saved.expiresAt > Date.now() && saved.token) return saved;
  } catch {
    // Treat malformed stored data as an expired credential.
  }

  clearGoogleAccess();
  return null;
}

function clearGoogleAccess() {
  localStorage.removeItem(GOOGLE_ACCESS_TOKEN_KEY);
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
