// functions/subscribe.js
// Stores a client's PushSubscription in Workers KV (binding name: SUBSCRIBERS)

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
    const subscription = body.subscription;
    const user = body.user || 'anonymous';
    if (!subscription || !subscription.endpoint) {
      return new Response(JSON.stringify({ error: 'Invalid subscription' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }});
    }

    // Create a stable key for the subscription using base64 of endpoint
    const key = 'sub:' + btoa(subscription.endpoint);

    const value = JSON.stringify({ subscription, user, created: Date.now() });
    await env.SUBSCRIBERS.put(key, value);

    return new Response(JSON.stringify({ ok: true, key }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }});
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }});
  }
}
