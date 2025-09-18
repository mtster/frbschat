import { getDatabase, ref, push, onChildAdded, limitToLast, query } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { app } from "./firebase-config.js";

const db = getDatabase(app);
const messagesRef = ref(db, "protocol-messages");

const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const messagesDiv = document.getElementById("messages");
const enableNotificationsBtn = document.getElementById("enableNotifications");

let nickname = localStorage.getItem("nickname");
if (!nickname) {
  nickname = prompt("Enter your nickname:") || "Anonymous";
  localStorage.setItem("nickname", nickname);
}

// --- Send message ---
sendButton.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", e => {
  if (e.key === "Enter") sendMessage();
});

function sendMessage() {
  const text = messageInput.value.trim();
  if (text) {
    push(messagesRef, {
      nickname,
      text,
      timestamp: Date.now()
    });
    messageInput.value = "";
    messageInput.focus(); // keep keyboard open
  }
}

// --- Display messages ---
const lastMessagesQuery = query(messagesRef, limitToLast(200));
onChildAdded(lastMessagesQuery, snapshot => {
  const msg = snapshot.val();
  displayMessage(msg.nickname, msg.text);
});

function displayMessage(sender, text) {
  const wrapper = document.createElement("div");
  wrapper.classList.add("message");
  wrapper.classList.add(sender === nickname ? "self" : "other");

  const nickEl = document.createElement("div");
  nickEl.className = "nickname";
  nickEl.textContent = sender;

  const textEl = document.createElement("div");
  textEl.textContent = text; // prevents <br> per character issue

  wrapper.appendChild(nickEl);
  wrapper.appendChild(textEl);
  messagesDiv.appendChild(wrapper);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// --- Notifications ---
enableNotificationsBtn.addEventListener("click", async () => {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    alert("Notifications not supported.");
    return;
  }

  const reg = await navigator.serviceWorker.register("/service-worker.js");
  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    alert("Notifications denied");
    return;
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY)
  });

  await fetch("/functions/subscribe", {
    method: "POST",
    body: JSON.stringify(sub)
  });

  alert("Notifications enabled!");
});

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
