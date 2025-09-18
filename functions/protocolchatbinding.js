// functions/protocolchatbinding.js
// Receives chat messages and delivers Web Push notifications to all subscriptions stored in KV.

import { buildPushPayload } from '@block65/webcrypto-web-push';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  }

  try {
    const body = await request.json();
    const message = body && (body.message || body.text || body.data) ? (body.message || body.text || body.data) : '';
    const user = body && body.user ? body.user : 'unknown';

    // Build push message payload (the library will handle encryption and VAPID auth)
    const pushMessage = {
      data: JSON.stringify({ user, message }),
      options: { ttl: 60 }
    };

    const vapid = {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY
    };

    // Iterate KV subscriptions
    let list = await env.SUBSCRIBERS.list();
    if (!list || !list.keys) list = { keys: [] };

    for (const key of list.keys) {
      try {
        const raw = await env.SUBSCRIBERS.get(key.name);
        if (!raw) {
          // nothing to do
          continue;
        }
        const parsed = JSON.parse(raw);
        const subscription = parsed.subscription || parsed;

        // Build payload
        const payload = await buildPushPayload(pushMessage, subscription, vapid);

        // Send to subscription endpoint
        const res = await fetch(subscription.endpoint, payload);

        if (res.status === 404 || res.status === 410) {
          // subscription is gone - delete it from KV
          await env.SUBSCRIBERS.delete(key.name);
        }
      } catch (err) {
        // don't let one broken subscription stop the loop
        console.error('error sending push to', key.name, err);
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  }
}
