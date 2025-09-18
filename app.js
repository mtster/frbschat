// app.js - Protocol Chat (Cloudflare + Web Push + Firebase RTDB)
// Replace VAPID_PUBLIC_KEY value with your own public key if different.
import { db } from './firebase-config.js';
import {
  ref as dbRef,
  push as dbPush,
  set as dbSet,
  query as dbQuery,
  limitToLast,
  onChildAdded
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const FIREBASE_DB_URL = 'https://protocol-chat-b6120-default-rtdb.europe-west1.firebasedatabase.app';
const BASE_URL = '/';
const MESSAGES_API = BASE_URL + 'protocolchatbinding';
const SUBSCRIBE_API = BASE_URL + 'subscribe';

// Public VAPID key (URL-safe base64). This can be public and must match the server's key.
const VAPID_PUBLIC_KEY = 'BAdYi2DwAr_u2endCUZda9Sth0jVH8e6ceuQXn0EQAl3ALEQCF5cDoEB9jfE8zOdOpHlu0gyu1pUYFrGpU5wEWQ';

// ---- Utilities ----
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function isPWAStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

// Simple toast + debug area (visual debug for iPhone)
function showToast(text, ms = 4000) {
  const toastRoot = document.getElementById('toast');
  if (!toastRoot) return;
  const el = document.createElement('div');
  el.className = 'm-2 p-2 rounded text-sm bg-gray-900 text-white';
  el.style.opacity = '0.95';
  el.textContent = text;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), ms);
  appendDebug('TOAST: ' + text);
}

function appendDebug(text) {
  const dbg = document.getElementById('debugLog');
  if (!dbg) return;
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  line.style.fontSize = '12px';
  line.style.padding = '2px 0';
  dbg.prepend(line);
}

// ---- Service worker registration and messaging ----
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    appendDebug('Service worker not supported in this browser.');
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    appendDebug('Service worker registered: scope=' + reg.scope);
    // Listen for messages from the service worker
    navigator.serviceWorker.addEventListener('message', (ev) => {
      appendDebug('SW -> ' + (ev.data && ev.data.type ? ev.data.type + ': ' + JSON.stringify(ev.data) : JSON.stringify(ev.data)));
      if (ev.data && ev.data.type === 'push-received') {
        // show a short toast (visual debug)
        showToast('Push received: ' + (ev.data.payload?.message || ev.data.payload?.data || '...'), 5000);
      }
    });
    return reg;
  } catch (err) {
    appendDebug('Service worker registration failed: ' + err);
    showToast('Service worker registration failed');
    return null;
  }
}

// ---- Push subscription flow ----
async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showToast('Push not supported in this browser');
    appendDebug('PushManager or ServiceWorker missing');
    return;
  }

  const reg = await registerServiceWorker();
  if (!reg) return;

  try {
    // If already subscribed locally, re-send to server
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      appendDebug('Already have subscription, sending to server (re-register).');
      await sendSubscriptionToServer(existing);
      showToast('Notifications already enabled');
      return;
    }

    // Request permission (must be user-initiated on iOS)
    const permission = await Notification.requestPermission();
    appendDebug('Notification.requestPermission -> ' + permission);
    if (permission !== 'granted') {
      showToast('Notifications permission not granted');
      return;
    }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    appendDebug('Got subscription: ' + JSON.stringify(sub));
    await sendSubscriptionToServer(sub);
    localStorage.setItem('pushSubscription', JSON.stringify(sub));
    showToast('Notifications enabled (subscription saved)');
  } catch (err) {
    appendDebug('subscribeToPush error: ' + err);
    showToast('Subscription failed: ' + (err && err.message ? err.message : err));
  }
}

async function sendSubscriptionToServer(subscription) {
  try {
    const resp = await fetch(SUBSCRIBE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription, user: (nickname || 'unknown') })
    });
    if (!resp.ok) {
      const txt = await resp.text();
      appendDebug('subscribe endpoint returned error: ' + resp.status + ' - ' + txt);
      showToast('Server subscribe error');
    } else {
      appendDebug('Subscription saved on server');
    }
  } catch (err) {
    appendDebug('Failed to send subscription to server: ' + err);
    showToast('Failed to reach subscribe endpoint');
  }
}

// ---- Firebase: listen & send messages ----
let messages = [];
let nickname = localStorage.getItem('protocol_nickname') || '';

function renderMessages(container = document.getElementById('messages')) {
  if (!container) return;
  container.innerHTML = '';
  for (const m of messages) {
    const el = document.createElement('div');
    el.className = 'mb-2';
    const who = document.createElement('div');
    who.className = 'text-xs opacity-80';
    who.textContent = m.user + ' • ' + new Date(m.ts).toLocaleTimeString();
    const txt = document.createElement('div');
    txt.className = 'text-base';
    txt.textContent = m.message;
    el.appendChild(who);
    el.appendChild(txt);
    container.appendChild(el);
  }
  // keep scrolled to bottom
  container.scrollTop = container.scrollHeight;
}

function setupFirebaseListener() {
  try {
    const messagesRef = dbRef(db, 'protocol-messages');
    const q = dbQuery(messagesRef, limitToLast(200));
    onChildAdded(q, (snap) => {
      const val = snap.val();
      messages.push(val);
      renderMessages();
    });
    appendDebug('Firebase listener initialized');
  } catch (err) {
    appendDebug('Firebase listener error: ' + err);
  }
}

async function sendMessage(text) {
  if (!text || !text.trim()) return;
  const msg = { user: nickname || 'anonymous', message: text.trim(), ts: Date.now() };
  // optimistic UI
  messages.push(msg);
  renderMessages();
  try {
    const ref = dbRef(db, 'protocol-messages');
    const newRef = await dbPush(ref);
    await dbSet(newRef, msg);
  } catch (err) {
    appendDebug('Firebase write failed: ' + err);
    showToast('Failed to send message (DB write failed)');
  }

  // trigger server worker to broadcast notifications
  try {
    await fetch(MESSAGES_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg)
    });
    appendDebug('Sent message to MESSAGES_API');
  } catch (err) {
    appendDebug('Failed to POST to MESSAGES_API: ' + err);
  }
}

// ---- UI wiring ----
document.addEventListener('DOMContentLoaded', async () => {
  // Query DOM
  const nicknameOverlay = document.getElementById('nicknameOverlay');
  const nicknameInput = document.getElementById('nicknameInput');
  const nicknameSave = document.getElementById('nicknameSave');
  const connectedAs = document.getElementById('connectedAs');
  const sendForm = document.getElementById('sendForm');
  const messageInput = document.getElementById('messageInput');
  const enableNotifBtn = document.getElementById('enableNotifs');

  // debug copy button
  const copyBtn = document.getElementById('copyDebug');
  if (copyBtn) {
    copyBtn.onclick = () => {
      const dbg = document.getElementById('debugLog');
      const text = Array.from(dbg.children).map(n => n.textContent).join('\n');
      navigator.clipboard?.writeText(text).then(() => showToast('Debug copied to clipboard'));
    };
  }

  function setConnectedText() {
    if (!connectedAs) return;
    connectedAs.textContent = 'Connected as: ' + (nickname || 'anonymous');
  }

  nicknameSave.addEventListener('click', () => {
    nickname = (nicknameInput.value || '').trim();
    if (!nickname) { showToast('Please enter a nickname'); return; }
    localStorage.setItem('protocol_nickname', nickname);
    nicknameOverlay.style.display = 'none';
    setConnectedText();
    appendDebug('Nickname saved: ' + nickname);
    // only register SW & prompt for notifications when we have a nickname & PWA standalone
    if (isPWAStandalone()) {
      showToast('Running as PWA - ready to enable notifications if you added to Home Screen.');
    }
  });

  sendForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value;
    messageInput.value = '';
    sendMessage(text);
  });

  enableNotifBtn.addEventListener('click', () => {
    subscribeToPush();
  });

  // show overlay if no nickname
  if (!nickname) {
    nicknameOverlay.style.display = 'block';
  } else {
    nicknameOverlay.style.display = 'none';
    setConnectedText();
  }

  // register service worker early for PWA cases
  await registerServiceWorker();

  // If already a subscription saved in localStorage, try re-sending to server (helps iOS)
  try {
    const saved = localStorage.getItem('pushSubscription');
    if (saved) {
      appendDebug('Found saved pushSubscription in localStorage, attempting to re-register with server');
      const sub = JSON.parse(saved);
      await sendSubscriptionToServer(sub);
    }
  } catch (err) {
    appendDebug('Error re-sending saved subscription: ' + err);
  }

  // Hook firebase listener
  setupFirebaseListener();

  // Visual hint: offer enable notifications button if running as standalone (iOS requirement)
  if (isPWAStandalone()) {
    showToast('App is running in standalone mode (Home Screen). Tap "Enable Notifications" to allow push notifications.');
  } else {
    appendDebug('Not running as standalone PWA. On iOS, notifications only work when the app is added to Home Screen.');
  }
});
