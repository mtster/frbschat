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
    const msg = await request.json(); // { user, message, timestamp }

    // Build VAPID object from env vars (set these in Pages project settings)
    const vapid = {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY
    };

    // List subscriptions in KV (small scale demo)
    const list = await env.SUBSCRIPTIONS.list({ prefix: '' });

    // message payload for clients (string or object)
    const pushMessage = {
      data: JSON.stringify({ user: msg.user, message: msg.message }),
      options: { ttl: 60 }
    };

    for (const key of list.keys) {
      try {
        const raw = await env.SUBSCRIPTIONS.get(key.name);
        if (!raw) continue;
        const record = JSON.parse(raw);
        const subscription = record.subscription || record;

        // build encrypted push payload suitable for push service
        const payload = await buildPushPayload(pushMessage, subscription, vapid);

        // send to browser's push service endpoint
        const res = await fetch(subscription.endpoint, payload);

        // if push service says subscription gone, delete from KV
        if (res.status === 404 || res.status === 410) {
          await env.SUBSCRIPTIONS.delete(key.name);
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
