// app.js - Protocol Chat (updated push subscription flow + PWA/iOS improvements)
//
// Instructions:
// - Replace SUBSCRIBE_ENDPOINT with your Cloudflare Worker (subscribe worker) URL if needed.
//   The client will request GET /subscribe to obtain the VAPID public key, and POST /subscribe
//   to store subscriptions in Workers KV. When deployed to the same domain as the worker,
//   a relative path like '/subscribe' is fine. If your worker is hosted under a different domain
//   or path, update SUBSCRIBE_ENDPOINT accordingly.
//
// - Make sure your Cloudflare Worker (subscribe.js) sets VAPID_PUBLIC_KEY and SUBSCRIPTIONS KV binding.
// - Make sure service-worker.js is deployed at the site root ("/service-worker.js") and has scope "/".
//
// This file preserves the Firebase RTDB real-time chat behaviour and adds a robust push subscription flow.

import { db } from './firebase-config.js';
import {
  ref as dbRef,
  push as dbPush,
  set as dbSet,
  query as dbQuery,
  limitToLast,
  onChildAdded
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

// Configuration - update if your subscribe worker is hosted elsewhere:
const SUBSCRIBE_ENDPOINT = '/subscribe'; // <-- change if your worker is at another path or domain
const PUSH_BROADCAST_ENDPOINT = '/protocolchatbinding'; // <-- endpoint of your protocolchatbinding worker (change as needed)

// Utils
function urlBase64ToUint8Array(base64String) {
  // Replace URL-safe characters
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
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

// DOM Elements (assumes your index.html has these IDs)
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

// Service Worker registration - ensure root scope
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).then(reg => {
    console.log('Service Worker registered:', reg.scope);
    swRegistration = reg;
  }).catch(err => {
    console.warn('Service Worker registration failed:', err);
  });
}

// Firebase - message sending
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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = msgInput.value.trim();
  if (!text) return;
  const entry = { user: nickname || 'anonymous', text, ts: Date.now() };
  // optimistic UI
  addMessageToUI(entry);
  msgInput.value = '';
  try {
    const newRef = await dbPush(messagesRef);
    await dbSet(newRef, entry);

    // OPTIONAL: trigger server-side worker to broadcast notifications
    // (uncomment and set PUSH_BROADCAST_ENDPOINT to your worker path)
    
    try {
      await fetch('/protocolchatbinding', {
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

// Nickname overlay logic
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

// Notification subscription logic
async function getVapidPublicKey() {
  try {
    const res = await fetch(SUBSCRIBE_ENDPOINT, { method: 'GET' });
    if (!res.ok) throw new Error('Failed to fetch VAPID key');
    const j = await res.json();
    return j.publicKey;
  } catch (err) {
    console.error('Could not load VAPID public key from server:', err);
    return null;
  }
}

async function subscribeToPush() {
  if (!swRegistration) {
    console.warn('Service worker registration not ready yet');
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
      alert('Cannot subscribe: server VAPID key missing. Check subscribe worker.');
      return;
    }
    const sub = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    // Send subscription to server to save in KV
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

// Simple toast helper
function showToast(msg, timeout=3500) {
  const el = document.createElement('div');
  el.className = 'fixed bottom-4 right-4 bg-zinc-900 text-white px-4 py-2 rounded shadow';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), timeout);
}

// Only prompt for notifications if running as standalone PWA (iOS requirement)
function maybePromptForNotifications() {
  if (isPWAStandalone()) {
    // show an in-app prompt to enable notifications
    const btn = document.createElement('button');
    btn.className = 'bg-emerald-500 text-black px-4 py-2 rounded mb-2';
    btn.textContent = 'Enable Notifications';
    btn.addEventListener('click', async () => {
      await subscribeToPush();
      btn.remove();
    });
    toastRoot.appendChild(btn);
  } else {
    console.log('Not a standalone PWA; skipping push prompt (iOS requires home-screen PWA).');
  }
}

// If nickname was already present, we may want to show prompt (for returning users)
if (nickname) {
  maybePromptForNotifications();
}

// Wire enableNotificationsBtn (if present)
if (enableNotificationsBtn) {
  enableNotificationsBtn.addEventListener('click', () => {
    subscribeToPush();
  });
}

// Expose subscribe function on window for debugging
window.__protocol_subscribeToPush = subscribeToPush;
