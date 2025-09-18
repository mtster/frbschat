// functions/subscribe.js
// Stores a client's PushSubscription in Workers KV (binding name: SUBSCRIPTIONS)

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
    const subscription = body.subscription || body;
    const user = body.user || null;
    const id = 'sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);

    const record = { subscription, user, createdAt: new Date().toISOString() };
    await env.SUBSCRIPTIONS.put(id, JSON.stringify(record));

    return new Response(JSON.stringify({ ok: true, id }), { status: 201, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  }
}
