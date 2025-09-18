// app.js - UI + Firebase (keeps your backend endpoints intact)
//
// IMPORTANT: This file intentionally preserves your RTDB & push endpoints.
// It only changes client rendering and SW registration behavior.

// ----- VAPID public key (client) -----
// Replace this value only if your server uses a different public key.
// The client must use the same public key pair that your Cloudflare worker uses.
const VAPID_PUBLIC_KEY = 'BAdYi2DwAr_u2endCUZda9Sth0jVH8e6ceuQXn0EQAl3ALEQCF5cDoEB9jfE8zOdOpHlu0gyu1pUYFrGpU5wEWQ';

import { db } from './firebase-config.js';
import {
  ref as dbRef,
  push as dbPush,
  set as dbSet,
  query as dbQuery,
  limitToLast,
  onChildAdded
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* --- Config: update if your endpoints live at non-root path --- */
const SUBSCRIBE_API = '/subscribe'; // unchanged
const MESSAGES_API = '/protocolchatbinding'; // unchanged

/* --- UI elements --- */
const messagesRoot = document.getElementById('messages');
const sendBtn = document.getElementById('sendBtn');
const messageInput = document.getElementById('messageInput');
const enableNotifsBtn = document.getElementById('enableNotifs');

/* --- local state --- */
let nickname = localStorage.getItem('protocol_nickname') || '';
// Set a default nickname if absent (first-run). Keep non-intrusive.
if (!nickname) {
  nickname = 'anon-' + Math.random().toString(36).slice(2,8);
  localStorage.setItem('protocol_nickname', nickname);
}

/* --- a centered column inside messages to control max width --- */
let msgColumn = document.querySelector('.msg-col');
if (!msgColumn) {
  msgColumn = document.createElement('div');
  msgColumn.className = 'msg-col';
  messagesRoot.appendChild(msgColumn);
}

/* Keep track of Firebase keys to avoid duplicates */
const seenKeys = new Set();

/* --- Helpers --- */
function formatTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function makeMessageElement(obj, key) {
  const isMe = (obj.user || obj.nickname || obj.userName || '') === (localStorage.getItem('protocol_nickname') || nickname);

  const el = document.createElement('div');
  el.className = 'msg ' + (isMe ? 'me' : 'other');

  if (!isMe) {
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = obj.user || obj.nickname || 'Unknown';
    el.appendChild(name);
  }

  const text = document.createElement('div');
  // IMPORTANT: use textContent so characters don't get split into separate elements
  text.textContent = obj.message || obj.text || obj.msg || '';
  el.appendChild(text);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = formatTime(obj.ts || obj.timestamp || Date.now());
  el.appendChild(meta);

  return el;
}

/* --- Firebase listener (no optimistic duplicate append) --- */
function setupFirebaseListener() {
  try {
    const refMsgs = dbRef(db, 'protocol-messages');
    const q = dbQuery(refMsgs, limitToLast(200));
    onChildAdded(q, (snap) => {
      if (!snap || !snap.key) return;
      if (seenKeys.has(snap.key)) return; // dedupe
      seenKeys.add(snap.key);
      const val = snap.val();
      // append properly
      const el = makeMessageElement(val, snap.key);
      msgColumn.appendChild(el);
      // scroll to bottom
      messagesRoot.scrollTop = messagesRoot.scrollHeight;
    });
  } catch (err) {
    // keep UX quiet if DB listener fails
    console.error('Firebase listener error', err);
  }
}

/* --- Send message (no optimistic local duplicate) --- */
async function sendMessage() {
  const text = (messageInput.value || '').trim();
  if (!text) return;
  const payload = { user: (localStorage.getItem('protocol_nickname') || nickname), message: text, ts: Date.now() };

  try {
    const rRef = dbRef(db, 'protocol-messages');
    const newRef = await dbPush(rRef);
    await dbSet(newRef, payload);
    // do not append locally - onChildAdded will render this message once DB pushes it back
    messageInput.value = '';
    messageInput.focus(); // keep keyboard open on iPhone
    // trigger backend worker to broadcast push notifications (your existing endpoint)
    try {
      await fetch(MESSAGES_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (e) {
      // silent - notifications worker may be on another domain; server logs will show error
    }
  } catch (err) {
    // keep UI clean but show small toast
    showToast('Send failed');
  }
}

/* --- keep keyboard open & handle Enter to send (avoid shift+enter complexity) --- */
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendMessage();
  }
});
sendBtn.addEventListener('click', (e) => { e.preventDefault(); sendMessage(); });

/* --- Service worker registration & push subscription UI --- */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    // register at root scope so notifications work across app
    const reg = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    return reg;
  } catch (err) {
    return null;
  }
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showToast('Push not supported in this browser');
    return;
  }
  const reg = await registerServiceWorker();
  if (!reg) { showToast('Open app from Home Screen to enable notifications'); return; }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { showToast('Permission denied'); return; }

    // get existing or create new subscription
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      // send to server (idempotent)
      await fetch('/subscribe', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ subscription: existing, user: localStorage.getItem('protocol_nickname') || nickname })});
      showToast('Notifications ready');
      return;
    }

    // Use the VAPID public key defined at the top of this file
    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    // send to server
    await fetch('/subscribe', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ subscription: sub, user: localStorage.getItem('protocol_nickname') || nickname })});
    localStorage.setItem('pushSubscription', JSON.stringify(sub));
    showToast('Notifications enabled');
  } catch (err) {
    showToast('Subscription failed');
  }
}

/* small toast helper */
function showToast(msg, ms = 2500) {
  // simple transient toast in top-center
  let t = document.createElement('div');
  t.textContent = msg;
  t.style.position = 'fixed';
  t.style.top = '14px';
  t.style.left = '50%';
  t.style.transform = 'translateX(-50%)';
  t.style.background = 'rgba(0,0,0,0.7)';
  t.style.color = '#fff';
  t.style.padding = '8px 12px';
  t.style.borderRadius = '10px';
  t.style.zIndex = 9999;
  document.body.appendChild(t);
  setTimeout(()=> { t.style.opacity='0'; setTimeout(()=>t.remove(),200) }, ms);
}

/* urlBase64ToUint8Array util */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

/* handle messages from service worker (for small visual debug if push arrives) */
navigator.serviceWorker?.addEventListener && navigator.serviceWorker.addEventListener('message', (ev) => {
  try {
    if (ev.data && ev.data.type === 'push-received') {
      // show a subtle toast so user sees push was handled (no permanent panels)
      showToast(ev.data.payload?.body || 'New message');
    }
  } catch (e) {}
});

/* expose subscribe button */
enableNotifsBtn && enableNotifsBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  // If not PWA / not standalone, prompt user to add to home screen
  if (!window.matchMedia('(display-mode: standalone)').matches && !window.navigator.standalone) {
    showToast('Add to Home Screen and open from there to enable iOS notifications.');
    // still register SW so some browsers allow testing
    await registerServiceWorker();
    return;
  }
  await subscribeToPush();
});

/* --- initialize --- */
(async function init() {
  // ensure messagesRoot contains single message column
  // cleanup previously appended children (prevent duplicates if hot reload) then re-add msgColumn
  if (!messagesRoot.querySelector('.msg-col')) {
    messagesRoot.innerHTML = '';
    messagesRoot.appendChild(msgColumn);
  }
  await registerServiceWorker();
  setupFirebaseListener();
})();
