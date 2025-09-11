/* app.js - Protocol Chat (Firebase version) */

document.addEventListener('DOMContentLoaded', () => {
  // Firebase initialization
  const db = firebase.database();
  const messagesRef = db.ref('protocol-messages');

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

  // Listen for new messages in Firebase
  function initChat() {
    messagesRef.off(); // remove any previous listeners
    messagesRef.limitToLast(50).on('child_added', snapshot => {
      const msg = snapshot.val();
      messages.push(msg);
      renderMessages();
    });
  }

  // Send a message to Firebase
  async function sendMessage(text) {
    if (!text.trim()) return;
    const msg = { timestamp: new Date().toISOString(), user: nickname, message: text.trim() };
    messages.push(msg); // optimistic update
    renderMessages();

    try {
      await messagesRef.push(msg);
    } catch (err) {
      console.error('Send failed', err);
      showToast('Network error sending message.');
    }
  }

  // Nickname setup
  nicknameSave.addEventListener('click', () => {
    const val = nicknameInput.value.trim();
    if (!val) { showToast('Enter a nickname.'); return; }
    nickname = val;
    localStorage.setItem('protocol_nickname', nickname);
    hideOverlay();
    setConnectedAsText();
    showToast('Welcome, ' + nickname + '!');
    initChat();
  });

  nicknameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); nicknameSave.click(); }
  });

  // Message form submit
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
  if (!nickname) showOverlay();
  else { hideOverlay(); setConnectedAsText(); initChat(); }
});
