// app.js - UI-focused Protocol Chat client
// Keep the VAPID_PUBLIC_KEY matched to your worker keys
import { db } from './firebase-config.js';
import {
  ref as dbRef,
  push as dbPush,
  set as dbSet,
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
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
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

// ---------- Firebase messaging ---------
let messages = [];
let nickname = localStorage.getItem('protocol_nickname') || '';

function formatTime(ts) {
  try {
    const d = new Date(Number(ts) || Date.now());
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

function makeAvatarInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0,2).toUpperCase();
}

function renderMessages(container = document.getElementById('messages')) {
  if (!container) return;
  container.innerHTML = '';

  for (const m of messages) {
    const isMe = (m.user || '').trim() === (nickname || '').trim();

    const row = document.createElement('div');
    row.className = 'msg-row ' + (isMe ? 'me' : 'other');

    // For other messages: avatar + bubble; for me: bubble aligned right
    if (!isMe) {
      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'avatar';
      avatarWrap.textContent = makeAvatarInitials(m.user || 'U');
      row.appendChild(avatarWrap);
    }

    const content = document.createElement('div');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.message || '';

    // If other user, show name above bubble
    if (!isMe) {
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = m.user || 'Unknown';
      content.appendChild(name);
    }

    content.appendChild(bubble);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = formatTime(m.ts);
    content.appendChild(meta);

    row.appendChild(content);
    container.appendChild(row);
  }

  // scroll to bottom
  setTimeout(() => {
    try {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } catch (e) {
      container.scrollTop = container.scrollHeight;
    }
  }, 60);
}

function setupFirebaseListener() {
  try {
    const messagesRef = dbRef(db, 'protocol-messages');
    const q = dbQuery(messagesRef, limitToLast(200));
    onChildAdded(q, (snap) => {
      const val = snap.val();
      if (!val) return;
      messages.push(val);
      // keep only last 400 in-memory as a safeguard
      if (messages.length > 400) messages = messages.slice(-400);
      renderMessages();
    });
  } catch (err) {
    showToast('Database listener error');
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
    showToast('Message failed to send');
    return;
  }

  // notify backend worker to broadcast push notifications
  try {
    await fetch(MESSAGES_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg)
    });
  } catch (err) {
    // fail silently (server may be unreachable); no UI debug
  }
}

// ---------- UI wiring ----------
document.addEventListener('DOMContentLoaded', async () => {
  const nicknameOverlay = document.getElementById('nicknameOverlay');
  const nicknameInput = document.getElementById('nicknameInput');
  const nicknameSave = document.getElementById('nicknameSave');
  const sendForm = document.getElementById('sendForm');
  const messageInput = document.getElementById('messageInput');
  const enableNotifBtn = document.getElementById('enableNotifs');
  const sendBtn = document.getElementById('sendBtn');

  // Auto-resize textarea
  function autoResize(el) {
    el.style.height = 'auto';
    const max = 160;
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
  }
  if (messageInput) messageInput.addEventListener('input', () => autoResize(messageInput));

  // Save nickname handler
  if (nicknameSave) {
    nicknameSave.addEventListener('click', () => {
      const val = (nicknameInput && nicknameInput.value || '').trim();
      if (!val) { showToast('Please enter a name'); return; }
      nickname = val;
      localStorage.setItem('protocol_nickname', nickname);
      if (nicknameOverlay) nicknameOverlay.style.display = 'none';
      showToast('Hello, ' + nickname);

      // === NEW: attach OneSignal external id so server can target this user ===
      try { if (window.onsignalLogin) window.onsignalLogin(nickname); } catch(e) { /* ignore */ }
    });
  }

  // Use overlay on first run if no nickname
  if (!nickname) {
    if (nicknameOverlay) {
      nicknameOverlay.style.display = 'flex';
      if (nicknameInput) nicknameInput.focus();
    }
  } else {
    if (nicknameOverlay) nicknameOverlay.style.display = 'none';
  }

  // Send form (submit) or fallback to send button click
  if (sendForm) {
    sendForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = messageInput ? (messageInput.value || '') : '';
      if (messageInput) { messageInput.value = ''; autoResize(messageInput); }
      sendMessage(text);
    });
  } else if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      const text = messageInput ? (messageInput.value || '') : '';
      if (messageInput) { messageInput.value = ''; autoResize(messageInput); }
      sendMessage(text);
    });
  }

  // "Enable" button
  if (enableNotifBtn) {
    enableNotifBtn.addEventListener('click', async () => {
      // if not in PWA mode on iOS, request user to add to Home Screen
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
  }

  // Register SW early (does no UI debug)
  await registerServiceWorker();

  // If subscription is saved locally, try resending to server (helps iOS)
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
