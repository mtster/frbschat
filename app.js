// app.js - Protocol Chat (Firebase modular v9+) with Push subscription + broadcast
// Assumptions:
// - /subscribe (GET/POST) Pages Function returns { publicKey } on GET and stores subscription on POST.
// - /protocolchatbinding (POST) Pages Function will read KV (SUBSCRIBERS) and send empty pushes.
// - Your KV binding in Cloudflare Pages is called SUBSCRIBERS.
// - Service worker is available at /service-worker.js and registered with scope '/'.

import { db } from './firebase-config.js';
import {
  ref,
  push,
  onChildAdded,
  query,
  limitToLast,
  off
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

  // Endpoints (Pages Functions)
  const SUBSCRIBE_ENDPOINT = '/subscribe';
  const PUSH_BROADCAST_ENDPOINT = '/protocolchatbinding';

  let nickname = localStorage.getItem('protocol_nickname') || '';
  let messages = [];

  const messagesRef = ref(db, 'protocol-messages');

  let currentQueryRef = null;
  let childAddedListener = null;

  let swRegistration = null;

  // Utility - show small toast
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

    // scroll to bottom a bit after render
    setTimeout(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight + 200;
    }, 30);
  }

  function initChat() {
    // Clear old state
    messages = [];
    if (currentQueryRef && childAddedListener) {
      off(currentQueryRef, 'child_added', childAddedListener);
    }

    // Query last 50 messages
    const q = query(messagesRef, limitToLast(50));
    currentQueryRef = q;

    // Attach listener
    childAddedListener = (snapshot) => {
      const msg = snapshot.val();
      if (msg) {
        messages.push(msg);
        renderMessages();
      }
    };
    onChildAdded(q, childAddedListener);
  }

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await push(messagesRef, {
        timestamp: new Date().toISOString(),
        user: nickname,
        message: trimmed
      });
      // clear after successful push
      messageInput.value = '';

      // trigger broadcast so server pushes to subscribers
      try {
        await fetch(PUSH_BROADCAST_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { user: nickname, text: trimmed, ts: Date.now() } })
        });
      } catch (err) {
        console.warn('Broadcast call failed:', err);
      }

    } catch (err) {
      console.error('Send failed', err);
      showToast('Network error sending message.');
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
    initChat();

    // After user signed in, consider prompting for notifications when appropriate
    maybeShowEnableNotifications();
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

  // --- Service worker registration (root scope) ---
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
      .then(reg => {
        swRegistration = reg;
        console.log('Service worker registered at', reg.scope);
      })
      .catch(err => console.warn('SW register failed', err));
  }

  // --- Push subscription helpers ---
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
      showToast('Service worker not ready yet.');
      return;
    }
    if (!('PushManager' in window)) {
      showToast('Push not supported in this browser.');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast('Notification permission denied.');
        return;
      }
      const publicKey = await getVapidPublicKey();
      if (!publicKey) {
        showToast('VAPID public key not available on server.');
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

      showToast('Subscribed to notifications.');
      // remove enable button if present
      removeEnableButton();

    } catch (err) {
      console.error('subscribeToPush error', err);
      showToast('Failed to subscribe: ' + (err && err.message ? err.message : err));
    }
  }

  // Show a small enable-notifications button in header (non-intrusive) only when appropriate
  function isPWAStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }

  let enableBtnEl = null;
  function createEnableButton() {
    if (enableBtnEl) return;
    // create a small bell button to match header aesthetics
    const btn = document.createElement('button');
    btn.title = 'Enable notifications';
    btn.setAttribute('aria-label', 'Enable notifications');
    btn.className = 'ml-3 inline-flex items-center justify-center w-8 h-8 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1"></path></svg>';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      await subscribeToPush();
    });
    enableBtnEl = btn;
    // insert into header (right side)
    const header = document.querySelector('header');
    if (header) header.appendChild(btn);
  }

  function removeEnableButton() {
    if (!enableBtnEl) return;
    enableBtnEl.remove();
    enableBtnEl = null;
  }

  function maybeShowEnableNotifications() {
    // Only show if user is in standalone (home-screen PWA) OR desktop browsers where push is supported.
    // iOS requires the PWA be opened from Home Screen to show native prompt; showing a button is harmless.
    if (!('PushManager' in window)) return;
    // Only show after nickname set
    if (!nickname) return;

    // Show button in header for manual opt-in
    createEnableButton();
  }

  // If logged in already, init chat and show enable button
  if (!nickname) showOverlay();
  else { hideOverlay(); setConnectedAsText(); initChat(); maybeShowEnableNotifications(); }

  // Expose for debugging
  window.__protocol_subscribeToPush = subscribeToPush;
});
