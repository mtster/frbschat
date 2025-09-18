// functions/list_subs.js
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export async function onRequest(context) {
  const { env, request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const list = await env.SUBSCRIBERS.list({ limit: 100 });
    const keys = list.keys || [];
    const results = [];

    for (const k of keys.slice(0, 20)) {
      const raw = await env.SUBSCRIBERS.get(k.name);
      try {
        const parsed = JSON.parse(raw);
        results.push({ key: k.name, value: parsed });
      } catch (e) {
        results.push({ key: k.name, value: raw });
      }
    }

    // Return up to first entry for quick inspection
    const first = results[0] || null;
    return new Response(JSON.stringify({ total: keys.length, sample: first, allKeys: keys.map(x => x.name).slice(0, 200) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }});
  }
}
