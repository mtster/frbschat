// app.js - Protocol Chat (PWA + Firebase + Push Notifications)

import { db } from './firebase-config.js';
import {
  ref as dbRef,
  push as dbPush,
  set as dbSet,
  query as dbQuery,
  limitToLast,
  onChildAdded
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

// Endpoints (Cloudflare Pages Functions)
const SUBSCRIBE_ENDPOINT = '/subscribe';
const PUSH_BROADCAST_ENDPOINT = '/protocolchatbinding';

// Utils
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isPWAStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

// DOM Elements (must exist in index.html)
const overlay = document.getElementById('nicknameOverlay');
const nicknameInput = document.getElementById('nicknameInput');
const nicknameSave = document.getElementById('nicknameSave');
const chatList = document.getElementById('chatList');
const form = document.getElementById('msgForm');
const msgInput = document.getElementById('msgInput');
const enableNotificationsBtn = document.getElementById('enableNotificationsBtn');
const toastRoot = document.getElementById('toastRoot');

// State
let nickname = localStorage.getItem('protocol_nickname') || '';
let swRegistration = null;

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).then(reg => {
    console.log('Service Worker registered:', reg.scope);
    swRegistration = reg;
  }).catch(err => {
    console.warn('Service Worker registration failed:', err);
  });
}

// Firebase – load last 200 messages
const messagesRef = dbRef(db, 'protocol-messages');
const recentQuery = dbQuery(messagesRef, limitToLast(200));

onChildAdded(recentQuery, (snap) => {
  const msg = snap.val();
  addMessageToUI(msg, snap.key);
});

function addMessageToUI(msg, key) {
  const div = document.createElement('div');
  div.className = 'p-2';
  const name = document.createElement('div');
  name.className = 'text-xs text-zinc-400';
  name.textContent = msg.user || 'anon';
  const body = document.createElement('div');
  body.className = 'text-sm';
  body.textContent = msg.text || '';
  div.appendChild(name);
  div.appendChild(body);
  chatList.appendChild(div);
  chatList.scrollTop = chatList.scrollHeight;
}

// Handle sending messages
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = msgInput.value.trim();
  if (!text) return;
  const entry = { user: nickname || 'anonymous', text, ts: Date.now() };

  // Optimistic UI update
  addMessageToUI(entry);
  msgInput.value = '';

  try {
    const newRef = await dbPush(messagesRef);
    await dbSet(newRef, entry);

    // Trigger push broadcast
    try {
      await fetch(PUSH_BROADCAST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: entry })
      });
    } catch (err) {
      console.warn('notify worker call failed:', err);
    }

  } catch (err) {
    console.error('Failed to send message:', err);
  }
});

// Nickname overlay
function showOverlay() { overlay.style.display = 'flex'; }
function hideOverlay() { overlay.style.display = 'none'; }

nicknameSave.addEventListener('click', () => {
  const v = nicknameInput.value.trim();
  if (!v) return;
  nickname = v;
  localStorage.setItem('protocol_nickname', nickname);
  hideOverlay();
  maybePromptForNotifications();
});

if (!nickname) showOverlay();
else hideOverlay();

// Push subscription
async function getVapidPublicKey() {
  try {
    const res = await fetch(SUBSCRIBE_ENDPOINT);
    if (!res.ok) throw new Error('Failed to fetch VAPID key');
    const j = await res.json();
    return j.publicKey;
  } catch (err) {
    console.error('Could not load VAPID key:', err);
    return null;
  }
}

async function subscribeToPush() {
  if (!swRegistration) {
    console.warn('Service worker not ready yet');
    return;
  }
  if (!('PushManager' in window)) {
    alert('Push not supported in this browser.');
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission not granted:', permission);
      return;
    }
    const publicKey = await getVapidPublicKey();
    if (!publicKey) {
      alert('Cannot subscribe: missing server VAPID key.');
      return;
    }
    const sub = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    await fetch(SUBSCRIBE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub, user: nickname || 'anonymous' })
    });
    showToast('Subscribed to notifications');
  } catch (err) {
    console.error('subscribeToPush error', err);
    showToast('Failed to subscribe: ' + err.message);
  }
}

// Toast helper
function showToast(msg, timeout=3500) {
  const el = document.createElement('div');
  el.className = 'fixed bottom-4 right-4 bg-zinc-900 text-white px-4 py-2 rounded shadow';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), timeout);
}

// Notification prompt
function maybePromptForNotifications() {
  if (isPWAStandalone()) {
    const btn = document.createElement('button');
    btn.className = 'bg-emerald-500 text-black px-4 py-2 rounded mb-2';
    btn.textContent = 'Enable Notifications';
    btn.addEventListener('click', async () => {
      await subscribeToPush();
      btn.remove();
    });
    toastRoot.appendChild(btn);
  } else {
    console.log('Not standalone PWA; skipping push prompt.');
  }
}

// Returning user prompt
if (nickname) maybePromptForNotifications();

// Manual enable button (if present in HTML)
if (enableNotificationsBtn) {
  enableNotificationsBtn.addEventListener('click', () => {
    subscribeToPush();
  });
}

// Debug hook
window.__protocol_subscribeToPush = subscribeToPush;
