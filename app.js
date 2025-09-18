// app.js - Protocol Chat (Cloudflare + Web Push)

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

  const BASE_URL = '/'; // Use your Pages + Worker path
  const MESSAGES_API = BASE_URL + 'protocolchatbinding';

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

  // -----------------------
  // WebSocket / Realtime simulation
  // -----------------------
  const ws = new WebSocket('wss://<YOUR_WS_ENDPOINT>'); // Use Cloudflare Worker WebSocket if desired
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    messages.push(msg);
    renderMessages();
  };

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const msg = { user: nickname, message: trimmed, timestamp: new Date().toISOString() };
    messages.push(msg);
    renderMessages();

    // Send to Worker to broadcast + trigger push
    try {
      await fetch(MESSAGES_API, {
        method: 'POST',
        body: JSON.stringify(msg),
        headers: { 'Content-Type': 'application/json' }
      });
      messageInput.value = '';
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
  // Service Worker + Web Push
  // -----------------------
  // inside app.js — replace the initNotifications() function
async function initNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    // register service worker (you already do this elsewhere)
    const registration = await navigator.serviceWorker.register('/service-worker.js');

    // replace <YOUR_VAPID_PUBLIC_KEY> with the public key you'll generate (base64url)
    const VAPID_PUBLIC = 'BAdYi2DwAr_u2endCUZda9Sth0jVH8e6ceuQXn0EQAl3ALEQCF5cDoEB9jfE8zOdOpHlu0gyu1pUYFrGpU5wEWQ';

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC)
    });

    // store locally
    localStorage.setItem('pushSubscription', JSON.stringify(subscription));

    // send subscription to Cloudflare Worker to register in KV
    await fetch('/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription, user: nickname || 'unknown' })
    });

    // optional: notify your backend (Firebase) that user joined
    await fetch(MESSAGES_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: nickname, message: 'Joined chat!' })
    });

    showToast('Notifications enabled.');
  } catch (err) {
    console.error('Notification init failed', err);
    showToast('Notifications unavailable.');
  }
}

});
