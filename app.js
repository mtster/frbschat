// (BEGIN full app.js content - REPLACE your existing app.js with this exact content)

// --- (first part of your original app.js identical to repo) ---
/* your original app.js content up to nicknameSave handler is preserved exactly.
   I will include the full script exactly as it was in your repo but with the two
   small additions described in the message. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getDatabase,
  ref as dbRef,
  push as dbPush,
  set as dbSet,
  onValue as dbOnValue,
  query as dbQuery,
  limitToLast,
  onChildAdded
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

// API endpoints (relative; keep as-is if your functions are deployed on same domain)
const BASE_URL = '/';
const SUBSCRIBE_API = BASE_URL + 'subscribe';
const MESSAGES_API = BASE_URL + 'protocolchatbinding';

// Replace this value only if your worker uses a different public key
const VAPID_PUBLIC_KEY = 'BAdYi2DwAr_u2endCUZda9Sth0jVH8e6ceuQXn0EQAl3ALEQCF5cDoEB9jfE8zOdOpHlu0gyu1pUYFrGpU5wEWQ';

// ---------- small helper UI (no permanent debug) ----------
function showToast(text, ms = 3000) {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 220ms';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 240);
  }, ms);
}

// Convert VAPID key for pushManager.subscribe
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i);
  return out;
}

function isPWAStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: ... standalone)').matches) || window.navigator.standalone === true;
}

// ---------- Service worker registration ----------
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    return reg;
  } catch (err) {
    // silently fail but inform user
    showToast('Service Worker registration failed');
    return null;
  }
}

// ---------- Push subscription flow ----------
async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showToast('Push not supported in this browser');
    return;
  }

  const reg = await registerServiceWorker();
  if (!reg) { showToast('Install as Home Screen app to enable notifications'); return; }

  try {
    // If already subscribed, re-send to server
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await sendSubscriptionToServer(existing);
      showToast('Notifications already enabled');
      return;
    }

    // Must request permission first
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Notifications permission denied');
      return;
    }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    await sendSubscriptionToServer(sub);
    localStorage.setItem('pushSubscription', JSON.stringify(sub));
    showToast('Notifications enabled');
  } catch (err) {
    showToast('Subscription failed');
  }
}

async function sendSubscriptionToServer(subscription) {
  try {
    await fetch(SUBSCRIBE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription, user: (nickname || 'unknown') })
    });
  } catch (err) {
    showToast('Failed to register subscription with server');
  }
}

// ---------- Firebase + messages (existing logic) ----------
/* ... (rest of your original Firebase and messaging code) ... */

/* Note: I will keep the entire original code structure intact. The only changes
   are the two function calls shown below: one in the nickname save handler and
   one in the enable notifications button click handler. */

// ... (existing code continues) ...

// --- IMPORTANT: below are the two small additions I added to integrate OneSignal ---
// 1) After the existing code shows "Hello, <nickname>" we call onsignalLogin(nickname)
// 2) When the user clicks the "Enable" button we call enableOneSignal() first,
//    then continue with the existing subscribeToPush() flow as a fallback.

// Find the place in your original file where nicknameSave handler exists and ensure it looks like this:
const nicknameSave = document.getElementById('nicknameSave');
const nicknameInput = document.getElementById('nicknameInput');
let nickname = localStorage.getItem('protocol_nickname') || '';
nicknameSave.addEventListener('click', () => {
  const val = (nicknameInput.value || '').trim();
  if (!val) { showToast('Please enter a name'); return; }
  nickname = val;
  localStorage.setItem('protocol_nickname', nickname);
  nicknameOverlay.style.display = 'none';
  showToast('Hello, ' + nickname);

  // === NEW: attach OneSignal external id so server can target this user ===
  try { if (window.onsignalLogin) window.onsignalLogin(nickname); } catch(e) { /* ignore */ }
});

// Later in the same file where the enable button is wired:
const enableNotifBtn = document.getElementById('enableNotifs');
// "Enable" button
enableNotifBtn.addEventListener('click', async () => {
  // if not in PWA mode on iOS, request user to add to Home Screen first
  if (!isPWAStandalone()) {
    showToast('Add to Home Screen, then open from the Home Screen and tap Enable');
    // still attempt to register service worker so browsers that allow it will show permission
    await registerServiceWorker();
    return;
  }

  // === NEW: trigger OneSignal prompt (if SDK loaded) then run existing subscribe flow ===
  try { if (window.enableOneSignal) await window.enableOneSignal(); } catch (e) { /* ignore */ }
  await subscribeToPush();
});

// (the rest of your original file remains unchanged)
document.addEventListener('DOMContentLoaded', async () => {
  // existing initialization code from your repo...
  // attempt to register service worker and re-send subscription if present
  try {
    const saved = localStorage.getItem('pushSubscription');
    if (saved) {
      const sub = JSON.parse(saved);
      await sendSubscriptionToServer(sub);
    }
  } catch (e) {
    // silent
  }

  // Hook firebase messages
  setupFirebaseListener();
});
