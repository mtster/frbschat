// app.js - Protocol Chat (Cloudflare + Web Push + Firebase RTDB)
import { db } from './firebase-config.js';
import {
  ref as dbRef,
  push as dbPush,
  set as dbSet,
  query as dbQuery,
  limitToLast,
  onChildAdded
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('nicknameOverlay');
  const nicknameInput = document.getElementById('nicknameInput');
  const nicknameSave = document.getElementById('nicknameSave');
  const connectedAs = document.getElementById('connectedAs');
  const messagesList = document.getElementById('messagesList');
  const messagesContainer = document.getElementById('messagesContainer');
  const composeForm = document.getElementById('composeForm');
  const messageInput = document.getElementById('messageInput');
  const toastRoot = document.getElementById('toast');

  let nickname = localStorage.getItem('protocol_nickname') || '';
  let messages = [];

  const BASE_URL = '/';
  const MESSAGES_API = BASE_URL + 'protocolchatbinding';
  const SUBSCRIBE_API = BASE_URL + 'subscribe';

  function showToast(text, ms = 3500) {
    toastRoot.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'bg-zinc-900 border border-zinc-800 text-sm text-white px-4 py-2 rounded shadow';
    el.textContent = text;
    toastRoot.appendChild(el);
    setTimeout(() => { if (toastRoot.contains(el)) toastRoot.removeChild(el); }, ms);
  }

  function setConnectedAsText() {
    connectedAs.textContent = nickname ? `Signed in as ${nickname}` : 'Not signed in';
  }

  function showOverlay() { overlay.style.display = 'flex'; nicknameInput.focus(); }
  function hideOverlay() { overlay.style.display = 'none'; }

  function renderMessages() {
    messagesList.innerHTML = '';
    messages.forEach(msg => {
      const isSelf = msg.user === nickname;
      const wrapper = document.createElement('div');
      wrapper.className = isSelf ? 'self-end flex justify-end' : 'self-start flex justify-start';

      const bubble = document.createElement('div');
      bubble.className = 'bubble p-3 rounded-lg';
      if (isSelf) bubble.classList.add('bg-gradient-to-br','from-emerald-500','to-green-400','text-black','rounded-br-none');
      else bubble.classList.add('bg-zinc-900','text-white','rounded-bl-none','border','border-zinc-800');

      const nameEl = document.createElement('div');
      nameEl.className = 'muted mb-1';
      nameEl.textContent = msg.user || 'Unknown';

      const textEl = document.createElement('div');
      textEl.textContent = msg.message;

      bubble.appendChild(nameEl);
      bubble.appendChild(textEl);
      wrapper.appendChild(bubble);
      messagesList.appendChild(wrapper);
    });

    setTimeout(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight + 200;
    }, 30);
  }

  // --------------------------------
  // Firebase Realtime Database listen
  // --------------------------------
  try {
    const listRef = dbQuery(dbRef(db, 'protocol-messages'), limitToLast(200));
    onChildAdded(listRef, (snap) => {
      const val = snap.val();
      if (!val) return;
      messages.push(val);
      renderMessages();
    });
  } catch (e) {
    console.warn('Realtime DB listener not initialized', e);
  }

  // -----------------------
  // Send message -> write to Firebase + POST to Worker trigger
  // -----------------------
  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const msg = { user: nickname, message: trimmed, timestamp: new Date().toISOString() };

    messages.push(msg);
    renderMessages();

    try {
      const newRef = dbPush(dbRef(db, 'protocol-messages'));
      await dbSet(newRef, msg);
    } catch (err) {
      console.error('Firebase write failed', err);
      showToast('Failed to write to DB.');
    }

    try {
      await fetch(MESSAGES_API, {
        method: 'POST',
        body: JSON.stringify(msg),
        headers: { 'Content-Type': 'application/json' }
      });
      messageInput.value = '';
    } catch (err) {
      console.error('Send to Worker failed', err);
      showToast('Network error sending message to push gateway.');
    }
  }

  // -----------------------
  // User nickname setup
  // -----------------------
  nicknameSave.addEventListener('click', () => {
    const val = nicknameInput.value.trim();
    if (!val) { showToast('Enter a nickname.'); return; }
    nickname = val;
    localStorage.setItem('protocol_nickname', nickname);
    hideOverlay();
    setConnectedAsText();
    showToast('Welcome, ' + nickname + '!');

    // trigger notification setup only after user sets nickname
    if (isPWAStandalone()) promptEnableNotifications();
  });

  nicknameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); nicknameSave.click(); }
  });

  composeForm.addEventListener('submit', e => {
    e.preventDefault();
    if (!nickname) { showOverlay(); return; }
    const txt = messageInput.value;
    if (!txt.trim()) return;
    sendMessage(txt);
  });

  messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      composeForm.dispatchEvent(new Event('submit'));
    }
  });

  // -----------------------
  // PWA Detection for iOS 16.4+ and Notifications
  // -----------------------
  function isPWAStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  const VAPID_PUBLIC_KEY = 'BAdYi2DwAr_u2endCUZda9Sth0jVH8e6ceuQXn0EQAl3ALEQCF5cDoEB9jfE8zOdOpHlu0gyu1pUYFrGpU5wEWQ';

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  async function subscribeToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');

      const existing = localStorage.getItem('pushSubscription');
      if (existing) {
        const subObj = JSON.parse(existing);
        await fetch(SUBSCRIBE_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: subObj, user: nickname || 'unknown' })
        });
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { showToast('Notifications blocked'); return; }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });

      localStorage.setItem('pushSubscription', JSON.stringify(subscription));
      await fetch(SUBSCRIBE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription, user: nickname || 'unknown' })
      });

      showToast('Notifications enabled!');
    } catch (err) {
      console.error('Push subscription failed', err);
      showToast('Notifications unavailable.');
    }
  }

  function promptEnableNotifications() {
    if (!isPWAStandalone()) return; // do not prompt in browser
    const btn = document.createElement('button');
    btn.textContent = 'Enable Notifications';
    btn.className = 'bg-emerald-500 text-black px-4 py-2 rounded mb-2';
    btn.onclick = () => { subscribeToPush(); btn.remove(); };
    toastRoot.appendChild(btn);
  }

  // -----------------------
  // Initialization
  // -----------------------
  if (!nickname) showOverlay();
  else { hideOverlay(); setConnectedAsText(); }

  // prompt notifications only if in standalone PWA
  if (nickname && isPWAStandalone()) promptEnableNotifications();
});
