// functions/send_test.js
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// POST body: { keyName: "<KV key name>" } OR { endpoint: "..." }
// If keyName supplied, it will fetch the subscription from KV first.
export async function onRequest(context) {
  const { env, request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  }

  try {
    const body = await request.json();
    let subscription = null;

    if (body.keyName) {
      const raw = await env.SUBSCRIBERS.get(body.keyName);
      if (!raw) return new Response(JSON.stringify({ error: 'No such key in KV' }), { status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }});
      subscription = JSON.parse(raw);
    } else if (body.endpoint) {
      subscription = { endpoint: body.endpoint };
    } else {
      return new Response(JSON.stringify({ error: 'Provide keyName or endpoint' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }});
    }

    // Attempt a raw POST (empty payload) to the subscription endpoint
    const endpoint = subscription.endpoint;
    if (!endpoint) return new Response(JSON.stringify({ error: 'Subscription missing endpoint' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }});

    // Some endpoints require content-length: 0 and TTL header
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'TTL': '60',
        'Content-Length': '0'
      },
      // empty body
      body: ''
    });

    // Return information about the response to help debugging
    const text = await safeText(resp);
    return new Response(JSON.stringify({
      status: resp.status,
      statusText: resp.statusText,
      headers: Object.fromEntries(resp.headers.entries()),
      bodySnippet: text.slice(0, 200)
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }});
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }});
  }
}

async function safeText(resp) {
  try {
    return await resp.text();
  } catch (_) {
    return '';
  }
}
