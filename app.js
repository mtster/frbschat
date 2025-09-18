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

  const BASE_URL = '/'; // served from Cloudflare Pages root
  const MESSAGES_API = BASE_URL + 'protocolchatbinding'; // POST -> triggers Worker push
  const SUBSCRIBE_API = BASE_URL + 'subscribe'; // POST subscription -> Worker stores in KV

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
    // Listen to last 200 messages and append as they arrive
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

    // optimistic local UI
    messages.push(msg);
    renderMessages();

    // 1) write to Firebase
    try {
      const newRef = dbPush(dbRef(db, 'protocol-messages'));
      await dbSet(newRef, msg);
    } catch (err) {
      console.error('Firebase write failed', err);
      showToast('Failed to write to DB.');
    }

    // 2) Tell the Worker to broadcast & send push notifications
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

  nicknameSave.addEventListener('click', () => {
    const val = nicknameInput.value.trim();
    if (!val) { showToast('Enter a nickname.'); return; }
    nickname = val;
    localStorage.setItem('protocol_nickname', nickname);
    hideOverlay();
    setConnectedAsText();
    showToast('Welcome, ' + nickname + '!');
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
  // Service Worker + Web Push (subscribe)
  // -----------------------
  // EDIT THIS: replace with your VAPID public key (base64url string)
  const VAPID_PUBLIC_KEY = '<YOUR_VAPID_PUBLIC_KEY>';

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/')
    const rawData = atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
    return outputArray
  }

  async function initNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');

      // If user already subscribed (stored locally), skip re-subscribe
      const existing = localStorage.getItem('pushSubscription');
      if (existing) {
        // still post to Worker once to ensure KV has it (safe)
        const subObj = JSON.parse(existing);
        await fetch(SUBSCRIBE_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: subObj, user: nickname || 'unknown' })
        });
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });

      localStorage.setItem('pushSubscription', JSON.stringify(subscription));

      // Send to Worker to persist into KV
      await fetch(SUBSCRIBE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription, user: nickname || 'unknown' })
      });

      showToast('Notifications enabled.');
    } catch (err) {
      console.error('Notification init failed', err);
      showToast('Notifications unavailable.');
    }
  }

  initNotifications();

  if (!nickname) showOverlay();
  else { hideOverlay(); setConnectedAsText(); }
});
