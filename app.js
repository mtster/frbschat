/* app.js - Protocol Chat */

document.addEventListener('DOMContentLoaded', () => {
  const API_URL = 'https://script.google.com/macros/s/AKfycbwlOAtrgztsRTZeWLwJ85xIwMajhQm9AYXaMeLisiRt0wn7kS3wvxBWWsz5YFQRaBHjPQ/exec';
  const POLL_MS = 2500;

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
  let pollTimer = null;

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
      if (isSelf) {
        bubble.classList.add('bg-gradient-to-br','from-emerald-500','to-green-400','text-black','rounded-br-none');
      } else {
        bubble.classList.add('bg-zinc-900','text-white','rounded-bl-none','border','border-zinc-800');
      }

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

  async function fetchLatest() {
    try {
      const res = await fetch(API_URL + '?t=' + Date.now(), { method: 'GET', cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        messages = json.messages || [];
        renderMessages();
      }
    } catch (err) {
      console.error('Fetch failed', err);
      showToast('Network error fetching messages.');
    }
  }

  async function sendMessage(text) {
  if (!text.trim()) return;
  const optimistic = { timestamp: new Date().toISOString(), user: nickname, message: text.trim() };
  messages.push(optimistic);
  renderMessages();

  try {
    const body = new FormData();
    body.append('user', nickname);
    body.append('message', text.trim());

    const r = await fetch(API_URL, {
      method: 'POST',
      body // no headers → browser sets multipart/form-data automatically
    });

    const j = await r.json();
    if (!j.success) {
      showToast('Server error saving message.');
    } else {
      await fetchLatest();
    }
  } catch (err) {
    console.error('Send failed', err);
    showToast('Network error sending message.');
  }
}


  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(fetchLatest, POLL_MS);
  }

  nicknameSave.addEventListener('click', () => {
    const v = nicknameInput.value.trim();
    if (!v) { showToast('Enter a nickname.'); return; }
    nickname = v;
    localStorage.setItem('protocol_nickname', nickname);
    hideOverlay();
    setConnectedAsText();
    fetchLatest();   // fetch right away
    startPolling();
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
    messageInput.value = '';
  });

  messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      composeForm.dispatchEvent(new Event('submit'));
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(err => console.warn(err));
  }

  // Startup
  if (!nickname) {
    showOverlay();
  } else {
    hideOverlay();
    setConnectedAsText();
    fetchLatest();   // fetch immediately on load
    startPolling();
  }
});
