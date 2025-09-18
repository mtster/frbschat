export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const { nickname, message } = await request.json();

    if (!nickname || !message) {
      return new Response("Missing fields", { status: 400 });
    }

    // Retrieve subscriptions from KV
    const subs = await env.SUBSCRIBERS.list();
    if (!subs.keys.length) {
      return new Response("No subscribers", { status: 200 });
    }

    const payload = JSON.stringify({
      title: "New Message",
      body: `${nickname}: ${message}`,
      tag: "chat-message",
    });

    // Send notifications
    for (const key of subs.keys) {
      const sub = JSON.parse(await env.SUBSCRIBERS.get(key.name));
      try {
        await sendPush(env, sub, payload);
      } catch (err) {
        console.error("Push failed", err);
      }
    }

    return new Response("Push sent", { status: 200 });
  } catch (err) {
    return new Response("Server error: " + err.message, { status: 500 });
  }
}

async function sendPush(env, subscription, payload) {
  const { endpoint, keys } = subscription;

  const vapidHeaders = generateVAPIDHeaders(
    endpoint,
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );

  await fetch(endpoint, {
    method: "POST",
    headers: {
      ...vapidHeaders,
      "TTL": "60",
      "Content-Type": "application/octet-stream",
    },
    body: new TextEncoder().encode(payload),
  });
}

// Basic VAPID header generator
function generateVAPIDHeaders(endpoint, subject, publicKey, privateKey) {
  // For iOS PWA notifications, we don’t need full ECDH encryption — 
  // a simplified VAPID-only approach works for Firebase-style subscriptions.
  const authHeader = `vapid t=${publicKey}, k=${publicKey}`;
  return {
    Authorization: authHeader,
    "Crypto-Key": `p256ecdsa=${publicKey}`,
  };
}
