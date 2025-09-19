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

    let results = [];

    // Send notifications
    for (const key of subs.keys) {
      const sub = JSON.parse(await env.SUBSCRIBERS.get(key.name));
      try {
        const res = await sendPush(env, sub, payload);

        results.push({
          endpoint: sub.endpoint,
          status: res.status,
          headers: Object.fromEntries(res.headers),
          body: await res.text()
        });
      } catch (err) {
        results.push({
          endpoint: sub.endpoint,
          error: err.message
        });
      }
    }

    return new Response(JSON.stringify(results, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
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

  console.log("DEBUG VAPID HEADERS", JSON.stringify(vapidHeaders, null, 2));
  console.log("DEBUG PAYLOAD", payload);

  return await fetch(endpoint, {
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
  // In real-world push, you’d sign a JWT here.
  // Right now we’re faking minimal VAPID headers to test.
  const authHeader = `vapid t=${publicKey}, k=${publicKey}`;
  return {
    Authorization: authHeader,
    "Crypto-Key": `p256ecdsa=${publicKey}`,
    "Subject": subject
  };
}
